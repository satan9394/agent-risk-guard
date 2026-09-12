/**
 * redact.ts — Secret Redaction（生态对标：copilot-safety-net / claude-guardrails）
 *
 * 原则：拦截消息与审计日志中绝不回显明文密钥。
 * 吸取经验：CC Safety Net 的 block 消息与 JSONL 日志自动脱敏 token/password/API key；
 *           claude-guardrails 在 UserPromptSubmit 阶段拦截粘贴的活凭据。
 * 本模块提供统一脱敏基元：审计序列化、hook 输出、block 消息在出口处一律过 redactSecrets()。
 *
 * ── G15b（2026-09-11）三端同源纪律 ──────────────────────────────────────────
 * 本文件是脱敏模式的 **canonical（唯一真源）**。另外两端按平台语法重写同一语义集合：
 *   - `agent-risk-guard-audit/scripts/dangerous-commands.ps1`（.NET 正则，RedactPatterns）
 *   - `agent-risk-guard-audit/scripts/dangerous-commands.sh`（POSIX ERE，redact_text）
 * 三端一致性由 `packages/core/test/redact-parity.test.ts` 守住（同一语料喂三端，断言输出与命中类一致）。
 *
 * 与 G15 版的差异（G15b 补齐四类残留 + 三端收敛）：
 *   1. 键值对支持**空格分隔**（`aws_secret_access_key VALUE`）——原模式只认 `[:=]`；
 *   2. 键值对的值支持**引号内含空格**（`password="correct horse battery staple"`）——
 *      原值正则 `[^\s'",;}\]]+` 遇空格即断；
 *   3. 新增 CLI 短参 `-p<value>`（mysql）与 `-u user:pass`（curl/basic auth）；
 *   4. 键值类补 `token` / `secret` / `credential` / `passwd` 裸键名；
 *   5. **去掉 `\b`**：POSIX ERE 无 `\b`，三端若一端用 `\b`、另一端用 `(^|[^alnum])` 模拟，
 *      会在边界场景产生不一致输出。统一改为「独特前缀 + 贪婪量词」，确需左边界者
 *      （`-p` / `-u`）三端同形写作 `(^|[^-A-Za-z0-9_])`。去掉 `\b` 只**增加**命中，不减少既有覆盖。
 *
 * ── G15b-FIX2（2026-09-11）三处收窄/拆分（复验打回后的修复）──────────────────
 *   1. **`-u` 与 `--user` 拆成两条规则**：G15b-FIX 把「密码段须含非数字」守卫加在共用分支上，
 *      令 `curl -u alice:123456`（全数字口令）明文泄漏 → `cli-basic-auth-u` 恢复 G15b 旧写法
 *      （无值限制），`cli-basic-auth-user` 保留守卫**并锚定 curl/wget**（非认证用法逐字不变）。
 *   2. **`-p<数字>` 改为命令词锚定**：旧写法只要求「同段出现过 mysql 这个词」，会把
 *      `ssh mysql -p2222 host` / `psql -h mysql -p5432` 的**端口**当密码脱敏；现要求 `-p` 属于
 *      「段首（或 ;&| 之后、sudo/env/command 之后）的 mysql/mariadb 本次调用」。
 *   3. **sh 生产路径不再折叠换行**（见 dangerous-commands.sh 的 redact_cmd）：旧实现跨行命中别的
 *      命令的端口，且与 ps1 发散；现要求三端在多行命令上逐字一致（parity PART B 有专门语料）。
 *
 * 已知取舍（均为「覆盖更多」或「避免误伤」，详见 G15b / G15b-FIX2 报告）：
 *   - `-p` 左边界排除前导 `-`，否则 `--prefix` / `--pretty` 会被误伤；
 *   - `-p` 通用规则的值须含至少一个非数字字符，排除 `ssh -p2222` 这类端口误伤
 *     （全数字密码由命令词锚定的 `cli-mysql-password-numeric` 补齐）；
 *   - `-u` / `--user` 的值类**不排除** `;`/`&`/`|`：排除会让 `curl -u 'u:p;q'` 只脱敏到 `;` 前，
 *     造成**部分明文残留**；吞掉尾部分隔符只影响 deny 回显的可读性，不影响判定。
 */

