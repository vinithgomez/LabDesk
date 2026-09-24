import type { DbClient } from "../db/prisma.js";
import type { TxClient } from "../db/transaction.js";
import type { Checkin, CheckinMethod, CheckoutMethod } from "../domain/types.js";

const checkinSelect = {
  id: true,
  bookingId: true,
  checkedInAt: true,
  checkedOutAt: true,
  checkinMethod: true,
  overriddenBy: true,
  checkoutMethod: true,
  checkoutOverriddenBy: true,
} as const;

/** Read-only check-in queries. Safe on any client (`uow.read.checkins`). */
export class CheckinReader {
  constructor(protected readonly db: DbClient) {}

  findByBookingId(bookingId: string): Promise<Checkin | null> {
    return this.db.checkin.findUnique({ where: { bookingId }, select: checkinSelect });
  }
}

/**
 * Check-in writes. TxClient only: each must commit together with the
 * booking's status change and its audit row, inside transitionBooking.
 */
export class CheckinWriter extends CheckinReader {
  constructor(private readonly tx: TxClient) {
    super(tx);
  }

  checkIn(c: { bookingId: string; at: Date; method: CheckinMethod; overriddenBy: string | null }): Promise<Checkin> {
    return this.tx.checkin.create({
      data: { bookingId: c.bookingId, checkedInAt: c.at, checkinMethod: c.method, overriddenBy: c.overriddenBy },
      select: checkinSelect,
    });
  }

  checkOut(c: { bookingId: string; at: Date; method: CheckoutMethod; overriddenBy: string | null }): Promise<Checkin> {
    return this.tx.checkin.update({
      where: { bookingId: c.bookingId },
      data: { checkedOutAt: c.at, checkoutMethod: c.method, checkoutOverriddenBy: c.overriddenBy },
      select: checkinSelect,
    });
  }
}
