/**
 * decision-parity.test.ts — G3 跨端**判定**一致性闸门（ps1 vs sh）
 *
 * ── 为什么必须有它（这是本卡最重要的产出）─────────────────────────────────
 * `redact-parity.test.ts` 只钉住**脱敏输出**，对「同一条命令两端给出不同 permissionDecision」毫无覆盖。
 * 于是 ps1（PowerShell，`-match` 默认大小写不敏感）与 sh（POSIX grep，默认大小写敏感）在判定上
 * **各自为政**：G3 编排者实测 20 条里 5 条发散（4 条 sh 漏拦 + 1 条 sh 误拦），G4/G5 两轮复验又各挖出
 * 一批同类分歧——全部是本闸门缺席的后果。本文件把「两端判定必须逐条相同」变成一条自动化红线。
 *
 * ── 判据（三重合取，缺一不可）─────────────────────────────────────────────
 * 对语料中每条载荷，**两端真实 spawn + 进程 stdin**（D6）：
 *   ① 输出必须可判读：空/纯空白 = allow（CC hook 协议：exit 0 + 无 JSON 即放行）；
 *      非空则必须是**合法 JSON** 且带 `permissionDecision`（非法 JSON = 调用方拿不到决策 = 事故）。
 *   ② 两端 decision 必须**完全一致**（allow 与「无输出」视为同一态）。
 *   ③ 两端还都必须等于语料里钉住的 `expect`——只有 ② 会被"两端一起改错"骗过，③ 把应然语义也钉住。
 * 失败时打印 `载荷 / ps1 / sh / 期望` 四列，便于直接定位。
 *
 * ── 语料九段（G3 实测的 5 条分歧 + 两侧邻居面 + FIX4 三处缺口 + FIX5 前缀/分歧面）───────
 *   A 段 T1–T20：编排者 Round 260 的 20 条分歧矩阵（含 T2/T3/T5/T9/T10 五条已修分歧）。
 *   B 段 Q1–Q12：**T3「空引号归一」的绕过面**——归一只能"多看见"不能"少看见"：
 *                `rm'' --help` → allow，而 `rm'' -rf /tmp/t` / `r''m -rf` / `;''rm -rf` 必须仍 deny。
 *   C 段 C1–C20：**T5/T2「大小写」的绕过面**（含必须保持放行的 `RM --help` / `RM -H` / `RM -V`；
 *                以及 ps1 用 `-cmatch` 精确大写的 `git switch -C`，`-c` 是安全的新建分支）。
 *   D 段 Y1–Y10：**T9/T10「command 类型」的邻居面**——按 PowerShell `[string]` 转换语义对齐：
 *                null / [] / {} → deny；`["rm","-rf","/tmp/t"]` → deny（PS 会拼成 "rm -rf /tmp/t"）；
 *                123 / true / {"a":1} / [["rm"]] / ["rm","--help"] / ["git","status"] → allow。
 *   F 段 F1–F18：**非 rm 族**的空引号插词（R1）。⚠️ G3-FIX5/B 起两端**同做全局空引号归一**，
 *                故 F1–F15 由 allow 改钉为 **deny**（与 C6/C12/C16/C17 同判）——FIX4 把 F7/F8/F9/F13
 *                钉成 allow 与 C 段自相矛盾，等于把「ps1 的洞」当契约、禁止后续收紧（见 D12）。
 *   H 段 H1–H12：**command 数组的元素为对象**（R2：`[{"cmd":"rm -rf /tmp/t"}]` 曾 fail-open）。
 *   G 段 G1–G14：`-i` 之后「引号内文本命中不敏感词」的**前导锚**面（R3：合法 commit message 被误拦）。
 *   K 段 K1–K31：**G3-FIX5 新增**——sudo / `sudo''` / 绝对路径前缀 × 危险基座（A 面，Evaluator
 *                G3-FIX4 §4-A 点名的 12 条真实危险命令），既存分歧族 diskpart/rmdir/format（B 面，
 *                §2.4d 实测 ≥12 条），以及补前缀后的过拦面（C 面）。
 *   K 段 K39–K56：**G3-FIX6/A 新增**——**包装词 / 子 shell / 块 / if-then / for-do** 前缀面
 *                （Evaluator G3-FIX5 §3.1 的 REJECT 依据：这 8 条真实可执行形态在 ps1 端 deny → allow）。
 *                K57–K59 是**过拦守卫**：`do`/`then` 出现在引号内散文时不得被点着。
 *   K 段 K60–K68：**G3-FIX7/A 新增**——**引号内 / 散文里的括号不是命令位**（Evaluator G3-FIX6 §4.1 的
 *                REJECT 依据：把 `\(`/`\{` 放**锚位**导致 9 条合法命令 allow → deny，含验收清单点名的
 *                `printf '{ diskpart }'`）。K43/K44/K52/K53 是**成对守卫**：真子 shell / 块仍须 deny。
 *   K 段 K69–K87：**G3-FIX7/B 新增**——**包装词 ↔ cmd/command/env 可互串**（Evaluator G3-FIX6 §9.4
 *                登记项：FIX6 的固定顺序使 `command time diskpart` 等 ≥10 条真实可执行形态在 ps1 端
 *                相对冻结基线 pre-G3 由 deny → allow，属 D12 放松）。K83–K87 是反向守卫（闭集可重复
 *                **不得**滑向「任意单词」：`x command diskpart` / `timeout diskpart` / `sudorm` 仍 allow）。
 *   K 段 K88–K99：**G3-FIX8/A 新增**——**包装词自身的选项**（`sudo -u root` / `nice -n 5` /
 *                `ionice -c 3` / `doas -u root` / `exec -a name` / `time -p` / `sudo --user=root`）。
 *                FIX7 只认「包装词 + 空白」，选项把命令词推离命令位 → 两端 allow，而 pre-G3 ps1
 *                本就 deny（其规则无命令位锚）→ 同属 D12 放松。K97–K99 是反向守卫：选项后是
 *                **安全命令**（`sudo -u root ls diskpart`）时不得误拦 —— 修法不得「吃掉任意 token」。
 *   K 段 K100–K116：**G3-FIX8/R3 新增**（独立 Evaluator REJECT 的两条放松面）——
 *                ① **多行 rm 豁免粒度**（sh 单端）：`rm --help` + 换行 + `rm /tmp/t` 曾被首行豁免掩蔽
 *                   → 两端 deny；修法取「全部匹配行」，任一行非 help/version 即 deny。
 *                ② **`env` 长选项**（两端）：`env --ignore-environment diskpart` / `env --unset=FOO …`
 *                   在 FIX7/HEAD 本就 deny，FIX8 一度收窄 env 分支 → allow；本轮 env/command 分支
 *                   逐字回到 FIX7 形态。K111–K116 是守卫（长选项后接安全命令、多行无真删除）。
 *   L 段 L1–L24：**G3-FIX6/A 新增 + G3-FIX7/A 扩到 20 条 + G3-FIX8/A 扩到 22 条 + R3 扩到 24 条**——
 *                **跨端身份断言**专用语料（命令位 / 非命令位成对），由**独立的第二个 test**
 *                断言「两端 decision 逐条一致」（不看应然），使「单端前缀漂移」提交前必红。
 *                L17–L20 是 FIX7/A 的两对括号守卫；L21–L22 是 FIX8/A 的包装词选项守卫；
 *                L23–L24 是 R3 的多行豁免守卫。
 *   M 段 M1–M15：**G24 新增**——**rule 16 的 help/version 豁免粒度**。豁免只能作用于「它自己那次
 *                直接调用」，**不得**退化成整条命令级抑制（旧 ps1 用第二个 `-and ($cmd -notmatch …)`
 *                做整串否定 → 一处 `rm --help` 就把同一条命令里另一处真删除一并放行）。
 *                M1–M9 是「一处 help 掩盖另一处真删除」（ps1 旧=allow / sh=deny 的分歧面），
 *                M10–M15 是**纯 help 调用必须仍 allow** 的反向守卫（防「干脆取消豁免」式的过拦修法）。
 *
 * ⚠️ 本闸门只钉「两端逐字同判 + 等于应然」。**不得**为了让它变绿而放宽 deny 语义（红线 §5.6/D12）：
 *    若某条真的两端分歧且短期无法收敛，正确做法是**保留分歧并如实登记**，而不是把它钉成 allow。
 *    当前已知的此类残留（**不入语料**，见 IMPLEMENTATION_RESULT_G3-FIX6 §未解决问题）：
 *      `rmdir <无标志路径>`（sh deny / ps1 allow，POSIX 与 Windows 语义冲突；ps1 `hook-fp-regression.ps1`
 *        第 5 条把 `rmdir /tmp/empty_dir` 钉成 allow，sh `sh-hook-test` 把它钉成 deny）、
 *      `time|nice|nohup … rmdir <无标志路径>`（G3-FIX6 把上面这条**既存语义分歧**沿包装词前缀**同构扩展**：
 *        sh rule 1/1b 无论有无标志都拦，ps1 rule 14 只在带 `/s|/q|-r|-f|…` 时拦）、
 *      `echo "Format-Volume guide"`（sh 的 rule 17 读未剥离 echo 的原文 → deny / ps1 allow）、
 *      `rm /tmp/t; rm --help`（**反向顺序**：G24 修复后 ps1 deny / sh allow。ps1 把豁免收成**调用点
 *        前瞻**后，「非 help 的 rm」一律拦；而 sh 的 rmseg 抽取式（`.*` 贪婪 + `head -1`）取的是
 *        **最后一个** rm 的实参 → 仍被后面的 `--help` 掩蔽。方向是 ps1 **收紧**而非放松，故保留并登记）、
 *      `rm --help\nrm /tmp/t`（**多行**：G24 修复后 ps1 deny / sh allow。sh 侧 sed 是**逐行**处理再
 *        `head -1`，只看**第一行**的抽取结果，第二行的真删除对 sh 不可见。同上，方向为 ps1 收紧）、
 *      `rm --help extra`（ps1 allow / sh deny；**既有**，非 G24 引入：ps1 的前瞻只认「help 标志 + 词
 *        边界」，sh 的 `case` 要求实参**逐字**等于 `--help`）。
 *
 * 可覆盖路径（用于变异验证：把主源换成"回退版"后本闸门必须变红）：
 *   `RG_PARITY_PS1=<path>` / `RG_PARITY_SH=<path>`
 * 缺 `powershell.exe` 或 `wsl.exe` 时对应端 skip 并 diagnostic（沿用 `redact-parity.test.ts` 的既有写法）。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const HERE = import.meta.dirname;
// HERE = <repo>/packages/core/test → 三层上溯到 <repo>，再进 skills/agent-risk-guard/scripts
// 2026-09-13 修复：此前指向**仓库外**的兄弟目录 `agent-risk-guard-audit/`，而 CI 只 checkout 仓库本身
//   → 该路径在 CI 上永远不存在，本闸门**从未在 CI 跑起来过**（主干因此连续变红）。
//   现改为指向**仓库内**那一份（与 `test-all.ps1` 和 CI 用的是同一份、同一位置）。
//   变异验证仍可用 `RG_PARITY_PS1` / `RG_PARITY_SH` 覆盖。
const DEFAULT_PS1 = resolve(HERE, '../../../skills/agent-risk-guard/scripts/dangerous-commands.ps1');
const DEFAULT_SH = resolve(HERE, '../../../skills/agent-risk-guard/scripts/dangerous-commands.sh');

export type Decision = 'allow' | 'deny';
export interface DecisionCase {
  /** 用例名（打印用） */
  id: string;
  /** 直接喂给 hook **进程 stdin** 的 JSON 原文（不是命令原文——这样才能覆盖 command 的类型形态） */
  payload: string;
  /** 应然 decision（两端都必须等于它） */
  expect: Decision;
  /** 备注（为什么这么钉） */
  note?: string;
}

