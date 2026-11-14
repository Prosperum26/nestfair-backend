# Đóng góp vào nestfair-backend

## Nhánh và PR
- `main` (production) ← `dev` ← `feat/<module>-<mô-tả>`. Không push thẳng `main` hay `dev`.
- Mỗi issue một PR vào `dev`; người còn lại trong nhóm review rồi mới merge.
- Tiêu đề PR và commit theo Conventional Commits có scope module: `feat(chores): ...`, `fix(expenses): ...`.
- `dev → main` chỉ merge khi bản dev đã deploy và kiểm tra xanh.

## Check bắt buộc trên PR
| Workflow | Kiểm |
|---|---|
| `ci` | typecheck, lint, unit test, build; e2e trên Postgres 17 |
| `security` | `npm audit` (high trở lên), gitleaks, Semgrep, CodeQL (khi repo public) |
| `pr-title` | tiêu đề theo Conventional Commits |

## Chạy như CI trên máy
```bash
npm ci
npm run typecheck && npm run lint && npm test && npm run build
npm run db:up && npm run test:e2e -- --maxWorkers=4   # máy yếu hoặc đang bận thì giảm số worker
```

## Bí mật
Không commit `.env`. Thêm biến mới vào `src/config/env.validation.ts` thì thêm vào `.env.example` (unit test sẽ đỏ nếu thiếu).
