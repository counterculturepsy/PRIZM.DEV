# Security baseline

## M0 controls

- Strict environment validation and server-only secrets
- Auth.js sessions with configured secret and protected server routes
- Durable account- and trusted-edge-IP rate limits for login, registration, verification and reset flows using HMAC-pseudonymized identifiers; blocked responses include `Retry-After`, successful login clears its account bucket, and authentication sessions expire after 12 hours
- Expiring, single-use email-verification and password-reset tokens stored only as SHA-256 hashes; password reset increments the user's authentication version and invalidates existing sessions
- Pseudonymized authentication security events without passwords, raw action tokens, email addresses or IP addresses
- Same-origin checks on authentication mutations; forwarded client IPs are ignored unless the request is running behind Vercel's trusted edge
- Branded workspace authorization scope and deny-by-default roles
- Tenant columns, composite uniqueness, and scoped query conventions
- Zod at trust boundaries
- Security response headers and disabled framework signature
- Immutable audit-log foundation
- Hashed 256-bit invitation tokens, seven-day expiry, intended-email matching, and existing-member downgrade prevention
- Dependency lockfile and least-privilege CI permissions
- Bounded CSV ingestion (1 MB, 500 rows, strict headers and field lengths) with no automatic crawling
- Deterministic per-workspace company/source deduplication and provenance labels
- Audit URL allowlisting, public-IP pinning, private/reserved address denial, and redirect revalidation
- Robots-aware single-page fetches with strict time, redirect, content-type, and byte limits
- Raw website HTML is analyzed in memory and never persisted
- Durable audit leases, bounded retries, sanitized error codes, and worker disabled by default
- Deterministic opportunity rules, relational evidence provenance, nullable catalogue-backed pricing, and composite tenant constraints
- Tenant-scoped CRM references, attributed contact entry, normalized suppression records, transactional activity/audit writes, and read-only Viewer enforcement
- Disabled-by-default AI at server and workspace levels, redacted bounded evidence snapshots, strict structured output, evidence-ID grounding, quota reservation, sanitized failures, and mandatory audited human review with no send path
- Tenant-scoped append-only proposal versions, bounded integer money calculations, server-authoritative currency/totals, conditional Owner/Admin approval, and no public share, send, signature or payment path
- Immutable campaign message snapshots, stable provider idempotency keys, leased claims, atomic daily reservations, pre-send suppression rechecks, one-way unsubscribe-token hashes, replay-safe normalized events, and fail-closed delivery configuration
- Tenant-filtered aggregate analytics, privileged deal-value access, versioned definitions, non-additive source caveats, currency separation, and no contact/message payload exposure

## Required before production

The application is not production-ready. Before launch: integrate and approve a transactional email provider, enforce verified-email sign-in only after delivery is proven, apply and validate migrations through a controlled staging promotion, configure and live-test OAuth, establish authentication-event retention/alerting, verify trusted-edge behavior in preview, approve audit-worker egress and DNS controls, publish a crawler contact/policy, configure scheduling and monitoring, validate scoring and CRM workflows against realistic authorized staging data, review robots/terms/legal policy, select any external discovery provider contractually, establish contact-data retention/lawful basis and subject-rights workflows, approve an AI model/provider and data-processing basis, run an authorized staging evaluation, monitor request budgets and provider failures, add encrypted integration-token storage, CSP, backups and restore drills, privacy workflows, abuse controls, and an external tenant-isolation/privacy review.

## Authorization rules

Authentication is not authorization. The server resolves active membership for every tenant request. Owner/Admin manage workspace configuration; Sales handles CRM/outreach within policy; Developer handles technical audits; Viewer is read-only. High-risk actions require explicit capability checks and audit records.

## Outreach and data use

Only Owner/Admin/Sales may prepare campaigns; Owner/Admin alone review and stage immutable delivery records. Service mutations revalidate active role/membership. Enrollment checks contact flags and workspace-wide normalized email suppression; review and the worker recheck suppression and address changes. Plain-text templates render without HTML execution or interpolation. Public unsubscribe tokens are never stored raw, expire, are atomically single-use and expose no address. Provider events must be signature-verified by a future adapter before normalized ingestion; raw payloads are not retained. The runtime rejects enabled delivery and ships no live provider. Approved provider/sender, encrypted credentials, provider-specific signature verification, monitoring, staging validation and independent policy review remain mandatory before any send.

Only compliant/public APIs, user imports, and permissibly public data sources may be used. No uncontrolled scraping. Store source attribution, honour suppression/opt-out state, deduplicate, rate-limit, and require human review. POPIA/GDPR readiness is a design requirement, not a legal-compliance claim.

Report vulnerabilities privately to the repository owner; do not open a public issue containing exploit details or data.

## Analytics privacy and authorization

M9 reports resolve active membership server-side and every aggregate includes a workspace predicate. Sales/lead reports expose aggregate operational counts only. Deal-value reporting is Owner/Admin-only and is hidden from other roles. Reports do not include contact fields, message bodies, source snapshots, or raw provider payloads. Exact aggregate queries prevent misleading partial totals; explicit metric/version/timezone/currency labels prevent ambiguous interpretation. Future tracking, exports, cohort events, or a warehouse require separate privacy, retention, abuse, and tenant-isolation review.
