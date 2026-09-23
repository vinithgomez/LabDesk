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

---

## 15. Conventions

- TypeScript strict mode on, no `any`
- Services return domain results; controllers translate to HTTP
- One Prisma transaction per mutation, audit written inside it
- Zod schemas colocated with routes, exported for frontend type inference
- No business logic in React components — hooks or query functions only
