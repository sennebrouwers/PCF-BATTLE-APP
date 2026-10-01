# PCF BATTLE

PCF BATTLE is a tournament website and operations portal for team registration,
delegation management, match operations, accommodation and tournament finance.

## Vercel deployment

The repository is connected to Vercel through GitHub. Vercel installs with
`npm ci`, runs `npm run build:vercel`, and serves the Nitro output. A push to the
connected production branch triggers a deployment.

Set these values in the Vercel project before enabling production workflows:

| Variable | Purpose |
| --- | --- |
| `TURSO_DATABASE_URL` | Turso/libSQL database URL |
| `TURSO_AUTH_TOKEN` | Turso database authentication |
| `SESSION_SECRET` | HMAC session signing key; use at least 32 random characters |
| `BLOB_READ_WRITE_TOKEN` | Private Vercel Blob uploads and reads |
| `RESEND_API_KEY` | Transactional email delivery |
| `RESEND_FROM` | Verified sender address for transactional emails |
| `SITE_ORIGIN` | Optional canonical HTTPS origin override for email assets and links; defaults to `https://www.pcfbattle.be` |

Set secrets in Vercel's environment settings. Do not commit `.env` files or
secret values. For local development, use a separate database and storage
environment; never point local testing at production data.

## Local checks

```text
npm ci
npx tsc --noEmit --pretty false
npm run lint
npm test
npm run build:vercel
```

`npm test` runs the application build and automated product checks. Database and
payment tests use temporary local SQLite files and do not contact production.

## Runtime notes

- `app/api/[[...path]]/route.ts` contains the server API and role checks.
- `lib/turso-db.ts` adapts Turso transactions and batches to the API's database
  interface.
- `lib/blob-storage.ts` stores private uploads in Vercel Blob.
- `db/schema.ts` describes the Drizzle schema. Some legacy runtime columns are
  also added idempotently by the API when their features are first used.
- `SECURITY.md` documents required secrets and deployment checks.
- `GDPR-DATA-MAP.md` identifies personal data and operational retention decisions.
