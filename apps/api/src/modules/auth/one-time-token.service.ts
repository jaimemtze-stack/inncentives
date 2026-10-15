import { Injectable } from '@nestjs/common';
import type { OneTimeTokenPurpose } from '@prisma/client';
import { randomToken, sha256 } from '../../common/crypto/tokens';
import { PrismaService } from '../../common/prisma/prisma.service';

/** Single-use tokens for invitations and password resets: 256-bit, hashed at rest, short-lived. */
@Injectable()
export class OneTimeTokenService {
  constructor(private readonly prisma: PrismaService) {}

  async issue(userId: string, purpose: OneTimeTokenPurpose, ttlMs: number): Promise<string> {
    const token = randomToken(32);
    await this.prisma.$transaction([
      // Only the latest token of a purpose is valid.
      this.prisma.oneTimeToken.updateMany({
        where: { userId, purpose, usedAt: null },
        data: { usedAt: new Date() },
      }),
      this.prisma.oneTimeToken.create({
        data: {
          userId,
          purpose,
          tokenHash: sha256(token),
          expiresAt: new Date(Date.now() + ttlMs),
        },
      }),
    ]);
    return token;
  }

  /** Atomically consumes a token. Returns the user id or null if invalid, used or expired. */
  async consume(token: string, purpose: OneTimeTokenPurpose): Promise<string | null> {
    const tokenHash = sha256(token);
    const now = new Date();
    const res = await this.prisma.oneTimeToken.updateMany({
      where: { tokenHash, purpose, usedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now },
    });
    if (res.count !== 1) return null;
    const row = await this.prisma.oneTimeToken.findUnique({
      where: { tokenHash },
      select: { userId: true },
    });
    return row?.userId ?? null;
  }
}
