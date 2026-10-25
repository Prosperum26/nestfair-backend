import type { Prisma } from '../../generated/prisma/client.js';

/**
 * Các cột của User được phép trả ra API. Mọi query trả user cho client phải dùng select này
 * để passwordHash / googleId không bao giờ lọt ra ngoài.
 */
export const publicUserSelect = {
  id: true,
  email: true,
  fullName: true,
  phone: true,
  bankBin: true,
  bankAccount: true,
  avatarUrl: true,
  ocrConsentAt: true,
  assistantConsentAt: true,
  createdAt: true,
} satisfies Prisma.UserSelect;

export type PublicUser = Prisma.UserGetPayload<{
  select: typeof publicUserSelect;
}>;
