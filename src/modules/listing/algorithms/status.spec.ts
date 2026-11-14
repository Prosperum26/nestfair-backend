import { describe, expect, it } from 'vitest';
import { missingPhotos, nextStatus, shouldReopenAfterFull } from './status.js';

describe('nextStatus', () => {
  const ok = { slotsOpen: 1, missing: [] as string[] };
  const publish = {
    change: true,
    status: 'OPEN',
    closeReason: null,
    setPublishedAt: true,
    setClosedAt: false,
  };

  it('DRAFT → OPEN hợp lệ khi còn chỗ và đủ ảnh: đặt publishedAt', () => {
    expect(nextStatus({ current: 'DRAFT', target: 'OPEN', ...ok })).toEqual(publish);
  });

  it('DRAFT → OPEN thiếu ảnh → LISTING_INCOMPLETE', () => {
    expect(nextStatus({ current: 'DRAFT', target: 'OPEN', slotsOpen: 1, missing: ['PHOTO_LIVING'] })).toEqual({
      error: 'LISTING_INCOMPLETE',
    });
  });

  it('DRAFT → OPEN khi nhà đủ người → HOUSE_FULL', () => {
    expect(nextStatus({ current: 'DRAFT', target: 'OPEN', slotsOpen: 0, missing: [] })).toEqual({
      error: 'HOUSE_FULL',
    });
  });

  it('vừa thiếu ảnh vừa đủ người thì ra HOUSE_FULL trước', () => {
    expect(
      nextStatus({ current: 'DRAFT', target: 'OPEN', slotsOpen: 0, missing: ['PHOTO_BEDROOM', 'PHOTO_LIVING'] }),
    ).toEqual({ error: 'HOUSE_FULL' });
  });

  it('OPEN → DRAFT (tạm ẩn) hợp lệ, không đụng publishedAt, closedAt', () => {
    expect(nextStatus({ current: 'OPEN', target: 'DRAFT', slotsOpen: 0, missing: ['PHOTO_LIVING'] })).toEqual({
      change: true,
      status: 'DRAFT',
      closeReason: null,
      setPublishedAt: false,
      setClosedAt: false,
    });
  });

  it.each(['DRAFT', 'OPEN'] as const)('%s → CLOSED đặt closeReason MANUAL và closedAt, bất kể chỗ và ảnh', (current) => {
    expect(nextStatus({ current, target: 'CLOSED', slotsOpen: 0, missing: ['PHOTO_BEDROOM'] })).toEqual({
      change: true,
      status: 'CLOSED',
      closeReason: 'MANUAL',
      setPublishedAt: false,
      setClosedAt: true,
    });
  });

  it('CLOSED → OPEN (mở lại) khi còn chỗ và đủ ảnh: xóa closeReason', () => {
    expect(nextStatus({ current: 'CLOSED', target: 'OPEN', ...ok })).toEqual(publish);
  });

  it('CLOSED → OPEN khi đủ người → HOUSE_FULL; thiếu ảnh → LISTING_INCOMPLETE', () => {
    expect(nextStatus({ current: 'CLOSED', target: 'OPEN', slotsOpen: 0, missing: [] })).toEqual({
      error: 'HOUSE_FULL',
    });
    expect(nextStatus({ current: 'CLOSED', target: 'OPEN', slotsOpen: 2, missing: ['PHOTO_BATHROOM'] })).toEqual({
      error: 'LISTING_INCOMPLETE',
    });
  });

  it('CLOSED → DRAFT → LISTING_STATUS_INVALID', () => {
    expect(nextStatus({ current: 'CLOSED', target: 'DRAFT', ...ok })).toEqual({ error: 'LISTING_STATUS_INVALID' });
  });

  it.each(['DRAFT', 'OPEN', 'CLOSED'] as const)('cùng trạng thái %s → không đổi, kể cả khi điều kiện đăng không đạt', (s) => {
    expect(nextStatus({ current: s, target: s, slotsOpen: 0, missing: ['PHOTO_LIVING'] })).toEqual({ change: false });
  });
});

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

describe('shouldReopenAfterFull', () => {
  it('tin đóng vì đủ người, nay còn chỗ → mở lại', () => {
    expect(shouldReopenAfterFull({ status: 'CLOSED', closeReason: 'FULL', slotsOpen: 1 })).toBe(true);
  });

  it('nhà vẫn đủ người → giữ nguyên', () => {
    expect(shouldReopenAfterFull({ status: 'CLOSED', closeReason: 'FULL', slotsOpen: 0 })).toBe(false);
  });

  it('trưởng phòng tự đóng (MANUAL) thì không tự mở lại dù còn chỗ', () => {
    expect(shouldReopenAfterFull({ status: 'CLOSED', closeReason: 'MANUAL', slotsOpen: 2 })).toBe(false);
  });

  it('tin đang OPEN hoặc DRAFT không có gì để mở lại', () => {
    expect(shouldReopenAfterFull({ status: 'OPEN', closeReason: null, slotsOpen: 2 })).toBe(false);
    expect(shouldReopenAfterFull({ status: 'DRAFT', closeReason: null, slotsOpen: 2 })).toBe(false);
  });
});
