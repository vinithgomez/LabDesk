-- Incidents (CLAUDE.md §4): damage or faults reported against a resource.
-- Beyond §4: created_at, resolved_by and resolution (a note on the fix).

-- CreateEnum
CREATE TYPE "incident_severity" AS ENUM ('minor', 'major', 'out_of_service');

-- CreateTable
CREATE TABLE "incidents" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "resource_id" UUID NOT NULL,
    "booking_id" UUID,
    "reported_by" UUID NOT NULL,
    "severity" "incident_severity" NOT NULL,
    "description" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMPTZ(6),
    "resolved_by" UUID,
    "resolution" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "incidents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "incidents_resource_id_idx" ON "incidents"("resource_id");

-- CreateIndex
CREATE INDEX "incidents_reported_by_idx" ON "incidents"("reported_by");

-- CreateIndex
CREATE INDEX "incidents_booking_id_idx" ON "incidents"("booking_id");

-- AddForeignKey
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_resource_id_fkey" FOREIGN KEY ("resource_id") REFERENCES "resources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_reported_by_fkey" FOREIGN KEY ("reported_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_resolved_by_fkey" FOREIGN KEY ("resolved_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Raw SQL: an incident can't contradict itself.
ALTER TABLE "incidents"
  ADD CONSTRAINT "incidents_description_check" CHECK (length(btrim("description")) > 0),
  -- Resolved <=> who resolved it is recorded.
  ADD CONSTRAINT "incidents_resolved_check" CHECK (("resolved_at" IS NULL) = ("resolved_by" IS NULL));

-- Open incidents per resource: what an owner looks at first.
CREATE INDEX "incidents_open_by_resource" ON "incidents" ("resource_id", "created_at") WHERE "resolved_at" IS NULL;
