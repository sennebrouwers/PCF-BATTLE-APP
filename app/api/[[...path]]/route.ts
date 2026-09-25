import { NextRequest, NextResponse } from "next/server";
import { getDatabase } from "@/lib/turso-db";
import { readBlob, writeBlob } from "@/lib/blob-storage";

const db = getDatabase;
const now = () => new Date().toISOString();
const uuid = () => crypto.randomUUID();
const roundMoney = (value: number) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;
const secureToken = (bytes = 24) => {
  const values = crypto.getRandomValues(new Uint8Array(bytes));
  return [...values].map((value) => value.toString(16).padStart(2, "0")).join("").toUpperCase();
};
let publicDataCache: { expiresAt: number; payload: unknown } | null = null;
const securityHeaders = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
};
const MAX_JSON_BODY_BYTES = 2 * 1024 * 1024;
type ScheduleRecord = {
  id: string;
  label?: string;
  match_id?: string;
  item_type?: string;
  match_date?: string;
  start_time?: string;
  duration_minutes?: number | string;
  court?: string;
  home_team_id?: string;
  away_team_id?: string;
  referee_ids?: string[] | string;
  [key: string]: unknown;
};
type ScheduleProposal = Partial<ScheduleRecord> & { id?: string };
type ScheduledEntry = { item: ScheduleRecord; start: number; end: number };
type RuntimeEnv = {
  SESSION_SECRET?: string;
  RESEND_API_KEY?: string;
  RESEND_FROM?: string;
  SITE_ORIGIN?: string;
  BUCKET: {
    get: (key: string) => Promise<{ body?: ReadableStream; httpMetadata?: Record<string, string>; customMetadata?: Record<string, string> } | null>;
    put: (key: string, value: ReadableStream, options?: Record<string, unknown>) => Promise<unknown>;
  };
};
const runtimeEnv = process.env as unknown as RuntimeEnv;
type SessionUser = { id: string; role: string; name?: string; exp: number; sv: string; [key: string]: unknown };
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function parseSessionUser(value: unknown): SessionUser | null {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.role !== "string" || typeof value.exp !== "number" || typeof value.sv !== "string") return null;
  return value as SessionUser;
}
const out = (data: unknown, status = 200) =>
  NextResponse.json(data, { status, headers: securityHeaders });
function logServerError(request: NextRequest, error: unknown) {
  console.error(JSON.stringify({
    event: "api_error",
    requestId: request.headers.get("cf-ray") || crypto.randomUUID(),
    path: new URL(request.url).pathname,
    error: error instanceof Error ? error.name : "UnknownError",
  }));
}

