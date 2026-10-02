# CLAUDE.md — LabDesk

Lab & Equipment Booking and Utilization System for a college department.

This file is the authoritative spec. Follow it. If something here is ambiguous, ask before inventing behaviour.

---

## 1. Product summary

Departments allocate labs, rooms and equipment over WhatsApp and a paper register. This causes double-booking, no visibility into real utilization, and no accountability for damage.

LabDesk provides:

- Conflict-free slot booking with a database-level guarantee
- A configurable approval workflow (student → faculty → lab in-charge)
- QR check-in/out that records **actual** usage against **booked** usage
- Maintenance windows and incident logging
- Utilization analytics that surface idle equipment and no-show patterns
- Per-user ICS calendar feeds

Primary users: students, faculty, lab in-charges, department admin.

---

## 2. Non-negotiable technical requirements

These define the project. Do not substitute simpler approaches.

1. **Overlap prevention must be enforced by PostgreSQL**, using `tstzrange` + `EXCLUDE USING gist`. Application-level check-then-insert is explicitly forbidden.
2. **All timestamps are `timestamptz`, stored in UTC.** Rendering to local time happens only in the UI layer.
3. **Authorization is centralized** in a single policy module. No inline role checks in route handlers.
4. **Booking creation is idempotent** via a client-supplied `Idempotency-Key` header.
5. **Integration tests run against a real PostgreSQL** (Testcontainers), never a mock or SQLite.
6. There must be a test that fires **50 concurrent booking requests** at one slot and asserts exactly one succeeds and 49 receive a `409 SLOT_CONFLICT`.

---

## 2b. Settled scope decisions

These were debated and closed. Do not reopen them mid-build; if a phase seems to need one reversed, stop and ask.

**Onboarding — open signup, admin promotes.**
Anyone may register. New accounts default to `role = 'student'` and `is_active = true`. Only an admin can change a role. A seed script creates one bootstrap admin from `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` env vars. No invite system, no email-domain allowlist in v1 (leave a `TODO` comment where the domain check would go).

**No team bookings.**
A booking has exactly one accountable user — the booker. Group usage is represented only by `attendee_count`. Do **not** create a `booking_members` table. If a team needs to book, one member books and is responsible.

**Department scoping is enforced.**
A user may only view and book resources whose `department_id` matches their own. Admins see all departments. This is checked in the policy layer, not by filtering in the UI. Seed data must include two departments so the scoping is actually demonstrable.

**Same-day bookings only.**
A booking's `period` must start and end on the same calendar date in IST — reject violations with `MULTI_DAY_NOT_SUPPORTED` (422). Separately, it must not exceed the resource's `max_slot_minutes` (`SLOT_TOO_LONG`) or fall below `min_slot_minutes` (`SLOT_TOO_SHORT`). These are distinct rules with distinct codes. Multi-day equipment loans are documented as future work in the README — do not build them.

---

## 2c. Amendments ratified after Phase 1

These supersede anything earlier in this file that conflicts with them.

**Schema additions.** `refresh_tokens` (id, user_id, family_id, rotated_at, revoked_at, expires_at) is part of the model — reuse detection requires it. The row's `id` **is** the JWT ID (`jti`) and serves as the lookup key; **the token itself is never stored, in any form, hashed or otherwise.** A database leak must not yield anything replayable, since validity still depends on the signing secret. Extensions enabled: `btree_gist`, `pgcrypto`, `citext`.

**Audit log.** `audit_log` (id, actor_id nullable, entity_type, entity_id uuid, action, before jsonb, after jsonb, created_at). `writeAudit()` is exposed **only** on transaction-scoped repositories, so calling it outside a mutation's transaction is a compile error. Take a `SELECT … FOR UPDATE` row lock before capturing the `before` snapshot. Snapshots recursively drop any key containing `password`, `secret` or `token`. No-op changes are still logged. The table is append-only, enforced by a `BEFORE UPDATE OR DELETE` trigger that raises.

**Cross-department listing** (`GET /api/resources?departmentId=<other>`) returns 403 FORBIDDEN, not 404 — department IDs are public, so there is no existence to conceal. The 404 rule below applies to individual resources only.

