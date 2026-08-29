/**
 * redact.ts — Secret Redaction（生态对标：copilot-safety-net / claude-guardrails）
 *
 * 原则：拦截消息与审计日志中绝不回显明文密钥。
 * 吸取经验：CC Safety Net 的 block 消息与 JSONL 日志自动脱敏 token/password/API key；
 *           claude-guardrails 在 UserPromptSubmit 阶段拦截粘贴的活凭据。
 * 本模块提供统一脱敏基元：审计序列化、hook 输出、block 消息在出口处一律过 redactSecrets()。
 */

/** 常见密钥模式（覆盖主流云/平台/密钥格式；命中即整体替换为占位符） */
const SECRET_PATTERNS: RegExp[] = [
  // AWS access key
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
  // GitHub PAT / fine-grained
  /\bgh[pousr]_[A-Za-z0-9]{36,255}\b/g,
  // OpenAI / Anthropic
  /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/g,
  /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g,
  // JWT（紧凑三段的 header.payload.signature）
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
  // PEM 私钥块（含换行，跨行匹配）
  /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/g,
  // 显式键值对赋值（password= / token= / api_key= / Authorization: Bearer ...）
  /(?:"?password"?\s*[:=]\s*)(['"]?)([^\s'",;}\]]+)\1/gi,
  /(?:"?(?:api[_-]?key|access[_-]?token|secret[_-]?key|client[_-]?secret)"?\s*[:=]\s*)(['"]?)([^\s'",;}\]]+)\1/gi,
  /(?:authorization\s*[:=]\s*(?:bearer|basic)\s+)([A-Za-z0-9._-]+)/gi,
  // 通用长随机串（heuristic：>=32 位字母数字混合，避免误伤普通单词/哈希片段）
  /\b[A-Za-z0-9_-]{40,}\b/g,
];

const REDACTED = '[REDACTED]';

/** 对任意文本做密钥脱敏（审计日志 / 拦截消息 / hook 输出统一入口） */
export function redactSecrets(text: string): string {
  if (!text) return text;
  let out = text;
  for (const re of SECRET_PATTERNS) {
    out = out.replace(re, REDACTED);
  }
  return out;
}

/** 脱敏并尽量保留结构（JSON 字符串场景：整体替换后仍是合法字符串） */
export function redactJsonValue(value: unknown): unknown {
  if (typeof value === 'string') return redactSecrets(value);
  if (Array.isArray(value)) return value.map(redactJsonValue);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = redactJsonValue(v);
    }
    return out;
  }
  return value;
}
