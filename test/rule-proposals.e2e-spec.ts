import { createFixture } from './support/house-fixture.js';

// Cần Postgres đang chạy (npm run db:up) và .env hợp lệ.
const DOMAIN = '@e2e-rule-proposals.nestfair.test';

describe('Đề xuất nội quy (e2e)', () => {
  let fx: Awaited<ReturnType<typeof createFixture>>;

  beforeAll(async () => {
    fx = await createFixture(DOMAIN);
  });
  afterAll(() => fx.cleanup());

  /** Nhà 3 người (Hùng là trưởng phòng) với nội quy có sẵn. */
  async function house(rules = '1. Giữ yên lặng sau 23h\n2. Rửa chén ngay') {
    const h = await fx.houseWith(['Hùng', 'Thiện', 'Mai']);
    const [hung, thien, mai] = h.users;
    await fx.as(hung.token).patch(`/api/v1/houses/${h.houseId}`, { rules }).expect(200);
    const base = `/api/v1/houses/${h.houseId}/rule-proposals`;
    return { ...h, hung, thien, mai, base };
  }
  const rulesOf = async (houseId: string) =>
    (await fx.prisma.house.findUniqueOrThrow({ where: { id: houseId } })).rules;

  it('thành viên đề xuất thêm điều mới, cả nhà thấy, trưởng phòng duyệt thì nội quy cập nhật', async () => {
    const h = await house();
    const created = await fx
      .as(h.thien.token)
      .post(h.base, { kind: 'ADD', content: '  Khách ở qua đêm báo trước ', reason: 'Hay có khách' })
      .expect(201);
    expect(created.body).toMatchObject({
      kind: 'ADD',
      content: 'Khách ở qua đêm báo trước',
      reason: 'Hay có khách',
      status: 'PENDING',
      proposer: { userId: h.thien.id, fullName: 'Thiện' },
    });

    const list = await fx.as(h.mai.token).get(h.base).expect(200);
    expect(list.body.map((p: { id: string }) => p.id)).toEqual([created.body.id]);

    const approved = await fx.as(h.hung.token).post(`${h.base}/${created.body.id}/approve`).expect(200);
    expect(approved.body.status).toBe('APPROVED');
    expect(await rulesOf(h.houseId)).toBe('1. Giữ yên lặng sau 23h\n2. Rửa chén ngay\nKhách ở qua đêm báo trước');
  });

  it('đề xuất sửa và bỏ một điều theo nội dung, bỏ qua số thứ tự gõ tay', async () => {
    const h = await house();
    const edit = await fx
      .as(h.thien.token)
      .post(h.base, { kind: 'EDIT', targetText: 'Rửa chén ngay', content: 'Rửa chén trong 30 phút' })
      .expect(201);
    const remove = await fx.as(h.mai.token).post(h.base, { kind: 'REMOVE', targetText: 'Giữ yên lặng sau 23h' }).expect(201);

    await fx.as(h.hung.token).post(`${h.base}/${edit.body.id}/approve`).expect(200);
    await fx.as(h.hung.token).post(`${h.base}/${remove.body.id}/approve`).expect(200);
    expect(await rulesOf(h.houseId)).toBe('Rửa chén trong 30 phút');
  });

  it('trưởng phòng không đề xuất (sửa trực tiếp), thành viên không duyệt / từ chối được', async () => {
    const h = await house();
    const res = await fx.as(h.hung.token).post(h.base, { kind: 'ADD', content: 'Điều mới' }).expect(403);
    expect(res.body.code).toBe('ADMIN_EDITS_DIRECTLY');

    const p = await fx.as(h.thien.token).post(h.base, { kind: 'ADD', content: 'Điều mới' }).expect(201);
    await fx.as(h.mai.token).post(`${h.base}/${p.body.id}/approve`).expect(403);
    await fx.as(h.thien.token).post(`${h.base}/${p.body.id}/reject`, {}).expect(403);
  });

  it.each([
    ['ADD thiếu nội dung', { kind: 'ADD' }],
    ['EDIT thiếu điều cần sửa', { kind: 'EDIT', content: 'x' }],
    ['EDIT nội dung không đổi', { kind: 'EDIT', targetText: 'Rửa chén ngay', content: 'Rửa chén ngay' }],
    ['điều cần sửa không có trong nội quy', { kind: 'REMOVE', targetText: 'Không hút thuốc' }],
    ['loại lạ', { kind: 'REPLACE_ALL', content: 'x' }],
    ['nội dung quá 200 ký tự', { kind: 'ADD', content: 'a'.repeat(201) }],
    ['trường lạ', { kind: 'ADD', content: 'x', status: 'APPROVED' }],
  ])('%s thì 400', async (_, body) => {
    const h = await house();
    await fx.as(h.thien.token).post(h.base, body).expect(400);
  });

  it('tối đa 3 đề xuất đang chờ mỗi người; rút lại thì đề xuất tiếp được', async () => {
    const h = await house();
    const ids: string[] = [];
    for (const n of [1, 2, 3]) {
      ids.push((await fx.as(h.thien.token).post(h.base, { kind: 'ADD', content: `Điều ${n}` }).expect(201)).body.id);
    }
    const res = await fx.as(h.thien.token).post(h.base, { kind: 'ADD', content: 'Điều 4' }).expect(409);
    expect(res.body.code).toBe('TOO_MANY_PENDING');
    // Người khác vẫn đề xuất được.
    await fx.as(h.mai.token).post(h.base, { kind: 'ADD', content: 'Điều của Mai' }).expect(201);

    await fx.as(h.mai.token).delete(`${h.base}/${ids[0]}`).expect(403);
    const withdrawn = await fx.as(h.thien.token).delete(`${h.base}/${ids[0]}`).expect(200);
    expect(withdrawn.body.status).toBe('WITHDRAWN');
    await fx.as(h.thien.token).post(h.base, { kind: 'ADD', content: 'Điều 4' }).expect(201);
  });

  it('trưởng phòng đã sửa điều đó trước khi duyệt thì 409 RULE_CHANGED, đề xuất vẫn chờ', async () => {
    const h = await house();
    const p = await fx.as(h.thien.token).post(h.base, { kind: 'REMOVE', targetText: 'Rửa chén ngay' }).expect(201);
    await fx.as(h.hung.token).patch(`/api/v1/houses/${h.houseId}`, { rules: 'Giữ yên lặng sau 22h' }).expect(200);

    const res = await fx.as(h.hung.token).post(`${h.base}/${p.body.id}/approve`).expect(409);
    expect(res.body.code).toBe('RULE_CHANGED');
    const row = await fx.prisma.ruleProposal.findUniqueOrThrow({ where: { id: p.body.id } });
    expect(row.status).toBe('PENDING');
    // Từ chối kèm lý do vẫn được.
    const rejected = await fx.as(h.hung.token).post(`${h.base}/${p.body.id}/reject`, { reason: 'Đã sửa rồi' }).expect(200);
    expect(rejected.body).toMatchObject({ status: 'REJECTED', rejectReason: 'Đã sửa rồi' });
  });

  it('đề xuất đã xử lý thì duyệt / từ chối / rút lại lần nữa đều 409', async () => {
    const h = await house();
    const p = await fx.as(h.thien.token).post(h.base, { kind: 'ADD', content: 'Điều mới' }).expect(201);
    await fx.as(h.hung.token).post(`${h.base}/${p.body.id}/reject`, {}).expect(200);

    await fx.as(h.hung.token).post(`${h.base}/${p.body.id}/approve`).expect(409);
    await fx.as(h.hung.token).post(`${h.base}/${p.body.id}/reject`, {}).expect(409);
    await fx.as(h.thien.token).delete(`${h.base}/${p.body.id}`).expect(409);
  });

  it('bấm duyệt 2 lần cùng lúc: nội quy chỉ thêm 1 lần', async () => {
    const h = await house('Rửa chén ngay');
    const p = await fx.as(h.thien.token).post(h.base, { kind: 'ADD', content: 'Điều mới' }).expect(201);
    const results = await Promise.all([1, 2].map(() => fx.as(h.hung.token).post(`${h.base}/${p.body.id}/approve`)));
    expect(results.map((r) => r.status).sort((a, b) => a - b)).toEqual([200, 409]);
    expect(await rulesOf(h.houseId)).toBe('Rửa chén ngay\nĐiều mới');
  });

  it('đề xuất của nhà khác thì 404 (chống IDOR)', async () => {
    const a = await house();
    const b = await house();
    const p = await fx.as(b.thien.token).post(b.base, { kind: 'ADD', content: 'Điều nhà B' }).expect(201);
    await fx.as(a.hung.token).post(`${a.base}/${p.body.id}/approve`).expect(404);
    await fx.as(a.hung.token).post(`${b.base}/${p.body.id}/approve`).expect(403);
    expect(await rulesOf(b.houseId)).toBe('1. Giữ yên lặng sau 23h\n2. Rửa chén ngay');
  });
});
