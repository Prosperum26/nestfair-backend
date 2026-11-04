import { applyRuleProposal, ruleItems } from './rule-proposal.js';

const RULES = '1. Giữ yên lặng sau 23h\n\n2) Rửa chén ngay\nĐổ rác trước 8h';

describe('ruleItems', () => {
  it('mỗi dòng một điều, bỏ số thứ tự gõ tay, bỏ dòng trống', () => {
    expect(ruleItems(RULES)).toEqual(['Giữ yên lặng sau 23h', 'Rửa chén ngay', 'Đổ rác trước 8h']);
  });

  it('không có nội quy thì rỗng', () => {
    expect(ruleItems(null)).toEqual([]);
    expect(ruleItems(' \r\n ')).toEqual([]);
  });
});

describe('applyRuleProposal', () => {
  it('ADD nối điều mới vào cuối, giữ nguyên định dạng các dòng cũ', () => {
    expect(applyRuleProposal(RULES, { kind: 'ADD', content: 'Khách ở qua đêm báo trước' })).toEqual({
      ok: true,
      rules: '1. Giữ yên lặng sau 23h\n\n2) Rửa chén ngay\nĐổ rác trước 8h\nKhách ở qua đêm báo trước',
    });
  });

  it('ADD khi chưa có nội quy', () => {
    expect(applyRuleProposal(null, { kind: 'ADD', content: 'Rửa chén ngay' })).toEqual({ ok: true, rules: 'Rửa chén ngay' });
  });

  it('EDIT thay đúng dòng khớp nội dung (bỏ qua số thứ tự gõ tay)', () => {
    expect(applyRuleProposal(RULES, { kind: 'EDIT', targetText: 'Rửa chén ngay', content: 'Rửa chén trong 30 phút' })).toEqual({
      ok: true,
      rules: '1. Giữ yên lặng sau 23h\n\nRửa chén trong 30 phút\nĐổ rác trước 8h',
    });
  });

  it('REMOVE bỏ dòng khớp; bỏ hết thì nội quy thành null', () => {
    expect(applyRuleProposal(RULES, { kind: 'REMOVE', targetText: 'Giữ yên lặng sau 23h' })).toEqual({
      ok: true,
      rules: '2) Rửa chén ngay\nĐổ rác trước 8h',
    });
    expect(applyRuleProposal('Rửa chén ngay', { kind: 'REMOVE', targetText: 'Rửa chén ngay' })).toEqual({ ok: true, rules: null });
  });

  it('hai dòng trùng nội dung: chỉ đổi dòng đầu tiên', () => {
    expect(applyRuleProposal('A\nA', { kind: 'REMOVE', targetText: 'A' })).toEqual({ ok: true, rules: 'A' });
  });

  it('điều được nhắm tới không còn (admin đã sửa) thì RULE_CHANGED', () => {
    expect(applyRuleProposal(RULES, { kind: 'EDIT', targetText: 'Không hút thuốc', content: 'x' })).toEqual({ ok: false, reason: 'RULE_CHANGED' });
    expect(applyRuleProposal(null, { kind: 'REMOVE', targetText: 'Rửa chén ngay' })).toEqual({ ok: false, reason: 'RULE_CHANGED' });
  });

  it('kết quả vượt 1000 ký tự thì RULES_TOO_LONG', () => {
    const long = 'a'.repeat(990);
    expect(applyRuleProposal(long, { kind: 'ADD', content: 'Rửa chén ngay' })).toEqual({ ok: false, reason: 'RULES_TOO_LONG' });
  });
});
