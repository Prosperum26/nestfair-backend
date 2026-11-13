import type { OpenAPIObject } from '@nestjs/swagger';
import { randomUUID } from 'node:crypto';
import { buildOpenApiDocument } from '../src/swagger.setup.js';
import { makeAssignment } from './support/assignment-fixture.js';
import { createFixture } from './support/house-fixture.js';

/**
 * Quét kiểm soát truy cập trên TOÀN BỘ route trong tài liệu OpenAPI (route mới tự được quét):
 * - chưa đăng nhập: mọi route cần token trả 401;
 * - người ngoài nhà (đã đăng nhập, ở nhà khác) dùng id thật của nhà nạn nhân: chỉ được 403/404,
 *   không 2xx (lộ/sửa dữ liệu), không 5xx; sau khi quét, dữ liệu nạn nhân còn nguyên.
 */
const METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;

/** Route theo chính người gọi (không nhận id tài nguyên của người khác): kiểm riêng ở dưới. */
const SELF_SCOPED = [
  /^\/api\/v1\/auth\//,
  /^\/api\/v1\/users\/me/,
  /^\/api\/v1\/houses$/,
  /^\/api\/v1\/houses\/join$/,
  /^\/api\/v1\/reminders$/,
  /^\/api\/v1\/notifications$/,
  /^\/api\/v1\/notifications\/read-all$/,
];

/**
 * Route mà nhà suy ra từ tài nguyên (không có `houseId` trên đường dẫn) kiểm quyền trong service, sau
 * ValidationPipe. Gửi body/query hợp lệ để request đi tới bước kiểm quyền thay vì dừng ở 400.
 */
const VALID_INPUT: Record<string, { body?: object; query?: string }> = {
  'patch /api/v1/assignments/{assignmentId}/verify': { body: { decision: 'APPROVED' } },
  'patch /api/v1/assignments/{assignmentId}/override': { body: { action: 'CANCEL', reason: 'Quét quyền truy cập' } },
  'get /api/v1/assignments/{assignmentId}/swap-options': { query: 'type=EXCHANGE' },
  'post /api/v1/swaps/{swapId}/escalate': { body: { action: 'SELF' } },
  'patch /api/v1/chore-debts/{debtId}/payback': { body: { assignmentId: randomUUID() } },
  'post /api/v1/wheel/spins/{spinId}/void': { body: { reason: 'Quét quyền truy cập' } },
};

/** Route xác thực bằng cookie, không bằng token: logout không có cookie vẫn 204 (idempotent, theo thiết kế). */
const COOKIE_ONLY = new Set(['post /api/v1/auth/logout', 'post /api/v1/auth/refresh']);

