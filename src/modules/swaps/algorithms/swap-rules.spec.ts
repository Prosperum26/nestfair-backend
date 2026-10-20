import { dueAtOf } from '../../chores/week.js';
import { SWAP_ERRORS } from '../swap-errors.js';
import {
  escalationWindowOk,
  expiresAtFor,
  inGrace,
  isUrgentCover,
  slotSwapSource,
  tooLateToRequest,
  weightWarnings,
} from './swap-rules.js';

const at = (date: string, hhmm: string) => dueAtOf(date, hhmm);
const HOUR = 3_600_000;

describe('expiresAtFor (spec 4.5)', () => {
  const created = at('2026-10-21', '10:00'); // T4

  it('EXCHANGE: min(createdAt + 24h, min(dueAt) − 1h)', () => {
    const r = expiresAtFor('EXCHANGE', created, [at('2026-10-21', '21:00'), at('2026-10-23', '21:00')]);
    expect(r).toEqual(at('2026-10-21', '20:00'));
  });

  it('EXCHANGE: 24h cap wins when both due dates are far', () => {
    const r = expiresAtFor('EXCHANGE', created, [at('2026-10-24', '21:00'), at('2026-10-25', '21:00')]);
    expect(r).toEqual(at('2026-10-22', '10:00'));
  });

  it('COVER with ≥ 6h left: min(createdAt + 24h, dueAt − 6h)', () => {
    expect(expiresAtFor('COVER', created, [at('2026-10-25', '18:00')])).toEqual(at('2026-10-22', '10:00'));
    expect(expiresAtFor('COVER', created, [at('2026-10-21', '20:00')])).toEqual(at('2026-10-21', '14:00'));
  });

  it('COVER with < 6h left: dueAt − 1h', () => {
    const c = at('2026-10-24', '16:00');
    expect(expiresAtFor('COVER', c, [at('2026-10-24', '20:00')])).toEqual(at('2026-10-24', '19:00'));
  });

  it('PERMANENT: min(createdAt + 48h, Sunday 19:00 of the current week)', () => {
    expect(expiresAtFor('PERMANENT', created, [])).toEqual(at('2026-10-23', '10:00'));
    expect(expiresAtFor('PERMANENT', at('2026-10-24', '22:00'), [])).toEqual(at('2026-10-25', '19:00'));
  });

  it('PERMANENT created on Sunday morning uses that same Sunday 19:00', () => {
    expect(expiresAtFor('PERMANENT', at('2026-10-25', '08:00'), [])).toEqual(at('2026-10-25', '19:00'));
  });
});

describe('time guards', () => {
  it('tooLateToRequest: < 90 minutes to the earliest dueAt', () => {
    const due = at('2026-10-24', '20:00');
    expect(tooLateToRequest(at('2026-10-24', '18:45'), [due])).toBe(true);
    expect(tooLateToRequest(at('2026-10-24', '17:30'), [due])).toBe(false);
    expect(tooLateToRequest(at('2026-10-24', '18:30'), [due])).toBe(false);
  });

  it('tooLateToRequest uses the earliest of several dueAts', () => {
    const now = at('2026-10-24', '18:45');
    expect(tooLateToRequest(now, [at('2026-10-24', '20:00'), at('2026-10-26', '20:00')])).toBe(true);
  });

  it('isUrgentCover: < 6h left', () => {
    const due = at('2026-10-24', '20:00');
    expect(isUrgentCover(at('2026-10-24', '16:00'), due)).toBe(true);
    expect(isUrgentCover(at('2026-10-24', '14:00'), due)).toBe(false);
    expect(isUrgentCover(at('2026-10-24', '13:59'), due)).toBe(false);
  });

  it('escalationWindowOk: ≥ 15 minutes before dueAt − 1h', () => {
    const due = at('2026-10-24', '20:00');
    expect(escalationWindowOk(at('2026-10-24', '18:45'), due)).toBe(true);
    expect(escalationWindowOk(at('2026-10-24', '18:46'), due)).toBe(false);
  });

  it('inGrace: after dueAt and within graceHours', () => {
    const due = at('2026-10-24', '20:00');
    expect(inGrace(new Date(due.getTime() - 1), due, 2)).toBe(false);
    expect(inGrace(new Date(due.getTime() + 1), due, 2)).toBe(true);
    expect(inGrace(new Date(due.getTime() + 2 * HOUR), due, 2)).toBe(true);
    expect(inGrace(new Date(due.getTime() + 2 * HOUR + 1), due, 2)).toBe(false);
    expect(inGrace(new Date(due.getTime() + 1), due, 0)).toBe(false);
  });
});

