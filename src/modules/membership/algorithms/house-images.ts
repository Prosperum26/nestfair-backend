import { publicIdFromUrl } from '../../uploads/cloudinary.service.js';

/** Gom `public_id` Cloudinary từ nhiều danh sách URL (ảnh minh chứng, hóa đơn, tin đăng…). Bỏ rỗng, URL lạ và trùng. */
export function houseImagePublicIds(urlLists: (string | null | undefined)[][]): string[] {
  const ids = new Set<string>();
  for (const list of urlLists) {
    for (const url of list) {
      const id = url ? publicIdFromUrl(url) : null;
      if (id) ids.add(id);
    }
  }
  return [...ids];
}
