import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));

test("match deletion is atomic and stays deleted from the schedule", { timeout: 30_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "pcf-match-delete-test-"));
  const originalUrl = process.env.TURSO_DATABASE_URL;
  const originalToken = process.env.TURSO_AUTH_TOKEN;
  process.env.TURSO_DATABASE_URL = `file:${join(directory, "test.sqlite")}`;
  process.env.TURSO_AUTH_TOKEN = "local-test-token";
  const vite = await createServer({
    appType: "custom",
    configFile: false,
    root,
    resolve: { alias: { "@": root } },
    server: { middlewareMode: true, hmr: false },
    logLevel: "error",
  });

  try {
    const [{ getDatabase }, { removeMatchAndScheduleItem }] = await Promise.all([
      vite.ssrLoadModule("/lib/turso-db.ts"),
      vite.ssrLoadModule("/lib/match-deletion.ts"),
    ]);
    const database = getDatabase();
    await database.prepare("CREATE TABLE matches (id TEXT PRIMARY KEY, tournament_id TEXT NOT NULL, confirmed INTEGER NOT NULL DEFAULT 0)").run();
    await database.prepare("CREATE TABLE schedule_items (id TEXT PRIMARY KEY, tournament_id TEXT NOT NULL, item_type TEXT NOT NULL, match_id TEXT)").run();
    await database.prepare("CREATE TABLE goal_events (id TEXT PRIMARY KEY, match_id TEXT NOT NULL)").run();
    await database.prepare("CREATE TABLE match_events (id TEXT PRIMARY KEY, match_id TEXT NOT NULL)").run();

    await database.prepare("INSERT INTO matches (id,tournament_id,confirmed) VALUES ('match-1','tournament-1',0)").run();
    await database.prepare("INSERT INTO schedule_items (id,tournament_id,item_type,match_id) VALUES ('schedule-1','tournament-1','match','match-1')").run();
    await database.prepare("INSERT INTO goal_events (id,match_id) VALUES ('goal-1','match-1')").run();
    await database.prepare("INSERT INTO match_events (id,match_id) VALUES ('event-1','match-1')").run();

    await database.prepare("INSERT INTO matches (id,tournament_id,confirmed) VALUES ('match-locked','tournament-1',1)").run();
    await database.prepare("INSERT INTO schedule_items (id,tournament_id,item_type,match_id) VALUES ('schedule-locked','tournament-1','match','match-locked')").run();

    const locked = await removeMatchAndScheduleItem(database, undefined, "schedule-locked");
    assert.equal(locked.locked, true);
    assert.equal(Number((await database.prepare("SELECT COUNT(*) count FROM matches WHERE id='match-locked'").first()).count), 1);

    const removed = await removeMatchAndScheduleItem(database, undefined, "schedule-1");
    assert.equal(removed.deletedMatch, true);
    assert.equal(Number((await database.prepare("SELECT COUNT(*) count FROM matches WHERE id='match-1'").first()).count), 0);
    assert.equal(Number((await database.prepare("SELECT COUNT(*) count FROM schedule_items WHERE match_id='match-1'").first()).count), 0);
    assert.equal(Number((await database.prepare("SELECT COUNT(*) count FROM goal_events WHERE match_id='match-1'").first()).count), 0);
    assert.equal(Number((await database.prepare("SELECT COUNT(*) count FROM match_events WHERE match_id='match-1'").first()).count), 0);

    await database.prepare("INSERT INTO matches (id,tournament_id,confirmed) VALUES ('match-atomic','tournament-1',0)").run();
    await database.prepare("INSERT INTO schedule_items (id,tournament_id,item_type,match_id) VALUES ('schedule-atomic','tournament-1','match','match-atomic')").run();
    await database.prepare("INSERT INTO goal_events (id,match_id) VALUES ('goal-atomic','match-atomic')").run();
    await database.prepare("DROP TABLE match_events").run();
    await assert.rejects(removeMatchAndScheduleItem(database, undefined, "schedule-atomic"));
    assert.equal(Number((await database.prepare("SELECT COUNT(*) count FROM matches WHERE id='match-atomic'").first()).count), 1);
    assert.equal(Number((await database.prepare("SELECT COUNT(*) count FROM schedule_items WHERE id='schedule-atomic'").first()).count), 1);
    assert.equal(Number((await database.prepare("SELECT COUNT(*) count FROM goal_events WHERE id='goal-atomic'").first()).count), 1);

    await database.prepare("CREATE TABLE match_events (id TEXT PRIMARY KEY, match_id TEXT NOT NULL)").run();
    await database.prepare("INSERT INTO match_events (id,match_id) VALUES ('event-atomic','match-atomic')").run();
    assert.equal((await removeMatchAndScheduleItem(database, undefined, "schedule-atomic")).deletedMatch, true);

    await database.prepare("INSERT INTO schedule_items (id,tournament_id,item_type,match_id) VALUES ('break-1','tournament-1','break',NULL)").run();
    const breakResult = await removeMatchAndScheduleItem(database, undefined, "break-1");
    assert.equal(breakResult.deletedMatch, false);
    assert.equal(Number((await database.prepare("SELECT COUNT(*) count FROM schedule_items WHERE id='break-1'").first()).count), 0);
  } finally {
    await vite.close();
    if (originalUrl === undefined) delete process.env.TURSO_DATABASE_URL;
    else process.env.TURSO_DATABASE_URL = originalUrl;
    if (originalToken === undefined) delete process.env.TURSO_AUTH_TOKEN;
    else process.env.TURSO_AUTH_TOKEN = originalToken;
    await rm(directory, { recursive: true, force: true });
  }
});
