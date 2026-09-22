"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { errorMessage, type Match, type Referee, type Team, type Tournament } from "@/types/app";
import { clientApi } from "@/lib/api-client";
type Item = {
  id: string;
  item_type: "match" | "break" | "ceremony";
  match_id?: string;
  label?: string;
  match_date?: string;
  start_time?: string;
  duration_minutes?: number;
  court?: string;
  [key: string]: unknown;
};
const api = clientApi;
const toMinutes = (v = "00:00") => {
  const [a, b] = v.split(":").map(Number);
  return (a || 0) * 60 + (b || 0);
};
const toTime = (n: number) =>
  `${String(Math.floor(n / 60) % 24).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
const groupColor = (value: string) => {
  const palette = [
    "#fff0c2",
    "#dff7e8",
    "#e4e0ff",
    "#dff4ff",
    "#ffe0eb",
    "#f1e4d2",
  ];
  let n = 0;
  for (const c of value) n = (n + c.charCodeAt(0)) % palette.length;
  return palette[n];
};
const placeholderNames: Record<string,string> = {"placeholder:KO:sf1:home":"1st Group A","placeholder:KO:sf1:away":"2nd Group B","placeholder:KO:sf2:home":"1st Group B","placeholder:KO:sf2:away":"2nd Group A","placeholder:KO:5a:home":"3rd Group A","placeholder:KO:5a:away":"4th Group B","placeholder:KO:5b:home":"3rd Group B","placeholder:KO:5b:away":"4th Group A","placeholder:KO:final:home":"Winner Semi-final 1","placeholder:KO:final:away":"Winner Semi-final 2","placeholder:KO:3rd:home":"Loser Semi-final 1","placeholder:KO:3rd:away":"Loser Semi-final 2","placeholder:KO:5th:home":"Winner Intermediate 1","placeholder:KO:5th:away":"Winner Intermediate 2","placeholder:KO:7th:home":"Loser Intermediate 1","placeholder:KO:7th:away":"Loser Intermediate 2"};
export default function ScheduleWorkspace({ refresh }: { refresh: number }) {
  const [items, setItems] = useState<Item[]>([]),
    [matches, setMatches] = useState<Match[]>([]),
    [teams, setTeams] = useState<Team[]>([]),
    [referees, setReferees] = useState<Referee[]>([]),
    [drag, setDrag] = useState<string | null>(null),
    [over, setOver] = useState<string | null>(null),
    [day, setDay] = useState("all"),
    [court, setCourt] = useState("all"),
    [status, setStatus] = useState(""),
    [selected, setSelected] = useState<Item | null>(null),
    [history, setHistory] = useState<Item[][]>([]),
    [future, setFuture] = useState<Item[][]>([]),
    [first, setFirst] = useState("09:00"),
    [duration, setDuration] = useState(15),
    [changeover, setChangeover] = useState(5),
    [minimumRest, setMinimumRest] = useState(10),
    [halftime, setHalftime] = useState(5),
    [tournamentId, setTournamentId] = useState("");
  const [loading, setLoading] = useState(true);
  const load = useCallback(() => {
    setLoading(true);
    return Promise.all([
      api("/schedule"),
      api("/matches"),
      api("/teams"),
      api("/referees"),
      api("/tournaments"),
    ])
      .then(([s, m, t, r, tr]) => {
        setItems(s.items || []);
        setMatches(Array.isArray(m) ? m : m.matches || []);
        setTeams(Array.isArray(t) ? t : t.teams || []);
        setReferees(Array.isArray(r) ? r : r.referees || []);
        const active =
          (Array.isArray(tr) ? tr : tr.tournaments || []).find(
            (x: any) => x.active,
          ) || (Array.isArray(tr) ? tr : tr.tournaments || [])[0];
        if (active) {
          setTournamentId(active.id);
          setFirst(active.schedule_start_time || "09:00");
          setDuration(
            Number(
              active.schedule_half_duration_minutes ||
                Math.max(
                  1,
                  Math.round(Number(active.match_duration_minutes || 30) / 2),
                ),
            ),
          );
          setChangeover(Number(active.schedule_changeover_minutes ?? 5));
          setMinimumRest(Number(active.schedule_min_rest_minutes ?? 10));
          setHalftime(Number(active.halftime_duration_minutes ?? 5));
        }
      })
      .catch((e: unknown) => setStatus(errorMessage(e)))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    load();
  }, [refresh]);
  const by = useMemo<Record<string, Match>>(
    () => Object.fromEntries(matches.map((m) => [m.id, m])),
    [matches],
  );
  const teamName = (id: string | undefined, match?: Match, side?: "home" | "away") => teams.find((t) => t.id === id)?.name || (id ? placeholderNames[id] : undefined) || (match?.group_id && side ? placeholderNames[`placeholder:${match.group_id}:${side}`] : null) || "TBD";
  const days = useMemo(
    () => [...new Set(items.map((i) => i.match_date).filter(Boolean))],
    [items],
  );
  const courts = useMemo(
    () => [...new Set(matches.map((m) => m.court).filter(Boolean))],
    [matches],
  );
  const visible = items.filter(
    (i) =>
      (day === "all" || i.match_date === day) &&
      (court === "all" || (i.court || by[i.match_id || ""]?.court) === court),
  );
  function recalculate(list: Item[]) {
    const cursor: Record<string, number> = {};
    return list.map((i) => {
      const m = by[i.match_id || ""],
        lane = `${i.match_date || "unscheduled"}|${i.court || m?.court || "all"}`,
        start = cursor[lane] ?? toMinutes(first);
      const length =
        i.item_type === "match"
          ? duration * 2 + halftime
          : Number(i.duration_minutes || (i.item_type === "break" ? 15 : 15));
      cursor[lane] = start + length + changeover;
      return { ...i, start_time: toTime(start) };
    });
  }
  const saveSettings = useCallback(async () => {
    if (!tournamentId) return;
    try {
      await api(`/tournaments/${tournamentId}`, {
        method: "PUT",
        body: JSON.stringify({
          schedule_start_time: first,
          schedule_half_duration_minutes: duration,
          match_duration_minutes: duration * 2,
          schedule_changeover_minutes: changeover,
          halftime_duration_minutes: halftime,
          schedule_min_rest_minutes: minimumRest,
        }),
      });
    } catch (e: unknown) {
      setStatus(errorMessage(e));
    }
  }, [tournamentId, first, duration, changeover, halftime, minimumRest]);
  useEffect(() => {
    if (tournamentId) void saveSettings();
  }, [saveSettings, tournamentId]);
  async function save(next: Item[], remember = true, message = "Saved ✓") {
    if (remember) setHistory((h) => [...h, items]);
    setFuture([]);
    setItems(next);
    setStatus("Saving…");
    try {
      await api("/schedule/reorder", {
        method: "PUT",
        body: JSON.stringify({ items: next }),
      });
      setStatus(message);
    } catch (e: unknown) {
      setStatus(errorMessage(e));
      await load();
    }
  }
  function move(id: string, target: string) {
    const a = items.findIndex((i) => i.id === id),
      b = items.findIndex((i) => i.id === target);
    if (a < 0 || b < 0 || a === b) return;
    const next = [...items],
      [x] = next.splice(a, 1);
    next.splice(b, 0, x);
    void save(recalculate(next));
    setDrag(null);
    setOver(null);
  }
  function moveRelative(id: string, direction: -1 | 1) {
    const index = items.findIndex((item) => item.id === id), target = items[index + direction];
    if (index < 0 || !target) return;
    move(id, target.id);
  }
  function recalculateCurrent() {
    if (!items.length) return;
    void save(recalculate(items), true, "Times recalculated ✓");
  }
  function undo() {
    const old = history[history.length - 1];
    if (!old) return;
    setHistory(history.slice(0, -1));
    setFuture((f) => [...f, items]);
    void save(old, false);
  }
  function redo() {
    const next = future[future.length - 1];
    if (!next) return;
    setFuture(future.slice(0, -1));
    setHistory((h) => [...h, items]);
    void save(next, false);
  }
  async function addBreak() {
    try {
      await api("/schedule/items", {
        method: "POST",
        body: JSON.stringify({
          label: "Break",
          match_date: day === "all" ? days[0] || null : day,
          start_time: first,
          duration_minutes: 15,
          court: court === "all" ? null : court,
        }),
      });
      await load();
      setStatus("Saved ✓");
    } catch (e: unknown) {
      setStatus(errorMessage(e));
    }
  }
  async function generateGroups() {
    setStatus("Generating…");
    try {
      const r = await api("/groups/generate-schedule", {
        method: "POST",
        body: JSON.stringify({}),
      });
      await load();
      setStatus(`${r.created || 0} group matches ready · Saved ✓`);
    } catch (e: unknown) {
      setStatus(errorMessage(e));
    }
  }
  function exportSchedule() {
    const escape = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
    const rows = [["Date", "Time", "Court", "Type", "Home / item", "Away", "Duration"]];
    for (const item of items) {
      const match = by[item.match_id || ""];
      rows.push([
        item.match_date || "",
        item.start_time || "",
        item.court || match?.court || "",
        item.item_type === "match" ? "Match" : String(item.item_type || "Break"),
        item.item_type === "match" ? teamName(match?.home_team_id, match, "home") : item.label || "Break",
        item.item_type === "match" ? teamName(match?.away_team_id, match, "away") : "",
        String(item.duration_minutes || ""),
      ]);
    }
    const blob = new Blob([rows.map((row) => row.map(escape).join(",")).join("\n")], { type: "text/csv;charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "pcf-battle-schedule.csv";
    link.click();
    URL.revokeObjectURL(link.href);
  }
  async function remove(item: Item) {
    if (!confirm("Remove this schedule item?")) return;
    try {
      await api(`/schedule_items/${item.id}`, { method: "DELETE" });
      setItems((v) => v.filter((x) => x.id !== item.id));
      setStatus("Saved ✓");
    } catch (e: unknown) {
      setStatus(errorMessage(e));
    }
  }
  return (
    <section className="panel schedule-workspace">
      <div className="panelhead">
        <div>
          <h3>Schedule</h3>
          <small>
            One ordered list for group matches, brackets, breaks and ceremonies.
          </small>
        </div>
        <strong aria-live="polite">{status}</strong>
      </div>
      <div className="schedule-toolbar">
        <select value={day} onChange={(e) => setDay(e.target.value)}>
          <option value="all">All days</option>
          {days.map((d) => (
            <option key={d}>{d}</option>
          ))}
        </select>
        <select value={court} onChange={(e) => setCourt(e.target.value)}>
          <option value="all">All courts</option>
          {courts.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
        <button className="btn" onClick={undo} disabled={!history.length}>
          Undo
        </button>
        <button className="btn" onClick={redo} disabled={!future.length}>
          Redo
        </button>
        <button className="btn" onClick={exportSchedule} disabled={!items.length}>
          Export schedule
        </button>
        <button className="btn" onClick={recalculateCurrent} disabled={!items.length}>
          Recalculate times
        </button>
        <button className="btn" onClick={addBreak}>
          + Break
        </button>
        <button className="btn primary" onClick={() => void generateGroups()}>
          Generate
        </button>
      </div>
      <div className="schedule-options">
        <label>
          First match
          <input
            type="time"
            value={first}
            onChange={(e) => setFirst(e.target.value)}
          />
        </label>
        <label>
          Duration per half
          <input
            type="number"
            min="1"
            value={duration}
            onChange={(e) => setDuration(+e.target.value)}
          />
        </label>
        <label>
          Halftime pause
          <input
            type="number"
            min="0"
            value={halftime}
            onChange={(e) => setHalftime(+e.target.value)}
          />
        </label>
        <label>
          Changeover
          <input
            type="number"
            min="0"
            value={changeover}
            onChange={(e) => setChangeover(+e.target.value)}
          />
        </label>
        <label>
          Minimum team rest
          <input
            type="number"
            min="0"
            value={minimumRest}
            onChange={(e) => setMinimumRest(+e.target.value)}
          />
        </label>
      </div>
      <div className="schedule-list">
        {loading && <div className="empty-state">Loading schedule…</div>}
        {!loading && status.startsWith("Request failed") && <div className="empty-state"><p>{status}</p><button className="btn" onClick={() => void load()}>Retry</button></div>}
        {!loading && !visible.length && !status.startsWith("Request failed") && <div className="empty-state">No schedule items yet. Use “Generate” or add a break.</div>}
        {visible.map((item) => {
          const m = by[item.match_id || ""],
            group = String(m?.group_id || "").toLowerCase(),
            stage =
              item.item_type === "break"
                ? "break"
                : group.startsWith("ko:")
                  ? ["ko:5a","ko:5b","ko:sf1","ko:sf2"].includes(group)
                    ? "playoffs"
                    : "finals"
                  : group
                    ? "group"
                    : "block";
          return (
            <div key={item.id}>
              {over === item.id && <div className="schedule-insertion-line" />}
              <article
                draggable
                onDragStart={() => setDrag(item.id)}
                onDragOver={(e) => {
                  e.preventDefault();
                  setOver(item.id);
                }}
                onDrop={() => drag && move(drag, item.id)}
                onClick={() => setSelected(item)}
                className={`schedule-row ${stage}`}
              >
                <time>{item.start_time || "TBD"}</time>
                <div className="schedule-card-main">
                  <strong>
                    {item.item_type === "match"
                      ? `${teamName(m?.home_team_id,m,"home")} — ${teamName(m?.away_team_id,m,"away")}`
                      : item.label || "Break"}
                  </strong>
                  <small>
                    {item.item_type === "match"
                      ? m?.court || "No court"
                      : item.duration_minutes || 15}{" "}
                    {item.item_type === "match" && <>· Referees: {m?.referee_names?.length ? m.referee_names.join(" · ") : "Not assigned"}</>}
                  </small>
                </div>
                {item.item_type === "match" && <button className="schedule-edit" onClick={(e) => { e.stopPropagation(); setSelected(item); }}>Edit</button>}
                <div className="schedule-reorder-actions" onClick={(e) => e.stopPropagation()}>
                  <button type="button" className="schedule-reorder" aria-label="Move schedule item earlier" onClick={() => moveRelative(item.id, -1)}>↑</button>
                  <button type="button" className="schedule-reorder" aria-label="Move schedule item later" onClick={() => moveRelative(item.id, 1)}>↓</button>
                </div>
                <span
                  className={`schedule-stage-label ${stage}`}
                  style={
                    stage === "group"
                      ? { background: groupColor(group), color: "#5a3447" }
                      : undefined
                  }
                >
                  {item.item_type === "break"
                    ? "BREAK"
                    : stage === "playoffs"
                      ? "PLAY OFFS"
                      : stage === "finals"
                        ? "FINALS"
                      : stage === "group"
                        ? `GROUP ${m?.group_id}`
                        : "BLOCK"}
                </span>
                <button
                  className="schedule-remove"
                  aria-label="Remove item"
                  onClick={(e) => {
                    e.stopPropagation();
                    void remove(item);
                  }}
                >
                  ×
                </button>
              </article>
            </div>
          );
        })}
      </div>
      {selected && (
        <aside key={selected.id} className="schedule-editor">
          <h4>Edit item</h4>
          {selected.item_type === "match" && by[selected.match_id || ""] && <>
            <p className="schedule-editor-match">{teamName(by[selected.match_id || ""]?.home_team_id, by[selected.match_id || ""], "home")} — {teamName(by[selected.match_id || ""]?.away_team_id, by[selected.match_id || ""], "away")}</p>
            <label>
              Referee 1
              <select value={by[selected.match_id || ""]?.referee_ids?.[0] || ""} onChange={(e) => setMatches((rows) => rows.map((row) => row.id === selected.match_id ? { ...row, referee_ids: [e.target.value, row.referee_ids?.[1] || ""] } : row))}>
                <option value="">Choose referee</option>
                {referees.map((referee) => <option key={referee.id} value={referee.id}>{referee.name}</option>)}
              </select>
            </label>
            <label>
              Referee 2
              <select value={by[selected.match_id || ""]?.referee_ids?.[1] || ""} onChange={(e) => setMatches((rows) => rows.map((row) => row.id === selected.match_id ? { ...row, referee_ids: [row.referee_ids?.[0] || "", e.target.value] } : row))}>
                <option value="">Choose referee</option>
                {referees.map((referee) => <option key={referee.id} value={referee.id}>{referee.name}</option>)}
              </select>
            </label>
          </>}
          <label>
            Date
            <input
              type="date"
              value={selected.match_date || by[selected.match_id || ""]?.match_date || ""}
              onClick={(e) => {
                e.stopPropagation();
                e.currentTarget.showPicker?.();
              }}
              onChange={(e) =>
                setSelected({ ...selected, match_date: e.target.value })
              }
            />
          </label>
          <label>
            Court
            <select
              value={selected.court || by[selected.match_id || ""]?.court || ""}
              onChange={(e) => setSelected({ ...selected, court: e.target.value || null })}
            >
              <option value="">No court</option>
              {[...new Set([...courts, selected.court, by[selected.match_id || ""]?.court].filter(Boolean) as string[])].map((value) => (
                <option key={value} value={value}>{value}</option>
              ))}
            </select>
          </label>
          <label>
            Time
            <input
              type="time"
              value={selected.start_time || ""}
              onChange={(e) =>
                setSelected({ ...selected, start_time: e.target.value })
              }
            />
          </label>
          <label>
            Duration
            <input
              type="number"
              min="1"
              value={selected.duration_minutes || 15}
              onChange={(e) =>
                setSelected({ ...selected, duration_minutes: +e.target.value })
              }
            />
          </label>
          <button
            className="btn primary"
            onClick={async () => {
              const match = selected.item_type === "match" ? by[selected.match_id || ""] : null;
              if (match) {
                const assigned = (match.referee_ids || []).filter(Boolean);
                try {
              const changes: Record<string, unknown> = { match_date: selected.match_date || null, start_time: selected.start_time || null, court: selected.court || null };
                  if (assigned.length) changes.referee_ids = assigned;
                  if (match.version !== undefined) changes.version = match.version;
                  await api(`/matches/${match.id}`, { method: "PUT", body: JSON.stringify(changes) });
                } catch (e: unknown) { setStatus(errorMessage(e)); return; }
              }
              await save(items.map((i) => (i.id === selected.id ? selected : i)));
              await load();
              setSelected(null);
            }}
          >
            Save
          </button>
          <button className="btn" onClick={() => setSelected(null)}>
            Close
          </button>
        </aside>
      )}
    </section>
  );
}
