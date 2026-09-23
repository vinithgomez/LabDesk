/**
 * Phase 1 seed: two departments (so department scoping is demonstrable), the
 * bootstrap admin from SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD, and a handful
 * of faculty, lab in-charges, students and resources in BOTH departments.
 *
 * Idempotent: safe to run repeatedly. Existing users keep their passwords.
 * Run with `npm run db:seed`.
 */
import "dotenv/config";
import { z } from "zod";
import { createPasswordHasher } from "../auth/password.js";
import type { ResourceType, UserRole } from "../domain/types.js";
import { createPrismaClient, type PrismaClient } from "./prisma.js";

const env = z
  .object({
    DATABASE_URL: z.string().min(1),
    SEED_ADMIN_EMAIL: z.email(),
    SEED_ADMIN_PASSWORD: z.string().min(8).max(72),
    // Shared password for the non-admin demo accounts.
    SEED_USER_PASSWORD: z.string().min(8).max(72).default("Password123!"),
    BCRYPT_ROUNDS: z.coerce.number().int().min(4).max(15).default(12),
  })
  .parse(process.env);

interface SeedUser {
  email: string;
  fullName: string;
  role: UserRole;
  dept: DeptCode;
  rollNo?: string;
}

interface SeedResource {
  dept: DeptCode;
  name: string;
  type: ResourceType;
  location: string;
  capacity: number;
  description: string;
  requiresApproval: boolean;
  approvalLevels: 1 | 2;
  minSlotMinutes: number;
  maxSlotMinutes: number;
  bookingHorizonDays: number;
  /** Owner emails with the approval level each decides at. */
  owners: { email: string; level: 1 | 2 }[];
}

const DEPARTMENTS = [
  { code: "CSE", name: "Computer Science & Engineering" },
  { code: "ECE", name: "Electronics & Communication Engineering" },
] as const;
type DeptCode = (typeof DEPARTMENTS)[number]["code"];

const USERS: SeedUser[] = [
  { email: "anita.rao@college.edu", fullName: "Dr. Anita Rao", role: "faculty", dept: "CSE" },
  { email: "ravi.kumar@college.edu", fullName: "Ravi Kumar", role: "lab_incharge", dept: "CSE" },
  { email: "arjun.nair@college.edu", fullName: "Arjun Nair", role: "student", dept: "CSE", rollNo: "CSE21001" },
  { email: "priya.shah@college.edu", fullName: "Priya Shah", role: "student", dept: "CSE", rollNo: "CSE21002" },
  { email: "kabir.das@college.edu", fullName: "Kabir Das", role: "student", dept: "CSE", rollNo: "CSE21003" },
  { email: "meera.iyer@college.edu", fullName: "Dr. Meera Iyer", role: "faculty", dept: "ECE" },
  { email: "suresh.menon@college.edu", fullName: "Suresh Menon", role: "lab_incharge", dept: "ECE" },
  { email: "divya.pillai@college.edu", fullName: "Divya Pillai", role: "student", dept: "ECE", rollNo: "ECE21001" },
  { email: "rahul.verma@college.edu", fullName: "Rahul Verma", role: "student", dept: "ECE", rollNo: "ECE21002" },
];

