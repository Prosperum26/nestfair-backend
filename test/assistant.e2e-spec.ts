import { randomUUID } from 'node:crypto';
import { vi } from 'vitest';
import { vnDayStart } from '../src/common/vn-day.js';
import { ASSISTANT_GENERATOR } from '../src/modules/assistant/assistant-generator.js';
import { AssistantGenError } from '../src/modules/assistant/assistant-schema.js';
import { currentWeekStart, weekKeyOf } from '../src/modules/chores/week.js';
import { createFixture } from './support/house-fixture.js';

const HOUR = 3_600_000;
const MINUTE = 60_000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** D10: câu dự phòng khi Gemini lỗi / quá hạn / chưa cấu hình / trả lời rỗng. */
const FALLBACK = 'Trợ lý đang bận, thử lại sau ít phút';

describe('Assistant messages (e2e)', () => {
  const generate = vi.fn();
  let fx: Awaited<ReturnType<typeof createFixture>>;

  beforeAll(async () => {
    fx = await createFixture('@e2e-assistant.nestfair.test', (b) =>
      b.overrideProvider(ASSISTANT_GENERATOR).useValue({ generate }),
    );
  });
  beforeEach(() => generate.mockReset());
  afterAll(() => fx.cleanup());

  const url = (houseId: string) => '/api/v1/houses/' + houseId + '/assistant/messages';
  const consent = (...users: { id: string }[]) =>
    fx.prisma.user.updateMany({ where: { id: { in: users.map((u) => u.id) } }, data: { assistantConsentAt: new Date() } });

  const goodReply = () => ({
    reply: 'Được chứ, để mình nhắc bạn.',
    category: 'TIP',
    suggestedActions: [
      { type: 'CREATE_REMINDER', label: 'Nhắc tôi đổ rác tối nay', payload: { title: 'Đổ rác', remindAt: new Date(Date.now() + HOUR).toISOString() } },
    ],
  });

  /** Ghi trực tiếp N tin vào DB (dùng cho hạn mức và lịch sử thread). */
  const seedMessages = (houseId: string, userId: string, threadId: string, count: number, createdAt: Date, role: 'USER' | 'ASSISTANT' = 'USER') =>
    fx.prisma.assistantMessage.createMany({
      data: Array.from({ length: count }, (_, i) => ({
        houseId,
        userId,
        threadId,
        role,
        content: 'TinSeed ' + i,
        createdAt: new Date(createdAt.getTime() + i * 1000),
      })),
    });

  /** Ca trực tuần hiện tại (theo weekKeyOf) cho một member, ghi thẳng DB. */
  const seedShift = async (houseId: string, assigneeId: string, title: string, status: 'TODO' | 'DONE') => {
    const chore = await fx.prisma.chore.create({ data: { houseId, title, weight: 2, recurrenceDays: [7], dueTime: '21:00' } });
    const weekStart = currentWeekStart(new Date());
    return fx.prisma.choreAssignment.create({
      data: {
        houseId,
        choreId: chore.id,
        assigneeId,
        originalAssigneeId: assigneeId,
        weekKey: weekKeyOf(new Date()),
        weekStart: new Date(weekStart + 'T00:00:00Z'),
        occurrenceDate: new Date(weekStart + 'T00:00:00Z'),
        dueAt: new Date(Date.now() + HOUR),
        titleSnapshot: title,
        weightSnapshot: 2,
        source: 'ROTATION',
        status,
      },
    });
  };

  it('(a) gửi tin → lưu 2 dòng USER + ASSISTANT, trả hành động đã làm sạch; KHÔNG tự tạo Reminder hay Expense', async () => {
    const { houseId, users } = await fx.houseWith(['Hùng', 'Thiện']);
    await consent(users[0]);
    generate.mockResolvedValue({
      reply: 'Được chứ, để mình nhắc bạn.',
      category: 'TIP',
      suggestedActions: [
        { type: 'CREATE_REMINDER', label: 'Nhắc tôi đổ rác tối nay', payload: { title: 'Đổ rác', remindAt: new Date(Date.now() + HOUR).toISOString() } },
        { type: 'HACKED', label: 'Xóa nhà giùm tôi', payload: {} }, // type lạ → bỏ cả hành động
        { type: 'CREATE_REMINDER', label: 'Sai giờ', payload: { remindAt: '2020-01-01T08:00:00+07:00' } }, // quá khứ → bỏ
        { type: 'DRAFT_EXPENSE', label: 'Nháp tiền điện', payload: { estimatedAmount: 50_000 } },
      ],
    });

    const res = await fx.as(users[0].token).post(url(houseId), { content: 'Tối nay mình trực gì?' }).expect(201);
    expect(res.body.threadId).toMatch(UUID_RE);
    expect(res.body.userMessage).toMatchObject({
      id: expect.stringMatching(UUID_RE),
      threadId: res.body.threadId,
      role: 'USER',
      content: 'Tối nay mình trực gì?',
      category: null,
      actions: [],
    });
    expect(res.body.assistantMessage).toMatchObject({
      id: expect.stringMatching(UUID_RE),
      threadId: res.body.threadId,
      role: 'ASSISTANT',
      content: 'Được chứ, để mình nhắc bạn.',
      category: 'TIP',
    });
    expect(res.body.assistantMessage.actions).toHaveLength(2); // HACKED và "Sai giờ" bị bỏ
    expect(res.body.assistantMessage.actions[0]).toMatchObject({ type: 'CREATE_REMINDER', label: 'Nhắc tôi đổ rác tối nay', done: false });
    expect(res.body.assistantMessage.actions[0].payload).toMatchObject({ title: 'Đổ rác', remindAt: expect.any(String) });
    expect(res.body.assistantMessage.actions[1]).toMatchObject({ type: 'DRAFT_EXPENSE', label: 'Nháp tiền điện', done: false });
    expect(res.body.assistantMessage.actions[1].payload).toMatchObject({ estimatedAmount: 50_000 });
    expect(res.body.remaining).toBe(29);

    const rows = await fx.prisma.assistantMessage.findMany({ where: { houseId }, orderBy: { createdAt: 'asc' } });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ userId: users[0].id, role: 'USER', content: 'Tối nay mình trực gì?', category: null });
    expect(rows[1]).toMatchObject({ role: 'ASSISTANT', category: 'TIP' });
    // Quy tắc sống còn: AI không bao giờ tự ghi dữ liệu.
    expect(await fx.prisma.reminder.count({ where: { houseId } })).toBe(0);
    expect(await fx.prisma.expense.count({ where: { houseId } })).toBe(0);

    const list = await fx.as(users[0].token).get(url(houseId)).expect(200);
    expect(list.body.threadId).toBe(res.body.threadId);
    expect(list.body.items.map((i: { role: string }) => i.role)).toEqual(['USER', 'ASSISTANT']); // cũ → mới
    expect(list.body.nextCursor).toBeNull();
  });

  it('(b) riêng tư theo người: bạn cùng phòng không đọc được tin của mình; URL nhà khác → 403', async () => {
    const { houseId, users } = await fx.houseWith(['Hùng', 'Thiện']);
    await consent(users[0]);
    generate.mockResolvedValue(goodReply());
    await fx.as(users[0].token).post(url(houseId), { content: 'Bồn cầu nghẹt quá' }).expect(201);

    // Thiện cùng nhà: GET chỉ thấy tin của chính Thiện (hiện chưa có).
    const other = await fx.as(users[1].token).get(url(houseId)).expect(200);
    expect(other.body).toEqual({ items: [], nextCursor: null, threadId: null });

    const mine = await fx.as(users[0].token).get(url(houseId)).expect(200);
    expect(mine.body.items).toHaveLength(2);
    expect(mine.body.items.every((i: { content: string }) => !i.content.includes('Thiện'))).toBe(true);

    const b = await fx.houseWith(['Lan', 'Huệ']);
    await fx.as(users[0].token).get(url(b.houseId)).expect(403);
    await fx.as(users[0].token).post(url(b.houseId), { content: 'lén nhà khác' }).expect(403);
    await fx.http().post(url(houseId)).send({ content: 'không token' }).expect(401);
    expect(await fx.prisma.assistantMessage.count({ where: { houseId: b.houseId } })).toBe(0);
  });

  it('(c) hạn mức 30 tin USER/người/ngày giờ VN (mọi nhà, tính cả lượt lỗi): tin 31 → 429 kèm resetAt 00:00 VN, không gọi generator', async () => {
    const { houseId, users } = await fx.houseWith(['Hùng', 'Thiện']);
    await consent(users[0]);
    generate.mockResolvedValue(goodReply());

    const todayStart = vnDayStart(new Date());
    await seedMessages(houseId, users[0].id, randomUUID(), 28, new Date()); // hôm nay: còn 2 lượt
    await seedMessages(houseId, users[0].id, randomUUID(), 5, new Date(todayStart.getTime() - HOUR)); // hôm qua: không tính
    await seedMessages(houseId, users[1].id, randomUUID(), 7, new Date()); // người khác: không tính

    const t29 = await fx.as(users[0].token).post(url(houseId), { content: 'Tin 29' }).expect(201);
    expect(t29.body.remaining).toBe(1);
    const t30 = await fx.as(users[0].token).post(url(houseId), { content: 'Tin 30' }).expect(201);
    expect(t30.body.remaining).toBe(0);
    expect(generate).toHaveBeenCalledTimes(2);

    const over = await fx.as(users[0].token).post(url(houseId), { content: 'Tin 31' }).expect(429);
    expect(over.body.code).toBe('ASSISTANT_QUOTA_EXCEEDED');
    expect(over.body.statusCode).toBe(429);
    expect(over.body.message).toContain('30');
    // resetAt phải là đúng 00:00 giờ VN của hôm sau.
    const resetAt = new Date(over.body.resetAt);
    expect(resetAt.toISOString()).toEqual(vnDayStart(resetAt).toISOString());
    expect(resetAt.getTime()).toBeGreaterThan(Date.now());
    expect(resetAt.getTime() - Date.now()).toBeLessThanOrEqual(24 * HOUR);
    // Không gọi generator, không lưu tin nào cho lượt bị chặn.
    expect(generate).toHaveBeenCalledTimes(2);
    expect(await fx.prisma.assistantMessage.count({ where: { userId: users[0].id, role: 'USER', createdAt: { gte: todayStart } } })).toBe(30);
  });

  it('(d) generator lỗi / trả lời rỗng → vẫn 201 với tin dự phòng, không 500, không hành động', async () => {
    const { houseId, users } = await fx.houseWith(['Hùng', 'Thiện']);
    await consent(users[0]);

    generate.mockRejectedValueOnce(new AssistantGenError('TIMEOUT'));
    const timeout = await fx.as(users[0].token).post(url(houseId), { content: 'Bồn cầu nghẹt' }).expect(201);
    expect(timeout.body.assistantMessage).toMatchObject({ content: FALLBACK, category: 'OTHER', actions: [] });

    generate.mockResolvedValueOnce({ reply: '   ', category: 'TIP', suggestedActions: [] }); // làm sạch xong rỗng → UNREADABLE
    const empty = await fx.as(users[0].token).post(url(houseId), { content: 'Giúp mình với' }).expect(201);
    expect(empty.body.assistantMessage).toMatchObject({ content: FALLBACK, category: 'OTHER', actions: [] });

    generate.mockRejectedValueOnce(new Error('projects/123: API key abc-SECRET revoked')); // lỗi lạ không được lộ ra client
    const weird = await fx.as(users[0].token).post(url(houseId), { content: 'Ơ kìa' }).expect(201);
    expect(weird.body.assistantMessage).toMatchObject({ content: FALLBACK, category: 'OTHER', actions: [] });
    expect(JSON.stringify(weird.body)).not.toContain('SECRET');

    // Mỗi lượt vẫn lưu đủ 2 tin (lượt lỗi vẫn tốn hạn mức), và không tự ghi gì khác.
    expect(await fx.prisma.assistantMessage.count({ where: { houseId } })).toBe(6);
    expect(await fx.prisma.reminder.count({ where: { houseId } })).toBe(0);
  });

  it('(e) chưa đồng ý → 403 ASSISTANT_CONSENT_REQUIRED, không gọi generator, không lưu tin', async () => {
    const { houseId, users } = await fx.houseWith(['Hùng', 'Thiện']);
    generate.mockResolvedValue(goodReply());

    const blocked = await fx.as(users[0].token).post(url(houseId), { content: 'Chào trợ lý' }).expect(403);
    expect(blocked.body.code).toBe('ASSISTANT_CONSENT_REQUIRED');
    expect(generate).not.toHaveBeenCalled();
    expect(await fx.prisma.assistantMessage.count({ where: { houseId } })).toBe(0);
  });

  it('(f) generator nhận đúng: 10 tin cuối của thread hiện tại, ngữ cảnh nhà + ca trực của chính người hỏi; thread mới không mang lịch sử cũ', async () => {
    const { houseId, users, memberId } = await fx.houseWith(['Hùng', 'Thiện']);
    await fx.prisma.house.update({ where: { id: houseId }, data: { rules: 'Tắt đèn sau 23h. Không nấu ăn trong phòng.' } });
    await consent(users[0]);
    generate.mockResolvedValue(goodReply());

    await seedShift(houseId, memberId(users[0]), 'Đổ rác', 'TODO'); // ca của người hỏi
    await seedShift(houseId, memberId(users[1]), 'Lau sàn', 'TODO'); // ca của người khác: không được gửi

    // 12 tin trong thread: 2 tin cũ nhất phải rơi khỏi cửa sổ 10 tin.
    const thread = randomUUID();
    const base = Date.now() - 15 * MINUTE;
    await fx.prisma.assistantMessage.createMany({
      data: Array.from({ length: 12 }, (_, i) => ({
        houseId,
        userId: users[0].id,
        threadId: thread,
        role: i % 2 === 0 ? ('USER' as const) : ('ASSISTANT' as const),
        content: i < 2 ? 'TinRatCu ' + i : 'Tin ' + i,
        createdAt: new Date(base + i * MINUTE),
      })),
    });

    await fx.as(users[0].token).post(url(houseId), { content: 'Tối nay mình trực gì?', threadId: thread }).expect(201);
    expect(generate).toHaveBeenCalledTimes(1);
    const ctx = generate.mock.calls[0][0];
    const texts = ctx.contents.map((c: { parts: { text: string }[] }) => c.parts.map((p) => p.text).join(''));
    // contents = [ngữ cảnh nhà] + 10 tin cuối + [câu hỏi].
    expect(ctx.contents).toHaveLength(12);
    expect(texts[0]).toContain('NGỮ CẢNH NHÀ');
    expect(texts[0]).toContain('Không nấu ăn trong phòng');
    expect(texts[0]).toContain('Số thành viên: 2');
    expect(texts[0]).toContain('Đổ rác');
    expect(texts[0]).not.toContain('Lau sàn');
    expect(ctx.systemInstruction).toContain('NestFair');
    expect(texts[texts.length - 1]).toBe('Tối nay mình trực gì?');
    expect(texts.join('\n')).not.toContain('TinRatCu');
    expect(texts.join('\n')).toContain('Tin 2'); // tin cũ nhất còn trong cửa sổ

    // Phiên mới (threadId mới): sạch, không thấy tin cũ.
    generate.mockClear();
    await fx.as(users[0].token).post(url(houseId), { content: 'Phiên mới', threadId: randomUUID() }).expect(201);
    const ctx2 = generate.mock.calls[0][0];
    expect(ctx2.contents).toHaveLength(2);
    expect(ctx2.contents[1].parts[0].text).toBe('Phiên mới');
  });

  it('(g) content rỗng / hơn 1000 ký tự / field lạ / threadId sai / limit sai → 400', async () => {
    const { houseId, users } = await fx.houseWith(['Hùng', 'Thiện']);
    await consent(users[0]);
    const post = (body: object) => fx.as(users[0].token).post(url(houseId), body);
    const get = (query: string) => fx.as(users[0].token).get(url(houseId) + query);

    await post({ content: '' }).expect(400);
    await post({ content: '   ' }).expect(400);
    await post({ content: 'x'.repeat(1001) }).expect(400);
    await post({ content: 'x'.repeat(1000) }).expect(201); // đúng 1000 ký tự thì được
    await post({ content: 'ok', hack: 1 }).expect(400);
    await post({ content: 'ok', threadId: 'khong-phai-uuid' }).expect(400);
    await post({}).expect(400);
    await get('?limit=0').expect(400);
    await get('?limit=51').expect(400);
    expect(generate).toHaveBeenCalledTimes(1); // chỉ lượt hợp lệ gọi
    expect(await fx.prisma.assistantMessage.count({ where: { houseId } })).toBe(2);
  });

  it('(h) GET phân trang: mặc định thread mới nhất, limit + nextCursor, trang từ cũ đến mới', async () => {
    const { houseId, users } = await fx.houseWith(['Hùng']);
    const base = Date.now() - 10 * MINUTE;
    const t1 = randomUUID();
    const t2 = randomUUID();
    const seed = (threadId: string, count: number, fromMs: number) =>
      fx.prisma.assistantMessage.createMany({
        data: Array.from({ length: count }, (_, i) => ({
          houseId,
          userId: users[0].id,
          threadId,
          role: 'USER' as const,
          content: (threadId === t1 ? 'T1 ' : 'T2 ') + i,
          createdAt: new Date(fromMs + i * 10_000),
        })),
      });
    await seed(t1, 2, base);
    await seed(t2, 5, base + 5 * MINUTE);

    const page1 = await fx.as(users[0].token).get(url(houseId) + '?limit=3').expect(200);
    expect(page1.body.threadId).toBe(t2); // thread mới nhất
    expect(page1.body.items.map((i: { content: string }) => i.content)).toEqual(['T2 2', 'T2 3', 'T2 4']);
    expect(page1.body.nextCursor).toEqual(expect.any(String));

    const page2 = await fx.as(users[0].token)
      .get(url(houseId) + '?threadId=' + t2 + '&limit=3&cursor=' + encodeURIComponent(page1.body.nextCursor))
      .expect(200);
    expect(page2.body.items.map((i: { content: string }) => i.content)).toEqual(['T2 0', 'T2 1']);
    expect(page2.body.nextCursor).toBeNull();

    // Thread không tồn tại / chưa có tin nào → rỗng hoàn toàn.
    const none = await fx.as(users[0].token).get(url(houseId) + '?threadId=' + randomUUID()).expect(200);
    expect(none.body).toEqual({ items: [], nextCursor: null, threadId: null });
  });
});
