import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));

test("assistant answers from active schedule, standings and Admin knowledge", { timeout: 30_000 }, async () => {
  const vite = await createServer({
    appType: "custom",
    configFile: false,
    root,
    resolve: { alias: { "@": root } },
    server: { middlewareMode: true, hmr: false },
    logLevel: "error",
  });
  try {
    const [{ answerTournamentQuestion, calculateGroupStandings, parseAiKnowledge }, { getPublicFaq }] = await Promise.all([
      vite.ssrLoadModule("/lib/tournament-assistant.ts"),
      vite.ssrLoadModule("/lib/public-faq.ts"),
    ]);
    const context = {
      tournament: { start_date: "2027-06-12", end_date: "2027-06-13", city: "Leuven", country: "Belgium", venue_name: "Sportoase", venue_address: "Philipssite", parking_info: "Parking P1", registration_enabled: 0, registration_mode: 1 },
      teams: [{ id: "t1", name: "Falcons", group_id: "A" }, { id: "t2", name: "Wolves", group_id: "B" }],
      matches: [{ id: "m1", home_team_id: "t1", away_team_id: "t2", home_name: "Falcons", away_name: "Wolves", status: "scheduled", match_date: "2027-06-12", start_time: "10:30", group_id: "A" }],
      schedule: [{ id: "s1", item_type: "match", match_id: "m1", match_date: "2027-06-12", start_time: "10:30" }, { id: "s2", item_type: "break", label: "Opening ceremony", match_date: "2027-06-12", start_time: "09:00" }],
      groups: { A: [{ id: "t1", name: "Falcons", played: 1, points: 3 }], B: [{ id: "t2", name: "Wolves", played: 1, points: 0 }] },
      knowledge: parseAiKnowledge(JSON.stringify([{ title: "Airport", content: "Brussels Airport is the closest major airport; allow an hour for the train to Leuven." }])),
      faqs: getPublicFaq({ start_date: "2027-06-12", end_date: "2027-06-13", venue_name: "Sportoase", venue_address: "Philipssite" }, 2),
      language: "en",
      ownTeamId: null,
    };
    assert.match(answerTournamentQuestion("When does Falcons play?", context), /Falcons vs Wolves/);
    assert.match(answerTournamentQuestion("Who is first in Group A?", context), /Falcons/);
    assert.match(answerTournamentQuestion("Where can I park?", context), /Parking P1/);
    assert.match(answerTournamentQuestion("How do I get from the airport?", context), /Brussels Airport/);
    assert.match(answerTournamentQuestion("Is registration open?", context), /currently closed/);
    assert.match(answerTournamentQuestion("What is on the schedule?", context), /Opening ceremony/);
    assert.match(answerTournamentQuestion("What is powerchair floorball?", context), /fast-paced, inclusive team sport/);
    assert.deepEqual(calculateGroupStandings(context.teams, [
      { home_team_id: "t1", away_team_id: "t2", home_score: 2, away_score: 1, status: "finished", confirmed: 1, group_id: "A" },
      { home_team_id: "t1", away_team_id: "t2", home_score: 0, away_score: 1, status: "finished", confirmed: 0, group_id: "A" },
    ], "A").map(({ name, points }) => [name, points]), [["Falcons", 3]]);
    assert.deepEqual(parseAiKnowledge("legacy FAQ text"), [{ title: "Existing tournament information", content: "legacy FAQ text" }]);
  } finally {
    await vite.close();
  }
});
