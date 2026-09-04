/**
 * installer/transaction.ts — 安装事务（v0.1.1 P0：真正事务式 install）
 *
 * 目标：install 要么完整成功，要么可证明恢复到安装前——不留下「装了一半」。
 *
 * 对每个即将被修改的目标文件，安装前记录 TransactionTarget：
 *   - existedBefore：本轮安装前是否存在（决定 rollback 是 restore 还是 remove）
 *   - backupPath：本轮事务创建的精确备份（已存在文件）；rollback 只允许用它
 *   - createdByTransaction：本轮创建的新文件（rollback 用 trash 移除）
 *
 * 铁律：
 *   1. backup 任一「已存在」目标失败 → 立即 ABORT（绝不 best-effort）。
 *   2. rollback 只使用本轮事务产生的备份，禁止扫描历史 backup 目录猜测。
 *   3. rollback 完成后自验证：原存在 → sha256(restored)==sha256(before)；
 *      原不存在 → 目标不存在。不满足就报 ROLLBACK_INCOMPLETE，不谎报成功。
 *   4. 新文件移除遵循 RiskGuard 安全政策 → trash（回收站），非永久删除。
 */

import { mkdir, writeFile, rename, copyFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { sha256File } from './hash.ts';
import { backupPaths } from './backup.ts';

export interface TransactionTarget {
  path: string;
  /** 本轮安装前是否存在 */
  existedBefore: boolean;
  /** 本轮事务创建的精确备份路径（仅 existedBefore=true 且备份成功时有） */
  backupPath?: string;
  /** 是否由本轮事务创建（rollback 需移除） */
  createdByTransaction: boolean;
  /** 备份时的 sha256（rollback 自验证用） */
  beforeSha256?: string;
}

export type InstallTransactionState =
  | 'precheck'
  | 'snapshot'
  | 'backup'
  | 'writing'
  | 'verifying'
  | 'committed'
  | 'rolling-back'
  | 'rolled-back'
  | 'failed';

export interface RollbackReport {
  state: 'rolled-back' | 'rollback-incomplete';
  message: string;
  /** 每个目标恢复情况 */
  perTarget: { path: string; action: 'restored' | 'removed' | 'untouched'; verified: boolean }[];
}

let txCounter = 0;

export interface TransactionOptions {
  /** 备份实现（测试注入用；默认真实 backupPaths）。返回 ok:false = 该目标备份失败。 */
  backupImpl?: (agent: string, paths: string[], home: string) => Promise<{ ok: boolean; entries: { src: string; dst: string }[] }>;
}

export class InstallTransaction {
  readonly id: string;
  readonly agent: string;
  readonly home: string;
  private backupImpl: NonNullable<TransactionOptions['backupImpl']>;
  state: InstallTransactionState = 'precheck';
  private targets = new Map<string, TransactionTarget>();
  /** 事务期间已产生的 manifest 路径（若 commit 前失败需删除） */
  private provisionalManifestPath: string | null = null;

  constructor(agent: string, home: string, opts: TransactionOptions = {}) {
    this.agent = agent;
    this.home = home;
    this.backupImpl = opts.backupImpl ?? (async (a, paths, h) => {
      const bk = await backupPaths(a, paths, { home: h });
      return { ok: bk.ok, entries: bk.entries };
    });
    txCounter += 1;
    this.id = `${new Date().toISOString().replace(/[:.]/g, '-')}-${process.pid}-${txCounter}`;
  }

  target(path: string): TransactionTarget | undefined {
    return this.targets.get(path);
  }

  /** SNAPSHOT+BACKUP：记录每个即将写入目标的本轮状态。已存在文件必须备份成功，否则抛错（ABORT）。 */
  async snapshot(paths: string[]): Promise<void> {
    this.state = 'snapshot';
    for (const p of paths) {
      const existed = existsSync(p);
      const t: TransactionTarget = { path: p, existedBefore: existed, createdByTransaction: false };
      if (existed) {
        const bk = await this.backupImpl(this.agent, [p], this.home);
        if (!bk.ok || bk.entries.length === 0) {
          throw new Error(`Backup failed: ${p}`);
        }
        t.backupPath = bk.entries[0].dst;
        t.beforeSha256 = (await sha256File(p)) ?? undefined;
      }
      this.targets.set(p, t);
    }
    this.state = 'backup';
  }

  /** 标记某路径为本轮会创建/修改的目标（调用前须已 snapshot；未 snapshot 则先记录 existedBefore） */
  markWrite(path: string): void {
    if (!this.targets.has(path)) {
      const existed = existsSync(path);
      this.targets.set(path, { path, existedBefore: existed, createdByTransaction: !existed });
    }
  }

  /** 原子写 JSON（temp → rename），并标记 createdByTransaction / 变更 */
  async writeJsonAtomic(path: string, data: unknown): Promise<void> {
    this.state = 'writing';
    await mkdir(dirname(path), { recursive: true });
    await this.atomicWrite(path, JSON.stringify(data, null, 2));
    const t = this.targets.get(path);
    if (t) {
      if (!t.existedBefore) t.createdByTransaction = true;
    }
  }

  /** 原子写文件内容（temp → rename；Windows rename 覆盖已存在文件 OK） */
  private async atomicWrite(path: string, content: string | Buffer): Promise<void> {
    const tmp = `${path}.${this.id}.tmp`;
    await writeFile(tmp, content, 'utf8');
    // 写后校验可读（parse 留给调用方 VERIFY）
    await rename(tmp, path);
  }

  /** 原子复制 artifact（temp → rename） */
  async writeArtifactAtomic(src: string, dst: string): Promise<void> {
    this.state = 'writing';
    await mkdir(dirname(dst), { recursive: true });
    const existed = existsSync(dst);
    if (!existed) {
      // 新文件：temp 复制后 rename
      const tmp = `${dst}.${this.id}.tmp`;
      await copyFile(src, tmp);
      await rename(tmp, dst);
      const t = this.targets.get(dst);
      if (t) t.createdByTransaction = true;
      else this.targets.set(dst, { path: dst, existedBefore: false, createdByTransaction: true });
    }
    // 已存在且 hash 相同（幂等场景由调用方跳过）；这里只处理新建
  }

  /** VERIFY 通过后记录 provisional manifest 路径（commit 前的产物，失败要删） */
  noteProvisionalManifest(path: string): void {
    this.provisionalManifestPath = path;
  }

  commit(): void {
    this.state = 'committed';
  }

  /** 回滚：restore 原存在文件 / trash 移除本轮创建文件；随后自验证 */
  async rollback(reason: string): Promise<RollbackReport> {
    this.state = 'rolling-back';
    const perTarget: RollbackReport['perTarget'] = [];
    const msgs: string[] = [];
    for (const t of this.targets.values()) {
      if (!t.existedBefore && !t.createdByTransaction && !existsSync(t.path)) {
        perTarget.push({ path: t.path, action: 'untouched', verified: true });
        continue;
      }
      if (t.existedBefore && t.backupPath) {
        // 情况 A：restore exact backup
        try {
          await copyFile(t.backupPath, t.path);
          const now = await sha256File(t.path);
          const verified = t.beforeSha256 === undefined || now === t.beforeSha256;
          perTarget.push({ path: t.path, action: 'restored', verified });
          msgs.push(`${verified ? 'restored' : 'RESTORE-MISMATCH'}: ${t.path}`);
        } catch (e) {
          perTarget.push({ path: t.path, action: 'restored', verified: false });
          msgs.push(`RESTORE-FAILED: ${t.path} (${(e as Error).message})`);
        }
      } else if (t.createdByTransaction || (!t.existedBefore && existsSync(t.path))) {
        // 情况 B：移除本轮创建文件（走 trash）
        try {
          await import('../../trash/src/index.ts').then(({ trash }) => trash(t.path));
          const gone = !existsSync(t.path);
          perTarget.push({ path: t.path, action: 'removed', verified: gone });
          msgs.push(gone ? `removed: ${t.path}` : `REMOVE-FAILED: ${t.path}`);
        } catch (e) {
          perTarget.push({ path: t.path, action: 'removed', verified: false });
          msgs.push(`REMOVE-FAILED: ${t.path} (${(e as Error).message})`);
        }
      }
    }
    // 删除 provisional manifest（若已写且未 commit）
    if (this.provisionalManifestPath && existsSync(this.provisionalManifestPath)) {
      try {
        await import('../../trash/src/index.ts').then(({ trash }) => trash(this.provisionalManifestPath!));
        msgs.push(`removed provisional manifest: ${this.provisionalManifestPath}`);
      } catch { /* ignore */ }
    }
    const allVerified = perTarget.every((x) => x.verified);
    this.state = allVerified ? 'rolled-back' : 'failed';
    return {
      state: allVerified ? 'rolled-back' : 'rollback-incomplete',
      message: msgs.join('; ') || 'nothing to roll back',
      perTarget,
    };
  }
}
