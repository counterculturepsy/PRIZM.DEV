# Service catalogue approval document

> **DRAFT / NOT YET APPROVED.** Prepared from `plans/service-catalogue-draft.md`. Nothing here has been entered into the service editor, and no service, slug, mapping or recommendation has been created or changed.
> Every description is **inferred from the service name** plus the answers still needed from you. No prices, timelines, technical capabilities or delivery commitments are stated; anything that looks like one is listed under *Assumptions to confirm*.

## Status update (2026-10-27): two services finalised and saved

The owner approved a two-service model: **Technical Remediation** (one-off, specific verified website issues) and **Ongoing Maintenance & Technical Support** (recurring care). They stay commercially distinct. Their finalised text, saved through the Settings editor, supersedes the earlier drafts of those two entries below. All other services in this document remain DRAFT / NOT YET APPROVED and unsaved.

**Ongoing Maintenance & Technical Support** (`ongoing-maintenance-technical-support`), saved. Description (413/500): "A recurring arrangement for the ongoing care of an existing website or application: software and security updates, scoped bug fixes, and small content or design changes. Monitoring, backups and hosting management can be offered as optional extras and are not standard inclusions. Not included: major redesigns; substantial new features; unlimited support or changes; 24/7 availability or response-time guarantees." Features: Software and security updates; Scoped bug fixes; Small content or design changes; Optional extras: monitoring, backups, hosting management.

**Technical Remediation** (`technical-remediation-e15e2e`, id `b1ec2e6c-b031-45a5-812c-f7ab90676adf`), created through the Settings add form (the UI appended the suffix) and saved. Description (452/500): "One-off, fixed-scope fixes for specific website problems, such as security-header or HTTPS configuration, page metadata, image alt text, form labels, viewport settings or straightforward performance fixes after diagnosis. Each problem is confirmed before it is agreed, and the fixes are agreed before work starts. Not included: redesigns; new features; ongoing maintenance; penetration testing; full accessibility certification; SEO ranking guarantees." Features: Agreed fix list; Implementation of the agreed fixes; Before-and-after verification of each fix; Short handover note.

Neither service has a price, and Technical Remediation is not mapped to any finding or opportunity type. Recommendations remain off: all five mapping rows are kept with zero preferred. An audit finding is an observation, never an automatic diagnosis or quotation.
**Revision 2026-10-27 (final):** four Part A profiles (Booking & Reservation Systems, Custom E-Commerce Platforms & Online Stores, Custom Website Design & Development, Website Redesign & Modernisation) are **APPROVED FOR THE INTERNAL SERVICE CATALOGUE** with the owner's final wording rules, and this document is the source of truth for their saved text. The other three Part A services and the eight Part B services are unchanged and still DRAFT / NOT YET APPROVED.

**Save status 2026-10-27:** the four approved profiles above were saved through the Settings editor, one at a time and each verified, and match this document character for character. Six services now carry approved text: Technical Remediation, Ongoing Maintenance & Technical Support, Custom Website Design & Development, Website Redesign & Modernisation, Custom E-Commerce Platforms & Online Stores and Booking & Reservation Systems. The remaining ten services are unchanged and unpopulated. No prices, mappings, recommendation rules or schema changed.

**Revision 2026-10-27 (Part A remainder, final):** Full-Stack Web Application Development, Mobile App Development and Payment Gateway Integration are **APPROVED** with the owner's final wording. The owner confirmed that PRIZM.DEV offers both mobile app design and mobile app development, so the earlier condition on Mobile App Development is lifted. This document is the source of truth for their saved text.

**Save status 2026-10-27 (Part A remainder):** Full-Stack Web Application Development, Mobile App Development and Payment Gateway Integration were saved through the Settings editor, one at a time and each verified, and match this document character for character. Nine services now carry approved text. The remaining seven services (AI Integration & AI-Powered Applications, API Development & Third-Party Integrations, Business Process Automation, CRM & ERP Systems, Customer Portals & Admin Dashboards, Database Architecture & Backend Development, SaaS Platform Development) are unchanged, unpopulated and awaiting commercial approval. No prices, mappings, recommendation rules or schema changed.

**Save status 2026-10-27 (final seven):** AI Integration & AI-Powered Applications, API Development & Third-Party Integrations, Business Process Automation, CRM & ERP Systems, Customer Portals & Admin Dashboards, Database Architecture & Backend Development and SaaS Platform Development were saved through the Settings editor, one at a time and each verified, and match blocks B1 to B7 below character for character. All 16 services now carry approved text. No prices, mappings, recommendation rules, scoring or schema changed, and the Opportunities feed and both company reports remain neutral (no service recommendation shown).

