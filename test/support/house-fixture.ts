import { INestApplication } from '@nestjs/common';
import { Test, type TestingModuleBuilder } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/app.setup.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';

export interface TestUser {
  id: string;
  token: string;
}

/** Khởi tạo app + helper tạo user/nhà cho e2e. `domain` để dọn dữ liệu cuối test. */
export async function createFixture(
  domain: string,
  configure: (builder: TestingModuleBuilder) => TestingModuleBuilder = (b) => b,
) {
  let seq = 0;
  const moduleRef = await configure(
    Test.createTestingModule({ imports: [AppModule] }),
  ).compile();
  const app: INestApplication<App> = moduleRef.createNestApplication();
  configureApp(app);
  await app.init();
  const prisma = app.get(PrismaService);
  const http = () => request(app.getHttpServer());

  async function user(fullName: string): Promise<TestUser> {
    const res = await http()
      .post('/api/v1/auth/register')
      .send({
        fullName,
        email: `u${Date.now()}-${seq++}${domain}`,
        phone: '0901234567',
        password: 'MatKhau123',
      })
      .expect(201);
    return { id: res.body.user.id, token: res.body.accessToken };
  }

  const as = (token: string) => ({
    get: (path: string) => http().get(path).set('Authorization', `Bearer ${token}`),
    post: (path: string, body?: object) =>
      http().post(path).set('Authorization', `Bearer ${token}`).send(body),
    patch: (path: string, body?: object) =>
      http().patch(path).set('Authorization', `Bearer ${token}`).send(body),
    delete: (path: string) => http().delete(path).set('Authorization', `Bearer ${token}`),
  });

  /** Tạo nhà: người đầu là ADMIN, những người sau vào bằng mã mời. */
  async function houseWith(names: string[]) {
    const users = [];
    for (const n of names) users.push(await user(n));
    const created = await as(users[0].token)
      .post('/api/v1/houses', { name: 'Nhà test', maxMembers: Math.max(2, names.length) })
      .expect(201);
    for (const u of users.slice(1)) {
      await as(u.token).post('/api/v1/houses/join', { inviteCode: created.body.inviteCode }).expect(200);
    }
    const members = await prisma.houseMember.findMany({ where: { houseId: created.body.id } });
    const memberId = (u: TestUser) => members.find((m) => m.userId === u.id)!.id;
    return { houseId: created.body.id as string, users, memberId };
  }

  async function cleanup() {
    await prisma.house.deleteMany({
      where: { members: { some: { user: { email: { endsWith: domain } } } } },
    });
    await prisma.user.deleteMany({ where: { email: { endsWith: domain } } });
    await app.close();
  }

  return { app, prisma, http, as, user, houseWith, cleanup };
}
