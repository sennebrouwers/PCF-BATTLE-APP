import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../lib/email-delivery.ts", import.meta.url), "utf8");
const javascript = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { deliverEmail } = await import(
  "data:text/javascript;base64," + Buffer.from(javascript).toString("base64")
);

test("does not call Resend when required settings are missing", async () => {
  let calls = 0;
  const result = await deliverEmail({
    subject: "Registration received",
    html: "<p>Thanks</p>",
    fetcher: async () => {
      calls += 1;
      return Response.json({ id: "unexpected" });
    },
  });
  assert.deepEqual(result, { ok: false, reason: "missing_configuration" });
  assert.equal(calls, 0);
});

test("reports provider rejection without exposing provider message text", async () => {
  const result = await deliverEmail({
    apiKey: "test-key",
    from: "noreply@example.test",
    to: "team@example.test",
    subject: "Registration received",
    html: "<p>Thanks</p>",
    fetcher: async () => Response.json({
      name: "validation_error",
      message: "private provider response details",
    }, { status: 422 }),
  });
  assert.deepEqual(result, {
    ok: false,
    reason: "provider_rejected",
    status: 422,
    providerCode: "validation_error",
  });
  assert.equal(JSON.stringify(result).includes("private provider response details"), false);
});

test("sends the expected request and captures the provider message ID", async () => {
  let requestUrl = "";
  let requestOptions;
  const result = await deliverEmail({
    apiKey: "test-key",
    from: "noreply@example.test",
    to: "team@example.test",
    subject: "Registration received",
    html: "<p>Thanks</p>",
    fetcher: async (url, options) => {
      requestUrl = String(url);
      requestOptions = options;
      return Response.json({ id: "msg_123" });
    },
  });
  assert.equal(requestUrl, "https://api.resend.com/emails");
  assert.equal(requestOptions.method, "POST");
  assert.equal(new Headers(requestOptions.headers).get("Authorization"), "Bearer test-key");
  assert.deepEqual(result, { ok: true, providerMessageId: "msg_123" });
});

test("handles network failures without exposing exception text", async () => {
  const result = await deliverEmail({
    apiKey: "test-key",
    from: "noreply@example.test",
    to: "team@example.test",
    subject: "Registration received",
    html: "<p>Thanks</p>",
    fetcher: async () => {
      throw new TypeError("request contained private details");
    },
  });
  assert.deepEqual(result, { ok: false, reason: "network_error", errorName: "TypeError" });
});


test("adds the PCF BATTLE signature and PNG social icons to outgoing email", async () => {
  let sentHtml = "";
  const result = await deliverEmail({
    apiKey: "test-key",
    from: "noreply@example.test",
    to: "team@example.test",
    subject: "Registration received",
    html: "<html><body><p>Thanks</p></body></html>",
    fetcher: async (_url, options) => {
      sentHtml = JSON.parse(String(options.body)).html;
      return Response.json({ id: "msg_signature" });
    },
  });
  assert.equal(result.ok, true);
  assert.match(sentHtml, /Senne Brouwers &amp; Seppe Hemerijckx/);
  assert.match(sentHtml, /ORGANIZERS/);
  assert.match(sentHtml, /hello@pcfbattle\.be/);
  assert.match(sentHtml, /https:\/\/www\.pcfbattle\.be/);
  assert.match(sentHtml, /https:\/\/www\.facebook\.com\/pcfbattle/);
  assert.match(sentHtml, /https:\/\/www\.instagram\.com\/pcfbattle\//);
  assert.match(sentHtml, /<img src="https:\/\/www\.pcfbattle\.be\/email-signature-website\.png"/);
  assert.match(sentHtml, /<\/body><\/html>/);
});

test("adds PNG social icons without duplicating existing organizer signatures", async () => {
  let sentHtml = "";
  const result = await deliverEmail({
    apiKey: "test-key",
    from: "noreply@example.test",
    to: "team@example.test",
    subject: "Invitation",
    html: "<html><body><table><tr><td><p>Senne Brouwers &amp;<br>Seppe Hemerijckx</p><p>ORGANIZERS</p><p>POWERCHAIR FLOORBALL BATTLE</p><div><a href="mailto:hello@pcfbattle.be">hello@pcfbattle.be</a></div></td></tr></table></body></html>",
    fetcher: async (_url, options) => {
      sentHtml = JSON.parse(String(options.body)).html;
      return Response.json({ id: "msg_existing_signature" });
    },
  });
  assert.equal(result.ok, true);
  assert.equal((sentHtml.match(/Senne Brouwers/g) || []).length, 1);
  assert.equal((sentHtml.match(/title="PCF BATTLE on Instagram"/g) || []).length, 1);
  assert.match(sentHtml, /email-signature-instagram\.png/);
  assert.ok(sentHtml.indexOf("email-signature-instagram.png") < sentHtml.indexOf("</td>"));
});
