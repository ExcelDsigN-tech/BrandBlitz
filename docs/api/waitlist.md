# Waitlist API

The waitlist API lets users join the BrandBlitz waitlist and track their live position in line.

## POST /waitlist

Join the waitlist. Duplicate emails are silently ignored (idempotent).

### Rate Limiting

Protected by `waitlistLimiter`: **5 requests per hour per IP**. Exceeding this returns a `429` response.

### Request Body

| Field           | Type             | Required | Description                                                              |
| --------------- | ---------------- | -------- | ------------------------------------------------------------------------ |
| `email`         | string (max 254) | Yes      | Valid email address. Normalised to lowercase and trimmed before storage. |
| `referral_code` | string (max 64)  | No       | Referral code from another user's invite link                            |

### Example Request

```bash
curl -X POST https://api.brandblitz.io/waitlist \
  -H "Content-Type: application/json" \
  -d '{"email": "alex@example.com", "referral_code": "ABC123"}'
```

### Response

**201 Created** — first signup

```json
{ "message": "You're on the list!", "id": "6f1c2c1e-2f5b-4d1a-9b7e-0d3c2b1a0f9e" }
```

`id` is the entry's private token for `GET /waitlist/:id/position`. Store it
client-side; it is returned only once.

**201 Created** — duplicate email (idempotent, no error, no `id`)

```json
{ "message": "You're on the list!" }
```

### Error Responses

| Status | Body                                                              | Trigger                                |
| ------ | ----------------------------------------------------------------- | -------------------------------------- |
| `422`  | `{ "error": "Invalid email address", "code": "INVALID_EMAIL" }`   | Malformed email (fails Zod validation) |
| `429`  | `{ "error": "Too many signup attempts, please try again later" }` | Rate limit exceeded (5 req/hr/IP)      |

---

## GET /waitlist/:id/position

Live queue position and estimated wait for one entry (#1046). The web page
polls this every 30 seconds.

There's no login on the waitlist, so the unguessable entry `id` from
`POST /waitlist` is the access check. The old `GET /waitlist/position/:email`
was removed because anyone could look up anyone's position by email.

### Rate Limiting

Protected by `apiLimiter`: dynamic rate limit per user/IP over a 15-minute window.

### Example Request

```bash
curl https://api.brandblitz.io/waitlist/6f1c2c1e-2f5b-4d1a-9b7e-0d3c2b1a0f9e/position
```

### Response

**200 OK**

```json
{ "activated": false, "position": 42, "estimatedWaitSeconds": 1814400, "throughputPerDay": 2 }
```

| Field                  | Description                                                                                                                                            |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `activated`            | `true` once the entry has been let in (`waitlist.activated_at` set).                                                                                   |
| `position`             | 1-based place among entries not yet activated, in join order. `null` once activated.                                                                   |
| `estimatedWaitSeconds` | `position / throughputPerDay`, in seconds. `null` when nobody was activated in the window, since there's no basis for an estimate. `0` once activated. |
| `throughputPerDay`     | Activations over the last 7 days divided by 7.                                                                                                         |

### Error Responses

| Status | Body                                                       | Trigger                 |
| ------ | ---------------------------------------------------------- | ----------------------- |
| `404`  | `{ "error": "Waitlist entry not found" }`                  | Unknown or malformed id |
| `429`  | `{ "error": "Too many requests, please try again later" }` | Rate limit exceeded     |

---

## Notes

- The waitlist signup page is at [`apps/web/src/app/waitlist/page.tsx`](../../apps/web/src/app/waitlist/page.tsx).
- Entries live in the `waitlist` table. Position counts entries with `status = 'waiting'` in `created_at` order; throughput counts `activated_at` values in the window. Redeeming an invite code (`POST /waitlist/redeem-code`) sets `status = 'active'` and `activated_at` (migration `00036-priority-invite-codes.sql`; the throughput index is `00041-waitlist-activated-at-index.sql`).
- Both endpoints are public. The position endpoint is scoped to its entry by the private `id`.