describe('Kiểm soát truy cập (quét toàn bộ route)', () => {
  let fx: Awaited<ReturnType<typeof createFixture>>;
  let doc: OpenAPIObject;
  let victim: Awaited<ReturnType<typeof fx.houseWith>>;
  let outsider: { token: string };
  const ids: Record<string, string> = {};

  const secured = () =>
    Object.entries(doc.paths).flatMap(([path, item]) =>
      METHODS.filter((m) => item[m] && (item[m]!.security?.length ?? 0) > 0).map((m) => ({ path, method: m })),
    );

  /** Điền tham số đường dẫn bằng id thật của nhà nạn nhân (id không biết thì UUID ngẫu nhiên). */
  const fill = (path: string) =>
    path.replace(/\{(\w+)\}/g, (_, name: string) => {
      if (name === 'id') return path.startsWith('/api/v1/reminders') ? ids.reminder : ids.notification;
      return ids[name] ?? randomUUID();
    });

  beforeAll(async () => {
    fx = await createFixture('@idor.test');
    doc = buildOpenApiDocument(fx.app);
    victim = await fx.houseWith(['Hùng', 'Thiện']);
    const [a, b] = victim.users;
    outsider = (await fx.houseWith(['Người lạ', 'Bạn người lạ'])).users[0];

    const assignment = await makeAssignment(fx, victim);
    const expense = await fx
      .as(a.token)
      .post(`/api/v1/houses/${victim.houseId}/expenses`, {
        title: 'Tiền điện',
        category: 'ELECTRICITY',
        totalAmount: 200_000,
        splitType: 'EQUAL',
        spentAt: new Date().toISOString(),
      })
      .expect(201);
    const reminder = await fx
      .as(a.token)
      .post('/api/v1/reminders', {
        houseId: victim.houseId,
        title: 'Đóng tiền nhà',
        remindAt: new Date(Date.now() + 86_400_000).toISOString(),
      })
      .expect(201);
    const notification = await fx.prisma.notification.findFirstOrThrow({ where: { userId: b.id } });
    Object.assign(ids, {
      houseId: victim.houseId,
      userId: a.id,
      assignmentId: assignment.id,
      expenseId: expense.body.id,
      reminder: reminder.body.id,
      notification: notification.id,
    });
  });

  afterAll(async () => {
    await fx.cleanup();
  });

  it('chưa đăng nhập: mọi route cần token trả 401', async () => {
    const leaks: string[] = [];
    for (const { path, method } of secured()) {
      if (COOKIE_ONLY.has(`${method} ${path}`)) continue;
      const res = await fx.http()[method](fill(path)).send({});
      if (res.status !== 401) leaks.push(`${method.toUpperCase()} ${path} → ${res.status}`);
    }
    expect(leaks).toEqual([]);
  });

  it('người ngoài nhà: mọi route theo nhà hoặc theo tài nguyên chỉ trả 403/404', async () => {
    const leaks: string[] = [];
    let checked = 0;
    for (const { path, method } of secured()) {
      if (SELF_SCOPED.some((re) => re.test(path))) continue;
      checked++;
      const input = VALID_INPUT[`${method} ${path}`] ?? {};
      const url = fill(path) + (input.query ? `?${input.query}` : '');
      const res = await fx
        .http()
        [method](url)
        .set('Authorization', `Bearer ${outsider.token}`)
        .set('Idempotency-Key', randomUUID())
        .send(input.body ?? {});
      if (res.status !== 403 && res.status !== 404) leaks.push(`${method.toUpperCase()} ${path} → ${res.status}`);
    }
    expect(checked).toBeGreaterThan(60);
    expect(leaks).toEqual([]);
  });

  it('sau khi quét, dữ liệu nhà nạn nhân còn nguyên', async () => {
    const house = await fx.prisma.house.findUniqueOrThrow({ where: { id: victim.houseId } });
    expect(house.name).toBe('Nhà test');
    const members = await fx.prisma.houseMember.findMany({ where: { houseId: victim.houseId, leftAt: null } });
    expect(members).toHaveLength(2);
    expect(members.find((m) => m.userId === ids.userId)?.role).toBe('ADMIN');
    expect(await fx.prisma.expense.findUnique({ where: { id: ids.expenseId } })).not.toBeNull();
    expect(await fx.prisma.reminder.findUnique({ where: { id: ids.reminder } })).not.toBeNull();
    expect((await fx.prisma.notification.findUniqueOrThrow({ where: { id: ids.notification } })).readAt).toBeNull();
    expect((await fx.prisma.choreAssignment.findUniqueOrThrow({ where: { id: ids.assignmentId } })).status).toBe('TODO');
  });

  it('route theo người gọi: không thấy, không tạo được dữ liệu của nhà khác', async () => {
    const o = fx.as(outsider.token);
    const reminders = await o.get('/api/v1/reminders').expect(200);
    expect(JSON.stringify(reminders.body)).not.toContain(ids.reminder);
    const notifications = await o.get(`/api/v1/notifications?houseId=${victim.houseId}`).expect(200);
    expect(notifications.body.items).toEqual([]);
    await o.post('/api/v1/notifications/read-all', { houseId: victim.houseId }).expect((r) => {
      expect(r.status).toBeLessThan(300);
    });
    expect((await fx.prisma.notification.findUniqueOrThrow({ where: { id: ids.notification } })).readAt).toBeNull();
    const created = await o.post('/api/v1/reminders', {
      houseId: victim.houseId,
      title: 'Chen ngang',
      remindAt: new Date(Date.now() + 86_400_000).toISOString(),
    });
    expect([403, 404]).toContain(created.status);
  });
});
