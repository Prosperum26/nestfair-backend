# NestFair API

Backend của **NestFair**, web-app quản lý ở ghép cho sinh viên. Đồ án cuối kỳ môn MSIS207 (Phát triển ứng dụng web, UIT), nhóm 2 người: Hưng và Thiện.

NestFair giúp một nhà trọ chia việc nhà công bằng, theo dõi chi tiêu chung và tìm thêm người ở ghép. Repo này là API (REST + Socket.IO); giao diện nằm ở repo [nestfair-frontend](https://github.com/Prosperum26/nestfair-frontend).

## Tính năng

1. **Việc nhà:** lịch xoay vòng công bằng (rào 3 tuần), Shuffle, Lucky Wheel, check-in bằng ảnh và bạn cùng phòng duyệt chéo; đổi ca, nhờ trực dùm, làm bù hoặc tặng quà, Chợ ca.
2. **Chi tiêu:** chia tiền (EQUAL / CUSTOM / EXACT / ITEMIZED), Min Cash Flow rút gọn nợ, báo chuyển và xác nhận thanh toán, VietQR.
3. **Trợ lý AI phòng trọ:** chat riêng tư (Gemini), gợi ý xử lý sự cố đời sống, tạo nhắc nhở.
4. **OCR hóa đơn:** chụp hóa đơn, Gemini Vision trả bản nháp khoản chi, người dùng xác nhận mới lưu.
5. **Tìm người ở ghép:** tin đăng, trang công khai `/r/:slug`, poster kèm QR.

Ngoài phạm vi: tách thuế VAT (OCR chỉ lấy tổng thực trả), thanh toán thật, chat giữa thành viên, kiểm duyệt link/QR, bảng xếp hạng / huy hiệu / đổi thưởng, AI Mediator, Harmony Index, PDF report. AI không tự ghi dữ liệu: OCR chỉ trả bản nháp, gợi ý của trợ lý chỉ là nút để người dùng bấm.

## Công nghệ

| Lớp | Công nghệ |
| :--- | :--- |
| Framework | NestJS 12 (ESM), TypeScript 6 |
| Database | PostgreSQL 17 (Docker khi chạy máy), Prisma 7 + `@prisma/adapter-pg` |
| Xác thực | `@nestjs/jwt`, `passport-jwt`, `passport-google-oauth20`, `bcrypt` |
| Realtime | Socket.IO 4.8 (`@nestjs/websockets`) |
| Tác vụ nền | `@nestjs/schedule` (múi giờ `Asia/Ho_Chi_Minh`) |
| Bảo mật | Helmet, `@nestjs/throttler`, `class-validator` (ValidationPipe whitelist) |
| Tài liệu API | `@nestjs/swagger` tại `/api/docs` |
| Bên ngoài | Gemini (`@google/genai`), Cloudinary (ảnh) |
| Kiểm thử | Vitest 5, Supertest, oxlint |

## Chạy trên máy

Yêu cầu: Node 26 (xem `.nvmrc`; `package.json` đặt `>=26 <27`) và Docker (cho PostgreSQL).

```bash
npm install                  # tự chạy prisma generate
cp .env.example .env         # rồi đặt JWT_SECRET >= 64 ký tự (lệnh sinh có trong .env.example)
npm run db:up                # Postgres container `nestfair-postgres`, cổng 5433
npm run prisma:migrate       # áp migration + generate client
npm run seed                 # (tùy chọn) nạp dữ liệu demo, xem mục Tài khoản demo
npm run start:dev            # http://localhost:5000/api/v1
```

Swagger: http://localhost:5000/api/docs. Kiểm tra sống: `GET /api/v1/health/live`.

Muốn chạy bản build: `npm run build` rồi `npm run start:prod`.

### Biến môi trường

Sao chép từ `.env.example`; không commit `.env`.

| Biến | Ý nghĩa |
| :--- | :--- |
| `PORT`, `NODE_ENV` | Cổng (mặc định 5000) và chế độ chạy. |
| `CORS_ORIGINS` | Origin của frontend, cách nhau bằng dấu phẩy. |
| `TRUST_PROXY_HOPS` | Số proxy đứng trước server để throttle lấy đúng IP: 0 khi chạy máy, Render = 1, Cloudflare + Render = 2. |
| `COOKIE_SAME_SITE` | sameSite của cookie refresh (tùy chọn); để trống = production `none`, máy dev `lax`. |
| `PUBLIC_WEB_URL` | Gốc link tin tìm người ở ghép (`<PUBLIC_WEB_URL>/r/<slug>`) và mã QR trên poster. |
| `PUBLIC_API_URL` | URL công khai của API, hiện trong danh sách Servers của Swagger; để trống = chỉ localhost. |
| `DATABASE_URL` | Chuỗi kết nối PostgreSQL (mẫu trong `.env.example` trỏ tới container Docker cổng 5433). |
| `JWT_SECRET` | Khóa ký access token, tối thiểu 64 ký tự. |
| `JWT_ACCESS_TTL_MINUTES`, `REFRESH_TOKEN_TTL_DAYS` | Thời hạn access token (15 phút) và refresh token (7 ngày). |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_CALLBACK_URL` | Đăng nhập Google; để trống = tắt. |
| `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` hoặc `CLOUDINARY_URL` | Upload ảnh (check-in, hóa đơn, avatar); để trống = tắt upload. |
| `GEMINI_API_KEY`, `GEMINI_MODEL` | OCR hóa đơn và trợ lý; để trống key = tắt OCR (chuyển nhập tay). Có key thì bắt buộc khai báo model, không hardcode trong code. |

## Tài khoản demo

`npm run seed` nạp **Nhà 12A** với 4 tài khoản, chạy lại bao nhiêu lần cũng được. Mật khẩu chung: `NestFair123`.

| Email | Vai trò |
| :--- | :--- |
| `hung@nestfair.demo` | Trưởng phòng |
| `thien@nestfair.demo` | Thành viên |
| `mai@nestfair.demo` | Thành viên |
| `quan@nestfair.demo` | Thành viên |

Mã mời Nhà 12A: `K7M2QZ` (tối đa 5 người nên còn 1 chỗ để thử luồng vào nhà bằng mã). Dữ liệu mẫu gồm lịch trực, dữ liệu đổi ca, sổ chi tháng 10.2026 tổng 2.280.000đ (sau rút gọn: Thiện → Mai 380.000đ, Hùng → Quân 170.000đ), khoản chi từ OCR, tin tìm người ở ghép, tin nhắn trợ lý và nhắc nhở.

Đây là dữ liệu demo công khai. Không chạy seed trên production.

## Kiểm thử và chất lượng

| Lệnh | Việc |
| :--- | :--- |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | oxlint (type-aware) cho `src/`, `test/`, `prisma/` |
| `npm test` | Unit test Vitest (`src/**/*.spec.ts`) |
| `npm run test:cov` | Unit test kèm coverage |
| `npm run test:e2e` | E2E (`test/*.e2e-spec.ts`), **cần DB đang chạy** (`npm run db:up`) |
| `npm run format` | Prettier |
| `npm run docs:export` | Build và xuất OpenAPI ra `docs/openapi.json` |

Chạy như CI trên máy:

```bash
npm ci
npm run typecheck && npm run lint && npm test && npm run build
npm run db:up && npm run test:e2e -- --maxWorkers=4
```

### CI/CD (GitHub Actions, thư mục `.github/workflows/`)

| Workflow | Việc |
| :--- | :--- |
| `ci.yml` | Typecheck, lint, unit test, build; e2e trên Postgres 17. Push vào `dev` hoặc `main` thì gọi `deploy.yml`. |
| `security.yml` | `npm audit` (mức high trở lên), gitleaks, Semgrep, CodeQL; chạy cả theo lịch hằng tuần. |
| `pr-title.yml` | Kiểm tiêu đề PR theo Conventional Commits. |
| `deploy.yml` | Migrate DB, gọi deploy hook Render theo đúng commit, đợi bản mới, smoke test, rollback nếu lỗi. Prod có `pg_dump` trước khi migrate và chờ duyệt Environment `prod`. |
| `seed-dev.yml` | Chạy tay: nạp lại dữ liệu demo cho môi trường dev (gõ `seed dev` để xác nhận). |

## Cấu trúc thư mục

```text
prisma/                 schema.prisma, migrations/, seed.ts, seed-listing.ts
src/
├── main.ts             bootstrap + Swagger
├── app.setup.ts        prefix /api/v1, Helmet, cookie-parser, CORS, ValidationPipe (dùng chung cho e2e)
├── config/             kiểm tra biến môi trường lúc khởi động
├── common/             tiện ích dùng chung (swagger, throttle, lỗi có code, ngày giờ VN)
├── prisma/             PrismaService (global)
├── generated/prisma/   Prisma client (sinh ra, không commit)
└── modules/
    ├── auth/  users/  houses/  membership/
    ├── chores/  wheel/  swaps/        việc nhà, Lucky Wheel, đổi ca
    ├── expenses/  settlements/        chi tiêu, Min Cash Flow, thanh toán
    ├── receipts/  ai/  assistant/  reminders/
    ├── listing/                       tin tìm người ở ghép, trang công khai
    ├── events/  notifications/  activity/
    ├── scheduler/                     cron
    └── uploads/                       Cloudinary
test/                   e2e
docs/                   DEPLOY.md, openapi.json
```

Thuật toán thuần (xoay vòng, chia tiền, Min Cash Flow...) nằm ở `<module>/algorithms/*.ts` kèm `*.spec.ts`.

Mọi route trong nhà đi qua `/houses/:houseId/...` với `JwtAuthGuard` + `HouseMemberGuard`; `houseId` lấy từ membership đã xác thực, không tin dữ liệu client gửi.

## Triển khai

Có hai môi trường, mỗi môi trường một bộ dịch vụ riêng:

| | dev | production |
| :--- | :--- | :--- |
| Nhánh | `dev` | `main` |
| Backend | Render (Free) `nestfair-api-dev` | Render (Free) `nestfair-api-prod` |
| Frontend | Cloudflare Pages `nestfair-dev` | Cloudflare Pages `nestfair-prod` |
| Database | Neon | Neon |

Bản dev đang chạy:

- Web: https://nestfair-dev.pages.dev
- API: https://nestfair-api-dev.onrender.com (Swagger: https://nestfair-api-dev.onrender.com/api/docs)

Production và tên miền riêng chưa được thiết lập. Render Free ngủ sau 15 phút không có request nên lần gọi đầu có thể chậm vài chục giây. Hướng dẫn thiết lập đầy đủ (Neon, Render Blueprint `render.yaml`, Cloudflare Pages, GitHub Environments) nằm ở [docs/DEPLOY.md](docs/DEPLOY.md).

## Quy trình Git

- Nhánh: `main` (production) ← `dev` ← `feat/<module>-<mô-tả>`. Không push thẳng `main` hay `dev`.
- Mỗi issue một PR vào `dev`, người còn lại review rồi mới merge.
- Commit và tiêu đề PR theo Conventional Commits có scope module, ví dụ `feat(chores): ...`, `fix(expenses): ...`.

Chi tiết xem [CONTRIBUTING.md](CONTRIBUTING.md).

---

# Ghi chú kỹ thuật theo module

Phần dưới là tài liệu chi tiết của từng module (đã có từ trước).

## Thêm một module thuộc nhà (chores, expenses…)

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

Check-in việc nhà, ảnh hóa đơn và bill chuyển khoản cần ảnh. Điền `CLOUDINARY_URL=cloudinary://<api_key>:<api_secret>@<cloud_name>` vào `.env` (Cloudinary Dashboard → API Keys → "API Environment variable"), hoặc 3 biến tách rời `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` (ưu tiên hơn URL nếu có cả hai). Chưa điền thì `POST /assignments/:id/checkin` trả `503`.

## Hồ sơ người dùng

Mọi route cần JWT, chỉ tác động lên chính người đang đăng nhập (không nhận `userId` từ client).

| Method | Path | Ghi chú |
| :--- | :--- | :--- |
| GET / PATCH | `/users/me` | Họ tên, SĐT, ngân hàng (`bankBin`) + STK. `null` xóa SĐT hoặc cả cặp ngân hàng + STK; lệch cặp trả 400. |
| POST | `/users/me/avatar` | multipart field `avatar` (JPG/PNG/WEBP, tối đa 5MB, kiểm tra magic bytes) lên Cloudinary `users/<id>/avatar`. Lưu URL mới rồi mới xóa ảnh cũ; ảnh cũ không thuộc Cloudinary (vd. ảnh Google) thì giữ nguyên. Thiếu file: 400 `AVATAR_REQUIRED`. |
| DELETE | `/users/me/avatar` | Xóa URL và ảnh trên Cloudinary; chưa có avatar vẫn 200. |
| PATCH | `/users/me/notifications` | `{ expenseCreated?, choreDigest?, debtPaid? }`, khóa không gửi giữ nguyên. Cột `User.notificationPrefs` (JSON), `null` = chưa chỉnh = bật hết. |
| POST | `/auth/change-password` | `{ currentPassword, newPassword }` → 204. Thu hồi mọi refresh token khác, giữ phiên hiện tại (đọc cookie `nf_rt`). Lỗi mật khẩu trả **400** (`WRONG_PASSWORD`, `SAME_PASSWORD`, `PASSWORD_NOT_SET` cho tài khoản chỉ có Google) chứ không 401, để client không nhầm với phiên hết hạn. |

Hiện chỉ `choreDigest` có tác dụng: bản tin việc nhà 08:00 (`ChoreTodayDigestSource`) bỏ qua người đã tắt. `expenseCreated` và `debtPaid` mới được lưu, chưa có nơi gửi thông báo riêng nên giao diện hiện "Sắp có".

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

## Chi tiêu & thanh toán (Issue #9)

**Nguyên tắc.** Tiền là số nguyên VNĐ. Không lưu bảng nợ: số dư ròng của mỗi người = `Σ đã trả − Σ phần chịu`, cộng chỉnh theo settlement `CONFIRMED`
(người chuyển +, người nhận −), tính lại từ dữ liệu gốc mỗi lần (`LedgerService`). Settlement `PENDING` chưa tính.

- **Chia tiền** (`expenses/algorithms/split.ts`): `EQUAL` chia cả nhà, `CUSTOM` chia đều cho người được chọn, `EXACT` nhập từng người (tổng phải khớp).
  Phần dư cộng lần lượt 1đ từ người vào nhà sớm nhất. `ITEMIZED` chia theo từng món (xem mục "Quét hóa đơn").
- **Min Cash Flow** (`expenses/algorithms/min-cash-flow.ts`): ghép con nợ lớn nhất với chủ nợ lớn nhất, tối đa N−1 giao dịch, kết quả xác định.
  Ném lỗi nếu tổng số dư khác 0 thay vì âm thầm làm mất tiền.
- **Báo chuyển / xác nhận:** người nợ tạo `PENDING` (không vượt số còn nợ và số người nhận còn được nhận), người nhận xác nhận → `CONFIRMED`.
  Mỗi cặp chỉ một báo đang chờ (partial unique index). Xác nhận là một `UPDATE ... WHERE status = 'PENDING'` nên bấm đúp chỉ thành công một lần.

**API** (prefix `/api/v1/houses/:id`):

| Method | Endpoint | Ghi chú |
| :-- | :-- | :-- |
| GET | `/expenses?month=2026-10&payerId=&category=&q=` | sổ chi theo tháng (giờ VN), kèm `splits`, `myShare`, `canEdit` |
| GET | `/expenses/summary?month=` | tổng tháng, bạn đã trả, phần của bạn, `diff`, theo danh mục |
| POST | `/expenses` | `{ title, category, totalAmount, splitType, payerId?, participantIds? (CUSTOM), splits? (EXACT), items? (ITEMIZED), receiptScanId?, spentAt?, note?, receiptImageUrl? }` |
| POST | `/expenses/scan` | multipart `photo` → bản nháp hóa đơn, **không** lưu khoản chi (xem mục "Quét hóa đơn") |
| GET/PATCH/DELETE | `/expenses/:expenseId` | sửa/xóa: người trả, người ghi hoặc trưởng phòng; đổi tiền / kiểu chia thì chia lại |
| POST | `/expenses/receipt-image` | multipart `photo` → `{ url }` |
| GET | `/settlements/plan` | `members` (kèm `net`), `raw` (nợ chéo, sơ đồ "Trước"), `optimized` (kèm `pending`), `rawTotal`, `optimizedTotal` |
| GET | `/settlements/payment-info/:userId` | ngân hàng, STK đầy đủ, `accountName` bỏ dấu để dựng VietQR |
| GET | `/settlements?month=&scope=all\|mine` | lịch sử tất toán |
| POST | `/settlements` | `{ toUserId, amount, proofUrl?, note? }` → `PENDING` |
| POST | `/settlements/proof` | multipart `photo` → `{ url }` (bill chuyển khoản) |
| PATCH | `/settlements/:settlementId/confirm` | chỉ người nhận |
| PATCH | `/settlements/:settlementId/cancel` | người chuyển hoặc người nhận |

**Lỗi** (`code`): `SPLIT_INVALID`, `SPLIT_SUM_MISMATCH`, `RECEIPT_SCAN_NOT_FOUND`, `RECEIPT_SCAN_USED` (409), `NOT_A_HOUSE_MEMBER`, `SPENT_AT_IN_FUTURE`, `RECEIPT_URL_INVALID`,
`EXPENSE_NOT_FOUND`, `EXPENSE_FORBIDDEN`, `MEMBER_NOT_FOUND`, `PAYMENT_INFO_MISSING`, `SETTLEMENT_SELF`, `SETTLEMENT_AMOUNT_EXCEEDS_DEBT`,
`SETTLEMENT_ALREADY_PENDING` (409), `SETTLEMENT_NOT_PENDING` (409), `SETTLEMENT_NOT_FOUND`, `NOT_SETTLEMENT_RECEIVER`, `NOT_SETTLEMENT_PARTY`, `PROOF_URL_INVALID`.

**Realtime** (room `house:<id>`): `expense:new` `{ expenseId, title, payer, amount, fromReceipt }`, `expense:updated`, `expense:deleted`,
`settlement:requested`, `settlement:cancelled`, `debt:settled` `{ settlementId, fromUserId, toUserId, amount }`.

**Giới hạn đã biết.** Ảnh tải lên nhưng không gắn vào khoản chi / báo chuyển nào thì chưa có job dọn. Chưa chặn rời nhà khi số dư ≠ 0
(`LedgerService.netBalances` đã sẵn để issue nhà dùng). Greedy bảo đảm ≤ N−1 giao dịch, không bảo đảm ít nhất tuyệt đối.

## Quét hóa đơn OCR (Issue #11)

Chụp hóa đơn → Gemini Vision → **bản nháp** → người dùng sửa và gán món → lưu khoản chi `ITEMIZED`. AI không bao giờ tự ghi dữ liệu:
`POST /expenses/scan` chỉ tạo `ReceiptScan`, khoản chi chỉ có khi client gọi `POST /expenses` kèm `receiptScanId`.

**Bật.** Đặt `GEMINI_API_KEY` và `GEMINI_MODEL` trong `.env` (model không hardcode; bắt buộc có khi có key; ví dụ `gemini-3.5-flash-lite`). Để trống key = OCR tắt,
mọi lần quét trả về nhập tay. Cần thêm Cloudinary (ảnh được tải lên trước khi đọc).

**Quyền riêng tư.** Ảnh hóa đơn được gửi tới Google Gemini. Mỗi người tự đồng ý: `PATCH /users/me/ocr-consent { enabled }` đặt `User.ocrConsentAt`
(null = chưa đồng ý, hiện trong `/users/me`). Chưa đồng ý thì quét trả `403 OCR_CONSENT_REQUIRED`, kiểm tra trước cả upload và hạn mức. Đồng ý theo người, không theo nhà,
và tắt được bất cứ lúc nào. Điều khoản của gói free của Gemini có thể cho Google dùng dữ liệu để cải thiện sản phẩm: cần đọc lại điều khoản hiện hành trước khi dùng cho ảnh có thông tin cá nhân.

**`POST /houses/:houseId/expenses/scan`** (multipart `photo`, jpeg/png/webp ≤ 5MB; client nén ≤ 1MB, cạnh dài ≤ 1600px). Trả `201`:

```ts
{ scanId, imageUrl, latencyMs,
  mode: 'DRAFT' | 'MANUAL', reason: 'NOT_A_RECEIPT' | 'UNREADABLE' | 'AI_TIMEOUT' | 'AI_UNAVAILABLE' | null, message: string | null,
  draft: { merchant, purchasedAt /* YYYY-MM-DD | null */, total,
           items: [{ name, quantity, lineTotal, uncertain, note }],
           warnings: [{ code: 'ITEMS_TOTAL_MISMATCH' | 'DATE_MISSING' | 'DATE_IN_FUTURE' | 'DROPPED_ITEMS' | 'AI_NOTE', message }] } | null }
