-- CreateEnum
CREATE TYPE "checkin_method" AS ENUM ('qr', 'manual_override');

-- CreateEnum
CREATE TYPE "checkout_method" AS ENUM ('qr', 'manual_override', 'auto');

-- CreateTable
CREATE TABLE "checkins" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "booking_id" UUID NOT NULL,
    "checked_in_at" TIMESTAMPTZ(6) NOT NULL,
    "checked_out_at" TIMESTAMPTZ(6),
    "checkin_method" "checkin_method" NOT NULL,
    "overridden_by" UUID,
    "checkout_method" "checkout_method",
    "checkout_overridden_by" UUID,

    CONSTRAINT "checkins_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "checkins_booking_id_key" ON "checkins"("booking_id");

-- AddForeignKey
ALTER TABLE "checkins" ADD CONSTRAINT "checkins_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checkins" ADD CONSTRAINT "checkins_overridden_by_fkey" FOREIGN KEY ("overridden_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checkins" ADD CONSTRAINT "checkins_checkout_overridden_by_fkey" FOREIGN KEY ("checkout_overridden_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Raw SQL: a check-in row can't contradict itself.
ALTER TABLE "checkins"
  ADD CONSTRAINT "checkins_checkout_after_checkin_check"
    CHECK ("checked_out_at" IS NULL OR "checked_out_at" >= "checked_in_at"),
  -- Checked out <=> the checkout method is recorded.
  ADD CONSTRAINT "checkins_checkout_method_check"
    CHECK (("checked_out_at" IS NULL) = ("checkout_method" IS NULL)),
  -- Each overridden_by is set exactly when that step was a manual override.
  ADD CONSTRAINT "checkins_checkin_override_check"
    CHECK (("checkin_method" = 'manual_override') = ("overridden_by" IS NOT NULL)),
  ADD CONSTRAINT "checkins_checkout_override_check"
    CHECK (COALESCE("checkout_method" = 'manual_override', false) = ("checkout_overridden_by" IS NOT NULL));
