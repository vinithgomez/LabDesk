import jwt from "jsonwebtoken";
import { z } from "zod";

const accessClaims = z.object({ sub: z.string(), typ: z.literal("access") });
const refreshClaims = z.object({
  sub: z.string(),
  jti: z.string(),
  fam: z.string(),
  typ: z.literal("refresh"),
});

export type RefreshClaims = z.infer<typeof refreshClaims>;

export interface TokenSigner {
  signAccess(userId: string): string;
  verifyAccess(token: string): { userId: string } | null;
  signRefresh(claims: { userId: string; tokenId: string; familyId: string }): string;
  verifyRefresh(token: string): { userId: string; tokenId: string; familyId: string } | null;
}

export function createTokenSigner(opts: {
  accessSecret: string;
  refreshSecret: string;
  accessTtlSeconds: number;
  refreshTtlSeconds: number;
}): TokenSigner {
  const verify = <T>(token: string, secret: string, schema: z.ZodType<T>): T | null => {
    try {
      const decoded = jwt.verify(token, secret, { algorithms: ["HS256"] });
      const parsed = schema.safeParse(decoded);
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  };

  return {
    signAccess: (userId) =>
      jwt.sign({ typ: "access" }, opts.accessSecret, {
        subject: userId,
        expiresIn: opts.accessTtlSeconds,
        algorithm: "HS256",
      }),

    verifyAccess: (token) => {
      const claims = verify(token, opts.accessSecret, accessClaims);
      return claims ? { userId: claims.sub } : null;
    },

    signRefresh: ({ userId, tokenId, familyId }) =>
      jwt.sign({ typ: "refresh", fam: familyId }, opts.refreshSecret, {
        subject: userId,
        jwtid: tokenId,
        expiresIn: opts.refreshTtlSeconds,
        algorithm: "HS256",
      }),

    verifyRefresh: (token) => {
      const claims = verify(token, opts.refreshSecret, refreshClaims);
      return claims ? { userId: claims.sub, tokenId: claims.jti, familyId: claims.fam } : null;
    },
  };
}
