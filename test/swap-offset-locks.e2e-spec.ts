import { randomUUID } from 'node:crypto';
import { addDays, currentWeekStart } from '../src/modules/chores/week.js';
import { HOUR, makeAssignment } from './support/assignment-fixture.js';
import { createFixture } from './support/house-fixture.js';

type Fx = Awaited<ReturnType<typeof createFixture>>;
type House = Awaited<ReturnType<Fx['houseWith']>>;

/**
 * B3: cấn trừ nợ (khi ca gốc DONE) chạy song song với việc người được làm bù chọn ca bù cho đúng nợ cũ đó,
 * và nhiều cấn trừ cùng lúc trên cùng một cặp người. Phải tuần tự hóa: không deadlock (40P01), không mất cập nhật,
 * không có nợ vừa PAID (cấn trừ) vừa có ca bù đã giao. Cũng kiểm accept PAYBACK song song không lỗi.
 */
describe('Khóa khi cấn trừ nợ (e2e)', () => {
  let fx: Fx;

  beforeAll(async () => {
    fx = await createFixture('@e2e-swap-offset-locks.nestfair.test');
  });
  afterAll(() => fx.cleanup());

  const hoursFromNow = (n: number) => new Date(Date.now() + n * HOUR);
  const A = 0; // Quân: người nhờ, đồng thời là chủ nợ của B
  const B = 1; // Mai: người làm hộ, đang nợ A

  /** Quân nhờ Mai làm hộ ca `weight` điểm (PAYBACK), Mai nhận. Trả ca gốc đã chuyển sang Mai. */
  async function coverPayback(h: House, weight: number, day = 0) {
    const x = await makeAssignment(fx, h, { assignee: A, occurrenceDate: addDays(currentWeekStart(), 8 + day), dueAt: hoursFromNow(100 + day) }, { weight, title: `Ca ${day}` });
    const created = await fx
      .as(h.users[A].token)
      .post(`/api/v1/houses/${h.houseId}/swaps`, { type: 'COVER', fromAssignmentId: x.id, compensation: 'PAYBACK', targetMemberId: h.memberId(h.users[B]), acknowledgedWarnings: weight >= 4 ? ['WEIGHT_GAP'] : [] })
      .set('Idempotency-Key', randomUUID());
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    return { x, swapId: created.body.id as string };
  }
  const verify = (h: House, slotId: string) => fx.as(h.users[A].token).patch(`/api/v1/assignments/${slotId}/verify`, { decision: 'APPROVED' });

  it('20 request song song (10 duyệt ca gốc → cấn trừ + 10 chọn ca bù cho đúng nợ cũ): không 500 / 40P01, nhất quán', async () => {
    for (let i = 0; i < 12; i++) {
      const h = await fx.houseWith(['Quân', 'Mai', 'Hùng']);
      const a = h.memberId(h.users[A]);
      const b = h.memberId(h.users[B]);
      const nextWeek = addDays(currentWeekStart(), 7);
      const y = await makeAssignment(fx, h, { assignee: A, occurrenceDate: addDays(nextWeek, 2), dueAt: hoursFromNow(120) }, { weight: 2, title: 'Ca bù' });
      // Mai đang nợ Quân 2 điểm, cửa sổ chọn bù đang mở.
      const old = await fx.prisma.choreDebt.create({
        data: { houseId: h.houseId, debtorMemberId: b, creditorMemberId: a, swapRequestId: randomUUID(), coverAssignmentId: randomUUID(), weight: 2, pickOpensAt: hoursFromNow(-1), pickDeadlineAt: hoursFromNow(40) },
      });
      const { x, swapId } = await coverPayback(h, 2);
      await fx.as(h.users[B].token).patch(`/api/v1/swaps/${swapId}/accept`).set('Idempotency-Key', randomUUID()).expect(200);
      await fx.prisma.choreAssignment.update({ where: { id: x.id }, data: { status: 'PENDING_VERIFY', submittedAt: new Date() } });

      const verifies = Array.from({ length: 10 }, () => verify(h, x.id));
      const picks = Array.from({ length: 10 }, () =>
        fx.as(h.users[A].token).patch(`/api/v1/chore-debts/${old.id}/payback`, { assignmentId: y.id }).set('Idempotency-Key', randomUUID()),
      );
      const results = await Promise.all([...verifies, ...picks]);
      expect(results.filter((r) => r.status >= 500).map((r) => `${r.status} ${JSON.stringify(r.body)}`), `vòng ${i}`).toEqual([]);

      const d = await fx.prisma.choreDebt.findUniqueOrThrow({ where: { id: old.id } });
      const fresh = await fx.prisma.choreDebt.findFirstOrThrow({ where: { houseId: h.houseId, id: { not: old.id } } });
      const yNow = await fx.prisma.choreAssignment.findUniqueOrThrow({ where: { id: y.id } });
      if (d.status === 'PAID') {
        // Cấn trừ thắng: nợ cũ trả hết, nợ mới cũng hết, ca bù không bị giao.
        expect(d.paybackAssignmentId, `vòng ${i}: nợ PAID mà còn trỏ ca bù`).toBeNull();
        expect(yNow.assigneeId, `vòng ${i}: ca bù bị giao dù nợ đã cấn trừ`).toBe(a);
        expect(fresh).toMatchObject({ status: 'PAID', closeReason: 'OFFSET' });
      } else {
        // Chọn ca bù thắng: nợ cũ trỏ ca đó, ca thuộc người nợ; cấn trừ bỏ qua nợ này nên nợ mới còn nguyên.
        expect(d, `vòng ${i}`).toMatchObject({ status: 'OPEN', paybackAssignmentId: y.id, weight: 2 });
        expect(yNow).toMatchObject({ assigneeId: b, source: 'PAYBACK' });
        expect(fresh).toMatchObject({ status: 'OPEN', weight: 2 });
      }
    }
  }, 300_000);

  it('accept PAYBACK song song (21 request trên 3 yêu cầu): không 500 / deadlock, mỗi yêu cầu đúng một lần', async () => {
    const h = await fx.houseWith(['Quân', 'Mai']);
    const swapIds: string[] = [];
    for (let i = 0; i < 3; i++) {
      const x = await makeAssignment(fx, h, { assignee: A, occurrenceDate: addDays(currentWeekStart(), 8 + i), dueAt: hoursFromNow(100 + i) }, { weight: 2, title: `Ca ${i}` });
      const res = await fx
        .as(h.users[A].token)
        .post(`/api/v1/houses/${h.houseId}/swaps`, { type: 'COVER', fromAssignmentId: x.id, compensation: 'PAYBACK', targetMemberId: h.memberId(h.users[B]), acknowledgedWarnings: [] })
        .set('Idempotency-Key', randomUUID())
        .expect(201);
      swapIds.push(res.body.id);
    }
    const results = await Promise.all(
      Array.from({ length: 21 }, (_, i) => fx.as(h.users[B].token).patch(`/api/v1/swaps/${swapIds[i % 3]}/accept`).set('Idempotency-Key', randomUUID())),
    );
    expect(results.filter((r) => r.status >= 500).map((r) => `${r.status} ${JSON.stringify(r.body)}`)).toEqual([]);
    expect(results.filter((r) => r.status === 200)).toHaveLength(3);
    expect(await fx.prisma.choreDebt.count({ where: { houseId: h.houseId, status: 'OPEN' } })).toBe(3);
  }, 120_000);

  it('nhiều ca gốc DONE cùng lúc trên cùng một cặp người: cấn trừ không mất cập nhật, tổng nợ ròng giữ nguyên', async () => {
    const h = await fx.houseWith(['Quân', 'Mai']);
    const a = h.memberId(h.users[A]);
    const b = h.memberId(h.users[B]);
    // Mai nợ Quân 3 + 2 + 1 = 6 điểm; Quân nhờ Mai ba ca 2 điểm (6 điểm) và cả ba ca được duyệt cùng lúc.
    for (const weight of [3, 2, 1]) {
      await fx.prisma.choreDebt.create({
        data: { houseId: h.houseId, debtorMemberId: b, creditorMemberId: a, swapRequestId: randomUUID(), coverAssignmentId: randomUUID(), weight },
      });
    }
    const slots: string[] = [];
    for (let i = 0; i < 3; i++) {
      const { x, swapId } = await coverPayback(h, 2, i);
      await fx.as(h.users[B].token).patch(`/api/v1/swaps/${swapId}/accept`).set('Idempotency-Key', randomUUID()).expect(200);
      await fx.prisma.choreAssignment.update({ where: { id: x.id }, data: { status: 'PENDING_VERIFY', submittedAt: new Date() } });
      slots.push(x.id);
    }
    const results = await Promise.all(slots.flatMap((id) => [verify(h, id), verify(h, id), verify(h, id)]));
    expect(results.filter((r) => r.status >= 500).map((r) => `${r.status} ${JSON.stringify(r.body)}`)).toEqual([]);
    expect(results.filter((r) => r.status === 200)).toHaveLength(3);

    // Nợ ròng (Mai → Quân dương, Quân → Mai âm) phải còn đúng 0 và không còn khoản nào mở.
    const debts = await fx.prisma.choreDebt.findMany({ where: { houseId: h.houseId } });
    const net = debts.filter((d) => d.status === 'OPEN').reduce((n, d) => n + (d.debtorMemberId === b ? d.weight : -d.weight), 0);
    expect(net).toBe(0);
    expect(debts.filter((d) => d.status === 'OPEN')).toHaveLength(0);
    expect(debts.every((d) => d.status === 'PAID' && d.closeReason === 'OFFSET')).toBe(true);
  }, 120_000);
});
