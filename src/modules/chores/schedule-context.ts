import type { Prisma, PrismaClient } from '../../generated/prisma/client.js';
import type { GenChore, GenInput, GenMember } from './algorithms/schedule-generator.js';
import { type HistSlot, neutralCredits, LOAD_WEEKS } from './algorithms/load.js';
import { addDays, type DateStr } from './week.js';

/** PrismaService hoặc client trong transaction. */
export type Db = PrismaClient | Prisma.TransactionClient;

export const dateOf = (ds: DateStr): Date => new Date(`${ds}T00:00:00.000Z`);
export const dsOf = (d: Date): DateStr => d.toISOString().slice(0, 10);

/** Trạng thái ca được tính vào rào và tải (loại MISSED, CANCELLED, UNASSIGNED). */
export const COUNTED_STATUSES = ['TODO', 'PENDING_VERIFY', 'REJECTED', 'DONE'] as const;

const WEEK_DAYS = (weekStart: DateStr) => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

/** Các ngày trong [from, to] (gồm hai đầu) giao với tuần `weekStart`. */
function overlapDates(weekStart: DateStr, from: Date, to: Date): DateStr[] {
  const f = dsOf(from);
  const t = dsOf(to);
  return WEEK_DAYS(weekStart).filter((d) => d >= f && d <= t);
}

export interface ChoreMeta {
  id: string;
  title: string;
  weight: number;
  dueTime: string;
}

export interface GenContext {
  input: GenInput;
  chores: Map<string, ChoreMeta>;
  /** Người đang ở nhà: id (HouseMember) → userId. */
  userOf: Map<string, string>;
}

/** Số tuần trước ngày bắt đầu mà thành viên vào nhà vẫn coi là "người mới" (S-17). */
const NEW_MEMBER_WEEKS = 4;

/**
 * Gom mọi thứ thuật toán cần cho tuần `weekStart`: thành viên (kèm ngày vắng), việc đang bật, ngày nghỉ nhà,
 * lịch sử 6 tuần **có lịch** gần nhất, đuôi PER_OCCURRENCE và tín dụng trung lập.
 */
