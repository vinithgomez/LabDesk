-- CreateEnum
CREATE TYPE "approval_decision" AS ENUM ('approved', 'rejected');

-- AlterTable
ALTER TABLE "resource_owners" ADD COLUMN     "approval_level" SMALLINT NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "booking_approvals" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "booking_id" UUID NOT NULL,
    "level" SMALLINT NOT NULL,
    "approver_id" UUID NOT NULL,
    "decision" "approval_decision" NOT NULL,
    "comment" TEXT NOT NULL DEFAULT '',
    "decided_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "booking_approvals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "booking_approvals_approver_id_idx" ON "booking_approvals"("approver_id");

-- CreateIndex
CREATE UNIQUE INDEX "booking_approvals_booking_id_level_key" ON "booking_approvals"("booking_id", "level");

-- CreateIndex
CREATE UNIQUE INDEX "booking_approvals_booking_id_approver_id_key" ON "booking_approvals"("booking_id", "approver_id");

-- AddForeignKey
ALTER TABLE "booking_approvals" ADD CONSTRAINT "booking_approvals_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_approvals" ADD CONSTRAINT "booking_approvals_approver_id_fkey" FOREIGN KEY ("approver_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Raw SQL: levels are 1 or 2 (resources.approval_levels is 1 or 2).
ALTER TABLE "resource_owners"
  ADD CONSTRAINT "resource_owners_approval_level_check" CHECK ("approval_level" IN (1, 2));
ALTER TABLE "booking_approvals"
  ADD CONSTRAINT "booking_approvals_level_check" CHECK ("level" IN (1, 2));
