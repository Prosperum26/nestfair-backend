# NestFair API

Backend của NestFair (đồ án MSIS207, UIT): NestJS 12 (ESM) + Prisma 7 + PostgreSQL 17.

## Chạy lần đầu

Cần Node 22+ và Docker.

```bash
npm install                  # tự chạy prisma generate
cp .env.example .env         # rồi đặt JWT_SECRET >= 64 ký tự (lệnh sinh có trong file)
npm run db:up                # Postgres container `nestfair-postgres`, cổng 5433
npm run prisma:migrate       # áp migration + generate client
npm run start:dev            # http://localhost:5000/api/v1
```

Swagger: http://localhost:5000/api/docs

## Lệnh

| Lệnh | Việc |
| :--- | :--- |
| `npm run start:dev` | Chạy dev, tự reload |
| `npm run typecheck` / `npm run lint` | Kiểm tra kiểu, oxlint |
| `npm test` | Unit test (Vitest, `src/**/*.spec.ts`) |
| `npm run test:e2e` | E2E (`test/*.e2e-spec.ts`), **cần DB đang chạy** |
| `npm run prisma:migrate` | Tạo/áp migration và generate client (Prisma 7 không tự generate sau migrate) |
| `npm run format` | Prettier |

## Cấu trúc

```text
prisma/                 schema.prisma, migrations/
src/
├── main.ts             bootstrap + Swagger
├── app.setup.ts        prefix /api/v1, Helmet, cookie-parser, CORS, ValidationPipe (dùng chung cho e2e)
├── config/             kiểm tra biến môi trường lúc khởi động
├── prisma/             PrismaService (global)
├── generated/prisma/   Prisma client (sinh ra, không commit)
└── modules/
    ├── auth/           đăng ký, đăng nhập, refresh token, Google OAuth, JwtAuthGuard, @CurrentUser
    └── users/          hồ sơ + tài khoản nhận tiền (ngân hàng + STK)
test/                   e2e
```

Module mới: `src/modules/<tên>/` gồm `<tên>.module.ts`, controller, service, `dto/`, test `*.spec.ts` cạnh service. Route cần đăng nhập dùng `@UseGuards(JwtAuthGuard)` và lấy user bằng `@CurrentUser()`; trả user ra ngoài luôn qua `publicUserSelect`.

## Auth (tóm tắt)

- Access token JWT 15 phút trong body, client gửi `Authorization: Bearer`.
- Refresh token ngẫu nhiên trong cookie httpOnly `nf_rt` (path `/api/v1/auth`), DB chỉ lưu SHA-256, xoay vòng mỗi lần `POST /auth/refresh`.
- `rememberMe: false` thì cookie phiên (mất khi đóng trình duyệt).
- Google OAuth chỉ bật khi `.env` có `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET`. Chưa có thì `GET /auth/config` trả `googleEnabled: false` và `/auth/google` trả 404.

### Bật Google OAuth

1. Google Cloud Console → APIs & Services → Credentials → OAuth client ID (Web application).
2. Authorized redirect URI: `http://localhost:5000/api/v1/auth/google/callback` (production: URL backend thật).
3. Điền `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_CALLBACK_URL` vào `.env`, khởi động lại server.
