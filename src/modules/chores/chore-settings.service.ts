import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AuditService } from './audit.service.js';
import type { ChoreSettingsDto } from './dto/chore-response.dto.js';
import type { UpdateChoreSettingsDto } from './dto/update-chore-settings.dto.js';

const SELECT = { choreGraceHours: true, maxSlotsPerPersonPerDay: true } as const;

@Injectable()
export class ChoreSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  get(houseId: string): Promise<ChoreSettingsDto> {
    return this.prisma.house.findUniqueOrThrow({ where: { id: houseId }, select: SELECT });
  }

  async update(houseId: string, actorMemberId: string, dto: UpdateChoreSettingsDto): Promise<ChoreSettingsDto> {
    const before = await this.get(houseId);
    const after = await this.prisma.house.update({ where: { id: houseId }, data: dto, select: SELECT });
    await this.audit.log(houseId, actorMemberId, 'SETTINGS_UPDATED', { before: { ...before }, after: { ...after } });
    return after;
  }
}
