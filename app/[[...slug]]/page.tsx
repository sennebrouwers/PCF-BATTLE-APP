"use client";
import { lazy, Suspense, use, useEffect, useState, type FormEvent, type ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  Accessibility,
  ArrowDown,
  ArrowRight,
  Bot,
  CalendarDays,
  ChevronRight,
  Clock3,
  Hotel,
  Info,
  MapPin,
  MessageCircle,
  ParkingCircle,
  Plus,
  Star,
  Swords,
  Trophy,
  Utensils,
  Users,
  X,
  Zap,
} from "lucide-react";
import { toast, Toaster } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import PublicHeader from "@/components/public-header";
import PublicFooter from "@/components/public-footer";
import { publicCopy, usePublicLanguage } from "@/components/public-language";
import type { Match, PublicBracketData, PublicData, PublicLink, PublicScorer, Referee, StandingRow, Team, Tournament } from "@/types/app";
import { errorMessage } from "@/types/app";
import { getPageMetadata } from "@/lib/page-metadata";
const PortalApp = lazy(() => import("@/components/portal-app"));
const Gallery = lazy(() => import("@/components/gallery"));
const ScoreboardDisplay = lazy(() => import("@/components/scoreboard-display"));
const PublicChat = lazy(() => import("@/components/public-chat"));
const LOGO = "/PFB_Logo_Pink.svg";

function DeferredPublicChat() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const run = () => setReady(true);
    if ("requestIdleCallback" in window) {
      const id = window.requestIdleCallback(run, { timeout: 2500 });
      return () => window.cancelIdleCallback(id);
    }
    const id = setTimeout(run, 1200);
    return () => clearTimeout(id);
  }, []);
  return ready ? <Suspense fallback={null}><PublicChat /></Suspense> : null;
}
function teamSlug(name: string, id?: string) {
  const slug = String(name || "team")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || id || "team";
}
async function api(path: string, options: RequestInit = {}) {
  const headers = new Headers(options.headers);
  if (options.body) headers.set("Content-Type", "application/json");
  const response = await fetch(`/api${path}`, {
    ...options,
    headers,
    credentials: "same-origin",
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Request failed");
  return data;
}
function Status({ s }: { s: string }) {
  return (
    <span className={`status ${s}`}>
      {s === "live" && <i />}
      {s}
    </span>
  );
}
function LiveClock({ match }: { match: Match }) {
  const [now, setNow] = useState(0);
  useEffect(() => {
    if (!match?.clock_running) return;
    const timer = setInterval(() => setNow(Date.now()), 250);
    setNow(Date.now());
    return () => clearInterval(timer);
  }, [match?.id, match?.clock_running, match?.clock_started_at]);
  const [minutes = "0", seconds = "0"] = String(match?.clock || "00:00").split(":"),
    base = Number(minutes) * 60 + Number(seconds),
    left = match?.clock_running && match?.clock_started_at
      ? Math.max(0, base - Math.floor((now - new Date(String(match.clock_started_at)).getTime()) / 1000))
      : base;
  return <>{`${Math.floor(left / 60).toString().padStart(2, "0")}:${(left % 60).toString().padStart(2, "0")}`}</>;
}
function Chat() {
  const { language } = usePublicLanguage();
  const copy = publicCopy[language];
  const [open, setOpen] = useState(false),
    [text, setText] = useState("");
  const [msgs, setMsgs] = useState<string[]>([
    language === "nl"
      ? "Hallo! Stel me een vraag over livewedstrijden, het wedstrijdschema, de stand of de regels."
      : "Hi! Ask me about live matches, standings, the schedule or rules.",
  ]);
  async function send(q = text) {
    if (!q) return;
    setMsgs((v) => [...v, q]);
    setText("");
    try {
      const out = await api("/chat", {
        method: "POST",
        body: JSON.stringify({ message: q, language }),
      });
      setMsgs((v) => [...v, out.answer]);
    } catch {
      setMsgs((v) => [
        ...v,
        language === "nl"
          ? "Ik kan de toernooiinformatie momenteel niet ophalen. Neem contact op met de organisatie via hello@pcfbattle.be."
          : "I couldn’t reach the tournament data. Please contact the organisation at hello@pcfbattle.be for further assistance.",
      ]);
    }
  }
  return (
    <>
      <button className="chatfab" onClick={() => setOpen(!open)} aria-label={open ? "Close tournament assistant" : "Open tournament assistant"}>
        {open ? <X /> : <MessageCircle />}
      </button>
      {open && (
        <aside className="chat">
          <div>
            <Bot /> {copy.tournamentAssistant} <small>{copy.liveData}</small>
          </div>
          <section>
            {msgs.map((x, i) => (
              <p className={i % 2 ? "you" : "bot"} key={i}>
                {x}
              </p>
            ))}
          </section>
          <nav>
              <button onClick={() => send("Live matches")}>{copy.liveMatches}</button>
              <button onClick={() => send("Standings")}>{copy.standings}</button>
          </nav>
          <form
            toolname="ask_tournament_assistant"
            tooldescription="Ask the PCF BATTLE tournament assistant for public information about matches, standings, and schedules."
            onSubmit={(e) => {
              e.preventDefault();
              send();
            }}
          >
            <input
              name="question"
              toolparamdescription="The visitor's question about the tournament."
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={`${copy.question}…`}
              aria-label={copy.question}
            />
            <button>{copy.send}</button>
          </form>
        </aside>
      )}
    </>
  );
}
function Login() {
  const [email, setEmail] = useState(""),
    [pass, setPass] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function go(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const out = await api("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password: pass }),
      });
      localStorage.setItem("phb_user", JSON.stringify(out.user));
      const r = String(out.user.role).toLowerCase();
      const requested = new URLSearchParams(location.search).get("return");
      window.location.assign(
        requested?.startsWith("/") && !requested.startsWith("//")
          ? requested
          : r === "admin" ? "/admin" : r === "team" ? "/my-team" : r === "referee" ? "/referee" : "/scoreboard",
      );
    } catch (err: unknown) {
      setError(errorMessage(err, "Unable to sign in"));
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="loginpage">
      <Link className="brand" href="/">
        <Image src={LOGO} alt="PCF Battle" width={58} height={58} unoptimized />
        <span>
          PCF <b>BATTLE</b>
        </span>
      </Link>
      <section>
        <span className="pink">WELCOME BACK</span>
        <h1>Sign in to your portal</h1>
        <p>Manage your tournament, team, or referee assignments.</p>
        <form method="post" onSubmit={go} toolname="sign_in_to_portal" tooldescription="Sign in to the PCF BATTLE team, referee, or administrator portal.">
          <label>
            Email address
            <input id="login-email" name="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label>
            Password
            <input
              id="login-password"
              name="password"
              type="password"
              autoComplete="current-password"
              value={pass}
              onChange={(e) => setPass(e.target.value)}
            />
          </label>
          {error && <p className="formerror">{error}</p>}
          <button className="btn primary" disabled={busy}>
            {busy ? "Signing in…" : "Sign in"} <ChevronRight />
          </button>
        </form>
      </section>
    </main>
  );
}
function Signup() {
  const [code, setCode] = useState(""),
    [teamName, setTeamName] = useState(""),
    [email, setEmail] = useState(""),
    [name, setName] = useState(""),
    [pass, setPass] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [ok, setOk] = useState(false),
    [inviteReady, setInviteReady] = useState(false);
  useEffect(() => {
    const inviteCode = new URLSearchParams(window.location.search).get("code")?.trim() || "";
    setCode(inviteCode);
    if (!inviteCode) {
      setError("This invite link is missing its code.");
      return;
    }
    api("/invites/verify", {
      method: "POST",
      body: JSON.stringify({ code: inviteCode }),
    }).then((invite) => {
      setTeamName(invite.team_name || "");
      if (invite.recipient_email) setEmail(invite.recipient_email);
      setInviteReady(true);
    }).catch((e) => setError(e.message));
  }, []);
  async function redeem(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await api("/invites/redeem", {
        method: "POST",
        body: JSON.stringify({ code, email, name, password: pass }),
      });
      setOk(true);
    } catch (e: unknown) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="loginpage">
      <Link className="brand" href="/">
        <Image src={LOGO} alt="PCF Battle" width={58} height={58} unoptimized />
        <span>
          PCF <b>BATTLE</b>
        </span>
      </Link>
      <section>
        <span className="pink">TEAM INVITE</span>
        <h1>Create your team login</h1>
        {ok ? (
          <>
            <p>
              Your account is ready. You can now sign in to the team portal.
            </p>
            <Link className="btn primary" href={`/login?return=${encodeURIComponent("/my-team")}`}>
              Go to sign in <ChevronRight />
            </Link>
          </>
        ) : !inviteReady ? (
          <>
            <p>{error || "A valid team invitation is required to create an account."}</p>
            <Link className="btn" href="/login">Go to sign in</Link>
          </>
        ) : (
          <form method="post" onSubmit={redeem} toolname="create_team_portal_account" tooldescription="Create a team portal account using a valid PCF BATTLE invitation.">
            <label>
              Team name
              <input name="team_name" value={teamName} readOnly aria-readonly="true" toolparamdescription="The invited team name." />
            </label>
            <label>
              Your name
              <input
                name="name"
                toolparamdescription="The account holder's full name."
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={120}
                autoComplete="name"
                required
              />
            </label>
            <label>
              Email address
              <input
                name="email"
                toolparamdescription="The account holder's email address."
                type="email"
                value={email}
                readOnly
                autoComplete="email"
                maxLength={254}
                required
              />
            </label>
            <label>
              Password
              <input
                name="password"
                toolparamdescription="A password for the new team portal account."
                type="password"
                value={pass}
                onChange={(e) => setPass(e.target.value)}
                minLength={8}
                maxLength={256}
                autoComplete="new-password"
                required
              />
            </label>
            {error && <p className="formerror">{error}</p>}
            <button className="btn primary" disabled={busy} aria-busy={busy}>
              {busy ? "Creating account…" : "Create account"} {!busy && <ChevronRight />}
            </button>
          </form>
        )}
      </section>
    </main>
  );
}
function Panel({
  title,
  action,
  children,
}: {
  title: string;
  action?: string;
  children: ReactNode;
}) {
  return (
    <section className="panel">
      <div className="panelhead">
        <h3>{title}</h3>
        {action && (
          <button
            className="btn small"
            onClick={() => toast.success(`${action} opened`)}
          >
            <Plus />
            {action}
          </button>
        )}
      </div>
      {children}
    </section>
  );
}
function LiveMark({ team }: { team?: Team }) {
  if (team?.logo) return <span className="mark team-logo-mark"><img src={team.logo} alt="" /></span>;
  return (
    <span className="mark" style={{ background: team?.color || "#64748b" }}>
      {String(team?.name || "?")
        .split(" ")
        .map((x: string) => x[0])
        .join("")
        .slice(0, 2)}
    </span>
  );
}
function knockoutLabel(groupId?: string | null) {
  const labels: Record<string, string> = {
    "ko:5a": "Intermediate 1",
    "ko:5b": "Intermediate 2",
    "ko:sf1": "Semi-final 1",
    "ko:sf2": "Semi-final 2",
    "ko:7th": "7th/8th place match",
    "ko:5th": "5th/6th place match",
    "ko:3rd": "3rd/4th place match",
    "ko:final": "Final",
  };
  return labels[String(groupId || "").toLowerCase()] || "Knockout match";
}
function LiveMatch({ match, teams: all, referees = [] }: { match: Match; teams: Team[]; referees?: Referee[] }) {
  const { language } = usePublicLanguage();
  const copy = publicCopy[language];
  const sources: Record<string,string> = {"placeholder:KO:sf1:home":"1st Group A","placeholder:KO:sf1:away":"2nd Group B","placeholder:KO:sf2:home":"1st Group B","placeholder:KO:sf2:away":"2nd Group A","placeholder:KO:5a:home":"3rd Group A","placeholder:KO:5a:away":"4th Group B","placeholder:KO:5b:home":"3rd Group B","placeholder:KO:5b:away":"4th Group A","placeholder:KO:final:home":"Winner Semi-final 1","placeholder:KO:final:away":"Winner Semi-final 2","placeholder:KO:3rd:home":"Loser Semi-final 1","placeholder:KO:3rd:away":"Loser Semi-final 2","placeholder:KO:5th:home":"Winner Intermediate 1","placeholder:KO:5th:away":"Winner Intermediate 2","placeholder:KO:7th:home":"Loser Intermediate 1","placeholder:KO:7th:away":"Loser Intermediate 2"};
  const home = all.find((t) => t.id === match.home_team_id), away = all.find((t) => t.id === match.away_team_id);
  const homeName = home?.name || (match.home_team_id ? sources[match.home_team_id] : undefined) || "TBD", awayName = away?.name || (match.away_team_id ? sources[match.away_team_id] : undefined) || "TBD";
  const refereeNames = (match.referee_ids || []).map((id: string) => referees.find((referee) => referee.id === id)?.name).filter(Boolean);
  return (
    <article className={`match ${match.status}`}>
      <div className="meta">
      <Status s={match.status || "scheduled"} />
        <span>
          {match.match_date ? `${new Date(`${match.match_date}T12:00:00`).toLocaleDateString("en-BE")} · ` : ""}{match.start_time || "TBD"} · {match.court || "Court TBD"}
        </span>
        <span className={`public-group-sticker ${String(match.group_id || "").replace(/^group-/i, "").toLowerCase() === "b" ? "group-b" : ""}`}>{String(match.group_id || "").toLowerCase().startsWith("ko:") ? knockoutLabel(match.group_id) : `${copy.groupLabel} ${String(match.group_id || "—").replace(/^group-/i, "")}`}</span>
      </div>
      <div className="versus">
        <div>
          <LiveMark team={home} />
          <b>{homeName}</b>
        </div>
        <strong>
          {match.home_score || 0}
          <i>—</i>
          {match.away_score || 0}
        </strong>
        <div>
          <b>{awayName}</b>
          <LiveMark team={away} />
        </div>
      </div>
      <div className="match-officials"><span>Referees</span><b>{refereeNames.length ? refereeNames.join(" · ") : "Not assigned"}</b></div>
    </article>
  );
}
const emptyPublicData: PublicData = {
    teams: [],
    matches: [],
    standings: [],
    links: [],
    brackets: [],
    tournaments: [],
    referees: [],
    scorers: [],
    players: [],
    schedule_items: [],
    ready: false,
    updatedAt: null,
  };
