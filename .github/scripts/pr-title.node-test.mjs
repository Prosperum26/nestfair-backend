import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkPrTitle } from './pr-title.mjs';

test('nhận Conventional Commits có hoặc không có scope', () => {
  for (const t of [
    'feat(security): gia cố bảo mật backend',
    'fix(chores): sửa xoay vòng',
    'chore: dọn code chết backend',
    'ci: thêm workflow kiểm tra',
    'feat(swap)!: đổi định dạng API',
    'chore(release): dev → main',
  ]) {
    assert.equal(checkPrTitle(t), null, t);
  }
});

test('từ chối tiêu đề không theo quy ước, kèm lời nhắc tiếng Việt', () => {
  for (const t of ['Enhance notifications', 'feat:thiếu khoảng trắng', 'Feat(chores): viết hoa type', 'feat(): scope rỗng', 'wip(chores): loại lạ', 'feat(chores): ', '']) {
    assert.match(checkPrTitle(t) ?? '', /Conventional Commits/, JSON.stringify(t));
  }
});

test('từ chối tiêu đề quá dài', () => {
  assert.match(checkPrTitle(`feat(chores): ${'a'.repeat(120)}`) ?? '', /100 ký tự/);
});
