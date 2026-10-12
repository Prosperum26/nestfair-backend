import type { WeekSchedule } from '../../generated/prisma/client.js';
import type { GeneratedBy, ScheduleStatus } from '../../generated/prisma/enums.js';
import { ALGO_VERSION, type GenResult, type GenSlot } from './algorithms/schedule-generator.js';
import { dateOf, type Db, type GenContext } from './schedule-context.js';
import { type DateStr, dueAtOf, weekKeyFromStart } from './week.js';

/** Các cột của WeekSchedule lấy từ kết quả thuật toán (dùng cho tạo mới và re-roll). */
export function scheduleFields(res: GenResult, seed: number) {
  return {
    seed,
    attempts: res.attempts,
    fenceWeeksApplied: res.fenceWeeksApplied,
    relaxLevel: res.relaxLevel,
    relaxed: res.relaxed,
    reasons: res.reasons,
    loadSnapshot: { after: res.loadAfter },
    algoVersion: ALGO_VERSION,
  };
}

/** Ghi các ca của một lịch: snapshot tên/weight, hạn theo giờ nhà, người gốc = người được giao. */
export async function storeSlots(tx: Db, houseId: string, schedule: WeekSchedule, ctx: GenContext, slots: GenSlot[]): Promise<void> {
  if (slots.length === 0) return;
  await tx.choreAssignment.createMany({
    data: slots.map((s) => {
      const chore = ctx.chores.get(s.choreId)!;
      return {
        houseId,
        scheduleId: schedule.id,
        choreId: s.choreId,
        assigneeId: s.memberId,
        originalAssigneeId: s.memberId,
        weekKey: schedule.weekKey,
        weekStart: schedule.weekStart,
        occurrenceDate: dateOf(s.occurrenceDate),
        slotIndex: s.slotIndex,
        dueAt: dueAtOf(s.occurrenceDate, chore.dueTime),
        titleSnapshot: chore.title,
        weightSnapshot: chore.weight,
        source: s.source,
        status: s.memberId ? ('TODO' as const) : ('UNASSIGNED' as const),
      };
    }),
  });
}

/** Tạo WeekSchedule + các ca từ kết quả đã sinh. */
export async function createScheduleRows(
  tx: Db,
  houseId: string,
  weekStart: DateStr,
  by: GeneratedBy,
  seed: number,
  ctx: GenContext,
  res: GenResult,
  status: ScheduleStatus,
): Promise<WeekSchedule> {
  const schedule = await tx.weekSchedule.create({
    data: { houseId, weekStart: dateOf(weekStart), weekKey: weekKeyFromStart(weekStart), status, generatedBy: by, ...scheduleFields(res, seed) },
  });
  await storeSlots(tx, houseId, schedule, ctx, res.slots);
  return schedule;
}
