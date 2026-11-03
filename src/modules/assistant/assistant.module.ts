import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { HousesModule } from '../houses/houses.module.js';
import { AssistantController } from './assistant.controller.js';
import { ASSISTANT_GENERATOR, GeminiAssistantGenerator } from './assistant-generator.js';
import { AssistantService } from './assistant.service.js';

/**
 * Trợ lý AI riêng tư (Issue #12). Câu sinh nằm sau token `ASSISTANT_GENERATOR` (hiện là Gemini, quyết
 * định D3) để test thay bằng bản giả; client Gemini dùng chung từ AiModule (null khi chưa có key —
 * mọi lượt chat trả tin dự phòng).
 */
@Module({
  imports: [AiModule, AuthModule, HousesModule],
  controllers: [AssistantController],
  providers: [AssistantService, { provide: ASSISTANT_GENERATOR, useClass: GeminiAssistantGenerator }],
})
export class AssistantModule {}
