# PCF BATTLE security and operations

## Production configuration

The Vercel runtime uses Turso/libSQL and private Vercel Blob storage. Configure
these values in the Vercel project's environment settings:

- `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN`: production database connection.
- `SESSION_SECRET`: at least 32 random characters for HMAC session signing.
  Rotating it invalidates existing sessions.
- `BLOB_READ_WRITE_TOKEN`: private upload and download access.
- `RESEND_API_KEY` and `RESEND_FROM`: transactional confirmation, selection,
  waiting-list and portal invitation emails.
- `SITE_ORIGIN`: canonical HTTPS origin for generated email links and images.

Use separate credentials and databases for Preview and Development. Never
commit runtime values, tokens, database credentials or local `.env` files.

## Roles

Authorization is enforced in the API, not by navigation visibility:

- `PUBLIC`: public tournament data only
- `TEAM`: own team/delegation data
- `REFEREE`: assigned match data and referee workflows
- `SCOREBOARD`: match-control and scoreboard workflows
- `ADMIN`: tournament administration and exports

Any new endpoint must authenticate and authorize before reading or mutating
records. Team and referee identifiers must always be checked against the
authenticated user on the server.

## Data and uploads

Uploads are limited to authenticated operational roles and 4 MB per file, so
multipart requests stay below Vercel Functions' 4.5 MB request-body limit.
Supported raster images and PDFs are validated against file signatures. SVG is
not accepted. File reads require the owner or an administrator unless the
object is linked from a published public resource. PDF responses are private
attachments. Use a client-to-Blob upload flow before raising this limit.
Public participant names require privacy consent; participant photos also
require photo consent.

Do not log passwords, session tokens, email contents, medical notes or other
unnecessary personal data. API errors shown to users must be actionable but
must not expose stack traces or database errors.

## Deployment checks

Before the first production API request after deployment, check for existing
case-insensitive duplicate emails. The API creates unique normalized email
indexes lazily, and those migrations will fail until duplicate rows are
resolved according to the organisation's account policy:

```sql
SELECT lower(email), COUNT(*) FROM users GROUP BY lower(email) HAVING COUNT(*) > 1;
SELECT tournament_id, lower(email), COUNT(*) FROM preregistrations
GROUP BY tournament_id, lower(email) HAVING COUNT(*) > 1;
```

Run before every production deployment:

```text
npx tsc --noEmit --pretty false
npm run lint
npm test
npm audit --omit=dev --audit-level=high
npm run build:vercel
```

The current automated tests cover mutation protection, login throttling,
session revocation, public-data consistency, atomic payments and idempotency,
tournament invariants, recovery checks and scoreboard protection. A staging
rehearsal is still required for real backup restore, concurrent operators,
email delivery, browser/device coverage and network recovery.
