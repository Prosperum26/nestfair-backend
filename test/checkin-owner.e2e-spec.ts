import { randomUUID } from 'node:crypto';
import { vi } from 'vitest';
import { HOUR, makeAssignment, png } from './support/assignment-fixture.js';
import { createFixture } from './support/house-fixture.js';
import { CloudinaryService } from '../src/modules/uploads/cloudinary.service.js';

/** B4: chủ ca được kiểm trước bước upload ảnh (vài giây); trong lúc đó ca có thể đã chuyển cho người khác. */
describe('Check-in và chủ ca (e2e)', () => {
  const destroy = vi.fn();
  /** Việc chạy giữa lúc upload ảnh (mô phỏng người khác nhận ca trong lúc ảnh đang lên). */
  let duringUpload: (() => Promise<void>) | null = null;
  let fx: Awaited<ReturnType<typeof createFixture>>;

  beforeAll(async () => {
    fx = await createFixture('@e2e-checkin-owner.nestfair.test', (b) =>
      b.overrideProvider(CloudinaryService).useValue({
        upload: vi.fn(async () => {
          await duringUpload?.();
          return { url: 'https://res.cloudinary.test/p.jpg', publicId: 'proof-1' };
        }),
        destroy,
      }),
    );
  });
  beforeEach(() => {
    destroy.mockReset();
    duringUpload = null;
  });
  afterAll(() => fx.cleanup());

  const photo = (token: string, id: string) => fx.as(token).post(`/api/v1/assignments/${id}/checkin`).attach('photo', png(), { filename: 'p.png', contentType: 'image/png' });

  it('ca chuyển sang người khác trong lúc upload: check-in bị 409, ảnh không ghi vào ca của người mới, ảnh vừa upload bị xóa', async () => {
    const h = await fx.houseWith(['Hùng', 'Thiện', 'Mai']);
    const slot = await makeAssignment(fx, h, { assignee: 1, dueAt: new Date(Date.now() + 48 * HOUR) });
    const created = await fx
      .as(h.users[1].token)
      .post(`/api/v1/houses/${h.houseId}/swaps`, { type: 'COVER', fromAssignmentId: slot.id, compensation: 'GIFT', targetMemberId: h.memberId(h.users[2]), acknowledgedWarnings: [] })
      .set('Idempotency-Key', randomUUID())
      .expect(201);
    // Thiện đang upload ảnh thì Mai nhận ca.
    duringUpload = async () => {
      await fx.as(h.users[2].token).patch(`/api/v1/swaps/${created.body.id}/accept`).set('Idempotency-Key', randomUUID()).expect(200);
    };

    const res = await photo(h.users[1].token, slot.id).expect(409);
    expect(res.body.code).toBe('ASSIGNMENT_STATE_CHANGED');
    const after = await fx.prisma.choreAssignment.findUniqueOrThrow({ where: { id: slot.id } });
    expect(after).toMatchObject({ assigneeId: h.memberId(h.users[2]), status: 'TODO', proofImageUrl: null, submittedAt: null, source: 'COVER' });
    expect(destroy).toHaveBeenCalledWith('proof-1');
  });

  it('chủ ca vẫn là người nộp thì check-in bình thường', async () => {
    const h = await fx.houseWith(['Hùng', 'Thiện']);
    const slot = await makeAssignment(fx, h, { assignee: 1, dueAt: new Date(Date.now() + 48 * HOUR) });
    await photo(h.users[1].token, slot.id).expect(200);
    expect(await fx.prisma.choreAssignment.findUniqueOrThrow({ where: { id: slot.id } })).toMatchObject({ status: 'PENDING_VERIFY', proofImageUrl: 'https://res.cloudinary.test/p.jpg' });
    expect(destroy).not.toHaveBeenCalled();
  });
});
