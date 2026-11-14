import { HttpStatus, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { coded } from '../../common/coded-exception.js';
import type { ListingPhotoCategory } from '../../generated/prisma/enums.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { CloudinaryService, publicIdFromUrl } from '../uploads/cloudinary.service.js';
import { type UploadedImage, validateImageFile } from '../uploads/image-validation.js';
import type { ListingPhotoDto } from './dto/listing-response.dto.js';

/** L5: mỗi nhóm tối đa 6 ảnh, chặn lạm dụng Cloudinary. */
export const MAX_PHOTOS_PER_CATEGORY = 6;

const LISTING_NOT_FOUND = 'Nhà chưa có tin đăng. Hãy lưu nội dung tin trước khi thêm ảnh.';
const PHOTO_LIMIT = `Mỗi nhóm tối đa ${MAX_PHOTOS_PER_CATEGORY} ảnh. Hãy xóa bớt ảnh trước khi thêm.`;

@Injectable()
export class ListingPhotosService {
  private readonly logger = new Logger(ListingPhotosService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cloudinary: CloudinaryService,
  ) {}

  /**
   * Thứ tự an toàn: kiểm tra file và hạn mức → upload → ghi DB trong transaction khóa dòng nhà.
   * Khóa dòng nhà (cùng dòng mà đổi trạng thái và `join` khóa) để hai lần tải song song không vượt 6 ảnh,
   * không trùng sortOrder. Ghi DB thất bại thì xóa ảnh vừa up (không để ảnh mồ côi).
   */
  async add(
    houseId: string,
    category: ListingPhotoCategory,
    file: UploadedImage | undefined,
  ): Promise<ListingPhotoDto> {
    if (!file) throw coded(HttpStatus.BAD_REQUEST, 'PHOTO_FILE_REQUIRED', 'Hãy chọn ảnh để tải lên.');
    validateImageFile(file);

    // Kiểm tra sớm để khỏi tốn một lần upload; kiểm tra lại có khóa trong transaction bên dưới.
    const listing = await this.prisma.roomListing.findUnique({ where: { houseId }, select: { id: true } });
    if (!listing) throw coded(HttpStatus.NOT_FOUND, 'LISTING_NOT_FOUND', LISTING_NOT_FOUND);
    const existing = await this.prisma.listingPhoto.count({ where: { listingId: listing.id, category } });
    if (existing >= MAX_PHOTOS_PER_CATEGORY) throw coded(HttpStatus.UNPROCESSABLE_ENTITY, 'PHOTO_LIMIT', PHOTO_LIMIT);

    const uploaded = await this.cloudinary.upload(file.buffer, `houses/${houseId}/listing`);
    try {
      return await this.prisma.$transaction(async (tx) => {
        await this.lockHouse(tx, houseId);
        const current = await tx.roomListing.findUnique({ where: { houseId }, select: { id: true } });
        if (!current) throw coded(HttpStatus.NOT_FOUND, 'LISTING_NOT_FOUND', LISTING_NOT_FOUND);

        const { _count, _max } = await tx.listingPhoto.aggregate({
          where: { listingId: current.id, category },
          _count: { _all: true },
          _max: { sortOrder: true },
        });
        if (_count._all >= MAX_PHOTOS_PER_CATEGORY) {
          throw coded(HttpStatus.UNPROCESSABLE_ENTITY, 'PHOTO_LIMIT', PHOTO_LIMIT);
        }

        const photo = await tx.listingPhoto.create({
          data: { listingId: current.id, category, url: uploaded.url, sortOrder: (_max.sortOrder ?? -1) + 1 },
        });
        return { id: photo.id, category: photo.category, url: photo.url, sortOrder: photo.sortOrder };
      });
    } catch (error) {
      await this.cloudinary.destroy(uploaded.publicId);
      throw error;
    }
  }

  /** Xóa DB trước, rồi mới xóa trên Cloudinary (lỗi chỉ ghi log). Tin `OPEN` không được mất ảnh cuối của nhóm. */
  async remove(houseId: string, photoId: string): Promise<{ ok: true }> {
    const url = await this.prisma.$transaction(async (tx) => {
      await this.lockHouse(tx, houseId);
      // Lọc theo houseId của membership: photoId của nhà khác coi như không tồn tại.
      const photo = await tx.listingPhoto.findFirst({
        where: { id: photoId, listing: { houseId } },
        include: { listing: { select: { status: true } } },
      });
      if (!photo) throw new NotFoundException('Không tìm thấy ảnh.');

      if (photo.listing.status === 'OPEN') {
        const inGroup = await tx.listingPhoto.count({
          where: { listingId: photo.listingId, category: photo.category },
        });
        if (inGroup <= 1) {
          throw coded(
            HttpStatus.UNPROCESSABLE_ENTITY,
            'PHOTO_REQUIRED',
            'Tin đang đăng cần ít nhất 1 ảnh mỗi nhóm. Hãy thêm ảnh mới hoặc tạm ẩn tin trước khi xóa.',
          );
        }
      }
      await tx.listingPhoto.delete({ where: { id: photo.id } });
      return photo.url;
    });

    const publicId = publicIdFromUrl(url);
    if (publicId) {
      try {
        await this.cloudinary.destroy(publicId);
      } catch (error) {
        this.logger.warn(`Không xóa được ảnh ${publicId} trên Cloudinary: ${(error as Error).message}`);
      }
    }
    return { ok: true };
  }

  /** Ảnh bìa = ảnh Phòng ngủ đứng đầu nhóm: đưa ảnh này lên sortOrder 0, đánh số lại cả nhóm 0..n-1. */
  async setCover(houseId: string, photoId: string): Promise<ListingPhotoDto> {
    return this.prisma.$transaction(async (tx) => {
      await this.lockHouse(tx, houseId);
      const photo = await tx.listingPhoto.findFirst({ where: { id: photoId, listing: { houseId } } });
      if (!photo) throw new NotFoundException('Không tìm thấy ảnh.');
      if (photo.category !== 'BEDROOM') {
        throw coded(
          HttpStatus.UNPROCESSABLE_ENTITY,
          'COVER_CATEGORY_INVALID',
          'Chỉ ảnh Phòng ngủ mới làm được ảnh bìa.',
        );
      }

      const group = await tx.listingPhoto.findMany({
        where: { listingId: photo.listingId, category: 'BEDROOM' },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      });
      const ordered = [photo, ...group.filter((p) => p.id !== photo.id)];
      for (const [index, p] of ordered.entries()) {
        if (p.sortOrder !== index) await tx.listingPhoto.update({ where: { id: p.id }, data: { sortOrder: index } });
      }
      return { id: photo.id, category: photo.category, url: photo.url, sortOrder: 0 };
    });
  }

  private lockHouse(tx: Pick<PrismaService, '$queryRaw'>, houseId: string) {
    return tx.$queryRaw`SELECT id FROM houses WHERE id = ${houseId}::uuid FOR UPDATE`;
  }
}
