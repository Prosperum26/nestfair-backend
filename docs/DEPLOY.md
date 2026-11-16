# Deploy NestFair: hướng dẫn thiết lập lần đầu

Áp dụng cho cả `nestfair-backend` và `nestfair-frontend`. Làm theo đúng thứ tự: mỗi bước cần thông tin của bước trước.
Dev dùng `*.onrender.com` và `*.pages.dev`. Prod chạy trên tên miền riêng `nestfair.cloud` (web) và `api.nestfair.cloud` (API); cách gắn tên miền ở Bước 7.

## Tổng quan

| | dev | prod |
|---|---|---|
| Nhánh | `dev` | `main` |
| Backend (Render Free) | `nestfair-api-dev` | `nestfair-api-prod` |
| Frontend (Cloudflare Pages) | project `nestfair-dev` | project `nestfair-prod` |
| DB (Neon Free) | branch `development` | branch `production` (cùng một project Neon) |
| Địa chỉ web | `https://nestfair-dev.pages.dev` | `https://nestfair.cloud` |
| Địa chỉ API | `https://nestfair-api-dev.onrender.com` | `https://api.nestfair.cloud` |
| Ảnh (Cloudinary) | dùng chung tài khoản | dùng chung tài khoản |

Luồng tự động sau khi thiết lập:

1. PR vào `dev`: `ci` (typecheck, lint, test, build, e2e), `security`, `pr-title`.
2. Merge vào `dev`: CI xanh → **deploy dev** (backend: migrate → deploy đúng commit → đợi → smoke test → rollback nếu lỗi; frontend: build với `VITE_API_URL` → Pages → smoke test) → **verify-dev** (Playwright + Lighthouse) → tự mở PR `dev → main` ở cả hai repo.
3. Merge PR `dev → main`: **deploy prod** (backend có `pg_dump` trước khi migrate), dừng chờ bạn duyệt ở Environment `prod`.

> **Lưu ý:** `main` hiện chậm hơn `dev` rất nhiều (chưa từng release). PR release đầu tiên sẽ mang toàn bộ thay đổi lên prod; đó cũng là lúc các workflow chạy theo lịch, chạy tay (`seed-dev`) và `repository_dispatch` bắt đầu có hiệu lực, vì GitHub chỉ đọc các workflow loại này từ nhánh mặc định.

## Bước 1. Neon (1 project, 2 branch)

