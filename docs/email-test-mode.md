# TEST-ONLY transactional email (temporary)

> **TEST-ONLY. NOT production-ready email delivery.** This configuration exists to exercise the real Resend integration at no cost until `auth.hoax1g.dev` is purchased and verified. It can only reach an allowlist of addresses you own, every message is marked `[TEST-ONLY]`, and the server refuses to start with it in a Production environment.

## How it works

| Safeguard | Where | Behaviour |
|---|---|---|
| Recipient allowlist | `src/server/auth/email-delivery.ts` (one send function used by verification, password reset, account status and the administrator notification) | A recipient not on `AUTH_EMAIL_TEST_ALLOWLIST` is never sent to. The call fails with `TestModeRecipientBlockedError`, an `email_test_recipient_blocked` security event is recorded (hashed identifier only), and the existing failure path voids the token. |
| Exact matching | `src/modules/auth/email-test-mode.ts` | Case-insensitive exact address only. No wildcards, domains or plus-address expansion. |
| Visible marking | same | Subject prefixed `[TEST-ONLY] `; HTML and text bodies carry a TEST-ONLY banner. |
| Fail-closed startup | `src/config/env.ts` | Test mode requires provider `resend`, sender on `resend.dev`, a non-empty valid allowlist, and `ADMIN_NOTIFICATION_EMAIL` on the allowlist. Test mode and the `resend.dev` sender are **refused when `VERCEL_ENV=production`**, and the test sender is refused whenever test mode is off. |
| Unchanged | | Account approval, token hashing, expiry, single use, rate limits and session invalidation are untouched. |

Effect: while test mode is on, **only allowlisted addresses can receive mail**. Other registered users cannot verify, reset or receive status emails; that is intentional.

## Preview-only variables (branch-scoped in Vercel; enter secrets yourself)

| Variable | Value |
|---|---|
| `AUTH_EMAIL_TEST_MODE` | `true` |
| `AUTH_EMAIL_TEST_ALLOWLIST` | the verified email address of the owner's Resend account (the only address Resend's test sender can reach) |
| `AUTH_EMAIL_PROVIDER` | `resend` |
| `AUTH_EMAIL_FROM` | `PRIZM.DEV <onboarding@resend.dev>` |
| `ADMIN_NOTIFICATION_EMAIL` | the same address as the allowlist |
| `RESEND_API_KEY` | a **separate Preview-only, sending-access key**, Sensitive, scoped to the Preview branch |

**Never** reuse the unscoped `RESEND_API_KEY` entry that currently targets Production, Preview and Development together, and never set these variables for the Production target.

## Isolation checklist (before any live send)

1. The Preview branch has its **own** `DATABASE_URL`, pointing at a disposable database (not the Production database). Confirm with a read-only diagnostic run by the owner; do not rely on names.
2. The Preview `RESEND_API_KEY` is branch-scoped and different from Production's (compare in the Resend dashboard by key name and last characters, never by value in chat).
3. `CAMPAIGN_DELIVERY_ENABLED`, `WEBSITE_AUDIT_ENABLED` and `AI_GENERATION_ENABLED` are `false` and `DEV_AUTH_BYPASS` is `false` for the Preview branch.
4. The deployment reports test mode: signing up with a non-allowlisted address must send nothing (check Resend's log: no message).

## Live acceptance steps (owner mailbox only, fictional account name)

1. Sign up with the allowlisted address: expect a `[TEST-ONLY]` verification email; verify once; the link must fail on reuse.
2. Expect the administrator notification (to the same address); approve the account in `/app/admin/users`; expect the status email.
3. Request a password reset: expect the email; reset once; the link must fail on reuse. Reset links expire in 30 minutes, verification links in 24 hours.
4. Sign up with a second, non-allowlisted fictional address: expect **no** email and an `email_test_recipient_blocked` security event.
5. Record evidence (headers, screenshots, event rows) without any key or token values.

Real delivery is not "working" until step 1 to 3 are observed in the mailbox.

## Migration to `auth.hoax1g.dev` (after the domain is purchased)

1. Purchase `hoax1g.dev`; note where DNS is managed.
2. In Resend add `auth.hoax1g.dev`; publish the SPF, DKIM and return-path records Resend shows; add `_dmarc.auth.hoax1g.dev` (`v=DMARC1; p=none; rua=mailto:<mailbox>` to start); wait for **Verified**.
3. Create separate sending-access keys: one for Preview, one for Production (Sensitive, correctly scoped).
4. **Preview first:** set `AUTH_EMAIL_FROM=PRIZM.DEV <no-reply@auth.hoax1g.dev>`; **delete** `AUTH_EMAIL_TEST_MODE` and `AUTH_EMAIL_TEST_ALLOWLIST`; keep `ADMIN_NOTIFICATION_EMAIL` as the real admin mailbox. (Leaving the resend.dev sender with test mode off is refused at startup by design.)
5. Repeat the live acceptance steps with the real sender, then check message headers show SPF, DKIM and DMARC pass.
6. Only with separate approval: set the same variables for Production using the Production key, and verify.
7. Remove this document's TEST-ONLY variables from every environment and keep the code (it is inert when the variables are absent).

## Rollback

Remove the Preview variables (or set `AUTH_EMAIL_TEST_MODE=false` together with a verified sender). With no email variables at all the app degrades to "delivery unavailable" without errors.
