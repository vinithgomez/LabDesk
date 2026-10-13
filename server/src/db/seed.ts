/**
 * Seed: two departments (so department scoping is demonstrable), the
 * bootstrap admin from SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD, a handful of
 * faculty, lab in-charges, students and resources in BOTH departments, and
 * (Phase 6, demo only) HISTORY_WEEKS of past bookings and check-ins so the
 * analytics dashboard has something to show — see seed-history.ts.
 *
 * Idempotent: safe to run repeatedly. Existing users keep their passwords.
 * Run with `npm run db:seed`.
 *
 * Demo data only, meant to be seen: realistic names, resources and booking
 * purposes, and every password from the environment. Test fixtures (the
 * Playwright suite's "E2E" resources and students) are never created here.
 */
import "dotenv/config";
import { z } from "zod";
import { createPasswordHasher } from "../auth/password.js";
import type { ResourceType, UserRole } from "../domain/types.js";
import { createPrismaClient, type PrismaClient } from "./prisma.js";
import { seedHistory, type HistoryResource, type UsageProfile } from "./seed-history.js";

/** Weeks of demo booking history (CLAUDE.md §12: 8 weeks). */
const HISTORY_WEEKS = 8;
const DAY_MS = 86_400_000;

const env = z
  .object({
    DATABASE_URL: z.string().min(1),
    SEED_ADMIN_EMAIL: z.email(),
    SEED_ADMIN_PASSWORD: z.string().min(8).max(72),
    // Shared password for the non-admin demo accounts. Required: no password lives in code.
    SEED_USER_PASSWORD: z.string().min(8).max(72),
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
  /** IST opening hours used for utilization, and the days they apply (0 = Sunday). */
  hours: { start: string; end: string; days: number[] };
  /** Owner emails with the approval level each decides at. */
  owners: { email: string; level: 1 | 2 }[];
  /** Demo history: how busy it is, and who books it. */
  usage: UsageProfile & { bookers: "students" | "staff" };
  /** Demo history: what bookings are for, and how many people come. */
  purposes: string[];
  attendees: { min: number; max: number };
  /** How long ago it came into service (the idle ranking needs 4 weeks). */
  ageDays: number;
}

const WEEKDAYS = [1, 2, 3, 4, 5];

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
  { email: "neha.gupta@college.edu", fullName: "Neha Gupta", role: "student", dept: "CSE", rollNo: "CSE21004" },
  { email: "vikram.singh@college.edu", fullName: "Vikram Singh", role: "student", dept: "CSE", rollNo: "CSE21005" },
  { email: "meera.iyer@college.edu", fullName: "Dr. Meera Iyer", role: "faculty", dept: "ECE" },
  { email: "suresh.menon@college.edu", fullName: "Suresh Menon", role: "lab_incharge", dept: "ECE" },
  { email: "divya.pillai@college.edu", fullName: "Divya Pillai", role: "student", dept: "ECE", rollNo: "ECE21001" },
  { email: "rahul.verma@college.edu", fullName: "Rahul Verma", role: "student", dept: "ECE", rollNo: "ECE21002" },
  { email: "ananya.bose@college.edu", fullName: "Ananya Bose", role: "student", dept: "ECE", rollNo: "ECE21003" },
];

/** Demo history: habitual no-showers, so the no-show table has a story. */
const NO_SHOW_HABITS: Record<string, number> = {
  "kabir.das@college.edu": 0.35,
  "rahul.verma@college.edu": 0.22,
  "vikram.singh@college.edu": 0.15,
};

