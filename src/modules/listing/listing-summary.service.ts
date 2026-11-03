import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { monthRange } from '../expenses/month.js';
import { averageUtilities, perPersonShare, previousMonthKeys } from './algorithms/pricing.js';
import type { ListingSummaryDto } from './dto/listing-response.dto.js';

export type ListingSummary = ListingSummaryDto;

/** Số liệu của nhà dùng chung cho trang quản lý (B4) và trang công khai (B7). */
@Injectable()
export class ListingSummaryService {
  constructor(private readonly prisma: PrismaService) {}

  async summary(houseId: string, now: Date = new Date()): Promise<ListingSummary> {
    // Mới nhất trước: keys[0] là tháng vừa khép, phần tử cuối là tháng cũ nhất trong cửa sổ.
    const keys = previousMonthKeys(now);
    const from = monthRange(keys[keys.length - 1]).start;
    const to = monthRange(keys[0]).end;

    const [house, memberCount, expenses] = await Promise.all([
      this.prisma.house.findUniqueOrThrow({ where: { id: houseId }, select: { maxMembers: true } }),
      this.prisma.houseMember.count({ where: { houseId, leftAt: null } }),
      this.prisma.expense.findMany({
        where: { houseId, category: { in: ['ELECTRICITY', 'WATER'] }, spentAt: { gte: from, lt: to } },
        select: { spentAt: true, totalAmount: true },
      }),
    ]);

    const { avgMonthlyTotal, monthsUsed } = averageUtilities(expenses, now);
    return {
      memberCount,
      maxMembers: house.maxMembers,
      slotsOpen: Math.max(0, house.maxMembers - memberCount),
      utilities: { avgMonthlyTotal, perPerson: perPersonShare(avgMonthlyTotal, house.maxMembers), monthsUsed },
    };
  }
}
