import { vi } from 'vitest';
import { EventsService } from '../src/modules/events/events.service.js';
import { CloudinaryService } from '../src/modules/uploads/cloudinary.service.js';
import { assignmentIn, makeAssignment, png } from './support/assignment-fixture.js';
import { createFixture } from './support/house-fixture.js';

describe('Verify, appeal & override (e2e)', () => {
  let fx: Awaited<ReturnType<typeof createFixture>>;
  let seq = 0;

  beforeAll(async () => {
    fx = await createFixture('@e2e-verify.nestfair.test', (b) =>
      b.overrideProvider(CloudinaryService).useValue({
        upload: vi.fn(async () => ({ url: `https://res.cloudinary.test/v${++seq}.png`, publicId: `v${seq}` })),
        destroy: vi.fn(),
      }),
    );
  });
  afterEach(() => vi.restoreAllMocks());
  afterAll(() => fx.cleanup());

  /** Nhà Hùng (ADMIN), Thiện (người làm), Mai; ca của Thiện đang chờ duyệt. */
  const pending = (over: Parameters<typeof assignmentIn>[2] = {}) =>
    assignmentIn(fx, ['Hùng', 'Thiện', 'Mai'], { status: 'PENDING_VERIFY', proofImageUrl: 'https://res.cloudinary.test/p.png', submittedAt: new Date(), ...over });
  const verify = (token: string, id: string, body: object) => fx.as(token).patch(`/api/v1/assignments/${id}/verify`, body);
  const appeal = (token: string, id: string) => fx.as(token).post(`/api/v1/assignments/${id}/appeal`, {});
  const override = (token: string, id: string, body: object) => fx.as(token).patch(`/api/v1/assignments/${id}/override`, body);
  const row = (id: string) => fx.prisma.choreAssignment.findUniqueOrThrow({ where: { id } });
  const audit = (houseId: string) => fx.prisma.choreAuditLog.findMany({ where: { houseId }, orderBy: { createdAt: 'asc' } });

  describe('verify', () => {
    it('thành viên khác APPROVED → DONE, verifyMode PEER, ghi người duyệt, emit chore:verified', async () => {
      const { users, assignment, houseId, memberId } = await pending();
      const emit = vi.spyOn(fx.app.get(EventsService), 'emitToHouse');
      const res = await verify(users[0].token, assignment.id, { decision: 'APPROVED' }).expect(200);
      expect(res.body).toMatchObject({ status: 'DONE', verifyMode: 'PEER', verifiedById: memberId(users[0]), rejectReason: null });
      expect(res.body.verifiedAt).toBeTruthy();
      expect(emit).toHaveBeenCalledWith(houseId, 'chore:verified', expect.objectContaining({ assignmentId: assignment.id, status: 'DONE', verifyMode: 'PEER' }));
    });

    it('REJECTED kèm lý do → REJECTED, rejectCount tăng; người làm nộp lại được', async () => {
      const { users, assignment } = await pending();
      const res = await verify(users[2].token, assignment.id, { decision: 'REJECTED', reason: '  Ảnh bị mờ ' }).expect(200);
      expect(res.body).toMatchObject({ status: 'REJECTED', rejectReason: 'Ảnh bị mờ', rejectCount: 1, disputed: false });
      const again = await fx
        .http()
        .post(`/api/v1/assignments/${assignment.id}/checkin`)
        .set('Authorization', `Bearer ${users[1].token}`)
        .attach('photo', png(), { filename: 'a.png', contentType: 'image/png' })
        .expect(200);
      expect(again.body.status).toBe('PENDING_VERIFY');
    });

    it('S-55: bị từ chối lần thứ 3 → disputed, chỉ Admin quyết', async () => {
      const { users, assignment } = await pending({ rejectCount: 2 });
      const res = await verify(users[0].token, assignment.id, { decision: 'REJECTED', reason: 'Vẫn chưa sạch' }).expect(200);
      expect(res.body).toMatchObject({ rejectCount: 3, disputed: true, status: 'REJECTED' });
    });

    it('S-73: tự duyệt ca của mình → 403 SELF_VERIFY_FORBIDDEN, kể cả Admin là người làm', async () => {
      const a = await pending();
      const res = await verify(a.users[1].token, a.assignment.id, { decision: 'APPROVED' }).expect(403);
      expect(res.body).toMatchObject({ code: 'SELF_VERIFY_FORBIDDEN' });
      const adminOwn = await pending({ assignee: 0 });
      await verify(adminOwn.users[0].token, adminOwn.assignment.id, { decision: 'APPROVED' }).expect(403);
      expect((await row(adminOwn.assignment.id)).status).toBe('PENDING_VERIFY');
    });

    it('ca chưa nộp / đã xong / quá hạn → 409 ASSIGNMENT_STATE_CHANGED', async () => {
      for (const status of ['TODO', 'DONE', 'MISSED', 'CANCELLED'] as const) {
        const { users, assignment } = await pending({ status });
        const res = await verify(users[0].token, assignment.id, { decision: 'APPROVED' }).expect(409);
        expect(res.body).toMatchObject({ code: 'ASSIGNMENT_STATE_CHANGED' });
      }
    });

    it('body sai: thiếu/ lạ decision, REJECTED thiếu lý do, lý do < 5 hoặc > 200 ký tự → 400', async () => {
      const { users, assignment } = await pending();
      const t = users[0].token;
      await verify(t, assignment.id, {}).expect(400);
      await verify(t, assignment.id, { decision: 'APPROVE' }).expect(400);
      await verify(t, assignment.id, { decision: 'MAYBE' }).expect(400);
      await verify(t, assignment.id, { decision: 'REJECTED' }).expect(400);
      await verify(t, assignment.id, { decision: 'REJECTED', reason: '    ' }).expect(400);
      await verify(t, assignment.id, { decision: 'REJECTED', reason: 'mờ' }).expect(400);
      await verify(t, assignment.id, { decision: 'REJECTED', reason: 'x'.repeat(201) }).expect(400);
      await verify(t, assignment.id, { decision: 'REJECTED', reason: 'đủ năm' }).expect(200);
    });

    it('người nhà khác → 404; thành viên đã rời nhà → 403', async () => {
      const { users, assignment, memberId } = await pending();
      const outsider = await fx.user('Người lạ');
      await verify(outsider.token, assignment.id, { decision: 'APPROVED' }).expect(404);
      await fx.prisma.houseMember.update({ where: { id: memberId(users[2]) }, data: { leftAt: new Date() } });
      await verify(users[2].token, assignment.id, { decision: 'APPROVED' }).expect(403);
    });

    it('S-52 / T-14: hai người duyệt/từ chối cùng lúc → đúng một 200, người sau 409', async () => {
      const { users, assignment } = await pending();
      const codes = (
        await Promise.all([
          verify(users[0].token, assignment.id, { decision: 'APPROVED' }),
          verify(users[2].token, assignment.id, { decision: 'REJECTED', reason: 'Chưa sạch' }),
        ])
      )
        .map((r) => r.status)
        .sort((a, b) => a - b);
      expect(codes).toEqual([200, 409]);
    });
  });

  describe('appeal', () => {
    it('người làm khiếu nại ca bị từ chối → disputed, ghi audit', async () => {
      const { users, assignment, houseId } = await pending({ status: 'REJECTED', rejectCount: 1 });
      const res = await appeal(users[1].token, assignment.id).expect(201);
      expect(res.body).toMatchObject({ status: 'REJECTED', disputed: true });
      expect((await audit(houseId)).map((l) => l.action)).toContain('APPEAL');
      await appeal(users[1].token, assignment.id).expect(201); // idempotent
    });

    it('không phải người làm → 403 NOT_ASSIGNEE; ca không bị từ chối → 409', async () => {
      const a = await pending({ status: 'REJECTED' });
      expect((await appeal(a.users[2].token, a.assignment.id).expect(403)).body).toMatchObject({ code: 'NOT_ASSIGNEE' });
      const b = await pending();
      await appeal(b.users[1].token, b.assignment.id).expect(409);
    });
  });

  describe('override (Admin)', () => {
    const REASON = 'Đã xem xét lại ảnh minh chứng';

    it('thành viên thường → 403 ADMIN_ONLY', async () => {
      const { users, assignment } = await pending();
      const res = await override(users[2].token, assignment.id, { action: 'FORCE_DONE', reason: REASON }).expect(403);
      expect(res.body).toMatchObject({ code: 'ADMIN_ONLY' });
    });

    it('S-56: FORCE_DONE khôi phục ca MISSED và giải quyết ca disputed; ghi audit', async () => {
      const missed = await pending({ status: 'MISSED' });
      const r1 = await override(missed.users[0].token, missed.assignment.id, { action: 'FORCE_DONE', reason: REASON }).expect(200);
      expect(r1.body).toMatchObject({ status: 'DONE', verifyMode: 'ADMIN_OVERRIDE', disputed: false });
      const logs = await audit(missed.houseId);
      expect(logs.find((l) => l.action === 'OVERRIDE_FORCE_DONE')).toMatchObject({ assignmentId: missed.assignment.id });

      const disputed = await pending({ status: 'REJECTED', rejectCount: 3, disputed: true });
      const r2 = await override(disputed.users[0].token, disputed.assignment.id, { action: 'FORCE_DONE', reason: REASON }).expect(200);
      expect(r2.body).toMatchObject({ status: 'DONE', disputed: false });
    });

    it('Admin không FORCE_DONE được ca của chính mình (chống tự duyệt vòng)', async () => {
      const { users, assignment } = await pending({ assignee: 0, status: 'MISSED' });
      const res = await override(users[0].token, assignment.id, { action: 'FORCE_DONE', reason: REASON }).expect(403);
      expect(res.body).toMatchObject({ code: 'SELF_VERIFY_FORBIDDEN' });
    });

    it('FORCE_REJECT một ca đang chờ duyệt → REJECTED kèm lý do', async () => {
      const { users, assignment } = await pending();
      const res = await override(users[0].token, assignment.id, { action: 'FORCE_REJECT', reason: REASON }).expect(200);
      expect(res.body).toMatchObject({ status: 'REJECTED', rejectReason: REASON, rejectCount: 1, disputed: false });
    });

    it('REASSIGN giao ca cho người khác (theo userId): TODO, nguồn REASSIGN, giữ originalAssigneeId; cần userId hợp lệ', async () => {
      const { users, assignment, memberId } = await pending({ status: 'MISSED' });
      await override(users[0].token, assignment.id, { action: 'REASSIGN', reason: REASON }).expect(400);
      const outsider = await fx.user('Người lạ');
      const bad = await override(users[0].token, assignment.id, { action: 'REASSIGN', reason: REASON, userId: outsider.id }).expect(400);
      expect(bad.body).toMatchObject({ code: 'NOT_ELIGIBLE_ASSIGNEE' });

      const res = await override(users[0].token, assignment.id, { action: 'REASSIGN', reason: REASON, userId: users[2].id }).expect(200);
      expect(res.body).toMatchObject({ status: 'TODO', source: 'REASSIGN', assigneeId: memberId(users[2]), assigneeUserId: users[2].id, originalAssigneeId: memberId(users[1]), proofImageUrl: null });
    });

    it('REASSIGN cho người đã rời nhà → 400 NOT_ELIGIBLE_ASSIGNEE', async () => {
      const { users, assignment, memberId } = await pending({ status: 'MISSED' });
      await fx.prisma.houseMember.update({ where: { id: memberId(users[2]) }, data: { leftAt: new Date() } });
      await override(users[0].token, assignment.id, { action: 'REASSIGN', reason: REASON, userId: users[2].id }).expect(400);
    });

    it('CANCEL hủy ca chưa xong; không hủy được ca đã DONE (409)', async () => {
      const a = await pending({ status: 'TODO' });
      expect((await override(a.users[0].token, a.assignment.id, { action: 'CANCEL', reason: REASON }).expect(200)).body.status).toBe('CANCELLED');
      const b = await pending({ status: 'DONE' });
      expect((await override(b.users[0].token, b.assignment.id, { action: 'CANCEL', reason: REASON }).expect(409)).body).toMatchObject({ code: 'ASSIGNMENT_STATE_CHANGED' });
    });

    it('body sai: action lạ, lý do < 5 ký tự → 400', async () => {
      const { users, assignment } = await pending();
      await override(users[0].token, assignment.id, { action: 'NUKE', reason: REASON }).expect(400);
      await override(users[0].token, assignment.id, { action: 'FORCE_DONE', reason: 'ngắn' }).expect(400);
      await override(users[0].token, assignment.id, { action: 'FORCE_DONE' }).expect(400);
    });

    it('ca của nhà khác → 404', async () => {
      const a = await pending();
      const b = await makeAssignment(fx, await fx.houseWith(['Mai', 'Quân']), { assignee: 1 });
      await override(a.users[0].token, b.id, { action: 'CANCEL', reason: REASON }).expect(404);
    });
  });
});
