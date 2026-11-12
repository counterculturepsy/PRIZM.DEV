# Environment

Copy `.env.example` to `.env.local`. Never commit real values.

| Variable | Required | Scope | Purpose |
| --- | --- | --- | --- |
| `NEXTAUTH_URL` | Yes | Server | Canonical application origin used by Auth.js |
| `DATABASE_URL` | Yes | Server | PostgreSQL connection string |
| `AUTH_SECRET` | Yes | Server | At least 32 characters; session signing |
| `AUTH_GITHUB_ID/SECRET` | Pair | Server | GitHub OAuth |
| `AUTH_GOOGLE_ID/SECRET` | Pair | Server | Google OAuth (Google/Gmail sign-in); production callback: `https://prizm-dev-sigma.vercel.app/api/auth/callback/google` |
| `PASSWORD_AUTH_ENABLED` | No | Server | Enables first-party email/password registration and credentials sign-in; defaults to `false` |
| `OAUTH_LOGIN_ENABLED` | No | Server | Keeps configured OAuth providers available while `true`; disable only after administrator password login is proven |
| `RESEND_API_KEY` | Email delivery | Server secret | Preview-specific Resend API credential; never expose to the browser |
| `AUTH_EMAIL_FROM` | Email delivery | Server | Verified sender identity, for example `PRIZM.DEV <auth@verified-domain>` |
| `AUTH_EMAIL_REPLY_TO` | No | Server | Optional verified reply-to mailbox |
| `ADMIN_NOTIFICATION_EMAIL` | Email delivery | Server | Private recipient for new pending-registration alerts |
| `DEV_AUTH_BYPASS` | Local development only | Server | Bypass OAuth using an existing active workspace member; rejected outside `NODE_ENV=development` |
| `E2E_DATABASE_URL` | Browser tests only | Test runner | Must identify the isolated loopback database named `prizm_e2e`; never point browser tests at staging or production |
| `INTEGRATION_ENCRYPTION_KEY` | Production integrations | Server | 32-byte base64 envelope key |
| `AI_GENERATION_ENABLED` | No | Server | Fail-closed AI provider switch; defaults to `false` |
| `OPENAI_API_KEY` | When AI enabled | Server | OpenAI credential; never exposed to browsers |
| `OPENAI_MODEL` | When AI enabled | Server | Explicit compatible model identifier; no implicit production default |
| other provider API keys | Future adapters | Server | Reserved optional AI adapters |
| `WEBSITE_AUDIT_ENABLED` | No | Server/worker | Fail-closed switch; defaults to `false` |
| `AUDIT_USER_AGENT` | When audits enabled | Worker | Identifiable crawler product token and public contact/policy URL |
| `AUDIT_MAX_RESPONSE_BYTES` | When audits enabled | Worker | HTML response limit from 100,000 to 2,000,000 bytes |
| `CAMPAIGN_DELIVERY_ENABLED` | No | Server/worker | Fail-closed switch; only `false` is accepted until an approved adapter exists |
| `DISCOVERY_PROVIDER` | No | Server | `none` (default), `osm_extract` (local OpenStreetMap extract, recommended) or `overpass` (an Overpass endpoint; the public instance is not suitable for automated use) |
| `DISCOVERY_TERMS_VERIFIED_FOR` | When a provider is selected | Server | Must equal the provider id; records that its usage terms were read and accepted |
| `DISCOVERY_USER_AGENT` | When `overpass` is selected | Server | Identifiable product token with a contact URL or email address |
| `OVERPASS_API_URL` | No | Server | Optional `https` Overpass endpoint; defaults to the public instance |
| `OSM_EXTRACT_RADIUS_KM` | No | Server | Search radius around the chosen place for `osm_extract`, 1 to 50; defaults to 10 |

Run `pnpm env:check` before starting a deployment. Empty optional values normalize to absent. A half-configured OAuth pair is rejected. No secret uses a `NEXT_PUBLIC_` prefix.

Development, preview, and production use separate databases, OAuth clients, encryption keys, and provider projects. Rotate secrets through the deployment platform; do not paste them into issues, logs, screenshots, or source files.

Email verification and password-reset delivery are fail-closed. The server creates a deliverable token only when the complete Resend configuration is present. Configure `RESEND_API_KEY`, `AUTH_EMAIL_FROM` and `ADMIN_NOTIFICATION_EMAIL` together; partial configuration fails environment validation. Verification and reset links are single-use, stored only as SHA-256 hashes and expire after 24 hours and 30 minutes respectively. Approval remains independent from email verification. Do not claim delivery readiness until the sender domain is verified and a real Preview message has been received and opened.

Google sign-in is enabled automatically only when both Google OAuth values are present. Create a Google Cloud Web application client with the exact production origin and callback above, use separate credentials/callbacks for local or preview testing, then add both values as encrypted Vercel variables. Do not use a Gmail password or service-account key.

To run one audit job, the worker needs the environment loaded explicitly (tsx does not read `.env` itself): `pnpm exec tsx --env-file=.env scripts/run-audit-worker.ts` processes a single queued job and exits. Audit requests are limited per workspace (10 waiting or running, 50 per 24 hours) and each page fetch is bounded (10 s idle, 20 s total, 60 s per audit, 2 MB by default, three redirects, robots.txt checked at every hop).

Website auditing remains disabled for ordinary local UI work. Before enabling it, approve outbound network policy, publish the crawler identity/contact, configure worker scheduling and rate limits, and monitor blocked, failed, and retried jobs.

AI generation also remains disabled for ordinary local work. Enabling it requires all three server values above, an Owner/Admin-enabled workspace policy, an approved compatible model, data-processing and lawful-use review, authorized staging evaluation, request monitoring, and production governance. Local validation uses mocked transport and must not add a real key merely to make tests pass.

External company discovery stays off for ordinary local work; CSV import is always available. The OpenStreetMap adapter needs no API key, but the public Overpass servers are community-run: expect roughly 100 queries a day for regular use, send an identifying User-Agent, never run requests in parallel, and wait at least 30 seconds after an HTTP 429. The application enforces per-workspace limits well inside that. OpenStreetMap data is licensed under the ODbL and must be attributed ("© OpenStreetMap contributors"); the application stores that source on every record. Prefer a self-hosted instance or a regional extract before heavy use, and verify the terms of any commercial provider before adding an adapter. Discovery also requires at least one industry mapping in `OSM_INDUSTRY_FILTERS` (`src/modules/prospecting/overpass.ts`); with none defined, discovery stays unavailable even when the provider is configured.

The recommended discovery source is a locally loaded OpenStreetMap extract (`DISCOVERY_PROVIDER=osm_extract`). It makes no network requests at search time, needs no user agent, and still requires `DISCOVERY_TERMS_VERIFIED_FOR=osm_extract` as the owner's confirmation of the ODbL terms. The data must be downloaded and loaded first; the resource plan, runbook and approval checklist are in `plans/discovery-local-osm-extract.md`. The public Overpass server has returned HTTP 502 and states it is meant for human-operated tools, so do not point `overpass` at it for automated use.

Campaign delivery cannot be enabled in this release. Tests inject an in-memory provider and a test-only unsubscribe secret directly into the server service. Future production configuration must add a dedicated rotated unsubscribe secret, encrypted provider credentials, verified sender identity and provider-specific webhook secret only alongside the reviewed adapter that consumes them.
