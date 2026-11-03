import type {
  ListingCloseReason,
  ListingPhotoCategory,
  ListingStatus,
} from '../../../generated/prisma/enums.js';

export type MissingPhoto = 'PHOTO_BEDROOM' | 'PHOTO_BATHROOM' | 'PHOTO_LIVING';

/** Thứ tự cố định: cũng là thứ tự hiển thị trong form. */
const REQUIRED: { category: ListingPhotoCategory; missing: MissingPhoto }[] = [
  { category: 'BEDROOM', missing: 'PHOTO_BEDROOM' },
  { category: 'BATHROOM', missing: 'PHOTO_BATHROOM' },
  { category: 'LIVING', missing: 'PHOTO_LIVING' },
];

/** Nhóm ảnh còn thiếu để đăng tin (L5: mỗi nhóm cần ít nhất 1 ảnh). */
export function missingPhotos(photos: { category: string }[]): MissingPhoto[] {
  const have = new Set(photos.map((p) => p.category));
  return REQUIRED.filter((r) => !have.has(r.category)).map((r) => r.missing);
}

export type StatusChange =
  | { change: false }
  | {
      change: true;
      status: ListingStatus;
      closeReason: ListingCloseReason | null;
      /** Đặt `publishedAt = now` nếu tin chưa từng được đăng (giữ nguyên nếu đã có). */
      setPublishedAt: boolean;
      /** `true`: đặt `closedAt = now`; `false`: xóa `closedAt`. */
      setClosedAt: boolean;
    }
  | { error: 'HOUSE_FULL' | 'LISTING_INCOMPLETE' | 'LISTING_STATUS_INVALID' };

/**
 * Máy trạng thái của tin (mục 4.4). Hàm thuần: chỉ quyết định, không ghi gì.
 * Đăng hoặc mở lại kiểm `HOUSE_FULL` trước, rồi mới `LISTING_INCOMPLETE`.
 */
export function nextStatus(input: {
  current: ListingStatus;
  target: ListingStatus;
  slotsOpen: number;
  missing: string[];
}): StatusChange {
  const { current, target, slotsOpen, missing } = input;
  if (current === target) return { change: false };

  switch (target) {
    case 'OPEN':
      if (slotsOpen <= 0) return { error: 'HOUSE_FULL' };
      if (missing.length > 0) return { error: 'LISTING_INCOMPLETE' };
      return { change: true, status: 'OPEN', closeReason: null, setPublishedAt: true, setClosedAt: false };
    case 'DRAFT':
      // Chỉ tạm ẩn tin đang mở; tin đã đóng không quay về bản nháp.
      if (current === 'CLOSED') return { error: 'LISTING_STATUS_INVALID' };
      return { change: true, status: 'DRAFT', closeReason: null, setPublishedAt: false, setClosedAt: false };
    case 'CLOSED':
      return { change: true, status: 'CLOSED', closeReason: 'MANUAL', setPublishedAt: false, setClosedAt: true };
  }
}
