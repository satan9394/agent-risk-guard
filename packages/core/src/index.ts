/**
 * @riskguard/core — RiskGuard 纯函数内核入口
 *
 * 按文档 §14：核心必须是 Pure Library（evaluate(event, policy): Decision），
 * 无文件系统副作用 / 无网络 / 无子进程 / 无 Agent SDK 依赖。
 */

export * from './risk-taxonomy.ts';
export * from './event.ts';
export * from './decision.ts';
export * from './path-resolver.ts';
export * from './normalize.ts';
export * from './policy-engine.ts';
export * from './audit.ts';
export * from './rules/default-policy.ts';