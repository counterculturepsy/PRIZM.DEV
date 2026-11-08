# PRIZM.DEV | Developer Collaboration Handoff

## Welcome to the PRIZM.DEV Development Team

You are joining PRIZM.DEV as a collaborating full-stack developer, working alongside HOAX1G and ChatGPT/Codex.

We are jointly developing an advanced SaaS platform for business discovery, website analysis, opportunity intelligence, CRM, AI-assisted sales, proposals, campaigns, and analytics.

**Our objective:** Build, improve, test, and launch PRIZM.DEV as a professional, scalable, production-ready application.

This is an existing project. We are continuing development, not starting over.

## GitHub Repository

**Repository:** https://github.com/counterculturepsy/PRIZM.DEV

**Owner:** HOAX1G  
**Default branch:** `main`  
**Current development reference:** `codex/prizm-m8-campaign-foundation`

Important: The `main` branch currently contains only a minimal README. Most application development exists on milestone branches. Inspect the branches before beginning work.

You have been invited to collaborate through GitHub.

## Technology Stack

- Next.js 16 / React 19
- TypeScript
- Tailwind CSS 4
- PostgreSQL / Drizzle ORM
- Auth.js / NextAuth
- Zod
- Vitest / Playwright
- pnpm / Node.js 22+
- GitHub Actions

Preserve the existing stack and application architecture.

## Current Development Progress

The repository documents the following milestones:

- **M0–M1:** Application foundation, authentication, workspaces, and onboarding.
- **M2–M3:** Business discovery, prospect database, and website auditing.
- **M4–M5:** Opportunity intelligence, lead scoring, and CRM.
- **M6–M7:** AI-assisted sales drafts and proposal generation.
- **M8:** Campaign preparation and delivery safety infrastructure.
- **M9:** Analytics and reporting foundation.
- **M10–M11:** Billing and production hardening remain planned.

These milestones require code and test verification before being considered production-ready.

## Collaboration Workflow

Both developers will work from the same GitHub repository.

### Git Rules

1. Inspect the repository before editing.
2. Do not assume `main` is the latest application.
3. Coordinate on the integration branch before starting.
4. Create a separate feature branch for your work.
5. Never force-push shared branches.
6. Never overwrite another developer's uncommitted work.
7. Use descriptive commit messages.
8. Submit pull requests for review.
9. Do not merge into `main` without agreement.
10. Keep changes small and easy to review.

Suggested branch naming:

- `feature/dashboard-improvements`
- `feature/discovery-enhancements`
- `feature/crm-improvements`
- `fix/authentication`
- `test/integration-coverage`

### Code Quality

- Write clean, maintainable TypeScript.
- Reuse existing components and services.
- Preserve existing branding and UI conventions.
- Maintain workspace/tenant isolation.
- Protect database migrations and existing data.
- Use responsive, accessible design.
- Validate inputs and protect API boundaries.
- Add tests for new features and bug fixes.
- Never commit secrets or environment credentials.

## Initial Assignment

Before making any changes:

1. Clone the repository.
2. Inspect the existing milestone branches.
3. Identify the latest complete application.
4. Read `README.md`, `ARCHITECTURE.md`, `DATABASE.md`, `ROADMAP.md`, and `SECURITY.md` on the development branch.
5. Review the source structure, routes, components, and database schema.
6. Check available tests and CI configuration.
7. Report any incomplete functionality or architectural concerns.

Do not modify production data, enable outbound campaigns, or perform destructive Git operations.

## Shared Development Responsibilities

We will coordinate work across these areas:

| Area | Responsibilities |
|---|---|
| Frontend | Dashboard, UI/UX, responsiveness, accessibility |
| Backend | APIs, business logic, authentication |
| Database | Schema, queries, migrations, tenant isolation |
| Discovery | Company imports, searches, filtering |
| Auditing | Website analysis, evidence, security |
| CRM | Leads, pipeline, contacts, tasks |
| AI | Sales drafts, recommendations, provider integration |
| QA | Unit, integration, E2E and regression tests |
| DevOps | CI/CD, deployment, monitoring |

Assignments will be agreed upon before implementation to avoid conflicting changes.

## Communication and Progress

When working on a feature, communicate:

- What you are working on.
- Which branch and files you are changing.
- Any shared components or schemas affected.
- What has been completed.
- Which tests passed or failed.
- What needs review or integration.

We will use our shared ChatGPT development conversation for architecture discussions, debugging, decisions, code reviews, and progress tracking.

GitHub remains the source of truth for code.

## First Action

**Start with a read-only inspection of the PRIZM.DEV repository and its development branches.**

Then introduce yourself in the shared development chat with:

1. Your preferred development responsibilities.
2. Your local development environment.
3. Which area of PRIZM.DEV you would like to work on first.
4. Any issues you identified during repository inspection.

Do not begin major code changes until we agree on branch ownership and the first assignments.

---

**PRIZM.DEV Development Team**

Project Lead: HOAX1G  
Collaborating Developer: GitHub Invited  
AI Development Support: ChatGPT / Codex

**Our goal is one shared codebase, coordinated development, reliable testing, and a production-ready PRIZM.DEV platform.**
