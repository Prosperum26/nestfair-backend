export interface SwapErrorSpec {
  status: number;
  message: string;
}

/**
 * Mã lỗi đổi ca (spec 9.3) kèm copy hiển thị (spec 8.7). Không chứa mã quy tắc trong `message`.
 * Chỗ `{Tên}`, `{Việc}`, `{dd.mm}` được thay bằng `fillMessage`.
 */
export const SWAP_ERRORS: Record<string, SwapErrorSpec> = {
  IDEMPOTENCY_KEY_REQUIRED: { status: 400, message: 'Thiếu mã chống gửi trùng. Hãy thử lại.' },

  SLOT_LOCKED: { status: 409, message: 'Ca này đang chờ người khác trả lời.' },
  SWAP_ALREADY_ACCEPTED: { status: 409, message: 'Ca đã có người nhận.' },
  SWAP_NOT_PENDING: { status: 409, message: 'Yêu cầu này không còn hiệu lực.' },
  SLOT_CHANGED: { status: 409, message: 'Ca đã thay đổi nên yêu cầu không còn hiệu lực.' },
  SWAP_PENDING_IN_WEEK: { status: 409, message: 'Tuần này còn yêu cầu đổi ca đang chờ. Hãy hủy chúng trước.' },
  PAYBACK_WINDOW_NOT_OPEN: { status: 409, message: 'Chưa tới lúc chọn ca bù.' },
  PAYBACK_ALREADY_CHOSEN: { status: 409, message: 'Bạn đã chọn ca bù cho khoản nợ này rồi.' },
  DEBT_NOT_OPEN: { status: 409, message: 'Khoản nợ này đã được xử lý.' },
  DEBT_NOT_FORGIVABLE: { status: 409, message: 'Ca bù đã được làm nên không tha nợ được nữa.' },
  PERMANENT_EXISTS: { status: 409, message: 'Bạn đã có một yêu cầu đổi lịch tuần sau đang chờ.' },

  SWAP_EXPIRED: { status: 410, message: 'Yêu cầu đã hết hạn.' },

  SLOT_NOT_SWAPPABLE: { status: 422, message: 'Ca này không đổi được.' },
  SWAP_IDENTICAL_SLOT: { status: 422, message: 'Hai ca này giống nhau, đổi cũng không thay đổi gì.' },
  DUPLICATE_CHORE_SAME_DAY: { status: 422, message: '{Tên} đã có ca {Việc} hôm đó.' },
  COVER_CHAIN_FORBIDDEN: { status: 422, message: 'Ca này bạn đang làm hộ, không nhờ tiếp được.' },
  PAYBACK_SLOT_LOCKED: { status: 422, message: 'Ca làm bù phải tự làm, không chuyển được.' },
  TARGET_ABSENT: { status: 422, message: '{Tên} vắng ngày {dd.mm}.' },
  TARGET_LEFT: { status: 422, message: '{Tên} đã rời nhà.' },
  WEEK_MISMATCH: { status: 422, message: 'Hai ca khác tuần. Hãy nhờ trực dùm hoặc đổi lịch tuần sau.' },
  SWAP_TOO_LATE: { status: 422, message: 'Còn dưới 90 phút tới hạn, không kịp đổi. Hãy tự làm hoặc nhờ trực tiếp.' },
  SWAP_NEEDS_2_MEMBERS: { status: 422, message: 'Cần ít nhất 2 người trong nhà để đổi ca.' },
  REWARD_OUT_OF_RANGE: { status: 422, message: 'Quà từ 1.000đ đến 500.000đ.' },
  WARNINGS_NOT_ACKNOWLEDGED: { status: 422, message: 'Hãy đọc và tick xác nhận cảnh báo trước khi gửi.' },
  URGENT_MARKET_ONLY: { status: 422, message: 'Còn dưới 6 giờ tới hạn, chỉ đăng được lên Chợ ca.' },
  WEEK_NOT_GENERATED: { status: 422, message: 'Lịch tuần sau chưa có. Thử lại sau 20:00 Chủ Nhật.' },
  WHEEL_NOT_EXCHANGEABLE: { status: 422, message: 'Việc đột xuất chỉ nhờ được bằng quà.' },
  SWAP_SELF: { status: 422, message: 'Bạn không thể gửi yêu cầu cho chính mình.' },
  FENCE_VIOLATION: { status: 422, message: 'Đổi này làm {Tên} lặp lại việc trong 3 tuần.' },
  PAYBACK_TOO_SOON: { status: 422, message: 'Ca này quá gần hạn, người kia không kịp làm bù.' },
  PAYBACK_WRONG_WEEK: { status: 422, message: 'Chỉ chọn được ca ở tuần sau của khoản nợ.' },
  NO_VALID_PAYBACK_SLOT: { status: 422, message: 'Chưa có ca nào phù hợp để làm bù. Hệ thống sẽ thử lại ở tuần sau.' },
  ESCALATE_TOO_LATE: { status: 422, message: 'Còn quá ít thời gian để đăng lại. Bạn có thể tự làm ca này.' },
  ESCALATE_LIMIT: { status: 422, message: 'Bạn đã đăng lại đủ số lần cho ca này. Hãy tự làm ca này.' },
  REWARD_NOT_INCREASED: { status: 422, message: 'Quà đăng lại phải nhiều hơn lần trước hoặc có lời nhắn mới.' },
  NO_RESEND_CANDIDATE: { status: 422, message: 'Không còn ai để gửi thêm. Hãy đăng Chợ ca hoặc tự làm ca này.' },
  SWAP_TARGET_COOLDOWN: { status: 422, message: 'Bạn đã gửi cho {Tên} 2 lần và bị từ chối. Thử lại sau 24 giờ.' },

  NOT_SWAP_TARGET: { status: 403, message: 'Yêu cầu này không gửi cho bạn.' },
  CANNOT_ACCEPT_OWN: { status: 403, message: 'Bạn không thể nhận ca của chính mình.' },
  NOT_REQUESTER: { status: 403, message: 'Chỉ người gửi yêu cầu mới làm được việc này.' },
  NOT_CREDITOR: { status: 403, message: 'Chỉ người đã làm hộ mới chọn được ca bù.' },

  SWAP_PENDING_LIMIT: { status: 429, message: 'Bạn đang có 3 yêu cầu chờ. Hãy hủy bớt trước khi gửi thêm.' },
  SWAP_DAILY_LIMIT: { status: 429, message: 'Hôm nay bạn đã gửi 10 yêu cầu.' },
};

/** Thay `{Tên}`, `{Việc}`, `{dd.mm}` trong thông điệp. */
export function fillMessage(message: string, vars: Record<string, string> = {}): string {
  return message.replace(/\{([^}]+)\}/g, (whole, key: string) => vars[key] ?? whole);
}
