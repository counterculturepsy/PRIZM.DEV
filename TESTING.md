# Testing

## Layers

- Unit: authorization scopes, URL/robots policy, deterministic website analysis, opportunity generation, scoring/classification, CRM validation/normalization/lifecycle rules, analytics formatting/ratio/role rules, provider registries
- Component: accessibility and state of reusable UI
- Integration: generated migrations, PostgreSQL constraints, invitation safety, CSV idempotency, durable audit queue lifecycle, opportunity materialization/idempotency, CRM transaction/idempotency/suppression behaviour, exact analytics aggregates/currency grouping/cross-tenant isolation, and tenant-scoped queries against ephemeral PGlite (PostgreSQL in WebAssembly)
- API: authentication, authorization, validation, error contracts, idempotency
- E2E: landing, login, protected redirects including CRM, responsive smoke coverage, onboarding, discovery, and milestone user journeys

## Commands

M8 unit tests cover sequence order/delay/cap rules, header injection, the disabled provider and token hashing. PGlite tests apply migrations `0008`–`0009` and prove campaign idempotency, cross-tenant constraints, role denial, duplicate enrollment, later suppression/address changes, immutable staging, leased daily caps, provider-event replay protection and atomic unsubscribe suppression. Protected campaign routes and public unsubscribe screens are tested on desktop and mobile. No test invokes a live provider; authenticated staging delivery remains an external gate.

`pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, and `pnpm test:e2e` are required gates. Playwright needs Chromium (`pnpm exec playwright install chromium`). PGlite applies the real generated migrations without requiring a system PostgreSQL installation; live OAuth/database E2E remains a deployment-environment gate.

Tests must prove behaviour at boundaries, especially cross-workspace denial and role restrictions. A test that merely mirrors implementation is not sufficient.

M9 tests use a fixed as-of instant and two workspaces. They verify rolling windows, distinct source attribution, top dimensions, stage counts, proposal coverage, won ratio, average closed cycle, currency-separated values, and that the second tenant cannot affect the first tenant's result. Browser smoke coverage verifies all report routes redirect unauthenticated users on desktop and mobile.

The prospect-to-proposal acceptance test uses isolated PGlite fixtures to prove company and audit evidence persistence, identical deterministic opportunity rematerialization with stable downstream IDs, deduplicated CRM conversion, request-key-idempotent proposal creation, privileged human approval, revision-driven approval reset, cross-workspace denial and the absence of any outbound campaign/message side effect. Focused provenance tests also reject material changes or removal of a lead-linked opportunity while permitting transactional refresh of unlinked snapshots. External crawling, AI generation and delivery are not invoked.

The authenticated browser journey in `tests/e2e/prospect-to-proposal.spec.ts` requires `E2E_DATABASE_URL` to identify the loopback `prizm_e2e` database; `playwright.config.ts` rejects any other host or database name. The test registers a unique account, creates and onboards a unique workspace, imports one CSV prospect through the UI, inserts only isolated audit/evidence fixtures directly into the test database, and completes opportunity → CRM lead → proposal → Owner approval in the browser. Its cleanup resolves the unique account/workspace even after partial setup failure and deletes only those fixtures. It explicitly asserts that no campaign or staged message exists for the workspace. The stateful journey runs once in desktop Chromium; the remaining authentication and route coverage retains desktop/mobile projects.
