import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import type { HouseRole } from '../../generated/prisma/enums.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { ActivityService } from '../activity/activity.service.js';
import { actorOfUser } from '../events/actor.js';
import { EventsService } from '../events/events.service.js';
import type { CreateHouseDto } from './dto/create-house.dto.js';
import type {
  HouseDetailDto,
  HouseSummaryDto,
} from './dto/house-response.dto.js';
import { generateInviteCode, inviteExpiry } from './invite-code.js';

const INVALID_CODE =
  'Mã mời không tồn tại hoặc đã hết hạn. Kiểm tra lại với trưởng phòng.';
const MAX_CODE_ATTEMPTS = 5;

const isUniqueViolation = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError &&
  error.code === 'P2002';

@Injectable()
export class HousesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
    private readonly activity: ActivityService,
  ) {}

  /** Tạo nhà, người tạo là trưởng phòng (ADMIN). */
  async create(userId: string, dto: CreateHouseDto): Promise<HouseDetailDto> {
    const house = await this.withFreshInviteCode((inviteCode) =>
      this.prisma.house.create({
        data: {
          name: dto.name,
          address: dto.address,
          maxMembers: dto.maxMembers,
          inviteCode,
          inviteExpiresAt: inviteExpiry(),
          members: { create: { userId, role: 'ADMIN' } },
        },
        select: { id: true },
      }),
    );
    return this.detail(house.id, 'ADMIN');
  }

  /**
   * Vào nhà bằng mã mời. Khóa dòng nhà (FOR UPDATE) để kiểm tra sức chứa
   * không bị vượt khi nhiều người cùng vào lúc nhà còn 1 chỗ.
   */
  async join(userId: string, inviteCode: string): Promise<HouseDetailDto> {
    const actor = await actorOfUser(this.prisma, userId);
    const outbox = this.events.outbox();
    const houseId = await this.prisma
      .$transaction(async (tx) => {
        const [house] = await tx.$queryRaw<
          { id: string; maxMembers: number; inviteExpiresAt: Date }[]
        >`SELECT id, "maxMembers", "inviteExpiresAt" FROM houses
          WHERE "inviteCode" = ${inviteCode} FOR UPDATE`;
        if (!house || house.inviteExpiresAt <= new Date()) {
          throw new NotFoundException(INVALID_CODE);
        }

        const active = await tx.houseMember.findMany({
          where: { houseId: house.id, leftAt: null },
          select: { userId: true },
        });
        if (active.some((m) => m.userId === userId)) {
          throw new ConflictException('Bạn đã ở trong nhà này rồi.');
        }
        if (active.length >= house.maxMembers) {
          throw new ConflictException(
            'Nhà đã đủ người. Liên hệ trưởng phòng để tăng số người.',
          );
        }

        await tx.houseMember.create({
          data: { houseId: house.id, userId, role: 'ROOMMATE' },
        });
        await this.activity.record(tx, outbox, {
          houseId: house.id,
          type: 'member.joined',
          actor,
          params: {},
        });
        return house.id;
      })
      .catch((error: unknown) => {
        // Cùng một người bấm "Vào nhà" 2 lần cùng lúc: partial unique index chặn dòng thứ hai.
        if (isUniqueViolation(error)) {
          throw new ConflictException('Bạn đã ở trong nhà này rồi.');
        }
        throw error;
      });

    // Sau commit: socket đang mở của người mới vào room nhà, cả nhà nhận member:joined.
    await this.events.addMemberToHouse(userId, houseId);
    outbox.toHouse(houseId, 'member:joined', { userId, name: actor.name }, actor).flush();
    return this.detail(houseId, 'ROOMMATE');
  }

  /** Các nhà user đang ở (cho house switcher), nhà vào gần nhất đứng đầu. */
  async listMine(userId: string): Promise<HouseSummaryDto[]> {
    const memberships = await this.prisma.houseMember.findMany({
      where: { userId, leftAt: null },
      orderBy: { joinedAt: 'desc' },
      select: {
        role: true,
        house: {
          select: {
            id: true,
            name: true,
            address: true,
            maxMembers: true,
            _count: { select: { members: { where: { leftAt: null } } } },
          },
        },
      },
    });
    return memberships.map(({ role, house: { _count, ...house } }) => ({
      ...house,
      memberCount: _count.members,
      myRole: role,
    }));
  }

  async detail(houseId: string, myRole: HouseRole): Promise<HouseDetailDto> {
    const house = await this.prisma.house.findUnique({
      where: { id: houseId },
      select: {
        id: true,
        name: true,
        address: true,
        maxMembers: true,
        rules: true,
        inviteCode: true,
        inviteExpiresAt: true,
        createdAt: true,
        members: {
          where: { leftAt: null },
          orderBy: { joinedAt: 'asc' },
          select: {
            role: true,
            joinedAt: true,
            user: {
              select: {
                id: true,
                fullName: true,
                avatarUrl: true,
                bankBin: true,
                bankAccount: true,
              },
            },
          },
        },
      },
    });
    if (!house) throw new NotFoundException('Không tìm thấy nhà.');

    return {
      ...house,
      myRole,
      members: house.members.map(({ user, role, joinedAt }) => ({
        userId: user.id,
        fullName: user.fullName,
        avatarUrl: user.avatarUrl,
        // Thẻ thành viên chỉ hiện "TCB ·0123"; STK đầy đủ chỉ lộ khi cần trả tiền (VietQR, module thanh toán).
        bankBin: user.bankBin,
        bankAccountLast4: user.bankAccount?.slice(-4) ?? null,
        role,
        joinedAt,
      })),
    };
  }

  /** Trưởng phòng tạo mã mới: mã cũ hết hiệu lực ngay, hạn mới 7 ngày. */
  async regenerateInviteCode(houseId: string): Promise<HouseDetailDto> {
    await this.withFreshInviteCode((inviteCode) =>
      this.prisma.house.update({
        where: { id: houseId },
        data: { inviteCode, inviteExpiresAt: inviteExpiry() },
        select: { id: true },
      }),
    );
    return this.detail(houseId, 'ADMIN');
  }

  /** Thử lại khi mã ngẫu nhiên trùng mã đang có (unique inviteCode). */
  private async withFreshInviteCode<T>(
    write: (inviteCode: string) => Promise<T>,
  ): Promise<T> {
    for (let attempt = 1; attempt <= MAX_CODE_ATTEMPTS; attempt++) {
      try {
        return await write(generateInviteCode());
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
      }
    }
    throw new InternalServerErrorException(
      'Không tạo được mã mời, thử lại sau.',
    );
  }
}
