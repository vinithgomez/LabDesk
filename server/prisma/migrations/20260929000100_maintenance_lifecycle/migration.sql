-- Maintenance windows become manageable (Phase 7, CLAUDE.md §2c).

-- Soft delete: a window can be referenced by the bookings it cancelled, and
-- rows referenced by bookings are never hard-deleted (§2c). Removed <=> who
-- removed it is recorded.
ALTER TABLE "maintenance_windows"
  ADD COLUMN "removed_at" TIMESTAMPTZ(6),
  ADD COLUMN "removed_by" UUID,
  ADD CONSTRAINT "maintenance_windows_removed_check" CHECK (("removed_at" IS NULL) = ("removed_by" IS NULL));

ALTER TABLE "maintenance_windows" ADD CONSTRAINT "maintenance_windows_removed_by_fkey"
  FOREIGN KEY ("removed_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Live windows for one resource still never overlap; a removed window no
-- longer counts, so its time can be scheduled again.
ALTER TABLE "maintenance_windows" DROP CONSTRAINT "maintenance_windows_no_overlap";
ALTER TABLE "maintenance_windows" ADD CONSTRAINT "maintenance_windows_no_overlap"
EXCLUDE USING gist (
  "resource_id" WITH =,
  "period" WITH &&
) WHERE ("removed_at" IS NULL);

-- A booking cancelled because a maintenance window was created over it
-- points at that window, so its own detail can say why (§2c).
ALTER TABLE "bookings" ADD COLUMN "cancelled_by_maintenance_id" UUID;
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_cancelled_by_maintenance_id_fkey"
  FOREIGN KEY ("cancelled_by_maintenance_id") REFERENCES "maintenance_windows"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_maintenance_cancel_check"
  CHECK ("cancelled_by_maintenance_id" IS NULL OR "status" = 'cancelled');
CREATE INDEX "bookings_cancelled_by_maintenance_id_idx" ON "bookings"("cancelled_by_maintenance_id");