export async function buildGenContext(db: Db, houseId: string, weekStart: DateStr, seed: number): Promise<GenContext> {
  const house = await db.house.findUniqueOrThrow({
    where: { id: houseId },
    select: { maxSlotsPerPersonPerDay: true },
  });
  const members = await db.houseMember.findMany({
    where: { houseId, leftAt: null },
    select: { id: true, userId: true, joinedAt: true },
    orderBy: { joinedAt: 'asc' },
  });
  const choreRows = await db.chore.findMany({ where: { houseId, isActive: true }, orderBy: { createdAt: 'asc' } });

  // Vắng / nghỉ trong tuần đang sinh.
  const weekEnd = addDays(weekStart, 6);
  const absences = await db.memberAbsence.findMany({
    where: { houseId, startDate: { lte: dateOf(weekEnd) }, endDate: { gte: dateOf(weekStart) } },
  });
  const breaks = await db.houseBreak.findMany({
    where: { houseId, startDate: { lte: dateOf(weekEnd) }, endDate: { gte: dateOf(weekStart) } },
  });
  const absentByUser = new Map<string, Set<DateStr>>();
  for (const a of absences) {
    const set = absentByUser.get(a.userId) ?? new Set<DateStr>();
    for (const d of overlapDates(weekStart, a.startDate, a.endDate)) set.add(d);
    absentByUser.set(a.userId, set);
  }
  const houseBreakDates = new Set<DateStr>();
  for (const b of breaks) for (const d of overlapDates(weekStart, b.startDate, b.endDate)) houseBreakDates.add(d);

  // 6 tuần có lịch gần nhất trước tuần này (bỏ tuần EMPTY: S-32).
  const scheduled = await db.weekSchedule.findMany({
    where: { houseId, weekStart: { lt: dateOf(weekStart) }, status: { not: 'EMPTY' } },
    orderBy: { weekStart: 'desc' },
    take: LOAD_WEEKS,
    select: { weekStart: true },
  });
  const weeksBackOf = new Map<DateStr, number>(scheduled.map((s, i) => [dsOf(s.weekStart), i + 1]));
  const pastSlots = scheduled.length
    ? await db.choreAssignment.findMany({
        where: {
          houseId,
          weekStart: { in: scheduled.map((s) => s.weekStart) },
          assigneeId: { not: null },
          status: { in: [...COUNTED_STATUSES] },
        },
        select: { choreId: true, assigneeId: true, weightSnapshot: true, source: true, weekStart: true },
      })
    : [];
  const history: HistSlot[] = pastSlots.map((s) => ({
    weeksBack: weeksBackOf.get(dsOf(s.weekStart))!,
    choreId: s.choreId,
    memberId: s.assigneeId!,
    weight: s.weightSnapshot,
    source: s.source,
  }));

  // Tín dụng trung lập cho người từng vắng cả một tuần trong quá khứ (S-21).
  const credit: Record<string, number> = {};
  if (scheduled.length) {
    const oldest = dsOf(scheduled[scheduled.length - 1].weekStart);
    const pastAbs = await db.memberAbsence.findMany({
      where: { houseId, startDate: { lte: dateOf(addDays(dsOf(scheduled[0].weekStart), 6)) }, endDate: { gte: dateOf(oldest) } },
    });
    const weeks = scheduled.map((s, i) => {
      const ws = dsOf(s.weekStart);
      const days = WEEK_DAYS(ws);
      const absentWholeWeek = new Set<string>();
      for (const m of members) {
        const mine = pastAbs.filter((a) => a.userId === m.userId);
        const covered = days.every((d) => mine.some((a) => dsOf(a.startDate) <= d && dsOf(a.endDate) >= d));
        if (covered) absentWholeWeek.add(m.id);
      }
      const loadByMember: Record<string, number> = {};
      for (const m of members) loadByMember[m.id] = 0;
      for (const h of history) if (h.weeksBack === i + 1 && h.memberId in loadByMember) loadByMember[h.memberId] += h.weight;
      return { weeksBack: i + 1, loadByMember, absentWholeWeek };
    });
    Object.assign(credit, neutralCredits(weeks));
  }

  // Đuôi chuỗi của các việc PER_OCCURRENCE: người làm lần cuối trước tuần này.
  const perIds = choreRows.filter((c) => c.rotationMode === 'PER_OCCURRENCE').map((c) => c.id);
  const prevTail: Record<string, string | null> = {};
  if (perIds.length) {
    const tails = await db.choreAssignment.findMany({
      where: {
        houseId,
        choreId: { in: perIds },
        occurrenceDate: { lt: dateOf(weekStart) },
        assigneeId: { not: null },
        status: { notIn: ['CANCELLED', 'UNASSIGNED'] },
      },
      orderBy: { occurrenceDate: 'desc' },
      distinct: ['choreId'],
      select: { choreId: true, assigneeId: true },
    });
    for (const t of tails) prevTail[t.choreId] = t.assigneeId;
  }

  const newCutoff = addDays(weekStart, -7 * NEW_MEMBER_WEEKS);
  const genMembers: GenMember[] = members.map((m) => ({
    id: m.id,
    absentDates: absentByUser.get(m.userId) ?? new Set<DateStr>(),
    isNew: dsOf(m.joinedAt) >= newCutoff,
  }));
  const genChores: GenChore[] = choreRows.map((c) => ({
    id: c.id,
    weight: c.weight,
    frequency: c.frequency,
    recurrenceDays: c.recurrenceDays,
    rotationMode: c.rotationMode,
    occurrenceGap: c.occurrenceGap,
  }));

  return {
    input: {
      seed,
      weekStart,
      houseBreakDates,
      maxSlotsPerDay: house.maxSlotsPerPersonPerDay,
      members: genMembers,
      chores: genChores,
      history,
      prevTail,
      pinned: [],
      credit,
    },
    chores: new Map(choreRows.map((c) => [c.id, { id: c.id, title: c.title, weight: c.weight, dueTime: c.dueTime }])),
    userOf: new Map(members.map((m) => [m.id, m.userId])),
  };
}
