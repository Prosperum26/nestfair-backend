import { randomUUID } from 'node:crypto';
import { createFixture } from './support/house-fixture.js';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const URL = '/api/v1/reminders';

/** Nhắc nhở cá nhân (Issue #12, thẻ BE-4): CRUD + riêng tư theo userId lấy từ JWT. */
describe('Reminders (e2e)', () => {
  let fx: Awaited<ReturnType<typeof createFixture>>;

  beforeAll(async () => {
    fx = await createFixture('@e2e-reminders.nestfair.test');
  });
  afterAll(() => fx.cleanup());

  const iso = (msAhead: number) => new Date(Date.now() + msAhead).toISOString();
  /** Ghi thẳng DB một Reminder (dùng cho nhắc đã gửi / của hệ thống). */
  const seedReminder = (data: {
    userId: string;
    houseId: string;
    title: string;
    remindAt: Date;
    source: 'USER' | 'SYSTEM';
    sentAt?: Date;
  }) => fx.prisma.reminder.create({ data });

  /** Tin nhắn Trợ lý của `userId` có actionsJson: [0] CREATE_REMINDER, [1] DRAFT_EXPENSE. */
  const seedAssistantAction = (houseId: string, userId: string) =>
    fx.prisma.assistantMessage.create({
      data: {
        houseId,
        userId,
        threadId: randomUUID(),
        role: 'ASSISTANT',
        content: 'Được nhé, để mình nhắc bạn.',
        category: 'REMINDER',
        actionsJson: [
          { type: 'CREATE_REMINDER', label: 'Nhắc tôi đóng tiền nước', payload: { title: 'Đóng tiền nước', remindAt: iso(12 * HOUR) } },
          { type: 'DRAFT_EXPENSE', label: 'Nháp tiền điện', payload: { estimatedAmount: 50_000 } },
        ],
      },
    });

  it('(1) tạo thủ công → 201, source USER, sentAt null, không có dedupeKey', async () => {
    const { houseId, users } = await fx.houseWith(['Hùng', 'Thiện']);
    const remindAt = iso(3 * HOUR);
    const res = await fx.as(users[0].token)
      .post(URL, { houseId, title: 'Đóng tiền điện', remindAt })
      .expect(201);
    expect(res.body).toMatchObject({
      houseId,
      title: 'Đóng tiền điện',
      remindAt: new Date(remindAt).toISOString(),
      source: 'USER',
      sentAt: null,
    });
    expect(res.body.id).toEqual(expect.any(String));
    const row = await fx.prisma.reminder.findUnique({ where: { id: res.body.id } });
    expect(row?.dedupeKey).toBeNull();
  });

  it('(2) remindAt quá khứ hoặc quá 1 năm → 400 REMIND_AT_INVALID; biên 364 ngày thì được', async () => {
    const { houseId, users } = await fx.houseWith(['Hùng']);
    const post = (remindAt: string) =>
      fx.as(users[0].token).post(URL, { houseId, title: 'Việc gì đó', remindAt });

    const past = await post(iso(-HOUR)).expect(400);
    expect(past.body.code).toBe('REMIND_AT_INVALID');
    const tooFar = await post(iso(366 * DAY)).expect(400);
    expect(tooFar.body.code).toBe('REMIND_AT_INVALID');
    await post(iso(364 * DAY)).expect(201);
  });

  it('(3) houseId không phải nhà của mình → 403, không tạo dòng nào', async () => {
    const a = await fx.houseWith(['Hùng']);
    const b = await fx.houseWith(['Lan', 'Huệ']);
    await fx.as(a.users[0].token)
      .post(URL, { houseId: b.houseId, title: 'Lén tạo', remindAt: iso(HOUR) })
      .expect(403);
    expect(await fx.prisma.reminder.count({ where: { houseId: b.houseId } })).toBe(0);
  });

  it('(4) riêng tư theo người: B cùng nhà không thấy nhắc của A qua GET', async () => {
    const { houseId, users } = await fx.houseWith(['Hùng', 'Thiện']);
    await fx.as(users[0].token)
      .post(URL, { houseId, title: 'Việc riêng của Hùng', remindAt: iso(HOUR) })
      .expect(201);

    const ofB = await fx.as(users[1].token).get(URL).expect(200);
    expect(ofB.body).toEqual([]);
    const ofA = await fx.as(users[0].token).get(URL).expect(200);
    expect(ofA.body).toHaveLength(1);
    expect(ofA.body[0]).toMatchObject({ title: 'Việc riêng của Hùng', houseId });
  });

  it('(5) state=upcoming: chỉ chưa gửi, remindAt tăng dần; state=all có đủ (cũng tăng dần)', async () => {
    const { houseId, users } = await fx.houseWith(['Hùng']);
    const post = (title: string, msAhead: number) =>
      fx.as(users[0].token).post(URL, { houseId, title, remindAt: iso(msAhead) });
    await post('Ba giờ nữa', 3 * HOUR).expect(201);
    await post('Một giờ nữa', 1 * HOUR).expect(201);
    await post('Hai giờ nữa', 2 * HOUR).expect(201);
    await seedReminder({
      userId: users[0].id,
      houseId,
      title: 'Đã gửi',
      remindAt: new Date(Date.now() - HOUR),
      source: 'USER',
      sentAt: new Date(Date.now() - HOUR / 2),
    });

    const upcoming = await fx.as(users[0].token).get(URL + '?state=upcoming').expect(200);
    expect(upcoming.body.map((r: { title: string }) => r.title)).toEqual(['Một giờ nữa', 'Hai giờ nữa', 'Ba giờ nữa']);
    expect(upcoming.body.every((r: { sentAt: string | null }) => r.sentAt === null)).toBe(true);

    const all = await fx.as(users[0].token).get(URL + '?state=all').expect(200);
    expect(all.body).toHaveLength(4);
    const times = all.body.map((r: { remindAt: string }) => Date.parse(r.remindAt));
    expect(times).toEqual([...times].sort((x, y) => x - y));
  });

  it('(6) tạo từ nút Trợ lý (đúng người, đúng actionIndex) → source ASSISTANT + dedupeKey msg:<id>:<index>; bấm lần hai → 409 REMINDER_ALREADY_CREATED', async () => {
    const { houseId, users } = await fx.houseWith(['Hùng', 'Thiện']);
    const msg = await seedAssistantAction(houseId, users[0].id);

    const res = await fx.as(users[0].token)
      .post(URL, {
        houseId,
        title: 'Đóng tiền nước',
        remindAt: iso(12 * HOUR),
        sourceMessageId: msg.id,
        actionIndex: 0,
      })
      .expect(201);
    expect(res.body).toMatchObject({ title: 'Đóng tiền nước', source: 'ASSISTANT', sentAt: null });
    const row = await fx.prisma.reminder.findUnique({ where: { id: res.body.id } });
    expect(row?.dedupeKey).toBe('msg:' + msg.id + ':0');

    const again = await fx.as(users[0].token)
      .post(URL, {
        houseId,
        title: 'Đóng tiền nước',
        remindAt: iso(12 * HOUR),
        sourceMessageId: msg.id,
        actionIndex: 0,
      })
      .expect(409);
    expect(again.body.code).toBe('REMINDER_ALREADY_CREATED');
    expect(await fx.prisma.reminder.count({ where: { userId: users[0].id } })).toBe(1);
  });

  it('(7) sourceMessageId của người khác hoặc không tồn tại → 404', async () => {
    const { houseId, users } = await fx.houseWith(['Hùng', 'Thiện']);
    const msgOfB = await seedAssistantAction(houseId, users[1].id);
    await fx.as(users[0].token)
      .post(URL, { houseId, title: 'X', remindAt: iso(HOUR), sourceMessageId: msgOfB.id, actionIndex: 0 })
      .expect(404);
    await fx.as(users[0].token)
      .post(URL, { houseId, title: 'X', remindAt: iso(HOUR), sourceMessageId: randomUUID(), actionIndex: 0 })
      .expect(404);
  });

  it('(8) thiếu cặp sourceMessageId/actionIndex, hoặc hành động không phải CREATE_REMINDER → 400', async () => {
    const { houseId, users } = await fx.houseWith(['Hùng']);
    const msg = await seedAssistantAction(houseId, users[0].id);
    const post = (extra: object) =>
      fx.as(users[0].token).post(URL, { houseId, title: 'X', remindAt: iso(HOUR), ...extra });

    await post({ sourceMessageId: msg.id }).expect(400);
    await post({ actionIndex: 0 }).expect(400);
    await post({ sourceMessageId: msg.id, actionIndex: 1 }).expect(400); // DRAFT_EXPENSE
    await post({ sourceMessageId: msg.id, actionIndex: 99 }).expect(400); // ngoài mảng
    expect(await fx.prisma.reminder.count({ where: { houseId } })).toBe(0);
  });

  it('(9) PATCH: đổi giờ + tiêu đề hợp lệ → 200 ReminderDto mới; của người khác → 404; đã gửi → 409 REMINDER_ALREADY_SENT; giờ sai → 400', async () => {
    const { houseId, users } = await fx.houseWith(['Hùng', 'Thiện']);
    const created = await fx.as(users[0].token)
      .post(URL, { houseId, title: 'Đổ rác', remindAt: iso(2 * HOUR) })
      .expect(201);

    const newTime = iso(5 * HOUR);
    const res = await fx.as(users[0].token)
      .patch(URL + '/' + created.body.id, { title: 'Đổ rác (dời tối mai)', remindAt: newTime })
      .expect(200);
    expect(res.body).toMatchObject({
      id: created.body.id,
      title: 'Đổ rác (dời tối mai)',
      remindAt: new Date(newTime).toISOString(),
      sentAt: null,
    });

    await fx.as(users[1].token).patch(URL + '/' + created.body.id, { title: 'Lén sửa' }).expect(404);

    const sent = await seedReminder({
      userId: users[0].id,
      houseId,
      title: 'Đã gửi',
      remindAt: new Date(Date.now() - HOUR),
      source: 'USER',
      sentAt: new Date(Date.now() - HOUR / 2),
    });
    const conflict = await fx.as(users[0].token).patch(URL + '/' + sent.id, { title: 'Sửa sau khi gửi' }).expect(409);
    expect(conflict.body.code).toBe('REMINDER_ALREADY_SENT');

    const badTime = await fx.as(users[0].token).patch(URL + '/' + created.body.id, { remindAt: iso(-HOUR) }).expect(400);
    expect(badTime.body.code).toBe('REMIND_AT_INVALID');
  });

  it('(10) DELETE: nhắc USER → ok; SYSTEM → 403 REMINDER_NOT_DELETABLE; của người khác → 404; đã gửi vẫn xóa được', async () => {
    const { houseId, users } = await fx.houseWith(['Hùng', 'Thiện']);
    const mine = await fx.as(users[0].token)
      .post(URL, { houseId, title: 'Đóng nước', remindAt: iso(HOUR) })
      .expect(201);

    await fx.as(users[1].token).delete(URL + '/' + mine.body.id).expect(404);
    const del = await fx.as(users[0].token).delete(URL + '/' + mine.body.id).expect(200);
    expect(del.body).toEqual({ ok: true });
    expect(await fx.prisma.reminder.count({ where: { id: mine.body.id } })).toBe(0);

    const system = await seedReminder({
      userId: users[0].id,
      houseId,
      title: 'Hệ thống nhắc',
      remindAt: new Date(Date.now() + 2 * HOUR),
      source: 'SYSTEM',
    });
    const forbidden = await fx.as(users[0].token).delete(URL + '/' + system.id).expect(403);
    expect(forbidden.body.code).toBe('REMINDER_NOT_DELETABLE');
    expect(await fx.prisma.reminder.count({ where: { id: system.id } })).toBe(1);

    const sent = await seedReminder({
      userId: users[0].id,
      houseId,
      title: 'Đã gửi',
      remindAt: new Date(Date.now() - HOUR),
      source: 'USER',
      sentAt: new Date(Date.now() - HOUR / 2),
    });
    await fx.as(users[0].token).delete(URL + '/' + sent.id).expect(200);
  });

  it('(11) không có JWT → 401 với cả 4 route', async () => {
    await fx.http().get(URL).expect(401);
    await fx.http().post(URL).send({}).expect(401);
    await fx.http().patch(URL + '/' + randomUUID()).send({}).expect(401);
    await fx.http().delete(URL + '/' + randomUUID()).expect(401);
  });

  it('(12) DTO: title rỗng/dài quá, remindAt không phải ISO, field lạ, state/limit sai → 400', async () => {
    const { houseId, users } = await fx.houseWith(['Hùng']);
    const post = (body: object) => fx.as(users[0].token).post(URL, body);
    await post({ houseId, title: '   ', remindAt: iso(HOUR) }).expect(400);
    await post({ houseId, title: 'x'.repeat(121), remindAt: iso(HOUR) }).expect(400);
    await post({ houseId, title: 'Ok', remindAt: 'ngày mai' }).expect(400);
    await post({ houseId, title: 'Ok', remindAt: iso(HOUR), hack: 1 }).expect(400);
    await fx.as(users[0].token).get(URL + '?state=whatever').expect(400);
    await fx.as(users[0].token).get(URL + '?limit=0').expect(400);
    await fx.as(users[0].token).get(URL + '?limit=101').expect(400);
    expect(await fx.prisma.reminder.count({ where: { houseId } })).toBe(0);
  });
});
