# LabDesk

Lab & Equipment Booking and Utilization System.

See `CLAUDE.md` for the full specification.

## Local setup

1. `docker compose up -d` (Postgres on 5433, Redis on 6380)
2. `cd server && cp .env.example .env`
3. `npm install`
4. `npm run db:migrate` — apply migrations
5. `npm run db:seed` — two departments (CSE, ECE), the bootstrap admin from
   `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`, demo faculty / lab in-charges /
   students (password `SEED_USER_PASSWORD`) and resources in both departments
6. `npm run dev` — API on http://localhost:4000

## Tests

`npm test` — requires Docker. Integration tests start a disposable
PostgreSQL 16 via Testcontainers and run the real migrations against it.

## Backend layout (`server/src`)

```
routes/        HTTP: Zod request/response schemas, calls can(), then services
services/      use cases; no req/res, no Prisma — only the UnitOfWork
repositories/  the only code that touches Prisma
auth/policy.ts the single authorization module: can(actor, action, subject)
http/          envelope, error mapping, bearer-token middleware
```
