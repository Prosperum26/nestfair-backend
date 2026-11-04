import { describe, expect, it } from 'vitest';
import type { HistSlot } from './load.js';
import { type GenInput, generateWeek } from './schedule-generator.js';
import { blockChore, members, perChore, simulate } from './test-helpers.js';

const WEEK = '2026-10-05'; // T2 05.10 … CN 11.10
const input = (over: Partial<GenInput> = {}): GenInput => ({
  seed: 1,
  weekStart: WEEK,
  houseBreakDates: new Set(),
  maxSlotsPerDay: 2,
  members: members(4),
  chores: [blockChore('a', 2), blockChore('b', 3)],
  history: [],
  prevTail: {},
  pinned: [],
  ...over,
});
const SEEDS = Array.from({ length: 40 }, (_, i) => i + 1);

describe('trạng thái rỗng', () => {
  it('S-08: không có việc (hoặc chỉ việc ADHOC) → EMPTY NO_CHORES', () => {
    expect(generateWeek(input({ chores: [] }))).toMatchObject({ status: 'EMPTY', reasons: ['NO_CHORES'], slots: [] });
    const adhoc = { ...blockChore('w', 2), frequency: 'ADHOC' as const, recurrenceDays: [] };
    expect(generateWeek(input({ chores: [adhoc] }))).toMatchObject({ status: 'EMPTY', reasons: ['NO_CHORES'] });
  });

  it('không còn ai đủ điều kiện → EMPTY NO_ELIGIBLE_MEMBERS', () => {
    expect(generateWeek(input({ members: [] }))).toMatchObject({ status: 'EMPTY', reasons: ['NO_ELIGIBLE_MEMBERS'] });
  });

  it('S-23: cả tuần là ngày nghỉ nhà → EMPTY HOUSE_BREAK', () => {
    const all = new Set(['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11']);
    expect(generateWeek(input({ houseBreakDates: all }))).toMatchObject({ status: 'EMPTY', reasons: ['HOUSE_BREAK'] });
  });
});

describe('quy mô nhà', () => {
  it('S-01: 1 người, 4 việc cùng ngày → giao hết, DAILY_CAP_EXCEEDED, SOLO_HOUSE, không relaxed', () => {
    const chores = ['a', 'b', 'c', 'd'].map((id) => blockChore(id, 2));
    const res = generateWeek(input({ members: members(1), chores }));
    expect(res.slots).toHaveLength(4);
    expect(res.slots.every((s) => s.memberId === 'm1')).toBe(true);
    expect(res.reasons).toEqual(expect.arrayContaining(['SOLO_HOUSE', 'DAILY_CAP_EXCEEDED']));
    expect(res.relaxed).toBe(false);
  });

  it('S-06: 8 người, 3 việc, 6 tuần: ai nghỉ tuần này thì được ưu tiên tuần sau (ai cũng có việc, chênh ≤ 2)', () => {
    const chores = [blockChore('a', 2), blockChore('b', 3), blockChore('c', 4)];
    for (const seed of SEEDS.slice(0, 20)) {
      const { results } = simulate({ members: members(8), chores, weeks: 6, seed });
      const counts: Record<string, number> = {};
      for (const res of results) for (const s of res.slots) counts[s.memberId!] = (counts[s.memberId!] ?? 0) + 1;
      const per = Array.from({ length: 8 }, (_, i) => counts[`m${i + 1}`] ?? 0);
      expect(Math.min(...per), `seed ${seed}`).toBeGreaterThanOrEqual(1);
      expect(Math.max(...per) - Math.min(...per), `seed ${seed}`).toBeLessThanOrEqual(2);
    }
  });

  it('S-13: không ai quá số ca/ngày khi còn người khác', () => {
    const chores = [perChore('x', 1), perChore('y', 1), perChore('z', 1)];
    for (const seed of SEEDS) {
      const res = generateWeek(input({ seed, members: members(4), chores }));
      const perDay = new Map<string, number>();
      for (const s of res.slots) perDay.set(`${s.memberId}|${s.occurrenceDate}`, (perDay.get(`${s.memberId}|${s.occurrenceDate}`) ?? 0) + 1);
      expect(Math.max(...perDay.values()), `seed ${seed}`).toBeLessThanOrEqual(2);
      expect(res.reasons).not.toContain('DAILY_CAP_EXCEEDED');
    }
  });
});

