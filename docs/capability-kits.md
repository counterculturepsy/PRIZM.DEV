# Capability Kit Manager (M9)

Workspace-scoped media kits, private documents, case studies, recipient-specific application packs, human approval, reference attachments and revocable share links.

**Status:** implemented and verified locally (unit, integration, isolated E2E), including CRM, proposal, campaign and AI-drafting integration. Not deployed. Migrations `0017`, `0018` and `0019` have not been applied to any shared database.

## What it does
1. **Documents** (`/app/kits`): upload PDF, PNG or JPEG. Stored privately; versioned; archive, restore, purge.
2. **Kits**: a branded profile (introduction, capabilities, featured projects, approach, services, contact, branding). Every save is an immutable version.
3. **Case studies**: project, problem, solution, stack, responsibilities, architecture, links, results, development status, screenshots.
4. **Packs**: a recipient-specific selection of one kit version, case studies and documents, built from one of seven templates, with an editable cover note.
5. **Approval**: an owner or administrator approves the exact recipient, message, case studies and documents. Any later change returns the pack to draft and revokes its links.
6. **Attachments**: an approved pack can be attached as a reference to a CRM lead, an approved proposal, or a reviewed campaign.
7. **Share links**: public, token-only PDF download; expiring, revocable, optionally download-limited, rate limited per client address.
8. **Native integration**: attached packs appear on CRM lead, proposal and campaign pages with approval state and share-link expiry; approved packs can be chosen in AI strategy and outreach drafting, where their case studies (verified results only) and document titles become citable evidence; a pack that changed after approval blocks campaign staging and the final pre-send check.
9. **Document management**: per-document version page with preview and download for every version; owner/admin purge of archived documents behind a typed confirmation; documents still used by a pack or case study are kept.

## What it deliberately does not do
- It never sends anything. Attachments are references; the campaign delivery pipeline is unchanged and sends no files.
- It never invents content. Results appear in a kit or PDF only when the author marked them verified; development status is whatever the author chose.

## Architecture
| Concern | Decision |
| --- | --- |
| Storage | Postgres `bytea` (`kit_asset_versions.data`) behind the service layer. No new provider, no public URL, no billable resource. Swappable later behind `src/server/kits/library.ts`. |
| PDF | `pdf-lib` 1.17.1 (MIT, pure JS) for generation and for validating uploads. `@pdf-lib/fontkit` embeds DejaVu Sans (`assets/fonts`, licence included) as a subset for Latin, Latin Extended, Greek and Cyrillic; if the font files cannot be read it falls back to Helvetica. Scripts the font lacks (for example CJK) and emoji print as `?`. |
| Templates | Seven packs defined in code (`src/modules/kits/templates.ts`), checked by a DB constraint. |
| Layers | `src/modules/kits` (pure: content schema, file validation, PDF, tokens, templates) → `src/server/kits` (services) → `src/app/app/kits` + `src/app/api/kits` + `src/app/s/[token]` (UI, routes). |

## Data model (migrations 0017 to 0019)
`kit_assets`, `kit_asset_versions`, `capability_kits`, `capability_kit_versions`, `case_studies`, `case_study_assets`, `kit_packs`, `kit_pack_case_studies`, `kit_pack_assets`, `kit_attachments`, `kit_share_links`, `kit_access_events`. Audit history reuses `audit_logs` (`kit.*` actions). All tables carry `workspace_id`, use composite workspace-scoped foreign keys, and have check constraints. `0017` adds one value to the `crm_activity_type` enum; `0018` adds the twelve kit tables; `0019` widens the `auth_rate_limit_windows` kind check by one value (`kit_share_ip`). All three are additive and forward-only, with no data backfill. They were rehearsed on a restored copy of the local development database: existing row counts were unchanged and the new constraints behaved as intended.