/** 便捷构造：shell 工具 + 字符串 command */
const J = (cmd: string): string => JSON.stringify({ tool_name: 'Bash', tool_input: { command: cmd } });
/** 便捷构造：shell 工具 + 任意类型 command（覆盖 T9/T10 的类型面） */
const T = (v: unknown): string => JSON.stringify({ tool_name: 'Bash', tool_input: { command: v } });

export const DECISION_CORPUS: DecisionCase[] = [
  // ── A 段 T1–T20：编排者 Round 260 分歧矩阵（`_probe_g3_div.mjs`）──────────────────
  { id: 'T1  变量+反斜杠混淆', payload: J('$x="r\\m"; $x -rf /tmp/t'), expect: 'allow', note: '两端同 allow（反斜杠插字未构成可执行 rm）' },
  { id: 'T2  变量+大写', payload: J('$X=RM; $X -RF /tmp/t'), expect: 'deny', note: 'G3 修复：sh 漏拦（变量赋值规则缺 -i）' },
  { id: 'T3  rm 空引号 + --help', payload: J("rm'' --help"), expect: 'allow', note: 'G3 修复：sh 误拦（引号未归一）' },
  { id: 'T4  反斜杠插字', payload: J('r\\m -rf /tmp/t'), expect: 'deny' },
  { id: 'T5  全大写 RM', payload: J('RM -RF /tmp/t'), expect: 'deny', note: 'G3 修复：sh 漏拦（缺 -i）' },
  { id: 'T6  尾随 LF', payload: J('git status\n'), expect: 'allow' },
  { id: 'T7  尾随 TAB', payload: J('git status\tx'), expect: 'allow' },
  { id: 'T8  命令中间 TAB', payload: J('git\tstatus'), expect: 'allow' },
  { id: 'T9  command:null', payload: T(null), expect: 'deny', note: 'G3 修复：sh 漏拦（类型）' },
  { id: 'T10 command:数组', payload: T(['rm', '-rf', '/tmp/t']), expect: 'deny', note: 'G3 修复：sh 漏拦（PS [string] 拼成 "rm -rf /tmp/t"）' },
  { id: 'T11 首行 # 注释 + 危险', payload: J('# note\nrm -rf /tmp/t'), expect: 'allow', note: '已知同形残留：两端均在整串首字符 # 处短路' },
  { id: 'T12 危险 + 次行 # 注释', payload: J('rm -rf /tmp/t\n# note'), expect: 'deny' },
  { id: 'T13 空 command', payload: J(''), expect: 'deny' },
  { id: 'T14 非 Bash 工具', payload: JSON.stringify({ tool_name: 'Read', tool_input: { file_path: '/etc/passwd' } }), expect: 'allow' },
  { id: 'T15 对照：危险命令', payload: J('rm -rf /tmp/t'), expect: 'deny' },
  { id: 'T16 对照：安全命令', payload: J('git status'), expect: 'allow', note: '红线：不得为过闸门放宽既有 allow 语义' },
  { id: 'T17 前导空白 + 危险', payload: J('   rm -rf /tmp/t'), expect: 'deny' },
  { id: 'T18 分号串联', payload: J('echo a; rm -rf /tmp/t'), expect: 'deny' },
  { id: 'T19 管道串联', payload: J('echo a | rm -rf /tmp/t'), expect: 'deny' },
  { id: 'T20 换行串联', payload: J('echo a\nrm -rf /tmp/t'), expect: 'deny' },

  // ── B 段 Q1–Q12：T3 空引号归一的**绕过面**（归一后必须仍完整判定）──────────────────
  { id: 'Q1  rm 空单引号 + --help', payload: J("rm'' --help"), expect: 'allow' },
  { id: 'Q2  rm 空双引号 + --help', payload: J('rm"" --help'), expect: 'allow' },
  { id: 'Q3  rm 空引号 + -rf', payload: J("rm'' -rf /tmp/t"), expect: 'deny', note: '归一邻居：必须仍 deny' },
  { id: 'Q4  rm 空双引号 + -rf', payload: J('rm"" -rf /tmp/t'), expect: 'deny', note: '归一邻居：必须仍 deny' },
  { id: 'Q5  空引号插命令名 r..m -rf', payload: J("r''m -rf /tmp/t"), expect: 'deny', note: '归一后 → rm -rf' },
  { id: 'Q6  空引号插命令名 r..m --help', payload: J("r''m --help"), expect: 'allow', note: '归一后 → rm --help' },
  { id: 'Q7  空引号在命令名前', payload: J("''rm -rf /tmp/t"), expect: 'deny' },
  { id: 'Q8  空引号在分隔符后', payload: J(";''rm -rf /tmp/t"), expect: 'deny' },
  { id: 'Q9  rm 紧贴 -rf（无空格）', payload: J("rm''-rf /tmp/t"), expect: 'deny' },
  { id: 'Q10 非空引号插词（引号内有空格）', payload: J("rm' '-rf /tmp/t"), expect: 'deny' },
  { id: 'Q11 rm 空引号 + --version', payload: J("rm'' --version"), expect: 'allow' },
  { id: 'Q12 rm 空引号 + -h', payload: J("rm'' -h"), expect: 'allow' },

  // ── C 段 C1–C20：T5/T2 大小写的**绕过面**（ps1 `-match` 默认大小写不敏感）──────────
  { id: 'C1  Rm -Rf', payload: J('Rm -Rf /tmp/t'), expect: 'deny' },
  { id: 'C2  rM -rf', payload: J('rM -rf /tmp/t'), expect: 'deny' },
  { id: 'C3  RM --help', payload: J('RM --help'), expect: 'allow', note: '大小写邻居：不得误拦' },
  { id: 'C4  RM -H', payload: J('RM -H'), expect: 'allow' },
  { id: 'C5  RM -V', payload: J('RM -V'), expect: 'allow' },
  { id: 'C6  RMDIR /s /q', payload: J('RMDIR /s /q x'), expect: 'deny' },
  { id: 'C7  UNLINK', payload: J('UNLINK /tmp/t'), expect: 'deny' },
  { id: 'C8  Shred -u', payload: J('Shred -u /tmp/t'), expect: 'deny' },
  { id: 'C9  变量赋值 X=RM', payload: J('X=RM; $X -RF /tmp/t'), expect: 'deny' },
  { id: 'C10 变量赋值 X="RM"', payload: J('X="RM"; $X -rf /tmp/t'), expect: 'deny' },
  { id: 'C11 R\\M -rf', payload: J('R\\M -rf /tmp/t'), expect: 'deny' },
  { id: 'C12 FIND -DELETE', payload: J('find /tmp -DELETE'), expect: 'deny' },
  { id: 'C13 GIT CLEAN -f', payload: J('GIT CLEAN -f'), expect: 'deny' },
  { id: 'C14 Git RESET --HARD', payload: J('Git reset --HARD'), expect: 'deny' },
  // 已知同形残留（**两端一致 allow**，非分歧）：ps1 的 format 规则要求 `format X: /...`（带斜杠）才拦。
  // 本条钉的是"两端同判"，不是"这样安全"；若要收紧须两端一起改（超出 G3 范围，记录为加固候选）。
  { id: 'C15 FORMAT C:（无斜杠）', payload: J('FORMAT C:'), expect: 'allow', note: '已知同形残留：ps1 需 `format X: /` 才拦' },
  { id: 'C16 SHUTDOWN /s', payload: J('SHUTDOWN /s'), expect: 'deny' },
  { id: 'C17 CHMOD 777 /x', payload: J('CHMOD 777 /x'), expect: 'deny' },
  { id: 'C18 python SHUTIL.RMTREE', payload: J('python -c "import shutil; SHUTIL.RMTREE(x)"'), expect: 'deny' },
  { id: 'C19 rimraf', payload: J('rimraf node_modules'), expect: 'deny' },
  { id: 'C20 Clear-Content', payload: J('Clear-Content x'), expect: 'deny' },
  { id: 'C21 git switch -C main（大写 C）', payload: J('git switch -C main'), expect: 'deny', note: 'ps1 用 -cmatch 精确大写' },
  { id: 'C22 git switch -c feature（小写 c）', payload: J('git switch -c feature'), expect: 'allow', note: '安全的新建分支：大小写敏感必须保留' },

  // ── D 段 Y1–Y10：T9/T10 command 类型邻居（对齐 PowerShell `[string]`）─────────────
  { id: 'Y1  command:null', payload: T(null), expect: 'deny', note: 'null ≡ 缺字段（ps1 L204）' },
  { id: 'Y2  command:[]', payload: T([]), expect: 'deny', note: 'PS [string]@() = "" → 「command 为空」' },
  { id: 'Y3  command:["rm","-rf","/tmp/t"]', payload: T(['rm', '-rf', '/tmp/t']), expect: 'deny' },
  { id: 'Y4  command:["rm","--help"]', payload: T(['rm', '--help']), expect: 'allow', note: 'PS 拼成 "rm --help"（无害）' },
  { id: 'Y5  command:123', payload: T(123), expect: 'allow', note: 'PS [string]123 = "123"' },
  { id: 'Y6  command:true', payload: T(true), expect: 'allow', note: 'PS [string]$true = "True"' },
  { id: 'Y7  command:{}', payload: T({}), expect: 'deny', note: '空对象 → PS 串为空 → 「command 为空」' },
  { id: 'Y8  command:{"a":1}', payload: T({ a: 1 }), expect: 'allow', note: 'PS 串为 "@{a=1}"（非空、非危险）' },
  { id: 'Y9  command:[["rm"]]', payload: T([['rm']]), expect: 'allow', note: 'PS 嵌套数组 → "System.Object[]"' },
  { id: 'Y10 command:["git","status"]', payload: T(['git', 'status']), expect: 'allow' },

  // ── E 段：缺键/畸形（G5 红线的判定侧对照，防"为过闸门放宽 fail-closed"）───────────
  { id: 'E1  缺 command 键', payload: JSON.stringify({ tool_name: 'Bash', tool_input: {} }), expect: 'deny' },
  { id: 'E2  缺 tool_input', payload: JSON.stringify({ tool_name: 'Bash' }), expect: 'deny' },

  // ══════════════════════════════════════════════════════════════════════════════════
  // G3-FIX4 新增三段（F/H/G，共 44 条）—— 补的是 G3 闸门 66 条**零覆盖**、却在同一冻结源上
  // 实测出「14 条新跨端分歧 + 1 处 fail-open」的三处缺口（Evaluator G3 §2.2b/§2.4/§2.5d）。
  // 钉法：每条都同时钉「两端一致」与「等于应然」，故把任一条硬伤改回旧行为 → 本闸门必红。
  // ══════════════════════════════════════════════════════════════════════════════════

  // ── F 段 F1–F18：**非 rm 族**的空引号插词（R1；G3-FIX5/B 后两端一起 deny）──────────────
  // ⚠️ G3-FIX5 的**结构性变更**：ps1 与 sh **都**把「空引号对（'' / ""）归一」提升为
  //    **全部规则**读的检测文本（ps1 L211b `$cmd = $cmd -replace "''",'' -replace '""',''`；
  //    sh L389-396 `cmd="$cmdNoq"`）。因此 F1–F15 这些写法在 bash 下**真实还原**成危险命令
  //    （`g''it clean -f` ≡ `git clean -f`，Evaluator G3-FIX4 §2.3c 用 `set --` 逐条实测），
  //    **两端一致 deny**。这与 C 段同型用例（C6 RMDIR /s /q x、C12 FIND -DELETE、C16 SHUTDOWN /s、
  //    C17 CHMOD 777 /x）的期望**完全一致**——FIX4 曾把 F7/F8/F9/F13 钉成 allow，与 C 段自相矛盾，
  //    那一版把「ps1 的洞」当成了契约，等于禁止后续收紧；G3-FIX5 已按 D12（一致性必须**向上**对齐、
  //    不得把放松写进闸门）改为 deny。归一是「多看见」方向，故 F16/F17 反向守卫仍须 deny。
  { id: 'F1  g..it clean -f（非 rm 族）', payload: J("g''it clean -f"), expect: 'deny', note: '空引号归一 → git clean -f（与 C13 同判）' },
  { id: 'F2  g..it reset --hard', payload: J("g''it reset --hard"), expect: 'deny', note: '空引号归一 → git reset --hard' },
  { id: 'F3  g..it rm x', payload: J("g''it rm x"), expect: 'deny', note: '空引号归一 → git rm x' },
  { id: 'F4  g..it push --force', payload: J("g''it push --force"), expect: 'deny', note: '空引号归一 → git push --force' },
  { id: 'F5  g..it branch -D x', payload: J("g''it branch -D x"), expect: 'deny', note: '空引号归一 → git branch -D x' },
  { id: 'F6  r..mdir /s /q x', payload: J("r''mdir /s /q x"), expect: 'deny', note: '空引号归一 → rmdir /s /q x（与 C6 同判）' },
  { id: 'F7  R..MDIR /s /q x', payload: J("R''MDIR /s /q x"), expect: 'deny', note: '★FIX4 自相矛盾点：空引号归一后与 C6 是同一条命令 → 必须同判 deny' },
  { id: 'F8  s..hutdown /s', payload: J("s''hutdown /s"), expect: 'deny', note: '★FIX4 自相矛盾点：归一后与 C16 同判 deny' },
  { id: 'F9  c..hmod 777 /x', payload: J("c''hmod 777 /x"), expect: 'deny', note: '★FIX4 自相矛盾点：归一后与 C17 同判 deny' },
  { id: 'F10 d..iskpart', payload: J("d''iskpart"), expect: 'deny', note: '空引号归一 → diskpart' },
  { id: 'F11 sh..red -u /tmp/t', payload: J("sh''red -u /tmp/t"), expect: 'deny', note: '空引号归一 → shred -u（与 C8 同判）' },
  { id: 'F12 un..link /tmp/t', payload: J("un''link /tmp/t"), expect: 'deny', note: '空引号归一 → unlink（与 C7 同判）' },
  { id: 'F13 f..ind /tmp -delete', payload: J("f''ind /tmp -delete"), expect: 'deny', note: '★FIX4 自相矛盾点：归一后与 C12 同判 deny' },
  { id: 'F14 d..el /f x', payload: J("d''el /f x"), expect: 'deny', note: '空引号归一 → del /f x' },
  { id: 'F15 e..rase x', payload: J("e''rase x"), expect: 'deny', note: '空引号归一 → erase x' },
  { id: 'F16 r..m -rf /tmp/t（反向守卫）', payload: J("r''m -rf /tmp/t"), expect: 'deny', note: '删除族反向守卫：归一不得放行' },
  { id: 'F17 R..emove-Item（反向守卫）', payload: J("R''emove-Item x"), expect: 'deny', note: 'Remove-Item 是删除族：归一后必须仍 deny' },
  { id: 'F18 g..it status（对照）', payload: J("g''it status"), expect: 'allow', note: '对照：归一后是安全命令 → allow（防「一律 deny」式过修）' },

  // ── H 段 H1–H12：**数组元素为对象**（R2 = fail-open 回归源）──────────────────────────
  // 机理：PowerShell 对「数组元素位 / 哈希值位的对象」渲染为**空串**（实测 `[{"a":1}]` → ""、
  //      `{"a":{"b":1}}` → "@{a=}"），**不是**类型名。G3 的 ps_elem(dict) 返回类型名字符串 →
  //      `command:[{"cmd":"rm -rf /tmp/t"}]` 得到非空串 → 绕过「command 为空 → deny」→ **fail-open**。
  // H5 就是 R2 的直接回归测试；H6 是同族的第二形态。
  { id: 'H1  command:[{"a":1}]', payload: T([{ a: 1 }]), expect: 'deny', note: '对象元素 → PS 串 "" → command 为空 → deny' },
  { id: 'H2  command:[{"a":1},{"b":2}]', payload: T([{ a: 1 }, { b: 2 }]), expect: 'deny', note: 'PS 串 " " → 纯空白 → deny' },
  { id: 'H3  command:[{"a":1},"x"]', payload: T([{ a: 1 }, 'x']), expect: 'allow', note: 'PS 串 " x" → 非空、无危险词 → allow' },
  { id: 'H4  command:{"a":{"b":1}}', payload: T({ a: { b: 1 } }), expect: 'allow', note: 'PS 串 "@{a=}"（嵌套对象渲染为空）' },
  { id: 'H5  command:[{"cmd":"rm -rf /tmp/t"}]', payload: T([{ cmd: 'rm -rf /tmp/t' }]), expect: 'deny', note: '★ R2 回归测试：G3 曾在此 fail-open（allow）' },
  { id: 'H6  command:[{"cmd":"git status"}]', payload: T([{ cmd: 'git status' }]), expect: 'deny', note: 'R2 同族：对象元素 → "" → deny（sh 曾 allow）' },
  { id: 'H7  command:1e2', payload: T(1e2), expect: 'allow', note: 'PS [string]1e2 = "100"（非 "100.0"）' },
  { id: 'H8  command:1e21', payload: T(1e21), expect: 'allow', note: 'PS [string]1e21 = "1E+21"' },
  { id: 'H9  command:1.0e-7', payload: T(1e-7), expect: 'allow', note: 'PS [string]1e-7 = "1E-07"' },
  { id: 'H10 command:[{"a":1},[1]]', payload: T([{ a: 1 }, [1]]), expect: 'allow', note: 'PS 串 " System.Object[]"' },
  { id: 'H11 command:{"a":1,"b":2}', payload: T({ a: 1, b: 2 }), expect: 'allow', note: 'PS 串 "@{a=1; b=2}"' },
  { id: 'H12 command:{"rm":"-rf"}', payload: T({ rm: '-rf' }), expect: 'allow', note: 'PS 串 "@{rm=-rf}"：值位不被当命令词' },

  // ── G 段 G1–G14：`-i` 之后「引号内文本恰好命中不敏感词」的锚点面（R3）────────────────
  // 机理：sh 的 shutdown(L489)/chmod(L494)/rm 引号变体(L509)/10b(L476) 前导锚曾含 `[:space:]`，
  //      而 ps1 L463/L468/L365/L370 只认 `(?:^|[;&|\r\n])\s*`。`-i` 把这类**潜伏锚点不一致**批量点着：
  //      `git commit -m "remove SHUTDOWN path"`（合法 commit message）由 allow 变 deny。G3-FIX4 对齐锚点。
  // G11/G12 是**两端同形残留**（ps1 与 sh 都 deny）：钉的是"两端一致"，不是"这样安全"——
  // 与 C15/T11 同一处理方式，登记为加固候选。
  { id: 'G1  commit -m "remove SHUTDOWN path"', payload: J('git commit -m "remove SHUTDOWN path"'), expect: 'allow', note: '★ R3：合法 commit message，曾被 -i 误拦' },
  { id: 'G2  commit -m "REBOOT fix"', payload: J('git commit -m "REBOOT fix"'), expect: 'allow', note: 'R3 邻' },
  { id: 'G3  commit -m "fix CHMOD docs"', payload: J('git commit -m "fix CHMOD docs"'), expect: 'allow', note: 'R3 邻（chmod 锚点）' },
  { id: 'G4  echo "please shutdown the server"', payload: J('echo "please shutdown the server"'), expect: 'allow', note: 'R3 邻' },
  { id: 'G5  echo "run chmod 777 /x"', payload: J('echo "run chmod 777 /x"'), expect: 'allow', note: 'R3 邻' },
  { id: 'G6  git log --grep="reboot"', payload: J('git log --oneline --grep="reboot"'), expect: 'allow', note: 'R3 邻' },
  { id: 'G7  commit -m "fix halt handling"', payload: J('git commit -m "fix halt handling"'), expect: 'allow', note: 'R3 邻' },
  { id: 'G8  cat shutdown.txt', payload: J('cat shutdown.txt'), expect: 'allow', note: 'R3 邻（ps1 尾锚 \\b 亦不命中）' },
  { id: 'G9  build && shutdown /s（反向守卫）', payload: J('npm run build && shutdown /s'), expect: 'deny', note: '分隔符后的 shutdown 必须仍拦' },
  { id: 'G10 echo hi; chmod 777 /x（反向守卫）', payload: J('echo hi; chmod 777 /x'), expect: 'deny', note: '分隔符后的 chmod 777 必须仍拦' },
  { id: 'G11 commit -m "drop RM -rf usages"', payload: J('git commit -m "drop RM -rf usages"'), expect: 'deny', note: '两端同形残留（非锚点类，L394 无锚点）：加固候选' },
  { id: 'G12 git log --grep="RM -rf"', payload: J('git log --grep="RM -rf"'), expect: 'deny', note: '两端同形残留：加固候选' },
  { id: 'G13 commit -m "shred the docs"', payload: J('git commit -m "shred the docs"'), expect: 'allow', note: 'R3 邻（unlink/shred 锚点）' },
  { id: 'G14 commit -m "update UNLINK docs"', payload: J('git commit -m "update UNLINK docs"'), expect: 'allow', note: 'R3 邻' },

  // ══════════════════════════════════════════════════════════════════════════════════
  // G3-FIX5 新增 K 段（K1–K32）：**sudo / 绝对路径前缀**面 + **既存分歧族**（Evaluator G3-FIX4 §4-A/§2.4d）
  // 机理：FIX4 的 M3 把 find/xargs/chmod 的前导锚对齐成 ps1 同形 `(?:^|[;&|\r\n])\s*`，而
  //   **两端都不认 `sudo` / `/usr/bin/` 前缀** → `sudo chmod 777 /x`、`sudo find /tmp -delete`、
  //   `/usr/bin/xargs rm`、`sudo'' shutdown /s` 由 deny 变 allow（其中 3 类在 pre-G3 冻结基线上**本来就是 deny**）。
  // G3-FIX5/A 的修法：两端同批把危险基座锚升级为**统一前缀**
  //   ps1 `(?:^|[;&|\r\n])\s*(?:sudo\s+)?(?:/[^\s;&|]*/)?` ／ sh `CMD_PRE='(^|[;&|])[[:space:]]*(sudo[[:space:]]+)?(/[^[:space:];&|]*/)?'`
  //   —— 方向恒为**向上对齐**（D12）：前缀形态由 allow → deny，两端同判。
  // 另含**既存分歧族**（pre-G3 即分歧，Evaluator §2.4d 实测 ≥12 条）：ps1 的 diskpart/rmdir/format
  //   规则原先**无前导锚**，sh 有锚 → 两端发散。本轮把 ps1 改成与 sh 同形的锚（取更严的**可辩护**一端：
  //   前缀形态 deny；`x <词>` / 引号内文本属**误伤形态** → 两端同判 allow，并在 note 里标注它不是「危险放松」）。
  // 变异敏感：把 A（统一前缀）或 B（全局归一）任一改回旧行为，本段与 F 段必红。
  // ══════════════════════════════════════════════════════════════════════════════════
  // ── A 面：sudo / sudo'' / 绝对路径 前缀 × 危险基座（12 条真实危险命令 + 1 条同族邻居）──
  { id: 'K1  sudo chmod 777 /x', payload: J('sudo chmod 777 /x'), expect: 'deny', note: '★FIX4 放松（pre-G3 即 deny）→ 本轮两端 deny' },
  { id: 'K2  sudo.. chmod 777 /x', payload: J("sudo'' chmod 777 /x"), expect: 'deny', note: '★空引号归一 → sudo chmod 777 /x' },
  { id: 'K3  /usr/bin/chmod 777 /x', payload: J('/usr/bin/chmod 777 /x'), expect: 'deny', note: '★绝对路径前缀 → 两端 deny（FIX4 前 sh 亦为 deny）' },
  { id: 'K4  sudo find /tmp -delete', payload: J('sudo find /tmp -delete'), expect: 'deny', note: '★FIX4 放松（pre-G3 即 deny）' },
  { id: 'K5  sudo.. find /tmp -delete', payload: J("sudo'' find /tmp -delete"), expect: 'deny', note: '★空引号归一后同 K4' },
  { id: 'K6  /usr/bin/find /tmp -delete', payload: J('/usr/bin/find /tmp -delete'), expect: 'deny', note: '★FIX4 放松（pre-G3 即 deny）' },
  { id: 'K7  sudo find /tmp -exec rm {} ;', payload: J('sudo find /tmp -exec rm {} ;'), expect: 'deny', note: '★FIX4 放松' },
  { id: 'K8  /usr/bin/find /tmp -exec rm {} ;', payload: J('/usr/bin/find /tmp -exec rm {} ;'), expect: 'deny', note: '★FIX4 放松' },
  { id: 'K9  sudo xargs rm < list.txt', payload: J('sudo xargs rm < list.txt'), expect: 'deny', note: '★FIX4 放松（pre-G3 即 deny）' },
  { id: 'K10 sudo.. xargs rm < list.txt', payload: J("sudo'' xargs rm < list.txt"), expect: 'deny', note: '★空引号归一后同 K9' },
  { id: 'K11 /usr/bin/xargs rm < list.txt', payload: J('/usr/bin/xargs rm < list.txt'), expect: 'deny', note: '★FIX4 放松' },
  { id: 'K12 sudo.. shutdown /s', payload: J("sudo'' shutdown /s"), expect: 'deny', note: '★FIX4 放松（pre-G3 即 deny）' },
  { id: 'K13 /usr/bin/shutdown /s', payload: J('/usr/bin/shutdown /s'), expect: 'deny', note: '同族邻居（绝对路径 + shutdown）' },
  { id: 'K14 sudo rm x', payload: J('sudo rm x'), expect: 'deny', note: 'A 面同族：sudo 前缀的 rm 亦拦（两端同批补前缀）' },
  // ── B 面：既存分歧族 sudo|x|/usr/bin/|sudo'' × diskpart / rmdir / format ──────────────
  { id: 'K15 sudo diskpart', payload: J('sudo diskpart'), expect: 'deny', note: '★既存分歧（ps1=deny/sh=allow）→ 本轮两端 deny' },
  { id: 'K16 sudo.. diskpart', payload: J("sudo'' diskpart"), expect: 'deny', note: '★既存分歧 → 两端 deny' },
  { id: 'K17 /usr/bin/diskpart', payload: J('/usr/bin/diskpart'), expect: 'deny', note: '★既存分歧 → 两端 deny' },
  { id: 'K18 x diskpart', payload: J('x diskpart'), expect: 'allow', note: '既存分歧的另一侧：`x` 不是可执行命令 → 两端同判 allow（**修正 ps1 的误伤**，非危险放松）' },
  { id: 'K19 sudo rmdir /s /q x', payload: J('sudo rmdir /s /q x'), expect: 'deny', note: '★既存分歧 → 两端 deny' },
  { id: 'K20 sudo.. rmdir /s /q x', payload: J("sudo'' rmdir /s /q x"), expect: 'deny', note: '★既存分歧 → 两端 deny' },
  { id: 'K21 /usr/bin/rmdir /s /q x', payload: J('/usr/bin/rmdir /s /q x'), expect: 'deny', note: '★既存分歧 → 两端 deny' },
  { id: 'K22 x rmdir /s /q x', payload: J('x rmdir /s /q x'), expect: 'allow', note: '`x` 不是可执行命令 → 两端同判 allow（修正误伤）' },
  { id: 'K23 sudo format C: /q', payload: J('sudo format C: /q'), expect: 'deny', note: '★既存分歧 → 两端 deny' },
  { id: 'K24 sudo.. format C: /q', payload: J("sudo'' format C: /q"), expect: 'deny', note: '★既存分歧 → 两端 deny' },
  { id: 'K25 /usr/bin/format C: /q', payload: J('/usr/bin/format C: /q'), expect: 'deny', note: '★既存分歧 → 两端 deny' },
  { id: 'K26 x format C: /q', payload: J('x format C: /q'), expect: 'allow', note: '`x` 不是可执行命令 → 两端同判 allow（修正误伤）' },
  { id: 'K27 commit -m "remove Diskpart usage"', payload: J('git commit -m "remove Diskpart usage"'), expect: 'allow', note: '★既存分歧根因：ps1 的 diskpart 规则原为无锚 → 引号内文本被误拦；本轮两端同判 allow' },
  { id: 'K28 commit -m "rmdir cleanup"', payload: J('git commit -m "rmdir cleanup"'), expect: 'allow', note: '过拦面：合法 commit message（ps1 要求 rmdir 带 /s 等标志）' },
  // ── C 面：sudo / 路径前缀不得误伤合法命令 ────────────────────────────────────────────
  { id: 'K30 commit -m "run chmod 777 in ci"', payload: J('git commit -m "run chmod 777 in ci"'), expect: 'allow', note: '过拦面：补前缀后仍 allow' },
  { id: 'K31 commit -m "note: xargs rm here"', payload: J('git commit -m "note: xargs rm here"'), expect: 'allow', note: '过拦面：xargs 规则补前缀后仍 allow' },
  { id: 'K32 diff <(git log) /tmp/f', payload: J('git diff --stat /usr/bin/README'), expect: 'allow', note: '过拦面：路径前缀只认「命令词位置」，参数里的 /usr/bin 不误伤' },
  // ── D 面：命令位包装前缀 cmd /c | command | env（把「无锚 → 有锚」丢掉的一类形态补回两端）──────
  { id: 'K33 cmd /c del /f C:\\x\\y', payload: J('cmd /c del /f C:\\x\\y'), expect: 'deny', note: '★ps1 五套之一 hook-bypass-regression 第 26 条的原始用例：锚点化后必须仍 deny' },
  { id: 'K34 cmd /c rmdir /s /q x', payload: J('cmd /c rmdir /s /q x'), expect: 'deny', note: '同上（rmdir 族）' },
  { id: 'K35 command diskpart', payload: J('command diskpart'), expect: 'deny', note: '同上（command 包装）' },
  { id: 'K36 env shutdown /s', payload: J('env shutdown /s'), expect: 'deny', note: '同上（env 包装）' },
  { id: 'K37 cmd /c npm test', payload: J('cmd /c npm test'), expect: 'allow', note: '过拦面：包装前缀不得误伤无危险基座的命令' },
  { id: 'K38 commit -m "command del docs"', payload: J('git commit -m "command del docs"'), expect: 'allow', note: '过拦面：包装词出现在参数/引号内不误伤' },
  // ── E 面（G3-FIX6/A 新增，K39–K56）：**包装词 / 子 shell / 块 / if-then / for-do 前缀** ─────────
  //   机理（Evaluator G3-FIX5 §3.1 的 REJECT 依据）：FIX5 把 ps1 三条规则（format/diskpart/del…rmdir）
  //   由**无锚**改为**命令位锚**，但 FIX5 的统一前缀里**只有 sudo** —— 于是
  //   `time|nice|nohup|setsid|doas|exec|ionice|busybox` 与 `(`/`{`/`then`/`do`/`else` 这一整类真实
  //   **可执行**形态在 ps1 端由 deny → allow（8 条回归；ps1 自 pre-G3 至 FIX4 逐字节未变 `fb85cc0e…`，
  //   故这是相对**冻结基线**的客观回归）。G3-FIX6/A：两端在**同一个** CMD_PRE 里补回包装词序列与
  //   子 shell/块锚 + `then|do|else`（放在**包装词位**的闭集里，见 L 段与 K57–K59 的过拦守卫）。
  { id: 'K39 time diskpart', payload: J('time diskpart'), expect: 'deny', note: '★FIX5 回归（ps1 allow）→ 两端 deny' },
  { id: 'K40 nice rmdir /s /q x', payload: J('nice rmdir /s /q x'), expect: 'deny', note: '★FIX5 回归（ps1 allow）→ 两端 deny' },
  { id: 'K41 nohup rmdir /s /q x', payload: J('nohup rmdir /s /q x'), expect: 'deny', note: '★FIX5 回归（ps1 allow）→ 两端 deny' },
  { id: 'K42 time format C: /q', payload: J('time format C: /q'), expect: 'deny', note: '★FIX5 回归（ps1 allow）→ 两端 deny' },
  { id: 'K43 (rmdir /s /q x)', payload: J('(rmdir /s /q x)'), expect: 'deny', note: '★FIX5 回归：子 shell 起始符不在 FIX5 的锚里' },
  { id: 'K44 { rmdir /s /q x; }', payload: J('{ rmdir /s /q x; }'), expect: 'deny', note: '★FIX5 回归：花括号组' },
  { id: 'K45 if true; then rmdir /s /q x; fi', payload: J('if true; then rmdir /s /q x; fi'), expect: 'deny', note: '★FIX5 回归：`then` 后是命令位' },
  { id: 'K46 for i in 1; do del x; done', payload: J('for i in 1; do del x; done'), expect: 'deny', note: '★FIX5 回归：`do` 后是命令位' },
  { id: 'K47 sudo time nice nohup diskpart', payload: J('sudo time nice nohup diskpart'), expect: 'deny', note: '包装词**嵌套**（D7 邻居）' },
  { id: 'K48 time /usr/bin/diskpart', payload: J('time /usr/bin/diskpart'), expect: 'deny', note: '路径 + 包装组合（D7 邻居）' },
  { id: 'K49 nohup shutdown /s', payload: J('nohup shutdown /s'), expect: 'deny', note: '包装词 × 系统关机族' },
  { id: 'K50 time find /tmp -delete', payload: J('time find /tmp -delete'), expect: 'deny', note: '包装词 × find -delete' },
  { id: 'K51 time xargs rm < list.txt', payload: J('time xargs rm < list.txt'), expect: 'deny', note: '包装词 × xargs rm' },
  { id: 'K52 { del x; }', payload: J('{ del x; }'), expect: 'deny', note: '块 × del' },
  { id: 'K53 (diskpart)', payload: J('(diskpart)'), expect: 'deny', note: '子 shell × diskpart' },
  { id: 'K54 if…then 换行形态', payload: J('if true\nthen rmdir /s /q x\nfi'), expect: 'deny', note: '换行也是命令位（ps1 `[;&|\\r\\n]` / sh 行首 `^`）' },
  { id: 'K55 for…do 换行形态', payload: J('for i in 1\ndo del x\ndone'), expect: 'deny', note: '同上' },
  { id: 'K56 then 后接包装词', payload: J('if x; then time rmdir /s /q x; fi'), expect: 'deny', note: '命令位保留词 + 包装词的组合' },
  // ── C 面续：**关键词不得被当成锚**（否则引号内散文 `do rm` 会变成新过拦）──────────────────
  { id: 'K57 commit -m "do rm docs"', payload: J('git commit -m "do rm docs"'), expect: 'allow', note: '★过拦守卫：`do` 是**命令位保留词**，只在分隔符/行首之后才算命令位' },
  { id: 'K58 echo "do rm"', payload: J('echo "do rm"'), expect: 'allow', note: '★过拦守卫：引号内散文不点着' },
  { id: 'K59 grep -r "then rmdir" .', payload: J('grep -r "then rmdir" .'), expect: 'allow', note: '★过拦守卫：同上（`then` 在引号内）' },
  // ── A 面（G3-FIX7/A 新增，K60–K68）：**`(` `{` 不放锚位** —— 引号内 / 散文里的括号不是命令位 ─────
  //   机理（Evaluator G3-FIX6 §4.1 的 REJECT 依据）：FIX6 把 `\(` `\{` 放进**命令位锚**，于是
  //   「文本里出现 `(` / `{` 就算命令位」——引号内/散文里的括号（含 `s/(rm -rf)/` 这种 `(` 前是 `/` 的，
  //   lookbehind 补 `["']` 也修不掉）被点着，9 条合法命令由 allow → deny（其中 `printf '{ diskpart }'`
  //   是验收清单点名的「零过拦」项）。G3-FIX7/A：`\(` `\{` 移入**可重复前缀项**（与 `then|do|else`
  //   的处置同构），锚位**只认** 行首 / 分隔符 / 换行。下列 9 条**两端必须 allow**。
  { id: 'K60 printf \'{ diskpart }\'', payload: J("printf '{ diskpart }'"), expect: 'allow', note: '★FIX6 过拦（ps1 deny / sh deny）→ 两端 allow；验收清单点名的合法命令' },
  { id: 'K61 echo "(diskpart)"', payload: J('echo "(diskpart)"'), expect: 'allow', note: '★FIX6 过拦 → 两端 allow（双引号内括号）' },
  { id: 'K62 echo "{ diskpart }"', payload: J('echo "{ diskpart }"'), expect: 'allow', note: '★FIX6 过拦 → 两端 allow（双引号内花括号）' },
  { id: 'K63 echo \'(rm -rf)\'', payload: J("echo '(rm -rf)'"), expect: 'allow', note: '★FIX6 过拦（ps1 deny）→ 两端 allow（单引号内括号）' },
  { id: 'K64 echo "(rm -rf /)"', payload: J('echo "(rm -rf /)"'), expect: 'allow', note: '★FIX6 过拦（ps1 deny）→ 两端 allow' },
  { id: 'K65 commit -m "fix (rm -rf)"', payload: J('git commit -m "fix (rm -rf)"'), expect: 'allow', note: '★FIX6 过拦（两端 deny）→ 两端 allow（commit message 里的括号）' },
  { id: 'K66 grep -r "(rm -rf)" .', payload: J('grep -r "(rm -rf)" .'), expect: 'allow', note: '★FIX6 过拦 → 两端 allow（grep 模式串里的括号）' },
  { id: 'K67 sed -n \'s/(rm -rf)/x/p\' f', payload: J("sed -n 's/(rm -rf)/x/p' f"), expect: 'allow', note: '★FIX6 过拦 → 两端 allow（`(` 前是 `/`，**lookbehind 补引号也修不掉**，只有「移出锚位」能修）' },
  { id: 'K68 ls (rm -rf)', payload: J('ls (rm -rf)'), expect: 'allow', note: '★FIX6 过拦 → 两端 allow（散文裸括号）' },
  // ── B 面（G3-FIX7/B 新增，K69–K82）：**包装词 ↔ cmd/command/env 必须可互串** ────────────────
  //   机理（Evaluator G3-FIX6 §9.4 登记项）：FIX6 的前缀是「包装词* → 路径 → (cmd|command|env)」的
  //   **固定顺序**，包装词与 command/env 不可交错 → 下列真实可执行形态落到前缀之外 = allow
  //   （相对冻结基线 pre-G3 是**放松**，D12 违规）。G3-FIX7/B：并为**同一个可重复组**（任意顺序、任意嵌套）。
  { id: 'K69 command time diskpart', payload: J('command time diskpart'), expect: 'deny', note: '★ps1 冻结基线 pre-G3=deny → FIX6=allow（放松）→ FIX7 两端 deny' },
  { id: 'K70 env nice diskpart', payload: J('env nice diskpart'), expect: 'deny', note: '★同上（ps1 pre-G3 deny → FIX6 allow）' },
  { id: 'K71 env sudo diskpart', payload: J('env sudo diskpart'), expect: 'deny', note: '★同上' },
  { id: 'K72 command cmd /c diskpart', payload: J('command cmd /c diskpart'), expect: 'deny', note: '★同上（`command` 后接 Windows 包装 `cmd /c`）' },
  { id: 'K73 command sudo diskpart', payload: J('command sudo diskpart'), expect: 'deny', note: '★同上' },
  { id: 'K74 env cmd /c diskpart', payload: J('env cmd /c diskpart'), expect: 'deny', note: '★同上' },
  { id: 'K75 command nohup rmdir /s /q x', payload: J('command nohup rmdir /s /q x'), expect: 'deny', note: '★同上（ps1 pre-G3 的 rmdir 命令位锚 = deny）' },
  { id: 'K76 env time rmdir /s /q x', payload: J('env time rmdir /s /q x'), expect: 'deny', note: '★同上' },
  { id: 'K77 sudo command time diskpart', payload: J('sudo command time diskpart'), expect: 'deny', note: '★同上（三层交错）' },
  { id: 'K78 command env diskpart', payload: J('command env diskpart'), expect: 'deny', note: '★同上' },
  { id: 'K79 env -i diskpart', payload: J('env -i diskpart'), expect: 'deny', note: '★`env` 带**选项**的真实形态（ps1 pre-G3 无锚 `\\bdiskpart\\b` = deny → FIX6 allow）；FIX7 按真实形态收进闭集' },
  { id: 'K80 env VAR=1 diskpart', payload: J('env VAR=1 diskpart'), expect: 'deny', note: '★`env` 带**赋值参数**的真实形态（同上）；这是**向上**新增拦截，不是放松' },
  { id: 'K81 /usr/bin/env diskpart', payload: J('/usr/bin/env diskpart'), expect: 'deny', note: '顺序固定时已覆盖 —— 作守卫：互串修法**不得**把它改回 allow' },
  { id: 'K82 command env -i time diskpart', payload: J('command env -i time diskpart'), expect: 'deny', note: '四种前缀项交错嵌套（D7 邻居）' },
  // ── B 面反向守卫（G3-FIX7/B）：放宽只到「闭集可重复」，**不得**变成「任意单词」──────────────
  { id: 'K83 x diskpart（反向守卫）', payload: J('x diskpart'), expect: 'allow', note: '★`x` 不是命令 → 必须仍 allow（B 面修法的边界）' },
  { id: 'K84 x command diskpart（反向守卫）', payload: J('x command diskpart'), expect: 'allow', note: '★同上：`x` 不在闭集里' },
  { id: 'K85 commit -m "env nice diskpart"', payload: J('git commit -m "env nice diskpart"'), expect: 'allow', note: '★引号内散文：互串闭集不得点着引号内文本' },
  { id: 'K86 timeout diskpart（反向守卫）', payload: J('timeout diskpart'), expect: 'allow', note: '★包装词必须整词匹配（`time` ⊄ `timeout`），否则「闭集可重复」会滑向「任意单词」' },
  { id: 'K87 sudorm --help（反向守卫）', payload: J('sudorm --help'), expect: 'allow', note: '★同上（`sudo` ⊄ `sudorm`）。⚠️ 注意 `sudorm -rf /tmp/t` **不入本语料**：sh 的既有裸 `rm -rf` 规则（L512，无命令位锚，FIX4 起）会 deny，ps1 allow —— 既存两端分歧，不作闸门断言' },
  // ── C 面（G3-FIX8/A 新增，K88–K99）：**包装词自身的选项**必须落在命令位前缀之内 ──────────────
  //   机理（源卡 FIX_BRIEF_G3-FIX8 §1）：FIX7 的前缀只认「包装词 + 空白」，于是包装词**自身选项**
  //   （`sudo -u root` / `nice -n 5` / `ionice -c 3` / `doas -u root` / `exec -a name` / `time -p`）
  //   把命令词推离命令位 → 两端 allow；而 **pre-G3 ps1 本来就 deny**（其规则无命令位锚），
  //   故这是 D12 意义上的**放松残留**（FIX5 锚化时丢失，FIX6 只收回「裸包装词」子情形）。
  //   修法：在包装词分支后消费**该包装词自身**的选项族 —— 吃参选项用 `-[A-Za-z]\s+tok`，
  //   不吃参用 `-[p]`/`-[inEpvcutlf]`，`--` 作选项终止符；**不得**写成「吃掉任意 token」。
  //   K95–K99 是反向守卫：选项后跟安全命令 / 引号内散文 / 未知选项 / 非本包装词的选项。
  { id: 'K88 sudo -u root diskpart', payload: J('sudo -u root diskpart'), expect: 'deny', note: '★FIX7 放松（ps1 pre-G3=deny → FIX7 两端 allow）→ 本轮两端 deny' },
  { id: 'K89 sudo -n diskpart', payload: J('sudo -n diskpart'), expect: 'deny', note: '★同上（`-n` 是非交互短选项，不吃参）' },
  { id: 'K90 sudo -u root rmdir /s /q x', payload: J('sudo -u root rmdir /s /q x'), expect: 'deny', note: '★同上（删除族 + 包装词选项）' },
  { id: 'K91 nice -n 5 diskpart', payload: J('nice -n 5 diskpart'), expect: 'deny', note: '★同上（`-n <N>` 吃参）' },
  { id: 'K92 ionice -c 3 diskpart', payload: J('ionice -c 3 diskpart'), expect: 'deny', note: '★同上（`-c <class>` 吃参）' },
  { id: 'K93 doas -u root diskpart', payload: J('doas -u root diskpart'), expect: 'deny', note: '★同上（`-u <user>` 吃参）' },
  { id: 'K94 exec -a name diskpart', payload: J('exec -a name diskpart'), expect: 'deny', note: '★同上（`-a <name>` 吃参）' },
  { id: 'K95 time -p diskpart', payload: J('time -p diskpart'), expect: 'deny', note: '★同上（`-p` 不吃参，但 `time -p diskpart` 里 `diskpart` 仍是命令词）' },
  { id: 'K96 sudo --user=root diskpart', payload: J('sudo --user=root diskpart'), expect: 'deny', note: '★同上（`--long=value` 形态：由 `-[A-Za-z]\\s+tok` 分支兜住）' },
  { id: 'K97 sudo -u root ls diskpart（反向守卫）', payload: J('sudo -u root ls diskpart'), expect: 'allow', note: '★选项后是**安全命令**：`ls` 才是命令词，`diskpart` 是它的实参 —— 修法不得吃掉任意 token' },
  { id: 'K98 nice -n 5 cat file（反向守卫）', payload: J('nice -n 5 cat file'), expect: 'allow', note: '★同上（无危险基座 → 必须仍 allow）' },
  { id: 'K99 sudo -u root x diskpart（反向守卫）', payload: J('sudo -u root x diskpart'), expect: 'allow', note: '★`x` 不是命令词：选项消费后仍必须停在「非命令位」语义上' },
  // ── C 面续（G3-FIX8/R3 新增，K100–K116）：**REJECT 的两条放松面** ───────────────────────────
  //   ① 多行 rm 豁免漏洞（sh 单端）：FIX8 一度把 rm 实参抽取式写成「无 -n 的 sed -E」→ **每一行**都被
  //      打印，`head -1` 取到首行的豁免词 → 「`rm --help` + 换行 + 真删除」被放行（ps1 一直是 deny）。
  //      修法：取**全部匹配行**的实参，只要有一条不是 help/version 形态就 deny（= ps1 的调用点前瞻语义）。
  //      下列 K100–K108 是 Evaluator 点名的 9 条（含 8 种写法）。
  //   ② `env` 长选项被收窄（**两端**）：FIX8 一度把 env 分支写成 `-[uCS] tok | -[in0v] | VAR=v`，
  //      丢掉 `--[a-z-]+` → `env --ignore-environment diskpart` 由 FIX7 的 **deny/deny** 退回 allow。
  //      修法：env/command 分支**逐字回到 FIX7 形态**（前缀语言 ⊇ FIX7 ⇒ 不可能产生 deny→allow）。
  //   ③ K109–K116 是**守卫**：长选项后跟安全命令、纯豁免形态、多行但无真删除。
  { id: 'K100 rm --help 首行 + 换行 + 真删除', payload: J('rm --help\nrm /tmp/t'), expect: 'deny', note: '★REJECT R2：sh 曾 allow（首行豁免掩蔽次行真删除）→ 两端 deny' },
  { id: 'K101 裸 --help 首行 + 换行 + 真删除', payload: J('--help\nrm /tmp/t'), expect: 'deny', note: '★REJECT R2（Evaluator 原始形态之一）' },
  { id: 'K102 裸 -h 首行 + 换行 + 真删除', payload: J('-h\nrm /tmp/t'), expect: 'deny', note: '★同上' },
  { id: 'K103 裸 -v 首行 + 换行 + 真删除', payload: J('-v\nrm /tmp/t'), expect: 'deny', note: '★同上（`-v` 在小写化后等同版本标志，必须由「任一行非豁免」兜住）' },
  { id: 'K104 裸 --version 首行 + 换行 + 真删除', payload: J('--version\nrm /tmp/t'), expect: 'deny', note: '★同上' },
  { id: 'K105 首行 echo rm --help + 换行 + 真删除', payload: J('echo rm --help\nrm /tmp/t'), expect: 'deny', note: '★同上（首行含豁免词但不是命令位）' },
  { id: 'K106 --help 首行 + 换行 + sudo 真删除', payload: J('rm --help\nsudo rm /tmp/t'), expect: 'deny', note: '★同上（次行带 CMD_PRE 前缀）' },
  { id: 'K107 --version 首行 + 换行 + 真删除带后续语句', payload: J('rm --version\nrm /tmp/t; ls'), expect: 'deny', note: '★同上（次行有分隔符）' },
  { id: 'K108 --help 首行 + 换行 + 绝对路径真删除', payload: J('rm --help\n/usr/bin/rm /tmp/t'), expect: 'deny', note: '★同上（绝对路径前缀）' },
  { id: 'K109 env --ignore-environment diskpart', payload: J('env --ignore-environment diskpart'), expect: 'deny', note: '★REJECT R1：FIX7/HEAD 两端本为 deny，FIX8 一度收窄 env 长选项 → allow；本轮逐字回到 FIX7 形态' },
  { id: 'K110 env --unset=FOO diskpart', payload: J('env --unset=FOO diskpart'), expect: 'deny', note: '★同上（`--long=value` 形态）' },
  { id: 'K111 env --ignore-environment ls（守卫）', payload: J('env --ignore-environment ls'), expect: 'allow', note: '★长选项后是安全命令 → 必须 allow（防「长选项一律吃参」）' },
  { id: 'K112 env --ignore-environment ls diskpart（守卫）', payload: J('env --ignore-environment ls diskpart'), expect: 'allow', note: '★同上（`diskpart` 是 `ls` 的实参）' },
  { id: 'K113 env -i ls diskpart（守卫）', payload: J('env -i ls diskpart'), expect: 'allow', note: '★FIX7 既有守卫：`-i` 不吃参' },
  { id: 'K114 env VAR=1 ls（守卫）', payload: J('env VAR=1 ls'), expect: 'allow', note: '★赋值形态后接安全命令' },
  { id: 'K115 rm --help 首行 + 换行 + 安全命令（守卫）', payload: J('rm --help\nls -la'), expect: 'allow', note: '★多行但无真删除 → 豁免仍生效' },
  { id: 'K116 ls -la 首行 + 换行 + rm --help（守卫）', payload: J('ls -la\nrm --help'), expect: 'allow', note: '★同上（豁免在第二行）' },
  // ── C 面续（G3-FIX8/R2 新增，K117–K121）：**逐包装词的选项族**（防「吃掉任意 token」）──────────
  //   修法从「单一泛化族 `-<任意字母> <操作数>`」改为**逐包装词**列确凿吃参的短选项：
  //     sudo `[ugpCUrthDRT]`+不吃参 `[bEHikKlnsPvAe]`；time `[fo]`+`[apv]`；nice `[n]`；
  //     ionice `[cnpP]`+`[tu]`；doas `[uC]`+`[ns]`；exec `[a]`+`[cl]`。
  //   于是：`-n` 对 sudo 不吃参（`sudo -n diskpart` 仍 deny）而对 nice 吃参（`nice -n 5 diskpart` 仍 deny）；
  //   `-v`/`-p` 对 sudo/time 不吃参 → **不会**把后面的安全命令误当操作数。
  { id: 'K117 time -p ls diskpart（守卫）', payload: J('time -p ls diskpart'), expect: 'allow', note: '★`-p` 对 time 不吃参 → `ls` 才是命令词（修掉上一版 `-[p]` 可选操作数造成的收窄）' },
  { id: 'K118 sudo -v ls diskpart（守卫）', payload: J('sudo -v ls diskpart'), expect: 'allow', note: '★`-v` 对 sudo 不吃参 → 不得把 `ls` 当操作数（泛化族会误拦）' },
  { id: 'K119 sudo -b diskpart', payload: J('sudo -b diskpart'), expect: 'deny', note: '★`-b` 是 sudo 的不吃参选项 → 消费后 `diskpart` 仍是命令词' },
  { id: 'K120 doas -n diskpart', payload: J('doas -n diskpart'), expect: 'deny', note: '★`-n` 是 doas 的不吃参选项（同族的 `nice -c 3 diskpart` 走 allow：`-c` 不是 nice 的）' },
  { id: 'K121 nice -c 3 diskpart（守卫）', payload: J('nice -c 3 diskpart'), expect: 'allow', note: '★非本包装词的选项**不得**被消费（与 FIX7 同判，防「吃掉任意 token」）' },
  // ── M 段（G24 新增，M1–M15）：**help/version 豁免的粒度** ─────────────────────────────────
  //   缺陷（G24）：ps1 rule 16 的豁免写成 `-and ($cmd -notmatch $CMD_PRE + 'rm\s+(--help|…)')`
  //   —— `-notmatch` 作用于**整个 $cmd**，于是命令里**任意位置**出现一次 `rm --help`，
  //   就把整条命令的 rule 16 关掉。G24 修复把豁免收成 `rm` 之后的**调用点前瞻**
  //   `rm(?!\s+(?:-h|--help|--version|-V)\b)`：只对「紧跟 help/version 的那次调用」免检。
  //   ⚠️ 修法**不得**滑向「取消豁免」：M10–M15 是反向守卫（纯 help 调用必须仍 allow）。
  { id: 'M1  rm --help 掩盖真删除', payload: J('rm --help; rm /tmp/t'), expect: 'deny', note: '★G24：旧 ps1=allow（整条命令级抑制）/ sh=deny → 修后两端 deny' },
  { id: 'M2  rm -h 掩盖真删除', payload: J('rm -h; rm /tmp/t'), expect: 'deny', note: '★同上（豁免的第二个标志）' },
  { id: 'M3  rm --version 掩盖真删除', payload: J('rm --version; rm /tmp/t'), expect: 'deny', note: '★同上（--version 分支）' },
  { id: 'M4  rm -V 掩盖真删除', payload: J('rm -V; rm /tmp/t'), expect: 'deny', note: '★同上（-V 分支）' },
  { id: 'M5  rm --help && 真删除', payload: J('rm --help && rm /tmp/t'), expect: 'deny', note: '★同上（`&&` 分隔，非 `;`）' },
  { id: 'M6  echo; rm --help; 真删除', payload: J('echo hi; rm --help; rm /tmp/t'), expect: 'deny', note: '★同上（help 在中间，两侧都有语句）' },
  { id: 'M7  sudo rm --help 掩盖真删除', payload: J('sudo rm --help; rm /tmp/t'), expect: 'deny', note: '★同上（豁免侧带 CMD_PRE 前缀；防「只豁免裸 rm」的写法把这条改回 allow）' },
  { id: 'M8  rm\'\' --help 掩盖真删除', payload: J("rm'' --help; rm /tmp/t"), expect: 'deny', note: '★同上（空引号归一后仍须按调用点豁免，与 Q1/Q2/C6 同源）' },
  { id: 'M9  绝对路径 rm --help 掩盖真删除', payload: J('/usr/bin/rm --help; rm /tmp/t'), expect: 'deny', note: '★同上（绝对路径前缀）' },
  { id: 'M10 纯 rm --help', payload: J('rm --help'), expect: 'allow', note: '反向守卫：单次 help 调用必须仍 allow（不得用「取消豁免」来过拦）' },
  { id: 'M11 纯 rm -h', payload: J('rm -h'), expect: 'allow', note: '反向守卫（短标志）' },
  { id: 'M12 纯 rm --version', payload: J('rm --version'), expect: 'allow', note: '反向守卫（version 分支）' },
  { id: 'M13 纯 rm -V', payload: J('rm -V'), expect: 'allow', note: '反向守卫（大小写不敏感）' },
  { id: 'M14 sudo rm --help', payload: J('sudo rm --help'), expect: 'allow', note: '反向守卫：豁免前瞻必须与 CMD_PRE **同前缀**，否则 `sudo rm --help` 由 allow 变误拦' },
  { id: 'M15 绝对路径 rm --help', payload: J('/usr/bin/rm --help'), expect: 'allow', note: '反向守卫（同上，绝对路径前缀）' },
];

