import { Injectable } from '@nestjs/common';
import type { ChoreSwapRequest } from '../../generated/prisma/client.js';
import type { SwapResolution } from '../../generated/prisma/enums.js';
import type { Db } from '../chores/schedule-context.js';
import type { Outbox } from '../events/events.service.js';
import { closeSwap } from './swap-close.js';

/**
 * Hủy yêu cầu PENDING khi ca hoặc người liên quan thay đổi từ chỗ khác (check-in, quá hạn, rời nhà, re-roll).
 *
 * Thứ tự khóa giống `accept` (yêu cầu trước, ca sau) để không deadlock: bên gọi PHẢI gọi `lockPendingFor`
 * trước khi sửa dòng ca, rồi mới gọi các hàm `cancel*` sau khi sửa. Sự kiện xếp vào `outbox`, bên gọi `flush()` sau commit.
 */
@Injectable()
export class SwapLifecycleService {
  /** Giữ khóa dòng các yêu cầu PENDING có dính tới các ca này. Trả id yêu cầu. */
  async lockPendingFor(tx: Db, assignmentIds: string[]): Promise<string[]> {
    if (!assignmentIds.length) return [];
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM chore_swap_requests
      WHERE status = 'PENDING'
        AND ("fromAssignmentId" = ANY(${assignmentIds}::uuid[]) OR "toAssignmentId" = ANY(${assignmentIds}::uuid[]))
      ORDER BY id FOR UPDATE`;
    return rows.map((r) => r.id);
  }

  async cancelPendingForAssignments(tx: Db, outbox: Outbox, assignmentIds: string[], resolution: SwapResolution): Promise<string[]> {
    const ids = await this.lockPendingFor(tx, assignmentIds);
    return this.closeAll(tx, outbox, ids, () => resolution);
  }

  /** Chủ ca tự nộp ảnh: nếu là ca của người gửi thì "người gửi tự làm", ngược lại ca đích đã đổi. */
  async cancelOnCheckin(tx: Db, outbox: Outbox, assignmentId: string): Promise<string[]> {
    const ids = await this.lockPendingFor(tx, [assignmentId]);
    return this.closeAll(tx, outbox, ids, (s) => (s.fromAssignmentId === assignmentId ? 'REQUESTER_DID_IT' : 'SLOT_CHANGED'));
  }

  async cancelPendingForMember(tx: Db, outbox: Outbox, memberId: string, resolution: 'MEMBER_LEFT'): Promise<string[]> {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM chore_swap_requests
      WHERE status = 'PENDING' AND ("requesterMemberId" = ${memberId}::uuid OR "targetMemberId" = ${memberId}::uuid)
      ORDER BY id FOR UPDATE`;
    return this.closeAll(tx, outbox, rows.map((r) => r.id), () => resolution);
  }

  /** Mọi yêu cầu PENDING của cả nhà (giải tán nhà). */
  async cancelAllPendingInHouse(tx: Db, outbox: Outbox, houseId: string, resolution: 'MEMBER_LEFT'): Promise<string[]> {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM chore_swap_requests WHERE status = 'PENDING' AND "houseId" = ${houseId}::uuid ORDER BY id FOR UPDATE`;
    return this.closeAll(tx, outbox, rows.map((r) => r.id), () => resolution);
  }

  /** Mọi yêu cầu PENDING có ca thuộc tuần `weekStart` của nhà (Admin dọn trước khi re-roll). */
  async cancelPendingInWeek(tx: Db, outbox: Outbox, houseId: string, weekStart: Date, resolution: SwapResolution): Promise<string[]> {
    const slots = await tx.choreAssignment.findMany({ where: { houseId, weekStart }, select: { id: true } });
    return this.cancelPendingForAssignments(tx, outbox, slots.map((s) => s.id), resolution);
  }

  private async closeAll(tx: Db, outbox: Outbox, ids: string[], resolutionFor: (s: ChoreSwapRequest) => SwapResolution): Promise<string[]> {
    if (!ids.length) return [];
    const rows = await tx.choreSwapRequest.findMany({ where: { id: { in: ids }, status: 'PENDING' }, orderBy: { id: 'asc' } });
    const members = await tx.houseMember.findMany({
      where: { id: { in: rows.flatMap((r) => [r.requesterMemberId, r.targetMemberId]).filter((x): x is string => !!x) } },
      select: { id: true, userId: true },
    });
    const userOf = new Map(members.map((m) => [m.id, m.userId]));
    for (const swap of rows) {
      const resolution = resolutionFor(swap);
      await closeSwap(tx, swap, 'CANCELLED', resolution);
      const payload = { swapId: swap.id, resolution };
      if (swap.targetMemberId === null) {
        outbox.toHouse(swap.houseId, 'swap:cancelled', payload);
        continue;
      }
      for (const memberId of [swap.requesterMemberId, swap.targetMemberId]) {
        const userId = userOf.get(memberId);
        if (userId) outbox.toUser(userId, 'swap:cancelled', payload, { houseId: swap.houseId });
      }
    }
    return rows.map((r) => r.id);
  }
}