**Revision 2026-10-27 (final seven, owner-approved refinements):** B1 to B7 were revised to the owner's approved commercial rules (testing as a standard deliverable limited to the agreed scope; AI data handling and privacy agreed explicitly with no POPIA compliance claim; provider and fee dependence for APIs; initial assessment as part of scoping for automation; separately scoped CRM/ERP extras; security assessed in scoping for portals; consulting distinct from build for databases; SaaS deployment, hosting and operations by explicit agreement). Names and slugs are unchanged.

## How to read and approve this

- **Customer-facing text** is what would be saved in the service's existing `description` (up to 500 characters). It includes the engagement type and the scope exclusions. **Features** are the deliverables saved in the existing `features` list (up to 12 entries, 80 characters each).
- **Evidence required before recommending** and **Assumptions** are internal guidance. There is no field for them in a service record today, so they stay in this document until you decide otherwise.
- Names and slugs are exact and were checked against the database. They are not edited by the editor.
- For each item, mark: **Approve as written**, **Approve with edits** (write the edit beside it), or **Hold**.

## Summary

| Part | Services | Status |
| --- | --- | --- |
| A. Relatively clear scope | 7 | Draft text proposed; assumptions to confirm |
| B. Need your input | 8 | Conservative placeholder text; questions to answer first |
| C. Technical Remediation | 1 | **Created and saved** (see status update above) |

## A. Seven services with relatively clear scope

### A1. Booking & Reservation Systems

**APPROVED FOR THE INTERNAL SERVICE CATALOGUE** (owner approval 2026-10-27, final wording rules applied; save status is recorded in the status update at the top)

- **Name:** Booking & Reservation Systems
- **Slug:** `booking-reservation-systems`
- **Work type:** New functionality: custom booking built into a website, or integration with an existing booking solution, depending on needs and platform compatibility
- **Engagement type:** Project
- **Final customer-facing description** (403/500 characters):
  > Custom booking functionality, or integration with an existing booking solution, depending on the business's needs and platform compatibility. Delivered as a project. Support for every website platform or booking scenario is not guaranteed. Not included (unless separately agreed): calendar synchronisation; SMS; online payments; multi-location scheduling; third-party platform fees; ongoing maintenance.
- **Final features** (4/12; longest 33/80 characters):
  - Customer booking flow (21)
  - Availability and scheduling rules (33)
  - Booking confirmations (21)
  - Administrative booking management (33)
- **Standard inclusions:**
  - Customer booking flow
  - Availability and scheduling rules
  - Booking confirmations
  - Administrative booking management
  - Final deliverables agreed according to the selected approach (custom build or integration)
- **Explicit exclusions and scope rules:**
  - Calendar synchronisation, SMS, online payments, multi-location scheduling, third-party platform fees and ongoing maintenance are excluded unless separately agreed
  - No guarantee of support for every website platform or booking scenario
  - No third-party booking platforms are named
- **Evidence required before recommending** (internal; not saved to the service record):
  - The business takes bookings and currently handles them manually (phone, email, messages), confirmed with the business
  - Audit observations never show that bookings are taken or how they are handled
- **Can a website audit support further investigation?** No. The audit cannot show that a business takes bookings or handles them manually. At most, the company's industry in the discovery data might prompt a question, which is not an audit finding. Never an automatic recommendation.
- **Remaining points to confirm:** none outstanding; the owner approved these profiles with the final wording rules.
- **Decision:** ☑ Approved with final wording (2026-10-27)

### A2. Custom E-Commerce Platforms & Online Stores

**APPROVED FOR THE INTERNAL SERVICE CATALOGUE** (owner approval 2026-10-27, final wording rules applied; save status is recorded in the status update at the top)

- **Name:** Custom E-Commerce Platforms & Online Stores
- **Slug:** `custom-e-commerce-platforms-online-stores`
- **Work type:** New-build (a custom online store); payment, shipping and stock links are separate integration scope
- **Engagement type:** Project
- **Final customer-facing description** (496/500 characters):
  > A custom online store, from storefront to checkout, with scope agreed per project. Delivered as a project. Payment gateway integration is explicitly scoped and quoted, within the project or via the separate Payment Gateway Integration service. Checkout is not live or payment-ready until integration and testing are complete. Not included (unless explicitly agreed): shipping integrations; tax automation; stock-system integrations; product migration; photography; marketing; ongoing maintenance.
- **Final features** (5/12; longest 37/80 characters):
  - Storefront (10)
  - Product catalogue (17)
  - Cart and checkout workflow (26)
  - Agreed order management functionality (37)
  - Launch (6)
- **Standard inclusions:**
  - Storefront
  - Product catalogue
  - Cart and checkout workflow
  - Order management functionality as agreed
  - Launch of the store
