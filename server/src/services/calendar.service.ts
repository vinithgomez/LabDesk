import ical, { ICalEventStatus } from "ical-generator";
import { readIcsToken, signIcsToken } from "../auth/ics-token.js";
import { DomainError } from "../domain/errors.js";
import type { Actor, BookingStatus } from "../domain/types.js";
import type { UnitOfWork } from "../repositories/index.js";

/**
 * Only bookings that are (or were) really happening appear in a feed.
 * Pending ones aren't confirmed; cancelled, rejected (which includes
 * expired) and no-show ones never happened or were called off.
 */
export const FEED_STATUSES: readonly BookingStatus[] = ["approved", "checked_in", "completed"];

/** How far back a feed reaches; everything upcoming is included. */
export const FEED_LOOKBACK_DAYS = 90;
const FEED_MAX_EVENTS = 1000;
const DAY_MS = 86_400_000;

const feedNotFound = (): DomainError => new DomainError("NOT_FOUND", "Calendar feed not found");

/**
 * Per-user ICS calendar feeds (CLAUDE.md §9). The feed URL embeds a signed
 * token (src/auth/ics-token.ts); the only state is the user's feed version.
 */
export class CalendarService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly config: { publicApiUrl: string; icsTokenSecret: string },
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** The caller's current feed URL. */
  async feedUrl(actor: Actor): Promise<string> {
    const version = await this.uow.read.users.findFeedVersion(actor.id);
    if (version === null) throw feedNotFound();
    return this.urlFor(actor.id, version);
  }

  /**
   * Issues a new feed URL and revokes every earlier one (a calendar link
   * that was shared and shouldn't have been). Audited.
   */
  async regenerate(actor: Actor): Promise<string> {
    const version = await this.uow.transaction(async (tx) => {
      await tx.users.lockById(actor.id);
      const before = await tx.users.findFeedVersion(actor.id);
      if (before === null) throw feedNotFound();
      const after = await tx.users.bumpFeedVersion(actor.id);
      await tx.writeAudit({
        actorId: actor.id,
        entityType: "user",
        entityId: actor.id,
        action: "user.calendar_feed_regenerated",
        // "feedVersion", not "...token...": snapshots drop token-like keys.
        before: { feedVersion: before },
        after: { feedVersion: after },
      });
      return after;
    });
    return this.urlFor(actor.id, version);
  }

  /**
   * The ICS document for a feed token. Any token that doesn't verify, is
   * from a revoked version, or belongs to a deactivated user is the same
   * NOT_FOUND, so a probe learns nothing.
   */
  async render(token: string): Promise<string> {
    const claim = readIcsToken(this.config.icsTokenSecret, token);
    if (!claim) throw feedNotFound();
    const user = await this.uow.read.users.findById(claim.userId);
    const version = await this.uow.read.users.findFeedVersion(claim.userId);
    if (!user || !user.isActive || version !== claim.version) throw feedNotFound();

    const bookings = await this.uow.read.bookings.list(
      { kind: "own", userId: user.id },
      {
        statuses: FEED_STATUSES,
        from: new Date(this.now().getTime() - FEED_LOOKBACK_DAYS * DAY_MS),
        limit: FEED_MAX_EVENTS,
      },
    );
    const resources = new Map(
      (await this.uow.read.resources.findManyByIds([...new Set(bookings.map((b) => b.resourceId))])).map((r) => [r.id, r]),
    );

    const calendar = ical({
      name: "LabDesk bookings",
      prodId: { company: "LabDesk", product: "Bookings", language: "EN" },
      // A hint to calendar apps on how often to refresh.
      ttl: 15 * 60,
    });
    for (const b of bookings) {
      const resource = resources.get(b.resourceId);
      calendar.createEvent({
        id: `${b.id}@labdesk`,
        start: b.startsAt,
        end: b.endsAt,
        stamp: b.updatedAt,
        summary: resource ? resource.name : "LabDesk booking",
        location: resource?.location ?? null,
        description: [b.purpose, `Status: ${b.status.replace("_", " ")}`].filter(Boolean).join("\n"),
        status: ICalEventStatus.CONFIRMED,
      });
    }
    return calendar.toString();
  }

  private urlFor(userId: string, version: number): string {
    return `${this.config.publicApiUrl}/api/calendar/${signIcsToken(this.config.icsTokenSecret, userId, version)}.ics`;
  }
}
