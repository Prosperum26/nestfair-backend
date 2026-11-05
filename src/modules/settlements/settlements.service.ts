import { HttpStatus, Injectable } from '@nestjs/common';
import { coded } from '../../common/coded-exception.js';
import { toBankAccountName } from '../../common/text.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { computeNetBalances, minCashFlow, pairwiseDebts } from '../expenses/algorithms/min-cash-flow.js';
import { balanceMoves, LedgerService } from '../expenses/ledger.service.js';
import type { HouseMembership } from '../houses/guards/house-member.guard.js';
import type { PaymentInfoDto, SettlementPlanDto } from './dto/settlement-plan.dto.js';

const sumAmounts = (list: { amount: number }[]) => list.reduce((s, t) => s + t.amount, 0);

@Injectable()
export class SettlementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
  ) {}

  /**
   * Kế hoạch thanh toán tối ưu của cả nhà (ảnh 09). Tính trên toàn bộ sổ (nợ cộng dồn qua các tháng):
   * số dư ròng, nợ chéo từng cặp cho sơ đồ "Trước" và kết quả Min Cash Flow cho sơ đồ "Sau".
   */
  async plan(m: HouseMembership): Promise<SettlementPlanDto> {
    const [ledger, memberships] = await Promise.all([
      this.ledger.load(m.houseId),
      this.prisma.houseMember.findMany({
        where: { houseId: m.houseId },
        select: { userId: true, leftAt: true, joinedAt: true, user: { select: { id: true, fullName: true, avatarUrl: true } } },
        orderBy: [{ joinedAt: 'asc' }, { id: 'asc' }],
      }),
    ]);

    const activeIds = memberships.filter((x) => x.leftAt === null).map((x) => x.userId);
    const { expenses, settlements } = ledger;
    const moves = balanceMoves(ledger);
    const net = computeNetBalances(expenses, moves, activeIds);
    const raw = pairwiseDebts(expenses, moves);
    const optimized = minCashFlow(net);
    const pending = settlements.filter((s) => s.status === 'PENDING');

    // Một người có thể vào lại nhà (nhiều membership): lấy dòng mới nhất cho cờ active.
    const users = new Map<string, { id: string; fullName: string; avatarUrl: string | null; active: boolean }>();
    for (const x of memberships) users.set(x.userId, { ...x.user, active: x.leftAt === null });
    const members = [...users.values()]
      // Người đã rời vẫn hiện nếu còn số dư, hoặc còn cạnh trong sơ đồ nợ chéo (đã được điều chỉnh về 0 khi bị xóa).
      .filter((u) => u.active || (net.get(u.id) ?? 0) !== 0 || raw.some((t) => t.from === u.id || t.to === u.id))
      .map((u) => ({ ...u, net: net.get(u.id) ?? 0 }));

    return {
      members,
      raw: raw.map((t) => ({ fromUserId: t.from, toUserId: t.to, amount: t.amount })),
      optimized: optimized.map((t) => {
        const p = pending.find((s) => s.fromUserId === t.from && s.toUserId === t.to);
        return {
          fromUserId: t.from,
          toUserId: t.to,
          amount: t.amount,
          pending: p ? { id: p.id, amount: p.amount, createdAt: p.createdAt, proofUrl: p.proofUrl } : null,
        };
      }),
      rawTotal: sumAmounts(raw),
      optimizedTotal: sumAmounts(optimized),
    };
  }

  /**
   * Tài khoản nhận tiền của một thành viên cùng nhà (để dựng VietQR). Trả STK đầy đủ nên chỉ cho người
   * trong nhà; người đã rời vẫn tra được vì có thể còn được nhận tiền.
   */
  async paymentInfo(m: HouseMembership, userId: string): Promise<PaymentInfoDto> {
    const member = await this.prisma.houseMember.findFirst({
      where: { houseId: m.houseId, userId },
      select: { user: { select: { id: true, fullName: true, bankBin: true, bankAccount: true } } },
    });
    if (!member) throw coded(HttpStatus.NOT_FOUND, 'MEMBER_NOT_FOUND', 'Không tìm thấy thành viên này trong nhà.');
    const { user } = member;
    if (!user.bankBin || !user.bankAccount) {
      throw coded(HttpStatus.NOT_FOUND, 'PAYMENT_INFO_MISSING', `${user.fullName} chưa cập nhật tài khoản nhận tiền.`);
    }
    return {
      userId: user.id,
      fullName: user.fullName,
      bankBin: user.bankBin,
      bankAccount: user.bankAccount,
      accountName: toBankAccountName(user.fullName),
    };
  }
}
