import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const api = await readFile(new URL("../app/api/[[...path]]/route.ts", import.meta.url), "utf8");
const page = await readFile(new URL("../app/[[...slug]]/page.tsx", import.meta.url), "utf8");
const portal = await readFile(new URL("../components/portal-app.tsx", import.meta.url), "utf8");
const publicHeader = await readFile(new URL("../components/public-header.tsx", import.meta.url), "utf8");
const scoreboard = await readFile(new URL("../components/scoreboard-display.tsx", import.meta.url), "utf8");
const securityRunbook = await readFile(new URL("../SECURITY.md", import.meta.url), "utf8");
const gdprMap = await readFile(new URL("../GDPR-DATA-MAP.md", import.meta.url), "utf8");
const tursoAdapter = await readFile(new URL("../lib/turso-db.ts", import.meta.url), "utf8");
const vercelConfig = JSON.parse(await readFile(new URL("../vercel.json", import.meta.url), "utf8"));

test("protects mutations and rate limits repeated logins", () => {
  assert.match(api, /acceptsMutation\(req\)/);
  assert.match(api, /Too many login attempts/);
  assert.match(api, /15 \* 60 \* 1000/);
  assert.match(api, /login_attempts/);
});

test("hardens request bodies and uploaded files", () => {
  assert.match(api, /MAX_JSON_BODY_BYTES = 2 \* 1024 \* 1024/);
  assert.match(api, /Request body is too large/);
  assert.match(api, /hasAllowedFileSignature/);
  assert.match(api, /MAX_UPLOAD_FILE_BYTES = 4 \* 1024 \* 1024/);
  assert.match(api, /File must be 4 MB or smaller/);
  assert.match(api, /Only valid images and PDF files are supported/);
});

