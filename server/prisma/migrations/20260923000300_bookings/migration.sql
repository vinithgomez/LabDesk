-- CreateEnum
CREATE TYPE "booking_status" AS ENUM ('pending', 'approved', 'rejected', 'cancelled', 'checked_in', 'completed', 'no_show');

-- CreateTable
CREATE TABLE "bookings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "resource_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "period" tstzrange NOT NULL,
    "status" "booking_status" NOT NULL DEFAULT 'pending',
    "purpose" TEXT NOT NULL DEFAULT '',
    "attendee_count" INTEGER NOT NULL DEFAULT 1,
    "series_id" UUID,
    "idempotency_key" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bookings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "bookings_resource_id_idx" ON "bookings"("resource_id");

-- CreateIndex
CREATE INDEX "bookings_user_id_idx" ON "bookings"("user_id");

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_resource_id_fkey" FOREIGN KEY ("resource_id") REFERENCES "resources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Raw SQL: invariants Prisma cannot express.
-- period is always a bounded, non-empty, half-open [start, end) range.
ALTER TABLE "bookings"
  ADD CONSTRAINT "bookings_period_shape_check" CHECK (
    NOT isempty("period")
    AND NOT lower_inf("period") AND NOT upper_inf("period")
    AND lower_inc("period") AND NOT upper_inc("period")
  ),
  ADD CONSTRAINT "bookings_attendee_count_check" CHECK ("attendee_count" >= 1);

-- Idempotency (CLAUDE.md §4): a client key is unique per user.
CREATE UNIQUE INDEX "bookings_user_idempotency_key"
  ON "bookings" ("user_id", "idempotency_key")
  WHERE "idempotency_key" IS NOT NULL;
