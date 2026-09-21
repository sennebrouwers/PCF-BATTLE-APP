# PCF BATTLE security and operations

## Production configuration

The application requires the Sites runtime bindings for D1 and R2 plus these
runtime secrets:

- `SESSION_SECRET`: a long, randomly generated signing secret. Rotate it by
  changing the value and redeploying; existing sessions will be invalidated.
- `RESEND_API_KEY` and `RESEND_FROM`: optional email delivery configuration.
- `SITE_ORIGIN`: the public HTTPS origin used in generated email links.

Never commit runtime values, tokens, database credentials or local `.env` files.
Use the hosting provider's secret store and issue a new repository credential
for each deployment session.

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

Uploads are limited to authenticated operational roles, 20 MB, and validated
against file signatures for supported images and PDFs. Do not add a new upload
type without validating its binary signature and access policy.

Do not log passwords, session tokens, email contents, medical notes or other
unnecessary personal data. API errors shown to users must be actionable but
must not expose stack traces or database errors.

## Deployment checks

Run before every production deployment:

```text
npx tsc --noEmit --pretty false
npm run lint
npm test
npm audit --omit=dev --audit-level=high
npm run build
```

The current automated tests cover mutation protection, login throttling,
session revocation, public-data consistency, tournament invariants, recovery
checks and scoreboard protection. A staging rehearsal is still required for
real backup restore, concurrent operators, email delivery, browser/device
coverage and network recovery.
