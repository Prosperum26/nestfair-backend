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
    ├── users/          hồ sơ + tài khoản nhận tiền (ngân hàng + STK)
    ├── houses/         nhà, mã mời, thành viên; HouseMemberGuard, HouseRolesGuard, @CurrentMembership
    ├── chores/         việc nhà: lịch xoay vòng công bằng (algorithms/), check-in ảnh, duyệt chéo, vắng mặt, nghỉ nhà, nhật ký
    ├── events/         Socket.IO gateway, EventsService (room house:<id>, user:<id>)
    ├── scheduler/      cron: tạo lịch tuần mới, quá hạn, tự duyệt, dọn ảnh, khóa tuần (xem mục Việc nhà)
    └── uploads/        CloudinaryService + kiểm tra ảnh (jpeg/png/webp, 5MB)
test/                   e2e
```

Module mới: `src/modules/<tên>/` gồm `<tên>.module.ts`, controller, service, `dto/`, test `*.spec.ts` cạnh service. Route cần đăng nhập dùng `@UseGuards(JwtAuthGuard)` và lấy user bằng `@CurrentUser()`; trả user ra ngoài luôn qua `publicUserSelect`.

### Thêm một module thuộc nhà (chores, expenses…)

Mọi dữ liệu của một nhà đi qua route `/houses/:houseId/...` và **luôn** có `HouseMemberGuard`:

```ts
// chores.module.ts
@Module({ imports: [HousesModule], controllers: [ChoresController], providers: [ChoresService] })
export class ChoresModule {}

// chores.controller.ts
@UseGuards(JwtAuthGuard, HouseMemberGuard)
@Controller('houses/:houseId/chores')
export class ChoresController {
  @Get()
  list(@CurrentMembership() m: HouseMembership) {
    return this.chores.list(m.houseId); // houseId đã xác thực, không lấy từ body/query
  }

  @Post()
  @HouseRoles('ADMIN')
  @UseGuards(HouseRolesGuard) // chỉ trưởng phòng
  create(@CurrentMembership() m: HouseMembership, @Body() dto: CreateChoreDto) { ... }
}
```

- `HouseMemberGuard`: houseId sai định dạng trả 404; không phải thành viên (hoặc đã rời nhà) trả 403. Gắn `{ id, houseId, userId, role }` vào request.
- Query trong service luôn lọc theo `m.houseId`; id con (choreId…) phải kiểm tra thuộc đúng nhà đó, nếu không thành viên nhà A sửa được dữ liệu nhà B.
- Thành viên còn ở nhà: `leftAt: null`.

## Dữ liệu demo

```bash
npm run seed       # Nhà 12A + 4 tài khoản, chạy lại bao nhiêu lần cũng được
```

| Email | Vai trò | Ngân hàng |
| :--- | :--- | :--- |
| `hung@nestfair.demo` | Trưởng phòng | Techcombank |
| `thien@nestfair.demo` | Thành viên | Vietcombank |
| `mai@nestfair.demo` | Thành viên | ACB |
| `quan@nestfair.demo` | Thành viên | MB Bank |

Mật khẩu chung: `NestFair123`. Mã mời Nhà 12A: `K7M2QZ` (seed đặt lại hạn 7 ngày mỗi lần chạy). Nhà 12A tối đa 5 người nên còn 1 chỗ để thử luồng vào nhà bằng mã.

## Auth (tóm tắt)

- Access token JWT 15 phút trong body, client gửi `Authorization: Bearer`.
- Refresh token ngẫu nhiên trong cookie httpOnly `nf_rt` (path `/api/v1/auth`), DB chỉ lưu SHA-256, xoay vòng mỗi lần `POST /auth/refresh`.
- `rememberMe: false` thì cookie phiên (mất khi đóng trình duyệt).
- Google OAuth chỉ bật khi `.env` có `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET`. Chưa có thì `GET /auth/config` trả `googleEnabled: false` và `/auth/google` trả 404.

### Bật Google OAuth

1. Google Cloud Console → APIs & Services → Credentials → OAuth client ID (Web application).
2. Authorized redirect URI: `http://localhost:5000/api/v1/auth/google/callback` (production: URL backend thật).
3. Điền `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_CALLBACK_URL` vào `.env`, khởi động lại server.

### Bật upload ảnh (Cloudinary)

Check-in việc nhà cần ảnh minh chứng. Điền `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` vào `.env` (lấy ở Cloudinary Dashboard). Chưa điền thì `POST /assignments/:id/checkin` trả `503`.

## Việc nhà (Issue #4 v2)

Đặc tả: lịch theo **ngày**, hai chế độ xoay, rào nới dần, check-in có cửa sổ và ân hạn, duyệt chéo, vắng mặt / nghỉ cả nhà.

**Khái niệm.** Một *ca* (`ChoreAssignment`) = một việc vào một ngày. Tuần ISO thứ Hai → Chủ Nhật theo giờ `Asia/Ho_Chi_Minh`;
mỗi (nhà, tuần) có đúng một `WeekSchedule` (`UNIQUE(houseId, weekStart)`, kèm `seed` để tái lập lịch).

