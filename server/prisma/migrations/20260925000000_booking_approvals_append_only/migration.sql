-- booking_approvals is append-only, like audit_log (CLAUDE.md §2c): an
-- approval decision is history, so any UPDATE or DELETE raises. INSERT is
-- unaffected (transitionBooking only ever inserts).
--
-- A generic function, reusable for any future append-only table: the error
-- names the table it guards. Same SQLSTATE (LD001) as audit_log's trigger.
-- As with audit_log, row triggers do not fire on TRUNCATE and a table owner
-- can drop the trigger; hardening against privileged operators is a
-- role/privilege concern for deployment.
CREATE FUNCTION "reject_append_only_mutation"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only: % is not permitted', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'LD001',
          HINT = 'Rows in this table are immutable; record a new row instead.';
END;
$$;

CREATE TRIGGER "booking_approvals_append_only"
BEFORE UPDATE OR DELETE ON "booking_approvals"
FOR EACH ROW EXECUTE FUNCTION "reject_append_only_mutation"();