describe('slotSwapSource (spec 4.3)', () => {
  it.each([
    ['ROTATION', { exchange: true, cover: true, payback: true }],
    ['SWAP', { exchange: true, cover: true, payback: true }],
    ['COVER', { exchange: true, cover: false, payback: false }],
    ['PAYBACK', { exchange: false, cover: false, payback: false }],
    ['REASSIGN', { exchange: true, cover: true, payback: true }],
    ['WHEEL', { exchange: false, cover: true, payback: false }],
  ] as const)('%s', (source, expected) => {
    expect(slotSwapSource(source)).toEqual(expected);
  });
});

describe('weightWarnings (W-1 … W-5)', () => {
  const none = { consecutiveDay: false, fenceRepeat: false, overDailyCap: false };
  const now = at('2026-10-21', '10:00');
  const far = at('2026-10-25', '18:00');

  it('WEIGHT_GAP when weights differ by ≥ 2, not by 1', () => {
    expect(weightWarnings({ ...none, weightA: 3, weightB: 1, now, minDueAt: far })).toContain('WEIGHT_GAP');
    expect(weightWarnings({ ...none, weightA: 1, weightB: 3, now, minDueAt: far })).toContain('WEIGHT_GAP');
    expect(weightWarnings({ ...none, weightA: 2, weightB: 1, now, minDueAt: far })).not.toContain('WEIGHT_GAP');
  });

  it('no WEIGHT_GAP for COVER (no second slot)', () => {
    expect(weightWarnings({ ...none, weightA: 5, weightB: null, now, minDueAt: far })).toEqual([]);
  });

  it('DUE_SOON when the received slot is < 6h away', () => {
    expect(weightWarnings({ ...none, weightA: 1, weightB: null, now, minDueAt: at('2026-10-21', '15:59') })).toEqual(['DUE_SOON']);
    expect(weightWarnings({ ...none, weightA: 1, weightB: null, now, minDueAt: at('2026-10-21', '16:00') })).toEqual([]);
  });

  it('passes through the precomputed flags in a stable order', () => {
    const r = weightWarnings({
      weightA: 4,
      weightB: 1,
      now,
      minDueAt: at('2026-10-21', '12:00'),
      consecutiveDay: true,
      fenceRepeat: true,
      overDailyCap: true,
    });
    expect(r).toEqual(['WEIGHT_GAP', 'FENCE_REPEAT', 'OVER_DAILY_CAP', 'CONSECUTIVE_DAY', 'DUE_SOON']);
  });
});

describe('SWAP_ERRORS (spec 9.3 and 8.7)', () => {
  it.each([
    ['SLOT_LOCKED', 409],
    ['SWAP_ALREADY_ACCEPTED', 409],
    ['SWAP_NOT_PENDING', 409],
    ['SWAP_EXPIRED', 410],
    ['SLOT_NOT_SWAPPABLE', 422],
    ['DUPLICATE_CHORE_SAME_DAY', 422],
    ['WEEK_MISMATCH', 422],
    ['WEEK_NOT_GENERATED', 422],
    ['WHEEL_NOT_EXCHANGEABLE', 422],
    ['PAYBACK_SLOT_LOCKED', 422],
    ['URGENT_MARKET_ONLY', 422],
    ['SWAP_TARGET_COOLDOWN', 422],
    ['NOT_SWAP_TARGET', 403],
    ['CANNOT_ACCEPT_OWN', 403],
    ['NOT_REQUESTER', 403],
    ['NOT_CREDITOR', 403],
    ['SWAP_PENDING_LIMIT', 429],
    ['SWAP_DAILY_LIMIT', 429],
  ])('%s → %i', (code, status) => {
    expect(SWAP_ERRORS[code]?.status).toBe(status);
  });

  it('carries the Vietnamese copy from table 8.7', () => {
    expect(SWAP_ERRORS.SLOT_LOCKED.message).toBe('Ca này đang chờ người khác trả lời.');
    expect(SWAP_ERRORS.SWAP_ALREADY_ACCEPTED.message).toBe('Ca đã có người nhận.');
    expect(SWAP_ERRORS.SWAP_EXPIRED.message).toBe('Yêu cầu đã hết hạn.');
    expect(SWAP_ERRORS.REWARD_OUT_OF_RANGE.message).toBe('Quà từ 1.000đ đến 500.000đ.');
  });

  it('never leaks a rule code into user-facing copy', () => {
    for (const [code, { message }] of Object.entries(SWAP_ERRORS)) {
      expect(message, code).not.toMatch(/R-SWAP|\bW-\d|[A-Z]{3,}_[A-Z_]+/);
      expect(message.length, code).toBeGreaterThan(0);
    }
  });
});
