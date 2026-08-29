/**
 * ecosystem-fusion.test.ts — R3 生态融合核心单元测试
 *
 * 覆盖从对标项目吸取的三个能力：
 *   1. Secret Redaction（CC Safety Net / claude-guardrails）：审计与消息出口脱敏
 *   2. 敏感路径分类（agent-safety-pack sensitive-paths）：read/write 门控输入
 *   3. wrapper 递归解包（CC Safety Net）：bash -c / cmd /c 内层提取
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redactSecrets, redactJsonValue } from '../src/redact.ts';
import { classifySensitivePath, unwrapShellWrapper, WRAPPER_MAX_DEPTH } from '../src/normalize.ts';
import { auditToJson, type AuditRecord } from '../src/audit.ts';

test('redact: 常见密钥形态全部脱敏', () => {
  const samples = [
    'sk-ant-api03-abcdefghijklmnopqrstuvwxyz123456',
    'sk-proj-ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwx',
    'ghp_1234567890abcdefghijklmnopqrstuvwxyzABCD',
    'AKIA1234567890ABCDEF',
    'password=hunter2secret',
    'api_key: sk_live_1234567890abcdef',
    'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U',
    '-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA\n-----END RSA PRIVATE KEY-----',
  ];
  for (const s of samples) {
    const out = redactSecrets(s);
    assert.ok(!/[A-Za-z0-9+/]{20,}/.test(out) || out.includes('[REDACTED]'),
      `应脱敏但残留长串: ${s} → ${out}`);
    assert.ok(out.includes('[REDACTED]'), `应包含占位符: ${s} → ${out}`);
  }
});

test('redact: 普通文本不受影响', () => {
  assert.equal(redactSecrets('git push origin main --force'), 'git push origin main --force');
  assert.equal(redactSecrets('npm install lodash'), 'npm install lodash');
  assert.equal(redactSecrets(''), '');
});

test('redact: 嵌套 JSON 结构递归脱敏', () => {
  const obj = { command: 'rm -rf /tmp/x', env: { TOKEN: 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz123456' }, ok: true };
  const out = redactJsonValue(obj) as typeof obj;
  assert.ok(String(out.env.TOKEN).includes('[REDACTED]'));
  assert.equal(out.command, 'rm -rf /tmp/x');
  assert.equal(out.ok, true);
});

test('redact: 审计序列化出口自动脱敏（auditToJson）', () => {
  // 出口防线：无论字段来源，序列化时密钥一律脱敏（AuditRecord 设计上不落命令原文，
  // 但 target/reason 等可能携带敏感值，出口统一 redact）
  const rec: AuditRecord = {
    timestamp: '2026-08-29T00:00:00.000Z',
    agent: 'cc',
    tool: 'Bash',
    operation: 'credentials.credential_export',
    target: 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz123456',
    risk: 'critical',
    decision: 'deny',
    rule: 'RG-CR-001',
  };
  const json = auditToJson(rec);
  assert.ok(json.includes('[REDACTED]'), `审计日志应脱敏密钥: ${json}`);
  assert.ok(!json.includes('sk-ant-api03'), '审计日志不得含明文密钥');
  assert.ok(!json.includes('abcdefghijklmnopqrstuvwxyz123456'), '审计日志不得残留密钥片段');
});

test('sensitive-path: 识别 SSH/凭据/密钥文件，放过普通路径', () => {
  assert.equal(classifySensitivePath('C:\\Users\\me\\.ssh\\id_rsa').category, 'ssh');
  assert.equal(classifySensitivePath('/home/me/.ssh/id_ed25519').category, 'ssh');
  assert.equal(classifySensitivePath('C:\\repo\\.env').category, 'env');
  assert.equal(classifySensitivePath('C:\\repo\\.env.production').category, 'env');
  assert.equal(classifySensitivePath('C:\\Users\\me\\.aws\\credentials').category, 'aws');
  assert.equal(classifySensitivePath('C:\\repo\\secret.pem').category, 'pem');
  assert.equal(classifySensitivePath('C:\\repo\\id_rsa.pub').category, 'ssh-key');
  assert.equal(classifySensitivePath('C:\\repo\\src\\main.ts').sensitive, false);
  assert.equal(classifySensitivePath('C:\\repo\\package.json').sensitive, false);
});

test('unwrap: 提取 bash -c / cmd /c / pwsh -Command 内层命令', () => {
  assert.equal(unwrapShellWrapper("bash -c 'git reset --hard'"), 'git reset --hard');
  assert.equal(unwrapShellWrapper('sh -c "rm -rf /tmp/x"'), 'rm -rf /tmp/x');
  assert.equal(unwrapShellWrapper('cmd /c "del C:\\temp\\x.txt"'), 'del C:\\temp\\x.txt');
  assert.equal(unwrapShellWrapper('pwsh -Command "Remove-Item C:\\temp\\x"'), 'Remove-Item C:\\temp\\x');
  assert.equal(unwrapShellWrapper('git status'), null, '无 wrapper 返回 null');
  assert.equal(unwrapShellWrapper('bash -c '), null, '缺参数不误提取');
  assert.ok(WRAPPER_MAX_DEPTH >= 3 && WRAPPER_MAX_DEPTH <= 10, '递归深度上限在合理范围');
});