describe('nới rào', () => {
  it('một việc bị cấm với cả 3 người ở cấp đầy đủ → nới 1 cấp, relaxed + FEW_OPTIONS', () => {
    const chores = [blockChore('c1', 2), blockChore('c2', 2), blockChore('c3', 2)];
    // c1: m1 làm 1 tuần trước, m2 và m3 làm 2 tuần trước → rào 3 tuần cấm c1 với cả ba người.
    const history: HistSlot[] = [
      { weeksBack: 1, choreId: 'c1', memberId: 'm1', weight: 2, source: 'ROTATION' },
      { weeksBack: 2, choreId: 'c1', memberId: 'm2', weight: 2, source: 'ROTATION' },
      { weeksBack: 2, choreId: 'c1', memberId: 'm3', weight: 2, source: 'ROTATION' },
    ];
    const res = generateWeek(input({ members: members(3), chores, history }));
    expect(res.relaxed).toBe(true);
    expect(res.relaxLevel).toBe(1);
    expect(res.reasons).toContain('FEW_OPTIONS');
    expect(res.slots.every((s) => s.memberId)).toBe(true);
    // Cấp 1 (nhìn lại 1 tuần) chỉ còn cấm m1 làm c1.
    expect(res.slots.find((s) => s.choreId === 'c1')!.memberId).not.toBe('m1');
  });

  it('Q2 (#5): ca WHEEL trong lịch sử không tính vào rào lẫn tải, lịch sinh ra như không có', () => {
    const chores = [blockChore('c1', 2), blockChore('c2', 2), blockChore('c3', 2)];
    const history: HistSlot[] = [
      { weeksBack: 1, choreId: 'c1', memberId: 'm1', weight: 2, source: 'WHEEL' },
      { weeksBack: 1, choreId: 'c2', memberId: 'm1', weight: 2, source: 'WHEEL' },
      { weeksBack: 1, choreId: 'c3', memberId: 'm1', weight: 2, source: 'WHEEL' },
    ];
    const withWheel = generateWeek(input({ members: members(3), chores, history, seed: 42 }));
    const without = generateWeek(input({ members: members(3), chores, history: [], seed: 42 }));
    expect(withWheel.relaxed).toBe(false);
    expect(withWheel.slots).toEqual(without.slots);
    expect(withWheel.loadAfter).toEqual(without.loadAfter);
  });
});

describe('vắng mặt, nghỉ nhà, ADHOC', () => {
  it('H1 / S-20: người vắng đúng ngày của ca không nhận ca đó (WEEK_BLOCK và PER_OCCURRENCE)', () => {
    const chores = [blockChore('b', 3, [3]), perChore('daily', 2)];
    for (const seed of SEEDS) {
      const res = generateWeek(input({ seed, members: members(3, { m1: ['2026-10-07', '2026-10-09'] }), chores }));
      for (const s of res.slots) {
        if (s.memberId === 'm1') expect(['2026-10-07', '2026-10-09']).not.toContain(s.occurrenceDate);
      }
      expect(res.slots.every((s) => s.memberId !== null || s.reason)).toBe(true);
    }
  });

  it('S-21: vắng cả tuần → không vào danh sách đủ điều kiện, MEMBER_ABSENT', () => {
    const week = ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11'];
    const res = generateWeek(input({ members: members(3, { m3: week }), chores: [blockChore('a', 2), blockChore('b', 2)] }));
    expect(res.slots.every((s) => s.memberId !== 'm3')).toBe(true);
    expect(res.reasons).toContain('MEMBER_ABSENT');
    expect(res.fenceWeeksApplied).toBe(2); // N = 2 người còn lại
  });

  it('không ai rảnh vào ngày đó → UNASSIGNED có lý do, không bỏ rơi im lặng', () => {
    const res = generateWeek(input({ members: members(2, { m1: ['2026-10-11'], m2: ['2026-10-11'] }), chores: [blockChore('a', 2)] }));
    expect(res.slots).toHaveLength(1);
    expect(res.slots[0].memberId).toBeNull();
    expect(res.slots[0].reason).toBeTruthy();
  });

  it('S-23: ngày nghỉ nhà không có slot', () => {
    const res = generateWeek(input({ chores: [perChore('daily', 2)], houseBreakDates: new Set(['2026-10-07', '2026-10-08']) }));
    expect(res.slots.map((s) => s.occurrenceDate)).not.toContain('2026-10-07');
    expect(res.slots).toHaveLength(5);
  });

  it('ADHOC không sinh slot', () => {
    const adhoc = { ...blockChore('w', 2), frequency: 'ADHOC' as const, recurrenceDays: [] };
    const res = generateWeek(input({ chores: [adhoc, blockChore('a', 2)] }));
    expect(res.slots.map((s) => s.choreId)).toEqual(['a']);
  });
});

