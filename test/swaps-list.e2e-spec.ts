import { randomUUID } from 'node:crypto';
import { addDays, dueAtOf, weekStartOf } from '../src/modules/chores/week.js';
import { makeAssignment } from './support/assignment-fixture.js';
import { createFixture } from './support/house-fixture.js';

type Fx = Awaited<ReturnType<typeof createFixture>>;
type House = Awaited<ReturnType<Fx['houseWith']>>;

describe('Danh sách yêu cầu đổi ca và số đếm (e2e)', () => {
  let fx: Fx;

  beforeAll(async () => {
    fx = await createFixture('@e2e-swaps-list.nestfair.test');
  });
  afterAll(async () => {
    await fx.prisma.swapLock.deleteMany({});
    await fx.cleanup();
  });

  const monday = addDays(weekStartOf(new Date()), 7);
  const day = (n: number) => addDays(monday, n);
  const slot = (house: House, assignee: number, date: string, weight = 2) =>
    makeAssignment(fx, house, { assignee, occurrenceDate: date, dueAt: dueAtOf(date, '21:00') }, { weight, title: `Việc ${assignee}-${date}` });

  const exchange = async (house: House, from: number, to: number, fromDay: number, toDay: number, extra: object = {}) => {
    const a = await slot(house, from, day(fromDay));
    const b = await slot(house, to, day(toDay));
    const res = await fx
      .as(house.users[from].token)
      .post(`/api/v1/houses/${house.houseId}/swaps`, { type: 'EXCHANGE', fromAssignmentId: a.id, toAssignmentId: b.id, acknowledgedWarnings: [], ...extra })
      .set('Idempotency-Key', randomUUID())
      .expect(201);
    return { a, b, id: res.body.id as string };
  };
  const list = (house: House, i: number, scope: string) => fx.as(house.users[i].token).get(`/api/v1/houses/${house.houseId}/swaps?scope=${scope}`);

  /** Chợ ca chèn thẳng DB (đường tạo COVER làm ở Task 8). */
  async function market(house: House, requester: number, date: string, over: { expiresAt?: Date; amount?: number } = {}) {
    const from = await slot(house, requester, date);
    const id = randomUUID();
    await fx.prisma.choreSwapRequest.create({
      data: {
        id,
        houseId: house.houseId,
        type: 'COVER',
        requesterMemberId: house.memberId(house.users[requester]),
        fromAssignmentId: from.id,
        compensation: 'GIFT',
        rewardAmount: over.amount ?? 30000,
        rewardNote: 'Bao trà sữa',
        expiresAt: over.expiresAt ?? new Date(Date.now() + 6 * 3_600_000),
        rootRequestId: id,
        fromWeightSnapshot: from.weightSnapshot,
      },
    });
    return { id, from };
  }

  it('INCOMING chỉ có yêu cầu đích danh gửi tới người xem; OUTGOING chỉ có yêu cầu người xem gửi', async () => {
    const house = await fx.houseWith(['Hùng', 'Thiện', 'Mai']);
    const toThien = await exchange(house, 0, 1, 1, 2);
    const toMai = await exchange(house, 0, 2, 3, 4);

    const thien = await list(house, 1, 'INCOMING').expect(200);
    expect(thien.body.map((s: any) => s.id)).toEqual([toThien.id]);
    const mai = await list(house, 2, 'INCOMING').expect(200);
    expect(mai.body.map((s: any) => s.id)).toEqual([toMai.id]);
    expect((await list(house, 0, 'INCOMING').expect(200)).body).toEqual([]);

    const out = await list(house, 0, 'OUTGOING').expect(200);
    expect(out.body.map((s: any) => s.id).sort()).toEqual([toThien.id, toMai.id].sort());
    expect((await list(house, 1, 'OUTGOING').expect(200)).body).toEqual([]);
  });

  it('T-SW-21: reason và note chỉ hiện cho người gửi, người nhận và Admin', async () => {
    const house = await fx.houseWith(['Hùng', 'Thiện', 'Mai']);
    // Thiện (không phải Admin) gửi cho Mai; Hùng là Admin.
    const s = await exchange(house, 1, 2, 1, 2, { reason: 'Khám phụ khoa', note: 'Cảm ơn Mai' });
    const seen = async (viewer: number) => {
      const res = await fx.as(house.users[viewer].token).get(`/api/v1/houses/${house.houseId}/swaps?scope=OUTGOING`);
      return res.body;
    };
    expect((await seen(1))[0]).toMatchObject({ id: s.id, reason: 'Khám phụ khoa', note: 'Cảm ơn Mai' });
    const mai = (await list(house, 2, 'INCOMING').expect(200)).body[0];
    expect(mai).toMatchObject({ reason: 'Khám phụ khoa', note: 'Cảm ơn Mai' });
    expect(mai.requesterName).toBe('Thiện');
    // Người xem không liên quan: một thành viên thứ tư không có quyền Admin.
    const four = await fx.houseWith(['Hùng', 'Thiện', 'Mai', 'Quân']);
    const x = await exchange(four, 1, 2, 1, 2, { reason: 'Riêng tư', note: 'Nhắn riêng' });
    const viaService = fx.app.get((await import('../src/modules/swaps/swaps.service.js')).SwapsService);
    const row = await fx.prisma.choreSwapRequest.findUniqueOrThrow({ where: { id: x.id } });
    const asD = (await viaService.present([row], { id: four.memberId(four.users[3]), role: 'ROOMMATE' }))[0];
    expect(asD).toMatchObject({ reason: null, note: null, rejectReason: null });
    const asAdmin = (await viaService.present([row], { id: four.memberId(four.users[0]), role: 'ADMIN' }))[0];
    expect(asAdmin).toMatchObject({ reason: 'Riêng tư', note: 'Nhắn riêng' });
  });

  it('MARKET: sắp theo hạn gần nhất, kèm eligibility theo người xem', async () => {
    const house = await fx.houseWith(['Hùng', 'Thiện', 'Mai']);
    const later = await market(house, 0, day(4), { expiresAt: new Date(Date.now() + 10 * 3_600_000) });
    const sooner = await market(house, 1, day(5), { expiresAt: new Date(Date.now() + 2 * 3_600_000) });
    await fx.prisma.memberAbsence.create({
      data: {
        houseId: house.houseId,
        userId: house.users[2].id,
        startDate: new Date(`${day(4)}T00:00:00Z`),
        endDate: new Date(`${day(4)}T00:00:00Z`),
        createdById: house.users[0].id,
      },
    });

    const asMai = (await list(house, 2, 'MARKET').expect(200)).body;
    expect(asMai.map((s: any) => s.id)).toEqual([sooner.id, later.id]);
    expect(asMai[0].eligibility).toMatchObject({ canAccept: true });
    expect(asMai[1].eligibility).toMatchObject({ canAccept: false, reasonCode: 'TARGET_ABSENT' });
    expect(asMai[0]).toMatchObject({ market: true, rewardAmount: 30000, reason: null });

    const asHung = (await list(house, 0, 'MARKET').expect(200)).body;
    expect(asHung.find((s: any) => s.id === later.id).eligibility).toMatchObject({ canAccept: false, reasonCode: 'CANNOT_ACCEPT_OWN' });
  });

  it('T-SW-35: summary đếm đúng bằng độ dài các danh sách; nợ ca đếm theo chiều', async () => {
    const house = await fx.houseWith(['Hùng', 'Thiện', 'Mai']);
    await exchange(house, 0, 1, 1, 2);
    await exchange(house, 2, 1, 3, 4);
    await market(house, 0, day(5));
    const covers = await slot(house, 0, day(6));
    for (const [debtor, creditor] of [[1, 0], [0, 2], [0, 1]]) {
      await fx.prisma.choreDebt.create({
        data: {
          houseId: house.houseId,
          debtorMemberId: house.memberId(house.users[debtor]),
          creditorMemberId: house.memberId(house.users[creditor]),
          swapRequestId: randomUUID(),
          coverAssignmentId: covers.id,
          weight: 2,
        },
      });
    }
    const sum = async (i: number) => (await fx.as(house.users[i].token).get(`/api/v1/houses/${house.houseId}/swaps/summary`).expect(200)).body;
    const thien = await sum(1);
    expect(thien.incoming).toBe((await list(house, 1, 'INCOMING')).body.length);
    expect(thien.incoming).toBe(2);
    expect(thien.market).toBe((await list(house, 1, 'MARKET')).body.length);
    expect(thien).toMatchObject({ market: 1, debtsOwedByMe: 1, debtsOwedToMe: 1 });
    expect(await sum(0)).toMatchObject({ incoming: 0, market: 1, debtsOwedByMe: 2, debtsOwedToMe: 1 });
  });

  it('yêu cầu đã quá hạn nhưng cron chưa chạy không xuất hiện trong INCOMING / MARKET', async () => {
    const house = await fx.houseWith(['Hùng', 'Thiện']);
    const s = await exchange(house, 0, 1, 1, 2);
    const m = await market(house, 0, day(4));
    await fx.prisma.choreSwapRequest.updateMany({ where: { id: { in: [s.id, m.id] } }, data: { expiresAt: new Date(Date.now() - 60_000) } });
    expect((await list(house, 1, 'INCOMING')).body).toEqual([]);
    expect((await list(house, 1, 'MARKET')).body).toEqual([]);
    expect((await fx.as(house.users[1].token).get(`/api/v1/houses/${house.houseId}/swaps/summary`)).body).toMatchObject({ incoming: 0, market: 0 });
  });

  it('scope sai nhận 400; người ngoài nhà nhận 403/404', async () => {
    const house = await fx.houseWith(['Hùng', 'Thiện']);
    await list(house, 0, 'ALL').expect(400);
    const outsider = await fx.user('Người lạ');
    const res = await fx.as(outsider.token).get(`/api/v1/houses/${house.houseId}/swaps?scope=INCOMING`);
    expect([403, 404]).toContain(res.status);
  });
});
