import { vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { EventsService } from '../src/modules/events/events.service.js';
import { toDateStr } from '../src/modules/chores/week.js';
import { CloudinaryService } from '../src/modules/uploads/cloudinary.service.js';
import { WheelService } from '../src/modules/wheel/wheel.service.js';
import { dateOf, HOUR, png } from './support/assignment-fixture.js';
import { createFixture } from './support/house-fixture.js';

describe('Lucky Wheel (e2e)', () => {
  let fx: Awaited<ReturnType<typeof createFixture>>;
  let wheel: WheelService;

  beforeAll(async () => {
    fx = await createFixture('@e2e-wheel.nestfair.test', (b) =>
      b.overrideProvider(CloudinaryService).useValue({ upload: vi.fn().mockResolvedValue({ url: 'https://res.cloudinary.test/w.jpg', publicId: 'w' }), destroy: vi.fn() }),
    );
    wheel = fx.app.get(WheelService);
    wheel.durationMs = 400;
  });
  afterEach(() => vi.restoreAllMocks());
  afterAll(() => fx.cleanup());

  const due = (hours = 2) => new Date(Date.now() + hours * HOUR).toISOString();
  const spin = (token: string, houseId: string, body: object, key: string | null = randomUUID()) => {
    const req = fx.as(token).post(`/api/v1/houses/${houseId}/wheel/spin`, body);
    return key ? req.set('Idempotency-Key', key) : req;
  };
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const house4 = () => fx.houseWith(['Hùng', 'Thiện', 'Mai', 'Quân']);

  it('D-2 / D-3: server chọn người trúng, ghi đúng 1 log + 1 ca WHEEL, commit trước khi phát wheel:spinning', async () => {
    const h = await house4();
    const participantIds = [h.users[0].id, h.users[2].id, h.users[3].id];
    let seenInDb: number | null = null;
    const events = fx.app.get(EventsService);
    const original = events.send.bind(events);
    vi.spyOn(events, 'send').mockImplementation((room, env) => {
      if (env.type === 'wheel:spinning') void fx.prisma.luckyWheelLog.count({ where: { houseId: h.houseId } }).then((n) => (seenInDb = n));
      original(room, env);
    });

    const res = await spin(h.users[1].token, h.houseId, { taskTitle: '  Mua   nước bình 20L ', participantIds, dueAt: due() }).expect(201);
    expect(res.body).toMatchObject({ taskTitle: 'Mua nước bình 20L', status: 'SPINNING', winner: null, assignmentId: null, excludedCount: 1 });
    expect(res.body.slices).toHaveLength(9);
    expect(participantIds).toContain(res.body.slices[res.body.landingIndex]);
    expect(new Date(res.body.startAt).getTime() - new Date(res.body.serverNow).getTime()).toBe(300);

    const logs = await fx.prisma.luckyWheelLog.findMany({ where: { houseId: h.houseId } });
    expect(logs).toHaveLength(1);
    const log = logs[0];
    expect(log).toMatchObject({ spunById: h.users[1].id, participantIds, seed: res.body.seed, landingIndex: res.body.landingIndex });
    expect(participantIds).toContain(log.selectedUserId);
    const slot = await fx.prisma.choreAssignment.findUniqueOrThrow({ where: { id: log.assignmentId }, include: { assignee: true, chore: true } });
    expect(slot).toMatchObject({ source: 'WHEEL', status: 'TODO', titleSnapshot: 'Mua nước bình 20L', weightSnapshot: 1 });
    expect(slot.assignee!.userId).toBe(log.selectedUserId);
    expect(slot.chore).toMatchObject({ isSystem: true, title: 'Việc đột xuất', frequency: 'ADHOC' });
    await sleep(50);
    expect(seenInDb).toBe(1);
  });

  it('D-2: gửi kèm winnerId thì 400 (forbidNonWhitelisted)', async () => {
    const h = await house4();
    await spin(h.users[0].token, h.houseId, { taskTitle: 'Đổ rác', participantIds: [h.users[0].id, h.users[1].id], dueAt: due(), winnerId: h.users[0].id }).expect(400);
  });

  it('T-LW-09: GET /wheel/current giữa vòng và sau vòng; công bố ghi ticker + wheel:result', async () => {
    const h = await house4();
    await fx.as(h.users[0].token).get(`/api/v1/houses/${h.houseId}/wheel/current`).expect(204);
    const send = vi.spyOn(fx.app.get(EventsService), 'send');
    const res = await spin(h.users[0].token, h.houseId, { taskTitle: 'Thông bồn cầu', participantIds: h.users.map((u) => u.id), dueAt: due() }).expect(201);
    const mid = await fx.as(h.users[1].token).get(`/api/v1/houses/${h.houseId}/wheel/current`).expect(200);
    expect(mid.body).toMatchObject({ spinId: res.body.spinId, status: 'SPINNING', winner: null });

    await sleep(1000); // timer revealAt (400 ms + 300 ms)
    const after = await fx.as(h.users[1].token).get(`/api/v1/houses/${h.houseId}/wheel/current`).expect(200);
    expect(after.body.status).toBe('REVEALED');
    expect(after.body.winner.id).toBe(after.body.slices[after.body.landingIndex]);
    const types = send.mock.calls.map((c) => (c[1] as { type: string }).type);
    expect(types).toEqual(expect.arrayContaining(['wheel:spinning', 'activity:new', 'wheel:result']));
    const act = await fx.prisma.houseActivity.findFirstOrThrow({ where: { houseId: h.houseId, type: 'wheel.result' } });
    expect(act.params).toMatchObject({ taskTitle: 'Thông bồn cầu', winnerUserId: after.body.winner.id });
    expect(await wheel.reveal(res.body.spinId)).toBe(false);
  });

  it('T-LW-03 / LW-01: 20 request song song → đúng 1 vòng 201, còn lại WHEEL_BUSY kèm retryAfterMs', async () => {
    const h = await house4();
    const body = { taskTitle: 'Mua gas', participantIds: h.users.map((u) => u.id), dueAt: due() };
    const results = await Promise.all(Array.from({ length: 20 }, (_, i) => spin(h.users[i % 4].token, h.houseId, body)));
    const codes = results.map((r) => r.status);
    expect(codes.filter((c) => c === 201)).toHaveLength(1);
    expect(codes.filter((c) => c === 409)).toHaveLength(19);
    const busy = results.find((r) => r.status === 409)!.body;
    expect(busy).toMatchObject({ code: 'WHEEL_BUSY', retryAfterMs: expect.any(Number), spinId: expect.any(String) });
    expect(await fx.prisma.luckyWheelLog.count({ where: { houseId: h.houseId } })).toBe(1);
    expect(await fx.prisma.choreAssignment.count({ where: { houseId: h.houseId, source: 'WHEEL' } })).toBe(1);
  });

  it('T-LW-04: cùng Idempotency-Key gửi 2 lần → 1 vòng, lần hai 200 trả kết quả cũ; thiếu key thì 400', async () => {
    const h = await house4();
    const body = { taskTitle: 'Mua nước', participantIds: [h.users[0].id, h.users[1].id], dueAt: due() };
    const first = await spin(h.users[0].token, h.houseId, body, 'k-1').expect(201);
    const again = await spin(h.users[0].token, h.houseId, body, 'k-1').expect(200);
    expect(again.body.spinId).toBe(first.body.spinId);
    expect(await fx.prisma.luckyWheelLog.count({ where: { houseId: h.houseId } })).toBe(1);
    const missing = await spin(h.users[0].token, h.houseId, body, null).expect(400);
    expect(missing.body.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
  });

  it('T-LW-05: người tham gia sai / thiếu, nhà nghỉ → 422 đúng code', async () => {
    const h = await house4();
    const outsider = await fx.user('Người lạ');
    const tok = h.users[0].token;
    const ids = h.users.map((u) => u.id);
    const code = async (body: object) => (await spin(tok, h.houseId, { taskTitle: 'Việc gì đó', dueAt: due(), ...body }).expect(422)).body.code as string;

    expect(await code({ participantIds: [ids[0]] })).toBe('WHEEL_NEEDS_2_ELIGIBLE');
    expect(await code({ participantIds: [ids[0], ids[0], ids[1]] })).toBe('PARTICIPANT_DUPLICATE');
    expect(await code({ participantIds: [ids[0], outsider.id] })).toBe('PARTICIPANT_NOT_MEMBER');

    const today = toDateStr(new Date());
    await fx.prisma.memberAbsence.create({ data: { houseId: h.houseId, userId: ids[2], startDate: dateOf(today), endDate: dateOf(today), createdById: ids[2] } });
    expect(await code({ participantIds: [ids[0], ids[2]] })).toBe('PARTICIPANT_ABSENT');
    const opts = await fx.as(tok).get(`/api/v1/houses/${h.houseId}/wheel/options`).expect(200);
    expect(opts.body.defaultParticipantIds).toEqual([ids[0], ids[1], ids[3]]);
    expect(opts.body.members.find((m: { id: string }) => m.id === ids[2]).absentToday).toBe(true);
    expect(opts.body.dueOptions).toHaveLength(4);
    expect(opts.body.remaining).toEqual({ hour: 5, day: 10 });

    await fx.prisma.houseBreak.create({ data: { houseId: h.houseId, startDate: dateOf(today), endDate: dateOf(today), createdById: ids[0] } });
    expect(await code({ participantIds: [ids[0], ids[1]] })).toBe('WHEEL_HOUSE_BREAK');
  });

  it('LW-02: nhà 1 người → WHEEL_NEEDS_2_ELIGIBLE', async () => {
    const h = await fx.houseWith(['Hùng']);
    const res = await spin(h.users[0].token, h.houseId, { taskTitle: 'Đổ rác', participantIds: [h.users[0].id], dueAt: due() }).expect(422);
    expect(res.body.code).toBe('WHEEL_NEEDS_2_ELIGIBLE');
  });

  it('T-LW-06: dueAt ngoài khoảng → 422; tên việc quá ngắn → 400; quá 5 vòng/giờ → 429', async () => {
    const h = await house4();
    const ids = [h.users[0].id, h.users[1].id];
    const bad = await spin(h.users[0].token, h.houseId, { taskTitle: 'Đổ rác', participantIds: ids, dueAt: new Date(Date.now() + 10 * 60_000).toISOString() }).expect(422);
    expect(bad.body.code).toBe('WHEEL_DUE_INVALID');
    await spin(h.users[0].token, h.houseId, { taskTitle: 'ab', participantIds: ids, dueAt: due() }).expect(400);
    await spin(h.users[0].token, h.houseId, { taskTitle: 'ab\u0000\u0007', participantIds: ids, dueAt: due() }).expect(400);

    // 5 vòng trong giờ qua (giả lập bằng DB để không chờ animation).
    const res = await spin(h.users[0].token, h.houseId, { taskTitle: 'Vòng một', participantIds: ids, dueAt: due() }).expect(201);
    await wheel.reveal(res.body.spinId);
    const tpl = await fx.prisma.luckyWheelLog.findUniqueOrThrow({ where: { id: res.body.spinId } });
    for (let i = 0; i < 4; i++) {
      const a = await fx.prisma.choreAssignment.findUniqueOrThrow({ where: { id: tpl.assignmentId } });
      const copy = await fx.prisma.choreAssignment.create({ data: { ...a, id: undefined, slotIndex: a.slotIndex + 10 + i, createdAt: undefined, updatedAt: undefined } });
      await fx.prisma.luckyWheelLog.create({
        data: { ...tpl, id: undefined, assignmentId: copy.id, idempotencyKey: `seed-${i}`, status: 'REVEALED', createdAt: undefined },
      });
    }
    const limited = await spin(h.users[0].token, h.houseId, { taskTitle: 'Vòng sáu', participantIds: ids, dueAt: due() }).expect(429);
    expect(limited.body.code).toBe('WHEEL_RATE_LIMIT');
  });

  it('T-LW-08: việc hệ thống ẩn khỏi GET /chores, PATCH → 403 SYSTEM_CHORE, quay lần 2 dùng lại', async () => {
    const h = await house4();
    const ids = [h.users[0].id, h.users[1].id];
    const a = await spin(h.users[0].token, h.houseId, { taskTitle: 'Lần một', participantIds: ids, dueAt: due() }).expect(201);
    await wheel.reveal(a.body.spinId);
    await spin(h.users[0].token, h.houseId, { taskTitle: 'Lần hai', participantIds: ids, dueAt: due() }).expect(201);
    const system = await fx.prisma.chore.findMany({ where: { houseId: h.houseId, isSystem: true } });
    expect(system).toHaveLength(1);
    const list = await fx.as(h.users[0].token).get(`/api/v1/houses/${h.houseId}/chores?includeInactive=true`).expect(200);
    expect(list.body).toHaveLength(0);
    const res = await fx.as(h.users[0].token).patch(`/api/v1/houses/${h.houseId}/chores/${system[0].id}`, { isActive: false }).expect(403);
    expect(res.body.code).toBe('SYSTEM_CHORE');
  });

  it('T-LW-10: ca WHEEL ẩn khỏi GET /assignments và chưa check-in được trước revealAt', async () => {
    const h = await house4();
    wheel.durationMs = 60_000;
    try {
      const res = await spin(h.users[0].token, h.houseId, { taskTitle: 'Mua đá', participantIds: h.users.map((u) => u.id), dueAt: due() }).expect(201);
      const log = await fx.prisma.luckyWheelLog.findUniqueOrThrow({ where: { id: res.body.spinId } });
      const winner = h.users.find((u) => u.id === log.selectedUserId)!;
      const week = await fx.as(h.users[0].token).get(`/api/v1/houses/${h.houseId}/assignments`).expect(200);
      expect(week.body.assignments.some((x: { id: string }) => x.id === log.assignmentId)).toBe(false);
      const early = await fx
        .as(winner.token)
        .post(`/api/v1/assignments/${log.assignmentId}/checkin`)
        .attach('photo', png(), { filename: 'a.png', contentType: 'image/png' })
        .expect(422);
      expect(early.body.code).toBe('CHECKIN_NOT_OPEN');

      await wheel.reveal(res.body.spinId);
      await fx.prisma.luckyWheelLog.update({ where: { id: log.id }, data: { revealAt: new Date(Date.now() - 1000) } });
      const after = await fx.as(h.users[0].token).get(`/api/v1/houses/${h.houseId}/assignments`).expect(200);
      const card = after.body.assignments.find((x: { id: string }) => x.id === log.assignmentId);
      expect(card).toMatchObject({ source: 'WHEEL', wheelSpinId: log.id, choreTitle: 'Mua đá' });
    } finally {
      wheel.durationMs = 400;
    }
  });

  it('T-LW-11 / LW-19: Admin hủy vòng → ca CANCELLED, có nhật ký + ticker; thành viên 403; hủy lần hai 409', async () => {
    const h = await house4();
    const res = await spin(h.users[1].token, h.houseId, { taskTitle: 'Mua nuoc binh', participantIds: [h.users[2].id, h.users[3].id], dueAt: due() }).expect(201);
    await wheel.reveal(res.body.spinId);
    const url = `/api/v1/wheel/spins/${res.body.spinId}/void`;
    const member = await fx.as(h.users[1].token).post(url, { reason: 'Gõ sai tên việc' }).expect(403);
    expect(member.body.code).toBe('ADMIN_ONLY');
    await fx.as(h.users[0].token).post(url, { reason: 'abc' }).expect(400);

    const [x, y] = await Promise.all([
      fx.as(h.users[0].token).post(url, { reason: 'Gõ sai tên việc' }),
      fx.as(h.users[0].token).post(url, { reason: 'Gõ sai tên việc' }),
    ]);
    expect([x.status, y.status].sort((p, q) => p - q)).toEqual([200, 409]);
    const log = await fx.prisma.luckyWheelLog.findUniqueOrThrow({ where: { id: res.body.spinId }, include: { assignment: true } });
    expect(log).toMatchObject({ status: 'VOIDED', voidReason: 'Gõ sai tên việc', voidedById: h.users[0].id });
    expect(log.assignment.status).toBe('CANCELLED');
    expect(await fx.prisma.choreAuditLog.count({ where: { houseId: h.houseId, action: 'WHEEL_VOID' } })).toBe(1);
    expect(await fx.prisma.houseActivity.count({ where: { houseId: h.houseId, type: 'wheel.voided' } })).toBe(1);
    const stranger = await fx.user('Người lạ');
    await fx.as(stranger.token).post(url, { reason: 'Gõ sai tên việc' }).expect(404);
  });

  it('T-LW-12: khởi động lại với vòng dang dở → REVEALED và phát wheel:result', async () => {
    const h = await house4();
    wheel.durationMs = 60_000;
    try {
      const res = await spin(h.users[0].token, h.houseId, { taskTitle: 'Dọn tủ lạnh', participantIds: [h.users[0].id, h.users[1].id], dueAt: due() }).expect(201);
      await fx.prisma.luckyWheelLog.update({ where: { id: res.body.spinId }, data: { revealAt: new Date(Date.now() - 1000) } });
      const send = vi.spyOn(fx.app.get(EventsService), 'send');
      await wheel.recoverPending();
      expect((await fx.prisma.luckyWheelLog.findUniqueOrThrow({ where: { id: res.body.spinId } })).status).toBe('REVEALED');
      expect(send.mock.calls.map((c) => (c[1] as { type: string }).type)).toContain('wheel:result');
    } finally {
      wheel.durationMs = 400;
    }
  });

  it('lịch sử vòng quay có người tham gia và người trúng; vòng đang quay chưa lộ người trúng', async () => {
    const h = await house4();
    const res = await spin(h.users[0].token, h.houseId, { taskTitle: 'Dọn ban công', participantIds: [h.users[1].id, h.users[2].id], dueAt: due() }).expect(201);
    const during = await fx.as(h.users[3].token).get(`/api/v1/houses/${h.houseId}/wheel/spins`).expect(200);
    expect(during.body[0]).toMatchObject({ spinId: res.body.spinId, winner: null, excludedCount: 2 });
    await wheel.reveal(res.body.spinId);
    const after = await fx.as(h.users[3].token).get(`/api/v1/houses/${h.houseId}/wheel/spins?limit=5`).expect(200);
    expect(after.body[0].participants.map((p: { name: string }) => p.name)).toEqual(['Thiện', 'Mai']);
    expect(after.body[0].winner).not.toBeNull();
  });
});
