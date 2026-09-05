/**
 * acs/types.ts — ACS v0.1.0 类型集（v0.2.0 建立，v0.2.1 对齐官方 JSON Schema）
 *
 * 唯一权威 = 官方 OWASP ACS v0.1.0 JSON Schema（pinned 快照：
 * tests/vendor/owasp-acs-v0.1.0/，upstream commit 见该目录 README.md）。
 * 本文件是这些 schema 的 TS 镜像，禁止再按 RiskGuard 自己的“方便形状”定义
 * 官方 payload 类型。
 *
 * 对齐要点（v0.2.1）：
 *   - ToolCallRequest：required = tool + arguments；capability 可选（§四/§五/§六）
 *   - 非官方顶层字段（environment / provenance[] / requestId / tool.protocol）
 *     移出官方 payload 类型（§六）
 *   - AcsResult：type / acs_version / request_id / decision 必填（§十三/§十四/§十五）
 *   - modifications 是 object（modified_content | redactions / parameter_overrides），
 *     不再是 [{tool, capability, ...}] 数组（§十七）
 *   - ask_details / defer_details 按官方 ask-details.json / defer-details.json（§二十二/§二十三）
 *   - 新增 Request Envelope / Response Envelope 类型（§七/§十二）
 */

import type { AcsDecision } from './version.ts';

// ============================================================================
// ToolCallRequest（官方 hooks/tool-call-request.json）
// ============================================================================

/** ACS 官方 capability 枚举（报告实测 v0.1.0/tool-call-request.json：自由字符串） */
export type AcsCapability = string;

export interface AcsTool {
  /** required */
  name: string;
  version?: string;
  provider?: string;
  // 注意：官方 schema 无 protocol 字段；MCP 等协议信息由 tool.name / provider 表达（§六）
}

/** 官方 provenance.json（参数级 provenance；required: provenance_id + origin） */
export interface AcsProvenance {
  provenance_id: string;
  origin: 'user_input' | 'system' | 'tool_output' | 'retrieved' | 'agent_generated' | 'a2a_inbound' | 'external';
  source_id?: string;
  derived_from?: string[];
}

/** 官方 arguments 值包装：每个参数 = { value, provenance? }（required: value） */
export interface AcsArgumentValue {
  value: unknown;
  provenance?: AcsProvenance;
}

export type AcsArguments = Record<string, AcsArgumentValue>;

/**
 * ACS v0.1.0 ToolCallRequest（官方 schema 镜像）：
 *   required: tool, arguments
 *   capability: OPTIONAL（缺失时由 gateway 从 tool/operation/raw_command/arguments 推导，§三十一）
 * 非官方便捷字段已移出（§六）。
 */
export interface AcsToolCallRequest {
  tool: AcsTool;
  operation?: string;
  capability?: string;
  arguments: AcsArguments;
  raw_command?: string;
  intent?: { description?: string; goal?: string };
}

// ============================================================================
// Request Envelope（官方 request-envelope.json）
// ============================================================================

export interface AcsRequestMetadata {
  /** required */
  agent_id: string;
  /** required（uuid） */
  session_id: string;
  agent_name?: string;
  turn_id?: string;
  parent_turn_id?: string;
  session_state?: { chain_hash?: string };
  environment?: 'development' | 'staging' | 'production';
  platform?: string;
  platform_version?: string;
  user_context?: { user_id?: string; roles?: string[]; authentication_method?: string };
  [k: string]: unknown;
}

export interface AcsRequestParams {
  /** required（semver，如 0.1.0） */
  acs_version: string;
  /** required（uuid） */
  request_id: string;
  /** required（ISO 8601 date-time） */
  timestamp: string;
  /** required */
  metadata: AcsRequestMetadata;
  /** required（hook 专属 payload，如 ToolCallRequest） */
  payload: Record<string, unknown>;
  nonce?: string;
  tenant_id?: string;
  signature?: AcsSignature;
}

export interface AcsSignature {
  algorithm: string;
  value: string;
  key_id: string;
}

export interface AcsRequestEnvelope {
  /** required（const "2.0"） */
  jsonrpc: '2.0';
  /** required（如 "steps/toolCallRequest"） */
  method: string;
  /** required（JSON-RPC correlation id） */
  id: string | number;
  params: AcsRequestParams;
}

// ============================================================================
// Response Envelope（官方 response-envelope.json）
// ============================================================================