**Advisory lock before booking insert.** The exclusion constraint alone deadlocks under burst contention: concurrent inserts each block on the others' uncommitted rows, and Postgres resolves deadlocks roughly once per second, producing 500s and multi-second latency. `BookingRepository.insert` therefore takes a per-resource **transaction-scoped** advisory lock immediately before the INSERT, using the **two-argument** form so the lock carries a namespace: `pg_advisory_xact_lock(19524, hashtext(resource_id::text))`, where 19524 (`0x4c44`) is the booking-insert namespace. Both arguments must be `int4` — do not use `hashtextextended`, which returns `bigint` and forces the namespace-less one-argument form. `hashtext` collisions within the namespace are harmless: two resources sharing a key only serialize briefly, never incorrectly. Any future advisory lock elsewhere in the codebase must claim its own namespace rather than sharing this key space. The lock only serializes inserts per resource — it performs no overlap checking. The exclusion constraint remains the sole mechanism that rejects overlaps, and a test must prove this by removing the constraint while keeping the lock and observing the concurrency test fail.

**Additional error codes:** `SLOT_TOO_SHORT` (422), `CAPACITY_EXCEEDED` (422, capacity 0 means unlimited), `IDEMPOTENCY_KEY_REUSED` (422, same key with a different body), `INVALID_TRANSITION` (409).

**Booking visibility.** `booking:view` is granted to the booker, the resource's owners, and admins. Everyone else receives 404. Listing applies the same rule. The availability endpoint returns busy intervals and their status only — never the identity of the booker — and accepts a window of at most 31 days.

**Admins may not book outside their department.** They can see the resource, so they receive `WRONG_DEPARTMENT` (403); students cannot see it, so they receive 404.

**Approval level lives on the owner, not derived from role.** `resource_owners` gains `approval_level` (1 or 2), set via `PATCH /api/resources/:id/owners`. A resource's required approval levels must each keep at least one owner (`OWNER_REQUIRED`, 422) — this applies to resource create, update, and owner changes alike, so enabling approval on an owner-less resource is also refused.

**Bookings on a resource with `requires_approval = false` are created directly as `approved`,** with no approval rows. `requires_approval` means what it says.

**Owner management (`resource:manage_owners`) is admin-only,** consistent with resource creation and role changes — adding an owner grants approval power, which is a privilege escalation action.

**Two-level approval stall handling (no background job required in Phase 3):** a booking flagged stalled in the inbox once level 1 has approved and level 2 has not acted for 24 hours, sorted by start time. Approving after the booking's start time returns 409; rejecting remains allowed and the inbox marks it lapsed. The booker may cancel a pending booking at any time. Closing lapsed pending bookings automatically is Phase 4's worker's job, not Phase 3's.

**Admins decide approvals only within their own department** — another department's admin gets `WRONG_DEPARTMENT`, consistent with the admin-booking rule above.

**`POST /api/resources` takes `owners: [{ userId, approvalLevel }]`**, not a bare list of IDs. `GET /api/bookings/:id` includes the approval trail and which level is currently awaiting a decision.

**Known, accepted gaps carried into Phase 4+:** a resource's approval levels dropping from 2 to 1 while a booking awaits level 2 leaves that booking undecidable until its start time (cancellable in the meantime); a deactivated or demoted owner loses approval power but the owner row itself persists.

**Scheduled job locking uses Redis, not Postgres advisory locks.** Each job acquires `SET lock:<job-name> <run-id> NX PX <ttl-ms>` before running and releases it (checking the value matches, to avoid releasing a lock another run since acquired) on completion. The TTL must comfortably exceed the job's expected run time, so a crashed worker's lock self-expires rather than starving every future run. This differs deliberately from the booking-insert lock: that one needs transaction scope tied to a single INSERT, which Postgres advisory locks fit naturally; a periodic job spanning many rows and an unbounded duration needs a lock that survives a crash on its own, which is what Redis's native TTL gives for free.

**Check-in window is `[start − 15min, start + 15min]`, not the whole booking ±15.** The no-show sweeper marks `no_show` at exactly `now > start + 15min`, so check-in closes at that same instant — tying the window to the sweeper's own boundary avoids the window's edge depending on when the sweeper last happened to run. Check-out stays open until `end + 15min`, where the auto-complete job takes over.

**`checkins` has separate check-in and check-out method/overrider columns** (`checkout_method`, `checkout_overridden_by`, alongside the existing check-in pair) — a session can be opened by QR and closed by manual override or vice versa, and Phase 6 utilization needs to distinguish a real check-out from an auto-completed one.

**Manual-override permission is checked before booking-state.** An earlier draft checked state first, which leaked a booking's status to a user with no permission to see it via the error message. Permission always gates first, before any state-specific error can reveal anything.

