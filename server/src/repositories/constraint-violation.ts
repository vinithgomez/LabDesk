/**
 * A database constraint rejected a write. Repositories translate driver
 * errors into this, so services can map constraint names to domain errors
 * without importing Prisma.
 */
export class ConstraintViolation extends Error {
  constructor(
    /** SQLSTATE, e.g. 23P01 (exclusion_violation) or 23505 (unique_violation). */
    public readonly sqlState: string,
    /** Name of the violated constraint or index, when Postgres reports one. */
    public readonly constraint: string | null,
    message: string,
  ) {
    super(message);
    this.name = "ConstraintViolation";
  }
}
