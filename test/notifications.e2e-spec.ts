import { randomUUID } from 'node:crypto';
import { ReminderCronService } from '../src/modules/scheduler/reminder-cron.service.js';
import { createFixture } from './support/house-fixture.js';

const URL = '/api/v1/notifications';
const MINUTE = 60_000;

/** Hộp thông báo cá nhân (chuông): API riêng tư theo userId và các điểm phát sinh thông báo. */
describe('Notifications (e2e)', () => {
  let fx: Awaited<ReturnType<typeof createFixture>>;

  beforeAll(async () => {
    fx = await createFixture('@e2e-notifications.nestfair.test');
  });
  afterAll(() => fx.cleanup());

  const expenseUrl = (houseId: string) => `/api/v1/houses/${houseId}/expenses`;
  const settleUrl = (houseId: string) => `/api/v1/houses/${houseId}/settlements`;
  const expense = { title: 'Tiền điện', category: 'ELECTRICITY', totalAmount: 300_000, splitType: 'EQUAL', spentAt: '2026-10-05T12:00:00+07:00' };
  const inbox = async (token: string, query = '') => (await fx.as(token).get(URL + query).expect(200)).body as {
    items: { id: string; houseId: string; type: string; params: Record<string, unknown>; readAt: string | null }[];
    unreadCount: number;
  };
  const seed = (userId: string, houseId: string, title: string, createdAt = new Date()) =>
    fx.prisma.notification.create({ data: { userId, houseId, type: 'REMINDER_DUE', params: { reminderId: randomUUID(), title }, createdAt } });

  describe('API', () => {
    it('chỉ trả thông báo của chính mình, mới nhất trước, kèm số chưa đọc', async () => {
      const { houseId, users } = await fx.houseWith(['Hùng', 'Thiện']);
      const [hung, thien] = users;
      await seed(hung.id, houseId, 'Cũ', new Date(Date.now() - 10 * MINUTE));
      await seed(hung.id, houseId, 'Mới');
      await seed(thien.id, houseId, 'Của Thiện');

      const mine = await inbox(hung.token);
      expect(mine.items.map((n) => n.params.title)).toEqual(['Mới', 'Cũ']);
      expect(mine.unreadCount).toBe(2);
      expect(JSON.stringify(mine)).not.toContain('Của Thiện');
      expect(Object.keys(mine.items[0]).sort()).toEqual(['createdAt', 'houseId', 'id', 'params', 'readAt', 'type']);
    });

    it('lọc theo houseId chỉ trên thông báo của chính mình; limit giới hạn danh sách nhưng không giới hạn số chưa đọc', async () => {
      const a = await fx.houseWith(['Hùng', 'Thiện']);
      const hung = a.users[0];
      const created = await fx.as(hung.token).post('/api/v1/houses', { name: 'Nhà hai', maxMembers: 2 }).expect(201);
      const otherHouseId = created.body.id as string;
      await seed(hung.id, a.houseId, 'Nhà một');
      await seed(hung.id, otherHouseId, 'Nhà hai');

      expect((await inbox(hung.token, `?houseId=${a.houseId}`)).items.map((n) => n.params.title)).toEqual(['Nhà một']);
      const limited = await inbox(hung.token, '?limit=1');
      expect(limited.items).toHaveLength(1);
      expect(limited.unreadCount).toBe(2);
      // Nhà của người khác: không lỗi, chỉ đơn giản là không có dòng nào của mình.
      const b = await fx.houseWith(['Mai', 'Quân']);
      expect(await inbox(hung.token, `?houseId=${b.houseId}`)).toEqual({ items: [], unreadCount: 0 });
    });

    it('400 khi houseId không phải UUID hoặc limit ngoài khoảng; 401 khi chưa đăng nhập', async () => {
      const { users } = await fx.houseWith(['Hùng', 'Thiện']);
      await fx.as(users[0].token).get(URL + '?houseId=abc').expect(400);
      await fx.as(users[0].token).get(URL + '?limit=0').expect(400);
      await fx.as(users[0].token).get(URL + '?limit=101').expect(400);
      await fx.http().get(URL).expect(401);
      await fx.http().post(URL + '/read-all').expect(401);
    });

    it('đánh dấu một thông báo đã đọc; gọi lại giữ nguyên readAt', async () => {
      const { houseId, users } = await fx.houseWith(['Hùng', 'Thiện']);
      const n = await seed(users[0].id, houseId, 'Đổ rác');
      const first = await fx.as(users[0].token).post(`${URL}/${n.id}/read`, {}).expect(200);
      expect(first.body.readAt).toEqual(expect.any(String));
      const again = await fx.as(users[0].token).post(`${URL}/${n.id}/read`, {}).expect(200);
      expect(again.body.readAt).toBe(first.body.readAt);
      expect((await inbox(users[0].token)).unreadCount).toBe(0);
    });

    it('thông báo của người khác (kể cả bạn cùng phòng) → 404 NOTIFICATION_NOT_FOUND, không bị đánh dấu', async () => {
      const { houseId, users } = await fx.houseWith(['Hùng', 'Thiện']);
      const n = await seed(users[1].id, houseId, 'Của Thiện');
      const res = await fx.as(users[0].token).post(`${URL}/${n.id}/read`, {}).expect(404);
      expect(res.body.code).toBe('NOTIFICATION_NOT_FOUND');
      await fx.as(users[0].token).post(`${URL}/${randomUUID()}/read`, {}).expect(404);
      await fx.as(users[0].token).post(`${URL}/khong-phai-uuid/read`, {}).expect(400);
      expect((await fx.prisma.notification.findUniqueOrThrow({ where: { id: n.id } })).readAt).toBeNull();
    });

    it('đánh dấu tất cả đã đọc chỉ chạm thông báo của mình; gọi lại trả 0', async () => {
      const { houseId, users } = await fx.houseWith(['Hùng', 'Thiện']);
      await seed(users[0].id, houseId, 'Một');
      await seed(users[0].id, houseId, 'Hai');
      const theirs = await seed(users[1].id, houseId, 'Của Thiện');

      expect((await fx.as(users[0].token).post(URL + '/read-all', {}).expect(200)).body).toEqual({ updated: 2 });
      expect((await fx.as(users[0].token).post(URL + '/read-all', {}).expect(200)).body).toEqual({ updated: 0 });
      expect((await inbox(users[0].token)).unreadCount).toBe(0);
      expect((await fx.prisma.notification.findUniqueOrThrow({ where: { id: theirs.id } })).readAt).toBeNull();
    });
  });

  describe('khoản chi mới (EXPENSE_CREATED)', () => {
    it('báo cho người có phần, không báo người tạo; params chỉ có phần của chính người nhận', async () => {
      const { houseId, users } = await fx.houseWith(['Hùng', 'Thiện', 'Mai']);
      const [hung, thien, mai] = users;
      const res = await fx.as(hung.token).post(expenseUrl(houseId), expense).expect(201);

      const thienBox = await inbox(thien.token);
      expect(thienBox.unreadCount).toBe(1);
      expect(thienBox.items[0]).toMatchObject({
        houseId,
        type: 'EXPENSE_CREATED',
        params: { expenseId: res.body.id, title: 'Tiền điện', payerName: 'Hùng', share: 100_000 },
        readAt: null,
      });
      expect((await inbox(mai.token)).unreadCount).toBe(1);
      expect((await inbox(hung.token)).items).toEqual([]);
    });

    it('tắt công tắc "Khi có khoản chi mới" thì không nhận; người khác vẫn nhận', async () => {
      const { houseId, users } = await fx.houseWith(['Hùng', 'Thiện', 'Mai']);
      const [hung, thien, mai] = users;
      await fx.as(thien.token).patch('/api/v1/users/me/notifications', { expenseCreated: false }).expect(200);
      await fx.as(hung.token).post(expenseUrl(houseId), expense).expect(201);

      expect((await inbox(thien.token)).items).toEqual([]);
      expect((await inbox(mai.token)).unreadCount).toBe(1);
    });

    it('khoản chi không hợp lệ (422) thì không tạo thông báo nào', async () => {
      const { houseId, users } = await fx.houseWith(['Hùng', 'Thiện']);
      await fx.as(users[0].token).post(expenseUrl(houseId), { ...expense, splitType: 'CUSTOM' }).expect(422);
      expect(await fx.prisma.notification.count({ where: { houseId } })).toBe(0);
    });
  });

  describe('báo đã trả nợ (DEBT_PAID)', () => {
    /** Thiện trả 100.000đ chia đôi: Hùng nợ Thiện 50.000đ. */
    async function debt() {
      const house = await fx.houseWith(['Hùng', 'Thiện']);
      const [hung, thien] = house.users;
      await fx.as(thien.token).post(expenseUrl(house.houseId), { ...expense, totalAmount: 100_000 }).expect(201);
      await fx.prisma.notification.deleteMany({ where: { houseId: house.houseId } });
      return { houseId: house.houseId, hung, thien };
    }

    it('người nợ báo đã chuyển → chủ nợ nhận thông báo, người nợ thì không', async () => {
      const { houseId, hung, thien } = await debt();
      const res = await fx.as(hung.token).post(settleUrl(houseId), { toUserId: thien.id, amount: 50_000 }).expect(201);

      const box = await inbox(thien.token);
      expect(box.items).toHaveLength(1);
      expect(box.items[0]).toMatchObject({ type: 'DEBT_PAID', params: { settlementId: res.body.id, fromName: 'Hùng', amount: 50_000 } });
      expect((await inbox(hung.token)).items).toEqual([]);
    });

    it('tắt công tắc "Khi có người trả nợ cho bạn" thì không nhận', async () => {
      const { houseId, hung, thien } = await debt();
      await fx.as(thien.token).patch('/api/v1/users/me/notifications', { debtPaid: false }).expect(200);
      await fx.as(hung.token).post(settleUrl(houseId), { toUserId: thien.id, amount: 50_000 }).expect(201);
      expect((await inbox(thien.token)).items).toEqual([]);
    });
  });

  describe('nhắc nhở tới giờ (REMINDER_DUE)', () => {
    it('cron gửi nhắc → có thông báo cho đúng người; chạy lại không tạo thêm; tắt hết công tắc vẫn nhận', async () => {
      const { houseId, users } = await fx.houseWith(['Hùng', 'Thiện']);
      await fx.as(users[0].token).patch('/api/v1/users/me/notifications', { expenseCreated: false, debtPaid: false, choreDigest: false }).expect(200);
      const reminder = await fx.prisma.reminder.create({
        data: { userId: users[0].id, houseId, title: 'Đổ rác tối nay', remindAt: new Date(Date.now() - 5 * MINUTE), source: 'USER' },
      });
      const cron = fx.app.get(ReminderCronService);

      expect((await cron.dispatchDue(new Date(), [houseId])).sent).toBe(1);
      await cron.dispatchDue(new Date(), [houseId]);

      const box = await inbox(users[0].token);
      expect(box.items).toHaveLength(1);
      expect(box.items[0]).toMatchObject({ type: 'REMINDER_DUE', params: { reminderId: reminder.id, title: 'Đổ rác tối nay' } });
      expect((await inbox(users[1].token)).items).toEqual([]);
    });
  });
});
