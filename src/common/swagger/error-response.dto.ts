import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** Error body shared by every non-2xx response (the NestJS standard shape plus a stable business `code`). */
export class ErrorResponseDto {
  @ApiProperty({ example: 409, description: 'HTTP status code, repeated in the body.' })
  statusCode: number;

  @ApiProperty({
    oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
    example: 'The house still has unsettled balances.',
    description:
      'Human-readable explanation. Localized in Vietnamese for the web UI, so never branch on it. Request validation failures return an array with one entry per invalid field.',
  })
  message: string | string[];

  @ApiProperty({ example: 'Conflict', description: 'HTTP status name.' })
  error: string;

  @ApiPropertyOptional({
    example: 'HAS_BALANCE',
    description:
      'Stable machine-readable business error code (see the error code catalogue in the API overview). Absent on plain validation (400) and authentication (401) errors.',
  })
  code?: string;
}
