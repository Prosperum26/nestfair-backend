import type { ListingPhotoCategory } from '../../../generated/prisma/enums.js';

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
