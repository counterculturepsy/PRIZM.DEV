# Changelog

All notable changes follow Keep a Changelog. The project has not released a stable API.

## Unreleased

### Added

- Proposal evidence and approval traceability: new proposals capture an immutable, server-derived snapshot of the tenant-owned source opportunity, findings and stored service recommendations; later versions preserve it unchanged. Proposal detail now displays the exact evidence, attributed version authors, approval actor and lifecycle transitions. Proposal reads and writes revalidate active database membership/current role inside workspace-locked transactions. An isolated authenticated Playwright journey covers CSV prospect import through owner approval and proves that no outbound campaign or message is created. No migration, external crawl, delivery or payment path was enabled.
- Prospect-to-proposal continuation: lead workspaces link back to the exact source audit and current company opportunity report, proposal creation can safely preselect only a tenant-visible lead, proposal detail returns to CRM context, and a cross-module PGlite acceptance test covers evidence-backed opportunity materialization, deduplicated CRM conversion, proposal versioning, privileged human approval and approval reset. Lead conversion and materialization share a tenant/company row lock so concurrent conversion cannot attach to a partially refreshed snapshot. Approval remains review/export-only and never sends content.
- First-party authentication hardening: durable account/trusted-edge-IP limits with `429`/`Retry-After`, mutation-origin validation, expiring single-use hashed email-verification and password-reset tokens, reset-driven session invalidation, pseudonymized security events, dedicated recovery screens, and isolated PostgreSQL/Playwright coverage. External email delivery remains disabled and verified-email sign-in is not yet enforced.
- Google/Gmail OAuth sign-in with paired environment validation, explicit account selection, conditional login UI and pseudonymized OAuth success events; production credentials remain intentionally unconfigured.
- Service catalogue: approved descriptions and features saved through the Settings editor for AI Integration & AI-Powered Applications, API Development & Third-Party Integrations, Business Process Automation, CRM & ERP Systems, Customer Portals & Admin Dashboards, Database Architecture & Backend Development and SaaS Platform Development. All 16 services are now populated; no prices, mappings, recommendation rules or schema changed.
- Service catalogue: approved descriptions and features saved through the Settings editor for Full-Stack Web Application Development, Mobile App Development and Payment Gateway Integration (nine services are now populated, seven await approval); no prices, mappings, schema changes or recommendation rules were added
- Service catalogue: approved descriptions and features saved through the Settings editor for Custom Website Design & Development, Website Redesign & Modernisation, Custom E-Commerce Platforms & Online Stores and Booking & Reservation Systems (six services are now populated); no prices, mappings, schema changes or recommendation rules were added
- Service catalogue: a one-off Technical Remediation service (created through Settings) and approved descriptions and features for it and for Ongoing Maintenance & Technical Support, saved through the details editor; no prices, mappings, schema changes or recommendation rules were added
- Service details editor (Settings, Services): owners and admins can edit only a service's description (up to 500 characters) and features (up to 12 entries of 80 characters) in the existing columns, with server-side validation, workspace isolation and an audit entry that records the changed fields and sizes but never the text; name, slug, active status, prices and delivery time cannot be edited there, other roles see the details read-only, and no migration was needed
- Recommendation presentation is preferred-only: the feed and the company report present a service as recommended only when the opportunity's stored snapshot marks it preferred; otherwise they show "No service recommendation confirmed" with neutral pricing and never list or count non-preferred snapshot services (snapshots and mappings are stored unchanged)
- Opportunities feed enhancement (read-only, no schema change): cards show opportunity type, lead priority and score, highest linked finding severity, evidence confidence and count, the preferred service and price state taken only from the opportunity recommendation snapshot, lead-v1 prospect suitability (match, verified mismatch, missing data) and CRM lead status; historical opportunities without a snapshot read "No recommendation snapshot" and "Price not recorded" and are never resolved from current mappings
- Opportunity-to-service mapping: workspace-scoped, editable mappings (Settings → Services) with an optional preferred service per opportunity type, recommendation snapshots stored per opportunity (migration `0011`, additive; legacy slug aliases seed explicit mappings for exact matches only), a pure resolver ordering preferred then name then id, price guidance only from configured prices, and a company report that shows website health, observed need, prospect suitability and evidence quality separately and labels missing data apart from verified mismatches. The `lead-v1` formula and `opportunity-v1` identifiers are unchanged; historical opportunities are not rewritten
- Provider-gated company discovery: a `DiscoveryProvider` abstraction, an OpenStreetMap (Overpass) adapter that is off unless `DISCOVERY_PROVIDER` and a terms acknowledgement are configured, per-workspace run limits, source-attributed fill-missing upserts that never overwrite user data, bounded paging, and a paginated Discover list; CSV import remains the fallback
- Local OpenStreetMap extract discovery: a separate global `osm_source` schema (migration `0010`, applied to the local database on 2026-10-26), an offline `osmium` GeoJSON-sequence parser and loader with a read-only `scan` dry run, a `DISCOVERY_PROVIDER=osm_extract` provider that searches by distance from a named place with cursor paging and no network access, provider-specific run limits, and dataset provenance stored on every saved source. Tested on synthetic fixtures and a read-only scan of the real Geofabrik extract; the loader refuses to publish a dataset unless every line of the file was read
- Six-company CSV import and deduplication integration coverage
- M8 campaign preparation: immutable templates, ordered steps, deduplicated audiences, suppression/readiness checks, privileged human review, audit events and tenant/role regression tests; delivery remains disabled
- M8 delivery safety control plane: immutable staged messages, provider idempotency, leased/capped claims, bounded retries, hashed single-use unsubscribe, replay-safe normalized events, system suppression and public confirmation/result screens; no live provider or send action
- M9 `analytics-v1` reporting: exact tenant-scoped discovery/source, pipeline/proposal, deal-value and closed-cycle aggregates; authenticated sales/lead reports, privileged won-value view, currency/timezone definitions, explicit telemetry limitations and cross-tenant tests

