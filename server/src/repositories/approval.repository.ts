import { constraintViolationOf, type DbClient } from "../db/prisma.js";
import type { TxClient } from "../db/transaction.js";
import type { ApprovalDecision, BookingApproval } from "../domain/types.js";
import { ConstraintViolation } from "./constraint-violation.js";

const approvalSelect = {
  id: true,
  bookingId: true,
  level: true,
  approverId: true,
  decision: true,
  comment: true,
  decidedAt: true,
} as const;

export interface NewApproval {
  bookingId: string;
  level: number;
  approverId: string;
  decision: ApprovalDecision;
  comment: string;
}

/** Read-only approval queries. Safe on any client (`uow.read.approvals`). */
export class ApprovalReader {
  constructor(protected readonly db: DbClient) {}

  listForBooking(bookingId: string): Promise<BookingApproval[]> {
    return this.db.bookingApproval.findMany({ where: { bookingId }, select: approvalSelect, orderBy: { level: "asc" } });
  }

  listForBookings(bookingIds: readonly string[]): Promise<BookingApproval[]> {
    if (bookingIds.length === 0) return Promise.resolve([]);
    return this.db.bookingApproval.findMany({
      where: { bookingId: { in: [...bookingIds] } },
      select: approvalSelect,
      orderBy: [{ bookingId: "asc" }, { level: "asc" }],
    });
  }
}

/**
 * Approval writes. TxClient only: a decision must commit together with the
 * booking's status change and its audit row, inside transitionBooking.
 */
export class ApprovalWriter extends ApprovalReader {
  constructor(private readonly tx: TxClient) {
    super(tx);
  }

  /**
   * Records a decision. UNIQUE(booking_id, level) and
   * UNIQUE(booking_id, approver_id) are the database backstops; a violation
   * surfaces as ConstraintViolation (23505).
   */
  async insert(a: NewApproval): Promise<BookingApproval> {
    try {
      return await this.tx.bookingApproval.create({ data: a, select: approvalSelect });
    } catch (err) {
      const violation = constraintViolationOf(err);
      if (violation) throw new ConstraintViolation(violation.sqlState, violation.constraint, violation.message);
      throw err;
    }
  }
}