/** 单条脱敏规则：id 用于跨端 parity 断言「命中集合一致」 */
export interface RedactRule {
  /** 稳定的规则标识（三端同名，parity 测试按它比对命中集合） */
  id: string;
  /** 匹配正则（一律带 g；需要大小写不敏感的规则自带 i） */
  re: RegExp;
  /** 替换模板；缺省为 [REDACTED]。需要保留左边界字符的规则用 `$1`。 */
  repl?: string;
}

const REDACTED = '[REDACTED]';

/**
 * 内部哨兵：规则替换时先写入它，全部规则跑完后再统一映射为 `[REDACTED]`。
 *
 * 为什么需要它：若第一条规则已产出 `[REDACTED]`，后面的键值规则会把 `[REDACTED`（不含 `]`，
 * 因为值类排除 `]`）当成一个「值」再匹配一次，于是留下多余的 `]`——
 * 实测 `aws configure set aws_access_key_id AKIA…` → `aws configure set [REDACTED]]`（三端同病）。
 * 哨兵不含 `[`/`]`/空白且不含键名，任何规则都不会二次命中，从根上消除该类伪影。
 */
const SENTINEL = '@@RG_REDACTED@@';

/** 键值对的「值」：双引号（可含空格）| 单引号（可含空格）| 不带引号的连续非空白 */
const V = '("[^"]*"|\'[^\']*\'|[^\\s\'",;}\\]]+)';

/**
 * 常见密钥模式（覆盖主流云/平台/密钥格式；命中即整体替换为占位符）。
 * 顺序即应用顺序，三端必须保持一致（先专用后通用）。
 */
export const SECRET_RULES: RedactRule[] = [
  // ── 形状类（无需键名） ─────────────────────────────────────────────
  // AWS access key id
  { id: 'aws-access-key-id', re: /(?:AKIA|ASIA)[0-9A-Z]{16}/g },
  // GitHub PAT / fine-grained（下界取 20：G15 的 ps1/sh 已是 20，core 原为 36，统一到 20 只增不减）
  { id: 'github-pat', re: /gh[pousr]_[A-Za-z0-9]{20,255}/g },
  // OpenAI / Anthropic
  { id: 'openai-sk', re: /sk-(?:proj-)?[A-Za-z0-9_-]{20,}/g },
  { id: 'anthropic-sk-ant', re: /sk-ant-[A-Za-z0-9_-]{20,}/g },
  // JWT（紧凑三段的 header.payload.signature）
  { id: 'jwt', re: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g },
  // PEM 私钥块（含换行，跨行匹配）
  {
    id: 'pem-private-key',
    re: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/g,
  },

  // ── 键值类 ────────────────────────────────────────────────────────
  // password=<值>（值可带引号并可含空格）
  { id: 'password-kv', re: new RegExp('"?password"?\\s*[:=]\\s*' + V, 'gi') },
  // AWS CLI / 等价键名的**空格分隔**形态：aws configure set aws_secret_access_key VALUE
  // 必须排在 generic-kv 之前，否则 `session_token=…` 会被 generic 的裸 `token` 先截断
  {
    id: 'aws-space-kv',
    re: new RegExp(
      '(?:aws_)?(?:secret_access_key|access_key_id|session_token)(?:\\s*[:=]\\s*|\\s+)' + V,
      'gi',
    ),
  },
  // api_key= / access_token= / token= / secret_key= / client_secret= / credential= / secret= / passwd=
  {
    id: 'generic-kv',
    re: new RegExp(
      '"?(?:api[_-]?key|access[_-]?token|token|secret[_-]?key|client[_-]?secret|credential|secret|passwd)"?\\s*[:=]\\s*' +
        V,
      'gi',
    ),
  },
  // Authorization: Bearer <token> / Basic <b64>
  { id: 'authorization', re: /authorization\s*[:=]\s*(?:bearer|basic)\s+[A-Za-z0-9._-]+/gi },

  // ── CLI 参数类 ────────────────────────────────────────────────────
  // mysql -p<password>：值须含至少一个非数字字符，避免误伤 `-p2222` 端口 / `--prefix` / `-p 8080:80`
  {
    id: 'cli-mysql-password',
    re: /(^|[^-A-Za-z0-9_])-p[^\s]*[^\s0-9][^\s]*/g,
    repl: '$1' + SENTINEL,
  },
  // G15b-FIX F4 / G15b-FIX2 R2：**全数字**密码（`mysql -p12345678`）在 mysql/mariadb 上下文里脱敏。
  // G15b-FIX2 改为**命令词锚定**：`-p<数字>` 必须紧跟在「段首（或 ; & | 后、sudo/env/command 前缀后）
  // 的 mysql/mariadb 调用」之内。旧写法只要求「同段出现过 mysql 这个词」，于是
  //   `ssh mysql -p2222 host`（主机名恰好叫 mysql）、`psql -h mysql -p5432` 的**端口**被当密码脱敏，
  //   且 sh 生产路径先折叠换行，会跨行命中别的命令的端口（与 ps1 发散）。
  // 锚定后：`ssh mysql -p2222` / `psql -h mysql -p5432` / `docker run --name mysql -p 3306:3306 mysql`
  //   逐字不变，而 `mysql -p12345678` / `sudo mysql -p12345678` 仍脱敏。
  {
    id: 'cli-mysql-password-numeric',
    re: /(^|[;&|]\s*|sudo\s+|env\s+|command\s+)(mysql|mariadb)([^;&|\n]*)(\s)-p[0-9]+/gi,
    repl: '$1$2$3$4' + SENTINEL,
  },
  // G15b-FIX2 R1：`-u` 与 `--user` **拆成两条规则**。
  // 背景：G15b-FIX 把「密码段须含非数字」的守卫加在了 `-u|--user` 的**共用分支**上，
  //   导致 `curl -u alice:123456`（全数字口令）从此**明文泄漏**（G15b 时是脱敏的）→ 回归。
  // ① `-u`（curl 短参）：恢复 G15b 的旧写法，**不加**任何非数字限制 → `curl -u alice:123456` 必脱敏。
  {
    id: 'cli-basic-auth-u',
    re: /(^|[^-A-Za-z0-9_])-u\s+[^\s:]+:[^\s]+/g,
    repl: '$1' + SENTINEL,
  },
  // ② `--user`（长参）：保留「密码段须含非数字」守卫（避开 uid:gid），并额外做**命令词锚定**——
  //    只有 curl/wget 的 `--user` 才是凭据；`docker run --user nginx:nginx`（user:group）、
  //    `npm install --user alice:hunter2`、`chown --user …` 一律逐字不变（R2 的过度脱敏）。
  {
    id: 'cli-basic-auth-user',
    re: /(^|[;&|]\s*|sudo\s+|env\s+|command\s+)(curl|wget)([^;&|\n]*)(\s--user\s+)[^\s:]+:[^\s]*[^\s0-9:][^\s]*/g,
    repl: '$1$2$3$4' + SENTINEL,
  },

  // ── 通用启发式（放最后，避免抢先吞掉上面的专用形态） ───────────────
  // >=40 位长随机串（避免误伤普通单词/短参数）
  { id: 'long-random', re: /[A-Za-z0-9_-]{40,}/g },
];