/**
 * ── L 段：**跨端身份断言**语料（G3-FIX6/A 新增）──────────────────────────────────────────
 * 为什么单列：主测试把「两端同判」与「等于应然」合在一个断言里，任一端悄悄漂移时，失败原因容易被
 * 误读成「应然写错了」。本段只钉**身份**：**不管应然是什么，两端 decision 必须逐条一致**。
 * 成对设计（D7 邻居）：每条「命令位」形态都配一条只差一个词的「非命令位」邻居（`x` 前缀 / 引号内 /
 * 参数位），两条的应然**相反**：
 *   · 若把命令位前缀放宽成「任意单词」→ 两条一起 deny（**新过拦**）；
 *   · 若把前缀收窄回 FIX5 → 两条一起 allow（**回归**）。
 * 故本段同时对「过拦」与「放松」两个方向敏感，且与应然表相互独立。
 * 已知**不入语料**的两端残留（保留分歧并如实登记，见 IMPLEMENTATION_RESULT_G3-FIX6 §未解决问题）：
 *   `rmdir <无标志路径>` 与 `time rmdir <无标志路径>`（sh deny / ps1 allow：POSIX 与 Windows 语义冲突，
 *   两端各有测试套件钉住——ps1 `hook-fp-regression.ps1` 第 5 条把 `rmdir /tmp/empty_dir` 钉成 allow）。
 */