**Lapsed pending bookings (approved at level 1, no further action) are moved to `rejected` by a dedicated job**, not left pending indefinitely — this closes the gap Phase 3 deferred. `actor_id` is null and the audit action is `booking.expired`, distinguishing "nobody decided in time" from a booker's own cancellation.

**Override limits:** staff cannot override their own booking; admins may only override within their own department, consistent with the approval rule.

**`PUBLIC_APP_URL`** (in `.env.example`) is embedded in every generated QR code. Changing it after resources have printed QR codes invalidates them — treat it as effectively immutable once resources are in real use.

**Overlapping check-in windows: one scan, one action, never chained.** When an active session and the next booking's window overlap, a scan checks out the active session and stops — it does not also check the user into the following booking in the same request. Checking into the next booking requires a separate, later scan. Known UX gap, not a safety issue: that follow-up scan's success panel reads identically to any ordinary check-in, with nothing distinguishing "you've just been checked into a different booking than the one you expected." Worth a distinct message eventually; not urgent.

**Waitlist promotion is best-fit, not strict FIFO.** An older waiting entry whose desired window doesn't match the slot that just freed does not block a newer entry that does fit — it remains waiting and is reconsidered the next time a slot frees. The alternative (strict order blocking on a mismatched entry) would leave freed capacity idle, which contradicts the project's purpose. A promoted booking is created through the same insert path as any other booking — full exclusion-constraint and advisory-lock protection — and starts `pending` or `approved` per the resource's `requires_approval`, never auto-approved.

**A waiting entry auto-expires once its desired window's start time passes** without promotion, consistent with the lapsed-pending-booking rule from Phase 3.

**Series creation books the first pass of occurrences immediately, not only via the nightly materializer** — otherwise the creator sees nothing happen until the next 00:15 run. The materializer subsequently extends the series out to `booking_horizon_days` nightly, tracking its last-handled occurrence so concurrent or repeated runs never double-book.

**A materialization conflict skips only that occurrence and continues the series**, recorded in a `booking_series_skips` table and surfaced via `GET /api/series/:id`. Skipped occurrences are not retried even if the slot later frees. **Known asymmetry, unresolved:** a paused series (booker deactivated, moved department, or resource inactive) records nothing — no skip, no audit trail — unlike a genuine slot conflict. Bring these into parity in a later phase so `GET /api/series/:id` reflects the full reason history, not only conflicts.

**Additional schema, beyond §4:** `waitlist_entries` gains `purpose`, `attendee_count`, `booking_id`. `booking_series` gains `purpose`, `attendee_count`, `status`, `cancelled_at`, `materialized_through`. New table `booking_series_skips`.

**§8's "notifies the user" on promotion is not implemented** — no notification channel exists yet in this project. Deferred to whenever email/push notifications are added, not a Phase 5 gap.

**Known gap, low priority:** `POST /api/series` has no `Idempotency-Key`, unlike booking creation. A retried request creates a second parallel series. Worth adding before this project is considered feature-complete, not urgent given how infrequently series are created relative to individual bookings.

**Additional error codes:** `SLOT_AVAILABLE` (409, returned when joining a waitlist for a slot that isn't actually held by anyone — book it directly instead), `WAITLIST_DUPLICATE` (409, one user may not hold two overlapping waiting entries on the same resource, enforced by a database constraint), `INVALID_RRULE` (422, only `FREQ=WEEKLY;BYDAY=…;UNTIL=…` is accepted), `INVALID_BUSINESS_HOURS` (422, a resource's configured opening time must be before its closing time).

**Resources gain `business_hours_start`, `business_hours_end` (IST, default 08:00–18:00) and `business_days`** (default Monday–Friday). All utilization math is computed against each resource's own hours and days — never a hardcoded global window — and available-minutes accounting starts from the later of the query window's start or the resource's creation date, never before the resource existed.

