import { describe, expect, it } from 'vitest';
import { missingPhotos } from './status.js';

describe('missingPhotos', () => {
  it('chưa có ảnh: thiếu cả ba nhóm theo thứ tự cố định', () => {
    expect(missingPhotos([])).toEqual(['PHOTO_BEDROOM', 'PHOTO_BATHROOM', 'PHOTO_LIVING']);
  });

  it('có ảnh nhóm nào thì nhóm đó không còn thiếu', () => {
    expect(missingPhotos([{ category: 'BATHROOM' }])).toEqual(['PHOTO_BEDROOM', 'PHOTO_LIVING']);
    expect(missingPhotos([{ category: 'BEDROOM' }, { category: 'LIVING' }])).toEqual(['PHOTO_BATHROOM']);
  });

  it('đủ ba nhóm: không thiếu gì; nhiều ảnh một nhóm không ảnh hưởng', () => {
    expect(
      missingPhotos([
        { category: 'BEDROOM' },
        { category: 'BEDROOM' },
        { category: 'BATHROOM' },
        { category: 'LIVING' },
      ]),
    ).toEqual([]);
  });
});