/** 全部规则 id（供文档与跨端 parity 测试比对） */
export const REDACT_RULE_IDS: string[] = SECRET_RULES.map((r) => r.id);

/** 脱敏结果：输出文本 + 命中的规则 id 集合 */
export interface RedactResult {
  out: string;
  hits: string[];
}

/**
 * 脱敏并返回命中的规则 id（parity 测试按 hits 断言三端「命中集合一致」）。
 * hits 按规则应用顺序排列，同一规则命中多次只记一次。
 */
export function redactDetails(text: string): RedactResult {
  if (!text) return { out: text, hits: [] };
  let out = text;
  const hits: string[] = [];
  for (const rule of SECRET_RULES) {
    // 每条规则用全新 RegExp，避免共享 /g 对象的 lastIndex 状态泄漏
    const re = new RegExp(rule.re.source, rule.re.flags);
    let matched = false;
    out = out.replace(re, (...args: unknown[]) => {
      matched = true;
      if (!rule.repl) return SENTINEL;
      // args = [match, p1..pn, offset, string]
      const groups = args.slice(1, args.length - 2) as (string | undefined)[];
      return rule.repl.replace(/\$(\d)/g, (_m, d: string) => groups[Number(d) - 1] ?? '');
    });
    if (matched) hits.push(rule.id);
  }
  // 全部规则跑完后，哨兵统一映射为最终占位符（见 SENTINEL 注释：防止规则二次命中占位符）
  return { out: out.split(SENTINEL).join(REDACTED), hits };
}

/** 对任意文本做密钥脱敏（审计日志 / 拦截消息 / hook 输出统一入口） */
export function redactSecrets(text: string): string {
  if (!text) return text;
  return redactDetails(text).out;
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
