const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 00:00 giờ Việt Nam (Asia/Ho_Chi_Minh, UTC+7, không có giờ mùa hè) của ngày chứa `now`, trả về `Date` UTC.
 * Dùng để đếm hạn mức theo ngày của người dùng, không theo ngày UTC.
 */
export function vnDayStart(now: Date): Date {
  const localMs = now.getTime() + VN_OFFSET_MS;
  return new Date(Math.floor(localMs / DAY_MS) * DAY_MS - VN_OFFSET_MS);
}
