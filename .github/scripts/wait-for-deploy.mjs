// Đợi Render chạy đúng commit vừa deploy rồi DB sẵn sàng. Render deploy hook trả về ngay, còn bản cũ vẫn trả lời
// trong lúc bản mới build, nên phải so `commit` của /health/live (7 ký tự đầu của RENDER_GIT_COMMIT).
// Dùng: API_URL=https://... COMMIT=<sha> [TIMEOUT_SECONDS=600] node .github/scripts/wait-for-deploy.mjs
import { pathToFileURL } from 'node:url';

const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(fetchImpl, url) {
  try {
    const res = await fetchImpl(url, { headers: { accept: 'application/json' } });
    return { status: res.status, body: res.ok ? await res.json() : null };
  } catch (error) {
    return { status: 0, body: null, error: error.message };
  }
}

export async function waitForDeploy({
  baseUrl,
  commit,
  timeoutMs = 600_000,
  intervalMs = 15_000,
  fetchImpl = fetch,
  sleep = defaultSleep,
  now = Date.now,
  log = () => {},
}) {
  if (!/^[0-9a-f]{7,40}$/i.test(commit ?? '')) throw new Error(`commit không phải SHA hợp lệ: "${commit}"`);
  const want = commit.slice(0, 7).toLowerCase();
  const base = baseUrl.replace(/\/+$/, '');
  const deadline = now() + timeoutMs;

  let last = 'chưa trả lời';
  for (;;) {
    const live = await getJson(fetchImpl, `${base}/api/v1/health/live`);
    if (live.body?.commit === want) break;
    last = live.body?.commit ?? live.error ?? `HTTP ${live.status}`;
    log(`Đang đợi ${want}, hiện tại: ${last}`);
    if (now() >= deadline) throw new Error(`Hết giờ: đợi commit ${want} nhưng server vẫn trả ${last}`);
    await sleep(intervalMs);
  }

  // Neon có thể đang ngủ: lần đầu chạm DB chậm, thử lại tới hạn.
  for (;;) {
    const health = await getJson(fetchImpl, `${base}/api/v1/health`);
    if (health.body?.db === 'up') return { commit: want, db: 'up' };
    log(`Bản ${want} đã chạy, đợi DB (${health.error ?? `HTTP ${health.status}`})`);
    if (now() >= deadline) throw new Error(`Hết giờ: bản ${want} đã chạy nhưng /health chưa báo db up`);
    await sleep(intervalMs);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    const result = await waitForDeploy({
      baseUrl: process.env.API_URL ?? '',
      commit: process.env.COMMIT ?? '',
      timeoutMs: Number(process.env.TIMEOUT_SECONDS ?? 600) * 1000,
      log: (m) => console.log(m),
    });
    console.log(`Đã lên: commit ${result.commit}, db ${result.db}`);
  } catch (error) {
    console.error(`::error title=Deploy chưa lên::${error.message}`);
    process.exit(1);
  }
}
