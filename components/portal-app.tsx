"use client";

import {
  FormEvent,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import {
  CalendarDays,
  ChevronRight,
  CircleDollarSign,
  ClipboardList,
  ClipboardCheck,
  Download,
  FileText,
  Hotel,
  LayoutDashboard,
  Link2,
  LogOut,
  Mail,
  Menu,
  Minus,
  Phone,
  Plus,
  RefreshCw,
  Search,
  Send,
  Settings,
  Shield,
  Swords,
  Trash2,
  Trophy,
  UserRoundCog,
  Users,
  Zap,
  Monitor,
} from "lucide-react";
import ThemeToggle from "@/components/theme-toggle";
const ScheduleWorkspaceLazy = lazy(() => import("@/components/schedule-workspace"));
const BracketBuilderLazy = lazy(() => import("@/components/bracket-builder"));
const GroupBuilderLazy = lazy(() => import("@/components/group-builder"));
const lazyFallback = <div className="panel loading-state" aria-busy="true">Loading workspace…</div>;
const ScheduleWorkspace = ({ refresh }: { refresh: number }) => <Suspense fallback={lazyFallback}><ScheduleWorkspaceLazy refresh={refresh} /></Suspense>;
const BracketBuilder = ({ refresh }: { refresh: number }) => <Suspense fallback={lazyFallback}><BracketBuilderLazy refresh={refresh} /></Suspense>;
const GroupBuilder = ({ refresh = 0 }: { refresh?: number }) => <Suspense fallback={lazyFallback}><GroupBuilderLazy refresh={refresh} /></Suspense>;
import { toast, Toaster } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { errorMessage } from "@/types/app";

type Role = "admin" | "team" | "referee" | "scoreboard";
type Row = Record<string, any>;
type TeamOverviewPayload = Row & {
  matches?: Row[];
  team?: Row;
  members?: Row[];
  rooms?: Row[];
  roomCost?: number;
};
type HealthCheck = { ready?: boolean; issues?: string[] };
type ReportEvent = Row & {
  created_at?: string;
  clock?: string;
  team_name?: string;
  player_name?: string;
  type?: string;
  details?: unknown;
};
const teamColors = [
  "#ec4899",
  "#f97316",
  "#8b5cf6",
  "#0ea5e9",
  "#ef4444",
  "#eab308",
  "#10b981",
  "#64748b",
];
const nav = {
  admin: [
    ["dashboard", "Dashboard", LayoutDashboard],
    ["operations", "Operations", Zap],
    ["messages", "Messages", Mail],
    ["contacts", "Contacts", Phone],
    ["teams", "Teams", Users],
    ["tournament", "Tournament settings", Trophy],
    ["matches", "Matches", Swords],
    ["control", "Game control", Monitor],
    ["delegation", "Delegation", ClipboardList],
    ["confirmations", "Registration Review", ClipboardList],
    ["mvp", "MVP voting", Trophy],
    ["rooms", "Rooms", Hotel],
    ["costs", "Finance", CircleDollarSign],
    ["sponsors", "Sponsors", Trophy],
    ["links", "Links", Link2],
    ["users", "Admin Panel", UserRoundCog],
    ["settings", "Settings", Settings],
  ],
  team: [
    ["overview", "Overview", LayoutDashboard],
    ["messages", "Messages", Mail],
    ["contacts", "Contacts", Phone],
    ["delegation", "Delegation", Users],
    ["rooms", "Rooms", Hotel],
    ["info", "Team Info", Shield],
    ["documents", "Documents", FileText],
    ["review", "Team Confirmation", ClipboardCheck],
    ["finance", "Payments", CircleDollarSign],
  ],
  referee: [
    ["matches", "My matches", Swords],
    ["messages", "Messages", Mail],
    ["contacts", "Contacts", Phone],
    ["schedule", "Schedule", CalendarDays],
    ["mvp", "MVP voting", Trophy],
  ],
  scoreboard: [["control", "Match control", Monitor]],
} as const;

const pendingGetRequests = new Map<string, Promise<unknown>>();
const recentGetResponses = new Map<
  string,
  { expiresAt: number; data: unknown }
>();
const GET_CACHE_MS = 30_000;
const MAX_CACHE_ENTRIES = 32;
const CACHEABLE_GETS = new Set(["/tournaments", "/links"]);

class ApiError extends Error {
  status: number;
  code?: string;
  fields?: Record<string, string>;
  requestId?: string;

  constructor(message: string, response: Response, details: Record<string, unknown> = {}) {
    super(message);
    this.name = "ApiError";
    this.status = response.status;
    this.code = typeof details.code === "string" ? details.code : undefined;
    this.fields = details.fields && typeof details.fields === "object" ? details.fields as Record<string, string> : undefined;
    this.requestId = response.headers.get("x-request-id") || undefined;
  }
}

function invalidateGetCache(paths?: string[]) {
  if (!paths?.length) {
    recentGetResponses.clear();
    return;
  }
  for (const key of recentGetResponses.keys()) {
    if (paths.some((path) => key === path || key.startsWith(`${path}?`))) recentGetResponses.delete(key);
  }
}

function cacheDependencies(path: string) {
  if (path.startsWith("/teams") || path.startsWith("/tournaments") || path.startsWith("/links")) return ["/tournaments", "/links"];
  return undefined;
}

function rememberGet(path: string, data: unknown) {
  if (recentGetResponses.size >= MAX_CACHE_ENTRIES) {
    const oldest = recentGetResponses.keys().next().value;
    if (oldest) recentGetResponses.delete(oldest);
  }
  recentGetResponses.set(path, { expiresAt: Date.now() + GET_CACHE_MS, data });
}

function combineSignals(signal: AbortSignal | null | undefined, timeoutMs: number) {
  const timeoutController = new AbortController();
  const timer = window.setTimeout(() => timeoutController.abort(), timeoutMs);
  if (!signal) return { signal: timeoutController.signal, cancel: () => window.clearTimeout(timer) };
  if (typeof AbortSignal.any === "function") {
    return { signal: AbortSignal.any([signal, timeoutController.signal]), cancel: () => window.clearTimeout(timer) };
  }
  const controller = new AbortController();
  const abort = () => controller.abort(signal.reason);
  if (signal.aborted || timeoutController.signal.aborted) abort();
  signal.addEventListener("abort", abort, { once: true });
  timeoutController.signal.addEventListener("abort", () => controller.abort(), { once: true });
  return { signal: controller.signal, cancel: () => window.clearTimeout(timer) };
}

async function parseApiResponse(response: Response) {
  const contentType = response.headers.get("content-type") || "";
  if (response.status === 204) return null;
  if (contentType.includes("application/json")) return response.json().catch(() => ({}));
  return response.text();
}

async function fetchWithRetry(url: string, init: RequestInit, retries: number) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      const response = await fetch(url, init);
      if (response.status >= 500 && response.status < 600 && attempt < retries) {
        await new Promise((resolve) => window.setTimeout(resolve, 150 * 2 ** attempt + Math.random() * 100));
        continue;
      }
      return response;
    } catch (error) {
      if (init.signal?.aborted || attempt >= retries) throw error;
      await new Promise((resolve) => window.setTimeout(resolve, 150 * 2 ** attempt + Math.random() * 100));
    }
  }
}

async function api(path: string, options: RequestInit = {}) {
  const method = String(options.method || "GET").toUpperCase();
  const cacheable = method === "GET" && CACHEABLE_GETS.has(path);
  if (method === "GET") {
    const cached = recentGetResponses.get(path);
    if (cached && cached.expiresAt > Date.now()) return cached.data;
    if (cached) recentGetResponses.delete(path);
    const pending = pendingGetRequests.get(path);
    if (pending) return pending;
  }
  const request = (async () => {
    const headers = new Headers(options.headers);
    if (options.body) headers.set("Content-Type", "application/json");
    const timeout = method === "GET" ? 15000 : 10000;
    const combined = combineSignals(options.signal, timeout);
    let res: Response;
    try {
      res = await fetchWithRetry(`/api${path}`, {
        ...options,
        headers,
        credentials: "same-origin",
        signal: combined.signal,
      }, method === "GET" ? 2 : 0);
    } finally {
      combined.cancel();
    }
    const data = await parseApiResponse(res);
    if (!res.ok) {
      const details = typeof data === "object" && data !== null ? data as Record<string, unknown> : {};
      throw new ApiError(typeof details.error === "string" ? details.error : `Request failed (${res.status})`, res, details);
    }
    return data;
  })();
  if (method !== "GET") {
    invalidateGetCache(cacheDependencies(path));
    return request;
  }
  pendingGetRequests.set(path, request);
  try {
    const data = await request;
    if (cacheable) rememberGet(path, data);
    return data;
  } finally {
    if (pendingGetRequests.get(path) === request)
      pendingGetRequests.delete(path);
  }
}
async function prepareUploadFile(file: File) {
  if (
    !file.type.startsWith("image/") ||
    file.type === "image/svg+xml" ||
    file.size <= 750 * 1024
  )
    return file;
  const bitmap = await createImageBitmap(file);
  const maxSide = 2200;
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/webp", 0.82),
  );
  return blob && blob.size < file.size
    ? new File([blob], `${file.name.replace(/\.[^.]+$/, "")}.webp`, {
        type: "image/webp",
      })
    : file;
}
async function uploadFile(file: File) {
  const upload = await prepareUploadFile(file);
  const body = new FormData();
  body.append("file", upload);
  const res = await fetch("/api/uploads", {
      method: "POST",
      credentials: "same-origin",
      body,
    }),
    data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Upload failed");
  return data;
}
const fmtMoney = (n: unknown) =>
  new Intl.NumberFormat("en-BE", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(n || 0));
const fmtDate = (s: unknown) =>
  s
    ? new Date(
        /^\d{4}-\d{2}-\d{2}$/.test(String(s)) ? `${s}T12:00:00` : String(s),
      ).toLocaleDateString("en-BE")
    : "—";
const matchStamp = (match: Row) =>
  `${match.match_date || "9999-12-31"}T${match.start_time || "23:59"}`;
const sortMatches = (a: Row, b: Row) =>
  matchStamp(a).localeCompare(matchStamp(b));

