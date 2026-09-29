import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { webcrypto } from "node:crypto";
import { createServer } from "vite";

test("records invoice payments atomically and binds idempotency keys to invoice and amount", { timeout: 30_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "pcf-payment-test-"));
  const original = {
    TURSO_DATABASE_URL: process.env.TURSO_DATABASE_URL,
    TURSO_AUTH_TOKEN: process.env.TURSO_AUTH_TOKEN,
    SESSION_SECRET: process.env.SESSION_SECRET,
  };
  process.env.TURSO_DATABASE_URL = `file:${join(directory, "test.sqlite")}`;
  process.env.TURSO_AUTH_TOKEN = "local-test-token";
  process.env.SESSION_SECRET = "local-test-session-secret-with-at-least-32-bytes";
  globalThis.crypto ??= webcrypto;
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
    await db.prepare("INSERT INTO users (id,role,active,updated_at) VALUES (?,?,?,?)").bind("admin-test", "ADMIN", 1, "2026-09-29T00:00:00.000Z").run();

    const snapshot = JSON.stringify({ approved_snapshot: { pricing: { balance: 40 } } });
    await db.prepare("CREATE TABLE invoices (id text PRIMARY KEY,team_id text NOT NULL,invoice_number text NOT NULL UNIQUE,invoice_type text NOT NULL,participant_count integer NOT NULL,unit_price real NOT NULL,subtotal real NOT NULL,deposit_percentage real NOT NULL,total_amount real NOT NULL,issued_at text NOT NULL,due_at text,status text NOT NULL DEFAULT 'issued',snapshot text NOT NULL,created_at text NOT NULL,updated_at text NOT NULL)").run();
    await db.prepare("INSERT INTO invoices (id,team_id,invoice_number,invoice_type,participant_count,unit_price,subtotal,deposit_percentage,total_amount,issued_at,status,snapshot,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)").bind("invoice-test", "team-test", "PCFB-2026-0001", "DEPOSIT", 2, 50, 100, 30, 100, "2026-09-01T00:00:00.000Z", "issued", snapshot, "2026-09-01T00:00:00.000Z", "2026-09-01T00:00:00.000Z").run();
    await db.prepare("INSERT INTO invoices (id,team_id,invoice_number,invoice_type,participant_count,unit_price,subtotal,deposit_percentage,total_amount,issued_at,status,snapshot,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)").bind("invoice-other", "team-other", "PCFB-2026-0002", "BALANCE", 1, 200, 200, 30, 200, "2026-09-01T00:00:00.000Z", "issued", "{}", "2026-09-01T00:00:00.000Z", "2026-09-01T00:00:00.000Z").run();

    const payload = Buffer.from(JSON.stringify({
      id: "admin-test",
      role: "ADMIN",
      exp: Date.now() + 60 * 60 * 1000,
      sv: "2026-09-29T00:00:00.000Z",
    })).toString("base64").replace(/=/g, "");
    const key = await webcrypto.subtle.importKey("raw", Buffer.from(process.env.SESSION_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const signature = Buffer.from(await webcrypto.subtle.sign("HMAC", key, Buffer.from(payload))).toString("hex");
    const token = `${payload}.${signature}`;
    const request = (body) => new NextRequest("http://localhost/api/finance/record-payment", {
      method: "POST",
      headers: { origin: "http://localhost", cookie: `phb_token=${token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const call = async (body) => {
      const response = await POST(request(body), { params: Promise.resolve({ path: ["finance", "record-payment"] }) });
      return { status: response.status, body: await response.json() };
    };

    const first = { invoice_id: "invoice-test", amount: 50, idempotency_key: "payment-attempt-1" };
    assert.equal((await call(first)).status, 201);
    const duplicate = await call(first);
    assert.equal(duplicate.status, 200);
    assert.equal(duplicate.body.duplicate, true);

    assert.equal((await call({ ...first, amount: 60 })).status, 409, "an idempotency key cannot be reused with a different amount");
    assert.equal((await call({ ...first, invoice_id: "invoice-other" })).status, 409, "an idempotency key cannot be reused for another invoice");
    const overpayment = await call({ invoice_id: "invoice-test", amount: 60, idempotency_key: "payment-overpay" });
    assert.equal(overpayment.status, 422);
    assert.equal(overpayment.body.outstanding, 50);

    const finalPayment = await call({ invoice_id: "invoice-test", amount: 50, idempotency_key: "payment-attempt-2" });
    assert.equal(finalPayment.status, 201);
    assert.equal(finalPayment.body.outstanding, 0);
    const totals = await db.prepare("SELECT COUNT(*) count,COALESCE(SUM(amount),0) total FROM finance_payments WHERE invoice_id=?").bind("invoice-test").first();
    assert.equal(Number(totals.count), 2);
    assert.equal(Number(totals.total), 100);
    const invoice = await db.prepare("SELECT status FROM invoices WHERE id=?").bind("invoice-test").first();
    assert.equal(invoice.status, "paid");
    const balance = await db.prepare("SELECT total_amount FROM invoices WHERE team_id=? AND invoice_type='BALANCE'").bind("team-test").first();
    assert.equal(Number(balance.total_amount), 40);
    const audit = await db.prepare("SELECT action FROM audit_log WHERE type='invoice'").all();
    assert.equal(audit.results.length, 2, "only the two distinct successful payments should be audited");
  } finally {
    await vite.close();
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(directory, { recursive: true, force: true });
  }
});
