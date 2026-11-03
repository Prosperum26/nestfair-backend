import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { HousesModule } from '../houses/houses.module.js';
import { ListingController } from './listing.controller.js';
import { ListingService } from './listing.service.js';
import { ListingSummaryService } from './listing-summary.service.js';

/** Tin tìm người ở ghép (Issue #11). Ảnh, đổi trạng thái và trang công khai thêm ở B5–B7. */
@Module({
  imports: [AuthModule, HousesModule],
  controllers: [ListingController],
  providers: [ListingService, ListingSummaryService],
  exports: [ListingSummaryService],
})
export class ListingModule {}