let publicDataCache: PublicData | null = null;
const publicDataStorageKey = "pcf-public-data-cache";
const publicDataCacheVersion = 3;
function readPublicDataCache(): PublicData | null {
  if (publicDataCache) return publicDataCache;
  try {
    const stored = JSON.parse(localStorage.getItem(publicDataStorageKey) || "null");
    if (stored?.version === publicDataCacheVersion && stored?.payload && Date.now() - Number(stored.savedAt || 0) < 60_000) {
      publicDataCache = stored.payload;
    }
  } catch {}
  return publicDataCache;
}

function usePublicData(): PublicData {
  // Start empty so the first client render matches the server; the cache is
  // applied right after hydration.
  const [data, setData] = useState<PublicData>(emptyPublicData);
  useEffect(() => {
    const cached = readPublicDataCache();
    if (cached) setData((current) => (current.ready ? current : { ...emptyPublicData, ...cached, ready: true }));
  }, []);
  useEffect(() => {
    let mounted = true;
    let refreshBusy = false;
    // Only poll live scores when a match can actually be live. Re-evaluated on every
    // public-data refresh (10s), so polling resumes soon after live is switched on.
    let livePossible = false;
    const set = (values: Partial<PublicData>) => {
      if (!mounted) return;
      if (Array.isArray(values.tournaments)) {
        const active = values.tournaments.find((t) => t.active) || values.tournaments[0];
        livePossible = Boolean(active) && active.show_tournament !== 0 && active.live_enabled !== 0 && active.registration_mode !== 1;
      }
      setData((current) => {
        const next = { ...current, ...values };
        if (next.ready) {
          publicDataCache = next;
          try {
            const serialized = JSON.stringify({ version: publicDataCacheVersion, savedAt: Date.now(), payload: next });
            if (serialized.length <= 1_500_000) localStorage.setItem(publicDataStorageKey, serialized);
            else localStorage.removeItem(publicDataStorageKey);
          } catch { try { localStorage.removeItem(publicDataStorageKey); } catch {} }
        }
        return next;
      });
    };
    api("/public-data")
      .then((values: PublicData) => set({ ...values, ready: true, error: "", updatedAt: new Date().toISOString() }))
      .catch((error: unknown) => set({ ready: true, error: error instanceof Error ? error.message : "Unable to load tournament data." }));
    const interval = location.pathname === "/" || location.pathname.startsWith("/tournament/") ? 10000 : 300000;
    const refreshTimer = setInterval(async () => {
      if (document.hidden || refreshBusy) return;
      refreshBusy = true;
      try { set({ ...(await api("/public-data")), ready: true, error: "", updatedAt: new Date().toISOString() }); } catch (error: unknown) { set({ error: error instanceof Error ? error.message : "Unable to refresh tournament data." }); }
      finally { refreshBusy = false; }
    }, interval);
    const liveTimer = location.pathname === "/" || location.pathname.startsWith("/tournament/")
      ? setInterval(async () => {
          if (document.hidden || refreshBusy || !livePossible) return;
          refreshBusy = true;
          try {
            const { match } = await api("/live-state");
            if (match) setData((current) => ({
              ...current,
              matches: current.matches.some((item) => item.id === match.id)
                ? current.matches.map((item) => item.id === match.id ? match : item)
                : [match, ...current.matches],
              updatedAt: new Date().toISOString(),
            }));
          } catch {}
          finally { refreshBusy = false; }
        }, 2000)
      : undefined;
    const onVisibility = () => {
      if (!document.hidden && livePossible) {
        void api("/live-state").then(({ match }) => {
          if (!match || !mounted) return;
          setData((current) => ({ ...current, matches: current.matches.some((item) => item.id === match.id) ? current.matches.map((item) => item.id === match.id ? match : item) : [match, ...current.matches], updatedAt: new Date().toISOString() }));
        }).catch(() => undefined);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      mounted = false;
      clearInterval(refreshTimer);
      if (liveTimer) clearInterval(liveTimer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);
  return data;
}
function PublicDataError({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return <div className="empty-state error-state" role="alert"><p>{message}</p>{onRetry && <button className="btn" onClick={onRetry}>Retry</button>}</div>;
}
function LastUpdated({ value, language }: { value?: string | null; language?: string }) {
  if (!value) return null;
  void language;
  const time = new Date(value).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  return <p className="last-updated" aria-live="polite">{`Last updated at ${time}`}</p>;
}
function localized(value: unknown, ...args: string[]) {
  void args;
  if (value && typeof value === "object") {
    const entry = value as Record<string, unknown>;
    return String(entry.en ?? "");
  }
  return String(value ?? "");
}
function ConnectionStatus({ updatedAt }: { updatedAt?: string | null }) {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    addEventListener("online", update);
    addEventListener("offline", update);
    return () => {
      removeEventListener("online", update);
      removeEventListener("offline", update);
    };
  }, []);
  if (online) return null;
  return (
    <div className="connection-status" role="status">
      Offline · showing data from {updatedAt ? new Date(updatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "the last update"}
    </div>
  );
}
function TournamentHeroDetails({ tournament }: { tournament?: Tournament }) {
  if (!tournament) return null;
  const date = (value: string | undefined) => {
      if (!value) return "Date to be announced";
      const parsed = new Date(`${value}T12:00:00Z`);
      return Number.isNaN(parsed.getTime())
        ? "Date to be announced"
        : parsed.toLocaleDateString("en-GB", {
            day: "numeric",
            month: "long",
            year: "numeric",
            timeZone: "UTC",
          });
    },
    start = tournament.start_date,
    end = tournament.end_date,
    range =
      start && end && start !== end
        ? `${date(start)} — ${date(end)}`
        : date(start || end),
    location = [
      tournament.city || "Leuven",
      tournament.country || "Belgium",
    ].join(", ");
  return (
    <div className="tournament-hero-details">
      <span>
        <CalendarDays />
        {range}
      </span>
      <span>
        <MapPin />
        {location}
      </span>
    </div>
  );
}
function SponsorBanner({ sponsors }: { sponsors: PublicLink[] }) {
  const looping = sponsors.length > 1;
  const items = looping ? [...sponsors, ...sponsors] : sponsors;
  if (!sponsors.length) return null;
  return (
    <section
      className={`sponsor-banner sponsor-carousel-v3${looping ? " is-looping" : ""}`}
    >
      <div className="sponsor-carousel-v3-viewport">
        <div className="sponsor-carousel-v3-track">
          {items.map((s: PublicLink, i: number) => {
            const logo = (
              <span className={`sponsor-v3-frame${s.dark_url ? " has-dark-logo" : ""}`}>
                <img className="sponsor-v3-logo sponsor-v3-light" src={s.url} alt={i < sponsors.length ? s.title || "Tournament sponsor" : ""} loading="lazy" />
                {s.dark_url ? <img className="sponsor-v3-logo sponsor-v3-dark" src={s.dark_url} alt="" aria-hidden="true" loading="lazy" /> : null}
              </span>
            );
            if (i >= sponsors.length) return <span className="sponsor-v3-item" aria-hidden="true" key={`${s.id}-${i}`}>{logo}</span>;
            return s.target_url ? <a className="sponsor-v3-item" href={s.target_url} target="_blank" rel="noreferrer" key={`${s.id}-${i}`}>{logo}</a> : <span className="sponsor-v3-item" key={`${s.id}-${i}`}>{logo}</span>;
          })}
        </div>
      </div>
    </section>
  );
}
function PreRegistrationDialog() {
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [done, setDone] = useState(false),
    [error, setError] = useState("");
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const b = Object.fromEntries(new FormData(e.currentTarget));
    try {
      await api("/preregister", {
        method: "POST",
        body: JSON.stringify({
          club_name: b.club_name,
          email: b.email,
          terms_accepted: b.terms_accepted === "on",
        }),
      });
      setDone(true);
    } catch (err: unknown) {
      setError(errorMessage(err, "Unable to register"));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) {
          setDone(false);
          setError("");
        }
      }}
    >
      <button
        className="btn primary registration-cta"
        onClick={() => setOpen(true)}
      >
        <Users /> Register your club
      </button>
      <DialogContent
        className="portal-dialog registration-dialog"
        centerInOverlay
      >
        <DialogHeader>
          <DialogTitle>Register for PCF Battle</DialogTitle>
        </DialogHeader>
        {done ? (
          <div className="registration-success">
            <h3>Thanks — you’re on the list.</h3>
            <p>We’ll contact your club with the next registration steps.</p>
            <button className="btn primary" onClick={() => setOpen(false)}>
              Close
            </button>
          </div>
        ) : (
          <form className="portal-form" method="post" onSubmit={submit} toolname="register_team" tooldescription="Register a club for PCF BATTLE by submitting its name and contact email.">
            <label className="portal-field">
              <span>Club name</span>
              <input name="club_name" required placeholder="Your club" toolparamdescription="The name of the club or team." />
            </label>
            <label className="portal-field">
              <span>Email address</span>
              <input
                name="email"
                type="email"
                required
                placeholder="you@example.com"
                toolparamdescription="The club contact email address."
              />
            </label>
            <label className="registration-consent">
              <input name="terms_accepted" type="checkbox" required />
              <span>
                I have read and agree to the <Link href="/terms">Terms &amp; Conditions</Link> and acknowledge that submitting a registration does not guarantee participation.
              </span>
            </label>
            {error && <p className="formerror">{error}</p>}
            <div className="form-actions">
              <button className="btn primary" disabled={busy}>
                {busy ? "Registering…" : "Register"}
              </button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
function PublicHomeLoading() {
  return (
    <>
      <PublicHeader loading />
      <main className="reference-home public-home-loading" aria-busy="true">
        <section className="reference-hero">
          <div className="reference-copy">
            <span className="live-pill loading-line" />
            <h1>
              <strong>
                <span className="hero-title-pink">Powerchair</span><br />
                <em className="hero-title-pink">Floorball</em>
                <br />
                <em className="hero-title-white">Battle</em>
              </strong>
            </h1>
            <div className="tournament-hero-details loading-details">
              <span />
              <span />
            </div>
            <p className="loading-copy" />
            <div className="reference-actions loading-actions">
              <span />
              <span />
            </div>
          </div>
          <div className="action-frame">
            <div className="orange-glow" />
            <picture className="hero-image-picture">
              <source media="(max-width: 800px)" srcSet="/pcf-battle-hero-mobile.svg" />
              <Image
                src="/pcf-battle-hero-high.svg"
                alt="Powerchair floorball player competing during a match"
                fill
                priority
                sizes="(max-width: 800px) 100vw, 56vw"
              />
            </picture>
          </div>
        </section>
      </main>
      <PublicFooter />
    </>
  );
}
function DynamicLanding() {
  const { language } = usePublicLanguage();
  const copy = publicCopy[language];
  const d = usePublicData();
  const [favouriteTeamId, setFavouriteTeamId] = useState("");
  useEffect(() => setFavouriteTeamId(localStorage.getItem("pcf_favourite_team") || ""), []);
  if (!d.ready) return <PublicHomeLoading />;
  const tournament =
    d.tournaments.find((t) => t.active) || d.tournaments[0] || {},
    registration = Number(tournament.registration_mode) !== 0,
    registrationsOpen = registration && Number(tournament.registration_enabled ?? 1) !== 0,
    liveEnabled = tournament.live_enabled !== 0,
    live = liveEnabled ? d.matches.find((m) => m.status === "live") : null,
    home = d.teams.find((t: Team) => t.id === live?.home_team_id),
    away = d.teams.find((t: Team) => t.id === live?.away_team_id),
    sponsors = d.links
      .filter((l) => l.category === "Sponsor" && l.active !== 0)
      .sort((a, b) => Number(a.sort_order) - Number(b.sort_order));
  const quick = [
    {
      name: copy.live,
      detail: copy.viewLiveAction,
      href: "/tournament/live",
      icon: Zap,
      tone: "pink",
      show: tournament.show_tournament !== 0 && liveEnabled && tournament.show_matches !== 0,
    },
    {
      name: copy.schedule,
      detail: copy.viewAllMatches,
      href: "/tournament/schedule",
      icon: CalendarDays,
      tone: "blue",
      show: tournament.show_tournament !== 0 && tournament.show_matches !== 0,
    },
    {
      name: copy.standings,
      detail: copy.viewRankings,
      href: "/tournament/standings",
      icon: Trophy,
      tone: "orange",
      show: tournament.show_tournament !== 0 && tournament.show_standings !== 0,
    },
    {
      name: copy.brackets,
      detail: copy.viewKnockout,
      href: "/tournament/brackets",
      icon: Swords,
      tone: "purple",
      show: tournament.show_tournament !== 0 && tournament.show_brackets !== 0,
    },
  ].filter((x) => x.show);
  return (
    <>
      <PublicHeader settings={tournament} currentPath="/" />
      <main className="reference-home">
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "SportsEvent",
          "@id": "https://www.pcfbattle.be/#event-2027",
          name: "Powerchair Floorball Battle 2027",
          description: "International powerchair floorball tournament in Leuven, Belgium, on 1 and 2 May 2027.",
          url: "https://www.pcfbattle.be/",
          image: "https://www.pcfbattle.be/pcf-social-graph.jpg",
          startDate: "2027-05-01T09:00:00+02:00",
          endDate: "2027-05-02T18:00:00+02:00",
          eventStatus: "https://schema.org/EventScheduled",
          eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
          location: {
            "@type": "Place",
            name: "Leuven, Belgium",
            address: { "@type": "PostalAddress", addressLocality: "Leuven", addressCountry: "BE" },
          },
          sport: "Powerchair Floorball",
          organizer: { "@id": "https://www.pcfbattle.be/#organization" },
        }) }} />
        <section className="reference-hero">
          <div className="reference-copy">
            <span className={`live-pill${registration && !registrationsOpen ? " registration-closed" : ""}`}>
              <i />{" "}
              {registration
                ? registrationsOpen
                  ? copy.registrationOpen
                  : copy.registrationClosed
                : live
                  ? copy.liveTournament
                  : copy.tournamentTag}
            </span>
            <h1>
              <strong>
                <span className="hero-title-pink">Powerchair</span>
                <br />
                <em className="hero-title-pink">Floorball</em>
                <br />
                <em className="hero-title-white">Battle</em>
              </strong>
            </h1>
            <TournamentHeroDetails tournament={tournament} />
            <p>
              {registration
                ? localized(tournament.public_message, language) ||
                  (registrationsOpen
                    ? "Team registration is currently open. Tournament details will be published soon."
                    : copy.registrationClosed)
                : copy.followTournament}
            </p>
            {registration && (
              <div className="reference-actions registration-actions">
                {tournament.registration_enabled !== 0 && (
                  <PreRegistrationDialog />
                )}
                <Link className="btn" href="/about">
                  {copy.practicalInformation}
                </Link>
              </div>
            )}
            {!registration && (
              <div className="reference-actions">
                {liveEnabled && tournament.show_matches !== 0 && (
                  <Link className="btn primary" href="/tournament/live">
                    <Zap /> {copy.watchLive}
                  </Link>
                )}
                {tournament.show_standings !== 0 && (
                  <Link className="btn" href="/tournament/standings">
                    <Trophy /> {copy.standings}
                  </Link>
                )}
              </div>
            )}
          </div>
          <div className="action-frame">
            <div className="orange-glow" />
            <picture className="hero-image-picture">
              <source media="(max-width: 800px)" srcSet="/pcf-battle-hero-mobile.svg" />
              <Image
                src="/pcf-battle-hero-high.svg"
                alt="Powerchair floorball player competing during a match"
                fill
                priority
                sizes="(max-width: 800px) 100vw, 56vw"
              />
            </picture>
            {!registration && live && (
              <Link className="live-score" href="/tournament/live">
                <span>
                  <i /> LIVE · {live.court || "COURT"}
                </span>
                <b>
                  {home?.name || "Home"}{" "}
                  <strong>
                    {live.home_score}–{live.away_score}
                  </strong>{" "}
                  {away?.name || "Away"}
                </b>
                <small>
                  {live.period || "In progress"} · <LiveClock match={live} />{" "}
                  <ChevronRight />
                </small>
              </Link>
            )}
          </div>
        </section>
        {!registration && tournament.show_teams !== 0 && (
          <section className="block team-overview">
            <div className="title">
              <div>
                <h2>{copy.participatingTeams}</h2>
              </div>
            </div>
            <div className="teamgrid">
              {d.teams.length === 0 && (
                <p className="empty-state">{copy.teamsEmpty}</p>
              )}
              {d.teams.map((team: Team) => (
                <article key={team.id} className={favouriteTeamId === team.id ? "favourite" : ""}>
                  <Link className="team-home-link" href={`/teams/${teamSlug(team.name, team.id)}`}>
                    <LiveMark team={team} />
                    <div><b>{team.name}</b><small>{copy.groupLabel} {team.group_id}</small></div>
                  </Link>
                  <button
                    className="favourite-team"
                    aria-label={favouriteTeamId === team.id ? `Remove ${team.name} from favourites` : `Follow ${team.name}`}
                    aria-pressed={favouriteTeamId === team.id}
                    onClick={() => {
                      const next = favouriteTeamId === team.id ? "" : team.id;
                      setFavouriteTeamId(next);
                      if (next) localStorage.setItem("pcf_favourite_team", next);
                      else localStorage.removeItem("pcf_favourite_team");
                    }}
                  ><Star /></button>
                </article>
              ))}
            </div>
          </section>
        )}
        <SponsorBanner sponsors={sponsors} />
        <section className="quick-grid">
            {quick.map(({ name, detail, href, icon: Icon, tone }) => (
              <Link href={href} key={name}>
                <span className={`quick-icon ${tone}`}>
                  <Icon />
                </span>
                <b>{name}</b>
                <small>
                  {detail} <ChevronRight />
                </small>
              </Link>
            ))}
        </section>
        <PublicFooter />
      </main>
      <Chat />
      <ConnectionStatus updatedAt={d.updatedAt} />
      <Toaster richColors />
    </>
  );
}
function DynamicStandings({ rows }: { rows: StandingRow[] }) {
  return (
    <div className="group-standings">
      <PublicStandingsGroupTable rows={rows} group="A" />
      <PublicStandingsGroupTable rows={rows} group="B" />
    </div>
  );
}
function PublicStandingsGroupTable({ rows, group }: { rows: StandingRow[]; group: string }) {
  const { language } = usePublicLanguage();
  const copy = publicCopy[language];
  const groupRows = rows.filter(
      (t: StandingRow) =>
        String(t.group_id).replace("group-", "").toUpperCase() === group,
    );
  return (
    <section className="group-standing standings-group-table">
        <h2>{copy.group} {group}</h2>
        <div className="table">
          <table className="standings-table">
            <colgroup>
              <col className="standings-col-rank" />
              <col className="standings-col-team" />
              <col className="standings-col-stat" />
              <col className="standings-col-stat" />
              <col className="standings-col-stat" />
            </colgroup>
            <thead>
              <tr>
                <th>#</th>
                <th>{copy.team}</th>
                <th>PLD</th>
                <th>PTS</th>
                <th>+/-</th>
              </tr>
            </thead>
            <tbody>
              {groupRows.map((t: StandingRow, i: number) => (
                <tr key={t.id}>
                  <td>
                    <b>{i + 1}</b>
                  </td>
                  <td>
                    <span className="teamcell">
                      <LiveMark team={t} />
                      <b>{t.name}</b>
                    </span>
                  </td>
                  <td>{t.played}</td>
                  <td>
                    <b className="points">{t.points}</b>
                  </td>
                  <td>
                    {(t.goalDifference ?? 0) > 0 ? "+" : ""}
                    {t.goalDifference ?? 0}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
    </section>
  );
}
function BracketSchedule({ data }: { data: PublicBracketData }) {
  const normalizedGroup = (value: unknown) => String(value || "").replace(/^group-/i, "").toUpperCase();
  const groupMatches = data.matches.filter((m: Match) =>
      ["A", "B"].includes(normalizedGroup(m.group_id)),
    ),
    complete =
      groupMatches.length > 0 &&
      groupMatches.length >=
        ["A", "B"].reduce((sum, g) => {
          const count = data.teams.filter(
            (t: Team) =>
              String(t.group_id).replace("group-", "").toUpperCase() === g,
          ).length;
          return sum + (count * (count - 1)) / 2;
        }, 0) &&
      groupMatches.every((m: Match) => m.status === "finished"),
    rank = (group: string, pos: number) =>
      complete
        ? data.standings.filter(
            (t: StandingRow) =>
              String(t.group_id).replace("group-", "").toUpperCase() === group,
          )[pos - 1]
        : null,
    matchAt = (time: string) =>
      data.matches.find(
        (m: Match) =>
          m.start_time === time &&
          !["A", "B"].includes(normalizedGroup(m.group_id)),
      ),
    winner = (m: Match | undefined) =>
      m && m.status === "finished"
        ? (m.home_score ?? 0) > (m.away_score ?? 0)
          ? data.teams.find((t: Team) => t.id === m.home_team_id)
          : data.teams.find((t: Team) => t.id === m.away_team_id)
        : null,
    loser = (m: Match | undefined) =>
      m && m.status === "finished"
        ? (m.home_score ?? 0) < (m.away_score ?? 0)
          ? data.teams.find((t: Team) => t.id === m.home_team_id)
          : data.teams.find((t: Team) => t.id === m.away_team_id)
        : null,
    m09 = matchAt("09:00"),
    m10 = matchAt("10:00"),
    sf1 = matchAt("11:00"),
    sf2 = matchAt("12:00");
  const games = [
    {
      time: "09:00",
      title: "Placement Match",
      a: rank("A", 3),
      aText: "3rd Group A",
      b: rank("B", 4),
      bText: "4th Group B",
      m: m09,
    },
    {
      time: "10:00",
      title: "Placement Match",
      a: rank("B", 3),
      aText: "3rd Group B",
      b: rank("A", 4),
      bText: "4th Group A",
      m: m10,
    },
    {
      time: "11:00",
      title: "Semi-final 1",
      a: rank("A", 1),
      aText: "1st Group A",
      b: rank("B", 2),
      bText: "2nd Group B",
      m: sf1,
    },
    {
      time: "12:00",
      title: "Semi-final 2",
      a: rank("B", 1),
      aText: "1st Group B",
      b: rank("A", 2),
      bText: "2nd Group A",
      m: sf2,
    },
    {
      time: "13:00",
      title: "7th/8th Place Final",
      a: loser(m09),
      aText: "Loser of 09:00 match",
      b: loser(m10),
      bText: "Loser of 10:00 match",
      m: matchAt("13:00"),
    },
    {
      time: "14:00",
      title: "5th/6th Place Final",
      a: winner(m09),
      aText: "Winner of 09:00 match",
      b: winner(m10),
      bText: "Winner of 10:00 match",
      m: matchAt("14:00"),
    },
    {
      time: "15:00",
      title: "3rd/4th Place Final",
      a: loser(sf1),
      aText: "Loser of Semi-final 1",
      b: loser(sf2),
      bText: "Loser of Semi-final 2",
      m: matchAt("15:00"),
    },
    {
      time: "16:30",
      title: "Grand Final – 1st/2nd Place",
      a: winner(sf1),
      aText: "Winner of Semi-final 1",
      b: winner(sf2),
      bText: "Winner of Semi-final 2",
      m: matchAt("16:30"),
    },
  ];
  return (
    <div className="scheduled-bracket">
      {games.map((g, index) => {
        const groupId = ["KO:5a", "KO:5b", "KO:sf1", "KO:sf2", "KO:7th", "KO:5th", "KO:3rd", "KO:final"][index];
        const match = g.m || {
          id: `public-${groupId}`,
          status: "scheduled",
          group_id: groupId,
          start_time: g.time,
          court: "Court 1",
          home_team_id: `placeholder:${groupId}:home`,
          away_team_id: `placeholder:${groupId}:away`,
        };
        return <LiveMatch key={match.id} match={match as Match} teams={data.teams} referees={data.referees} />;
      })}
    </div>
  );
}
function PublicUnavailable({
  title,
  settings,
}: {
  title: string;
  settings: Tournament;
}) {
  return (
    <>
      <PublicHeader settings={settings} />
      <main className="public">
        <div className="pagehero">
          <span>PCF BATTLE</span>
          <h1>{title}</h1>
          <p>This section is not published yet.</p>
        </div>
      </main>
      <PublicFooter />
      <DeferredPublicChat />
    </>
  );
}
function DynamicPublic({ view }: { view: string }) {
  const { language } = usePublicLanguage();
  const copy = publicCopy[language];
  const d = usePublicData(),
    t = d.tournaments.find((x: Tournament) => x.active) || d.tournaments[0] || {},
    title = view[0].toUpperCase() + view.slice(1),
    visibility: any = {
      live: t.show_tournament !== 0 && t.live_enabled !== 0 && t.show_matches !== 0,
      schedule: t.show_tournament !== 0 && t.show_matches !== 0,
      standings: t.show_tournament !== 0 && t.show_standings !== 0,
      brackets: t.show_tournament !== 0 && t.show_brackets !== 0,
      statistics: t.show_tournament !== 0 && t.show_statistics !== 0,
    },
    allowed = visibility[view] !== false,
    live =
      t.live_enabled !== 0
        ? d.matches.find((m: Match) => m.status === "live")
        : null,
    finished = d.matches.filter((m: Match) => m.status === "finished"),
    goals = finished.reduce(
      (n: number, m: Match) =>
        n + Number(m.home_score || 0) + Number(m.away_score || 0),
      0,
    ),
    teamGoals = d.teams
      .map((team: Team) => ({
        ...team,
        goals: finished.reduce(
          (n: number, m: Match) =>
            n +
            (m.home_team_id === team.id
              ? Number(m.home_score || 0)
              : m.away_team_id === team.id
                ? Number(m.away_score || 0)
                : 0),
          0,
        ),
      }))
      .sort((a: PublicScorer, b: PublicScorer) => (b.goals ?? 0) - (a.goals ?? 0));
  if (!allowed) return <PublicUnavailable title={title} settings={t} />;
  const tabs = Object.keys(visibility).filter((v) => visibility[v]);
  const scheduledMatches = [...d.matches]
    .map((match: any) => {
      const item = d.schedule_items?.find((candidate: any) => candidate.match_id === match.id);
      return item
        ? { ...match, match_date: item.match_date ?? match.match_date, start_time: item.start_time ?? match.start_time, court: item.court ?? match.court, schedule_order: item.sort_order }
        : { ...match, schedule_order: Number.MAX_SAFE_INTEGER };
    })
    .sort((a: any, b: any) => Number(a.schedule_order) - Number(b.schedule_order) || `${a.match_date || "9999-12-31"}T${a.start_time || "23:59"}`.localeCompare(`${b.match_date || "9999-12-31"}T${b.start_time || "23:59"}`));
  return (
    <>
      <PublicHeader settings={t} currentPath={`/tournament/${view}`} loading={!d.ready} />
      <main className="public">
        <div className="pagehero">
          <span>PCF BATTLE</span>
          <h1>{title}</h1>
          <p>{String(t.name || "Tournament information").replace(/^PCH\b/i, "PCF")}</p>
          <LastUpdated value={d.updatedAt} language={language} />
        </div>
        <nav role="tablist" aria-label={copy.tournamentSections}>
            {tabs.map((v) => (
              <Link
                key={v}
                href={`/tournament/${v}`}
                role="tab"
                aria-selected={view === v}
                data-state={view === v ? "active" : "inactive"}
              >
                {v}
              </Link>
            ))}
        </nav>
          {d.error ? <PublicDataError message={d.error} /> : null}
          {!d.error && view === "live" && (
            <div>
              {live ? (
                <LiveMatch match={live} teams={d.teams} referees={d.referees} />
              ) : (
                <Panel title={copy.liveMatches}>
                  <p>{copy.noLive}</p>
                </Panel>
              )}
              <Panel title={copy.comingUp}>
                {[...d.matches]
                  .filter((m: any) => m.status === "scheduled")
                  .sort((a: any, b: any) => `${a.match_date || "9999-12-31"}T${a.start_time || "23:59"}`.localeCompare(`${b.match_date || "9999-12-31"}T${b.start_time || "23:59"}`))
                  .slice(0, 4)
                  .map((m: any) => (
                    <LiveMatch key={m.id} match={m} teams={d.teams} referees={d.referees} />
                  ))}
              </Panel>
            </div>
          )}
          {!d.error && view === "schedule" && <div>
            {scheduledMatches.length === 0 && <p className="empty-state">{copy.scheduleEmpty}</p>}
            {scheduledMatches.map((m: any) => <LiveMatch key={m.id} match={m} teams={d.teams} referees={d.referees} />)}
          </div>}
          {!d.error && view === "standings" && (
            <DynamicStandings rows={d.standings} />
          )}
          {!d.error && view === "brackets" && (
            <Panel title="Tournament bracket">
              <BracketSchedule data={d} />
            </Panel>
          )}
          {!d.error && view === "statistics" && (
            <div className="stats">
              <article className="accent">
                <span>{copy.totalGoals}</span>
                <b>{goals}</b>
                <small>{copy.finishedMatches}</small>
              </article>
              <article>
                <span>{copy.matchesPlayed}</span>
                <b>{finished.length}</b>
                <small>of {d.matches.length}</small>
              </article>
              <article>
                <span>{copy.playersWithGoals}</span>
                <b>{d.scorers.length}</b>
                <small>{copy.recordedGoalscorers}</small>
              </article>
              <article>
                <span>{copy.liveNow}</span>
                <b>
                  {d.matches.filter((m: any) => m.status === "live").length}
                </b>
                <small>matches</small>
              </article>
              <Panel title="Top scorers">
                {d.scorers.length ? (
                  d.scorers.map((player: any, i: number) => (
                    <div className="rank" key={player.player_id}>
                      <b>{i + 1}</b>
                      <span>
                        {player.player_name}
                        <small>
                          {player.team_name}
                          {player.player_number
                            ? ` · #${player.player_number}`
                            : ""}
                        </small>
                      </span>
                      <strong>
                        {player.goals}{" "}
                        {Number(player.goals) === 1 ? (language === "nl" ? "doelpunt" : "goal") : (language === "nl" ? "doelpunten" : "goals")}
                      </strong>
                    </div>
                  ))
                ) : (
                  <p>{copy.noGoals}</p>
                )}
              </Panel>
              <Panel title="Most goals per team">
                {teamGoals.map((team: any, i: number) => (
                  <div className="rank" key={team.id}>
                    <b>{i + 1}</b>
                    <span>
                      {team.name}
                      <small>{copy.groupLabel} {team.group_id || "—"}</small>
                    </span>
                    <strong>{team.goals} goals</strong>
                  </div>
                ))}
              </Panel>
            </div>
          )}
      </main>
      <PublicFooter />
      <Chat />
      <ConnectionStatus updatedAt={d.updatedAt} />
    </>
  );
}

type PracticalRow = { label: string; value?: string; icon: ReactNode };

function PracticalPlace({
  title,
  kicker,
  image,
  imageAlt,
  address,
  location,
  rows,
  reverse = false,
}: {
  title: string;
  kicker: string;
  image?: string;
  imageAlt: string;
  address?: string;
  location: string;
  rows: PracticalRow[];
  reverse?: boolean;
}) {
  const visibleRows = rows.filter((row) => row.value?.trim());
  return (
    <section className={`practical-place${reverse ? " reverse" : ""}`}>
      <div className="practical-place-photo">
        {image ? (
          <Image src={image} alt={imageAlt} fill sizes="(max-width: 800px) 100vw, 50vw" loading="lazy" />
        ) : (
          <div className="practical-photo-empty" aria-label={`${title} photo not uploaded`}>
            <span><Hotel aria-hidden="true" /></span>
            <b>Photo coming soon</b>
          </div>
        )}
        <span className="practical-place-photo-caption">{kicker}</span>
      </div>
      <div className="practical-place-copy">
        <span className="practical-eyebrow">{kicker}</span>
        <h2>{title}</h2>
        <p className="practical-location"><MapPin aria-hidden="true" />{location}</p>
        {visibleRows.length > 0 && (
          <div className="practical-place-details">
            {visibleRows.map((row) => (
              <div className="practical-detail-row" key={row.label}>
                <span className="practical-detail-icon">{row.icon}</span>
                <div><b>{row.label}</b><p>{row.value}</p></div>
              </div>
            ))}
          </div>
        )}
        {address && (
          <a className="practical-map-link" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`} target="_blank" rel="noreferrer">
            <MapPin aria-hidden="true" /> Open in Google Maps <ArrowRight aria-hidden="true" />
          </a>
        )}
      </div>
    </section>
  );
}

function FlowMatch({ title, top, bottom }: { title: string; top: string; bottom: string }) {
  return (
    <article className="flow-match">
      <span className="flow-match-title">{title}</span>
      <div><b>{top}</b><span>VS</span><b>{bottom}</b></div>
    </article>
  );
}

function FlowDestination({ source, title, rank }: { source: string; title: string; rank: string }) {
  return (
    <article className="flow-destination">
      <span>{source}</span>
      <div><b>{title}</b><small>{rank}</small></div>
    </article>
  );
}

function TournamentFlow() {
  return (
    <section className="practical-format" aria-labelledby="practical-format-title">
      <div className="practical-section-heading">
        <span className="practical-eyebrow">THE COMPETITION</span>
        <h2 id="practical-format-title">Tournament format</h2>
        <p>8 teams. 2 groups. 2 days. One champion.</p>
      </div>
      <section className="format-day format-day-one" aria-labelledby="group-stage-title">
        <header className="format-day-heading"><span>DAY 1</span><div><h3 id="group-stage-title">Group stage</h3><p>Every team plays each of the other teams in its group once.</p></div></header>
        <div className="format-groups">
          {["A", "B"].map((group) => (
            <article className="format-group-card" key={group}>
              <div className="format-group-name"><Users aria-hidden="true" /><span>GROUP {group}</span></div>
              <div className="format-group-stats"><b>4 <small>teams</small></b><ArrowRight aria-hidden="true" /><b>3 <small>matches each</small></b></div>
              <span className="format-round-robin">Round-robin</span>
            </article>
          ))}
        </div>
        <div className="format-bridge"><span></span><b>GROUP STANDINGS</b><ArrowDown aria-hidden="true" /><strong>DAY 2</strong><span></span></div>
        <p className="format-explainer">After three group matches per team, the final standings set the Day 2 matchups.</p>
      </section>
      <section className="format-day format-day-two" aria-labelledby="knockout-title">
        <header className="format-day-heading"><span>DAY 2</span><div><h3 id="knockout-title">Knockout &amp; placement stage</h3><p>Two paths make sure every team plays on and earns a final position.</p></div></header>
        <div className="format-paths">
          <section className="format-path format-path-championship">
            <header><span className="format-path-icon"><Trophy aria-hidden="true" /></span><div><span>PLACES 1–4</span><h4>Championship path</h4></div></header>
            <div className="format-match-grid">
              <FlowMatch title="Semi-final 1" top="1st Group A" bottom="2nd Group B" />
              <FlowMatch title="Semi-final 2" top="1st Group B" bottom="2nd Group A" />
            </div>
            <div className="format-branch-label"><span></span><b>SEMI-FINAL RESULTS</b><ArrowDown aria-hidden="true" /><span></span></div>
            <div className="format-destinations">
              <FlowDestination source="WINNERS" title="Final" rank="1st / 2nd place" />
              <FlowDestination source="LOSERS" title="Bronze match" rank="3rd / 4th place" />
            </div>
          </section>
          <section className="format-path format-path-placement">
            <header><span className="format-path-icon"><Swords aria-hidden="true" /></span><div><span>PLACES 5–8</span><h4>Placement path</h4></div></header>
            <div className="format-match-grid">
              <FlowMatch title="Play-off 1" top="3rd Group A" bottom="4th Group B" />
              <FlowMatch title="Play-off 2" top="3rd Group B" bottom="4th Group A" />
            </div>
            <div className="format-branch-label"><span></span><b>PLAY-OFF RESULTS</b><ArrowDown aria-hidden="true" /><span></span></div>
            <div className="format-destinations">
              <FlowDestination source="WINNERS" title="5th-place match" rank="5th / 6th place" />
              <FlowDestination source="LOSERS" title="7th-place match" rank="7th / 8th place" />
            </div>
          </section>
        </div>
        <div className="format-every-team"><span><Users aria-hidden="true" /></span><p><b>Every team plays on both days</b><small>All eight teams continue into Day 2 and finish with a tournament ranking from 1st to 8th place.</small></p><Trophy aria-hidden="true" className="format-every-trophy" /></div>
      </section>
    </section>
  );
}

function About() {
  const { language } = usePublicLanguage(), copy = publicCopy[language],
    d = usePublicData(),
    t = d.tournaments.find((x: any) => x.active) || d.tournaments[0] || {},
    venueName = localized(t.venue_name, language) || "Sportoase Philipssite Arena",
    venueAddress = localized(t.venue_address, language) || "",
    hotelName = localized(t.hotel_name, language) || "Park Inn by Radisson Leuven",
    hotelAddress = localized(t.hotel_address, language) || "",
    practicalInfo = [
      { label: "Opening hours", value: localized(t.opening_hours, language), icon: <Clock3 aria-hidden="true" /> },
      { label: "Catering", value: localized(t.catering_info, language), icon: <Utensils aria-hidden="true" /> },
      { label: "Visitor information", value: localized(t.visitor_info, language), icon: <Info aria-hidden="true" /> },
      { label: "Award ceremony", value: localized(t.award_info, language), icon: <Trophy aria-hidden="true" /> },
      { label: "Additional match information", value: localized(t.format_rules, language), icon: <Swords aria-hidden="true" /> },
    ].filter((item) => item.value?.trim());
  return (
    <>
      <PublicHeader settings={t} currentPath="/about" loading={!d.ready} />
      <main className="public about-page practical-event-guide">
        <div className="pagehero practical-hero">
          <span>PCF BATTLE · {String(t.start_date || "").slice(0, 4) || "TOURNAMENT GUIDE"}</span>
          <h1>{copy.practicalTitle}</h1>
          <p>Your guide to the venue, accommodation and tournament weekend in Leuven.</p>
          <TournamentHeroDetails tournament={t} />
        </div>
        <section className="practical-about">
          <div className="practical-section-heading compact"><span className="practical-eyebrow">ABOUT</span><h2>{copy.pcfTitle}</h2></div>
          <p className="about-lead">{localized(t.pcf_battle_info, language) || copy.pcfText}</p>
        </section>
        <section className="practical-glance" aria-labelledby="practical-glance-title">
          <div className="practical-section-heading compact"><span className="practical-eyebrow">THE WEEKEND</span><h2 id="practical-glance-title">Tournament at a glance</h2></div>
          <div className="practical-stats-grid">
            {[
              { number: "8", label: "Teams", icon: <Users aria-hidden="true" /> },
              { number: "2", label: "Groups", icon: <Users aria-hidden="true" /> },
              { number: "2", label: "Days", icon: <CalendarDays aria-hidden="true" /> },
              { number: "20", label: "Matches", icon: <Swords aria-hidden="true" /> },
              { number: "1", label: "Court", icon: <MapPin aria-hidden="true" /> },
              { number: "5v5", label: "Format", icon: <Zap aria-hidden="true" /> },
            ].map((item) => <article className="practical-stat" key={item.label}><span>{item.icon}</span><b>{item.number}</b><small>{item.label}</small></article>)}
          </div>
        </section>
        <section className="practical-places" aria-label="Venue and hotel">
          <PracticalPlace
            title={venueName}
            kicker="THE VENUE"
            image={t.venue_image}
            imageAlt={`${venueName}, tournament venue in Leuven`}
            address={venueAddress}
            location={[t.city || "Leuven", t.country || "Belgium"].filter(Boolean).join(", ")}
            rows={[
              { label: "Address", value: venueAddress, icon: <MapPin aria-hidden="true" /> },
              { label: "Parking", value: localized(t.parking_info, language), icon: <ParkingCircle aria-hidden="true" /> },
              { label: "Accessibility", value: localized(t.accessibility_info, language), icon: <Accessibility aria-hidden="true" /> },
            ]}
          />
          <PracticalPlace
            title={hotelName}
            kicker="TEAM ACCOMMODATION"
            image={t.hotel_image}
            imageAlt={`${hotelName}, accommodation for tournament teams`}
            address={hotelAddress}
            location={[t.city || "Leuven", t.country || "Belgium"].filter(Boolean).join(", ")}
            reverse
            rows={[
              { label: "Address", value: hotelAddress, icon: <MapPin aria-hidden="true" /> },
              { label: "Team stay", value: "Three-night stay included", icon: <Hotel aria-hidden="true" /> },
              { label: "Check-in", value: localized(t.hotel_checkin, language), icon: <Clock3 aria-hidden="true" /> },
              { label: "Check-out", value: localized(t.hotel_checkout, language), icon: <Clock3 aria-hidden="true" /> },
              { label: "Accessibility", value: localized(t.hotel_accessibility_info, language), icon: <Accessibility aria-hidden="true" /> },
              { label: "Team information", value: localized(t.hotel_info, language), icon: <Info aria-hidden="true" /> },
            ]}
          />
        </section>
        <TournamentFlow />
        {practicalInfo.length > 0 && <section className="practical-additional">
          <div className="practical-section-heading"><span className="practical-eyebrow">GOOD TO KNOW</span><h2>More practical information</h2></div>
          <div className="practical-additional-grid">{practicalInfo.map((item) => <article key={item.label}><span>{item.icon}</span><div><h3>{item.label}</h3><p>{item.value}</p></div></article>)}</div>
        </section>}
        {t.show_teams !== 0 && (
          <section className="block"><div className="title"><h2>Participating teams</h2></div><div className="people-grid">
            {d.teams.map((team: any) => <Link href={`/teams/${teamSlug(team.name, team.id)}`} className="team-overview-card" key={team.id}>{team.logo ? <img src={team.logo} alt={`${team.name} logo`} /> : <LiveMark team={team} />}<b>{team.name}</b><small>{copy.groupLabel} {team.group_id}</small></Link>)}
          </div></section>
        )}
        {t.show_referees !== 0 && <section className="block"><div className="title"><h2>Tournament referees</h2></div><div className="people-grid">
          {d.referees.map((ref: any) => <article key={ref.id}>{ref.photo ? <img src={ref.photo} alt={`${ref.name}, tournament referee`} /> : <span className="person-placeholder">{ref.name?.slice(0, 1)}</span>}<b>{ref.name}</b><small>{ref.country || "Tournament referee"}</small></article>)}
        </div></section>}
        <section className="block contact-section"><div className="title"><h2>Contact</h2></div><p>Have a question about PCF BATTLE? Contact the organisation.</p><p><a href="mailto:hello@pcfbattle.be">hello@pcfbattle.be</a> · <a href="https://www.instagram.com/pcfbattle/" target="_blank" rel="noreferrer">Instagram</a></p></section>
      </main>
      <PublicFooter />
      <DeferredPublicChat />
      <ConnectionStatus updatedAt={d.updatedAt} />
    </>
  );
}

function FAQ() {
  type FaqGroup = [string, string[][]];
  const { language } = usePublicLanguage(), copy = publicCopy[language],
    [openQuestion, setOpenQuestion] = useState<string | null>(null),
    d = usePublicData(),
    t = d.tournaments.find((x: any) => x.active) || d.tournaments[0] || {},
    groups: FaqGroup[] = [
      [language === "nl" ? "Over PCF BATTLE" : "About PCF BATTLE", [
        ["What is PCF BATTLE?", "PCF BATTLE is an international powerchair floorball tournament bringing teams together for competitive matches in an energetic tournament environment."],
        ["What is powerchair floorball?", "Powerchair floorball is a fast-paced, inclusive team sport played by athletes using electric wheelchairs. Players compete with floorball sticks attached to their wheelchairs or held in their hands, combining tactical teamwork, precision, and speed."],
      ]],
      [language === "nl" ? "Toernooi & bezoekers" : "Tournament & Spectators", [
        ["When and where does PCF BATTLE take place?", `The tournament takes place from ${t.start_date || "the published tournament dates"}${t.end_date ? ` to ${t.end_date}` : ""} at ${[t.venue_name, t.venue_address].filter(Boolean).join(", ") || "the published tournament venue"}. More practical information is available on the Practical Information page.`],
        ["Which teams are participating?", `All confirmed teams are listed in the Participating Teams section of the website. ${d.teams.length ? `${d.teams.length} teams are currently published.` : "The team list will be updated as teams are confirmed."}`],
        ["Where can I find the match schedule?", "The complete tournament schedule is available in the Tournament section. Match times and other information can be updated during the tournament."],
        ["Where can I see the results and standings?", "Results, group standings, and tournament brackets are updated on the website throughout PCF BATTLE."],
        ["Is PCF BATTLE open to spectators?", "Yes. Spectators are welcome to come and experience powerchair floorball live. Please check the Practical Information page for venue and visitor details."],
        ["Is the venue wheelchair accessible?", t.accessibility_info || "Accessibility information is available on the Practical Information page. Please contact the organization in advance if you have specific accessibility requirements."],
        ["Will the matches be livestreamed?", t.show_livestream === 1 ? "Yes. When livestreaming is available, the link is published on the Livestream page and shared through the PCF BATTLE social media channels." : "Livestream information will be published on the website when it is available."],
      ]],
      [language === "nl" ? "Teams & registratie" : "Teams & Registration", [
        ["Where can teams find their tournament information?", "Participating teams receive access to their personal Team Portal, where they can submit and manage the information required by the tournament organization."],
        ["How can my team participate in PCF BATTLE?", "When registrations are open, teams can submit their registration through the PCF BATTLE website. Registration does not automatically guarantee selection for the tournament."],
        ["How will we know if our team has been selected?", "Selected teams receive an official confirmation by email. They will later receive a separate invitation to access their Team Portal."],
        ["Can I follow PCF BATTLE on social media?", "Yes. Follow PCF BATTLE on Instagram for tournament announcements, participating teams, behind-the-scenes content, results, and other updates."],
        ["Who can I contact if I have a question?", "You can contact the PCF BATTLE organization at hello@pcfbattle.be or through the contact details provided on the website."],
      ]],
    ];
  const faqNl: Record<string, [string, string]> = {
    "What is PCF BATTLE?": ["Wat is PCF BATTLE?", "PCF BATTLE is een internationaal powerchair floorballtoernooi dat teams samenbrengt voor competitieve wedstrijden in een dynamische toernooisfeer."],
    "What is powerchair floorball?": ["Wat is powerchair floorball?", "Powerchair floorball is een snelle, inclusieve teamsport voor sporters die een elektrische rolstoel gebruiken. Spelers nemen deel met floorballsticks die aan hun rolstoel zijn bevestigd of die ze in hun handen houden. De sport combineert tactisch samenspel, precisie en snelheid."],
    "When and where does PCF BATTLE take place?": ["Wanneer en waar vindt PCF BATTLE plaats?", `Het toernooi vindt plaats van ${String(t.start_date || "de gepubliceerde toernooidata")}${t.end_date ? ` tot ${String(t.end_date)}` : ""} in ${[t.venue_name, t.venue_address].filter(Boolean).map(String).join(", ") || "de gepubliceerde toernooilocatie"}. Meer praktische informatie vind je op de pagina Praktische informatie.`],
    "Which teams are participating?": ["Welke teams nemen deel?", `Alle bevestigde teams staan vermeld bij Deelnemende teams op de website. ${d.teams.length ? `Momenteel zijn er ${d.teams.length} teams gepubliceerd.` : "De lijst wordt bijgewerkt zodra teams bevestigd zijn."}`],
    "Where can I find the match schedule?": ["Waar vind ik het wedstrijdschema?", "Het volledige wedstrijdschema staat in het onderdeel Toernooi. Wedstrijdtijden en andere informatie kunnen tijdens het toernooi worden aangepast."],
    "Where can I see the results and standings?": ["Waar kan ik de resultaten en stand bekijken?", "Resultaten, groepsstanden en het toernooischema worden tijdens PCF BATTLE op de website bijgewerkt."],
    "Is PCF BATTLE open to spectators?": ["Is PCF BATTLE toegankelijk voor toeschouwers?", "Ja. Toeschouwers zijn welkom om powerchair floorball live te beleven. Bekijk de pagina Praktische informatie voor informatie over de locatie en bezoekers."],
    "Is the venue wheelchair accessible?": ["Is de locatie toegankelijk voor rolstoelgebruikers?", t.accessibility_info || "Informatie over toegankelijkheid vind je op de pagina Praktische informatie. Neem vooraf contact op met de organisatie als je specifieke toegankelijkheidsbehoeften hebt."],
    "Will the matches be livestreamed?": ["Worden de wedstrijden gestreamd?", t.show_livestream === 1 ? "Ja. Wanneer livestreaming beschikbaar is, wordt de link op de Livestreampagina gepubliceerd en gedeeld via de sociale mediakanalen van PCF BATTLE." : "Informatie over de livestream wordt op de website gepubliceerd zodra die beschikbaar is."],
    "Where can teams find their tournament information?": ["Waar vinden teams hun toernooi-informatie?", "Deelnemende teams krijgen toegang tot hun persoonlijke Team Portal. Daar kunnen ze de informatie die de toernooiorganisatie nodig heeft indienen en beheren."],
    "How can my team participate in PCF BATTLE?": ["Hoe kan mijn team deelnemen aan PCF BATTLE?", "Wanneer de inschrijvingen geopend zijn, kunnen teams zich via de PCF BATTLE-website registreren. Een registratie garandeert niet automatisch dat een team geselecteerd wordt."],
    "How will we know if our team has been selected?": ["Hoe weten we of ons team geselecteerd is?", "Geselecteerde teams ontvangen een officiële bevestiging per e-mail. Later ontvangen ze een aparte uitnodiging voor hun Team Portal."],
    "Can I follow PCF BATTLE on social media?": ["Kan ik PCF BATTLE volgen op sociale media?", "Ja. Volg PCF BATTLE op Instagram voor aankondigingen, deelnemende teams, beelden achter de schermen, resultaten en andere updates."],
    "Who can I contact if I have a question?": ["Met wie kan ik contact opnemen als ik een vraag heb?", "Je kunt contact opnemen met de organisatie van PCF BATTLE via hello@pcfbattle.be of via de contactgegevens op de website."],
  };
  return <>
    <PublicHeader settings={t} currentPath="/faq" loading={!d.ready} />
    <main className="public faq-page">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify({
        "@context": "https://schema.org", "@type": "FAQPage",
        mainEntity: groups.flatMap(([, questions]) => (questions as string[][]).map(([question, answer]) => ({ "@type": "Question", name: language === "nl" ? (faqNl[question]?.[0] || question) : question, acceptedAnswer: { "@type": "Answer", text: language === "nl" ? (faqNl[question]?.[1] || answer) : answer } })))
      }) }} />
      <div className="pagehero"><span>PCF BATTLE</span><h1>{copy.faqTitle}</h1><p>{copy.faqIntro}</p></div>
      {groups.map(([title, questions]) => <section className="block about-faq" key={String(title)}>
        <div className="title"><h2>{title}</h2></div>
        {(questions as string[][]).map(([question, answer]) => { const translated = language === "nl" ? faqNl[question] : null; const isOpen = openQuestion === question; return <details className={`faq-item${isOpen ? " is-open" : ""}`} key={question} open={isOpen}><summary onClick={(event) => { event.preventDefault(); setOpenQuestion(isOpen ? null : question); }}>{translated?.[0] || question}</summary><p>{translated?.[1] || answer}</p></details>; })}
      </section>)}
    </main>
    <PublicFooter />
    <DeferredPublicChat />
  </>;
}

function TeamOverview({ id }: { id: string }) {
  const { language } = usePublicLanguage(), copy = publicCopy[language],
    d = usePublicData(), t = d.tournaments.find((x: any) => x.active) || d.tournaments[0] || {},
    team = d.teams.find((x: any) => x.id === id || teamSlug(x.name, x.id) === id), teamMembers = d.players.filter((x: any) => x.team_id === team?.id),
    matches = [...d.matches].filter((match: any) => match.home_team_id === team?.id || match.away_team_id === team?.id).sort((a: any,b: any) => `${a.match_date || "9999-12-31"}T${a.start_time || "23:59"}`.localeCompare(`${b.match_date || "9999-12-31"}T${b.start_time || "23:59"}`));
  const players = teamMembers.filter((member: any) => member.role === "PLAYER");
  const coaches = teamMembers.filter((member: any) => member.role === "COACH" || member.staff_role === "COACH" || member.staff_role === "ASSISTANT_COACH");
  return <><PublicHeader settings={t} currentPath="/about" loading={!d.ready}/><main className="public team-detail-page">
    {!d.ready ? <div className="route-loading"/> : !team ? <Panel title={copy.teamNotFound}><p>{copy.teamNotFound}</p></Panel> : <>
      <div className="team-detail-hero">{team.team_photo || team.logo ? <img src={team.team_photo || team.logo} alt={team.name}/> : <LiveMark team={team}/>}<div>{team.logo && <img className="team-detail-logo" src={team.logo} alt=""/>}<span>PARTICIPATING TEAM · GROUP {team.group_id || "—"}</span><h1>{team.name}</h1><p>{team.description || "Competing at PCF Battle."}</p>{team.website && <a href={team.website} target="_blank" rel="noreferrer">Visit team website <ChevronRight/></a>}</div></div>
      <section className="block"><div className="title"><h2>{copy.teamSelection}</h2></div><div className="player-list">{players.map((player: any) => <article key={player.id}>{player.photo ? <img src={player.photo} alt={player.name || "Player"}/> : <span aria-hidden="true">{player.name?.[0]}</span>}<b>{player.name}</b><strong>#{player.number ?? "—"}</strong></article>)}{!players.length && <p>{copy.noPlayers}</p>}</div></section>
      {coaches.length > 0 && <section className="block"><div className="title"><h2>Coaches</h2></div><div className="player-list">{coaches.map((coach: any) => <article key={coach.id}>{coach.photo ? <img src={coach.photo} alt={coach.name || "Coach"}/> : <span aria-hidden="true">{coach.name?.[0]}</span>}<b>{coach.name}</b><strong>{coach.staff_role === "ASSISTANT_COACH" ? "Assistant coach" : "Coach"}</strong></article>)}</div></section>}
      <section className="block"><div className="title"><h2>{copy.matches}</h2><span>{matches.length} {copy.scheduled}</span></div><div className="team-match-list">{matches.map((match: any) => <LiveMatch key={match.id} match={match} teams={d.teams} referees={d.referees}/>)}{!matches.length && <p>{copy.noTeamMatches}</p>}</div></section>
    </>}
  </main><PublicFooter /><DeferredPublicChat /></>;
}

function Livestream() {
  const { language } = usePublicLanguage(), copy = publicCopy[language], d = usePublicData(), t = d.tournaments.find((x: any) => x.active) || d.tournaments[0] || {};
  const raw = String(t.livestream_url || ""), match = raw.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|live\/))([^?&/]+)/), embed = match ? `https://www.youtube-nocookie.com/embed/${match[1]}` : "";
  if (d.ready && t.show_livestream !== 1) return <PublicUnavailable title="Livestream" settings={t}/>;
  return <><PublicHeader settings={t} currentPath="/livestream" loading={!d.ready}/><main className="public livestream-page"><div className="pagehero"><span>PCF BATTLE</span><h1>{copy.livestream}</h1><p>{copy.livestreamIntro}</p></div>{embed ? <div className="video-frame"><iframe src={embed} title="PCF Battle livestream" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowFullScreen/></div> : <Panel title={copy.livestream}><p>{copy.livestreamNotStarted}</p></Panel>}</main><PublicFooter /><DeferredPublicChat /></>;
}

function LegalPage({ page }: { page: "terms" | "privacy" | "cookies" | "accessibility" }) {
  const d = usePublicData();
  const tournament = d.tournaments.find((x: any) => x.active) || d.tournaments[0] || {};
  const termsSections: [string, string][] = [
    ["1. Registration and selection", "Submitting a registration does not guarantee participation. All registrations are applications. Team Belgium Powerchair Hockey VZW will review applications and select the teams invited to participate. A selected team's place is not definitively reserved until the required 30% deposit is received. If the deposit is not paid by the deadline, the organiser may withdraw the invitation and offer the place to another team. Unselected teams have no payment obligation."],
    ["2. Participation costs", "The applicable participation costs, what is included and any excluded services will be communicated to the team in the official registration or payment information before payment is requested. The applicable amount applies to each confirmed delegation member, including players, coaches, staff and assistants. Unless expressly stated otherwise, travel, transport, drinks, additional nights, regular evening meals and other personal expenses remain the responsibility of the team or participant."],
    ["3. Deposit and definitive confirmation", "After selection, the team must pay a deposit equal to 30% of its total participation price. The deposit is due within 30 calendar days of the invoice or payment request unless another deadline is stated. It forms part of the total price and is deducted from the final balance; it is not an additional charge. The place becomes definitively reserved only after the deposit is received."],
    ["4. Remaining balance", "The remaining 70% must normally be received no later than 90 days before the first official tournament day. If a team is selected later, the organiser may set another deadline. If payment remains outstanding after a reminder and reasonable final payment period, participation may be cancelled. Cancellation for non-payment does not automatically entitle the team to a refund."],
    ["5. Delegation changes", "Teams must provide accurate delegation numbers. Additional members are charged at the applicable rate communicated for the registration and are subject to tournament and hotel capacity. A reduction is treated as a partial cancellation under these conditions. The final delegation size must be confirmed by the organiser's deadline."],
    ["6. Cancellation by a team", "Cancellations must be made in writing. More than 120 days before the tournament, amounts paid above the deposit will normally be refunded; the deposit may be retained for commitments and administration. Between 120 and 61 days, the deposit is non-refundable and amounts above it will normally be refunded, less specific non-refundable costs. Between 60 and 31 days, the team remains liable for 50% of the total price. At 30 days or less, the full price is non-refundable and remains payable. These rules may apply proportionally to individual cancellations. Exceptional circumstances may be considered case by case."],
    ["7. Withdrawal before the deposit", "A selected team that has not paid its deposit may withdraw without a cancellation fee if it does so before the deposit deadline. Once the deposit is paid, the cancellation rules above apply."],
    ["8. Participant replacements", "A team may request a replacement participant. Replacements require organiser approval and may not be possible after hotel, catering, accreditation or other final lists have been submitted."],
    ["9. Non-payment", "Failure to pay the deposit or balance on time may result in cancellation. Before cancelling for an unpaid balance, the organiser will normally issue a reminder and allow a reasonable final payment period. Amounts already paid are handled under the cancellation rules applicable at the time of cancellation."],
    ["10. Changes or cancellation by the organiser", "The organiser may reasonably change the programme, schedule, venue or accommodation. If the tournament is cancelled and cannot reasonably be rescheduled, the organiser will seek to refund participation fees, including deposits. Where cancellation is caused by circumstances outside the organiser's reasonable control, refunds may be limited to amounts recoverable after non-refundable costs, to the extent permitted by law. External travel costs are not the organiser's responsibility."],
    ["11. Force majeure", "The organiser is not responsible for failure to organise, continue or complete the tournament because of circumstances beyond reasonable control, including severe weather, natural disasters, fire, epidemic or pandemic restrictions, war, terrorism, civil unrest, government measures, transport disruption, power failure or venue or hotel unavailability. Reasonable efforts will be made to minimise the consequences."],
    ["12. Travel and insurance", "Teams arrange their own transportation unless agreed otherwise. Each participant is responsible for suitable travel, medical, liability, equipment and cancellation insurance where applicable."],
    ["13. Health, safety and personal assistance", "Each team remains responsible for the health, personal care and assistance needs of its delegation. Accessibility requirements requiring organisational arrangements must be communicated sufficiently in advance."],
    ["14. Wheelchairs and equipment", "Teams and participants are responsible for their sports and everyday wheelchairs, chargers, batteries, sticks and other equipment. The organiser is not responsible for loss, theft or damage except where liability cannot legally be excluded."],
    ["15. Tournament rules and conduct", "Teams must comply with tournament regulations, sporting rules, referee and official instructions, venue safety requirements and reasonable organiser instructions. Serious misconduct may result in disciplinary measures or removal without an automatic right to a refund."],
    ["16. Damage", "Participants and teams may be responsible for deliberate or negligent damage, subject to applicable law. Documented costs charged to the organiser may be passed on to the responsible team where legally permitted."],
    ["17. Photography, video and livestreaming", "The tournament may be photographed, filmed and livestreamed for reporting, communication and promotional purposes. Where consent or another legal basis is required, the organiser will process media accordingly. Acceptance of these conditions does not replace consent where consent is legally required."],
    ["18. Personal data", "Personal data provided during registration may be processed for team communication, accreditation, accommodation, catering, competition administration, safety and invoicing. Data is handled in accordance with applicable data-protection law, including the GDPR. See the Privacy Policy for further information."],
    ["19. Dietary and accessibility requirements", "Teams must provide dietary requirements, allergies and accessibility requirements within the communicated deadlines. The organiser will make reasonable efforts to accommodate timely requests but cannot guarantee every request can be fulfilled."],
    ["20. Accommodation", "Included hotel accommodation is arranged by the organiser based on team information and availability, including accessible-room availability. Specific room types cannot be guaranteed unless explicitly confirmed. Additional nights, upgrades and extra services may incur additional charges."],
    ["21. Programme and schedule", "Schedules, ceremonies and other programme elements may change for sporting or organisational reasons. Significant changes will be communicated as soon as reasonably possible."],
    ["22. Team representative", "The person submitting a registration confirms they are authorised to register the team or provide the information. The representative must communicate conditions, deadlines and payment requirements to the delegation."],
    ["23. Minors", "For minors, the team must obtain all necessary parent or guardian permissions and remains responsible for appropriate supervision."],
    ["24. Liability", "The organiser will take reasonable measures to provide a safe, properly managed tournament. To the extent permitted by law, the organiser is not responsible for indirect losses or losses outside reasonable control. Nothing excludes or limits liability where prohibited by law."],
    ["25. Deadlines", "Teams must respect deadlines for payments, player information, rooming lists, dietary requirements, accreditation and other administration. Missing a deadline may make services unavailable or, in serious cases, result in cancellation."],
    ["26. Amendments", "The organiser may reasonably amend these conditions because of organisational changes, legal requirements or circumstances outside its control. Material changes affecting confirmed teams will be communicated appropriately."],
    ["27. Applicable law and disputes", "These Terms & Conditions are governed by Belgian law. The parties should first seek an amicable solution. If none can be reached, disputes will be handled by the competent Belgian courts."],
    ["28. Acceptance", "By submitting a registration, the team representative confirms that the information is accurate, registration does not guarantee participation, selection is not yet a definitive reservation, the place is reserved only after the 30% deposit is received, the remaining 70% is normally due 90 days before the tournament, and the team accepts these payment, cancellation, tournament and organisational conditions."],
    ["Organiser and payment summary", "Organiser: Team Belgium Powerchair Hockey VZW. Tournament: Powerchair Hockey Battle. The applicable participation costs and payment schedule are communicated separately in the official registration or payment information. The deposit is 30% of the total participation price and the remaining balance is 70%, unless a different arrangement is confirmed in writing."],
  ];
  const privacySections: [string, string][] = [
    ["1. Data controller", "Powerchair Hockey Battle is organised by Team Belgium Powerchair Hockey VZW, Belgium. The organisation acts as controller for personal data processed for the organisation and administration of the tournament, unless stated otherwise. Privacy contact: hello@pcfbattle.be. Registered address: Oude Diestsestraat 45, 3380 Glabbeek, Belgium. Enterprise number: BE0804.423.077."],
    ["2. Scope", "This policy applies to the Powerchair Hockey Battle website, tournament registration, team applications and selection, team accounts and portals, player and staff registration, accommodation, catering, accreditation, tournament administration, competition management, payments and invoicing, communications, photography, video, livestreaming and technical operation of the platform."],
    ["3. Personal data we may collect", "Depending on how you interact with the tournament, we may process team and club details, country, contact details, team logos, delegation size, names, roles, player or staff status, jersey numbers, sporting or competition information, date of birth where required, accreditation details, room allocations, arrival and departure information, dietary and allergy requirements, accessibility or assistance requirements, account and login information, payment and invoice details, messages, photographs, video, livestream footage, IP address, device and browser information, timestamps, login attempts, security events, error logs and account activity. We only request information reasonably necessary for the relevant purpose."],
    ["4. Why we process personal data", "We process data to receive and evaluate registrations, select teams, communicate with teams, administer accounts and delegations, organise accommodation and catering, arrange accessibility, issue accreditation, prepare schedules and results, administer payments, send essential communications, operate and secure the platform, prevent fraud and unauthorised access, comply with legal obligations and document or promote the tournament through appropriate media."],
    ["5. Legal bases", "Depending on the circumstances, processing may be based on performance of a contract, legitimate interests such as tournament administration and platform security, legal obligations, or consent for specific activities. Consent may generally be withdrawn at any time; withdrawal does not affect processing that was lawful before withdrawal."],
    ["6. Special categories of data", "Health, disability, accessibility and some dietary information may constitute special-category data under the GDPR. We process it only when an appropriate legal basis and GDPR condition are available, restrict access to people who need it, and do not use it for unrelated marketing or profiling."],
    ["7. Minors", "Participants may be under 18. Teams must ensure they have the authority and permissions required to submit information about delegation members. Where parental or guardian consent is legally required for a specific activity, it must be obtained."],
    ["8. How we receive data", "We may receive information directly from you, from a team representative or club, through the registration system or team portal, through forms, email, tournament officials, authorised administrators or automatically through use of the platform. Representatives submitting information about others should ensure those people are appropriately informed."],
    ["9. Who can access data", "Access is limited according to role and necessity. Depending on their role, authorised tournament administrators, organisers, officials, team representatives, accommodation or catering coordinators, technical administrators and other authorised personnel may access relevant information. Users should receive only the access required for their role."],
    ["10. Service providers and sharing", "Limited data may be shared where necessary with hotels, caterers, hosting and cloud providers, databases, email and payment providers, IT and security providers, tournament technology or livestream providers, professional advisers and public authorities where legally required. Only information reasonably necessary for the service should be shared. Appropriate processor agreements should be used where required."],
    ["11. International transfers", "Some providers may process data outside the European Economic Area. Where required, we will use an appropriate GDPR transfer mechanism, such as an adequacy decision, Standard Contractual Clauses or another legally recognised safeguard."],
    ["12. Retention", "We do not intend to retain personal data indefinitely. Unsuccessful applications should be removed when no longer reasonably required; operational tournament data should be retained only for administration and reasonable follow-up; security logs should be proportionate; accommodation, dietary and accessibility information should be removed when no longer needed; financial records may be retained as required by law; and published photographs, results and legitimate historical records may be kept longer where there is an appropriate legal basis. Data may be anonymised where possible."],
    ["13. Security", "We take reasonable technical and organisational measures to protect data against unauthorised access, loss, alteration, disclosure, misuse and destruction. Measures may include encrypted connections, secure authentication, password hashing, role-based access controls, server-side authorisation, security logging, rate limiting, backups, updates and restricted administrative access. No internet-connected system can guarantee absolute security."],
    ["14. Data breaches", "If a personal data breach occurs, Team Belgium Powerchair Hockey VZW will assess its nature and consequences. Where required, the competent supervisory authority and affected individuals will be notified in accordance with the GDPR."],
    ["15. Cookies and similar technologies", "Necessary cookies or storage may be used for authentication, secure sessions, essential settings, abuse prevention and core platform functionality. Non-essential analytics, advertising or tracking technologies should only be used in accordance with applicable consent requirements. Further information is provided in the Cookie Policy."],
    ["16. Marketing communications", "Contact details supplied for registration are primarily used for tournament-related communications. Registration is not automatically consent to unrelated marketing. Where consent is legally required, promotional messages will only be sent with the appropriate consent or legal basis, and recipients can withdraw consent or unsubscribe. Essential registration communications may still be sent."],
    ["17. Automated decision-making", "We do not intend to make decisions producing legal or similarly significant effects solely through automated processing. Team selection may use information submitted through the platform, but selection is part of the organiser's process and is not made solely by an automated algorithm."],
    ["18. Your GDPR rights", "Depending on the circumstances, you may request access, correction, deletion, restriction, portability or object to certain processing. You may withdraw consent where processing is based on consent and lodge a complaint with a competent supervisory authority. Rights are subject to applicable conditions and exceptions. Contact hello@pcfbattle.be; identity verification may be required."],
    ["19. Belgian Data Protection Authority", "As the organiser is established in Belgium, individuals may contact the Belgian Data Protection Authority (Gegevensbeschermingsautoriteit / Autorité de protection des données), without prejudice to any right to contact another competent authority under the GDPR."],
    ["20. Third-party websites", "The website may link to independent third-party websites or services. Team Belgium Powerchair Hockey VZW is not responsible for their privacy practices. Review their own privacy information."],
    ["21. Accuracy", "Teams and participants are responsible for providing accurate information and updating it when circumstances change. Representatives submitting information about others must be authorised to do so and should ensure it is accurate."],
    ["22. Changes", "This Privacy Policy may be updated when the platform, processing activities or legal requirements change. The current version will be published on the Powerchair Hockey Battle website. Material changes will be communicated where appropriate."],
    ["23. Contact", "Team Belgium Powerchair Hockey VZW · Powerchair Hockey Battle. Address: Oude Diestsestraat 45, 3380 Glabbeek, Belgium. Email: hello@pcfbattle.be. Enterprise number: BE0804.423.077."],
    ["24. Privacy acknowledgement", "Users should be given access to this Privacy Policy when submitting information. Where consent is required for a specific activity, it will be requested separately and will not be inferred from general acknowledgement of this policy."],
  ];
  const cookieSections: [string, string][] = [
    ["1. What are cookies?", "Cookies are small text files or similar information stored on or accessed from your device when you visit a website. They can maintain secure sessions, remember settings, protect against abuse and, where applicable, help understand website use. Some expire when the browser closes; others remain for a defined period."],
    ["2. Who operates this website?", "The Powerchair Hockey Battle website and tournament platform are operated by Team Belgium Powerchair Hockey VZW, Belgium. Address: Oude Diestsestraat 45, 3380 Glabbeek, Belgium. Enterprise number: BE0804.423.077. Privacy contact: hello@pcfbattle.be."],
    ["3. Strictly necessary cookies", "Necessary cookies or similar technologies may authenticate users, keep sessions secure, protect forms, prevent unauthorised access and abuse, maintain essential functionality and store essential privacy preferences. They cannot normally be disabled through cookie settings because the platform may not function securely without them. Where permitted by law, they do not require consent."],
    ["4. Preference cookies", "Preference technologies may remember language, display and interface settings. Where they are not strictly necessary, they will only be used where permitted by law and, where required, after consent."],
    ["5. Analytics cookies", "Analytics may be introduced to understand visited pages, navigation, approximate visit duration, performance and technical errors. Where analytics requires consent, it will not be activated until consent is provided. If no non-essential analytics is active, no unnecessary analytics consent should be requested."],
    ["6. Marketing cookies", "The platform does not intend to use advertising or behavioural marketing cookies unless explicitly introduced in the future. If introduced, they will only be activated with an appropriate legal basis and consent where required."],
    ["7. Authentication and security", "The platform may use cookies or similar technologies for authorised administrators, team representatives and other users. They help determine whether a user is logged in and which areas they may access. Security technologies may detect failed login attempts, suspicious requests, automated abuse, unauthorised access and malicious activity."],
    ["8. Local and session storage", "The platform may use local storage or session storage for interface preferences, authentication and application functionality. Non-essential storage is subject to the same consent principles as comparable cookies."],
    ["9. Third-party services", "The platform may depend on hosting, authentication, database, email, security, payment, livestream, embedded media and analytics providers. Some may place or access cookies or similar technologies. Non-essential third-party technologies requiring consent must not be activated before consent. Final provider names and cookie details should be added once the production configuration is confirmed."],
    ["10. Cookie consent", "Where required, visitors are offered a clear choice before optional cookies are used: Accept all or Reject non-essential. Rejecting optional cookies is as straightforward as accepting them. Necessary technologies remain active for essential functionality and security."],
    ["11. No pre-selected optional consent", "Optional categories must not be enabled by default where prior consent is legally required. Closing or ignoring a banner is not consent. Consent must result from appropriate affirmative action."],
    ["12. Consent choice", "The visitor's choice is stored locally on the device so the consent notice is not shown repeatedly. Choosing Reject non-essential prevents the optional analytics scripts from being loaded. Choosing Accept all allows the optional analytics scripts described in this policy to load."],
    ["13. Cookie duration and current cookie list", "Session cookies generally expire when the browser session ends. Persistent cookies remain for a defined period or until deleted and should not last longer than reasonably necessary. The production cookie table must be updated after a technical audit and should list each actual name, provider, purpose, category and duration. At present, the expected categories are authentication/session, security, cookie preference and any additional technologies confirmed before production launch."],
    ["14. Browser controls and personal data", "Most browsers allow cookies to be viewed, blocked or deleted. Blocking necessary cookies may stop authentication and portal functionality. Some cookies and similar technologies may involve personal data. See the Privacy Policy for processing purposes, legal bases, retention, sharing and GDPR rights."],
    ["15. Changes and contact", "This policy may change when technologies, providers, analytics, functionality or legal requirements change. The latest version is published on the website. Questions can be directed to Team Belgium Powerchair Hockey VZW, Powerchair Hockey Battle, Address: Oude Diestsestraat 45, 3380 Glabbeek, Belgium, enterprise number BE0804.423.077, email hello@pcfbattle.be. Last updated: 19 September 2026."],
  ];
  const accessibilitySections: [string, string][] = [
    ["1. Our commitment", "The Powerchair Hockey Battle, organised by Team Belgium Powerchair Hockey VZW, aims to provide an accessible and inclusive experience for athletes, staff, assistants, volunteers, officials, spectators and visitors. We recognise that needs differ and work to remove barriers, provide clear information, make reasonable accommodations, listen to feedback and improve continuously."],
    ["2. Digital accessibility", "We aim to make the public website, registration system, team portal and other tournament services usable with a wide range of devices and assistive technologies, following recognised accessibility principles and relevant WCAG guidance where reasonably possible."],
    ["3. Website design", "We aim to provide consistent navigation, readable text, sufficient contrast, meaningful headings, understandable links and buttons, labelled form fields, visible keyboard focus, responsive layouts, usable enlarged text, alternatives to colour-only information, and accessible errors and validation messages."],
    ["4. Keyboard and assistive technology", "Important functionality should work without a mouse or touchscreen. Focus should remain visible and follow a logical order without intentional keyboard traps. We aim to use semantic structures, associated labels, meaningful alternative text, accessible controls, useful link text and status information."],
    ["5. Colour, contrast and motion", "Important information should not depend solely on colour. This includes match status, groups, schedules, rankings, warnings, errors, buttons and navigation. Colour-coded labels should also contain text or another indicator. Animations and automatic movement should not unnecessarily interfere with use."],
    ["6. Forms and registration", "Registration and team administration forms should have clear labels, understandable instructions, useful validation, clear required fields, sufficient completion time where reasonably possible, and accessible confirmation and error states. If a digital process cannot be completed because of a barrier, contact the organiser for assistance or an alternative."],
    ["7. Sports venue", "The organiser aims to arrange facilities suitable for powerchair athletes and wheelchair users, considering step-free access, wide routes, wheelchair-accessible playing and team areas, accessible spectator areas, toilets, changing facilities, administration areas and safe movement of sports and everyday wheelchairs."],
    ["8. Toilets and charging", "The venue should provide accessible toilets and clear information about their location. Where possible, appropriate wheelchair charging arrangements will be identified. Participants remain responsible for chargers, cables, adapters and compatible equipment and must follow venue safety requirements."],
    ["9. Emergency accessibility", "Accessibility will be considered in safety and emergency planning. Participants who need specific assistance should communicate this to their team and, where appropriate, the organiser. Teams remain responsible for personal assistance and supervision, and venue instructions must be followed."],
    ["10. Accessible accommodation", "Where accommodation is included, accessibility requirements will be considered for rooms, step-free access, bathrooms, space around beds and personal assistants. Teams must communicate essential requirements early. Accessible rooms may be limited, so specific configurations cannot be guaranteed unless confirmed."],
    ["11. Assistants and personal equipment", "Participants who require personal assistance remain responsible for arranging assistants or carers unless explicitly agreed otherwise. Official delegation members must be registered. Participants are responsible for wheelchairs, batteries, chargers, medication, medical and personal-care equipment and other specialist equipment."],
    ["12. Travel, parking and transportation", "Information about accessible parking, drop-off points and entrances will be shared where available. Unless included in the tournament package, teams arrange accessible transport to, from and between locations. Organiser-provided transport will take known requirements into account where reasonably possible."],
    ["13. Information and alternative formats", "We aim to communicate schedules, venue, hotel, match, accessibility and emergency information clearly and promptly when changes occur. If a format is inaccessible, contact us and we will provide another suitable format or assistance where reasonably possible."],
    ["14. Requesting arrangements", "Teams and participants should communicate accessibility requirements during registration or through the team portal as early as possible. Late requests are still considered, but arrangements may be limited after hotels, venues or external services are finalised."],
    ["15. Sensitive information", "Accessibility requests may reveal health or disability information. Such information is handled under the Privacy Policy and applicable data-protection law. We collect only what is reasonably necessary and restrict access to authorised people who need it for the relevant purpose."],
    ["16. Assistance animals", "Participants or visitors using a recognised assistance animal should contact the organiser in advance where possible. We will make reasonable efforts to accommodate assistance animals in accordance with venue rules and applicable law."],
    ["17. Spectators and visitors", "Accessibility also applies to spectators, family members, assistants, volunteers, officials, staff and media. Where a particular spectator area has limitations, we aim to provide clear information about available alternatives."],
    ["18. Reporting digital problems", "Report website or platform barriers to us with the page, task, barrier, device or browser and assistive technology where relevant. You do not need to disclose unnecessary medical information."],
    ["19. Reporting problems during the tournament", "Report an accessibility barrier to a tournament official, volunteer or organiser. Where reasonably possible, we will try to resolve immediate barriers during the event."],
    ["20. Contact", "Accessibility questions, requests or problems can be directed to Team Belgium Powerchair Hockey VZW, Powerchair Hockey Battle. Accessibility contact: hello@pcfbattle.be. Website: https://www.pcfbattle.be/. Include the team name where relevant."],
    ["21. Feedback and testing", "Accessibility is ongoing. Feedback helps identify barriers. We aim to review navigation, registration, login, portals, forms, schedules, match information, brackets and important public information. Automated tests may help, but manual testing and user feedback remain essential."],
    ["22. Third-party services and limitations", "Some services depend on independent websites, platforms, hotels or venues whose accessibility we cannot fully control. Existing infrastructure, availability or circumstances outside our control may limit a request. We will discuss limitations and seek practical alternatives where possible."],
    ["23. Changes and principle", "This policy may change when the tournament, venues, accommodation, platform or legal requirements change. Powerchair sport should be accessible by design, not as an afterthought. We aim to provide participation with dignity, independence and appropriate support. Last updated: 19 September 2026."],
  ];
  const content = {
    terms: {
      title: "Terms & Conditions",
      intro: "Powerchair Hockey Battle, organised by Team Belgium Powerchair Hockey VZW. By submitting a registration, the registering team confirms that it has read, understood and accepted these Terms & Conditions.",
      sections: termsSections,
    },
    privacy: {
      title: "Privacy Policy",
      intro: "Last updated: 19 September 2026. This Privacy Policy explains how Team Belgium Powerchair Hockey VZW collects, uses, stores and protects personal data in connection with the Powerchair Hockey Battle.",
      sections: privacySections,
    },
    cookies: {
      title: "Cookie Policy",
      intro: "Last updated: 19 September 2026. This policy explains how Team Belgium Powerchair Hockey VZW uses cookies and similar technologies on the Powerchair Hockey Battle website and tournament platform.",
      sections: cookieSections,
    },
    accessibility: {
      title: "Accessibility Policy",
      intro: "Last updated: 19 September 2026. The Powerchair Hockey Battle is committed to creating an accessible and inclusive tournament experience across the website, platform, venue, accommodation and tournament activities.",
      sections: accessibilitySections,
    },
  }[page];
  return <><PublicHeader settings={tournament} currentPath={`/${page}`} loading={!d.ready} /><main className="public legal-page"><div className="pagehero"><span>PCF BATTLE</span><h1>{content.title}</h1><p>{content.intro}</p></div><section className="block legal-content">{content.sections.map(([title, text]) => <article key={title}><h2>{title}</h2><p>{text}</p></article>)}</section></main><PublicFooter /><DeferredPublicChat /></>;
}

const TOURNAMENT_VIEWS = ["live", "schedule", "standings", "brackets", "statistics"];

// Homepage only: React hoists these into <head>. The media queries match the
// hero's <picture> sources, so each device preloads only the image it shows.
function HeroPreload() {
  return (
    <>
      <link rel="preload" as="image" href="/pcf-battle-hero-high.svg" type="image/svg+xml" media="(min-width: 801px)" fetchPriority="high" />
      <link rel="preload" as="image" href="/pcf-battle-hero-mobile.svg" type="image/svg+xml" media="(max-width: 800px)" fetchPriority="high" />
    </>
  );
}

export default function App({ params }: { params: Promise<{ slug?: string[] }> }) {
  const { slug = [] } = use(params);
  const p = `/${slug.join("/")}`.replace(/\/$/, "") || "/";
  useEffect(() => {
    document.title = getPageMetadata(p).title;
  }, [p]);
  if (p === "/") return <><HeroPreload /><DynamicLanding /></>;
  if (p === "/login") return <Login />;
  if (p.startsWith("/signup")) return <Signup />;
  if (p === "/admin") return <Suspense fallback={<div className="route-loading" />}><PortalApp role="admin" /></Suspense>;
  if (p === "/my-team") return <Suspense fallback={<div className="route-loading" />}><PortalApp role="team" /></Suspense>;
  if (p === "/referee") return <Suspense fallback={<div className="route-loading" />}><PortalApp role="referee" /></Suspense>;
  if (p === "/scoreboard") return <Suspense fallback={<div className="route-loading" />}><PortalApp role="scoreboard" /></Suspense>;
  if (p === "/scoreboard/display") return <Suspense fallback={<div className="scoreboard-screen loading" />}><ScoreboardDisplay /></Suspense>;
  if (p === "/about") return <About />;
  if (p === "/faq") return <FAQ />;
  if (p === "/livestream") return <Livestream />;
  if (p.startsWith("/teams/")) return <TeamOverview id={p.split("/").pop() || ""}/>;
  if (p === "/gallery") return <Suspense fallback={<div className="route-loading gallery-route-loading" aria-label="Loading media" />}><Gallery /></Suspense>;
  if (["/terms", "/privacy", "/cookies", "/accessibility"].includes(p)) return <LegalPage page={p.slice(1) as "terms" | "privacy" | "cookies" | "accessibility"} />;
  const tournamentView = /^\/tournament\/([a-z]+)$/.exec(p)?.[1];
  if (tournamentView && TOURNAMENT_VIEWS.includes(tournamentView)) return <DynamicPublic view={tournamentView} />;
  notFound();
}
