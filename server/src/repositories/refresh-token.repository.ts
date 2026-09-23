import type { DbClient } from "../db/prisma.js";

export interface RefreshTokenRecord {
  id: string;
  familyId: string;
  userId: string;
  expiresAt: Date;
  rotatedAt: Date | null;
  revokedAt: Date | null;
}

export class RefreshTokenRepository {
  constructor(private readonly db: DbClient) {}

  async create(record: { id: string; familyId: string; userId: string; expiresAt: Date }): Promise<void> {
    await this.db.refreshToken.create({ data: record });
  }

  findById(id: string): Promise<RefreshTokenRecord | null> {
    return this.db.refreshToken.findUnique({ where: { id } });
  }

  /**
   * Atomically marks a live token as rotated. Returns false if the token was
   * already rotated or revoked — i.e. it is being replayed. The conditional
   * UPDATE makes two concurrent refreshes with the same token race safely:
   * exactly one wins.
   */
  async markRotated(id: string, at: Date): Promise<boolean> {
    const result = await this.db.refreshToken.updateMany({
      where: { id, rotatedAt: null, revokedAt: null },
      data: { rotatedAt: at },
    });
    return result.count === 1;
  }

  async revokeFamily(familyId: string, at: Date): Promise<void> {
    await this.db.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: at },
    });
  }
}
