import { dueAtOf } from '../chores/week.js';
import { pickAuto, validPaybackSlots, type DebtorState, type PaybackSlot } from './payback-pick.js';

const slot = (id: string, weight: number, date: string, hhmm: string, over: Partial<PaybackSlot> = {}): PaybackSlot => ({
  id,
  choreId: `chore-${id}`,
  title: id,
  weight,
  occurrenceDate: date,
  weekStart: '2026-10-26',
  dueAt: dueAtOf(date, hhmm),
  status: 'TODO',
  source: 'ROTATION',
  ...over,
});

const clean: DebtorState = { absentDates: new Set(), sameDayKeys: new Set(), lockedIds: new Set(), weekStarts: new Set(['2026-10-26']) };
// Spec 5.4: pickDeadlineAt = 20:00 T3 27.10, ngưỡng hạn ca bù = 08:00 T4 28.10.
const deadline = dueAtOf('2026-10-27', '20:00');

const lauNha = slot('lau-nha', 3, '2026-10-30', '18:00');
const ruaChen = slot('rua-chen', 2, '2026-10-29', '21:00');
const doRac = slot('do-rac', 1, '2026-10-28', '07:30');

describe('validPaybackSlots (spec 5.4, ví dụ DoD #3)', () => {
  it('Lau nhà T6 30.10 và Rửa chén T5 29.10 hợp lệ; Đổ rác T4 28.10 07:30 bị loại vì trước 08:00 T4 28.10', () => {
    const out = validPaybackSlots([lauNha, ruaChen, doRac], deadline, clean);
    expect(out.map((s) => s.id).sort()).toEqual(['lau-nha', 'rua-chen']);
  });

  it('đúng ngưỡng 12 giờ thì hợp lệ, chậm 1 phút thì không', () => {
    const edge = slot('edge', 1, '2026-10-28', '08:00');
    const late = slot('late', 1, '2026-10-28', '07:59');
    expect(validPaybackSlots([edge, late], deadline, clean).map((s) => s.id)).toEqual(['edge']);
  });

  it('loại ca không TODO, đang bị khóa, source PAYBACK / COVER / WHEEL', () => {
    const bad = [
      slot('done', 2, '2026-10-30', '18:00', { status: 'DONE' }),
      slot('locked', 2, '2026-10-30', '18:00'),
      slot('payback', 2, '2026-10-30', '18:00', { source: 'PAYBACK' }),
      slot('cover', 2, '2026-10-30', '18:00', { source: 'COVER' }),
      slot('wheel', 2, '2026-10-30', '18:00', { source: 'WHEEL' }),
    ];
    const state = { ...clean, lockedIds: new Set(['locked']) };
    expect(validPaybackSlots([...bad, lauNha], deadline, state).map((s) => s.id)).toEqual(['lau-nha']);
  });

  it('loại ca ngoài tuần cho phép, ngày debtor vắng, và ca trùng việc cùng ngày của debtor', () => {
    const otherWeek = slot('other-week', 2, '2026-11-05', '18:00', { weekStart: '2026-11-02' });
    const state: DebtorState = {
      ...clean,
      absentDates: new Set(['2026-10-29']),
      sameDayKeys: new Set(['chore-lau-nha|2026-10-30']),
    };
    expect(validPaybackSlots([otherWeek, ruaChen, lauNha], deadline, state)).toEqual([]);
  });
});

describe('pickAuto', () => {
  const cands = validPaybackSlots([lauNha, ruaChen], deadline, clean);

  it('nợ 3 điểm chọn Lau nhà (|3−3| = 0)', () => {
    expect(pickAuto(cands, 3)).toBe('lau-nha');
  });

  it('nợ 2 điểm chọn Rửa chén', () => {
    expect(pickAuto(cands, 2)).toBe('rua-chen');
  });

  it('hòa về độ nặng thì chọn ca có dueAt muộn hơn', () => {
    const early = slot('early', 2, '2026-10-29', '10:00');
    const later = slot('later', 2, '2026-10-30', '10:00');
    expect(pickAuto([early, later], 2)).toBe('later');
  });

  it('hòa cả độ nặng lẫn dueAt thì chọn id nhỏ hơn', () => {
    const b = slot('b', 2, '2026-10-30', '10:00');
    const a = slot('a', 2, '2026-10-30', '10:00');
    expect(pickAuto([b, a], 2)).toBe('a');
  });

  it('không có ứng viên thì trả null', () => {
    expect(pickAuto([], 3)).toBeNull();
  });
});
