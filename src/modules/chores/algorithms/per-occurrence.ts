import { fisherYates } from './rng.js';

interface Params {
  memberIds: readonly string[];
  /** Số lần việc xảy ra trong tuần. */
  length: number;
  /** Người làm lần cuối của tuần trước (liên tục xuyên tuần). */
  prev: string | null;
  load: Record<string, number>;
  /** Cùng người không làm lại trong `gap` lần kế tiếp. */
  gap: number;
  rnd: () => number;
}

const MAX_SHUFFLES = 50;

/** Chọn `count` người tải thấp nhất (hòa thì ngẫu nhiên), nếu được thì loại `exclude`. */
function lowestLoad(ids: readonly string[], count: number, load: Record<string, number>, exclude: string | null, rnd: () => number) {
  const ranked = fisherYates(ids, rnd).sort((a, b) => {
    const ex = Number(a === exclude) - Number(b === exclude);
    return ex !== 0 ? ex : (load[a] ?? 0) - (load[b] ?? 0);
  });
  return ranked.slice(0, count);
}

/** `block` có làm ai đó lặp lại trong `gap` vị trí liền trước (tính cả `context`)? */
function violatesGap(context: readonly string[], block: readonly string[], gap: number): boolean {
  const all = [...context, ...block];
  for (let i = context.length; i < all.length; i++) {
    for (let j = 1; j <= gap && i - j >= 0; j++) if (all[i] === all[i - j]) return true;
  }
  return false;
}

/**
 * Chuỗi người làm cho việc `PER_OCCURRENCE`: nối các khối hoán vị Fisher-Yates (mỗi người đúng 1 lần
 * mỗi khối), hoán đổi ở biên khối để không ai làm hai lần liên tiếp. Khối dở cuối (length mod N)
 * giao cho những người có tải tích lũy thấp nhất.
 */
export function blockSequence({ memberIds, length, prev, load, gap, rnd }: Params): string[] {
  const n = memberIds.length;
  if (n === 0 || length <= 0) return [];
  if (n === 1) return Array<string>(length).fill(memberIds[0]);

  const fullBlocks = Math.floor(length / n);
  const rest = length % n;
  const seq: string[] = [];
  const context = () => (seq.length > 0 ? seq : prev ? [prev] : []);
  // Người sẽ nhận ca dư: khối đủ cuối cùng không nên kết thúc bằng họ (tránh dính liền với khối dở).
  const extras = rest > 0 && fullBlocks > 0 ? lowestLoad(memberIds, rest, load, null, rnd) : [];

  for (let b = 0; b < fullBlocks; b++) {
    const isLastFull = b === fullBlocks - 1;
    const acceptable = (block: string[], strict: boolean) =>
      !violatesGap(context(), block, gap) && !(strict && isLastFull && extras.includes(block.at(-1)!));
    let block = fisherYates(memberIds, rnd);
    for (const strict of [true, false]) {
      for (let t = 0; t < MAX_SHUFFLES && !acceptable(block, strict); t++) block = fisherYates(memberIds, rnd);
      if (acceptable(block, strict)) break;
    }
    // Phương án cuối: đưa một người khác `prev` lên đầu khối.
    const last = context().at(-1);
    if (block[0] === last) {
      const k = block.findIndex((x) => x !== last);
      if (k > 0) [block[0], block[k]] = [block[k], block[0]];
    }
    seq.push(...block);
  }

  if (rest > 0) {
    const last = context().at(-1) ?? null;
    let block = fisherYates(fullBlocks > 0 ? extras : lowestLoad(memberIds, rest, load, last, rnd), rnd);
    for (let t = 0; t < MAX_SHUFFLES && violatesGap(context(), block, gap); t++) block = fisherYates(block, rnd);
    if (block[0] === last) {
      const k = block.findIndex((x) => x !== last);
      if (k > 0) [block[0], block[k]] = [block[k], block[0]];
      else block = lowestLoad(memberIds, rest, load, last, rnd);
    }
    seq.push(...block);
  }
  return seq;
}
