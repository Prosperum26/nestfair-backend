import { describe, expect, it } from 'vitest';
import { type HistSlot, neutralCredits, rollingLoad } from './load.js';

const slot = (over: Partial<HistSlot>): HistSlot => ({
  weeksBack: 1,
  choreId: 'c1',
  memberId: 'a',
  weight: 2,
  source: 'ROTATION',
  ...over,
});

describe('rollingLoad', () => {
  it('cộng weight theo người trong 6 tuần có lịch gần nhất, bỏ tuần xa hơn', () => {
    const load = rollingLoad(
      [slot({ weeksBack: 1 }), slot({ weeksBack: 6, weight: 3 }), slot({ weeksBack: 7, weight: 5 })],
      ['a', 'b'],
      {},
    );
    expect(load).toEqual({ a: 5, b: 0 });
  });

  it('tính cả ca WHEEL vào tải', () => {
    expect(rollingLoad([slot({ source: 'WHEEL', weight: 4 })], ['a'], {})).toEqual({ a: 4 });
  });

  it('bỏ qua người không còn trong danh sách đủ điều kiện', () => {
    expect(rollingLoad([slot({ memberId: 'gone' })], ['a'], {})).toEqual({ a: 0 });
  });

  it('cộng tín dụng trung lập và baseline', () => {
    expect(rollingLoad([slot({})], ['a', 'b'], { credit: { b: 3 }, baseline: { a: 1 } })).toEqual({ a: 3, b: 3 });
  });
});

describe('neutralCredits', () => {
  it('người vắng cả tuần nhận tải trung bình nhà của tuần đó', () => {
    const credit = neutralCredits([
      { weeksBack: 1, loadByMember: { a: 4, b: 2 }, absentWholeWeek: new Set(['c']) },
      { weeksBack: 2, loadByMember: { a: 2, b: 2 }, absentWholeWeek: new Set(['c']) },
    ]);
    expect(credit).toEqual({ c: 5 });
  });

  it('bỏ tuần xa hơn 6 và tuần không ai vắng', () => {
    expect(
      neutralCredits([
        { weeksBack: 7, loadByMember: { a: 4 }, absentWholeWeek: new Set(['c']) },
        { weeksBack: 1, loadByMember: { a: 4 }, absentWholeWeek: new Set() },
      ]),
    ).toEqual({});
  });
});
