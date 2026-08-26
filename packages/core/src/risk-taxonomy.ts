/**
 * risk-taxonomy.ts — RiskGuard 风险分类学 v1（文档 §8）
 *
 * 第一版固定六个 Domain，不追求几十个安全类别。核心 action 集合版本化扩展，
 * 不破坏现有协议。
 */

export const SCHEMA_VERSION = '1.0';

/** 六大风险域 */
export const DOMAINS = ['filesystem', 'process', 'git', 'network', 'credentials', 'guard'] as const;
export type Domain = (typeof DOMAINS)[number];

/** filesystem 域 action */
export const FS_ACTIONS = [
  'read', 'create', 'write', 'edit', 'overwrite', 'truncate',
  'move', 'copy', 'trash', 'delete', 'recursive_delete',
  'unknown', // P0-31 修复：无法分类的工具操作（Cursor/OpenCode 未知工具）
] as const;

/** process 域 action */
export const PROCESS_ACTIONS = ['execute', 'spawn'] as const;

/** git 域 action */
export const GIT_ACTIONS = ['git_commit', 'git_reset', 'git_clean', 'git_checkout_discard'] as const;

/** network 域 action */
export const NETWORK_ACTIONS = ['network_connect', 'network_upload'] as const;

/** credentials 域 action */
export const CREDENTIAL_ACTIONS = ['credential_read', 'credential_export'] as const;

/** guard 域 action */
export const GUARD_ACTIONS = ['guard_modify', 'guard_disable'] as const;

export const ACTIONS = [
  ...FS_ACTIONS, ...PROCESS_ACTIONS, ...GIT_ACTIONS,
  ...NETWORK_ACTIONS, ...CREDENTIAL_ACTIONS, ...GUARD_ACTIONS,
] as const;
export type Action = (typeof ACTIONS)[number];

/** 风险等级 */
export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

/**
 * 判定一个 action 是否为不可逆破坏性操作。
 * 这是 Policy Engine 的 fast-path 分类，不用于宣称"绝对安全"。
 */
export function isDestructiveAction(domain: Domain, action: Action): boolean {
  switch (domain) {
    case 'filesystem':
      return action === 'delete' || action === 'recursive_delete' || action === 'overwrite' || action === 'truncate';
    case 'process':
      return false; // 执行本身不是删除，但 spwan 外部子进程属于高风险，由 policy 决定
    case 'git':
      return action === 'git_reset' || action === 'git_clean' || action === 'git_checkout_discard';
    case 'network':
      return action === 'network_upload';
    case 'credentials':
      return action === 'credential_export';
    case 'guard':
      return true; // 修改/禁用 RiskGuard 自身恒为不可逆高风险
    default:
      return false;
  }
}

/** 是否为"永久删除"类 action（不可逆、需要 trash 替代） */
export function isPermanentDelete(domain: Domain, action: Action): boolean {
  if (domain !== 'filesystem') return false;
  return action === 'delete' || action === 'recursive_delete';
}