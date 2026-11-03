import { GoogleGenAI } from '@google/genai';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.validation.js';
import { GENAI_CLIENT } from '../receipts/gemini-receipt.extractor.js';

/**
 * Client Gemini dùng chung cho các module AI (quét hóa đơn, sau này là Trợ lý). Chưa có `GEMINI_API_KEY`
 * thì client là `null` — nơi inject phải xử lý trường hợp AI tắt thay vì tạo client thứ hai.
 */
@Module({
  providers: [
    {
      provide: GENAI_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => {
        const apiKey = config.get('GEMINI_API_KEY', { infer: true });
        return apiKey ? new GoogleGenAI({ apiKey }) : null;
      },
    },
  ],
  exports: [GENAI_CLIENT],
})
export class AiModule {}
