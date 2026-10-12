import { BadGatewayException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { vi } from 'vitest';
import { EventsService } from '../src/modules/events/events.service.js';
import { CloudinaryService } from '../src/modules/uploads/cloudinary.service.js';
import { sha256 } from '../src/modules/uploads/image-validation.js';
import { addDays } from '../src/modules/chores/week.js';
import { assignmentIn, HOUR, makeAssignment, png, today } from './support/assignment-fixture.js';
import { createFixture } from './support/house-fixture.js';

describe('Check-in (e2e)', () => {
  const upload = vi.fn();
  const destroy = vi.fn();
  let fx: Awaited<ReturnType<typeof createFixture>>;
  let seq = 0;

  beforeAll(async () => {
    fx = await createFixture('@e2e-checkin.nestfair.test', (b) => b.overrideProvider(CloudinaryService).useValue({ upload, destroy }));
  });
  beforeEach(() => {
    upload.mockReset();
    destroy.mockReset();
    upload.mockImplementation(async () => ({ url: `https://res.cloudinary.test/p${++seq}.png`, publicId: `p${seq}` }));
  });
  afterEach(() => vi.restoreAllMocks());
  afterAll(() => fx.cleanup());

  const checkin = (token: string, id: string, file?: { buf: Buffer; type: string }, key?: string) => {
    let req = fx.http().post(`/api/v1/assignments/${id}/checkin`).set('Authorization', `Bearer ${token}`);
    if (key) req = req.set('Idempotency-Key', key);
    return file ? req.attach('photo', file.buf, { filename: 'proof', contentType: file.type }) : req;
  };
  const ok = () => ({ buf: png(), type: 'image/png' });
  const row = (id: string) => fx.prisma.choreAssignment.findUniqueOrThrow({ where: { id } });

  it('người được giao check-in → PENDING_VERIFY, lưu ảnh + băm, thư mục theo nhà, emit chore:submitted', async () => {
    const { users, assignment, houseId } = await assignmentIn(fx, ['Hùng', 'Thiện']);
    const emit = vi.spyOn(fx.app.get(EventsService), 'emitToHouse');
    const file = ok();
    const res = await checkin(users[1].token, assignment.id, file).expect(200);
    expect(res.body).toMatchObject({ id: assignment.id, status: 'PENDING_VERIFY', isLate: false, verifyMode: null });
    expect(res.body.proofImageUrl).toMatch(/^https:\/\/res\.cloudinary\.test\//);
    const saved = await row(assignment.id);
    expect(saved.proofHash).toBe(sha256(file.buf));
    expect(saved.submittedAt).toBeTruthy();
    expect(upload).toHaveBeenCalledWith(expect.any(Buffer), `houses/${houseId}/proofs`);
    expect(emit).toHaveBeenCalledWith(houseId, 'chore:submitted', expect.objectContaining({ assignmentId: assignment.id }));
  });

  it('T-13: không có file → 400 PROOF_REQUIRED; gif / giả MIME → 415; quá 5MB → 413 — không gọi upload', async () => {
    const { users, assignment } = await assignmentIn(fx, ['Hùng', 'Thiện']);
    const t = users[1].token;
    expect((await checkin(t, assignment.id).expect(400)).body).toMatchObject({ code: 'PROOF_REQUIRED' });
    expect((await checkin(t, assignment.id, { buf: Buffer.from('GIF89a....'), type: 'image/gif' }).expect(415)).body).toMatchObject({ code: 'UNSUPPORTED_IMAGE' });
    await checkin(t, assignment.id, { buf: Buffer.from('not an image'), type: 'image/png' }).expect(415);
    expect((await checkin(t, assignment.id, { buf: png(5 * 1024 * 1024 + 1), type: 'image/png' }).expect(413)).body).toMatchObject({ code: 'IMAGE_TOO_LARGE' });
    expect(upload).not.toHaveBeenCalled();
    expect((await row(assignment.id)).status).toBe('TODO');
  });

  it('S-72: người khác trong nhà nộp ca không phải của mình → 403 NOT_ASSIGNEE', async () => {
    const { users, assignment } = await assignmentIn(fx, ['Hùng', 'Thiện']);
    const res = await checkin(users[0].token, assignment.id, ok()).expect(403);
    expect(res.body).toMatchObject({ code: 'NOT_ASSIGNEE', statusCode: 403 });
  });

  it('S-70/S-71: người nhà khác hoặc id lạ → 404; thành viên đã rời nhà → 403', async () => {
    const { users, assignment, memberId } = await assignmentIn(fx, ['Hùng', 'Thiện', 'Mai']);
    const outsider = await fx.user('Người lạ');
    await checkin(outsider.token, assignment.id, ok()).expect(404);
    await checkin(outsider.token, randomUUID(), ok()).expect(404);
    await checkin(outsider.token, 'not-a-uuid', ok()).expect(404);
    await fx.prisma.houseMember.update({ where: { id: memberId(users[2]) }, data: { leftAt: new Date() } });
    await checkin(users[2].token, assignment.id, ok()).expect(403);
  });

  it('ca đã nộp / đã xong / đã hủy / quá hạn / chưa có người → 409 ASSIGNMENT_STATE_CHANGED', async () => {
    for (const status of ['PENDING_VERIFY', 'DONE', 'CANCELLED', 'MISSED'] as const) {
      const { users, assignment } = await assignmentIn(fx, ['Hùng', 'Thiện'], { status });
      const res = await checkin(users[1].token, assignment.id, ok()).expect(409);
      expect(res.body).toMatchObject({ code: 'ASSIGNMENT_STATE_CHANGED' });
    }
  });

  it('S-59: chưa tới ngày làm → 422 CHECKIN_NOT_OPEN', async () => {
    const { users, assignment } = await assignmentIn(fx, ['Hùng', 'Thiện'], { occurrenceDate: addDays(today(), 2) });
    const res = await checkin(users[1].token, assignment.id, ok()).expect(422);
    expect(res.body).toMatchObject({ code: 'CHECKIN_NOT_OPEN' });
    expect(upload).not.toHaveBeenCalled();
  });

  it('S-60: nộp trong ân hạn → isLate; quá ân hạn → 422 CHECKIN_WINDOW_CLOSED; ân hạn theo cài đặt nhà', async () => {
    const late = await assignmentIn(fx, ['Hùng', 'Thiện'], { dueAt: new Date(Date.now() - 1 * HOUR) });
    const r1 = await checkin(late.users[1].token, late.assignment.id, ok()).expect(200);
    expect(r1.body.isLate).toBe(true);

    const closed = await assignmentIn(fx, ['Hùng', 'Thiện'], { dueAt: new Date(Date.now() - 4 * HOUR) });
    const r2 = await checkin(closed.users[1].token, closed.assignment.id, ok()).expect(422);
    expect(r2.body).toMatchObject({ code: 'CHECKIN_WINDOW_CLOSED' });

    const tight = await assignmentIn(fx, ['Hùng', 'Thiện'], { dueAt: new Date(Date.now() - 2 * HOUR) });
    await fx.prisma.house.update({ where: { id: tight.houseId }, data: { choreGraceHours: 1 } });
    await checkin(tight.users[1].token, tight.assignment.id, ok()).expect(422);
    await fx.prisma.house.update({ where: { id: tight.houseId }, data: { choreGraceHours: 3 } });
    await checkin(tight.users[1].token, tight.assignment.id, ok()).expect(200);
  });

  it('S-53: ảnh trùng ảnh đã nộp trong nhà (30 ngày) → 409 PROOF_DUPLICATE; quá 30 ngày thì được', async () => {
    const h = await assignmentIn(fx, ['Hùng', 'Thiện', 'Mai']);
    const second = await makeAssignment(fx, h, { assignee: 2 }, { title: 'Lau nhà' });
    const file = ok();
    await checkin(h.users[1].token, h.assignment.id, file).expect(200);
    upload.mockClear();
    const dup = await checkin(h.users[2].token, second.id, file).expect(409);
    expect(dup.body).toMatchObject({ code: 'PROOF_DUPLICATE' });
    expect(upload).not.toHaveBeenCalled();

    await fx.prisma.choreAssignment.update({ where: { id: h.assignment.id }, data: { submittedAt: new Date(Date.now() - 31 * 24 * HOUR) } });
    await checkin(h.users[2].token, second.id, file).expect(200);
  });

  it('S-55: ca bị từ chối nộp lại được; đã disputed thì 409 ASSIGNMENT_DISPUTED', async () => {
    const a = await assignmentIn(fx, ['Hùng', 'Thiện'], { status: 'REJECTED', rejectReason: 'Ảnh mờ', rejectCount: 1 });
    const res = await checkin(a.users[1].token, a.assignment.id, ok()).expect(200);
    expect(res.body).toMatchObject({ status: 'PENDING_VERIFY', rejectReason: null, rejectCount: 1 });

    const d = await assignmentIn(fx, ['Hùng', 'Thiện'], { status: 'REJECTED', rejectCount: 3, disputed: true });
    expect((await checkin(d.users[1].token, d.assignment.id, ok()).expect(409)).body).toMatchObject({ code: 'ASSIGNMENT_DISPUTED' });
  });

  it('S-57: cùng Idempotency-Key nộp lại ca đã nộp → 200 trả ca cũ, không upload lần hai', async () => {
    const { users, assignment } = await assignmentIn(fx, ['Hùng', 'Thiện']);
    const file = ok();
    const first = await checkin(users[1].token, assignment.id, file, 'key-1').expect(200);
    upload.mockClear();
    const retry = await checkin(users[1].token, assignment.id, file, 'key-1').expect(200);
    expect(retry.body.proofImageUrl).toBe(first.body.proofImageUrl);
    expect(upload).not.toHaveBeenCalled();
    // Khác key thì là lần nộp mới → ca không còn ở trạng thái chờ làm.
    await checkin(users[1].token, assignment.id, ok(), 'key-2').expect(409);
  });

  it('S-57: hai request cùng key chạy song song → cả hai 200, chỉ một ảnh được giữ, ảnh thừa bị xóa', async () => {
    const { users, assignment } = await assignmentIn(fx, ['Hùng', 'Thiện']);
    const file = ok();
    const [a, b] = await Promise.all([checkin(users[1].token, assignment.id, file, 'same'), checkin(users[1].token, assignment.id, file, 'same')]);
    expect([a.status, b.status]).toEqual([200, 200]);
    const saved = await row(assignment.id);
    expect(saved.status).toBe('PENDING_VERIFY');
    expect(upload.mock.calls.length - destroy.mock.calls.length).toBe(1);
    for (const call of destroy.mock.calls) expect(saved.proofImageUrl).not.toContain(call[0] as string);
  });

  it('bấm đúp không có key: một request 200, một 409; ảnh của request thua được xóa', async () => {
    const { users, assignment } = await assignmentIn(fx, ['Hùng', 'Thiện']);
    const codes = (await Promise.all([checkin(users[1].token, assignment.id, ok()), checkin(users[1].token, assignment.id, ok())])).map((r) => r.status).sort((x, y) => x - y);
    expect(codes).toEqual([200, 409]);
    expect(upload.mock.calls.length - destroy.mock.calls.length).toBe(1);
  });

  it('upload lỗi → 502, ca vẫn TODO, không xóa gì', async () => {
    upload.mockRejectedValue(new BadGatewayException('Không tải được ảnh lên, thử lại sau ít phút.'));
    const { users, assignment } = await assignmentIn(fx, ['Hùng', 'Thiện']);
    await checkin(users[1].token, assignment.id, ok()).expect(502);
    expect((await row(assignment.id)).status).toBe('TODO');
    expect(destroy).not.toHaveBeenCalled();
  });

  it('DB lỗi sau khi upload → xóa ảnh vừa up (không để ảnh mồ côi), ca vẫn TODO', async () => {
    const { users, assignment } = await assignmentIn(fx, ['Hùng', 'Thiện']);
    vi.spyOn(fx.prisma.choreAssignment, 'updateMany').mockRejectedValueOnce(new Error('db down'));
    await checkin(users[1].token, assignment.id, ok()).expect(500);
    expect(destroy).toHaveBeenCalledTimes(1);
    expect((await row(assignment.id)).status).toBe('TODO');
  });

  it('S-01 / T-03: nhà chỉ còn một người → DONE ngay với verifyMode SELF_ATTESTED (vẫn bắt buộc ảnh)', async () => {
    const { users, assignment } = await assignmentIn(fx, ['Hùng'], { assignee: 0 });
    const res = await checkin(users[0].token, assignment.id, ok()).expect(200);
    expect(res.body).toMatchObject({ status: 'DONE', verifyMode: 'SELF_ATTESTED' });
    expect(res.body.proofImageUrl).toBeTruthy();
  });

  it('S-51: những người còn lại đã rời nhà → cũng SELF_ATTESTED', async () => {
    const { users, assignment, memberId } = await assignmentIn(fx, ['Hùng', 'Thiện']);
    await fx.prisma.houseMember.update({ where: { id: memberId(users[0]) }, data: { leftAt: new Date() } });
    const res = await checkin(users[1].token, assignment.id, ok()).expect(200);
    expect(res.body).toMatchObject({ status: 'DONE', verifyMode: 'SELF_ATTESTED' });
  });
});
