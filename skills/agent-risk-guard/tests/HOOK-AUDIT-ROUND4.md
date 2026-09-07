# RiskGuard PreToolUse 门禁脚本 — 第四轮独立对抗审查报告

> **审查员角色**：独立对抗审查员（GAN 式判别器，验证第三轮修复落地）  
> **审查日期**：2026-08-21  
> **审查目标**：`dangerous-commands.ps1`（与 `dangerous-commands-universal.ps1` 规则同步）  
> **审查方法**：独立运行 42+ 测试用例，逐条验证第三轮报告中的每个待修复项  
> **前轮评分**：7 / 10  
> **本轮评分**：**8 / 10**

---

## 总体评价

开发方在第三轮修复中表现出高度执行力：第三轮报告列出的 6 项修复目标**全部真实落地**，包括最棘手的 echo 误伤全面修复（规则 9/13/33 改用 `$cmdTest`）和 `--force-with-lease` 锚定修复。修复质量高，无遗漏。脚本从 7/10 提升到 8/10。

**本轮新发现 3 个问题**（均为中低严重度），不涉及核心安全缺口，但在边界场景下可被利用或造成误伤。

---

## 一、第三轮待修复项复测结果

### 1. git switch -C main — ✅ 已修复

| 测试命令 | 期望 | 实测 | 状态 |
|---|---|---|---|
| `git switch -C main` | deny | deny | ✅ |
| `git switch -C feature` | deny | deny | ✅ |

**分析**：规则 30 新增 `switch\s+-C\b`，实测确认拦截生效。`git switch -C` 等价于 `git checkout -B`，强制重置分支指向，确实危险。修复正确。

---

### 2. git worktree remove --force — ✅ 已修复

| 测试命令 | 期望 | 实测 | 状态 |
|---|---|---|---|
| `git worktree remove --force` | deny | deny | ✅ |
| `git worktree add ../new main` | allow | allow | ✅（未误伤） |

**分析**：新增独立规则 `\bgit\s+worktree\s+remove\s+--force`，精准匹配强制删除，不影响 `worktree add`。修复正确。

---

### 3. wmic shadowcopy delete — ✅ 已修复

| 测试命令 | 期望 | 实测 | 状态 |
|---|---|---|---|
| `wmic shadowcopy delete` | deny | deny | ✅ |
| `wmic shadowcopy where "ID=1" delete` | deny | deny | ✅（WHERE 子句也拦） |
| `wmic shadowstorage delete` | deny | deny | ✅ |
| `wmic qfe list brief` | allow | allow | ✅（查询不误拦） |

**分析**：新增 wmic 规则覆盖 shadowcopy/shadowstorage + delete，同时保留 `wmic ... delete` 通用兜底。修复正确。

---

### 4. git push --force-with-lease 安全替代放行 — ✅ 已修复

| 测试命令 | 期望 | 实测 | 状态 |
|---|---|---|---|
| `git push --force-with-lease origin main` | allow | allow | ✅ |
| `git push origin main --force-with-lease` | allow | allow | ✅ |
| `git push --force-with-lease` | allow | allow | ✅ |
| `git push --force-with-lease=origin main` | allow | allow | ✅ |

**分析**：规则 30b 改为 `\bgit\s+push\s+.*--force(?:\s|$|\.)`，`--force-with-lease` 中 `--force` 后接 `-with-lease`，不匹配 `\s|$|\.`，正确放行。同时确认：

| 测试命令 | 期望 | 实测 | 状态 |
|---|---|---|---|
| `git push --force origin main` | deny | deny | ✅ |
| `git push origin main --force` | deny | deny | ✅ |
| `git push --force` | deny | deny | ✅ |

修复正确且精准。

---

### 5. echo "Remove-Item docs" 误伤 — ✅ 已修复

| 测试命令 | 期望 | 实测 | 状态 |
|---|---|---|---|
| `echo "Remove-Item docs"` | allow | allow | ✅ |
| `echo "Remove-Item"` | allow | allow | ✅ |

**分析**：规则 13 改用 `$cmdTest`（行 142），echo 引号字符串被预处理剥离为 `echo ""`，不再匹配 `\bRemove-Item\b`。修复正确。

---

### 6. echo "Format-Volume guide" 误伤 — ✅ 已修复

| 测试命令 | 期望 | 实测 | 状态 |
|---|---|---|---|
| `echo "Format-Volume guide"` | allow | allow | ✅ |
| `echo "Clear-Disk warning"` | allow | allow | ✅ |

**分析**：规则 9 改用 `$cmdTest`（行 122），同理。修复正确。

---

### 7. echo "subprocess.call is useful" 误伤 — ✅ 已修复

| 测试命令 | 期望 | 实测 | 状态 |
|---|---|---|---|
| `echo "subprocess.call is useful"` | allow | allow | ✅ |
| `echo "subprocess.run"` | allow | allow | ✅ |