export const IDENTITY_CORPUS: DecisionCase[] = [
  { id: 'L1  命令位 time diskpart', payload: J('time diskpart'), expect: 'deny', note: '与 L2 成对（只差一个非命令词）' },
  { id: 'L2  非命令位 x diskpart', payload: J('x diskpart'), expect: 'allow', note: '反向守卫' },
  { id: 'L3  命令位 nohup rmdir /s /q x', payload: J('nohup rmdir /s /q x'), expect: 'deny', note: '与 L4 成对' },
  { id: 'L4  非命令位 x rmdir /s /q x', payload: J('x rmdir /s /q x'), expect: 'allow', note: '反向守卫' },
  { id: 'L5  命令行 { del x; }', payload: J('{ del x; }'), expect: 'deny', note: '与 L6 成对' },
  { id: 'L6  非命令词 x del x', payload: J('x del x'), expect: 'allow', note: '反向守卫' },
  { id: 'L7  if…then 命令位', payload: J('if true; then rmdir /s /q x; fi'), expect: 'deny', note: '与 L8 成对' },
  { id: 'L8  引号内 then rmdir', payload: J('git commit -m "then rmdir /s /q"'), expect: 'allow', note: '反向守卫（`then` 在引号内不是命令位）' },
  { id: 'L9  for…do 命令位', payload: J('for i in 1; do del x; done'), expect: 'deny', note: '与 L10 成对' },
  { id: 'L10 引号内 do del', payload: J('git commit -m "do del files"'), expect: 'allow', note: '反向守卫' },
  { id: 'L11 命令位 time format C: /q', payload: J('time format C: /q'), expect: 'deny', note: '与 L12 成对' },
  { id: 'L12 非命令位 x format C: /q', payload: J('x format C: /q'), expect: 'allow', note: '反向守卫' },
  { id: 'L13 包装词嵌套（全包装）', payload: J('sudo time nice nohup diskpart'), expect: 'deny', note: '与 L14 成对' },
  { id: 'L14 包装词嵌套后接非命令词', payload: J('sudo time nice nohup x diskpart'), expect: 'allow', note: '反向守卫：`x` 不是命令，nohup 会执行 `x` 而非 diskpart' },
  { id: 'L15 子 shell 命令位', payload: J('(rmdir /s /q x)'), expect: 'deny', note: '与 L16 成对' },
  { id: 'L16 参数位 rmdir', payload: J('echo "rmdir /s /q x"'), expect: 'allow', note: '反向守卫：echo 后是文本' },
  // G3-FIX7/A 新增两对：**同一个 `(` / `{`，前面是锚/包装词 → deny；前面是普通词/引号 → allow**
  { id: 'L17 块命令位 { rmdir /s /q x; }', payload: J('{ rmdir /s /q x; }'), expect: 'deny', note: '与 L18 成对（同一载荷只差「是否被引号包住」）' },
  { id: 'L18 引号内花括号 printf', payload: J("printf '{ rmdir /s /q x }'"), expect: 'allow', note: '反向守卫：引号内 `{` 不是命令位（FIX7 修法的边界）' },
  { id: 'L19 子 shell + 嵌套块', payload: J('if true; then (rmdir /s /q x); fi'), expect: 'deny', note: '与 L20 成对（`;` 锚 + `then ` 包装 + `(`）' },
  { id: 'L20 grep 模式串内括号', payload: J('grep -r "(rmdir /s /q x)" .'), expect: 'allow', note: '反向守卫：`(` 前面不是锚也不是包装词' },
  // G3-FIX8/A 新增两对：**包装词自身选项**消费后，命令位是否仍在
  { id: 'L21 包装词选项 + 命令位', payload: J('sudo -u root diskpart'), expect: 'deny', note: '与 L22 成对（同一前缀，只差命令词后是否有安全命令）' },
  { id: 'L22 包装词选项 + 参数位', payload: J('sudo -u root ls diskpart'), expect: 'allow', note: '反向守卫：选项消费后 `ls` 才是命令词，`diskpart` 是它的实参' },
  // G3-FIX8/R3 新增一对：**多行 rm 豁免的粒度**
  { id: 'L23 多行首行豁免 + 次行真删除', payload: J('rm --help\nrm /tmp/t'), expect: 'deny', note: '与 L24 成对（同一首行，只差次行是否有真删除）' },
  { id: 'L24 多行首行豁免 + 次行安全', payload: J('rm --help\nls -la'), expect: 'allow', note: '反向守卫：豁免只在「它自己那次调用」上生效，但不得因换行而误拦' },
];

