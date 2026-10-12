import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    // Nhiều file chạy song song, mỗi file nạp cả AppModule và hash bcrypt khi đăng ký user.
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
