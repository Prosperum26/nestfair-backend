import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { PrismaService } from './prisma/prisma.service.js';

describe('AppController', () => {
  let controller: AppController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        AppService,
        {
          provide: PrismaService,
          useValue: { $queryRaw: vi.fn().mockResolvedValue([1]) },
        },
      ],
    }).compile();

    controller = module.get(AppController);
  });

  it('trả về ok khi database phản hồi', async () => {
    await expect(controller.health()).resolves.toEqual({
      status: 'ok',
      db: 'up',
    });
  });
});
