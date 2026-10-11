import { BadGatewayException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { vi } from 'vitest';
import { EventsService } from '../src/modules/events/events.service.js';
import { CloudinaryService } from '../src/modules/uploads/cloudinary.service.js';
import { createFixture } from './support/house-fixture.js';

const PNG_HEAD = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const png = (size = 2048) => Buffer.concat([Buffer.from(PNG_HEAD), Buffer.alloc(size - PNG_HEAD.length)]);
const PROOF_URL = 'https://res.cloudinary.test/proof.png';

describe('Check-in (e2e)', () => {
  const upload = vi.fn();
  let fx: Awaited<ReturnType<typeof createFixture>>;

  beforeAll(async () => {
    fx = await createFixture('@e2e-checkin.nestfair.test', (b) =>
      b.overrideProvider(CloudinaryService).useValue({ upload }),
    );
  });
  beforeEach(() => {
    upload.mockReset();
    upload.mockResolvedValue({ url: PROOF_URL });
  });
  afterEach(() => vi.restoreAllMocks());
  afterAll(() => fx.cleanup());

  /** Nhà 2 người; ca của Thiện (users[1]) còn 2 ngày mới tới hạn. */
  async function setup(over: Record<string, unknown> = {}) {
    const house = await fx.houseWith(['Hùng', 'Thiện']);
    const chore = await fx.prisma.chore.create({
      data: { houseId: house.houseId, title: 'Đổ rác', weight: 2 },
    });
    const assignment = await fx.prisma.choreAssignment.create({
      data: {
        houseId: house.houseId,
        choreId: chore.id,
        assigneeId: house.memberId(house.users[1]),
        originalAssigneeId: house.memberId(house.users[1]),
        weekKey: '2026-W41',
        dueAt: new Date(Date.now() + 2 * 86_400_000),
        source: 'AUTO',
        ...over,
      },
    });
    return { ...house, assignment };
  }
  const checkin = (token: string, id: string, file?: { buf: Buffer; type: string }) => {
    const req = fx.http().post(`/api/v1/assignments/${id}/checkin`).set('Authorization', `Bearer ${token}`);
    return file ? req.attach('photo', file.buf, { filename: 'proof', contentType: file.type }) : req;
  };
  const okFile = { buf: png(), type: 'image/png' };

  it('người được giao check-in → PENDING_VERIFY, lưu ảnh, emit chore:submitted', async () => {
    const { users, assignment, houseId } = await setup();
    const emit = vi.spyOn(fx.app.get(EventsService), 'emitToHouse');
    const res = await checkin(users[1].token, assignment.id, okFile).expect(200);
    expect(res.body).toMatchObject({ id: assignment.id, status: 'PENDING_VERIFY', proofImageUrl: PROOF_URL });
    expect(res.body.submittedAt).toBeTruthy();
    expect(upload).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith(houseId, 'chore:submitted', expect.objectContaining({ assignmentId: assignment.id }));
  });

  it('không có file / gif / giả MIME / quá 5MB → 400 và không gọi upload', async () => {
    const { users, assignment } = await setup();
    const t = users[1].token;
    await checkin(t, assignment.id).expect(400);
    await checkin(t, assignment.id, { buf: Buffer.from('GIF89a....'), type: 'image/gif' }).expect(400);
    await checkin(t, assignment.id, { buf: Buffer.from('not an image'), type: 'image/png' }).expect(400);
    await checkin(t, assignment.id, { buf: png(5 * 1024 * 1024 + 1), type: 'image/png' }).expect(400);
    expect(upload).not.toHaveBeenCalled();
    const row = await fx.prisma.choreAssignment.findUniqueOrThrow({ where: { id: assignment.id } });
    expect(row.status).toBe('TODO');
  });

  it('thành viên khác check-in ca không phải của mình → 403', async () => {
    const { users, assignment } = await setup();
    await checkin(users[0].token, assignment.id, okFile).expect(403);
  });

  it('người nhà khác → 403; id không tồn tại → 404', async () => {
    const { assignment } = await setup();
    const outsider = await fx.user('Người lạ');
    await checkin(outsider.token, assignment.id, okFile).expect(403);
    await checkin(outsider.token, randomUUID(), okFile).expect(404);
    await checkin(outsider.token, 'not-a-uuid', okFile).expect(404);
  });

  it('ca đã PENDING_VERIFY / DONE → 409', async () => {
    for (const status of ['PENDING_VERIFY', 'DONE'] as const) {
      const { users, assignment } = await setup({ status });
      await checkin(users[1].token, assignment.id, okFile).expect(409);
    }
  });

  it('quá hạn → 409', async () => {
    const { users, assignment } = await setup({ dueAt: new Date(Date.now() - 1000) });
    await checkin(users[1].token, assignment.id, okFile).expect(409);
  });

  it('ca REJECTED check-in lại được và xóa lý do từ chối', async () => {
    const { users, assignment } = await setup({ status: 'REJECTED', rejectReason: 'Ảnh mờ' });
    const res = await checkin(users[1].token, assignment.id, okFile).expect(200);
    expect(res.body).toMatchObject({ status: 'PENDING_VERIFY', rejectReason: null });
  });

  it('upload lỗi → 502 và ca vẫn TODO', async () => {
    upload.mockRejectedValue(new BadGatewayException('Không tải được ảnh lên, thử lại sau ít phút.'));
    const { users, assignment } = await setup();
    await checkin(users[1].token, assignment.id, okFile).expect(502);
    const row = await fx.prisma.choreAssignment.findUniqueOrThrow({ where: { id: assignment.id } });
    expect(row.status).toBe('TODO');
  });

  it('bấm đúp: hai request song song → một 200, một 409', async () => {
    const { users, assignment } = await setup();
    const codes = (
      await Promise.all([
        checkin(users[1].token, assignment.id, okFile),
        checkin(users[1].token, assignment.id, okFile),
      ])
    )
      .map((r) => r.status)
      .sort((a, b) => a - b);
    expect(codes).toEqual([200, 409]);
  });
});
