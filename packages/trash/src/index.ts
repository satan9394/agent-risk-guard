/**
 * trash/index.ts — 跨平台 trash 入口（文档 §6）
 * 按平台分发：Windows → 回收站 / macOS → trash / Linux → gio trash。
 */

export interface TrashResult {
  ok: boolean;
  path: string;
  platform: string;
  error?: string;
}

export async function trash(absPath: string): Promise<TrashResult> {
  if (process.platform === 'win32') {
    const { trash: winTrash } = await import('./windows.ts');
    const r = await winTrash(absPath);
    return { ...r, platform: 'win32' };
  }
  if (process.platform === 'darwin') {
    const { trash: macTrash } = await import('./macos.ts');
    const r = await macTrash(absPath);
    return { ...r, platform: 'darwin' };
  }
  const { trash: linuxTrash } = await import('./linux.ts');
  const r = await linuxTrash(absPath);
  return { ...r, platform: 'linux' };
}