function Modal({
  title,
  open,
  onOpenChange,
  className = "",
  children,
}: {
  title: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={`portal-dialog ${className}`}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}
function Field({
  label,
  name,
  defaultValue = "",
  type = "text",
  required = false,
  minLength,
  min,
  max,
  step,
  placeholder,
  children,
}: {
  label: string;
  name: string;
  defaultValue?: string | number | readonly string[];
  type?: string;
  required?: boolean;
  minLength?: number;
  min?: number;
  max?: number;
  step?: number;
  placeholder?: string;
  children?: ReactNode;
}) {
  const fieldChildren =
    name === "method" ? (
      <select name="method">
        <option value="BANK_TRANSFER">Bank transfer</option>
      </select>
    ) : (
      children
    );
  const fieldDefaultValue = defaultValue;
  return (
    <label className="portal-field">
      <span>
        {label}
        {required && (
          <i className="required-mark" aria-hidden="true">
            *
          </i>
        )}
      </span>
      {fieldChildren || (
        <input
          name={name}
          type={type}
          defaultValue={fieldDefaultValue ?? ""}
          required={required}
          minLength={minLength}
          min={min}
          max={max}
          step={step}
          placeholder={placeholder}
        />
      )}
    </label>
  );
}
const callingCodes = [
  ["BE", "🇧🇪 Belgium", "+32"],
  ["NL", "🇳🇱 Netherlands", "+31"],
  ["DE", "🇩🇪 Germany", "+49"],
  ["FR", "🇫🇷 France", "+33"],
  ["GR", "🇬🇷 Greece", "+30"],
  ["GB", "🇬🇧 United Kingdom", "+44"],
  ["ES", "🇪🇸 Spain", "+34"],
  ["IT", "🇮🇹 Italy", "+39"],
  ["CH", "🇨🇭 Switzerland", "+41"],
  ["US", "🇺🇸 United States", "+1"],
];
function PhoneField({
  defaultValue = "",
  defaultCode = "+32",
  required = false,
}: {
  defaultValue?: string;
  defaultCode?: string;
  required?: boolean;
}) {
  return (
    <label className="portal-field">
      <span>
        Phone number
        {required && (
          <i className="required-mark" aria-hidden="true">
            *
          </i>
        )}
      </span>
      <span className="phone-field">
        <select
          name="phone_country_code"
          defaultValue={defaultCode}
          aria-label="Country calling code"
        >
          {callingCodes.map(([country, label, code]) => (
            <option key={country} value={code}>
              {label} {code}
            </option>
          ))}
        </select>
        <input
          name="phone"
          type="tel"
          defaultValue={defaultValue}
          required={required}
          inputMode="tel"
          placeholder="Phone number"
        />
      </span>
    </label>
  );
}
function AddressFields({ team }: { team?: Row }) {
  return (
    <div className="address-fields">
      <Field
        label="Street"
        name="address_street"
        defaultValue={team?.address_street || ""}
        required
      />
      <Field
        label="House/building number"
        name="address_number"
        defaultValue={team?.address_number || ""}
        required
      />
      <Field
        label="Postal/ZIP code"
        name="address_postal_code"
        defaultValue={team?.address_postal_code || ""}
        required
      />
      <Field
        label="City"
        name="address_city"
        defaultValue={team?.address_city || ""}
        required
      />
      <Field
        label="Country"
        name="address_country"
        defaultValue={team?.address_country || "Belgium"}
        required
        children={
          <>
            <input
              name="address_country"
              list="country-list"
              defaultValue={team?.address_country || "Belgium"}
              required
            />
            <datalist id="country-list">
              {[
                "Belgium",
                "Netherlands",
                "Germany",
                "France",
                "Greece",
                "Spain",
                "Italy",
                "Switzerland",
                "United Kingdom",
                "United States",
              ].map((country) => (
                <option key={country} value={country} />
              ))}
            </datalist>
          </>
        }
      />
    </div>
  );
}
function VisibilityField({
  label,
  name,
  defaultValue = 1,
  onLabel = "Visible",
  offLabel = "Hidden",
}: {
  label: string;
  name: string;
  defaultValue?: number;
  onLabel?: string;
  offLabel?: string;
}) {
  const [checked, setChecked] = useState(defaultValue !== 0);
  return (
    <label className="visibility-switch">
      <span>
        <b>{label}</b>
        <small>{checked ? onLabel : offLabel}</small>
      </span>
      <input type="hidden" name={name} value={checked ? "1" : "0"} />
      <button
        type="button"
        className="settings-switch"
        role="switch"
        aria-checked={checked}
        aria-label={`${label}: ${checked ? onLabel : offLabel}`}
        onClick={() => setChecked((value) => !value)}
      >
        <span aria-hidden="true" />
      </button>
    </label>
  );
}
function FormButtons({
  busy,
  onCancel,
}: {
  busy: boolean;
  onCancel: () => void;
}) {
  return (
    <div className="form-actions">
      <button type="button" className="btn" onClick={onCancel}>
        Cancel
      </button>
      <button
        className="btn primary"
        disabled={busy}
        aria-busy={busy}
        onClick={(event) => {
          const button = event.currentTarget;
          const form = button.form;
          if (form && !form.checkValidity()) return;
          if (
            button.dataset.submitting === "true" ||
            form?.dataset.submitting === "true"
          ) {
            event.preventDefault();
            return;
          }
          if (form) form.dataset.submitting = "true";
          window.setTimeout(() => {
            if (!button.isConnected) return;
            button.dataset.submitting = "true";
            button.disabled = true;
            button.setAttribute("aria-busy", "true");
            button.textContent = "Saving…";
          }, 0);
        }}
      >
        {busy ? "Saving…" : "Save"}
      </button>
    </div>
  );
}
function Empty({ text }: { text: string }) {
  return (
    <div className="portal-empty">
      <ClipboardList />
      <b>{text}</b>
      <span>Use the action above to add the first item.</span>
    </div>
  );
}
function Badge({ children }: { children: ReactNode }) {
  const state =
    String(children).toLowerCase() === "public"
      ? "published"
      : String(children).toLowerCase();
  return <span className={`portal-badge ${state}`}>{children}</span>;
}
function TeamMark({ team }: { team?: Row }) {
  if (team?.logo)
    return (
      <span className="portal-mark logo">
        <img src={team.logo} alt="" />
      </span>
    );
  return (
    <span
      className="portal-mark"
      style={{ background: team?.color || "#64748b" }}
    >
      {(team?.name || "?")
        .split(" ")
        .map((x: string) => x[0])
        .join("")
        .slice(0, 2)}
    </span>
  );
}
function Confirm({
  title,
  text,
  onConfirm,
  passwordInput = false,
  children,
}: {
  title: string;
  text: string;
  onConfirm: (password?: string) => Promise<void> | void;
  passwordInput?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [password, setPassword] = useState("");
  return (
    <>
      <span onClick={() => setOpen(true)}>{children}</span>
      <Modal title={title} open={open} onOpenChange={setOpen}>
        <p>{text}</p>
        {passwordInput && <Field label="Admin password" name="reset-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" />}
        <div className="form-actions">
          <button className="btn" onClick={() => setOpen(false)}>
            Cancel
          </button>
          <button
            className="btn danger"
            disabled={busy || (passwordInput && !password)}
            onClick={async () => {
              setBusy(true);
              try {
                await onConfirm(passwordInput ? password : undefined);
                setPassword("");
                setOpen(false);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Working…" : passwordInput ? "Reset securely" : "Confirm"}
          </button>
        </div>
      </Modal>
    </>
  );
}

export default function PortalApp({ role }: { role: Role }) {
  const items = nav[role],
    [active, setActive] = useState<string>(() => {
      if (typeof window === "undefined") return items[0][0];
      const saved = localStorage.getItem(`phb_active_page_${role}`);
      return saved && items.some((item) => item[0] === saved)
        ? saved
        : items[0][0];
    }),
    [menu, setMenu] = useState(false),
    [user, setUser] = useState<Row | null>(null),
    [tournamentYear, setTournamentYear] = useState(new Date().getFullYear()),
    [refresh, setRefresh] = useState(0),
    [refreshing, setRefreshing] = useState(false),
    [unread, setUnread] = useState(0),
    previousUnread = useRef<number | null>(null);
  const reload = () => setRefresh((x) => x + 1);
  const refreshAll = () => {
    if (refreshing) return;
    setRefreshing(true);
    reload();
    window.setTimeout(() => setRefreshing(false), 700);
  };
  const navigate = (page: string) => {
    if (!items.some((item) => item[0] === page)) return;
    setActive(page);
    localStorage.setItem(`phb_active_page_${role}`, page);
  };
  useEffect(() => {
    const raw = localStorage.getItem("phb_user");
    if (!raw) {
      location.assign("/login");
      return;
    }
    const cached = JSON.parse(raw);
    if (String(cached.role).toLowerCase() !== role) {
      location.assign(
        cached.role === "ADMIN"
          ? "/admin"
          : cached.role === "TEAM"
            ? "/my-team"
            : cached.role === "REFEREE"
              ? "/referee"
              : "/scoreboard",
      );
      return;
    }
    setUser(cached);
    api("/auth/me")
      .then(setUser)
      .catch((e: any) => {
        if (e.message === "Unauthorized") {
          localStorage.removeItem("phb_user");
          location.assign("/login");
        } else {
          setUser(cached);
        }
      });
  }, [role]);
  useEffect(() => {
    api("/tournaments")
      .then((rows) => {
        const active = rows.find((row: Row) => row.active) || rows[0],
          year = Number(String(active?.start_date || "").slice(0, 4));
        if (year) setTournamentYear(year);
      })
      .catch(() => {});
  }, [refresh]);
  useEffect(() => {
    if (!user) return;
    let stopped = false;
    const check = async () => {
      if (document.hidden) return;
      try {
        const rows = await api("/messages"),
          count = rows.filter(
            (m: Row) => m.recipient_user_id === user.id && !m.read_at,
          ).length;
        if (!stopped) {
          if (previousUnread.current !== null && count > previousUnread.current)
            toast.info("You received a new message", {
              action: { label: "Open", onClick: () => navigate("messages") },
            });
          previousUnread.current = count;
          setUnread(count);
        }
      } catch {}
    };
    check();
    const timer = setInterval(check, 5000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [user?.id]);
  if (!user) return null;
  return (
    <div className="portal">
      <header>
        <Link className="brand" href="/">
          <img src="/PFB_Logo_Pink.svg" alt="PCF Battle" />
          <span>
            PCF <b>BATTLE</b>
          </span>
        </Link>
        <div className="head-actions">
          <ThemeToggle />
          <button
            className="icon mobile"
            aria-label="Open menu"
            onClick={() => setMenu(!menu)}
          >
            <Menu />
          </button>
          <span className="portal-user">
            <b>{user.name}</b>
            <small>{role} portal</small>
          </span>
          <span className="user">
            {user.name
              ?.split(" ")
              .map((x: string) => x[0])
              .join("")
              .slice(0, 2)}
          </span>
        </div>
      </header>
      <aside className={`sidebar ${menu ? "open" : ""}`}>
        <b>{role.toUpperCase()} PORTAL</b>
        <nav>
          {items.map(([id, label, Icon]) => (
            <button
              className={active === id ? "active" : ""}
              key={id}
              onClick={() => {
                navigate(id);
                setMenu(false);
              }}
            >
              <Icon />
              <span>{label}</span>
              {id === "messages" && unread > 0 ? (
                <em
                  className="nav-notification"
                  aria-label={`${unread} unread messages`}
                >
                  {unread > 99 ? "99+" : unread}
                </em>
              ) : null}
            </button>
          ))}
        </nav>
        <button
          onClick={async () => {
            await api("/auth/logout", { method: "POST" }).catch(() => {});
            localStorage.removeItem("phb_user");
            location.assign("/login");
          }}
        >
          <LogOut /> Log out
        </button>
      </aside>
      <main className="workspace">
        <div className="workspacehead">
          <div>
            <span>PCF BATTLE {tournamentYear}</span>
            <h1>{items.find((x) => x[0] === active)?.[1]}</h1>
          </div>
          <button
            className="btn"
            onClick={refreshAll}
            disabled={refreshing}
            aria-busy={refreshing}
          >
            <RefreshCw className={refreshing ? "spin" : undefined} />{" "}
            {refreshing ? "Refreshing…" : "Refresh"}
          </button>
        </div>
        {role === "admin" ? (
          <Admin
            active={active}
            refresh={refresh}
            reload={reload}
            onOpenGameControl={() => navigate("control")}
          />
        ) : role === "team" ? (
          <Team
            active={active}
            refresh={refresh}
            onNavigate={navigate}
            reload={reload}
          />
        ) : role === "referee" ? (
          <Referee active={active} refresh={refresh} />
        ) : (
          <ScoreboardControl refresh={refresh} />
        )}
      </main>
      <Toaster richColors />
    </div>
  );
}

function useData<T = Row[]>(path: string, refresh = 0, poll = false) {
  const [data, setData] = useState<T>([] as unknown as T),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const requestId = useRef(0), abortRef = useRef<AbortController | null>(null);
  const load = useCallback(
    () => {
      const currentRequest = ++requestId.current;
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setLoading(true);
      return api(path, { signal: controller.signal })
        .then((value) => {
          if (currentRequest !== requestId.current) return;
          setData(value);
          setError("");
        })
        .catch((e: Error) => {
          if (currentRequest !== requestId.current) return;
          setError(e.message);
          toast.error(e.message);
        })
        .finally(() => {
          if (currentRequest === requestId.current) setLoading(false);
        });
    },
    [path],
  );
  useEffect(() => {
    load();
    if (!poll) return;
    const t = setInterval(() => {
      if (!document.hidden) load();
    }, 10000);
    return () => { clearInterval(t); abortRef.current?.abort(); };
  }, [load, refresh, poll]);
  return { data, loading, error, load };
}

function Admin({
  active,
  refresh,
  reload,
  onOpenGameControl,
}: {
  active: string;
  refresh: number;
  reload: () => void;
  onOpenGameControl: () => void;
}) {
  if (active === "dashboard") return <Dashboard refresh={refresh} />;
  if (active === "operations")
    return (
      <OperationsHub refresh={refresh} onOpenGameControl={onOpenGameControl} />
    );
  if (active === "messages") return <ChatPanel refresh={refresh} />;
  if (active === "contacts") return <ContactsPanel refresh={refresh} admin />;
  if (active === "teams") return <TeamsAdminV2 refresh={refresh} />;
  if (active === "tournament") return <TournamentManager refresh={refresh} />;
  if (active === "matches") return <MatchesAdmin refresh={refresh} />;
  if (active === "control") return <ScoreboardControl refresh={refresh} />;
  if (active === "delegation") return <Delegation refresh={refresh} admin />;
  if (active === "confirmations")
    return <ConfirmationsOverview refresh={refresh} />;
  if (active === "mvp") return <MvpVoting refresh={refresh} admin />;
  if (active === "rooms") return <RoomsPanelV2 refresh={refresh} admin />;
  if (active === "invites") return <Invites refresh={refresh} />;
  if (active === "costs")
    return (
      <>
        <AdminFinanceSimple refresh={refresh} />
        <FinanceSettingsPanel refresh={refresh} />
      </>
    );
  if (active === "sponsors") return <SponsorPanel refresh={refresh} />;
  if (active === "links") return <ResourcePanel refresh={refresh} />;
  if (active === "users") return <UsersPanel refresh={refresh} />;
  return <SettingsPanel reload={reload} />;
}

function ConfirmationsOverview({ refresh }: { refresh: number }) {
  const reviews = useData("/team-reviews", refresh),
    [busy, setBusy] = useState<string | null>(null),
    [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  async function reviewAction(
    teamId: string,
    action: "approve" | "request_changes" | "withdraw",
  ) {
    setBusy(`${teamId}:${action}`);
    try {
      await api("/team-review/admin", {
        method: "POST",
        body: JSON.stringify({
          team_id: teamId,
          action,
          message:
            action === "request_changes"
              ? "Please review the submitted information and correct the highlighted items."
              : undefined,
        }),
      });
      toast.success(
        action === "approve"
          ? "Costs approved and payment opened"
          : action === "withdraw"
            ? "Team review withdrawn"
            : "Changes requested",
      );
      reviews.load();
    } catch (error: unknown) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(null);
    }
  }
  return (
    <>
      <AdminOnboardingOverview refresh={refresh} />
      <section className="panel confirmations-overview">
        <div className="panelhead">
          <div>
            <h3>Registration Review</h3>
            <small>
              Review the complete team submission before opening payment.
            </small>
          </div>
        </div>
        <div className="confirmation-list">
          {reviews.data.map((team: Row) => {
            const isCollapsed = collapsed[team.id] ?? true;
            return (
              <article
                className={`confirmation-team${isCollapsed ? " is-collapsed" : ""}`}
                key={team.id}
              >
                <div className="confirmation-team-heading">
                  <div>
                    <h4>{team.name}</h4>
                    <small>
                      {team.review_status === "awaiting_admin"
                        ? `Submitted ${fmtDate(team.team_reviewed_at)}`
                        : team.review_status === "approved_payment_open"
                          ? `Approved ${fmtDate(team.admin_reviewed_at)}`
                          : team.review_message || "No review submitted yet"}
                    </small>
                  </div>
                  <button
                    type="button"
                    className="btn small"
                    aria-expanded={!isCollapsed}
                    onClick={() =>
                      setCollapsed((current) => ({
                        ...current,
                        [team.id]: !isCollapsed,
                      }))
                    }
                  >
                    {isCollapsed ? "Expand review" : "Collapse review"}
                  </button>
                </div>
                {!isCollapsed && (
                  <>
                    <div>
                      {team.review_snapshot && (
                        <AdminReviewSnapshot snapshot={team.review_snapshot} />
                      )}
                    </div>
                    <div className="confirmation-control">
                      <span
                        className={`status-pill ${team.review_status === "approved_payment_open" ? "confirmed" : team.review_status === "awaiting_admin" ? "pending" : "neutral"}`}
                      >
                        {team.review_status === "awaiting_admin"
                          ? "Awaiting Registration Review"
                          : team.review_status === "approved_payment_open"
                            ? "Registration approved"
                            : team.review_status === "changes_requested"
                              ? "Changes requested"
                              : "Information incomplete"}
                      </span>
                      {team.review_status === "awaiting_admin" && (
                        <>
                          <button
                            className="btn"
                            disabled={busy === `${team.id}:request_changes`}
                            onClick={() =>
                              reviewAction(team.id, "request_changes")
                            }
                          >
                            Request changes
                          </button>
                          <Confirm
                            title="Withdraw team confirmation?"
                            text="This returns the team to Information incomplete so they can correct and resubmit their review. Payment will remain locked."
                            onConfirm={() => reviewAction(team.id, "withdraw")}
                          >
                            <button
                              className="btn"
                              disabled={busy === `${team.id}:withdraw`}
                            >
                              Withdraw confirmation
                            </button>
                          </Confirm>
                          <button
                            className="btn primary"
                            disabled={busy === `${team.id}:approve`}
                            onClick={() => reviewAction(team.id, "approve")}
                          >
                            Approve Registration
                          </button>
                        </>
                      )}
                    </div>
                  </>
                )}
              </article>
            );
          })}
        </div>
      </section>
    </>
  );
}

function AdminOnboardingOverview({ refresh }: { refresh: number }) {
  const onboarding = useData<Row[]>("/team-onboardings", refresh);
  return (
    <section className="panel admin-onboarding-overview">
      <div className="panelhead">
        <div>
          <span className="eyebrow">Tournament lifecycle</span>
          <h3>Team onboarding</h3>
          <small>
            Team setup → Delegation → Rooms → Review → Team Confirmation →
            Registration Review → Deposit → Balance → Tournament Ready
          </small>
        </div>
      </div>
      <div className="admin-onboarding-list">
        {onboarding.data.map((item: Row) => (
          <article key={item.team.id} className="admin-onboarding-team">
            <div className="admin-onboarding-team-name">
              <TeamMark team={item.team} />
              <div>
                <b>{item.team.name}</b>
                <small>{item.action}</small>
              </div>
            </div>
            <div className="admin-onboarding-stages">
              {item.stages.map((stage: Row) => (
                <span
                  className={
                    stage.done
                      ? "done"
                      : stage.state === "current"
                        ? "current"
                        : "upcoming"
                  }
                  key={stage.key}
                >
                  <i>{stage.done ? "✓" : "·"}</i>
                  {stage.label}
                </span>
              ))}
            </div>
            <div className="admin-onboarding-status">
              <b>{item.current}</b>
              <small>
                {item.payment?.deposit
                  ? `Deposit ${fmtMoney(item.payment.deposit)} · paid ${fmtMoney(item.payment.paid)}`
                  : "No payment opened"}
              </small>
            </div>
          </article>
        ))}
        {!onboarding.loading && !onboarding.data.length && (
          <Empty text="No teams found" />
        )}
      </div>
    </section>
  );
}

function AdminReviewSnapshot({
  snapshot,
  teamId,
  canReopen = true,
}: {
  snapshot: string;
  teamId?: string;
  canReopen?: boolean;
}) {
  let data: Row = {};
  try {
    data = JSON.parse(snapshot);
  } catch {
    return (
      <p className="formerror">Submitted review could not be displayed.</p>
    );
  }
  const pricing = data.pricing || {},
    members = data.members || [],
    rooms = data.rooms || [],
    reopenTeamId = teamId || data.team?.id;
  async function reopen() {
    if (!reopenTeamId) return;
    try {
      await api("/team-review/admin", {
        method: "POST",
        body: JSON.stringify({ team_id: reopenTeamId, action: "reopen" }),
      });
      toast.success("Review reopened for the team");
      window.location.reload();
    } catch (error: unknown) {
      toast.error(errorMessage(error));
    }
  }
  return (
    <div className="admin-review-summary team-review-look">
      <section className="review-card">
        <div className="review-card-heading">
          <div>
            <span className="review-number">1</span>
            <div>
              <h3>Team information</h3>
              <small>Used for communication and billing</small>
            </div>
          </div>
          {canReopen && (
            <Confirm
              title="Reopen this review?"
              text="The team will return to Information incomplete. Any unpaid deposit request will be cancelled and the team must confirm again."
              onConfirm={reopen}
            >
              <button className="btn" type="button">
                Reopen review
              </button>
            </Confirm>
          )}
        </div>
        <div className="review-detail-grid">
          <span>
            <small>Team</small>
            <b>{data.team?.name || "Not provided"}</b>
          </span>
          <span>
            <small>Contact</small>
            <b>{data.team?.contact_person || "Not provided"}</b>
          </span>
          <span>
            <small>Phone</small>
            <b>{data.team?.phone || "Not provided"}</b>
          </span>
          <span className="wide">
            <small>Billing address</small>
            <b>{data.team?.address || "Not provided"}</b>
          </span>
        </div>
      </section>
      <section className="review-card">
        <div className="review-card-heading">
          <div>
            <span className="review-number">2</span>
            <div>
              <h3>Delegation</h3>
              <small>
                {members.length} payable members ·{" "}
                {
                  members.filter(
                    (member: Row) => member.member_type === "PLAYER",
                  ).length
                }{" "}
                players
              </small>
            </div>
          </div>
        </div>
        <div className="review-member-list">
          {members.map((member: Row) => (
            <div key={member.id}>
              <span className="member-avatar">
                {String(member.name || "")
                  .split(" ")
                  .map((part: string) => part[0])
                  .join("")
                  .slice(0, 2)}
              </span>
              <span>
                <b>{member.name}</b>
                <small>
                  {member.member_type === "PLAYER"
                    ? `Player · #${member.number || "—"} · ${member.player_role || "—"} · ${member.classification_points ?? "—"} points`
                    : member.staff_role || member.member_type}
                </small>
              </span>
            </div>
          ))}
        </div>
      </section>
      <section className="review-card">
        <div className="review-card-heading">
          <div>
            <span className="review-number">3</span>
            <div>
              <h3>Rooms & supplements</h3>
              <small>Every delegation member must have a room</small>
            </div>
          </div>
        </div>
        <div className="review-room-list">
          {rooms.map((room: Row) => (
            <div key={room.id}>
              <span>
                <b>Room {room.number}</b>
                <small>
                  {room.members.length} / {room.capacity} occupants
                </small>
              </span>
              <span>
                {room.members.map((member: Row) => member.name).join(", ") ||
                  "Empty"}
                {room.members.length === 1 && (
                  <small className="supplement">
                    Single-room supplement ·{" "}
                    {fmtMoney(pricing.singleSupplement || 0)}
                  </small>
                )}
              </span>
            </div>
          ))}
        </div>
      </section>
      <section className="review-card">
        <div className="review-card-heading">
          <div>
            <span className="review-number">4</span>
            <div>
              <h3>Billing information</h3>
              <small>Used for payment administration</small>
            </div>
          </div>
        </div>
        <div className="review-detail-grid">
          <span>
            <small>Organization</small>
            <b>{data.team?.name || "Not provided"}</b>
          </span>
          <span>
            <small>Billing contact</small>
            <b>{data.team?.contact_person || "Not provided"}</b>
          </span>
          <span className="wide">
            <small>Address</small>
            <b>{data.team?.address || "Not provided"}</b>
          </span>
        </div>
      </section>
      <section className="review-cost-card admin-review-cost-card">
        <div className="review-cost-heading">
          <span className="eyebrow">Approved calculation</span>
          <h3>Cost summary</h3>
        </div>
        <div className="cost-line">
          <span>
            {members.length} × {fmtMoney(pricing.unitPrice)} participation
          </span>
          <b>{fmtMoney(pricing.participantSubtotal)}</b>
        </div>
        <div className="cost-line">
          <span>
            {pricing.singleRoomCount || 0} ×{" "}
            {fmtMoney(pricing.singleSupplement)} single-room supplement
          </span>
          <b>{fmtMoney(pricing.accommodationSupplement)}</b>
        </div>
        <div className="cost-total">
          <span>Total participation cost</span>
          <strong>{fmtMoney(pricing.total)}</strong>
        </div>
        <div className="cost-schedule">
          <span>
            <small>Deposit · {pricing.depositPercentage || 30}%</small>
            <b>{fmtMoney(pricing.deposit)}</b>
          </span>
          <span>
            <small>
              Remaining · {100 - (pricing.depositPercentage || 30)}%
            </small>
            <b>{fmtMoney(pricing.balance)}</b>
          </span>
        </div>
      </section>
    </div>
  );
}

function TeamReview({ refresh }: { refresh: number }) {
  const review = useData<Row>("/team-review", refresh),
    data = review.data || {},
    team = data.team || {},
    pricing = data.pricing || {},
    [checked, setChecked] = useState(false),
    [busy, setBusy] = useState(false);
  async function submit() {
    setBusy(true);
    try {
      await api("/team-review/confirm", {
        method: "POST",
        body: JSON.stringify({}),
      });
      toast.success("Information submitted for admin review");
      review.load();
    } catch (error: unknown) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  async function withdraw() {
    setBusy(true);
    try {
      await api("/team-review/withdraw", {
        method: "POST",
        body: JSON.stringify({}),
      });
      toast.success("Review withdrawn — you can update your information now");
      review.load();
    } catch (error: unknown) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  if (review.loading && !review.data)
    return <section className="panel">Loading review…</section>;
  const blocked = data.issues?.length > 0,
    status = team.review_status || "information_incomplete";
  return (
    <section className="review-page">
      <div className="review-hero panel">
        <div>
          <span className="eyebrow">Team Confirmation</span>
          <h2>Review & confirm</h2>
          <p>
            Check everything once before your information is sent to PCF BATTLE.
          </p>
        </div>
        <span
          className={`status-pill ${status === "approved_payment_open" ? "confirmed" : "pending"}`}
        >
          {status === "awaiting_admin"
            ? "Submitted for review"
            : status === "approved_payment_open"
              ? "Registration approved"
              : status === "changes_requested"
                ? "Changes requested"
                : "Ready to review"}
        </span>
      </div>
      {status === "awaiting_admin" && (
        <div className="review-status-banner success">
          <strong>Submitted for Registration Review</strong>
          <span>
            Your Team Confirmation is waiting for PCF BATTLE to review. Payment
            is still locked.
          </span>
          <Confirm
            title="Withdraw this confirmation?"
            text="The confirmation will return to Information incomplete. You can then add the missing information and submit it again."
            onConfirm={withdraw}
          >
            <button className="btn" disabled={busy} type="button">
              Withdraw & edit information
            </button>
          </Confirm>
        </div>
      )}
      {status === "approved_payment_open" && (
        <div className="review-status-banner success">
          <strong>Registration approved</strong>
          <span>
            Your approved total is {fmtMoney(pricing.total)}. The payment page
            shows when the deposit request is ready.
          </span>
        </div>
      )}
      {status === "changes_requested" && (
        <div className="review-status-banner warning">
          <strong>Changes requested</strong>
          <span>
            {team.review_message ||
              "Please check your information and submit the review again."}
          </span>
        </div>
      )}
      <div className="review-layout">
        <main className="review-sections">
          <section className="review-card">
            <div className="review-card-heading">
              <div>
                <span className="review-number">1</span>
                <div>
                  <h3>Team information</h3>
                  <small>Used for communication and billing</small>
                </div>
              </div>
              <a href="#team-info">Edit</a>
            </div>
            <div className="review-detail-grid">
              <span>
                <small>Team</small>
                <b>{team.name || "Not provided"}</b>
              </span>
              <span>
                <small>Contact</small>
                <b>{team.contact_person || "Not provided"}</b>
              </span>
              <span>
                <small>Phone</small>
                <b>{team.phone || "Not provided"}</b>
              </span>
              <span>
                <small>Billing address</small>
                <b>{team.address || "Not provided"}</b>
              </span>
            </div>
          </section>
          <section className="review-card">
            <div className="review-card-heading">
              <div>
                <span className="review-number">2</span>
                <div>
                  <h3>Delegation</h3>
                  <small>
                    {data.members?.length || 0} payable members ·{" "}
                    {data.members?.filter(
                      (m: Row) => m.member_type === "PLAYER",
                    ).length || 0}{" "}
                    players
                  </small>
                </div>
              </div>
              <a href="#delegation">Edit</a>
            </div>
            <div className="review-member-list">
              {(data.members || []).map((member: Row) => (
                <div key={member.id}>
                  <span className="member-avatar">
                    {member.name
                      .split(" ")
                      .map((x: string) => x[0])
                      .join("")
                      .slice(0, 2)}
                  </span>
                  <span>
                    <b>{member.name}</b>
                    <small>
                      {member.member_type === "PLAYER"
                        ? `Player · #${member.number || "—"} · ${member.player_role || "Missing role"} · ${member.classification_points ?? "Missing classification"} points`
                        : member.staff_role || member.member_type}
                    </small>
                  </span>
                </div>
              ))}
            </div>
          </section>
          <section className="review-card">
            <div className="review-card-heading">
              <div>
                <span className="review-number">3</span>
                <div>
                  <h3>Rooms & supplements</h3>
                  <small>Every delegation member must have a room</small>
                </div>
              </div>
              <a href="#rooms">Edit</a>
            </div>
            <div className="review-room-list">
              {(data.rooms || []).map((room: Row) => (
                <div key={room.id}>
                  <span>
                    <b>Room {room.number}</b>
                    <small>
                      {room.members.length} / {room.capacity} occupants
                    </small>
                  </span>
                  <span>
                    {room.members
                      .map((member: Row) => member.name)
                      .join(", ") || "Empty"}
                    {room.members.length === 1 && (
                      <small className="supplement">
                        Single-room supplement ·{" "}
                        {fmtMoney(pricing.singleSupplement)}
                      </small>
                    )}
                  </span>
                </div>
              ))}
            </div>
            {data.unassigned?.length > 0 && (
              <div className="review-inline-warning">
                ⚠ {data.unassigned.length} member(s) have no room assignment.
              </div>
            )}
          </section>
          <section className="review-card">
            <div className="review-card-heading">
              <div>
                <span className="review-number">4</span>
                <div>
                  <h3>Billing information</h3>
                  <small>Used on the invoice</small>
                </div>
              </div>
              <a href="#team-info">Edit</a>
            </div>
            <div className="review-detail-grid">
              <span>
                <small>Organization</small>
                <b>{team.name || "Not provided"}</b>
              </span>
              <span>
                <small>Billing contact</small>
                <b>{team.contact_person || "Not provided"}</b>
              </span>
              <span className="wide">
                <small>Address</small>
                <b>{team.address || "Not provided"}</b>
              </span>
            </div>
          </section>
        </main>
        <aside className="review-cost-card">
          <div className="review-cost-heading">
            <span className="eyebrow">Your calculation</span>
            <h3>Cost summary</h3>
          </div>
          <div className="cost-line">
            <span>
              {data.members?.length || 0} × {fmtMoney(pricing.unitPrice)}{" "}
              participation
            </span>
            <b>{fmtMoney(pricing.participantSubtotal)}</b>
          </div>
          <div className="cost-line">
            <span>
              {pricing.singleRoomCount || 0} ×{" "}
              {fmtMoney(pricing.singleSupplement)} single-room supplement
            </span>
            <b>{fmtMoney(pricing.accommodationSupplement)}</b>
          </div>
          <div className="cost-total">
            <span>Total participation cost</span>
            <strong>{fmtMoney(pricing.total)}</strong>
          </div>
          <div className="cost-schedule">
            <span>
              <small>Deposit · {pricing.depositPercentage || 30}%</small>
              <b>{fmtMoney(pricing.deposit)}</b>
            </span>
            <span>
              <small>
                Remaining · {100 - (pricing.depositPercentage || 30)}%
              </small>
              <b>{fmtMoney(pricing.balance)}</b>
            </span>
          </div>
          <small className="cost-note">
            Payment becomes available only after Admin approves this review.
          </small>
        </aside>
      </div>
      {blocked && (
        <div className="review-status-banner warning">
          <strong>Action required</strong>
          <div>
            {data.issues.map((issue: string) => (
              <span key={issue}>• {issue}</span>
            ))}
          </div>
        </div>
      )}
      {status !== "approved_payment_open" && status !== "awaiting_admin" && (
        <div className="review-submit panel">
          <label>
            <input
              type="checkbox"
              checked={checked}
              onChange={(event) => setChecked(event.target.checked)}
            />
            <span>
              <b>I confirm that everything is correct</b>
              <small>
                I reviewed the delegation, rooms, billing information and
                calculated costs.
              </small>
            </span>
          </label>
          <Confirm
            title="Submit Team Confirmation?"
            text="Your Team Confirmation will be sent to Registration Review. Payment will remain unavailable until PCF BATTLE approves the confirmed information."
            onConfirm={submit}
          >
            <button
              className="btn primary"
              disabled={!checked || blocked || busy}
            >
              {busy ? "Submitting…" : "Confirm Team Information"}
            </button>
          </Confirm>
        </div>
      )}
    </section>
  );
}

function Dashboard({ refresh }: { refresh: number }) {
  const stats = useData<Row>("/stats", refresh),
    audit = useData("/audit", refresh),
    matches = useData("/matches", refresh, true),
    teams = useData("/teams", refresh),
    payments = useData("/payments", refresh);
  const s = (stats as any).data;
  const paymentTotal = payments.data.reduce(
      (a, p) => a + Number(p.amount || 0),
      0,
    ),
    outstanding = payments.data
      .filter((p) => p.status !== "paid")
      .reduce((a, p) => a + Number(p.amount || 0), 0);
  const live = matches.data.find((m) => m.status === "live");
  return (
    <>
      <div className="cards">
        {[
          ["Teams", s.teams ?? "—", "registered", Users],
          ["Matches", s.matches ?? "—", "scheduled and played", Swords],
          ["Members", s.delegation_members ?? "—", "delegation", Shield],
          ["Goals", s.goals ?? "—", "finished matches", Trophy],
          ["Rooms", s.rooms ?? "—", "available", Hotel],
          [
            "Outstanding",
            fmtMoney(outstanding),
            `of ${fmtMoney(paymentTotal)}`,
            CircleDollarSign,
          ],
        ].map(([l, v, sub, Icon]: any) => (
          <article key={l}>
            <span>
              <Icon />
            </span>
            <div>
              <small>{l}</small>
              <b>{v}</b>
              <em>{sub}</em>
            </div>
          </article>
        ))}
      </div>
      <div className="dashgrid">
        <section className="panel">
          <div className="panelhead">
            <h3>Live match</h3>
          </div>
          {live ? (
            <MatchCard
              match={live}
              teams={teams.data}
              editable
              onChanged={matches.load}
            />
          ) : (
            <Empty text="No match is live" />
          )}
        </section>
        <section className="panel">
          <div className="panelhead">
            <div>
              <h3>Recent activity</h3>
              <small>Latest changes across the tournament</small>
            </div>
          </div>
          {audit.data.slice(0, 6).map((a) => (
            <div className="activity" key={a.id}>
              <i />
              <span>
                {a.action.replaceAll("_", " ")} · {a.entity_type}
                <small>
                  {a.actor_name} · {fmtDate(a.created_at)}
                </small>
              </span>
            </div>
          ))}
          {!audit.data.length && <Empty text="No activity recorded yet" />}
        </section>
      </div>
      <section className="panel dashboard-next">
        <div className="panelhead">
          <div>
            <h3>Next matches</h3>
            <small>Keep the next three fixtures close at hand</small>
          </div>
        </div>
        {matches.data
          .filter((m: Row) => m.status !== "finished")
          .sort(sortMatches)
          .slice(0, 3)
          .map((m: Row) => (
            <div className="next-match" key={m.id}>
              <span>
                <b>{m.start_time || "TBD"}</b>
                <small>
                  {m.match_date ? `${fmtDate(m.match_date)} · ` : ""}
                  {m.court || "Court TBD"}
                </small>
              </span>
              <strong>
                {teamName(teams.data, m.home_team_id)} <i>vs</i>{" "}
                {teamName(teams.data, m.away_team_id)}
              </strong>
              <Badge>{m.status}</Badge>
            </div>
          ))}
        {!matches.data.filter((m: Row) => m.status !== "finished").length && (
          <Empty text="No upcoming matches" />
        )}
      </section>
    </>
  );
}

function OperationsHub({
  refresh,
  onOpenGameControl,
}: {
  refresh: number;
  onOpenGameControl: () => void;
}) {
  const matches = useData("/matches", refresh, true),
    teams = useData("/teams", refresh),
    members = useData("/delegation", refresh),
    rooms = useData("/rooms", refresh),
    payments = useData("/payments", refresh),
    audit = useData("/audit", refresh),
    checks = useData<HealthCheck>("/tournament-checks", refresh),
    [focusMode, setFocusMode] = useState(false),
    live = matches.data.find((m: Row) => m.status === "live"),
    scheduled = [...matches.data]
      .filter((m: Row) => m.status !== "finished")
      .sort(sortMatches),
    teamChecks = teams.data.map((team: Row) => {
      const delegation = members.data.filter((m: Row) => m.team_id === team.id),
        players = delegation.filter((m: Row) => m.role === "PLAYER"),
        assignedRooms = rooms.data.filter((r: Row) => r.team_id === team.id),
        invoice = payments.data.filter((p: Row) => p.team_id === team.id),
        missing = [
          !team.logo && "logo",
          !team.team_photo && "team photo",
          !team.contact_person && "contact",
          players.length === 0 && "players",
          delegation.length === 0 && "delegation",
          assignedRooms.length === 0 && "rooms",
          invoice.length === 0 && "payment record",
          delegation.some((member: Row) => !member.privacy_consent) &&
            "privacy consent",
          delegation.some(
            (member: Row) =>
              member.member_type === "PLAYER" &&
              (!member.player_role ||
                member.classification_points === null ||
                member.classification_points === undefined ||
                Number(member.classification_points) < 0),
          ) && "player role/classification",
        ].filter(Boolean);
      return { team, delegation, players, assignedRooms, invoice, missing };
    }),
    alerts = [
      ...(checks.data?.issues || []),
      ...teamChecks
        .filter((x: any) => x.missing.length)
        .map((x: any) => `${x.team.name}: ${x.missing.join(", ")}`),
      ...matches.data
        .filter((m: Row) => (m.referee_ids || []).length !== 2)
        .map((m: Row) => `${m.start_time || "TBD"}: match needs two referees`),
      ...payments.data
        .filter((p: Row) => p.status === "overdue")
        .map((p: Row) => `${p.team_name || "Team"}: payment overdue`),
    ],
    due = payments.data
      .filter((p: Row) => p.status !== "paid")
      .reduce((sum: number, p: Row) => sum + Number(p.amount || 0), 0);
  useEffect(() => {
    try {
      setFocusMode(
        window.localStorage.getItem("pcf-tournament-day-mode") === "1",
      );
    } catch {
      /* local preferences are optional */
    }
  }, []);
  function toggleFocusMode() {
    setFocusMode((value) => {
      const next = !value;
      try {
        window.localStorage.setItem(
          "pcf-tournament-day-mode",
          next ? "1" : "0",
        );
      } catch {
        /* ignore storage failures */
      }
      return next;
    });
  }
  async function downloadBackup() {
    try {
      const backup = await api("/admin/backup"),
        url = URL.createObjectURL(
          new Blob([JSON.stringify(backup, null, 2)], {
            type: "application/json",
          }),
        ),
        link = document.createElement("a");
      link.href = url;
      link.download = `pcf-battle-backup-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(url);
      toast.success("Backup downloaded");
    } catch (error: unknown) {
      toast.error(errorMessage(error));
    }
  }
  return (
    <div className={`operations-hub ${focusMode ? "focus-mode" : ""}`}>
      <div className="operations-toolbar">
        <button className="btn" onClick={downloadBackup}>
          <Download /> Download backup
        </button>
        <button
          className="btn primary"
          aria-pressed={focusMode}
          onClick={toggleFocusMode}
        >
          {focusMode ? "Exit tournament-day mode" : "Tournament-day mode"}
        </button>
      </div>
      <div className="operations-summary">
        <article>
          <small>Live now</small>
          <b>
            {live
              ? `${teamName(teams.data, live.home_team_id)} vs ${teamName(teams.data, live.away_team_id)}`
              : "No live match"}
          </b>
        </article>
        <article>
          <small>Open actions</small>
          <b>{alerts.length}</b>
        </article>
        <article>
          <small>Outstanding</small>
          <b>{fmtMoney(due)}</b>
        </article>
        <article>
          <small>Teams ready</small>
          <b>
            {teamChecks.filter((x: any) => !x.missing.length).length}/
            {teams.data.length}
          </b>
        </article>
      </div>
      <section
        className={`panel operations-control ${live ? "has-live-match" : "no-live-match"}`}
      >
        <div className="panelhead">
          <div>
            <h3>Tournament-day match control</h3>
            <small>Control the active match from one focused workspace</small>
          </div>
          {checks.data?.issues && (
            <Badge>
              {checks.data.ready
                ? "Ready"
                : `${checks.data.issues.length} checks`}
            </Badge>
          )}
        </div>
        {live ? (
          <MatchCard
            match={live}
            teams={teams.data}
            editable
            onChanged={matches.load}
          />
        ) : (
          <div className="empty-state">
            <p>Open Game control to start and operate the active match.</p>
            <button className="btn primary" onClick={onOpenGameControl}>
              Open Game control
            </button>
          </div>
        )}
      </section>
      <div className="operations-columns">
        <section className="panel">
          <div className="panelhead">
            <div>
              <h3>Day timeline</h3>
              <small>Upcoming matches ordered by start time</small>
            </div>
          </div>
          <div className="court-timeline">
            {scheduled.map((m: Row) => (
              <article key={m.id} className={m.status === "live" ? "live" : ""}>
                <time>{m.start_time || "TBD"}</time>
                <span>
                  <b>
                    {teamName(teams.data, m.home_team_id)} —{" "}
                    {teamName(teams.data, m.away_team_id)}
                  </b>
                  <small>
                    {m.match_date ? `${fmtDate(m.match_date)} · ` : ""}
                    {m.court} · Group {m.group_id} · {m.status}
                  </small>
                </span>
              </article>
            ))}
            {!scheduled.length && <Empty text="No upcoming matches" />}
          </div>
        </section>
        <section className="panel">
          <div className="panelhead">
            <div>
              <h3>Action centre</h3>
              <small>Items requiring organization attention</small>
            </div>
            <Badge>{alerts.length}</Badge>
          </div>
          <div className="operations-alerts">
            {alerts.slice(0, 12).map((message: string) => (
              <p key={message}>
                <i />
                {message}
              </p>
            ))}
            {!alerts.length && <Empty text="Everything required is complete" />}
          </div>
        </section>
      </div>
      <section className="panel">
        <div className="panelhead">
          <div>
            <h3>Team readiness</h3>
            <small>
              Registration, selection, accommodation and finance in one view
            </small>
          </div>
        </div>
        <div className="readiness-grid">
          {teamChecks.map((item: any) => {
            const complete = 8 - item.missing.length;
            return (
              <article key={item.team.id}>
                <TeamMark team={item.team} />
                <span>
                  <b>{item.team.name}</b>
                  <small>
                    {item.players.length} players · {item.delegation.length}{" "}
                    members · {item.assignedRooms.length} rooms
                  </small>
                  <em>
                    {item.missing.length
                      ? `Missing: ${item.missing.join(", ")}`
                      : "Ready"}
                  </em>
                </span>
                <strong>
                  {Math.max(0, Math.round((complete / 8) * 100))}%
                </strong>
              </article>
            );
          })}
        </div>
      </section>
      <section className="panel">
        <div className="panelhead">
          <div>
            <h3>Recent audit trail</h3>
            <small>Latest changes for recovery and accountability</small>
          </div>
        </div>
        {audit.data.slice(0, 12).map((entry: Row) => (
          <div className="activity" key={entry.id}>
            <i />
            <span>
              {entry.action.replaceAll("_", " ")} · {entry.entity_type}
              <small>
                {entry.actor_name} · {fmtDate(entry.created_at)}
              </small>
            </span>
          </div>
        ))}
      </section>
    </div>
  );
}

function Tournament({ refresh }: { refresh: number }) {
  const standings = useData("/standings", refresh),
    groups = useData("/groups", refresh),
    brackets = useData("/brackets", refresh),
    matches = useData("/matches", refresh, true),
    [scheduleBusy, setScheduleBusy] = useState(false),
    [scheduleDates, setScheduleDates] = useState<string[]>([]),
    [scheduleDateInput, setScheduleDateInput] = useState(""),
    [gameMinutes, setGameMinutes] = useState("40"),
    [pauseMinutes, setPauseMinutes] = useState("10"),
    [scheduleStart, setScheduleStart] = useState("09:00"),
    [scheduleEnd, setScheduleEnd] = useState("18:00");
  const autoBracketStarted = useRef(false);
  useEffect(() => {
    const groupMatches = matches.data.filter((match: Row) =>
      ["A", "B", "group-A", "group-B"].includes(String(match.group_id)),
    );
    if (
      autoBracketStarted.current ||
      groupMatches.length < 12 ||
      !groupMatches.every(
        (match: Row) => match.status === "finished" && match.confirmed,
      )
    )
      return;
    if (brackets.data[0]?.ready) return;
    autoBracketStarted.current = true;
    api("/knockout/generate", {
      method: "POST",
      body: JSON.stringify({ mode: "groups" }),
    })
      .then(() => brackets.load())
      .catch(() => {
        autoBracketStarted.current = false;
      });
  }, [matches.data, brackets.data]);
  // Match creation, group assignment, scheduling and brackets live in Matches.
  // Keep Tournament focused on public tournament configuration and standings.
  return (
    <Tabs className="tournament-tabs" defaultValue="standings">
      <TabsList>
        <TabsTrigger value="standings">Standings</TabsTrigger>
      </TabsList>
      <TabsContent value="standings">
        <StandingsTable rows={standings.data} />
      </TabsContent>
    </Tabs>
  );
  async function generateSchedule() {
    setScheduleBusy(true);
    try {
      const result = await api("/groups/generate-schedule", {
        method: "POST",
        body: JSON.stringify({
          dates: scheduleDates,
          game_minutes: Number(gameMinutes),
          pause_minutes: Number(pauseMinutes),
          start_time: scheduleStart,
          end_time: scheduleEnd,
        }),
      });
      toast.success(`${result.created || 0} group matches generated`);
    } catch (e: unknown) {
      toast.error(errorMessage(e));
    } finally {
      setScheduleBusy(false);
    }
  }
  async function generate() {
    try {
      await api("/knockout/generate", {
        method: "POST",
        body: JSON.stringify({ mode: "groups" }),
      });
      toast.success("Championship and consolation brackets generated");
      brackets.load();
    } catch (e: unknown) {
      toast.error(errorMessage(e));
    }
  }
  return (
    <Tabs className="tournament-tabs" defaultValue="standings">
      <TabsList>
        <TabsTrigger value="standings">Standings</TabsTrigger>
        <TabsTrigger value="groups">Groups</TabsTrigger>
      </TabsList>
      <TabsContent value="standings">
        <StandingsTable rows={standings.data} />
      </TabsContent>
      <TabsContent value="groups">
        <GroupBuilder refresh={refresh} />
        <section className="panel schedule-generator">
          <div className="panelhead">
            <div>
              <h3>Automatic group schedule</h3>
              <small>
                Creates missing round-robin matches and spaces rounds for team
                rest.
              </small>
            </div>
            <button
              className="btn primary"
              onClick={generateSchedule}
              disabled={scheduleBusy}
            >
              {scheduleBusy ? "Generating…" : "Generate schedule"}
            </button>
          </div>
          <div className="schedule-options">
            <label>
              <span>Dates</span>
              <input
                type="date"
                value={scheduleDateInput}
                onClick={(event) => {
                  event.currentTarget.showPicker?.();
                }}
                onChange={(event) => {
                  const value = event.target.value;
                  setScheduleDateInput(value);
                  if (value && !scheduleDates.includes(value))
                    setScheduleDates((dates) => [...dates, value].sort());
                }}
              />
              <div className="selected-dates">
                {scheduleDates.map((date) => (
                  <button
                    type="button"
                    key={date}
                    onClick={() =>
                      setScheduleDates((dates) =>
                        dates.filter((item) => item !== date),
                      )
                    }
                  >
                    {fmtDate(date)} ×
                  </button>
                ))}
              </div>
              <small>Add each tournament date with the calendar.</small>
            </label>
            <label>
              <span>Game length</span>
              <input
                type="number"
                min="1"
                value={gameMinutes}
                onChange={(event) => setGameMinutes(event.target.value)}
              />
              <small>Minutes per match</small>
            </label>
            <label>
              <span>Pause / break</span>
              <input
                type="number"
                min="0"
                value={pauseMinutes}
                onChange={(event) => setPauseMinutes(event.target.value)}
              />
              <small>Minutes between starts</small>
            </label>
            <label>
              <span>Playing window</span>
              <div className="schedule-time-range">
                <input
                  type="time"
                  value={scheduleStart}
                  onChange={(event) => setScheduleStart(event.target.value)}
                />
                <input
                  type="time"
                  value={scheduleEnd}
                  onChange={(event) => setScheduleEnd(event.target.value)}
                />
              </div>
              <small>Start and end time</small>
            </label>
          </div>
        </section>
        <div className="dashgrid">
          {groups.data.map((g) => (
            <section className="panel" key={g.id}>
              <div className="panelhead">
                <div>
                  <h3>Group {g.name}</h3>
                  <small>
                    {(g.team_ids || []).length} teams · round-robin format
                  </small>
                </div>
              </div>
              {(g.team_ids || []).map((id: string, i: number) => (
                <div className="grouprow" key={id}>
                  <b>{i + 1}</b>
                  <span>{id}</span>
                </div>
              ))}
            </section>
          ))}
        </div>
      </TabsContent>
    </Tabs>
  );
}
function TournamentManager({ refresh }: { refresh: number }) {
  const tournaments = useData("/tournaments", refresh),
    checks = useData<HealthCheck>("/tournament-checks", refresh),
    active = tournaments.data.find((t: Row) => t.active) || tournaments.data[0],
    [busy, setBusy] = useState(false),
    [creatingEdition, setCreatingEdition] = useState(false);
  async function activateEdition(id: string) {
    try {
      await api(`/tournaments/${id}/activate`, { method: "POST" });
      toast.success("Public tournament edition changed");
      tournaments.load();
    } catch (error: unknown) {
      toast.error(errorMessage(error));
    }
  }
  async function deleteEdition(id: string, password?: string) {
    try {
      await api(`/tournaments/${id}`, {
        method: "DELETE",
        body: JSON.stringify({ password }),
      });
      toast.success("Tournament edition deleted");
      tournaments.load();
    } catch (error: unknown) {
      toast.error(errorMessage(error));
      throw error;
    }
  }
  async function createEdition(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = Object.fromEntries(new FormData(event.currentTarget));
    try {
      const created = await api("/tournaments", {
        method: "POST",
        body: JSON.stringify({
          ...body,
          active: 0,
          registration_mode: 1,
          registration_enabled: 0,
        }),
      });
      await api(`/tournaments/${created.id}/activate`, { method: "POST" });
      toast.success("New tournament edition created");
      setCreatingEdition(false);
      tournaments.load();
    } catch (error: unknown) {
      toast.error(errorMessage(error));
    }
  }
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!active) return;
    setBusy(true);
    const body: any = Object.fromEntries(new FormData(e.currentTarget));
    body.active = 1;
    for (const key of [
      "registration_mode",
      "registration_enabled",
      "live_enabled",
      "show_tournament",
      "show_referees",
      "emergency_enabled",
      "show_livestream",
      "show_about",
      "show_teams",
      "show_matches",
      "show_brackets",
      "show_statistics",
      "show_gallery",
    ])
      body[key] = Number(body[key]);
    try {
      await api(`/tournaments/${active.id}`, {
        method: "PUT",
        body: JSON.stringify(body),
      });
      toast.success("Tournament website details updated");
      tournaments.load();
    } catch (err: unknown) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <section className="panel edition-manager">
        <div className="panelhead">
          <div>
            <h3>Tournament editions</h3>
            <small>Select the public edition or prepare a new one</small>
          </div>
          <button
            className="btn primary"
            onClick={() => setCreatingEdition(true)}
          >
            <Plus /> New edition
          </button>
        </div>
        <div className="edition-list" role="list">
          {tournaments.data.map((edition: Row) => (
            <div
              key={edition.id}
              className={`edition-row${edition.active ? " active" : ""}`}
              role="listitem"
            >
              <div className="edition-row-copy">
                <b>{String(edition.name).replace(/^PCH\b/i, "PCF")}</b>
                <small>
                  {edition.start_date || "Dates not set"} ·{" "}
                  {edition.city || "Location not set"}
                </small>
              </div>
              {edition.active ? (
                <Badge>Public</Badge>
              ) : (
                <div className="row-actions">
                  <button
                    type="button"
                    className="edition-row-action"
                    onClick={() => activateEdition(edition.id)}
                  >
                    Make public
                  </button>
                  <Confirm
                    title="Delete tournament edition?"
                    text={`This permanently deletes ${edition.name}'s matches, schedule, groups and registrations. Admin accounts are preserved.`}
                    passwordInput
                    onConfirm={(password) => deleteEdition(edition.id, password)}
                  >
                    <button type="button" className="danger-link">
                      Delete
                    </button>
                  </Confirm>
                </div>
              )}
            </div>
          ))}
        </div>
      </section>
      <section className="panel">
        <div className="panelhead">
          <div>
            <h3>Tournament Health Check</h3>
            <small>Resolve these checks before publishing the schedule.</small>
          </div>
          <Badge>
            {checks.data?.ready
              ? "Ready to publish"
              : `${(checks.data?.issues || []).length} issues`}
          </Badge>
        </div>
        {checks.loading ? (
          <p className="muted">Checking tournament data…</p>
        ) : checks.error ? (
          <div className="inline-error">
            <span>{checks.error}</span>
            <button className="btn" onClick={() => checks.load()}>
              Retry
            </button>
          </div>
        ) : checks.data?.ready ? (
          <p className="success-text">
            ✓ Teams, schedule, conflicts, bracket and assignments passed.
          </p>
        ) : (
          <ul className="health-check-list">
            {(checks.data?.issues || ["No active tournament edition"]).map(
              (issue: string) => (
                <li key={issue}>⚠ {issue}</li>
              ),
            )}
          </ul>
        )}
      </section>
      <section className="panel">
        <div className="panelhead">
          <div>
            <h3>Tournament website</h3>
            <small>
              Control public visibility, visitor information and the tournament
              assistant
            </small>
          </div>
        </div>
        {active ? (
          <>
            <SetupReadiness tournament={active} />
            <form className="portal-form tournament-details" onSubmit={save}>
              <h3 className="form-section-title first">Edition details</h3>
              <Field
                label="Tournament name"
                name="name"
                defaultValue={active.name}
                required
              />
              <Field
                label="Start date"
                name="start_date"
                type="date"
                defaultValue={active.start_date}
                required
              />
              <Field
                label="End date"
                name="end_date"
                type="date"
                defaultValue={active.end_date}
                required
              />
              <Field
                label="City"
                name="city"
                defaultValue={active.city}
                required
              />
              <Field
                label="Country"
                name="country"
                defaultValue={active.country}
                required
              />
              <h3 className="form-section-title">Publication mode</h3>
              <Field
                label="Website mode"
                name="registration_mode"
                children={
                  <select
                    name="registration_mode"
                    defaultValue={active.registration_mode || 0}
                  >
                    <option value="0">Tournament published</option>
                    <option value="1">Registration phase</option>
                  </select>
                }
              />
              <Field
                label="Registrations"
                name="registration_enabled"
                children={
                  <select
                    name="registration_enabled"
                    defaultValue={active.registration_enabled ?? 1}
                  >
                    <option value="1">Open</option>
                    <option value="0">Closed</option>
                  </select>
                }
              />
              <Field
                label="Registration message"
                name="public_message"
                defaultValue={
                  active.public_message ||
                  "Team registration is currently open. Tournament details will be published soon."
                }
              />
              <h3 className="form-section-title">
                Homepage and public sections
              </h3>
              {[
                ["live_enabled", "Live functionality"],
                ["show_tournament", "Tournament page"],
                ["show_referees", "Tournament referees"],
                ["emergency_enabled", "Emergency banner"],
                ["show_about", "Practical information"],
                ["show_teams", "Participating teams"],
                ["show_matches", "Matches and schedule"],
                ["show_brackets", "Brackets"],
                ["show_statistics", "Statistics"],
                ["show_gallery", "Media"],
                ["show_livestream", "Livestream"],
              ].map(([name, label]) => (
                <VisibilityField
                  key={`${active.id}-${name}`}
                  label={label}
                  name={name}
                  defaultValue={active[name] ?? 1}
                />
              ))}
              <Field
                label="Emergency message"
                name="emergency_message"
                defaultValue={active.emergency_message || ""}
                placeholder="Important tournament update for visitors"
              />
              <label className="portal-field wide">
                <span>Google Drive Media URL</span>
                <input
                  name="gallery_url"
                  type="url"
                  defaultValue={active.gallery_url || ""}
                  placeholder="https://drive.google.com/drive/folders/…"
                />
                <small>
                  Paste the deployed Google Apps Script URL for a native photo
                  media gallery, or a publicly shared Google Drive folder link.
                  Turn on the Media switch above to show it in the public menu.
                </small>
              </label>
              <Field
                label="Instagram profile URL"
                name="instagram_url"
                type="url"
                defaultValue={active.instagram_url || ""}
                placeholder="https://www.instagram.com/yourprofile/"
              />
              <Field
                label="YouTube livestream URL"
                name="livestream_url"
                type="url"
                defaultValue={active.livestream_url || ""}
                placeholder="https://www.youtube.com/watch?v=…"
              />
              <h3 className="form-section-title">Practical page</h3>
              <Field
                label="Opening hours / daily schedule"
                name="opening_hours"
                defaultValue={active.opening_hours}
              />
              <Field
                label="Hotel name"
                name="hotel_name"
                defaultValue={active.hotel_name}
              />
              <Field
                label="Hotel address"
                name="hotel_address"
                defaultValue={active.hotel_address}
              />
              <h3 className="form-section-title">
                Participation and accommodation pricing
              </h3>
              <Field
                label="Base tournament price per person"
                name="fixed_tournament_costs"
                type="number"
                defaultValue={active.fixed_tournament_costs || 0}
              />
              <Field
                label="Single room supplement per person"
                name="single_room_supplement"
                type="number"
                defaultValue={active.single_room_supplement || 0}
              />
              <p className="form-help wide">
                All rooms use the same central price. The total is calculated
                as: number of delegation members × base price, plus the
                supplement when a room has only one assigned person.
              </p>
              <Field
                label="Sports hall / venue"
                name="venue_name"
                defaultValue={active.venue_name}
              />
              <Field
                label="Venue address"
                name="venue_address"
                defaultValue={active.venue_address}
              />
              {[
                ["parking_info", "Parking information"],
                ["accessibility_info", "Accessibility information"],
                ["catering_info", "Catering information"],
                ["format_rules", "Tournament format and match rules"],
                ["pcf_battle_info", "What is Powerchair Floorball Battle?"],
                ["award_info", "Award ceremony information"],
                ["visitor_info", "Other visitor and delegation information"],
                ["chatbot_knowledge", "Tournament assistant knowledge / FAQs"],
              ].map(([name, label]) => (
                <label className="portal-field wide" key={name}>
                  <span>{label}</span>
                  <textarea
                    name={name}
                    rows={4}
                    defaultValue={active[name] || ""}
                  />
                </label>
              ))}
              <div className="form-actions">
                <button className="btn primary" disabled={busy}>
                  {busy ? "Saving…" : "Save website settings"}
                </button>
              </div>
            </form>
          </>
        ) : (
          <Empty text="No active tournament" />
        )}
      </section>
      <Modal
        title="Create tournament edition"
        open={creatingEdition}
        onOpenChange={setCreatingEdition}
      >
        <form className="portal-form" onSubmit={createEdition}>
          <Field
            label="Edition name"
            name="name"
            placeholder="PCF Battle 2028"
            required
          />
          <Field label="Start date" name="start_date" type="date" required />
          <Field label="End date" name="end_date" type="date" required />
          <Field label="City" name="city" required />
          <Field label="Country" name="country" required />
          <FormButtons
            busy={false}
            onCancel={() => setCreatingEdition(false)}
          />
        </form>
      </Modal>
    </>
  );
}
function SetupReadiness({ tournament }: { tournament: Row }) {
  const checks = [
      ["Dates", tournament.start_date && tournament.end_date],
      ["Location", tournament.city && tournament.country],
      ["Venue", tournament.venue_name && tournament.venue_address],
      ["Hotel", tournament.hotel_name && tournament.hotel_address],
      [
        "Practical information",
        tournament.opening_hours && tournament.catering_info,
      ],
      ["Instagram", tournament.instagram_url],
    ] as [string, any][],
    complete = checks.filter(([, value]) => value).length,
    percent = Math.round((complete / checks.length) * 100);
  return (
    <aside className="setup-readiness" aria-label="Website setup progress">
      <div>
        <b>Website readiness</b>
        <strong>{percent}%</strong>
      </div>
      <span>
        <i style={{ width: `${percent}%` }} />
      </span>
      {complete < checks.length && (
        <small>
          Still missing:{" "}
          {checks
            .filter(([, value]) => !value)
            .map(([label]) => label)
            .join(", ")}
        </small>
      )}
    </aside>
  );
}
function PreRegistrations({ refresh }: { refresh: number }) {
  const rows = useData("/preregistrations", refresh);
  const [busy, setBusy] = useState<string | null>(null);
  const [decisions, setDecisions] = useState<Record<string, "selected" | "rejected">>({});
  async function selectTeam(row: Row) {
    if (row.selection_email_sent_at) return;
    setBusy(row.id);
    try {
      const result = await api(`/preregistrations/${row.id}/select`, {
        method: "POST",
      });
      toast.success(
        result.emailSent
          ? `Selection email sent to ${row.club_name}`
          : "Selection recorded",
      );
      setDecisions((current) => ({ ...current, [row.id]: "selected" }));
      rows.load();
    } catch (error: unknown) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(null);
    }
  }
  async function notifyNotSelected(row: Row) {
    setBusy(row.id);
    try {
      const result = await api(`/preregistrations/${row.id}/waiting-list`, {
        method: "POST",
      });
      toast.success(
        result.emailSent
          ? `Non-selection email sent to ${row.club_name}`
          : "Email recorded",
      );
      setDecisions((current) => ({ ...current, [row.id]: "rejected" }));
      rows.load();
    } catch (error: unknown) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(null);
    }
  }
  return (
    <section className="panel teams-registrations-panel">
      <div className="panelhead">
        <div>
          <h3>Registered teams</h3>
          <small>
            {rows.data.length} teams currently on the registration list
          </small>
        </div>
      </div>
      {rows.data.length ? (
        <div className="portal-table">
          {rows.data.map((r: Row) => {
            const decision = decisions[r.id] || (r.selected || r.selection_email_sent_at ? "selected" : r.waiting_list ? "rejected" : "");
            return (
            <div
              className={`registration-card-v2${decision === "selected" ? " selection-approved" : decision === "rejected" ? " selection-rejected" : ""}`}
              style={decision === "selected" ? { background: "#183b29", color: "#8be0ae", borderColor: "#2f9b68" } : decision === "rejected" ? { background: "#4a1f26", color: "#ffb4b4", borderColor: "#d85c6a" } : undefined}
              key={r.id}
            >
              <TeamMark team={r} />
              <span>
                <b>{r.club_name}</b>
                <small>
                  {r.email} · Registered {fmtDate(r.created_at)}
                </small>
              </span>
              <div className="registration-statuses">
                <span className="status-chip">
                  {r.registration_confirmation_sent_at
                    ? "Confirmation sent"
                    : "Confirmation pending"}
                </span>
                <span className="status-chip">
                  {r.selection_email_sent_at
                    ? "Selection sent"
                    : "Selection pending"}
                </span>
                <span className="status-chip">
                  {r.portal_invitation_sent_at
                    ? "Portal invite sent"
                    : "Portal invite pending"}
                </span>
              </div>
              <div className="registration-actions">
              {r.selection_email_sent_at ? (
                <button
                  className="btn primary small registration-action"
                  disabled
                >
                  Selected · email sent
                </button>
              ) : (
                <>
                  <Confirm
                    title="Send selection email"
                    text={`Send the selection email to ${r.club_name}?`}
                    onConfirm={() => selectTeam(r)}
                  >
                    <button
                      className="btn primary small registration-action"
                      disabled={busy === r.id}
                    >
                      {busy === r.id ? "Sending…" : "Select team"}
                    </button>
                  </Confirm>
                  <Confirm
                    title="Tell team they were not selected"
                    text={`Send ${r.club_name} an email explaining that they were not selected and offering the waiting list?`}
                    onConfirm={() => notifyNotSelected(r)}
                  >
                    <button
                      className="btn small registration-action"
                      disabled={busy === r.id}
                    >
                      {busy === r.id
                        ? "Sending…"
                        : "Not selected / waiting list"}
                    </button>
                  </Confirm>
                </>
              )}
              <Confirm
                title="Delete registration"
                text={`Delete the registration from ${r.club_name}? This will not delete an existing team.`}
                onConfirm={async () => {
                  try {
                    await api(`/preregistrations/${r.id}`, {
                      method: "DELETE",
                    });
                    toast.success("Registration deleted");
                    rows.load();
                  } catch (error: unknown) {
                    toast.error(errorMessage(error));
                  }
                }}
              >
                <button className="icon-danger registration-delete" type="button" aria-label={`Delete ${r.club_name}`} title="Delete registration">
                  <Trash2 aria-hidden="true" />
                </button>
              </Confirm>
              </div>
            </div>
            );
          })}
        </div>
      ) : (
        <Empty text="No pre-registrations yet" />
      )}
    </section>
  );
}

function SelectedRegistrations({ refresh }: { refresh: number }) {
  const rows = useData("/preregistrations", refresh),
    selected = rows.data.filter(
      (r: Row) => r.selected || r.selection_email_sent_at,
    ),
    [busy, setBusy] = useState<string | null>(null);
  async function invite(row: Row) {
    setBusy(row.id);
    try {
      await api(`/preregistrations/${row.id}/invite`, { method: "POST" });
      toast.success(`Portal invite sent to ${row.club_name}`);
      rows.load();
    } catch (error: unknown) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(null);
    }
  }
  return (
    <section className="panel teams-selected-panel">
      <div className="panelhead">
        <div>
          <h3>Selected teams</h3>
          <small>{selected.length} teams selected for participation</small>
        </div>
        <span className="muted">Ready for portal invitations</span>
      </div>
      {selected.length ? (
        <div className="portal-table">
          {selected.map((r: Row) => (
            <div className="portal-row registration-row selection-approved" key={r.id}>
              <TeamMark team={r} />
              <span>
                <b>{r.club_name}</b>
                <small>{r.email}</small>
              </span>
              <div className="registration-statuses">
                <span className="status-chip">Selected</span>
                <span className="status-chip">
                  {r.portal_invitation_sent_at
                    ? "Portal invite sent"
                    : "Portal invite pending"}
                </span>
              </div>
              {r.portal_invitation_sent_at ? (
                <span className="invite-complete">Invite sent</span>
              ) : (
                <button
                  className="btn primary small"
                  disabled={busy === r.id}
                  onClick={() => invite(r)}
                >
                  {busy === r.id ? "Sending…" : "Create portal invite"}
                </button>
              )}
            </div>
          ))}
        </div>
      ) : (
        <Empty text="No selected teams yet" />
      )}
    </section>
  );
}
function MatchesAdmin({ refresh }: { refresh: number }) {
  const [view, setView] = useState<
    "schedule" | "bracket" | "groups" | "standings"
  >("schedule");
  return (
    <>
      <div className="match-workspace-tabs">
        <button
          className={view === "schedule" ? "active" : ""}
          onClick={() => setView("schedule")}
        >
          Schedule
        </button>
        <button
          className={view === "bracket" ? "active" : ""}
          onClick={() => setView("bracket")}
        >
          Bracket Builder
        </button>
        <button
          className={view === "groups" ? "active" : ""}
          onClick={() => setView("groups")}
        >
          Groups
        </button>
        <button
          className={view === "standings" ? "active" : ""}
          onClick={() => setView("standings")}
        >
          Standings
        </button>
      </div>
      {view === "schedule" ? (
        <ScheduleWorkspace refresh={refresh} />
      ) : view === "bracket" ? (
        <BracketBuilder refresh={refresh} />
      ) : view === "groups" ? (
        <GroupBuilder refresh={refresh} />
      ) : (
        <StandingsAdmin refresh={refresh} />
      )}
    </>
  );
}
function StandingsAdmin({ refresh }: { refresh: number }) {
  const standings = useData("/standings", refresh);
  return (
    <section className="panel">
      <div className="panelhead">
        <div>
          <h3>Standings</h3>
          <small>Calculated from confirmed match results</small>
        </div>
      </div>
      <StandingsTable rows={standings.data} />
    </section>
  );
}

function BracketView({
  data,
  bracketId,
  matches = [],
}: {
  data: any;
  bracketId?: string;
  matches?: Row[];
}) {
  const intermediate = data.consolation || [],
    semifinals = data.championship || [],
    finals = data.finals?.length
      ? data.finals
      : [
          {
            key: "KO:7th",
            title: "7th / 8th place final",
            a: "Loser 5A",
            b: "Loser 5B",
          },
          {
            key: "KO:5th",
            title: "5th / 6th place final",
            a: "Winner 5A",
            b: "Winner 5B",
          },
          {
            key: "KO:3rd",
            title: "3rd / 4th place final",
            a: "Loser SF1",
            b: "Loser SF2",
          },
          {
            key: "KO:final",
            title: "Grand final · 1st / 2nd place",
            a: "Winner SF1",
            b: "Winner SF2",
          },
        ];
  // Breaks are managed exclusively by Matches → Schedule. Keeping a second
  // bracket-local break list caused refreshes to restore stale positions.
  const breaks: any[] = [];
  const setBreaks = (_value: unknown) => {};
  const games = [
    {
      time: "09:00",
      game: intermediate[0],
      label: "Intermediate Round",
      tone: "intermediate",
    },
    {
      time: "10:00",
      game: intermediate[1],
      label: "Intermediate Round",
      tone: "intermediate",
    },
    { time: "11:00", game: semifinals[0], label: "Semifinal", tone: "semi" },
    { time: "12:00", game: semifinals[1], label: "Semifinal", tone: "semi" },
    {
      time: "13:00",
      game: finals.find((g: any) => g.key === "KO:7th"),
      label: "7th & 8th place",
      tone: "place",
    },
    {
      time: "14:00",
      game: finals.find((g: any) => g.key === "KO:5th"),
      label: "5th & 6th place",
      tone: "place",
    },
    {
      time: "15:00",
      game: finals.find((g: any) => g.key === "KO:3rd"),
      label: "3rd & 4th place",
      tone: "place",
    },
    {
      time: "16:30",
      game: finals.find((g: any) => g.key === "KO:final"),
      label: "1st & 2nd place",
      tone: "final",
    },
  ];
  const [order, setOrder] = useState([
    ...games.map((g) => g.game?.key || `slot-${g.time}`),
    ...breaks.map((b) => b.id),
  ]);
  const [dragged, setDragged] = useState<string | null>(null);
  const orderedItems = order
    .map(
      (key) =>
        games.find((g) => (g.game?.key || `slot-${g.time}`) === key) ||
        breaks.find((b) => b.id === key),
    )
    .filter(Boolean) as any[];
  async function move(key: string) {
    const from = order.indexOf(dragged || ""),
      to = order.indexOf(key);
    if (from < 0 || to < 0 || from === to) return;
    const next = [...order],
      [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    setOrder(next);
    setDragged(null);
    try {
      const slots = [
        "09:00",
        "10:00",
        "11:00",
        "12:00",
        "13:00",
        "14:00",
        "15:00",
        "16:30",
      ];
      await Promise.all(
        next.map((gameKey, index) => {
          const match = matches.find((m) => m.group_id === gameKey);
          return match
            ? api(`/matches/${match.id}`, {
                method: "PUT",
                body: JSON.stringify({ start_time: slots[index] }),
              })
            : Promise.resolve();
        }),
      );
      toast.success("Bracket order saved");
    } catch (error: unknown) {
      toast.error(errorMessage(error));
    }
  }
  async function saveBreaks(_next: unknown[]) {
    /* breaks belong to the unified schedule */
  }
  return (
    <div className="visual-brackets admin-bracket-timeline">
      <div className={`bracket-readiness ${data.ready ? "ready" : "waiting"}`}>
        <b>
          {data.ready
            ? "Final group positions assigned"
            : "Waiting for confirmed group results"}
        </b>
        <span>{data.message}</span>
      </div>
      <section className="admin-bracket-list">
        <div className="bracket-board-help">
          Drag knockout matches in Matches → Schedule. Times shown here come
          from the saved match schedule.
        </div>
        {orderedItems.map((item: any, i: number) => {
          const key = item.game?.key || item.id;
          const savedMatch = item.game
            ? matches.find((m) => m.group_id === item.game.key)
            : null;
          const time = savedMatch?.start_time || item.time || "TBD";
          return item.game ? (
            <article key={key}>
              <time>{time}</time>
              <div>
                <strong>
                  {item.game.a || "Empty spot 1"} <i>–</i>{" "}
                  {item.game.b || "Empty spot 2"}
                </strong>
                <small className={item.tone}>{item.label}</small>
              </div>
            </article>
          ) : null;
        })}
      </section>
    </div>
  );
}
function StandingsTable({ rows }: { rows: Row[] }) {
  const groups = ["A", "B"];
  const Table = ({ group }: { group: string }) => (
    <div className="table standings-group-table">
      <h4>Group {group}</h4>
      <table className="standings-table">
        <colgroup>
          <col className="standings-col-rank" />
          <col className="standings-col-team" />
          <col className="standings-col-stat" />
          <col className="standings-col-stat" />
          <col className="standings-col-stat" />
          <col className="standings-col-stat" />
          <col className="standings-col-stat" />
          <col className="standings-col-stat" />
        </colgroup>
        <thead>
          <tr>
            <th>#</th>
            <th>Team</th>
            <th>P</th>
            <th>W</th>
            <th>D</th>
            <th>L</th>
            <th>GD</th>
            <th>Pts</th>
          </tr>
        </thead>
        <tbody>
          {rows
            .filter(
              (t) =>
                String(t.group_id)
                  .replace(/^group-/, "")
                  .toUpperCase() === group,
            )
            .map((t, i) => (
              <tr key={t.id}>
                <td>
                  <b>{i + 1}</b>
                </td>
                <td>
                  <span className="teamcell">
                    <TeamMark team={t} />
                    <b>{t.name}</b>
                  </span>
                </td>
                <td>{t.played}</td>
                <td>{t.won}</td>
                <td>{t.drawn}</td>
                <td>{t.lost}</td>
                <td>
                  {t.goalDifference > 0 ? "+" : ""}
                  {t.goalDifference}
                </td>
                <td>
                  <b className="points">{t.points}</b>
                </td>
              </tr>
            ))}
        </tbody>
      </table>
    </div>
  );
  return (
    <div className="standings-columns">
      {groups.map((group) => (
        <Table key={group} group={group} />
      ))}
    </div>
  );
}

function LegacyMatchesAdmin({
  refresh,
  showWorkspace = true,
}: {
  refresh: number;
  showWorkspace?: boolean;
}) {
  const matches = useData("/matches", refresh, true),
    teams = useData("/teams", refresh),
    refs = useData("/referees", refresh),
    [editing, setEditing] = useState<Row | null | undefined>(undefined),
    [q, setQ] = useState(""),
    [status, setStatus] = useState("all");
  const filtered = matches.data
    .filter(
      (m) =>
        (status === "all" || m.status === status) &&
        `${teamName(teams.data, m.home_team_id)} ${teamName(teams.data, m.away_team_id)} ${m.court}`
          .toLowerCase()
          .includes(q.toLowerCase()),
    )
    .sort((a, b) =>
      a.status === "live" ? -1 : b.status === "live" ? 1 : sortMatches(a, b),
    );
  const scheduleWarnings = useMemo(() => {
    const warnings: string[] = [];
    matches.data.forEach((match: Row, index: number) => {
      matches.data.slice(index + 1).forEach((other: Row) => {
        if (
          !match.start_time ||
          match.start_time !== other.start_time ||
          (match.match_date || "") !== (other.match_date || "")
        )
          return;
        if (match.court && match.court === other.court)
          warnings.push(`${match.start_time}: ${match.court} is double-booked`);
        const teamsA = [match.home_team_id, match.away_team_id];
        if (
          teamsA.some((id) =>
            [other.home_team_id, other.away_team_id].includes(id),
          )
        )
          warnings.push(`${match.start_time}: a team is scheduled twice`);
        if (
          (match.referee_ids || []).some((id: string) =>
            (other.referee_ids || []).includes(id),
          )
        )
          warnings.push(`${match.start_time}: a referee is scheduled twice`);
      });
    });
    return [...new Set(warnings)];
  }, [matches.data]);
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const b: any = Object.fromEntries(new FormData(e.currentTarget));
    b.referee_ids = [b.referee_1, b.referee_2].filter(Boolean);
    delete b.referee_1;
    delete b.referee_2;
    if (!editing?.id) {
      b.home_score = 0;
      b.away_score = 0;
    }
    if (b.referee_ids.length !== 2 || new Set(b.referee_ids).size !== 2)
      return toast.error("Choose two different referees");
    try {
      editing?.id
        ? await api(`/matches/${editing.id}`, {
            method: "PUT",
            body: JSON.stringify({ ...b, version: editing.version }),
          })
        : await api("/matches", {
            method: "POST",
            body: JSON.stringify(b),
          });
      toast.success("Match saved");
      setEditing(undefined);
      await matches.load();
    } catch (e: unknown) {
      toast.error(errorMessage(e));
    }
  }
  const [view, setView] = useState<"schedule" | "bracket">("schedule");
  return (
    <>
      {showWorkspace && (
        <>
          <div className="match-workspace-tabs">
            <button
              className={view === "schedule" ? "active" : ""}
              onClick={() => setView("schedule")}
            >
              Schedule
            </button>
            <button
              className={view === "bracket" ? "active" : ""}
              onClick={() => setView("bracket")}
            >
              Bracket Builder
            </button>
          </div>
          {view === "schedule" ? (
            <ScheduleWorkspace refresh={refresh} />
          ) : (
            <BracketBuilder refresh={refresh} />
          )}
        </>
      )}
      <section className="panel">
        <div className="panelhead">
          <h3>All matches</h3>
          <button className="btn primary" onClick={() => setEditing(null)}>
            <Plus /> Add match
          </button>
        </div>
        <div className="filters">
          <Search />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search team or court"
          />
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="all">All statuses</option>
            <option value="scheduled">Scheduled</option>
            <option value="live">Live</option>
            <option value="finished">Finished</option>
          </select>
        </div>
        <div
          className={`schedule-health ${scheduleWarnings.length ? "warning" : "ok"}`}
        >
          <b>
            {scheduleWarnings.length
              ? `${scheduleWarnings.length} schedule conflict${scheduleWarnings.length === 1 ? "" : "s"}`
              : "Schedule checked — no conflicts"}
          </b>
          {scheduleWarnings.slice(0, 5).map((warning) => (
            <small key={warning}>{warning}</small>
          ))}
        </div>
        {filtered.map((m) => (
          <MatchCard
            key={m.id}
            match={m}
            teams={teams.data}
            editable
            onChanged={matches.load}
            onEdit={() => setEditing(m)}
            onDelete={async () => {
              await api(`/matches/${m.id}`, { method: "DELETE" });
              toast.success("Match deleted");
              matches.load();
            }}
          />
        ))}
        <Modal
          title={editing?.id ? "Edit match" : "Add match"}
          open={editing !== undefined}
          onOpenChange={(v) => !v && setEditing(undefined)}
        >
          <form
            key={editing?.id || "new-match"}
            className="portal-form"
            onSubmit={save}
          >
            <Field
              label="Home team"
              name="home_team_id"
              children={
                <select
                  name="home_team_id"
                  defaultValue={editing?.home_team_id}
                  required
                >
                  <option value="">Choose team</option>
                  {teams.data.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              }
            />
            <Field
              label="Away team"
              name="away_team_id"
              children={
                <select
                  name="away_team_id"
                  defaultValue={editing?.away_team_id}
                  required
                >
                  <option value="">Choose team</option>
                  {teams.data.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              }
            />
            <Field
              label="Status"
              name="status"
              children={
                <select
                  name="status"
                  defaultValue={editing?.status || "scheduled"}
                >
                  <option value="scheduled">Scheduled</option>
                  <option value="live">Live</option>
                  <option value="finished">Finished</option>
                </select>
              }
            />
            <Field
              label="Group"
              name="group_id"
              defaultValue={editing?.group_id || "A"}
            />
            <Field
              label="Court"
              name="court"
              defaultValue={editing?.court || "Court 1"}
              required
            />
            <Field
              label="Match date"
              name="match_date"
              type="date"
              defaultValue={editing?.match_date}
              required
            />
            <Field
              label="Start time"
              name="start_time"
              type="time"
              defaultValue={editing?.start_time}
            />
            <Field
              label="Referee 1"
              name="referee_1"
              children={
                <select
                  name="referee_1"
                  defaultValue={editing?.referee_ids?.[0]}
                  required
                >
                  <option value="">Choose referee</option>
                  {refs.data.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              }
            />
            <Field
              label="Referee 2"
              name="referee_2"
              children={
                <select
                  name="referee_2"
                  defaultValue={editing?.referee_ids?.[1]}
                  required
                >
                  <option value="">Choose referee</option>
                  {refs.data.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              }
            />
            <p className="portal-field wide score-note">
              Scores are changed by recording goals and selecting the scorer.
            </p>
            <FormButtons busy={false} onCancel={() => setEditing(undefined)} />
          </form>
        </Modal>
      </section>
    </>
  );
}
const teamName = (teams: Row[], id: string) =>
  teams.find((t) => t.id === id)?.name || id;
export function MatchCard({
  match,
  teams,
  editable = false,
  onChanged,
  onEdit,
  onDelete,
  showScoreboardControls = false,
  durationMinutes = 20,
  halftimeMinutes = 5,
}: {
  match: Row;
  teams: Row[];
  editable?: boolean;
  onChanged: () => void;
  onEdit?: () => void;
  onDelete?: () => Promise<void>;
  showScoreboardControls?: boolean;
  durationMinutes?: number;
  halftimeMinutes?: number;
}) {
  const [busy, setBusy] = useState(false),
    [goalTeam, setGoalTeam] = useState<string | null>(null),
    [players, setPlayers] = useState<Row[]>([]),
    [events, setEvents] = useState<Row[]>([]),
    [incidentEvents, setIncidentEvents] = useState<Row[]>([]),
    [playerId, setPlayerId] = useState(""),
    [incidentOpen, setIncidentOpen] = useState(false),
    [incidentType, setIncidentType] = useState("CARD"),
    [incidentTeam, setIncidentTeam] = useState(""),
    [incidentPlayer, setIncidentPlayer] = useState(""),
    [incidentDetails, setIncidentDetails] = useState(""),
    [timerRunning, setTimerRunning] = useState(Boolean(match.clock_running)),
    [seconds, setSeconds] = useState(() => {
      const [minutes = "20", secs = "0"] = String(match.clock || "20:00").split(
        ":",
      );
      return Number(minutes) * 60 + Number(secs);
    });
  async function loadGoals() {
    try {
      const [goals, incidents] = await Promise.all([
        api(`/goal-events/${match.id}`),
        api(`/match-events/${match.id}`),
      ]);
      setEvents(goals);
      setIncidentEvents(incidents);
    } catch {
      setEvents([]);
      setIncidentEvents([]);
    }
  }
  useEffect(() => {
    loadGoals();
  }, [match.id]);
  const savedSeconds = useCallback(() => {
    const [minutes = "20", secs = "0"] = String(match.clock || "20:00").split(
      ":",
    );
    const base = Number(minutes) * 60 + Number(secs);
    return match.clock_running && match.clock_started_at
      ? Math.max(
          0,
          base -
            Math.floor(
              (Date.now() - new Date(match.clock_started_at).getTime()) / 1000,
            ),
        )
      : base;
  }, [match.clock, match.clock_running, match.clock_started_at]);
  useEffect(() => {
    setTimerRunning(Boolean(match.clock_running));
    setSeconds(savedSeconds());
  }, [
    match.id,
    match.clock,
    match.clock_running,
    match.clock_started_at,
    savedSeconds,
  ]);
  useEffect(() => {
    if (!timerRunning) return;
    const timer = setInterval(
      () => setSeconds((value) => (value > 0 ? value - 1 : 0)),
      1000,
    );
    return () => clearInterval(timer);
  }, [timerRunning]);
  const clockText = `${Math.floor(seconds / 60)
    .toString()
    .padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`;
  const adjustClock = (delta: number) => {
    const next = Math.max(0, seconds + delta);
    setSeconds(next);
    update({
      clock: `${Math.floor(next / 60)
        .toString()
        .padStart(2, "0")}:${(next % 60).toString().padStart(2, "0")}`,
      clock_running: 0,
      clock_started_at: null,
    });
  };
  async function update(changes: Row) {
    setBusy(true);
    try {
      await api(`/matches/${match.id}`, {
        method: "PUT",
        body: JSON.stringify({ ...changes, version: match.version }),
      });
      toast.success("Match updated live");
      onChanged();
    } catch (e: unknown) {
      toast.error(errorMessage(e));
      onChanged();
    } finally {
      setBusy(false);
    }
  }
  async function openGoal(teamId: string) {
    setGoalTeam(teamId);
    setPlayerId("");
    try {
      const rows = await api("/delegation");
      setPlayers(
        rows.filter((p: Row) => p.team_id === teamId && p.role === "PLAYER"),
      );
    } catch (e: unknown) {
      toast.error(errorMessage(e));
    }
  }
  async function addGoal() {
    if (!goalTeam || !playerId) return;
    setBusy(true);
    try {
      const result = await api("/goal-events", {
        method: "POST",
        body: JSON.stringify({
          match_id: match.id,
          team_id: goalTeam,
          player_id: playerId,
          period: match.period,
          clock: match.clock,
        }),
      });
      toast.success(`Goal recorded for ${result.player_name}`);
      setGoalTeam(null);
      await loadGoals();
      onChanged();
    } catch (e: unknown) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function removeGoal(teamId: string) {
    const latest = [...events].reverse().find((e) => e.team_id === teamId);
    if (!latest) return toast.error("No player-linked goal to remove");
    setBusy(true);
    try {
      await api(`/goal-events/${latest.id}`, { method: "DELETE" });
      toast.success("Goal removed");
      await loadGoals();
      onChanged();
    } catch (e: unknown) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function openIncident() {
    setIncidentOpen(true);
    setIncidentType("CARD");
    setIncidentTeam(match.home_team_id);
    setIncidentPlayer("");
    setIncidentDetails("");
    try {
      setPlayers(await api("/delegation"));
    } catch (error: unknown) {
      toast.error(errorMessage(error));
    }
  }
  async function addIncident() {
    setBusy(true);
    try {
      await api("/match-events", {
        method: "POST",
        body: JSON.stringify({
          match_id: match.id,
          team_id: incidentTeam || null,
          player_id: incidentPlayer || null,
          type: incidentType,
          period: match.period,
          clock: match.clock,
          details: incidentDetails,
        }),
      });
      toast.success(`${incidentType.toLowerCase()} recorded`);
      setIncidentOpen(false);
      await loadGoals();
    } catch (error: unknown) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  async function downloadReport() {
    let referees: Row[] = [];
    try {
      referees = await api("/referees");
    } catch {}
    const escape = (value: unknown) =>
        String(value ?? "").replace(
          /[&<>"']/g,
          (char) =>
            ({
              "&": "&amp;",
              "<": "&lt;",
              ">": "&gt;",
              '"': "&quot;",
              "'": "&#39;",
            })[char] || char,
        ),
      home = teamName(teams, match.home_team_id),
      away = teamName(teams, match.away_team_id),
      rows: ReportEvent[] = [
        ...events.map((event) => ({
          ...event,
          type: "GOAL",
          details: event.player_name,
        })),
        ...incidentEvents,
      ] as ReportEvent[],
      sortedRows = rows.sort((a, b) =>
        String(a.created_at).localeCompare(String(b.created_at)),
      ),
      officialNames = (match.referee_ids || [])
        .map(
          (id: string) =>
            referees.find((referee) => referee.id === id)?.name || id,
        )
        .join(" · "),
      html = `<!doctype html><html><head><meta charset="utf-8"><title>${escape(home)} vs ${escape(away)}</title><style>body{font:16px Arial;max-width:850px;margin:40px auto;color:#17131a}h1{color:#ec4899}.score{font-size:32px;font-weight:800}table{width:100%;border-collapse:collapse;margin-top:28px}th,td{padding:10px;border-bottom:1px solid #ddd;text-align:left}</style></head><body><h1>PCF BATTLE · Match report</h1><h2>${escape(home)} vs ${escape(away)}</h2><p class="score">${match.home_score} — ${match.away_score}</p><p>${escape(match.match_date ? `${fmtDate(match.match_date)} · ` : "")}${escape(match.start_time || "TBD")} · ${escape(match.court)} · ${escape(match.status)}</p><p><strong>Referees:</strong> ${escape(officialNames || "Not assigned")}</p><table><thead><tr><th>Time</th><th>Type</th><th>Team / player</th><th>Details</th></tr></thead><tbody>${sortedRows.map((event) => `<tr><td>${escape(event.clock || "—")}</td><td>${escape(event.type)}</td><td>${escape(event.team_name || "—")}${event.player_name ? ` · ${escape(event.player_name)}` : ""}</td><td>${escape(event.details || "")}</td></tr>`).join("")}</tbody></table></body></html>`,
      url = URL.createObjectURL(new Blob([html], { type: "text/html" })),
      link = document.createElement("a");
    link.href = url;
    link.download = `match-report-${home}-${away}.html`.replace(
      /[^a-z0-9_.-]+/gi,
      "-",
    );
    link.click();
    URL.revokeObjectURL(url);
  }
  return (
    <article className={`match ${match.status}`}>
      <div className="meta">
        <Badge>{match.status}</Badge>
        <span>
          {match.match_date ? `${fmtDate(match.match_date)} · ` : ""}
          {match.start_time || "TBD"} · {match.court}
        </span>
        <span>Group {match.group_id}</span>
        <span className="match-referees">
          Referees:{" "}
          {(match.referee_names || []).length
            ? match.referee_names.join(" · ")
            : "Not assigned"}
        </span>
      </div>
      <div className="versus">
        <div>
          <TeamMark team={teams.find((t) => t.id === match.home_team_id)} />
          <b>{teamName(teams, match.home_team_id)}</b>
        </div>
        <strong>
          {match.home_score}
          <i>—</i>
          {match.away_score}
        </strong>
        <div>
          <b>{teamName(teams, match.away_team_id)}</b>
          <TeamMark team={teams.find((t) => t.id === match.away_team_id)} />
        </div>
      </div>
      {editable && !match.confirmed && (
        <>
          {showScoreboardControls && (
            <div className="match-clock-controls">
              <strong>{clockText}</strong>
              <button
                className="btn small"
                disabled={busy || seconds === 0}
                onClick={async () => {
                  if (timerRunning) {
                    setTimerRunning(false);
                    await update({
                      clock: clockText,
                      clock_running: 0,
                      clock_started_at: null,
                    });
                  } else {
                    setTimerRunning(true);
                    await update({
                      status: "live",
                      clock: clockText,
                      clock_running: 1,
                      clock_started_at: new Date().toISOString(),
                    });
                  }
                }}
              >
                {timerRunning ? "Pause" : "Start clock"}
              </button>
              <button
                className="btn small"
                disabled={timerRunning}
                onClick={() => adjustClock(-10)}
              >
                −10 sec
              </button>
              <button
                className="btn small"
                disabled={timerRunning}
                onClick={() => adjustClock(10)}
              >
                +10 sec
              </button>
              <button
                className="btn small"
                disabled={timerRunning}
                onClick={() => {
                  const next = prompt("Set time (MM:SS)", clockText);
                  if (next && /^\d{1,2}:[0-5]\d$/.test(next)) {
                    const [m, s] = next.split(":").map(Number);
                    setSeconds(m * 60 + s);
                    update({
                      clock: `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`,
                      clock_running: 0,
                      clock_started_at: null,
                    });
                  }
                }}
              >
                Set time
              </button>
              <button
                className="btn small"
                disabled={timerRunning}
                onClick={() => {
                  setSeconds(durationMinutes * 60);
                  update({
                    clock: `${String(durationMinutes).padStart(2, "0")}:00`,
                    clock_running: 0,
                    clock_started_at: null,
                  });
                }}
              >
                Reset {durationMinutes}:00
              </button>
              <select
                aria-label="Match period"
                value={match.period || "1st half"}
                onChange={(event) => {
                  const period = event.target.value;
                  if (period === "Half-time") {
                    setTimerRunning(false);
                    setSeconds(halftimeMinutes * 60);
                    update({
                      period,
                      clock: `${String(halftimeMinutes).padStart(2, "0")}:00`,
                      clock_running: 0,
                      clock_started_at: null,
                    });
                  } else if (period === "2nd half") {
                    setTimerRunning(false);
                    setSeconds(durationMinutes * 60);
                    update({
                      period,
                      clock: `${String(durationMinutes).padStart(2, "0")}:00`,
                      clock_running: 0,
                      clock_started_at: null,
                    });
                  } else update({ period });
                }}
              >
                <option value="1st half">1st half</option>
                <option value="Half-time">Half-time</option>
                <option value="2nd half">2nd half</option>
                <option value="Extra time">Extra time</option>
              </select>
            </div>
          )}
          <div className="scoretools">
            <div className="status-actions">
              <button
                disabled={busy}
                onClick={() => update({ status: "scheduled" })}
              >
                Scheduled
              </button>
              <button
                disabled={busy}
                onClick={() => update({ status: "live" })}
              >
                Live
              </button>
              <Confirm
                title="Finish match and lock result"
                text="Confirm and lock this match? Further changes will require an admin password."
                onConfirm={async () => {
                  setTimerRunning(false);
                  await update({
                    status: "finished",
                    clock: clockText,
                    clock_running: 0,
                    clock_started_at: null,
                  });
                  await api(`/matches/${match.id}/confirm`, { method: "POST" });
                  onChanged();
                }}
              >
                <button disabled={busy}>Finish</button>
              </Confirm>
            </div>
            <div>
              <button
                disabled={busy || match.home_score < 1}
                aria-label="Remove latest home goal"
                onClick={() => removeGoal(match.home_team_id)}
              >
                <Minus />
              </button>
              <button
                disabled={busy}
                aria-label="Record home goal"
                onClick={() => openGoal(match.home_team_id)}
              >
                <Plus />
              </button>
              <small>HOME</small>
              <button
                disabled={busy || match.away_score < 1}
                aria-label="Remove latest away goal"
                onClick={() => removeGoal(match.away_team_id)}
              >
                <Minus />
              </button>
              <button
                disabled={busy}
                aria-label="Record away goal"
                onClick={() => openGoal(match.away_team_id)}
              >
                <Plus />
              </button>
              {onEdit && (
                <button className="text-action" onClick={onEdit}>
                  Edit
                </button>
              )}
              <button className="text-action" onClick={openIncident}>
                Card / penalty
              </button>
              <button className="text-action" onClick={downloadReport}>
                <Download /> Report
              </button>
              {onDelete && (
                <Confirm
                  title="Delete match"
                  text="Delete this match permanently?"
                  onConfirm={onDelete}
                >
                  <button className="text-action danger-link">Delete</button>
                </Confirm>
              )}
            </div>
          </div>
          {events.length > 0 && (
            <div className="goal-history">
              <b>Goals</b>
              {events.map((e) => (
                <span key={e.id}>
                  <strong>{e.player_name}</strong>
                  <small>
                    {e.team_name}
                    {e.player_number ? ` · #${e.player_number}` : ""}
                    {e.clock ? ` · ${e.clock}` : ""}
                  </small>
                </span>
              ))}
            </div>
          )}
          {incidentEvents.length > 0 && (
            <div className="goal-history incident-history">
              <b>Cards, penalties and notes</b>
              {incidentEvents.map((event) => (
                <span key={event.id}>
                  <strong>
                    {event.type} ·{" "}
                    {event.player_name || event.team_name || "Match"}
                  </strong>
                  <small>
                    {event.clock || "—"}
                    {event.details ? ` · ${event.details}` : ""}
                  </small>
                  <button
                    aria-label="Delete event"
                    onClick={async () => {
                      await api(`/match-events/${event.id}`, {
                        method: "DELETE",
                      });
                      loadGoals();
                    }}
                  >
                    <Trash2 />
                  </button>
                </span>
              ))}
            </div>
          )}
        </>
      )}
      {match.confirmed && (
        <div className="match-lock">
          <b>Confirmed result — locked</b>
          {editable && (
            <button
              className="btn small"
              onClick={async () => {
                const password = prompt(
                  "Enter the admin password to unlock this match",
                );
                if (!password) return;
                try {
                  await api(`/matches/${match.id}/unlock`, {
                    method: "POST",
                    body: JSON.stringify({ password }),
                  });
                  toast.success("Match unlocked");
                  onChanged();
                } catch (error: unknown) {
                  toast.error(errorMessage(error));
                }
              }}
            >
              Unlock with admin password
            </button>
          )}
        </div>
      )}
      {!editable && (
        <button className="btn small" onClick={downloadReport}>
          <Download /> Download match report
        </button>
      )}
      <Modal
        title="Who scored?"
        open={goalTeam !== null}
        onOpenChange={(v) => !v && setGoalTeam(null)}
      >
        <p>
          Select the player who scored for {teamName(teams, goalTeam || "")}.
          The score and player statistics update together.
        </p>
        <label className="portal-field">
          <span>Goalscorer</span>
          <select
            value={playerId}
            onChange={(e) => setPlayerId(e.target.value)}
          >
            <option value="">Choose a player</option>
            {players.map((p) => (
              <option key={p.id} value={p.id}>
                {p.number ? `#${p.number} · ` : ""}
                {p.name}
              </option>
            ))}
          </select>
        </label>
        {!players.length && (
          <p className="formerror">
            No players are registered for this team yet.
          </p>
        )}
        <div className="form-actions">
          <button className="btn" onClick={() => setGoalTeam(null)}>
            Cancel
          </button>
          <button
            className="btn primary"
            disabled={busy || !playerId}
            onClick={addGoal}
          >
            {busy ? "Saving…" : "Record goal"}
          </button>
        </div>
      </Modal>
      <Modal
        title="Record card, penalty or note"
        open={incidentOpen}
        onOpenChange={setIncidentOpen}
      >
        <div className="portal-form">
          <Field
            label="Event"
            name="incident_type"
            children={
              <select
                value={incidentType}
                onChange={(event) => setIncidentType(event.target.value)}
              >
                <option value="CARD">Card</option>
                <option value="PENALTY">Penalty</option>
                <option value="NOTE">Match note</option>
              </select>
            }
          />
          <Field
            label="Team"
            name="incident_team"
            children={
              <select
                value={incidentTeam}
                onChange={(event) => {
                  setIncidentTeam(event.target.value);
                  setIncidentPlayer("");
                }}
              >
                <option value="">Match-wide</option>
                <option value={match.home_team_id}>
                  {teamName(teams, match.home_team_id)}
                </option>
                <option value={match.away_team_id}>
                  {teamName(teams, match.away_team_id)}
                </option>
              </select>
            }
          />
          <Field
            label="Player (optional)"
            name="incident_player"
            children={
              <select
                value={incidentPlayer}
                onChange={(event) => setIncidentPlayer(event.target.value)}
              >
                <option value="">No player</option>
                {players
                  .filter(
                    (player) =>
                      !incidentTeam || player.team_id === incidentTeam,
                  )
                  .map((player) => (
                    <option value={player.id} key={player.id}>
                      {player.number ? `#${player.number} · ` : ""}
                      {player.name}
                    </option>
                  ))}
              </select>
            }
          />
          <Field
            label="Details"
            name="incident_details"
            children={
              <textarea
                rows={3}
                value={incidentDetails}
                onChange={(event) => setIncidentDetails(event.target.value)}
                placeholder="Reason or additional information"
              />
            }
          />
          <div className="form-actions">
            <button className="btn" onClick={() => setIncidentOpen(false)}>
              Cancel
            </button>
            <button
              className="btn primary"
              disabled={busy}
              onClick={addIncident}
            >
              {busy ? "Saving…" : "Record event"}
            </button>
          </div>
        </div>
      </Modal>
    </article>
  );
}

function Delegation({
  refresh,
  admin = false,
}: {
  refresh: number;
  admin?: boolean;
}) {
  const members = useData("/delegation", refresh),
    teams = useData("/teams", refresh),
    [editing, setEditing] = useState<Row | null | undefined>(undefined),
    [team, setTeam] = useState("all"),
    [memberType, setMemberType] = useState<
      "PLAYER" | "COACH" | "STAFF" | "REFEREE"
    >("PLAYER"),
    [busy, setBusy] = useState(false);
  const saveLock = useRef(false);
  const shown = members.data.filter(
      (m) => team === "all" || m.team_id === team,
    ),
    players = shown.filter((m) => m.role === "PLAYER"),
    referees = shown.filter((m) => m.role === "REFEREE");
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (saveLock.current || busy) return;
    saveLock.current = true;
    setBusy(true);
    const b: any = Object.fromEntries(new FormData(e.currentTarget));
    if (b.number) b.number = Number(b.number);
    else b.number = null;
    try {
      editing?.id
        ? await api(`/delegation/${editing.id}`, {
            method: "PUT",
            body: JSON.stringify(b),
          })
        : await api("/delegation", { method: "POST", body: JSON.stringify(b) });
      toast.success(
        b.role === "PLAYER"
          ? "Member saved and added to the team selection"
          : b.role === "REFEREE"
            ? "Member saved and added to the referee system"
            : "Delegation member saved",
      );
      setEditing(undefined);
      members.load();
    } catch (e: unknown) {
      toast.error(errorMessage(e));
    } finally {
      saveLock.current = false;
      setBusy(false);
    }
  }
  return (
    <section className="panel">
      <div className="panelhead">
        <div>
          <h3>{admin ? "Delegation members" : "Your delegation"}</h3>
          <small>
            {shown.length} / 16 members · {players.length} / 8 players ·{" "}
            {referees.length} referees
          </small>
        </div>
        <button
          className="btn primary"
          onClick={() => {
            setMemberType("PLAYER");
            setEditing(null);
          }}
        >
          <Plus /> Add member
        </button>
      </div>
      {admin && (
        <div className="filters">
          <select value={team} onChange={(e) => setTeam(e.target.value)}>
            <option value="all">All teams</option>
            {teams.data.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="portal-table">
        {shown.map((m) => (
          <div className="portal-row member-row" key={m.id}>
            <span className="member-avatar">
              {m.name
                .split(" ")
                .map((x: string) => x[0])
                .join("")
                .slice(0, 2)}
            </span>
            <span>
              <b>{m.name}</b>
              <small>
                {admin
                  ? teamName(teams.data, m.team_id)
                  : m.dietary || "No dietary notes"}
              </small>
            </span>
            <span className="member-number">
              {m.role === "PLAYER" ? `#${m.number || "—"}` : ""}
            </span>
            <Badge>
              {m.member_type === "PLAYER"
                ? "Player"
                : m.member_type === "REFEREE"
                  ? "Referee"
                  : m.member_type === "COACH" ||
                      m.staff_role === "HEAD_COACH" ||
                      m.staff_role === "ASSISTANT_COACH"
                    ? "Coach"
                    : "Staff"}
            </Badge>
            <div className="row-actions">
              <button
                onClick={() => {
                  const type =
                    m.member_type === "PLAYER" ||
                    m.member_type === "REFEREE" ||
                    m.member_type === "COACH" ||
                    m.staff_role === "HEAD_COACH" ||
                    m.staff_role === "ASSISTANT_COACH"
                      ? m.member_type === "PLAYER"
                        ? "PLAYER"
                        : m.member_type === "REFEREE"
                          ? "REFEREE"
                          : "COACH"
                      : "STAFF";
                  setMemberType(type);
                  setEditing(m);
                }}
              >
                Edit
              </button>
              <Confirm
                title="Remove member"
                text={`Remove ${m.name} from the delegation?`}
                onConfirm={async () => {
                  await api(`/delegation/${m.id}`, { method: "DELETE" });
                  toast.success("Member removed");
                  members.load();
                }}
              >
                <button className="danger-link">Delete</button>
              </Confirm>
            </div>
          </div>
        ))}
      </div>
      <div className="automatic-selections">
        <div
          className={
            players.length ? "selection-complete" : "selection-pending"
          }
        >
          <h4>Team selection</h4>
          <small>
            Automatically includes every delegation member with the Player role.
          </small>
          <div>
            {players.map((p) => (
              <span key={p.id}>
                <b>
                  {p.number ? `#${p.number} · ` : ""}
                  {p.name}
                </b>
                <small>{teamName(teams.data, p.team_id)}</small>
              </span>
            ))}
          </div>
        </div>
        <div>
          <h4>Delegation referees</h4>
          <small>
            Automatically available in the referee overview and match
            assignments.
          </small>
          <div>
            {referees.map((r) => (
              <span key={r.id}>
                <b>{r.name}</b>
                <small>{teamName(teams.data, r.team_id)}</small>
              </span>
            ))}
          </div>
        </div>
      </div>
      <Modal
        title={editing?.id ? "Edit member" : "Add member"}
        open={editing !== undefined}
        onOpenChange={(v) => !v && setEditing(undefined)}
      >
        <form className="portal-form" onSubmit={save}>
          {admin && (
            <Field
              label="Team"
              name="team_id"
              children={
                <select
                  name="team_id"
                  defaultValue={
                    editing?.team_id || (team === "all" ? "" : team)
                  }
                  required
                >
                  <option value="">Choose team</option>
                  {teams.data.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              }
            />
          )}
          <Field
            label="Name"
            name="name"
            defaultValue={editing?.name}
            required
          />
          <Field
            label="Member type"
            name="role"
            children={
              <select
                name="role"
                value={memberType}
                onChange={(event) =>
                  setMemberType(
                    event.target.value as
                      "PLAYER" | "COACH" | "STAFF" | "REFEREE",
                  )
                }
              >
                <option value="PLAYER">Player</option>
                <option value="COACH">Coach</option>
                <option value="STAFF">Staff</option>
                <option value="REFEREE">Referee</option>
              </select>
            }
          />
          <input type="hidden" name="member_type" value={memberType} />
          {memberType === "PLAYER" && (
            <>
              <Field
                label="Player role"
                name="player_role"
                children={
                  <select
                    name="player_role"
                    defaultValue={editing?.player_role || "KEEPER"}
                  >
                    <option value="KEEPER">Goalkeeper</option>
                    <option value="T_STICK">T-stick</option>
                    <option value="HANDSTICK">Handstick</option>
                  </select>
                }
              />
              <Field
                label="Classification points"
                name="classification_points"
                type="number"
                defaultValue={editing?.classification_points ?? ""}
                min={0.5}
                max={4.5}
                step={0.5}
              />
            </>
          )}
          {memberType === "PLAYER" && (
            <Field
              label="Shirt number"
              name="number"
              type="number"
              defaultValue={editing?.number}
            />
          )}
          <Field
            label="Date of birth"
            name="dob"
            type="date"
            defaultValue={editing?.dob}
          />
          <Field
            label="Dietary requirements"
            name="dietary"
            defaultValue={editing?.dietary}
          />
          <Field label="Notes" name="notes" defaultValue={editing?.notes} />
          <Field
            label="Emergency contact"
            name="emergency_contact"
            defaultValue={editing?.emergency_contact}
          />
          <label className="portal-field wide">
            <span>Restricted medical/accessibility notes</span>
            <textarea
              name="medical_notes"
              rows={3}
              defaultValue={editing?.medical_notes || ""}
            />
          </label>
          <VisibilityField
            label="Privacy consent"
            name="privacy_consent"
            defaultValue={editing?.privacy_consent ?? 0}
            onLabel="Recorded"
            offLabel="Missing"
          />
          <VisibilityField
            label="Photo publication consent"
            name="photo_consent"
            defaultValue={editing?.photo_consent ?? 0}
            onLabel="Granted"
            offLabel="Not granted"
          />
          <FormButtons busy={busy} onCancel={() => setEditing(undefined)} />
        </form>
      </Modal>
    </section>
  );
}

function RoomsPanelV2({
  refresh,
  admin = false,
}: {
  refresh: number;
  admin?: boolean;
}) {
  const rooms = useData("/rooms", refresh),
    members = useData("/delegation", refresh),
    teams = useData("/teams", refresh),
    [editing, setEditing] = useState<Row | null | undefined>(undefined),
    [memberId, setMemberId] = useState(""),
    [roomId, setRoomId] = useState("");
  const assignedMemberIds = useMemo(
    () =>
      new Set(
        rooms.data.flatMap((room: Row) =>
          (room.assignments || []).map(
            (assignment: Row) => assignment.member_id,
          ),
        ),
      ),
    [rooms.data],
  );
  const unassignedMembers = members.data.filter(
    (member: Row) => !assignedMemberIds.has(member.id),
  );
  async function assign(
    rid: string | null = roomId || null,
    mid = memberId,
    previousRoomId: string | null = null,
    notify = true,
  ) {
    if (!mid) return toast.error("Choose a member");
    try {
      await api("/rooms/assign", {
        method: "POST",
        body: JSON.stringify({ roomId: rid, memberId: mid }),
      });
      const member = members.data.find((item: Row) => item.id === mid);
      await rooms.load();
      const room = rooms.data.find((item: Row) => item.id === rid);
      if (notify)
        toast.success(
          rid
            ? `${member?.name || "Member"} moved to Room ${room?.number || ""}`
            : `${member?.name || "Member"} removed from their room`,
          {
            action: {
              label: "Undo",
              onClick: () => assign(previousRoomId, mid, rid, false),
            },
          },
        );
      setMemberId("");
    } catch (e: unknown) {
      toast.error(errorMessage(e));
    }
  }
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const b: any = Object.fromEntries(new FormData(e.currentTarget));
    b.capacity = Number(b.capacity || 2);
    b.price = Number(b.price || 0);
    b.locked = Number(b.locked || 0);
    b.team_id = b.team_id || null;
    try {
      editing?.id
        ? await api(`/rooms/${editing.id}`, {
            method: "PUT",
            body: JSON.stringify(b),
          })
        : await api("/rooms", { method: "POST", body: JSON.stringify(b) });
      toast.success(editing?.id ? "Room updated" : "Room created");
      setEditing(undefined);
      rooms.load();
    } catch (err: unknown) {
      toast.error(errorMessage(err));
    }
  }
  return (
    <>
      <section className="panel room-assign">
        <div>
          <h3>Room allocation</h3>
          <p>
            All rooms use the centrally configured price. A supplement applies
            automatically when a room has only one assigned person.
          </p>
        </div>
        {admin && (
          <button className="btn primary" onClick={() => setEditing(null)}>
            <Plus /> Add room
          </button>
        )}
        <select value={memberId} onChange={(e) => setMemberId(e.target.value)}>
          <option value="">Choose member</option>
          {members.data.map((m: Row) => (
            <option key={m.id} value={m.id}>
              {m.name}
              {admin ? ` · ${teamName(teams.data, m.team_id)}` : ""}
            </option>
          ))}
        </select>
        <select value={roomId} onChange={(e) => setRoomId(e.target.value)}>
          <option value="">Unassigned / No room</option>
          {rooms.data.map((r: Row) => (
            <option key={r.id} value={r.id}>
              Room {r.number}
            </option>
          ))}
        </select>
        {roomId && (
          <button className="btn primary" onClick={() => assign()}>
            <Hotel /> Assign / move
          </button>
        )}
      </section>
      <div className="room-workspace">
        <section className="panel room-members">
          <h3>Unassigned members</h3>
          <div
            className="room-unassigned-drop"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              const mid = e.dataTransfer.getData("memberId"),
                previous = e.dataTransfer.getData("roomId") || null;
              void assign(null, mid, previous);
            }}
          >
            <small>Drop a person here to remove their room assignment</small>
          </div>
          {unassignedMembers.map((m: Row) => (
            <div
              draggable
              key={m.id}
              onDragStart={(e) => {
                e.dataTransfer.setData("memberId", m.id);
                e.dataTransfer.setData("roomId", "");
              }}
            >
              <span className="member-avatar">
                {m.name.slice(0, 2).toUpperCase()}
              </span>
              <span>
                {m.name}
                <small>
                  {admin ? teamName(teams.data, m.team_id) : m.role}
                </small>
              </span>
            </div>
          ))}
        </section>
        <div className="roomgrid">
          {rooms.data.map((r: Row) => (
            <article
              key={r.id}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) =>
                assign(
                  r.id,
                  e.dataTransfer.getData("memberId"),
                  e.dataTransfer.getData("roomId") || null,
                )
              }
            >
              <div>
                <Hotel />
                <b>Room {r.number}</b>
                <small>
                  {r.assignments?.length || 0} / {r.capacity}
                </small>
              </div>
              <p className="room-team">
                {r.team_id
                  ? teamName(teams.data, r.team_id)
                  : "Available to allocate"}{" "}
                ·{" "}
                {r.assignments?.length === 1
                  ? "Single occupancy"
                  : "Shared occupancy"}
              </p>
              {r.assignments?.map((a: Row) => (
                <span
                  className="room-assignment"
                  key={a.member_id}
                  draggable
                  onDragStart={(e) => {
                    e.stopPropagation();
                    e.dataTransfer.setData("memberId", a.member_id);
                    e.dataTransfer.setData("roomId", r.id);
                  }}
                >
                  <b>{a.name}</b>
                  <button
                    type="button"
                    className="room-remove"
                    data-room-remove="true"
                    aria-label={`Remove ${a.name} from room`}
                    title="Remove from room"
                    onClick={(e) => {
                      e.stopPropagation();
                      void assign(null, a.member_id, r.id);
                    }}
                  >
                    <Trash2 aria-hidden="true" />
                  </button>
                </span>
              ))}
              {(r.assignments?.length || 0) < r.capacity && (
                <em>{r.locked ? "Locked" : "Drop a member here"}</em>
              )}
              {admin && (
                <div className="room-actions">
                  <button className="text-action" onClick={() => setEditing(r)}>
                    Edit room
                  </button>
                  <Confirm
                    title="Delete room"
                    text={`Delete Room ${r.number}? The room must be empty first.`}
                    onConfirm={async () => {
                      try {
                        await api(`/rooms/${r.id}`, { method: "DELETE" });
                        toast.success(`Room ${r.number} deleted`);
                        rooms.load();
                      } catch (error: unknown) {
                        toast.error(errorMessage(error));
                      }
                    }}
                  >
                    <button className="danger-link" type="button">
                      Delete room
                    </button>
                  </Confirm>
                </div>
              )}
            </article>
          ))}
        </div>
      </div>
      {admin && (
        <Modal
          title={editing?.id ? `Edit room ${editing.number}` : "Add room"}
          open={editing !== undefined}
          onOpenChange={(v) => !v && setEditing(undefined)}
        >
          <form className="portal-form" onSubmit={save}>
            <Field
              label="Room number"
              name="number"
              defaultValue={editing?.number}
              required
            />
            <Field
              label="Capacity"
              name="capacity"
              type="number"
              defaultValue={editing?.capacity || 2}
              required
            />
            <Field
              label="Allocated team"
              name="team_id"
              children={
                <select name="team_id" defaultValue={editing?.team_id || ""}>
                  <option value="">Not allocated</option>
                  {teams.data.map((t: Row) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              }
            />
            <Field
              label="Status"
              name="locked"
              children={
                <select name="locked" defaultValue={editing?.locked || 0}>
                  <option value="0">Available</option>
                  <option value="1">Locked</option>
                </select>
              }
            />
            <FormButtons busy={false} onCancel={() => setEditing(undefined)} />
          </form>
        </Modal>
      )}
    </>
  );
}

function SponsorPanel({ refresh }: { refresh: number }) {
  const links = useData("/links", refresh),
    sponsors = links.data
      .filter((l: Row) => l.category === "Sponsor")
      .sort((a: Row, b: Row) => Number(a.sort_order) - Number(b.sort_order)),
    [editing, setEditing] = useState<Row | null | undefined>(undefined),
    [busy, setBusy] = useState(false);
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    const b: any = Object.fromEntries(new FormData(e.currentTarget)),
      file = b.logo_file;
    try {
      if (file instanceof File && file.size) {
        const uploaded = await uploadFile(file);
        b.url = uploaded.url;
      } else if (editing?.url) b.url = editing.url;
      else throw new Error("Choose a sponsor logo");
      const darkFile = b.dark_logo_file;
      if (darkFile instanceof File && darkFile.size) {
        const uploadedDark = await uploadFile(darkFile);
        b.dark_url = uploadedDark.url;
      } else if (editing?.dark_url) b.dark_url = editing.dark_url;
      delete b.logo_file;
      delete b.dark_logo_file;
      b.category = "Sponsor";
      b.sort_order = Number(b.sort_order || 0);
      b.active = Number(b.active ?? 1);
      editing?.id
        ? await api(`/links/${editing.id}`, {
            method: "PUT",
            body: JSON.stringify(b),
          })
        : await api("/links", { method: "POST", body: JSON.stringify(b) });
      toast.success("Sponsor saved");
      setEditing(undefined);
      links.load();
    } catch (err: unknown) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  async function move(item: Row, direction: number) {
    const index = sponsors.findIndex((x: Row) => x.id === item.id),
      other = sponsors[index + direction];
    if (!other) return;
    await Promise.all([
      api(`/links/${item.id}`, {
        method: "PUT",
        body: JSON.stringify({ sort_order: other.sort_order }),
      }),
      api(`/links/${other.id}`, {
        method: "PUT",
        body: JSON.stringify({ sort_order: item.sort_order }),
      }),
    ]);
    links.load();
  }
  return (
    <section className="panel">
      <div className="panelhead">
        <div>
          <h3>Sponsor banner</h3>
          <small>Upload logos, set destinations and control their order</small>
        </div>
        <button className="btn primary" onClick={() => setEditing(null)}>
          <Plus /> Add sponsor
        </button>
      </div>
      <div className="sponsor-admin-grid">
        {sponsors.map((s: Row, i: number) => (
          <article className="sponsor-admin-card" key={s.id}>
            <picture>
              <img src={s.url} alt={s.title} />
            </picture>
            <div>
              <b>{s.title}</b>
              <small>{s.active ? "Visible" : "Hidden"}</small>
            </div>
            <div className="row-actions">
              <button disabled={i === 0} onClick={() => move(s, -1)}>
                ←
              </button>
              <button
                disabled={i === sponsors.length - 1}
                onClick={() => move(s, 1)}
              >
                →
              </button>
              <button onClick={() => setEditing(s)}>Edit</button>
              <Confirm
                title="Delete sponsor"
                text={`Remove ${s.title} from the banner?`}
                onConfirm={async () => {
                  await api(`/links/${s.id}`, { method: "DELETE" });
                  links.load();
                }}
              >
                <button className="danger-link">Delete</button>
              </Confirm>
            </div>
          </article>
        ))}
      </div>
      <Modal
        title={editing?.id ? "Edit sponsor" : "Add sponsor"}
        open={editing !== undefined}
        onOpenChange={(v) => !v && setEditing(undefined)}
      >
        <form className="portal-form" onSubmit={save}>
          <Field
            label="Sponsor name"
            name="title"
            defaultValue={editing?.title}
            required
          />
          <Field
            label="Logo file"
            name="logo_file"
            type="file"
            required={!editing?.id}
          />
          <Field
            label="White/dark-mode logo (optional)"
            name="dark_logo_file"
            type="file"
          />
          <Field
            label="Clickable destination"
            name="target_url"
            type="url"
            defaultValue={editing?.target_url}
          />
          <Field
            label="Display order"
            name="sort_order"
            type="number"
            defaultValue={editing?.sort_order ?? sponsors.length}
          />
          <Field
            label="Visibility"
            name="active"
            children={
              <select name="active" defaultValue={editing?.active ?? 1}>
                <option value="1">Visible</option>
                <option value="0">Hidden</option>
              </select>
            }
          />
          <Field
            label="Description"
            name="description"
            defaultValue={editing?.description}
          />
          <FormButtons busy={busy} onCancel={() => setEditing(undefined)} />
        </form>
      </Modal>
    </section>
  );
}

function Invites({ refresh }: { refresh: number }) {
  const invites = useData("/invites", refresh),
    teams = useData("/teams", refresh),
    registrations = useData("/preregistrations", refresh),
    [open, setOpen] = useState(false);
  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const b = Object.fromEntries(new FormData(e.currentTarget));
    try {
      const out = await api("/invites", {
        method: "POST",
        body: JSON.stringify(b),
      });
      toast.success(
        out.emailSent
          ? `Invite ${out.code} created and emailed`
          : `Invite ${out.code} created${b.recipient_email ? "; email delivery is not configured" : ""}`,
      );
      setOpen(false);
      invites.load();
    } catch (e: unknown) {
      toast.error(errorMessage(e));
    }
  }
  return (
    <>
      <section className="panel">
        <div className="panelhead">
          <div>
            <h3>Selected teams awaiting portal invite</h3>
            <small>
              These teams have been selected and still need a personal portal
              invitation.
            </small>
          </div>
        </div>
        {registrations.data
          .filter(
            (r: Row) =>
              (r.selected || r.selection_email_sent_at) &&
              !r.portal_invitation_sent_at,
          )
          .map((r: Row) => (
            <div className="portal-row invite-row" key={r.id}>
              <span>
                <b>{r.club_name}</b>
                <small>{r.email}</small>
              </span>
              <Badge>Ready for invite</Badge>
            </div>
          ))}
        {!registrations.data.some(
          (r: Row) =>
            (r.selected || r.selection_email_sent_at) &&
            !r.portal_invitation_sent_at,
        ) && <Empty text="No selected teams are waiting for a portal invite" />}
      </section>
      <section className="panel">
        <div className="panelhead">
          <h3>Team invites</h3>
          <button className="btn primary" onClick={() => setOpen(true)}>
            <Plus /> Create invite
          </button>
        </div>
        <div className="portal-table">
          {invites.data.map((i) => (
            <div className="portal-row invite-row" key={i.id}>
              <code>{i.code}</code>
              <span>
                <b>{teamName(teams.data, i.team_id)}</b>
                <small>{i.recipient_email || "Link only"}</small>
              </span>
              <Badge>{i.used ? "Used" : "Unused"}</Badge>
              <span>{fmtDate(i.expires_at)}</span>
              <div className="row-actions">
                <button
                  onClick={async () => {
                    await api(`/invites/${i.id}/resend`, { method: "POST" });
                    toast.success("Invite resend recorded");
                  }}
                >
                  Resend
                </button>
                <Confirm
                  title="Delete invite"
                  text="Delete this invite code?"
                  onConfirm={async () => {
                    await api(`/invites/${i.id}`, { method: "DELETE" });
                    invites.load();
                  }}
                >
                  <button className="danger-link">Delete</button>
                </Confirm>
              </div>
            </div>
          ))}
        </div>
        <Modal title="Create team invite" open={open} onOpenChange={setOpen}>
          <form className="portal-form" onSubmit={create}>
            <Field
              label="Team"
              name="team_id"
              children={
                <select name="team_id" required>
                  <option value="">Choose team</option>
                  {teams.data.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              }
            />
            <Field
              label="Recipient email (optional)"
              name="recipient_email"
              type="email"
            />
            <FormButtons busy={false} onCancel={() => setOpen(false)} />
          </form>
        </Modal>
      </section>
    </>
  );
}

function Finance({
  refresh,
  admin = false,
}: {
  refresh: number;
  admin?: boolean;
}) {
  const finance = useData<{
      settings?: Row;
      invoices?: Row[];
      payments?: Row[];
      costs?: Row[];
    }>("/finance", refresh),
    teams = useData("/teams", refresh),
    approval = useData<Row | Row[]>(
      admin ? "/team-reviews" : "/team-review",
      refresh,
    ),
    [tab, setTab] = useState("overview"),
    [editing, setEditing] = useState<Row | null>(null),
    invoices = finance.data?.invoices || [],
    payments = finance.data?.payments || [],
    costs = finance.data?.costs || [],
    teamReview = !admin && !Array.isArray(approval.data) ? approval.data : {},
    teamApprovalStatus =
      teamReview.team?.review_status ||
      teamReview.review_status ||
      "information_incomplete";
  const legacyUnpaid = costs.filter((cost: Row) => cost.status !== "paid"),
    legacyOutstanding = legacyUnpaid.reduce(
      (sum: number, cost: Row) => sum + Number(cost.amount || 0),
      0,
    ),
    paid = payments.reduce(
      (sum, payment) => sum + Number(payment.amount || 0),
      0,
    ),
    invoiced = invoices.reduce(
      (sum, invoice) => sum + Number(invoice.total_amount || 0),
      0,
    );
  async function issue(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    try {
      await api("/finance/issue", {
        method: "POST",
        body: JSON.stringify(Object.fromEntries(new FormData(e.currentTarget))),
      });
      toast.success("Invoice issued");
      finance.load();
      setEditing(null);
    } catch (error: unknown) {
      toast.error(errorMessage(error));
    }
  }
  async function record(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    try {
      const body: any = Object.fromEntries(new FormData(e.currentTarget));
      body.method = "BANK_TRANSFER";
      body.reference =
        body.reference ||
        invoices.find((invoice: Row) => invoice.id === editing?.invoice_id)
          ?.invoice_number ||
        "";
      body.idempotency_key = crypto.randomUUID();
      setEditing(null);
      await api("/finance/record-payment", {
        method: "POST",
        body: JSON.stringify(body),
      });
      toast.success("Payment recorded");
      finance.load();
    } catch (error: unknown) {
      toast.error(errorMessage(error));
    }
  }
  useEffect(() => {
    if (editing?.form !== "payment") return;
    const reference =
      invoices.find((invoice: Row) => invoice.id === editing.invoice_id)
        ?.invoice_number || "";
    if (!reference) return;
    requestAnimationFrame(() => {
      const input = document.querySelector<HTMLInputElement>(
        'input[name="reference"]',
      );
      if (input) {
        input.value = reference;
        input.defaultValue = reference;
      }
    });
  }, [editing]);
  async function saveSettings(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    try {
      await api("/finance/settings", {
        method: "POST",
        body: JSON.stringify(Object.fromEntries(new FormData(e.currentTarget))),
      });
      toast.success("Finance settings saved");
      finance.load();
    } catch (error: unknown) {
      toast.error(errorMessage(error));
    }
  }
  async function removeInvoice(invoice: Row) {
    const hasPayments = payments.some(
      (payment) => payment.invoice_id === invoice.id,
    );
    try {
      const result = await api(`/finance/invoices/${invoice.id}`, {
        method: "DELETE",
      });
      toast.success(
        result.cancelled || hasPayments
          ? "Invoice cancelled because it has payments"
          : "Invoice deleted",
      );
      finance.load();
    } catch (error: unknown) {
      toast.error(errorMessage(error));
    }
  }
  if (!admin)
    return (
      <TeamPaymentsSimple finance={finance.data || {}} approval={teamReview} />
    );
  return (
    <>
      <div className="finance-tabs">
        <button
          className={tab === "overview" ? "active" : ""}
          onClick={() => setTab("overview")}
        >
          Overview
        </button>
        <button
          className={tab === "invoices" ? "active" : ""}
          onClick={() => setTab("invoices")}
        >
          Invoices
        </button>
        <button
          className={tab === "payments" ? "active" : ""}
          onClick={() => setTab("payments")}
        >
          Payments
        </button>
        <button
          className={tab === "settings" ? "active" : ""}
          onClick={() => setTab("settings")}
        >
          Settings
        </button>
      </div>
      {tab === "overview" && (
        <>
          <div className="cards cost">
            <article>
              <small>Invoice total</small>
              <b>{fmtMoney(invoiced)}</b>
            </article>
            <article>
              <small>Invoice payments received</small>
              <b>{fmtMoney(paid)}</b>
            </article>
            <article>
              <small>Invoice balance</small>
              <b>{fmtMoney(Math.max(0, invoiced - paid))}</b>
            </article>
            <article>
              <small>Unpaid costs</small>
              <b>{fmtMoney(legacyOutstanding)}</b>
            </article>
          </div>
          <section className="panel">
            <div className="panelhead">
              <div>
                <h3>Unpaid costs</h3>
                <small>
                  Existing accommodation and other cost records. These are shown
                  separately from issued invoices.
                </small>
              </div>
            </div>
            <div className="portal-table">
              {legacyUnpaid.map((cost: Row) => (
                <div className="portal-row payment-row" key={cost.id}>
                  <span>
                    <b>
                      {cost.team_name || teamName(teams.data, cost.team_id)}
                    </b>
                    <small>{cost.description}</small>
                  </span>
                  <b>{fmtMoney(cost.amount)}</b>
                  <Badge>{cost.status}</Badge>
                  <span>{fmtDate(cost.due_date)}</span>
                </div>
              ))}
              {!legacyUnpaid.length && <Empty text="No unpaid costs" />}
            </div>
          </section>
          <section className="panel">
            <div className="panelhead">
              <div>
                <h3>Invoice progress by team</h3>
                <small>
                  Only issued invoices and finance payment records are included
                  here.
                </small>
              </div>
            </div>
            <div className="finance-team-grid">
              {teams.data.map((team: Row) => {
                const rows = invoices.filter(
                    (invoice) => invoice.team_id === team.id,
                  ),
                  total = rows.reduce(
                    (sum, invoice) => sum + Number(invoice.total_amount || 0),
                    0,
                  ),
                  received = payments
                    .filter((payment) => payment.team_id === team.id)
                    .reduce(
                      (sum, payment) => sum + Number(payment.amount || 0),
                      0,
                    );
                return (
                  <article key={team.id}>
                    <TeamMark team={team} />
                    <span>
                      <b>{team.name}</b>
                      <small>
                        {fmtMoney(received)} of {fmtMoney(total)} received
                      </small>
                    </span>
                    <strong>
                      {total ? `${Math.round((received / total) * 100)}%` : "—"}
                    </strong>
                  </article>
                );
              })}
            </div>
          </section>
        </>
      )}
      {!admin && (
        <section className="panel payment-approval">
          <div className="panelhead">
            <div>
              <span className="eyebrow">Approved financial snapshot</span>
              <h3>Payment</h3>
              <small>
                Your payment amount is based on the information approved by both
                your team and PCF BATTLE.
              </small>
            </div>
            <Badge>
              {teamApprovalStatus === "approved_payment_open"
                ? "Payment available"
                : teamApprovalStatus || "Information incomplete"}
            </Badge>
          </div>
          {teamApprovalStatus === "approved_payment_open" ? (
            <>
              <div className="payment-summary-grid">
                <article>
                  <small>Payable delegation</small>
                  <b>{teamReview.members?.length || 0} people</b>
                  <span>
                    {fmtMoney(teamReview.pricing?.unitPrice || 0)} per person
                  </span>
                </article>
                <article>
                  <small>Participation fee</small>
                  <b>
                    {fmtMoney(teamReview.pricing?.participantSubtotal || 0)}
                  </b>
                  <span>Based on approved delegation</span>
                </article>
                <article>
                  <small>Single-room supplements</small>
                  <b>
                    {fmtMoney(teamReview.pricing?.accommodationSupplement || 0)}
                  </b>
                  <span>
                    {teamReview.pricing?.singleRoomCount || 0} single room(s)
                  </span>
                </article>
                <article className="payment-total">
                  <small>Approved total</small>
                  <b>{fmtMoney(teamReview.pricing?.total || 0)}</b>
                  <span>Final approved amount</span>
                </article>
              </div>
              <div className="payment-schedule">
                <div>
                  <span>
                    Deposit · {teamReview.pricing?.depositPercentage || 30}%
                  </span>
                  <b>{fmtMoney(teamReview.pricing?.deposit || 0)}</b>
                </div>
                <div>
                  <span>
                    Remaining balance ·{" "}
                    {100 - (teamReview.pricing?.depositPercentage || 30)}%
                  </span>
                  <b>{fmtMoney(teamReview.pricing?.balance || 0)}</b>
                </div>
              </div>
              <div className="payment-next-step">
                <b>Payment options</b>
                <span>
                  {invoices.length
                    ? "Your invoice is available below. Online payment will appear when the payment provider is connected."
                    : "Admin still needs to issue the invoice/payment request. You will then be able to choose invoice/bank transfer or online payment."}
                </span>
              </div>
            </>
          ) : (
            <div className="payment-locked">
              <b>Payment is not available yet</b>
              <span>
                Complete <strong>Review & confirm</strong>. Payment opens only
                after Admin has reviewed and approved the confirmed information.
              </span>
            </div>
          )}
        </section>
      )}
      {tab === "invoices" && (
        <section className="panel">
          <div className="panelhead">
            <h3>Invoices</h3>
            {admin && (
              <button
                className="btn primary"
                onClick={() => setEditing({ form: "invoice" })}
              >
                Issue invoice
              </button>
            )}
          </div>
          <div className="portal-table">
            {invoices.map((invoice) => {
              const hasPayments = payments.some(
                (payment) => payment.invoice_id === invoice.id,
              );
              return (
                <div className="portal-row payment-row" key={invoice.id}>
                  <span>
                    <b>{invoice.invoice_number}</b>
                    <small>
                      {invoice.team_name} · {invoice.participant_count} people
                    </small>
                  </span>
                  <b>{fmtMoney(invoice.total_amount)}</b>
                  <Badge>{invoice.status}</Badge>
                  <span>{fmtDate(invoice.due_at)}</span>
                  {admin && (
                    <>
                      <button
                        onClick={() =>
                          setEditing({
                            form: "payment",
                            invoice_id: invoice.id,
                          })
                        }
                      >
                        Record payment
                      </button>
                      {invoice.status !== "cancelled" && (
                        <Confirm
                          title={
                            hasPayments ? "Cancel invoice" : "Delete invoice"
                          }
                          text={
                            hasPayments
                              ? "This invoice has payments and will be cancelled to preserve its financial history."
                              : "Delete this unpaid invoice? This cannot be undone."
                          }
                          onConfirm={() => removeInvoice(invoice)}
                        >
                          <button className="danger-link" type="button">
                            {hasPayments ? "Cancel invoice" : "Delete"}
                          </button>
                        </Confirm>
                      )}
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}
      {tab === "payments" && (
        <section className="panel">
          <div className="panelhead">
            <h3>Payment history</h3>
          </div>
          <div className="portal-table">
            {payments.map((payment) => (
              <div className="portal-row payment-row" key={payment.id}>
                <span>
                  <b>{payment.invoice_number}</b>
                  <small>
                    {payment.method} · {payment.reference || "No reference"}
                  </small>
                </span>
                <b>{fmtMoney(payment.amount)}</b>
                <span>{fmtDate(payment.received_at)}</span>
              </div>
            ))}
          </div>
        </section>
      )}
      {tab === "settings" && (
        <section className="panel">
          <div className="panelhead">
            <div>
              <h3>Finance settings</h3>
              <small>These values are used for future invoices.</small>
            </div>
          </div>
          <form className="portal-form" onSubmit={saveSettings}>
            <Field
              label="Price per person"
              name="price_per_person"
              type="number"
              defaultValue={finance.data?.settings?.price_per_person || 325}
              required
            />
            <Field
              label="Deposit percentage"
              name="deposit_percentage"
              type="number"
              defaultValue={finance.data?.settings?.deposit_percentage || 30}
              required
            />
            <Field
              label="Legal organization name"
              name="legal_name"
              defaultValue={finance.data?.settings?.legal_name || ""}
            />
            <Field
              label="IBAN"
              name="iban"
              defaultValue={finance.data?.settings?.iban || ""}
            />
            <Field
              label="BIC"
              name="bic"
              defaultValue={finance.data?.settings?.bic || ""}
            />
            <Field
              label="Bank name"
              name="bank_name"
              defaultValue={finance.data?.settings?.bank_name || ""}
            />
            <FormButtons busy={false} onCancel={() => undefined} />
          </form>
        </section>
      )}
      {admin && editing?.form === "invoice" && (
        <Modal title="Issue invoice" open onOpenChange={() => setEditing(null)}>
          <form className="portal-form" onSubmit={issue}>
            <Field
              label="Team"
              name="team_id"
              children={
                <select name="team_id" required>
                  <option value="">Choose team</option>
                  {teams.data.map((team: Row) => (
                    <option key={team.id} value={team.id}>
                      {team.name}
                    </option>
                  ))}
                </select>
              }
            />
            <p className="form-help wide">
              The delegation count, base price and single-room supplements are
              calculated automatically from the team&apos;s approved review
              snapshot.
            </p>
            <Field label="Due date" name="due_at" type="date" />
            <FormButtons busy={false} onCancel={() => setEditing(null)} />
          </form>
        </Modal>
      )}
      {admin && editing?.form === "payment" && (
        <Modal
          title="Record payment"
          open
          onOpenChange={() => setEditing(null)}
        >
          <form className="portal-form" onSubmit={record}>
            <input type="hidden" name="invoice_id" value={editing.invoice_id} />
            <Field label="Amount" name="amount" type="number" required />
            <Field
              label="Method"
              name="method"
              children={
                <select name="method">
                  <option value="BANK_TRANSFER">Bank transfer</option>
                </select>
              }
            />
            <Field label="Payment reference" name="reference" />
            <Field
              label="Date received"
              name="received_at"
              type="date"
              defaultValue={new Date().toISOString().slice(0, 10)}
              required
            />
            <Field label="Internal note" name="note" />
            <FormButtons busy={false} onCancel={() => setEditing(null)} />
          </form>
        </Modal>
      )}
    </>
  );
}

function AdminFinanceSimple({ refresh }: { refresh: number }) {
  const finance = useData<{
      settings?: Row;
      invoices?: Row[];
      payments?: Row[];
      costs?: Row[];
    }>("/finance", refresh),
    teams = useData<Row[]>("/teams", refresh),
    reviews = useData<Row[]>("/team-reviews", refresh),
    [editing, setEditing] = useState<Row | null>(null),
    [tab, setTab] = useState<"overview" | "history">("overview");
  const invoices = finance.data?.invoices || [],
    payments = finance.data?.payments || [],
    invoiced = invoices.reduce(
      (sum, invoice) => sum + Number(invoice.total_amount || 0),
      0,
    ),
    received = payments.reduce(
      (sum, payment) => sum + Number(payment.amount || 0),
      0,
    ),
    outstanding = Math.max(0, invoiced - received),
    waiting = reviews.data.filter(
      (team: Row) => team.review_status === "awaiting_admin",
    ).length,
    approved = reviews.data.filter(
      (team: Row) => team.review_status === "approved_payment_open",
    ).length;
  async function record(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    try {
      const body: any = Object.fromEntries(new FormData(e.currentTarget));
      body.method = "BANK_TRANSFER";
      body.reference =
        body.reference ||
        editing?.reference ||
        invoices.find((invoice: Row) => invoice.id === editing?.invoice_id)
          ?.invoice_number ||
        "";
      body.idempotency_key = crypto.randomUUID();
      setEditing(null);
      await api("/finance/record-payment", {
        method: "POST",
        body: JSON.stringify(body),
      });
      toast.success("Payment recorded");
      finance.load();
    } catch (error: unknown) {
      toast.error(errorMessage(error));
    }
  }
  useEffect(() => {
    if (editing?.form !== "payment") return;
    const reference =
      invoices.find((invoice: Row) => invoice.id === editing.invoice_id)
        ?.invoice_number || "";
    if (!reference) return;
    requestAnimationFrame(() => {
      const input = document.querySelector<HTMLInputElement>(
        'input[name="reference"]',
      );
      if (input) {
        input.value = reference;
        input.defaultValue = reference;
      }
    });
  }, [editing]);
  async function resetPayments() {
    const password = window.prompt(
      "Enter an admin password to reset all payment records",
    );
    if (!password) return;
    try {
      const result = await api("/finance/reset", {
        method: "POST",
        body: JSON.stringify({ password }),
      });
      toast.success(
        `${Number(result.deleted?.invoices || 0) + Number(result.deleted?.financePayments || 0) + Number(result.deleted?.legacyPayments || 0)} payment records reset`,
      );
      finance.load();
    } catch (error: unknown) {
      toast.error(errorMessage(error));
    }
  }
  return (
    <section className="admin-finance-simple">
      <div className="admin-finance-header">
        <div>
          <span className="eyebrow">Finance</span>
          <h2>Payment journey</h2>
          <p>
            Review → Confirm → Registration Review → Deposit → Remaining balance → Tournament Ready.
          </p>
        </div>
        <Confirm
          title="Reset all payment records?"
          text="This permanently deletes invoices, recorded finance payments and legacy payment records. This cannot be undone."
          onConfirm={resetPayments}
        >
          <button className="btn danger" type="button">
            Reset payment data
          </button>
        </Confirm>
      </div>
      <div className="admin-finance-cards">
        <article>
          <small>Waiting for Admin review</small>
          <b>{waiting}</b>
        </article>
        <article>
          <small>Payment opened</small>
          <b>{approved}</b>
        </article>
        <article>
          <small>Received</small>
          <b>{fmtMoney(received)}</b>
        </article>
        <article>
          <small>Outstanding</small>
          <b>{fmtMoney(outstanding)}</b>
        </article>
      </div>
      <div className="admin-finance-tabs">
        <button
          className={tab === "overview" ? "active" : ""}
          onClick={() => setTab("overview")}
        >
          Payment journey
        </button>
        <button
          className={tab === "history" ? "active" : ""}
          onClick={() => setTab("history")}
        >
          Payment history
        </button>
      </div>
      {tab === "overview" && (
        <section className="panel">
          <div className="panelhead">
            <div>
              <h3>Team payment status</h3>
              <small>
                Approve submissions and follow each team through the same steps
                as the Team Portal.
              </small>
            </div>
          </div>
          <div className="admin-payment-team-list">
            {reviews.data.map((review: Row) => {
              const team =
                  teams.data.find((item: Row) => item.id === review.id) ||
                  review,
                rows = invoices.filter(
                  (invoice) => invoice.team_id === review.id,
                ),
                deposit = rows.find(
                  (invoice) =>
                    invoice.invoice_type === "DEPOSIT" &&
                    invoice.status !== "cancelled",
                ),
                balance = rows.find(
                  (invoice) =>
                    invoice.invoice_type === "BALANCE" &&
                    invoice.status !== "cancelled",
                ),
                paid = payments
                  .filter((payment) => payment.invoice_id === deposit?.id)
                  .reduce(
                    (sum, payment) => sum + Number(payment.amount || 0),
                    0,
                  ),
                total = Number(deposit?.total_amount || 0),
                balanceTotal = Number(balance?.total_amount || 0),
                balancePaid = payments
                  .filter((payment) => payment.invoice_id === balance?.id)
                  .reduce(
                    (sum, payment) => sum + Number(payment.amount || 0),
                    0,
                  ),
                depositComplete = total > 0 && paid >= total,
                balanceComplete = balanceTotal > 0 && balancePaid >= balanceTotal,
                state = review.review_status || "information_incomplete",
                label =
                  state === "awaiting_admin"
                    ? "Approve submission"
                    : state === "approved_payment_open"
                      ? balanceComplete
                        ? "Completed"
                        : depositComplete
                          ? "Remaining balance due"
                          : total
                            ? "Deposit due"
                          : "Payment opened"
                      : state === "changes_requested"
                        ? "Changes requested"
                        : "Not submitted";
              return (
                <article
                  className={`admin-payment-team${balanceComplete ? " completed" : ""}`}
                  key={review.id}
                >
                  <div className="admin-payment-team-head">
                    <TeamMark team={team} />
                    <div>
                      <h4>{team.name || review.name}</h4>
                      <small>{label}</small>
                    </div>
                    <Badge>{label}</Badge>
                  </div>
                  <div className="admin-payment-mini-progress">
                    <span
                      className={
                        state !== "information_incomplete" ? "done" : "current"
                      }
                    >
                      1 <b>Review</b>
                    </span>
                    <span
                      className={
                        state === "awaiting_admin" ||
                        state === "approved_payment_open"
                          ? "done"
                          : "current"
                      }
                    >
                      2 <b>Confirm</b>
                    </span>
                    <span
                      className={
                        state === "approved_payment_open"
                          ? "done"
                          : state === "awaiting_admin"
                            ? "current"
                            : "locked"
                      }
                    >
                      3 <b>Admin approval</b>
                    </span>
                    <span
                      className={
                        state === "approved_payment_open"
                          ? depositComplete
                            ? "done"
                            : "current"
                          : "locked"
                      }
                    >
                      4 <b>Deposit</b>
                    </span>
                    <span
                      className={
                        state === "approved_payment_open" &&
                        balanceComplete
                          ? "done"
                          : "locked"
                      }
                    >
                      5 <b>Remaining balance</b>
                    </span>
                    <span
                      className={
                        state === "approved_payment_open" && balanceComplete
                          ? "done"
                          : "locked"
                      }
                    >
                      6 <b>Completed</b>
                    </span>
                  </div>
                  <div className="admin-payment-team-bottom">
                    {deposit && (
                      <span>
                        <small>Deposit</small>
                        <b>{fmtMoney(total)}</b>
                        <em>Paid {fmtMoney(paid)}</em>
                      </span>
                    )}
                    {balance && (
                      <span className="admin-payment-balance-summary">
                        <small>Remaining balance</small>
                        <b>Due date {fmtDate(balance.due_at)}</b>
                        <em>
                          Paid {fmtMoney(balancePaid)} · Outstanding {fmtMoney(Math.max(0, balanceTotal - balancePaid))}
                        </em>
                      </span>
                    )}
                    {state === "awaiting_admin" && (
                      <button
                        className="btn primary"
                        onClick={async () => {
                          try {
                            await api("/team-review/admin", {
                              method: "POST",
                              body: JSON.stringify({
                                team_id: review.id,
                                action: "approve",
                              }),
                            });
                            toast.success("Costs approved and payment opened");
                            reviews.load();
                            finance.load();
                          } catch (error: unknown) {
                            toast.error(errorMessage(error));
                          }
                        }}
                      >
                        Approve & open payment
                      </button>
                    )}
                    {state === "approved_payment_open" &&
                      deposit &&
                      paid < total && (
                        <button
                          className="btn"
                          onClick={() =>
                            setEditing({
                              form: "payment",
                              invoice_id: deposit.id,
                              outstanding: Math.max(0, total - paid),
                            })
                          }
                        >
                          Record payment
                        </button>
                      )}
                    {state === "approved_payment_open" &&
                      depositComplete &&
                      balance &&
                      !balanceComplete && (
                        <button
                          className="btn"
                          onClick={() =>
                            setEditing({
                              form: "payment",
                              invoice_id: balance.id,
                              outstanding: Math.max(0, balanceTotal - balancePaid),
                            })
                          }
                        >
                          Record balance payment
                        </button>
                      )}
                  </div>
                </article>
              );
            })}
            {!reviews.data.length && <Empty text="No team submissions yet" />}
          </div>
        </section>
      )}
      {tab === "history" && (
        <section className="panel">
          <div className="panelhead">
            <h3>Payment history</h3>
          </div>
          <div className="portal-table">
            {payments.map((payment) => (
              <div className="portal-row payment-row" key={payment.id}>
                <span>
                  <b>{payment.team_name || payment.invoice_number}</b>
                  <small>
                    {payment.method} · {payment.reference || "No reference"}
                  </small>
                </span>
                <b>{fmtMoney(payment.amount)}</b>
                <span>{fmtDate(payment.received_at)}</span>
              </div>
            ))}
            {!payments.length && <Empty text="No payments recorded" />}
          </div>
        </section>
      )}
      {editing?.form === "payment" && (
        <Modal
          title="Record payment"
          open
          onOpenChange={() => setEditing(null)}
        >
          <form className="portal-form" onSubmit={record}>
            <input type="hidden" name="invoice_id" value={editing.invoice_id} />
            <Field
              label="Amount"
              name="amount"
              type="number"
              defaultValue={editing.outstanding}
              required
            />
            <Field
              label="Method"
              name="method"
              children={
                <select name="method">
                  <option value="BANK_TRANSFER">Bank transfer</option>
                  <option value="ONLINE">Online</option>
                  <option value="CASH">Cash</option>
                </select>
              }
            />
            <Field label="Payment reference" name="reference" />
            <Field
              label="Date received"
              name="received_at"
              type="date"
              required
            />
            <Field label="Internal note" name="note" />
            <FormButtons busy={false} onCancel={() => setEditing(null)} />
          </form>
        </Modal>
      )}
    </section>
  );
}

function FinanceSettingsPanel({ refresh }: { refresh: number }) {
  const finance = useData<{ settings?: Row }>("/finance", refresh);
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    try {
      await api("/finance/settings", {
        method: "POST",
        body: JSON.stringify(Object.fromEntries(new FormData(e.currentTarget))),
      });
      toast.success("Finance settings saved");
      finance.load();
    } catch (error: unknown) {
      toast.error(errorMessage(error));
    }
  }
  const settings = finance.data?.settings || {};
  return (
    <section className="panel admin-finance-settings">
      <div className="panelhead">
        <div>
          <span className="eyebrow">Finance settings</span>
          <h3>Bank transfer details</h3>
          <small>
            These details are shown to teams in the Team Portal payment
            instructions.
          </small>
        </div>
      </div>
      <form className="portal-form" onSubmit={save}>
        <Field
          label="IBAN"
          name="iban"
          defaultValue={settings.iban || ""}
          required
        />
        <Field
          label="Bank name"
          name="bank_name"
          defaultValue={settings.bank_name || ""}
          required
        />
        <Field label="BIC" name="bic" defaultValue={settings.bic || ""} />
        <Field
          label="Legal organization name"
          name="legal_name"
          defaultValue={settings.legal_name || ""}
        />
        <FormButtons busy={false} onCancel={() => undefined} />
      </form>
    </section>
  );
}

function TeamPaymentsSimple({
  finance,
  approval,
}: {
  finance: Row;
  approval: Row;
}) {
  const invoices = finance.invoices || [],
    payments = finance.payments || [],
    settings = finance.settings || {},
    status =
      approval.team?.review_status ||
      approval.review_status ||
      "information_incomplete",
    pricing = approval.pricing || {},
    deposit = invoices.find(
      (item: Row) =>
        item.invoice_type === "DEPOSIT" && item.status !== "cancelled",
    ),
    balance = invoices.find(
      (item: Row) =>
        item.invoice_type === "BALANCE" && item.status !== "cancelled",
    ),
    depositPayments = deposit
      ? payments.filter((payment: Row) => payment.invoice_id === deposit.id)
      : [],
    balancePayments = balance
      ? payments.filter((payment: Row) => payment.invoice_id === balance.id)
      : [],
    depositPaid = depositPayments.reduce(
      (sum: number, payment: Row) => sum + Number(payment.amount || 0),
      0,
    ),
    balancePaid = balancePayments.reduce(
      (sum: number, payment: Row) => sum + Number(payment.amount || 0),
      0,
    ),
    depositAmount = Number(pricing.deposit || deposit?.total_amount || 0),
    balanceAmount = Number(pricing.balance || balance?.total_amount || 0),
    depositComplete = depositPaid >= depositAmount && depositAmount > 0,
    balanceComplete = balanceAmount > 0 && balancePaid >= balanceAmount,
    dueDate = deposit?.due_at || null,
    finalDueDate =
      balance?.due_at ||
      (() => {
        const days = Number(settings.final_due_days || 30);
        const date = new Date();
        date.setDate(date.getDate() + days);
        return date.toISOString().slice(0, 10);
      })();
  settings.bic = settings.bic || "—";
  useEffect(() => {
    if (!settings.bank_name && !settings.legal_name) return;
    document
      .querySelectorAll<HTMLElement>(".bank-transfer-box dl")
      .forEach((list) => {
        if (list.querySelector("[data-bank-account-name]")) return;
        const holderLabel = document.createElement("dt");
        holderLabel.dataset.bankAccountName = "true";
        holderLabel.textContent = "Account holder";
        const holderValue = document.createElement("dd");
        holderValue.dataset.bankAccountName = "true";
        holderValue.textContent =
          settings.legal_name || "Team Belgium Powerchair Hockey VZW";
        const bankLabel = document.createElement("dt");
        bankLabel.dataset.bankAccountName = "true";
        bankLabel.textContent = "Bank Name";
        const bankValue = document.createElement("dd");
        bankValue.dataset.bankAccountName = "true";
        bankValue.textContent = settings.bank_name || "—";
        list.insertBefore(bankLabel, list.firstChild);
        list.insertBefore(bankValue, bankLabel.nextSibling);
        list.insertBefore(holderLabel, list.firstChild);
        list.insertBefore(holderValue, holderLabel.nextSibling);
      });
  }, [settings.bank_name, settings.legal_name]);
  const paymentOpen = status === "approved_payment_open" && Boolean(deposit);
  const phase = !paymentOpen
    ? status === "awaiting_admin"
      ? "admin"
      : status === "approved_payment_open"
        ? "payment_setup"
        : "review"
    : !depositComplete
      ? "deposit"
      : balanceComplete
        ? "complete"
        : "balance";
  const step = (
    key: string,
    label: string,
    detail: string,
    state: "done" | "current" | "locked",
  ) => (
    <div className={`payment-step ${state}`}>
      <span className="payment-step-marker">
        {state === "done" ? "✓" : key}
      </span>
      <div>
        <b>{label === "Admin approval" ? "Registration Review" : label}</b>
        <small>{detail}</small>
      </div>
    </div>
  );
  return (
    <section className="team-payments-simple">
      <div className="team-payment-hero">
        <div>
          <span className="eyebrow">PCF BATTLE payment</span>
          <h2>Your payment plan</h2>
          <p>Follow the steps below. Your next action is always highlighted.</p>
        </div>
        <span
          className={`status-pill ${phase === "complete" ? "confirmed" : phase === "review" || phase === "payment_setup" ? "pending" : "confirmed"}`}
        >
          {phase === "complete"
            ? "Completed"
            : phase === "review"
              ? "Action required"
              : phase === "admin"
                ? "Awaiting Admin approval"
                : phase === "payment_setup"
                  ? "Payment being prepared"
                  : phase === "deposit"
                    ? "Deposit due"
                    : "Balance due"}
        </span>
      </div>
      <div className="payment-progress" aria-label="Payment progress">
        {step(
          "1",
          "Review",
          "Check your tournament information",
          status !== "information_incomplete" ? "done" : "current",
        )}
        {step(
          "2",
          "Confirm",
          "Tell us everything is correct",
          status === "awaiting_admin" || status === "approved_payment_open"
            ? "done"
            : "current",
        )}
        {step(
          "3",
          "Admin approval",
          "PCF BATTLE verifies the costs",
          status === "approved_payment_open"
            ? "done"
            : status === "awaiting_admin"
              ? "current"
              : "locked",
        )}
        {step(
          "4",
          "Deposit",
          fmtMoney(depositAmount),
          phase === "deposit"
            ? "current"
            : phase === "balance" || phase === "complete"
              ? "done"
              : "locked",
        )}
        {step(
          "5",
          "Remaining balance",
          fmtMoney(balanceAmount),
          phase === "balance"
            ? "current"
            : phase === "complete"
              ? "done"
              : "locked",
        )}
        {step(
          "6",
          "Completed",
          "All payments received",
          phase === "complete" ? "done" : "locked",
        )}
      </div>
      {!paymentOpen ? (
        <div className="team-payment-locked">
          <h3>
            {status === "awaiting_admin"
              ? "Your information is waiting for Admin approval"
              : status === "approved_payment_open"
                ? "Your payment request is being prepared"
                : "Review & confirm your information"}
          </h3>
          <p>
            {status === "awaiting_admin"
              ? "Payment will open as soon as PCF BATTLE approves the submitted costs."
              : status === "approved_payment_open"
                ? "Your costs are approved. PCF BATTLE is preparing the deposit payment request."
                : "Complete the Review & confirm step first. No payment is available until Admin has approved your submission."}
          </p>
        </div>
      ) : (
        <>
          <div className="team-payment-total">
            <span>Approved participation cost</span>
            <strong>{fmtMoney(pricing.total || 0)}</strong>
            <small>
              {approval.members?.length || 0} delegation members ·{" "}
              {fmtMoney(pricing.unitPrice || 0)} per person ·{" "}
              {pricing.singleRoomCount || 0} single-room supplement(s)
            </small>
          </div>
          <div className="team-payment-breakdown">
            <article>
              <small>Participation fee</small>
              <b>{fmtMoney(pricing.participantSubtotal || 0)}</b>
              <span>
                {approval.members?.length || 0} ×{" "}
                {fmtMoney(pricing.unitPrice || 0)}
              </span>
            </article>
            <article>
              <small>Single-room supplements</small>
              <b>{fmtMoney(pricing.accommodationSupplement || 0)}</b>
              <span>{pricing.singleRoomCount || 0} room(s)</span>
            </article>
            <article>
              <small>Total paid</small>
              <b>{fmtMoney(depositPaid)}</b>
              <span>Recorded by PCF BATTLE</span>
            </article>
          </div>
          <section
            className={`team-payment-card payment-stage-card ${phase === "deposit" ? "current" : depositComplete ? "completed" : ""}`}
          >
            <div className="team-payment-card-head">
              <div>
                <span className="eyebrow">Step 4</span>
                <h3>Deposit</h3>
              </div>
              <span
                className={`status-pill ${depositComplete ? "confirmed" : "pending"}`}
              >
                {depositComplete
                  ? "Paid"
                  : depositPaid
                    ? "Partially paid"
                    : "Due"}
              </span>
            </div>
            <div className="team-payment-amount">
              <span>30% of the approved total</span>
              <strong>{fmtMoney(depositAmount)}</strong>
            </div>
            <div className="team-payment-meta">
              <span>
                Due date<b>{fmtDate(dueDate)}</b>
              </span>
              <span>
                Paid<b>{fmtMoney(depositPaid)}</b>
              </span>
              <span>
                Outstanding
                <b>{fmtMoney(Math.max(0, depositAmount - depositPaid))}</b>
              </span>
            </div>
            {!depositComplete && (
              <div className="bank-transfer-box">
                <h4>How to pay the deposit</h4>
                <p>
                  Choose your preferred payment method. Online payment can be
                  connected later; bank transfer details are shown below.
                </p>
                {settings.iban && (
                  <dl>
                    <dt>IBAN</dt>
                    <dd>{settings.iban}</dd>
                    <dt>BIC</dt>
                    <dd>{settings.bic || "—"}</dd>
                    <dt>Reference</dt>
                    <dd>{deposit?.invoice_number || "PCF-BATTLE-DEPOSIT"}</dd>
                  </dl>
                )}
              </div>
            )}
          </section>
          <section
            className={`team-payment-card payment-stage-card ${phase === "balance" ? "current" : balanceComplete ? "completed" : "locked"}`}
          >
            <div className="team-payment-card-head">
              <div>
                <span className="eyebrow">Step 5</span>
                <h3>Remaining balance</h3>
              </div>
              <span
                className={`status-pill ${balanceComplete ? "confirmed" : depositComplete ? "pending" : "pending"}`}
              >
                {balanceComplete
                  ? "Paid"
                  : depositComplete
                    ? balanceAmount > 0
                      ? "Ready to pay"
                      : "No balance"
                    : "Locked"}
              </span>
            </div>
            <div className="team-payment-amount">
              <span>70% of the approved total</span>
              <strong>{fmtMoney(balanceAmount)}</strong>
            </div>
            <div className="team-payment-meta">
              <span>
                Due date<b>{fmtDate(finalDueDate)}</b>
              </span>
              <span>
                Paid<b>{fmtMoney(balancePaid)}</b>
              </span>
              <span>
                Outstanding
                <b>{fmtMoney(Math.max(0, balanceAmount - balancePaid))}</b>
              </span>
            </div>
          </section>
        </>
      )}
    </section>
  );
}

function Payments({ refresh }: { refresh: number }) {
  const payments = useData("/payments", refresh),
    teams = useData("/teams", refresh),
    [editing, setEditing] = useState<Row | null | undefined>(undefined);
  const total = payments.data.reduce((a, p) => a + Number(p.amount), 0),
    paid = payments.data
      .filter((p) => p.status === "paid")
      .reduce((a, p) => a + Number(p.amount), 0),
    overdue = payments.data
      .filter(
        (p) =>
          p.status !== "paid" &&
          p.due_date &&
          new Date(p.due_date) < new Date(),
      )
      .reduce((a, p) => a + Number(p.amount), 0),
    teamFinance = teams.data.map((team: Row) => {
      const rows = payments.data.filter((p: Row) => p.team_id === team.id),
        billed = rows.reduce(
          (sum: number, p: Row) => sum + Number(p.amount || 0),
          0,
        ),
        settled = rows
          .filter((p: Row) => p.status === "paid")
          .reduce((sum: number, p: Row) => sum + Number(p.amount || 0), 0);
      return { team, billed, settled, open: billed - settled };
    });
  function exportPayments() {
    const cells = (value: unknown) =>
        `"${String(value ?? "").replaceAll('"', '""')}"`,
      csv = [
        ["Team", "Description", "Amount", "Status", "Due date"],
        ...payments.data.map((p: Row) => [
          teamName(teams.data, p.team_id),
          p.description,
          p.amount,
          p.status,
          p.due_date,
        ]),
      ]
        .map((row) => row.map(cells).join(","))
        .join("\n"),
      url = URL.createObjectURL(
        new Blob([csv], { type: "text/csv;charset=utf-8" }),
      ),
      link = document.createElement("a");
    link.href = url;
    link.download = "pcf-battle-payments.csv";
    link.click();
    URL.revokeObjectURL(url);
  }
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const b: any = Object.fromEntries(new FormData(e.currentTarget));
    b.amount = Number(b.amount);
    try {
      editing?.id
        ? await api(`/payments/${editing.id}`, {
            method: "PUT",
            body: JSON.stringify(b),
          })
        : await api("/payments", { method: "POST", body: JSON.stringify(b) });
      toast.success("Payment saved");
      setEditing(undefined);
      payments.load();
    } catch (e: unknown) {
      toast.error(errorMessage(e));
    }
  }
  return (
    <>
      <div className="cards cost">
        <article>
          <small>Total invoiced</small>
          <b>{fmtMoney(total)}</b>
        </article>
        <article>
          <small>Paid</small>
          <b>{fmtMoney(paid)}</b>
        </article>
        <article>
          <small>Outstanding</small>
          <b>{fmtMoney(total - paid)}</b>
        </article>
        <article>
          <small>Past due</small>
          <b>{fmtMoney(overdue)}</b>
        </article>
      </div>
      <section className="panel finance-overview">
        <div className="panelhead">
          <div>
            <h3>Team balances</h3>
            <small>Registration and accommodation charges combined</small>
          </div>
        </div>
        <div className="finance-team-grid">
          {teamFinance.map(({ team, billed, settled, open }: any) => (
            <article key={team.id}>
              <TeamMark team={team} />
              <span>
                <b>{team.name}</b>
                <small>
                  {fmtMoney(settled)} of {fmtMoney(billed)} paid
                </small>
                <i>
                  <em
                    style={{
                      width: `${billed ? Math.min(100, (settled / billed) * 100) : 0}%`,
                    }}
                  />
                </i>
              </span>
              <strong>{fmtMoney(open)}</strong>
            </article>
          ))}
        </div>
      </section>
      <section className="panel">
        <div className="panelhead">
          <h3>Payment tracker</h3>
          <div className="row-actions">
            <button className="btn" onClick={exportPayments}>
              <Download /> Export
            </button>
            <button className="btn primary" onClick={() => setEditing(null)}>
              <Plus /> Add payment
            </button>
          </div>
        </div>
        <div className="portal-table">
          {payments.data.map((p) => (
            <div className="portal-row payment-row" key={p.id}>
              <span>
                <b>{teamName(teams.data, p.team_id)}</b>
                <small>{p.description}</small>
              </span>
              <b>{fmtMoney(p.amount)}</b>
              <Badge>{p.status}</Badge>
              <span>{fmtDate(p.due_date)}</span>
              <div className="row-actions">
                {p.status !== "paid" && (
                  <button
                    onClick={async () => {
                      await api(`/payments/${p.id}/remind`, { method: "POST" });
                      toast.success("Reminder recorded");
                    }}
                  >
                    Remind
                  </button>
                )}
                <button onClick={() => setEditing(p)}>Edit</button>
                <Confirm
                  title="Delete payment"
                  text="Delete this payment record?"
                  onConfirm={async () => {
                    await api(`/payments/${p.id}`, { method: "DELETE" });
                    payments.load();
                  }}
                >
                  <button className="danger-link">Delete</button>
                </Confirm>
              </div>
            </div>
          ))}
        </div>
        <Modal
          title={editing?.id ? "Edit payment" : "Add payment"}
          open={editing !== undefined}
          onOpenChange={(v) => !v && setEditing(undefined)}
        >
          <form className="portal-form" onSubmit={save}>
            <Field
              label="Team"
              name="team_id"
              children={
                <select name="team_id" defaultValue={editing?.team_id} required>
                  <option value="">Choose team</option>
                  {teams.data.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              }
            />
            <Field
              label="Amount"
              name="amount"
              type="number"
              defaultValue={editing?.amount || 800}
              required
            />
            <Field
              label="Description"
              name="description"
              defaultValue={editing?.description || "Tournament registration"}
              required
            />
            <Field
              label="Status"
              name="status"
              children={
                <select
                  name="status"
                  defaultValue={editing?.status || "pending"}
                >
                  <option value="pending">Pending</option>
                  <option value="paid">Paid</option>
                  <option value="overdue">Overdue</option>
                </select>
              }
            />
            <Field
              label="Due date"
              name="due_date"
              type="date"
              defaultValue={editing?.due_date}
            />
            <FormButtons busy={false} onCancel={() => setEditing(undefined)} />
          </form>
        </Modal>
      </section>
    </>
  );
}

function TeamsAdminV2({ refresh }: { refresh: number }) {
  const teams = useData("/teams", refresh),
    [editing, setEditing] = useState<Row | null | undefined>(undefined),
    [busy, setBusy] = useState(false);
  const [teamTab, setTeamTab] = useState("directory");
  useEffect(() => {
    const readTab = () => {
      const value = new URLSearchParams(window.location.search).get("teamTab");
      if (
        ["selected", "registrations", "directory", "invites"].includes(
          value || "",
        )
      )
        setTeamTab(value || "directory");
    };
    readTab();
    window.addEventListener("popstate", readTab);
    return () => window.removeEventListener("popstate", readTab);
  }, []);
  function changeTeamTab(value: string) {
    setTeamTab(value);
    const url = new URL(window.location.href);
    url.searchParams.set("teamTab", value);
    window.history.replaceState({}, "", url);
  }
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    const b: any = Object.fromEntries(new FormData(e.currentTarget)),
      logoFile = b.logo_file,
      photoFile = b.team_photo_file;
    try {
      if (logoFile instanceof File && logoFile.size)
        b.logo = (await uploadFile(logoFile)).url;
      else if (editing?.logo) b.logo = editing.logo;
      if (photoFile instanceof File && photoFile.size)
        b.team_photo = (await uploadFile(photoFile)).url;
      else if (editing?.team_photo) b.team_photo = editing.team_photo;
      delete b.logo_file;
      delete b.team_photo_file;
      editing?.id
        ? await api(`/teams/${editing.id}`, {
            method: "PUT",
            body: JSON.stringify(b),
          })
        : await api("/teams", { method: "POST", body: JSON.stringify(b) });
      toast.success(editing?.id ? "Team updated" : "Team and login created");
      setEditing(undefined);
      teams.load();
    } catch (err: unknown) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Tabs
        value={teamTab}
        onValueChange={changeTeamTab}
        className="teams-tabs"
      >
        <TabsList>
          <TabsTrigger value="directory">Team directory</TabsTrigger>
          <TabsTrigger value="registrations">Registered teams</TabsTrigger>
          <TabsTrigger value="selected">Selected teams</TabsTrigger>
          <TabsTrigger value="invites">Invites</TabsTrigger>
        </TabsList>
        <TabsContent value="selected">
          <SelectedRegistrations refresh={refresh} />
        </TabsContent>
        <TabsContent value="registrations">
          <PreRegistrations refresh={refresh} />
        </TabsContent>
        <TabsContent value="invites">
          <Invites refresh={refresh} />
        </TabsContent>
        <TabsContent value="directory">
          <section className="panel teams-directory-panel">
            <div className="panelhead">
              <h3>Registered teams</h3>
              <button className="btn primary" onClick={() => setEditing(null)}>
                <Plus /> Add team
              </button>
            </div>
            <div className="portal-table">
              {teams.data.map((t: Row) => (
                <div className="portal-row team-row" key={t.id}>
                  {t.logo ? (
                    <img className="team-list-logo" src={t.logo} alt="" />
                  ) : (
                    <TeamMark team={t} />
                  )}
                  <span>
                    <b>{t.name}</b>
                    <small>
                      Group {t.group_id || "—"} ·{" "}
                      {t.contact_person || "No contact"}
                    </small>
                  </span>
                  <Badge>Active</Badge>
                  <div className="row-actions">
                    {t.logo && (
                      <a href={t.logo} download target="_blank">
                        <Download /> Logo
                      </a>
                    )}
                    {t.team_photo && (
                      <a href={t.team_photo} download target="_blank">
                        <Download /> Photo
                      </a>
                    )}
                    <a href={`/api/teams/${t.id}/pdf`} download>
                      <Download /> Team PDF
                    </a>
                    <button onClick={() => setEditing(t)}>Edit</button>
                    <Confirm
                      title="Delete team"
                      text={`Delete ${t.name}?`}
                      onConfirm={async () => {
                        await api(`/teams/${t.id}`, { method: "DELETE" });
                        teams.load();
                      }}
                    >
                      <button className="danger-link">Delete</button>
                    </Confirm>
                  </div>
                </div>
              ))}
            </div>
            <Modal
              title={editing?.id ? "Edit team" : "Add team"}
              open={editing !== undefined}
              onOpenChange={(v) => !v && setEditing(undefined)}
              className="team-editor-dialog"
            >
              <form className="portal-form" onSubmit={save}>
                <Field
                  label="Team name"
                  name="name"
                  defaultValue={editing?.name}
                  required
                />
                <Field
                  label="Contact person"
                  name="contact_person"
                  defaultValue={editing?.contact_person}
                />
                <Field
                  label="Group"
                  name="group_id"
                  defaultValue={editing?.group_id}
                />
                <Field
                  label="Team color"
                  name="color"
                  type="color"
                  defaultValue={
                    editing?.color || teamColors[teams.data.length % 8]
                  }
                />
                <PhoneField
                  defaultValue={editing?.phone}
                  defaultCode={editing?.phone_country_code || "+32"}
                />
                <Field
                  label="Website"
                  name="website"
                  type="url"
                  defaultValue={editing?.website}
                />
                <AddressFields team={editing || undefined} />
                <Field label="Team logo file" name="logo_file" type="file" />
                <Field
                  label="Team photo file"
                  name="team_photo_file"
                  type="file"
                />
                {!editing?.id && (
                  <>
                    <Field
                      label="Login email"
                      name="login_email"
                      type="email"
                      required
                    />
                    <Field
                      label="Temporary password"
                      name="login_password"
                      type="password"
                      minLength={8}
                      required
                    />
                  </>
                )}
                <FormButtons
                  busy={busy}
                  onCancel={() => setEditing(undefined)}
                />
              </form>
            </Modal>
          </section>
        </TabsContent>
      </Tabs>
    </>
  );
}

function ResourcePanel({ refresh }: { refresh: number }) {
  const links = useData("/links", refresh),
    resources = links.data.filter(
      (l: Row) => !["Sponsor", "Media"].includes(l.category),
    ),
    [editing, setEditing] = useState<Row | null | undefined>(undefined),
    [busy, setBusy] = useState(false);
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    const b: any = Object.fromEntries(new FormData(e.currentTarget)),
      file = b.file;
    try {
      if (file instanceof File && file.size)
        b.url = (await uploadFile(file)).url;
      else if (editing?.url) b.url = editing.url;
      else throw new Error("Choose a document or image");
      delete b.file;
      b.active = 1;
      b.sort_order = Number(editing?.sort_order || 0);
      editing?.id
        ? await api(`/links/${editing.id}`, {
            method: "PUT",
            body: JSON.stringify(b),
          })
        : await api("/links", { method: "POST", body: JSON.stringify(b) });
      toast.success("Resource saved");
      setEditing(undefined);
      links.load();
    } catch (err: unknown) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel">
      <div className="panelhead">
        <h3>Documents and resources</h3>
        <button className="btn primary" onClick={() => setEditing(null)}>
          <Plus /> Upload resource
        </button>
      </div>
      {resources.map((l: Row) => (
        <div className="portal-row link-row" key={l.id}>
          <FileText />
          <span>
            <b>{l.title}</b>
            <small>{l.description || l.category}</small>
          </span>
          <Badge>{l.category || "Document"}</Badge>
          <div className="row-actions">
            <a href={l.url} target="_blank">
              Open
            </a>
            <a href={l.url} download>
              Download
            </a>
            <button onClick={() => setEditing(l)}>Edit</button>
            <Confirm
              title="Delete resource"
              text={`Delete ${l.title}?`}
              onConfirm={async () => {
                await api(`/links/${l.id}`, { method: "DELETE" });
                links.load();
              }}
            >
              <button className="danger-link">Delete</button>
            </Confirm>
          </div>
        </div>
      ))}
      <Modal
        title={editing?.id ? "Edit resource" : "Upload resource"}
        open={editing !== undefined}
        onOpenChange={(v) => !v && setEditing(undefined)}
      >
        <form className="portal-form" onSubmit={save}>
          <Field
            label="Title"
            name="title"
            defaultValue={editing?.title}
            required
          />
          <Field
            label="Category"
            name="category"
            defaultValue={editing?.category || "Document"}
            required
          />
          <Field label="File" name="file" type="file" required={!editing?.id} />
          <Field
            label="Description"
            name="description"
            defaultValue={editing?.description}
          />
          <FormButtons busy={busy} onCancel={() => setEditing(undefined)} />
        </form>
      </Modal>
    </section>
  );
}

function UsersPanel({ refresh }: { refresh: number }) {
  const users = useData("/users", refresh),
    teams = useData("/teams", refresh),
    [editing, setEditing] = useState<Row | null | undefined>(undefined);
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const b: any = Object.fromEntries(new FormData(e.currentTarget));
    if (!editing?.id && b.password !== b.confirm_password) {
      toast.error("Passwords do not match");
      return;
    }
    delete b.confirm_password;
    b.active = Number(b.active);
    const photoFile = b.photo_file;
    delete b.photo_file;
    if (!b.password) delete b.password;
    try {
      if (photoFile instanceof File && photoFile.size)
        b.photo = (await uploadFile(photoFile)).url;
      else if (editing?.photo) b.photo = editing.photo;
      editing?.id
        ? await api(`/users/${editing.id}`, {
            method: "PUT",
            body: JSON.stringify(b),
          })
        : await api("/users", { method: "POST", body: JSON.stringify(b) });
      toast.success("User saved");
      setEditing(undefined);
      users.load();
    } catch (e: unknown) {
      toast.error(errorMessage(e));
    }
  }
  return (
    <section className="panel">
      <div className="panelhead">
        <h3>User management</h3>
        <div className="row-actions">
          <button className="btn" onClick={() => setEditing(null)}>
            <Plus /> Add user
          </button>
          <button className="btn primary" onClick={() => setEditing({ role: "ADMIN" } as Row)}>
            <Plus /> Add admin
          </button>
        </div>
      </div>
      {users.data.map((u) => (
        <div className="portal-row user-row" key={u.id}>
          <span className="member-avatar">
            {u.name
              .split(" ")
              .map((x: string) => x[0])
              .join("")
              .slice(0, 2)}
          </span>
          <span>
            <b>{u.name}</b>
            <small>{u.email}</small>
          </span>
          <Badge>{u.role}</Badge>
          <Badge>{u.active ? "Active" : "Inactive"}</Badge>
          <div className="row-actions">
            <button onClick={() => setEditing(u)}>Edit</button>
            <Confirm
              title="Delete user"
              text={`Delete ${u.name}?`}
              onConfirm={async () => {
                await api(`/users/${u.id}`, { method: "DELETE" });
                users.load();
              }}
            >
              <button className="danger-link">Delete</button>
            </Confirm>
          </div>
        </div>
      ))}
      <Modal
        title={editing?.id ? "Edit user" : editing?.role === "ADMIN" ? "Add admin account" : "Add user"}
        open={editing !== undefined}
        onOpenChange={(v) => !v && setEditing(undefined)}
      >
        <form className="portal-form" onSubmit={save}>
          <Field
            label="Name"
            name="name"
            defaultValue={editing?.name}
            required
          />
          <Field
            label="Email"
            name="email"
            type="email"
            defaultValue={editing?.email}
            required
          />
          <Field
            label={editing?.id ? "New password (optional)" : "Password"}
            name="password"
            type="password"
            minLength={8}
            required={!editing?.id}
          />
          {!editing?.id && (
            <Field
              label="Confirm password"
              name="confirm_password"
              type="password"
              minLength={8}
              required
            />
          )}
          <Field
            label="Role"
            name="role"
            children={
              <select name="role" defaultValue={editing?.role || "TEAM"}>
                <option>ADMIN</option>
                <option>TEAM</option>
                <option>REFEREE</option>
                <option>SCOREBOARD</option>
              </select>
            }
          />
          <Field
            label="Country"
            name="country"
            defaultValue={editing?.country}
          />
          <Field label="Profile photo" name="photo_file" type="file" />
          <Field
            label="Team (for team users)"
            name="team_id"
            children={
              <select name="team_id" defaultValue={editing?.team_id || ""}>
                <option value="">No team</option>
                {teams.data.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            }
          />
          <Field
            label="Status"
            name="active"
            children={
              <select name="active" defaultValue={editing?.active ?? 1}>
                <option value="1">Active</option>
                <option value="0">Inactive</option>
              </select>
            }
          />
          <FormButtons busy={false} onCancel={() => setEditing(undefined)} />
        </form>
      </Modal>
    </section>
  );
}

function ScoreboardControl({ refresh }: { refresh: number }) {
  const teams = useData("/teams", refresh),
    tournaments = useData("/tournaments", refresh),
    [matches, setMatches] = useState<Row[]>([]),
    [selected, setSelected] = useState(""),
    [settingsOpen, setSettingsOpen] = useState(false),
    [modeBusy, setModeBusy] = useState(false);
  const load = useCallback(async () => {
    try {
      const rows = await api("/matches");
      const ordered = [...rows].sort(sortMatches);
      setMatches(ordered);
      setSelected(
        (current) =>
          current ||
          ordered.find((m: Row) => m.status === "live")?.id ||
          ordered[0]?.id ||
          "",
      );
    } catch (error: unknown) {
      toast.error(errorMessage(error));
    }
  }, []);
  useEffect(() => {
    load();
    const timer = setInterval(load, 1000);
    return () => clearInterval(timer);
  }, [load, refresh]);
  const match = matches.find((item) => item.id === selected),
    settings = tournaments.data.find((item: Row) => item.active) || {};
  async function setMode(mode: string) {
    if (!match) return;
    setModeBusy(true);
    setMatches((current) =>
      current.map((item) =>
        item.id === match.id ? { ...item, scoreboard_mode: mode } : item,
      ),
    );
    try {
      await api("/scoreboard-mode", {
        method: "POST",
        body: JSON.stringify({ match_id: match.id, mode }),
      });
      toast.success(
        mode === "scoreboard"
          ? "Scoreboard shown"
          : mode === "sponsors"
            ? "Sponsor screen shown"
            : "TV screen blacked out",
      );
      await load();
    } catch (error: unknown) {
      toast.error(errorMessage(error));
      await load();
    } finally {
      setModeBusy(false);
    }
  }
  async function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values: any = Object.fromEntries(new FormData(event.currentTarget));
    values.scoreboard_show_sponsors = Boolean(values.scoreboard_show_sponsors);
    await api("/scoreboard-settings", {
      method: "POST",
      body: JSON.stringify(values),
    });
    toast.success("Scoreboard settings saved");
    setSettingsOpen(false);
    tournaments.load();
  }
  return (
    <div className="scoreboard-control-page">
      <section className="panel scoreboard-selector">
        <div>
          <h3>Scoreboard control</h3>
          <small>
            Select a match and open the clean fullscreen view on the TV.
          </small>
        </div>
        <select
          aria-label="Select match"
          value={selected}
          onChange={(event) => setSelected(event.target.value)}
        >
          {[...matches].sort(sortMatches).map((item) => (
            <option key={item.id} value={item.id}>
              {item.match_date ? `${fmtDate(item.match_date)} · ` : ""}
              {item.start_time || "TBD"} ·{" "}
              {teamName(teams.data, item.home_team_id)} vs{" "}
              {teamName(teams.data, item.away_team_id)}
            </option>
          ))}
        </select>
        <a
          className="btn primary"
          href={`/scoreboard/display?match=${encodeURIComponent(selected)}`}
          target="_blank"
          rel="noreferrer"
        >
          <Monitor /> Open TV view
        </a>
      </section>
      {match && (
        <section className="panel scoreboard-screen-controls">
          <div>
            <b>TV screen</b>
            <small>
              The pink option is currently visible on the connected screen.
            </small>
          </div>
          <div
            className="scoreboard-mode-group"
            role="group"
            aria-label="TV screen mode"
          >
            <button
              disabled={modeBusy}
              className={match.scoreboard_mode === "scoreboard" ? "active" : ""}
              aria-pressed={match.scoreboard_mode === "scoreboard"}
              onClick={() => setMode("scoreboard")}
            >
              Scoreboard
            </button>
            <button
              disabled={modeBusy}
              className={match.scoreboard_mode === "sponsors" ? "active" : ""}
              aria-pressed={match.scoreboard_mode === "sponsors"}
              onClick={() => setMode("sponsors")}
            >
              Sponsors
            </button>
            <button
              disabled={modeBusy}
              className={match.scoreboard_mode === "black" ? "active" : ""}
              aria-pressed={match.scoreboard_mode === "black"}
              onClick={() => setMode("black")}
            >
              Black screen
            </button>
          </div>
          <button
            className="scoreboard-settings-button"
            onClick={() => setSettingsOpen(true)}
          >
            Display settings
          </button>
        </section>
      )}
      {match ? (
        <MatchCard
          match={match}
          teams={teams.data}
          editable
          showScoreboardControls
          onChanged={load}
          durationMinutes={Number(settings.match_duration_minutes || 30)}
          halftimeMinutes={Number(settings.halftime_duration_minutes || 5)}
        />
      ) : (
        <Empty text="No match available" />
      )}
      <Modal
        title="Scoreboard settings"
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
      >
        <form className="portal-form" onSubmit={saveSettings}>
          <Field
            label="Minutes per half"
            name="match_duration_minutes"
            type="number"
            defaultValue={settings.match_duration_minutes || 15}
            required
          />
          <Field
            label="Half-time duration (minutes)"
            name="halftime_duration_minutes"
            type="number"
            defaultValue={settings.halftime_duration_minutes || 5}
            required
          />
          <Field
            label="Background colour"
            name="scoreboard_background"
            type="color"
            defaultValue={settings.scoreboard_background || "#100d12"}
          />
          <Field
            label="Accent colour"
            name="scoreboard_accent"
            type="color"
            defaultValue={settings.scoreboard_accent || "#f72585"}
          />
          <Field
            label="Team logo size (%)"
            name="scoreboard_logo_scale"
            type="number"
            defaultValue={settings.scoreboard_logo_scale || 100}
          />
          <label className="portal-field wide scoreboard-check">
            <input
              type="checkbox"
              name="scoreboard_show_sponsors"
              defaultChecked={settings.scoreboard_show_sponsors !== 0}
            />{" "}
            Show sponsors before the match and during half-time
          </label>
          <FormButtons busy={false} onCancel={() => setSettingsOpen(false)} />
        </form>
      </Modal>
    </div>
  );
}

function SettingsPanel({ reload }: { reload: () => void }) {
  const [error, setError] = useState("");
  async function password(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    const b = Object.fromEntries(new FormData(e.currentTarget));
    try {
      await api("/auth/change-password", {
        method: "POST",
        body: JSON.stringify(b),
      });
      toast.success("Password changed");
      e.currentTarget.reset();
    } catch (err: unknown) {
      setError(errorMessage(err));
    }
  }
  return (
    <>
      <section className="panel">
        <div className="setting">
          <h3>Reset tournament data</h3>
          <p>
            Restore the eight teams, ten matches, delegations, payments and
            rooms. Current changes will be removed.
          </p>
          <Confirm
            title="Reset all tournament data?"
            text="This permanently replaces the current tournament data with the original seed. Your admin login values will be preserved."
            passwordInput
            onConfirm={async (password) => {
              await api("/seed", {
                method: "POST",
                body: JSON.stringify({ force: true, password }),
              });
              toast.success("Tournament reset and re-seeded");
              reload();
            }}
          >
            <button className="btn danger">Reset & re-seed</button>
          </Confirm>
        </div>
      </section>
      <section className="panel password-panel">
        <div className="panelhead">
          <h3>Change password</h3>
        </div>
        <form className="portal-form" onSubmit={password}>
          <Field
            label="Current password"
            name="currentPassword"
            type="password"
            required
          />
          <Field
            label="New password"
            name="newPassword"
            type="password"
            required
          />
          <div className="form-actions">
            <button className="btn primary">Update password</button>
          </div>
          {error && <p className="formerror">{error}</p>}
        </form>
      </section>
    </>
  );
}

function ChatPanel({ refresh }: { refresh: number }) {
  const messages = useData("/messages", refresh, true),
    recipients = useData("/message-recipients", refresh),
    [selected, setSelected] = useState(""),
    [busy, setBusy] = useState(false);
  const me = JSON.parse(localStorage.getItem("phb_user") || "{}");
  useEffect(() => {
    if (!selected && recipients.data[0]?.id) setSelected(recipients.data[0].id);
  }, [recipients.data, selected]);
  const thread = messages.data
    .filter(
      (m: Row) =>
        (m.sender_user_id === me.id && m.recipient_user_id === selected) ||
        (m.sender_user_id === selected && m.recipient_user_id === me.id),
    )
    .sort((a: Row, b: Row) =>
      String(a.created_at).localeCompare(String(b.created_at)),
    );
  const unreadFor = (id: string) =>
    messages.data.filter(
      (m: Row) =>
        m.sender_user_id === id && m.recipient_user_id === me.id && !m.read_at,
    ).length;
  useEffect(() => {
    if (!selected) return;
    const unread = messages.data.filter(
      (m: Row) =>
        m.sender_user_id === selected &&
        m.recipient_user_id === me.id &&
        !m.read_at,
    );
    if (!unread.length) return;
    Promise.all(
      unread.map((m: Row) =>
        api(`/messages/${m.id}`, {
          method: "PUT",
          body: JSON.stringify({ read: true }),
        }),
      ),
    )
      .then(messages.load)
      .catch(() => {});
  }, [
    selected,
    messages.data.map((m: Row) => `${m.id}:${m.read_at || ""}`).join("|"),
  ]);
  async function send(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!selected) return toast.error("Choose a conversation");
    const form = e.currentTarget,
      body = String(new FormData(form).get("body") || "").trim();
    if (!body) return;
    setBusy(true);
    try {
      const result = await api("/messages", {
        method: "POST",
        body: JSON.stringify({
          recipient_user_id: selected,
          subject: "Chat message",
          body,
        }),
      });
      form.reset();
      await messages.load();
      if (!result.emailSent)
        toast.info("Message sent; email delivery is not configured");
    } catch (err: unknown) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  async function removeConversation() {
    if (!selected) return;
    await api(`/messages/conversation/${selected}`, { method: "DELETE" });
    toast.success("Conversation removed from your inbox");
    setSelected("");
    await messages.load();
  }
  const person = recipients.data.find((r: Row) => r.id === selected);
  return (
    <section className="panel chat-panel">
      <div className="panelhead">
        <div>
          <h3>Messages</h3>
          <small>
            Chat with{" "}
            {me.role === "ADMIN"
              ? "teams and referees"
              : "the tournament organization"}
          </small>
        </div>
      </div>
      <div className="chat-layout">
        <aside className="chat-contacts">
          <b>Conversations</b>
          {recipients.data.map((r: Row) => {
            const unread = unreadFor(r.id),
              last = messages.data.find(
                (m: Row) =>
                  m.sender_user_id === r.id || m.recipient_user_id === r.id,
              );
            return (
              <button
                key={r.id}
                className={selected === r.id ? "active" : ""}
                onClick={() => setSelected(r.id)}
              >
                <span className="member-avatar">
                  {r.name
                    .split(" ")
                    .map((x: string) => x[0])
                    .join("")
                    .slice(0, 2)}
                </span>
                <span>
                  <b>{r.name}</b>
                  <small>{last?.body || r.role}</small>
                </span>
                {unread > 0 && <em>{unread}</em>}
              </button>
            );
          })}
        </aside>
        <div className="chat-thread">
          <header>
            <span className="member-avatar">
              {person?.name
                ?.split(" ")
                .map((x: string) => x[0])
                .join("")
                .slice(0, 2) || "?"}
            </span>
            <span>
              <b>{person?.name || "Choose a conversation"}</b>
              <small>
                {person?.role &&
                !String(person?.name || "")
                  .toLowerCase()
                  .includes(String(person.role).toLowerCase())
                  ? person.role
                  : ""}
              </small>
            </span>
            {selected && (
              <Confirm
                title="Delete conversation"
                text="Remove this conversation from your inbox? The other participant keeps their copy."
                onConfirm={removeConversation}
              >
                <button
                  className="chat-delete"
                  aria-label="Delete conversation"
                >
                  <Trash2 /> Delete
                </button>
              </Confirm>
            )}
          </header>
          <div className="chat-history">
            {thread.length ? (
              thread.map((m: Row) => (
                <div
                  key={m.id}
                  className={`chat-bubble ${m.sender_user_id === me.id ? "mine" : "theirs"}`}
                >
                  <p>{m.body}</p>
                  <time>
                    {new Date(m.created_at).toLocaleString("en-BE", {
                      day: "2-digit",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </time>
                </div>
              ))
            ) : (
              <div className="chat-welcome">
                <Mail />
                <b>No messages yet</b>
                <span>Start the conversation below.</span>
              </div>
            )}
          </div>
          <form className="chat-reply" onSubmit={send}>
            <textarea
              name="body"
              rows={2}
              placeholder="Write a reply…"
              aria-label="Write a reply"
              required
            />
            <button
              className="btn primary"
              disabled={busy || !selected}
              aria-label="Send reply"
            >
              <Send />
              {busy ? "Sending…" : "Send"}
            </button>
          </form>
        </div>
      </div>
    </section>
  );
}

function ContactsPanel({
  refresh,
  admin = false,
}: {
  refresh: number;
  admin?: boolean;
}) {
  const contacts = useData("/contacts", refresh),
    [editing, setEditing] = useState<Row | null | undefined>(undefined),
    [busy, setBusy] = useState(false);
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    const b: any = Object.fromEntries(new FormData(e.currentTarget));
    b.emergency = b.emergency === "1";
    b.sort_order = Number(b.sort_order || 0);
    try {
      editing?.id
        ? await api(`/contacts/${editing.id}`, {
            method: "PUT",
            body: JSON.stringify(b),
          })
        : await api("/contacts", { method: "POST", body: JSON.stringify(b) });
      toast.success("Contact saved");
      setEditing(undefined);
      contacts.load();
    } catch (err: unknown) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel contacts-panel">
      <div className="panelhead">
        <div>
          <h3>Organization contacts</h3>
          <small>Call or email the tournament organization</small>
        </div>
        {admin && (
          <button className="btn primary" onClick={() => setEditing(null)}>
            <Plus /> Add contact
          </button>
        )}
      </div>
      <div className="contact-grid">
        {contacts.data.map((c: Row) => (
          <article key={c.id} className={c.emergency ? "emergency" : ""}>
            <span className="contact-icon">
              <Phone />
            </span>
            <div>
              <small>{c.role || "Organization"}</small>
              <h4>{c.name}</h4>
              <a href={`tel:${c.phone}`}>{c.phone}</a>
              {c.email && <a href={`mailto:${c.email}`}>{c.email}</a>}
            </div>
            {c.emergency ? <Badge>Emergency</Badge> : null}
            {admin && (
              <div className="row-actions">
                <button onClick={() => setEditing(c)}>Edit</button>
                <Confirm
                  title="Delete contact"
                  text={`Delete ${c.name}?`}
                  onConfirm={async () => {
                    await api(`/contacts/${c.id}`, { method: "DELETE" });
                    contacts.load();
                  }}
                >
                  <button className="danger-link">Delete</button>
                </Confirm>
              </div>
            )}
          </article>
        ))}
      </div>
      {admin && (
        <Modal
          title={editing?.id ? "Edit contact" : "Add contact"}
          open={editing !== undefined}
          onOpenChange={(v) => !v && setEditing(undefined)}
        >
          <form className="portal-form" onSubmit={save}>
            <Field
              label="Name"
              name="name"
              defaultValue={editing?.name}
              required
            />
            <Field
              label="Role or department"
              name="role"
              defaultValue={editing?.role}
            />
            <Field
              label="Phone number"
              name="phone"
              type="tel"
              defaultValue={editing?.phone}
              required
            />
            <Field
              label="Email"
              name="email"
              type="email"
              defaultValue={editing?.email}
            />
            <Field
              label="Contact type"
              name="emergency"
              children={
                <select
                  name="emergency"
                  defaultValue={editing?.emergency ? "1" : "0"}
                >
                  <option value="0">General contact</option>
                  <option value="1">Emergency contact</option>
                </select>
              }
            />
            <Field
              label="Display order"
              name="sort_order"
              type="number"
              defaultValue={editing?.sort_order || 0}
            />
            <FormButtons busy={busy} onCancel={() => setEditing(undefined)} />
          </form>
        </Modal>
      )}
    </section>
  );
}

function Team({
  active,
  refresh,
  onNavigate,
  reload,
}: {
  active: string;
  refresh: number;
  onNavigate: (page: string) => void;
  reload: () => void;
}) {
  let content: React.ReactNode;
  if (active === "messages") content = <ChatPanel refresh={refresh} />;
  else if (active === "contacts") content = <ContactsPanel refresh={refresh} />;
  else if (active === "delegation") content = <Delegation refresh={refresh} />;
  else if (active === "rooms") content = <RoomsPanelV2 refresh={refresh} />;
  else if (active === "info")
    content = <TeamInfoV2 refresh={refresh} reload={reload} />;
  else if (active === "documents") content = <Documents refresh={refresh} />;
  else if (active === "review") content = <TeamReview refresh={refresh} />;
  else if (active === "finance") content = <Finance refresh={refresh} />;
  else content = <TeamOverview refresh={refresh} onNavigate={onNavigate} />;
  return <div className="team-page-content">{content}</div>;
}
function TeamOnboardingProgress({
  refresh,
  teamData,
  onNavigate,
}: {
  refresh: number;
  teamData?: Row;
  onNavigate: (page: string) => void;
}) {
  const onboarding = useData<Row>("/team-onboarding", refresh);
  const data = onboarding.data || {};
  const members = teamData?.members || [];
  const hasValue = (value: unknown) => String(value || "").trim().length > 0;
  const localTeam = teamData?.team || {};
  const localHasAddress =
    hasValue(localTeam.address) ||
    [
      localTeam.address_street,
      localTeam.address_number,
      localTeam.address_postal_code,
      localTeam.address_city,
      localTeam.address_country,
    ].some(hasValue);
  const localSetup =
    hasValue(localTeam.contact_person) &&
    hasValue(localTeam.phone) &&
    localHasAddress;
  const localDelegation = Boolean(
    members.length &&
    members.every((member: Row) => {
      if (!member.name) return false;
      return (
        member.member_type !== "PLAYER" ||
        Boolean(
          member.player_role &&
          Number.isFinite(Number(member.classification_points)),
        )
      );
    }),
  );
  const localRooms = Boolean(
    members.length && (teamData?.rooms || []).length >= members.length,
  );
  const reviewStatus = String(
    teamData?.team?.review_status || "information_incomplete",
  );
  const localReview = localSetup && localDelegation && localRooms;
  const localConfirmation = [
    "awaiting_admin",
    "approved_payment_open",
  ].includes(reviewStatus);
  const localRegistrationReview = reviewStatus === "approved_payment_open";
  const fallbackStages = [
    {
      key: "setup",
      label: "Team setup",
      done: localSetup,
      state: localSetup ? "completed" : "current",
    },
    {
      key: "delegation",
      label: "Delegation",
      done: localDelegation,
      state: localDelegation
        ? "completed"
        : localSetup
          ? "current"
          : "upcoming",
    },
    {
      key: "rooms",
      label: "Rooms",
      done: localRooms,
      state: localRooms
        ? "completed"
        : localDelegation
          ? "current"
          : "upcoming",
    },
    {
      key: "review",
      label: "Review",
      done: localReview,
      state: localReview ? "completed" : "upcoming",
    },
    {
      key: "confirmation",
      label: "Team Confirmation",
      done: localConfirmation,
      state: localConfirmation
        ? "completed"
        : localReview
          ? "current"
          : "upcoming",
    },
    {
      key: "registration_review",
      label: "Registration Review",
      done: localRegistrationReview,
      state:
        reviewStatus === "awaiting_admin"
          ? "current"
          : localRegistrationReview
            ? "completed"
            : "upcoming",
    },
    { key: "deposit", label: "Deposit", state: "upcoming" },
    { key: "balance", label: "Remaining balance", state: "upcoming" },
    { key: "ready", label: "Tournament Ready", state: "upcoming" },
  ];
  const stageKeys = [
    "setup",
    "delegation",
    "rooms",
    "review",
    "confirmation",
    "registration_review",
    "deposit",
    "balance",
    "ready",
  ];
  const serverStages = (data.stages || []).filter((stage: Row) =>
    stageKeys.includes(stage.key),
  );
  const stages = serverStages.length ? serverStages : fallbackStages;
  const current = stages.find((stage: Row) => stage.label === data.current);
  const setupStage = stages.find((stage: Row) => stage.key === "setup");
  const depositOpen =
    data.status === "approved_payment_open" &&
    Number(data.payment?.deposit || 0) > Number(data.payment?.paid || 0);
  const localAction = !localSetup
    ? "Complete your team setup"
    : !localDelegation
      ? "Complete your delegation"
      : !localRooms
        ? "Assign everyone to a room"
        : reviewStatus === "changes_requested"
          ? "Review the requested changes"
          : reviewStatus === "awaiting_admin"
            ? "No action required — Registration Review is pending"
            : reviewStatus === "approved_payment_open"
              ? "Payment is being prepared"
              : "Review and confirm your tournament information";
  const displayAction = depositOpen
    ? `Pay the deposit of ${fmtMoney(Number(data.payment.deposit))}`
    : !current || (current.key === "setup" && !setupStage?.done)
      ? localAction
      : data.action || localAction;
  const actionPage = depositOpen
    ? "finance"
    : current?.key === "setup"
      ? "info"
      : current?.key === "delegation"
        ? "delegation"
        : current?.key === "rooms"
          ? "rooms"
          : current?.key === "review" ||
              current?.key === "confirmation" ||
              current?.key === "registration_review"
            ? "review"
            : current?.key === "deposit" || current?.key === "balance"
              ? "finance"
              : null;
  return (
    <section
      className={`onboarding-shell panel${actionPage ? " is-clickable" : ""}`}
      aria-label="Tournament onboarding progress"
      onClick={() => actionPage && onNavigate(actionPage)}
      onKeyDown={(event) => {
        if (actionPage && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault();
          onNavigate(actionPage);
        }
      }}
      role={actionPage ? "button" : undefined}
      tabIndex={actionPage ? 0 : undefined}
    >
      <div className="onboarding-heading">
        <div>
          <span className="eyebrow">Team onboarding</span>
          <h2>
            {data.team?.name || teamData?.team?.name || "Tournament setup"}
          </h2>
          <p>
            Complete your tournament information through to Tournament Ready.
          </p>
        </div>
        <span className="onboarding-current">
          {current?.label || "Team setup"}
        </span>
      </div>
      <div className="onboarding-stepper">
        {stages.map((stage: Row, index: number) => (
          <div
            className={`onboarding-step ${stage.done ? "done" : stage.state === "current" ? "current" : "upcoming"}`}
            key={stage.key}
          >
            <span>{stage.done ? "✓" : index + 1}</span>
            <b>{stage.label}</b>
          </div>
        ))}
      </div>
      <div className="onboarding-action">
        <div>
          <small>Next action</small>
          <strong>{displayAction}</strong>
          {data.payment?.due && <em>Due {fmtDate(data.payment.due)}</em>}
        </div>
        {current && (
          <span className="onboarding-state">
            {current.state === "current"
              ? "Action required"
              : current.state === "completed"
                ? "Completed"
                : "Waiting"}
          </span>
        )}
      </div>
    </section>
  );
}
function TeamOverview({
  refresh,
  onNavigate,
}: {
  refresh: number;
  onNavigate: (page: string) => void;
}) {
  const mine = useData<TeamOverviewPayload>("/my-team", refresh),
    teams = useData("/teams", refresh),
    payload = mine.data;
  const matches = Array.isArray(payload) ? [] : payload?.matches || [];
  return (
    <>
      <TeamOnboardingProgress
        refresh={refresh}
        teamData={payload || undefined}
        onNavigate={onNavigate}
      />
      <div className="cards cost">
        <article>
          <small>Your matches</small>
          <b>{matches.length}</b>
          <em>tournament total</em>
        </article>
        <article>
          <small>Delegation</small>
          <b>{payload?.members?.length || 0} / 16</b>
          <em>maximum 8 players</em>
        </article>
        <article>
          <small>Accommodation</small>
          <b>{fmtMoney(payload?.roomCost || 0)}</b>
          <em>{payload?.rooms?.length || 0} room(s) used</em>
        </article>
      </div>
      <section className="panel">
        <div className="panelhead">
          <h3>Your matches</h3>
        </div>
        {matches.map((m: Row) => (
          <MatchCard
            key={m.id}
            match={m}
            teams={teams.data}
            onChanged={mine.load}
          />
        ))}
      </section>
    </>
  );
}
function TeamInfoV2({
  refresh,
  reload,
}: {
  refresh: number;
  reload: () => void;
}) {
  const teams = useData("/teams", refresh),
    team = teams.data[0],
    [busy, setBusy] = useState(false),
    [removeLogo, setRemoveLogo] = useState(false),
    [removePhoto, setRemovePhoto] = useState(false),
    [logoSelected, setLogoSelected] = useState(false),
    [photoSelected, setPhotoSelected] = useState(false);
  const logoInputRef = useRef<HTMLInputElement>(null),
    photoInputRef = useRef<HTMLInputElement>(null);
  if (!team)
    return <section className="panel">Loading team information…</section>;
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    const b: any = Object.fromEntries(new FormData(e.currentTarget)),
      logoFile = b.logo_file,
      photoFile = b.team_photo_file;
    try {
      if (removeLogo) b.logo = null;
      else if (logoFile instanceof File && logoFile.size)
        b.logo = (await uploadFile(logoFile)).url;
      if (removePhoto) b.team_photo = null;
      else if (photoFile instanceof File && photoFile.size)
        b.team_photo = (await uploadFile(photoFile)).url;
      delete b.logo_file;
      delete b.team_photo_file;
      await api(`/teams/${team.id}`, {
        method: "PUT",
        body: JSON.stringify(b),
      });
      toast.success("Team information saved");
      setRemoveLogo(false);
      setRemovePhoto(false);
      setLogoSelected(false);
      setPhotoSelected(false);
      reload();
    } catch (err: unknown) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel">
      <div className="panelhead">
        <h3>Team information</h3>
      </div>
      <form className="portal-form" onSubmit={save}>
        <Field
          label="Team name"
          name="name"
          defaultValue={team.name}
          required
        />
        <Field
          label="Contact person"
          name="contact_person"
          defaultValue={team.contact_person}
          required
        />
        <PhoneField
          defaultValue={team.phone}
          defaultCode={team.phone_country_code || "+32"}
          required
        />
        <Field
          label="Website"
          name="website"
          type="url"
          defaultValue={team.website}
        />
        <AddressFields team={team} />
        <Field
          label="Team color"
          name="color"
          type="color"
          defaultValue={team.color}
        />
        <Field
          label="Team logo file"
          name="logo_file"
          children={
            <div className="file-picker-control">
              <input
                ref={logoInputRef}
                name="logo_file"
                type="file"
                accept="image/*"
                onChange={(event) => {
                  setLogoSelected(Boolean(event.target.files?.length));
                  setRemoveLogo(false);
                }}
              />
              {logoSelected ? (
                <button
                  className="btn small icon-only"
                  type="button"
                  title="Clear selected logo file"
                  aria-label="Clear selected logo file"
                  onClick={() => {
                    if (logoInputRef.current) logoInputRef.current.value = "";
                    setLogoSelected(false);
                  }}
                >
                  <Trash2 />
                </button>
              ) : null}
            </div>
          }
        />
        {team.logo && (
          <div className="team-media-control">
            <img
              className="logo-preview"
              src={team.logo}
              alt="Current team logo"
            />
            <button
              className="btn danger small"
              type="button"
              onClick={() => setRemoveLogo(true)}
            >
              {removeLogo ? "Logo will be removed" : "Remove logo"}
            </button>
          </div>
        )}
        <Field
          label="Team photo file"
          name="team_photo_file"
          children={
            <div className="file-picker-control">
              <input
                ref={photoInputRef}
                name="team_photo_file"
                type="file"
                accept="image/*"
                onChange={(event) => {
                  setPhotoSelected(Boolean(event.target.files?.length));
                  setRemovePhoto(false);
                }}
              />
              {photoSelected ? (
                <button
                  className="btn small icon-only"
                  type="button"
                  title="Clear selected team photo file"
                  aria-label="Clear selected team photo file"
                  onClick={() => {
                    if (photoInputRef.current) photoInputRef.current.value = "";
                    setPhotoSelected(false);
                  }}
                >
                  <Trash2 />
                </button>
              ) : null}
            </div>
          }
        />
        {team.team_photo && (
          <div className="team-media-control">
            <img
              className="team-photo-preview"
              src={team.team_photo}
              alt="Current team photo"
            />
            <button
              className="btn danger small"
              type="button"
              onClick={() => setRemovePhoto(true)}
            >
              {removePhoto ? "Photo will be removed" : "Remove team photo"}
            </button>
          </div>
        )}
        <div className="form-actions">
          <button className="btn primary" disabled={busy}>
            {busy ? "Saving…" : "Save changes"}
          </button>
        </div>
      </form>
    </section>
  );
}
function Documents({ refresh }: { refresh: number }) {
  const links = useData("/links", refresh);
  return (
    <section className="panel">
      <div className="panelhead">
        <h3>Documents and resources</h3>
      </div>
      <div className="docs">
        {links.data
          .filter((l) => l.category !== "Sponsor")
          .map((l) => (
            <a href={l.url} download key={l.id}>
              <FileText />
              <span>
                <b>{l.title}</b>
                <small>{l.description || l.category}</small>
              </span>
              <Download aria-hidden="true" />
            </a>
          ))}
      </div>
    </section>
  );
}

type MvpPayload = {
  enabled?: boolean;
  assistant_coach_eligible?: boolean;
  candidates?: Row[];
  referees?: Row[];
  voteSummary?: Record<string, Record<string, number>>;
  voteProgress?: { voted?: number; total?: number };
  votedCategories?: string[];
};
type MvpCandidateRow = Row & { category: string };

const MVP_CATEGORIES = [
  ["BEST_KEEPER", "Best Goalkeeper"],
  ["BEST_T_STICK", "Best T-stick Player"],
  ["BEST_HANDSTICK_UNDER_3", "Best Handstick Player — under 3 points"],
  ["BEST_HANDSTICK_3_PLUS", "Best Handstick Player — 3 points and above"],
  ["BEST_REFEREE", "Best Referee"],
  ["BEST_COACH", "Best Coach"],
] as const;

function MvpCandidate({
  candidate,
  selected,
  onSelect,
  votes,
  total,
}: {
  candidate: Row;
  selected?: boolean;
  onSelect?: () => void;
  votes: number;
  total: number;
}) {
  const percentage = total ? Math.round((votes / total) * 100) : 0;
  return (
    <button
      type="button"
      className={`mvp-choice${selected ? " selected" : ""}`}
      onClick={onSelect}
      disabled={!onSelect}
    >
      <span className="mvp-rank">{candidate.name?.slice(0, 1) || "?"}</span>
      <span className="mvp-choice-content">
        <strong>{candidate.name || "Unnamed candidate"}</strong>
        <small>
          {candidate.team_name || "Tournament referee"} ·{" "}
          {candidate.member_type === "PLAYER"
            ? `${candidate.player_role || "Player"} · ${candidate.classification_points ?? "—"} points`
            : candidate.member_type === "COACH"
              ? "Coach"
              : candidate.staff_role || "Referee"}
        </small>
        <span className="mvp-bar">
          <i style={{ width: `${percentage}%` }} />
        </span>
      </span>
      <span className="mvp-count">
        <b>{votes}</b>
        <small>{percentage}%</small>
      </span>
    </button>
  );
}

function MvpVoting({
  refresh,
  admin = false,
}: {
  refresh: number;
  admin?: boolean;
}) {
  const data = useData<MvpPayload>("/mvp/candidates", refresh);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [resetPassword, setResetPassword] = useState("");
  const candidates: MvpCandidateRow[] = [
    ...(data.data.candidates || []).map((candidate) => ({
      ...candidate,
      category: String(candidate.category || ""),
    })),
    ...(data.data.referees || []).map((referee) => ({
      ...referee,
      category: "BEST_REFEREE",
    })),
  ];
  const getCandidates = (category: string) =>
    candidates.filter((candidate) => candidate.category === category);
  const label = MVP_CATEGORIES[step]?.[1] || "Review your votes";
  const submit = async () => {
    setBusy(true);
    try {
      const pending = MVP_CATEGORIES.map(([category, title]) => {
        const candidate_id = answers[category];
        if (!candidate_id)
          throw new Error(`Please select a candidate for ${title}.`);
        return api("/mvp/vote", {
          method: "POST",
          body: JSON.stringify({ category, candidate_id }),
        }).catch((error: unknown) => {
          throw new Error(`${title}: ${errorMessage(error)}`);
        });
      });
      await Promise.all(pending);
      setSubmitted(true);
      toast.success("All votes submitted");
    } catch (error: unknown) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };
  const toggle = async () => {
    try {
      await api("/mvp/settings", {
        method: "POST",
        body: JSON.stringify({
          enabled: !data.data.enabled,
          assistant_coach_eligible: data.data.assistant_coach_eligible,
        }),
      });
      data.load();
    } catch (error: unknown) {
      toast.error(errorMessage(error));
    }
  };
  const resetVotes = async () => {
    if (!resetPassword) {
      toast.error("Enter the admin password first.");
      return;
    }
    if (
      !window.confirm(
        "Reset all MVP votes for the active tournament? This cannot be undone.",
      )
    )
      return;
    setBusy(true);
    try {
      await api("/mvp/reset", {
        method: "POST",
        body: JSON.stringify({ password: resetPassword }),
      });
      setResetPassword("");
      toast.success("MVP votes reset");
      data.load();
    } catch (error: unknown) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };
  if (data.loading)
    return (
      <section className="panel">
        <p className="muted">Loading MVP voting…</p>
      </section>
    );
  if (admin)
    return (
      <section className="panel mvp-panel">
        <div className="panelhead mvp-heading">
          <div>
            <span className="eyebrow">Awards</span>
            <h3>MVP voting overview</h3>
            <p className="muted">
              Live results from referee votes, grouped by official award
              category.
            </p>
            <div className="mvp-progress-summary">
              <strong>
                {data.data.voteProgress?.voted || 0} of{" "}
                {data.data.voteProgress?.total || 0}
              </strong>
              <span>referees have voted</span>
            </div>
          </div>
          <div className="mvp-actions">
            <span
              className={`mvp-status ${data.data.enabled ? "open" : "closed"}`}
            >
              {data.data.enabled ? "Voting open" : "Voting closed"}
            </span>
            <button className="btn primary" onClick={() => void toggle()}>
              {data.data.enabled ? "Close voting" : "Open voting"}
            </button>
          </div>
        </div>
        <div className="mvp-category-grid">
          {MVP_CATEGORIES.map(([category, title]) => {
            const list = getCandidates(category);
            const summary = data.data.voteSummary?.[category] || {};
            const total = Object.values(summary).reduce(
              (sum, count) => sum + Number(count),
              0,
            );
            return (
              <article className="mvp-result-card" key={category}>
                <div className="mvp-card-title">
                  <div>
                    <span className="eyebrow">Award category</span>
                    <h4>{title}</h4>
                  </div>
                  <strong>
                    {total}
                    <small> votes</small>
                  </strong>
                </div>
                {list.length ? (
                  [...list]
                    .sort(
                      (a, b) =>
                        Number(summary[String(b.id)] || 0) -
                        Number(summary[String(a.id)] || 0),
                    )
                    .map((candidate) => (
                      <MvpCandidate
                        key={candidate.id}
                        candidate={candidate}
                        votes={Number(summary[String(candidate.id)] || 0)}
                        total={total}
                      />
                    ))
                ) : (
                  <p className="muted">No eligible candidates yet.</p>
                )}
              </article>
            );
          })}
        </div>
        <div className="mvp-reset">
          <div>
            <strong>Reset votes</strong>
            <small>
              Deletes all votes for this active tournament. Candidates and
              settings stay unchanged.
            </small>
          </div>
          <div className="mvp-reset-controls">
            <input
              type="password"
              value={resetPassword}
              onChange={(event) => setResetPassword(event.target.value)}
              placeholder="Admin password"
              autoComplete="current-password"
            />
            <button
              className="btn danger"
              disabled={busy || !resetPassword}
              onClick={() => void resetVotes()}
            >
              Reset MVP votes
            </button>
          </div>
        </div>
      </section>
    );
  if (!data.data.enabled)
    return (
      <section className="panel mvp-panel mvp-closed">
        <span className="mvp-status closed">Voting closed</span>
        <h3>MVP voting is not open yet</h3>
        <p className="muted">
          The tournament administrators will open the voting when the candidate
          review is complete.
        </p>
      </section>
    );
  if (
    submitted ||
    (data.data.votedCategories?.length || 0) >= MVP_CATEGORIES.length
  )
    return (
      <section className="panel mvp-panel mvp-closed">
        <span className="mvp-status open">Vote submitted</span>
        <h3>Your MVP vote has been recorded</h3>
        <p className="muted">
          You can vote only once in each award category. Your submitted choices
          cannot be changed.
        </p>
      </section>
    );
  if (step === MVP_CATEGORIES.length)
    return (
      <section className="panel mvp-panel mvp-wizard">
        <div className="mvp-heading">
          <span className="eyebrow">Final review</span>
          <h3>Ready to submit?</h3>
          <p className="muted">
            Check your choices. You can go back to change any category before
            submitting.
          </p>
        </div>
        <div className="mvp-review">
          {MVP_CATEGORIES.map(([category, title]) => {
            const candidate = candidates.find(
              (item) =>
                item.category === category &&
                String(item.id) === answers[category],
            );
            return (
              <div key={category}>
                <span>{title}</span>
                <strong>{candidate?.name || "Not selected"}</strong>
              </div>
            );
          })}
        </div>
        <div className="mvp-wizard-actions">
          <button className="btn" onClick={() => setStep(step - 1)}>
            Back
          </button>
          <button
            className="btn primary"
            disabled={
              busy || Object.keys(answers).length !== MVP_CATEGORIES.length
            }
            onClick={() => void submit()}
          >
            {busy ? "Submitting…" : "Submit votes"}
          </button>
        </div>
      </section>
    );
  const list = getCandidates(MVP_CATEGORIES[step][0]);
  return (
    <section className="panel mvp-panel mvp-wizard">
      <div className="mvp-stepper">
        {MVP_CATEGORIES.map(([, title], index) => (
          <span
            className={index === step ? "active" : index < step ? "done" : ""}
            key={title}
          >
            {index + 1}
          </span>
        ))}
      </div>
      <div className="mvp-heading">
        <span className="eyebrow">
          Step {step + 1} of {MVP_CATEGORIES.length}
        </span>
        <h3>{label}</h3>
        <p className="muted">
          Select one candidate. Your vote will be submitted at the end.
        </p>
      </div>
      <div className="mvp-vote-list">
        {list.length ? (
          list.map((candidate) => (
            <MvpCandidate
              key={candidate.id}
              candidate={candidate}
              selected={
                answers[MVP_CATEGORIES[step][0]] === String(candidate.id)
              }
              onSelect={() =>
                setAnswers((current) => ({
                  ...current,
                  [MVP_CATEGORIES[step][0]]: String(candidate.id),
                }))
              }
              votes={0}
              total={0}
            />
          ))
        ) : (
          <p className="muted">No eligible candidates for this award.</p>
        )}
      </div>
      <div className="mvp-wizard-actions">
        {step > 0 && (
          <button className="btn" onClick={() => setStep(step - 1)}>
            Back
          </button>
        )}
        <button
          className="btn primary"
          disabled={!answers[MVP_CATEGORIES[step][0]]}
          onClick={() => setStep(step + 1)}
        >
          {step === MVP_CATEGORIES.length - 1
            ? "Review votes"
            : "Next category"}
        </button>
      </div>
    </section>
  );
}

function Referee({ active, refresh }: { active: string; refresh: number }) {
  if (active === "messages") return <ChatPanel refresh={refresh} />;
  if (active === "contacts") return <ContactsPanel refresh={refresh} />;
  if (active === "mvp") return <MvpVoting refresh={refresh} />;
  return <RefereeMatches active={active} refresh={refresh} />;
}
function RefereeMatches({
  active,
  refresh,
}: {
  active: string;
  refresh: number;
}) {
  const matches = useData("/matches", refresh, true),
    teams = useData("/teams", refresh),
    [q, setQ] = useState("");
  const shown = useMemo(
    () =>
      matches.data.filter((m) =>
        `${teamName(teams.data, m.home_team_id)} ${teamName(teams.data, m.away_team_id)} ${m.court}`
          .toLowerCase()
          .includes(q.toLowerCase()),
      ),
    [matches.data, teams.data, q],
  );
  return (
    <section className="panel">
      <div className="panelhead">
        <h3>{active === "schedule" ? "Your schedule" : "Assigned matches"}</h3>
        <Badge>{shown.length} assigned</Badge>
      </div>
      <div className="filters">
        <Search />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search team or court"
        />
      </div>
      {shown.map((m) => (
        <MatchCard
          key={m.id}
          match={m}
          teams={teams.data}
          editable={false}
          onChanged={matches.load}
        />
      ))}
    </section>
  );
}
