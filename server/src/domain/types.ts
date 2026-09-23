export const USER_ROLES = ["student", "faculty", "lab_incharge", "admin"] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const RESOURCE_TYPES = ["lab", "room", "equipment"] as const;
export type ResourceType = (typeof RESOURCE_TYPES)[number];

/** The authenticated principal every policy decision is made about. */
export interface Actor {
  id: string;
  role: UserRole;
  departmentId: string;
  isActive: boolean;
}

export interface Department {
  id: string;
  name: string;
  code: string;
}

export interface User {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  departmentId: string;
  rollNo: string | null;
  isActive: boolean;
  createdAt: Date;
}

export interface UserWithDepartment extends User {
  department: Department;
}

/** Credentials are only ever loaded by the auth service for verification. */
export interface UserCredentials extends User {
  passwordHash: string;
}

export interface Resource {
  id: string;
  departmentId: string;
  name: string;
  type: ResourceType;
  location: string;
  capacity: number;
  description: string;
  requiresApproval: boolean;
  approvalLevels: number;
  minSlotMinutes: number;
  maxSlotMinutes: number;
  bookingHorizonDays: number;
  isActive: boolean;
  ownerIds: string[];
  createdAt: Date;
  updatedAt: Date;
}

export const BOOKING_STATUSES = [
  "pending",
  "approved",
  "rejected",
  "cancelled",
  "checked_in",
  "completed",
  "no_show",
] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

/** Statuses that hold a slot (they participate in the overlap constraint). */
export const SLOT_HOLDING_STATUSES = ["pending", "approved", "checked_in"] as const satisfies readonly BookingStatus[];

/** `period` is the half-open range [startsAt, endsAt), stored as tstzrange in UTC. */
export interface Booking {
  id: string;
  resourceId: string;
  userId: string;
  startsAt: Date;
  endsAt: Date;
  status: BookingStatus;
  purpose: string;
  attendeeCount: number;
  seriesId: string | null;
  createdAt: Date;
  updatedAt: Date;
}