const RESOURCES: SeedResource[] = [
  {
    dept: "CSE", name: "Logic Analyzer LA-16", type: "equipment", location: "Block A, Room 214", capacity: 1,
    description: "16-channel logic analyzer.", requiresApproval: false, approvalLevels: 1,
    minSlotMinutes: 30, maxSlotMinutes: 120, bookingHorizonDays: 7,
    owners: [{ email: "ravi.kumar@college.edu", level: 1 }],
    hours: { start: "09:00", end: "17:00", days: WEEKDAYS },
    usage: { intensity: 0, lengths: [60], bookers: "students" }, ageDays: 70,
    purposes: ["Digital logic lab experiment", "Microprocessor bus debugging"], attendees: { min: 1, max: 2 },
  },
  {
    dept: "CSE", name: "3D Printer P-2", type: "equipment", location: "Block A, Maker Space", capacity: 1,
    description: "FDM printer, 25 cm build volume. New this term.", requiresApproval: false, approvalLevels: 1,
    minSlotMinutes: 60, maxSlotMinutes: 240, bookingHorizonDays: 14,
    owners: [{ email: "ravi.kumar@college.edu", level: 1 }],
    hours: { start: "09:00", end: "18:00", days: WEEKDAYS },
    usage: { intensity: 0.3, lengths: [120, 180, 240], bookers: "students" }, ageDays: 14,
    purposes: ["Mini-project enclosure print", "Final-year project parts", "Robotics club prototype", "Drone frame print"],
    attendees: { min: 1, max: 2 },
  },
  {
    dept: "CSE", name: "Systems Lab L-201", type: "lab", location: "Block A, 2nd floor", capacity: 40,
    description: "40 Linux workstations, projector.", requiresApproval: false, approvalLevels: 1,
    minSlotMinutes: 60, maxSlotMinutes: 180, bookingHorizonDays: 14,
    owners: [{ email: "ravi.kumar@college.edu", level: 1 }],
    hours: { start: "08:00", end: "20:00", days: [1, 2, 3, 4, 5, 6] },
    usage: { intensity: 0.6, lengths: [60, 120, 180], bookers: "students" }, ageDays: 70,
    purposes: [
      "Lab record work",
      "DBMS lab practice",
      "Operating systems lab assignment",
      "Compiler design lab",
      "Mini-project demo",
      "Coding club practice session",
      "Placement aptitude practice",
    ],
    attendees: { min: 4, max: 36 },
  },
  {
    dept: "CSE", name: "GPU Workstation #1", type: "equipment", location: "Block A, Room 214", capacity: 1,
    description: "RTX-class GPU box for ML coursework and projects.", requiresApproval: true, approvalLevels: 2,
    minSlotMinutes: 60, maxSlotMinutes: 240, bookingHorizonDays: 7,
    owners: [
      { email: "anita.rao@college.edu", level: 1 },
      { email: "ravi.kumar@college.edu", level: 2 },
    ],
    hours: { start: "08:00", end: "22:00", days: [0, 1, 2, 3, 4, 5, 6] },
    usage: { intensity: 0.5, lengths: [120, 180, 240], bookers: "students" }, ageDays: 70,
    purposes: ["Model training run", "Fine-tuning experiment", "Dataset preprocessing", "Final-year project experiments"],
    attendees: { min: 1, max: 1 },
  },
  {
    dept: "CSE", name: "Seminar Room S-1", type: "room", location: "Block A, ground floor", capacity: 60,
    description: "Seminar hall with AV setup.", requiresApproval: true, approvalLevels: 1,
    minSlotMinutes: 30, maxSlotMinutes: 240, bookingHorizonDays: 30,
    owners: [{ email: "anita.rao@college.edu", level: 1 }],
    hours: { start: "09:00", end: "17:00", days: WEEKDAYS },
    usage: { intensity: 0.22, lengths: [60, 90, 120], bookers: "staff" }, ageDays: 70,
    purposes: ["Department seminar", "Guest lecture", "Project review panel", "Faculty meeting", "Workshop on research writing"],
    attendees: { min: 15, max: 60 },
  },
  {
    dept: "ECE", name: "VLSI Design Lab", type: "lab", location: "Block C, 1st floor", capacity: 30,
    description: "EDA workstations with FPGA boards.", requiresApproval: false, approvalLevels: 1,
    minSlotMinutes: 60, maxSlotMinutes: 180, bookingHorizonDays: 14,
    owners: [{ email: "suresh.menon@college.edu", level: 1 }],
    hours: { start: "08:00", end: "18:00", days: WEEKDAYS },
    usage: { intensity: 0.42, lengths: [60, 120, 180], bookers: "students" }, ageDays: 70,
    purposes: ["Verilog simulation lab", "FPGA synthesis run", "VLSI lab record work", "Mini-project demo"],
    attendees: { min: 2, max: 28 },
  },
  {
    dept: "ECE", name: "Digital Storage Oscilloscope", type: "equipment", location: "Block C, Room 105", capacity: 1,
    description: "4-channel 200 MHz DSO.", requiresApproval: true, approvalLevels: 1,
    minSlotMinutes: 30, maxSlotMinutes: 120, bookingHorizonDays: 7,
    owners: [{ email: "suresh.menon@college.edu", level: 1 }],
    hours: { start: "08:00", end: "18:00", days: WEEKDAYS },
    usage: { intensity: 0.03, lengths: [30, 60], bookers: "students" }, ageDays: 70,
    purposes: ["Signal measurement for lab record", "Filter response readings"], attendees: { min: 1, max: 2 },
  },
  {
    dept: "ECE", name: "Embedded Systems Lab", type: "lab", location: "Block C, 2nd floor", capacity: 36,
    description: "Microcontroller kits and bench power supplies.", requiresApproval: true, approvalLevels: 2,
    minSlotMinutes: 60, maxSlotMinutes: 180, bookingHorizonDays: 14,
    owners: [
      { email: "meera.iyer@college.edu", level: 1 },
      { email: "suresh.menon@college.edu", level: 2 },
    ],
    hours: { start: "09:00", end: "18:00", days: WEEKDAYS },
    usage: { intensity: 0.2, lengths: [60, 120], bookers: "students" }, ageDays: 70,
    purposes: ["Microcontroller lab", "IoT mini-project", "Sensor interfacing practice", "Embedded systems lab record work"],
    attendees: { min: 2, max: 30 },
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

function idOf(userIds: ReadonlyMap<string, string>, email: string): string {
  const id = userIds.get(email);
  if (!id) throw new Error(`User ${email} was not seeded`);
  return id;
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

    const now = new Date();
    const history: HistoryResource[] = [];
    for (const { dept, owners, hours, usage, ageDays, purposes, attendees, ...rest } of RESOURCES) {
      const departmentId = deptId(dept);
      const since = new Date(now.getTime() - ageDays * DAY_MS);
      const fields = {
        ...rest,
        businessHoursStart: new Date(`1970-01-01T${hours.start}:00.000Z`),
        businessHoursEnd: new Date(`1970-01-01T${hours.end}:00.000Z`),
        businessDays: hours.days,
        // Demo: backdated so the idle ranking's 4-week minimum is met (or not).
        createdAt: since,
      };
      const ownerRows = owners.map(({ email, level }) => {
        const id = userIds.get(email);
        if (!id) throw new Error(`Owner ${email} was not seeded`);
        return { userId: id, approvalLevel: level };
      });
      const resourceId = await prisma.$transaction(async (tx) => {
        const existing = await tx.resource.findFirst({ where: { departmentId, name: fields.name }, select: { id: true } });
        const resource = existing
          ? await tx.resource.update({ where: { id: existing.id }, data: fields, select: { id: true } })
          : await tx.resource.create({ data: { ...fields, departmentId }, select: { id: true } });
        // Re-seeding resets the owner set to exactly the seed definition.
        await tx.resourceOwner.deleteMany({ where: { resourceId: resource.id } });
        await tx.resourceOwner.createMany({
          data: ownerRows.map((o) => ({ resourceId: resource.id, ...o })),
        });
        return resource.id;
      });

      const deptUsers = USERS.filter((u) => u.dept === dept);
      const bookerPool = deptUsers.filter((u) =>
        usage.bookers === "staff" ? u.role === "faculty" || u.role === "lab_incharge" : u.role === "student",
      );
      history.push({
        id: resourceId,
        name: rest.name,
        requiresApproval: rest.requiresApproval,
        minSlotMinutes: rest.minSlotMinutes,
        maxSlotMinutes: rest.maxSlotMinutes,
        businessHoursStart: hours.start,
        businessHoursEnd: hours.end,
        businessDays: hours.days,
        since,
        ownerId: ownerRows[0]?.userId ?? null,
        profile: usage,
        bookers: bookerPool.map((u, i) => ({ userId: idOf(userIds, u.email), weight: 1 + (i % 3) * 0.5 })),
        purposes,
        attendees: { min: attendees.min, max: Math.min(attendees.max, Math.max(rest.capacity, 1)) },
      });
    }

    const habits = new Map(Object.entries(NO_SHOW_HABITS).map(([email, rate]) => [idOf(userIds, email), rate]));
    const seeded = await seedHistory(prisma, history, habits, { now, weeks: HISTORY_WEEKS });

    console.log(
      `Seeded ${DEPARTMENTS.length} departments, admin ${env.SEED_ADMIN_EMAIL}, ` +
        `${USERS.length} demo users, ${RESOURCES.length} resources, ` +
        `${seeded.bookings} new history bookings (${seeded.checkins} check-ins) over ${HISTORY_WEEKS} weeks.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
