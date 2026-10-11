import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { type AssignmentRow, ASSIGNMENT_INCLUDE, toAssignmentDto } from './assignment.mapper.js';
import { generateWeekSchedule, type HistoryEntry } from './algorithms/fair-rotation.js';
import type { AssignmentDto } from './dto/assignment-response.dto.js';
import { shiftWeek, weekRange } from './week.js';

/** Số tuần lịch sử dùng để tính tải tích lũy; rào chỉ nhìn 2 tuần gần nhất. */
const HISTORY_WEEKS = 6;
const P2002 = 'P2002';

export interface GenerateWeekResult {
  assignments: AssignmentDto[];
  relaxed: boolean;
  /** Số ca mới tạo (0 nếu tuần đã có lịch và source = AUTO). */
  created: number;
}

/** Dùng chung cho nút Shuffle (SHUFFLE) và cron Chủ Nhật (AUTO). */
@Injectable()
export class ChoreScheduleService {
  constructor(private readonly prisma: PrismaService) {}

  async generateWeek(
    houseId: string,
    weekKey: string,
    source: 'AUTO' | 'SHUFFLE',
  ): Promise<GenerateWeekResult> {
    const existing = await this.fetchWeek(houseId, weekKey);
    if (source === 'AUTO' && existing.length > 0) {
      return { assignments: existing.map(toAssignmentDto), relaxed: false, created: 0 };
    }

    const [members, chores] = await Promise.all([
      this.prisma.houseMember.findMany({
        where: { houseId, leftAt: null },
        select: { id: true },
        orderBy: { joinedAt: 'asc' },
      }),
      this.prisma.chore.findMany({
        where: { houseId, isActive: true },
        select: { id: true, weight: true },
        orderBy: { createdAt: 'asc' },
      }),
    ]);
    if (members.length === 0 || chores.length === 0) {
      throw new BadRequestException('Chưa có việc hoặc thành viên để xếp lịch.');
    }

    // Ca đã nộp / đã duyệt / quá hạn được giữ nguyên; chỉ xếp lại các ca còn TODO.
    const kept = existing.filter((a) => a.status !== 'TODO');
    const keptChoreIds = new Set(kept.map((a) => a.choreId));
    const toArrange = chores.filter((c) => !keptChoreIds.has(c.id));
    if (toArrange.length === 0) {
      return { assignments: kept.map(toAssignmentDto), relaxed: false, created: 0 };
    }

    const extraLoad: Record<string, number> = {};
    for (const a of kept) extraLoad[a.assigneeId] = (extraLoad[a.assigneeId] ?? 0) + a.chore.weight;

    const result = generateWeekSchedule({
      memberIds: members.map((m) => m.id),
      chores: toArrange,
      history: await this.loadHistory(houseId, weekKey),
      currentWeekIndex: HISTORY_WEEKS,
      extraLoad,
    });

    const dueAt = weekRange(weekKey).dueAt;
    try {
      await this.prisma.$transaction([
        this.prisma.choreAssignment.deleteMany({ where: { houseId, weekKey, status: 'TODO' } }),
        this.prisma.choreAssignment.createMany({
          data: result.assignments.map((a) => ({
            houseId,
            weekKey,
            dueAt,
            source,
            choreId: a.choreId,
            assigneeId: a.memberId,
            originalAssigneeId: a.memberId,
          })),
        }),
      ]);
    } catch (e) {
      // Hai lần tạo lịch cùng lúc (vd. cron chạy trùng): bên thua gặp unique (choreId, weekKey).
      if ((e as { code?: string }).code !== P2002) throw e;
      if (source === 'AUTO') {
        const now = await this.fetchWeek(houseId, weekKey);
        return { assignments: now.map(toAssignmentDto), relaxed: false, created: 0 };
      }
      throw new ConflictException('Lịch tuần này vừa được cập nhật, hãy thử lại.');
    }

    const assignments = (await this.fetchWeek(houseId, weekKey)).map(toAssignmentDto);
    return { assignments, relaxed: result.relaxed, created: result.assignments.length };
  }

  fetchWeek(houseId: string, weekKey: string): Promise<AssignmentRow[]> {
    return this.prisma.choreAssignment.findMany({
      where: { houseId, weekKey },
      include: ASSIGNMENT_INCLUDE,
      orderBy: [{ chore: { createdAt: 'asc' } }, { id: 'asc' }],
    });
  }

  /** weekIndex: tuần liền trước = HISTORY_WEEKS - 1, xa nhất = 0. */
  private async loadHistory(houseId: string, weekKey: string): Promise<HistoryEntry[]> {
    const indexOf = new Map<string, number>();
    for (let k = 1; k <= HISTORY_WEEKS; k++) indexOf.set(shiftWeek(weekKey, -k), HISTORY_WEEKS - k);
    const rows = await this.prisma.choreAssignment.findMany({
      where: { houseId, weekKey: { in: [...indexOf.keys()] } },
      select: { choreId: true, assigneeId: true, weekKey: true },
    });
    return rows.map((r) => ({
      weekIndex: indexOf.get(r.weekKey)!,
      choreId: r.choreId,
      memberId: r.assigneeId,
    }));
  }
}