**分析**：规则 33 改用 `$cmdTest`（行 307），修复正确。

---

### 8. 未破坏原有防护

| 测试命令 | 期望 | 实测 | 状态 |
|---|---|---|---|
| `subprocess.call(["rm","-rf","/tmp"])` | deny | deny | ✅ |
| `Clear-Disk -Number 1` | deny | deny | ✅ |
| `Format-Volume -DriveLetter C` | deny | deny | ✅ |
| `Remove-Item C:\temp -Recurse -Force` | deny | deny | ✅ |
| `git clean -fdx` | deny | deny | ✅ |
| `git reset --hard HEAD` | deny | deny | ✅ |
| `git checkout -- .` | deny | deny | ✅ |
| `git push --force origin main` | deny | deny | ✅ |

**结论**：第三轮所有修复项**全部真实落地**，8/8 通过，无遗漏。

---

## 二、新发现的绕过与误伤

### NEW-R4-01：git push -f 短标志绕过 — ⚠️ 新发现（P1）

| 测试命令 | 期望 | 实测 | 说明 |
|---|---|---|---|
| `git push -f origin main` | deny | **allow** | `-f` 是 `--force` 的短标志，等价 |
| `git push -f` | deny | **allow** | 同上 |

**分析**：规则 30b `git\s+push\s+.*--force(?:\s|$|\.)` 仅匹配 `--force` 长标志，不匹配 `-f` 短标志。`git push -f` 与 `git push --force` 功能完全相同，均为强制推送覆盖远程历史。

**修复建议**：将规则改为 `\bgit\s+push\s+.*(?:--force|-f)(?:\s|$|\.)` 或 `\bgit\s+push\s+(?:.*--force|-f)`，注意 `-f` 需独立匹配（避免误拦 `--force-with-lease`）。

**严重度**：P1（安全替代绕过，可覆盖远程历史）

---

### NEW-R4-02：git switch -c 小写误拦 — ⚠️ 新发现（P2）

| 测试命令 | 期望 | 实测 | 说明 |
|---|---|---|---|
| `git switch -c feature` | allow | **deny** | `-c` 是安全的创建分支操作 |
| `git switch -c feature main` | allow | **deny** | 同上，带起始点 |

**分析**：规则 30 `switch\s+-C\b` 中 `\b-C\b` 在 PowerShell 的 `-match` 下大小写不敏感，导致 `-c`（安全，创建新分支）也被拦截。`git switch -c` 等价于 `git checkout -b`，是常规操作；只有 `-C`（大写，等价 `git checkout -B`）才是破坏性的。

**修复建议**：改用 case-sensitive 匹配或精确指定 `[A-Z]C\b`，例如 `switch\s+-[Cc](?!reate)\b` 或使用 `[regex]::Match($cmd, 'switch\s+-C\b', 'IgnoreCase, None')` 的显式大小写控制。更简单的方案：在 PowerShell 中用 `-cmatch` 替代 `-match` 做大小写敏感匹配。

**严重度**：P2（误伤日常开发命令）

---

### NEW-R4-03：docker volume prune 漏拦 — ⚠️ 新发现（P2）

| 测试命令 | 期望 | 实测 | 说明 |
|---|---|---|---|
| `docker volume prune` | deny | **allow** | 清除所有未使用的卷 |
| `docker volume prune -f` | deny | **allow** | 同上，跳过确认 |

**分析**：规则 35 `\bdocker\s+(?:system\s+prune|volume\s+rm|container\s+prune)` 中 `volume\s+rm` 仅匹配 `docker volume rm`，不匹配 `docker volume prune`。`docker volume prune` 删除所有未被容器使用的卷，破坏性不低于 `volume rm`。

**修复建议**：将 `volume\s+rm` 扩展为 `volume\s+(?:rm|prune)`。

**严重度**：P2（遗漏同类破坏操作）

---

### 新发现的误伤（低优先级）

| 测试命令 | 期望 | 实测 | 触发规则 | 说明 |
|---|---|---|---|---|
| `wmic diskpart list` | allow | deny | 规则 8 `\bdiskpart\b` | wmic 查询磁盘信息被误拦，但 `wmic diskpart list` 是只读查询 |

**分析**：规则 8 匹配所有含 `diskpart` 的命令，包括 wmic 上下文中的只读查询。实际影响极低（极少有人在 agent 环境中执行 wmic diskpart），但值得注意。

---

## 三、误伤抽查结果

