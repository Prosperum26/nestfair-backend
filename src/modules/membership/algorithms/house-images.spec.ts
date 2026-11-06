import { describe, expect, it } from 'vitest';
import { houseImagePublicIds } from './house-images.js';

const url = (path: string) => `https://res.cloudinary.com/demo/image/upload/v1700000000/${path}.jpg`;

describe('houseImagePublicIds', () => {
  it('lấy public_id của ảnh Cloudinary từ mọi nguồn', () => {
    expect(
      houseImagePublicIds([[url('nestfair/houses/h1/proofs/a')], [url('nestfair/houses/h1/receipts/b'), url('nestfair/listings/c')]]),
    ).toEqual(['nestfair/houses/h1/proofs/a', 'nestfair/houses/h1/receipts/b', 'nestfair/listings/c']);
  });

  it('bỏ giá trị rỗng, URL không phải Cloudinary và ảnh trùng', () => {
    expect(
      houseImagePublicIds([[null, undefined, '', 'https://example.com/x.jpg', url('nestfair/a')], [url('nestfair/a')]]),
    ).toEqual(['nestfair/a']);
  });

  it('không có ảnh nào thì trả mảng rỗng', () => {
    expect(houseImagePublicIds([[], [null]])).toEqual([]);
  });
});
