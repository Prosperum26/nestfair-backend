import { maskEmail } from './security-log.js';

describe('maskEmail', () => {
  it('chỉ giữ ký tự đầu và tên miền', () => {
    expect(maskEmail('hung@nestfair.demo')).toBe('h***@nestfair.demo');
  });

  it('chuỗi không có @ thì che hết', () => {
    expect(maskEmail('khongphaiemail')).toBe('***');
  });

  it('cắt ngắn tên miền dài bất thường để log không bị nhồi', () => {
    expect(maskEmail(`a@${'x'.repeat(300)}.vn`).length).toBeLessThanOrEqual(70);
  });
});
