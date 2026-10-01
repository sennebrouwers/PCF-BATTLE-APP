import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { webcrypto } from "node:crypto";
import { createServer } from "vite";

test("confirmation sends, explicit resend, and failed attempts are recoverable", { timeout: 30_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "pcf-registration-email-test-"));
  const envNames = ["TURSO_DATABASE_URL", "TURSO_AUTH_TOKEN", "SESSION_SECRET", "RESEND_API_KEY", "RESEND_FROM", "SITE_ORIGIN"];
  const originalEnv = Object.fromEntries(envNames.map((name) => [name, process.env[name]]));
  const originalFetch = globalThis.fetch;
  const sessionSecret = "local-test-session-secret-with-at-least-32-bytes";
  process.env.TURSO_DATABASE_URL = "file:" + join(directory, "test.sqlite");
  process.env.TURSO_AUTH_TOKEN = "local-test-token";
  process.env.SESSION_SECRET = sessionSecret;
  process.env.RESEND_API_KEY = "test-resend-key";
  process.env.RESEND_FROM = "noreply@example.test";
  process.env.SITE_ORIGIN = "https://www.pcfbattle.be";
  globalThis.crypto ??= webcrypto;
  let emailMode = "accept";
  let emailCalls = 0;
  globalThis.fetch = async (input, init) => {
    if (String(input) !== "https://api.resend.com/emails") return originalFetch(input, init);
    emailCalls += 1;
    if (emailMode === "reject") return Response.json({ name: "invalid_api_key" }, { status: 401 });
    return Response.json({ id: "email_" + emailCalls });
  };

  const vite = await createServer({
    configFile: false,
    root: process.cwd(),
    logLevel: "error",
    resolve: { alias: { "@": process.cwd() } },
    server: { middlewareMode: true },
    appType: "custom",
  });

  try {
    const [{ getDatabase }, { POST }, { NextRequest }] = await Promise.all([
      vite.ssrLoadModule("/lib/turso-db.ts"),
      vite.ssrLoadModule("/app/api/[[...path]]/route.ts"),
      import("../node_modules/next/server.js"),
    ]);
    const db = getDatabase();
    await db.prepare("CREATE TABLE users (id text PRIMARY KEY, role text, active integer, updated_at text)").run();
    await db.prepare("CREATE TABLE audit_log (id text PRIMARY KEY, user_id text, user_name text, action text, type text, entity text, details text, created_at text)").run();
    await db.prepare("INSERT INTO users (id,role,active,updated_at) VALUES (?,?,?,?)").bind("admin-test", "ADMIN", 1, "2026-10-01T00:00:00.000Z").run();
    await db.prepare("CREATE TABLE preregistrations (id text PRIMARY KEY,tournament_id text NOT NULL,club_name text NOT NULL,email text NOT NULL,created_at text NOT NULL)").run();
    await db.prepare("INSERT INTO preregistrations (id,tournament_id,club_name,email,created_at) VALUES (?,?,?,?,?)").bind("registration-test", "tournament-test", "Test Club", "team@example.test", "2026-10-01T00:00:00.000Z").run();

    const payload = Buffer.from(JSON.stringify({
      id: "admin-test",
      role: "ADMIN",
      exp: Date.now() + 60 * 60 * 1000,
      sv: "2026-10-01T00:00:00.000Z",
    })).toString("base64").replace(/=/g, "");
    const key = await webcrypto.subtle.importKey("raw", Buffer.from(sessionSecret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const signature = Buffer.from(await webcrypto.subtle.sign("HMAC", key, Buffer.from(payload))).toString("hex");
    const token = payload + "." + signature;
    const request = (body) => new NextRequest("http://localhost/api/preregistrations/registration-test/confirmation", {
      method: "POST",
      headers: { origin: "http://localhost", cookie: "phb_token=" + token, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const call = async (body = {}) => {
      const response = await POST(request(body), { params: Promise.resolve({ path: ["preregistrations", "registration-test", "confirmation"] }) });
      return { status: response.status, body: await response.json() };
    };

    assert.equal((await call()).status, 200);
    assert.equal(emailCalls, 1);
    const firstSentAt = (await db.prepare("SELECT registration_confirmation_sent_at FROM preregistrations WHERE id=?").bind("registration-test").first()).registration_confirmation_sent_at;
    assert.ok(firstSentAt);
    assert.equal((await call()).status, 409, "a duplicate send requires explicit resend");
    assert.equal(emailCalls, 1);

    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal((await call({ force: true })).status, 200);
    assert.equal(emailCalls, 2);
    const resentAt = (await db.prepare("SELECT registration_confirmation_sent_at FROM preregistrations WHERE id=?").bind("registration-test").first()).registration_confirmation_sent_at;
    assert.ok(resentAt);
    assert.notEqual(resentAt, firstSentAt);

    await db.prepare("UPDATE preregistrations SET registration_confirmation_sent_at=NULL WHERE id=?").bind("registration-test").run();
    emailMode = "reject";
    const rejected = await call();
    assert.equal(rejected.status, 502);
    assert.equal((await db.prepare("SELECT registration_confirmation_claimed_at FROM preregistrations WHERE id=?").bind("registration-test").first()).registration_confirmation_claimed_at, null);

    emailMode = "accept";
    assert.equal((await call()).status, 200, "a rejected send releases the claim for a later retry");
    assert.equal(emailCalls, 4);
  } finally {
    await vite.close();
    globalThis.fetch = originalFetch;
    for (const [name, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    await rm(directory, { recursive: true, force: true });
  }
});
