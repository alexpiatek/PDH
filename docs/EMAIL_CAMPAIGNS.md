# Email campaigns

Administrators can save drafts, preview, send a test, explicitly confirm a subscriber send,
and cancel remaining queued messages at `/admin/analytics`. All APIs use the same Nakama
administrator allowlist. Messages are plain text; recipient addresses are never shared.

## Setup

1. Apply `db/migrations/0004_email_campaigns.sql` to the signup database using the existing
   migration workflow. Run migrations before deploying the updated signup-list query.
2. Verify `admin@bondipoker.com` as an allowed sender with the SMTP provider. Configure the
   provider's SPF/DKIM records. Receiving or forwarding email alone is not SMTP sending access.
3. Set the following **server-only** variables in `apps/web/.env.local`:

```dotenv
CAMPAIGN_SEND_ENABLED=false
CAMPAIGN_SMTP_HOST=
CAMPAIGN_SMTP_PORT=587
CAMPAIGN_SMTP_SECURE=false
CAMPAIGN_SMTP_USER=
CAMPAIGN_SMTP_PASS=
CAMPAIGN_PUBLIC_ORIGIN=https://play.bondipoker.online
```

For Google Workspace, use `CAMPAIGN_SMTP_HOST=smtp.gmail.com`, port `587`,
`CAMPAIGN_SMTP_SECURE=false`, and `CAMPAIGN_SMTP_USER=admin@bondipoker.com`.
Use an app password for that mailbox in `CAMPAIGN_SMTP_PASS` if the Workspace
administrator permits app passwords and the account has 2-Step Verification enabled.
Do not use the ordinary mailbox password or paste credentials into chat. If the
organization disables app passwords, configure an approved SMTP relay or OAuth transport
before enabling sends; this implementation currently uses SMTP username/password auth.

Google setup reference: https://support.google.com/a/answer/176600

The sender and reply-to are `admin@bondipoker.com`. The footer identifies Bondi Poker and
its contact email, with an unsubscribe link; no postal address is included. Campaign credentials are deliberately
separate from signup notification credentials. Enable sending only after the sender is verified
and the provider permits mailing-list traffic. Restart the web and worker after configuration.

4. Run `pnpm exec tsx apps/web/scripts/campaign-worker.ts` as a persistent service. Adapt
   `deploy/pdh-campaign-worker.service.example` to the active checkout and installed pnpm path.
   The worker must use the same signup database and environment as the web service. It handles
   at most 10 recipients per batch, waits 60 seconds between batches, and uses a database lock
   to prevent overlapping workers. Respect the SMTP provider's daily limits.
5. In Email Signups, uncheck **Include in Updates** for test addresses (including `test@123.com`)
   and unwanted contacts. An unsubscribe can never be reversed with this checkbox.
6. Save a draft, send yourself a test and check its sender/inbox placement. Then review the
   current subscriber count and confirm sending. The worker continues after the browser closes.

## Delivery behavior

Queued content cannot be edited. Eligibility is checked again immediately before each send.
Unsubscribe links open a confirmation page; GET requests do not unsubscribe. The one-click
unsubscribe endpoint accepts POST using the secret per-subscriber token.

Counts show SMTP **acceptance**, not delivery or opens. Provider rejection is recorded as failed;
ambiguous transport failures and interrupted attempts are marked uncertain and never retried
automatically, preventing accidental duplicates. Inspect the provider before manually preparing
another campaign. Cancellation stops pending sends; an in-flight message can still be accepted.

This SMTP version has no automatic bounce/complaint webhook. Review provider bounce reports
and exclude those contacts in Email Signups. For larger lists, integrate a campaign provider's
bounce/complaint webhook and rate limits before scaling up.

## Verification

Unit tests: `pnpm exec vitest run apps/web/tests/campaignsApi.test.ts`.
Integration tests require a **disposable** database: set `CAMPAIGN_TEST_DATABASE_URL` and run
`pnpm exec vitest run apps/web/tests/campaigns.integration.test.ts`. These tests truncate their
test database tables and mock SMTP; never point them at production or the regular signup DB.

## Private production credential setup

Create a separate Google app password for `admin@bondipoker.com`, then run this in your own terminal:

```sh
ssh -t -o Hostname=5.223.42.187 -o HostKeyAlias=bondipoker.online pdh-root 'python3 /home/pdh/PDH/deploy/configure-campaign-email.py'
```

The prompt hides input. The script verifies SMTP login without sending mail, saves the
credential in the server-only environment, restarts the web service, and enables the
installed worker. Never paste credentials into chat. Use **Send Test** in Email Updates
before explicitly confirming a subscriber campaign.
