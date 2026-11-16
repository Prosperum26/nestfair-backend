import { randomUUID } from 'node:crypto';
import { vi } from 'vitest';
import { ScheduleService } from '../src/modules/chores/schedule.service.js';
import { addDays, currentWeekStart, openAtOf } from '../src/modules/chores/week.js';
import { EventsService } from '../src/modules/events/events.service.js';
import { ChoreDebtService } from '../src/modules/swaps/chore-debt.service.js';
import { createFixture } from './support/house-fixture.js';

describe('Chores (e2e)', () => {
  let fx: Awaited<ReturnType<typeof createFixture>>;
  beforeAll(async () => {
    fx = await createFixture('@e2e-chores.nestfair.test');
  });
  afterEach(() => vi.restoreAllMocks());
  afterAll(() => fx.cleanup());

  const url = (houseId: string, tail = '') => `/api/v1/houses/${houseId}/chores${tail}`;

  it('ADMIN tạo việc → 201 kèm mặc định; ROOMMATE tạo → 403', async () => {
    const { houseId, users } = await fx.houseWith(['Hùng', 'Thiện']);
    const ok = await fx.as(users[0].token).post(url(houseId), { title: '  Đổ rác ', weight: 2, frequency: 'WEEKLY', recurrenceDays: [4] }).expect(201);
    expect(ok.body).toMatchObject({
      title: 'Đổ rác',
      weight: 2,
      frequency: 'WEEKLY',
      recurrenceDays: [4],
      dueTime: '21:00',
      rotationMode: 'WEEK_BLOCK',
      occurrenceGap: 1,
      isActive: true,
    });
    await fx.as(users[1].token).post(url(houseId), { title: 'Lau nhà', weight: 3, frequency: 'WEEKLY', recurrenceDays: [6] }).expect(403);
  });

  it('chế độ xoay mặc định theo số ngày lặp; Admin chọn rõ thì giữ nguyên', async () => {
    const { houseId, users } = await fx.houseWith(['Hùng', 'Thiện']);
    const admin = fx.as(users[0].token);
    const daily = await admin.post(url(houseId), { title: 'Rửa chén', weight: 2, frequency: 'DAILY', dueTime: '22:00' }).expect(201);
    expect(daily.body).toMatchObject({ recurrenceDays: [1, 2, 3, 4, 5, 6, 7], rotationMode: 'PER_OCCURRENCE', dueTime: '22:00' });
    const three = await admin.post(url(houseId), { title: 'Tưới cây', weight: 1, frequency: 'WEEKLY', recurrenceDays: [5, 1, 3] }).expect(201);
    expect(three.body).toMatchObject({ recurrenceDays: [1, 3, 5], rotationMode: 'PER_OCCURRENCE' });
    const forced = await admin.post(url(houseId), { title: 'Lau bếp', weight: 2, frequency: 'WEEKLY', recurrenceDays: [1, 3, 5], rotationMode: 'WEEK_BLOCK' }).expect(201);
    expect(forced.body.rotationMode).toBe('WEEK_BLOCK');
    const adhoc = await admin.post(url(houseId), { title: 'Việc đột xuất', weight: 2, frequency: 'ADHOC' }).expect(201);
    expect(adhoc.body.recurrenceDays).toEqual([]);
  });

  it('dữ liệu sai → 400: ngày, giờ, weight, tên, field lạ, WEEKLY không ngày, gap', async () => {
    const { houseId, users } = await fx.houseWith(['Hùng', 'Thiện']);
    const post = (body: object) => fx.as(users[0].token).post(url(houseId), body);
    const ok = { title: 'A', weight: 2, frequency: 'WEEKLY', recurrenceDays: [1] };
    await post({ ...ok, recurrenceDays: [8] }).expect(400);
    await post({ ...ok, recurrenceDays: [0] }).expect(400);
    await post({ ...ok, recurrenceDays: [1, 1.5] }).expect(400);
    await post({ ...ok, dueTime: '25:00' }).expect(400);
    await post({ ...ok, dueTime: '9:00' }).expect(400);
    await post({ ...ok, weight: 6 }).expect(400);
    await post({ ...ok, weight: 0 }).expect(400);
    await post({ ...ok, title: '   ' }).expect(400);
    await post({ ...ok, isActive: false }).expect(400);
    await post({ ...ok, recurrenceDays: [] }).expect(400);
    await post({ ...ok, occurrenceGap: 0 }).expect(400);
    await post({ ...ok, occurrenceGap: 9 }).expect(400);
    await post({ ...ok, frequency: 'MONTHLY' }).expect(400);
  });

  it('người ngoài nhà không đọc được danh sách (403)', async () => {
    const { houseId } = await fx.houseWith(['Hùng', 'Thiện']);
    const outsider = await fx.user('Người lạ');
    await fx.as(outsider.token).get(url(houseId)).expect(403);
  });

  it('PATCH đổi tên/weight/giờ/ngày; việc đã tắt ẩn khỏi danh sách mặc định', async () => {
    const { houseId, users } = await fx.houseWith(['Hùng', 'Thiện']);
    const admin = fx.as(users[0].token);
    const created = await admin.post(url(houseId), { title: 'Rửa chén', weight: 2, frequency: 'WEEKLY', recurrenceDays: [2] });
    const id = created.body.id as string;
    const patched = await admin.patch(url(houseId, `/${id}`), { weight: 4, dueTime: '20:15', recurrenceDays: [2, 5] }).expect(200);
    expect(patched.body).toMatchObject({ weight: 4, dueTime: '20:15', recurrenceDays: [2, 5] });
    await admin.patch(url(houseId, `/${id}`), { isActive: false }).expect(200);
    expect((await fx.as(users[1].token).get(url(houseId)).expect(200)).body).toEqual([]);
    expect((await fx.as(users[1].token).get(url(houseId, '?includeInactive=true')).expect(200)).body).toHaveLength(1);
    await admin.patch(url(houseId, `/${id}`), { frequency: 'WEEKLY', recurrenceDays: [] }).expect(400);
  });

  it('PATCH choreId của nhà khác → 404 (chống IDOR); member → 403', async () => {
    const a = await fx.houseWith(['Hùng', 'Thiện']);
    const b = await fx.houseWith(['Mai', 'Quân']);
    const chore = await fx.as(b.users[0].token).post(url(b.houseId), { title: 'X', weight: 1, frequency: 'WEEKLY', recurrenceDays: [1] });
    await fx.as(a.users[0].token).patch(url(a.houseId, `/${chore.body.id}`), { title: 'Hack' }).expect(404);
    await fx.as(b.users[1].token).patch(url(b.houseId, `/${chore.body.id}`), { title: 'Hack' }).expect(403);
  });

  it('danh sách mặc định và includeInactive không trả việc đã lưu trữ; archived=true chỉ trả việc đã lưu trữ', async () => {
    const { houseId, users } = await fx.houseWith(['Hùng', 'Thiện']);
    const admin = fx.as(users[0].token);
    const make = async (title: string) =>
      (await admin.post(url(houseId), { title, weight: 2, frequency: 'WEEKLY', recurrenceDays: [3] }).expect(201)).body.id as string;
    const active = await make('Đang chạy');
    const paused = await make('Tạm ngưng');
    const archived = await make('Đã lưu trữ');
    await admin.patch(url(houseId, `/${paused}`), { isActive: false }).expect(200);
    await fx.prisma.chore.update({ where: { id: archived }, data: { isActive: false, archivedAt: new Date() } });

    const ids = async (query: string) => ((await admin.get(url(houseId, query)).expect(200)).body as { id: string }[]).map((c) => c.id).sort();
    expect(await ids('')).toEqual([active]);
    expect(await ids('?includeInactive=true')).toEqual([active, paused].sort());
    const onlyArchived = (await admin.get(url(houseId, '?archived=true')).expect(200)).body as { id: string; archivedAt: string | null }[];
    expect(onlyArchived.map((c) => c.id)).toEqual([archived]);
    expect(onlyArchived[0].archivedAt).toEqual(expect.any(String));
    const all = (await admin.get(url(houseId, '?includeInactive=true')).expect(200)).body as { archivedAt: string | null }[];
    expect(all.every((c) => c.archivedAt === null)).toBe(true);
  });

  it('S-27/S-28: sửa weight giữ snapshot ca đã sinh; tắt việc hủy ca TODO tương lai, không đụng ca DONE; ghi audit', async () => {
    const h = await fx.houseWith(['Hùng', 'Thiện', 'Mai']);
    const admin = fx.as(h.users[0].token);
    const chore = (await admin.post(url(h.houseId), { title: 'Dọn bếp', weight: 2, frequency: 'DAILY' }).expect(201)).body;
    const next = addDays(currentWeekStart(), 7);
    await fx.app.get(ScheduleService).ensureSchedule(h.houseId, next, 'CRON', openAtOf(currentWeekStart()));
    const rows = await fx.prisma.choreAssignment.findMany({ where: { houseId: h.houseId }, orderBy: { occurrenceDate: 'asc' } });
    expect(rows).toHaveLength(7);
    await fx.prisma.choreAssignment.update({ where: { id: rows[0].id }, data: { status: 'DONE' } });

    await admin.patch(url(h.houseId, `/${chore.id}`), { weight: 5, title: 'Đổi tên' }).expect(200);
    const afterEdit = await fx.prisma.choreAssignment.findFirstOrThrow({ where: { id: rows[1].id } });
    expect(afterEdit).toMatchObject({ weightSnapshot: 2, titleSnapshot: 'Dọn bếp' });

    const emit = vi.spyOn(fx.app.get(EventsService), 'send');
    await admin.patch(url(h.houseId, `/${chore.id}`), { isActive: false }).expect(200);
    const after = await fx.prisma.choreAssignment.findMany({ where: { houseId: h.houseId }, orderBy: { occurrenceDate: 'asc' } });
    expect(after[0].status).toBe('DONE');
    expect(after.slice(1).every((a) => a.status === 'CANCELLED')).toBe(true);
    expect(emit).toHaveBeenCalledWith(`house:${h.houseId}`, expect.objectContaining({ type: 'chore:cancelled', payload: expect.objectContaining({ choreId: chore.id }) }));
    const actions = (await fx.prisma.choreAuditLog.findMany({ where: { houseId: h.houseId } })).map((l) => l.action).sort();
    expect(actions).toEqual(['CHORE_CREATED', 'CHORE_DEACTIVATED', 'CHORE_UPDATED']);
  });

  describe('lưu trữ và khôi phục', () => {
    const makeChore = async (token: string, houseId: string, title = 'Dọn bếp') =>
      (await fx.as(token).post(url(houseId), { title, weight: 2, frequency: 'DAILY' }).expect(201)).body as { id: string };
    const actionsOf = async (houseId: string) => (await fx.prisma.choreAuditLog.findMany({ where: { houseId } })).map((l) => l.action);

    it('ADMIN lưu trữ: ca TODO tương lai thành CANCELLED, ca DONE giữ nguyên, việc ẩn khỏi danh sách, ghi audit CHORE_ARCHIVED', async () => {
      const h = await fx.houseWith(['Hùng', 'Thiện', 'Mai']);
      const chore = await makeChore(h.users[0].token, h.houseId);
      await fx.app.get(ScheduleService).ensureSchedule(h.houseId, addDays(currentWeekStart(), 7), 'CRON', openAtOf(currentWeekStart()));
      const rows = await fx.prisma.choreAssignment.findMany({ where: { houseId: h.houseId }, orderBy: { occurrenceDate: 'asc' } });
      await fx.prisma.choreAssignment.update({ where: { id: rows[0].id }, data: { status: 'DONE' } });

      const res = await fx.as(h.users[0].token).delete(url(h.houseId, `/${chore.id}`)).expect(200);
      expect(res.body).toMatchObject({ id: chore.id, isActive: false, archivedAt: expect.any(String) });

      const after = await fx.prisma.choreAssignment.findMany({ where: { houseId: h.houseId }, orderBy: { occurrenceDate: 'asc' } });
      expect(after[0].status).toBe('DONE');
      expect(after.slice(1).every((a) => a.status === 'CANCELLED')).toBe(true);
      expect((await fx.as(h.users[1].token).get(url(h.houseId, '?includeInactive=true')).expect(200)).body).toEqual([]);
      expect(await actionsOf(h.houseId)).toContain('CHORE_ARCHIVED');
    });

    it('lưu trữ hai lần là idempotent: lần hai 200, không thêm audit, không đổi ca', async () => {
      const h = await fx.houseWith(['Hùng', 'Thiện']);
      const chore = await makeChore(h.users[0].token, h.houseId);
      const admin = fx.as(h.users[0].token);
      const first = await admin.delete(url(h.houseId, `/${chore.id}`)).expect(200);
      const second = await admin.delete(url(h.houseId, `/${chore.id}`)).expect(200);
      expect(second.body.archivedAt).toBe(first.body.archivedAt);
      expect((await actionsOf(h.houseId)).filter((a) => a === 'CHORE_ARCHIVED')).toHaveLength(1);
    });

    it('việc đang tạm ngưng rồi lưu trữ: chỉ đặt archivedAt, không hủy ca lần nữa', async () => {
      const h = await fx.houseWith(['Hùng', 'Thiện']);
      const chore = await makeChore(h.users[0].token, h.houseId);
      const admin = fx.as(h.users[0].token);
      await admin.patch(url(h.houseId, `/${chore.id}`), { isActive: false }).expect(200);
      await admin.delete(url(h.houseId, `/${chore.id}`)).expect(200);
      const actions = await actionsOf(h.houseId);
      expect(actions.filter((a) => a === 'CHORE_DEACTIVATED')).toHaveLength(1);
      expect(actions).toContain('CHORE_ARCHIVED');
      expect((await fx.prisma.chore.findUniqueOrThrow({ where: { id: chore.id } })).archivedAt).not.toBeNull();
    });

    it('ROOMMATE gọi DELETE → 403; việc nhà khác → 404; việc isSystem → 403 SYSTEM_CHORE', async () => {
      const a = await fx.houseWith(['Hùng', 'Thiện']);
      const b = await fx.houseWith(['Mai', 'Quân']);
      const chore = await makeChore(a.users[0].token, a.houseId);
      await fx.as(a.users[1].token).delete(url(a.houseId, `/${chore.id}`)).expect(403);
      await fx.as(b.users[0].token).delete(url(b.houseId, `/${chore.id}`)).expect(404);
      const system = await fx.prisma.chore.create({ data: { houseId: a.houseId, title: 'Việc hệ thống', weight: 1, frequency: 'ADHOC', recurrenceDays: [], isSystem: true } });
      const res = await fx.as(a.users[0].token).delete(url(a.houseId, `/${system.id}`)).expect(403);
      expect(res.body.code ?? res.body.message).toEqual(expect.stringContaining('SYSTEM_CHORE'));
      expect((await fx.prisma.chore.findUniqueOrThrow({ where: { id: chore.id } })).archivedAt).toBeNull();
    });

    it('khôi phục: archivedAt = null, isActive vẫn false, hiện ở includeInactive; việc chưa lưu trữ → 409', async () => {
      const h = await fx.houseWith(['Hùng', 'Thiện']);
      const chore = await makeChore(h.users[0].token, h.houseId);
      const admin = fx.as(h.users[0].token);
      await admin.post(url(h.houseId, `/${chore.id}/restore`)).expect(409);
      await admin.delete(url(h.houseId, `/${chore.id}`)).expect(200);
      await fx.as(h.users[1].token).post(url(h.houseId, `/${chore.id}/restore`)).expect(403);
      const res = await admin.post(url(h.houseId, `/${chore.id}/restore`)).expect(200);
      expect(res.body).toMatchObject({ archivedAt: null, isActive: false });
      expect((await admin.get(url(h.houseId, '?includeInactive=true')).expect(200)).body).toHaveLength(1);
      expect(await actionsOf(h.houseId)).toContain('CHORE_RESTORED');
    });

    it('PATCH việc đã lưu trữ → 409 CHORE_ARCHIVED, không bật lại được', async () => {
      const h = await fx.houseWith(['Hùng', 'Thiện']);
      const chore = await makeChore(h.users[0].token, h.houseId);
      const admin = fx.as(h.users[0].token);
      await admin.delete(url(h.houseId, `/${chore.id}`)).expect(200);
      const res = await admin.patch(url(h.houseId, `/${chore.id}`), { isActive: true }).expect(409);
      expect(JSON.stringify(res.body)).toContain('CHORE_ARCHIVED');
      expect(await fx.prisma.chore.findUniqueOrThrow({ where: { id: chore.id } })).toMatchObject({ isActive: false });
    });

    it('lưu trữ là một transaction: hủy ca lỗi thì việc không bị đánh dấu lưu trữ và thử lại được', async () => {
      const h = await fx.houseWith(['Hùng', 'Thiện', 'Mai']);
      const chore = await makeChore(h.users[0].token, h.houseId);
      await fx.app.get(ScheduleService).ensureSchedule(h.houseId, addDays(currentWeekStart(), 7), 'CRON', openAtOf(currentWeekStart()));
      const admin = fx.as(h.users[0].token);
      const debts = fx.app.get(ChoreDebtService);
      const spy = vi.spyOn(debts, 'onAssignmentsCancelled').mockRejectedValueOnce(new Error('boom'));
      await admin.delete(url(h.houseId, `/${chore.id}`)).expect(500);
      spy.mockRestore();
      expect(await fx.prisma.chore.findUniqueOrThrow({ where: { id: chore.id } })).toMatchObject({ archivedAt: null, isActive: true });
      await admin.delete(url(h.houseId, `/${chore.id}`)).expect(200);
      const slots = await fx.prisma.choreAssignment.findMany({ where: { choreId: chore.id } });
      expect(slots.every((s) => s.status === 'CANCELLED')).toBe(true);
    });

    it('việc đã lưu trữ không sinh ca khi chạy sinh lịch tuần', async () => {
      const h = await fx.houseWith(['Hùng', 'Thiện']);
      const chore = await makeChore(h.users[0].token, h.houseId);
      await fx.as(h.users[0].token).delete(url(h.houseId, `/${chore.id}`)).expect(200);
      await fx.app.get(ScheduleService).ensureSchedule(h.houseId, addDays(currentWeekStart(), 7), 'CRON', openAtOf(currentWeekStart()));
      expect(await fx.prisma.choreAssignment.count({ where: { choreId: chore.id } })).toBe(0);
    });
  });

  describe('xóa vĩnh viễn', () => {
    const purgeUrl = (houseId: string, id: string) => url(houseId, `/${id}/permanent`);
    /** Việc đã lưu trữ kèm các ca sinh cho tuần sau. */
    async function archivedChoreWithSlots() {
      const h = await fx.houseWith(['Hùng', 'Thiện', 'Mai']);
      const admin = fx.as(h.users[0].token);
      const chore = (await admin.post(url(h.houseId), { title: 'Dọn bếp', weight: 2, frequency: 'DAILY' }).expect(201)).body as { id: string };
      await fx.app.get(ScheduleService).ensureSchedule(h.houseId, addDays(currentWeekStart(), 7), 'CRON', openAtOf(currentWeekStart()));
      await admin.delete(url(h.houseId, `/${chore.id}`)).expect(200);
      const slots = await fx.prisma.choreAssignment.findMany({ where: { choreId: chore.id } });
      return { h, admin, chore, slots };
    }

    it('purge việc đã lưu trữ chỉ có ca CANCELLED/TODO: 204, việc và các ca bị xóa, ghi audit CHORE_PURGED', async () => {
      const { h, admin, chore, slots } = await archivedChoreWithSlots();
      expect(slots.length).toBeGreaterThan(0);
      await admin.delete(purgeUrl(h.houseId, chore.id)).expect(204);
      expect(await fx.prisma.chore.count({ where: { id: chore.id } })).toBe(0);
      expect(await fx.prisma.choreAssignment.count({ where: { choreId: chore.id } })).toBe(0);
      const purged = await fx.prisma.choreAuditLog.findMany({ where: { houseId: h.houseId, action: 'CHORE_PURGED' } });
      expect(purged).toHaveLength(1);
      expect(purged[0].detail).toMatchObject({ choreId: chore.id, title: 'Dọn bếp' });
    });

    it('purge → 409 CHORE_HAS_HISTORY khi có ca DONE; khi có ChoreDebt trỏ tới ca; khi có ChoreSwapRequest trỏ tới ca; không xóa gì', async () => {
      const cases: { name: string; seed: (c: Awaited<ReturnType<typeof archivedChoreWithSlots>>) => Promise<void> }[] = [
        { name: 'ca DONE', seed: async (c) => void (await fx.prisma.choreAssignment.update({ where: { id: c.slots[0].id }, data: { status: 'DONE' } })) },
        {
          name: 'ChoreDebt',
          seed: async (c) =>
            void (await fx.prisma.choreDebt.create({
              data: {
                houseId: c.h.houseId,
                debtorMemberId: c.h.memberId(c.h.users[1]),
                creditorMemberId: c.h.memberId(c.h.users[2]),
                swapRequestId: randomUUID(),
                coverAssignmentId: c.slots[0].id,
                weight: 1,
              },
            })),
        },
        {
          name: 'ChoreSwapRequest',
          seed: async (c) =>
            void (await fx.prisma.choreSwapRequest.create({
              data: {
                houseId: c.h.houseId,
                type: 'COVER',
                compensation: 'PAYBACK',
                requesterMemberId: c.h.memberId(c.h.users[1]),
                fromAssignmentId: c.slots[0].id,
                status: 'CANCELLED',
                expiresAt: new Date(),
                rootRequestId: randomUUID(),
                fromWeightSnapshot: 1,
              },
            })),
        },
      ];
      for (const c of cases) {
        const ctx = await archivedChoreWithSlots();
        await c.seed(ctx);
        const res = await ctx.admin.delete(purgeUrl(ctx.h.houseId, ctx.chore.id)).expect(409);
        expect(JSON.stringify(res.body), c.name).toContain('CHORE_HAS_HISTORY');
        expect(await fx.prisma.chore.count({ where: { id: ctx.chore.id } }), c.name).toBe(1);
        expect(await fx.prisma.choreAssignment.count({ where: { choreId: ctx.chore.id } }), c.name).toBe(ctx.slots.length);
      }
    });

    it('purge việc chưa lưu trữ → 409 CHORE_NOT_ARCHIVED', async () => {
      const h = await fx.houseWith(['Hùng', 'Thiện']);
      const admin = fx.as(h.users[0].token);
      const chore = (await admin.post(url(h.houseId), { title: 'A', weight: 1, frequency: 'WEEKLY', recurrenceDays: [1] }).expect(201)).body as { id: string };
      const res = await admin.delete(purgeUrl(h.houseId, chore.id)).expect(409);
      expect(JSON.stringify(res.body)).toContain('CHORE_NOT_ARCHIVED');
      expect(await fx.prisma.chore.count({ where: { id: chore.id } })).toBe(1);
    });

    it('ROOMMATE → 403; nhà khác → 404; gọi lần hai → 404', async () => {
      const { h, admin, chore } = await archivedChoreWithSlots();
      const other = await fx.houseWith(['Mai', 'Quân']);
      await fx.as(h.users[1].token).delete(purgeUrl(h.houseId, chore.id)).expect(403);
      await fx.as(other.users[0].token).delete(purgeUrl(other.houseId, chore.id)).expect(404);
      await admin.delete(purgeUrl(h.houseId, chore.id)).expect(204);
      await admin.delete(purgeUrl(h.houseId, chore.id)).expect(404);
    });

    it('archived=true trả canPurge đúng cho việc có và không có lịch sử', async () => {
      const clean = await archivedChoreWithSlots();
      const used = await archivedChoreWithSlots();
      await fx.prisma.choreAssignment.update({ where: { id: used.slots[0].id }, data: { status: 'DONE' } });
      const flag = async (ctx: typeof clean) =>
        ((await ctx.admin.get(url(ctx.h.houseId, '?archived=true')).expect(200)).body as { id: string; canPurge: boolean }[]).find((c) => c.id === ctx.chore.id)?.canPurge;
      expect(await flag(clean)).toBe(true);
      expect(await flag(used)).toBe(false);
    });

    it('hai purge song song cùng việc: một 204, bên kia 404 hoặc 409, không 500', async () => {
      const { h, admin, chore } = await archivedChoreWithSlots();
      const results = await Promise.all([admin.delete(purgeUrl(h.houseId, chore.id)), admin.delete(purgeUrl(h.houseId, chore.id))]);
      const codes = results.map((r) => r.status).sort((a, b) => a - b);
      expect(codes[0]).toBe(204);
      expect([404, 409]).toContain(codes[1]);
      expect(await fx.prisma.chore.count({ where: { id: chore.id } })).toBe(0);
    });
  });

  describe('chore-settings', () => {
    it('mặc định 3 giờ ân hạn và 2 ca/người/ngày; Admin chỉnh được, member 403', async () => {
      const { houseId, users } = await fx.houseWith(['Hùng', 'Thiện']);
      const path = `/api/v1/houses/${houseId}/chore-settings`;
      expect((await fx.as(users[1].token).get(path).expect(200)).body).toEqual({ choreGraceHours: 3, maxSlotsPerPersonPerDay: 2 });
      const res = await fx.as(users[0].token).patch(path, { choreGraceHours: 6, maxSlotsPerPersonPerDay: 3 }).expect(200);
      expect(res.body).toEqual({ choreGraceHours: 6, maxSlotsPerPersonPerDay: 3 });
      await fx.as(users[1].token).patch(path, { choreGraceHours: 5 }).expect(403);
      for (const bad of [{ choreGraceHours: 0 }, { choreGraceHours: 25 }, { maxSlotsPerPersonPerDay: 0 }, { maxSlotsPerPersonPerDay: 7 }, { nope: 1 }]) {
        await fx.as(users[0].token).patch(path, bad).expect(400);
      }
      expect((await fx.as(users[1].token).get(path).expect(200)).body).toEqual({ choreGraceHours: 6, maxSlotsPerPersonPerDay: 3 });
    });
  });
});
