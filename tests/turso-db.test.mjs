import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createServer } from "vite";

test("Turso batches and explicit transactions are atomic", { timeout: 30_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "pcf-turso-test-"));
  const originalUrl = process.env.TURSO_DATABASE_URL;
  const originalToken = process.env.TURSO_AUTH_TOKEN;
  process.env.TURSO_DATABASE_URL = `file:${join(directory, "test.sqlite")}`;
  process.env.TURSO_AUTH_TOKEN = "local-test-token";
  const vite = await createServer({
    configFile: false,
    root: process.cwd(),
    logLevel: "error",
    server: { middlewareMode: true },
    appType: "custom",
  });

  try {
    const { getDatabase } = await vite.ssrLoadModule("/lib/turso-db.ts");
    const db = getDatabase();
    await db.prepare("CREATE TABLE atomic_probe (id INTEGER PRIMARY KEY, value TEXT UNIQUE)").run();

    await assert.rejects(db.batch([
      db.prepare("INSERT INTO atomic_probe(value) VALUES (?)").bind("duplicate"),
      db.prepare("INSERT INTO atomic_probe(value) VALUES (?)").bind("duplicate"),
    ]));
    let count = await db.prepare("SELECT COUNT(*) AS count FROM atomic_probe").first();
    assert.equal(Number(count.count), 0, "a failed batch must roll back every statement");

    await assert.rejects(db.transaction(async (transaction) => {
      await transaction.prepare("INSERT INTO atomic_probe(value) VALUES (?)").bind("rolled-back").run();
      throw new Error("force transaction rollback");
    }), /force transaction rollback/);
    count = await db.prepare("SELECT COUNT(*) AS count FROM atomic_probe").first();
    assert.equal(Number(count.count), 0, "a failed transaction callback must roll back its writes");

    await db.transaction(async (transaction) => {
      await transaction.prepare("INSERT INTO atomic_probe(value) VALUES (?)").bind("committed").run();
    });
    count = await db.prepare("SELECT COUNT(*) AS count FROM atomic_probe").first();
    assert.equal(Number(count.count), 1, "a completed transaction must commit its writes");
  } finally {
    await vite.close();
    if (originalUrl === undefined) delete process.env.TURSO_DATABASE_URL;
    else process.env.TURSO_DATABASE_URL = originalUrl;
    if (originalToken === undefined) delete process.env.TURSO_AUTH_TOKEN;
    else process.env.TURSO_AUTH_TOKEN = originalToken;
    await rm(directory, { recursive: true, force: true });
  }
});
