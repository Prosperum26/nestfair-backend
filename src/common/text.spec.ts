import { describe, expect, it } from 'vitest';
import { toBankAccountName } from './text.js';

describe('toBankAccountName (tên chủ tài khoản kiểu ngân hàng)', () => {
  it.each([
    ['Nguyễn Minh Quân', 'NGUYEN MINH QUAN'],
    ['Trần Minh Hùng', 'TRAN MINH HUNG'],
    ['Lê Đức Thiện', 'LE DUC THIEN'],
    ['Phạm Ngọc Mai', 'PHAM NGOC MAI'],
    ['đặng thị ỷ', 'DANG THI Y'],
    ['  Võ   Văn  Kiệt ', 'VO VAN KIET'],
    ["O'Brien-Nguyễn", 'OBRIENNGUYEN'],
  ])('%s → %s', (input, expected) => {
    expect(toBankAccountName(input)).toBe(expected);
  });
});
