import { describe, expect, it } from 'vitest';
import { averageUtilities, estimateTotal, perPersonShare, previousMonthKeys } from './pricing.js';

describe('previousMonthKeys', () => {
  it('ba tháng đã khép trước tháng hiện tại, mới nhất trước', () => {
    expect(previousMonthKeys(new Date('2026-10-30T10:00:00+07:00'))).toEqual([
      '2026-09',
      '2026-08',
      '2026-07',
    ]);
  });

  it('nửa đêm giờ VN: 00:30 ngày 01.11 đã là tháng 11', () => {
    const now = new Date('2026-11-01T00:30:00+07:00');
    expect(now.toISOString()).toBe('2026-10-31T17:30:00.000Z');
    expect(previousMonthKeys(now)).toEqual(['2026-10', '2026-09', '2026-08']);
  });

  it('qua năm', () => {
    expect(previousMonthKeys(new Date('2026-01-15T10:00:00+07:00'))).toEqual([
      '2025-12',
      '2025-11',
      '2025-10',
    ]);
  });

  it('tham số count', () => {
    expect(previousMonthKeys(new Date('2026-03-15T10:00:00+07:00'), 1)).toEqual(['2026-02']);
    expect(previousMonthKeys(new Date('2026-03-15T10:00:00+07:00'), 5)).toEqual([
      '2026-02',
      '2026-01',
      '2025-12',
      '2025-11',
      '2025-10',
    ]);
  });
});

describe('averageUtilities', () => {
  const now = new Date('2026-10-30T10:00:00+07:00');
  const e = (iso: string, totalAmount: number) => ({ spentAt: new Date(iso), totalAmount });

  it('trung bình ba tháng', () => {
    const expenses = [
      e('2026-09-10T10:00:00+07:00', 1_200_000),
      e('2026-08-10T10:00:00+07:00', 1_350_000),
      e('2026-07-10T10:00:00+07:00', 1_275_000),
    ];
    expect(averageUtilities(expenses, now)).toEqual({ avgMonthlyTotal: 1_275_000, monthsUsed: 3 });
  });

  it('cộng nhiều khoản trong cùng một tháng (điện + nước)', () => {
    const expenses = [
      e('2026-09-05T10:00:00+07:00', 900_000),
      e('2026-09-20T10:00:00+07:00', 300_000),
      e('2026-08-10T10:00:00+07:00', 1_350_000),
    ];
    expect(averageUtilities(expenses, now)).toEqual({ avgMonthlyTotal: 1_275_000, monthsUsed: 2 });
  });

  it('chỉ hai tháng có dữ liệu: trung bình hai tháng', () => {
    const expenses = [
      e('2026-09-10T10:00:00+07:00', 1_000_000),
      e('2026-07-10T10:00:00+07:00', 2_000_000),
    ];
    expect(averageUtilities(expenses, now)).toEqual({ avgMonthlyTotal: 1_500_000, monthsUsed: 2 });
  });

  it('không có dữ liệu → null và monthsUsed = 0', () => {
    expect(averageUtilities([], now)).toEqual({ avgMonthlyTotal: null, monthsUsed: 0 });
  });

  it('làm tròn trung bình về số nguyên', () => {
    const expenses = [
      e('2026-09-10T10:00:00+07:00', 1_000_001),
      e('2026-08-10T10:00:00+07:00', 1_000_000),
    ];
    expect(averageUtilities(expenses, now)).toEqual({ avgMonthlyTotal: 1_000_001, monthsUsed: 2 });
    expect(Number.isInteger(averageUtilities(expenses, now).avgMonthlyTotal)).toBe(true);
  });

  it('khoản chi 00:30 ngày 01.10 giờ VN không tính vào tháng 9', () => {
    const edge = e('2026-09-30T17:30:00Z', 5_000_000);
    expect(new Date(edge.spentAt).toISOString()).toBe('2026-09-30T17:30:00.000Z');
    expect(averageUtilities([edge], now)).toEqual({ avgMonthlyTotal: null, monthsUsed: 0 });
  });

  it('khoản chi 23:30 ngày 30.09 giờ VN vẫn là tháng 9', () => {
    expect(averageUtilities([e('2026-09-30T16:30:00Z', 800_000)], now)).toEqual({
      avgMonthlyTotal: 800_000,
      monthsUsed: 1,
    });
  });

  it('khoản chi trong tháng hiện tại không tính', () => {
    expect(averageUtilities([e('2026-10-05T10:00:00+07:00', 999_999)], now)).toEqual({
      avgMonthlyTotal: null,
      monthsUsed: 0,
    });
  });

  it('khoản chi quá ba tháng không tính', () => {
    expect(averageUtilities([e('2026-06-10T10:00:00+07:00', 999_999)], now)).toEqual({
      avgMonthlyTotal: null,
      monthsUsed: 0,
    });
  });

  it('bỏ tháng có tổng bằng 0', () => {
    expect(averageUtilities([e('2026-09-10T10:00:00+07:00', 0)], now)).toEqual({
      avgMonthlyTotal: null,
      monthsUsed: 0,
    });
  });
});

describe('perPersonShare', () => {
  it('chia cho maxMembers', () => {
    expect(perPersonShare(1_275_000, 5)).toBe(255_000);
  });

  it('làm tròn lên khi lẻ (nửa làm tròn lên)', () => {
    expect(perPersonShare(1_000_001, 3)).toBe(333_334);
  });

  it('null khi chưa có dữ liệu', () => {
    expect(perPersonShare(null, 5)).toBeNull();
  });
});

describe('estimateTotal', () => {
  it('tiền phòng + điện nước mỗi người + phí khác', () => {
    expect(
      estimateTotal({
        rentPerMonth: 1_200_000,
        utilitiesPerPerson: 255_000,
        otherFees: [{ amount: 60_000 }, { amount: 100_000 }],
      }),
    ).toBe(1_615_000);
  });

  it('chưa có điện nước thì tính 0', () => {
    expect(
      estimateTotal({
        rentPerMonth: 1_200_000,
        utilitiesPerPerson: null,
        otherFees: [{ amount: 60_000 }, { amount: 100_000 }],
      }),
    ).toBe(1_360_000);
  });

  it('không có phí khác', () => {
    expect(estimateTotal({ rentPerMonth: 1_000_000, utilitiesPerPerson: null, otherFees: [] })).toBe(
      1_000_000,
    );
  });
});
