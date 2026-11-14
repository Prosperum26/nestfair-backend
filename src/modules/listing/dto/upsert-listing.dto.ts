import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateBy,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { GenderWanted } from '../../../generated/prisma/enums.js';
import { isGoogleMapsUrl, MAP_URL_MAX } from '../algorithms/map-url.js';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/** Chỉ nhận link Google Maps (luật ở `isGoogleMapsUrl`). */
function IsGoogleMapsUrl(): PropertyDecorator {
  return ValidateBy({
    name: 'isGoogleMapsUrl',
    validator: {
      validate: (value: unknown) => typeof value === 'string' && isGoogleMapsUrl(value),
      defaultMessage: () => 'Chỉ nhận link Google Maps (https, tối đa 500 ký tự).',
    },
  });
}

export const MAX_RENT = 50_000_000;
export const MAX_FEE = 10_000_000;
export const MAX_OTHER_FEES = 8;

export class OtherFeeInputDto {
  @ApiProperty({ example: 'Wifi', maxLength: 40, description: 'Name of the extra fee (1-40 characters).' })
  @Transform(trim)
  @IsString()
  @Length(1, 40, { message: 'Tên khoản phí cần từ 1 đến 40 ký tự.' })
  name: string;

  @ApiProperty({ example: 60_000, minimum: 0, maximum: MAX_FEE, description: 'Fee in integer VND per person per month, from 0 to 10,000,000.' })
  @IsInt({ message: 'Số tiền phải là số nguyên VNĐ.' })
  @Min(0, { message: 'Số tiền không được âm.' })
  @Max(MAX_FEE, { message: 'Mỗi khoản phí tối đa 10.000.000đ.' })
  amount: number;
}

/** Nội dung tin. Không có `status`, `slug`, `houseId`: đổi trạng thái đi qua route riêng (B6). */
export class UpsertListingDto {
  @ApiProperty({ example: 'Alley 51 Linh Trung, Thu Duc · 5 minutes walk to UIT', minLength: 3, maxLength: 120, description: 'Short location text shown on the listing (3-120 characters).' })
  @Transform(trim)
  @IsString()
  @Length(3, 120, { message: 'Vị trí cần từ 3 đến 120 ký tự.' })
  locationText: string;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    maxLength: MAP_URL_MAX,
    example: 'https://www.google.com/maps/search/?api=1&query=10.87,106.803',
    description:
      'Google Maps link of the area (https only; google.com/maps, google.com.vn/maps, maps.google.com, maps.app.goo.gl or goo.gl/maps). ' +
      'Empty string or null removes it. The server only checks the text and never opens the link.',
  })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() || null : value))
  @ValidateIf((o: UpsertListingDto) => o.mapUrl !== null && o.mapUrl !== undefined)
  @IsString({ message: 'Link bản đồ không hợp lệ.' })
  @IsGoogleMapsUrl()
  mapUrl?: string | null;

  @ApiProperty({ enum: GenderWanted, enumName: 'GenderWanted', description: 'Gender the house is looking for: MALE, FEMALE or ANY.' })
  @IsEnum(GenderWanted, { message: 'Giới tính cần tìm không hợp lệ.' })
  genderWanted: GenderWanted;

  @ApiProperty({ example: 1_200_000, minimum: 1, maximum: MAX_RENT, description: 'Rent in integer VND per person per month, from 1 to 50,000,000.' })
  @IsInt({ message: 'Tiền thuê phải là số nguyên VNĐ.' })
  @Min(1, { message: 'Tiền thuê phải lớn hơn 0.' })
  @Max(MAX_RENT, { message: 'Tiền thuê tối đa 50.000.000đ.' })
  rentPerMonth: number;

  @ApiPropertyOptional({ type: [OtherFeeInputDto], maxItems: MAX_OTHER_FEES, default: [], description: 'Extra monthly fees per person (up to 8), for example wifi or cleaning.' })
  @IsArray()
  @ArrayMaxSize(MAX_OTHER_FEES, { message: 'Tối đa 8 khoản phí khác.' })
  @ValidateNested({ each: true })
  @Type(() => OtherFeeInputDto)
  otherFees: OtherFeeInputDto[] = [];

  @ApiPropertyOptional({ maxLength: 1000, default: '', description: 'Description of the house, plain text (up to 1000 characters); line breaks are kept and HTML is not interpreted.' })
  @IsString()
  @MaxLength(1000, { message: 'Mô tả tối đa 1000 ký tự.' })
  description: string = '';

  @ApiPropertyOptional({ maxLength: 500, default: '', description: 'Kind of roommate wanted, plain text (up to 500 characters); line breaks are kept.' })
  @IsString()
  @MaxLength(500, { message: 'Mong muốn tối đa 500 ký tự.' })
  roommateExpectations: string = '';

  @ApiProperty({ example: '0901234567', description: 'Vietnamese phone number: 10 digits starting with 0. Spaces are ignored.' })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.replace(/\s+/g, '') : value))
  @Matches(/^0\d{9}$/, { message: 'Số điện thoại cần 10 số, bắt đầu bằng 0.' })
  contactPhone: string;

  @ApiPropertyOptional({ default: true, description: 'Whether the public page shows this week\'s chore roster with anonymous labels.' })
  @IsBoolean()
  showChoreSchedule: boolean = true;
}
