import { randomInt } from 'node:crypto';
import { fisherYates, mulberry32 } from '../../chores/algorithms/rng.js';

/** Hàm sinh số nguyên ngẫu nhiên trong [min, max). Mặc định `crypto.randomInt` (an toàn mật mã). */
export type RandInt = (min: number, max: number) => number;

/** Số lát tối thiểu trên vòng để bánh xe trông đầy đặn (ảnh thiết kế 17: 4 người × 2 lát). */
const MIN_SLICES = 8;

/**
 * Người trúng do server chọn bằng `crypto.randomInt` (đặc tả #5, Q5). Cấm `Math.random()`.
 * Client không bao giờ gửi người trúng.
 */
export function pickWinner(participantIds: readonly string[], rand: RandInt = randomInt): string {
  if (participantIds.length < 2) throw new Error('Cần ít nhất 2 người tham gia');
  return participantIds[rand(0, participantIds.length)];
}

/**
 * Thứ tự lát trên vòng (userId, có lặp). Mỗi người `ceil(8 / n)` lát (2 → 8, 3 → 9, 4 → 8, 5 → 10, ≥ 8 → mỗi
 * người 1 lát). Mỗi "vòng nhỏ" là một hoán vị Fisher-Yates theo `seed`,
 * nối sao cho không có hai lát cạnh nhau cùng người, kể cả chỗ nối cuối → đầu.
 * Seed chỉ quyết định cách xếp lát để vẽ, KHÔNG quyết định người trúng.
 */
export function buildSlices(participantIds: readonly string[], seed: number): string[] {
  const k = Math.ceil(MIN_SLICES / participantIds.length);
  const rnd = mulberry32(seed);
  let out: string[] = [];
  for (let attempt = 0; attempt < 50; attempt++) {
    out = [];
    for (let r = 0; r < k; r++) {
      const round = fisherYates(participantIds, rnd);
      // Đầu vòng nhỏ trùng cuối vòng trước: đổi chỗ hai phần tử đầu (các phần tử trong một vòng nhỏ đều khác nhau).
      if (out.length > 0 && round[0] === out[out.length - 1]) [round[0], round[1]] = [round[1], round[0]];
      out.push(...round);
    }
    if (out[0] !== out[out.length - 1]) return out;
  }
  return out;
}

/** Lát kim dừng lại: một lát ngẫu nhiên (crypto) trong các lát của người trúng. */
export function pickLandingIndex(slices: readonly string[], winnerId: string, rand: RandInt = randomInt): number {
  const indexes = slices.flatMap((s, i) => (s === winnerId ? [i] : []));
  if (indexes.length === 0) throw new Error('Người trúng không có lát nào trên vòng');
  return indexes[rand(0, indexes.length)];
}