/** 拼一行可读的失败明细（载荷 / ps1 / sh / 期望） */
function row(c: DecisionCase, p: string, s: string, why: string): string {
  return [
    `  ${c.id}`,
    `    载荷 = ${c.payload}`,
    `    ps1  = ${p}`,
    `    sh   = ${s}`,
    `    期望 = ${c.expect}${c.note ? `   （${c.note}）` : ''}`,
    `    判定 = ${why}`,
  ].join('\n');
}

function toWslPath(p: string): string {
  const m = /^([A-Za-z]):[\\/](.*)$/.exec(p);
  if (!m) return p;
  return `/mnt/${m[1].toLowerCase()}/${m[2].replace(/\\/g, '/')}`;
}

function which(cmd: string, args: string[]): boolean {
  const r = spawnSync(cmd, args, { encoding: 'utf8' });
  return !r.error && r.status === 0;
}

/**
 * 跑一端：真实 spawn + **进程 stdin**（D6）。
 * ⚠️ 必须是**逐条串行**的 `spawnSync`：G3 实测把 8 组 ps1+wsl 并发（`spawn` + 并发池）时，
 *    `wsl.exe` 会间歇性在 stdout 吐出非 JSON 的实例告警 → 被误判成 INVALID-JSON（21/66 假红），
 *    且总耗时并未下降（Windows 进程创建互相拖慢）。串行版稳定 66/66，故此处不做并发优化。
 * 返回 decision 或诊断串（INVALID-JSON / SPAWN-ERR / EXIT-n / TIMEOUT）。
 */