**Maintenance windows auto-cancel conflicting bookings, they do not block creation and are not merely flagged.** A maintenance window describes reality (the resource is actually unusable) and must always be creatable regardless of existing bookings — rejecting creation over a scheduling conflict would mean the system refuses to record that something is broken. Every booking (`pending`, `approved`, or `checked_in`) whose period overlaps a newly created maintenance window is cancelled automatically, with a distinct audit action (`booking.cancelled_by_maintenance`, not the booker's own `booking.cancelled`) and a reason readable directly on the booking's own status/detail response — since no notification channel exists yet (per the Phase 5 note above), the booker only learns this by checking their own booking, so it must be self-explanatory there, not buried in an audit log they can't see.

**Utilization is capped to checked-in time within a resource's business hours and business days — on both axes, not hours alone — and can never exceed 100%.** Sessions are time-merged per resource before measuring, so overlapping check-in/check-out windows (a normal occurrence given the ±15-minute check-in/check-out tolerance from §7) are never double-counted; without merging, the cap could still be exceeded by realistic overlapping data. Time outside business hours/days is never discarded — it is reported separately (`offHoursMinutes` alongside `inHoursMinutes`, with `actualMinutes` = their sum) so nothing is hidden, only correctly categorized. The idle ranking and department totals use the same capped, merged figure.

**No-show rate strictly excludes rejected, expired, and cancelled bookings from its denominator** — `no_show / (no_show + completed + checked_in)` only. These are not attendance outcomes and must not affect a metric meant to measure attendance behavior; a rejection or an unactioned approval is not the booker's fault. A separate "request outcome" breakdown (proportions of rejected/expired/completed) is deliberately not built — it would be a different, differently-labeled metric if added later.

**Idle ranking requires 28 days of data, counted from the later of the query window's start or the resource's creation date** — never from a resource's first booking, since that would make a never-booked resource permanently unrankable and defeat the purpose of an idle ranking. Excluded resources are listed with a specific, human-readable reason (insufficient data with the actual day count, inactive, or no business hours configured), never silently omitted.

**Heatmap shows booking demand (booked time), not usage (checked-in time).** All 168 day×hour cells are always returned, zero-filled via `generate_series`, in IST.

**Analytics access is department-scoped like everything else**, with one deliberate asymmetry: admins default to their own department on analytics (unlike the resource list, where admins default to seeing everything) — analytics is a more sensitive, comparative view, so a narrower default is the safer one. Cross-department or all-department analytics requires an explicit admin request.

**Additional endpoints** (beyond §9):
```
GET    /api/departments                 public — signup form needs it
GET    /api/resources/:id
DELETE /api/resources/:id               soft delete, sets is_active = false
PATCH  /api/users/:id/role              admin only, never on own account
PATCH  /api/resources/:id/owners        TO BUILD IN PHASE 3
```

**Additional policy actions:** `resource:view`, `user:change_role`, plus `defaultResourceScope(actor)` for list scoping (admins → all departments, everyone else → own).

**Resource creation is admin-only.** "Owner or admin" cannot apply before a resource has owners.

**Cross-department resource access returns `404 NOT_FOUND`, not 403.** Do not confirm the existence of resources outside the actor's department. `WRONG_DEPARTMENT` (403) is reserved for cases where the actor can legitimately see the resource but may not act on it — e.g. booking a visible resource in another department.

**Authorization ordering.** Routes may load an entity through the service in order to authorize against it, then call `can()` before any mutation. The rule is "no mutation before `can()`", not "no read before `can()`".

**Audit log is active from Phase 1 onward.** Create `audit_log` and a `writeAudit()` helper called inside the same transaction as the mutation. Wire it into role changes and resource create/update/delete immediately — do not defer to Phase 3.

**Soft delete everywhere.** Rows referenced by bookings are never hard-deleted.

**Request bodies reject unknown fields** with 400. A `role` field in the signup body is an error, not silently ignored.

**Versions:** Node 22, Prisma 6.19, Express 5, Zod 4. (Supersedes the Node 20 line in §3.)

**Cookies:** refresh token scoped to `/api/auth`; `SameSite=None; Secure` in production, `Lax` in development.

**Additional error code:** `MAINTENANCE_OVERLAP` (409, a maintenance window overlapping an existing one on the same resource).

**Maintenance window behaviour.** A session in progress when a window is created is closed at the earlier of now and the window's start, recorded as an override by whoever created the window. A window must end in the future. Admins may create windows in any department: creating a window is a resource-management action, which is admin-any-department, unlike approvals, which are decisions on a specific request and stay department-scoped. Removing a window is a soft delete; bookings it cancelled stay cancelled.

**Incidents.** "Had a booking" means the reporter's booking was `approved`, `checked_in`, `completed` or `no_show`. Only owners and admins may attach a report to someone else's booking. An `out_of_service` incident does not automatically deactivate the resource or create a maintenance window; a human decides that.

**Calendar feeds.** The feed token is a signed value built from the user ID and a per-user feed version, never stored in the database. Regenerating bumps the version, which invalidates the old URL. Only the canonical encoding of a token is accepted; a non-canonical but equivalent spelling is rejected. Feeds look back 90 days and include only `approved`, `checked_in` and `completed` bookings. When `ICS_TOKEN_SECRET` is unset it is derived as HMAC-SHA256 of the JWT access secret over a fixed, purpose-specific label. Setting it explicitly to the JWT secret is refused at startup. **Never change the label**: doing so silently invalidates every feed URL already handed out.

**Deployment shape.** `docker compose --env-file server/.env up --build` starts the whole seeded app at `http://localhost:8080` (nginx serves the PWA and proxies `/api`). For development, use `docker compose --env-file server/.env up -d postgres redis` and run the server and client with `npm run dev`. New optional settings: `PUBLIC_API_URL`, `COOKIE_SECURE`, `COOKIE_SAMESITE`, `ICS_TOKEN_SECRET`.

**Known gaps (current through Phase 8a).** As of Phase 8a the frontend has sign-in, register, resource directory, week calendar, my bookings, scan, check-in and analytics. The approvals inbox, the admin screens (resources, maintenance, incidents) and the waitlist and series screens are not built (Phase 8b), and the Playwright flow still approves through the API. Not yet built or fixed: notifications, a login rate limit, an `Idempotency-Key` on `POST /api/series`. The API image keeps dev dependencies because the Prisma CLI runs migrations. `npm audit` flags a pre-existing advisory in the Prisma CLI's dependencies. CI has never run on GitHub; the first real run happens on the first push.

**Frontend conventions (Phase 8a).** The week calendar is a hand-built CSS grid with no calendar library. It needs no overlap layout, because the exclusion constraint guarantees that held bookings and maintenance windows on one resource never overlap. Other people's bookings render as anonymous "Busy" (the availability endpoint never names the booker); your own bookings render in the accent colour. Colour is semantic only, with no per-resource colours. Grid maths (slot to pixel, duration to height, drag normalisation, IST day boundaries) lives in pure functions and is tested with the machine's timezone set away from IST, so any accidental use of local time fails. Every API error code maps to one human sentence in `lib/api-errors.ts`, stating the actual limit where the response includes it; add new codes there, never inline in a component. All times render in IST.

**Booking submission.** Each submit attempt gets its own `Idempotency-Key`, reused only when retrying after an unknown outcome (network failure, 5xx, or an unreadable success response). A definite answer, or any change to the form, starts a new attempt with a new key. On `SLOT_CONFLICT` the client refetches availability so the winner's block appears, keeps the panel open, explains the conflict in one sentence, and offers the waitlist. A drag stops before the first busy slot, and the end-time list never offers a booking that crosses midnight IST, runs past the horizon, or violates the resource's minimum or maximum length.

**A booking that is `rejected` with no approver having rejected it is displayed as Expired** (the server stores expiry as `rejected`, with only the audit log marking `booking.expired`). Known limitation: the grid only shows a resource's business hours (widened for existing bookings), while the server does not enforce business hours, so times outside them cannot be picked in the UI and closed days are shaded but still bookable. The analytics off-hours reporting anticipates use outside business hours, so this is a UI limitation, not a rule.

---

## 3. Tech stack

### Frontend
- React 18 + TypeScript + Vite
- TanStack Query (server state, optimistic updates)
- React Router
- Tailwind CSS + shadcn/ui
- `html5-qrcode` for in-browser QR scanning
- `date-fns` + `date-fns-tz`
- PWA manifest + service worker (installable for phone scanning)

### Backend
- Node.js 20 + Express + TypeScript
- Zod for all request/response validation
- Prisma ORM; raw SQL migrations for constraints, views and indexes
- `jsonwebtoken` + `bcrypt` — access token in memory, refresh token in httpOnly cookie with rotation and reuse detection
- `node-cron` for scheduled jobs
- `ical-generator` for calendar feeds
- `pino` for structured logging

### Data
- PostgreSQL 16 (extensions: `btree_gist`, `pgcrypto`)
- Redis 7 — rate limiting, QR nonce store, job locks

### Testing & infra
- Vitest + Supertest (API), Testcontainers (Postgres)
- Playwright — one end-to-end happy-path booking flow
- Docker Compose for local dev
- GitHub Actions: lint → typecheck → test → build
- Deploy: backend on Railway/Render, frontend on Vercel, managed Postgres

---

## 4. Data model

### users
`id` uuid pk · `email` unique citext · `password_hash` · `full_name` · `role` enum(`student`,`faculty`,`lab_incharge`,`admin`) default `student` · `department_id` fk · `roll_no` nullable · `is_active` bool · `created_at`

### departments
`id` · `name` · `code` unique

### resources
`id` uuid pk · `department_id` fk · `name` · `type` enum(`lab`,`room`,`equipment`) · `location` · `capacity` int · `description` · `qr_secret` (random, used to sign QR payloads) · `requires_approval` bool · `approval_levels` smallint (1 or 2) · `min_slot_minutes` int · `max_slot_minutes` int · `booking_horizon_days` int · `is_active` bool

### resource_owners
`resource_id` fk · `user_id` fk · pk(resource_id, user_id) — users who may approve/manage this resource.

### bookings
`id` uuid pk · `resource_id` fk · `user_id` fk · `period` tstzrange **not null** · `status` enum(`pending`,`approved`,`rejected`,`cancelled`,`checked_in`,`completed`,`no_show`) · `purpose` text · `attendee_count` int · `series_id` uuid nullable fk → booking_series · `idempotency_key` text nullable · `created_at` · `updated_at`

**Constraint:**
```sql
ALTER TABLE bookings ADD CONSTRAINT bookings_no_overlap
EXCLUDE USING gist (
  resource_id WITH =,
  period WITH &&
) WHERE (status IN ('pending','approved','checked_in'));
```
Note: `pending` participates in the constraint — a requested slot is held while awaiting approval. Rejected/cancelled/no_show bookings do not block.

Also add a unique partial index on `(user_id, idempotency_key)` where `idempotency_key is not null`.

### booking_series
`id` uuid pk · `resource_id` · `user_id` · `rrule` text (RFC 5545 subset: FREQ=WEEKLY;BYDAY=...;UNTIL=...) · `start_time` time · `duration_minutes` int · `created_at`

Materialize individual `bookings` rows from the series so a single occurrence can be cancelled independently. Cap materialization at the resource's `booking_horizon_days`.

### booking_approvals
`id` · `booking_id` fk · `level` smallint · `approver_id` fk · `decision` enum(`approved`,`rejected`) · `comment` · `decided_at`

### checkins
`id` · `booking_id` fk unique · `checked_in_at` · `checked_out_at` nullable · `checkin_method` enum(`qr`,`manual_override`) · `overridden_by` nullable fk

`actual_minutes` is derived, not stored.

### maintenance_windows
`id` · `resource_id` fk · `period` tstzrange · `reason` · `created_by` fk

Blocks booking creation overlapping the window. Enforce with an exclusion constraint on this table too, and check it in the booking service.

### incidents
`id` · `resource_id` fk · `booking_id` nullable fk · `reported_by` fk · `severity` enum(`minor`,`major`,`out_of_service`) · `description` · `resolved_at` nullable

### waitlist_entries
`id` · `resource_id` fk · `user_id` fk · `desired_period` tstzrange · `created_at` · `status` enum(`waiting`,`promoted`,`expired`,`cancelled`)

### audit_log
`id` · `actor_id` · `entity_type` · `entity_id` · `action` · `before` jsonb · `after` jsonb · `created_at`

Write from a single helper called inside the same transaction as the mutation.

---

## 5. Booking state machine

```
pending ──approve──> approved ──checkin──> checked_in ──checkout──> completed
   │                     │                      │
   ├──reject──> rejected ├──cancel──> cancelled │
   │                     └──sweeper──> no_show  │
   └──cancel──> cancelled
```

Rules:
- `cancel` is forbidden once status is `checked_in` or `completed`.
- `no_show` is set by the sweeper when `now > period.lower + grace_minutes` (default 15) and no checkin row exists and status is `approved`.
- Transitioning to `no_show`, `cancelled` or `rejected` frees the slot (they are excluded from the overlap constraint), which triggers waitlist promotion.
- Implement transitions in one `transitionBooking(bookingId, action, actor)` service function. No status writes anywhere else.

---

## 6. Authorization policy

Single module `src/auth/policy.ts` exporting `can(actor, action, subject): boolean`.

| Action | Rule |
|---|---|
| `booking:create` | any active user; resource must be active and in the user's department |
| `booking:cancel` | owner of booking (if not checked in) OR resource owner OR admin |
| `booking:approve` | resource owner with matching approval level, OR admin. Cannot approve own booking. |
| `resource:manage` | resource owner or admin |
| `maintenance:create` | resource owner or admin |
| `analytics:view` | faculty, lab_incharge, admin |
| `checkin:override` | resource owner or admin |

Every route handler calls `can(...)` before touching the service layer. Add a test that asserts a student cannot approve their own booking.

---

## 7. QR check-in design

- Each resource has a `qr_secret`. The printed QR encodes `{resourceId, v:1}` signed as an HMAC — static, printable, durable.
- Scanning opens `/checkin?r=<resourceId>&sig=<hmac>` in the PWA.
- Backend verifies the signature, identifies the user from their session, then finds a booking for that user on that resource whose `period` contains `now` (with a ±15 min tolerance window).
- If found and status is `approved` → create checkin, set `checked_in`.
- Scanning again during an active session → sets `checked_out_at`, status `completed`.
- No matching booking → `404 NO_ACTIVE_BOOKING` with a helpful message.
- Rate limit scans per user per resource via Redis (max 5/min) to prevent abuse.

Manual override endpoint for lab in-charges when a phone fails; always records `overridden_by`.

---

## 8. Scheduled jobs

Run via `node-cron`, each guarded by a Redis lock so multiple instances don't double-execute. All jobs must be idempotent.

1. **no-show sweeper** — every 5 min. Marks eligible `approved` bookings as `no_show`.
2. **waitlist promoter** — every 5 min. For freed slots, promotes the oldest matching waiting entry, creates a `pending` booking, notifies the user.
3. **series materializer** — nightly. Extends recurring series into the booking horizon.
4. **auto-complete** — every 15 min. Closes `checked_in` bookings that were never checked out, setting `checked_out_at` to `period.upper`.

---

## 9. API surface

All responses use envelope `{ data } | { error: { code, message, details? } }`.

```
POST   /api/auth/register
POST   /api/auth/login
POST   /api/auth/refresh
POST   /api/auth/logout
GET    /api/auth/me

GET    /api/resources?type=&q=
POST   /api/resources                     (manage)
PATCH  /api/resources/:id                 (manage)
GET    /api/resources/:id/availability?from=&to=
GET    /api/resources/:id/qr              (PNG, manage)

POST   /api/bookings                      (Idempotency-Key required)
GET    /api/bookings?mine=true&status=&from=&to=
GET    /api/bookings/:id
POST   /api/bookings/:id/cancel
POST   /api/bookings/:id/approve
POST   /api/bookings/:id/reject

POST   /api/series                        (recurring booking)
DELETE /api/series/:id

POST   /api/checkin                       ({ resourceId, sig })
POST   /api/checkin/manual                (override)

POST   /api/maintenance
DELETE /api/maintenance/:id

POST   /api/incidents
PATCH  /api/incidents/:id/resolve

POST   /api/waitlist
DELETE /api/waitlist/:id

GET    /api/analytics/utilization?resourceId=&from=&to=
GET    /api/analytics/no-shows?from=&to=
GET    /api/analytics/heatmap?resourceId=&from=&to=
GET    /api/analytics/idle-ranking?from=&to=

GET    /api/calendar/:icsToken.ics        (unauthenticated, token-scoped)
```

Error codes: `SLOT_CONFLICT` (409), `MAINTENANCE_BLOCKED` (409), `OUTSIDE_HORIZON` (422), `SLOT_TOO_LONG` (422), `MULTI_DAY_NOT_SUPPORTED` (422), `WRONG_DEPARTMENT` (403), `NO_ACTIVE_BOOKING` (404), `FORBIDDEN` (403), `IDEMPOTENT_REPLAY` (200, returns original).

---

## 10. Analytics queries

Implement as SQL views or query functions, not in-memory JS aggregation.

**Utilization per resource:**
booked minutes = `SUM(upper(period) - lower(period))` for non-cancelled bookings.
actual minutes = `SUM(checked_out_at - checked_in_at)`.
utilization ratio = actual / available hours in window (define available as 08:00–18:00 weekdays unless configured).

**No-show rate:** `COUNT(status='no_show') / COUNT(status IN ('no_show','completed','checked_in'))`, per user and per resource.

**Heatmap:** bucket bookings by `EXTRACT(dow)` × `EXTRACT(hour)` using `generate_series` to produce zero-filled buckets.

**Idle ranking:** resources ordered ascending by utilization ratio, minimum 4 weeks of data.

---

## 11. Frontend screens

1. **Login / Register**
2. **Resource directory** — filter by type, search, availability-today badge
3. **Week calendar** — per resource, click-drag to select a slot, existing bookings and maintenance shaded, optimistic create with rollback on 409
4. **My bookings** — upcoming/past tabs, cancel, ICS link
5. **Approvals inbox** — for faculty/in-charge, approve/reject with comment
6. **Scan** — full-screen camera, big success/failure states, works one-handed
7. **Analytics dashboard** — utilization bars, heatmap grid, no-show table, idle ranking
8. **Admin** — resource CRUD, maintenance windows, incidents

Accessibility: keyboard-navigable calendar, visible focus rings, `aria-live` for booking result.

---

## 12. Build phases

Complete and test each phase before moving on. Commit at meaningful boundaries — do not squash the whole project into a few commits.

- **Phase 1** — Repo scaffold, Docker Compose, Prisma schema, auth (register/login/refresh/rotation), users & departments, resource CRUD, policy module, seed script creating two departments plus the bootstrap admin. Ship with tests proving: a new registration defaults to `student`, a student cannot promote themselves, and a user cannot see another department's resources.
- **Phase 2** — Bookings: exclusion constraint migration, create/list/get/cancel, idempotency, availability endpoint, the 50-concurrent-request test. **This is the core deliverable.**
- **Phase 3** — Approval workflow, state machine, approvals inbox, audit log.
- **Phase 4** — QR generation, check-in/out, no-show sweeper, manual override, PWA scan screen. *Project is demo-ready at the end of this phase.*
- **Phase 5** — Waitlist + promotion job, recurring series + materializer.
- **Phase 6** — Analytics SQL, dashboard UI, seed script generating 8 weeks of realistic data for the demo.
- **Phase 7** — ICS feeds, maintenance & incidents, Playwright e2e, CI pipeline, deploy, README with architecture diagram.

---

## 13. Definition of done

- `docker compose up` gives a working app with seeded data
- `npm test` passes, including the concurrency test
- README contains: problem statement, architecture diagram, the exclusion-constraint explanation, local setup, deploy notes
- Deployed URL is live and seeded
- No secrets committed; `.env.example` present

---

## 14. Git workflow

Applies from Phase 3 onward. **Commit and push only when explicitly asked to in the prompt for that session — never automatically at the end of a task.** When asked, follow every rule below.

**Commit in logical steps, then push.** One logical change per commit, never a whole phase squashed into one. Where a test-first sequence matters (a failing test, then the fix that turns it green), commit both states separately. Do not leave the working tree dirty or the branch unpushed once a commit/push has been requested and started.

**No AI attribution in commit history, ever.** Commit messages and PR descriptions must not contain `Co-Authored-By: Claude`, `Generated with Claude Code`, `Claude-Session:`, or any other tool byline, trailer, emoji or session link. The author and committer are the repository owner alone, in every commit, with no exceptions. Do not rely on tooling to strip this — write the message correctly the first time.

**Verification must complete, and be reviewed, before the push runs — never in the same batched command.** A push is not reversible the way a local commit is: a trailer or secret that reaches `origin` means rewriting pushed history. Run the check, read its output, confirm it's clean, and only then push as a separate step.

**Before every push, confirm in order:**
1. `npm test` passes and typecheck is clean
2. `git log --oneline -n <count>` shows the expected messages with no trailers
3. `git status` is empty
4. only then: `git push`

**`.gitignore` must be kept current.** Before each push, check that nothing below is tracked, and extend the file when the project grows:

```
node_modules/
dist/
build/
coverage/
.env
.env.*
!.env.example
*.log
npm-debug.log*
.DS_Store
Thumbs.db
.vscode/
.idea/
*.pem
*.key
prisma/*.db
prisma/*.db-journal
.cache/
tmp/
.claude/
```

`.env` is never committed; `.env.example` always is. **Never commit** credentials, tokens, keys, or database volumes, and never use `git add -f` to bypass `.gitignore`. If a secret is ever committed, stop and report it immediately rather than pushing — rotating it is the fix, deleting the file in a later commit is not.

**Avoid syntax that trips secret scanners even when no secret is present.** Tools like GitGuardian pattern-match on shapes such as `PASSWORD:`, `SECRET:`, `TOKEN:` followed by a colon and text, regardless of whether a real value follows. This produces false-positive alerts on legitimate code (variable-expansion syntax, `.env.example` placeholders, doc comments). Where practical, prefer forms less likely to trigger a match without sacrificing clarity — e.g. in `.env.example` use obviously-fake placeholder values (`changeme`, `your-secret-here`) rather than a bare variable-required syntax; in YAML/compose files, a comment above the block explaining "values come from .env, never hardcoded here" reduces ambiguity for both scanners and human reviewers. This is a hygiene preference, not a hard rule — never let it override actually removing a real credential.

---

## 15. Conventions

- TypeScript strict mode on, no `any`
- Services return domain results; controllers translate to HTTP
- One Prisma transaction per mutation, audit written inside it
- Zod schemas colocated with routes, exported for frontend type inference
- No business logic in React components — hooks or query functions only