- **Explicit exclusions and scope rules:**
  - Payment gateway integration is not automatic: it must be explicitly scoped and quoted, either in the project or via Payment Gateway Integration
  - A live checkout is never described as payment-ready until the gateway integration and its testing are complete
  - Shipping integrations, tax automation, stock-system integrations, product migration, photography, marketing and ongoing maintenance are not automatically included
- **Evidence required before recommending** (internal; not saved to the service record):
  - The business sells products, and the current store is missing or clearly limits the business, confirmed with the business
  - Audit observations never indicate an e-commerce need
- **Can a website audit support further investigation?** No. The audit does not detect whether a business sells products or has a store, and no current finding indicates an e-commerce need. It must never suggest this service on its own; it needs evidence from outside the audit. Never an automatic recommendation.
- **Remaining points to confirm:** none outstanding; the owner approved these profiles with the final wording rules.
- **Decision:** ☑ Approved with final wording (2026-10-27)

### A3. Custom Website Design & Development

**APPROVED FOR THE INTERNAL SERVICE CATALOGUE** (owner approval 2026-10-27, final wording rules applied; save status is recorded in the status update at the top)

- **Name:** Custom Website Design & Development
- **Slug:** `custom-website-design-development`
- **Work type:** New-build (bespoke website design and development, delivered as a scoped project)
- **Engagement type:** Project
- **Final customer-facing description** (406/500 characters):
  > Bespoke website design and development for businesses that need a new website, with scope agreed per project. Delivered as a project. Handover does not include training or extensive documentation unless separately agreed. Not included (unless explicitly agreed): content management system; basic SEO setup; hosting and domain registration; copywriting and photography; e-commerce and booking functionality.
- **Final features** (4/12; longest 30/80 characters):
  - Agreed website design (21)
  - Responsive website development (30)
  - Launch (6)
  - Handover (8)
- **Standard inclusions:**
  - Website design as agreed for the project
  - Responsive website development
  - Launch of the finished website
  - Handover to the client
- **Explicit exclusions and scope rules:**
  - Handover does not imply training or extensive documentation unless separately agreed
  - Content management system, basic SEO setup, hosting, domain registration, copywriting, photography, e-commerce and booking functionality are NOT automatically included; each may be added when explicitly agreed
  - No fixed page count and no specific technology are promised
- **Evidence required before recommending** (internal; not saved to the service record):
  - The business has no website, or one that clearly cannot meet its goals, confirmed with the business
  - Audit observations (headers, metadata, attributes, response time) never establish that a new website is needed
- **Can a website audit support further investigation?** Limited. An audit can at most show that a site is unreachable or returns an error status, which may justify checking whether it is broken or abandoned. It cannot show that a new site is needed. Having no website at all is a signal from company data, not from an audit. Never an automatic recommendation.
- **Remaining points to confirm:** none outstanding; the owner approved these profiles with the final wording rules.
- **Decision:** ☑ Approved with final wording (2026-10-27)

### A4. Full-Stack Web Application Development

**APPROVED WITH FINAL WORDING (owner decision 2026-10-27)** (final wording; save status is recorded in the status update at the top)

- **Name:** Full-Stack Web Application Development
- **Slug:** `full-stack-web-application-development`
- **Work type:** New-build (custom application development; technical components depend on the agreed scope)
- **Engagement type:** Project
- **Final customer-facing description** (483/500 characters):
  > Custom web application development, with scope agreed per project. Depending on the agreed scope, components may include the user interface, server-side logic, database, user authentication, access controls, deployment and handover. Hosting and deployment arrangements are decided for each project. Delivered as a project. Not included (unless explicitly agreed): optional integrations; ongoing hosting; maintenance and support; training or extensive documentation; third-party fees.
- **Final features** (6/12; longest 34/80 characters):
  - Agreed application functionality (32)
  - User interface (14)
  - Server-side logic and database (30)
  - Authentication and access controls (34)
  - Deployment (10)
  - Handover (8)
- **Core deliverables:**
  - The application functionality agreed for the project
  - Only those of these components that are agreed: user interface, server-side logic, database, authentication, access controls, deployment
  - Handover to the client
- **Explicit exclusions and scope rules:**
  - Not every project includes every component; each is included only when agreed (the description makes this clear, so the features carry no repeated suffix)
  - Hosting and deployment arrangements are decided for each project; ongoing hosting is not included
  - Optional integrations are kept generic and are separate scope; none are named
  - Maintenance and support are not included
  - Handover does not imply training or extensive documentation unless separately agreed
  - Third-party fees are not included unless separately agreed
- **Evidence required before recommending** (internal; not saved to the service record):
  - A defined requirement or problem the application should solve, confirmed with the business
  - Audit observations never establish a need for a custom application