function runEnd(bin: string, args: string[], payload: string): string {
  const r = spawnSync(bin, args, { input: payload, encoding: 'utf8', timeout: 120000, maxBuffer: 16 * 1024 * 1024 });
  if (r.error) return `SPAWN-ERR(${(r.error as Error).message.slice(0, 60)})`;
  return decisionOf(r.stdout ?? '', r.status);
}

/** 把 hook 的 stdout/exit 归一成 decision 或诊断串 */
function decisionOf(stdout: string, code: number | null): string {
  const out = stdout.trim();
  // CC hook 协议：exit 0 + 无输出 = 放行
  if (!out) return code === 0 ? 'allow' : `EXIT-${code}`;
  let parsed: { permissionDecision?: string; hookSpecificOutput?: { permissionDecision?: string } };
  try {
    parsed = JSON.parse(out) as typeof parsed;
  } catch {
    return 'INVALID-JSON';
  }
  const d = parsed.hookSpecificOutput?.permissionDecision ?? parsed.permissionDecision;
  return d === 'deny' ? 'deny' : d === 'allow' ? 'allow' : 'NO-DECISION';
}

test('decision parity: ps1 与 sh 对同一语料的 permissionDecision 必须逐条一致且等于应然', { timeout: 1800000 }, (t) => {
  const ps1Hook = process.env.RG_PARITY_PS1 || DEFAULT_PS1;
  const shHook = process.env.RG_PARITY_SH || DEFAULT_SH;
  // 路径写错时必须**响亮失败**（否则 powershell 打 banner、bash 静默 exit 127，表现为莫名其妙的"不一致"）
  assert.ok(existsSync(ps1Hook), `ps1 hook 不存在: ${ps1Hook}`);
  assert.ok(existsSync(shHook), `sh hook 不存在: ${shHook}`);

  const hasPs1 = which('powershell.exe', ['-NoProfile', '-Command', 'exit 0']);
  const hasSh = which('wsl.exe', ['-e', 'bash', '-lc', 'exit 0']);
  if (!hasPs1) t.diagnostic('SKIP ps1 端：本机无 powershell.exe');
  if (!hasSh) t.diagnostic('SKIP sh 端：本机无 wsl/bash');
  if (!hasPs1 || !hasSh) return t.skip('两端之一不可用，无法做判定 parity（本机 Windows+WSL 两端均可用）');

  const ps1Args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ps1Hook];
  const shArgs = ['-e', 'bash', toWslPath(shHook)];

  const rows: string[] = [];
  for (const c of DECISION_CORPUS) {
    const p = runEnd('powershell.exe', ps1Args, c.payload);
    const s = runEnd('wsl.exe', shArgs, c.payload);
    if (p === s && p === c.expect) continue;
    const why = p !== s ? '两端分歧' : p !== c.expect ? '两端同判但不符合应然语义' : '输出不可判读（非法 JSON / 非 0 退出）';
    rows.push(row(c, p, s, why));
  }
  assert.equal(
    rows.length,
    0,
    `跨端判定不一致（共 ${rows.length} / ${DECISION_CORPUS.length} 条）:\n${rows.join('\n')}\n`,
  );
});

