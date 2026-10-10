import { ApiProperty } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsInt, IsString, Length, Max, Min } from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class CreateChoreDto {
  @ApiProperty({ example: 'Đổ rác', minLength: 1, maxLength: 60 })
  @Transform(trim)
  @IsString()
  @Length(1, 60, { message: 'Tên việc cần từ 1 đến 60 ký tự.' })
  title: string;

  @ApiProperty({
    minimum: 1,
    maximum: 5,
    example: 2,
    description: 'Độ nặng của việc',
  })
  @Type(() => Number)
  @IsInt({ message: 'Độ nặng phải là số nguyên.' })
  @Min(1, { message: 'Độ nặng từ 1 đến 5.' })
  @Max(5, { message: 'Độ nặng từ 1 đến 5.' })
  weight: number;
}