1. Đăng ký [neon.com](https://neon.com), tạo một project: Postgres 18 (chọn 18 để khớp bước sao lưu `pg_dump` dùng image `postgres:18`), region **AWS Asia Pacific (Singapore)**.
2. Trong project, tạo hai branch `development` và `production` (branch mặc định làm parent). Mỗi branch là một database độc lập với chuỗi kết nối riêng.
3. Với mỗi branch, mở **Connect**, **tắt Connection pooling** để lấy chuỗi *direct* (host không có `-pooler`), giữ `sslmode=require`.
   Backend dùng khóa advisory và `SELECT ... FOR UPDATE` trong transaction, chuỗi direct tránh bất ngờ với pooler.
4. Giữ hai chuỗi kết nối ở chỗ an toàn. **Không dán vào chat, không commit.** Lỡ lộ thì reset mật khẩu role trong Neon rồi cập nhật lại ở Render và GitHub.

## Bước 2. Render (2 service bằng Blueprint)

1. Đăng ký [render.com](https://render.com), kết nối GitHub (cấp quyền cho repo `nestfair-backend`).
2. **New → Blueprint**, chọn repo `nestfair-backend`, nhánh có file `render.yaml` (sau khi PR CI/CD được merge thì chọn `dev`).
3. Render hỏi các biến `sync: false` cho từng service. Điền:

| Biến | dev | prod |
|---|---|---|
| `DATABASE_URL` | chuỗi direct Neon, branch `development` | chuỗi direct Neon, branch `production` |
| `JWT_SECRET` | chuỗi ngẫu nhiên ≥ 64 ký tự (`node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`) | **chuỗi khác** với dev |
| `CORS_ORIGINS` | `https://nestfair-dev.pages.dev` | `https://nestfair.cloud` (lúc đầu `https://nestfair-prod.pages.dev`, đổi ở Bước 7) |
| `PUBLIC_WEB_URL` | `https://nestfair-dev.pages.dev` | `https://nestfair.cloud` |
| `PUBLIC_API_URL` | `https://nestfair-api-dev.onrender.com` | `https://api.nestfair.cloud` |
| `COOKIE_SAME_SITE` | không đặt (dev khác site, dùng mặc định) | `lax` (chỉ khi web và API cùng site `nestfair.cloud`) |
| `TRUST_PROXY_HOPS` | `1` (mặc định trong `render.yaml`) | `2` |
| `CLOUDINARY_URL` | `cloudinary://<key>:<secret>@<cloud>` | như dev (hoặc tài khoản riêng) |
| `GEMINI_API_KEY`, `GEMINI_MODEL` | khóa và model đang dùng | như dev |

   Tên `*.pages.dev` và `*.onrender.com` ở trên là dự kiến: nếu tên đã có người dùng, Render/Cloudflare sẽ thêm hậu tố. Lấy URL thật ở Bước 2.5 và Bước 3.3 rồi sửa lại cho khớp.
4. Lần build đầu (Render tự chạy khi tạo service) **có thể lỗi health check** vì code trên `dev`/`main` lúc đó chưa có `/api/v1/health/live`. Không sao: các lần deploy sau do GitHub Actions điều khiển.
5. Mở từng service, ghi lại:
   - URL công khai (vd. `https://nestfair-api-dev.onrender.com`).
   - **Settings → Deploy Hook**: chép URL (dạng `https://api.render.com/deploy/srv-...?key=...`). Đây là bí mật.
6. Kiểm **Settings**: Auto-Deploy = Off, Health Check Path = `/api/v1/health/live`, Region = Singapore.

## Bước 3. Cloudflare Pages (2 project)

1. Đăng ký [cloudflare.com](https://dash.cloudflare.com).
2. **My Profile → API Tokens → Create Token → Custom token**: quyền *Account · Cloudflare Pages · Edit*, áp cho tài khoản của bạn. Chép token (bí mật). Lấy **Account ID** ở trang tổng quan Workers & Pages.
3. Tạo hai project kiểu Direct Upload (chạy trên máy, đăng nhập bằng `npx wrangler login`):
   ```bash
   npx wrangler@4.156.0 pages project create nestfair-dev --production-branch dev
   npx wrangler@4.156.0 pages project create nestfair-prod --production-branch main
   ```
   Ghi lại URL `https://<project>.pages.dev`.

## Bước 4. GitHub (cả hai repo)

### 4.1 Chuyển public
Settings → General → Danger Zone → **Change visibility → Public**. Lịch sử đã quét bằng gitleaks ngày 14/11/2026: không có secret.
Sau đó: Settings → Actions → General → *Fork pull request workflows from outside collaborators* → **Require approval for all outside collaborators**.

### 4.2 PAT dùng chung (một lần)
GitHub → Settings → Developer settings → **Fine-grained tokens → Generate**:
- Resource owner: tài khoản sở hữu hai repo; Repository access: chỉ `nestfair-backend` và `nestfair-frontend`.
- Permissions: **Contents: Read and write**, **Pull requests: Read and write** (Metadata tự có).
- Dùng để: backend báo frontend chạy verify (`repository_dispatch`) và mở PR `dev → main` (PR do `GITHUB_TOKEN` mở sẽ không chạy CI).

### 4.3 Environments
Settings → Environments → tạo `dev` và `prod` ở **mỗi repo**.

`prod`: bật **Required reviewers** (bạn), **Deployment branches** = Selected → `main`.
`dev`: **Deployment branches** = Selected → `dev`.

**nestfair-backend**

| Environment | Loại | Tên | Giá trị |
|---|---|---|---|
| dev, prod | variable | `API_URL` | URL Render của môi trường (không có `/` cuối) |
| dev, prod | secret | `DATABASE_URL` | chuỗi direct Neon của branch tương ứng |
| dev, prod | secret | `RENDER_DEPLOY_HOOK` | deploy hook của service tương ứng |
| dev, prod | secret | `CROSS_REPO_TOKEN` | PAT ở 4.2 |
| dev, prod | secret | `DISCORD_WEBHOOK_URL` | (tùy chọn) |

**nestfair-frontend**

| Environment | Loại | Tên | Giá trị |
|---|---|---|---|
| dev, prod | variable | `API_URL` | địa chỉ API của môi trường (prod: `https://api.nestfair.cloud`) |
| dev, prod | variable | `WEB_URL` | dev: `https://nestfair-dev.pages.dev`; prod: `https://nestfair.cloud` |
| dev, prod | variable | `PAGES_PROJECT` | `nestfair-dev` / `nestfair-prod` |
| dev, prod | secret | `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | ở Bước 3.2 |
| dev | secret | `CROSS_REPO_TOKEN` | PAT ở 4.2 (mở PR release) |
| dev, prod | secret | `DISCORD_WEBHOOK_URL` | (tùy chọn) |

Smoke test dùng tài khoản seed mặc định (`hung@nestfair.demo`). Muốn đổi thì thêm variable `DEMO_LOGIN_EMAIL`, `DEMO_LOGIN_PASSWORD` cho Environment `dev` và nối vào bước `npx playwright test` trong `verify-dev.yml`.

### 4.4 Bảo vệ nhánh
Settings → Branches → thêm rule cho `dev` và `main`: bắt buộc PR, bắt buộc check xanh, cấm force-push. Check cần chọn (xuất hiện sau lần chạy đầu tiên):
- backend: `typecheck · lint · unit · build`, `e2e (Postgres 17)`, `npm audit (production deps)`, `gitleaks (toàn bộ lịch sử)`, `semgrep`, `codeql`
- frontend: `typecheck · lint · test · build`, `npm audit (production deps)`, `gitleaks (toàn bộ lịch sử)`, `semgrep`, `codeql`
- `tiêu đề Conventional Commits`: tùy bạn. Một số PR cũ đặt tên kiểu "Enhance …" sẽ không qua.

### 4.5 (Khuyến nghị) Đổi nhánh mặc định sang `dev`
Settings → General → Default branch → `dev`. Workflow chạy tay (`seed-dev`), chạy theo lịch và `repository_dispatch` sẽ có hiệu lực ngay, không phải đợi release đầu; PR mới cũng mặc định nhắm `dev`. `main` vẫn là production.

## Bước 5. Lần deploy đầu

1. Merge PR CI/CD (`ci/pipeline-setup`) vào `dev` ở **backend trước**, rồi frontend.
2. Theo dõi tab Actions: backend `ci → deploy dev`; frontend `ci → deploy dev → verify dev`.
3. Nạp dữ liệu demo cho dev:
   - nếu đã làm 4.5: Actions → `seed-dev` → Run workflow, gõ `seed dev`;
   - nếu chưa: chạy trên máy `DATABASE_URL="<chuỗi Neon dev>" npm run seed` (trong `nestfair-backend`).
4. Chạy lại `verify-dev` (Actions → Run workflow, hoặc push một commit nhỏ vào `dev`). Xanh thì PR `dev → main` tự mở ở hai repo.
5. Review và merge PR release **backend trước**, duyệt Environment `prod` → đợi deploy prod xanh → merge PR release frontend.
6. **Không seed prod.** Mật khẩu seed nằm công khai trong mã nguồn.

## Bước 6. Giám sát
- [UptimeRobot](https://uptimerobot.com): monitor HTTP mỗi 5 phút vào `https://api.nestfair.cloud/api/v1/health/live` (không chạm DB nên Neon vẫn ngủ được). **Không** tạo monitor cho dev. Muốn giữ cả DB thức khi demo thì đổi sang `/api/v1/health` trong khung giờ demo.
- Render cho 750 giờ free mỗi tháng **cho cả workspace**: prod chạy 24/7 tốn khoảng 744 giờ. Kiểm số giờ đã dùng mỗi ngày ở Render Dashboard. Chỉ bật monitor trong đợt demo và chấm điểm, xong thì **Pause**.
- Prod đã dùng cùng site `nestfair.cloud`, nên cookie `lax` giữ được phiên trên mọi trình duyệt. Dev vẫn khác site (`pages.dev` và `onrender.com`): Safari và Firefox có thể mất phiên khi tải lại, demo dev bằng Chrome hoặc Edge.

## Bước 7. Tên miền (prod đã làm ngày 15/11/2026)

Tên miền `nestfair.cloud` mua ở Mắt Bão, DNS do Cloudflare quản lý. Chỉ gắn cho **prod**; dev giữ nguyên địa chỉ `pages.dev` và `onrender.com`.

1. **Đưa DNS về Cloudflare:** Cloudflare → Add a domain → **Connect a domain** (không phải Transfer) → gói Free. Cloudflare cho hai nameserver; vào Mắt Bão → Name Server → *Sử dụng Name Server tùy chỉnh*, nhập hai nameserver đó, bỏ `ns1/ns2.matbao.com`. Đợi trạng thái **Active** (từ vài phút đến vài giờ). Kiểm DNSSEC ở nhà đăng ký đang tắt.
2. **Web:** Workers & Pages → `nestfair-prod` → Custom domains → `nestfair.cloud`. Cloudflare tự tạo bản ghi DNS và cấp SSL.
3. **API:** trong Cloudflare DNS thêm `CNAME api → nestfair-api-prod.onrender.com`, **Proxy status = DNS only** (đám mây xám) để Render tự xác minh và cấp chứng chỉ. Render → `nestfair-api-prod` → Settings → Custom Domains → thêm `api.nestfair.cloud` → Verify → đợi *Certificate Issued*. Kiểm `https://api.nestfair.cloud/api/v1/health/live`.
4. **Đổi biến, chỉ làm sau khi bước 2 và 3 chạy:**
   - Render (`nestfair-api-prod`): `CORS_ORIGINS=https://nestfair.cloud`, `PUBLIC_WEB_URL=https://nestfair.cloud`, `PUBLIC_API_URL=https://api.nestfair.cloud`, `COOKIE_SAME_SITE=lax`, `TRUST_PROXY_HOPS=2` (và `GOOGLE_CALLBACK_URL` nếu bật Google). Chọn *Save and deploy*.
   - GitHub Environment `prod`, **Variables**: frontend `API_URL=https://api.nestfair.cloud`, `WEB_URL=https://nestfair.cloud`; backend `API_URL=https://api.nestfair.cloud`.
   - Chạy lại workflow `deploy` của frontend trên `main` (môi trường `prod`) để `VITE_API_URL` và `connect-src` trong `_headers` lấy giá trị mới.
   - UptimeRobot: đổi URL monitor sang `https://api.nestfair.cloud/api/v1/health/live`.
5. **Kiểm:** đăng nhập trên `https://nestfair.cloud`, tải lại trang vẫn còn phiên; thử thêm trên Safari hoặc Firefox; Socket.IO.
6. **Lùi lại nếu hỏng:** đặt các biến Render về địa chỉ `pages.dev` và `onrender.com` cũ, bỏ `COOKIE_SAME_SITE`, `TRUST_PROXY_HOPS=1`; sửa biến GitHub về địa chỉ cũ rồi deploy lại frontend. Địa chỉ `nestfair-api-prod.onrender.com` vẫn hoạt động vì *Render Subdomain* đang bật.
7. **Còn tùy chọn:** Cloudflare rate limit `POST /api/v1/auth/*` (10 mỗi phút mỗi IP); ẩn thông tin WHOIS ở nhà đăng ký (Mắt Bão: gói *Bảo mật danh tính*).

> Không bật proxy (đám mây cam) cho bản ghi `api`: Render cần xác minh trực tiếp và Socket.IO dễ gặp lỗi qua proxy. Bản ghi của `nestfair.cloud` (Pages) thì để proxied.

## Xử lý sự cố
| Hiện tượng | Kiểm |
|---|---|
| Deploy dừng ở "Kiểm cấu hình môi trường" | Thiếu variable/secret trong Environment tương ứng (bảng 4.3). |
| "Đợi bản mới chạy" hết giờ | Render build lỗi (xem log Render) hoặc deploy hook sai service. Workflow tự gọi lại commit trước (rollback). |
| Smoke test frontend lỗi CSP | `API_URL` trong Environment không khớp URL Render thật (có `/` cuối hoặc sai tên). |
| Đăng nhập được nhưng gọi API bị CORS | `CORS_ORIGINS` trên Render chưa đúng URL Pages hoặc `https://nestfair.cloud` (không có `/` cuối). |
| Đăng nhập xong tải lại là mất phiên (prod) | `COOKIE_SAME_SITE` chưa là `lax`, hoặc web và API không cùng site (đang dùng `pages.dev` với `onrender.com`). |
| Render mãi `Certificate Pending` cho `api.nestfair.cloud` | Bản ghi `api` trong Cloudflare đang bật proxy (cam) hoặc trỏ sai target; đặt **DNS only**, target `nestfair-api-prod.onrender.com`. |
| Không thấy PR release tự mở | Chưa có `CROSS_REPO_TOKEN` trong Environment `dev` của frontend, hoặc `dev` không mới hơn `main`. |
| Migrate prod lỗi giữa chừng | Bản `pg_dump` nằm trong artifact `prod-db-<sha>` của lần chạy đó (giữ 30 ngày): `pg_restore --clean --no-owner -d "$DATABASE_URL" prod.dump`. |
