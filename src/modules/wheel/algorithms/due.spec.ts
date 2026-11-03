import { describe, expect, it } from 'vitest';
import { defaultDueKey, dueOptions, isDueValid, MAX_DUE_MS, MIN_DUE_MS } from './due.js';

/** Giờ VN → UTC: 20:15 21.10.2026 (VN) = 13:15Z. */
const vn = (iso: string) => new Date(`${iso}+07:00`);

describe('isDueValid', () => {
  const now = vn('2026-10-21T20:15:00');
  it('hợp lệ trong [now + 30 phút, now + 48 giờ]', () => {
    expect(isDueValid(now, new Date(now.getTime() + MIN_DUE_MS))).toBe(true);
    expect(isDueValid(now, new Date(now.getTime() + MAX_DUE_MS))).toBe(true);
    expect(isDueValid(now, new Date(now.getTime() + MIN_DUE_MS - 1))).toBe(false);
    expect(isDueValid(now, new Date(now.getTime() + MAX_DUE_MS + 1))).toBe(false);
  });
});

describe('dueOptions', () => {
  it('4 mốc theo giờ nhà: +2 giờ, hôm nay 21:00, hết hôm nay 23:59, ngày mai 21:00', () => {
    const opts = dueOptions(vn('2026-10-21T20:15:00'));
    expect(opts.map((o) => o.key)).toEqual(['IN_2H', 'TONIGHT', 'END_OF_DAY', 'TOMORROW']);
    expect(opts.map((o) => o.dueAt.toISOString())).toEqual([
      vn('2026-10-21T22:15:00').toISOString(),
      vn('2026-10-21T21:00:00').toISOString(),
      vn('2026-10-21T23:59:00').toISOString(),
      vn('2026-10-22T21:00:00').toISOString(),
    ]);
    expect(opts.every((o) => o.valid)).toBe(true);
    expect(defaultDueKey(opts)).toBe('END_OF_DAY');
  });

  it('LW-09: 23:45 thì "hôm nay 21:00" và "hết hôm nay" không hợp lệ, có lý do; mặc định lấy mốc hợp lệ gần nhất', () => {
    const opts = dueOptions(vn('2026-10-21T23:45:00'));
    const by = Object.fromEntries(opts.map((o) => [o.key, o]));
    expect(by.TONIGHT.valid).toBe(false);
    expect(by.END_OF_DAY.valid).toBe(false);
    expect(by.END_OF_DAY.reason).toMatch(/30 phút/);
    expect(by.IN_2H.valid).toBe(true);
    expect(defaultDueKey(opts)).toBe('IN_2H');
  });

  it('20:45 thì "hôm nay 21:00" còn 15 phút nên không hợp lệ', () => {
    const by = Object.fromEntries(dueOptions(vn('2026-10-21T20:45:00')).map((o) => [o.key, o]));
    expect(by.TONIGHT.valid).toBe(false);
    expect(by.END_OF_DAY.valid).toBe(true);
  });
});