/**
 * ── G3-FIX6/A：**跨端身份断言**（独立红线）────────────────────────────────────────────
 * 与上一个 test 的区别：本测试**不看应然**，只断言「同一批命令位/非命令位语料，两端 decision 一致」。
 * 这是任务卡 §1「闸门加一条跨端身份断言」的落地：即便将来有人只改一端的前缀（另一端忘记同步），
 * 只要本段语料里任一条两端不同判，本测试即红——把「单端漂移」从"要等 Evaluator 扫全量才发现"
 * 变成"提交前必红"。
 */
test('cross-end identity: 命令位/非命令位语料两端 decision 必须逐条一致', { timeout: 1800000 }, (t) => {
  const ps1Hook = process.env.RG_PARITY_PS1 || DEFAULT_PS1;
  const shHook = process.env.RG_PARITY_SH || DEFAULT_SH;
  assert.ok(existsSync(ps1Hook), `ps1 hook 不存在: ${ps1Hook}`);
  assert.ok(existsSync(shHook), `sh hook 不存在: ${shHook}`);
  const hasPs1 = which('powershell.exe', ['-NoProfile', '-Command', 'exit 0']);
  const hasSh = which('wsl.exe', ['-e', 'bash', '-lc', 'exit 0']);
  if (!hasPs1 || !hasSh) return t.skip('两端之一不可用，无法做身份断言');

  const ps1Args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ps1Hook];
  const shArgs = ['-e', 'bash', toWslPath(shHook)];

  const rows: string[] = [];
  for (const c of IDENTITY_CORPUS) {
    const p = runEnd('powershell.exe', ps1Args, c.payload);
    const s = runEnd('wsl.exe', shArgs, c.payload);
    if (p === s) continue;
    rows.push(row(c, p, s, '两端分歧（身份断言失败：某一端的前缀漂移了）'));
  }
  assert.equal(
    rows.length,
    0,
    `跨端身份断言失败（共 ${rows.length} / ${IDENTITY_CORPUS.length} 条）:\n${rows.join('\n')}\n`,
  );
});