async function hasAllowedFileSignature(file: File) {
  if (file.type === "image/svg+xml") {
    const text = await file.slice(0, 4096).text();
    return /^\s*(?:<\?xml[^>]*>\s*)?(?:<!--[^>]*-->\s*)?<svg(?:\s|>)/i.test(text) && !/<script\b/i.test(text);
  }
  const bytes = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const startsWith = (signature: number[]) => signature.every((value, index) => bytes[index] === value);
  if (file.type === "application/pdf") return startsWith([0x25, 0x50, 0x44, 0x46]);
  if (file.type === "image/png") return startsWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (file.type === "image/jpeg") return startsWith([0xff, 0xd8, 0xff]);
  if (file.type === "image/gif") return startsWith([0x47, 0x49, 0x46, 0x38]);
  if (file.type === "image/webp") return startsWith([0x52, 0x49, 0x46, 0x46]) && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
  return false;
}
let scheduleSchemaReady: Promise<void> | null = null;
let mvpSchemaReady: Promise<void> | null = null;
let financeSchemaReady: Promise<void> | null = null;
async function ensureFinanceSchema() {
  if (financeSchemaReady) return financeSchemaReady;
  financeSchemaReady = (async () => {
    await db().prepare("CREATE TABLE IF NOT EXISTS finance_settings (id text PRIMARY KEY NOT NULL,price_per_person real DEFAULT 325,deposit_percentage real DEFAULT 30,deposit_due_days integer DEFAULT 30,final_due_days integer DEFAULT 30,legal_name text,address text,vat_number text,email text,iban text,bic text,bank_name text,updated_at text NOT NULL)").run();
    await db().prepare("CREATE TABLE IF NOT EXISTS invoices (id text PRIMARY KEY NOT NULL,team_id text NOT NULL,invoice_number text NOT NULL UNIQUE,invoice_type text NOT NULL,participant_count integer NOT NULL,unit_price real NOT NULL,subtotal real NOT NULL,deposit_percentage real NOT NULL,total_amount real NOT NULL,issued_at text NOT NULL,due_at text,status text NOT NULL DEFAULT 'issued',snapshot text NOT NULL,created_at text NOT NULL,updated_at text NOT NULL)").run();
    await db().prepare("CREATE TABLE IF NOT EXISTS finance_payments (id text PRIMARY KEY NOT NULL,invoice_id text NOT NULL,team_id text NOT NULL,amount real NOT NULL,method text NOT NULL,reference text,received_at text NOT NULL,note text,provider_payment_id text UNIQUE,idempotency_key text,created_at text NOT NULL,updated_at text NOT NULL)").run();
    try { await db().prepare("ALTER TABLE finance_payments ADD COLUMN idempotency_key text").run(); } catch { /* already migrated */ }
    try { await db().prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_finance_payments_idempotency ON finance_payments(idempotency_key) WHERE idempotency_key IS NOT NULL").run(); } catch { /* older SQLite compatibility */ }
    await db().batch([
      db().prepare("CREATE INDEX IF NOT EXISTS idx_invoices_team_type_status ON invoices(team_id,invoice_type,status)"),
      db().prepare("CREATE INDEX IF NOT EXISTS idx_finance_payments_invoice ON finance_payments(invoice_id)"),
      db().prepare("CREATE INDEX IF NOT EXISTS idx_finance_payments_team ON finance_payments(team_id)"),
    ]);
    await db().prepare("INSERT OR IGNORE INTO finance_settings (id,updated_at) VALUES ('default',?)").bind(now()).run();
    await db().prepare("UPDATE finance_settings SET final_due_days=30 WHERE id='default' AND (final_due_days IS NULL OR final_due_days=90)").run();
  })();
  try { await financeSchemaReady; } catch (error) { financeSchemaReady = null; throw error; }
}
async function ensureMvpSchema() {
  if (mvpSchemaReady) return mvpSchemaReady;
  mvpSchemaReady = (async () => {
    await db().prepare("CREATE TABLE IF NOT EXISTS mvp_votes (id text PRIMARY KEY NOT NULL,tournament_id text NOT NULL,referee_id text NOT NULL,category text NOT NULL,candidate_id text NOT NULL,created_at text NOT NULL,UNIQUE(tournament_id,referee_id,category))").run();
    await db().prepare("CREATE TABLE IF NOT EXISTS mvp_settings (tournament_id text PRIMARY KEY NOT NULL,enabled integer DEFAULT 0 NOT NULL,assistant_coach_eligible integer DEFAULT 1 NOT NULL)").run();
  })();
  try { await mvpSchemaReady; } catch (error) { mvpSchemaReady = null; throw error; }
}
async function ensureScheduleSchema() {
  if (scheduleSchemaReady) return scheduleSchemaReady;
  scheduleSchemaReady = (async () => {
  // Schedule was introduced after the first production schema. Keep the
  // endpoint self-healing for databases that missed a later migration instead
  // of allowing a missing table/column to surface as an opaque 500.
  await db().prepare("CREATE TABLE IF NOT EXISTS schedule_items (id text PRIMARY KEY NOT NULL,tournament_id text NOT NULL,item_type text NOT NULL,match_id text,label text,match_date text,start_time text,duration_minutes integer,court text,sort_order integer DEFAULT 0 NOT NULL,active integer DEFAULT 1 NOT NULL,created_at text NOT NULL,updated_at text NOT NULL)").run();
  await db().batch([
    db().prepare("CREATE INDEX IF NOT EXISTS idx_schedule_tournament_order ON schedule_items(tournament_id,active,sort_order,id)"),
    db().prepare("CREATE INDEX IF NOT EXISTS idx_schedule_match ON schedule_items(match_id)"),
    db().prepare("CREATE INDEX IF NOT EXISTS idx_room_assignments_room_member ON room_assignments(room_id,member_id)"),
  ]);
  // Room numbers are assigned later by the hotel. Multiple newly-created
  // rooms therefore need to be allowed to remain blank for now.
  await db().prepare("DROP INDEX IF EXISTS rooms_number_unique").run();
  await db().prepare("CREATE TABLE IF NOT EXISTS mvp_votes (id text PRIMARY KEY NOT NULL,tournament_id text NOT NULL,referee_id text NOT NULL,category text NOT NULL,candidate_id text NOT NULL,created_at text NOT NULL,UNIQUE(tournament_id,referee_id,category))").run();
  await db().prepare("CREATE TABLE IF NOT EXISTS mvp_settings (tournament_id text PRIMARY KEY NOT NULL,enabled integer DEFAULT 0 NOT NULL,assistant_coach_eligible integer DEFAULT 1 NOT NULL)").run();
  for (const statement of [
    "ALTER TABLE schedule_items ADD COLUMN court text",
    "ALTER TABLE tournaments ADD COLUMN schedule_start_time text DEFAULT '09:00'",
    "ALTER TABLE tournaments ADD COLUMN schedule_half_duration_minutes integer DEFAULT 15",
    "ALTER TABLE tournaments ADD COLUMN schedule_changeover_minutes integer DEFAULT 5",
    "ALTER TABLE tournaments ADD COLUMN schedule_min_rest_minutes integer DEFAULT 10",
    "ALTER TABLE tournaments ADD COLUMN instagram_url text",
    "ALTER TABLE tournaments ADD COLUMN format_rules text",
    "ALTER TABLE tournaments ADD COLUMN pcf_battle_info text",
    "ALTER TABLE tournaments ADD COLUMN show_tournament integer DEFAULT 1",
    "ALTER TABLE tournaments ADD COLUMN show_referees integer DEFAULT 1",
    "ALTER TABLE tournaments ADD COLUMN show_gallery integer DEFAULT 0",
    "ALTER TABLE tournaments ADD COLUMN gallery_url text",
    "ALTER TABLE tournaments ADD COLUMN public_message text",
    "ALTER TABLE tournaments ADD COLUMN opening_hours text",
    "ALTER TABLE tournaments ADD COLUMN hotel_name text",
    "ALTER TABLE tournaments ADD COLUMN hotel_address text",
    "ALTER TABLE tournaments ADD COLUMN venue_name text",
    "ALTER TABLE tournaments ADD COLUMN venue_address text",
    "ALTER TABLE tournaments ADD COLUMN parking_info text",
    "ALTER TABLE tournaments ADD COLUMN accessibility_info text",
    "ALTER TABLE tournaments ADD COLUMN catering_info text",
    "ALTER TABLE tournaments ADD COLUMN award_info text",
    "ALTER TABLE tournaments ADD COLUMN visitor_info text",
    "ALTER TABLE tournaments ADD COLUMN emergency_enabled integer DEFAULT 0",
    "ALTER TABLE tournaments ADD COLUMN single_room_price real DEFAULT 0",
    "ALTER TABLE tournaments ADD COLUMN double_room_price real DEFAULT 0",
    "ALTER TABLE tournaments ADD COLUMN fixed_tournament_costs real DEFAULT 0",
    "ALTER TABLE rooms ADD COLUMN room_type text DEFAULT 'DOUBLE'",
    "ALTER TABLE tournaments ADD COLUMN single_room_supplement real DEFAULT 0",
    "ALTER TABLE tournaments ADD COLUMN emergency_message text",
    "ALTER TABLE teams ADD COLUMN delegation_confirmed integer DEFAULT 0",
    "ALTER TABLE teams ADD COLUMN delegation_confirmed_at text",
    "ALTER TABLE teams ADD COLUMN delegation_confirmed_by text",
    "ALTER TABLE teams ADD COLUMN rooms_confirmed integer DEFAULT 0",
    "ALTER TABLE teams ADD COLUMN rooms_confirmed_at text",
    "ALTER TABLE teams ADD COLUMN rooms_confirmed_by text",
    "ALTER TABLE teams ADD COLUMN review_status text DEFAULT 'information_incomplete'",
    "ALTER TABLE teams ADD COLUMN review_snapshot text",
    "ALTER TABLE teams ADD COLUMN team_reviewed_at text",
    "ALTER TABLE teams ADD COLUMN team_reviewed_by text",
    "ALTER TABLE teams ADD COLUMN admin_reviewed_at text",
    "ALTER TABLE teams ADD COLUMN admin_reviewed_by text",
    "ALTER TABLE teams ADD COLUMN review_message text",
    "ALTER TABLE teams ADD COLUMN approved_snapshot text",
    "ALTER TABLE teams ADD COLUMN phone_country_code text DEFAULT '+32'",
    "ALTER TABLE teams ADD COLUMN address_street text",
    "ALTER TABLE teams ADD COLUMN address_number text",
    "ALTER TABLE teams ADD COLUMN address_postal_code text",
    "ALTER TABLE teams ADD COLUMN address_city text",
    "ALTER TABLE teams ADD COLUMN address_country text",
    "ALTER TABLE teams ADD COLUMN expected_delegation_size integer",
    "ALTER TABLE teams ADD COLUMN invoice_requested integer DEFAULT 0",
    "ALTER TABLE teams ADD COLUMN billing_address text",
    "ALTER TABLE teams ADD COLUMN billing_name text",
    "ALTER TABLE teams ADD COLUMN vat_number text",
    "ALTER TABLE teams ADD COLUMN billing_postal_code text",
    "ALTER TABLE teams ADD COLUMN billing_city text",
    "ALTER TABLE teams ADD COLUMN billing_country text",
    "ALTER TABLE teams ADD COLUMN contact_email text",
    "ALTER TABLE teams ADD COLUMN whatsapp text",
    "ALTER TABLE teams ADD COLUMN withdrawal_reason text",
    "ALTER TABLE delegation_members ADD COLUMN member_type text DEFAULT 'STAFF'",
    "ALTER TABLE delegation_members ADD COLUMN player_role text",
    "ALTER TABLE delegation_members ADD COLUMN classification_points real",
    "ALTER TABLE delegation_members ADD COLUMN staff_role text",
    "ALTER TABLE delegation_members ADD COLUMN custom_staff_role text",
    "ALTER TABLE delegation_members ADD COLUMN assistant_player_id text",
    "ALTER TABLE delegation_members ADD COLUMN wheelchair_user integer DEFAULT 0",
    "ALTER TABLE organization_contacts ADD COLUMN whatsapp text",
  ]) {
    try { await db().prepare(statement).run(); } catch (error: unknown) {
      if (!/duplicate column|already exists/i.test(String(error instanceof Error ? error.message : error))) throw error;
    }
  }
  })();
  try { await scheduleSchemaReady; } catch (error) { scheduleSchemaReady = null; throw error; }
}
function groupTeamRooms(rows: any[]) {
  const rooms = new Map<string, { id: string; number: string; capacity: number; room_type: string; members: { id: string; name: string }[] }>();
  for (const row of rows) {
    const room = rooms.get(row.room_id) || {
      id: row.room_id,
      number: row.number,
      capacity: row.capacity,
      room_type: row.room_type,
      members: [] as { id: string; name: string }[],
    };
    if (row.member_id) room.members.push({ id: row.member_id, name: row.member_name });
    rooms.set(row.room_id, room);
  }
  return [...rooms.values()];
}
async function buildTeamReview(teamId: string, prepareSchema = true) {
  if (prepareSchema) {
    await ensureScheduleSchema();
    await ensureFinanceSchema();
  }
  const teamPromise = db().prepare("SELECT * FROM teams WHERE id=?").bind(teamId).first();
  const [team, memberResult, roomResult, tournament, settings] = await Promise.all([
    teamPromise,
    db().prepare("SELECT * FROM delegation_members WHERE team_id=? ORDER BY member_type,name").bind(teamId).all(),
    db().prepare("SELECT r.id room_id,r.number,r.capacity,r.room_type,dm.id member_id,dm.name member_name FROM rooms r LEFT JOIN room_assignments ra ON ra.room_id=r.id LEFT JOIN delegation_members dm ON dm.id=ra.member_id AND dm.team_id=? WHERE r.team_id IS NULL OR r.team_id=? ORDER BY r.number,dm.name").bind(teamId, teamId).all(),
    db().prepare("SELECT single_room_supplement,fixed_tournament_costs FROM tournaments WHERE active=1 LIMIT 1").first(),
    db().prepare("SELECT * FROM finance_settings WHERE id='default'").first(),
  ]);
  if (!team) return null;
  const members = memberResult.results as any[];
  const roomRows = roomResult.results as any[];
  const rooms = groupTeamRooms(roomRows);
  const assigned = new Set(rooms.flatMap((room: any) => room.members.map((member: any) => member.id)));
  const unassigned = members.filter((member) => !assigned.has(member.id));
  const unitPrice = Number(tournament?.fixed_tournament_costs || settings?.price_per_person || 325), singleSupplement = Number(tournament?.single_room_supplement || 0);
  const singleRooms = rooms.filter((room: any) => room.members.length === 1);
  const issues: string[] = [];
  for (const member of members) {
    if (member.member_type === "PLAYER" && !member.player_role) issues.push(`${member.name} is missing a playing role`);
  }
  if (!members.length) issues.push("Add at least one delegation member");
  if (unassigned.length) issues.push(`${unassigned.length} delegation member(s) have no room assignment`);
  const hasValue = (value: unknown) => String(value || "").trim().length > 0;
  const hasAddress = hasValue(team.address) || [team.address_street, team.address_number, team.address_postal_code, team.address_city, team.address_country].some(hasValue);
  if (!hasValue(team.contact_person) || !hasValue(team.phone) || !hasAddress) issues.push("Complete team contact and billing address information");
  const participantSubtotal = members.length * unitPrice, accommodationSupplement = singleRooms.length * singleSupplement, total = participantSubtotal + accommodationSupplement, depositPercentage = Number(settings?.deposit_percentage || 30);
  const deposit = roundMoney(total * depositPercentage / 100), balance = roundMoney(total - deposit);
  return { team, members, rooms, unassigned, issues, settings, pricing: { unitPrice, singleSupplement, singleRoomCount: singleRooms.length, participantSubtotal, accommodationSupplement, total: roundMoney(total), depositPercentage, deposit, balance } };
}
async function buildOnboardingStatus(teamId: string) {
  const review = await buildTeamReview(teamId, false);
  if (!review) return null;
  const team: any = review.team;
  const invoices: any[] = (await db().prepare("SELECT * FROM invoices WHERE team_id=? AND status!='cancelled' ORDER BY issued_at").bind(teamId).all()).results as any[];
  const payments: any[] = (await db().prepare("SELECT * FROM finance_payments WHERE team_id=?").bind(teamId).all()).results as any[];
  const deposit = invoices.find((item) => item.invoice_type === "DEPOSIT");
  const balance = invoices.find((item) => item.invoice_type === "BALANCE");
  const depositPaid = payments.filter((item) => item.invoice_id === deposit?.id).reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const balancePaid = payments.filter((item) => item.invoice_id === balance?.id).reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const depositOpen = team.review_status === "approved_payment_open" && Boolean(deposit);
  const depositDone = depositOpen && depositPaid >= Number(deposit?.total_amount || review.pricing.deposit || 0) && Number(deposit?.total_amount || review.pricing.deposit || 0) > 0;
  const balanceOpen = depositDone && Boolean(balance);
  const balanceDone = balanceOpen && balancePaid >= Number(balance?.total_amount || review.pricing.balance || 0) && Number(balance?.total_amount || review.pricing.balance || 0) > 0;
  const complete = review.issues.length === 0;
  // A team that can access this portal has already passed the internal
  // registration, selection and invitation stages. Those stages are not part
  // of the team-facing onboarding journey.
  const selected = true;
  const portal = true;
  const hasValue = (value: unknown) => String(value || "").trim().length > 0;
  const hasAddress = hasValue(team.address) || [team.address_street, team.address_number, team.address_postal_code, team.address_city, team.address_country].some(hasValue);
  const setupDone = hasValue(team.contact_person) && hasValue(team.phone) && hasAddress;
  const delegationDone = Boolean(review.members.length && !review.members.some((member: any) => !member.name || (member.member_type === "PLAYER" && !member.player_role)));
  const roomsDone = review.unassigned.length === 0 && review.members.length > 0;
  const stages = [
    { key: "registration", label: "Registration", done: true, state: "completed" },
    { key: "selection", label: "Selection", done: selected, state: selected ? "completed" : "current" },
    { key: "portal", label: "Portal activated", done: portal, state: portal ? "completed" : "current" },
    { key: "setup", label: "Team setup", done: setupDone, state: setupDone ? "completed" : "current" },
    { key: "delegation", label: "Delegation", done: delegationDone, state: delegationDone ? "completed" : setupDone ? "current" : "upcoming" },
    { key: "rooms", label: "Rooms", done: roomsDone, state: roomsDone ? "completed" : delegationDone ? "current" : "upcoming" },
    { key: "review", label: "Review", done: complete, state: complete ? "completed" : roomsDone ? "current" : "upcoming" },
    { key: "confirmation", label: "Team Confirmation", done: ["awaiting_admin", "approved_payment_open"].includes(team.review_status), state: ["awaiting_admin", "approved_payment_open"].includes(team.review_status) ? "completed" : "upcoming" },
    { key: "registration_review", label: "Registration Review", done: team.review_status === "approved_payment_open", state: team.review_status === "awaiting_admin" ? "current" : team.review_status === "approved_payment_open" ? "completed" : "upcoming" },
    { key: "deposit", label: "Deposit", done: depositDone, state: depositDone ? "completed" : depositOpen ? "current" : "upcoming" },
    { key: "balance", label: "Remaining balance", done: balanceDone, state: balanceDone ? "completed" : balanceOpen ? "current" : "upcoming" },
  ];
  const current = stages.find((stage) => stage.state === "current") || stages.find((stage) => !stage.done) || stages[stages.length - 1];
  const action = !selected ? "Awaiting selection by PCF BATTLE" : !portal ? "Wait for your Team Portal invitation" : !complete ? (review.issues[0] || "Complete the missing team information") : team.review_status === "information_incomplete" || team.review_status === "changes_requested" ? "Review your information and submit Team Confirmation" : team.review_status === "awaiting_admin" ? "No action required — Registration Review is pending" : !depositOpen ? "Payment is being prepared" : !depositDone ? `Pay the deposit of ${fmtMoneyServer(Number(deposit?.total_amount || review.pricing.deposit))}` : !balanceOpen ? "Remaining balance payment is being prepared" : !balanceDone ? `Pay the remaining balance of ${fmtMoneyServer(Number(balance?.total_amount || review.pricing.balance))}` : "Tournament onboarding is complete";
  const ready = balanceDone && team.review_status === "approved_payment_open";
  return { team: { id: team.id, name: team.name }, status: team.review_status, stages: [...stages, { key: "ready", label: "Tournament Ready", done: ready, state: ready ? "completed" : "upcoming" }], current: current.label, action, review: { issues: review.issues.length, members: review.members.length, unassigned: review.unassigned.length }, payment: { deposit: Number(deposit?.total_amount || review.pricing.deposit || 0), paid: depositPaid, due: deposit?.due_at || null, balance: Number(balance?.total_amount || review.pricing.balance || 0), balancePaid } };
}
async function buildOnboardingStatuses(teamIds: string[]) {
  if (!teamIds.length) return [];
  await ensureFinanceSchema();
  const placeholders = teamIds.map(() => "?").join(",");
  const [teamRows, memberRows, assignmentRows, invoiceRows, paymentRows, settings, tournament] = await Promise.all([
    db().prepare(`SELECT * FROM teams WHERE id IN (${placeholders}) ORDER BY name`).bind(...teamIds).all(),
    db().prepare(`SELECT id,team_id,name,member_type,player_role,classification_points FROM delegation_members WHERE team_id IN (${placeholders}) ORDER BY team_id,member_type,name`).bind(...teamIds).all(),
    db().prepare(`SELECT ra.member_id,dm.team_id FROM room_assignments ra JOIN delegation_members dm ON dm.id=ra.member_id WHERE dm.team_id IN (${placeholders})`).bind(...teamIds).all(),
    db().prepare(`SELECT id,team_id,invoice_type,total_amount,due_at,status FROM invoices WHERE team_id IN (${placeholders}) AND status!='cancelled' ORDER BY issued_at`).bind(...teamIds).all(),
    db().prepare(`SELECT invoice_id,team_id,amount FROM finance_payments WHERE team_id IN (${placeholders})`).bind(...teamIds).all(),
    db().prepare("SELECT price_per_person,deposit_percentage FROM finance_settings WHERE id='default'").first<any>(),
    db().prepare("SELECT single_room_supplement FROM tournaments WHERE active=1 LIMIT 1").first<any>(),
  ]);
  const membersByTeam = new Map<string, any[]>(), assignedByTeam = new Map<string, Set<string>>(), invoicesByTeam = new Map<string, any[]>(), paymentsByInvoice = new Map<string, number>();
  for (const member of memberRows.results as any[]) (membersByTeam.get(member.team_id) || (membersByTeam.set(member.team_id, []), membersByTeam.get(member.team_id)!)).push(member);
  for (const assignment of assignmentRows.results as any[]) (assignedByTeam.get(assignment.team_id) || (assignedByTeam.set(assignment.team_id, new Set()), assignedByTeam.get(assignment.team_id)!)).add(assignment.member_id);
  for (const invoice of invoiceRows.results as any[]) (invoicesByTeam.get(invoice.team_id) || (invoicesByTeam.set(invoice.team_id, []), invoicesByTeam.get(invoice.team_id)!)).push(invoice);
  for (const payment of paymentRows.results as any[]) paymentsByInvoice.set(payment.invoice_id, roundMoney((paymentsByInvoice.get(payment.invoice_id) || 0) + Number(payment.amount || 0)));
  const unitPrice = Number(tournament?.fixed_tournament_costs || settings?.price_per_person || 325), depositPercentage = Number(settings?.deposit_percentage || 30), singleSupplement = Number(tournament?.single_room_supplement || 0);
  return (teamRows.results as any[]).map((team) => {
    const members = membersByTeam.get(team.id) || [], assigned = assignedByTeam.get(team.id) || new Set<string>(), unassigned = members.filter((member) => !assigned.has(member.id));
    const memberIssues = members.filter((member) => member.member_type === "PLAYER" && (!member.player_role || member.classification_points === null || !Number.isFinite(Number(member.classification_points))));
    const issues = [...memberIssues];
    const hasValue = (value: unknown) => String(value || "").trim().length > 0;
    const hasAddress = hasValue(team.address) || [team.address_street, team.address_number, team.address_postal_code, team.address_city, team.address_country].some(hasValue);
    if (!members.length) issues.push({});
    if (!hasValue(team.contact_person) || !hasValue(team.phone) || !hasAddress) issues.push({});
    const total = roundMoney(members.length * unitPrice + unassigned.length * 0), depositAmount = roundMoney(total * depositPercentage / 100), balanceAmount = roundMoney(total - depositAmount);
    const invoices = invoicesByTeam.get(team.id) || [], deposit = invoices.find((item) => item.invoice_type === "DEPOSIT"), balance = invoices.find((item) => item.invoice_type === "BALANCE");
    const depositPaid = Number(paymentsByInvoice.get(deposit?.id) || 0), balancePaid = Number(paymentsByInvoice.get(balance?.id) || 0), depositTotal = Number(deposit?.total_amount || depositAmount), balanceTotal = Number(balance?.total_amount || balanceAmount);
    const depositOpen = team.review_status === "approved_payment_open" && Boolean(deposit), depositDone = depositOpen && depositPaid >= depositTotal && depositTotal > 0, balanceOpen = depositDone && Boolean(balance), balanceDone = balanceOpen && balancePaid >= balanceTotal && balanceTotal > 0;
    const setupDone = hasValue(team.contact_person) && hasValue(team.phone) && hasAddress, delegationDone = members.length > 0 && memberIssues.length === 0, roomsDone = unassigned.length === 0 && members.length > 0, complete = issues.length === 0;
    const stages = [
      { key: "registration", label: "Registration", done: true, state: "completed" },
      { key: "selection", label: "Selection", done: true, state: "completed" },
      { key: "portal", label: "Portal activated", done: true, state: "completed" },
      { key: "setup", label: "Team setup", done: setupDone, state: setupDone ? "completed" : "current" },
      { key: "delegation", label: "Delegation", done: delegationDone, state: delegationDone ? "completed" : setupDone ? "current" : "upcoming" },
      { key: "rooms", label: "Rooms", done: roomsDone, state: roomsDone ? "completed" : delegationDone ? "current" : "upcoming" },
      { key: "review", label: "Review", done: complete, state: complete ? "completed" : roomsDone ? "current" : "upcoming" },
      { key: "confirmation", label: "Team Confirmation", done: ["awaiting_admin", "approved_payment_open"].includes(team.review_status), state: ["awaiting_admin", "approved_payment_open"].includes(team.review_status) ? "completed" : "upcoming" },
      { key: "registration_review", label: "Registration Review", done: team.review_status === "approved_payment_open", state: team.review_status === "awaiting_admin" ? "current" : team.review_status === "approved_payment_open" ? "completed" : "upcoming" },
      { key: "deposit", label: "Deposit", done: depositDone, state: depositDone ? "completed" : depositOpen ? "current" : "upcoming" },
      { key: "balance", label: "Remaining balance", done: balanceDone, state: balanceDone ? "completed" : balanceOpen ? "current" : "upcoming" },
    ];
    const ready = balanceDone && team.review_status === "approved_payment_open", current = stages.find((stage) => stage.state === "current") || stages.find((stage) => !stage.done) || stages[stages.length - 1];
    return { team: { id: team.id, name: team.name }, status: team.review_status, stages: [...stages, { key: "ready", label: "Tournament Ready", done: ready, state: ready ? "completed" : "upcoming" }], current: current.label, action: ready ? "Tournament onboarding is complete" : "Complete the next registration step", review: { issues: issues.length, members: members.length, unassigned: unassigned.length }, payment: { deposit: depositTotal, paid: depositPaid, due: deposit?.due_at || null, balance: balanceTotal, balancePaid } };
  });
}
const fmtMoneyServer = (value: number) => `€${value.toFixed(2)}`;
function simplePdf(lines: string[]) {
  const clean = (value: string) => value.normalize("NFKD").replace(/[^\x20-\x7E]/g, "").replace(/([\\()])/g, "\\$1"),
    pages: string[][] = [];
  for (let i = 0; i < lines.length; i += 42) pages.push(lines.slice(i, i + 42));
  const objects: string[] = ["", "<< /Type /Catalog /Pages 2 0 R >>", ""];
  const pageIds: number[] = [];
  pages.forEach((page) => {
    const pageId = objects.length, contentId = pageId + 1;
    pageIds.push(pageId);
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${contentId + 1} 0 R >> >> /Contents ${contentId} 0 R >>`);
    const stream = `BT /F1 18 Tf 48 790 Td (${clean(page[0] || "PCF BATTLE")}) Tj /F1 10 Tf 0 -28 Td 15 TL ${page.slice(1).map((line, index) => `${index ? "T* " : ""}(${clean(line)}) Tj`).join(" ")} ET`;
    objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  });
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`;
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (let i = 1; i < objects.length; i++) { offsets[i] = pdf.length; pdf += `${i} 0 obj\n${objects[i]}\nendobj\n`; }
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n `).join("\n")}\ntrailer << /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new TextEncoder().encode(pdf);
}
function acceptsMutation(req: NextRequest) {
  const origin = req.headers.get("origin"),
    fetchSite = req.headers.get("sec-fetch-site");
  return fetchSite !== "cross-site" && (!origin || origin === new URL(req.url).origin);
}
const scheduleMinutes = (value: unknown, fallback = 15) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.min(180, Math.round(n)) : fallback;
};
const scheduleTime = (value: unknown) => {
  if (typeof value !== "string" || !/^\d{2}:\d{2}$/.test(value)) return null;
  const minutes = timeToMinutes(value);
  return minutes >= 0 && minutes < 24 * 60 ? minutes : null;
};
async function validateScheduleItems(tournamentId: string, proposed: ScheduleProposal[]) {
  const tournament = await db().prepare("SELECT schedule_min_rest_minutes, schedule_changeover_minutes FROM tournaments WHERE id=?").bind(tournamentId).first<{ schedule_min_rest_minutes?: number; schedule_changeover_minutes?: number }>();
  const minimumRest = Math.max(0, Number(tournament?.schedule_min_rest_minutes ?? 10));
  const rows = (await db().prepare("SELECT si.*,m.home_team_id,m.away_team_id,m.referee_ids FROM schedule_items si LEFT JOIN matches m ON m.id=si.match_id WHERE si.tournament_id=? AND si.active=1").bind(tournamentId).all()).results as unknown as ScheduleRecord[];
  const byId = new Map(rows.map((row) => [row.id, row]));
  for (const item of proposed) if (item.id && byId.has(item.id)) byId.set(item.id, { ...byId.get(item.id), ...item } as ScheduleRecord);
  const conflicts: { type: string; item_ids: string[]; message: string }[] = [];
  const lanes = new Map<string, ScheduledEntry[]>();
  const resources = new Map<string, ScheduledEntry[]>();
  for (const item of byId.values()) {
    if (!item.match_date || !item.start_time) {
      conflicts.push({ type: "missing_time", item_ids: [item.id], message: `${item.label || item.match_id || "Schedule item"} needs a date and time` });
      continue;
    }
    const start = scheduleTime(item.start_time);
    if (start === null) {
      conflicts.push({ type: "invalid_time", item_ids: [item.id], message: `Invalid start time for ${item.label || item.match_id || "schedule item"}` });
      continue;
    }
    const end = start + scheduleMinutes(item.duration_minutes, item.item_type === "break" ? 15 : 40);
    const laneKey = `${item.match_date}|${item.court || "unassigned"}`;
    if (!lanes.has(laneKey)) lanes.set(laneKey, []);
    lanes.get(laneKey)!.push({ item, start, end });
    if (item.item_type === "match") {
      let refs: string[] = [];
      try { refs = Array.isArray(item.referee_ids) ? item.referee_ids : JSON.parse(item.referee_ids || "[]"); } catch {}
      for (const resource of [...new Set([item.home_team_id, item.away_team_id, ...refs].filter(Boolean))]) {
        const key = `${item.match_date}|${resource}`;
        if (!resources.has(key)) resources.set(key, []);
        resources.get(key)!.push({ item, start, end });
      }
    }
  }
  const checkOverlaps = (groups: Map<string, ScheduledEntry[]>, type: string, label: (entry: ScheduledEntry) => string, gap = 0) => {
    for (const entries of groups.values()) {
      entries.sort((a, b) => a.start - b.start);
      for (let i = 1; i < entries.length; i++) if (entries[i].item.id !== entries[i - 1].item.id && entries[i].start < entries[i - 1].end + gap) {
        const a = entries[i - 1], b = entries[i];
        conflicts.push({ type, item_ids: [a.item.id, b.item.id], message: `${label(b)} overlaps ${label(a)}` });
      }
    }
  };
  checkOverlaps(lanes, "court_overlap", (entry) => entry.item.label || entry.item.match_id || "schedule item");
  checkOverlaps(resources, "resource_overlap", (entry) => entry.item.label || entry.item.match_id || "match", minimumRest);
  return conflicts;
}
const resources: Record<string, string[]> = {
  tournaments: [
    "name",
    "start_date",
    "end_date",
    "city",
    "country",
    "active",
    "registration_mode",
    "registration_enabled",
    "live_enabled",
    "show_tournament",
    "show_referees",
    "emergency_enabled",
    "emergency_message",
    "show_livestream",
    "livestream_url",
    "show_teams",
    "show_matches",
    "show_standings",
    "show_brackets",
    "show_statistics",
    "show_about",
    "show_gallery",
    "gallery_url",
    "instagram_url",
    "public_message",
    "opening_hours",
    "hotel_name",
    "hotel_address",
    "venue_name",
    "venue_address",
    "parking_info",
    "accessibility_info",
    "catering_info",
    "format_rules",
    "pcf_battle_info",
    "award_info",
    "visitor_info",
    "chatbot_knowledge",
    "match_duration_minutes",
    "schedule_half_duration_minutes",
    "schedule_start_time",
    "schedule_changeover_minutes",
    "schedule_min_rest_minutes",
    "halftime_duration_minutes",
    "scoreboard_background",
    "scoreboard_accent",
    "scoreboard_logo_scale",
    "scoreboard_show_sponsors",
    "fixed_tournament_costs",
    "single_room_supplement",
  ],
  preregistrations: ["tournament_id", "club_name", "email"],
  teams: [
    "name",
    "contact_person",
    "color",
    "logo",
    "team_photo",
    "phone",
    "phone_country_code",
    "address",
    "address_street",
    "address_number",
    "address_postal_code",
    "address_city",
    "address_country",
    "website",
    "group_id",
    "expected_delegation_size",
    "invoice_requested",
    "billing_address",
    "billing_name",
    "vat_number",
    "billing_postal_code",
    "billing_city",
    "billing_country",
    "contact_email",
    "whatsapp",
    "withdrawal_reason",
  ],
  matches: [
    "tournament_id",
    "home_team_id",
    "away_team_id",
    "home_score",
    "away_score",
    "status",
    "confirmed",
    "court",
    "match_date",
    "start_time",
    "referee_ids",
    "group_id",
    "period",
    "clock",
    "clock_running",
    "clock_started_at",
    "scoreboard_mode",
    "version",
  ],
  groups: ["tournament_id", "name", "team_ids"],
  delegation_members: [
    "team_id",
    "name",
    "role",
    "member_type",
    "player_role",
    "classification_points",
    "staff_role",
    "custom_staff_role",
    "dob",
    "dietary",
    "notes",
    "number",
    "photo",
    "privacy_consent",
    "photo_consent",
    "emergency_contact",
    "assistant_player_id",
    "wheelchair_user",
  ],
  rooms: ["number", "capacity", "price", "locked", "team_id"],
  payments: [
    "team_id",
    "amount",
    "description",
    "status",
    "due_date",
    "last_reminder_at",
    "notes",
  ],
  links: [
    "title",
    "url",
    "dark_url",
    "target_url",
    "description",
    "category",
    "sort_order",
    "active",
  ],
  users: [
    "email",
    "password",
    "role",
    "name",
    "team_id",
    "country",
    "photo",
    "active",
  ],
  invites: ["code", "team_id", "recipient_email", "used", "expires_at"],
  brackets: ["active", "mode", "data"],
  schedule_items: ["tournament_id", "item_type", "match_id", "label", "match_date", "start_time", "duration_minutes", "court", "sort_order", "active"],
};
const mapName = (s: string) => (s === "delegation" ? "delegation_members" : s);
async function sha(s: string) {
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(h)]
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}
const hex = (b: Uint8Array) =>
  [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
const PBKDF2_ITERATIONS = 100000;
async function hashPassword(password: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16)),
    key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(password),
      "PBKDF2",
      false,
      ["deriveBits"],
    ),
    bits = await crypto.subtle.deriveBits(
      { name: "PBKDF2", hash: "SHA-256", salt, iterations: PBKDF2_ITERATIONS },
      key,
      256,
    );
  return `pbkdf2$${hex(salt)}$${hex(new Uint8Array(bits))}`;
}
async function verifyPassword(password: string, stored: string) {
  if (!stored.startsWith("pbkdf2$")) return stored === (await sha(password));
  const [, saltHex, want] = stored.split("$"),
    salt = new Uint8Array(
      (saltHex.match(/.{2}/g) || []).map((x) => parseInt(x, 16)),
    ),
    key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(password),
      "PBKDF2",
      false,
      ["deriveBits"],
    ),
    bits = await crypto.subtle.deriveBits(
      { name: "PBKDF2", hash: "SHA-256", salt, iterations: PBKDF2_ITERATIONS },
      key,
      256,
    );
  return hex(new Uint8Array(bits)) === want;
}
function pack(v: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify(v));
  return btoa(String.fromCharCode(...bytes)).replace(/=/g, "");
}
async function sign(payload: string) {
  const configuredSecret = runtimeEnv.SESSION_SECRET;
  if (!configuredSecret)
    throw new Error("SESSION_SECRET is required");
  const secret = String(configuredSecret),
    key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    ),
    sig = await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(payload),
    );
  return hex(new Uint8Array(sig));
}
async function session(req: NextRequest): Promise<SessionUser | null> {
  const raw =
    req.cookies.get("phb_token")?.value ||
    req.headers.get("authorization")?.replace(/^Bearer /i, "");
  try {
    const [payload, sig] = (raw || "").split(".");
    if (!payload || sig !== (await sign(payload))) return null;
    const bytes = Uint8Array.from(atob(payload), (c) => c.charCodeAt(0)),
      u = parseSessionUser(JSON.parse(new TextDecoder().decode(bytes)));
    if (!u || u.exp <= Date.now()) return null;
    const current = await db()
      .prepare("SELECT active,updated_at FROM users WHERE id=?")
      .bind(u.id)
      .first<{ active?: number; updated_at?: string }>();
    return current?.active === 1 && u.sv === current.updated_at ? u : null;
  } catch {
    return null;
  }
}
function permit(u: SessionUser | null, roles: string[]) {
  return u && roles.includes(u.role);
}
async function log(
  u: SessionUser | null,
  action: string,
  type: string,
  entity?: string,
  details?: unknown,
) {
  await db()
    .prepare("INSERT INTO audit_log VALUES (?,?,?,?,?,?,?,?)")
    .bind(
      uuid(),
      u?.id || null,
      u?.name || "System",
      action,
      type,
      entity || null,
      details ? JSON.stringify(details) : null,
      now(),
    )
    .run();
}
async function sendEmail(
  to: string | undefined,
  subject: string,
  html: string,
) {
  const key = runtimeEnv.RESEND_API_KEY,
    from = runtimeEnv.RESEND_FROM;
  if (!key || !from || !to) return false;
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from, to, subject, html }),
    });
    return r.ok;
  } catch {
    return false;
  }
}
function escapeEmailHtml(value: unknown) {
  return String(value ?? "").replace(
    /[&<>\"]/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '\"': "&quot;" })[
        character
      ] || character,
  );
}

function teamInviteEmail(origin: string, code: string) {
  const safeOrigin = escapeEmailHtml(origin);
  const safeCode = escapeEmailHtml(code);
  const inviteUrl = `${origin}/signup?code=${encodeURIComponent(code)}`;
  const safeInviteUrl = escapeEmailHtml(inviteUrl);
  const logoUrl = `${origin}/PFB_Logo_Pink.svg`;

  return `<!doctype html>
<html lang="en">
  <body style="margin:0;background:#f5f5f7;color:#18181b;font-family:Arial,Helvetica,sans-serif">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0">Your invitation to join Powerchair Floorball Battle is ready.</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f7">
      <tr>
        <td align="center" style="padding:32px 14px">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:680px;background:#ffffff;border:1px solid #e4e4e7;border-radius:18px;overflow:hidden">
            <tr>
              <td align="center" style="padding:32px 32px 24px;border-top:6px solid #ec4899">
                <img src="${escapeEmailHtml(logoUrl)}" width="82" alt="PCF BATTLE" style="display:block;width:82px;height:auto;margin:0 auto 18px">
                <div style="font-size:13px;font-weight:700;letter-spacing:1.8px;color:#ec4899">PCF BATTLE</div>
                <h1 style="margin:8px 0 0;font-size:28px;line-height:1.2;color:#18181b">Powerchair Floorball Battle</h1>
              </td>
            </tr>
            <tr>
              <td style="padding:34px 40px 38px">
                <h2 style="margin:0 0 14px;font-size:22px;line-height:1.3;color:#18181b">You have been invited</h2>
                <p style="margin:0 0 22px;font-size:16px;line-height:1.65;color:#52525b">The organisation has invited you to create a team portal account. Use the invitation code below to complete your registration and choose your password.</p>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;background:#fdf2f8;border:1px solid #fbcfe8;border-radius:12px">
                  <tr>
                    <td align="center" style="padding:20px">
                      <div style="margin-bottom:7px;font-size:12px;font-weight:700;letter-spacing:1.5px;color:#9d174d">INVITATION CODE</div>
                      <div style="font-size:28px;font-weight:800;letter-spacing:3px;color:#18181b">${safeCode}</div>
                    </td>
                  </tr>
                </table>
                <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto 26px">
                  <tr>
                    <td align="center" bgcolor="#ec4899" style="border-radius:10px">
                      <a href="${safeInviteUrl}" style="display:inline-block;padding:14px 24px;color:#ffffff;font-size:16px;font-weight:700;text-decoration:none">Complete team registration</a>
                    </td>
                  </tr>
                </table>
                <p style="margin:0 0 10px;font-size:14px;line-height:1.6;color:#71717a">If the button does not work, visit:</p>
                <p style="margin:0 0 24px;font-size:14px;line-height:1.6;word-break:break-all"><a href="${safeInviteUrl}" style="color:#db2777">${safeInviteUrl}</a></p>
                <p style="margin:0;font-size:14px;line-height:1.6;color:#71717a">Need help? Contact the organisation at <a href="mailto:hello@pcfbattle.be" style="color:#db2777">hello@pcfbattle.be</a>.</p>
              </td>
            </tr>
            <tr>
              <td style="padding:0;background:#fafafa;border-top:1px solid #e4e4e7">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    <td width="31%" align="center" valign="middle" style="padding:26px 22px">
                      <img src="${escapeEmailHtml(logoUrl)}" width="112" alt="Powerchair Floorball Battle Belgium" style="display:block;width:100%;max-width:112px;height:auto;margin:0 auto">
                    </td>
                    <td width="2" style="width:2px;background:#ec1970;font-size:0;line-height:0">&nbsp;</td>
                    <td valign="middle" style="padding:26px 24px 26px 28px">
                      <div style="font-size:21px;font-weight:800;line-height:1.25;color:#18181b">Senne Brouwers &amp;<br>Seppe Hemerijckx</div>
                      <div style="margin-top:8px;font-size:13px;font-weight:800;letter-spacing:1.2px;color:#ec4899">ORGANIZERS</div>
                      <div style="margin-top:18px;font-size:15px;font-weight:800;line-height:1.35;letter-spacing:.4px;color:#27272a">POWERCHAIR FLOORBALL BATTLE</div>
                      <div style="margin-top:10px;font-size:14px;font-weight:700"><a href="mailto:hello@pcfbattle.be" style="color:#db2777;text-decoration:none">hello@pcfbattle.be</a></div>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}
function registrationEmail(clubName: string, selected = false, waitingList = false) {
  const title = selected ? "Your team has been selected" : waitingList ? "Your team was not selected" : "Registration received";
  const intro = selected
    ? `Congratulations — <strong>${escapeEmailHtml(clubName)}</strong> has been selected to participate in PCF BATTLE.`
    : waitingList
    ? `Thank you for applying with <strong>${escapeEmailHtml(clubName)}</strong>. Unfortunately, your team was not selected for the tournament at this time.`
    : `We have received the registration for <strong>${escapeEmailHtml(clubName)}</strong>.`;
  const next = selected
    ? "You will receive a separate invitation to your personal team portal later. There, you can complete the required tournament information."
    : waitingList
    ? "If you would like your team to be considered for the waiting list, simply reply to this email and let us know. We will contact you if a place becomes available."
    : "Our team will review the registration and contact you with the next steps. Sending this registration does not yet guarantee a place in the tournament.";
  const logoUrl = `${new URL(runtimeEnv.SITE_ORIGIN || "https://pch-battle.senne-brouwers.chatgpt.site").origin}/PFB_Logo_Pink.svg`;
  return `<!doctype html><html lang="en"><body style="margin:0;background:#f5f5f7;color:#18181b;font-family:Arial,Helvetica,sans-serif"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f7"><tr><td align="center" style="padding:32px 14px"><table role="presentation" width="100%" style="max-width:680px;background:#fff;border:1px solid #e4e4e7;border-radius:18px;overflow:hidden"><tr><td align="center" style="padding:32px 32px 24px;border-top:6px solid #ec4899"><img src="${logoUrl}" width="82" alt="PCF BATTLE" style="display:block;width:82px;height:auto;margin:0 auto 18px"><div style="font-size:13px;font-weight:700;letter-spacing:1.8px;color:#ec4899">PCF BATTLE</div><h1 style="margin:8px 0 0;font-size:28px;line-height:1.2;color:#18181b">Powerchair Floorball Battle</h1></td></tr><tr><td style="padding:34px 40px 38px"><h2 style="margin:0 0 14px;font-size:22px;line-height:1.3;color:#18181b">${title}</h2><div style="font-size:16px;line-height:1.65;color:#52525b"><p>${intro}</p><p>${next}</p><p style="margin-bottom:0">Questions? Contact <a href="mailto:hello@pcfbattle.be" style="color:#db2777">hello@pcfbattle.be</a>.</p></div></td></tr><tr><td style="padding:0;background:#fafafa;border-top:1px solid #e4e4e7"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td width="31%" align="center" valign="middle" style="padding:26px 22px"><img src="${logoUrl}" width="112" alt="Powerchair Floorball Battle Belgium" style="display:block;width:100%;max-width:112px;height:auto;margin:0 auto"></td><td width="2" style="width:2px;background:#ec1970;font-size:0;line-height:0">&nbsp;</td><td valign="middle" style="padding:26px 24px 26px 28px"><div style="font-size:21px;font-weight:800;line-height:1.25;color:#18181b">Senne Brouwers &amp;<br>Seppe Hemerijckx</div><div style="margin-top:8px;font-size:13px;font-weight:800;letter-spacing:1.2px;color:#ec4899">ORGANIZERS</div><div style="margin-top:18px;font-size:15px;font-weight:800;line-height:1.35;letter-spacing:.4px;color:#27272a">POWERCHAIR FLOORBALL BATTLE</div><div style="margin-top:10px;font-size:14px;font-weight:700"><a href="mailto:hello@pcfbattle.be" style="color:#db2777;text-decoration:none">hello@pcfbattle.be</a></div></td></tr></table></td></tr></table></td></tr></table></body></html>`;
}
async function syncAccommodation(teamId: string) {
  if (!teamId) return;
  await ensureScheduleSchema();
  const settings: any = await db().prepare("SELECT fixed_tournament_costs,single_room_supplement FROM tournaments WHERE active=1 LIMIT 1").first();
  const assignments = (await db()
    .prepare("SELECT ra.room_id FROM room_assignments ra JOIN delegation_members m ON m.id=ra.member_id WHERE m.team_id=?")
    .bind(teamId)
    .all()).results as any[];
  const baseCost = Number(settings?.fixed_tournament_costs || 0);
  const singleSupplement = Number(settings?.single_room_supplement || 0);
  const occupantsByRoom = new Map<string, number>();
  for (const assignment of assignments) occupantsByRoom.set(assignment.room_id, (occupantsByRoom.get(assignment.room_id) || 0) + 1);
  const singleRooms = [...occupantsByRoom.values()].filter((occupants) => occupants === 1).length;
  const amount = assignments.length * baseCost + singleRooms * singleSupplement,
    ts = now();
  await db()
    .prepare(
      "INSERT INTO payments (id,team_id,amount,description,status,due_date,last_reminder_at,notes,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET amount=excluded.amount,updated_at=excluded.updated_at",
    )
    .bind(
      `accommodation-${teamId}`,
      teamId,
      amount,
      "Accommodation",
      "pending",
      null,
      null,
      "Automatically calculated per assigned person",
      ts,
      ts,
    )
    .run();
}
async function list(table: string, where = "", values: any[] = [], columns = "*") {
  const r = await db()
    .prepare(`SELECT ${columns} FROM ${table} ${where}`)
    .bind(...values)
    .all();
  return r.results.map((x: any) => {
    for (const k of ["team_ids", "referee_ids", "data"])
      if (typeof x[k] === "string")
        try {
          x[k] = JSON.parse(x[k]);
        } catch {}
    delete x.password;
    return x;
  });
}
async function seed(force = false, preserveAdminId?: string) {
  if (force)
    for (const t of [
      "audit_log",
      "match_events",
      "goal_events",
      "preregistrations",
      "room_assignments",
      "brackets",
      "payments",
      "invites",
      "links",
      "rooms",
      "matches",
      "groups",
      "delegation_members",
      "teams",
      "tournaments",
    ])
      await db().prepare(`DELETE FROM ${t}`).run();
  if (force && preserveAdminId)
    await db().prepare("UPDATE users SET active=1 WHERE id=? AND role='ADMIN'").bind(preserveAdminId).run();
  if ((await db().prepare("SELECT COUNT(*) c FROM teams").first<any>())?.c)
    return { seeded: false };
  const ts = now(),
    names = [
      "Brussels Falcons",
      "Antwerp Dragons",
      "Leuven Knights",
      "Ghent Wolves",
      "Rotterdam Phoenix",
      "Liège Lions",
      "Eindhoven Titans",
      "Cologne Bears",
    ],
    colors = [
      "#ec4899",
      "#f97316",
      "#8b5cf6",
      "#0ea5e9",
      "#ef4444",
      "#eab308",
      "#10b981",
      "#64748b",
    ];
  const q: any[] = [
    db()
      .prepare(
        "INSERT OR IGNORE INTO tournaments (id,name,start_date,end_date,city,country,active,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
      )
      .bind(
        "tournament-1",
        "PCF Battle 2027",
        "2027-05-01",
        "2027-05-02",
        "Leuven",
        "Belgium",
        1,
        ts,
        ts,
      ),
    db()
      .prepare(
        "INSERT OR IGNORE INTO users (id,email,password,role,name,team_id,country,photo,active,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
      )
      .bind(
        "admin-1",
        "admin@phb.app",
        await hashPassword(crypto.randomUUID()),
        "ADMIN",
        "Tournament Admin",
        null,
        "Belgium",
        null,
        1,
        ts,
        ts,
      ),
    db()
      .prepare(
        "INSERT OR IGNORE INTO users (id,email,password,role,name,team_id,country,photo,active,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
      )
      .bind(
        "ref-1",
        "ref@phb.app",
        await hashPassword(crypto.randomUUID()),
        "REFEREE",
        "Marc Janssen",
        null,
        "Belgium",
        null,
        1,
        ts,
        ts,
      ),
    db()
      .prepare(
        "INSERT OR IGNORE INTO users (id,email,password,role,name,team_id,country,photo,active,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
      )
      .bind(
        "ref-2",
        "ref2@phb.app",
        await hashPassword(crypto.randomUUID()),
        "REFEREE",
        "Anna Rossi",
        null,
        "Italy",
        null,
        1,
        ts,
        ts,
      ),
  ];
  for (let i = 0; i < 8; i++) {
    q.push(
      db()
        .prepare(
          "INSERT INTO teams (id,name,contact_person,color,logo,team_photo,phone,address,website,group_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
        )
        .bind(
          `team-${i + 1}`,
          names[i],
          `${names[i]} contact`,
          colors[i],
          null,
          null,
          null,
          null,
          null,
          i < 4 ? "A" : "B",
          ts,
          ts,
        ),
    );
    q.push(
      db()
        .prepare(
          "INSERT OR IGNORE INTO users (id,email,password,role,name,team_id,country,photo,active,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
        )
        .bind(
          `team-user-${i + 1}`,
          `team${i || ""}@phb.app`,
          await hashPassword(crypto.randomUUID()),
          "TEAM",
          names[i],
          `team-${i + 1}`,
          null,
          null,
          1,
          ts,
          ts,
        ),
    );
    q.push(
      db()
        .prepare(
          "INSERT INTO rooms (id,number,capacity,price,locked,team_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)",
        )
        .bind(
          `room-${i + 1}`,
          String(201 + i),
          2,
          80,
          0,
          `team-${i + 1}`,
          ts,
          ts,
        ),
    );
  }
  await db().batch(q);
  await db().batch([
    db()
      .prepare("INSERT INTO groups VALUES (?,?,?,?,?,?)")
      .bind(
        "group-a",
        "tournament-1",
        "A",
        JSON.stringify(["team-1", "team-2", "team-3", "team-4"]),
        ts,
        ts,
      ),
    db()
      .prepare("INSERT INTO groups VALUES (?,?,?,?,?,?)")
      .bind(
        "group-b",
        "tournament-1",
        "B",
        JSON.stringify(["team-5", "team-6", "team-7", "team-8"]),
        ts,
        ts,
      ),
  ]);
  const games = [
    [1, 2, 4, 3, "live", "14:30", "A"],
    [5, 6, 6, 2, "finished", "12:00", "B"],
    [3, 4, 3, 3, "finished", "13:15", "A"],
    [7, 8, 0, 0, "scheduled", "16:00", "B"],
    [1, 3, 0, 0, "scheduled", "17:15", "A"],
    [2, 4, 2, 1, "finished", "10:00", "A"],
    [5, 7, 5, 2, "finished", "10:45", "B"],
    [6, 8, 4, 4, "finished", "11:30", "B"],
    [1, 4, 6, 1, "finished", "09:00", "A"],
    [5, 8, 3, 0, "finished", "09:45", "B"],
  ] as any[][];
  await db().batch(
    games.map((g, i) =>
      db()
        .prepare("INSERT INTO matches (id,tournament_id,home_team_id,away_team_id,home_score,away_score,status,court,start_time,referee_ids,group_id,period,clock,version,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
        .bind(
          `match-${i + 1}`,
          "tournament-1",
          `team-${g[0]}`,
          `team-${g[1]}`,
          g[2],
          g[3],
          g[4],
          "Court 1",
          g[5],
          JSON.stringify(["ref-1", "ref-2"]),
          g[6],
          "1st half",
          "20:00",
          1,
          ts,
          ts,
        ),
    ),
  );
  await db().batch(
    names.flatMap((name, i) =>
      [0, 1, 2, 3, 4, 5, 6, 7].map((n, j) =>
        db()
          .prepare(
            "INSERT INTO delegation_members VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
          )
          .bind(
            `member-${i + 1}-${j + 1}`,
            `team-${i + 1}`,
            j < 6
              ? `${name.split(" ")[0]} Player ${j + 1}`
              : j === 6
                ? "Head Coach"
                : "Team Assistant",
            j < 6 ? "PLAYER" : j === 6 ? "COACH" : "ASSISTANT",
            null,
            j === 2 ? "Vegetarian" : null,
            null,
            j < 6 ? n + 2 : null,
            null,
            ts,
            ts,
          ),
      ),
    ),
  );
  await db().batch(
    names.map((name, i) =>
      db()
        .prepare("INSERT INTO payments VALUES (?,?,?,?,?,?,?,?,?,?)")
        .bind(
          `payment-${i + 1}`,
          `team-${i + 1}`,
          800,
          "Tournament registration",
          i < 5 ? "paid" : i === 7 ? "overdue" : "pending",
          "2027-04-01",
          null,
          null,
          ts,
          ts,
        ),
    ),
  );
  await db()
    .prepare(
      "INSERT INTO links (id,title,url,target_url,description,category,sort_order,active,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
    )
    .bind(
      "link-1",
      "Powerchair floorball rules",
      "https://www.powerchairhockey.org/",
      null,
      "Official rules and resources",
      "Rules",
      0,
      1,
      ts,
      ts,
    )
    .run();
  await db().batch(
    ["G10", "Park Inn by Radisson", "Leuven", "Sport Vlaanderen"]
      .map((n, i) =>
        db()
          .prepare(
            "INSERT INTO links (id,title,url,target_url,description,category,sort_order,active,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
          )
          .bind(
            `sponsor-${i + 1}`,
            n,
            [
              "/sponsor-g10.png",
              "/sponsor-parkinn.png",
              "/sponsor-leuven.png",
              "/sponsor-sportvlaanderen.png",
            ][i],
            null,
            "Sponsor logo",
            "Sponsor",
            i,
            1,
            ts,
            ts,
          ),
      )
      .filter(Boolean),
  );
  await log(null, "SEED", "system", "tournament-1");
  return { seeded: true };
}
async function standings() {
  const teams: any[] = (await list("teams")) as any[],
    matches: any[] = (await list(
      "matches",
      "WHERE status='finished' AND confirmed=1",
    )) as any[];
  return teams
    .map((t) => {
      let p = 0,
        w = 0,
        d = 0,
        l = 0,
        gf = 0,
        ga = 0;
      for (const m of matches)
        if ([m.home_team_id, m.away_team_id].includes(t.id)) {
          p++;
          const home = m.home_team_id === t.id,
            a = home ? m.home_score : m.away_score,
            b = home ? m.away_score : m.home_score;
          gf += a;
          ga += b;
          a > b ? w++ : a === b ? d++ : l++;
        }
      return {
        ...t,
        played: p,
        won: w,
        drawn: d,
        lost: l,
        goalsFor: gf,
        goalsAgainst: ga,
        goalDifference: gf - ga,
        points: w * 3 + d,
      };
    })
    .sort(
      (a, b) =>
        b.points - a.points ||
        b.goalDifference - a.goalDifference ||
        b.goalsFor - a.goalsFor,
    );
}
function parseJson<T>(value: unknown, fallback: T): T {
  if (Array.isArray(value) || (value && typeof value === "object")) return value as T;
  try { return JSON.parse(String(value || "")) as T; } catch { return fallback; }
}
function addDays(date: string, amount: number) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + amount);
  return value.toISOString().slice(0, 10);
}
function timeToMinutes(value: string) {
  const [hours, minutes] = String(value || "00:00").split(":").map(Number);
  return (hours || 0) * 60 + (minutes || 0);
}
function makeRoundRobin(ids: string[]) {
  const teams = [...new Set(ids.filter(Boolean))];
  if (teams.length % 2) teams.push("");
  const rounds: { home: string; away: string }[][] = [];
  for (let round = 0; round < teams.length - 1; round++) {
    const games: { home: string; away: string }[] = [];
    for (let i = 0; i < teams.length / 2; i++) {
      const home = teams[i], away = teams[teams.length - 1 - i];
      if (home && away) games.push({ home, away });
    }
    rounds.push(games);
    teams.splice(1, 0, teams.pop() as string);
  }
  return rounds;
}
async function groupStandingsFor(tournamentId: string, groupId: string) {
  const teams: any[] = (await list("teams", "WHERE upper(replace(group_id,'group-',''))=? ORDER BY name", [groupId])) as any[];
  const matches: any[] = (await list("matches", "WHERE tournament_id=? AND upper(replace(group_id,'group-',''))=? AND status='finished' AND confirmed=1", [tournamentId, groupId])) as any[];
  return teams.map((team) => {
    let played = 0, points = 0, gf = 0, ga = 0;
    for (const match of matches) if ([match.home_team_id, match.away_team_id].includes(team.id)) {
      played++;
      const home = match.home_team_id === team.id, scored = home ? Number(match.home_score) : Number(match.away_score), conceded = home ? Number(match.away_score) : Number(match.home_score);
      gf += scored; ga += conceded; points += scored > conceded ? 3 : scored === conceded ? 1 : 0;
    }
    return { ...team, played, points, goalsFor: gf, goalsAgainst: ga, goalDifference: gf - ga };
  }).sort((a, b) => b.points - a.points || b.goalDifference - a.goalDifference || b.goalsFor - a.goalsFor || a.name.localeCompare(b.name));
}
async function resolveBracketProgression(tournamentId: string) {
  const bracket: any = await db().prepare("SELECT id,data FROM brackets WHERE active=1 ORDER BY created_at DESC LIMIT 1").first();
  if (!bracket) return;
  const data: any = parseJson(bracket.data, {});
  const standings = { A: await groupStandingsFor(tournamentId, "A"), B: await groupStandingsFor(tournamentId, "B") };
  const games = [...(data.consolation || []), ...(data.championship || []), ...(data.finals || [])];
  const byKey: Record<string, any> = Object.fromEntries(games.map((game) => [game.key, game]));
  const matches: any[] = (await db().prepare("SELECT * FROM matches WHERE tournament_id=? AND group_id LIKE 'KO:%'").bind(tournamentId).all()).results as any[];
  const matchByKey: Record<string, any> = Object.fromEntries(matches.map((match) => [match.group_id, match]));
  const sources: Record<string, [any, any]> = {
    "KO:5a": [{ type: "GROUP_POSITION", group: "A", position: 3 }, { type: "GROUP_POSITION", group: "B", position: 4 }],
    "KO:5b": [{ type: "GROUP_POSITION", group: "B", position: 3 }, { type: "GROUP_POSITION", group: "A", position: 4 }],
    "KO:sf1": [{ type: "GROUP_POSITION", group: "A", position: 1 }, { type: "GROUP_POSITION", group: "B", position: 2 }],
    "KO:sf2": [{ type: "GROUP_POSITION", group: "B", position: 1 }, { type: "GROUP_POSITION", group: "A", position: 2 }],
    "KO:7th": [{ type: "MATCH_LOSER", match: "KO:5a" }, { type: "MATCH_LOSER", match: "KO:5b" }],
    "KO:5th": [{ type: "MATCH_WINNER", match: "KO:5a" }, { type: "MATCH_WINNER", match: "KO:5b" }],
    "KO:3rd": [{ type: "MATCH_LOSER", match: "KO:sf1" }, { type: "MATCH_LOSER", match: "KO:sf2" }],
    "KO:final": [{ type: "MATCH_WINNER", match: "KO:sf1" }, { type: "MATCH_WINNER", match: "KO:sf2" }],
  };
  const resolve = (source: any): string | null => {
    if (source.type === "GROUP_POSITION") return standings[source.group as "A" | "B"][source.position - 1]?.id || null;
    const sourceMatch = matchByKey[source.match];
    if (!sourceMatch || sourceMatch.status !== "finished" || !sourceMatch.confirmed || sourceMatch.home_team_id?.startsWith("source:") || sourceMatch.away_team_id?.startsWith("source:")) return null;
    const winner = Number(sourceMatch.home_score) >= Number(sourceMatch.away_score) ? sourceMatch.home_team_id : sourceMatch.away_team_id;
    return source.type === "MATCH_LOSER" ? (winner === sourceMatch.home_team_id ? sourceMatch.away_team_id : sourceMatch.home_team_id) : winner;
  };
  const resolvedTeamIds = [...new Set(matches.flatMap((match: any) => [match.home_team_id, match.away_team_id]).filter((id: unknown): id is string => typeof id === "string" && !id.startsWith("source:") && !id.startsWith("dependency:")))] as string[];
  const teamNameRows = resolvedTeamIds.length
    ? (await db().prepare(`SELECT id,name FROM teams WHERE id IN (${resolvedTeamIds.map(() => "?").join(",")})`).bind(...resolvedTeamIds).all()).results as any[]
    : [];
  const teamNames = new Map(teamNameRows.map((row: any) => [row.id, row.name]));
  for (const game of games) {
    const pair = sources[game.key];
    if (!pair || !matchByKey[game.key]) continue;
    const resolved = pair.map(resolve), match = matchByKey[game.key];
    // The legacy schema requires both participant columns to be non-null.
    // Keep a dependency marker until its source is known; never write NULL.
    const stored = resolved.map((id, index) => id || match[index === 0 ? "home_team_id" : "away_team_id"] || `dependency:${game.key}:${index === 0 ? "home" : "away"}`);
    await db().prepare("UPDATE matches SET home_team_id=?,away_team_id=?,updated_at=? WHERE id=?").bind(stored[0], stored[1], now(), match.id).run();
    const display = (id: string | null, source: any) => id ? (matches.find((item) => item.home_team_id === id || item.away_team_id === id)?.home_team_id === id ? null : null) : source.type === "GROUP_POSITION" ? `${source.position}th Group ${source.group}` : `${source.type === "MATCH_WINNER" ? "Winner" : "Loser"} ${source.match.replace("KO:", "")}`;
    const names = resolved.map((id, index) => id ? (teamNames.get(id) || id) : display(null, pair[index]));
    const updateData = (list: any[]) => list.map((item) => item.key === game.key ? { ...item, a: names[0], b: names[1], dependencies: pair } : item);
    data.consolation = updateData(data.consolation || []); data.championship = updateData(data.championship || []); data.finals = updateData(data.finals || []);
  }
  await db().prepare("UPDATE brackets SET data=?,updated_at=? WHERE id=?").bind(JSON.stringify(data), now(), bracket.id).run();
}
async function mayControlMatch(u: SessionUser | null, matchId: string) {
  if (!u) return false;
  return ["ADMIN", "SCOREBOARD"].includes(u.role);
}
async function mayViewMatch(u: SessionUser | null, matchId: string) {
  if (await mayControlMatch(u, matchId)) return true;
  if (u?.role !== "REFEREE") return false;
  const row: any = await db()
    .prepare("SELECT referee_ids FROM matches WHERE id=?")
    .bind(matchId)
    .first();
  return JSON.parse(row?.referee_ids || "[]").includes(u.id);
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ path?: string[] }> },
) {
  const parts = (await params).path || [],
    path = parts.join("/"),
    u = (await session(req)) as SessionUser;
  try {
    if (path === "mvp/candidates") {
      if (!permit(u, ["ADMIN", "REFEREE"])) return out({ error: u ? "Forbidden" : "Unauthorized" }, u ? 403 : 401);
      await ensureMvpSchema();
      const tournament: any = await db().prepare("SELECT id FROM tournaments WHERE active=1 LIMIT 1").first();
      const settings: any = await db().prepare("SELECT * FROM mvp_settings WHERE tournament_id=?").bind(tournament?.id || "").first();
      const rows: any = (await db().prepare("SELECT dm.id,dm.name,dm.member_type,dm.player_role,dm.classification_points,dm.staff_role,dm.custom_staff_role,t.id team_id,t.name team_name FROM delegation_members dm JOIN teams t ON t.id=dm.team_id WHERE dm.member_type IN ('PLAYER','COACH','STAFF') ORDER BY t.name,dm.name").all()).results;
      const candidates = rows.flatMap((member: any) => {
        if (member.member_type === "PLAYER" && member.player_role === "KEEPER") return [{ ...member, category: "BEST_KEEPER" }];
        if (member.member_type === "PLAYER" && member.player_role === "T_STICK") return [{ ...member, category: "BEST_T_STICK" }];
        if (member.member_type === "PLAYER" && member.player_role === "HANDSTICK") return [{ ...member, category: Number(member.classification_points) < 3 ? "BEST_HANDSTICK_UNDER_3" : "BEST_HANDSTICK_3_PLUS" }];
        if (member.member_type === "COACH" || (member.member_type === "STAFF" && (member.staff_role === "HEAD_COACH" || (member.staff_role === "ASSISTANT_COACH" && settings?.assistant_coach_eligible !== 0)))) return [{ ...member, category: "BEST_COACH" }];
        return [];
      });
      const referees: any = (await db().prepare("SELECT id,name,'REFEREE' member_type,NULL team_id,NULL team_name FROM users WHERE role='REFEREE' AND active=1 UNION ALL SELECT id,name,member_type,team_id,NULL team_name FROM delegation_members WHERE member_type='REFEREE'").all()).results;
      const votes: any = (await db().prepare("SELECT category,candidate_id,COUNT(*) votes FROM mvp_votes WHERE tournament_id=? GROUP BY category,candidate_id").bind(tournament?.id || "").all()).results;
      const voteSummary = votes.reduce((result: Record<string, Record<string, number>>, vote: any) => { (result[vote.category] ||= {})[vote.candidate_id] = Number(vote.votes || 0); return result; }, {});
      const voted: any = await db().prepare("SELECT COUNT(DISTINCT referee_id) count FROM mvp_votes WHERE tournament_id=?").bind(tournament?.id || "").first();
      const ownVotes: any[] = u?.role === "REFEREE" ? (await db().prepare("SELECT category FROM mvp_votes WHERE tournament_id=? AND referee_id=?").bind(tournament?.id || "", u.id).all()).results as any[] : [];
      return out({ enabled: settings?.enabled === 1, assistant_coach_eligible: settings?.assistant_coach_eligible !== 0, candidates, referees, voteSummary, voteProgress: { voted: Number(voted?.count || 0), total: referees.length }, votedCategories: ownVotes.map((vote) => vote.category) });
    }
    if (path === "seed")
      return permit(u, ["ADMIN"])
        ? out(await seed())
        : out({ error: "Forbidden" }, 403);
    if (parts[0] === "files" && parts[1]) {
      const objectKey = parts.slice(1).join("/");
      if (!/^[A-Za-z0-9._-]{1,180}$/.test(objectKey)) return out({ error: "Invalid file reference" }, 400);
      const object = await readBlob(objectKey);
      if (!object) return new NextResponse("Not found", { status: 404 });
      if (object.contentType === "application/pdf") {
        const sharedResource = (await db().prepare("SELECT id FROM links WHERE url=? AND active=1 LIMIT 1").bind(`/api/files/${objectKey}`).first()) as any;
        if (!u || (!sharedResource && u.role !== "ADMIN" && object.customMetadata?.owner !== u.id && !objectKey.startsWith(`${u.id}-`)))
          return out({ error: u ? "Forbidden" : "Unauthorized" }, u ? 403 : 401);
      }
      return new NextResponse(object.body, {
        headers: {
          "Content-Type": object.contentType || "application/octet-stream",
          ...(object.contentType === "application/pdf"
            ? { "Content-Disposition": object.contentDisposition || "attachment; filename=pcf-battle-document.pdf" }
            : object.contentDisposition
              ? { "Content-Disposition": object.contentDisposition }
              : {}),
          "Cache-Control": "private, no-store",
          ...securityHeaders,
        },
      });
    }
    if (path === "auth/me")
      return u ? out(u) : out({ error: "Unauthorized" }, 401);
    if (path === "schedule") {
      if (!permit(u, ["ADMIN"])) return out({ error: "Forbidden" }, 403);
      await ensureMvpSchema();
      const tournament: any = await db().prepare("SELECT id FROM tournaments WHERE active=1 LIMIT 1").first();
      if (!tournament) return out({ items: [] });
      await db().batch([
        db().prepare("UPDATE matches SET court='Court 1',updated_at=? WHERE tournament_id=? AND (court IS NULL OR court='' OR court!='Court 1')").bind(now(), tournament.id),
        db().prepare("UPDATE schedule_items SET court='Court 1',updated_at=? WHERE tournament_id=? AND active=1 AND (court IS NULL OR court='' OR court!='Court 1')").bind(now(), tournament.id),
      ]);
      // Repair legacy corrupt rows at the schedule boundary. These were created by
      // the old group generator before self-match validation existed.
      const corrupt = (await db().prepare("SELECT id FROM matches WHERE tournament_id=? AND home_team_id=away_team_id AND confirmed=0").bind(tournament.id).all()).results as any[];
      for (const match of corrupt) {
        await db().prepare("DELETE FROM schedule_items WHERE match_id=?").bind(match.id).run();
        await db().prepare("DELETE FROM matches WHERE id=? AND tournament_id=? AND confirmed=0").bind(match.id, tournament.id).run();
      }
      const bracket: any = await db().prepare("SELECT data FROM brackets WHERE active=1 ORDER BY created_at DESC LIMIT 1").first();
      const legacyBreaks = parseJson<{ breaks?: any[] }>(bracket?.data, {})?.breaks || [];
      const existingBreaks = new Set(((await db().prepare("SELECT id FROM schedule_items WHERE tournament_id=? AND item_type='break'").bind(tournament.id).all()).results as any[]).map((row) => row.id));
      const breakRows = legacyBreaks.filter((item: any) => item?.id && !existingBreaks.has(item.id));
      if (breakRows.length) {
        const max: any = await db().prepare("SELECT COALESCE(MAX(sort_order),-1) value FROM schedule_items WHERE tournament_id=?").bind(tournament.id).first();
        for (const [index, item] of breakRows.entries()) await db().prepare("INSERT INTO schedule_items (id,tournament_id,item_type,label,match_date,start_time,duration_minutes,sort_order,active,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)").bind(item.id,tournament.id,"break",item.label||"Break",item.match_date||null,item.time||item.start_time||null,Number(item.duration||30),Number(max?.value||-1)+index+1,1,now(),now()).run();
      }
      const missing = (await db().prepare("SELECT m.id,m.match_date,m.start_time FROM matches m LEFT JOIN schedule_items si ON si.match_id=m.id AND si.active=1 WHERE m.tournament_id=? AND si.id IS NULL").bind(tournament.id).all()).results as any[];
      if (missing.length) {
        const max: any = await db().prepare("SELECT COALESCE(MAX(sort_order),-1) value FROM schedule_items WHERE tournament_id=?").bind(tournament.id).first();
        for (const [index, match] of missing.entries()) await db().prepare("INSERT INTO schedule_items (id,tournament_id,item_type,match_id,match_date,start_time,duration_minutes,sort_order,active,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)").bind(uuid(),tournament.id,"match",match.id,match.match_date||null,match.start_time||null,20,Number(max?.value||-1)+index+1,1,now(),now()).run();
      }
      const items = (await db().prepare("SELECT si.*, CASE WHEN si.item_type='match' THEN COALESCE(m.match_date,si.match_date) ELSE si.match_date END AS match_date, CASE WHEN si.item_type='match' THEN COALESCE(m.start_time,si.start_time) ELSE si.start_time END AS start_time, CASE WHEN si.item_type='match' THEN COALESCE(m.court,si.court) ELSE si.court END AS court, m.home_team_id,m.away_team_id,m.group_id,m.status,m.confirmed FROM schedule_items si LEFT JOIN matches m ON m.id=si.match_id WHERE si.tournament_id=? AND si.active=1 ORDER BY si.sort_order,si.start_time,si.id").bind(tournament.id).all()).results;
      return out({ items });
    }
    if (parts[0] === "teams" && parts[2] === "pdf" && parts[1]) {
      if (!permit(u, ["ADMIN"])) return out({ error: "Forbidden" }, 403);
      const team: any = await db().prepare("SELECT * FROM teams WHERE id=?").bind(parts[1]).first();
      if (!team) return out({ error: "Team not found" }, 404);
      const members = await list("delegation_members", "WHERE team_id=? ORDER BY role,number,name", [team.id]);
      const rooms = (await db().prepare("SELECT r.number,r.capacity,m.name FROM room_assignments ra JOIN rooms r ON r.id=ra.room_id JOIN delegation_members m ON m.id=ra.member_id WHERE m.team_id=? ORDER BY r.number,m.name").bind(team.id).all()).results as any[];
      const lines = ["PCF BATTLE · TEAM INFORMATION", "", team.name, `Group: ${team.group_id || "-"}`, `Contact person: ${team.contact_person || "-"}`, `Email: ${team.contact_email || "-"}`, `Phone: ${team.phone || "-"}`, `WhatsApp: ${team.whatsapp || "-"}`, `Address: ${team.address || "-"}`, `Website: ${team.website || "-"}`, `Invoice requested: ${team.invoice_requested ? "Yes" : "No"}`, "", "DELEGATION OVERVIEW", ...members.map((member: any) => `${member.role}  #${member.number ?? "-"}  ${member.name}${member.dob ? `  | DOB: ${member.dob}` : ""}${member.classification_points ? `  | Classification: ${member.classification_points}` : ""}${member.player_role ? `  | Role: ${member.player_role}` : ""}`), "", "ROOM ALLOCATION", ...(rooms.length ? rooms.map((room: any) => `Room ${room.number}  ·  ${room.name}`) : ["No rooms assigned"]), "", `Generated: ${new Date().toLocaleString("en-BE")}`];
      return new NextResponse(simplePdf(lines), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${team.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-team-info.pdf"`, "Cache-Control": "private, no-store" } });
    }
    if (path === "live-state") {
      const match: any = await db().prepare("SELECT * FROM matches WHERE status='live' ORDER BY updated_at DESC LIMIT 1").first();
      if (!match) return NextResponse.json({ match: null }, { headers: { "Cache-Control": "public, max-age=0, no-cache" } });
      match.referee_ids = JSON.parse(match.referee_ids || "[]");
      return NextResponse.json({ match }, { headers: { "Cache-Control": "public, max-age=0, no-cache" } });
    }
    if (path === "scoreboard-state") {
      if (!permit(u, ["ADMIN", "SCOREBOARD"]))
        return out({ error: "Forbidden" }, 403);
      const requestedId = req.nextUrl.searchParams.get("matchId"),
        match: any = requestedId
          ? await db().prepare("SELECT * FROM matches WHERE id=?").bind(requestedId).first()
          : await db().prepare("SELECT * FROM matches WHERE status='live' ORDER BY updated_at DESC LIMIT 1").first();
      if (!match) return out({ match: null, teams: [], goals: [] });
      match.referee_ids = JSON.parse(match.referee_ids || "[]");
      const teams = await list("teams", "WHERE id IN (?,?)", [match.home_team_id, match.away_team_id]);
      const goals = (await db().prepare("SELECT ge.*,dm.name player_name,dm.number player_number,t.name team_name FROM goal_events ge JOIN delegation_members dm ON dm.id=ge.player_id JOIN teams t ON t.id=ge.team_id WHERE ge.match_id=? ORDER BY ge.created_at").bind(match.id).all()).results;
      const incidents = (await db().prepare("SELECT me.*,dm.name player_name,t.name team_name FROM match_events me LEFT JOIN delegation_members dm ON dm.id=me.player_id LEFT JOIN teams t ON t.id=me.team_id WHERE me.match_id=? AND me.type IN ('CARD','PENALTY') ORDER BY me.created_at").bind(match.id).all()).results;
      const settings = await db().prepare("SELECT match_duration_minutes,halftime_duration_minutes,scoreboard_background,scoreboard_accent,scoreboard_logo_scale,scoreboard_show_sponsors FROM tournaments WHERE id=?").bind(match.tournament_id).first();
      const sponsors = await list("links", "WHERE category='Sponsor' AND active=1 ORDER BY sort_order,title");
      return NextResponse.json({ match, teams, goals, incidents, settings, sponsors }, { headers: { "Cache-Control": "private, no-store" } });
    }
    if (path === "public-data") {
      const cached = publicDataCache;
      if (cached && cached.expiresAt > Date.now()) {
        return NextResponse.json(cached.payload, { headers: { "Cache-Control": "public, max-age=5, s-maxage=15, stale-while-revalidate=60" } });
      }
      const activeTournament: any = await db().prepare("SELECT id FROM tournaments WHERE active=1 LIMIT 1").first();
      if (activeTournament) {
        await resolveBracketProgression(activeTournament.id);
      }
      const degraded: string[] = [];
      const safe = async <T,>(name: string, request: Promise<T>, fallback: T): Promise<T> =>
        request.catch(() => { degraded.push(name); return fallback; });
      const [
        tournaments,
        teams,
        matches,
        table,
        links,
        brackets,
        schedule_items,
        referees,
        scorers,
        players,
      ] = await Promise.all([
        safe("tournaments", list("tournaments", "", [], "id,name,start_date,end_date,city,country,active,registration_mode,registration_enabled,live_enabled,show_tournament,show_referees,show_livestream,livestream_url,show_teams,show_matches,show_standings,show_brackets,show_statistics,show_about,show_gallery,gallery_url,public_message,opening_hours,hotel_name,hotel_address,venue_name,venue_address,parking_info,accessibility_info,catering_info,award_info,visitor_info,format_rules"), []),
        safe("teams", list("teams", "", [], "id,name,color,logo,team_photo,group_id"), []),
        safe("matches", db().prepare("SELECT id,tournament_id,home_team_id,away_team_id,home_score,away_score,status,confirmed,court,match_date,start_time,referee_ids,group_id,period,clock,clock_running,clock_started_at,scoreboard_mode,version,created_at,updated_at FROM matches WHERE tournament_id=(SELECT id FROM tournaments WHERE active=1 LIMIT 1) AND (home_team_id IS NULL OR away_team_id IS NULL OR home_team_id<>away_team_id)").all().then((r: any) => r.results.map((x: any) => { for (const k of ["referee_ids"]) if (typeof x[k] === "string") try { x[k] = JSON.parse(x[k]); } catch {} return x; })), []),
        safe("standings", standings(), []),
        safe("links", list("links", "", [], "id,title,url,dark_url,target_url,description,category,sort_order,active"), []),
        safe("brackets", list("brackets", "", [], "id,active,mode,data,created_at,updated_at"), []),
        safe("schedule", db().prepare("SELECT id,tournament_id,item_type,match_id,label,match_date,start_time,duration_minutes,court,sort_order,active,created_at,updated_at FROM schedule_items WHERE active=1 AND tournament_id=(SELECT id FROM tournaments WHERE active=1 LIMIT 1) ORDER BY sort_order,id").all().then((r: any) => r.results), []),
        safe("referees", db()
          .prepare(
            "SELECT id,name,country,photo,NULL team_id,'USER' source FROM users WHERE role='REFEREE' AND active=1 UNION ALL SELECT dm.id,dm.name,NULL country,dm.photo,dm.team_id,'DELEGATION' source FROM delegation_members dm WHERE dm.role='REFEREE' AND dm.id NOT IN (SELECT id FROM users) ORDER BY name",
          )
          .all()
          .then((r: any) => r.results), []),
        safe("scorers", db()
          .prepare(
            "SELECT dm.id player_id,dm.name player_name,dm.number player_number,t.id team_id,t.name team_name,t.logo team_logo,COUNT(ge.id) goals FROM goal_events ge JOIN delegation_members dm ON dm.id=ge.player_id JOIN teams t ON t.id=ge.team_id JOIN matches m ON m.id=ge.match_id WHERE m.status IN ('live','finished') GROUP BY dm.id,dm.name,dm.number,t.id,t.name,t.logo ORDER BY goals DESC,dm.name ASC",
          )
          .all()
          .then((r: any) => r.results), []),
        safe("players", db().prepare("SELECT id,team_id,name,number,photo,role,staff_role FROM delegation_members WHERE role IN ('PLAYER','COACH') OR staff_role IN ('COACH','ASSISTANT_COACH') ORDER BY team_id,number,name").all().then((r: any) => r.results), []),
      ]);
      const groupRows = (group: string) => (table as any[]).filter((row) => String(row.group_id || "").replace(/^group-/i, "").toUpperCase() === group);
      const groupA = groupRows("A"), groupB = groupRows("B");
      const expectedKnockout: Record<string, [string | undefined, string | undefined]> = {
        "KO:5a": [groupA[2]?.id, groupB[3]?.id],
        "KO:5b": [groupB[2]?.id, groupA[3]?.id],
        "KO:sf1": [groupA[0]?.id, groupB[1]?.id],
        "KO:sf2": [groupB[0]?.id, groupA[1]?.id],
      };
      for (const match of matches as any[]) {
        const expected = expectedKnockout[String(match.group_id || "")];
        if (!expected || match.status !== "scheduled" || match.confirmed || !expected[0] || !expected[1]) continue;
        if (match.home_team_id !== expected[0] || match.away_team_id !== expected[1]) {
          match.home_team_id = expected[0];
          match.away_team_id = expected[1];
          await db().prepare("UPDATE matches SET home_team_id=?,away_team_id=?,updated_at=? WHERE id=? AND status='scheduled' AND confirmed=0").bind(expected[0], expected[1], now(), match.id).run();
        }
      }
      const payload = {
        tournaments,
        teams,
        matches,
        standings: table,
        links,
        brackets,
        schedule_items,
        referees,
        scorers,
        players,
        degraded,
      };
      publicDataCache = { expiresAt: Date.now() + 5000, payload };
      return NextResponse.json(payload, { headers: { "Cache-Control": "public, max-age=5, s-maxage=15, stale-while-revalidate=60" } });
    }
    if (path === "gallery") {
      const tournament: any = await db()
          .prepare("SELECT gallery_url FROM tournaments WHERE active=1 LIMIT 1")
          .first(),
        galleryUrl = String(tournament?.gallery_url || "").trim();
      if (!galleryUrl) return out({ photos: [] });
      const source = new URL(galleryUrl);
      let items: any[] = [];
      if (
        ["script.google.com", "script.googleusercontent.com"].includes(
          source.hostname,
        )
      ) {
        const response = await fetch(source.toString(), {
          headers: { Accept: "application/json" },
          cf: { cacheTtl: 300, cacheEverything: true },
        } as RequestInit);
        if (!response.ok)
          return out({ error: "Google Drive gallery unavailable" }, 502);
        const data: any = await response.json();
        items = Array.isArray(data)
          ? data
          : Array.isArray(data.photos)
            ? data.photos
            : Array.isArray(data.files)
              ? data.files
              : [];
      } else if (source.hostname === "drive.google.com") {
        const folderId =
          source.pathname.match(/\/folders\/([A-Za-z0-9_-]+)/)?.[1] ||
          source.searchParams.get("id") ||
          "";
        if (!/^[A-Za-z0-9_-]{10,200}$/.test(folderId))
          return out({ error: "The Google Drive folder link is invalid" }, 422);
        const response = await fetch(
          `https://drive.google.com/embeddedfolderview?id=${encodeURIComponent(folderId)}#grid`,
          { cf: { cacheTtl: 300, cacheEverything: true } } as RequestInit,
        );
        if (!response.ok)
          return out({ error: "Google Drive gallery unavailable" }, 502);
        const html = await response.text(),
          matches = [
            ...html.matchAll(
              /id="entry-([A-Za-z0-9_-]+)"[\s\S]*?<div class="flip-entry-title">([\s\S]*?)<\/div>/g,
            ),
          ],
          decode = (value: string) =>
            value
              .replace(/&amp;/g, "&")
              .replace(/&quot;/g, '"')
              .replace(/&#39;/g, "'")
              .replace(/&lt;/g, "<")
              .replace(/&gt;/g, ">");
        items = matches
          .map((match) => ({
            id: match[1],
            name: decode(match[2].replace(/<[^>]+>/g, "")),
          }))
          .filter((item) => /\.(jpe?g|png|webp|gif)$/i.test(item.name));
      } else
        return out(
          {
            error: "Use a shared Google Drive folder or Google Apps Script URL",
          },
          422,
        );
      const photos = items
        .map((item: any, index: number) => {
          const rawId = String(item.id || item.fileId || ""),
            url = String(
              item.url ||
                item.imageUrl ||
                item.webContentLink ||
                item.thumbnailUrl ||
                item.thumbnailLink ||
                "",
            ),
            id =
              rawId ||
              url.match(/[?&]id=([\w-]+)/)?.[1] ||
              url.match(/\/d\/([\w-]+)/)?.[1] ||
              "";
          return id
            ? {
                id,
                name: String(
                  item.name || item.title || `Tournament photo ${index + 1}`,
                ),
                url: `/api/gallery/image?id=${encodeURIComponent(id)}&v=2`,
                thumbnailUrl: `/api/gallery/image?id=${encodeURIComponent(id)}&thumbnail=1`,
              }
            : null;
        })
        .filter(Boolean);
      return NextResponse.json({ photos }, { headers: { "Cache-Control": "public, max-age=60, s-maxage=300, stale-while-revalidate=3600" } });
    }
    if (path === "gallery/image") {
      const id = req.nextUrl.searchParams.get("id") || "";
      if (!/^[A-Za-z0-9_-]{10,200}$/.test(id))
        return new NextResponse("Invalid image", { status: 400 });
      const thumbnail = req.nextUrl.searchParams.get("thumbnail") === "1",
        download = req.nextUrl.searchParams.get("download") === "1";
      const source = thumbnail
        ? `https://drive.google.com/thumbnail?id=${encodeURIComponent(id)}&sz=w1600`
        : `https://drive.google.com/uc?export=download&id=${encodeURIComponent(id)}`;
      const response = await fetch(source, {
          redirect: "follow",
          cf: { cacheTtl: thumbnail ? 86400 : 3600, cacheEverything: true },
        } as RequestInit),
        contentType = response.headers.get("content-type") || "";
      if (!response.ok || !contentType.startsWith("image/"))
        return new NextResponse("Image unavailable", { status: 502 });
      const headers: Record<string, string> = {
        "Content-Type": contentType,
        "Cache-Control": thumbnail
          ? "public, max-age=86400, stale-while-revalidate=604800"
          : download ? "private, no-store" : "public, max-age=3600, stale-while-revalidate=86400",
        "X-Content-Type-Options": "nosniff",
      };
      if (download)
        headers["Content-Disposition"] =
          `attachment; filename="pcf-battle-photo.${contentType.split("/")[1]?.split(";")[0] || "jpg"}"`;
      return new NextResponse(response.body, { headers });
    }
    if (path === "message-recipients") {
      if (!permit(u, ["ADMIN", "TEAM", "REFEREE"])) return out({ error: u ? "Forbidden" : "Unauthorized" }, u ? 403 : 401);
      const where =
        u.role === "ADMIN"
          ? "WHERE active=1 AND role IN ('TEAM','REFEREE')"
          : "WHERE active=1 AND role='ADMIN'";
      return out(await list("users", `${where} ORDER BY role,name`));
    }
    if (path === "messages") {
      if (!u) return out({ error: "Unauthorized" }, 401);
      const rows = (
        await db()
          .prepare(
            "SELECT m.*,su.name sender_name,su.role sender_role,ru.name recipient_name,ru.role recipient_role FROM messages m JOIN users su ON su.id=m.sender_user_id JOIN users ru ON ru.id=m.recipient_user_id WHERE (m.sender_user_id=? AND m.deleted_by_sender=0) OR (m.recipient_user_id=? AND m.deleted_by_recipient=0) ORDER BY m.created_at DESC",
          )
          .bind(u.id, u.id)
          .all()
      ).results;
      return out(rows);
    }
    if (path === "contacts") {
      if (!u) return out({ error: "Unauthorized" }, 401);
      const count =
        (
          await db()
            .prepare("SELECT COUNT(*) c FROM organization_contacts")
            .first<any>()
        )?.c || 0;
      if (!count)
        await db().batch([
          db()
            .prepare(
              "INSERT OR IGNORE INTO organization_contacts (id,name,role,email,phone,emergency,sort_order,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
            )
            .bind(
              "contact-main",
              "Tournament desk",
              "General questions",
              "info@phb.app",
              "+32 16 00 00 00",
              0,
              1,
              now(),
              now(),
            ),
          db()
            .prepare(
              "INSERT OR IGNORE INTO organization_contacts (id,name,role,email,phone,emergency,sort_order,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
            )
            .bind(
              "contact-emergency",
              "Event emergency line",
              "Urgent assistance",
              null,
              "+32 470 00 00 00",
              1,
              2,
              now(),
              now(),
            ),
        ]);
      return out(
        await list("organization_contacts", "ORDER BY sort_order,name"),
      );
    }
    if (path === "preregistrations") {
      if (!permit(u, ["ADMIN"])) return out({ error: "Forbidden" }, 403);
      return out(await db().prepare("SELECT p.*,t.name tournament_name FROM preregistrations p LEFT JOIN tournaments t ON t.id=p.tournament_id ORDER BY p.created_at DESC").all().then((r: any) => r.results));
    }
    if (path === "standings") return out(await standings());
    if (path === "goal-events") {
      const rows = (
        await db()
          .prepare(
            "SELECT ge.*,dm.name player_name,dm.number player_number,t.name team_name FROM goal_events ge JOIN delegation_members dm ON dm.id=ge.player_id JOIN teams t ON t.id=ge.team_id ORDER BY ge.created_at DESC",
          )
          .all()
      ).results;
      return out(rows);
    }
    if (parts[0] === "goal-events" && parts[1]) {
      const rows = (
        await db()
          .prepare(
            "SELECT ge.*,dm.name player_name,dm.number player_number,t.name team_name FROM goal_events ge JOIN delegation_members dm ON dm.id=ge.player_id JOIN teams t ON t.id=ge.team_id WHERE ge.match_id=? ORDER BY ge.created_at",
          )
          .bind(parts[1])
          .all()
      ).results;
      return out(rows);
    }
    if (parts[0] === "match-events" && parts[1]) {
      if (!u) return out({ error: "Unauthorized" }, 401);
      if (!(await mayViewMatch(u, parts[1])) && u.role !== "ADMIN")
        return out({ error: "Forbidden" }, 403);
      const rows = (
        await db()
          .prepare(
            "SELECT me.*,dm.name player_name,dm.number player_number,t.name team_name FROM match_events me LEFT JOIN delegation_members dm ON dm.id=me.player_id LEFT JOIN teams t ON t.id=me.team_id WHERE me.match_id=? ORDER BY me.created_at",
          )
          .bind(parts[1])
          .all()
      ).results;
      return out(rows);
    }
    if (path === "scorers") {
      const rows = (
        await db()
          .prepare(
            "SELECT dm.id player_id,dm.name player_name,dm.number player_number,t.id team_id,t.name team_name,t.logo team_logo,COUNT(ge.id) goals FROM goal_events ge JOIN delegation_members dm ON dm.id=ge.player_id JOIN teams t ON t.id=ge.team_id JOIN matches m ON m.id=ge.match_id WHERE m.status IN ('live','finished') GROUP BY dm.id,dm.name,dm.number,t.id,t.name,t.logo ORDER BY goals DESC,dm.name ASC",
          )
          .all()
      ).results;
      return out(rows);
    }
    if (path === "referees") {
      const rows = (
        await db()
          .prepare(
            "SELECT id,name,country,photo,NULL team_id,'USER' source FROM users WHERE role='REFEREE' AND active=1 UNION ALL SELECT dm.id,dm.name,NULL country,dm.photo,dm.team_id,'DELEGATION' source FROM delegation_members dm WHERE dm.role='REFEREE' AND dm.id NOT IN (SELECT id FROM users) ORDER BY name",
          )
          .all()
      ).results;
      return out(rows);
    }
    if (path === "team-selection") {
      if (!u) return out({ error: "Unauthorized" }, 401);
      const where = u.role === "TEAM" ? "AND dm.team_id=?" : "",
        values = u.role === "TEAM" ? [u.teamId] : [];
      const rows = (
        await db()
          .prepare(
            `SELECT dm.*,t.name team_name,t.logo team_logo FROM delegation_members dm JOIN teams t ON t.id=dm.team_id WHERE dm.role='PLAYER' ${where} ORDER BY t.name,dm.number,dm.name`,
          )
          .bind(...values)
          .all()
      ).results;
      return out(rows);
    }
    if (path === "rooms") {
      if (!u) return out({ error: "Unauthorized" }, 401);
      const rooms: any[] = await list(
          "rooms",
          u.role === "TEAM"
            ? "WHERE team_id=? ORDER BY number"
            : "ORDER BY number",
          u.role === "TEAM" ? [u.teamId] : [],
        ),
        where = u.role === "TEAM" ? "WHERE m.team_id=?" : "",
        values = u.role === "TEAM" ? [u.teamId] : [],
        a = (
          await db()
            .prepare(
              `SELECT ra.room_id,ra.member_id,m.name,m.team_id FROM room_assignments ra JOIN delegation_members m ON m.id=ra.member_id ${where}`,
            )
            .bind(...values)
            .all()
        ).results;
      return out(
        rooms.map((r) => ({
          ...r,
          assignments: a.filter((x: any) => x.room_id === r.id),
        })),
      );
    }
    if (path === "audit")
      return permit(u, ["ADMIN"])
        ? out(await list("audit_log", "ORDER BY created_at DESC LIMIT 100"))
        : out({ error: "Forbidden" }, 403);
    if (path === "admin/backup") {
      if (!permit(u, ["ADMIN"])) return out({ error: "Forbidden" }, 403);
      const tables = ["tournaments", "teams", "users", "delegation_members", "rooms", "room_assignments", "matches", "goal_events", "match_events", "payments", "groups", "brackets", "schedule_items", "links", "organization_contacts", "preregistrations", "audit_log"];
      const data: Record<string, any[]> = {};
      for (const table of tables) data[table] = await list(table);
      const backup = { exported_at: now(), format: "PCF_BATTLE_BACKUP_V1", data };
      return out({ ...backup, checksum: await sha(JSON.stringify(backup)) });
    }
    if (path === "tournament-checks") {
      if (!permit(u, ["ADMIN"])) return out({ error: "Forbidden" }, 403);
      await ensureScheduleSchema();
      const tournament: any = await db().prepare("SELECT * FROM tournaments WHERE active=1 LIMIT 1").first(),
        teams: any[] = await list("teams", "ORDER BY name"),
        matches: any[] = await list("matches", tournament ? "WHERE tournament_id=?" : "WHERE 1=0", tournament ? [tournament.id] : []),
        scheduleItems: any[] = tournament ? await list("schedule_items", "WHERE tournament_id=? AND active=1 ORDER BY sort_order", [tournament.id]) : [],
        members: any[] = await list("delegation_members"),
        issues: string[] = [];
      if (!tournament) issues.push("No public tournament edition is active");
      if (teams.length !== 8) issues.push(`${teams.length}/8 participating teams configured`);
      for (const group of ["A", "B"]) {
        const count = teams.filter((team: any) => String(team.group_id || "").replace("group-", "").toUpperCase() === group).length;
        if (count !== 4) issues.push(`Group ${group} contains ${count}/4 teams`);
      }
      for (const team of teams) {
        const players = members.filter((member: any) => member.team_id === team.id && member.role === "PLAYER");
        if (!players.length) issues.push(`${team.name} has no players`);
        if (!team.logo) issues.push(`${team.name} has no logo`);
        if (members.some((member: any) => member.team_id === team.id && !member.privacy_consent)) issues.push(`${team.name} has delegation members without privacy consent`);
      }
      const groupMatches = matches.filter((match: any) => ["A", "B", "group-A", "group-B"].includes(String(match.group_id)));
      if (groupMatches.length !== 12) issues.push(`${groupMatches.length}/12 required group matches configured`);
      const scheduledMatchIds = new Set(scheduleItems.filter((item: any) => item.item_type === "match" && item.match_id).map((item: any) => item.match_id));
      const unscheduledMatches = matches.filter((match: any) => match.status !== "cancelled" && !scheduledMatchIds.has(match.id));
      if (unscheduledMatches.length) issues.push(`${unscheduledMatches.length} match${unscheduledMatches.length === 1 ? "" : "es"} missing from the schedule`);
      const scheduleConflicts = tournament ? await validateScheduleItems(tournament.id, scheduleItems) : [];
      for (const conflict of scheduleConflicts.slice(0, 10)) issues.push(conflict.message);
      const bracket: any = tournament ? await db().prepare("SELECT data FROM brackets WHERE active=1 LIMIT 1").first() : null;
      if (matches.some((match: any) => String(match.group_id || "").toLowerCase().startsWith("ko:")) && !bracket) issues.push("Knockout matches exist without an active bracket");
      const pairs = new Set<string>();
      matches.forEach((match: any, index: number) => {
        const pair = [match.home_team_id, match.away_team_id].sort().join("|");
        if (pairs.has(pair) && ["A", "B", "group-A", "group-B"].includes(String(match.group_id))) issues.push(`${match.start_time || "TBD"}: duplicate group pairing`);
        pairs.add(pair);
        if ((match.referee_ids || []).length !== 2) issues.push(`${match.start_time || "TBD"}: two referees required`);
        matches.slice(index + 1).forEach((other: any) => {
          if (!match.start_time || match.start_time !== other.start_time || (match.match_date || "") !== (other.match_date || "")) return;
          if (match.court && match.court === other.court) issues.push(`${match.start_time}: ${match.court} is double-booked`);
          if ([match.home_team_id, match.away_team_id].some((id: string) => [other.home_team_id, other.away_team_id].includes(id))) issues.push(`${match.start_time}: a team is scheduled twice`);
        });
      });
      return out({ ready: issues.length === 0, issues: [...new Set(issues)], counts: { teams: teams.length, matches: matches.length } });
    }
    if (path === "stats") {
      if (!permit(u, ["ADMIN"])) return out({ error: "Forbidden" }, 403);
      const stats: any = {};
      for (const t of ["teams", "matches", "delegation_members", "rooms"])
        stats[t] =
          (await db().prepare(`SELECT COUNT(*) c FROM ${t}`).first<any>())?.c ||
          0;
      stats.goals =
        (
          await db()
            .prepare(
              "SELECT COALESCE(SUM(home_score+away_score),0) c FROM matches WHERE status='finished'",
            )
            .first<any>()
        )?.c || 0;
      return out(stats);
    }
    if (path === "my-team") {
      if (!permit(u, ["TEAM"])) return out({ error: "Forbidden" }, 403);
      const [memberResult, roomResult, pricing, teamResult, matchResult] = await Promise.all([
        db().prepare("SELECT * FROM delegation_members WHERE team_id=?").bind(u.teamId).all(),
        db().prepare("SELECT ra.room_id,ra.member_id,r.number,m.name FROM room_assignments ra JOIN rooms r ON r.id=ra.room_id JOIN delegation_members m ON m.id=ra.member_id WHERE m.team_id=?").bind(u.teamId).all(),
        db().prepare("SELECT fixed_tournament_costs,single_room_supplement FROM tournaments WHERE active=1 LIMIT 1").first(),
        db().prepare("SELECT * FROM teams WHERE id=?").bind(u.teamId).first(),
        db().prepare("SELECT * FROM matches WHERE home_team_id=? OR away_team_id=?").bind(u.teamId, u.teamId).all(),
      ]);
      const members = memberResult.results as any[];
      const roomRows = roomResult.results as any[];
      const occupantsByRoom = new Map<string, number>();
      for (const room of roomRows) occupantsByRoom.set(room.room_id, (occupantsByRoom.get(room.room_id) || 0) + 1);
      const singleRooms = [...occupantsByRoom.values()].filter((occupants) => occupants === 1).length;
      const roomCost = roomRows.length * Number(pricing?.fixed_tournament_costs || 0) + singleRooms * Number(pricing?.single_room_supplement || 0);
      return out({
        team: teamResult,
        members,
        matches: matchResult.results,
        rooms: roomRows,
        roomCost,
      });
    }
    if (path === "team-review") {
      if (!u || !permit(u, ["ADMIN", "TEAM"])) return out({ error: "Forbidden" }, 403);
      const requestedTeam = new URL(req.url).searchParams.get("team_id") || u.teamId;
      if (u.role === "TEAM" && requestedTeam !== u.teamId) return out({ error: "Forbidden" }, 403);
      const review = await buildTeamReview(String(requestedTeam || ""));
      return review ? out(review) : out({ error: "Team not found" }, 404);
    }
    if (path === "team-onboarding") {
      if (!u || !permit(u, ["ADMIN", "TEAM"])) return out({ error: "Forbidden" }, 403);
      const requestedTeam = new URL(req.url).searchParams.get("team_id") || u.teamId;
      if (u.role === "TEAM" && requestedTeam !== u.teamId) return out({ error: "Forbidden" }, 403);
      const status = await buildOnboardingStatus(String(requestedTeam || ""));
      return status ? out(status) : out({ error: "Team not found" }, 404);
    }
    if (path === "team-onboardings") {
      if (!permit(u, ["ADMIN"])) return out({ error: "Forbidden" }, 403);
      const teams = (await db().prepare("SELECT id FROM teams ORDER BY name").all()).results as { id: string }[];
      const statuses = await buildOnboardingStatuses(teams.map((team) => team.id));
      return out(statuses);
    }
    if (path === "team-reviews") {
      if (!permit(u, ["ADMIN"])) return out({ error: "Forbidden" }, 403);
      const teams = (await db().prepare("SELECT id,name,review_status,review_snapshot,team_reviewed_at,admin_reviewed_at,review_message,withdrawal_reason,contact_person,contact_email,phone,whatsapp,address,address_street,address_number,address_postal_code,address_city,address_country FROM teams ORDER BY name").all()).results as any[];
      return out(teams);
    }
    if (path === "finance") {
      if (!u || !permit(u, ["ADMIN", "TEAM"])) return out({ error: "Forbidden" }, 403);
      await ensureFinanceSchema();
      const settings: any = await db().prepare("SELECT * FROM finance_settings WHERE id='default'").first();
      if (settings && (!settings.final_due_days || settings.final_due_days === 90)) settings.final_due_days = 30;
      const where = u.role === "TEAM" ? "WHERE i.team_id=?" : "";
      const invoices: any[] = (await db().prepare(`SELECT i.*,t.name team_name FROM invoices i LEFT JOIN teams t ON t.id=i.team_id ${where} ORDER BY i.issued_at DESC`).bind(...(u.role === "TEAM" ? [u.teamId] : [])).all()).results as any[];
      invoices.forEach((invoice) => {
        if (invoice.invoice_type === "BALANCE" && invoice.issued_at) {
          invoice.due_at = new Date(
            new Date(invoice.issued_at).getTime() +
              Number(settings?.final_due_days || 30) * 86400000,
          )
            .toISOString()
            .slice(0, 10);
        }
      });
      const payments: any[] = (await db().prepare(`SELECT p.*,i.invoice_number FROM finance_payments p JOIN invoices i ON i.id=p.invoice_id ${u.role === "TEAM" ? "WHERE p.team_id=?" : ""} ORDER BY p.received_at DESC`).bind(...(u.role === "TEAM" ? [u.teamId] : [])).all()).results as any[];
      const costs: any[] = await list("payments", u.role === "TEAM" ? "WHERE team_id=? ORDER BY due_date,created_at" : "ORDER BY due_date,created_at", u.role === "TEAM" ? [u.teamId] : []);
      return out({ settings, invoices, payments, costs });
    }
    const table = mapName(parts[0]);
    if (resources[table]) {
      if (table === "delegation_members" && !u)
        return out({ error: "Unauthorized" }, 401);
      if (
        ["users", "payments", "invites"].includes(table) &&
        !permit(u, ["ADMIN"])
      )
        return out({ error: "Forbidden" }, 403);
      if (
        u?.role === "TEAM" &&
        ["teams", "delegation_members", "payments"].includes(table)
      )
        return out(
          await list(table, `WHERE ${table === "teams" ? "id" : "team_id"}=?`, [
            u.teamId,
          ]),
        );
      if (u?.role === "REFEREE" && table === "matches")
        return out(
          await list(table, "WHERE referee_ids LIKE ?", [`%${u.id}%`]),
        );
      const rows = await list(table);
      if (table !== "matches") return out(rows);
      const referees = await list("users", "WHERE role='REFEREE' AND active=1");
      const delegationReferees = await list("delegation_members", "WHERE role='REFEREE'");
      const officials = [...referees, ...delegationReferees];
      return out(rows.map((match: any) => ({ ...match, referee_names: (match.referee_ids || []).map((id: string) => officials.find((referee: any) => referee.id === id)?.name).filter(Boolean) })));
    }
    return out({ error: "Not found" }, 404);
  } catch (error: unknown) {
    logServerError(req, error);
    return out({ error: "The requested data is temporarily unavailable. Please try again." }, 503);
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ path?: string[] }> },
) {
  if (!acceptsMutation(req)) return out({ error: "Cross-site request blocked" }, 403);
  const parts = (await params).path || [],
    path = parts.join("/"),
    contentLength = Number(req.headers.get("content-length") || 0);
  if (path !== "uploads" && contentLength > MAX_JSON_BODY_BYTES) return out({ error: "Request body is too large" }, 413);
  const body: any = path === "uploads" ? {} : await req.json().catch(() => ({})),
    u = (await session(req)) as SessionUser;
  try {
    if (parts[0] === "teams" && parts[2] === "confirmation" && parts[1]) {
      if (!u || !permit(u, ["ADMIN", "TEAM"])) return out({ error: u ? "Forbidden" : "Unauthorized" }, u ? 403 : 401);
      if (u.role === "TEAM" && u.teamId !== parts[1]) return out({ error: "You can only confirm your own team" }, 403);
      const kind = body.kind === "rooms" ? "rooms" : "delegation",
        confirmed = body.confirmed ? 1 : 0,
        prefix = kind === "rooms" ? "rooms" : "delegation";
      if (!confirmed && u.role !== "ADMIN") return out({ error: "Only the organization can unlock a confirmation" }, 403);
      await ensureScheduleSchema();
      const exists: any = await db().prepare("SELECT id FROM teams WHERE id=?").bind(parts[1]).first();
      if (!exists) return out({ error: "Team not found" }, 404);
      await db().prepare(`UPDATE teams SET ${prefix}_confirmed=?,${prefix}_confirmed_at=?,${prefix}_confirmed_by=?,updated_at=? WHERE id=?`).bind(confirmed, confirmed ? now() : null, confirmed ? u.id : null, now(), parts[1]).run();
      await log(u, confirmed ? "CONFIRM" : "UNLOCK", `team_${kind}`, parts[1]);
      return out({ ok: true, kind, confirmed });
    }
    if (path === "team-review/confirm") {
      if (!u || u.role !== "TEAM" || !u.teamId) return out({ error: "Only a team account can submit this review" }, 403);
      const review = await buildTeamReview(String(u.teamId));
      if (!review) return out({ error: "Team not found" }, 404);
      if (review.issues.length) return out({ error: "Complete all required information before submitting", issues: review.issues }, 422);
      const snapshot = JSON.stringify({ team: review.team, members: review.members, rooms: review.rooms, pricing: review.pricing, confirmed_at: now(), confirmed_by: u.id });
      await db().prepare("UPDATE teams SET review_status='awaiting_admin',review_snapshot=?,team_reviewed_at=?,team_reviewed_by=?,review_message=NULL,updated_at=? WHERE id=?").bind(snapshot, now(), u.id, now(), u.teamId).run();
      await log(u, "TEAM_REVIEW_SUBMITTED", "team", String(u.teamId), { total: review.pricing.total });
      return out({ ok: true, status: "awaiting_admin", total: review.pricing.total });
    }
    if (path === "matches/assign-referees") {
      if (!permit(u, ["ADMIN"])) return out({ error: "Forbidden" }, 403);
      const tournament: any = await db().prepare("SELECT id FROM tournaments WHERE active=1 LIMIT 1").first();
      if (!tournament) return out({ error: "No active tournament" }, 409);
      const officials = (await db().prepare("SELECT id,wheelchair_user FROM delegation_members WHERE role='REFEREE' ORDER BY name").all()).results as any[];
      if (officials.length < 2) return out({ error: "At least two referees are required" }, 422);
      const matches = (await db().prepare("SELECT id,referee_ids FROM matches WHERE tournament_id=? ORDER BY match_date,start_time,id").bind(tournament.id).all()).results as any[];
      const assignments: { id: string; referee_ids: string[] }[] = [];
      for (const match of matches) {
        const shuffled = [...officials].sort(() => Math.random() - 0.5);
        const selected = shuffled.find((first) => {
          const second = shuffled.find((candidate) => candidate.id !== first.id && !(first.wheelchair_user && candidate.wheelchair_user));
          return Boolean(second);
        });
        if (!selected) continue;
        const second = shuffled.find((candidate) => candidate.id !== selected.id && !(selected.wheelchair_user && candidate.wheelchair_user));
        if (!second) continue;
        const ids = [selected.id, second.id];
        await db().prepare("UPDATE matches SET referee_ids=?,updated_at=? WHERE id=?").bind(JSON.stringify(ids), now(), match.id).run();
        assignments.push({ id: match.id, referee_ids: ids });
      }
      await log(u, "RANDOM_REFEREES_ASSIGNED", "tournament", tournament.id, { count: assignments.length });
      return out({ ok: true, assignments });
    }
    if (path === "team-review/withdraw") {
      if (!u || u.role !== "TEAM" || !u.teamId) return out({ error: "Only a team account can withdraw its review" }, 403);
      const team: any = await db().prepare("SELECT review_status FROM teams WHERE id=?").bind(u.teamId).first();
      if (!team) return out({ error: "Team not found" }, 404);
      if (team.review_status !== "awaiting_admin") return out({ error: "This review can no longer be withdrawn" }, 409);
      await db().prepare("UPDATE teams SET review_status='information_incomplete',review_snapshot=NULL,approved_snapshot=NULL,team_reviewed_at=NULL,team_reviewed_by=NULL,admin_reviewed_at=NULL,admin_reviewed_by=NULL,review_message=NULL,withdrawal_reason=?,updated_at=? WHERE id=?").bind(String(body.reason || "Review withdrawn by team."), now(), u.teamId).run();
      await log(u, "TEAM_REVIEW_WITHDRAWN", "team", String(u.teamId));
      return out({ ok: true, status: "information_incomplete" });
    }
    if (path === "team-review/admin") {
      if (!permit(u, ["ADMIN"])) return out({ error: "Forbidden" }, 403);
      const teamId = String(body.team_id || ""), action = String(body.action || "");
      const team: any = await db().prepare("SELECT * FROM teams WHERE id=?").bind(teamId).first();
      if (!team) return out({ error: "Team not found" }, 404);
      if (action === "reopen") {
        if (!team.review_snapshot || !["awaiting_admin", "approved_payment_open"].includes(String(team.review_status))) return out({ error: "This team has no review that can be reopened" }, 409);
        await ensureFinanceSchema();
        const payment: any = await db().prepare("SELECT id FROM finance_payments WHERE team_id=? LIMIT 1").bind(teamId).first();
        if (payment) return out({ error: "This review cannot be reopened because a payment has already been recorded" }, 409);
        await db().prepare("UPDATE invoices SET status='cancelled',updated_at=? WHERE team_id=? AND invoice_type='DEPOSIT' AND status!='paid'").bind(now(), teamId).run();
        await db().prepare("UPDATE teams SET review_status='information_incomplete',review_snapshot=NULL,approved_snapshot=NULL,team_reviewed_at=NULL,team_reviewed_by=NULL,admin_reviewed_at=NULL,admin_reviewed_by=NULL,review_message=NULL,withdrawal_reason=?,updated_at=? WHERE id=?").bind(String(body.reason || "Review withdrawn by administrator."), now(), teamId).run();
        await log(u, "ADMIN_REOPENED_TEAM_REVIEW", "team", teamId);
        return out({ ok: true, status: "information_incomplete" });
      }
      if (!team.review_snapshot || team.review_status !== "awaiting_admin") return out({ error: "Team has not submitted a review" }, 409);
      if (action === "withdraw") {
        await db().prepare("UPDATE teams SET review_status='information_incomplete',review_snapshot=NULL,approved_snapshot=NULL,team_reviewed_at=NULL,team_reviewed_by=NULL,admin_reviewed_at=NULL,admin_reviewed_by=NULL,review_message=NULL,updated_at=? WHERE id=?").bind(now(), teamId).run();
        await log(u, "ADMIN_WITHDREW_TEAM_REVIEW", "team", teamId);
        return out({ ok: true, status: "information_incomplete" });
      }
      if (action === "request_changes") {
        await db().prepare("UPDATE teams SET review_status='changes_requested',review_message=?,updated_at=? WHERE id=?").bind(String(body.message || "Please review your information."), now(), teamId).run();
        await log(u, "TEAM_REVIEW_CHANGES_REQUESTED", "team", teamId, { message: body.message });
        return out({ ok: true, status: "changes_requested" });
      }
      if (action !== "approve") return out({ error: "Choose approve or request_changes" }, 422);
      await ensureFinanceSchema();
      let approvedSnapshot: any;
      try { approvedSnapshot = JSON.parse(String(team.review_snapshot)); } catch { return out({ error: "Submitted financial snapshot is invalid" }, 409); }
      const pricing = approvedSnapshot?.pricing;
      if (!pricing || !Number.isFinite(Number(pricing.deposit))) return out({ error: "Submitted financial snapshot is incomplete" }, 409);
      const existingInvoice: any = await db().prepare("SELECT id FROM invoices WHERE team_id=? AND invoice_type='DEPOSIT' AND status!='cancelled' LIMIT 1").bind(teamId).first();
      if (!existingInvoice) {
        const settings: any = await db().prepare("SELECT deposit_due_days FROM finance_settings WHERE id='default'").first();
        const year = new Date().getUTCFullYear(), sequence: any = await db().prepare("SELECT COUNT(*) count FROM invoices WHERE invoice_number LIKE ?").bind(`PCFB-${year}-%`).first();
        const invoiceNumber = `PCFB-${year}-${String(Number(sequence?.count || 0) + 1).padStart(4, "0")}`;
        const issued = now(), due = new Date(Date.now() + Number(settings?.deposit_due_days || 30) * 86400000).toISOString().slice(0, 10), invoiceId = uuid();
        const invoiceSnapshot = JSON.stringify({ approved_snapshot: approvedSnapshot, invoice_kind: "deposit", total_participation_cost: pricing.total, deposit_percentage: pricing.depositPercentage, deposit_amount: pricing.deposit, team_name: approvedSnapshot.team?.name || team.name, billing_address: approvedSnapshot.team?.address || team.address || null });
        await db().prepare("INSERT INTO invoices (id,team_id,invoice_number,invoice_type,participant_count,unit_price,subtotal,deposit_percentage,total_amount,issued_at,due_at,status,snapshot,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(invoiceId, teamId, invoiceNumber, "DEPOSIT", approvedSnapshot.members?.length || 0, pricing.unitPrice, pricing.deposit, pricing.depositPercentage, pricing.deposit, issued, due, "issued", invoiceSnapshot, issued, issued).run();
        await log(u, "ISSUE_DEPOSIT_INVOICE", "invoice", invoiceId, { team_id: teamId, invoice_number: invoiceNumber, amount: pricing.deposit });
      }
      await db().prepare("UPDATE teams SET review_status='approved_payment_open',approved_snapshot=review_snapshot,admin_reviewed_at=?,admin_reviewed_by=?,review_message=NULL,updated_at=? WHERE id=?").bind(now(), u.id, now(), teamId).run();
      await log(u, "TEAM_REVIEW_APPROVED", "team", teamId);
      return out({ ok: true, status: "approved_payment_open" });
    }
    if (path === "finance/settings") {
      if (!permit(u, ["ADMIN"])) return out({ error: "Forbidden" }, 403);
      await ensureFinanceSchema();
      const fields = ["price_per_person","deposit_percentage","deposit_due_days","final_due_days","legal_name","address","vat_number","email","iban","bic","bank_name"];
      const values = fields.map((field) => ["price_per_person","deposit_percentage","deposit_due_days","final_due_days"].includes(field) ? Number(body[field] || 0) : String(body[field] || "").trim() || null);
      await db().prepare(`UPDATE finance_settings SET ${fields.map((field) => `${field}=?`).join(",")},updated_at=? WHERE id='default'`).bind(...values, now()).run();
      await log(u, "UPDATE", "finance_settings", "default", body);
      return out({ ok: true });
    }
    if (path === "finance/record-payment") {
      if (!permit(u, ["ADMIN"])) return out({ error: "Forbidden" }, 403);
      const invoiceId = String(body.invoice_id || ""), amount = roundMoney(Number(body.amount));
      if (!invoiceId || !Number.isFinite(amount) || amount <= 0) return out({ error: "Invoice and a positive amount are required" }, 422);
      await ensureFinanceSchema();
      const idempotencyKey = String(body.idempotency_key || req.headers.get("Idempotency-Key") || "").trim();
      if (!idempotencyKey || idempotencyKey.length > 128) return out({ error: "A valid payment request key is required" }, 422);
      const existingPayment: any = await db().prepare("SELECT id,invoice_id FROM finance_payments WHERE idempotency_key=? LIMIT 1").bind(idempotencyKey).first();
      if (existingPayment) {
        const existingPaid: any = await db().prepare("SELECT COALESCE(SUM(amount),0) total FROM finance_payments WHERE invoice_id=?").bind(existingPayment.invoice_id).first();
        const existingInvoice: any = await db().prepare("SELECT total_amount FROM invoices WHERE id=?").bind(existingPayment.invoice_id).first();
        return out({ ok: true, duplicate: true, payment_id: existingPayment.id, paid: roundMoney(Number(existingPaid?.total || 0)), outstanding: roundMoney(Math.max(0, Number(existingInvoice?.total_amount || 0) - Number(existingPaid?.total || 0))) });
      }
      const invoice: any = await db().prepare("SELECT * FROM invoices WHERE id=?").bind(invoiceId).first();
      if (!invoice) return out({ error: "Invoice not found" }, 404);
      const paymentId = uuid();
      const timestamp = now();
      const payment = db().prepare("INSERT INTO finance_payments (id,invoice_id,team_id,amount,method,reference,received_at,note,idempotency_key,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)").bind(paymentId, invoiceId, invoice.team_id, amount, "BANK_TRANSFER", String(body.reference || "").trim() || null, body.received_at || timestamp, String(body.note || "").trim() || null, idempotencyKey, timestamp, timestamp);
      const paid: any = await db().prepare("SELECT COALESCE(SUM(amount),0) total FROM finance_payments WHERE invoice_id=?").bind(invoiceId).first();
      const paidTotal = roundMoney(Number(paid?.total || 0) + amount), status = paidTotal >= roundMoney(Number(invoice.total_amount)) ? "paid" : "partially_paid";
      try {
        await db().batch([payment, db().prepare("UPDATE invoices SET status=?,updated_at=? WHERE id=?").bind(status, timestamp, invoiceId)]);
      } catch (error) {
        // A concurrent administrator may have won the same idempotency key.
        // Return the existing result instead of reporting a misleading failure.
        if (/unique|constraint/i.test(String(error instanceof Error ? error.message : error))) {
          const concurrent: any = await db().prepare("SELECT id,invoice_id FROM finance_payments WHERE idempotency_key=? LIMIT 1").bind(idempotencyKey).first();
          if (concurrent) {
            const currentPaid: any = await db().prepare("SELECT COALESCE(SUM(amount),0) total FROM finance_payments WHERE invoice_id=?").bind(concurrent.invoice_id).first();
            const currentInvoice: any = await db().prepare("SELECT total_amount FROM invoices WHERE id=?").bind(concurrent.invoice_id).first();
            return out({ ok: true, duplicate: true, payment_id: concurrent.id, paid: roundMoney(Number(currentPaid?.total || 0)), outstanding: roundMoney(Math.max(0, Number(currentInvoice?.total_amount || 0) - Number(currentPaid?.total || 0))) });
          }
        }
        throw error;
      }
      if (invoice.invoice_type === "DEPOSIT" && paidTotal >= roundMoney(Number(invoice.total_amount))) {
        const existingBalance: any = await db().prepare("SELECT id FROM invoices WHERE team_id=? AND invoice_type='BALANCE' AND status!='cancelled' LIMIT 1").bind(invoice.team_id).first();
        if (!existingBalance) {
          let snapshot: any = {};
          try { snapshot = JSON.parse(String(invoice.snapshot || "{}")); } catch { snapshot = {}; }
          const approved = snapshot.approved_snapshot || {}, pricing = approved.pricing || {}, balanceAmount = roundMoney(Number(pricing.balance || 0));
          if (balanceAmount > 0) {
            const settings: any = await db().prepare("SELECT final_due_days FROM finance_settings WHERE id='default'").first();
            const balanceId = uuid(), balanceNumber = `${invoice.invoice_number}-BAL`, due = new Date(Date.now() + Number(settings?.final_due_days || 30) * 86400000).toISOString().slice(0, 10);
            await db().prepare("INSERT INTO invoices (id,team_id,invoice_number,invoice_type,participant_count,unit_price,subtotal,deposit_percentage,total_amount,issued_at,due_at,status,snapshot,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(balanceId, invoice.team_id, balanceNumber, "BALANCE", invoice.participant_count, invoice.unit_price, balanceAmount, invoice.deposit_percentage, balanceAmount, timestamp, due, "issued", invoice.snapshot, timestamp, timestamp).run();
          }
        }
      }
      return out({ ok: true, payment_id: paymentId, paid: paidTotal, outstanding: roundMoney(Math.max(0, Number(invoice.total_amount) - paidTotal)) }, 201);
    }
    if (path === "finance/reset") {
      if (!permit(u, ["ADMIN"])) return out({ error: u ? "Forbidden" : "Unauthorized" }, u ? 403 : 401);
      await ensureFinanceSchema();
      const password = String(body.password || "");
      const admins = (await db().prepare("SELECT password FROM users WHERE role='ADMIN' AND active=1").all()).results as Array<{ password?: string }>;
      const valid = await Promise.all(admins.map((admin) => verifyPassword(password, String(admin.password || ""))));
      if (!valid.some(Boolean)) return out({ error: "Admin password is incorrect" }, 403);
      const paymentRows: any = await db().prepare("SELECT COUNT(*) count FROM finance_payments").first();
      const invoiceRows: any = await db().prepare("SELECT COUNT(*) count FROM invoices").first();
      const legacyRows: any = await db().prepare("SELECT COUNT(*) count FROM payments").first();
      await db().batch([
        db().prepare("DELETE FROM finance_payments"),
        db().prepare("DELETE FROM invoices"),
        db().prepare("DELETE FROM payments"),
      ]);
      await log(u, "RESET_FINANCE", "finance", "all", { financePayments: Number(paymentRows?.count || 0), invoices: Number(invoiceRows?.count || 0), legacyPayments: Number(legacyRows?.count || 0) });
      return out({ ok: true, deleted: { financePayments: Number(paymentRows?.count || 0), invoices: Number(invoiceRows?.count || 0), legacyPayments: Number(legacyRows?.count || 0) } });
    }
    if (path === "finance/issue") {
      if (!permit(u, ["ADMIN"])) return out({ error: "Forbidden" }, 403);
      await ensureFinanceSchema();
      const teamId = String(body.team_id || ""), team: any = await db().prepare("SELECT * FROM teams WHERE id=?").bind(teamId).first();
      if (!team) return out({ error: "Team not found" }, 404);
      if (team.review_status !== "approved_payment_open" || !team.approved_snapshot) return out({ error: "Team review must be approved before payment can be opened" }, 409);
      let approved: any;
      try { approved = JSON.parse(String(team.approved_snapshot)); } catch { return out({ error: "Approved financial snapshot is invalid" }, 409); }
      const pricing = approved?.pricing;
      if (!pricing || !Number.isFinite(Number(pricing.total))) return out({ error: "Approved financial snapshot is incomplete" }, 409);
      const participantCount = Number(pricing.participantCount || approved.members?.length || 0), unitPrice = Number(pricing.unitPrice), singleRoomSupplement = Number(pricing.singleSupplement || 0), singleRoomCount = Number(pricing.singleRoomCount || 0), participationSubtotal = Number(pricing.participantSubtotal), accommodationSupplement = Number(pricing.accommodationSupplement || 0), total = Number(pricing.total), depositPercentage = Number(pricing.depositPercentage || 30);
      const year = new Date().getUTCFullYear(), seq: any = await db().prepare("SELECT COUNT(*) count FROM invoices WHERE invoice_number LIKE ?").bind(`PCFB-${year}-%`).first(), number = `PCFB-${year}-${String(Number(seq?.count || 0) + 1).padStart(4, "0")}`, id = uuid(), issued = now(), snapshot = JSON.stringify({ approved_snapshot: approved, participant_count: participantCount, unit_price: unitPrice, participation_subtotal: participationSubtotal, single_room_supplement: singleRoomSupplement, single_room_count: singleRoomCount, accommodation_supplement: accommodationSupplement, subtotal: total, deposit_percentage: depositPercentage, team_name: approved.team?.name || team.name, billing_address: approved.team?.address || team.address || null });
      await db().prepare("INSERT INTO invoices (id,team_id,invoice_number,invoice_type,participant_count,unit_price,subtotal,deposit_percentage,total_amount,issued_at,due_at,status,snapshot,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(id, teamId, number, String(body.invoice_type || "PARTICIPATION"), participantCount, unitPrice, total, depositPercentage, total, issued, body.due_at || null, "issued", snapshot, issued, issued).run();
      await log(u, "ISSUE_INVOICE", "invoice", id, { invoice_number: number, team_id: teamId, total });
      return out({ id, invoice_number: number }, 201);
    }
    if (path === "mvp/settings") {
      if (!permit(u, ["ADMIN"])) return out({ error: "Forbidden" }, 403);
      await ensureMvpSchema();
      const tournament: any = await db().prepare("SELECT id FROM tournaments WHERE active=1 LIMIT 1").first();
      await db().prepare("INSERT INTO mvp_settings (tournament_id,enabled,assistant_coach_eligible) VALUES (?,?,?) ON CONFLICT(tournament_id) DO UPDATE SET enabled=excluded.enabled,assistant_coach_eligible=excluded.assistant_coach_eligible").bind(tournament.id, body.enabled ? 1 : 0, body.assistant_coach_eligible === false ? 0 : 1).run();
      return out({ ok: true });
    }
    if (path === "mvp/reset") {
      if (!permit(u, ["ADMIN"])) return out({ error: u ? "Forbidden" : "Unauthorized" }, u ? 403 : 401);
      await ensureMvpSchema();
      const password = String(body.password || "");
      const admins = (await db().prepare("SELECT password FROM users WHERE role='ADMIN' AND active=1").all()).results as Array<{ password?: string }>;
      const valid = await Promise.all(admins.map((admin) => verifyPassword(password, String(admin.password || ""))));
      if (!valid.some(Boolean)) return out({ error: "Admin password is incorrect" }, 403);
      const tournament: any = await db().prepare("SELECT id FROM tournaments WHERE active=1 LIMIT 1").first();
      if (!tournament) return out({ error: "No active tournament" }, 422);
      await db().prepare("DELETE FROM mvp_votes WHERE tournament_id=?").bind(tournament.id).run();
      await log(u, "RESET", "mvp_votes", tournament.id);
      return out({ ok: true });
    }
    if (path === "mvp/vote") {
      if (!permit(u, ["REFEREE"])) return out({ error: u ? "Only referees can vote" : "Unauthorized" }, u ? 403 : 401);
      await ensureMvpSchema();
      const tournament: any = await db().prepare("SELECT id FROM tournaments WHERE active=1 LIMIT 1").first();
      const settings: any = await db().prepare("SELECT * FROM mvp_settings WHERE tournament_id=?").bind(tournament?.id || "").first();
      if (!settings?.enabled) return out({ error: "MVP voting is not open" }, 409);
      const category = String(body.category || ""), candidateId = String(body.candidate_id || "");
      const allowed: any = category === "BEST_REFEREE"
        ? await db().prepare("SELECT id FROM users WHERE id=? AND role='REFEREE' AND active=1 UNION ALL SELECT id FROM delegation_members WHERE id=? AND member_type='REFEREE'").bind(candidateId, candidateId).first()
        : await db().prepare("SELECT id FROM delegation_members WHERE id=? AND member_type IN ('PLAYER','STAFF')").bind(candidateId).first();
      if (!allowed || !["BEST_KEEPER","BEST_T_STICK","BEST_HANDSTICK_UNDER_3","BEST_HANDSTICK_3_PLUS","BEST_COACH","BEST_REFEREE"].includes(category)) return out({ error: "Invalid MVP candidate" }, 422);
      const existing: any = await db().prepare("SELECT id FROM mvp_votes WHERE tournament_id=? AND referee_id=? AND category=?").bind(tournament.id, u.id, category).first();
      if (existing) return out({ error: "You have already voted in this category" }, 409);
      await db().prepare("INSERT INTO mvp_votes (id,tournament_id,referee_id,category,candidate_id,created_at) VALUES (?,?,?,?,?,?)").bind(uuid(), tournament.id, u.id, category, candidateId, now()).run();
      return out({ ok: true });
    }
    if (path === "admin/backup/validate") {
      if (!permit(u, ["ADMIN"])) return out({ error: "Forbidden" }, 403);
      const requiredTables = ["tournaments", "teams", "matches", "users", "audit_log"],
        issues = requiredTables.filter((table) => !body?.data || !Array.isArray(body.data[table])).map((table) => `Missing table: ${table}`),
        valid = body?.format === "PCF_BATTLE_BACKUP_V1" && issues.length === 0;
      return out({ valid, issues });
    }
    if (path === "schedule/items") {
      if (!permit(u, ["ADMIN"])) return out({ error: "Forbidden" }, 403);
      await ensureScheduleSchema();
      const tournament: any = await db().prepare("SELECT id FROM tournaments WHERE active=1 LIMIT 1").first();
      if (!tournament) return out({ error: "No active tournament" }, 422);
      const id = uuid();
      const max: any = await db().prepare("SELECT COALESCE(MAX(sort_order),-1) value FROM schedule_items WHERE tournament_id=?").bind(tournament.id).first();
      await db().prepare("INSERT INTO schedule_items (id,tournament_id,item_type,label,match_date,start_time,duration_minutes,court,sort_order,active,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)").bind(id,tournament.id,String(body.item_type || "break"),String(body.label || "Break"),body.match_date || null,body.start_time || null,Number(body.duration_minutes || 15),body.court || null,Number(max?.value || -1)+1,1,now(),now()).run();
      return out({ id }, 201);
    }
    if (parts[0] === "matches" && parts[2] === "confirm" && parts[1]) {
      if (!permit(u, ["ADMIN", "SCOREBOARD"])) return out({ error: "Forbidden" }, 403);
      await db().prepare("UPDATE matches SET confirmed=1,status='finished',clock_running=0,updated_at=? WHERE id=?").bind(now(), parts[1]).run();
      const confirmed: any = await db().prepare("SELECT tournament_id FROM matches WHERE id=?").bind(parts[1]).first();
      if (confirmed?.tournament_id) await resolveBracketProgression(confirmed.tournament_id);
      await log(u, "CONFIRM", "match", parts[1]);
      return out({ ok: true });
    }
    if (parts[0] === "matches" && parts[2] === "unlock" && parts[1]) {
      if (!permit(u, ["ADMIN", "SCOREBOARD"])) return out({ error: "Forbidden" }, 403);
      const admins = (await db().prepare("SELECT password FROM users WHERE role='ADMIN' AND active=1").all()).results as any[];
      const valid = await Promise.all(admins.map((admin) => verifyPassword(String(body.password || ""), admin.password)));
      if (!valid.some(Boolean)) return out({ error: "Admin password is incorrect" }, 403);
      await db().prepare("UPDATE matches SET confirmed=0,updated_at=? WHERE id=?").bind(now(), parts[1]).run();
      await log(u, "UNLOCK", "match", parts[1]);
      return out({ ok: true });
    }
    if (path === "preregister") {
      const t: any = await db()
        .prepare("SELECT * FROM tournaments WHERE active=1 LIMIT 1")
        .first();
      if (!t || t.registration_mode !== 1 || t.registration_enabled === 0)
        return out({ error: "Registrations are currently closed" }, 403);
      const clubName = String(body.club_name || "").trim(),
        email = String(body.email || "")
          .trim()
          .toLowerCase();
      if (clubName.length < 2 || !/^\S+@\S+\.\S+$/.test(email))
        return out({ error: "Enter a club name and valid email address" }, 422);
      if (body.terms_accepted !== true)
        return out({ error: "You must accept the Terms & Conditions before registering" }, 422);
      try {
        const id = uuid();
        await db()
          .prepare(
            "INSERT INTO preregistrations (id,tournament_id,club_name,email,created_at) VALUES (?,?,?,?,?)",
          )
          .bind(id, t.id, clubName, email, now())
          .run();
        const emailSent = await sendEmail(email, "Registration received — PCF BATTLE", registrationEmail(clubName));
        if (emailSent) await db().prepare("UPDATE preregistrations SET registration_confirmation_sent_at=? WHERE id=?").bind(now(), id).run();
        return out({ ok: true, id, emailSent }, 201);
      } catch (e: any) {
        if (String(e.message).includes("UNIQUE"))
          return out({ error: "This email is already registered" }, 409);
        throw e;
      }
    }
    if (parts[0] === "preregistrations" && parts[2] === "select" && parts[1]) {
      if (!permit(u, ["ADMIN"])) return out({ error: "Forbidden" }, 403);
      const row: any = await db().prepare("SELECT * FROM preregistrations WHERE id=?").bind(parts[1]).first();
      if (!row) return out({ error: "Registration not found" }, 404);
      if (row.selection_email_sent_at) return out({ error: "The selection email has already been sent" }, 409);
      const sent = await sendEmail(row.email, "Your team has been selected — PCF BATTLE", registrationEmail(row.club_name, true));
      if (!sent) return out({ error: "Email could not be sent. Check the email service configuration." }, 502);
      try { await db().prepare("ALTER TABLE preregistrations ADD COLUMN waiting_list integer DEFAULT 0").run(); } catch {}
      await db().prepare("UPDATE preregistrations SET selected=1,waiting_list=0,selection_email_sent_at=? WHERE id=?").bind(now(), row.id).run();
      await log(u, "SEND_SELECTION_EMAIL", "preregistration", row.id, { email: row.email });
      return out({ ok: true, emailSent: true });
    }
    if (parts[0] === "preregistrations" && parts[2] === "waiting-list" && parts[1]) {
      if (!permit(u, ["ADMIN"])) return out({ error: "Forbidden" }, 403);
      try { await db().prepare("ALTER TABLE preregistrations ADD COLUMN waiting_list integer DEFAULT 0").run(); } catch {}
      const row: any = await db().prepare("SELECT * FROM preregistrations WHERE id=?").bind(parts[1]).first();
      if (!row) return out({ error: "Registration not found" }, 404);
      if (row.selected || row.selection_email_sent_at) return out({ error: "This team has already been selected" }, 409);
      const sent = await sendEmail(row.email, "Update on your PCF BATTLE registration", registrationEmail(row.club_name, false, true));
      if (!sent) return out({ error: "Email could not be sent. Check the email service configuration." }, 502);
      await db().prepare("UPDATE preregistrations SET waiting_list=1 WHERE id=?").bind(row.id).run();
      await log(u, "SEND_NON_SELECTION_EMAIL", "preregistration", row.id, { email: row.email });
      return out({ ok: true, emailSent: true });
    }
    if (parts[0] === "preregistrations" && parts[2] === "invite" && parts[1]) {
      if (!permit(u, ["ADMIN"])) return out({ error: "Forbidden" }, 403);
      const row: any = await db().prepare("SELECT * FROM preregistrations WHERE id=?").bind(parts[1]).first();
      if (!row || !(row.selected || row.selection_email_sent_at)) return out({ error: "Select this team before creating an invite" }, 409);
      if (row.portal_invitation_sent_at) return out({ error: "The portal invitation has already been sent" }, 409);
      let team: any = await db().prepare("SELECT * FROM teams WHERE lower(name)=lower(?) LIMIT 1").bind(row.club_name).first();
      if (!team) {
        team = { id: uuid(), name: row.club_name, color: "#ec4899" };
        await db().prepare("INSERT INTO teams (id,name,contact_person,color,created_at,updated_at) VALUES (?,?,?,?,?,?)").bind(team.id, team.name, null, team.color, now(), now()).run();
      }
      const code = secureToken(10), id = uuid(), expires = new Date(Date.now() + 604800000).toISOString();
      await db().prepare("INSERT INTO invites (id,code,team_id,recipient_email,used,expires_at,created_at) VALUES (?,?,?,?,?,?,?)").bind(id, code, team.id, row.email, 0, expires, now()).run();
      const emailSent = await sendEmail(row.email, "Your invitation to Powerchair Floorball Battle", teamInviteEmail(new URL(req.url).origin, code));
      if (!emailSent) { await db().prepare("DELETE FROM invites WHERE id=?").bind(id).run(); return out({ error: "Email could not be sent. Check the email service configuration." }, 502); }
      await db().prepare("UPDATE preregistrations SET portal_invitation_sent_at=?,selected=1 WHERE id=?").bind(now(), row.id).run();
      await log(u, "SEND_PORTAL_INVITE", "preregistration", row.id, { teamId: team.id, inviteId: id });
      return out({ ok: true, emailSent: true, inviteId: id, teamId: team.id });
    }
    if (path === "auth/login") {
      const email = String(body.email || "").trim().toLowerCase(),
        password = String(body.password || "");
      const
        ip = req.headers.get("cf-connecting-ip") || "unknown",
        identifier = await sha(`${email}|${ip}`),
        attempt: any = await db()
          .prepare("SELECT attempts,locked_until FROM login_attempts WHERE identifier=?")
          .bind(identifier)
          .first();
      if (attempt?.locked_until && new Date(attempt.locked_until).getTime() > Date.now())
        return out({ error: "Too many login attempts. Try again in 15 minutes." }, 429);
      const row = await db()
        .prepare("SELECT * FROM users WHERE email=? AND active=1")
        .bind(email)
        .first<any>();
      if (
        !row ||
        !(await verifyPassword(password, row.password))
      ) {
        const attempts = Number(attempt?.attempts || 0) + 1,
          lockedUntil = attempts >= 5 ? new Date(Date.now() + 15 * 60 * 1000).toISOString() : null;
        await db()
          .prepare("INSERT INTO login_attempts (identifier,attempts,locked_until,updated_at) VALUES (?,?,?,?) ON CONFLICT(identifier) DO UPDATE SET attempts=excluded.attempts,locked_until=excluded.locked_until,updated_at=excluded.updated_at")
          .bind(identifier, attempts >= 5 ? 0 : attempts, lockedUntil, now())
          .run();
        return out({ error: "Invalid email or password" }, 401);
      }
      await db().prepare("DELETE FROM login_attempts WHERE identifier=?").bind(identifier).run();
      let sessionVersion = row.updated_at;
      if (!String(row.password).startsWith("pbkdf2$"))
        {
        sessionVersion = now();
        await db()
          .prepare("UPDATE users SET password=?,updated_at=? WHERE id=?")
          .bind(await hashPassword(String(body.password)), sessionVersion, row.id)
          .run();
        }
      const user = {
          id: row.id,
          email: row.email,
          role: row.role,
          name: row.name,
          teamId: row.team_id,
          sv: sessionVersion,
          exp: Date.now() + 86400000,
        },
        payload = pack(user),
        token = `${payload}.${await sign(payload)}`;
      const res = out({ user });
      res.cookies.set("phb_token", token, {
        httpOnly: true,
        secure: true,
        sameSite: "lax",
        path: "/",
        maxAge: 86400,
      });
      return res;
    }
    if (path === "uploads") {
      if (!permit(u, ["ADMIN", "TEAM", "REFEREE"])) return out({ error: u ? "Forbidden" : "Unauthorized" }, u ? 403 : 401);
      const form = await req.formData(),
        file = form.get("file");
      if (!(file instanceof File) || !file.size)
        return out({ error: "Choose a file to upload" }, 422);
      if (file.size > 20 * 1024 * 1024)
        return out({ error: "File must be 20 MB or smaller" }, 413);
      if (!(file.type.startsWith("image/") || file.type === "application/pdf") || !(await hasAllowedFileSignature(file)))
        return out({ error: "Only valid images and PDF files are supported" }, 415);
      const clean = file.name.replace(/[^a-zA-Z0-9._-]/g, "-").slice(-80),
        key = `${u.id}-${uuid()}-${clean}`;
      const blobConfigured = Boolean(
        process.env.BLOB_READ_WRITE_TOKEN ||
          process.env.BLOB_STORE_ID ||
          process.env.VERCEL_OIDC_TOKEN,
      );
      if (!blobConfigured) return out({ error: "File storage is not available" }, 503);
      await writeBlob(key, file.stream(), file.type, u.id);
      return out(
        {
          url: `/api/files/${key}`,
          name: file.name,
          type: file.type,
          size: file.size,
        },
        201,
      );
    }
    if (path === "auth/logout") {
      const res = out({ ok: true });
      res.cookies.delete("phb_token");
      return res;
    }
    if (path === "auth/change-password") {
      if (!u) return out({ error: "Unauthorized" }, 401);
      if (
        !body.currentPassword ||
        !body.newPassword ||
        String(body.newPassword).length < 8
      )
        return out(
          {
            error:
              "A current password and a new password of at least 8 characters are required",
          },
          422,
        );
      const row: any = await db()
        .prepare("SELECT password FROM users WHERE id=?")
        .bind(u.id)
        .first();
      if (
        !row ||
        !(await verifyPassword(String(body.currentPassword), row.password))
      )
        return out({ error: "Current password is incorrect" }, 403);
      await db()
        .prepare("UPDATE users SET password=?,updated_at=? WHERE id=?")
        .bind(await hashPassword(String(body.newPassword)), now(), u.id)
        .run();
      await log(u, "CHANGE_PASSWORD", "user", u.id);
      return out({ ok: true });
    }
    if (path === "seed") {
      if (!permit(u, ["ADMIN"])) return out({ error: "Forbidden" }, 403);
      if (body.force) {
        const password = String(body.password || ""), admin: any = await db().prepare("SELECT password FROM users WHERE id=? AND role='ADMIN' AND active=1").bind(u.id).first();
        if (!password || !admin || !(await verifyPassword(password, String(admin.password || "")))) return out({ error: "Admin password is incorrect" }, 403);
      }
      return out(await seed(Boolean(body.force), u.id));
    }
    if (path === "scoreboard-settings") {
      if (!permit(u, ["ADMIN", "SCOREBOARD"])) return out({ error: "Forbidden" }, 403);
      const tournament: any = await db().prepare("SELECT id FROM tournaments WHERE active=1 LIMIT 1").first();
      if (!tournament) return out({ error: "No active tournament" }, 404);
      const matchDuration = Math.min(60, Math.max(1, Number(body.match_duration_minutes || 30))),
        halftimeDuration = Math.min(30, Math.max(1, Number(body.halftime_duration_minutes || 5))),
        logoScale = Math.min(120, Math.max(60, Number(body.scoreboard_logo_scale || 100))),
        color = (value: any, fallback: string) => /^#[0-9a-f]{6}$/i.test(String(value || "")) ? String(value) : fallback;
      await db().prepare("UPDATE tournaments SET match_duration_minutes=?,halftime_duration_minutes=?,scoreboard_background=?,scoreboard_accent=?,scoreboard_logo_scale=?,scoreboard_show_sponsors=?,updated_at=? WHERE id=?")
        .bind(matchDuration, halftimeDuration, color(body.scoreboard_background, "#100d12"), color(body.scoreboard_accent, "#f72585"), logoScale, body.scoreboard_show_sponsors ? 1 : 0, now(), tournament.id).run();
      await log(u, "UPDATE_SCOREBOARD_SETTINGS", "tournament", tournament.id, body);
      return out({ ok: true });
    }
    if (path === "scoreboard-mode") {
      if (!permit(u, ["ADMIN", "SCOREBOARD"])) return out({ error: "Forbidden" }, 403);
      const matchId = String(body.match_id || ""),
        mode = String(body.mode || "");
      if (!matchId || !["scoreboard", "sponsors", "black"].includes(mode))
        return out({ error: "Choose a valid screen mode" }, 422);
      const result = await db().prepare("UPDATE matches SET scoreboard_mode=?,version=version+1,updated_at=? WHERE id=?")
        .bind(mode, now(), matchId).run();
      if (!result.meta.changes) return out({ error: "Match not found" }, 404);
      await log(u, "UPDATE_SCOREBOARD_MODE", "match", matchId, { mode });
      return out({ ok: true, mode });
    }
    if (/^tournaments\/[^/]+\/activate$/.test(path)) {
      if (!permit(u, ["ADMIN"])) return out({ error: "Forbidden" }, 403);
      const tournamentId = parts[1],
        tournament: any = await db()
          .prepare("SELECT id FROM tournaments WHERE id=?")
          .bind(tournamentId)
          .first();
      if (!tournament) return out({ error: "Tournament edition not found" }, 404);
      const timestamp = now();
      await db().batch([
        db().prepare("UPDATE tournaments SET active=0,updated_at=? WHERE active=1").bind(timestamp),
        db().prepare("UPDATE tournaments SET active=1,updated_at=? WHERE id=?").bind(timestamp, tournamentId),
      ]);
      await log(u, "ACTIVATE", "tournament", tournamentId);
      return out({ ok: true });
    }
    if (path === "goal-events") {
      const matchId = String(body.match_id || ""),
        teamId = String(body.team_id || ""),
        playerId = String(body.player_id || "");
      if (!(await mayControlMatch(u, matchId)))
        return out({ error: "Forbidden" }, 403);
      const match: any = await db()
        .prepare("SELECT * FROM matches WHERE id=?")
        .bind(matchId)
        .first();
      if (match?.confirmed) return out({ error: "This match is confirmed and locked" }, 423);
      if (!match || ![match.home_team_id, match.away_team_id].includes(teamId))
        return out({ error: "Team is not playing in this match" }, 422);
      const player: any = await db()
        .prepare(
          "SELECT id,name,team_id,role FROM delegation_members WHERE id=?",
        )
        .bind(playerId)
        .first();
      if (!player || player.team_id !== teamId || player.role !== "PLAYER")
        return out({ error: "Choose a player from the scoring team" }, 422);
      const id = uuid(),
        scoreColumn =
          teamId === match.home_team_id ? "home_score" : "away_score",
        ts = now();
      await db().batch([
        db()
          .prepare(
            "INSERT INTO goal_events (id,match_id,team_id,player_id,period,clock,created_by,created_at) VALUES (?,?,?,?,?,?,?,?)",
          )
          .bind(
            id,
            matchId,
            teamId,
            playerId,
            body.period || match.period || null,
            body.clock || match.clock || null,
            u.id,
            ts,
          ),
        db()
          .prepare(
            `UPDATE matches SET ${scoreColumn}=${scoreColumn}+1,version=version+1,updated_at=? WHERE id=?`,
          )
          .bind(ts, matchId),
      ]);
      await log(u, "GOAL", "match", matchId, {
        goalEventId: id,
        teamId,
        playerId,
        playerName: player.name,
      });
      return out({ id, player_name: player.name }, 201);
    }
    if (path === "match-events") {
      const matchId = String(body.match_id || ""),
        type = String(body.type || "").toUpperCase();
      if (!(await mayControlMatch(u, matchId))) return out({ error: "Forbidden" }, 403);
      const locked: any = await db().prepare("SELECT confirmed FROM matches WHERE id=?").bind(matchId).first();
      if (locked?.confirmed) return out({ error: "This match is confirmed and locked" }, 423);
      if (!["CARD", "PENALTY", "NOTE"].includes(type)) return out({ error: "Choose card, penalty or note" }, 422);
      const id = uuid();
      await db().prepare("INSERT INTO match_events (id,match_id,team_id,player_id,type,period,clock,details,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)")
        .bind(id, matchId, body.team_id || null, body.player_id || null, type, body.period || null, body.clock || null, String(body.details || "").trim() || null, u.id, now()).run();
      await log(u, `MATCH_${type}`, "match", matchId, { eventId: id, teamId: body.team_id, playerId: body.player_id, details: body.details });
      return out({ id }, 201);
    }
    if (path === "chat") {
      const question = String(body.message || "").trim(),
        q = question.toLowerCase(),
        language = "en",
        t: any = (await list("tournaments", "WHERE active=1 LIMIT 1"))[0] || {};
      if (q.includes("standing") || q.includes("stand"))
        return out({
          answer: `Current leader: ${(await standings())[0]?.name || "not decided yet"}.`,
        });
      if (q.includes("live"))
        return out({
          answer:
            t.live_enabled === 0
              ? "Live match coverage is currently disabled."
              : `${(await list("matches", "WHERE status='live'")).length} match is live now.`,
        });
      const facts = [
        t.start_date && `Tournament dates: ${t.start_date}${t.end_date ? ` to ${t.end_date}` : ""}`,
        (t.city || t.country) && `Location: ${[t.city, t.country].filter(Boolean).join(", ")}`,
        t.opening_hours,
        t.hotel_name && `Hotel: ${t.hotel_name}, ${t.hotel_address || ""}`,
        t.venue_name && `Venue: ${t.venue_name}, ${t.venue_address || ""}`,
        t.parking_info,
        t.accessibility_info,
        t.catering_info,
        t.award_info,
        t.visitor_info,
        t.chatbot_knowledge,
      ]
        .filter(Boolean)
        .join("\n");
      const words = q.split(/\W+/).filter((w: string) => w.length > 3),
        lines = facts.split(/\n+/).filter(Boolean),
        match = lines.find((line: string) =>
          words.some((w: string) => line.toLowerCase().includes(w)),
        );
      return out({
        answer:
          match ||
          (q.includes("rule") || q.includes("regel")
            ? "Win 3, draw 1, loss 0. Ties use goal difference, then goals for."
            : "I could not find that in the tournament information yet. Please contact the organisation at hello@pcfbattle.be for further assistance."),
      });
    }
    if (path === "messages") {
      if (!u) return out({ error: "Unauthorized" }, 401);
      const recipient: any = await db()
        .prepare("SELECT id,email,name,role,active FROM users WHERE id=?")
        .bind(body.recipient_user_id)
        .first();
      if (!recipient?.active) return out({ error: "Recipient not found" }, 404);
      if (u.role === "ADMIN" && !["TEAM", "REFEREE"].includes(recipient.role))
        return out({ error: "Admin can message teams and referees" }, 403);
      if (u.role !== "ADMIN" && recipient.role !== "ADMIN")
        return out(
          { error: "Teams and referees can only message the organization" },
          403,
        );
      const subject = String(body.subject || "").trim(),
        message = String(body.body || "").trim();
      if (!subject || !message)
        return out({ error: "Subject and message are required" }, 422);
      const id = uuid();
      await db()
        .prepare(
          "INSERT INTO messages (id,sender_user_id,recipient_user_id,subject,body,read_at,deleted_by_sender,deleted_by_recipient,created_at) VALUES (?,?,?,?,?,?,?,?,?)",
        )
        .bind(id, u.id, recipient.id, subject, message, null, 0, 0, now())
        .run();
      const safe = (s: string) =>
        s.replace(
          /[&<>\"]/g,
          (c) =>
            ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '\"': "&quot;" })[c] ||
            c,
        );
      const emailSent = await sendEmail(
        recipient.email,
        `PCF BATTLE: ${subject}`,
        `<div style="font-family:Arial,sans-serif;padding:28px;line-height:1.55"><h1 style="color:#ec4899">PCF BATTLE</h1><p><strong>New message from ${safe(u.name || "A team member")}</strong></p><h2>${safe(subject)}</h2><p>${safe(message).replace(/\n/g, "<br>")}</p><p style="color:#666">Sign in to PCF BATTLE to reply.</p></div>`,
      );
      await log(u, "SEND", "message", id, {
        recipient: recipient.id,
        emailSent,
      });
      return out({ id, emailSent }, 201);
    }
    if (path === "contacts") {
      if (!permit(u, ["ADMIN"])) return out({ error: "Forbidden" }, 403);
      await ensureScheduleSchema();
      const name = String(body.name || "").trim(),
        phone = String(body.phone || "").trim();
      const whatsapp = String(body.whatsapp || "").trim(),
        email = String(body.email || "").trim();
      if (!name || (!phone && !whatsapp && !email))
        return out({ error: "Name and at least one contact method are required" }, 422);
      const id = uuid();
      await db()
        .prepare("INSERT INTO organization_contacts (id,name,role,email,phone,whatsapp,emergency,sort_order,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)")
        .bind(
          id,
          name,
          body.role || null,
          email || null,
          phone || null,
          whatsapp || null,
          body.emergency ? 1 : 0,
          Number(body.sort_order || 0),
          now(),
          now(),
        )
        .run();
      await log(u, "CREATE", "organization_contact", id, body);
      return out({ id, ...body }, 201);
    }
    if (path === "rooms/assign") {
      if (!permit(u, ["ADMIN", "TEAM"]))
        return out({ error: "Forbidden" }, 403);
      const member = await db()
        .prepare("SELECT team_id FROM delegation_members WHERE id=?")
        .bind(body.memberId)
        .first<any>();
      if (!member) return out({ error: "Member not found" }, 404);
      if (u.role === "TEAM" && member.team_id !== u.teamId)
        return out({ error: "You can only assign your own delegation" }, 403);
      if (!body.roomId) {
        await db().prepare("DELETE FROM room_assignments WHERE member_id=?").bind(body.memberId).run();
        await syncAccommodation(member.team_id);
        await log(u, "UNASSIGN_ROOM", "room", body.memberId, body);
        return out({ ok: true, roomId: null });
      }
      const room = await db()
          .prepare("SELECT * FROM rooms WHERE id=?")
          .bind(body.roomId)
          .first<any>(),
        existing = await db()
          .prepare("SELECT room_id FROM room_assignments WHERE member_id=?")
          .bind(body.memberId)
          .first<any>(),
        count =
          (
            await db()
              .prepare(
                "SELECT COUNT(*) c FROM room_assignments WHERE room_id=?",
              )
              .bind(body.roomId)
              .first<any>()
          )?.c || 0;
      if (
        !room ||
        room.locked ||
        (room.team_id && room.team_id !== member.team_id) ||
        (count >= room.capacity && existing?.room_id !== body.roomId)
      )
        return out(
          {
            error: "Room is not allocated to this team, is locked, or is full",
          },
          409,
        );
      if (!room.team_id)
        await db()
          .prepare("UPDATE rooms SET team_id=?,updated_at=? WHERE id=?")
          .bind(member.team_id, now(), room.id)
          .run();
      await db()
        .prepare(
          "INSERT INTO room_assignments VALUES (?,?,?,?,?) ON CONFLICT(member_id) DO UPDATE SET room_id=excluded.room_id,updated_at=excluded.updated_at",
        )
        .bind(uuid(), body.roomId, body.memberId, now(), now())
        .run();
      await syncAccommodation(member.team_id);
      await log(u, "ASSIGN_ROOM", "room", body.roomId, body);
      return out({ ok: true });
    }
    if (/^payments\/[^/]+\/remind$/.test(path)) {
      if (!permit(u, ["ADMIN"])) return out({ error: "Forbidden" }, 403);
      const payment: any = await db()
        .prepare(
          "SELECT p.*,t.name team_name FROM payments p LEFT JOIN teams t ON t.id=p.team_id WHERE p.id=?",
        )
        .bind(parts[1])
        .first();
      const recipient: any = payment?.team_id
        ? await db()
            .prepare(
              "SELECT email FROM users WHERE team_id=? AND role='TEAM' LIMIT 1",
            )
            .bind(payment.team_id)
            .first()
        : null;
      const emailSent = await sendEmail(
        recipient?.email,
        "PCF BATTLE payment reminder",
        `<div style="font-family:Arial;padding:28px"><h1 style="color:#ec4899">PCF BATTLE</h1><p>This is a reminder that ${payment?.description || "your tournament payment"} of €${payment?.amount || 0} is still marked ${payment?.status || "pending"}.</p></div>`,
      );
      await db()
        .prepare(
          "UPDATE payments SET last_reminder_at=?,updated_at=? WHERE id=?",
        )
        .bind(now(), now(), parts[1])
        .run();
      await log(u, "SEND_REMINDER", "payment", parts[1], { emailSent });
      return out({
        ok: true,
        emailSent,
        message: emailSent
          ? "Reminder email sent"
          : "Reminder recorded; email service is not configured",
      });
    }
    if (path === "invites/verify") {
      const invite = await db()
        .prepare(
          "SELECT i.*,t.name team_name FROM invites i LEFT JOIN teams t ON t.id=i.team_id WHERE i.code=? AND i.used=0 AND (i.expires_at IS NULL OR i.expires_at>?)",
        )
        .bind(body.code, now())
        .first();
      return invite
        ? out({ valid: true, team_id: invite.team_id, team_name: invite.team_name, recipient_email: invite.recipient_email, expires_at: invite.expires_at })
        : out({ error: "Invalid or expired invite" }, 404);
    }
    if (path === "invites/redeem") {
      const invite: any = await db()
        .prepare(
          "SELECT * FROM invites WHERE code=? AND used=0 AND (expires_at IS NULL OR expires_at>?)",
        )
        .bind(body.code, now())
        .first();
      if (!invite) return out({ error: "Invalid or expired invite" }, 404);
      const email = String(body.email || "").trim().toLowerCase();
      const name = String(body.name || "").trim();
      const password = String(body.password || "");
      if (!email || !password || !name)
        return out({ error: "Name, email and password are required" }, 422);
      if (password.length < 8)
        return out({ error: "Choose a password of at least 8 characters" }, 422);
      const existing: any = await db().prepare("SELECT id,team_id FROM users WHERE lower(email)=?").bind(email).first();
      if (existing) {
        const canAttach = existing.team_id === invite.team_id || String(invite.recipient_email || "").trim().toLowerCase() === email;
        if (!canAttach) return out({ error: "An account already exists with this email address. Please use another email or sign in." }, 409);
        await db().batch([
          db().prepare("UPDATE users SET password=?,role='TEAM',name=?,team_id=?,active=1,updated_at=? WHERE id=?").bind(await hashPassword(password), name, invite.team_id, now(), existing.id),
          db().prepare("UPDATE invites SET used=1 WHERE id=?").bind(invite.id),
          db().prepare("UPDATE teams SET contact_person=COALESCE(NULLIF(contact_person,''),?),updated_at=? WHERE id=?").bind(name, now(), invite.team_id),
        ]);
        return out({ ok: true, existingAccount: true });
      }
      const uid = uuid();
      await db().batch([
        db()
          .prepare(
            "INSERT INTO users (id,email,password,role,name,team_id,country,photo,active,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
          )
          .bind(
            uid,
            email,
            await hashPassword(password),
            "TEAM",
            name,
            invite.team_id,
            null,
            null,
            1,
            now(),
            now(),
          ),
        db().prepare("UPDATE invites SET used=1 WHERE id=?").bind(invite.id),
        db().prepare("UPDATE teams SET contact_person=COALESCE(NULLIF(contact_person,''),?),updated_at=? WHERE id=?").bind(name, now(), invite.team_id),
      ]);
      return out({ ok: true });
    }
    if (/^invites\/[^/]+\/resend$/.test(path)) {
      if (!permit(u, ["ADMIN"])) return out({ error: "Forbidden" }, 403);
      const invite: any = await db()
        .prepare("SELECT * FROM invites WHERE id=?")
        .bind(parts[1])
        .first();
      const origin = new URL(req.url).origin;
      const emailSent = await sendEmail(
        invite?.recipient_email,
        "Your invitation to Powerchair Floorball Battle",
        invite ? teamInviteEmail(origin, invite.code) : "",
      );
      if (emailSent) await db().prepare("UPDATE preregistrations SET portal_invitation_sent_at=? WHERE lower(email)=lower(?) AND selection_email_sent_at IS NOT NULL").bind(now(), invite?.recipient_email || "").run();
      await log(u, "RESEND", "invite", parts[1], { emailSent });
      return out({
        ok: true,
        emailSent,
        message: emailSent
          ? "Invite email sent"
          : "Invite resend recorded; email service is not configured",
      });
    }
    if (path === "groups/generate-schedule") {
      if (!permit(u, ["ADMIN"])) return out({ error: "Forbidden" }, 403);
      const tournament: any = await db().prepare("SELECT * FROM tournaments WHERE active=1 LIMIT 1").first();
      const groupRows: any[] = tournament ? (await db().prepare("SELECT * FROM groups WHERE tournament_id=? ORDER BY name").bind(tournament.id).all()).results as any[] : [];
      if (!tournament || !groupRows.length) return out({ error: "Create groups and assign teams first" }, 422);
      const dates = Array.isArray(body.dates) && body.dates.length ? body.dates : [tournament.start_date || now().slice(0, 10)];
      const gameMinutes = Math.max(1, Number(body.game_minutes || tournament.match_duration_minutes || 30));
      const pauseMinutes = Math.max(0, Number(body.pause_minutes ?? 10));
      const startMinutes = timeToMinutes(body.start_time || "09:00");
      const endMinutes = Math.max(startMinutes + gameMinutes, timeToMinutes(body.end_time || "18:00"));
      const times: string[] = [];
      for (let minute = startMinutes; minute + gameMinutes <= endMinutes; minute += gameMinutes + pauseMinutes) times.push(`${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`);
      if (!times.length) return out({ error: "The playing window is shorter than one game" }, 422);
      const courts = ["Court 1"];
      const slots = times.map((time: string) => ({ date: dates[0], time }));
      const firstDay = dates[0];
      await db().batch([
        db().prepare("UPDATE matches SET match_date=?,updated_at=? WHERE tournament_id=? AND status='scheduled' AND confirmed=0 AND upper(replace(group_id,'group-','')) IN ('A','B')").bind(firstDay, now(), tournament.id),
        db().prepare("UPDATE schedule_items SET match_date=?,updated_at=? WHERE tournament_id=? AND active=1 AND match_id IN (SELECT id FROM matches WHERE tournament_id=? AND status='scheduled' AND confirmed=0 AND upper(replace(group_id,'group-','')) IN ('A','B'))").bind(firstDay, now(), tournament.id, tournament.id),
      ]);
      const existing: any[] = (await db().prepare("SELECT * FROM matches WHERE tournament_id=?").bind(tournament.id).all()).results as any[];
      for (const match of existing) if (match.home_team_id && match.home_team_id === match.away_team_id && match.status === "scheduled" && !match.confirmed) {
        await db().prepare("DELETE FROM schedule_items WHERE match_id=?").bind(match.id).run();
        await db().prepare("DELETE FROM matches WHERE id=? AND tournament_id=?").bind(match.id, tournament.id).run();
      }
      const validExisting = existing.filter((match) => match.home_team_id !== match.away_team_id && !(match.status === "scheduled" && !match.confirmed && match.home_team_id === match.away_team_id));
      const created: string[] = [];
      const occupied = new Set<string>();
      const teamReady = new Map<string, number>();
      const minimumRest = Math.max(0, Number(tournament.schedule_min_rest_minutes ?? 10));
      validExisting.forEach((match) => {
        if (match.match_date && match.start_time && match.court) occupied.add(`${match.match_date}|${match.start_time}|${match.court}`);
        if (match.match_date && match.start_time) {
          const ready = timeToMinutes(match.start_time) + gameMinutes + minimumRest;
          for (const team of [match.home_team_id, match.away_team_id].filter(Boolean)) teamReady.set(`${match.match_date}|${team}`, Math.max(teamReady.get(`${match.match_date}|${team}`) || 0, ready));
        }
      });
      const allTeams: any[] = (await db().prepare("SELECT id,group_id FROM teams").all()).results as any[];
      const plans = groupRows.map((group) => {
        const groupName = String(group.name).replace(/^group-/i, "").toUpperCase();
        const saved = parseJson(group.team_ids, []).filter(Boolean);
        const assigned = allTeams.filter((team) => String(team.group_id || "").replace(/^group-/i, "").toUpperCase() === groupName).map((team) => team.id);
        const ids = [...new Set([...assigned, ...saved])].filter(Boolean);
        return { group, rounds: makeRoundRobin(ids) };
      });
      let slotIndex = 0;
      for (let roundIndex = 0; roundIndex < Math.max(...plans.map((plan) => plan.rounds.length)); roundIndex++) {
        let lastUsedSlot = slotIndex;
        for (let groupIndex = 0; groupIndex < plans.length; groupIndex++) {
          const plan = plans[groupIndex], group = plan.group, round = plan.rounds[roundIndex] || [];
          for (let gameIndex = 0; gameIndex < round.length; gameIndex++) {
            const game = round[gameIndex], pair = [game.home, game.away].sort().join("|");
            if (validExisting.some((match) => match.group_id === group.name && [match.home_team_id, match.away_team_id].sort().join("|") === pair)) continue;
            let candidate = slotIndex, courtIndex = -1;
            while (candidate < slots.length) {
              const slot = slots[candidate];
              const readyAt = Math.max(teamReady.get(`${slot.date}|${game.home}`) || 0, teamReady.get(`${slot.date}|${game.away}`) || 0);
              if (timeToMinutes(slot.time) < readyAt) { candidate++; continue; }
              courtIndex = courts.findIndex((court: string) => !occupied.has(`${slots[candidate].date}|${slots[candidate].time}|${court}`));
              if (courtIndex >= 0) break;
              candidate++;
            }
            if (!slots[candidate]) return out({ error: "Not enough playing slots and courts for all group matches", created: created.length }, 422);
              const slot = slots[candidate], court = courts[courtIndex], id = uuid();
            occupied.add(`${slot.date}|${slot.time}|${court}`);
            const readyAt = timeToMinutes(slot.time) + gameMinutes + minimumRest;
            teamReady.set(`${slot.date}|${game.home}`, readyAt);
            teamReady.set(`${slot.date}|${game.away}`, readyAt);
            await db().prepare("INSERT INTO matches (id,tournament_id,home_team_id,away_team_id,home_score,away_score,status,confirmed,court,match_date,start_time,referee_ids,group_id,period,clock,clock_running,scoreboard_mode,version,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(id,tournament.id,game.home,game.away,0,0,"scheduled",0,court,slot.date,slot.time,"[]",group.name,"1st half",`${Math.max(1, Math.ceil(gameMinutes / 2))}:00`,0,"scoreboard",1,now(),now()).run();
            const order: any = await db().prepare("SELECT COALESCE(MAX(sort_order),-1) value FROM schedule_items WHERE tournament_id=?").bind(tournament.id).first();
            await db().prepare("INSERT INTO schedule_items (id,tournament_id,item_type,match_id,match_date,start_time,duration_minutes,court,sort_order,active,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)").bind(uuid(),tournament.id,"match",id,slot.date,slot.time,gameMinutes,court,Number(order?.value||-1)+1,1,now(),now()).run();
            created.push(id);
            lastUsedSlot = Math.max(lastUsedSlot, candidate);
          }
        }
        // Mix every group into the same round, then leave one full slot for rest.
        slotIndex = lastUsedSlot + 2;
      }
      await log(u, "GENERATE", "group_schedule", tournament.id, { created: created.length });
      return out({ ok: true, created: created.length }, 201);
    }
    if (path === "knockout/generate") {
      if (!permit(u, ["ADMIN"])) return out({ error: "Forbidden" }, 403);
      const tournament: any = await db().prepare("SELECT * FROM tournaments WHERE active=1 LIMIT 1").first();
      if (!tournament) return out({ error: "No active tournament" }, 409);
      const groupA = await groupStandingsFor(tournament.id, "A"), groupB = await groupStandingsFor(tournament.id, "B");
      const confirmedGroupMatches: any[] = (await list("matches", "WHERE tournament_id=? AND upper(replace(group_id,'group-','')) IN ('A','B') AND status='finished' AND confirmed=1", [tournament.id])) as any[];
      const complete = groupA.length === 4 && groupB.length === 4 && confirmedGroupMatches.length === 12 && [...groupA, ...groupB].every((team) => team.played === 3);
      const label = (group: any[], position: number, name: string) => complete ? group[position - 1]?.name || `${position}th Group ${name}` : `${position}th Group ${name}`;
      const data = {
          ready: complete,
          message: complete ? "Final group positions assigned" : "Complete and confirm every group match to assign teams",
          championship: [
            { key: "KO:sf1", a: label(groupA, 1, "A"), b: label(groupB, 2, "B"), dependencies: [{ type: "GROUP_POSITION", group: "A", position: 1 }, { type: "GROUP_POSITION", group: "B", position: 2 }] },
            { key: "KO:sf2", a: label(groupB, 1, "B"), b: label(groupA, 2, "A"), dependencies: [{ type: "GROUP_POSITION", group: "B", position: 1 }, { type: "GROUP_POSITION", group: "A", position: 2 }] },
          ],
          consolation: [
            { key: "KO:5a", a: label(groupA, 3, "A"), b: label(groupB, 4, "B"), dependencies: [{ type: "GROUP_POSITION", group: "A", position: 3 }, { type: "GROUP_POSITION", group: "B", position: 4 }] },
            { key: "KO:5b", a: label(groupB, 3, "B"), b: label(groupA, 4, "A"), dependencies: [{ type: "GROUP_POSITION", group: "B", position: 3 }, { type: "GROUP_POSITION", group: "A", position: 4 }] },
          ],
          finals: [
            { key: "KO:7th", title: "7th / 8th place final", a: "Loser Intermediate 1", b: "Loser Intermediate 2", dependencies: [{ type: "MATCH_LOSER", match: "KO:5a" }, { type: "MATCH_LOSER", match: "KO:5b" }] },
            { key: "KO:5th", title: "5th / 6th place final", a: "Winner Intermediate 1", b: "Winner Intermediate 2", dependencies: [{ type: "MATCH_WINNER", match: "KO:5a" }, { type: "MATCH_WINNER", match: "KO:5b" }] },
            { key: "KO:3rd", title: "3rd / 4th place final", a: "Loser Semi-Final 1", b: "Loser Semi-Final 2", dependencies: [{ type: "MATCH_LOSER", match: "KO:sf1" }, { type: "MATCH_LOSER", match: "KO:sf2" }] },
            { key: "KO:final", title: "Grand final · 1st / 2nd place", a: "Winner Semi-Final 1", b: "Winner Semi-Final 2", dependencies: [{ type: "MATCH_WINNER", match: "KO:sf1" }, { type: "MATCH_WINNER", match: "KO:sf2" }] },
          ],
        },
        bid = uuid();
      {
        const existingKeys = new Set(((await db().prepare("SELECT group_id FROM matches WHERE tournament_id=? AND group_id LIKE 'KO:%'").bind(tournament.id).all()).results as any[]).map((row) => row.group_id));
        const date = body.match_date || tournament.end_date || tournament.start_date || now().slice(0, 10);
        const times = Array.isArray(body.times) && body.times.length ? body.times : ["09:00", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:30"];
        const initial: [string, string, string][] = [["KO:5a", groupA[2]?.id || "source:3rd-group-a", groupB[3]?.id || "source:4th-group-b"], ["KO:5b", groupB[2]?.id || "source:3rd-group-b", groupA[3]?.id || "source:4th-group-a"], ["KO:sf1", groupA[0]?.id || "source:1st-group-a", groupB[1]?.id || "source:2nd-group-b"], ["KO:sf2", groupB[0]?.id || "source:1st-group-b", groupA[1]?.id || "source:2nd-group-a"]];
        const dependent: [string, string, string][] = [["KO:7th", "placeholder:KO:7th:home", "placeholder:KO:7th:away"], ["KO:5th", "placeholder:KO:5th:home", "placeholder:KO:5th:away"], ["KO:3rd", "placeholder:KO:3rd:home", "placeholder:KO:3rd:away"], ["KO:final", "placeholder:KO:final:home", "placeholder:KO:final:away"]];
        for (const [index, [key, home, away]] of [...initial, ...dependent].entries()) if (!existingKeys.has(key)) { const matchId = uuid(); await db().prepare("INSERT INTO matches (id,tournament_id,home_team_id,away_team_id,home_score,away_score,status,confirmed,court,match_date,start_time,referee_ids,group_id,period,clock,clock_running,scoreboard_mode,version,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(matchId,tournament.id,home,away,0,0,"scheduled",0,"Court 1",date,times[index] || times[times.length - 1],"[]",key,"1st half",`${tournament.match_duration_minutes || 20}:00`,0,"scoreboard",1,now(),now()).run(); const max: any = await db().prepare("SELECT COALESCE(MAX(sort_order),-1) value FROM schedule_items WHERE tournament_id=?").bind(tournament.id).first(); await db().prepare("INSERT INTO schedule_items (id,tournament_id,item_type,match_id,match_date,start_time,duration_minutes,court,sort_order,active,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)").bind(uuid(),tournament.id,"match",matchId,date,times[index] || times[times.length - 1],Number(tournament.match_duration_minutes || 20),"Court 1",Number(max?.value || -1)+1,1,now(),now()).run(); }
      }
      await db().prepare("UPDATE brackets SET active=0 WHERE active=1").run();
      await db()
        .prepare("INSERT INTO brackets (id,active,mode,data,created_at,updated_at) VALUES (?,?,?,?,?,?)")
        .bind(bid, 1, body.mode || "groups", JSON.stringify(data), now(), now())
        .run();
      await resolveBracketProgression(tournament.id);
      await log(u, "GENERATE", "bracket", bid);
      return out({ id: bid, data }, 201);
    }
    const table = mapName(parts[0]);
    if (table === "rooms" || table === "tournaments" || table === "teams") await ensureScheduleSchema();
    if (
      !resources[table] ||
      !permit(u, table === "delegation_members" ? ["ADMIN", "TEAM"] : ["ADMIN"])
    )
      return out({ error: "Forbidden" }, 403);
    if (table === "delegation_members") {
      if (u.role === "TEAM") body.team_id = u.teamId;
      body.member_type = String(body.member_type || body.role || "STAFF").toUpperCase();
      body.role = body.member_type;
      body.player_role = body.player_role ? String(body.player_role).toUpperCase() : null;
      body.staff_role = body.staff_role ? String(body.staff_role).toUpperCase() : null;
      body.classification_points = body.classification_points === "" || body.classification_points === undefined ? null : Number(body.classification_points);
      if (!["PLAYER", "COACH", "STAFF", "REFEREE", "TEAM_MANAGER", "ASSISTANT"].includes(body.member_type)) return out({ error: "Choose a valid delegation role" }, 422);
      if (body.member_type === "PLAYER" && !["KEEPER", "T_STICK", "HANDSTICK"].includes(body.player_role)) return out({ error: "Players require a valid playing role" }, 422);
      if (["COACH", "STAFF", "TEAM_MANAGER", "ASSISTANT"].includes(body.member_type)) { body.player_role = null; body.classification_points = null; body.staff_role = body.member_type; body.custom_staff_role = null; }
      if (body.member_type === "REFEREE") { body.player_role = null; body.staff_role = null; body.classification_points = null; }
      const total =
          (
            await db()
              .prepare(
                "SELECT COUNT(*) c FROM delegation_members WHERE team_id=?",
              )
              .bind(body.team_id)
              .first<any>()
          )?.c || 0,
        players =
          (
            await db()
              .prepare(
                "SELECT COUNT(*) c FROM delegation_members WHERE team_id=? AND role='PLAYER'",
              )
              .bind(body.team_id)
              .first<any>()
          )?.c || 0;
      if (total >= 16 || (body.role === "PLAYER" && players >= 8))
        return out({ error: "Delegation limit reached" }, 409);
    }
    if (
      table === "matches" &&
      (!Array.isArray(body.referee_ids) || body.referee_ids.length !== 2)
    )
      return out({ error: "Exactly two referees required" }, 422);
    if (table === "matches") {
      if (body.home_team_id && body.away_team_id && body.home_team_id === body.away_team_id)
        return out({ error: "A team cannot play against itself" }, 422);
      const conflict = await db()
        .prepare(
          "SELECT id FROM matches WHERE COALESCE(match_date,'')=COALESCE(?,'') AND start_time=? AND id!=? AND (referee_ids LIKE ? OR referee_ids LIKE ?)",
        )
        .bind(
          body.match_date || null,
          body.start_time || "",
          "",
          `%${body.referee_ids?.[0] || ""}%`,
          `%${body.referee_ids?.[1] || ""}%`,
        )
        .first();
      if (conflict)
        return out(
          {
            error:
              "A referee is already assigned to another match at this time",
          },
          409,
        );
    }
    if (table === "matches") body.court = "Court 1";
    if (table === "invites") {
      body.code = body.code || secureToken(10);
      body.expires_at =
        body.expires_at || new Date(Date.now() + 604800000).toISOString();
    }
    if (table === "users") {
      const email = String(body.email || "").trim().toLowerCase();
      const name = String(body.name || "").trim();
      const role = String(body.role || "TEAM").toUpperCase();
      if (!email || !email.includes("@") || !name)
        return out({ error: "Name and a valid email are required" }, 422);
      if (!["ADMIN", "TEAM", "REFEREE", "SCOREBOARD"].includes(role))
        return out({ error: "Invalid user role" }, 422);
      const existing: any = await db()
        .prepare("SELECT id FROM users WHERE lower(email)=? LIMIT 1")
        .bind(email)
        .first();
      if (existing) return out({ error: "An account already exists with this email address" }, 409);
      if (!body.password || String(body.password).length < 8)
        return out({ error: "Choose a password of at least 8 characters" }, 422);
      body.email = email;
      body.name = name;
      body.role = role;
      body.password = await hashPassword(String(body.password));
    }
    if (table === "teams" && (!body.login_password || String(body.login_password).length < 8))
      return out({ error: "Choose a temporary password of at least 8 characters" }, 422);
    if (table === "teams") {
      const loginEmail = String(body.login_email || `team-${uuid().slice(0, 8)}@phb.app`).toLowerCase().trim();
      const existingUser: any = await db().prepare("SELECT id FROM users WHERE lower(email)=lower(?) LIMIT 1").bind(loginEmail).first();
      if (existingUser) return out({ error: "A user with this login email already exists" }, 409);
      body.login_email = loginEmail;
    }
    if (table === "matches" && !body.tournament_id) {
      const active: any = await db().prepare("SELECT id FROM tournaments WHERE active=1 LIMIT 1").first();
      if (!active?.id) return out({ error: "Create or activate a tournament first" }, 409);
      body.tournament_id = active.id;
    }
    if (table === "groups" && !body.tournament_id) {
      const active: any = await db().prepare("SELECT id FROM tournaments WHERE active=1 LIMIT 1").first();
      if (!active?.id) return out({ error: "Create or activate a tournament first" }, 409);
      body.tournament_id = active.id;
    }
    const rid = uuid(),
      cols = resources[table].filter((k) => body[k] !== undefined),
      vals = cols.map((k) =>
        ["team_ids", "referee_ids", "data"].includes(k)
          ? JSON.stringify(body[k])
          : body[k],
      ),
      hasUpdated = table !== "invites";
    await db()
      .prepare(
        `INSERT INTO ${table} (id,${cols.join(",")},created_at${hasUpdated ? ",updated_at" : ""}) VALUES (?,${cols.map(() => "?").join(",")},?${hasUpdated ? ",?" : ""})`,
      )
      .bind(rid, ...vals, now(), ...(hasUpdated ? [now()] : []))
      .run();
    if (table === "teams") {
      const email = String(
        body.login_email || `team-${rid.slice(0, 8)}@phb.app`,
      ).toLowerCase();
      await db()
        .prepare(
          "INSERT INTO users (id,email,password,role,name,team_id,country,photo,active,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
        )
        .bind(
          uuid(),
          email,
          await hashPassword(String(body.login_password)),
          "TEAM",
          body.name || "Team manager",
          rid,
          null,
          null,
          1,
          now(),
          now(),
        )
        .run();
      const expected = Math.min(16, Math.max(0, Number(body.expected_delegation_size || 0)));
      const requiredRooms = Math.ceil(expected / 2);
      for (let index = 0; index < requiredRooms; index++) {
        await db()
          .prepare("INSERT INTO rooms (id,number,capacity,locked,team_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?)")
          .bind(uuid(), "", 2, 0, rid, now(), now())
          .run();
      }
    }
    let emailSent = false;
    if (table === "invites" && body.recipient_email) {
      const origin = new URL(req.url).origin;
      emailSent = await sendEmail(
        body.recipient_email,
        "Your invitation to Powerchair Floorball Battle",
        teamInviteEmail(origin, String(body.code || "")),
      );
      if (emailSent) await db().prepare("UPDATE preregistrations SET portal_invitation_sent_at=? WHERE lower(email)=lower(?) AND selection_email_sent_at IS NOT NULL").bind(now(), body.recipient_email).run();
    }
    const auditBody = table === "users" ? { ...body, password: undefined } : body;
    await log(u, "CREATE", table, rid, auditBody);
    return out({ id: rid, ...body, emailSent }, 201);
  } catch (error: unknown) {
    logServerError(req, error);
    return out({ error: "We could not complete that change. Please check the values and try again." }, 500);
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ path?: string[] }> },
) {
  if (!acceptsMutation(req)) return out({ error: "Cross-site request blocked" }, 403);
  const parts = (await params).path || [],
    path = parts.join("/"),
    table = mapName(parts[0]),
    rid = parts[1],
    contentLength = Number(req.headers.get("content-length") || 0);
  if (contentLength > MAX_JSON_BODY_BYTES) return out({ error: "Request body is too large" }, 413);
  const body: any = await req.json().catch(() => ({})),
    u = (await session(req)) as SessionUser;
  if (path === "schedule/reorder") {
    if (!permit(u, ["ADMIN"])) return out({ error: "Forbidden" }, 403);
    await ensureScheduleSchema();
    const tournament: any = await db().prepare("SELECT id FROM tournaments WHERE active=1 LIMIT 1").first();
    if (!tournament || !Array.isArray(body.items)) return out({ error: "Invalid schedule" }, 422);
    const conflicts = await validateScheduleItems(tournament.id, body.items);
    if (conflicts.length) return out({ error: "Schedule conflicts must be resolved before saving", conflicts }, 409);
    const stamp = now(), statements = body.items.flatMap((item: any, index: number) => {
      if (!item?.id) return [];
      const result = [db().prepare("UPDATE schedule_items SET sort_order=?,match_date=?,start_time=?,duration_minutes=?,court=?,updated_at=? WHERE id=? AND tournament_id=?").bind(index,item.match_date || null,item.start_time || null,Number(item.duration_minutes || 15),"Court 1",stamp,item.id,tournament.id)];
      if (item.match_id) result.push(db().prepare("UPDATE matches SET match_date=?,start_time=?,court=?,updated_at=? WHERE id=? AND tournament_id=?").bind(item.match_date || null,item.start_time || null,"Court 1",stamp,item.match_id,tournament.id));
      return result;
    });
    if (statements.length) await db().batch(statements);
    return out({ ok: true, conflicts: [] });
  }
  if (parts[0] === "messages" && rid) {
    if (!u) return out({ error: "Unauthorized" }, 401);
    const result = await db()
      .prepare(
        "UPDATE messages SET read_at=? WHERE id=? AND recipient_user_id=?",
      )
      .bind(now(), rid, u.id)
      .run();
    return result.meta.changes
      ? out({ ok: true })
      : out({ error: "Message not found" }, 404);
  }
  if (parts[0] === "contacts" && rid) {
    if (!permit(u, ["ADMIN"])) return out({ error: "Forbidden" }, 403);
    await ensureScheduleSchema();
    const fields = [
      "name",
      "role",
      "email",
      "phone",
      "whatsapp",
      "emergency",
      "sort_order",
    ].filter((k) => body[k] !== undefined);
    if (!fields.length) return out({ error: "No changes supplied" }, 422);
    const vals = fields.map((k) =>
      k === "emergency"
        ? body[k]
          ? 1
          : 0
        : k === "sort_order"
          ? Number(body[k])
          : body[k] || null,
    );
    await db()
      .prepare(
        `UPDATE organization_contacts SET ${fields.map((k) => `${k}=?`).join(",")},updated_at=? WHERE id=?`,
      )
      .bind(...vals, now(), rid)
      .run();
    await log(u, "UPDATE", "organization_contact", rid, body);
    return out({ ok: true });
  }
  if (table === "matches") {
    const locked: any = await db().prepare("SELECT confirmed FROM matches WHERE id=?").bind(rid).first();
    if (locked?.confirmed) return out({ error: "This match is confirmed and locked" }, 423);
    const current: any = await db().prepare("SELECT home_team_id,away_team_id FROM matches WHERE id=?").bind(rid).first();
    if ((body.home_team_id || current?.home_team_id) && (body.away_team_id || current?.away_team_id) && (body.home_team_id || current?.home_team_id) === (body.away_team_id || current?.away_team_id)) return out({ error: "A team cannot play against itself" }, 422);
  }
  if (!rid || !resources[table] || !u) return out({ error: "Forbidden" }, 403);
  if (u.role === "TEAM") {
    if (table === "teams" && rid !== u.teamId)
      return out({ error: "Forbidden" }, 403);
    if (table === "delegation_members") {
      const member = await db()
        .prepare("SELECT team_id FROM delegation_members WHERE id=?")
        .bind(rid)
        .first<any>();
      if (member?.team_id !== u.teamId) return out({ error: "Forbidden" }, 403);
    } else if (table !== "teams") return out({ error: "Forbidden" }, 403);
  } else if (u.role === "REFEREE") {
    if (table !== "matches") return out({ error: "Forbidden" }, 403);
    const match = await db()
      .prepare("SELECT referee_ids FROM matches WHERE id=?")
      .bind(rid)
      .first<any>();
    if (!JSON.parse(match?.referee_ids || "[]").includes(u.id))
      return out({ error: "Not assigned to this match" }, 403);
  } else if (u.role === "SCOREBOARD") {
    if (table !== "matches") return out({ error: "Forbidden" }, 403);
  } else if (u.role !== "ADMIN") return out({ error: "Forbidden" }, 403);
  if (table === "teams") {
    await db().prepare("UPDATE teams SET review_status='information_incomplete',review_snapshot=NULL,approved_snapshot=NULL,admin_reviewed_at=NULL,admin_reviewed_by=NULL,review_message=NULL,updated_at=? WHERE id=? AND review_status!='information_incomplete'").bind(now(), rid).run();
  }
  if (table === "delegation_members") {
    const member: any = await db().prepare("SELECT team_id FROM delegation_members WHERE id=?").bind(rid).first();
  }
  if (table === "users" && body.password) {
    if (String(body.password).length < 8)
      return out({ error: "Password must contain at least 8 characters" }, 422);
    body.password = await hashPassword(String(body.password));
  }
  if (table === "delegation_members" && body.role !== undefined) {
    body.member_type = String(body.member_type || body.role || "STAFF").toUpperCase();
    body.role = body.member_type;
    body.player_role = body.player_role ? String(body.player_role).toUpperCase() : null;
    body.staff_role = body.staff_role ? String(body.staff_role).toUpperCase() : null;
    body.classification_points = body.classification_points === "" || body.classification_points === undefined ? null : Number(body.classification_points);
    if (!["PLAYER", "COACH", "STAFF", "REFEREE", "TEAM_MANAGER", "ASSISTANT"].includes(body.member_type)) return out({ error: "Choose a valid delegation role" }, 422);
    if (body.member_type === "PLAYER" && !["KEEPER", "T_STICK", "HANDSTICK"].includes(body.player_role)) return out({ error: "Players require a valid playing role" }, 422);
    if (["COACH", "STAFF", "TEAM_MANAGER", "ASSISTANT"].includes(body.member_type)) { body.player_role = null; body.classification_points = null; body.staff_role = body.member_type; body.custom_staff_role = null; }
    if (body.member_type === "REFEREE") { body.player_role = null; body.staff_role = null; body.classification_points = null; }
    if (body.role === "PLAYER") {
      const current: any = await db()
          .prepare("SELECT team_id,role FROM delegation_members WHERE id=?")
          .bind(rid)
          .first(),
        players =
          (
            await db()
              .prepare(
                "SELECT COUNT(*) c FROM delegation_members WHERE team_id=? AND role='PLAYER' AND id!=?",
              )
              .bind(current?.team_id, rid)
              .first<any>()
          )?.c || 0;
      if (players >= 8)
        return out({ error: "This team already has 8 players" }, 409);
    }
  }
  if (table === "matches" && body.status === "live") {
    const row = await db()
      .prepare("SELECT referee_ids FROM matches WHERE id=?")
      .bind(rid)
      .first<any>();
    if (JSON.parse(row?.referee_ids || "[]").length !== 2)
      return out({ error: "Two referees required" }, 422);
  }
  if (table === "matches" && body.status === "finished") {
    const row: any = await db()
        .prepare("SELECT home_score,away_score FROM matches WHERE id=?")
        .bind(rid)
        .first(),
      count =
        (
          await db()
            .prepare("SELECT COUNT(*) c FROM goal_events WHERE match_id=?")
            .bind(rid)
            .first<any>()
        )?.c || 0;
    if (count !== Number(row?.home_score || 0) + Number(row?.away_score || 0))
      return out(
        {
          error:
            "Every goal must be linked to a player before this match can be finished",
        },
        409,
      );
  }
  if (table === "matches" && (body.match_date || body.start_time || body.referee_ids)) {
    const current: any = await db()
      .prepare("SELECT match_date,start_time,referee_ids FROM matches WHERE id=?")
      .bind(rid)
      .first();
    const date = body.match_date ?? current?.match_date,
      start = body.start_time || current?.start_time,
      refs = body.referee_ids || JSON.parse(current?.referee_ids || "[]"),
      conflict = await db()
        .prepare(
          "SELECT id FROM matches WHERE COALESCE(match_date,'')=COALESCE(?,'') AND start_time=? AND id!=? AND (referee_ids LIKE ? OR referee_ids LIKE ?)",
        )
        .bind(date || null, start, rid, `%${refs[0] || ""}%`, `%${refs[1] || ""}%`)
        .first();
    if (conflict)
      return out(
        {
          error: "A referee is already assigned to another match at this time",
        },
        409,
      );
  }
  if (table === "tournaments" || table === "rooms" || table === "teams") await ensureScheduleSchema();
  if (table === "teams") {
    const parts = [body.address_street, body.address_number, body.address_postal_code, body.address_city, body.address_country].filter((value) => String(value || "").trim());
    if (parts.length) body.address = parts.join(" ");
  }
  if (table === "matches") body.court = "Court 1";
  const cols = resources[table].filter(
    (k) => body[k] !== undefined && k !== "version",
  );
  if (!cols.length) return out({ error: "No changes supplied" }, 422);
  const vals = cols.map((k) =>
    ["team_ids", "referee_ids", "data"].includes(k)
      ? JSON.stringify(body[k])
      : body[k],
  );
  const result = await db()
    .prepare(
      `UPDATE ${table} SET ${cols.map((k) => `${k}=?`).join(",")},updated_at=?${table === "matches" ? ",version=version+1" : ""} WHERE id=?${body.version !== undefined ? " AND version=?" : ""}`,
    )
    .bind(
      ...vals,
      now(),
      rid,
      ...(body.version !== undefined ? [body.version] : []),
    )
    .run();
  if (!result.meta.changes)
    return out({ error: "Record changed by another user" }, 409);
  if (table === "teams" && body.expected_delegation_size !== undefined) {
    const expected = Math.min(16, Math.max(0, Number(body.expected_delegation_size || 0)));
    const requiredRooms = Math.ceil(expected / 2);
    const currentRooms: any = await db().prepare("SELECT COUNT(*) count FROM rooms WHERE team_id=?").bind(rid).first();
    for (let index = Number(currentRooms?.count || 0); index < requiredRooms; index++) {
      await db().prepare("INSERT INTO rooms (id,number,capacity,locked,team_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?)").bind(uuid(), "", 2, 0, rid, now(), now()).run();
    }
  }
  if (table === "matches" && (body.match_date !== undefined || body.start_time !== undefined || body.court !== undefined)) {
    const scheduleFields: string[] = [], scheduleValues: any[] = [];
    if (body.match_date !== undefined) { scheduleFields.push("match_date=?"); scheduleValues.push(body.match_date || null); }
    if (body.start_time !== undefined) { scheduleFields.push("start_time=?"); scheduleValues.push(body.start_time || null); }
    if (body.court !== undefined) { scheduleFields.push("court=?"); scheduleValues.push(body.court || null); }
    if (scheduleFields.length) {
      scheduleValues.push(now(), rid);
      await db().prepare(`UPDATE schedule_items SET ${scheduleFields.join(",")},updated_at=? WHERE match_id=? AND active=1`).bind(...scheduleValues).run();
    }
  }
  if (table === "rooms") {
    const affected = (
      await db()
        .prepare(
          "SELECT DISTINCT m.team_id FROM room_assignments ra JOIN delegation_members m ON m.id=ra.member_id WHERE ra.room_id=?",
        )
        .bind(rid)
        .all()
    ).results as any[];
    for (const x of affected) await syncAccommodation(x.team_id);
    if (body.team_id) await syncAccommodation(body.team_id);
  }
  await log(u, "UPDATE", table, rid, body);
  return out({ ok: true, id: rid });
}
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ path?: string[] }> },
) {
  if (!acceptsMutation(req)) return out({ error: "Cross-site request blocked" }, 403);
  const parts = (await params).path || [],
    table = mapName(parts[0]),
    rid = parts[1],
    u = (await session(req)) as SessionUser,
    body: any = await req.json().catch(() => ({}));
  if (parts[0] === "tournaments" && rid) {
    if (!permit(u, ["ADMIN"])) return out({ error: "Forbidden" }, 403);
    const tournament: any = await db().prepare("SELECT id,name,active FROM tournaments WHERE id=?").bind(rid).first();
    if (!tournament) return out({ error: "Tournament edition not found" }, 404);
    if (tournament.active) return out({ error: "Activate another tournament edition before deleting this one" }, 409);
    const admins: any[] = (await db().prepare("SELECT password FROM users WHERE role='ADMIN' AND active=1").all()).results as any[];
    const valid = await Promise.all(admins.map((admin) => verifyPassword(String(body.password || ""), String(admin.password || ""))));
    if (!valid.some(Boolean)) return out({ error: "Admin password is incorrect" }, 403);
    const matches = (await db().prepare("SELECT id FROM matches WHERE tournament_id=?").bind(rid).all()).results as any[];
    await db().batch([
      db().prepare("DELETE FROM schedule_items WHERE tournament_id=?").bind(rid),
      ...matches.flatMap((match) => [
        db().prepare("DELETE FROM goal_events WHERE match_id=?").bind(match.id),
        db().prepare("DELETE FROM match_events WHERE match_id=?").bind(match.id),
      ]),
      db().prepare("DELETE FROM matches WHERE tournament_id=?").bind(rid),
      db().prepare("DELETE FROM groups WHERE tournament_id=?").bind(rid),
      db().prepare("DELETE FROM preregistrations WHERE tournament_id=?").bind(rid),
      db().prepare("DELETE FROM tournaments WHERE id=? AND active=0").bind(rid),
    ]);
    await log(u, "DELETE_TOURNAMENT", "tournament", rid, { name: tournament.name, matches: matches.length });
    return out({ ok: true, deletedMatches: matches.length });
  }
  if (parts[0] === "finance" && parts[1] === "invoices" && parts[2]) {
    if (!permit(u, ["ADMIN"])) return out({ error: "Forbidden" }, 403);
    await ensureFinanceSchema();
    const invoiceId = parts[2];
    const invoice: any = await db().prepare("SELECT id FROM invoices WHERE id=?").bind(invoiceId).first();
    if (!invoice) return out({ error: "Invoice not found" }, 404);
    const payment: any = await db().prepare("SELECT id FROM finance_payments WHERE invoice_id=? LIMIT 1").bind(invoiceId).first();
    if (payment) {
      await db().prepare("UPDATE invoices SET status='cancelled',updated_at=? WHERE id=?").bind(now(), invoiceId).run();
      await log(u, "CANCEL_INVOICE", "invoice", invoiceId);
      return out({ ok: true, cancelled: true });
    }
    await db().prepare("DELETE FROM invoices WHERE id=?").bind(invoiceId).run();
    await log(u, "DELETE_INVOICE", "invoice", invoiceId);
    return out({ ok: true, deleted: true });
  }
  if (parts[0] === "goal-events" && rid) {
    const event: any = await db()
      .prepare(
        "SELECT ge.*,m.home_team_id FROM goal_events ge JOIN matches m ON m.id=ge.match_id WHERE ge.id=?",
      )
      .bind(rid)
      .first();
    if (!event || !(await mayControlMatch(u, event.match_id)))
      return out({ error: "Goal not found or forbidden" }, 404);
    const locked: any = await db().prepare("SELECT confirmed FROM matches WHERE id=?").bind(event.match_id).first();
    if (locked?.confirmed) return out({ error: "This match is confirmed and locked" }, 423);
    const column =
      event.team_id === event.home_team_id ? "home_score" : "away_score";
    await db().batch([
      db().prepare("DELETE FROM goal_events WHERE id=?").bind(rid),
      db()
        .prepare(
          `UPDATE matches SET ${column}=MAX(0,${column}-1),version=version+1,updated_at=? WHERE id=?`,
        )
        .bind(now(), event.match_id),
    ]);
    await log(u, "DELETE_GOAL", "match", event.match_id, {
      goalEventId: rid,
      playerId: event.player_id,
    });
    return out({ ok: true });
  }
  if (parts[0] === "match-events" && rid) {
    const event: any = await db().prepare("SELECT * FROM match_events WHERE id=?").bind(rid).first();
    if (!event || !(await mayControlMatch(u, event.match_id))) return out({ error: "Event not found or forbidden" }, 404);
    const locked: any = await db().prepare("SELECT confirmed FROM matches WHERE id=?").bind(event.match_id).first();
    if (locked?.confirmed) return out({ error: "This match is confirmed and locked" }, 423);
    await db().prepare("DELETE FROM match_events WHERE id=?").bind(rid).run();
    await log(u, "DELETE_MATCH_EVENT", "match", event.match_id, { eventId: rid, type: event.type });
    return out({ ok: true });
  }
  if (parts[0] === "messages" && parts[1] === "conversation" && parts[2]) {
    if (!u) return out({ error: "Unauthorized" }, 401);
    const other = parts[2];
    await db().batch([
      db()
        .prepare(
          "UPDATE messages SET deleted_by_sender=1 WHERE sender_user_id=? AND recipient_user_id=?",
        )
        .bind(u.id, other),
      db()
        .prepare(
          "UPDATE messages SET deleted_by_recipient=1 WHERE recipient_user_id=? AND sender_user_id=?",
        )
        .bind(u.id, other),
    ]);
    return out({ ok: true });
  }
  if (parts[0] === "messages" && rid) {
    if (!u) return out({ error: "Unauthorized" }, 401);
    await db().batch([
      db()
        .prepare(
          "UPDATE messages SET deleted_by_sender=1 WHERE id=? AND sender_user_id=?",
        )
        .bind(rid, u.id),
      db()
        .prepare(
          "UPDATE messages SET deleted_by_recipient=1 WHERE id=? AND recipient_user_id=?",
        )
        .bind(rid, u.id),
    ]);
    return out({ ok: true });
  }
  if (parts[0] === "contacts" && rid) {
    if (!permit(u, ["ADMIN"])) return out({ error: "Forbidden" }, 403);
    await db()
      .prepare("DELETE FROM organization_contacts WHERE id=?")
      .bind(rid)
      .run();
    await log(u, "DELETE", "organization_contact", rid);
    return out({ ok: true });
  }
  if (!rid || !resources[table] || !u) return out({ error: "Forbidden" }, 403);
  if (u.role === "TEAM" && table === "delegation_members") {
    const member = await db()
      .prepare("SELECT team_id FROM delegation_members WHERE id=?")
      .bind(rid)
      .first<any>();
    if (member?.team_id !== u.teamId) return out({ error: "Forbidden" }, 403);
  } else if (u.role !== "ADMIN") return out({ error: "Forbidden" }, 403);
  if (table === "matches") {
    const locked: any = await db().prepare("SELECT confirmed FROM matches WHERE id=?").bind(rid).first();
    if (locked?.confirmed) return out({ error: "This match is confirmed and locked" }, 423);
  }
  if (table === "matches")
    await db()
      .prepare("DELETE FROM goal_events WHERE match_id=?")
      .bind(rid)
      .run();
  if (table === "rooms") {
    const assigned: any = await db().prepare("SELECT COUNT(*) c FROM room_assignments WHERE room_id=?").bind(rid).first();
    if (Number(assigned?.c || 0) > 0) return out({ error: "Remove all people from this room before deleting it" }, 409);
  }
  if (table === "groups") {
    const group: any = await db().prepare("SELECT * FROM groups WHERE id=?").bind(rid).first();
    if (!group) return out({ error: "Group not found" }, 404);
    const matches = (await db().prepare("SELECT id FROM matches WHERE group_id=?").bind(group.name).all()).results as any[];
    for (const m of matches) { await db().prepare("DELETE FROM schedule_items WHERE match_id=?").bind(m.id).run(); await db().prepare("DELETE FROM goal_events WHERE match_id=?").bind(m.id).run(); await db().prepare("DELETE FROM match_events WHERE match_id=?").bind(m.id).run(); await db().prepare("DELETE FROM matches WHERE id=?").bind(m.id).run(); }
    await db().prepare("UPDATE teams SET group_id=NULL,updated_at=? WHERE group_id=? OR group_id=?").bind(now(),group.name,`group-${group.name}`).run();
    await db().prepare("DELETE FROM groups WHERE id=?").bind(rid).run();
    await log(u,"DELETE",table,rid,{deletedMatches:matches.length}); return out({ok:true,deletedMatches:matches.length});
  }
  await db().prepare(`DELETE FROM ${table} WHERE id=?`).bind(rid).run();
  await log(u, "DELETE", table, rid);
  return out({ ok: true });
}
