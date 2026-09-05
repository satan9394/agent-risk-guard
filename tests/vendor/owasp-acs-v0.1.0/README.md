# OWASP ACS v0.1.0 — Vendor Schema Snapshot

本目录是 OWASP Agent Control Standard **v0.1.0** 官方 JSON Schema 的 pinned 快照，
是 RiskGuard v0.2.1 的最终 conformance 判据（Layer 2）。

> **Vendor schema snapshots are read-only.**
> 禁止直接 patch 本目录任何 schema 文件（含“为了让测试通过而改官方 schema”）。
> 如需更新：换 upstream commit → 重新同步 → 更新 `SCHEMA_SHA256SUMS` → 人工 review。

## 来源记录

| 项 | 值 |
| --- | --- |
| Upstream repo | https://github.com/GenAI-Security-Project/agent-control-standard |
| Spec | v0.1.0（`specification/v0.1.0/`） |
| Pinned commit | `f46d260d22fe6d6ad71e4d979be7e25d063c468e` — "Integrate canonical v0.1.0 (#2)"（2026-06-05） |
| License | Apache-2.0（上游仓库 LICENSE；schema 快照随上游 Apache-2.0 分发） |
| Retrieved | 2026-08-21 |
| 校验 | `SCHEMA_SHA256SUMS`（CI 校验；防止本地被无意修改） |

> Pinned commit 说明：v0.1.0 官方 schema 由 commit
> `f46d260d22fe6d6ad71e4d979be7e25d063c468e` 引入，且直至上游 v0.1.1 release
> （`1af1f92c1e445cf5ffa662515f83275de6eb603e`）`specification/v0.1.0/` 目录
> 内容完全未变（`git diff f46d260..1af1f92 -- specification/v0.1.0` 为空）。

## 文件清单

```text
request-envelope.json            # JSON-RPC Request Envelope（§七/§十）
response-envelope.json           # JSON-RPC Response Envelope + AcsResult + JsonRpcError（§十二/§十六）
hooks/tool-call-request.json     # ToolCallRequest payload（§四/§五/§六）
modifications.json               # modify 决策的官方 modifications 结构（§十七）
ask-details.json                 # ask 决策详情（§二十二）
defer-details.json               # defer 决策详情（§二十三）
provenance.json                  # argument-level provenance（§三十四）
SCHEMA_SHA256SUMS                # 各文件 SHA-256（CI 完整性校验，§五十四）
```

## 完整性校验

```bash
node scripts/verify-acs-schema-snapshot.ts
```

脚本检查：文件齐全、SHA-256 匹配 `SCHEMA_SHA256SUMS`、upstream commit 元数据一致
（§五十六）。CI 中作为普通校验步骤运行（§五十四）；不阻塞则见
`scripts/check-acs-upstream.ts`（informational drift check，§二十七）。