- **Can a website audit provide relevant evidence?** No. A single-page, read-only audit sees one public page: headers, metadata, a few attributes and response time. It cannot show that a business needs a custom application, and a finding such as an unlabelled form control concerns that page, not an application need. It must never suggest this service on its own. Never an automatic recommendation.
- **Remaining points to confirm:** none outstanding; the owner approved these profiles with the final wording rules.
- **Decision:** ☑ Approved with final wording (2026-10-27)

### A5. Mobile App Development

**APPROVED WITH FINAL WORDING (owner decision 2026-10-27; the owner confirmed that PRIZM.DEV offers both mobile app design and mobile app development)** (final wording; save status is recorded in the status update at the top)

- **Name:** Mobile App Development
- **Slug:** `mobile-app-development`
- **Work type:** New-build (a scoped mobile application; both app design and development are offered, confirmed by the owner)
- **Engagement type:** Project
- **Final customer-facing description** (477/500 characters):
  > Mobile app design (screens and user experience) and development of the agreed functionality. Delivered as a project. Target platforms (iOS, Android or both), development approach, backend and project scope are agreed individually, not assumed. Includes testing within the agreed scope. Submission assistance is optional and given only where agreed; marketplace approval is not guaranteed. Not included (unless separately agreed): app store fees; marketing; ongoing maintenance.
- **Final features** (4/12; longest 40/80 characters):
  - App design (screens and user experience) (40)
  - App development (15)
  - Testing within the agreed scope (31)
  - Submission assistance (where agreed) (36)
- **Core deliverables:**
  - App design: the screens and user experience of the app
  - App development of the agreed functionality
  - Testing within the agreed scope
  - Submission assistance only where explicitly agreed
- **Explicit exclusions and scope rules:**
  - No automatic promise of iOS, Android or both, native or cross-platform development, or a particular backend; each is agreed individually
  - Development, testing and optional submission assistance are separate from actual approval, which belongs to the app marketplace and is not guaranteed
  - Ongoing maintenance, including post-launch maintenance, is a separate arrangement unless separately agreed
  - App store fees and marketing are not included
  - Fixing a website's mobile layout is website work, not app work
- **Evidence required before recommending** (internal; not saved to the service record):
  - An explicit requirement for an app (for example device features, offline use or app-store presence), confirmed with the business
  - Website mobile findings never support this service
- **Can a website audit provide relevant evidence?** No. A single-page audit cannot show that a business needs an app. A missing viewport setting concerns the website's mobile layout, which belongs to website services (for example Technical Remediation or Website Redesign), not to app development. It must never suggest this service on its own. Never an automatic recommendation.
- **Remaining points to confirm:** none outstanding; the owner approved these profiles with the final wording rules.
- **Decision:** ☑ Approved with final wording (2026-10-27)

### A6. Payment Gateway Integration

**APPROVED WITH FINAL WORDING (owner decision 2026-10-27)** (final wording; save status is recorded in the status update at the top)

- **Name:** Payment Gateway Integration
- **Slug:** `payment-gateway-integration`
- **Work type:** Integration (adding an agreed payment provider to a website, store or application; sold independently or as a separately scoped part of an e-commerce project)
- **Engagement type:** Project
- **Final customer-facing description** (492/500 characters):
  > Integration of an agreed payment provider into a website, store or application, on its own or within a separately scoped e-commerce project. Scope is agreed per project. Delivered as a project, with implementation and testing of the agreed payment flow. Not included (unless separately agreed): provider and transaction fees; additional payment features; merchant account approval; regulatory certification. No guarantee of gateway support, provider availability or zero transaction failures.
- **Final features** (3/12; longest 41/80 characters):
  - Agreed payment provider integration (35)
  - Implementation of the agreed payment flow (41)
  - Testing of the agreed payment flow (34)
- **Core deliverables:**
  - Integration of the agreed payment provider
  - Implementation of the agreed payment flow
  - Testing of the agreed payment flow
- **Explicit exclusions and scope rules:**
  - Provider and integration approach are scope-dependent and agreed per project
  - Provider and transaction fees are separate and must be agreed
  - Additional payment features are separate scope and must be separately agreed
  - Merchant account setup or approval is not included and is not guaranteed
  - Regulatory certification is not included
  - No guarantee of gateway support, provider availability or zero transaction failures
  - May be sold independently or as a separately scoped component of an e-commerce project
- **Evidence required before recommending** (internal; not saved to the service record):
  - How the business takes payment today and which provider it will use, confirmed with the business
  - Audit observations never show how a business takes payment
- **Can a website audit provide relevant evidence?** No. The audit does not detect payment methods or providers and cannot show that a business needs a payment integration. A finding such as a page served without HTTPS is a security-configuration observation (Technical Remediation territory), not evidence for this service. It must never suggest this service on its own. Never an automatic recommendation.
- **Remaining points to confirm:** none outstanding; the owner approved these profiles with the final wording rules.
- **Decision:** ☑ Approved with final wording (2026-10-27)