## Security model
- **Tenancy:** every query filters by the caller's workspace; cross-workspace ids behave as not found.
- **Roles:** writers create and edit; viewers read. Approval, share-link creation and purge need `manage_workspace` (owner or administrator). Enforced in the service, not only the UI.
- **Uploads:** the file's bytes decide its type (the declared type and extension are never trusted). Limits: PDF 4 MB and 100 pages, image 2 MB and 40 megapixels, 200 documents and 50 MB per workspace, 20 versions per document. PDFs with scripts, launch actions, embedded files or encryption are refused. Filenames are sanitised to a path-free display name and never used as a path.
- **Downloads:** signed-in, workspace-scoped, logged; `Cache-Control: private, no-store`, `nosniff`, `X-Robots-Tag: noindex`, restrictive CSP. Every refusal is the same generic 404.
- **Share links:** 256-bit token; only its SHA-256 is stored; 1 to 30 days; at most 5 active per pack; download claim is a single atomic UPDATE (tested under 10 concurrent requests against a limit of 3). The public route is limited to 30 requests per client address per 10 minutes (the limiter applies where a trustworthy client address exists, i.e. on Vercel). A link stops working if the pack is edited, loses approval, or its referenced content changes (approval digest).
- **Approval digest:** SHA-256 over kit version, template, recipient, message, case studies (with their update times) and pinned document versions.
- **Send gate:** campaign staging and the last check before each provider send both require every attached pack to be approved exactly as reviewed; otherwise the message is suppressed with `attachment_changed_after_approval`. Attachments are references: delivered messages carry no files.
- **AI context:** only an approved, current pack can be attached to a draft request; unverified results are never included; the pack's text goes to the configured AI provider only after the user's existing evidence-transfer acknowledgement, and the request is logged as `capabilityPack: true` without content.
- **Logging:** no token, file byte or document text is written to application logs, audit rows or access events (asserted by a test that spies on the console and scans the stored rows).
- **Audit:** upload, archive, restore, purge, kit and pack changes, approval, attach, detach, link create and revoke. Access events log downloads and denied link attempts with a keyed IP hash.

## Operations
- **Apply the migration** only with a backup first, on Preview then Production, through the normal migration process. It is forward-only; rolling back means leaving the tables unused.
- **Storage cleanup:** archive documents, then `purgeArchivedKitAssets` (owner or administrator) removes archived documents older than a cutoff that no pack or case study references.
- **Request size:** `next.config.ts` sets the server-action body limit to 4.4 MB, under Vercel's 4.5 MB cap.

## Known limitations
- Unknown or malformed tokens are not logged (they cannot be tied to a workspace).
- PDF active-content detection scans raw bytes and the parsed catalog; names inside compressed object streams other than the catalog are not scanned.
- Screenshots in the PDF are limited to two per case study; images are embedded at the width of the page.
- Document templates are code, not per-workspace data. Custom workspace templates are future work.
- CJK, Arabic, Hebrew and emoji are not rendered (the bundled font does not cover them); they print as `?`.
- The pack's cover note is for the author to copy into outreach or campaign tools; campaign delivery does not attach files.
- The IP rate limit does not apply in local development because no trustworthy client address is available there; it is covered by a unit test that supplies one.
- Vercel packaging of the bundled fonts is verified in the local production build (file tracing), not yet on a deployment.

## Tests
`src/modules/kits/*.test.ts` (files incl. encrypted and active-content PDFs, PDF and Unicode fonts, templates, tokens), `src/server/kits/service.integration.test.ts` (in-memory Postgres on the real migrations: tenancy, roles, quotas, versions, drift, attachments, share links, concurrency, log hygiene, purge, AI evidence), `src/server/campaigns/delivery.attachments.integration.test.ts` (send gate), `src/app/s/[token]/route.test.ts` (public route: expired, revoked, unknown, rate limit), `tests/e2e/capability-kits.spec.ts` (browser journey incl. lead attachment, document versions, purge, cross-tenant and unauthenticated access).
