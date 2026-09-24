# LabDesk

Lab & Equipment Booking and Utilization System.

See `CLAUDE.md` for the full specification.

## Local setup

1. `cp server/.env.example server/.env` — Postgres credentials live here
2. `docker compose --env-file server/.env up -d` (Postgres on 5433, Redis on 6380)
3. `cd server && npm install`
4. `npm run db:migrate` — apply migrations
5. `npm run db:seed` — two departments (CSE, ECE), the bootstrap admin from
   `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`, demo faculty / lab in-charges /
   students (password `SEED_USER_PASSWORD`) and resources in both departments
6. `npm run dev` — API on http://localhost:4000 (also runs the scheduled jobs)
7. `cd ../client && npm install && npm run dev` — the PWA on http://localhost:5173,
   proxying `/api` to the API. `/scan` is the in-app QR scanner; a printed
   code opens `/checkin?r=…&sig=…` directly from the phone's camera.

Print a resource's check-in code with `GET /api/resources/:id/qr` (owner or
admin). The code is static: it stays valid for the resource's lifetime, as long
as `PUBLIC_APP_URL` doesn't change.

## Tests

`npm test` — requires Docker. Integration tests start a disposable
PostgreSQL 16 via Testcontainers and run the real migrations against it.
Its credentials come from `POSTGRES_*` in `server/.env` (or the environment).

## Concurrency: what the exclusion constraint doesn't solve

**Goal.** Two bookings for the same resource must never overlap, and the
database enforces this rather than application logic. An application-level
check-then-insert is unsafe: under READ COMMITTED, two transactions can both
check, both see a free slot before either commits, and both insert.

**The constraint.** `bookings_no_overlap` is
`EXCLUDE USING gist (resource_id WITH =, period WITH &&) WHERE (status IN ('pending','approved','checked_in'))`,
where `period` is a half-open `tstzrange`. PostgreSQL enforces it at insert
time; a violation raises SQLSTATE 23P01, which the booking service maps to
`409 SLOT_CONFLICT`.

**The failure it exposed.** The constraint is correct but not sufficient under
burst load. With 50 simultaneous inserts for one slot, each insert blocks on
the other inserts' uncommitted rows. Inserters waiting on each other deadlock,
and PostgreSQL resolves a deadlock roughly once per second
(`deadlock_timeout`). The concurrency test went flaky, passing 3 of 5 runs,
with requests failing after about 45 seconds. In one captured failing run, 15
requests failed with deadlock errors (40P01), the other 35 exceeded the
15-second transaction timeout, and no booking succeeded.

**The fix.** `BookingWriter.insert` takes a per-resource, transaction-scoped
advisory lock, `pg_advisory_xact_lock(19524, hashtext(resource_id::text))`,
immediately before the INSERT. The lock orders inserts for one resource and
checks nothing. Each later inserter finds the winner already committed and
fails immediately with 23P01. Because the lock is transaction-scoped, `insert`
is only reachable through a transaction-bound client; calling it anywhere else
is a compile error. After the fix, the test passed 25 of 25 runs.

**The control.** The lock must not be what prevents double-booking. With the
constraint migration removed and the lock kept, the same test creates 50
bookings and fails.

**How the test gets real concurrency.** It sends 50 HTTP requests from 50
users through the real route, service and repository. Each request runs in
its own interactive transaction on a separate pooled connection and waits at
a barrier placed immediately before the INSERT. When the last one arrives,
and before any is released, a separate connection verifies that 50 distinct
backends are idle inside open transactions and that no booking has been
committed. The test then asserts exactly one `201`, 49 `409 SLOT_CONFLICT`
responses, and one stored row for the slot.

## Backend layout (`server/src`)

```
routes/        HTTP: Zod request/response schemas, calls can(), then services
services/      use cases; no req/res, no Prisma — only the UnitOfWork
repositories/  the only code that touches Prisma
auth/policy.ts the single authorization module: can(actor, action, subject)
http/          envelope, error mapping, bearer-token middleware
```
