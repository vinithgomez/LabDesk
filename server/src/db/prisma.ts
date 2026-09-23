import { PrismaClient, Prisma } from "@prisma/client";

export { PrismaClient, Prisma };

/** Either the root client or a client bound to an open transaction. */
export type DbClient = PrismaClient | Prisma.TransactionClient;

export function createPrismaClient(databaseUrl: string): PrismaClient {
  return new PrismaClient({ datasourceUrl: databaseUrl });
}

export function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

/**
 * Extracts SQLSTATE and constraint name from a failed raw query (P2010) or a
 * Prisma-level unique violation (P2002). Returns null for anything else.
 */
export function constraintViolationOf(err: unknown): { sqlState: string; constraint: string | null; message: string } | null {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError)) return null;
  if (err.code === "P2002") return { sqlState: "23505", constraint: null, message: err.message };
  if (err.code !== "P2010") return null;
  const meta = err.meta ?? {};
  const sqlState = typeof meta["code"] === "string" ? meta["code"] : null;
  const message = typeof meta["message"] === "string" ? meta["message"] : err.message;
  if (!sqlState || !sqlState.startsWith("23")) return null;
  const constraint = /constraint "([^"]+)"/.exec(message)?.[1] ?? null;
  return { sqlState, constraint, message };
}

