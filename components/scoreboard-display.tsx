"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";

type ScoreboardTeam = { id: string; name?: string; logo?: string; color?: string };
type ScoreboardMatch = {
  id: string;
  home_team_id?: string;
  away_team_id?: string;
  home_score?: number;
  away_score?: number;
  status?: string;
  clock?: string;
  clock_running?: number;
  clock_started_at?: string;
  period?: string;
  start_time?: string;
  scoreboard_mode?: string;
};
type ScoreboardEvent = { id?: string; team_id?: string; type?: string; details?: string };
type ScoreboardSettings = { scoreboard_show_sponsors?: number; scoreboard_accent?: string; scoreboard_background?: string; scoreboard_logo_scale?: number };
type Sponsor = { url: string; title?: string };
type ScoreboardState = { match: ScoreboardMatch | null; teams: ScoreboardTeam[]; goals: ScoreboardEvent[]; incidents: ScoreboardEvent[]; settings: ScoreboardSettings; sponsors: Sponsor[] };

function clockSeconds(match: ScoreboardMatch | null) {
  if (!match) return 0;
  const [minutes = "0", seconds = "0"] = String(match.clock || "00:00").split(":");
  const base = Number(minutes) * 60 + Number(seconds);
  if (!match.clock_running || !match.clock_started_at) return base;
  return Math.max(0, base - Math.floor((Date.now() - new Date(match.clock_started_at).getTime()) / 1000));
}

