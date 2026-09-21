"use client";
import { useEffect, useMemo, useState } from "react";
import { errorMessage, type Match as AppMatch, type Team } from "@/types/app";

async function api(path: string, options: RequestInit = {}) {
  const response = await fetch(`/api${path}`, {
    ...options,
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Request failed");
  return data;
}

type Match = AppMatch & {
  id: string;
  group_id?: string;
  home_team_id?: string;
  away_team_id?: string;
  home_score?: number;
  away_score?: number;
  status?: string;
  start_time?: string;
};
type BracketGame = { key: string; a?: string; b?: string; label?: string; source?: string };
type BracketData = { qualification?: string[]; championship?: BracketGame[]; consolation?: BracketGame[]; finals?: BracketGame[] };
const sourceText = (value: unknown) =>
  typeof value === "string"
    ? value
    : value && typeof value === "object" && "name" in value ? String(value.name) : "TBD";

export default function BracketBuilder({ refresh }: { refresh: number }) {
  const [bracket, setBracket] = useState<{ data?: BracketData } | null>(null),
    [matches, setMatches] = useState<Match[]>([]),
    [teams, setTeams] = useState<Team[]>([]),
    [status, setStatus] = useState(""),
    [editing, setEditing] = useState<string | null>(null);
  async function load() {
    try {
      const [b, m, t] = await Promise.all([
        api("/brackets"),
        api("/matches"),
        api("/teams"),
      ]);
      setBracket((Array.isArray(b) ? b : b.brackets || [])[0] || null);
      setMatches(Array.isArray(m) ? m : m.matches || []);
      setTeams((Array.isArray(t) ? t : t.teams || []) as Team[]);
    } catch {
      setStatus("Could not load bracket");
    }
  }
  useEffect(() => {
    void load();
  }, [refresh]);
  const matchByKey = useMemo(
    () => Object.fromEntries(matches.map((m) => [m.group_id, m])),
    [matches],
  );
  const team = (id: string) =>
    teams.find((t) => t.id === id)?.name || ({
      "placeholder:KO:3rd:home": "Loser Semi-final 1",
      "placeholder:KO:3rd:away": "Loser Semi-final 2",
      "placeholder:KO:final:home": "Winner Semi-final 1",
      "placeholder:KO:final:away": "Winner Semi-final 2",
      "placeholder:KO:5th:home": "Winner Intermediate 1",
      "placeholder:KO:5th:away": "Winner Intermediate 2",
      "placeholder:KO:7th:home": "Loser Intermediate 1",
      "placeholder:KO:7th:away": "Loser Intermediate 2",
    } as Record<string, string>)[id] || (/^source:(\d+)-(.*)-group-([ab])$/i.test(id) ? id.replace(/^source:/i, "").replace(/-/g, " ") : id) || "TBD";
  async function saveMatch(match: Match, values: { match_date: string; start_time: string; court: string }) {
    setStatus("Saving…");
    try {
      await api(`/matches/${match.id}`, { method: "PUT", body: JSON.stringify(values) });
      setMatches((current) => current.map((item) => item.id === match.id ? { ...item, ...values } : item));
      setEditing(null);
      setStatus("Saved ✓");
    } catch (error: unknown) { setStatus(errorMessage(error, "Could not save match")); }
  }
  const data: BracketData = bracket?.data || {};
  const qualification = (
    data.qualification || [
      "1st Group A",
      "2nd Group A",
      "3rd Group A",
      "4th Group A",
      "1st Group B",
      "2nd Group B",
      "3rd Group B",
      "4th Group B",
    ]
  ).map((label: string) => ({ label, source: label }));
  const groupTeams = (group: string) => teams.filter((item) => String(item.group_id || "").toUpperCase().replace("GROUP-", "") === group);
  const allBracketGames = [...(data.championship || []), ...(data.consolation || []), ...(data.finals || [])];
  const savedGame = (key: string, fallback: BracketGame) => allBracketGames.find((game) => game.key === key) || fallback;
  const championshipData = [savedGame("KO:sf1", { key: "KO:sf1", a: "1st Group A", b: "2nd Group B" }), savedGame("KO:sf2", { key: "KO:sf2", a: "1st Group B", b: "2nd Group A" })];
  const finalsData = [savedGame("KO:final", { key: "KO:final", a: "Winner Semi-final 1", b: "Winner Semi-final 2" }), savedGame("KO:3rd", { key: "KO:3rd", a: "Loser Semi-final 1", b: "Loser Semi-final 2" }), savedGame("KO:5th", { key: "KO:5th", a: "Winner Intermediate 1", b: "Winner Intermediate 2" }), savedGame("KO:7th", { key: "KO:7th", a: "Loser Intermediate 1", b: "Loser Intermediate 2" })];
  const consolationData = [savedGame("KO:5a", { key: "KO:5a", a: "3rd Group A", b: "4th Group B" }), savedGame("KO:5b", { key: "KO:5b", a: "3rd Group B", b: "4th Group A" })];
  const championship = [...championshipData.map((g, i) => ({ key: g.key, label: `Semi-final ${i + 1} · P1–P4`, source: `${sourceText(g.a)} · ${sourceText(g.b)}` })), ...finalsData.filter((g) => g.key === "KO:final").map((g) => ({ key: g.key, label: "Final · P1–P2", source: `${sourceText(g.a)} · ${sourceText(g.b)}` })), ...finalsData.filter((g) => g.key === "KO:3rd").map((g) => ({ key: g.key, label: "Small final · P3–P4", source: `${sourceText(g.a)} · ${sourceText(g.b)}` }))];
  const placements = [...consolationData.map((g, i) => ({ key: g.key, label: `Intermediate ${i + 1} · P5–P8`, source: `${sourceText(g.a)} · ${sourceText(g.b)}` })), ...finalsData.filter((g) => ["KO:7th", "KO:5th"].includes(g.key)).map((g) => ({ key: g.key, label: g.key === "KO:7th" ? "Placement · P7–P8" : "Placement · P5–P6", source: `${sourceText(g.a)} · ${sourceText(g.b)}` }))];
  const columns = [
    {
      title: "Group phase",
      tone: "qualification",
      items: qualification,
    },
    {
      title: "Play Offs and Finals",
      tone: "final",
      items: [...championship, ...placements],
    },
  ];
  const renderCard = (item: { key: string; label: string; source: string }, tone: string) => {
    const match = item.key ? matchByKey[item.key] : null;
    return <article className={`bracket-builder-card ${tone}`} key={item.key || item.label}>
      <small>{item.label}</small>
      <strong>{match ? `${team(match.home_team_id)} — ${team(match.away_team_id)}` : item.source}</strong>
      {match && <span>{match.status === "finished" ? `${match.home_score} – ${match.away_score}` : match.start_time || "Unscheduled"}</span>}
      {match && <button className="btn small bracket-edit-button" onClick={(event) => { event.stopPropagation(); setEditing(editing === match.id ? null : match.id); }}>Edit match</button>}
      {match && editing === match.id && <div className="bracket-inline-editor" onClick={(event) => event.stopPropagation()}><label>Date<input type="date" defaultValue={match.match_date || ""} id={`date-${match.id}`} /></label><label>Time<input type="time" defaultValue={match.start_time || ""} id={`time-${match.id}`} /></label><label>Court<input type="text" defaultValue={match.court || ""} id={`court-${match.id}`} /></label><button className="btn primary small" onClick={() => void saveMatch(match, { match_date: (document.getElementById(`date-${match.id}`) as HTMLInputElement)?.value || "", start_time: (document.getElementById(`time-${match.id}`) as HTMLInputElement)?.value || "", court: (document.getElementById(`court-${match.id}`) as HTMLInputElement)?.value || "" })}>Save</button></div>}
      <i>{match ? "Linked dependency" : "Source dependency"}</i>
    </article>;
  };
  return (
    <section className="panel bracket-builder">
      <div className="panelhead">
        <div>
          <h3>Bracket Builder</h3>
          <small>
            Qualification and progression use the same matches shown in
            Schedule.
          </small>
        </div>
        <span aria-live="polite">{status}</span>
        <button
          className="btn primary"
          onClick={async () => {
            setStatus("Generating…");
            try {
              await api("/knockout/generate", {
                method: "POST",
                body: JSON.stringify({ mode: "groups" }),
              });
              await load();
              setStatus("Saved ✓");
            } catch (error: unknown) {
              setStatus(errorMessage(error, "Could not make bracket"));
            }
          }}
        >
          Make bracket
        </button>
      </div>
      {!bracket ? (
        <p className="empty-state">
          Generate a bracket after creating the group matches.
        </p>
      ) : (
        <div className="bracket-builder-board phase-layout">
          <section className="bracket-phase playoffs-phase"><h4>Play Offs and Finals</h4>
            <div className="bracket-subphase"><h5>P1–P4</h5><div className="phase-columns"><div><span className="phase-column-title">Semi-finals</span>{championship.filter((item) => item.key === "KO:sf1" || item.key === "KO:sf2").map((item) => renderCard(item, "semifinal"))}</div><div><span className="phase-column-title">Finals</span>{championship.filter((item) => item.key === "KO:final" || item.key === "KO:3rd").map((item) => renderCard(item, "final"))}</div></div></div>
            <div className="bracket-subphase"><h5>P5–P8</h5><div className="phase-columns"><div><span className="phase-column-title">Intermediate</span>{placements.filter((item) => item.key === "KO:5a" || item.key === "KO:5b").map((item) => renderCard(item, "intermediate"))}</div><div><span className="phase-column-title">Placement finals</span>{placements.filter((item) => item.key === "KO:7th" || item.key === "KO:5th").map((item) => renderCard(item, "placement"))}</div></div></div>
          </section>
        </div>
      )}
    </section>
  );
}
