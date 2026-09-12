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
 *
 * ⚠️ 本闸门只钉「两端逐字同判 + 等于应然」。**不得**为了让它变绿而放宽 deny 语义（红线 §5.6/D12）：
 *    若某条真的两端分歧且短期无法收敛，正确做法是**保留分歧并如实登记**，而不是把它钉成 allow。
 *    当前已知的此类残留（**不入语料**，见 IMPLEMENTATION_RESULT_G3-FIX5 §未解决问题）：
 *      `rmdir <无标志路径>`（sh deny / ps1 allow，POSIX 与 Windows 语义冲突，两端各有测试套件钉住）、
 *      `echo "Format-Volume guide"`（sh 的 rule 17 读未剥离 echo 的原文 → deny / ps1 allow）。
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
// HERE = <ws>/agent-risk-guard/packages/core/test → 四层上溯到 <ws>，再进 agent-risk-guard-audit
const DEFAULT_PS1 = resolve(HERE, '../../../../agent-risk-guard-audit/scripts/dangerous-commands.ps1');
const DEFAULT_SH = resolve(HERE, '../../../../agent-risk-guard-audit/scripts/dangerous-commands.sh');

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