| 命令 | 期望 | 实测 | 状态 |
|---|---|---|---|
| `git push origin main` | allow | allow | ✅ |
| `git log --oneline` | allow | allow | ✅ |
| `git diff` | allow | allow | ✅ |
| `git pull` | allow | allow | ✅ |
| `git add .` | allow | allow | ✅ |
| `git commit -m "fix"` | allow | allow | ✅ |
| `npm test` | allow | allow | ✅ |
| `ls -la` | allow | allow | ✅ |
| `git clean -h` | allow | allow | ✅ |
| `echo "diskpart is useful"` | allow | allow | ✅ |
| `echo "del old files"` | allow | allow | ✅ |
| `echo "rmdir test"` | allow | allow | ✅ |
| `printf "Remove-Item stuff"` | allow | allow | ✅ |
| `printf "Clear-Disk note"` | allow | allow | ✅ |
| `docker system df` | allow | allow | ✅ |
| `docker container rm myapp` | allow | allow | ✅ |
| `git worktree add ../new main` | allow | allow | ✅ |
| `git branch --delete feature` | allow | allow | ✅ |

**结论**：常规开发命令 **18/18 全部正确放行**。误伤率相比第三轮显著改善。

---

## 四、-Cmd 参数安全性

测试了 `-Cmd` 参数注入场景：

| 测试命令 | 期望 | 实测 | 状态 |
|---|---|---|---|
| `echo test` | allow | allow | ✅ |
| `echo test; rm -rf /` | deny | deny | ✅ |
| 换行符注入 `echo test\nrm -rf /` | deny | deny | ✅ |

**分析**：`-Cmd` 参数接收完整命令字符串，脚本内部处理包含分号链和换行符的复合命令，均正确拦截。无参数注入风险。

---

## 五、已知局限性确认（诚实保留，不要求修复）

| 项目 | 测试命令 | 实测 | 说明 |
|---|---|---|---|
| P0-10 变量展开 | `R=m; $R -rf /tmp/t` | allow | 正则方案固有限制 |
| P0-14 npm cache clean | `npm cache clean --force` | allow | 低风险，可接受 |
| P0-15 rm 独参 | `rm` | allow | 无害，可接受 |
| P1-03 python print | `python -c "print(os.remove())"` | deny | 正则无法区分执行与打印 |

**结论**：上述 4 项均为正则方案的结构性限制，第三轮报告已诚实标注，本轮确认未变。不计入扣分。

---

## 六、评分与理由

### 本轮评分：8 / 10

| 维度 | 第三轮 | 第四轮 | 变化 |
|---|---|---|---|
| 第三轮修复项落地 | 未知（待验证） | **6/6 全部通过** | ↑ 全部确认 |
| 新发现问题 | 3 项 | 3 项（NEW-R4-01~03） | 新轮次新发现 |
| 误伤率 | 3/15 常规命令 | 1/18 常规命令 | ↑ 显著改善 |
| 正则局限 | 4 项 | 4 项（不变） | → 已知限制 |

### 评分理由

**+1 分提升（7→8）**：
- 第三轮 6 项修复全部真实落地，修复质量高，无遗漏
- echo 误伤问题全面解决（规则 9/13/33 均改用 `$cmdTest`）
- `--force-with-lease` 锚定精准，既放行安全替代又不降低防护
- 常规开发命令误伤率从 3/15 降至 1/18（+1 来自 wmic diskpart 误拦，极低频）
- 新增 wmic/worktree 规则覆盖第三轮报告的全部缺口

**扣分原因（-2 分）**：
- `git push -f` 短标志未覆盖（P1，可绕过强制推送防护）
- `git switch -c` 大小写不敏感误拦（P2，影响日常开发）
- `docker volume prune` 漏拦（P2，同类破坏操作遗漏）
- 正则方案固有限制仍然存在（已知，不额外扣分）

---

## 七、建议优先级

### P1（应修复）

1. **git push -f 短标志**：规则 30b 扩展匹配 `-f`，同时保持 `--force-with-lease` 放行
   ```
   建议：\bgit\s+push\s+(?:.*--force|-f)(?:\s|$|\.) 或 \bgit\s+push\s+.*(?:--force|-f\b)
   ```

### P2（建议修复）

2. **git switch -c 大小写**：规则 30 改用 case-sensitive 匹配或精确指定 `[A-Z]C\b`
3. **docker volume prune**：规则 35 扩展 `volume\s+(?:rm|prune)`

### 已知局限（记录，不修复）

4. 变量展开 / npm cache clean / bare rm / python print — 正则方案固有限制

---

## 八、汇总

**第三轮修复验证结论**：开发方自述属实，6 项修复全部真实落地，脚本防护能力从 7/10 提升到 8/10。

**新发现 3 个中低严重度问题**：
- `git push -f` 短标志绕过（P1）—— 最高优先级修复
- `git switch -c` 大小写误拦（P2）—— 影响日常开发体验
- `docker volume prune` 漏拦（P2）—— 同类操作遗漏

**整体评价**：脚本已具备生产级防护能力，核心安全路径（rm -rf / 系统目录、git 破坏整类、管道到 shell、IEX+WebClient、subprocess、wmic shadowcopy、truncate 块设备）均有可靠拦截。新发现的问题均为边界场景，不构成系统性风险。建议优先修复 `git push -f` 短标志绕过。
