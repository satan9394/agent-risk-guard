/**
 * cli/runtime-install.ts — v0.1.2 Phase B：portable runtime 安装（bootstrap）
 *
 * 把 CLI 真正运行所需的最小文件集复制到：
 *   <home>/.riskguard/runtime/<version>/
 * 保持与仓库相同的相对布局（packages/...），因此：
 *   - REPO_ROOT 相对解析（packages/cli/src/commands.ts 上溯）在 runtime 内仍成立
 *   - hook command 指向 runtime 而非 git clone 路径 → 删除源码仓库 RiskGuard 仍工作
 *   - core/version.ts 读 runtime 内的 package.json → 版本自洽
 *
 * 生成 runtime manifest（~/.riskguard/runtime/<version>/runtime-manifest.json）：
 *   { productVersion, files: [{ path, sha256 }] } 供 doctor 验证 runtime integrity。
 *
 * 只复制运行依赖，不复制 tests/ docs/ .github/ README 等。
 */

import { mkdir, copyFile, readdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PRODUCT_VERSION } from '../../core/src/version.ts';
import { sha256File } from '../../installer/src/hash.ts';

export interface RuntimeManifest {
  schemaVersion: number;
  productVersion: string;
  installedAt: string;
  files: { path: string; sha256: string }[];
}

/** 仓库根（runtime-install.ts 位于 packages/cli/src → 上溯 3 = repo root） */
const REPO_ROOT: string = (() => {
  try {
    const here = dirname(fileURLToPath(import.meta.url)); // packages/cli/src
    return dirname(dirname(dirname(here)));
  } catch {
    return process.cwd();
  }
})();

export function runtimeRoot(home?: string): string {
  const base = home ?? process.env.USERPROFILE ?? process.env.HOME ?? '.';
  return join(base, '.riskguard', 'runtime');
}

export function runtimeVersionDir(home?: string): string {
  return join(runtimeRoot(home), PRODUCT_VERSION);
}

export function runtimeManifestPath(home?: string): string {
  return join(runtimeVersionDir(home), 'runtime-manifest.json');
}

/** 递归收集目录内 .ts 文件（相对 repo root 的 posix 路径） */
async function collectTs(dir: string): Promise<string[]> {
  const out: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      // 跳过测试目录
      if (e.name === 'test' || e.name === 'tests' || e.name === 'node_modules') continue;
      out.push(...(await collectTs(p)));
    } else if (e.name.endsWith('.ts')) {
      out.push(p);
    }
  }
  return out;
}

/** 运行依赖文件集（相对 repo root 的绝对路径列表） */
export async function collectRuntimeFiles(): Promise<string[]> {
  const files: string[] = [];
  // package.json：version.ts 运行时读取
  files.push(join(REPO_ROOT, 'package.json'));
  // installer 的数据文件（compatibility.ts 运行时读 ../compatibility.json）
  const compatJson = join(REPO_ROOT, 'packages', 'installer', 'compatibility.json');
  if (existsSync(compatJson)) files.push(compatJson);
  // CLI 运行链
  for (const pkg of ['cli', 'core', 'installer', 'trash']) {
    files.push(...(await collectTs(join(REPO_ROOT, 'packages', pkg, 'src'))));
  }
  // hook 链：claude adapter
  files.push(...(await collectTs(join(REPO_ROOT, 'packages', 'adapters', 'claude', 'src'))));
  // opencode plugin asset（install 时复制给用户）
  const asset = join(REPO_ROOT, 'assets', 'opencode', 'agent-risk-guard.ts');
  if (existsSync(asset)) files.push(asset);
  return files;
}

/** 安装 portable runtime 到 ~/.riskguard/runtime/<version>/，返回安装文件数 */
export async function installRuntime(opts: { home?: string; force?: boolean } = {}): Promise<{ dir: string; files: number; manifest: RuntimeManifest }> {
  const dest = runtimeVersionDir(opts.home);
  const files = await collectRuntimeFiles();
  const records: RuntimeManifest['files'] = [];

  await mkdir(dest, { recursive: true });
  for (const f of files) {
    // 相对 repo root 的路径（posix），拼到 runtime/<ver> 下保持镜像布局
    const rel = relative(REPO_ROOT, f).split(sep).join('/');
    const dst = join(dest, rel);
    await mkdir(dirname(dst), { recursive: true });
    await copyFile(f, dst);
    const h = await sha256File(dst);
    if (h) records.push({ path: rel, sha256: h });
  }

  const manifest: RuntimeManifest = {
    schemaVersion: 1,
    productVersion: PRODUCT_VERSION,
    installedAt: new Date().toISOString(),
    files: records,
  };
  await writeFile(runtimeManifestPath(opts.home), JSON.stringify(manifest, null, 2), 'utf8');
  return { dir: dest, files: files.length, manifest };
}

/** 校验 runtime 完整性：所有文件 hash 与 manifest 一致；缺/改返回 false + 差异清单 */
export async function verifyRuntime(opts: { home?: string } = {}): Promise<{ ok: boolean; issues: string[] }> {
  const mf = runtimeManifestPath(opts.home);
  if (!existsSync(mf)) return { ok: false, issues: [`runtime manifest missing: ${mf}`] };
  const m = JSON.parse(await (await import('node:fs/promises')).readFile(mf, 'utf8')) as RuntimeManifest;
  const issues: string[] = [];
  for (const f of m.files) {
    const p = join(runtimeVersionDir(opts.home), f.path);
    if (!existsSync(p)) { issues.push(`missing: ${f.path}`); continue; }
    const h = await sha256File(p);
    if (h !== f.sha256) issues.push(`hash mismatch: ${f.path}`);
  }
  return { ok: issues.length === 0, issues };
}

export function isRuntimeInstalled(home?: string): boolean {
  return existsSync(runtimeManifestPath(home));
}
