import { HttpStatus, NotFoundException } from '@nestjs/common';
import { coded } from '../../common/coded-exception.js';
import type { HouseRole } from '../../generated/prisma/enums.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import { type AssignmentRow, ASSIGNMENT_INCLUDE } from './assignment.mapper.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NOT_FOUND = 'Không tìm thấy ca trực.';

export interface AssignmentAccess {
  assignment: AssignmentRow;
  membership: { id: string; houseId: string; role: HouseRole };
}

/**
 * Route `/assignments/:id` không có houseId trên URL nên không dùng HouseMemberGuard: lấy nhà từ chính ca trực.
 * - Chưa từng ở nhà đó → 404 (không lộ ca có tồn tại, S-70).
 * - Đã rời nhà → 403 (S-71).
 */
export async function loadAssignmentForUser(
  prisma: PrismaService,
  userId: string,
  assignmentId: string,
): Promise<AssignmentAccess> {
  if (!UUID.test(assignmentId)) throw new NotFoundException(NOT_FOUND);
  const assignment = await prisma.choreAssignment.findUnique({ where: { id: assignmentId }, include: ASSIGNMENT_INCLUDE });
  if (!assignment) throw new NotFoundException(NOT_FOUND);

  const active = await prisma.houseMember.findFirst({
    where: { houseId: assignment.houseId, userId, leftAt: null },
    select: { id: true, houseId: true, role: true },
  });
  if (active) return { assignment, membership: active };

  const former = await prisma.houseMember.findFirst({ where: { houseId: assignment.houseId, userId }, select: { id: true } });
  if (!former) throw new NotFoundException(NOT_FOUND);
  throw coded(HttpStatus.FORBIDDEN, 'LEFT_HOUSE', 'Bạn đã rời nhà này.');
}
