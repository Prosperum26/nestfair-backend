/**
 * Tên chủ tài khoản theo cách ngân hàng hiển thị: bỏ dấu tiếng Việt, viết hoa, chỉ giữ chữ, số và
 * một khoảng trắng giữa các từ. "Nguyễn Minh Quân" → "NGUYEN MINH QUAN".
 */
export function toBankAccountName(fullName: string): string {
  return fullName
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, '')
    .trim()
    .replace(/\s+/g, ' ');
}
