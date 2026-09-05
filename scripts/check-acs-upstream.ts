/**
 * scripts/check-acs-upstream.ts — ACS upstream drift check（v0.2.1 §二十七，informational）
 *
 * 作用：告诉开发者官方 main 是否比 pinned commit（f46d260）更新。
 * 约束：
 *   - 普通 CI 不得因为上游有新 commit 而 fail（本脚本无论结果如何都 exit 0）
 *   - 需要网络；离线/被代理拦截时打印 notice 并 exit 0
 *
 * 用法：node scripts/check-acs-upstream.ts [--json]
 */

import { execFileSync } from 'node:child_process';

const PINNED_COMMIT = 'f46d260d22fe6d6ad71e4d979be7e25d063c468e';
const UPSTREAM_REPO = 'https://github.com/GenAI-Security-Project/agent-control-standard.git';

async function main(): Promise<void> {
  const json = process.argv.includes('--json');
  let upstreamHead: string | null = null;
  let error: string | null = null;
  try {
    const out = execFileSync('git', ['ls-remote', UPSTREAM_REPO, 'HEAD'], { encoding: 'utf8', timeout: 20000, stdio: ['ignore', 'pipe', 'pipe'] });
    upstreamHead = out.trim().split(/\s+/)[0] ?? null;
  } catch (e) {
    error = (e as Error).message;
  }

  if (upstreamHead) {
    const isHead = upstreamHead.startsWith(PINNED_COMMIT);
    if (json) {
      console.log(JSON.stringify({ ok: true, pinnedCommit: PINNED_COMMIT, upstreamHead, upstreamAhead: upstreamHead !== PINNED_COMMIT, isHead }, null, 2));
    } else {
      console.log('ACS upstream drift check (informational, never fails CI):');
      console.log(`  pinned commit : ${PINNED_COMMIT}`);
      console.log(`  upstream HEAD : ${upstreamHead}`);
      console.log(`  status        : ${isHead ? 'HEAD == pinned commit' : upstreamHead !== PINNED_COMMIT ? 'UPSTREAM HAS NEW COMMITS (review before updating snapshot)' : 'HEAD is an ancestor of pinned commit'}`);
    }
  } else {
    if (json) {
      console.log(JSON.stringify({ ok: true, pinnedCommit: PINNED_COMMIT, upstreamHead: null, upstreamAhead: null, note: `offline: ${error ?? 'unknown'}` }, null, 2));
    } else {
      console.log(`ACS upstream drift check (informational): cannot reach upstream (${error ?? 'offline'}). Pinned snapshot stays authoritative.`);
    }
  }
  // 无论结果如何 exit 0（§二十七：不阻塞普通 CI）
  process.exit(0);
}

await main();
