# vX.Y.Z — <主题 / Theme> · Pre-release

> [中文](#中文) · [English](#english) · [完整变更日志](https://github.com/satan9394/agent-risk-guard/blob/main/CHANGELOG.md) · 上一版：同目录 `vA.B.C.md`
>
> 用法：复制本文件为 `vX.Y.Z.md`（与 git tag 同名），中英两段都要写。发布工作流按 `${GITHUB_REF_NAME}` 取用；
> **文件不存在时发版会失败**（见 `.github/workflows/release.yml`）。
> Usage: copy this file to `vX.Y.Z.md` (same name as the git tag) and fill in **both** languages. The release
> workflow reads `${GITHUB_REF_NAME}`; **a missing file fails the release job**.

---

## 中文

### 这一版要解决什么问题

> 不要写"新增了哪些功能"。要写：**上一版缺什么、哪里会出错、谁受影响、不修的后果是什么。**
> 如果这一版是纯新增能力，也要说清"没有它的时候用户会踩什么坑"。

### 改变了什么

> 具体到**可验证的行为**。每条尽量能指到代码/文档位置；禁止"优化了体验""提升了稳定性"这类无法检验的话。

### 验证

> 跑了什么、结果如何、在哪些环境上。**没验证的必须显式写"未验证"**，不要把推测写成结论。

---

## English

### The problem this release solves

> Do not list features. State **what the previous version lacked, what could go wrong, who was affected, and what
> happens if it is left unfixed.** If this release is purely additive, say what a user hits without it.

### What changed

> Concrete, **checkable behaviour**; each item should point at code or docs. No unverifiable claims like
> "improved the experience" or "increased stability".

### Verification

> What you ran, the result, and on which environments. **Anything untested must be explicitly marked "not
> verified"** — never present a guess as a finding.