```

- **Không đọc được thì vẫn `201` với `mode: 'MANUAL'`** (ảnh mờ, không phải hóa đơn, tổng ≤ 0, Gemini lỗi hoặc quá 10 giây): ảnh đã tải lên vẫn dùng được để mở form nhập tay.
- **Hậu kiểm** (`receipts/receipt-sanity.ts`): `items` rỗng → `NOT_A_RECEIPT`; tổng ≤ 0, không nguyên hoặc > 1 tỷ → `UNREADABLE`; `|Σ món − tổng| / tổng > 2%` → cảnh báo `ITEMS_TOTAL_MISMATCH`;
  dòng giảm giá âm / 0đ bị loại kèm cảnh báo; chuỗi do AI trả về bị cắt độ dài và bỏ ký tự điều khiển. Không tách VAT, chỉ lấy tổng thực trả.
- **Hạn mức** 20 lượt quét / nhà / ngày (giờ VN, kể cả lượt lỗi); quá hạn mức `429 OCR_QUOTA_EXCEEDED` mà không upload hay gọi Gemini.
  Hai request song song ở mốc 19→20 có thể vượt 1 lượt.
- Mỗi lần quét lưu `ReceiptScan` (JSON gốc của AI, model, độ trễ) để debug và đánh giá độ chính xác trong báo cáo. Engine đọc ảnh nằm sau token `RECEIPT_EXTRACTOR`.

**Chia theo món** (`POST /expenses`, `splitType: 'ITEMIZED'`, `items: [{ name, lineTotal, userIds }]`, tối đa 100 món): mỗi món chia đều cho những người dùng nó;
phần chênh giữa `totalAmount` và tổng các món (giảm giá, phí) được chia **theo tỷ lệ tiền món của từng người**, dùng BigInt vì tích có thể vượt 2^53;
phần dư chia 1đ từ người vào nhà sớm nhất, nên Σ phần chia luôn bằng `totalAmount`. Ví dụ: tổng 100.000đ, món 60.000đ (a, b, c) và món 50.000đ (a) → a 63.636đ, b 18.182đ, c 18.182đ.
Gửi `receiptScanId` để gắn bản nháp: kiểm tra cùng nhà và chưa dùng, đánh dấu `USED` trong cùng transaction nên bấm lưu đúp chỉ ra một khoản chi (`409 RECEIPT_SCAN_USED`);
scan của nhà khác hoặc không có thì `404`. Khoản `ITEMIZED` đổi tiền hoặc kiểu chia phải gửi lại `items` để chia lại. `PATCH` không nhận `receiptScanId`.

**Danh sách món (lưu để xem lại).** `items: [{ name, lineTotal, userIds }]` (tối đa 100 món) được lưu ở cột JSON `Expense.items` với **mọi kiểu chia**, không chỉ `ITEMIZED`;
`GET` chi tiết và danh sách đều trả `items` (mảng rỗng nếu khoản không có, kể cả khoản cũ). `userIds` chỉ có nghĩa với `ITEMIZED` (bắt buộc ít nhất một người mỗi món); kiểu chia khác bỏ qua và lưu `[]`.
Danh sách món **không** đi vào phép tính: phần chia và số dư vẫn tính như cũ, và không ép tổng món bằng tổng hóa đơn (giảm giá, phí làm lệch). `ITEMIZED` có `items` rỗng hoặc món không người dùng trả `400 ITEMS_INVALID`.
`PATCH`: gửi `items` thì thay toàn bộ (`[]` = xóa); không gửi thì giữ nguyên; đổi khỏi `ITEMIZED` mà không gửi `items` thì giữ tên và tiền, xóa `userIds`.
Giới hạn: khoản lưu trước khi có tính năng không có danh sách món; chưa có API sửa từng món (chỉ thay cả danh sách); `items` là JSON nên chưa truy vấn được theo món xuyên khoản chi.

**Giới hạn đã biết.** Refresh trang xác nhận thì mất bản nháp phía client (chưa có API đọc lại); ảnh của scan không được dùng chưa có job dọn.

## Trợ lý & Nhắc nhở (Issue #12)

Chat riêng tư với trợ lý phòng trọ (Gemini) và nhắc nhở cá nhân. **AI không bao giờ tự ghi dữ liệu**: `suggestedActions` chỉ là nút gợi ý,
người dùng bấm thì client mới gọi API thường (`POST /reminders`, mở form chi tiêu có điền sẵn). Backend không tạo `Reminder` hay `Expense` khi trả lời chat.

**Bật.** Dùng chung `GEMINI_API_KEY` / `GEMINI_MODEL` với OCR (provider `GENAI_CLIENT` ở `AiModule`). Không có key, Gemini lỗi hoặc quá 10 giây thì
`POST` vẫn `201` với tin dự phòng "Trợ lý đang bận, thử lại sau ít phút" (không có nút hành động); nhắc nhở thủ công vẫn dùng được.

**Quyền riêng tư.** Tin nhắn theo `userId`: không API nào trả tin của người khác, kể cả cùng nhà. Gửi nội dung chat cho Google cần đồng ý riêng theo người:
`PATCH /users/me/assistant-consent { enabled }` đặt `User.assistantConsentAt` (khác `ocrConsentAt` vì dữ liệu khác). Chưa đồng ý thì `403 ASSISTANT_CONSENT_REQUIRED`,
kiểm tra trước hạn mức và trước khi gọi Gemini. Chỉ gửi dữ liệu tối thiểu: tên nhà, **số** thành viên (không gửi tên người khác), nội quy (≤ 2000 ký tự),
ca trực tuần này của người hỏi, giờ hiện tại, 10 tin gần nhất của thread. Nội dung người dùng và nội quy luôn là dữ liệu, không là chỉ thị (nằm ở `contents`, không ở `systemInstruction`).

| Method | Path | Ghi chú |
| :-- | :-- | :-- |
| GET | `/houses/:houseId/assistant/messages?threadId=&cursor=&limit=` | `{ items, nextCursor, threadId }`, chỉ tin của người gọi. `limit` mặc định 30, tối đa 50, `items` từ cũ đến mới. Không có `threadId` thì lấy thread mới nhất. |
| POST | `/houses/:houseId/assistant/messages` | `{ content (1–1000), threadId? }` → `201 { threadId, userMessage, assistantMessage, remaining }`. |
| GET | `/reminders?state=upcoming\|all&limit=` | Nhắc của tôi (mảng `ReminderDto[]`). `upcoming` = chưa gửi, `remindAt` tăng dần. |
| POST | `/reminders` | `{ houseId, title (1–120), remindAt, sourceMessageId?, actionIndex? }` → `201`. Có `sourceMessageId` thì `source = ASSISTANT`, `dedupeKey = msg:<id>:<index>`. |
| PATCH | `/reminders/:id` | `{ title?, remindAt? }`. Đã gửi → `409 REMINDER_ALREADY_SENT`. |
| DELETE | `/reminders/:id` | `200 { ok: true }`. Nhắc `SYSTEM` → `403 REMINDER_NOT_DELETABLE`. |
| PATCH | `/users/me/assistant-consent` | `{ enabled }` → `PublicUserDto` có `assistantConsentAt`. |

Mã lỗi: `ASSISTANT_CONSENT_REQUIRED` 403, `ASSISTANT_QUOTA_EXCEEDED` 429 (kèm `resetAt`), `REMIND_AT_INVALID` 400 (phải ở tương lai, trong 1 năm),
`REMINDER_ALREADY_CREATED` 409 (bấm nút AI hai lần), `REMINDER_ALREADY_SENT` 409, `REMINDER_NOT_DELETABLE` 403, `REMINDER_NOT_FOUND` 404,
`MESSAGE_NOT_FOUND` 404, `HOUSE_FORBIDDEN` 403, `REMINDER_SOURCE_INVALID` / `REMINDER_ACTION_INVALID` 400.

**Hạn mức.** 30 tin `USER` / người / ngày (ngày giờ VN, cộng mọi nhà của người đó, tính cả lần Gemini lỗi). Tin thứ 31 trả `429 ASSISTANT_QUOTA_EXCEEDED`
kèm `resetAt` (00:00 VN hôm sau), không lưu và không gọi Gemini.

**Hành động đề xuất.** `sanitizeReply` giữ tối đa 4 hành động thuộc `CREATE_REMINDER` | `CREATE_ADHOC_TASK` | `DRAFT_EXPENSE`; `CREATE_REMINDER` phải có `remindAt`
hợp lệ ở tương lai (trong 1 năm) nếu không thì bị bỏ; `estimatedAmount` phải là số nguyên 1…1.000.000.000. `actions[].done` cho biết nút `CREATE_REMINDER` đã được bấm (theo `dedupeKey`).
"Cuộc trò chuyện mới" là `threadId` mới; không có API xóa lịch sử.

**Cron** (`SchedulerModule`, múi giờ `Asia/Ho_Chi_Minh`, bỏ qua khi `NODE_ENV=test`):
- `ReminderCronService.dispatchDue` mỗi phút: quét nhắc đến hạn bằng `FOR UPDATE SKIP LOCKED` (nhiều instance không bắn đôi), đặt `sentAt`, thêm tin `SYSTEM` vào chat
  (người offline thấy lại sau), rồi sau commit mới emit `reminder:due { reminderId, title }` tới room `user:<userId>`. Nhắc quá hạn nhiều giờ vẫn bắn đúng một lần.
- `sendDailyDigest` 08:00: một nhắc `SYSTEM` tổng hợp mỗi người mỗi ngày về ca `TODO` hôm nay, `dedupeKey = digest:<YYYY-MM-DD>` nên chạy lại không tạo trùng. Nhắc `SYSTEM` sửa giờ được, không xóa được.

**Giới hạn đã biết.**
- `CREATE_ADHOC_TASK` **không có API riêng**: frontend chuyển người dùng sang Việc nhà, mở Vòng quay với tên việc (`payload.title`, cắt về 60 ký tự) điền sẵn. Người dùng tự chọn người tham gia, hạn rồi bấm Quay, và chỉ khi đó mới gọi `POST /houses/:houseId/wheel/spin` (server vẫn là bên chọn người trúng). Trạng thái "đã tạo" của nút chỉ lưu ở trình duyệt.
- Digest 08:00 hiện chỉ gồm ca trực hôm nay. Yêu cầu đổi ca sắp hết hạn và nợ ca chưa có bảng nguồn: issue đổi ca cắm thêm qua provider `DIGEST_SOURCES` (interface `DigestSource`).
- `ApiError` ở frontend bỏ phần thừa của body lỗi nên `resetAt` thường không tới được UI; UI hiện câu "Mai mình trò chuyện tiếp nhé".
