import { describe, expect, it } from 'vitest';
import { type PublicListingInput, toPublicListing } from './public-listing.mapper.js';

const summary = {
  memberCount: 3,
  maxMembers: 5,
  slotsOpen: 2,
  utilities: { avgMonthlyTotal: 1_275_000, perPerson: 255_000, monthsUsed: 3 },
};

/** Các trường "mồi" mà dòng Prisma hoặc join có thể mang theo: không được lọt ra ngoài. */
const BAIT = {
  id: 'BAIT-listing-id',
  houseId: 'BAIT-house-id',
  userId: 'BAIT-user-id',
  memberId: 'BAIT-member-id',
  fullName: 'BAIT Nguyen Van A',
  email: 'bait@example.com',
  bankAccount: 'BAIT-0123456789',
  bankBin: 'BAIT-970436',
  avatarUrl: 'https://bait.example/avatar.png',
  inviteCode: 'BAITCD',
  houseName: 'BAIT-house-name',
  createdAt: new Date('2026-10-01T00:00:00Z'),
  updatedAt: new Date('2026-10-02T00:00:00Z'),
};

const open = (over: Partial<PublicListingInput['listing']> = {}): PublicListingInput => ({
  listing: {
    ...BAIT,
    slug: 'x7Kp2QmA',
    status: 'OPEN',
    closeReason: null,
    publishedAt: new Date('2026-10-04T03:00:00Z'),
    locationText: 'Hẻm 51 Linh Trung',
    genderWanted: 'ANY',
    rentPerMonth: 1_200_000,
    otherFees: [{ name: 'Wifi', amount: 60_000, ...BAIT }],
    description: 'Phòng thoáng',
    roommateExpectations: 'Sạch sẽ',
    contactPhone: '0901234567',
    showChoreSchedule: true,
    ...over,
  } as PublicListingInput['listing'],
  photos: [
    { ...BAIT, id: 'p2', category: 'BEDROOM', url: 'https://x/b2.jpg', sortOrder: 1 },
    { ...BAIT, id: 'p1', category: 'BEDROOM', url: 'https://x/b1.jpg', sortOrder: 0 },
    { ...BAIT, id: 'p3', category: 'LIVING', url: 'https://x/l.jpg', sortOrder: 0 },
  ] as PublicListingInput['photos'],
  summary,
  roster: { weekKey: '2026-W44', rows: [{ title: 'Rửa chén', cells: [['TV1'], [], [], [], [], [], []] }] },
});

describe('toPublicListing', () => {
  it('tin OPEN còn chỗ: đúng payload mục 4.3, ảnh theo nhóm, liên hệ nằm trong contact', () => {
    expect(toPublicListing(open())).toEqual({
      slug: 'x7Kp2QmA',
      status: 'OPEN',
      closeReason: null,
      publishedAt: new Date('2026-10-04T03:00:00Z'),
      locationText: 'Hẻm 51 Linh Trung',
      genderWanted: 'ANY',
      rentPerMonth: 1_200_000,
      otherFees: [{ name: 'Wifi', amount: 60_000 }],
      summary,
      // 1.200.000 + 255.000 + 60.000
      estimatedPerPerson: 1_515_000,
      description: 'Phòng thoáng',
      roommateExpectations: 'Sạch sẽ',
      photos: {
        BEDROOM: [
          { id: 'p1', url: 'https://x/b1.jpg' },
          { id: 'p2', url: 'https://x/b2.jpg' },
        ],
        BATHROOM: [],
        LIVING: [{ id: 'p3', url: 'https://x/l.jpg' }],
      },
      roster: { weekKey: '2026-W44', rows: [{ title: 'Rửa chén', cells: [['TV1'], [], [], [], [], [], []] }] },
      contact: { phone: '0901234567' },
    });
  });

  it('tin OPEN: không có trường mồi nào lọt ra (kiểm theo khóa và theo chuỗi JSON)', () => {
    const result = toPublicListing(open());
    const json = JSON.stringify(result);
    for (const key of Object.keys(BAIT)) expect(result).not.toHaveProperty(key);
    for (const value of Object.values(BAIT)) {
      if (typeof value === 'string') expect(json).not.toContain(value);
    }
    // contactPhone chỉ nằm trong contact.phone, không còn ở ngoài.
    expect(result).not.toHaveProperty('contactPhone');
    expect(result).not.toHaveProperty('showChoreSchedule');
  });

  it('ảnh và phí khác chỉ giữ trường công khai (id, url / name, amount)', () => {
    const result = toPublicListing(open());
    if (result.status !== 'OPEN') throw new Error('expected OPEN');
    expect(Object.keys(result.photos.BEDROOM[0]).sort()).toEqual(['id', 'url']);
    expect(Object.keys(result.otherFees[0]).sort()).toEqual(['amount', 'name']);
  });

  it('chưa có điện nước: estimatedPerPerson chỉ gồm tiền thuê và phí khác', () => {
    const input = open();
    input.summary = { ...summary, utilities: { avgMonthlyTotal: null, perPerson: null, monthsUsed: 0 } };
    const result = toPublicListing(input);
    if (result.status !== 'OPEN') throw new Error('expected OPEN');
    expect(result.estimatedPerPerson).toBe(1_260_000);
  });

  it('roster null được giữ nguyên', () => {
    const input = open();
    input.roster = null;
    const result = toPublicListing(input);
    if (result.status !== 'OPEN') throw new Error('expected OPEN');
    expect(result.roster).toBeNull();
  });

  it('tin CLOSED: bản rút gọn đúng 5 khóa, không có liên hệ, lịch, ảnh, giá', () => {
    const input = open({ status: 'CLOSED', closeReason: 'MANUAL' });
    input.summary = null;
    const result = toPublicListing(input);

    expect(Object.keys(result).sort()).toEqual(['closeReason', 'coverUrl', 'locationText', 'slug', 'status']);
    expect(result).toEqual({
      slug: 'x7Kp2QmA',
      status: 'CLOSED',
      closeReason: 'MANUAL',
      locationText: 'Hẻm 51 Linh Trung',
      coverUrl: 'https://x/b1.jpg',
    });
    expect(JSON.stringify(result)).not.toContain('0901234567');
  });

  it('coverUrl là ảnh Phòng ngủ đứng đầu; không có ảnh Phòng ngủ thì null', () => {
    const input = open({ status: 'CLOSED', closeReason: 'FULL' });
    input.photos = input.photos.filter((p) => p.category !== 'BEDROOM');
    expect(toPublicListing(input)).toMatchObject({ coverUrl: null });
  });

  it('tin OPEN nhưng nhà đã đủ người (lớp phòng thủ): bản rút gọn CLOSED/FULL', () => {
    const input = open();
    input.summary = { ...summary, memberCount: 5, slotsOpen: 0 };
    const result = toPublicListing(input);

    expect(Object.keys(result).sort()).toEqual(['closeReason', 'coverUrl', 'locationText', 'slug', 'status']);
    expect(result).toMatchObject({ status: 'CLOSED', closeReason: 'FULL' });
  });

  it('tin DRAFT không bao giờ được đưa ra công khai', () => {
    expect(() => toPublicListing(open({ status: 'DRAFT' }))).toThrow();
  });
});
