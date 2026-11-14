import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateSlug } from '../src/modules/listing/algorithms/slug.js';
import { createFixture } from './support/house-fixture.js';

/** Tin đóng vì đủ người tự mở lại khi nhà hết đủ người (rời, bị xóa, nâng sức chứa). */
describe('Listing reopen when the house has room again (e2e)', () => {
  let fx: Awaited<ReturnType<typeof createFixture>>;
  const DOMAIN = '@e2e-listing-reopen.nestfair.test';

  beforeAll(async () => {
    fx = await createFixture(DOMAIN);
  });
  afterAll(async () => {
    await fx.cleanup();
  });

  const row = (houseId: string) => fx.prisma.roomListing.findUniqueOrThrow({ where: { houseId } });

  /** Nhà 3 người đủ chỗ (max 3) có tin đóng với `closeReason`. */
  async function fullHouse(closeReason: 'FULL' | 'MANUAL') {
    const h = await fx.houseWith(['Hùng', 'Thiện', 'Mai']);
    await fx.prisma.house.update({ where: { id: h.houseId }, data: { maxMembers: 3 } });
    await fx.prisma.roomListing.create({
      data: {
        houseId: h.houseId,
        slug: generateSlug(),
        status: 'CLOSED',
        closeReason,
        closedAt: new Date(),
        publishedAt: new Date(),
        locationText: 'Hẻm 51 Linh Trung',
        rentPerMonth: 1_200_000,
        contactPhone: '0912345678',
      },
    });
    return h;
  }

  it('thành viên rời nhà: tin CLOSED/FULL → OPEN, xóa closeReason và closedAt', async () => {
    const h = await fullHouse('FULL');
    await fx.as(h.users[2].token).post(`/api/v1/houses/${h.houseId}/leave`).send({}).expect(200);

    const saved = await row(h.houseId);
    expect(saved).toMatchObject({ status: 'OPEN', closeReason: null, closedAt: null });
  });

  it('trưởng phòng xóa thành viên: tin cũng mở lại', async () => {
    const h = await fullHouse('FULL');
    await fx.as(h.users[0].token).delete(`/api/v1/houses/${h.houseId}/members/${h.users[1].id}`).send({}).expect(200);

    expect((await row(h.houseId)).status).toBe('OPEN');
  });

  it('nâng số người tối đa: tin đủ người mở lại', async () => {
    const h = await fullHouse('FULL');
    await fx.as(h.users[0].token).patch(`/api/v1/houses/${h.houseId}`, { maxMembers: 4 }).expect(200);

    expect((await row(h.houseId)).status).toBe('OPEN');
  });

  it('tin trưởng phòng tự đóng (MANUAL) thì giữ nguyên dù có người rời', async () => {
    const h = await fullHouse('MANUAL');
    await fx.as(h.users[2].token).post(`/api/v1/houses/${h.houseId}/leave`).send({}).expect(200);

    expect(await row(h.houseId)).toMatchObject({ status: 'CLOSED', closeReason: 'MANUAL' });
  });

  it('đổi tên nhà (không đổi sức chứa) không mở lại tin', async () => {
    const h = await fullHouse('FULL');
    await fx.as(h.users[0].token).patch(`/api/v1/houses/${h.houseId}`, { name: 'Nhà mới' }).expect(200);

    expect((await row(h.houseId)).status).toBe('CLOSED');
  });
});
