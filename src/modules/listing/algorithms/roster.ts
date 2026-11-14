import { createHash } from 'node:crypto';
import type { AssignmentSource, AssignmentStatus } from '../../../generated/prisma/enums.js';
import { addDays, type DateStr } from '../../chores/week.js';

/** Một ca của tuần, đã đọc từ DB (B7 nạp). Chưa có `choreIsSystem`, thêm ở X3. */
export interface RosterSlot {
  choreId: string;
  title: string;
  occurrenceDate: DateStr;
  slotIndex: number;
  assigneeId: string | null;
  status: AssignmentStatus;
  source: AssignmentSource;
}

/** Lịch trực công khai: không có danh tính thật, `cells` luôn 7 phần tử (T2…CN). */
export interface PublicRoster {
  weekKey: string;
  rows: { title: string; cells: string[][] }[];
}

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

/**
 * Nhãn ẩn danh `TV1…TVn`. Thứ tự theo `sha256(listingId:memberId)` tăng dần: ổn định với cùng một tin
 * nhưng không suy ra được ai vào nhà trước (không dùng `joinedAt` hay `id`), và khác nhau giữa các tin.
 */
export function anonymousLabels(listingId: string, memberIds: string[]): Map<string, string> {
  const ordered = memberIds
    .map((memberId) => ({ memberId, hash: sha256(`${listingId}:${memberId}`) }))
    .sort((a, b) => (a.hash < b.hash ? -1 : a.hash > b.hash ? 1 : 0));
  return new Map(ordered.map(({ memberId }, index) => [memberId, `TV${index + 1}`]));
}

/**
 * Lịch trực tuần cho trang công khai. Bỏ ca `CANCELLED`/`UNASSIGNED`, ca không có người, ca của Vòng quay
 * (`source = WHEEL`), ca của người không còn ở trong nhà và ca ngoài tuần. Không còn dòng nào thì `null`.
 */
export function buildRoster(input: {
  listingId: string;
  weekKey: string;
  weekStart: DateStr;
  activeMemberIds: string[];
  slots: RosterSlot[];
}): PublicRoster | null {
  const labels = anonymousLabels(input.listingId, input.activeMemberIds);
  const dayIndex = new Map(Array.from({ length: 7 }, (_, i) => [addDays(input.weekStart, i), i]));

  const rows = new Map<string, { title: string; days: { slotIndex: number; label: string }[][] }>();
  for (const slot of input.slots) {
    if (slot.status === 'CANCELLED' || slot.status === 'UNASSIGNED') continue;
    if (slot.source === 'WHEEL' || slot.assigneeId === null) continue;
    const label = labels.get(slot.assigneeId);
    const day = dayIndex.get(slot.occurrenceDate);
    if (label === undefined || day === undefined) continue;

    let row = rows.get(slot.choreId);
    if (!row) {
      row = { title: slot.title, days: Array.from({ length: 7 }, () => []) };
      rows.set(slot.choreId, row);
    }
    row.days[day].push({ slotIndex: slot.slotIndex, label });
  }
  if (rows.size === 0) return null;

  return {
    weekKey: input.weekKey,
    rows: [...rows.entries()]
      .sort(([idA, a], [idB, b]) => a.title.localeCompare(b.title, 'vi') || (idA < idB ? -1 : idA > idB ? 1 : 0))
      .map(([, row]) => ({
        title: row.title,
        cells: row.days.map((cell) => cell.sort((a, b) => a.slotIndex - b.slotIndex).map((c) => c.label)),
      })),
  };
}
