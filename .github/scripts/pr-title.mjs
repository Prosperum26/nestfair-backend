// Kiểm tiêu đề PR theo Conventional Commits (AGENTS.md mục 10: thầy chấm qua lịch sử commit).
// Dùng: PR_TITLE="..." node .github/scripts/pr-title.mjs  (đọc từ biến môi trường, không nội suy vào shell).
import { pathToFileURL } from 'node:url';

const TYPES = ['feat', 'fix', 'chore', 'docs', 'test', 'refactor', 'perf', 'ci', 'build', 'style', 'revert'];
const PATTERN = new RegExp(`^(${TYPES.join('|')})(\\([a-z0-9][a-z0-9-]*\\))?!?: \\S.*$`);
const MAX = 100;

/** Trả `null` nếu hợp lệ, ngược lại là câu nhắc. */
export function checkPrTitle(title) {
  if (!PATTERN.test(title)) {
    return (
      `Tiêu đề PR cần theo Conventional Commits: "<type>(<scope>): <mô tả>", ` +
      `type thuộc ${TYPES.join(', ')}. Ví dụ: "feat(chores): xoay vòng công bằng".`
    );
  }
  if (title.length > MAX) return `Tiêu đề PR tối đa ${MAX} ký tự (đang có ${title.length}).`;
  return null;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const problem = checkPrTitle(process.env.PR_TITLE ?? '');
  if (problem) {
    console.error(`::error title=Tiêu đề PR::${problem}`);
    process.exit(1);
  }
  console.log('Tiêu đề PR hợp lệ.');
}
