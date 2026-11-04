import { randomUUID } from 'node:crypto';
import { vi } from 'vitest';
import { addDays, toDateStr } from '../src/modules/chores/week.js';
import { ChoreCronService } from '../src/modules/scheduler/chore-cron.service.js';
import { WheelService } from '../src/modules/wheel/wheel.service.js';
import { CloudinaryService } from '../src/modules/uploads/cloudinary.service.js';
import { HOUR, makeAssignment, png } from './support/assignment-fixture.js';
import { createFixture } from './support/house-fixture.js';

type Fx = Awaited<ReturnType<typeof createFixture>>;
type House = Awaited<ReturnType<Fx['houseWith']>>;

/** `ChoreAssignment.version` là khóa lạc quan (spec 3.1): phải tăng ở mọi nơi đổi người hoặc đổi trạng thái ca. */
describe('ChoreAssignment.version (e2e)', () => {
  let fx: Fx;
  let cron: ChoreCronService;

  beforeAll(async () => {
    fx = await createFixture('@e2e-assignment-version.nestfair.test', (b) =>
      b.overrideProvider(CloudinaryService).useValue({ upload: vi.fn().mockResolvedValue({ url: 'https://res.cloudinary.test/p.jpg', publicId: 'p' }), destroy: vi.fn() }),
    );
    cron = fx.app.get(ChoreCronService);
  });
  afterAll(() => fx.cleanup());

  const inDays = (n: number) => new Date(Date.now() + n * 24 * HOUR);
  const version = async (id: string) => (await fx.prisma.choreAssignment.findUniqueOrThrow({ where: { id } })).version;
  const override = (h: House, id: string, body: object) => fx.as(h.users[0].token).patch(`/api/v1/assignments/${id}/override`, { reason: 'Trưởng phòng can thiệp', ...body });

  /** Hàm này chạy `act` rồi khẳng định version của ca đúng +1. */
  async function bumps(h: House, id: string, act: () => Promise<unknown>) {
    const before = await version(id);
    await act();
    expect(await version(id)).toBe(before + 1);
  }

  it('override: REASSIGN, CANCEL, FORCE_DONE, FORCE_REJECT đều tăng version', async () => {
    const h = await fx.houseWith(['Hùng', 'Thiện', 'Mai']);
    const slot = (over: Parameters<typeof makeAssignment>[2]) => makeAssignment(fx, h, { assignee: 1, dueAt: inDays(3), ...over });
    const reassign = await slot({});
    await bumps(h, reassign.id, () => override(h, reassign.id, { action: 'REASSIGN', userId: h.users[2].id }).expect(200));
    const cancel = await slot({});
    await bumps(h, cancel.id, () => override(h, cancel.id, { action: 'CANCEL' }).expect(200));
    const done = await slot({ status: 'PENDING_VERIFY', submittedAt: new Date() });
    await bumps(h, done.id, () => override(h, done.id, { action: 'FORCE_DONE' }).expect(200));
    const rejected = await slot({ status: 'PENDING_VERIFY', submittedAt: new Date() });
    await bumps(h, rejected.id, () => override(h, rejected.id, { action: 'FORCE_REJECT' }).expect(200));
  });

  it('duyệt (APPROVED và REJECTED) tăng version', async () => {
    const h = await fx.houseWith(['Hùng', 'Thiện']);
    const a = await makeAssignment(fx, h, { assignee: 1, status: 'PENDING_VERIFY', submittedAt: new Date() });
    await bumps(h, a.id, () => fx.as(h.users[0].token).patch(`/api/v1/assignments/${a.id}/verify`, { decision: 'APPROVED' }).expect(200));
    const b = await makeAssignment(fx, h, { assignee: 1, status: 'PENDING_VERIFY', submittedAt: new Date() });
    await bumps(h, b.id, () => fx.as(h.users[0].token).patch(`/api/v1/assignments/${b.id}/verify`, { decision: 'REJECTED', reason: 'Ảnh bị mờ quá' }).expect(200));
  });

  it('check-in tăng version', async () => {
    const h = await fx.houseWith(['Hùng', 'Thiện']);
    const a = await makeAssignment(fx, h, { assignee: 1, dueAt: inDays(2) });
    await bumps(h, a.id, () => fx.as(h.users[1].token).post(`/api/v1/assignments/${a.id}/checkin`).attach('photo', png(), { filename: 'p.png', contentType: 'image/png' }).expect(200));
  });

  it('khai vắng (dời ca cho người khác) tăng version', async () => {
    const h = await fx.houseWith(['Hùng', 'Thiện', 'Mai']);
    const date = addDays(toDateStr(new Date()), 4);
    const a = await makeAssignment(fx, h, { assignee: 1, occurrenceDate: date, dueAt: inDays(4) });
    await bumps(h, a.id, () => fx.as(h.users[1].token).post(`/api/v1/houses/${h.houseId}/absences`, { startDate: date, endDate: date }).expect(201));
    expect((await fx.prisma.choreAssignment.findUniqueOrThrow({ where: { id: a.id } })).assigneeId).not.toBe(h.memberId(h.users[1]));
  });

  it('cron: markMissed và autoApprove tăng version', async () => {
    const h = await fx.houseWith(['Hùng', 'Thiện']);
    const missed = await makeAssignment(fx, h, { assignee: 1, dueAt: new Date(Date.now() - 5 * HOUR) });
    await bumps(h, missed.id, () => cron.markMissed(new Date(), [h.houseId]));
    const auto = await makeAssignment(fx, h, { assignee: 1, status: 'PENDING_VERIFY', submittedAt: new Date(Date.now() - 49 * HOUR) });
    await bumps(h, auto.id, () => cron.autoApprove(new Date(), [h.houseId]));
  });

  it('hủy ca do nghỉ cả nhà tăng version', async () => {
    const h = await fx.houseWith(['Hùng', 'Thiện']);
    const date = addDays(toDateStr(new Date()), 3);
    const a = await makeAssignment(fx, h, { assignee: 1, occurrenceDate: date, dueAt: inDays(3) });
    await bumps(h, a.id, () => fx.as(h.users[0].token).post(`/api/v1/houses/${h.houseId}/breaks`, { startDate: date, endDate: date }).expect(201));
    expect((await fx.prisma.choreAssignment.findUniqueOrThrow({ where: { id: a.id } })).status).toBe('CANCELLED');
  });

  it('tắt việc: ca TODO của việc đó bị hủy và version tăng; yêu cầu đổi ca đang chờ trên ca đó bị 409 SLOT_CHANGED khi accept', async () => {
    const h = await fx.houseWith(['Hùng', 'Thiện', 'Mai']);
    const a = await makeAssignment(fx, h, { assignee: 1, dueAt: inDays(5) });
    const b = await makeAssignment(fx, h, { assignee: 2, dueAt: inDays(5) });
    const created = await fx
      .as(h.users[1].token)
      .post(`/api/v1/houses/${h.houseId}/swaps`, { type: 'EXCHANGE', fromAssignmentId: a.id, toAssignmentId: b.id, acknowledgedWarnings: [] })
      .set('Idempotency-Key', randomUUID())
      .expect(201);

    await bumps(h, a.id, () => fx.as(h.users[0].token).patch(`/api/v1/houses/${h.houseId}/chores/${a.choreId}`, { isActive: false }).expect(200));
    expect((await fx.prisma.choreAssignment.findUniqueOrThrow({ where: { id: a.id } })).status).toBe('CANCELLED');
    const res = await fx.as(h.users[2].token).patch(`/api/v1/swaps/${created.body.id}/accept`).set('Idempotency-Key', randomUUID()).expect(409);
    expect(res.body.code).toBe('SLOT_CHANGED');
  });

  it('hủy vòng quay (void): ca WHEEL bị CANCELLED và version tăng', async () => {
    const h = await fx.houseWith(['Hùng', 'Thiện', 'Mai', 'Quân']);
    const spin = await fx
      .as(h.users[1].token)
      .post(`/api/v1/houses/${h.houseId}/wheel/spin`, { taskTitle: 'Mua nước bình', participantIds: [h.users[2].id, h.users[3].id], dueAt: new Date(Date.now() + 2 * HOUR).toISOString() })
      .set('Idempotency-Key', randomUUID())
      .expect(201);
    await fx.app.get(WheelService).reveal(spin.body.spinId);
    const log = await fx.prisma.luckyWheelLog.findUniqueOrThrow({ where: { id: spin.body.spinId } });
    expect((await fx.prisma.choreAssignment.findUniqueOrThrow({ where: { id: log.assignmentId } })).source).toBe('WHEEL');

    await bumps(h, log.assignmentId, () => fx.as(h.users[0].token).post(`/api/v1/wheel/spins/${spin.body.spinId}/void`, { reason: 'Gõ sai tên việc' }).expect(200));
    expect((await fx.prisma.choreAssignment.findUniqueOrThrow({ where: { id: log.assignmentId } })).status).toBe('CANCELLED');
  });

  it('REASSIGN ca đang có yêu cầu PENDING: accept sau đó bị 409 SLOT_CHANGED và khóa được nhả', async () => {
    const h = await fx.houseWith(['Hùng', 'Thiện', 'Mai']);
    const a = await makeAssignment(fx, h, { assignee: 1, dueAt: inDays(5) });
    const b = await makeAssignment(fx, h, { assignee: 2, dueAt: inDays(5) });
    const created = await fx
      .as(h.users[1].token)
      .post(`/api/v1/houses/${h.houseId}/swaps`, { type: 'EXCHANGE', fromAssignmentId: a.id, toAssignmentId: b.id, acknowledgedWarnings: [] })
      .set('Idempotency-Key', randomUUID())
      .expect(201);

    await override(h, a.id, { action: 'REASSIGN', userId: h.users[0].id }).expect(200);
    const res = await fx.as(h.users[2].token).patch(`/api/v1/swaps/${created.body.id}/accept`).set('Idempotency-Key', randomUUID()).expect(409);
    expect(res.body.code).toBe('SLOT_CHANGED');
    expect(await fx.prisma.swapLock.count({ where: { assignmentId: { in: [a.id, b.id] } } })).toBe(0);
    expect((await fx.prisma.choreSwapRequest.findUniqueOrThrow({ where: { id: created.body.id } })).resolution).toBe('SLOT_CHANGED');
  });
});
