# The Edit — an editorial CMS

A fictional independent publication with a working editorial desk: write and revise stories, manage custom pages and staff roles, attach images, import/export CSV and read JSON feeds. The slate, paper and red design turns restored PHP coursework into a contemporary publishing workspace.

This repository contains two real backend editions:

- **Hosted edition (repository root):** Node.js 22, Express, EJS and MongoDB-compatible Cosmos DB on Azure Static Web Apps Free. Each visitor creates a private, temporary editorial workspace; its data persists in the database across requests and deployments.
- **Original restored PHP edition (`php-edition/`):** PHP and SQLite for local development, preserved with its setup instructions and test suite. The hosted adaptation does not pretend that Azure runs PHP or put SQLite on a network share.

## What you can do

Browse fictional sample stories, search headlines/bylines, sort by publication date and view story details. Start an editorial workspace with a fictional username and password to create/edit stories, pages and staff profiles. Administrators manage editor/admin roles; editors can publish content but cannot manage people. JPEG/PNG uploads work on stories, pages and profiles. CSV imports validate the complete batch before saving; exports escape formula-like values. A latest-stories widget and read-only JSON endpoints remain available.

There is no destructive delete workflow because the source coursework only had create/read/update screens. Sample stories are read-only; use **Copy to workspace** to edit your own version. Uploaded text is plain text, not executable rich HTML.

## Local development

Use Node.js 22.22 or newer. Install dependencies with `npm ci`.

For a quick interface preview, run `npm run demo:local` and open http://127.0.0.1:4372. **This explicit preview mode uses temporary memory and resets when the process stops.** It is never used by the Azure deployment.

For the persistent edition, copy `.env.example` to `.env`, set a local MongoDB URI and a random session secret of at least 32 characters, then run:

```sh
npm run db:prepare
npm start
```

Preparation is an explicit administrative command that inserts missing sample content and 100 empty workspace slots. It never overwrites existing data and does not create indexes by default. The application never performs DDL at startup. For local MongoDB index setup, an administrator may call `repository.prepare({skipIndexes:false})`; Azure indexes are provisioned separately by the resource owner.

Use fictional credentials and content. A workspace cookie binds your browser to its workspace, while your username/password authenticates a role inside that workspace. Signing out keeps that workspace association so another staff account in the same workspace can sign in. Clearing cookies loses that association; there is intentionally no email recovery or cross-device invitation service.

## Retention, privacy and free hosting limits

Every workspace expires **96 hours after creation**. Sign-ins and edits do not extend that deadline. Reads and mutations immediately reject expired workspaces. An hourly cleanup job clears their people, passwords, sessions, stories, pages and images; permanent fictional seed content is retained. GitHub scheduled jobs can be delayed or disabled after repository inactivity, so access expiry is enforced independently of the schedule. Reusing an expired slot also replaces all prior content.

A single collection, `portfolio-demos.edit_demo`, contains one permanent seed document and 100 fixed workspace slots. Allocation atomically claims a slot, and a random generation prevents old sessions from accessing a reused slot. Each workspace is a bounded document; optimistic revision checks prevent concurrent writes from silently overwriting each other.

Limits keep the showcase small: 100 active workspaces globally; 30 stories, 10 pages, 5 people and 3 images per workspace; a 900 KiB document ceiling. Uploads accept JPEG/PNG up to 2 MiB and 4000×4000, then strip metadata, resize and encode to JPEG at at most 150 KiB each. CSV accepts at most 30 complete stories and 1 MiB. These are documented hosted-demo limits; the preserved local PHP edition has its original larger CSV limit. Normal article/page/user/image workflows are retained.

Passwords use scrypt. Signed HttpOnly, Secure, SameSite cookies bind opaque session tokens to a workspace generation; only token hashes are stored. Sessions last up to eight hours, are revoked on logout and password/role changes, and cannot outlive workspace expiry. Server-side CSRF, ownership and role checks apply to writes. Output is escaped, uploads are decoded/re-encoded, JSON never exposes password/session fields, and CSV exports neutralize formulas. Rate limits and global storage caps bound casual abuse; this public portfolio demo is not a production publishing service or a place for sensitive data.

The deployment uses an existing **Free** Static Web App and existing shared Cosmos throughput. Scripts do not provision resources, change throughput, upgrade subscriptions or alter spending limits. Free service quotas remain finite; do not enable paid scaling to accommodate demo traffic.

## Azure deployment

The owner configures these **server-only** app settings:

- `MONGODB_URI`: scoped Cosmos Mongo credential with read/write access only to `edit_demo`.
- `MONGODB_DATABASE`: `portfolio-demos`.
- `SESSION_SECRET`: a private random secret of at least 32 characters.

Required indexes: unique `_id` (default), and `{kind:1, expiresAt:1}` for allocation/cleanup. There is no TTL index that could delete permanent seed content or fixed slots. Preparation uses the scoped account only after backup and collection/index provisioning by the owner.

`.github/workflows/azure.yml` runs tests, dependency auditing and packaging on pushes/PRs. Deployment is disabled unless repository variable `AZURE_DEPLOY_ENABLED` is `true`; the deploy job uses protected environment `azure` and its `AZURE_STATIC_WEB_APPS_API_TOKEN` secret. The Linux runner installs production dependencies, including the correct native Sharp image library, before uploading. No local `.env`, database, PHP storage or historical credentials enter the release.

`.github/workflows/cleanup.yml` runs hourly at minute 29 and manually, with the same gate/environment. Its `MONGODB_URI` environment secret is the app-scoped connection only. It clears expired payloads without changing the collection, indexes or capacity. Administrators can run `npm run db:cleanup` explicitly; it reports only the number of cleared workspaces.

`npm run package:azure` creates `release/site` and `release/api`. The adapter preserves multipart image bytes, separate query parameters, multiple cookies and binary image responses. `/api/health` verifies that the database is reachable and prepared; it exposes no connection details. Optional `DEMO_MAINTENANCE=true` blocks the application during maintenance.

## Verification

`npm test` covers authentication and logout/password revocation, CSRF, workspace isolation, role enforcement, article/page workflows, immutable seeds, upload validation, CSV atomicity/export safety, fixed expiry, cleanup and storage caps. Tests also run an ephemeral local MongoDB instance to verify real allocation/CAS/persistence semantics, plus the Azure adapter’s cookies, query routing and binary upload/download round trip. The Mongo binary is downloaded by the test tool if not already cached; no hosted database is used.

`npm audit --omit=dev --audit-level=low` checks production dependencies. Dependabot checks npm and Actions weekly. MongoDB driver major updates are held because the current Cosmos Mongo compatibility endpoint requires the supported 6.x driver; changing that constraint needs a compatibility test.

## Provenance

Recovered from [`GrimSyntaxCloud/advancedPHP`, `week12`](https://github.com/GrimSyntaxCloud/advancedPHP/tree/508f7f4844f6fd1ffb60b6ad3da7051539a8b181/week12), commit `508f7f4844f6fd1ffb60b6ad3da7051539a8b181`.

This is Andres Macias’s coursework, restored and redesigned with AI assistance, then adapted to a free hosted backend. The original repository/history remains available. No old database credentials, database exports or original user photos were copied. All sample articles and people are fictional. Preserve this attribution when sharing the project.
