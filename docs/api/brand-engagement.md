# Brand engagement

These endpoints support priority invites (#997), cohort retention (#996), persistent
challenge discussions (#995), and challenge duplication (#1014). URLs below include
the `/api` prefix added by the reverse proxy. Direct requests to Express omit it.
Request and response schemas are also available in the generated OpenAPI document.

## Priority invites

The brand owner generates a random code with `POST /api/brands/:id/invite-codes`:

```json
{
  "challengeId": "11111111-1111-4111-8111-111111111111",
  "maxUses": 10,
  "expiresAt": "2027-01-31T23:59:59Z"
}
```

Every field is optional. Omitting `challengeId` scopes the code to the whole brand;
an included challenge must belong to that brand. Omitted expiry and usage limits mean
no expiry and unlimited redemptions. `maxUses` must be an integer from 1 to 100,000.
Expiry must be in the future. The response is `201 { inviteCode }`.

`GET /api/brands/:id/invite-codes` returns `{ data, nextCursor }`, up to 100 codes
at a time, newest first. Pass `?cursor=...` for older codes. Owners can see the code,
scope, expiry, maximum uses and current use count in the dashboard.

A player first joins the existing waitlist with their account email, signs in, then
submits `POST /api/waitlist/redeem-code` with `{ "code": "..." }`. Codes are
case-insensitive. The email is looked up from the authenticated account; the caller
cannot choose another email. Success returns:

```json
{
  "status": "active",
  "brandId": "22222222-2222-4222-8222-222222222222",
  "challengeId": null
}
```

Redemption activates early access in `waitlist`, removes the entry from the waiting
FIFO positions, and records `waitlist.invite_redeemed` in `audit_log`. It does not
change account suspension, challenge start dates, or challenge funding eligibility.
The code's scope identifies the issuing campaign; early access itself is account-wide.

Capacity checks, redemption records, activation and the audit insert share a
transaction. Repeating a successful redemption with the same user/code succeeds
without another use or audit entry, even if the code has since expired or exhausted
its capacity. Codes belonging to deleted brands/challenges cannot be redeemed.
Suspended accounts are always rejected. Invalid codes return 404, expired codes 410,
exhausted codes 409, and accounts not enrolled with their own email 403. Existing
waitlist request limits apply. `GET /api/waitlist/access` returns the signed-in
account's `waiting`, `active`, or `not_enrolled` state across page reloads.

## Weekly cohort retention

`GET /api/brands/:id/retention` requires at least viewer access to the brand and returns:

```json
{
  "challengeCount": 2,
  "cohorts": [
    {
      "cohort_week": "2026-10-05",
      "cohort_size": 10,
      "week_offset": 0,
      "retained_users": 10,
      "retention_pct": 100
    },
    {
      "cohort_week": "2026-10-05",
      "cohort_size": 10,
      "week_offset": 1,
      "retained_users": 4,
      "retention_pct": 40
    }
  ]
}
```

- Cohorts use a player's first session week for the brand, starting Monday in UTC.
- Week 0 represents the initial cohort. Later weeks count distinct players who
  participate in a different challenge from their cohort week.
- Practice sessions, flagged sessions, null user IDs, future-dated sessions, drafts,
  and soft-deleted challenges are excluded. Data comes from live session tables;
  archived participation is not included.
- The chart includes zero-return weeks through the current week, with a maximum
  of 12 weeks after week 0. Future weeks are absent, rather than shown as 0%.
  The current week is partial.
- Fewer than two non-draft challenges, or no eligible participants, returns an
  empty `cohorts` array and a helpful dashboard message.

Brand-filtered challenge and covering session indexes support the aggregation.
No additional analytics service or chart dependency is required.

## Challenge discussion

`GET /api/challenges/:id/comments?limit=20&cursor=...` is public and returns
`{ data, nextCursor }`. Each comment includes its ID, challenge ID, author ID and
display name, plain-text body, and creation/update timestamps. The page size is
1–100 (default 20). Pagination preserves timestamp precision and breaks ties by ID.

`POST /api/challenges/:id/comments` requires an active authenticated account and
accepts `{ "body": "Your comment" }`. Bodies are trimmed and limited to 1–2,000
characters. Success returns `201 { comment }`.

The existing fraud-flag utility rejects accounts under fraud review. Basic profanity,
excessive links and repeated characters are rejected with 422. Identical text within
one minute, or more than five comments per minute across challenges, returns 429.
Per-author database locks serialize spam checks across concurrent requests and
server processes. The UI renders text through React without interpreting HTML.

Draft or soft-deleted challenges return 404. A database trigger removes all comments
when a challenge is soft-deleted, including deletion paths outside the API. A share
lock prevents comment insertion from racing that cleanup. Hard deletion cascades.

The discussion is available before gameplay and on the results screen, alongside
the existing ephemeral live chat. Errors preserve an unsent comment for editing.

## Duplicate and fund a challenge

`POST /api/challenges/:id/duplicate` requires the source brand's direct owner and
returns `201 { challenge }` with a new `draft` challenge.

The transaction reuses the challenge creation query and copies the requested prize
pool, player limit, payout schedule, licensing obligations, questions, tags, variant
configuration and tier rules. Optional legacy configuration tables are copied when
installed. Variant status resets to active; results are not copied. The new challenge
has a fresh identifier, no start/end dates or deposit memo, no escrow/deposit/payout
transaction references, zero participants and no sessions, scores, payouts or comments.
The operation records `challenge.duplicated` in `audit_log`.

The dashboard's **Duplicate** button adds the draft to the challenge list. Use
**Set dates & fund** to submit:

```text
POST /api/challenges/:draftId/publish-draft
{ "startsAt": "2027-02-01T12:00:00Z", "endsAt": "2027-02-01T14:00:00Z" }
```

Publishing requires current terms acceptance, ownership, a future start, a duration
of at least one hour and a pool of at least 100 USDC. It transitions only a draft to
`pending_deposit` and returns `{ challenge, depositInstructions }` with a fresh memo.
Fund using the existing deposit flow; scheduling alone never activates a challenge.
Publishing an already scheduled draft returns 409. Other brands and delegated editors
cannot duplicate or publish it.

## Database upgrade and verification

Apply API migrations `00036`–`00039` to an initialized database using the normal
migration runner. They add invite/redemption records and waitlist access state,
retention indexes, comment storage/cleanup and the draft status/date constraints.
Rollback files are included. The draft rollback refuses to run while drafts remain,
so an operator must first resolve them; it does not silently discard configuration.

The runner orders mixed historical four-digit and newer five-digit sequences
numerically, with filename tie-breaks. Applied filenames are preserved.

The new PostgreSQL integration suite creates and drops its own schema using
`DATABASE_URL`; it never resets the target database. Runtime test defaults are in
`apps/api/.env.test` and are deliberately fake. Override `DATABASE_URL` to point to
an isolated local database, then run:

```bash
pnpm exec vitest run --project @brandblitz/api apps/api/src/routes/brand-engagement.integration.test.ts
pnpm exec vitest run --project @brandblitz/web apps/web/src/components/challenge/brand-engagement.test.tsx
pnpm --filter @brandblitz/api migrate:lint
pnpm --filter @brandblitz/api gen:openapi
```

The database tests exercise capacity races, idempotent retries, audit rollback,
retention calculations/index plans, tied-timestamp pagination, spam races,
soft-delete cleanup, ownership, duplication and all four migration round trips.
