import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { anonymousLabels, buildRoster, type RosterSlot } from './roster.js';

const LISTING = 'listing-1';
// Thứ Hai 2026-10-26 → Chủ Nhật 2026-11-01.
const WEEK_START = '2026-10-26';
const WEEK_KEY = '2026-W44';
const MEMBERS = ['member-a', 'member-b', 'member-c', 'member-d'];

const slot = (over: Partial<RosterSlot> = {}): RosterSlot => ({
  choreId: 'chore-dishes',
  title: 'Rửa chén',
  occurrenceDate: '2026-10-26',
  slotIndex: 0,
  assigneeId: 'member-a',
  status: 'TODO',
  source: 'ROTATION',
  ...over,
});

const build = (slots: RosterSlot[], activeMemberIds = MEMBERS, listingId = LISTING) =>
  buildRoster({ listingId, weekKey: WEEK_KEY, weekStart: WEEK_START, activeMemberIds, slots });

describe('anonymousLabels', () => {
  it('nhãn liên tục TV1..TVn, mỗi người một nhãn', () => {
    const labels = anonymousLabels(LISTING, MEMBERS);
    expect([...labels.keys()].sort()).toEqual([...MEMBERS].sort());
    expect([...labels.values()].sort()).toEqual(['TV1', 'TV2', 'TV3', 'TV4']);
  });

  it('xác định: cùng đầu vào cho cùng nhãn, không phụ thuộc thứ tự mảng truyền vào', () => {
    const a = anonymousLabels(LISTING, MEMBERS);
    const b = anonymousLabels(LISTING, [...MEMBERS].reverse());
    expect([...a.entries()].sort()).toEqual([...b.entries()].sort());
  });

  it('thứ tự nhãn là thứ tự tăng dần của sha256(listingId:memberId)', () => {
    const labels = anonymousLabels(LISTING, MEMBERS);
    const sorted = [...MEMBERS].sort((x, y) => {
      const hx = createHash('sha256').update(`${LISTING}:${x}`).digest('hex');
      const hy = createHash('sha256').update(`${LISTING}:${y}`).digest('hex');
      return hx < hy ? -1 : 1;
    });
    expect(sorted.map((id) => labels.get(id))).toEqual(['TV1', 'TV2', 'TV3', 'TV4']);
  });

  it('đổi listingId thì thứ tự nhãn đổi (thử nhiều listing, ít nhất một thứ tự khác)', () => {
    const base = anonymousLabels(LISTING, MEMBERS);
    const differs = ['l-2', 'l-3', 'l-4', 'l-5', 'l-6'].some((id) => {
      const other = anonymousLabels(id, MEMBERS);
      return MEMBERS.some((m) => other.get(m) !== base.get(m));
    });
    expect(differs).toBe(true);
  });

  it('không sắp theo thứ tự truyền vào (không suy ra ai vào nhà trước)', () => {
    // Thử 20 listing: nhãn của người đầu danh sách không luôn là TV1.
    const first = new Set(
      Array.from({ length: 20 }, (_, i) => anonymousLabels(`l-${i}`, MEMBERS).get(MEMBERS[0])),
    );
    expect(first.size).toBeGreaterThan(1);
  });

  it('danh sách rỗng → Map rỗng', () => {
    expect(anonymousLabels(LISTING, []).size).toBe(0);
  });
});

