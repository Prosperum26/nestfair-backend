import { monthKeyOf } from '../../expenses/month.js';

/** `count` khóa tháng (giờ VN) ngay trước tháng chứa `now`, tháng mới nhất đứng trước. */
export function previousMonthKeys(now: Date, count = 3): string[] {
  const [year, month] = monthKeyOf(now).split('-').map(Number);
  const keys: string[] = [];
  for (let i = 1; i <= count; i++) {
    const index = year * 12 + (month - 1) - i;
    const y = Math.floor(index / 12);
    keys.push(`${y}-${String((index % 12) + 1).padStart(2, '0')}`);
  }
  return keys;
}

/**
 * Trung bình tổng điện nước theo tháng trong cửa sổ `previousMonthKeys(now)`.
 * Chỉ tính tháng có dữ liệu (tổng > 0); tháng hiện tại và tháng cũ hơn cửa sổ bị bỏ.
 */
export function averageUtilities(
  expenses: { spentAt: Date; totalAmount: number }[],
  now: Date,
): { avgMonthlyTotal: number | null; monthsUsed: number } {
  const totals = new Map<string, number>(previousMonthKeys(now).map((key) => [key, 0]));
  for (const { spentAt, totalAmount } of expenses) {
    const key = monthKeyOf(spentAt);
    const current = totals.get(key);
    if (current !== undefined) totals.set(key, current + totalAmount);
  }
  const monthly = [...totals.values()].filter((total) => total > 0);
  if (monthly.length === 0) return { avgMonthlyTotal: null, monthsUsed: 0 };
  const sum = monthly.reduce((a, b) => a + b, 0);
  return { avgMonthlyTotal: Math.round(sum / monthly.length), monthsUsed: monthly.length };
}

/** Phần mỗi người khi nhà đủ `maxMembers` người; `null` khi chưa có dữ liệu. */
export function perPersonShare(avgMonthlyTotal: number | null, maxMembers: number): number | null {
  return avgMonthlyTotal === null ? null : Math.round(avgMonthlyTotal / maxMembers);
}

/** Ước tính một người trả mỗi tháng: tiền phòng + điện nước + phí khác. */
export function estimateTotal(input: {
  rentPerMonth: number;
  utilitiesPerPerson: number | null;
  otherFees: { amount: number }[];
}): number {
  const fees = input.otherFees.reduce((sum, fee) => sum + fee.amount, 0);
  return input.rentPerMonth + (input.utilitiesPerPerson ?? 0) + fees;
}
