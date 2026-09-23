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