export default function ScoreboardDisplay() {
  const [state, setState] = useState<ScoreboardState | null>(null),
    [tick, setTick] = useState(0),
    [offline, setOffline] = useState(false),
    [started, setStarted] = useState(false),
    [goalFlash, setGoalFlash] = useState(false),
    lastGoalCount = useRef<number | null>(null),
    lastMatchId = useRef<string | null>(null),
    previousSeconds = useRef<number | null>(null),
    audio = useRef<AudioContext | null>(null);
  useEffect(() => {
    const matchId = new URLSearchParams(location.search).get("match") || "";
    let stopped = false;
    let refreshBusy = false;
    const load = async () => {
      if (document.hidden || refreshBusy) return;
      refreshBusy = true;
      try {
        const response = await fetch(`/api/scoreboard-state${matchId ? `?matchId=${encodeURIComponent(matchId)}` : ""}`, { cache: "no-store", credentials: "same-origin" });
        if (response.status === 401 || response.status === 403)
          return location.assign(`/login?return=${encodeURIComponent(location.pathname + location.search)}`);
        if (!response.ok) throw new Error("Scoreboard unavailable");
        const next = await response.json();
        if (!stopped) { setState(next); setOffline(false); }
      } catch { if (!stopped) setOffline(true); }
      finally { refreshBusy = false; }
    };
    load();
    const sync = setInterval(load, 2000), second = setInterval(() => setTick((value) => value + 1), 250);
    const onVisibility = () => { if (!document.hidden) void load(); };
    document.addEventListener("visibilitychange", onVisibility);
    return () => { stopped = true; clearInterval(sync); clearInterval(second); document.removeEventListener("visibilitychange", onVisibility); };
  }, []);
  const match = state?.match || null,
    home = state?.teams.find((team) => team.id === match?.home_team_id),
    away = state?.teams.find((team) => team.id === match?.away_team_id),
    remaining = useMemo(() => {
      // The clock tick is intentionally read here so the memo recalculates
      // while a running match is displayed.
      void tick;
      return clockSeconds(match);
    }, [match, tick]),
    clock = `${Math.floor(remaining / 60).toString().padStart(2, "0")}:${(remaining % 60).toString().padStart(2, "0")}`;
  useEffect(() => {
    if (!state?.match) return;
    const count = state?.goals?.length ?? 0;
    if (lastMatchId.current !== state.match.id) {
      lastMatchId.current = state.match.id;
      lastGoalCount.current = count;
      return;
    }
    if (lastGoalCount.current !== null && count > lastGoalCount.current) {
      setGoalFlash(true);
      const timeout = setTimeout(() => setGoalFlash(false), 2600);
      lastGoalCount.current = count;
      return () => clearTimeout(timeout);
    }
    lastGoalCount.current = count;
  }, [state?.goals?.length, state?.match]);
  useEffect(() => {
    if (previousSeconds.current !== null && previousSeconds.current > 0 && remaining === 0 && match?.clock_running) {
      const context = audio.current;
      if (context) {
        const start = context.currentTime,
          master = context.createGain(),
          compressor = context.createDynamicsCompressor();
        compressor.threshold.value = -24;
        compressor.knee.value = 8;
        compressor.ratio.value = 16;
        compressor.attack.value = .002;
        compressor.release.value = .3;
        master.gain.setValueAtTime(.0001, start);
        master.gain.exponentialRampToValueAtTime(1, start + .035);
        master.gain.setValueAtTime(1, start + 1.8);
        master.gain.exponentialRampToValueAtTime(.0001, start + 2.5);
        master.connect(compressor);
        compressor.connect(context.destination);
        [55, 82.4, 110, 138.6, 164.8].forEach((frequency, index) => {
          const oscillator = context.createOscillator(),
            voice = context.createGain();
          oscillator.type = index < 2 ? "square" : "sawtooth";
          oscillator.frequency.setValueAtTime(frequency * 1.04, start);
          oscillator.frequency.exponentialRampToValueAtTime(frequency, start + .18);
          voice.gain.value = index < 2 ? .2 : .16;
          oscillator.connect(voice);
          voice.connect(master);
          oscillator.start(start);
          oscillator.stop(start + 2.55);
        });
      }
    }
    previousSeconds.current = remaining;
  }, [remaining, match?.clock_running]);
  async function startScoreboard() {
    const Audio = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Audio) return;
    audio.current = audio.current || new Audio();
    await audio.current.resume();
    await document.documentElement.requestFullscreen?.().catch(() => undefined);
    setStarted(true);
  }
  if (!state) return <main className="scoreboard-screen loading"><img src="/PFB_Logo_Pink.svg" alt="PCF Battle" /></main>;
  if (!match) return <main className="scoreboard-screen waiting"><img src="/PFB_Logo_Pink.svg" alt="PCF Battle" /><h1>Waiting for the next match</h1></main>;
  const settings = state.settings || {},
    sponsors = state.sponsors || [],
    sponsor = sponsors[Math.floor(tick / 16) % Math.max(1, sponsors.length)],
    showSponsorRibbon = settings.scoreboard_show_sponsors !== 0 && sponsors.length > 0 && (match.status === "scheduled" || match.period === "Half-time"),
    style = { "--board-pink": settings.scoreboard_accent || "#f72585", "--board-bg": settings.scoreboard_background || "#100d12", "--logo-scale": `${Number(settings.scoreboard_logo_scale || 100) / 100}` } as CSSProperties & Record<`--${string}`, string>;
  if (match.scoreboard_mode === "black") return <main className="scoreboard-black" />;
  if (match.scoreboard_mode === "sponsors") return <main className="scoreboard-sponsor-screen">
    {!started && <button className="scoreboard-start" onClick={startScoreboard}><img src="/PFB_Logo_Pink.svg" alt="" /><b>Start sponsor screen</b><span>Enables fullscreen and sound</span></button>}
    <header><img src="/PFB_Logo_Pink.svg" alt="PCF Battle" /><span>TOURNAMENT PARTNERS</span></header>
    <section>{sponsor ? <img src={sponsor.url} alt={sponsor.title || "Tournament partner"} /> : <><h1>No sponsors configured</h1><p>Add active sponsors in the Admin Portal.</p></>}</section>
  </main>;
  return <main className={`scoreboard-screen ${match.status}`} style={style}>
    {!started && <button className="scoreboard-start" onClick={startScoreboard}><img src="/PFB_Logo_Pink.svg" alt="" /><b>Start scoreboard</b><span>Enables fullscreen and the final buzzer</span></button>}
    {goalFlash && <div className="scoreboard-goal-flash"><strong>GOAL!</strong><span>{match.home_score} : {match.away_score}</span></div>}
    {offline && <div className="scoreboard-connection-warning">Connection lost — showing the last received score</div>}
    <header>
      <div className="scoreboard-brand"><img src="/PFB_Logo_Pink.svg" alt="PCF Battle" /><span>PCF <b>BATTLE</b></span></div>
      <strong className="scoreboard-status"><i />{match.status === "live" ? "LIVE" : match.status}</strong>
    </header>
    <section className="scoreboard-main">
      <article className="scoreboard-team home">
        <div className="scoreboard-crest">{home?.logo ? <img src={home.logo} alt="" /> : <i style={{ background: home?.color }} />}</div>
        <h1>{home?.name || "Home"}</h1>
      </article>
      <div className="scoreboard-centre">
        <span>{match.period || "Match"}</span>
        <time>{clock}</time>
        <div className="scoreboard-score"><b>{match.home_score}</b><em>:</em><b>{match.away_score}</b></div>
      </div>
      <article className="scoreboard-team away">
        <div className="scoreboard-crest">{away?.logo ? <img src={away.logo} alt="" /> : <i style={{ background: away?.color }} />}</div>
        <h1>{away?.name || "Away"}</h1>
      </article>
    </section>
    {showSponsorRibbon && sponsor && <aside className="scoreboard-sponsor"><small>PARTNER</small><img src={sponsor.url} alt={sponsor.title || "Tournament partner"} /></aside>}
    <div className="scoreboard-penalties home">{state.incidents?.filter((item) => item.team_id === match.home_team_id).slice(-2).map((item) => <span key={item.id}>{item.type}{item.details ? ` · ${item.details}` : ""}</span>)}</div>
    <div className="scoreboard-penalties away">{state.incidents?.filter((item) => item.team_id === match.away_team_id).slice(-2).map((item) => <span key={item.id}>{item.type}{item.details ? ` · ${item.details}` : ""}</span>)}</div>
    <footer><span>{match.start_time ? `Start · ${match.start_time}` : ""}</span><span className={offline ? "offline" : ""}>{offline ? "Reconnecting" : "Live sync"}</span></footer>
  </main>;
}
