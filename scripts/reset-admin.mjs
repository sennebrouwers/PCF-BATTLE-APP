import { createClient } from "@libsql/client";
import { randomBytes, pbkdf2 } from "node:crypto";
import { promisify } from "node:util";

const [email = "admin@pcfbattle.be", password] = process.argv.slice(2);
if (!password) {
  console.error("Usage: node scripts/reset-admin.mjs <email> <password>");
  process.exit(1);
}

if (!process.env.TURSO_DATABASE_URL || !process.env.TURSO_AUTH_TOKEN) {
  console.error("Load .env.production.local before running this script.");
  process.exit(1);
}

const derive = promisify(pbkdf2);
const salt = randomBytes(16);
const derived = await derive(Buffer.from(password), salt, 100000, 32, "sha256");
const hash = `pbkdf2$${salt.toString("hex")}$${derived.toString("hex")}`;
const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});
const now = new Date().toISOString();

await db.execute("DELETE FROM login_attempts");
await db.execute({
  sql: "UPDATE users SET password=?, role='ADMIN', active=1, updated_at=? WHERE lower(email)=lower(?)",
  args: [hash, now, email],
});

const result = await db.execute({
  sql: "SELECT id,email,role,active FROM users WHERE lower(email)=lower(?)",
  args: [email],
});
if (!result.rows.length) {
  console.error(`No user found for ${email}`);
  process.exit(1);
}
console.log(`Admin password reset for ${email}.`);
