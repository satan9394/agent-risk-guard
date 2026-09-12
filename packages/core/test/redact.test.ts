/**
 * redact.test.ts — G15b：脱敏模式回归 + 四类残留补齐（canonical = src/redact.ts）
 *
 * 覆盖：
 *   A. G15 既有的 10 类密钥形态（回归，不得回退）
 *   B. G15b 新增的四类残留：空格分隔 AWS 键、引号含空格值、`-p<pass>`、`-u user:pass`
 *   C. 无误伤对照（普通命令逐字不变）
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redactSecrets, redactDetails } from '../src/redact.ts';

// ── A. G15 既有 10 类（回归） ──────────────────────────────────────────
test('redact/G15 回归: 既有密钥形态仍全部脱敏', () => {
  const samples: Array<[string, string, string]> = [
    ['aws-access-key-id', 'AKIA1234567890ABCDEF', 'aws s3 cp s3://b/f . --profile AKIA1234567890ABCDEF'],
    [
      'github-pat',
      'ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
      'git clone https://ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789@github.com/o/r.git',
    ],
    ['openai-sk', 'sk-proj-AAAABBBBCCCCDDDDEEEEFFFF12345', 'curl -H "X: sk-proj-AAAABBBBCCCCDDDDEEEEFFFF12345"'],
    ['anthropic-sk-ant', 'sk-ant-abcdefghij0123456789xyzw', 'curl -H "X: sk-ant-abcdefghij0123456789xyzw"'],
    [
      'jwt',
      'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk',
      'curl -H "Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk"',
    ],
    [
      'pem-private-key',
      'MIIEowIBAAKCAQEAsecretbody',
      'printf "%s" "-----BEGIN RSA PRIVATE KEY----- MIIEowIBAAKCAQEAsecretbody -----END RSA PRIVATE KEY-----"',
    ],
    ['password-kv', 'hunter2SuperSecret', 'mysql -u root --password=hunter2SuperSecret -e "select 1"'],
    ['generic-kv', 'abcd1234efgh5678', 'curl -H "X-Api-Key: abcd1234efgh5678" https://api.example.com'],
    ['authorization', 'tok_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123', 'curl -H "Authorization: Bearer tok_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123" https://x'],
    ['long-random', 'A1B2C3D4E5F6G7H8I9J0K1L2M3N4O5P6Q7R8S9T0', 'curl "https://example.com/data?q=A1B2C3D4E5F6G7H8I9J0K1L2M3N4O5P6Q7R8S9T0"'],
  ];
  // 注：`sk-ant-…` 会被更靠前的 `openai-sk`（`sk-(proj-)?[A-Za-z0-9_-]{20,}`）先吞掉——
  // 这是 G15 起就有的既有行为（三端顺序一致，故不影响 parity），此处按「等价类」断言。
  const EQUIV: Record<string, string[]> = { 'anthropic-sk-ant': ['anthropic-sk-ant', 'openai-sk'] };
  for (const [id, secret, cmd] of samples) {
    const { out, hits } = redactDetails(cmd);
    const expect = EQUIV[id] ?? [id];
    assert.ok(expect.some((e) => hits.includes(e)), `[${id}] 命中集合应含 ${expect.join('|')}，实际 ${JSON.stringify(hits)}`);
    assert.ok(out.includes('[REDACTED]'), `[${id}] 应包含占位符: ${cmd} → ${out}`);
    assert.ok(!out.includes(secret), `[${id}] 不得残留明文: ${out}`);
  }
});

// ── B. G15b 四类残留 ──────────────────────────────────────────────────
test('redact/G15b R1: aws configure set <key> <value>（空格分隔）脱敏', () => {
  const cases: Array<[string, string]> = [
    [
      'aws_secret_access_key',
      'aws configure set aws_secret_access_key wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
    ],
    ['aws_access_key_id', 'aws configure set aws_access_key_id AKIAIOSFODNN7EXAMPLE'],
    ['secret_access_key', 'aws configure set secret_access_key wJalrXUtnFEMI/K7MDENG'],
    ['aws_secret_access_key(=)', 'aws configure set aws_secret_access_key=wJalrXUtnFEMI'],
    ['aws_session_token', 'aws configure set aws_session_token FQoGZXIvYXdzEBYaDExample'],
  ];
  for (const [label, cmd] of cases) {
    const out = redactSecrets(cmd);
    assert.ok(out.includes('[REDACTED]'), `[${label}] 应脱敏: ${cmd} → ${out}`);
    assert.ok(!out.includes('wJalrXUtnFEMI') && !out.includes('AKIAIOSFODNN7EXAMPLE') && !out.includes('FQoGZXIvYXdzEBYaDExample'),
      `[${label}] 不得残留明文: ${out}`);
    assert.ok(out.startsWith('aws configure set'), `[${label}] 命令前缀应保留: ${out}`);
  }
});

test('redact/G15b R2: 引号内含空格的值整段脱敏', () => {
  const cases: Array<[string, string, string]> = [
    ['password', '--password="correct horse battery staple"', 'correct horse battery staple'],
    ['token', "--token='x y z long value'", 'x y z long value'],
    ['api_key', 'curl -H "X: api_key=\'a b c\'" https://x', 'a b c'],
    ['client_secret', 'deploy --client_secret="split across spaces" https://x', 'split across spaces'],
    ['AWS 空格键+引号值', 'aws configure set aws_secret_access_key "quoted value with spaces"', 'quoted value with spaces'],
  ];
  for (const [label, cmd, secret] of cases) {
    const out = redactSecrets(cmd);
    assert.ok(out.includes('[REDACTED]'), `[${label}] 应脱敏: ${cmd} → ${out}`);
    assert.ok(!out.includes(secret), `[${label}] 不得残留明文: ${out}`);
  }
});

test('redact/G15b R3: mysql -p<password> 脱敏', () => {
  const out = redactSecrets('mysql -pSup3rS3cret -e "select 1"');
  assert.ok(out.includes('[REDACTED]'), `应脱敏: ${out}`);
  assert.ok(!out.includes('Sup3rS3cret'), `不得残留明文: ${out}`);
  assert.ok(out.startsWith('mysql'), `命令名应保留: ${out}`);
});

test('redact/G15b R4: curl -u user:pass 脱敏', () => {
  const out = redactSecrets('curl -u alice:hunter2 https://example.com');
  assert.ok(out.includes('[REDACTED]'), `应脱敏: ${out}`);
  assert.ok(!out.includes('hunter2'), `不得残留明文: ${out}`);
  assert.ok(out.includes('https://example.com'), `URL 应保留: ${out}`);
});

// ── C. 无误伤对照 ─────────────────────────────────────────────────────
test('redact/G15b 无误伤: 普通命令逐字不变', () => {
  const benign = [
    'echo hello',
    'git status',
    'ls -la',
    'npm run build --prefix packages/core',
    'git push origin main --force',
    'npm install lodash',
    'mkdir -p /tmp/empty_dir',
    'ssh -p2222 host',
    'docker run -p 8080:80 nginx',
    'sudo -u root whoami',
    'Get-ChildItem C:\\Users\\Public',
    'pnpm -F @scope/pkg run test',
  ];
  for (const cmd of benign) {
    assert.equal(redactSecrets(cmd), cmd, `不应改动普通命令: ${cmd}`);
  }
});

test('redact/G15b 边界: 空文本/无密钥长文本不崩溃', () => {
  assert.equal(redactSecrets(''), '');
  assert.equal(redactDetails('').hits.length, 0);
  // 注意：连续 40+ 位同字符（如 'x'.repeat(5000)）**应当**命中 long-random，故此处用带空格的正常长文本
  const long = 'the quick brown fox jumps over the lazy dog '.repeat(120);
  assert.equal(redactSecrets(long), long);
});

// ── D. G15b-FIX 新增能力 ──────────────────────────────────────────────

test('redact/G15b-FIX F3: --user user:pass 长参脱敏（G15b-FIX2 起锚定 curl/wget）', () => {
  for (const cmd of [
    'curl --user alice:hunter2 https://example.com',
    'curl -u alice:hunter2 https://example.com',
  ]) {
    const out = redactSecrets(cmd);
    assert.ok(out.includes('[REDACTED]'), `应脱敏: ${cmd} -> ${out}`);
    assert.ok(!out.includes('hunter2'), `不得残留明文: ${out}`);
  }
  // 反例：uid:gid 不是密码，不得误伤
  assert.equal(redactSecrets('docker run --user 1000:1000 nginx'), 'docker run --user 1000:1000 nginx');
});

test('redact/G15b-FIX2 R1: `-u` 与 `--user` 拆两条规则——全数字口令必须脱敏', () => {
  // 回归：G15b-FIX 把「密码段须含非数字」守卫加在 `-u|--user` 共用分支上，
  // 使 `curl -u alice:123456`（G15b 时是脱敏的）变成明文泄漏 → 本轮拆成两条规则修回。
  for (const cmd of [
    'curl -u alice:123456 https://example.com',
    'curl -u alice:123456',
    'curl -u root:000000 -e "x"',
  ]) {
    const { out, hits } = redactDetails(cmd);
    assert.ok(hits.includes('cli-basic-auth-u'), `[${cmd}] 应由 cli-basic-auth-u 命中，实际 ${JSON.stringify(hits)}`);
    assert.ok(out.includes('[REDACTED]'), `应脱敏: ${cmd} -> ${out}`);
    assert.ok(!/\d{6}/.test(out), `不得残留全数字口令: ${out}`);
  }
  // `-u` 无冒号值（sudo 等）不得误伤
  assert.equal(redactSecrets('sudo -u root whoami'), 'sudo -u root whoami');
  // `--user` 走另一条规则 id（守卫 + curl/wget 锚定）
  assert.ok(redactDetails('curl --user alice:hunter2 https://x').hits.includes('cli-basic-auth-user'));
});

test('redact/G15b-FIX F4: -p<全数字> 仅在 mysql/mariadb 上下文脱敏', () => {
  // 正例：mysql 上下文（含同段内其它命令名分隔）
  for (const cmd of ['mysql -p12345678 -e "select 1"', 'mariadb -p99887766 -e "select 1"']) {
    const out = redactSecrets(cmd);
    assert.ok(out.includes('[REDACTED]'), `应脱敏: ${cmd} -> ${out}`);
    assert.ok(!/\d{6,}/.test(out), `不得残留数字密码: ${out}`);
  }
  // 反例：非 mysql 上下文的 -p 端口/前缀，逐字不变
  for (const cmd of ['ssh -p2222 host', 'docker run -p 8080:80 nginx', 'npm run build --prefix packages/core', 'mkdir -p /tmp/empty_dir']) {
    assert.equal(redactSecrets(cmd), cmd, `不应改动: ${cmd}`);
  }
});

test('redact/G15b-FIX2 R2: `-p<数字>` 必须锚定到 mysql/mariadb 本次调用（不得把端口当密码）', () => {
  // 回归：旧写法只要求「同一命令段里出现过 mysql 这个词」，于是下面这些**端口/主机名**被当密码抹掉
  for (const cmd of [
    'ssh mysql -p2222 host',
    'ssh mysql-prod -p2222',
    'psql -h mysql -p5432 -U postgres',
    'docker run --name mysql -p 3306:3306 mysql',
  ]) {
    const { out, hits } = redactDetails(cmd);
    assert.equal(out, cmd, `应逐字不变: ${cmd} -> ${out}`);
    assert.equal(hits.length, 0, `命中集合应为空，实际 ${JSON.stringify(hits)}`);
  }
  // 跨行：别的行的 mysql 不得把本行的端口拖下水（sh 生产路径曾先折叠换行 → 跨行命中）
  const ml = 'mysql -e "select 1"\nssh host -p2222\nrm -rf /tmp/t';
  assert.equal(redactSecrets(ml), ml, `跨行不得命中他命令: ${JSON.stringify(redactSecrets(ml))}`);
  // 锚定仍须覆盖真正属于 mysql 的写法
  for (const cmd of ['mysql -p12345678 -e "select 1"', 'sudo mysql -p12345678 -e "y"', 'env mariadb -p12345678 -e "y"']) {
    assert.ok(redactSecrets(cmd).includes('[REDACTED]'), `应脱敏: ${cmd} -> ${redactSecrets(cmd)}`);
  }
});

test('redact/G15b-FIX2 R2: `--user` 锚定 curl/wget——非认证用法逐字不变', () => {
  // 回归：旧写法把 docker 的 user:group / npm 的 --user 当口令抹掉（且吞掉结尾分隔符）
  for (const cmd of [
    'docker run --user nginx:nginx nginx',
    'npm install --user alice:hunter2',
    'chown --user alice:hunter2 f',
    'docker run --user 1000:1000 nginx',
  ]) {
    assert.equal(redactSecrets(cmd), cmd, `应逐字不变: ${cmd} -> ${redactSecrets(cmd)}`);
  }
  // 锚定后 `npm … --user` 不再命中，结尾分隔符自然保留
  assert.equal(redactSecrets('npm install --user alice:hunter2; ls'), 'npm install --user alice:hunter2; ls');
});

test('redact/G15b-FIX3: 多行命令**第 2 行起**的锚定规则仍须脱敏（`^` 的行首语义）', () => {
  // 回归（第四次复验 REJECT 依据）：FIX2 的命令词锚点写 `^`，而 core/ps1 是**整串**跑正则
  // （无 `m` 时 `^` = 字符串开头），sh 是逐行 sed（`^` = 行首）。于是下面这些多行载荷
  // 在 core/ps1 **明文泄漏**、sh 却脱敏 → 跨端发散，且既有语料（PART A 逐行驱动 + 唯一一条
  // 多行语料的 mysql 行不含 `-p`）覆盖不到。修法：`cli-mysql-password-numeric` /
  // `cli-basic-auth-user` 加 `m` 标志（redact.ts L129 / L146），`^` 从此 = 行首。
  const cases: Array<[string, string]> = [
    ['rm -rf /tmp/t\nmysql -p12345678 -e "select 1"', '12345678'],
    ['echo start\nmysql -p12345678 -e "select 1"\nrm -rf /tmp/t', '12345678'],
    ['rm -rf /tmp/t\nmariadb -p99887766', '99887766'],
    ['rm -rf /tmp/t\ncurl --user alice:hunter2 https://x', 'hunter2'],
    ['rm -rf /tmp/t\nwget --user alice:hunter2 https://x', 'hunter2'],
    ['echo start\n  mysql -p12345678 -e "select 1"\nfi', '12345678'], // 缩进续行（`^\s*`-等价形态见 §报告）
  ];
  for (const [cmd, secret] of cases) {
    const out = redactSecrets(cmd);
    assert.ok(out.includes('[REDACTED]'), `应脱敏: ${JSON.stringify(cmd)} -> ${JSON.stringify(out)}`);
    assert.ok(!out.includes(secret), `不得残留明文 ${secret}: ${JSON.stringify(out)}`);
  }
  // 第 1 行（对照）：同形态密钥在**行首**必须同样脱敏，与第 2 行结果逐字同构
  assert.equal(redactSecrets('mysql -p12345678 -e "select 1"'), 'mysql [REDACTED] -e "select 1"');
  assert.equal(redactSecrets('rm -rf /tmp/t\nmysql -p12345678 -e "select 1"'), 'rm -rf /tmp/t\nmysql [REDACTED] -e "select 1"');
  // 反方向（FIX2 已保证，防回退）：换行分隔不得把它行的端口/主机名拖下水
  for (const cmd of [
    'echo mysql\npsql -p5432 -U postgres\nssh host -p2222\nrm -rf /tmp/t',
    'mysql -e "select 1"\nssh host -p2222\nrm -rf /tmp/t',
  ]) {
    assert.equal(redactSecrets(cmd), cmd, `跨行不得命中他命令: ${JSON.stringify(redactSecrets(cmd))}`);
  }
});

test('redact/G15b-FIX F5: 同一行多块 PEM 逐块替换（与 core 惰性量词语义一致）', () => {
  const cmd =
    'cat a.key b.key "-----BEGIN RSA PRIVATE KEY----- BODYONE -----END RSA PRIVATE KEY-----" mid "-----BEGIN EC PRIVATE KEY----- BODYTWO -----END EC PRIVATE KEY-----"';
  const out = redactSecrets(cmd);
  assert.equal(
    out,
    'cat a.key b.key "[REDACTED]" mid "[REDACTED]"',
    `多块 PEM 应逐块替换且保留块间文本: ${out}`,
  );
  assert.ok(!out.includes('BODYONE') && !out.includes('BODYTWO'), `不得残留私钥体: ${out}`);
});

test('redact/G15b-FIX A1: ssh -i <私钥路径> 明确不脱敏（编排者裁量）', () => {
  // 编排者裁定：-i 是私钥**文件路径**而非密钥值，脱敏它属过度脱敏
  const cmd = 'ssh -i /home/u/.ssh/id_rsa host';
  assert.equal(redactSecrets(cmd), cmd);
});
