import { randomBytes } from 'node:crypto';
import { addDays, toDateStr } from '../../src/modules/chores/week.js';
import type { createFixture } from './house-fixture.js';

type Fx = Awaited<ReturnType<typeof createFixture>>;

const PNG_HEAD = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Ảnh PNG giả có nội dung ngẫu nhiên (mỗi lần gọi một băm khác nhau). */
export const png = (size = 2048): Buffer => Buffer.concat([Buffer.from(PNG_HEAD), randomBytes(size - PNG_HEAD.length)]);

export const HOUR = 3_600_000;
export const today = () => toDateStr(new Date());
export const dateOf = (ds: string) => new Date(`${ds}T00:00:00Z`);

export interface MakeAssignment {
  /** Chỉ số trong `users` của người được giao (mặc định 1). */
  assignee?: number;
  status?: 'TODO' | 'PENDING_VERIFY' | 'DONE' | 'REJECTED' | 'MISSED' | 'CANCELLED' | 'UNASSIGNED';
  /** Ngày làm; mặc định hôm qua (cửa sổ check-in đã mở, không phụ thuộc giờ chạy test). */
  occurrenceDate?: string;
  dueAt?: Date;
  rejectCount?: number;
  disputed?: boolean;
  proofImageUrl?: string;
  proofHash?: string;
  submittedAt?: Date;
  checkinKey?: string;
  rejectReason?: string;
}

/** Tạo nhà + 1 ca trực trực tiếp trong DB (không đi qua thuật toán sinh lịch). */
export async function assignmentIn(
  fx: Fx,
  names: string[],
  over: MakeAssignment = {},
  chore: { title?: string; weight?: number } = {},
) {
  const house = await fx.houseWith(names);
  const row = await makeAssignment(fx, house, over, chore);
  return { ...house, assignment: row };
}

export async function makeAssignment(
  fx: Fx,
  house: Awaited<ReturnType<Fx['houseWith']>>,
  over: MakeAssignment = {},
  chore: { title?: string; weight?: number } = {},
) {
  const c = await fx.prisma.chore.create({
    data: { houseId: house.houseId, title: chore.title ?? 'Đổ rác', weight: chore.weight ?? 2, recurrenceDays: [7], dueTime: '21:00' },
  });
  const occurrenceDate = over.occurrenceDate ?? addDays(today(), -1);
  const weekStart = addDays(occurrenceDate, -((new Date(`${occurrenceDate}T00:00:00Z`).getUTCDay() + 6) % 7));
  const member = house.memberId(house.users[over.assignee ?? 1]);
  return fx.prisma.choreAssignment.create({
    data: {
      houseId: house.houseId,
      choreId: c.id,
      assigneeId: member,
      originalAssigneeId: member,
      weekKey: 'test',
      weekStart: dateOf(weekStart),
      occurrenceDate: dateOf(occurrenceDate),
      dueAt: over.dueAt ?? new Date(Date.now() + 2 * 24 * HOUR),
      titleSnapshot: c.title,
      weightSnapshot: c.weight,
      source: 'ROTATION',
      status: over.status ?? 'TODO',
      rejectCount: over.rejectCount ?? 0,
      disputed: over.disputed ?? false,
      proofImageUrl: over.proofImageUrl,
      proofHash: over.proofHash,
      submittedAt: over.submittedAt,
      checkinKey: over.checkinKey,
      rejectReason: over.rejectReason,
    },
  });
}
