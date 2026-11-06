import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AppService } from './app.service.js';

@ApiTags('health')
@Controller('health')
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  @ApiOperation({
    summary: 'Health check',
    description:
      'Liveness and readiness probe for the hosting platform. Runs `SELECT 1` against PostgreSQL, so it also proves the ' +
      'database connection works. Returns 500 if the database is unreachable. No authentication required.',
  })
  @ApiOkResponse({
    description: 'The server and the database are up.',
    schema: { type: 'object', properties: { status: { type: 'string', example: 'ok' }, db: { type: 'string', example: 'up' } } },
  })
  health() {
    return this.appService.health();
  }
}