const RESOURCES: SeedResource[] = [
  {
    dept: "CSE", name: "Systems Lab L-201", type: "lab", location: "Block A, 2nd floor", capacity: 40,
    description: "40 Linux workstations, projector.", requiresApproval: false, approvalLevels: 1,
    minSlotMinutes: 60, maxSlotMinutes: 180, bookingHorizonDays: 14,
    owners: [{ email: "ravi.kumar@college.edu", level: 1 }],
  },
  {
    dept: "CSE", name: "GPU Workstation #1", type: "equipment", location: "Block A, Room 214", capacity: 1,
    description: "RTX-class GPU box for ML coursework and projects.", requiresApproval: true, approvalLevels: 2,
    minSlotMinutes: 60, maxSlotMinutes: 240, bookingHorizonDays: 7,
    owners: [
      { email: "anita.rao@college.edu", level: 1 },
      { email: "ravi.kumar@college.edu", level: 2 },
    ],
  },
  {
    dept: "CSE", name: "Seminar Room S-1", type: "room", location: "Block A, ground floor", capacity: 60,
    description: "Seminar hall with AV setup.", requiresApproval: true, approvalLevels: 1,
    minSlotMinutes: 30, maxSlotMinutes: 240, bookingHorizonDays: 30,
    owners: [{ email: "anita.rao@college.edu", level: 1 }],
  },
  {
    dept: "ECE", name: "VLSI Design Lab", type: "lab", location: "Block C, 1st floor", capacity: 30,
    description: "EDA workstations with FPGA boards.", requiresApproval: false, approvalLevels: 1,
    minSlotMinutes: 60, maxSlotMinutes: 180, bookingHorizonDays: 14,
    owners: [{ email: "suresh.menon@college.edu", level: 1 }],
  },
  {
    dept: "ECE", name: "Digital Storage Oscilloscope", type: "equipment", location: "Block C, Room 105", capacity: 1,
    description: "4-channel 200 MHz DSO.", requiresApproval: true, approvalLevels: 1,
    minSlotMinutes: 30, maxSlotMinutes: 120, bookingHorizonDays: 7,
    owners: [{ email: "suresh.menon@college.edu", level: 1 }],
  },
  {
    dept: "ECE", name: "Embedded Systems Lab", type: "lab", location: "Block C, 2nd floor", capacity: 36,
    description: "Microcontroller kits and bench power supplies.", requiresApproval: true, approvalLevels: 2,
    minSlotMinutes: 60, maxSlotMinutes: 180, bookingHorizonDays: 14,
    owners: [
      { email: "meera.iyer@college.edu", level: 1 },
      { email: "suresh.menon@college.edu", level: 2 },
    ],
  },
];

async function upsertUser(
  prisma: PrismaClient,
  user: { email: string; fullName: string; role: UserRole; departmentId: string; rollNo: string | null },
  passwordHash: string,
): Promise<string> {
  const row = await prisma.user.upsert({
    where: { email: user.email },
    // Keep an existing password; only re-assert role/department/active.
    update: { role: user.role, departmentId: user.departmentId, isActive: true },
    create: { ...user, passwordHash },
    select: { id: true },
  });
  return row.id;
}

async function main(): Promise<void> {
  const prisma = createPrismaClient(env.DATABASE_URL);
  const hasher = createPasswordHasher(env.BCRYPT_ROUNDS);
  try {
    const deptIds = new Map<DeptCode, string>();
    for (const d of DEPARTMENTS) {
      const row = await prisma.department.upsert({
        where: { code: d.code },
        update: { name: d.name },
        create: d,
        select: { id: true },
      });
      deptIds.set(d.code, row.id);
    }
    const deptId = (code: DeptCode): string => {
      const id = deptIds.get(code);
      if (!id) throw new Error(`Department ${code} was not seeded`);
      return id;
    };

    // The bootstrap admin needs a home department (users.department_id is
    // NOT NULL); admins see every department regardless.
    await upsertUser(
      prisma,
      { email: env.SEED_ADMIN_EMAIL.toLowerCase(), fullName: "LabDesk Admin", role: "admin", departmentId: deptId("CSE"), rollNo: null },
      await hasher.hash(env.SEED_ADMIN_PASSWORD),
    );

    const demoHash = await hasher.hash(env.SEED_USER_PASSWORD);
    const userIds = new Map<string, string>();
    for (const u of USERS) {
      const id = await upsertUser(
        prisma,
        { email: u.email, fullName: u.fullName, role: u.role, departmentId: deptId(u.dept), rollNo: u.rollNo ?? null },
        demoHash,
      );
      userIds.set(u.email, id);
    }

    for (const { dept, owners, ...fields } of RESOURCES) {
      const departmentId = deptId(dept);
      const ownerRows = owners.map(({ email, level }) => {
        const id = userIds.get(email);
        if (!id) throw new Error(`Owner ${email} was not seeded`);
        return { userId: id, approvalLevel: level };
      });
      await prisma.$transaction(async (tx) => {
        const existing = await tx.resource.findFirst({ where: { departmentId, name: fields.name }, select: { id: true } });
        const resource = existing
          ? await tx.resource.update({ where: { id: existing.id }, data: fields, select: { id: true } })
          : await tx.resource.create({ data: { ...fields, departmentId }, select: { id: true } });
        // Re-seeding resets the owner set to exactly the seed definition.
        await tx.resourceOwner.deleteMany({ where: { resourceId: resource.id } });
        await tx.resourceOwner.createMany({
          data: ownerRows.map((o) => ({ resourceId: resource.id, ...o })),
        });
      });
    }

    console.log(
      `Seeded ${DEPARTMENTS.length} departments, admin ${env.SEED_ADMIN_EMAIL}, ` +
        `${USERS.length} demo users, ${RESOURCES.length} resources.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
