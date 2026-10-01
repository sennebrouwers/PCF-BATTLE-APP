import { PUBLIC_CONTACT_EMAIL } from "@/lib/public-organization";
import type { PublicFaqGroup } from "@/lib/public-faq";

export type AiKnowledgeEntry = { title: string; content: string };

function splitLegacyKnowledge(raw: string): AiKnowledgeEntry[] {
  const contentBlocks: string[] = [];
  let block = "";
  for (const paragraph of raw.split(/\n\s*\n/).map((part) => part.trim()).filter(Boolean)) {
    for (let offset = 0; offset < paragraph.length; offset += 4000) {
      const part = paragraph.slice(offset, offset + 4000);
      if (block && block.length + part.length + 2 > 4000) { contentBlocks.push(block); block = ""; }
      block = block ? `${block}\n\n${part}` : part;
    }
  }
  if (block) contentBlocks.push(block);
  return contentBlocks.map((content, index) => ({ title: contentBlocks.length > 1 ? `Existing tournament information ${index + 1}` : "Existing tournament information", content }));
}

export function parseAiKnowledge(value: unknown): AiKnowledgeEntry[] {
  const raw = String(value ?? "").trim();
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.flatMap((item): AiKnowledgeEntry[] => {
        if (!item || typeof item !== "object") return [];
        const title = String((item as AiKnowledgeEntry).title ?? "").trim();
        const content = String((item as AiKnowledgeEntry).content ?? "").trim();
        return title && content ? [{ title, content }] : [];
      });
    }
  } catch {
    // Older editions stored this field as a plain text FAQ/information block.
  }
  return splitLegacyKnowledge(raw);
}

export function calculateGroupStandings(teams: Row[], matches: Row[], group: "A" | "B"): Row[] {
  return teams.filter((team) => clean(team.group_id).replace(/^group-/i, "").toUpperCase() === group).map((team): Row => {
    let played = 0, points = 0, goalsFor = 0, goalsAgainst = 0;
    for (const match of matches) {
      if (match.status !== "finished" || Number(match.confirmed) !== 1 || clean(match.group_id).replace(/^group-/i, "").toUpperCase() !== group || ![match.home_team_id, match.away_team_id].includes(team.id)) continue;
      played++;
      const home = match.home_team_id === team.id;
      const scored = Number(home ? match.home_score : match.away_score) || 0;
      const conceded = Number(home ? match.away_score : match.home_score) || 0;
      goalsFor += scored; goalsAgainst += conceded;
      points += scored > conceded ? 3 : scored === conceded ? 1 : 0;
    }
    return { ...team, played, points, goalsFor, goalsAgainst, goalDifference: goalsFor - goalsAgainst };
  }).sort((a, b) => Number(b.points) - Number(a.points) || Number(b.goalDifference) - Number(a.goalDifference) || Number(b.goalsFor) - Number(a.goalsFor) || clean(a.name).localeCompare(clean(b.name)));
}

type Row = Record<string, unknown>;
type AssistantContext = {
  tournament: Row;
  teams: Row[];
  matches: Row[];
  schedule: Row[];
  groups: { A: Row[]; B: Row[] };
  knowledge: AiKnowledgeEntry[];
  scorers?: Row[];
  players?: Row[];
  ownClassifications?: Row[];
  mvpEnabled?: boolean | null;
  faqs?: PublicFaqGroup[];
  language?: string;
  ownTeamId?: string | null;
};

