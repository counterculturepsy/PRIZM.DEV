# Prospect-to-proposal vertical slice

## Scope

This slice connects the existing M2–M7 domains without adding a parallel service, provider, table or delivery path:

`Company → Website audit → Deterministic opportunity → CRM lead → Proposal draft/version → Owner/Admin approval`

## Transition contract

1. A company is persisted inside one trusted workspace with bounded source provenance and workspace-scoped deduplication.
2. An explicitly authorized audit persists sanitized page metadata and observed findings. Runtime crawling remains disabled unless separately approved and configured.
3. Opportunity materialization uses versioned deterministic rules. It upserts by workspace, audit, type and generation version so identical repeated runs preserve IDs used by downstream CRM records. Once a lead references an opportunity, its evidence, recommendation and commercial snapshot is immutable; a material change or removal requires a new audit/generation. Unlinked snapshots may refresh transactionally.
4. CRM conversion takes the same tenant/company row lock as materialization, then validates that the company and optional source opportunity belong to the active workspace and company inside the transaction. One lead per workspace/company makes conversion idempotent, and concurrent conversion cannot observe a partially refreshed opportunity snapshot.
5. Proposal creation validates the tenant-owned lead, uses a workspace-scoped request key and stores server-priced immutable versions. URL lead preselection is accepted only when the lead is present in the current workspace query.
6. Only an active Owner or Admin can approve a draft. A revision clears the earlier approval and requires a new review.

## Resume points

- Audit reports continue to the current company opportunity report.
- Lead workspaces link to the exact source audit when known, the current company opportunity report and proposal creation with tenant-validated preselection.
- Proposal detail links back to its CRM lead.

The exact source audit and the current company opportunity report are labelled separately because newer audits may supersede the intelligence used when the lead was created.

## Security and evidence invariants

- Every business record and relationship is scoped by the trusted workspace in queries and composite database constraints.
- Audit findings remain the observed source of truth; AI output cannot create or overwrite findings.
- Opportunity scoring and generation remain deterministic and versioned.
- A lead-linked source opportunity cannot be silently rewritten behind the preserved identifier.
- Proposal approval is an internal review/export state. It does not authorize or initiate email, campaign delivery, public sharing, signatures, invoices or payments.
- External crawling, external AI generation and live outbound delivery remain fail-closed.

## Database and environment impact

- Database migration: none. The existing opportunity natural key and tenant-composite foreign keys are reused.
- New dependency: none.
- New environment variable: none.
- Production/staging data change: none.

## Validation

Focused integration coverage must prove stable opportunity IDs after CRM conversion, nonduplicated evidence/recommendations, duplicate-safe lead and proposal creation, cross-workspace denial, privileged approval, approval reset after revision and no outbound side effect. Full lint, typecheck, unit/integration tests and production build remain required before merge or deployment.

## 2026-11-09 completion update

- Proposal reads and mutations now revalidate the caller's active database membership, active workspace and current role. The complete proposal read is protected by the same workspace/membership lock so a concurrent revocation cannot expose later version, evidence or actor queries.
- Version 1 captures a server-derived, immutable source-evidence snapshot from the tenant-owned lead opportunity, findings and stored service recommendations. Revisions copy that snapshot unchanged; clients cannot submit or replace it.
- Proposal creation, revision and approval audit events record the acting user, version and status transition. Proposal detail resolves those actors and renders lifecycle and version histories.
- Proposal detail visibly distinguishes embedded immutable evidence from legacy proposals that predate evidence snapshots and links to the exact source audit.
- The isolated Playwright journey uses only loopback `prizm_e2e`, unique fixtures and ID-scoped cleanup. It imports a prospect, stores audit evidence without crawling, opens the deterministic opportunity, creates a CRM lead and proposal, records human approval and asserts that no campaign or message was created.
- No migration, dependency, new environment variable, external crawl, AI call, delivery, proposal send or payment path was added or enabled.
