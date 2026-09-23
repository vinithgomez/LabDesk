-- audit_log is append-only (CLAUDE.md §2c). Any UPDATE or DELETE raises, so
-- a recorded audit row can never be altered or removed through SQL issued by
-- the application. INSERT is unaffected.
--
-- Scope: row-level triggers do not fire on TRUNCATE, and a table owner can
-- drop the trigger. Hardening against a privileged operator needs database
-- roles (the app role without UPDATE/DELETE/TRUNCATE on audit_log), which is
-- a deployment concern.
CREATE FUNCTION "audit_log_reject_mutation"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only: % is not permitted', TG_OP
    USING ERRCODE = 'LD001',
          HINT = 'Audit rows are immutable; record a new entry instead.';
END;
$$;

CREATE TRIGGER "audit_log_append_only"
BEFORE UPDATE OR DELETE ON "audit_log"
FOR EACH ROW EXECUTE FUNCTION "audit_log_reject_mutation"();