describe('ghim, người mới, ràng buộc cứng', () => {
  it('R-FAIR-4 / S-42: ca ghim được giữ; vi phạm rào thì PINNED_OVERRIDE', () => {
    const history: HistSlot[] = [{ weeksBack: 1, choreId: 'a', memberId: 'm1', weight: 2, source: 'ROTATION' }];
    const res = generateWeek(
      input({ history, pinned: [{ choreId: 'a', date: '2026-10-11', memberId: 'm1', source: 'PAYBACK' }] }),
    );
    const a = res.slots.find((s) => s.choreId === 'a')!;
    expect(a.memberId).toBe('m1');
    expect(a.source).toBe('PAYBACK');
    expect(res.reasons).toContain('PINNED_OVERRIDE');
    expect(res.slots.find((s) => s.choreId === 'b')!.memberId).toBeTruthy();
  });

  it('S-17: người mới vào có tải khởi điểm bằng trung bình nhà và NEW_MEMBER', () => {
    const ms = members(3).map((m) => ({ ...m, isNew: m.id === 'm3' }));
    const history: HistSlot[] = ['m1', 'm2'].map((m) => ({ weeksBack: 1, choreId: 'x', memberId: m, weight: 10, source: 'ROTATION' as const }));
    const res = generateWeek(input({ members: ms, history, chores: [blockChore('a', 5), blockChore('b', 5), blockChore('c', 5)] }));
    expect(res.reasons).toContain('NEW_MEMBER');
    const per = ['m1', 'm2', 'm3'].map((m) => res.slots.filter((s) => s.memberId === m).length);
    expect(per).toEqual([1, 1, 1]); // người mới không bị dồn hết việc, cũng không được miễn
  });

  it('mọi slot đều đúng định dạng: ngày thuộc tuần, slotIndex 0, source ROTATION', () => {
    const res = generateWeek(input({ chores: [blockChore('a', 2, [1, 4]), perChore('d', 1, [2, 6])] }));
    for (const s of res.slots) {
      expect(s.slotIndex).toBe(0);
      expect(s.source).toBe('ROTATION');
      expect(s.occurrenceDate >= '2026-10-05' && s.occurrenceDate <= '2026-10-11').toBe(true);
    }
    expect(res.slots.map((s) => `${s.choreId}@${s.occurrenceDate}`).sort()).toEqual([
      'a@2026-10-05',
      'a@2026-10-08',
      'd@2026-10-06',
      'd@2026-10-10',
    ]);
  });

  it('WEEK_BLOCK nhiều ngày: cả khối cùng một chủ', () => {
    for (const seed of SEEDS) {
      const res = generateWeek(input({ seed, chores: [blockChore('a', 2, [1, 3, 5])] }));
      expect(new Set(res.slots.map((s) => s.memberId)).size).toBe(1);
    }
  });

  it('PER_OCCURRENCE với occurrenceGap = 2: không ai lặp trong 2 lần liền', () => {
    for (const seed of SEEDS) {
      const res = generateWeek(input({ seed, members: members(4), chores: [perChore('d', 1, [1, 2, 3, 4, 5, 6, 7], 2)] }));
      const seq = res.slots.map((s) => s.memberId);
      for (let i = 1; i < seq.length; i++) {
        expect(seq[i], `seed ${seed}`).not.toBe(seq[i - 1]);
        if (i >= 2) expect(seq[i], `seed ${seed}`).not.toBe(seq[i - 2]);
      }
    }
  });
});
