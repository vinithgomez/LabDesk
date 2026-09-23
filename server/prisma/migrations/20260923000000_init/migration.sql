-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "btree_gist";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "citext";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- CreateEnum
CREATE TYPE "user_role" AS ENUM ('student', 'faculty', 'lab_incharge', 'admin');

-- CreateEnum
CREATE TYPE "resource_type" AS ENUM ('lab', 'room', 'equipment');

-- CreateTable
CREATE TABLE "departments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,

    CONSTRAINT "departments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "email" CITEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "role" "user_role" NOT NULL DEFAULT 'student',
    "department_id" UUID NOT NULL,
    "roll_no" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "resources" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "department_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "type" "resource_type" NOT NULL,
    "location" TEXT NOT NULL,
    "capacity" INTEGER NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "qr_secret" TEXT NOT NULL DEFAULT encode(gen_random_bytes(32), 'hex'),
    "requires_approval" BOOLEAN NOT NULL DEFAULT false,
    "approval_levels" SMALLINT NOT NULL DEFAULT 1,
    "min_slot_minutes" INTEGER NOT NULL DEFAULT 30,
    "max_slot_minutes" INTEGER NOT NULL DEFAULT 180,
    "booking_horizon_days" INTEGER NOT NULL DEFAULT 14,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "resources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "resource_owners" (
    "resource_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,

    CONSTRAINT "resource_owners_pkey" PRIMARY KEY ("resource_id","user_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "departments_code_key" ON "departments"("code");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_department_id_idx" ON "users"("department_id");

-- CreateIndex
CREATE INDEX "resources_department_id_idx" ON "resources"("department_id");

-- CreateIndex
CREATE INDEX "resource_owners_user_id_idx" ON "resource_owners"("user_id");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resources" ADD CONSTRAINT "resources_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resource_owners" ADD CONSTRAINT "resource_owners_resource_id_fkey" FOREIGN KEY ("resource_id") REFERENCES "resources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resource_owners" ADD CONSTRAINT "resource_owners_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Raw SQL: invariants Prisma cannot express.
ALTER TABLE "resources"
  ADD CONSTRAINT "resources_approval_levels_check" CHECK ("approval_levels" IN (1, 2)),
  ADD CONSTRAINT "resources_capacity_check" CHECK ("capacity" >= 0),
  ADD CONSTRAINT "resources_slot_bounds_check" CHECK (
    "min_slot_minutes" > 0
    AND "max_slot_minutes" >= "min_slot_minutes"
    AND "max_slot_minutes" <= 1440
  ),
  ADD CONSTRAINT "resources_booking_horizon_check" CHECK ("booking_horizon_days" BETWEEN 1 AND 365);
