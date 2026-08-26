# M7 模糊测试攻防档案（2026-08-24）

来源：`packages/core/test/classify-fuzz.test.ts`（确定性 PRNG，种子固定）
配合 `path-junction.test.ts`（D3 实测）。每一轮块：绕过向量 → 修复 → 锁定测试。

## 1. `shred;` 命令分隔符后缀

- **绕过**：`shred; rm backup` —— `shred` 后跟 `;` 分隔而非空格，原正则 `\bunlink|shred\s+` 要求 `shred` 后必跟空白，分号形式漏网。
- **修复**：`/\b(shred|unlink)\b\s*/` —— 词边界 + 可选空白，不再要求后缀形状。
- **锁定**：`classify-fuzz` 破坏性不变量循环 + adversarial corpus「shred 分号分隔」。

## 2. `Path.unlink('...')` 无 pathlib 前缀

- **绕过**：`python -c "from pathlib import Path; Path('f').unlink()"` —— 常见 `from pathlib import Path` 导入后用类名直接调用，原正则只匹配 `pathlib.*\.unlink`，`Path.unlink` 漏网。
- **修复**：`(?:pathlib\.)?(?:pure)?path\.unlink` —— 允许裸 `Path.`/`PurePath.` 前缀。
- **锁定**：`classify-fuzz` + corpus「Path.unlink 无前缀」。

## 3. `unlink <参数后缀>`

- **绕过**：`unlink config.old` —— `unlink` 后跟空格参数，原正则 `\b(shred|unlink)\s*([;&|].*)?$` 锚定 `$`，带参数后缀时不匹配。
- **修复**：与 1 同一正则（去 `$` 锚定）。
- **锁定**：`classify-fuzz` + corpus「unlink 带参数后缀」。

## 4. junction 逃逸（行为级，非正则）

- **绕过**：workspace 内 junction 指向外部目录，`rm -rf workspace/link/x` 字符串级 canonical 判定为「workspace 内」，实际删除外部文件（T10）。
- **修复**：`resolveReal()`（fs.realpath）+ DSH pre-execute 内 `checkJunctionEscape`（删除命令目标 realpath 逃出 workspace 根 → deny）。
- **锁定**：`path-junction.test.ts`（D3 实测：字符串级误判 true → realpath 级 false）+ `dsh-plugin.test.ts` 逃逸用例。

## 5. 附：`fs.rmSync &&` 无括号（判定为合理不拦）

- fuzz 曾报 `fs.rmSync && /tmp/x` 漏网——但 `fs.rmSync` 无括号不构成 JS 调用，判定 null 合理（避免过度拦截），不作为缺陷。语料 FN 形状已限定带括号。

## 累积效果

- normalize.ts 修复 3 处（shred/unlink、Path.unlink、`.Delete` 短名大小写）；
- 语料 32 → 35 条（新增 fuzz 闭环 3 条）；
- 全套 80/80 测试通过后最终回归稳定。