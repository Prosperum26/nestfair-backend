import { addDays, dueAtOf, weekStartOf } from '../src/modules/chores/week.js';
import { dateOf, HOUR, makeAssignment } from './support/assignment-fixture.js';
import { createFixture } from './support/house-fixture.js';

type Fx = Awaited<ReturnType<typeof createFixture>>;
type House = Awaited<ReturnType<Fx['houseWith']>>;

describe('GET /assignments/:id/swap-options (e2e)', () => {
  let fx: Fx;

  beforeAll(async () => {
    fx = await createFixture('@e2e-swap-options.nestfair.test');
  });
  afterAll(() => fx.cleanup());

  // Cả tuần kế tiếp nằm hẳn trong tương lai, nên ca không bao giờ quá hạn hay dưới 6 giờ khi test chạy.
  const monday = addDays(weekStartOf(new Date()), 7);
  const day = (n: number) => addDays(monday, n);
  const slot = (house: House, assignee: number, date: string, weight: number, extra: Parameters<typeof makeAssignment>[2] = {}) =>
    makeAssignment(fx, house, { assignee, occurrenceDate: date, dueAt: dueAtOf(date, '21:00'), ...extra }, { weight, title: `Việc ${assignee}-${date}` });

  const options = (token: string, assignmentId: string, type: string, extra = '') =>
    fx.as(token).get(`/api/v1/assignments/${assignmentId}/swap-options?type=${type}${extra}`);

  it('EXCHANGE: ca cùng tuần khác việc hợp lệ, chênh độ nặng 2 thì có cảnh báo WEIGHT_GAP', async () => {
    const house = await fx.houseWith(['Hùng', 'Thiện', 'Mai']);
    const mine = await slot(house, 0, day(1), 4);
    const heavy = await slot(house, 1, day(3), 2); // chênh 2
    const close = await slot(house, 2, day(4), 3); // chênh 1

    const res = await options(house.users[0].token, mine.id, 'EXCHANGE').expect(200);
    const byId = new Map<string, any>(res.body.options.map((o: any) => [o.assignmentId, o]));
    expect(byId.get(heavy.id)).toMatchObject({ valid: true, warnings: ['WEIGHT_GAP'] });
    expect(byId.get(close.id)).toMatchObject({ valid: true, warnings: [] });
    expect(res.body.market).toMatchObject({ allowed: true });
  });

  it('EXCHANGE: ca khác tuần bị WEEK_MISMATCH, thông điệp tiếng Việt không có mã quy tắc', async () => {
    const house = await fx.houseWith(['Hùng', 'Thiện']);
    const mine = await slot(house, 0, day(1), 2);
    const other = await slot(house, 1, day(8), 2);

    const res = await options(house.users[0].token, mine.id, 'EXCHANGE').expect(200);
    const opt = res.body.options.find((o: any) => o.assignmentId === other.id);
    expect(opt).toMatchObject({ valid: false, reasonCode: 'WEEK_MISMATCH' });
    expect(opt.reasonText).toBe('Hai ca khác tuần. Hãy nhờ trực dùm hoặc đổi lịch tuần sau.');
    expect(opt.reasonText).not.toMatch(/R-SWAP/);
  });

  it('EXCHANGE: ranh giới tuần ISO 2026-W53 và 2027-W01 là hai tuần khác nhau', async () => {
    const house = await fx.houseWith(['Hùng', 'Thiện']);
    const mine = await slot(house, 0, '2026-12-31', 2);
    const other = await slot(house, 1, '2027-01-04', 2);

    const res = await options(house.users[0].token, mine.id, 'EXCHANGE').expect(200);
    expect(res.body.options.find((o: any) => o.assignmentId === other.id)).toMatchObject({
      valid: false,
      reasonCode: 'WEEK_MISMATCH',
    });
  });

  it('EXCHANGE: ca đích đang PENDING_VERIFY thì SLOT_NOT_SWAPPABLE', async () => {
    const house = await fx.houseWith(['Hùng', 'Thiện']);
    const mine = await slot(house, 0, day(1), 2);
    const waiting = await slot(house, 1, day(2), 2, { status: 'PENDING_VERIFY' });

    const res = await options(house.users[0].token, mine.id, 'EXCHANGE').expect(200);
    const opt = res.body.options.find((o: any) => o.assignmentId === waiting.id);
    expect(opt).toMatchObject({ valid: false, reasonCode: 'SLOT_NOT_SWAPPABLE' });
    expect(opt.reasonText).toBe('Ca đã có ảnh chờ duyệt nên không đổi được nữa.');
  });

  it('EXCHANGE: người nhận vắng đúng ngày của ca họ sẽ nhận thì TARGET_ABSENT', async () => {
    const house = await fx.houseWith(['Hùng', 'Thiện']);
    const mine = await slot(house, 0, day(1), 2);
    const other = await slot(house, 1, day(3), 2);
    await fx.prisma.memberAbsence.create({
      data: {
        houseId: house.houseId,
        userId: house.users[1].id,
        startDate: dateOf(day(1)),
        endDate: dateOf(day(1)),
        createdById: house.users[0].id,
      },
    });

    const res = await options(house.users[0].token, mine.id, 'EXCHANGE').expect(200);
    const opt = res.body.options.find((o: any) => o.assignmentId === other.id);
    expect(opt).toMatchObject({ valid: false, reasonCode: 'TARGET_ABSENT' });
    expect(opt.reasonText).toMatch(/^Thiện vắng ngày \d{2}\.\d{2}\.$/);
  });

  it('EXCHANGE: ca đích đang bị khóa bởi yêu cầu khác thì SLOT_LOCKED', async () => {
    const house = await fx.houseWith(['Hùng', 'Thiện']);
    const mine = await slot(house, 0, day(1), 2);
    const other = await slot(house, 1, day(3), 2);
    await fx.prisma.swapLock.create({ data: { assignmentId: other.id, swapRequestId: '00000000-0000-4000-8000-000000000001' } });

    const res = await options(house.users[0].token, mine.id, 'EXCHANGE').expect(200);
    expect(res.body.options.find((o: any) => o.assignmentId === other.id)).toMatchObject({
      valid: false,
      reasonCode: 'SLOT_LOCKED',
    });
    await fx.prisma.swapLock.delete({ where: { assignmentId: other.id } });
  });

  it('EXCHANGE: ca có source = PAYBACK bị PAYBACK_SLOT_LOCKED', async () => {
    const house = await fx.houseWith(['Hùng', 'Thiện']);
    const mine = await slot(house, 0, day(1), 2);
    await fx.prisma.choreAssignment.update({ where: { id: mine.id }, data: { source: 'PAYBACK' } });
    const other = await slot(house, 1, day(3), 2);

    const res = await options(house.users[0].token, mine.id, 'EXCHANGE').expect(200);
    expect(res.body.options.find((o: any) => o.assignmentId === other.id)).toMatchObject({
      valid: false,
      reasonCode: 'PAYBACK_SLOT_LOCKED',
    });
    const cover = await options(house.users[0].token, mine.id, 'COVER').expect(200);
    expect(cover.body.market.allowed).toBe(false);
  });

  it('COVER: liệt kê thành viên, người vắng đúng ngày ca là TARGET_ABSENT', async () => {
    const house = await fx.houseWith(['Hùng', 'Thiện', 'Mai']);
    const mine = await slot(house, 0, day(2), 2);
    await fx.prisma.memberAbsence.create({
      data: {
        houseId: house.houseId,
        userId: house.users[2].id,
        startDate: dateOf(day(1)),
        endDate: dateOf(day(3)),
        createdById: house.users[0].id,
      },
    });

    const res = await options(house.users[0].token, mine.id, 'COVER').expect(200);
    const byMember = new Map<string, any>(res.body.options.map((o: any) => [o.memberId, o]));
    expect(res.body.options).toHaveLength(2);
    expect(byMember.get(house.memberId(house.users[1]))).toMatchObject({ valid: true });
    expect(byMember.get(house.memberId(house.users[2]))).toMatchObject({ valid: false, reasonCode: 'TARGET_ABSENT' });
    expect(byMember.has(house.memberId(house.users[0]))).toBe(false);
  });

  it('COVER: ca còn dưới 6 giờ thì đích danh bị URGENT_MARKET_ONLY, Chợ ca vẫn được', async () => {
    const house = await fx.houseWith(['Hùng', 'Thiện']);
    const mine = await makeAssignment(fx, house, { assignee: 0, dueAt: new Date(Date.now() + 3 * HOUR) }, { weight: 2 });

    const res = await options(house.users[0].token, mine.id, 'COVER').expect(200);
    expect(res.body.options[0]).toMatchObject({ valid: false, reasonCode: 'URGENT_MARKET_ONLY' });
    expect(res.body.market).toMatchObject({ allowed: true });
  });

  it('người không phải assignee nhận 403', async () => {
    const house = await fx.houseWith(['Hùng', 'Thiện']);
    const mine = await slot(house, 0, day(1), 2);
    await options(house.users[1].token, mine.id, 'EXCHANGE').expect(403);
  });

  it('người ngoài nhà nhận 404, type sai nhận 400', async () => {
    const house = await fx.houseWith(['Hùng', 'Thiện']);
    const mine = await slot(house, 0, day(1), 2);
    const outsider = await fx.user('Người lạ');
    await options(outsider.token, mine.id, 'EXCHANGE').expect(404);
    await options(house.users[0].token, mine.id, 'PERMANENT').expect(400);
  });
});
