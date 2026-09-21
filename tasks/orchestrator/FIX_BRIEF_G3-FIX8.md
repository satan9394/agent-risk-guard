# FIX_BRIEF G3-FIX8 —— 包装词「自身选项」纳入命令位前缀（G3 最后一轮）

## 0. FIX7 已核实通过（**不得回退**）

编排者自跑 32 条：**A 面 8/8 allow**（`printf '{ diskpart }'` 等过拦已收回）、**A 面真子 shell/块 5/5 deny**（含嵌套 `((rmdir /s /q x))`）、**B 面互串 6/6 deny**（`command time diskpart`、`env sudo diskpart`…）、**守卫 5/5 allow**（`x diskpart`、`sudo -u root ls diskpart`、`cmd /c npm test`、`env -i ls diskpart`）。
FIX7 的三列矩阵：**FIX6 冻结字节 50 条不符 → FIX7 0 条不符**；48 处变化 = 16 放松收回 + 30 收紧，**方向全对**；闸门 168→196，A/B 变异红点**恰好** K60–K68 / K69–K78+K82；红线全绿（sh 12/12、ps1 10/10、redact 3/3 + M4/M2 红、node 380/380）。

**本轮只补一条轴，改完即收 G3。**

---

## 1. 必修：包装词**自身选项**未纳入前缀（安全方向残留）

### 实测（编排者 Round 264，两端）
| 载荷 | 应然 | ps1 | sh | pre-G3 ps1 |
|---|---|---|---|---|
| `sudo -u root diskpart` | deny | **allow** | **allow** | **deny** |
| `sudo -n diskpart` | deny | **allow** | **allow** | deny |
| `sudo --user=root diskpart` | deny | **allow** | **allow** | deny |
| `nice -n 5 diskpart` | deny | **allow** | **allow** | deny |
| `ionice -c 3 diskpart` | deny | **allow** | **allow** | deny |
| `doas -u root diskpart` | deny | **allow** | **allow** | deny |
| `exec -a name diskpart` | deny | **allow** | **allow** | deny |
| `time -p diskpart` | deny | **allow** | **allow** | deny |

**性质**：这不是"边角"——`sudo -u root diskpart` 是**真实可执行的危险命令**，而 `pre-G3 ps1` 本就 deny，故属 **D12 意义上的放松残留**（FIX5 锚化时丢失，FIX6 只收回"裸包装词"子情形，**带选项的子情形未收回**）。**属安全方向，故开本轮。**

### 修法
在**包装词可重复组**里允许消费**该包装词自身的选项**，例如把每个包装词写成「词 + 其合法选项族」：
- `sudo`：`-u <user>` / `-g <group>` / `-n` / `-E` / `-H` / `-i` / `-s` / `--user=<u>` / `--group=<g>` / `-p <prompt>` …
- `nice`：`-n <N>` / `--adjustment=<N>`
- `ionice`：`-c <N>` / `-n <N>` / `-p <PID>`
- `doas`：`-u <user>`
- `exec`：`-a <name>` / `-c` / `-l`
- `time`：`-p` / `-v` / `--verbose`
- `env`：`-i` / `-0` / `-v` / `-u <NAME>` / `-C <DIR>` / `-S <STR>` / `VAR=v`
- `setsid` / `busybox`：按其真实形态

**⚠️ 最大风险：过度消费 → 新过拦**（这正是 FIX6 翻过的车）。**必须配反向守卫，且逐条自测**：
- `sudo -u root ls diskpart` → **allow**（选项后是安全命令）
- `sudo -n ls dat` → **allow**
- `nice -n 5 cat file` → allow
- `env -i ls diskpart` → allow
- `cmd /c npm test` → allow
- `x diskpart` / `git status` → allow

**判据**：选项消费**只发生在包装词紧邻位置**，且消费后**必须紧跟命令词**；**不得把选项族写成"吃掉任意 token"**（那会把 `sudo ls diskpart` 这类安全命令误拦）。

### 并修报告口径
`IMPLEMENTATION_RESULT_G3-FIX7.md` §8-3 已给出精确形态——**请核实并更正其中与实测不符之处**；本轮结果写入 `G3-FIX8` 报告。

---

## 2. 闸门

1. 新增语料：上表 8–10 条 → **expect deny**；反向守卫 6 条 → **expect allow**
2. **L 段身份守卫**补对
3. **变异体从终版冻结字节派生**；**"只回退本轮选项消费" → 闸门必红**，且**失败集恰好是本轮新增语料**（不得牵连其它）
4. **不得留占位符**

## 3. 不能破坏（红线）

§0 全部（A 面 8 条 allow、真子 shell/块 15 条 deny、B 面 30 条 deny、守卫 allow）；`x diskpart` 等反向守卫；前缀仍**两端各单一定义 + 全规则引用**；7 处例外不动；§A 向上对齐与 §B 空引号收敛成果；`rm'' --help` allow；redact parity A/B/C 绿 + **M4 红** + **M2 红（`sh-failclosed-test` 31/34）**；sh 四套×三棵树 12/12；**ps1 五套×同步树 10/10**；node 全量；副本 sh×3 + ps1×6 distinct=1 且 **ps1 BOM=True 逐份**；25+ 条合法命令零过拦。

## 4. 纪律

**D6** 真实 spawn + 进程 stdin（sh 必须 `wsl.exe -e bash`）；**D7** 构造邻居（**本轮尤其**：包装词选项的各种写法、选项后跟安全命令、多包装词各带选项、`--` 终止符）；**D8** 基线对照**用 `git show <commit>:<path>` 取冻结字节**；**D9** ps1 改动逐份复核 BOM；**D10** 串行 + 单次全红先重跑；**D12** 向上对齐。每条改动**可指代码行**。顺序：改 → 测 → **同步副本** → 复核 distinct/BOM/行尾 → **最后**更新报告。

## 5. 交付

- sh + ps1 改动（含六份 ps1 同步）+ 闸门语料 + FIX7 报告口径更正
- `tasks/orchestrator/IMPLEMENTATION_RESULT_G3-FIX8.md`：§改动逐条对照（可指代码行）→ §C 面 8–10 条三列 before/after → §反向守卫 6 条 → §"过度消费"自查矩阵 → §闸门变异证据（冻结基底，失败集恰好）→ §回归数字 → §副本表（BOM/行尾）→ §未解决问题
- 证据 `tasks/orchestrator/_g3fix8_*`

## 6. 验收标准

上表 **8–10 条两端 deny**；**6 条反向守卫两端 allow**；**无任何新过拦**（对 FIX7 冻结基线做全量对照，`allow→deny` 只允许出现在本轮新增的危险载荷上）；闸门补齐且"只回退本轮"变异红点**恰好**；§3 红线全绿；副本 distinct=1 且 ps1 BOM=True。
