import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { ChoreDto } from './dto/chore-response.dto.js';
import type { CreateChoreDto } from './dto/create-chore.dto.js';
import type { UpdateChoreDto } from './dto/update-chore.dto.js';

const SELECT = {
  id: true,
  title: true,
  weight: true,
  frequency: true,
  isActive: true,
} as const;

@Injectable()
export class ChoresService {
  constructor(private readonly prisma: PrismaService) {}

  list(houseId: string, includeInactive = false): Promise<ChoreDto[]> {
    return this.prisma.chore.findMany({
      where: { houseId, ...(includeInactive ? {} : { isActive: true }) },
      select: SELECT,
      orderBy: { createdAt: 'asc' },
    });
  }

  create(houseId: string, dto: CreateChoreDto): Promise<ChoreDto> {
    return this.prisma.chore.create({
      data: { houseId, title: dto.title, weight: dto.weight },
      select: SELECT,
    });
  }

  async update(
    houseId: string,
    choreId: string,
    dto: UpdateChoreDto,
  ): Promise<ChoreDto> {
    const found = await this.prisma.chore.findFirst({
      where: { id: choreId, houseId },
      select: { id: true },
    });
    if (!found) throw new NotFoundException('Không tìm thấy việc này.');
    return this.prisma.chore.update({
      where: { id: choreId },
      data: dto,
      select: SELECT,
    });
  }
}
