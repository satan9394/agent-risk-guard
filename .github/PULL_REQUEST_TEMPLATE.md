## 变更类型

- [ ] Bug fix（非破坏性修复）
- [ ] Feature（非破坏性新能力）
- [ ] Breaking change（会改变现有行为 / 接口）
- [ ] 文档 / 测试 / CI 维护

## 改动摘要

一句话说明改了什么、为什么。

## 关联 issue

Fixes #（如适用）

## 影响面

- 涉及包：core / cli / trash / installer / dsh / adapters / hooks / 其他
- 是否改变默认 deny 行为？如果是，说明理由。

## 测试

- [ ] 新增 / 修改了测试用例
- [ ] 本地全量通过：`& .\test-all.ps1`（或等价）
- [ ] 如有规则变更：`rule-alignment` 测试通过（skill 侧与 monorepo 侧同步）

## 安全自查

- [ ] 本 PR 不含绕过载荷演示 / 真实凭证 / 敏感路径（如有必须，走 SECURITY 私密渠道）
- [ ] 没有把删除类命令的「永久删除」示例写入文档作为推荐用法