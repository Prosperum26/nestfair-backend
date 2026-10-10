import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

// Cần Postgres đang chạy (npm run db:up) và .env hợp lệ.
const DOMAIN = '@e2e-houses.nestfair.test';
const INVALID_CODE =
  'Mã mời không tồn tại hoặc đã hết hạn. Kiểm tra lại với trưởng phòng.';
let seq = 0;

describe('Houses (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const http = () => request(app.getHttpServer());

  /** Đăng ký user mới, trả về { id, token }. */
  async function user(fullName: string) {
    const res = await http()
      .post('/api/v1/auth/register')
      .send({
        fullName,
        email: `u${Date.now()}-${seq++}${DOMAIN}`,
        phone: '0901234567',
        password: 'MatKhau123',
      })
      .expect(201);
    return {
      id: res.body.user.id as string,
      token: res.body.accessToken as string,
    };
  }

  const as = (token: string) => ({
    get: (path: string) =>
      http().get(path).set('Authorization', `Bearer ${token}`),
    post: (path: string, body?: object) =>
      http().post(path).set('Authorization', `Bearer ${token}`).send(body),
  });

  async function createHouse(token: string, over: object = {}) {
    const res = await as(token)
      .post('/api/v1/houses', { name: 'Nhà 12A', maxMembers: 4, ...over })
      .expect(201);
    return res.body as { id: string; inviteCode: string };
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await prisma.house.deleteMany({
      where: { members: { some: { user: { email: { endsWith: DOMAIN } } } } },
    });
    await prisma.user.deleteMany({ where: { email: { endsWith: DOMAIN } } });
    await app.close();
  });

  describe('POST /houses', () => {
    it('người tạo là ADMIN, nhận mã mời 6 ký tự hạn 7 ngày', async () => {
      const hung = await user('Trần Minh Hùng');
      const res = await as(hung.token)
        .post('/api/v1/houses', {
          name: '  Nhà 12A ',
          address: 'Hẻm 51, Linh Trung',
          maxMembers: 4,
        })
        .expect(201);

      expect(res.body).toMatchObject({
        name: 'Nhà 12A',
        address: 'Hẻm 51, Linh Trung',
        maxMembers: 4,
        myRole: 'ADMIN',
        members: [
          { userId: hung.id, fullName: 'Trần Minh Hùng', role: 'ADMIN' },
        ],
      });
      expect(res.body.inviteCode).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ2-9]{6}$/);
      const days =
        (Date.parse(res.body.inviteExpiresAt) - Date.now()) / 86_400_000;
      expect(days).toBeGreaterThan(6.99);
      expect(days).toBeLessThanOrEqual(7);
    });

    it('cần đăng nhập', async () => {
      await http()
        .post('/api/v1/houses')
        .send({ name: 'Nhà', maxMembers: 4 })
        .expect(401);
    });

    it.each([
      ['tên quá ngắn', { name: 'A', maxMembers: 4 }],
      ['ít hơn 2 người', { name: 'Nhà 12A', maxMembers: 1 }],
      ['quá 10 người', { name: 'Nhà 12A', maxMembers: 11 }],
      ['số người lẻ', { name: 'Nhà 12A', maxMembers: 2.5 }],
      [
        'gửi kèm inviteCode tự chọn',
        { name: 'Nhà 12A', maxMembers: 4, inviteCode: 'AAAAAA' },
      ],
    ])('%s thì 400', async (_, body) => {
      const hung = await user('Hùng');
      await as(hung.token).post('/api/v1/houses', body).expect(400);
    });
  });

  describe('POST /houses/join', () => {
    it('vào bằng mã (không phân biệt hoa thường, có khoảng trắng), vai trò ROOMMATE', async () => {
      const hung = await user('Trần Minh Hùng');
      const thien = await user('Lê Đức Thiện');
      const house = await createHouse(hung.token);
      const typed = ` ${house.inviteCode.slice(0, 3).toLowerCase()} ${house.inviteCode.slice(3)} `;

      const res = await as(thien.token)
        .post('/api/v1/houses/join', { inviteCode: typed })
        .expect(200);

      expect(res.body.id).toBe(house.id);
      expect(res.body.myRole).toBe('ROOMMATE');
      expect(
        res.body.members.map((m: { fullName: string; role: string }) => [
          m.fullName,
          m.role,
        ]),
      ).toEqual([
        ['Trần Minh Hùng', 'ADMIN'],
        ['Lê Đức Thiện', 'ROOMMATE'],
      ]);
    });

    it('thành viên thấy ngân hàng + 4 số cuối STK của nhau, không thấy STK đầy đủ, email', async () => {
      const hung = await user('Hùng');
      const thien = await user('Thiện');
      await as(hung.token)
        .post('/api/v1/houses', { name: 'Nhà 12A', maxMembers: 4 })
        .expect(201);
      await http()
        .patch('/api/v1/users/me')
        .set('Authorization', `Bearer ${hung.token}`)
        .send({ bankBin: '970407', bankAccount: '19036780123' })
        .expect(200);
      const house = (await as(hung.token).get('/api/v1/houses').expect(200))
        .body[0];
      const code = (
        await as(hung.token).get(`/api/v1/houses/${house.id}`).expect(200)
      ).body.inviteCode;

      const res = await as(thien.token)
        .post('/api/v1/houses/join', { inviteCode: code })
        .expect(200);

      const admin = res.body.members[0];
      expect(admin).toMatchObject({
        bankBin: '970407',
        bankAccountLast4: '0123',
      });
      expect(JSON.stringify(res.body)).not.toContain('19036780123');
      expect(JSON.stringify(res.body)).not.toContain(DOMAIN);
      expect(res.body.members[1]).toMatchObject({
        bankBin: null,
        bankAccountLast4: null,
      });
    });

    it('đã ở trong nhà thì 409 (kể cả trưởng phòng)', async () => {
      const hung = await user('Hùng');
      const thien = await user('Thiện');
      const house = await createHouse(hung.token);
      await as(thien.token)
        .post('/api/v1/houses/join', { inviteCode: house.inviteCode })
        .expect(200);

      const again = await as(thien.token)
        .post('/api/v1/houses/join', { inviteCode: house.inviteCode })
        .expect(409);
      expect(again.body.message).toBe('Bạn đã ở trong nhà này rồi.');
      await as(hung.token)
        .post('/api/v1/houses/join', { inviteCode: house.inviteCode })
        .expect(409);
    });

    it('mã không tồn tại thì 404 với thông báo thân thiện', async () => {
      const thien = await user('Thiện');
      const res = await as(thien.token)
        .post('/api/v1/houses/join', { inviteCode: 'ZZZZZ9' })
        .expect(404);
      expect(res.body.message).toBe(INVALID_CODE);
    });

    it('mã hết hạn thì 404', async () => {
      const hung = await user('Hùng');
      const thien = await user('Thiện');
      const house = await createHouse(hung.token);
      await prisma.house.update({
        where: { id: house.id },
        data: { inviteExpiresAt: new Date(Date.now() - 1000) },
      });

      const res = await as(thien.token)
        .post('/api/v1/houses/join', { inviteCode: house.inviteCode })
        .expect(404);
      expect(res.body.message).toBe(INVALID_CODE);
    });

    it.each(['ABC', 'ABCDEFG', 'ABC!@#', ''])(
      'mã sai định dạng "%s" thì 400',
      async (code) => {
        const thien = await user('Thiện');
        await as(thien.token)
          .post('/api/v1/houses/join', { inviteCode: code })
          .expect(400);
      },
    );

    it('nhà đủ người thì 409', async () => {
      const hung = await user('Hùng');
      const thien = await user('Thiện');
      const mai = await user('Mai');
      const house = await createHouse(hung.token, { maxMembers: 2 });
      await as(thien.token)
        .post('/api/v1/houses/join', { inviteCode: house.inviteCode })
        .expect(200);

      const res = await as(mai.token)
        .post('/api/v1/houses/join', { inviteCode: house.inviteCode })
        .expect(409);
      expect(res.body.message).toMatch(/Nhà đã đủ người/);
    });

    it('2 người cùng vào khi nhà còn 1 chỗ: đúng 1 người vào được', async () => {
      const hung = await user('Hùng');
      const [thien, mai] = await Promise.all([user('Thiện'), user('Mai')]);
      const house = await createHouse(hung.token, { maxMembers: 2 });

      const results = await Promise.all(
        [thien, mai].map((u) =>
          as(u.token).post('/api/v1/houses/join', {
            inviteCode: house.inviteCode,
          }),
        ),
      );

      expect(results.map((r) => r.status).sort((a, b) => a - b)).toEqual([
        200, 409,
      ]);
      const count = await prisma.houseMember.count({
        where: { houseId: house.id, leftAt: null },
      });
      expect(count).toBe(2);
    });

    it('một người bấm "Vào nhà" 2 lần cùng lúc: chỉ tạo 1 membership', async () => {
      const hung = await user('Hùng');
      const thien = await user('Thiện');
      const house = await createHouse(hung.token);

      const results = await Promise.all(
        [1, 2].map(() =>
          as(thien.token).post('/api/v1/houses/join', {
            inviteCode: house.inviteCode,
          }),
        ),
      );

      expect(results.map((r) => r.status).sort((a, b) => a - b)).toEqual([
        200, 409,
      ]);
      const count = await prisma.houseMember.count({
        where: { houseId: house.id, userId: thien.id, leftAt: null },
      });
      expect(count).toBe(1);
    });

    it('đã rời nhà thì vào lại được (membership mới, giữ dòng cũ)', async () => {
      const hung = await user('Hùng');
      const thien = await user('Thiện');
      const house = await createHouse(hung.token);
      await as(thien.token)
        .post('/api/v1/houses/join', { inviteCode: house.inviteCode })
        .expect(200);
      await prisma.houseMember.updateMany({
        where: { houseId: house.id, userId: thien.id },
        data: { leftAt: new Date() },
      });

      await as(thien.token)
        .post('/api/v1/houses/join', { inviteCode: house.inviteCode })
        .expect(200);
      const rows = await prisma.houseMember.count({
        where: { houseId: house.id, userId: thien.id },
      });
      expect(rows).toBe(2);
    });
  });

  describe('GET /houses, GET /houses/:houseId', () => {
    it('liệt kê các nhà đang ở, kèm vai trò và số thành viên', async () => {
      const hung = await user('Hùng');
      const thien = await user('Thiện');
      const a = await createHouse(hung.token, { name: 'Nhà 12A' });
      const b = await createHouse(thien.token, { name: 'Phòng 404' });
      await as(thien.token)
        .post('/api/v1/houses/join', { inviteCode: a.inviteCode })
        .expect(200);

      const res = await as(thien.token).get('/api/v1/houses').expect(200);

      expect(res.body).toEqual([
        expect.objectContaining({
          id: a.id,
          name: 'Nhà 12A',
          myRole: 'ROOMMATE',
          memberCount: 2,
        }),
        expect.objectContaining({
          id: b.id,
          name: 'Phòng 404',
          myRole: 'ADMIN',
          memberCount: 1,
        }),
      ]);
    });

    it('thành viên xem được chi tiết; người ngoài 403; houseId sai định dạng 404', async () => {
      const hung = await user('Hùng');
      const outsider = await user('Người lạ');
      const house = await createHouse(hung.token);

      const own = await as(hung.token)
        .get(`/api/v1/houses/${house.id}`)
        .expect(200);
      expect(own.body.inviteCode).toBe(house.inviteCode);

      const forbidden = await as(outsider.token)
        .get(`/api/v1/houses/${house.id}`)
        .expect(403);
      expect(forbidden.body.message).toBe('Bạn không phải thành viên nhà này.');
      await as(outsider.token)
        .get('/api/v1/houses/khong-phai-uuid')
        .expect(404);
    });

    it('người đã rời nhà không xem được nữa', async () => {
      const hung = await user('Hùng');
      const thien = await user('Thiện');
      const house = await createHouse(hung.token);
      await as(thien.token)
        .post('/api/v1/houses/join', { inviteCode: house.inviteCode })
        .expect(200);
      await prisma.houseMember.updateMany({
        where: { houseId: house.id, userId: thien.id },
        data: { leftAt: new Date() },
      });

      await as(thien.token).get(`/api/v1/houses/${house.id}`).expect(403);
      const list = await as(thien.token).get('/api/v1/houses').expect(200);
      expect(list.body).toEqual([]);
    });
  });

  describe('chống IDOR giữa các nhà', () => {
    it('trưởng phòng nhà A không xem / đổi mã của nhà B', async () => {
      const hung = await user('Hùng');
      const quan = await user('Quân');
      await createHouse(hung.token, { name: 'Nhà A' });
      const houseB = await createHouse(quan.token, { name: 'Nhà B' });

      await as(hung.token).get(`/api/v1/houses/${houseB.id}`).expect(403);
      await as(hung.token)
        .post(`/api/v1/houses/${houseB.id}/invite-code`)
        .expect(403);
      const unchanged = await prisma.house.findUniqueOrThrow({
        where: { id: houseB.id },
      });
      expect(unchanged.inviteCode).toBe(houseB.inviteCode);
    });

    it('houseId không tồn tại trả 403 như nhà của người khác (không lộ nhà nào có thật)', async () => {
      const hung = await user('Hùng');
      await as(hung.token)
        .get('/api/v1/houses/00000000-0000-4000-8000-000000000000')
        .expect(403);
    });
  });

  describe('POST /houses/:houseId/invite-code', () => {
    it('trưởng phòng tạo mã mới, mã cũ hết hiệu lực', async () => {
      const hung = await user('Hùng');
      const mai = await user('Mai');
      const house = await createHouse(hung.token);

      const res = await as(hung.token)
        .post(`/api/v1/houses/${house.id}/invite-code`)
        .expect(200);
      expect(res.body.inviteCode).not.toBe(house.inviteCode);

      await as(mai.token)
        .post('/api/v1/houses/join', { inviteCode: house.inviteCode })
        .expect(404);
      await as(mai.token)
        .post('/api/v1/houses/join', { inviteCode: res.body.inviteCode })
        .expect(200);
    });

    it('thành viên thường thì 403', async () => {
      const hung = await user('Hùng');
      const thien = await user('Thiện');
      const house = await createHouse(hung.token);
      await as(thien.token)
        .post('/api/v1/houses/join', { inviteCode: house.inviteCode })
        .expect(200);

      const res = await as(thien.token)
        .post(`/api/v1/houses/${house.id}/invite-code`)
        .expect(403);
      expect(res.body.message).toBe('Chỉ trưởng phòng mới làm được việc này.');
    });
  });
});