- M0 architecture, route map, database/tenancy model, design system, security, AI, API, environment, testing, and roadmap documentation
- Next.js/TypeScript/Tailwind application foundation
- Drizzle/PostgreSQL auth, workspace, membership, and audit schema
- Auth.js, workspace authorization, provider contracts, tests, and CI foundations
- M1 database-backed Auth.js adapter, workspace creation/switching, onboarding, service catalogue, ICP settings, team roles, and expiring hashed invitations
- Responsive authenticated shell with loading, empty, error, and permission-aware states
- PGlite integration coverage for migrations, tenant isolation, uniqueness, and invitation downgrade prevention
- M2 tenant-owned company database, source provenance, discovery-run history, and saved searches
- Bounded CSV ingestion with allowlisted columns, deterministic deduplication, and import audit events
- Company discovery filters, saved-search workflow, company profiles, and permission-aware responsive navigation
- M3 website targets, durable leased audit jobs, page evidence, findings, and versioned diagnostic scores
- SSRF-aware public destination policy, robots handling, bounded single-page HTTP provider, and disabled-by-default worker
- Accessible audit request, history, queued/blocked/partial states, and evidence report routes
- M4 versioned lead scores, deterministic opportunity rules, same-audit evidence links, and catalogue-backed nullable price guidance
- Ranked opportunity feed and company opportunity reports with complete score explanations and non-guarantee language
- Composite PostgreSQL constraints covering M4 company, audit, service, opportunity, and finding relationships
- M5 tenant-owned leads, deals, attributed contacts, notes, follow-up tasks, append-only activity, and suppression records
- Role-aware lead workspace, responsive pipeline, contact directory, task list, and activity timeline routes
- Transactional CRM activity/audit writes, normalized contact deduplication, idempotent lead creation, and cross-tenant regression coverage
- M6 disabled-by-default workspace AI policies, idempotent daily-budget reservations, redacted audit-evidence snapshots, structured provider provenance, and review-only draft lifecycle
- Evidence-grounded strategy/outreach pages, strict structured-output adapter, safe failure handling, human review screens, and tenant/role/quota regression coverage
- M7 tenant-owned proposal records, append-only version snapshots, server-authoritative pricing, Owner/Admin approval, accessible print rendering, and tenant/role/version regression coverage

### Fixed

- Opportunities feed copy no longer refers to internal milestones or to reprocessing existing audits; it now says opportunities appear after a website audit and that a fresh analysis needs a new audit
- Re-materialising an audit now upserts opportunities by the existing tenant/audit/type/generation natural key and preserves IDs referenced by CRM leads. Identical linked reruns retain their immutable evidence and recommendation snapshots; any material linked change or removal is rejected and requires a new audit. Unlinked snapshots refresh transactionally without duplication. No migration or environment variable was added.
- CSV import rejected rows where the optional `country_code` cell was blank
- Website audits: robots.txt wildcard matching no longer backtracks exponentially; requests have total time limits and a per-audit budget instead of idle-only timeouts; a connection dropped mid-response now fails cleanly instead of hanging; redirects to non-HTTP schemes and compressed responses are rejected; submit and button inputs are no longer reported as unlabelled; error pages are no longer scored as if they were the company's site; NAT64 and Teredo address ranges are blocked
- Website audits: per-workspace limits of 10 waiting or running audits and 50 requests per 24 hours
- Company sources: `observed_at` carries the source's own observation time for new OSM records, `created_at` keeps the import time, and the company page shows both; existing records were not changed
