-- CreateTable
CREATE TABLE "maintenance_windows" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "resource_id" UUID NOT NULL,
    "period" tstzrange NOT NULL,
    "reason" TEXT NOT NULL DEFAULT '',
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "maintenance_windows_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "maintenance_windows_created_by_idx" ON "maintenance_windows"("created_by");

-- AddForeignKey
ALTER TABLE "maintenance_windows" ADD CONSTRAINT "maintenance_windows_resource_id_fkey" FOREIGN KEY ("resource_id") REFERENCES "resources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_windows" ADD CONSTRAINT "maintenance_windows_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Raw SQL: same half-open, bounded range shape as bookings.period.
ALTER TABLE "maintenance_windows"
  ADD CONSTRAINT "maintenance_windows_period_shape_check" CHECK (
    NOT isempty("period")
    AND NOT lower_inf("period") AND NOT upper_inf("period")
    AND lower_inc("period") AND NOT upper_inc("period")
  );

-- Windows for one resource never overlap each other (CLAUDE.md §4). Its
-- gist index also serves the booking service's "overlaps a window?" lookup.
ALTER TABLE "maintenance_windows" ADD CONSTRAINT "maintenance_windows_no_overlap"
EXCLUDE USING gist (
  "resource_id" WITH =,
  "period" WITH &&
);
