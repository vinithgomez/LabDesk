import type { Response } from "express";
import { z } from "zod";

/** ISO-8601 on the wire; the output type is what the frontend infers. */
export const isoDateTime = z.date().transform((d) => d.toISOString());

/**
 * Sends `{ data }`. Every payload goes through its response schema, which
 * both documents the contract and strips anything not declared in it
 * (password hashes, QR secrets) as defence in depth.
 */
export function respond<S extends z.ZodType>(
  res: Response,
  status: number,
  schema: S,
  data: z.input<S>,
  meta?: Record<string, string>,
): void {
  res.status(status).json(meta ? { data: schema.parse(data), meta } : { data: schema.parse(data) });
}