test("protects private file downloads", () => {
  assert.match(api, /objectKey\.startsWith\(\`\$\{u\.id\}-\`\)/);
  assert.match(api, /object\.customMetadata\?\.owner && object\.customMetadata\.owner !== u\?\.id/);
  assert.match(api, /Invalid file reference/);
  assert.match(api, /Content-Security-Policy/);
  assert.match(api, /function isOwnedUploadReference/);
  assert.match(api, /Upload a new image before changing team media/);
});

test("keeps private API collections behind role checks", () => {
  assert.match(api, /if \(!u\) return out\(\{ error: "Unauthorized" \}, 401\);\s+if \(\["users", "payments", "invites", "preregistrations"\]\.includes\(table\) && !permit\(u, \["ADMIN"\]\)\)/);
  assert.match(api, /if \(table === "delegation_members"\) \{\s+if \(u\.role === "TEAM"\) return out\(await list\(table, "WHERE team_id=\?", \[u\.teamId\]\)\)/);
});

test("uses Nitro's generated Vercel output instead of a static-only folder", () => {
  assert.equal(vercelConfig.framework, null);
  assert.equal(vercelConfig.buildCommand, "npm run build:vercel");
  assert.equal(vercelConfig.outputDirectory, null);
});

test("documents the operational GDPR and security controls", () => {
  assert.match(securityRunbook, /SESSION_SECRET/);
  assert.match(securityRunbook, /Team/);
  assert.match(securityRunbook, /staging\s+rehearsal/);
  assert.match(gdprMap, /Team name/);
  assert.match(gdprMap, /retention/);
  assert.match(gdprMap, /data-subject request workflow/);
});

test("keeps role enforcement on the server", () => {
  assert.match(api, /permit\(u, \["ADMIN"\]\)/);
  assert.match(api, /permit\(u, \["ADMIN", "SCOREBOARD"\]\)/);
  assert.match(api, /u\.role === "TEAM"/);
  assert.match(api, /u\.role === "REFEREE"/);
  assert.match(api, /u\.teamId/);
  assert.match(api, /mayViewMatch/);
  assert.match(api, /Array\.isArray\(match\.referee_ids\) && match\.referee_ids\.includes\(u\.id\)/);
  assert.doesNotMatch(api, /WHERE referee_ids LIKE/);
});

test("minimizes audit details and preserves payment invariants", () => {
  assert.match(api, /function redactAuditDetails/);
  assert.match(api, /JSON\.stringify\(redactAuditDetails\(details\)\)/);
  assert.match(api, /existingPayment\.invoice_id !== invoiceId \|\| roundMoney\(Number\(existingPayment\.amount\)\) !== amount/);
  assert.match(api, /amount > outstandingBefore/);
  assert.match(api, /await log\(u, "RECORD_PAYMENT"/);
});

test("requires terms acceptance for public pre-registration", () => {
  assert.match(page, /name="terms_accepted" type="checkbox" required/);
  assert.match(page, /href="\/terms"/);
  assert.match(api, /body\.terms_accepted !== true/);
});

test("keeps registration identity and invite redemption atomic", () => {
  assert.match(api, /idx_preregistrations_tournament_email_normalized ON preregistrations\(tournament_id,lower\(email\)\)/);
  assert.match(api, /isRateLimited\("preregister", req, 10/);
  assert.match(api, /portal_invitation_claimed_at/);
  assert.match(api, /decision_email_claimed_at/);
  assert.match(api, /transaction\(async \(transaction\)/);
  assert.match(api, /recipient_email[^\n]+email/);
  assert.match(tursoAdapter, /client\.batch\(statements\.map\([\s\S]*"write"\)/);
});

test("does not leak credentials and enforces consent for public participant data", () => {
  assert.match(api, /login_password: undefined/);
  assert.match(api, /!\["password", "login_password", "code"\]\.includes\(field\)/);
  assert.match(api, /dm\.privacy_consent=1/);
  assert.match(api, /CASE WHEN photo_consent=1 THEN photo ELSE NULL END photo/);
  assert.match(api, /dm\.role='REFEREE' AND dm\.privacy_consent=1/);
  assert.match(api, /photo=\? AND privacy_consent=1 AND photo_consent=1/);
  assert.match(api, /photo_consent=1 THEN photo ELSE NULL END photo/);
  assert.match(api, /MAX_UPLOAD_BODY_BYTES/);
  assert.match(api, /Request body must be valid JSON/);
});

test("supports tournament and referee visibility controls", () => {
  assert.match(api, /show_tournament/);
  assert.match(api, /show_referees/);
  assert.match(page, /t\.show_referees !== 0/);
  assert.match(page, /t\.show_tournament !== 0/);
  assert.match(portal, /\["show_tournament", "Tournament page"\]/);
  assert.match(portal, /\["show_referees", "Tournament referees"\]/);
});

test("revokes sessions after account security state changes", () => {
  assert.match(api, /u\.sv === current\.updated_at/);
  assert.match(api, /sv: sessionVersion/);
  assert.match(api, /SELECT active,updated_at FROM users/);
});

test("does not create accounts with predictable fallback passwords", () => {
  assert.doesNotMatch(api, /body\.password \|\| "changeme"/);
  assert.doesNotMatch(api, /body\.login_password \|\| "team123"/);
  assert.doesNotMatch(api, /hashPassword\("(?:admin|team|ref)123"\)/);
  assert.doesNotMatch(portal, /defaultValue="team123"/);
  assert.match(portal, /minLength=\{8\}/);
});

test("keeps public tournament data internally consistent", () => {
  assert.match(page, /await api\("\/public-data"\)/);
  assert.doesNotMatch(page, /await Promise\.allSettled\(\[api\("\/standings"\), api\("\/scorers"\)\]\)/);
  assert.match(page, /aria-label=\{open \? "Close tournament assistant"/);
});

test("new matches use the active tournament instead of a fixed edition", () => {
  assert.match(api, /SELECT id FROM tournaments WHERE active=1 LIMIT 1/);
  assert.doesNotMatch(portal, /tournament_id: "tournament-1"/);
});

test("supports safe tournament edition activation and operations readiness", () => {
  assert.match(api, /tournaments\\\/\[\^\/\]\+\\\/activate/);
  assert.match(api, /Tournament edition not found/);
  assert.match(api, /UPDATE tournaments SET active=0/);
  assert.match(portal, /function OperationsHub/);
  assert.match(portal, /Team readiness/);
});

test("persists a public favourite team and reports offline data age", () => {
  assert.match(page, /pcf_favourite_team/);
  assert.match(page, /function ConnectionStatus/);
  assert.match(page, /updatedAt: new Date\(\)\.toISOString\(\)/);
});

test("provides an accessible mobile public navigation", () => {
  assert.match(publicHeader, /aria-controls="public-mobile-navigation"/);
  assert.match(publicHeader, /aria-expanded=\{menuOpen\}/);
  assert.match(publicHeader, /menuOpen \? <X \/> : <Menu \/>/);
  assert.match(publicHeader, /event\.key === "Escape"/);
});

test("supports tournament-day reports, checks, privacy and recovery", () => {
  assert.match(api, /path === "admin\/backup"/);
  assert.match(api, /path === "tournament-checks"/);
  assert.match(api, /path === "match-events"/);
  assert.match(api, /privacy_consent/);
  assert.match(portal, /Tournament-day mode/);
  assert.match(portal, /downloadReport/);
  assert.match(portal, /Finish match/);
  assert.match(api, /missing from the schedule/);
  assert.match(api, /Knockout matches exist without an active bracket/);
  assert.match(api, /validateScheduleItems\(tournament.id, scheduleItems\)/);
  assert.match(api, /admin\/backup\/validate/);
  assert.match(api, /PCF_BATTLE_BACKUP_V1/);
  assert.match(api, /checksum: await sha/);
});

test("protects bracket and schedule data invariants", () => {
  assert.match(api, /A team cannot play against itself/);
  assert.match(api, /resolveBracketProgression/);
  assert.match(api, /UPDATE schedule_items SET/);
  assert.match(api, /valid: true, team_id: invite\.team_id/);
  assert.doesNotMatch(api, /return invite\s*\? out\(invite\)/);
});

test("provides a protected synchronized scoreboard control and TV display", () => {
  assert.match(api, /path === "scoreboard-state"/);
  assert.match(api, /path === "scoreboard-mode"/);
  assert.match(api, /\["ADMIN", "SCOREBOARD"\]/);
  assert.match(api, /clock_started_at/);
  assert.match(portal, /Scoreboard control/);
  assert.match(portal, /Open TV view/);
  assert.match(page, /p === "\/scoreboard\/display"/);
  assert.match(scoreboard, /setInterval\(load, 2000\)/);
  assert.match(scoreboard, /visibilitychange/);
  assert.match(scoreboard, /scoreboard-main/);
  assert.match(scoreboard, /Start scoreboard/);
  assert.match(scoreboard, /requestFullscreen/);
  assert.match(scoreboard, /createOscillator/);
  assert.match(scoreboard, /scoreboard-goal-flash/);
  assert.match(scoreboard, /scoreboard-sponsor-screen/);
  assert.doesNotMatch(scoreboard, /Latest goal/);
  assert.doesNotMatch(scoreboard, />HOME</);
  assert.doesNotMatch(scoreboard, />AWAY</);
});
