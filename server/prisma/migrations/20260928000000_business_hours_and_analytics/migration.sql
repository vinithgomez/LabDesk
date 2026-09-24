-- Per-resource business hours (Phase 6): the "available" time utilization is
-- measured against. IST wall-clock times, like every other time-of-day in
-- LabDesk; business_days uses EXTRACT(dow) numbering, 0 = Sunday.
ALTER TABLE "resources"
  ADD COLUMN "business_hours_start" TIME(0) NOT NULL DEFAULT '08:00',
  ADD COLUMN "business_hours_end" TIME(0) NOT NULL DEFAULT '18:00',
  ADD COLUMN "business_days" SMALLINT[] NOT NULL DEFAULT '{1,2,3,4,5}';

ALTER TABLE "resources"
  -- Opening hours never wrap past midnight (bookings are same-day, §2b).
  ADD CONSTRAINT "resources_business_hours_check" CHECK ("business_hours_start" < "business_hours_end"),
  ADD CONSTRAINT "resources_business_days_check"
    CHECK ("business_days" <@ '{0,1,2,3,4,5,6}'::smallint[] AND array_position("business_days", NULL) IS NULL);

-- Length of a range in minutes; 0 for an empty range.
CREATE FUNCTION "range_minutes"(r tstzrange) RETURNS float8
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT COALESCE(EXTRACT(EPOCH FROM upper(r) - lower(r))::float8 / 60, 0)
$$;

-- A resource's open hours within [p_from, p_to), as UTC ranges: one per
-- business day, each day's [start, end) taken in IST and clipped to the
-- window. Summing range_minutes over these gives "available minutes".
-- IST has no daylight saving, so every day's hours are the same length.
CREATE FUNCTION "business_intervals"(
  p_start time,
  p_end time,
  p_days smallint[],
  p_from timestamptz,
  p_to timestamptz
) RETURNS TABLE ("slot" tstzrange)
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT s.slot FROM (
    SELECT tstzrange((d + p_start) AT TIME ZONE 'Asia/Kolkata', (d + p_end) AT TIME ZONE 'Asia/Kolkata', '[)')
           * tstzrange(p_from, p_to, '[)') AS slot
    FROM generate_series(
      (p_from AT TIME ZONE 'Asia/Kolkata')::date::timestamp,
      (p_to AT TIME ZONE 'Asia/Kolkata')::date::timestamp,
      interval '1 day'
    ) AS d
    WHERE EXTRACT(dow FROM d)::smallint = ANY (p_days)
  ) s
  WHERE NOT isempty(s.slot)
$$;
