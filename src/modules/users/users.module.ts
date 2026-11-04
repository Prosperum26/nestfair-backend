import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { UploadsModule } from '../uploads/uploads.module.js';
import { UsersController } from './users.controller.js';
import { UsersService } from './users.service.js';

@Module({
  imports: [AuthModule, UploadsModule],
  controllers: [UsersController],
  providers: [UsersService],
})
export class UsersModule {}