const clean = (value: unknown) => String(value ?? "").trim();
const norm = (value: string) => value.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
const has = (question: string, terms: string[]) => terms.some((term) => question.includes(term));
const stopWords = new Set(["the", "and", "for", "from", "with", "what", "when", "where", "which", "who", "how", "does", "can", "are", "is", "you", "your", "our", "about", "into", "over", "een", "het", "wat", "waar", "wanneer", "wie", "hoe", "voor", "van", "met", "zijn", "kan", "ons", "onze"]);
const formatDate = (value: unknown) => {
  const date = clean(value);
  if (!date) return "time to be announced";
  const parsed = new Date(`${date.slice(0, 10)}T12:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? date : new Intl.DateTimeFormat("en-GB", { dateStyle: "long", timeZone: "UTC" }).format(parsed);
};
const groupName = (value: unknown) => {
  const key = clean(value).replace(/^group-/i, "").toUpperCase();
  return key === "A" || key === "B" ? `Group ${key}` : key.startsWith("KO:") ? "Knockout stage" : "Tournament";
};
const recordFor = (entry: AiKnowledgeEntry, question: string) => {
  const text = norm(`${entry.title} ${entry.content}`);
  const words = [...new Set(norm(question).split(/[^a-z0-9]+/).filter((word) => word.length > 2 && !stopWords.has(word)))];
  return words.reduce((score, word) => score + (text.includes(word) ? (norm(entry.title).includes(word) ? 3 : 1) : 0), 0);
};

export function answerTournamentQuestion(message: string, context: AssistantContext): string {
  const question = norm(message);
  const nl = context.language === "nl";
  const t = context.tournament;
  const teamMentioned = [...context.teams].sort((a, b) => clean(b.name).length - clean(a.name).length)
    .find((team) => clean(team.name).length > 1 && question.includes(norm(clean(team.name))));
  const team = teamMentioned || context.teams.find((row) => row.id === context.ownTeamId);
  const teamMatches = team ? context.matches.filter((match) => match.home_team_id === team.id || match.away_team_id === team.id) : [];

  if (has(question, ["live", "currently playing", "now playing", "livewedstrijd", "live wedstrijd"])) {
    if (Number(t.live_enabled) === 0) return nl ? "Live wedstrijdinformatie is momenteel uitgeschakeld." : "Live match information is currently disabled.";
    const live = context.matches.filter((match) => match.status === "live");
    if (!live.length) return nl ? "Er is momenteel geen live wedstrijd." : "There are no live matches at the moment.";
    return `${nl ? "Live nu" : "Live now"}: ${live.map((match) => `${clean(match.home_name) || "TBD"} ${Number(match.home_score) || 0}–${Number(match.away_score) || 0} ${clean(match.away_name) || "TBD"}`).join("; ")}.`;
  }

  if (has(question, ["stand", "ranking", "rank", "leader", "leading", "first", "positie", "klassement", "groep", "group"]) && has(question, ["stand", "ranking", "rank", "leader", "leading", "first", "top", "position", "positie", "klassement", "group", "groep", "points", "punten"])) {
    const group = /\b(group|groep)\s*a\b/.test(question) ? "A" : /\b(group|groep)\s*b\b/.test(question) ? "B" : null;
    const rows = group ? context.groups[group] : [...context.groups.A, ...context.groups.B];
    if (team) {
      const position = rows.findIndex((row) => row.id === team.id);
      if (position >= 0) {
        const row = rows[position];
        return `${clean(team.name)} is ${position + 1}${position === 0 ? "st" : position === 1 ? "nd" : position === 2 ? "rd" : "th"} in Group ${group || clean(team.group_id).replace(/^group-/i, "")}, with ${Number(row.points) || 0} points from ${Number(row.played) || 0} matches.`;
      }
    }
    if (!rows.length) return nl ? "De groepsstanden zijn nog niet beschikbaar." : "Group standings are not available yet.";
    if (group) return `${nl ? "Stand" : "Standings"} — Group ${group}: ${rows.map((row, index) => `${index + 1}. ${clean(row.name)} (${Number(row.points) || 0} pts)`).join("; ")}.`;
    return `Group A: ${context.groups.A.map((row, index) => `${index + 1}. ${clean(row.name)} (${Number(row.points) || 0} pts)`).join("; ") || (nl ? "nog geen uitslagen" : "no results yet")}. Group B: ${context.groups.B.map((row, index) => `${index + 1}. ${clean(row.name)} (${Number(row.points) || 0} pts)`).join("; ") || (nl ? "nog geen uitslagen" : "no results yet")}.`;
  }

  const asksKnockoutFixture = has(question, ["semi", "semifinal", "semi-final", "bronze", "third place", "3rd place", "fifth", "5th place", "seventh", "7th place", "finalist", "who plays in the final", "final match"]);
  if (asksKnockoutFixture) {
    const a = context.groups.A, b = context.groups.B;
    const seed = (group: Row[], position: number) => clean(group[position - 1]?.name) || `the ${position}${position === 1 ? "st" : position === 2 ? "nd" : position === 3 ? "rd" : "th"}-placed team in Group ${group === a ? "A" : "B"}`;
    const fixture = (key: string, label: string, fallback: [string, string]) => {
      const match = context.matches.find((row) => row.group_id === key);
      const home = clean(match?.home_name), away = clean(match?.away_name);
      if (home && away) return `${label}: ${home} vs ${away}${match?.status === "finished" || match?.status === "live" ? ` (${Number(match.home_score) || 0}–${Number(match.away_score) || 0})` : ""}`;
      return `${label}: ${fallback[0]} vs ${fallback[1]}`;
    };
    if (has(question, ["bronze", "third place", "3rd place"])) return fixture("KO:3rd", "Bronze match", ["Loser of Semi-final 1", "Loser of Semi-final 2"]);
    if (has(question, ["fifth", "5th place"])) return fixture("KO:5th", "5th-place match", ["Winner of Play-off 1", "Winner of Play-off 2"]);
    if (has(question, ["seventh", "7th place"])) return fixture("KO:7th", "7th-place match", ["Loser of Play-off 1", "Loser of Play-off 2"]);
    if (has(question, ["semi", "semifinal", "semi-final"])) return [
      fixture("KO:sf1", "Semi-final 1", [seed(a, 1), seed(b, 2)]),
      fixture("KO:sf2", "Semi-final 2", [seed(b, 1), seed(a, 2)]),
    ].join("; ");
    const finalMatch = context.matches.find((row) => row.group_id === "KO:final");
    if (finalMatch?.home_name && finalMatch?.away_name) return fixture("KO:final", "Final", ["Winner of Semi-final 1", "Winner of Semi-final 2"]);
    return "The final is played by the two semi-final winners. Semi-final 1: 1st Group A vs 2nd Group B; Semi-final 2: 1st Group B vs 2nd Group A.";
  }

  if (has(question, ["schedule", "fixture", "fixtures", "match", "matches", "play", "when", "time", "wedstrijd", "speel", "schema", "speelt"])) {
    const matches = (team ? teamMatches : context.matches).filter((match) => match.status !== "cancelled");
    if (!matches.length && (team || !context.schedule.length)) return team ? `${clean(team.name)} ${nl ? "heeft nog geen gepubliceerde wedstrijden" : "does not have published matches yet"}.` : (nl ? "Het wedstrijdschema is nog niet gepubliceerd." : "The match schedule has not been published yet.");
    const scheduled = !team && context.schedule.length
      ? context.schedule.map((item) => item.item_type === "match" ? matches.find((match) => match.id === item.match_id) : item).filter(Boolean) as Row[]
      : matches;
    const rows = scheduled.slice(0, team ? 20 : 12).map((match) => {
      if (match.item_type && match.item_type !== "match") return `${formatDate(match.match_date)}${match.start_time ? ` at ${clean(match.start_time)}` : ""}: ${clean(match.label) || (nl ? "Onderdeel" : "Schedule item")}`;
      const home = clean(match.home_name) || "TBD", away = clean(match.away_name) || "TBD";
      const score = match.status === "finished" || match.status === "live" ? ` (${Number(match.home_score) || 0}–${Number(match.away_score) || 0})` : "";
      const status = match.status === "live" ? (nl ? "LIVE" : "LIVE") : match.status === "finished" ? (nl ? "afgelopen" : "finished") : "";
      return `${formatDate(match.match_date)}${match.start_time ? ` at ${clean(match.start_time)}` : ""}: ${home} vs ${away}${score}${status ? ` · ${status}` : ""} · ${groupName(match.group_id)}`;
    });
    return `${team ? `${clean(team.name)} — ` : ""}${nl ? "Wedstrijden" : "Matches"}: ${rows.join("; ")}${scheduled.length > rows.length ? `; ${nl ? "en" : "and"} ${scheduled.length - rows.length} more on the Schedule page.` : ""}`;
  }

  if (has(question, ["result", "score", "uitslag", "resultaat"]) && team) {
    const results = teamMatches.filter((match) => match.status === "finished");
    return results.length ? `${clean(team.name)} ${nl ? "resultaten" : "results"}: ${results.map((match) => `${clean(match.home_name)} ${Number(match.home_score) || 0}–${Number(match.away_score) || 0} ${clean(match.away_name)} (${formatDate(match.match_date)})`).join("; ")}.` : (nl ? "Er zijn nog geen bevestigde resultaten voor" : "There are no confirmed results for") + ` ${clean(team.name)}.`;
  }

  if (has(question, ["hotel", "check in", "check-in", "check out", "check-out", "overnight", "stay", "accommodation", "hotelverblijf", "overnachting"])) {
    const details = [t.hotel_name, t.hotel_address, t.hotel_checkin && `${nl ? "Inchecken" : "Check-in"}: ${t.hotel_checkin}`, t.hotel_checkout && `${nl ? "Uitchecken" : "Check-out"}: ${t.hotel_checkout}`, t.hotel_accessibility_info, t.hotel_info].map(clean).filter(Boolean);
    return details.length ? `${nl ? "Hotelinformatie" : "Hotel information"}: ${details.join(" · ")}` : (nl ? "Hotelinformatie is nog niet gepubliceerd." : "Hotel information has not been published yet.");
  }

  if (has(question, ["venue", "where", "address", "location", "parking", "accessible", "accessibility", "wheelchair", "catering", "food", "opening", "visitor", "spectator", "locatie", "adres", "parkeren", "toegankelijk", "eten", "bezoeker"])) {
    const venue = [t.venue_name, [t.city, t.country].filter(Boolean).join(", "), t.venue_address].map(clean).filter(Boolean);
    const details = [
      has(question, ["when", "date", "dates", "wanneer", "datum"]) && t.start_date ? `${nl ? "Datum" : "Dates"}: ${formatDate(t.start_date)}${t.end_date ? ` – ${formatDate(t.end_date)}` : ""}` : "",
      has(question, ["parking", "park", "parkeren"]) ? t.parking_info : "",
      has(question, ["accessible", "accessibility", "wheelchair", "toegankelijk"]) ? t.accessibility_info : "",
      has(question, ["catering", "food", "eten"]) ? t.catering_info : "",
      has(question, ["opening", "hours", "openingstijd"]) ? t.opening_hours : "",
      has(question, ["visitor", "spectator", "bezoeker", "toeschouwer"]) ? t.visitor_info : "",
    ].map(clean).filter(Boolean);
    if (venue.length || details.length) return `${nl ? "Praktische informatie" : "Practical information"}: ${[...venue, ...details].join(" · ")}`;
    return nl ? "De praktische informatie is nog niet gepubliceerd." : "Practical information has not been published yet.";
  }

  if (has(question, ["livestream", "stream", "watch online", "live stream", "livestreamen"])) {
    return Number(t.show_livestream) === 1 && clean(t.livestream_url)
      ? `${nl ? "Bekijk de livestream" : "Watch the livestream"}: ${clean(t.livestream_url)}`
      : (nl ? "Er is nog geen livestreamlink gepubliceerd." : "A livestream link has not been published yet.");
  }

  if (has(question, ["top scorer", "top goalscorer", "most goals", "scorer", "goalscorer", "doelpuntenmaker", "topschutter"])) {
    const scorers = context.scorers || [];
    return scorers.length
      ? `${nl ? "Topschutters" : "Top scorers"}: ${scorers.map((row) => `${clean(row.player_name)} (${Number(row.goals) || 0}, ${clean(row.team_name)})`).join("; ")}.`
      : (nl ? "Er zijn nog geen gepubliceerde doelpunten." : "There are no published goals yet.");
  }

  if (has(question, ["mvp", "most valuable", "voting", "vote", "stemmen", "stemming"])) {
    return context.mvpEnabled === null || context.mvpEnabled === undefined
      ? (nl ? "De MVP-stemming is nog niet ingesteld." : "MVP voting has not been configured yet.")
      : context.mvpEnabled
        ? (nl ? "De MVP-stemming staat open voor bevoegde scheidsrechters." : "MVP voting is open for eligible referees.")
        : (nl ? "De MVP-stemming is momenteel gesloten." : "MVP voting is currently closed.");
  }

  if (has(question, ["classification", "classified", "class points", "classificatie", "classificatiepunten"])) {
    const knowledge = context.knowledge.map((entry) => ({ entry, score: recordFor(entry, message) })).sort((a, b) => b.score - a.score)[0];
    if (knowledge && knowledge.score >= 2) return `${knowledge.entry.title}: ${knowledge.entry.content}`;
    if (context.ownClassifications?.length) return `${nl ? "Classificatie van jouw team" : "Your team’s player classifications"}: ${context.ownClassifications.map((row) => `${clean(row.name)} (${clean(row.player_role) || (nl ? "speler" : "player")}, ${row.classification_points ?? "—"} ${nl ? "punten" : "points"})`).join("; ")}.`;
    return nl ? "Individuele classificatiegegevens zijn alleen beschikbaar in het beveiligde Team Portal van het eigen team. Meld je aan om deze gegevens te bekijken." : "Individual classification details are only available in the team’s secure Team Portal. Sign in to see your own team’s information.";
  }

  if (has(question, ["player", "players", "roster", "squad", "speler", "spelers", "selectie"])) {
    const selectedPlayers = (context.players || []).filter((player) => !team || player.team_id === team.id);
    return selectedPlayers.length
      ? `${team ? `${clean(team.name)} — ` : ""}${nl ? "Openbaar gedeelde spelers" : "Public player roster"}: ${selectedPlayers.slice(0, 20).map((player) => `${clean(player.name)}${player.number !== null && player.number !== undefined ? ` #${clean(player.number)}` : ""}${!team && player.team_name ? ` (${clean(player.team_name)})` : ""}`).join("; ")}.`
      : (nl ? "Er zijn nog geen spelers openbaar gedeeld." : "No players have been publicly shared yet.");
  }

  if (has(question, ["which teams", "participating teams", "teams playing", "deelnemende teams", "welke teams", "teamlijst"])) {
    return context.teams.length
      ? `${nl ? "Deelnemende teams" : "Participating teams"}: ${context.teams.map((row) => clean(row.name)).filter(Boolean).join(", ")}.`
      : (nl ? "De deelnemende teams worden bekendgemaakt zodra ze bevestigd zijn." : "Participating teams will be published as they are confirmed.");
  }

  if (has(question, ["award", "awards", "trophy", "prize", "prijs", "prijzen", "award ceremony"])) {
    return clean(t.award_info) || (nl ? "Informatie over de prijsuitreiking is nog niet gepubliceerd." : "Award ceremony information has not been published yet.");
  }

  if (has(question, ["room", "rooms", "payment", "deposit", "invoice", "delegation", "player registration", "kamer", "betaling", "aanbetaling", "delegatie"])) {
    return nl
      ? "Team-specifieke delegatie-, kamer- en betalingsgegevens zijn alleen zichtbaar in het beveiligde Team Portal. Meld je daar aan of neem contact op met de organisatie."
      : "Team-specific delegation, room and payment details are available in the secure Team Portal. Sign in there or contact the organisation for help.";
  }

  if (has(question, ["registration", "register", "deadline", "preregister", "inschrijving", "registreren", "inschrijven", "invitation", "uitnodiging", "registration closes", "registration close"])) {
    const status = Number(t.registration_enabled) === 1 ? (nl ? "Inschrijvingen zijn momenteel geopend." : "Registration is currently open.") : (nl ? "Inschrijvingen zijn momenteel gesloten." : "Registration is currently closed.");
    const mode = Number(t.registration_mode) === 1 ? (nl ? " Teams kunnen zich aanmelden via de registratiepagina; aanmelden garandeert geen selectie." : " Teams can apply on the registration page; applying does not guarantee selection.") : "";
    const deadline = context.knowledge.map((entry) => ({ entry, score: recordFor(entry, message) }))
      .filter(({ entry, score }) => score >= 2 && has(norm(entry.title), ["registration", "deadline", "closing", "inschrijf", "registratie"]))
      .sort((a, b) => b.score - a.score)[0]?.entry;
    return `${status}${mode}${deadline ? ` ${deadline.content}` : ""}`;
  }

  if (has(question, ["format", "how many teams", "group", "groups", "knockout", "final", "placement", "match format", "rule", "regels", "format", "toernooiopzet"])) {
    const rules = clean(t.format_rules);
    const defaultFormat = "PCF Battle is an 8-team, 5v5 Powerchair Floorball tournament with Groups A and B. Day 1 is a round-robin group stage (three matches per team). On Day 2, teams play semi-finals and finals for places 1–4, plus placement matches for places 5–8. Every team plays on both days and receives a final position from 1st to 8th.";
    if (has(question, ["rule", "rules", "spelregel", "reglement", "regels"])) {
      const knowledge = context.knowledge.find((entry) => has(norm(entry.title), ["rule", "spelregel", "reglement"]));
      return rules || knowledge?.content || (nl ? "De actuele spelregels zijn nog niet gepubliceerd. Neem contact op met de organisatie voor de officiële regels." : "The current playing rules have not been published yet. Contact the organisation for the official rules.");
    }
    return rules ? `${nl ? "Toernooiformat en regels" : "Tournament format and rules"}: ${rules}` : defaultFormat;
  }

  if (has(question, ["date", "when is", "when does", "dates", "datum", "wanneer"])) {
    const date = t.start_date ? `${formatDate(t.start_date)}${t.end_date ? ` to ${formatDate(t.end_date)}` : ""}` : "not published yet";
    return `${nl ? "PCF Battle vindt plaats op" : "PCF Battle takes place"} ${date}${t.city || t.country ? ` in ${[t.city, t.country].filter(Boolean).join(", ")}` : ""}.`;
  }

  if (has(question, ["instagram", "facebook", "social", "contact", "email", "contacteer", "contact opnemen"])) {
    const links = [
      `Instagram: ${clean(t.instagram_url) || "https://www.instagram.com/pcfbattle"}`,
      "Facebook: https://www.facebook.com/pcfbattle",
      `Email: ${PUBLIC_CONTACT_EMAIL}`,
    ];
    return `${nl ? "Neem contact op met de organisatie" : "Contact the organisation"}: ${links.join(" · ")}`;
  }

  const faqMatches = (context.faqs || []).flatMap((group) => group.questions).map((item) => ({ item, score: recordFor({ title: item.question, content: "" }, message) })).sort((a, b) => b.score - a.score);
  if (faqMatches[0]?.score >= 2) return faqMatches[0].item.answer;

  const ranked = context.knowledge.map((entry) => ({ entry, score: recordFor(entry, message) })).sort((a, b) => b.score - a.score);
  if (ranked[0]?.score >= 2) return `${ranked[0].entry.title}: ${ranked[0].entry.content}`;

  return nl
    ? `Ik kan helpen met actuele wedstrijden, standen, locatie, hotel en toernooipraktische informatie. Ik kan dit antwoord nog niet vinden. Neem contact op met ${PUBLIC_CONTACT_EMAIL}.`
    : `I can help with current matches, standings, venue, hotel and tournament practical information. I could not find this answer in the published information yet. Please contact ${PUBLIC_CONTACT_EMAIL}.`;
}
