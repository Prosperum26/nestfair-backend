import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { HouseRole } from '../../generated/prisma/enums.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import { type AssignmentRow, ASSIGNMENT_INCLUDE } from './assignment.mapper.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface AssignmentAccess {
  assignment: AssignmentRow;
  membership: { id: string; houseId: string; role: HouseRole };
}

/**
 * Route `/assignments/:id` không có houseId trên URL nên không dùng HouseMemberGuard:
 * lấy nhà từ chính ca trực rồi kiểm tra user còn là thành viên nhà đó (chống IDOR).
 */
export async function loadAssignmentForUser(
  prisma: PrismaService,
  userId: string,
  assignmentId: string,
): Promise<AssignmentAccess> {
  if (!UUID.test(assignmentId)) {
    throw new NotFoundException('Không tìm thấy ca trực.');
  }
  const assignment = await prisma.choreAssignment.findUnique({
    where: { id: assignmentId },
    include: ASSIGNMENT_INCLUDE,
  });
  if (!assignment) throw new NotFoundException('Không tìm thấy ca trực.');

  const membership = await prisma.houseMember.findFirst({
    where: { houseId: assignment.houseId, userId, leftAt: null },
    select: { id: true, houseId: true, role: true },
  });
  if (!membership) {
    throw new ForbiddenException('Bạn không phải thành viên nhà này.');
  }
  return { assignment, membership };
}
