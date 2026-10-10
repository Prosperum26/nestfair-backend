import { createFixture } from './support/house-fixture.js';

describe('Chores (e2e)', () => {
  let fx: Awaited<ReturnType<typeof createFixture>>;
  beforeAll(async () => {
    fx = await createFixture('@e2e-chores.nestfair.test');
  });
  afterAll(() => fx.cleanup());

  it('ADMIN tạo việc → 201; ROOMMATE tạo → 403', async () => {
    const { houseId, users } = await fx.houseWith(['Hùng', 'Thiện']);
    const ok = await fx.as(users[0].token)
      .post(`/api/v1/houses/${houseId}/chores`, { title: '  Đổ rác ', weight: 2 })
      .expect(201);
    expect(ok.body).toMatchObject({ title: 'Đổ rác', weight: 2, frequency: 'WEEKLY', isActive: true });
    await fx.as(users[1].token)
      .post(`/api/v1/houses/${houseId}/chores`, { title: 'Lau nhà', weight: 3 })
      .expect(403);
  });

  it('weight ngoài 1–5, title rỗng và field lạ → 400', async () => {
    const { houseId, users } = await fx.houseWith(['Hùng', 'Thiện']);
    const post = (body: object) =>
      fx.as(users[0].token).post(`/api/v1/houses/${houseId}/chores`, body);
    await post({ title: 'A', weight: 6 }).expect(400);
    await post({ title: 'A', weight: 0 }).expect(400);
    await post({ title: '   ', weight: 2 }).expect(400);
    await post({ title: 'A', weight: 2, isActive: false }).expect(400);
  });

  it('người ngoài nhà không đọc được danh sách (403)', async () => {
    const { houseId } = await fx.houseWith(['Hùng', 'Thiện']);
    const outsider = await fx.user('Người lạ');
    await fx.as(outsider.token).get(`/api/v1/houses/${houseId}/chores`).expect(403);
  });

  it('PATCH đổi tên/weight/isActive; việc đã tắt bị ẩn khỏi danh sách mặc định', async () => {
    const { houseId, users } = await fx.houseWith(['Hùng', 'Thiện']);
    const admin = fx.as(users[0].token);
    const created = await admin.post(`/api/v1/houses/${houseId}/chores`, { title: 'Rửa chén', weight: 2 });
    const id = created.body.id as string;
    const patched = await admin.patch(`/api/v1/houses/${houseId}/chores/${id}`, { weight: 4, isActive: false }).expect(200);
    expect(patched.body).toMatchObject({ weight: 4, isActive: false });
    const list = await fx.as(users[1].token).get(`/api/v1/houses/${houseId}/chores`).expect(200);
    expect(list.body).toEqual([]);
    const all = await fx.as(users[1].token).get(`/api/v1/houses/${houseId}/chores?includeInactive=true`).expect(200);
    expect(all.body).toHaveLength(1);
  });

  it('PATCH choreId của nhà khác → 404 (chống IDOR)', async () => {
    const a = await fx.houseWith(['Hùng', 'Thiện']);
    const b = await fx.houseWith(['Mai', 'Quân']);
    const chore = await fx.as(b.users[0].token).post(`/api/v1/houses/${b.houseId}/chores`, { title: 'X', weight: 1 });
    await fx.as(a.users[0].token)
      .patch(`/api/v1/houses/${a.houseId}/chores/${chore.body.id}`, { title: 'Hack' })
      .expect(404);
  });
});
