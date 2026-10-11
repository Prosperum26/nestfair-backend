import { vi } from 'vitest';
import { EventsService } from '../src/modules/events/events.service.js';
import { CloudinaryService } from '../src/modules/uploads/cloudinary.service.js';
import { createFixture } from './support/house-fixture.js';

const PNG_HEAD = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

describe('Verify (e2e)', () => {
  let fx: Awaited<ReturnType<typeof createFixture>>;

  beforeAll(async () => {
    fx = await createFixture('@e2e-verify.nestfair.test', (b) =>
      b.overrideProvider(CloudinaryService).useValue({
        upload: vi.fn().mockResolvedValue({ url: 'https://res.cloudinary.test/again.png' }),
      }),
    );
  });
  afterEach(() => vi.restoreAllMocks());
  afterAll(() => fx.cleanup());

  /** Nhà Hùng (ADMIN), Thiện (người làm), Mai; ca của Thiện đang chờ duyệt. */
  async function setup(over: Record<string, unknown> = {}) {
    const house = await fx.houseWith(['Hùng', 'Thiện', 'Mai']);
    const chore = await fx.prisma.chore.create({
      data: { houseId: house.houseId, title: 'Lau nhà', weight: 3 },
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
        status: 'PENDING_VERIFY',
        proofImageUrl: 'https://res.cloudinary.test/p.png',
        submittedAt: new Date(),
        ...over,
      },
    });
    return { ...house, assignment };
  }
  const verify = (token: string, id: string, body: object) =>
    fx.as(token).patch(`/api/v1/assignments/${id}/verify`, body);

  it('thành viên khác APPROVE → DONE, ghi người duyệt, emit chore:verified', async () => {
    const { users, assignment, houseId, memberId } = await setup();
    const emit = vi.spyOn(fx.app.get(EventsService), 'emitToHouse');
    const res = await verify(users[0].token, assignment.id, { decision: 'APPROVE' }).expect(200);
    expect(res.body).toMatchObject({ status: 'DONE', verifiedById: memberId(users[0]), rejectReason: null });
    expect(res.body.verifiedAt).toBeTruthy();
    expect(emit).toHaveBeenCalledWith(
      houseId,
      'chore:verified',
      expect.objectContaining({ assignmentId: assignment.id, status: 'DONE' }),
    );
  });

  it('REJECT kèm lý do → REJECTED, rồi người làm check-in lại được', async () => {
    const { users, assignment } = await setup();
    const res = await verify(users[2].token, assignment.id, { decision: 'REJECT', reason: '  Ảnh bị mờ ' }).expect(200);
    expect(res.body).toMatchObject({ status: 'REJECTED', rejectReason: 'Ảnh bị mờ' });

    const photo = Buffer.concat([Buffer.from(PNG_HEAD), Buffer.alloc(1000)]);
    const again = await fx
      .http()
      .post(`/api/v1/assignments/${assignment.id}/checkin`)
      .set('Authorization', `Bearer ${users[1].token}`)
      .attach('photo', photo, { filename: 'a.png', contentType: 'image/png' })
      .expect(200);
    expect(again.body.status).toBe('PENDING_VERIFY');
  });

  it('không thể tự duyệt ca của chính mình → 403', async () => {
    const { users, assignment } = await setup();
    await verify(users[1].token, assignment.id, { decision: 'APPROVE' }).expect(403);
    const row = await fx.prisma.choreAssignment.findUniqueOrThrow({ where: { id: assignment.id } });
    expect(row.status).toBe('PENDING_VERIFY');
  });

  it('ca chưa nộp (TODO) hoặc đã duyệt xong → 409', async () => {
    for (const status of ['TODO', 'DONE', 'MISSED'] as const) {
      const { users, assignment } = await setup({ status });
      await verify(users[0].token, assignment.id, { decision: 'APPROVE' }).expect(409);
    }
  });

  it('body sai: thiếu decision, decision lạ, REJECT không lý do, lý do quá 200 ký tự → 400', async () => {
    const { users, assignment } = await setup();
    const t = users[0].token;
    await verify(t, assignment.id, {}).expect(400);
    await verify(t, assignment.id, { decision: 'MAYBE' }).expect(400);
    await verify(t, assignment.id, { decision: 'REJECT' }).expect(400);
    await verify(t, assignment.id, { decision: 'REJECT', reason: '   ' }).expect(400);
    await verify(t, assignment.id, { decision: 'REJECT', reason: 'x'.repeat(201) }).expect(400);
  });

  it('người nhà khác hoặc thành viên đã rời nhà → 403', async () => {
    const { users, assignment, memberId } = await setup();
    const outsider = await fx.user('Người lạ');
    await verify(outsider.token, assignment.id, { decision: 'APPROVE' }).expect(403);

    await fx.prisma.houseMember.update({ where: { id: memberId(users[2]) }, data: { leftAt: new Date() } });
    await verify(users[2].token, assignment.id, { decision: 'APPROVE' }).expect(403);
  });

  it('hai người duyệt cùng lúc → một 200, một 409', async () => {
    const { users, assignment } = await setup();
    const codes = (
      await Promise.all([
        verify(users[0].token, assignment.id, { decision: 'APPROVE' }),
        verify(users[2].token, assignment.id, { decision: 'REJECT', reason: 'Chưa sạch' }),
      ])
    )
      .map((r) => r.status)
      .sort((a, b) => a - b);
    expect(codes).toEqual([200, 409]);
  });
});
