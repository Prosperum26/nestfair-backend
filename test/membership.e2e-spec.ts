import { vi } from 'vitest';
import { ScheduleService } from '../src/modules/chores/schedule.service.js';
import { EventsService } from '../src/modules/events/events.service.js';
import { HOUR, makeAssignment } from './support/assignment-fixture.js';
import { createFixture, type TestUser } from './support/house-fixture.js';

// Cần Postgres đang chạy (npm run db:up) và .env hợp lệ.
const DOMAIN = '@e2e-membership.nestfair.test';

describe('Rời nhà, xóa thành viên, chuyển quyền (e2e)', () => {
  let fx: Awaited<ReturnType<typeof createFixture>>;
  beforeAll(async () => {
    fx = await createFixture(DOMAIN);
  });
  afterEach(() => vi.restoreAllMocks());
  afterAll(() => fx.cleanup());

  const url = (houseId: string, tail = '') => `/api/v1/houses/${houseId}${tail}`;

  /** `creditor` trả hộ `debtor` toàn bộ `amount`. */
  const debt = (houseId: string, creditor: TestUser, debtor: TestUser, amount: number) =>
    fx
      .as(creditor.token)
      .post(url(houseId, '/expenses'), {
        title: 'Nợ',
        category: 'OTHER',
        totalAmount: amount,
        splitType: 'EXACT',
        spentAt: '2026-10-05T12:00:00+07:00',
        splits: [{ userId: debtor.id, amount }],
      })
      .expect(201);

  /** Nhà 4 người Hùng (Admin), Thiện, Mai, Quân. */
  async function house4() {
    const h = await fx.houseWith(['Hùng', 'Thiện', 'Mai', 'Quân']);
    const [H, T, M, Q] = h.users;
    return { ...h, H, T, M, Q };
  }

  const kick = (token: string, houseId: string, userId: string, body: object = {}) =>
    fx.as(token).delete(url(houseId, `/members/${userId}`)).send(body);

  const netOf = async (houseId: string, token: string) => {
    const plan = await fx.as(token).get(url(houseId, '/settlements/plan')).expect(200);
    return Object.fromEntries(plan.body.members.map((m: { id: string; net: number }) => [m.id, m.net])) as Record<string, number>;
  };
  const isActive = async (houseId: string, userId: string) =>
    (await fx.prisma.houseMember.count({ where: { houseId, userId, leftAt: null } })) === 1;

  describe('GET /members/:userId/leave-preview', () => {
    it('trưởng phòng xem được số dư và số ca sắp tới của thành viên', async () => {
      const h = await house4();
      await debt(h.houseId, h.H, h.Q, 170_000);
      await makeAssignment(fx, h, { assignee: 3, occurrenceDate: undefined, dueAt: new Date(Date.now() + 48 * HOUR) });

      const res = await fx.as(h.H.token).get(url(h.houseId, `/members/${h.Q.id}/leave-preview`)).expect(200);
      expect(res.body).toMatchObject({
        userId: h.Q.id,
        fullName: 'Quân',
        role: 'ROOMMATE',
        net: -170_000,
        futureShifts: 1,
        openChoreDebts: 0,
        isLastMember: false,
      });
    });

    it('thành viên xem được của chính mình, không xem được của người khác', async () => {
      const h = await house4();
      await fx.as(h.T.token).get(url(h.houseId, `/members/${h.T.id}/leave-preview`)).expect(200);
      await fx.as(h.T.token).get(url(h.houseId, `/members/${h.M.id}/leave-preview`)).expect(403);
    });

    it('người không ở nhà này thì 404', async () => {
      const h = await house4();
      const outsider = await fx.user('Người lạ');
      await fx.as(h.H.token).get(url(h.houseId, `/members/${outsider.id}/leave-preview`)).expect(404);
    });
  });

  describe('POST /leave', () => {
    it('hết nợ thì rời được: đặt leftAt, mất quyền vào nhà, phát member:left, ghi hoạt động', async () => {
      const h = await house4();
      const events = fx.app.get(EventsService);
      const kicked = vi.spyOn(events, 'removeMemberFromHouse');

      await fx.as(h.T.token).post(url(h.houseId, '/leave'), {}).expect(200);

      expect(await isActive(h.houseId, h.T.id)).toBe(false);
      await fx.as(h.T.token).get(url(h.houseId)).expect(403);
      expect(kicked).toHaveBeenCalledWith(h.T.id, h.houseId, 'Thiện', false);
      const activity = await fx.prisma.houseActivity.findFirst({ where: { houseId: h.houseId, type: 'member.left' } });
      expect(activity?.params).toMatchObject({ userId: h.T.id, name: 'Thiện', kicked: false });
    });

    it.each([
      ['còn nợ', (h: Awaited<ReturnType<typeof house4>>) => debt(h.houseId, h.H, h.T, 50_000), -50_000],
      ['chưa nhận đủ', (h: Awaited<ReturnType<typeof house4>>) => debt(h.houseId, h.T, h.M, 80_000), 80_000],
    ])('%s thì 409 HAS_BALANCE kèm số dư, vẫn ở trong nhà', async (_, setup, net) => {
      const h = await house4();
      await setup(h);
      const res = await fx.as(h.T.token).post(url(h.houseId, '/leave'), {}).expect(409);
      expect(res.body).toMatchObject({ code: 'HAS_BALANCE', net });
      expect(await isActive(h.houseId, h.T.id)).toBe(true);
    });

    it('trưởng phòng rời phải chọn người nhận quyền', async () => {
      const h = await house4();
      const res = await fx.as(h.H.token).post(url(h.houseId, '/leave'), {}).expect(409);
      expect(res.body.code).toBe('NEW_ADMIN_REQUIRED');

      const outsider = await fx.user('Người lạ');
      await fx.as(h.H.token).post(url(h.houseId, '/leave'), { newAdminUserId: outsider.id }).expect(400);
      await fx.as(h.H.token).post(url(h.houseId, '/leave'), { newAdminUserId: h.H.id }).expect(400);

      await fx.as(h.H.token).post(url(h.houseId, '/leave'), { newAdminUserId: h.M.id }).expect(200);
      const roles = await fx.prisma.houseMember.findMany({ where: { houseId: h.houseId, leftAt: null }, select: { userId: true, role: true } });
      expect(roles.filter((r) => r.role === 'ADMIN').map((r) => r.userId)).toEqual([h.M.id]);
      expect(await isActive(h.houseId, h.H.id)).toBe(false);
      // Trưởng phòng mới làm được việc của trưởng phòng.
      await fx.as(h.M.token).patch(url(h.houseId), { name: 'Nhà của Mai' }).expect(200);
    });

    it('người cuối cùng không rời được (409 LAST_MEMBER)', async () => {
      const solo = await fx.houseWith(['Hùng']);
      const res = await fx.as(solo.users[0].token).post(url(solo.houseId, '/leave'), {}).expect(409);
      expect(res.body.code).toBe('LAST_MEMBER');
    });

    it('ca tương lai của người rời được hệ thống tự chia cho người khác', async () => {
      const h = await house4();
      const slot = await makeAssignment(fx, h, { assignee: 1, dueAt: new Date(Date.now() + 48 * HOUR) });
      await fx.as(h.T.token).post(url(h.houseId, '/leave'), {}).expect(200);
      const row = await fx.prisma.choreAssignment.findUniqueOrThrow({ where: { id: slot.id } });
      expect(row.status).toBe('TODO');
      expect(row.assigneeId).not.toBe(h.memberId(h.T));
      expect(row.assigneeId).not.toBeNull();
    });
  });

  describe('DELETE /members/:userId (trưởng phòng xóa thành viên)', () => {
    it('hết nợ thì xóa ngay, client của người bị xóa được báo là bị xóa', async () => {
      const h = await house4();
      const kicked = vi.spyOn(fx.app.get(EventsService), 'removeMemberFromHouse');
      await kick(h.H.token, h.houseId, h.Q.id).expect(200);
      expect(kicked).toHaveBeenCalledWith(h.Q.id, h.houseId, 'Quân', true);
      expect(await isActive(h.houseId, h.Q.id)).toBe(false);
      await fx.as(h.Q.token).get(url(h.houseId)).expect(403);
      const activity = await fx.prisma.houseActivity.findFirst({ where: { houseId: h.houseId, type: 'member.left' } });
      expect(activity?.params).toMatchObject({ userId: h.Q.id, kicked: true });
    });

    it('còn nợ mà chưa chọn cách xử lý thì 409 kèm số dư, không xóa', async () => {
      const h = await house4();
      await debt(h.houseId, h.H, h.Q, 170_000);
      const res = await kick(h.H.token, h.houseId, h.Q.id).expect(409);
      expect(res.body).toMatchObject({ code: 'BALANCE_DECISION_REQUIRED', net: -170_000 });
      expect(await isActive(h.houseId, h.Q.id)).toBe(true);
    });

    it('WRITE_OFF: xóa khoản nợ, chủ nợ chịu; người bị xóa về 0, tổng số dư vẫn 0', async () => {
      const h = await house4();
      await debt(h.houseId, h.H, h.Q, 100_000);
      await debt(h.houseId, h.M, h.Q, 300_000);
      await kick(h.H.token, h.houseId, h.Q.id, { mode: 'WRITE_OFF' }).expect(200);

      const net = await netOf(h.houseId, h.H.token);
      expect(net[h.H.id] ?? 0).toBe(0);
      expect(net[h.M.id] ?? 0).toBe(0);
      expect(net[h.Q.id] ?? 0).toBe(0);
      expect(Object.values(net).reduce((s, v) => s + v, 0)).toBe(0);
      const adj = await fx.prisma.balanceAdjustment.findFirstOrThrow({ where: { houseId: h.houseId }, include: { lines: true } });
      expect(adj).toMatchObject({ userId: h.Q.id, kind: 'WRITE_OFF', amount: -400_000, toUserId: null, createdById: h.H.id });
      expect(adj.lines).toHaveLength(2);
    });

    it('TRANSFER: người nhận gánh đúng số nợ, các khoản khác không đổi', async () => {
      const h = await house4();
      await debt(h.houseId, h.H, h.Q, 170_000);
      await debt(h.houseId, h.M, h.T, 380_000);
      await kick(h.H.token, h.houseId, h.Q.id, { mode: 'TRANSFER', toUserId: h.T.id }).expect(200);

      const net = await netOf(h.houseId, h.H.token);
      expect(net[h.H.id]).toBe(170_000);
      expect(net[h.M.id]).toBe(380_000);
      expect(net[h.T.id]).toBe(-550_000);
      expect(net[h.Q.id] ?? 0).toBe(0);
    });

    it('TRANSFER khi người bị xóa đang được nhận: người nhận hưởng phần đó', async () => {
      const h = await house4();
      await debt(h.houseId, h.Q, h.T, 90_000);
      await kick(h.H.token, h.houseId, h.Q.id, { mode: 'TRANSFER', toUserId: h.M.id }).expect(200);
      const net = await netOf(h.houseId, h.H.token);
      expect(net[h.M.id]).toBe(90_000);
      expect(net[h.T.id]).toBe(-90_000);
    });

    it.each([
      ['thiếu người nhận', (_h: Awaited<ReturnType<typeof house4>>) => ({ mode: 'TRANSFER' })],
      ['người nhận là chính người bị xóa', (h: Awaited<ReturnType<typeof house4>>) => ({ mode: 'TRANSFER', toUserId: h.Q.id })],
      ['cách xử lý lạ', () => ({ mode: 'FORGET' })],
    ])('%s thì 400', async (_, body) => {
      const h = await house4();
      await debt(h.houseId, h.H, h.Q, 10_000);
      await kick(h.H.token, h.houseId, h.Q.id, body(h)).expect(400);
      expect(await isActive(h.houseId, h.Q.id)).toBe(true);
    });

    it('người nhận không ở nhà này thì 400', async () => {
      const h = await house4();
      const outsider = await fx.user('Người lạ');
      await debt(h.houseId, h.H, h.Q, 10_000);
      await kick(h.H.token, h.houseId, h.Q.id, { mode: 'TRANSFER', toUserId: outsider.id }).expect(400);
    });

    it('không tự xóa mình, không xóa người không ở nhà; thành viên thường không xóa được ai', async () => {
      const h = await house4();
      const self = await kick(h.H.token, h.houseId, h.H.id).expect(400);
      expect(self.body.code).toBe('CANNOT_KICK_SELF');
      const outsider = await fx.user('Người lạ');
      await kick(h.H.token, h.houseId, outsider.id).expect(404);
      await kick(h.T.token, h.houseId, h.Q.id).expect(403);
    });

    it('chọn "để trống" thì ca tương lai của người bị xóa thành UNASSIGNED để trưởng phòng tự gán', async () => {
      const h = await house4();
      const future = await makeAssignment(fx, h, { assignee: 3, dueAt: new Date(Date.now() + 48 * HOUR) });
      const done = await makeAssignment(fx, h, { assignee: 3, status: 'DONE' });
      await kick(h.H.token, h.houseId, h.Q.id, { shifts: 'MANUAL' }).expect(200);

      const row = await fx.prisma.choreAssignment.findUniqueOrThrow({ where: { id: future.id } });
      expect(row).toMatchObject({ status: 'UNASSIGNED', assigneeId: null, originalAssigneeId: h.memberId(h.Q) });
      expect((await fx.prisma.choreAssignment.findUniqueOrThrow({ where: { id: done.id } })).status).toBe('DONE');
    });

    it('ca để trống: cron chia ca mồ côi không đụng tới, trưởng phòng giao lại bằng thao tác REASSIGN có sẵn', async () => {
      const h = await house4();
      const slot = await makeAssignment(fx, h, { assignee: 3, dueAt: new Date(Date.now() + 48 * HOUR) });
      await kick(h.H.token, h.houseId, h.Q.id, { shifts: 'MANUAL' }).expect(200);

      await fx.app.get(ScheduleService).reassignOrphans(h.houseId);
      expect((await fx.prisma.choreAssignment.findUniqueOrThrow({ where: { id: slot.id } })).status).toBe('UNASSIGNED');

      await fx
        .as(h.H.token)
        .patch(`/api/v1/assignments/${slot.id}/override`, { action: 'REASSIGN', userId: h.T.id, reason: 'Quân đã rời nhà' })
        .expect(200);
      const row = await fx.prisma.choreAssignment.findUniqueOrThrow({ where: { id: slot.id } });
      expect(row).toMatchObject({ status: 'TODO', assigneeId: h.memberId(h.T) });
    });

    it('đóng nợ ca còn OPEN của người bị xóa (cả khi là người nợ lẫn người được làm bù)', async () => {
      const h = await house4();
      const asDebtor = await fx.prisma.choreDebt.create({
        data: { houseId: h.houseId, debtorMemberId: h.memberId(h.Q), creditorMemberId: h.memberId(h.T), swapRequestId: crypto.randomUUID(), coverAssignmentId: crypto.randomUUID(), weight: 2 },
      });
      const asCreditor = await fx.prisma.choreDebt.create({
        data: { houseId: h.houseId, debtorMemberId: h.memberId(h.M), creditorMemberId: h.memberId(h.Q), swapRequestId: crypto.randomUUID(), coverAssignmentId: crypto.randomUUID(), weight: 3 },
      });
      await kick(h.H.token, h.houseId, h.Q.id).expect(200);

      const [a, b] = await Promise.all([asDebtor, asCreditor].map((d) => fx.prisma.choreDebt.findUniqueOrThrow({ where: { id: d.id } })));
      expect(a).toMatchObject({ status: 'CANCELLED', closeReason: 'DEBTOR_LEFT' });
      expect(b).toMatchObject({ status: 'CANCELLED', closeReason: 'CREDITOR_LEFT' });
    });

    it('hủy yêu cầu thanh toán đang chờ có người bị xóa', async () => {
      const h = await house4();
      await debt(h.houseId, h.H, h.Q, 100_000);
      await fx.as(h.Q.token).post(url(h.houseId, '/settlements'), { toUserId: h.H.id, amount: 100_000 }).expect(201);
      await kick(h.H.token, h.houseId, h.Q.id, { mode: 'WRITE_OFF' }).expect(200);
      const pending = await fx.prisma.settlement.count({ where: { houseId: h.houseId, status: 'PENDING' } });
      expect(pending).toBe(0);
    });

    it('trưởng phòng bấm xóa 2 lần cùng lúc: chỉ một lần điều chỉnh số dư', async () => {
      const h = await house4();
      await debt(h.houseId, h.H, h.Q, 120_000);
      const results = await Promise.all([1, 2].map(() => kick(h.H.token, h.houseId, h.Q.id, { mode: 'WRITE_OFF' })));
      expect(results.map((r) => r.status).sort((a, b) => a - b)).toEqual([200, 404]);
      expect(await fx.prisma.balanceAdjustment.count({ where: { houseId: h.houseId } })).toBe(1);
    });
  });

  describe('POST /transfer-admin', () => {
    it('trưởng phòng chuyển quyền: hai vai đổi cho nhau, người cũ mất quyền trưởng phòng', async () => {
      const h = await house4();
      await fx.as(h.H.token).post(url(h.houseId, '/transfer-admin'), { userId: h.T.id }).expect(200);
      const roles = Object.fromEntries(
        (await fx.prisma.houseMember.findMany({ where: { houseId: h.houseId, leftAt: null } })).map((m) => [m.userId, m.role]),
      );
      expect(roles[h.T.id]).toBe('ADMIN');
      expect(roles[h.H.id]).toBe('ROOMMATE');
      await fx.as(h.H.token).patch(url(h.houseId), { name: 'Đổi tên' }).expect(403);
    });

    it('thành viên thường 403; chuyển cho chính mình 400; người ngoài nhà 404', async () => {
      const h = await house4();
      await fx.as(h.T.token).post(url(h.houseId, '/transfer-admin'), { userId: h.M.id }).expect(403);
      await fx.as(h.H.token).post(url(h.houseId, '/transfer-admin'), { userId: h.H.id }).expect(400);
      const outsider = await fx.user('Người lạ');
      await fx.as(h.H.token).post(url(h.houseId, '/transfer-admin'), { userId: outsider.id }).expect(404);
    });
  });
});
