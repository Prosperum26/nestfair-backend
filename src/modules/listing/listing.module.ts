import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { HousesModule } from '../houses/houses.module.js';
import { UploadsModule } from '../uploads/uploads.module.js';
import { ListingController } from './listing.controller.js';
import { ListingPhotosService } from './listing-photos.service.js';
import { PublicListingController } from './public-listing.controller.js';
import { PublicListingService } from './public-listing.service.js';
import { ListingStatusService } from './listing-status.service.js';
import { ListingService } from './listing.service.js';
import { ListingSummaryService } from './listing-summary.service.js';

/** Tin tìm người ở ghép (Issue #11). Ảnh, đổi trạng thái và trang công khai thêm ở B5–B7. */
@Module({
  imports: [AuthModule, HousesModule, UploadsModule],
  controllers: [ListingController, PublicListingController],
  providers: [
    ListingService,
    ListingSummaryService,
    ListingPhotosService,
    ListingStatusService,
    PublicListingService,
  ],
  exports: [ListingSummaryService],
})
export class ListingModule {}
