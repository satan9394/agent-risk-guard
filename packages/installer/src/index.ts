/**
 * @riskguard/installer — M6 安装器公共入口
 *
 * discovery（只读检测）/ deploy（生成部署计划）/ backup（写入前备份）/
 * rollback（恢复备份）/ uninstall（移除注入）/ doctor（健康检查）。
 */

export { AGENT_REGISTRY, discoverAgents, detectAgent, discoveryToJson, expandProbePath } from './discovery.ts';
export type { AgentDescriptor, AgentInstall, GuardMechanism, GuardStatus } from './discovery.ts';
export { backupPaths, backupRoot, listBackups } from './backup.ts';
export type { BackupResult } from './backup.ts';
export { planAll, planClaudeHook, planClaudePermissions, planCodexRules, planDshPatch, defaultDenyRules } from './deploy.ts';
export type { DeployPlan, GuardRules } from './deploy.ts';
export { rollbackAgent } from './rollback.ts';
export type { RollbackResult } from './rollback.ts';
export { uninstallFromJsonConfig } from './uninstall.ts';
export type { UninstallResult } from './uninstall.ts';
/**
 * 已废弃（@deprecated）：子串级旧实现，CLI 已统一走 `probeAgentRuntime`（runtime-probe.ts）。
 * 仅为既有外部调用方保留；新代码请用 probeAgentRuntime(agent, { deep: true })。
 */
export { runDoctors } from './doctor.ts';
export { checkDshPatchDeep, countPatchRules } from './doctor.ts';
export type { DshPatchDeep, DshPatchProfile } from './doctor.ts';
export { probeAgentRuntime, checkHookScriptFreshness, aggregateHookFreshness } from './runtime-probe.ts';
export type { HookScriptCheck, RuntimeProbeResult, VerificationMode } from './runtime-probe.ts';
export type { DoctorCheck, DoctorReport } from './doctor.ts';
