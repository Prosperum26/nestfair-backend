import type { Prisma, PrismaClient } from '../../generated/prisma/client.js';
import type { EventActor } from './events.service.js';

type Db = PrismaClient | Prisma.TransactionClient;

/** Người gây ra sự kiện theo userId (tên đầy đủ chụp lúc phát; client tự rút gọn). */
export async function actorOfUser(db: Db, userId: string): Promise<EventActor> {
  const user = await db.user.findUniqueOrThrow({ where: { id: userId }, select: { id: true, fullName: true } });
  return { userId: user.id, name: user.fullName };
}

/** Như trên, theo HouseMember.id. */
export async function actorOfMember(db: Db, memberId: string): Promise<EventActor> {
  const m = await db.houseMember.findUniqueOrThrow({ where: { id: memberId }, select: { user: { select: { id: true, fullName: true } } } });
  return { userId: m.user.id, name: m.user.fullName };
}
