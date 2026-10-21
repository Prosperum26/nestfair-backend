import { randomUUID } from 'node:crypto';
import { addDays, currentWeekStart } from '../src/modules/chores/week.js';
import { HOUR, makeAssignment } from './support/assignment-fixture.js';
import { createFixture } from './support/house-fixture.js';

type Fx = Awaited<ReturnType<typeof createFixture>>;

/**
 * B3: accept COVER + PAYBACK cấn trừ nợ cũ trong khi người được làm bù chọn ca bù cho chính nợ đó.
 * Hai thao tác này phải tuần tự hóa: không deadlock (40P01), không có nợ vừa PAID (cấn trừ) vừa có ca bù đã giao.
 */
describe('Khóa khi cấn trừ nợ (e2e)', () => {
  let fx: Fx;

  beforeAll(async () => {
    fx = await createFixture('@e2e-swap-offset-locks.nestfair.test');
  });
  afterAll(() => fx.cleanup());

  const hoursFromNow = (n: number) => new Date(Date.now() + n * HOUR);

  /** Quân (A) nhờ Mai (B) làm hộ ca X bằng PAYBACK, trong khi Mai đang nợ Quân nợ D và Quân có thể chọn ca bù Y cho D. */
  async function round() {
    const h = await fx.houseWith(['Quân', 'Mai', 'Hùng']);
    const A = 0;
    const B = 1;
    const a = h.memberId(h.users[A]);
    const b = h.memberId(h.users[B]);
    const x = await makeAssignment(fx, h, { assignee: A, dueAt: hoursFromNow(120) }, { weight: 2 });
    const nextWeek = addDays(currentWeekStart(), 7);
    const pickDeadlineAt = hoursFromNow(40);
    const y = await makeAssignment(fx, h, { assignee: A, occurrenceDate: addDays(nextWeek, 2), dueAt: hoursFromNow(120) }, { weight: 2, title: 'Ca bù' });
    const debt = await fx.prisma.choreDebt.create({
      data: {
        houseId: h.houseId,
        debtorMemberId: b,
        creditorMemberId: a,
        swapRequestId: randomUUID(),
        coverAssignmentId: randomUUID(),
        weight: 2,
        pickOpensAt: hoursFromNow(-1),
        pickDeadlineAt,
      },
    });
    const swap = await fx
      .as(h.users[A].token)
      .post(`/api/v1/houses/${h.houseId}/swaps`, { type: 'COVER', fromAssignmentId: x.id, compensation: 'PAYBACK', targetMemberId: b, acknowledgedWarnings: [] })
      .set('Idempotency-Key', randomUUID())
      .expect(201);
    return { h, a, b, x, y, debt, swapId: swap.body.id as string };
  }

  it('20 request song song (10 accept cấn trừ + 10 chọn ca bù cho đúng nợ đó): không 500 / 40P01, không nợ vừa PAID vừa có ca bù', async () => {
    for (let i = 0; i < 12; i++) {
      const r = await round();
      const accepts = Array.from({ length: 10 }, () => fx.as(r.h.users[1].token).patch(`/api/v1/swaps/${r.swapId}/accept`).set('Idempotency-Key', randomUUID()));
      const picks = Array.from({ length: 10 }, () =>
        fx.as(r.h.users[0].token).patch(`/api/v1/chore-debts/${r.debt.id}/payback`, { assignmentId: r.y.id }).set('Idempotency-Key', randomUUID()),
      );
      const results = await Promise.all([...accepts, ...picks]);

      const bad = results.filter((x) => x.status >= 500);
      expect(bad.map((x) => `${x.status} ${JSON.stringify(x.body)}`), `vòng ${i}`).toEqual([]);

      const d = await fx.prisma.choreDebt.findUniqueOrThrow({ where: { id: r.debt.id } });
      const swap = await fx.prisma.choreSwapRequest.findUniqueOrThrow({ where: { id: r.swapId } });
      expect(swap.status, `vòng ${i}`).toBe('ACCEPTED');
      const y = await fx.prisma.choreAssignment.findUniqueOrThrow({ where: { id: r.y.id } });
      if (d.status === 'PAID' || d.status === 'FORGIVEN') {
        // Nợ đã bị cấn trừ: ca bù không được giao cho người nợ.
        expect(d.paybackAssignmentId, `vòng ${i}: nợ ${d.status} mà còn trỏ ca bù`).toBeNull();
        expect(y.assigneeId, `vòng ${i}: ca bù bị giao dù nợ đã cấn trừ`).toBe(r.a);
      } else {
        // Ca bù được chọn trước: nợ giữ nguyên trỏ ca đó, ca thuộc người nợ, cấn trừ bỏ qua nợ này.
        expect(d.paybackAssignmentId, `vòng ${i}`).toBe(r.y.id);
        expect(y).toMatchObject({ assigneeId: r.b, source: 'PAYBACK' });
        expect(d.weight).toBe(2);
      }
    }
  }, 300_000);

  it('hai chiều khóa: nhiều accept cấn trừ trên cùng một cặp người, mỗi cái một ca, không 500 / deadlock', async () => {
    const h = await fx.houseWith(['Quân', 'Mai']);
    const a = h.memberId(h.users[0]);
    const b = h.memberId(h.users[1]);
    // Mai nợ Quân ba khoản; Quân gửi ba yêu cầu (giới hạn 3 PENDING) và Mai chấp nhận cả ba cùng lúc.
    for (const weight of [3, 2, 1]) {
      await fx.prisma.choreDebt.create({
        data: { houseId: h.houseId, debtorMemberId: b, creditorMemberId: a, swapRequestId: randomUUID(), coverAssignmentId: randomUUID(), weight },
      });
    }
    const swapIds: string[] = [];
    for (let i = 0; i < 3; i++) {
      const x = await makeAssignment(fx, h, { assignee: 0, occurrenceDate: addDays(currentWeekStart(), 8 + i), dueAt: hoursFromNow(100 + i) }, { weight: 2, title: `Ca ${i}` });
      const res = await fx
        .as(h.users[0].token)
        .post(`/api/v1/houses/${h.houseId}/swaps`, { type: 'COVER', fromAssignmentId: x.id, compensation: 'PAYBACK', targetMemberId: b, acknowledgedWarnings: [] })
        .set('Idempotency-Key', randomUUID())
        .expect(201);
      swapIds.push(res.body.id);
    }
    const results = await Promise.all(
      Array.from({ length: 21 }, (_, i) => fx.as(h.users[1].token).patch(`/api/v1/swaps/${swapIds[i % 3]}/accept`).set('Idempotency-Key', randomUUID())),
    );
    expect(results.filter((r) => r.status >= 500).map((r) => `${r.status} ${JSON.stringify(r.body)}`)).toEqual([]);
    expect(results.filter((r) => r.status === 200)).toHaveLength(3);

    // Tổng nợ còn lại + nợ mới phải khớp bảng cấn trừ: 6 điểm nợ cũ, 3 yêu cầu x 2 điểm = 6 điểm cấn trừ => hết nợ.
    const debts = await fx.prisma.choreDebt.findMany({ where: { houseId: h.houseId } });
    const open = debts.filter((d) => d.status === 'OPEN');
    expect(open.reduce((n, d) => n + (d.debtorMemberId === b ? d.weight : -d.weight), 0)).toBe(0);
    expect(debts.filter((d) => d.status === 'PAID').every((d) => d.closeReason === 'OFFSET')).toBe(true);
  }, 120_000);
});