- `WEEK_BLOCK`: một người sở hữu việc cả tuần. Rào `W_eff = min(3, số người)`: không làm lại cùng việc trong `W_eff − 1` tuần **có lịch** liền trước.
- `PER_OCCURRENCE`: mỗi lần một người, xoay bằng khối hoán vị Fisher-Yates, không ai làm hai lần liên tiếp (kể cả qua tuần).
- Vô nghiệm thì nới rào dần (`relaxed` + lý do `FEW_OPTIONS`); lý do khác: `SOLO_HOUSE`, `SMALL_HOUSE`, `MEMBER_ABSENT`, `NEW_MEMBER`, `PINNED_OVERRIDE`, `NO_CHORES`, `NO_ELIGIBLE_MEMBERS`, `HOUSE_BREAK`, `DAILY_CAP_EXCEEDED`.

**API chính** (prefix `/api/v1`, Swagger ở `/api/docs`):

| Method | Endpoint | Ghi chú |
| :-- | :-- | :-- |
| GET | `/houses/:id/assignments?week=2026-W41` | `{ schedule, assignments }`; tuần hiện tại/kế tiếp chưa có lịch thì sinh bù |
| POST | `/houses/:id/schedules/preview` | xem trước (dry-run), trả `seed` |
| POST | `/houses/:id/assignments/shuffle` | `{ weekKey, mode: CREATE \| REROLL }`; REROLL chỉ Admin, ≤ 2 lần, trước khi tuần bắt đầu |
| GET/POST/PATCH | `/houses/:id/chores` | `frequency`, `recurrenceDays`, `dueTime`, `rotationMode`, `occurrenceGap` |
| GET/PATCH | `/houses/:id/chore-settings` | ân hạn nộp muộn (giờ), số ca tối đa / người / ngày |
| POST | `/assignments/:id/checkin` | multipart `photo`, header `Idempotency-Key` |
| PATCH | `/assignments/:id/verify` | `{ decision: APPROVED \| REJECTED, reason? }` |
| POST | `/assignments/:id/appeal` | khiếu nại ca bị từ chối |
| PATCH | `/assignments/:id/override` | Admin: `FORCE_DONE`, `FORCE_REJECT`, `REASSIGN`, `CANCEL` |
| GET/POST/DELETE | `/houses/:id/absences`, `/houses/:id/breaks` | khai vắng / cả nhà vắng |
| GET | `/houses/:id/chore-audit?week=` | nhật ký thao tác |

**Lỗi.** Giữ format NestJS `{ statusCode, message, error }` và thêm `code`: `WEEK_OUT_OF_RANGE`, `SCHEDULE_LOCKED`, `SCHEDULE_HAS_ACTIVITY`, `REROLL_LIMIT`,
`ASSIGNMENT_STATE_CHANGED`, `PROOF_DUPLICATE`, `ASSIGNMENT_DISPUTED`, `NOT_ASSIGNEE`, `SELF_VERIFY_FORBIDDEN`, `ADMIN_ONLY`, `CHECKIN_NOT_OPEN`,
`CHECKIN_WINDOW_CLOSED`, `UNSUPPORTED_IMAGE` (415), `IMAGE_TOO_LARGE` (413), `UPLOAD_UNAVAILABLE` (503), `INVALID_DATE_RANGE`, `NOT_ELIGIBLE_ASSIGNEE`.

**Cron** (múi giờ `Asia/Ho_Chi_Minh`, an toàn nhiều instance, tắt khi `NODE_ENV=test`):

| Job | Lịch | Việc làm |
| :-- | :-- | :-- |
| `generateNextWeek` | CN 20:00 | tạo lịch tuần kế tiếp cho mọi nhà |
| `markMissed` | 5 phút | ca `TODO/REJECTED` quá `dueAt` + ân hạn của nhà → `MISSED` |
| `autoApprove` | 15 phút | `PENDING_VERIFY` quá 48 giờ → `DONE` (`AUTO_APPROVED`) |
| `reassignOrphans` | 10 phút | giao lại ca của người đã rời nhà |
| `cleanupProofs` | 03:00 | xóa ảnh minh chứng của ca `DONE` quá 60 ngày |
| `lockStartedWeeks` | 00:05 | `PUBLISHED` → `LOCKED` khi tuần đã bắt đầu |

Khi server khởi động cũng sinh bù lịch cho mọi nhà (cron có thể bị lỡ lúc server ngủ). Check-in / duyệt / khiếu nại giới hạn 20 lần / phút (`@nestjs/throttler`, bỏ qua khi test; đặt sau proxy thì cần cấu hình `trust proxy` để lấy đúng IP).

**Giới hạn đã biết.** Mỗi ca một người; chỉ lặp theo tuần; không chặn việc Admin tạo bản sao việc để né rào (chỉ có nhật ký); chống gian lận ảnh ở mức băm trùng + duyệt chéo;
chưa có "Xếp bổ sung" giữa tuần và duyệt khai vắng dài ngày.
