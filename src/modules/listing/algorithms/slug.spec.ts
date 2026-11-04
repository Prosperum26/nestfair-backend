import { describe, expect, it } from 'vitest';
import { SLUG_ALPHABET, SLUG_LENGTH, generateSlug, isValidSlug } from './slug.js';

describe('generateSlug', () => {
  it('bảng chữ cái có 62 ký tự theo thứ tự 0-9A-Za-z', () => {
    expect(SLUG_ALPHABET).toHaveLength(62);
    expect(SLUG_ALPHABET).toBe('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz');
    expect(SLUG_LENGTH).toBe(8);
  });

  it('dài 8 ký tự và chỉ gồm 0-9A-Za-z', () => {
    const slug = generateSlug();
    expect(slug).toHaveLength(8);
    expect(slug).toMatch(/^[0-9A-Za-z]{8}$/);
  });

  it('2000 lần gọi cho 2000 giá trị khác nhau', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 2000; i++) seen.add(generateSlug());
    expect(seen.size).toBe(2000);
  });

  it('rand = 0 → toàn ký tự đầu, rand = 61 → toàn ký tự cuối, rand = 10 → toàn "A"', () => {
    expect(generateSlug(() => 0)).toBe('00000000');
    expect(generateSlug(() => 61)).toBe('zzzzzzzz');
    expect(generateSlug(() => 10)).toBe('AAAAAAAA');
  });

  it('hỏi rand với max = 62 cho từng ký tự', () => {
    const maxes: number[] = [];
    generateSlug((max) => {
      maxes.push(max);
      return 0;
    });
    expect(maxes).toEqual(Array(8).fill(62));
  });
});

describe('isValidSlug', () => {
  it('chấp nhận đúng 8 ký tự 0-9A-Za-z', () => {
    expect(isValidSlug('x7Kp2QmA')).toBe(true);
    expect(isValidSlug('00000000')).toBe(true);
  });

  it.each([
    ['7 ký tự', 'x7Kp2Qm'],
    ['9 ký tự', 'x7Kp2QmAb'],
    ['có dấu gạch', 'x7Kp-2Qm'],
    ['có dấu cách', 'x7Kp 2Qm'],
    ['đường dẫn lên thư mục cha', '../x'],
    ['chuỗi rỗng', ''],
    ['ký tự có dấu', 'x7Kp2Qmá'],
    ['xuống dòng ở cuối', 'x7Kp2QmA\n'],
  ])('từ chối %s', (_label, value) => {
    expect(isValidSlug(value)).toBe(false);
  });
});
