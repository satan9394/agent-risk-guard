/**
 * scripts/build-release.ts — v0.1.2 Phase B：release artifact 构建
 *
 * 产出（到 dist/）：
 *   agent-risk-guard-v<version>/
 *     与 portable runtime 一致的最小运行文件集（packages/... 镜像布局）
 *     + bin/riskguard launcher 入口
 *     + runtime-manifest.json（sha256 逐文件）
 *   SHA256SUMS.txt        逐文件 checksum
 *   agent-risk-guard-v<version>.tar.gz   （可选，系统 tar 可用时）
 *
 * 用法：node scripts/build-release.ts [--out dist]
 * 零依赖；Linux/Windows(bsdtar) 均有系统 tar。
 */

import { mkdir, copyFile, writeFile, readdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import { collectRuntimeFiles } from '../packages/cli/src/runtime-install.ts';
import { PRODUCT_VERSION } from '../packages/core/src/version.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = process.argv.includes('--out') ? join(process.cwd(), process.argv[process.argv.indexOf('--out') + 1]) : join(ROOT, 'dist');
const VER = PRODUCT_VERSION;
const ART_NAME = `agent-risk-guard-v${VER}`;
const ART_DIR = join(OUT, ART_NAME);

function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

async function main(): Promise<void> {
  // 1. 清空重建 artifact 目录
  if (existsSync(ART_DIR)) await rm(ART_DIR, { recursive: true, force: true });
  await mkdir(ART_DIR, { recursive: true });

  // 2. 复制运行文件集（与 bootstrap 相同布局）
  const files = await collectRuntimeFiles();
  const rels: string[] = [];
  for (const f of files) {
    const rel = relative(ROOT, f).split(sep).join('/');
    const dst = join(ART_DIR, rel);
    await mkdir(dirname(dst), { recursive: true });
    await copyFile(f, dst);
    rels.push(rel);
  }

  // 3. bin/riskguard launcher（node 执行 runtime CLI index）
  const launcherDir = join(ART_DIR, 'bin');
  await mkdir(launcherDir, { recursive: true });
  const launcher = [
    '#!/usr/bin/env node',
    "// RiskGuard launcher (v0.1.2 portable runtime). Runs the CLI from this artifact, not a git clone.",
    "import { fileURLToPath, pathToFileURL } from 'node:url';",
    "import { dirname, join } from 'node:path';",
    "const here = dirname(fileURLToPath(import.meta.url));",
    "const root = join(here, '..');",
    "await import(pathToFileURL(join(root, 'packages', 'cli', 'src', 'index.ts')).href);",
    "",
  ].join('\n');
  await writeFile(join(launcherDir, 'riskguard.mjs'), launcher, 'utf8');

  // 4. runtime manifest
  const manifest = {
    schemaVersion: 1,
    productVersion: VER,
    installedAt: new Date().toISOString(),
    files: [] as { path: string; sha256: string }[],
  };
  for (const rel of [...rels, 'bin/riskguard.mjs']) {
    const p = join(ART_DIR, rel);
    const buf = await (await import('node:fs/promises')).readFile(p);
    manifest.files.push({ path: rel, sha256: sha256(buf) });
  }
  await writeFile(join(ART_DIR, 'runtime-manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');

  // 5. SHA256SUMS.txt（含 manifest 自身）
  const sums: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) await walk(p);
      else {
        const rel = relative(ART_DIR, p).split(sep).join('/');
        const buf = await (await import('node:fs/promises')).readFile(p);
        sums.push(`${sha256(buf)}  ${rel}`);
      }
    }
  };
  await walk(ART_DIR);
  await writeFile(join(ART_DIR, 'SHA256SUMS.txt'), sums.sort().join('\n') + '\n', 'utf8');

  // 6. tar.gz（系统 tar）
  let tarPath = '';
  try {
    const tgz = join(OUT, `${ART_NAME}.tar.gz`);
    execSync(`tar -czf "${tgz}" -C "${OUT}" "${ART_NAME}"`, { stdio: 'ignore' });
    tarPath = tgz;
  } catch { tarPath = '(system tar unavailable — directory artifact only)'; }

  console.log(`Release artifact built:\n  Version: ${VER}\n  Dir: ${ART_DIR}\n  Files: ${manifest.files.length}\n  SHA256SUMS: ${join(ART_DIR, 'SHA256SUMS.txt')}\n  Archive: ${tarPath}`);
}

void main().catch((e) => { console.error(`build failed: ${(e as Error).message}`); process.exit(1); });
