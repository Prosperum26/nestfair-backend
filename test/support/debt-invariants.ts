import { expect } from 'vitest';
import type { createFixture } from './house-fixture.js';

type Fx = Awaited<ReturnType<typeof createFixture>>;

/**
 * Bất biến của sổ nợ ca: mọi nợ OPEN đang trỏ tới một ca bù thì ca đó phải tồn tại, còn TODO, và đang do đúng
 * người nợ giữ. Gọi sau từng thao tác làm đổi ca hoặc nợ.
 */
export async function expectDebtInvariants(fx: Fx, houseId: string, label = ''): Promise<void> {
  const debts = await fx.prisma.choreDebt.findMany({ where: { houseId, status: 'OPEN', paybackAssignmentId: { not: null } } });
  for (const d of debts) {
    const slot = await fx.prisma.choreAssignment.findUnique({ where: { id: d.paybackAssignmentId! } });
    expect(slot, `${label}: ca bù của nợ ${d.id} phải tồn tại`).not.toBeNull();
    expect(slot!.status, `${label}: ca bù của nợ ${d.id} phải còn TODO`).toBe('TODO');
    expect(slot!.assigneeId, `${label}: ca bù của nợ ${d.id} phải do người nợ giữ`).toBe(d.debtorMemberId);
  }
}