export interface AcsJsonRpcError {
  /** required；ACS 应用错误保留 -32000 ~ -32099 */
  code: number;
  message: string;
  data?: unknown;
}

export interface AcsResponseEnvelope {
  jsonrpc: '2.0';
  /** 成功场景回显 request.id；parse/invalid request 时为 null */
  id: string | number | null;
  result?: AcsResult;
  error?: AcsJsonRpcError;
}

// ============================================================================
// AcsResult（官方 response-envelope.json#/$defs/AcsResult）
// ============================================================================

export type AcsEvaluator = 'deterministic' | 'agent' | 'composite';

export interface AcsPolicyReference {
  policy_id?: string;
  policy_version?: string;
  policy_name?: string;
  rule_id?: string;
}

/** 官方 modifications.json：modified_content XOR (redactions / parameter_overrides) */
export interface AcsModifications {
  modified_content?: string;
  redactions?: Array<{ path: string; replacement?: string }>;
  parameter_overrides?: Record<string, unknown>;
}

/** 官方 ask-details.json（required: approver + question + timeout_seconds） */
export interface AcsAskDetails {
  approver: {
    /** required */
    type: 'human' | 'agent' | 'service';
    /** required */
    id: string;
    endpoint?: string;
    auth?: { method?: 'bearer' | 'mtls' };
  };
  /** required */
  question: string;
  /** required（>= 1） */
  timeout_seconds: number;
  context?: string;
  options?: string[];
  timeout_disposition?: 'allow' | 'deny';
  intent_extension?: {
    capabilities: Array<{ tool?: string; operation?: string; resource?: string }>;
    scope: 'this_request' | 'session';
    provenance?: AcsProvenance;
  };
}

/** 官方 defer-details.json（required: reason + resolution_method + resolution_timeout_ms） */
export interface AcsDeferDetails {
  reason: 'insufficient_context' | 'conflicting_policies' | 'low_confidence' | 'pending_dependency';
  resolution_method: 'additional_context' | 'human_approval' | 'timeout';
  resolution_timeout_ms: number;
  timeout_decision?: 'deny' | 'ask';
  required_context?: string[];
}

export interface AcsMetadata {
  evaluator?: AcsEvaluator;
  evaluator_version?: string;
  evaluation_duration_ms?: number;
  model_id?: string;
  confidence?: number;
  [k: string]: unknown;
}

/**
 * RiskGuard Extension Namespace：
 * 不往 ACS 官方 schema 顶层加字段；RiskGuard 特有信息统一放 extensions.riskguard。
 */
export interface RiskGuardExtensions {
  ruleId?: string;
  degraded?: boolean;
  verification?: 'dynamic' | 'static' | 'none';
  monotonic?: boolean;
  profile?: string;
  acsVersion?: string;
}

/**
 * ACS v0.1.0 Result（官方必填：type / acs_version / request_id / decision）。
 * request_id 是官方顶层字段，禁止塞进 extensions（§十四）。
 */
export interface AcsResult {
  /** required（v0.1 固定 "final"，§十五） */
  type: 'final';
  /** required（完整 SemVer，如 "0.1.0"） */
  acs_version: string;
  /** required（uuid；回显请求 params.request_id） */
  request_id: string;
  decision: AcsDecision;
  /** deny/modify/ask/defer 必填（官方 allOf 约束） */
  reasoning?: string;
  reason_codes?: string[];
  policy_references?: AcsPolicyReference[];
  policy_data?: Record<string, unknown>;
  cited_provenance_ids?: string[];
  /** modify 必填：官方 modifications 结构（§十七） */
  modifications?: AcsModifications;
  ask_details?: AcsAskDetails;
  defer_details?: AcsDeferDetails;
  payload?: Record<string, unknown>;
  chain_hash?: string;
  signature?: AcsSignature;
  metadata?: AcsMetadata;
  /** RiskGuard 扩展命名空间 */
  extensions?: { riskguard: RiskGuardExtensions };
}

// ============================================================================
// JSON-RPC 错误码（§四十一）
// ============================================================================

export const ACS_JSONRPC_CODES = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  INVALID_PARAMS: -32602,
  /** ACS application error 区间下限（-32000 ~ -32099；本轮仅保留区间定义） */
  APPLICATION_ERROR_MIN: -32099,
  APPLICATION_ERROR_MAX: -32000,
} as const;
