-- Double-booking prevention, enforced by PostgreSQL (CLAUDE.md §2.1, §4).
--
-- Two bookings for the same resource may not have overlapping periods while
-- either one is holding the slot. The check runs inside the database at
-- INSERT/UPDATE time, so concurrent transactions cannot both pass it: the
-- second inserter blocks until the first commits, then fails with SQLSTATE
-- 23P01 (exclusion_violation). Requires btree_gist for the uuid "=" operator.
--
-- 'pending' participates: a requested slot is held while awaiting approval.
-- rejected / cancelled / no_show / completed rows do not block.
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_no_overlap"
EXCLUDE USING gist (
  "resource_id" WITH =,
  "period" WITH &&
) WHERE ("status" IN ('pending', 'approved', 'checked_in'));