### A7. Website Redesign & Modernisation

**APPROVED FOR THE INTERNAL SERVICE CATALOGUE** (owner approval 2026-10-27, final wording rules applied; save status is recorded in the status update at the top)

- **Name:** Website Redesign & Modernisation
- **Slug:** `website-redesign-modernisation`
- **Work type:** Redesign (redesigning and modernising an existing website)
- **Engagement type:** Project
- **Final customer-facing description** (497/500 characters):
  > Redesigning and modernising an existing website so it looks current and works on all devices. Delivered as a project. Content migration, platform migration and redirect planning depend on the agreed scope and existing website. Small isolated fixes are handled under Technical Remediation. Not included (unless separately agreed): custom application features; copywriting and photography; hosting and domain registration; ongoing maintenance. No search ranking or platform compatibility guarantees.
- **Final features** (3/12; longest 25/80 characters):
  - Agreed redesign (15)
  - Responsive implementation (25)
  - Launch (6)
- **Standard inclusions:**
  - Redesign as agreed for the project
  - Responsive implementation
  - Launch of the redesigned website
- **Explicit exclusions and scope rules:**
  - Small isolated fixes belong under Technical Remediation and do not automatically require a redesign
  - Hosting, domain registration and custom application features are excluded unless separately agreed
  - Content migration, platform migration and redirect planning are included only as far as the agreed scope and the existing website require
  - No promise of search ranking preservation or compatibility with any specific platform
- **Evidence required before recommending** (internal; not saved to the service record):
  - Site-wide evidence (several pages, overall design and technology age) plus the owner's goals
  - Single-page header, metadata, alt-text or label findings are fixable issues and are never sufficient on their own
