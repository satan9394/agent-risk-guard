/**
 * rules/default-policy.ts — 默认策略包（文档 §15 示例落地）
 *
 * RG-FS-001     永久删除（delete/unlink/recursive_delete）要求 reversible，否则 DENY → 建议 trash
 * RG-GUARD-001  命中 riskguard / agent-security-config 标签 → 单调 DENY（RG-I02 自保护）
 * RG-DISK-001   磁盘格式化/清空 → DENY
 * RG-GIT-001    git clean -f / reset --hard → DENY
 * RG-TRASH-001  trash 动作 → ALLOW
 * RG-PROC-001   shutdown/reboot 类 → DENY
 * RG-NET-001    network_upload → ask
 * RG-CRED-001   credential_export → DENY
 * RG-UNKNOWN-001 未知 mutation → DENY（RG-I04）
 */

import type { Policy, PolicyRule } from '../policy-engine.ts';

export const PROTECTED_RESOURCE_TAGS = ['riskguard', 'agent-security-config'];

/** Guard 自保护路径（文档 RG-I02：RiskGuard 不得被 Agent 自己关闭） */
export const PROTECTED_PATHS: string[] = [
  // 具体路径由 installation 时解析进 policy；这里是标签语义的默认集合
  'riskguard', // tag-based 而非 path-based
];

/**
 * 默认策略：Profile B — Autonomy Safe（文档 §5）
 * 正常开发零打扰，真正不可逆风险直接拒绝。
 */
export function defaultPolicy(): Policy {
  return {
    version: 1,
    defaults: {
      read: 'allow',
      reversibleWorkspaceWrite: 'allow',
      irreversible: 'deny',
      unknownMutation: 'deny',
    },
    rules: defaultRules(),
  };
}

export function defaultRules(): PolicyRule[] {
  return [
    // 自保护不变量优先（RG-I02）：命中受保护资源的删除/覆盖/移动 恒 deny（单调）
    { id: 'RG-GUARD-001', match: { domain: 'guard', action: ['guard_modify', 'guard_disable'] }, decision: 'deny', monotonic: true, risk: 'critical', reason: 'RiskGuard 自身不可修改' },
    // P2-9 修复：RG-GUARD-002 增加 domain 约束（只匹配 filesystem 的破坏性动作）
    { id: 'RG-GUARD-002', match: { domain: 'filesystem', targetTags: PROTECTED_RESOURCE_TAGS, action: ['delete', 'overwrite', 'truncate', 'move'] }, decision: 'deny', monotonic: true, risk: 'critical', reason: '命中受保护资源（RiskGuard/安全配置），拒绝' },
    { id: 'RG-DISK-001', match: { domain: 'filesystem', action: ['delete'], targetTags: ['disk-format'] }, decision: 'deny', risk: 'critical', reason: '磁盘格式化/清空永不允许' },
    { id: 'RG-FS-001', match: { domain: 'filesystem', action: ['delete', 'recursive_delete'], reversible: false }, decision: 'deny', monotonic: true, risk: 'critical', reason: '永久删除禁止，请使用回收站', safeAlternative: { operation: 'trash', description: '使用统一 trash 能力（Windows Recycle Bin / macOS Trash / freedesktop Trash）' } },
    { id: 'RG-FS-002', match: { domain: 'filesystem', action: ['overwrite', 'truncate'], protected: true }, decision: 'deny', risk: 'critical', reason: '受保护文件不得覆盖/清空' },
    { id: 'RG-GIT-001', match: { domain: 'git', action: ['git_clean', 'git_reset', 'git_checkout_discard'] }, decision: 'deny', risk: 'high', reason: 'git 不可逆丢失操作禁止' },
    { id: 'RG-PROC-002', match: { domain: 'process', action: ['execute'], reversible: false }, decision: 'deny', risk: 'critical', reason: '破坏性执行（如远程管道）禁止' },
    { id: 'RG-PROC-001', match: { domain: 'process', action: ['execute'] }, decision: 'ask', risk: 'high', reason: '危险进程执行需确认' },
    { id: 'RG-NET-001', match: { domain: 'network', action: ['network_upload'] }, decision: 'ask', risk: 'high', reason: '外部上传需确认' },
    { id: 'RG-CRED-001', match: { domain: 'credentials', action: ['credential_export'] }, decision: 'deny', risk: 'critical', reason: '凭据导出禁止' },
    // P0-31 修复：无法分类的工具操作 → deny（RG-I04 fail-closed，优先于 UNKNOWN-001 allow）
    { id: 'RG-UNKNOWN-002', match: { domain: 'filesystem', action: ['unknown'] }, decision: 'deny', risk: 'high', reason: '未知工具操作无法分类，fail-closed 拒绝' },
    { id: 'RG-UNKNOWN-001', match: { domain: 'filesystem', action: ['write', 'edit'] }, decision: 'allow', reason: '普通 workspace 写入放行（Profile B）' },
  ];
}

/** Strict Profile（文档 §5 Profile C）：直接不给危险能力 */
export function strictPolicy(): Policy {
  const base = defaultPolicy();
  return {
    ...base,
    rules: [
      { id: 'RG-S-DEL-001', match: { domain: 'filesystem', action: ['delete', 'recursive_delete'] }, decision: 'deny', monotonic: true, reason: 'Strict：删除能力从能力集移除', safeAlternative: { operation: 'trash' } },
      { id: 'RG-S-PROC-001', match: { domain: 'process', action: ['execute', 'spawn'] }, decision: 'ask', reason: 'Strict：执行需确认' },
      { id: 'RG-S-NET-001', match: { domain: 'network', action: ['network_connect', 'network_upload'] }, decision: 'deny', reason: 'Strict：网络默认拒绝' },
      ...base.rules.filter((r) => r.id === 'RG-GUARD-001' || r.id === 'RG-GUARD-002' || r.id === 'RG-CRED-001'),
    ],
  };
}