describe('buildRoster', () => {
  const label = (id: string) => anonymousLabels(LISTING, MEMBERS).get(id)!;

  it('một ca → một dòng, bảy ô, nhãn ở đúng ngày (Thứ Hai = ô 0)', () => {
    const roster = build([slot()]);
    expect(roster).toEqual({
      weekKey: WEEK_KEY,
      rows: [{ title: 'Rửa chén', cells: [[label('member-a')], [], [], [], [], [], []] }],
    });
  });

  it('Chủ Nhật rơi vào cells[6]; Thứ Bảy vào cells[5]', () => {
    const roster = build([
      slot({ occurrenceDate: '2026-11-01', assigneeId: 'member-b' }),
      slot({ occurrenceDate: '2026-10-31', assigneeId: 'member-c', slotIndex: 0 }),
    ]);
    const cells = roster!.rows[0].cells;
    expect(cells).toHaveLength(7);
    expect(cells[6]).toEqual([label('member-b')]);
    expect(cells[5]).toEqual([label('member-c')]);
  });

  it('hai ca cùng việc cùng ngày ra hai nhãn sắp theo slotIndex', () => {
    const roster = build([
      slot({ slotIndex: 1, assigneeId: 'member-c' }),
      slot({ slotIndex: 0, assigneeId: 'member-b' }),
    ]);
    expect(roster!.rows[0].cells[0]).toEqual([label('member-b'), label('member-c')]);
  });

  it('nhiều việc → mỗi việc một dòng, sắp theo tên việc cho kết quả ổn định', () => {
    const roster = build([
      slot({ choreId: 'c2', title: 'Rác', assigneeId: 'member-b' }),
      slot({ choreId: 'c1', title: 'Nấu cơm', assigneeId: 'member-a' }),
      slot({ choreId: 'c2', title: 'Rác', occurrenceDate: '2026-10-28', assigneeId: 'member-c' }),
    ]);
    expect(roster!.rows.map((r) => r.title)).toEqual(['Nấu cơm', 'Rác']);
    expect(roster!.rows[1].cells[0]).toEqual([label('member-b')]);
    expect(roster!.rows[1].cells[2]).toEqual([label('member-c')]);
  });

  it('loại ca CANCELLED và UNASSIGNED', () => {
    expect(build([slot({ status: 'CANCELLED' })])).toBeNull();
    expect(build([slot({ status: 'UNASSIGNED' })])).toBeNull();
  });

  it('giữ ca đã làm, quá hạn, chờ duyệt, bị từ chối (vẫn là lịch của tuần)', () => {
    const roster = build(
      (['TODO', 'PENDING_VERIFY', 'DONE', 'REJECTED', 'MISSED'] as const).map((status, i) =>
        slot({ status, occurrenceDate: `2026-10-${26 + i}`, assigneeId: 'member-a' }),
      ),
    );
    expect(roster!.rows[0].cells.slice(0, 5).every((c) => c.length === 1)).toBe(true);
  });

  it('loại ca không có người (assigneeId null)', () => {
    expect(build([slot({ assigneeId: null })])).toBeNull();
  });

  it('loại ca do Vòng quay sinh ra (source WHEEL), giữ các nguồn khác', () => {
    expect(build([slot({ source: 'WHEEL' })])).toBeNull();
    for (const source of ['ROTATION', 'SWAP', 'COVER', 'PAYBACK', 'REASSIGN'] as const) {
      expect(build([slot({ source })])).not.toBeNull();
    }
  });

  it('loại ca của người không còn ở trong nhà (không thuộc activeMemberIds)', () => {
    expect(build([slot({ assigneeId: 'member-gone' })])).toBeNull();
    const roster = build([slot({ assigneeId: 'member-gone' }), slot({ slotIndex: 1, assigneeId: 'member-b' })]);
    expect(roster!.rows[0].cells[0]).toEqual([label('member-b')]);
  });

  it('bỏ ca ngoài tuần đang xét', () => {
    expect(build([slot({ occurrenceDate: '2026-10-25' }), slot({ occurrenceDate: '2026-11-02' })])).toBeNull();
  });

  it('không có ca nào → null; một việc chỉ còn ca bị loại thì dòng đó biến mất', () => {
    expect(build([])).toBeNull();
    const roster = build([
      slot({ choreId: 'c1', title: 'Nấu cơm' }),
      slot({ choreId: 'c2', title: 'Rác', source: 'WHEEL' }),
    ]);
    expect(roster!.rows.map((r) => r.title)).toEqual(['Nấu cơm']);
  });

  it('nhãn không phụ thuộc trạng thái hay thứ tự ca: cùng người luôn cùng nhãn ở mọi dòng', () => {
    const roster = build([
      slot({ choreId: 'c1', title: 'A', assigneeId: 'member-d' }),
      slot({ choreId: 'c2', title: 'B', assigneeId: 'member-d', occurrenceDate: '2026-10-30' }),
    ]);
    expect(roster!.rows[0].cells[0]).toEqual(roster!.rows[1].cells[4]);
  });

  it('JSON kết quả không chứa bất kỳ memberId, choreId nào', () => {
    const roster = build([
      slot({ assigneeId: 'member-a' }),
      slot({ assigneeId: 'member-b', slotIndex: 1 }),
      slot({ choreId: 'chore-trash', title: 'Rác', assigneeId: 'member-c', occurrenceDate: '2026-10-29' }),
    ]);
    const json = JSON.stringify(roster);
    for (const id of [...MEMBERS, 'chore-dishes', 'chore-trash', LISTING]) expect(json).not.toContain(id);
    expect(json).toMatch(/TV\d/);
  });
});