- **Can a website audit support further investigation?** Limited. A single page showing issues across several unrelated categories, or a missing viewport setting, may justify looking at the whole website (several pages, overall design, platform age, the owner's goals). There is no automatic threshold, and a person decides after viewing the site. Individual header, metadata, alt-text or label findings point to Technical Remediation, not to a redesign. Never an automatic recommendation.
- **Remaining points to confirm:** none outstanding; the owner approved these profiles with the final wording rules.
- **Decision:** ☑ Approved with final wording (2026-10-27)

## B. Eight services that need your input

The text below is a deliberately conservative placeholder. It will be rewritten from your answers, and nothing should be approved until the questions are answered.

### B1. AI Integration & AI-Powered Applications

**FINAL WORDING (commercial direction approved by the owner 2026-10-27; saved only after validation)**

- **Name:** AI Integration & AI-Powered Applications
- **Slug:** `ai-integration-ai-powered-applications`
- **Work type:** New-build or integration (AI features built on existing AI models and APIs)
- **Engagement type:** Project
- **Final customer-facing description** (494/500 characters):
  > AI features for websites and applications, such as assistants, document and data processing, and automation, built on existing AI models and APIs, with scope agreed per project. Client data that external AI providers may process is agreed explicitly; privacy, retention and access needs are addressed in scoping. Delivered as a project. Not included (unless explicitly agreed): model training or fine-tuning; guaranteed AI accuracy; compliance guarantees; hosting; maintenance; AI service fees.
- **Final features** (4/12; longest 48/80 characters):
  - Agreed AI feature scope (23)
  - Integration with existing AI models and APIs (44)
  - Scoping of data, privacy and access requirements (48)
  - Testing within the agreed scope (31)
- **Testing:** standard deliverable, limited to the agreed scope. It does not imply exhaustive testing, penetration testing, certification or defect-free guarantees (internal note; not saved).
- **Scoping and scope rules (internal; not saved):**
  - No automatic POPIA compliance is claimed; "compliance guarantees" is excluded in the text.
  - Which client data may be processed by external AI providers must be agreed explicitly before build.
- **Evidence required before recommending** (internal): a requirement confirmed with the business; audit observations never establish it.
- **Can a website audit provide relevant evidence?** No. A single-page, read-only audit sees one public page and cannot show that a business needs AI features. It must never suggest this service on its own, and findings from unrelated categories never imply a need for it. Never an automatic recommendation.
- **Commercial risks (internal):**
  - Customers may read AI features as accurate or autonomous; the text disclaims guaranteed accuracy.
  - External AI provider fees and terms sit with the client.
  - Data handling by external providers is the main exposure; it is made an explicit scoping and agreement step.
- **Decision:** APPROVED by owner (final wording as above)

### B2. API Development & Third-Party Integrations

**FINAL WORDING (commercial direction approved by the owner 2026-10-27; saved only after validation)**

- **Name:** API Development & Third-Party Integrations
- **Slug:** `api-development-third-party-integrations`
- **Work type:** Integration and new-build (custom APIs and third-party integrations)
- **Engagement type:** Project
- **Final customer-facing description** (406/500 characters):
  > Custom API development and third-party system integrations, with scope agreed per project. Provider compatibility, access and external fees depend on the project. Delivered as a project. Not included (unless explicitly agreed): user interfaces; hosting; ongoing maintenance; third-party fees and licences; guaranteed third-party availability or unchanged provider APIs; training or extensive documentation.
- **Final features** (3/12; longest 31/80 characters):
  - Agreed API or integration scope (31)
  - API or integration development (30)
  - Testing within the agreed scope (31)
- **Testing:** standard deliverable, limited to the agreed scope. It does not imply exhaustive testing, penetration testing, certification or defect-free guarantees (internal note; not saved).
- **Scoping and scope rules (internal; not saved):**
  - No provider, platform or system is named.
- **Evidence required before recommending** (internal): a requirement confirmed with the business; audit observations never establish it.
- **Can a website audit provide relevant evidence?** No. The audit cannot see a business's internal systems or the data they exchange. It must never suggest this service on its own, and findings from unrelated categories never imply a need for it. Never an automatic recommendation.
- **Commercial risks (internal):**
  - Providers can change, restrict or withdraw interfaces after delivery; the text excludes any guarantee of availability or unchanged APIs.
  - Provider access, limits and fees are outside PRIZM.DEV's control.
- **Decision:** APPROVED by owner (final wording as above)

### B3. Business Process Automation

**FINAL WORDING (commercial direction approved by the owner 2026-10-27; saved only after validation)**

- **Name:** Business Process Automation
- **Slug:** `business-process-automation`
- **Work type:** New-build or configuration (custom-coded automation or established automation platforms)
- **Engagement type:** Project
- **Final customer-facing description** (485/500 characters):
  > Automation of repetitive business workflows, using custom-coded automation or established automation platforms. An initial assessment of workflow requirements is part of project scoping, and platform compatibility is assessed per project. Delivered as a project. Not included (unless explicitly agreed): separate process-consulting engagements; organisation-wide change management; hosting; ongoing maintenance; platform licences and subscriptions; training or extensive documentation.
- **Final features** (3/12; longest 40/80 characters):
  - Initial workflow requirements assessment (40)
  - Automation build (16)
  - Testing within the agreed scope (31)
- **Testing:** standard deliverable, limited to the agreed scope. It does not imply exhaustive testing, penetration testing, certification or defect-free guarantees (internal note; not saved).
- **Scoping and scope rules (internal; not saved):**
  - The initial assessment is part of scoping, not a separate comprehensive process-consulting engagement.
  - No automation platform is named.
- **Evidence required before recommending** (internal): a requirement confirmed with the business; audit observations never establish it.
- **Can a website audit provide relevant evidence?** No. A public page cannot reveal a business's internal processes. It must never suggest this service on its own, and findings from unrelated categories never imply a need for it. Never an automatic recommendation.
- **Commercial risks (internal):**
  - Platform-based automation inherits licences, limits and outages of the platform.
  - Clients may expect broad process redesign; the text excludes separate process consulting and change management.
- **Decision:** APPROVED by owner (final wording as above)

### B4. CRM & ERP Systems

**FINAL WORDING (commercial direction approved by the owner 2026-10-27; saved only after validation)**

- **Name:** CRM & ERP Systems
- **Slug:** `crm-erp-systems`
- **Work type:** New-build or integration (custom CRM/ERP development, or configuration or integration of existing systems)
- **Engagement type:** Project
- **Final customer-facing description** (431/500 characters):
  > Custom CRM or ERP development, or configuration or integration of existing systems, subject to feasibility and agreed scope. Access controls and data handling are addressed in project requirements. Delivered as a project. Separately scoped: enterprise-wide implementation; data migration; training; software licences and subscriptions. Not included (unless explicitly agreed): hosting; ongoing maintenance; extensive documentation.
- **Final features** (4/12; longest 62/80 characters):
  - Agreed CRM or ERP scope (23)
  - Development, integration or configuration of the agreed system (62)
  - Scoping of access controls and data handling (44)
  - Testing within the agreed scope (31)
- **Testing:** standard deliverable, limited to the agreed scope. It does not imply exhaustive testing, penetration testing, certification or defect-free guarantees (internal note; not saved).
- **Scoping and scope rules (internal; not saved):**
  - No CRM or ERP product is named.
- **Evidence required before recommending** (internal): a requirement confirmed with the business; audit observations never establish it.
- **Can a website audit provide relevant evidence?** No. The audit cannot see which business systems a company uses. It must never suggest this service on its own, and findings from unrelated categories never imply a need for it. Never an automatic recommendation.
- **Commercial risks (internal):**
  - These projects tend to grow; enterprise-wide implementation, migration, training and licences are stated as separately scoped.
  - Feasibility is a stated condition, which can cause friction if a client wanted a commitment before scoping.
- **Decision:** APPROVED by owner (final wording as above)

### B5. Customer Portals & Admin Dashboards

**FINAL WORDING (commercial direction approved by the owner 2026-10-27; saved only after validation)**

- **Name:** Customer Portals & Admin Dashboards
- **Slug:** `customer-portals-admin-dashboards`
- **Work type:** New-build or addition to existing systems (standalone portals/dashboards or existing-system approach)
- **Engagement type:** Project
- **Final customer-facing description** (473/500 characters):
  > Customer portals and admin dashboards, built as standalone systems or added to existing systems, with scope agreed per project. Authentication, permissions, data protection, security, reporting and integrations are assessed during scoping. No security certification or guarantee is implied. Delivered as a project. Not included (unless explicitly agreed): the underlying business systems; hosting; ongoing maintenance; third-party fees; training or extensive documentation.
- **Final features** (4/12; longest 51/80 characters):
  - Agreed portal or dashboard scope (32)
  - Portal or dashboard development (31)
  - Scoping of authentication, permissions and security (51)
  - Testing within the agreed scope (31)
- **Testing:** standard deliverable, limited to the agreed scope. It does not imply exhaustive testing, penetration testing, certification or defect-free guarantees (internal note; not saved).
- **Scoping and scope rules (internal; not saved):**
  - No specific security certification or guarantee is promised.
- **Evidence required before recommending** (internal): a requirement confirmed with the business; audit observations never establish it.
- **Can a website audit provide relevant evidence?** No. The audit does not detect a need for customer self-service or reporting; a login form or unlabelled field on a public page is unrelated. It must never suggest this service on its own, and findings from unrelated categories never imply a need for it. Never an automatic recommendation.
- **Commercial risks (internal):**
  - Portals expose customer data; clients may expect assurances beyond the agreed scope. The text promises no certification or guarantee.
  - Adding to an existing system depends on that system's design and access.
- **Decision:** APPROVED by owner (final wording as above)

### B6. Database Architecture & Backend Development

**FINAL WORDING (commercial direction approved by the owner 2026-10-27; saved only after validation)**

- **Name:** Database Architecture & Backend Development
- **Slug:** `database-architecture-backend-development`
- **Work type:** Consulting and new-build (architecture consulting and hands-on database and backend implementation)
- **Engagement type:** Project
- **Final customer-facing description** (446/500 characters):
  > Database architecture consulting or hands-on database and backend design and development, with scope agreed per project. Consulting-only engagements are distinct from build projects. Technology selection, migration and deployment are scoped individually. Delivered as a project. Not included (unless explicitly agreed): user interface design; hosting; ongoing maintenance; software licences and subscriptions; training or extensive documentation.
- **Final features** (4/12; longest 44/80 characters):
  - Agreed consulting or build scope (32)
  - Database and backend design (27)
  - Database and backend development (if scoped) (44)
  - Testing within the agreed scope (31)
- **Testing:** standard deliverable, limited to the agreed scope. It does not imply exhaustive testing, penetration testing, certification or defect-free guarantees (internal note; not saved).
- **Scoping and scope rules (internal; not saved):**
  - No database or backend technology is named.
- **Evidence required before recommending** (internal): a requirement confirmed with the business; audit observations never establish it.
- **Can a website audit provide relevant evidence?** No. The audit measures response time and a few page attributes, not data layers. A slow response (e.g. `performance.response_time`) belongs with Technical Remediation, not this service. It must never suggest this service on its own, and findings from unrelated categories never imply a need for it. Never an automatic recommendation.
- **Commercial risks (internal):**
  - Migration carries data-loss and downtime risk; it is scoped individually.
  - Consulting-only work can be mistaken for delivery of a working system; the text separates the two.
- **Decision:** APPROVED by owner (final wording as above)

### B7. SaaS Platform Development

**FINAL WORDING (commercial direction approved by the owner 2026-10-27; saved only after validation)**

- **Name:** SaaS Platform Development
- **Slug:** `saas-platform-development`
- **Work type:** New-build (custom SaaS products built for clients)
- **Engagement type:** Project
- **Final customer-facing description** (482/500 characters):
  > Custom software-as-a-service products built for clients, with scope agreed per project. Subscription billing, multi-tenancy, access controls and integrations are included only when explicitly agreed. Deployment, hosting, maintenance and ongoing operations require explicit agreement. No uptime, scalability or security guarantee without agreed specifications. Delivered as a project. Not included (unless explicitly agreed): third-party fees; marketing; customer support operations.
- **Final features** (3/12; longest 31/80 characters):
  - Agreed product scope (20)
  - Application development (23)
  - Testing within the agreed scope (31)
- **Testing:** standard deliverable, limited to the agreed scope. It does not imply exhaustive testing, penetration testing, certification or defect-free guarantees (internal note; not saved).
- **Scoping and scope rules (internal; not saved):**
  - Deployment, hosting, maintenance and operations are never implied.
- **Evidence required before recommending** (internal): a requirement confirmed with the business; audit observations never establish it.
- **Can a website audit provide relevant evidence?** No. A business's website cannot show that it needs a software product. It must never suggest this service on its own, and findings from unrelated categories never imply a need for it. Never an automatic recommendation.
- **Commercial risks (internal):**
  - Clients often assume hosting, support and billing are included; the text makes each an explicit agreement.
  - No uptime, scalability or security promise is made without agreed specifications.
- **Decision:** APPROVED by owner (final wording as above)

### B8. Ongoing Maintenance & Technical Support

**EARLIER DRAFT, SUPERSEDED by the finalised and saved text in the status update at the top**

- **Name:** Ongoing Maintenance & Technical Support
- **Slug:** `ongoing-maintenance-technical-support`
- **Engagement type:** Recurring
- **Proposed customer-facing description** (198/500 characters):
  > Ongoing care for an existing website or application, so it stays up to date and reported issues are looked after. Provided as an ongoing arrangement. Not included: new feature development; redesign.
- **Proposed features** (4/12; longest 31/80 characters):
  - Routine updates
  - Fixes for reported issues
  - Small content or design changes
  - Support requests
- **Scope exclusions:** new feature development; redesign
- **Evidence required before recommending:**
  - The owner's access to the site and its current setup
  - Whether a recurring arrangement suits better than a one-off fix
- **Assumptions to confirm:**
  - Every feature listed is provisional until you tick what is included (Q1)
  - No hours, response times or service levels are stated unless you ask for them (Q3)
- **Questions for you:**
  - **Q1.** Tick what is included: software and security updates, bug fixes, small content or design changes, monitoring, backups, hosting management, other (name it).
  - **Q2.** Is this a recurring arrangement only, or do you also accept one-off fixes under this service? (This decides whether Technical Remediation is needed.)
  - **Q3.** Do you want any hours or response times stated? Default: none stated.
- **Decision:** ☐ Approve as written  ☐ Approve with edits  ☐ Hold

**Total questions in Part B: 15.** The most consequential is Ongoing Maintenance Q2 (recurring only, or one-off fixes too), because it decides whether Technical Remediation is needed.

## C. Technical Remediation (earlier proposal; now created, see status update above)

_Historical note: this section is the earlier proposal. The finalised text is in the status update at the top; the service now exists with a generated slug and has no mapping or finding link._

### C1. Technical Remediation

**EARLIER DRAFT, SUPERSEDED by the status update above**

- **Name:** Technical Remediation
- **Slug:** _not assigned_
- **Engagement type:** One-off, fixed scope agreed per engagement
- **Proposed customer-facing description** (381/500 characters):
  > One-off, fixed-scope fixes for specific issues found on an existing website, such as missing security headers, page titles or descriptions, image alt text or form labels. Delivered as a one-off job; the fixes are agreed before work starts. Not included: redesign; new features; ongoing maintenance; accessibility certification or security testing; guarantees about search rankings.
- **Proposed features** (4/12; longest 34/80 characters):
  - Agreed list of fixes
  - Implementation of the fixes
  - Before-and-after check of each fix
  - Short handover note
- **Scope exclusions:** redesign; new features; ongoing maintenance; accessibility certification or security testing; guarantees about search rankings
- **Evidence required before recommending:**
  - Findings confirmed in context (audit output is an observation, not a diagnosis)
  - Authorised access to the site's hosting or content system
  - A small, well-understood list of issues
- **Assumptions to confirm:**
  - You are willing to do one-off fixes (B, Ongoing Maintenance, Q2)
  - The example issues in the text are fixes you can actually deliver; remove any you cannot
  - Resolved: the service was created through the Settings add form, which generated the slug technical-remediation-e15e2e
  - Not mapped to any finding or opportunity type
- **Decision:** ☐ Approve as written  ☐ Approve with edits  ☐ Hold

## What has not been done

- No service record, description, feature list, price or slug was created or changed, and the service editor is still empty.
- No mapping flag, snapshot, opportunity or audit was changed, and audits, AI and outreach remain disabled.
- Nothing is committed or deployed. After you approve, each service's text would be entered through the Settings editor one service at a time, as a separate step.
