/** Nội quy tối đa 1000 ký tự (UpdateHouseDto). */
export const RULES_MAX_LENGTH = 1000;

export type RuleProposalKind = 'ADD' | 'EDIT' | 'REMOVE';

export interface RuleChange {
  kind: RuleProposalKind;
  /** EDIT / REMOVE: nguyên văn điều đang có (đã bỏ số thứ tự). */
  targetText?: string | null;
  /** ADD / EDIT: nội dung mới. */
  content?: string | null;
}

export type ApplyResult =
  | { ok: true; rules: string | null }
  | { ok: false; reason: 'RULE_CHANGED' | 'RULES_TOO_LONG' };

/** Nội dung một dòng sau khi bỏ số thứ tự người viết gõ tay ("1.", "2)"). */
const normalize = (line: string) => line.replace(/^\s*\d+\s*[.)]\s*/, '').trim();

/** Các điều của nội quy, mỗi dòng không rỗng là một điều. Khớp `rulesLines` ở frontend. */
export function ruleItems(rules: string | null | undefined): string[] {
  if (!rules) return [];
  return rules.split(/\r?\n/).map(normalize).filter(Boolean);
}

/**
 * Áp một đề xuất lên chuỗi nội quy. Chỉ đổi đúng một dòng (dòng đầu tiên khớp), giữ
 * nguyên định dạng các dòng còn lại để không phá cách trưởng phòng đã viết.
 */
export function applyRuleProposal(rules: string | null, change: RuleChange): ApplyResult {
  const lines = rules ? rules.split(/\r?\n/) : [];
  let next: string[];

  if (change.kind === 'ADD') {
    next = [...lines, change.content ?? ''];
  } else {
    const index = lines.findIndex((line) => normalize(line) === change.targetText);
    if (index < 0) return { ok: false, reason: 'RULE_CHANGED' };
    next =
      change.kind === 'EDIT'
        ? lines.map((line, i) => (i === index ? (change.content ?? '') : line))
        : lines.filter((_, i) => i !== index);
  }

  const text = next.join('\n').trim();
  if (text.length > RULES_MAX_LENGTH) return { ok: false, reason: 'RULES_TOO_LONG' };
  return { ok: true, rules: text || null };
}
