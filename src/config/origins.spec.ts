import { isAllowedOrigin, parseOrigins } from './origins.js';

describe('parseOrigins', () => {
  it('tách theo dấu phẩy, bỏ khoảng trắng và mục rỗng', () => {
    expect(parseOrigins(' https://app.nestfair.vn , https://dev.nestfair.vn,,')).toEqual([
      'https://app.nestfair.vn',
      'https://dev.nestfair.vn',
    ]);
  });

  it('bỏ dấu / ở cuối để khớp header Origin của trình duyệt', () => {
    expect(parseOrigins('http://localhost:5173/')).toEqual(['http://localhost:5173']);
  });

  it('không nhận `*` vì cookie refresh cần credentials', () => {
    expect(() => parseOrigins('https://app.nestfair.vn,*')).toThrow(/\*/);
  });

  it('không nhận chuỗi không phải origin http(s)', () => {
    expect(() => parseOrigins('app.nestfair.vn')).toThrow(/app\.nestfair\.vn/);
    expect(() => parseOrigins('https://app.nestfair.vn/path')).toThrow(/path/);
  });

  it('danh sách rỗng là lỗi cấu hình', () => {
    expect(() => parseOrigins(' , ')).toThrow();
  });
});

describe('isAllowedOrigin', () => {
  const allowed = ['https://app.nestfair.vn'];

  it('khớp chính xác', () => {
    expect(isAllowedOrigin('https://app.nestfair.vn', allowed)).toBe(true);
  });

  it('không khớp tiền tố hay hậu tố', () => {
    expect(isAllowedOrigin('https://app.nestfair.vn.evil.com', allowed)).toBe(false);
    expect(isAllowedOrigin('http://app.nestfair.vn', allowed)).toBe(false);
    expect(isAllowedOrigin('null', allowed)).toBe(false);
  });
});
