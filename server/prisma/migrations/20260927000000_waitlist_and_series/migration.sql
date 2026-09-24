-- CreateEnum
CREATE TYPE "series_status" AS ENUM ('active', 'cancelled');

-- CreateEnum
CREATE TYPE "waitlist_status" AS ENUM ('waiting', 'promoted', 'expired', 'cancelled');

-- CreateTable
CREATE TABLE "booking_series" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "resource_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "rrule" TEXT NOT NULL,
    "start_time" TIME(0) NOT NULL,
    "duration_minutes" INTEGER NOT NULL,
    "purpose" TEXT NOT NULL DEFAULT '',
    "attendee_count" INTEGER NOT NULL DEFAULT 1,
    "status" "series_status" NOT NULL DEFAULT 'active',
    "materialized_through" TIMESTAMPTZ(6),
    "cancelled_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "booking_series_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking_series_skips" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "series_id" UUID NOT NULL,
    "occurrence" tstzrange NOT NULL,
    "reason" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "booking_series_skips_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "waitlist_entries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "resource_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "desired_period" tstzrange NOT NULL,
    "purpose" TEXT NOT NULL DEFAULT '',
    "attendee_count" INTEGER NOT NULL DEFAULT 1,
    "status" "waitlist_status" NOT NULL DEFAULT 'waiting',
    "booking_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "waitlist_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "booking_series_resource_id_idx" ON "booking_series"("resource_id");

-- CreateIndex
CREATE INDEX "booking_series_user_id_idx" ON "booking_series"("user_id");

-- CreateIndex
CREATE INDEX "booking_series_skips_series_id_idx" ON "booking_series_skips"("series_id");

-- CreateIndex
CREATE INDEX "bookings_series_id_idx" ON "bookings"("series_id");

-- CreateIndex
CREATE INDEX "waitlist_entries_user_id_idx" ON "waitlist_entries"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "waitlist_entries_booking_id_key" ON "waitlist_entries"("booking_id");

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_series_id_fkey" FOREIGN KEY ("series_id") REFERENCES "booking_series"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_series" ADD CONSTRAINT "booking_series_resource_id_fkey" FOREIGN KEY ("resource_id") REFERENCES "resources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_series" ADD CONSTRAINT "booking_series_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_series_skips" ADD CONSTRAINT "booking_series_skips_series_id_fkey" FOREIGN KEY ("series_id") REFERENCES "booking_series"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waitlist_entries" ADD CONSTRAINT "waitlist_entries_resource_id_fkey" FOREIGN KEY ("resource_id") REFERENCES "resources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waitlist_entries" ADD CONSTRAINT "waitlist_entries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waitlist_entries" ADD CONSTRAINT "waitlist_entries_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Raw SQL: invariants Prisma cannot express.

ALTER TABLE "booking_series"
  ADD CONSTRAINT "booking_series_duration_check" CHECK ("duration_minutes" > 0),
  ADD CONSTRAINT "booking_series_attendee_count_check" CHECK ("attendee_count" >= 1),
  -- Cancelled <=> the cancellation time is recorded.
  ADD CONSTRAINT "booking_series_cancelled_check"
    CHECK (("status" = 'cancelled') = ("cancelled_at" IS NOT NULL));

-- A series never materializes the same occurrence twice. The materializer's
-- series row lock and cursor (materialized_through) already guarantee this;
-- the index is the database-level backstop.
CREATE UNIQUE INDEX "bookings_series_occurrence"
  ON "bookings" ("series_id", lower("period"))
  WHERE "series_id" IS NOT NULL;

-- One skip record per occurrence.
CREATE UNIQUE INDEX "booking_series_skips_occurrence"
  ON "booking_series_skips" ("series_id", lower("occurrence"));

ALTER TABLE "booking_series_skips"
  ADD CONSTRAINT "booking_series_skips_occurrence_shape_check" CHECK (
    NOT isempty("occurrence")
    AND NOT lower_inf("occurrence") AND NOT upper_inf("occurrence")
    AND lower_inc("occurrence") AND NOT upper_inc("occurrence")
  );

ALTER TABLE "waitlist_entries"
  ADD CONSTRAINT "waitlist_entries_desired_period_shape_check" CHECK (
    NOT isempty("desired_period")
    AND NOT lower_inf("desired_period") AND NOT upper_inf("desired_period")
    AND lower_inc("desired_period") AND NOT upper_inc("desired_period")
  ),
  ADD CONSTRAINT "waitlist_entries_attendee_count_check" CHECK ("attendee_count" >= 1),
  -- Promoted <=> the booking it became is linked.
  ADD CONSTRAINT "waitlist_entries_promoted_check"
    CHECK (("status" = 'promoted') = ("booking_id" IS NOT NULL));

-- A user waits at most once for any given time on a resource: a second
-- 'waiting' entry overlapping the first is refused (WAITLIST_DUPLICATE).
ALTER TABLE "waitlist_entries" ADD CONSTRAINT "waitlist_entries_no_duplicate"
EXCLUDE USING gist (
  "resource_id" WITH =,
  "user_id" WITH =,
  "desired_period" WITH &&
) WHERE ("status" = 'waiting');

-- The promoter's queue: waiting entries per resource, oldest first (FIFO).
CREATE INDEX "waitlist_entries_waiting_fifo"
  ON "waitlist_entries" ("resource_id", "created_at")
  WHERE "status" = 'waiting';
