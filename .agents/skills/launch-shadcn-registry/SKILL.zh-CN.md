---
name: launch-shadcn-registry
description: >-
  启动并推广一个自定义 shadcn/ui registry。校验 registry.json，准备或开启目录拉取请求，
  并为 Reddit、X、Dev.to 与 Hacker News 起草帖子。当用户想要启动、列出、提交或宣布一个
  shadcn/ui registry 时使用，包括关于 awesome-shadcn-ui、registry.directory、free-for-dev、
  awesome-ai-devtools（MCP）或一个新的 @scope registry 的请求。
compatibility: 需要网络访问、curl、gh 与 git。创建拉取请求前，用户必须已通过 gh 登录。
---

> English: [SKILL.md](SKILL.md)

# 启动一个 shadcn registry

为一个自定义 shadcn/ui registry 准备目录提交，然后撰写贴合各平台的帖子。

## 开始之前

确认用户要的是完整发布还是仅选定目标。除非用户收窄范围，默认执行完整工作流。

收集或推断一份 registry 档案。在生成提交之前先询问缺失的必填字段。以 [templates/registry-profile.example.json](templates/registry-profile.example.json) 为形状，并对照 [templates/registry-profile.schema.json](templates/registry-profile.schema.json) 校验。

必填档案字段：

| 字段 | 用途 |
|-------|---------|
| `scope` | Registry 作用域，如 `@ogimagecn` |
| `name` | 显示名称 |
| `homepage` | 公开的项目或文档 URL |
| `registryBaseUrl` | JSON 文件的基础 URL，不带尾斜杠 |
| `componentUrlPattern` | 含 `{name}` 占位符的 URL 模式，如 `https://example.com/r/{name}.json` |
| `description` | 一句目录描述，不超过 160 字符 |
| `descriptionLong` | 两三句话，用于 awesome 清单与社交帖子 |
| `githubUrl` | 源仓库 |
| `githubUsername` | 用于头像 URL 与文件名 |
| `distribution` | `open-source` 或 `premium` |
| `categories` | 用于 shadcntemplates 与 awesome 清单的标签 |
| `installExample` | 完整安装命令，如 `npx shadcn@latest add @scope/component-name` |
| `logo` | 可选的内联 SVG 字符串；官方目录推荐提供 |
| `registryIndexPath` | 可选的 registry 索引路径，相对 `registryBaseUrl`；默认 `/registry.json` |
| `sampleComponents` | 可选的预检用组件 slug，如 `["og-image"]` |
| `features` | 可选的要点，用于 shadcntemplates 与社交帖子 |
| `mcpUrl` | 可选的 registry 域名上的 MCP 端点，如 `https://example.com/mcp`；awesome-ai-devtools 必填 |
| `freeTier` | 可选的免费档描述句，含具体限额；free-for-dev 必填 |
| `pricingUrl` | 可选的公开定价页 URL；free-for-dev 必填 |

## 工作流程

复制这份清单并跟踪进度：

```
Launch Progress:
- [ ] Phase 1: Preflight validation
- [ ] Phase 2: Generate directory artifacts
- [ ] Phase 3: Open GitHub pull requests after user approval
- [ ] Phase 4: Draft social posts
- [ ] Phase 5: Post-launch follow-up
```

## 阶段 1：预检

阅读 [references/preflight.md](references/preflight.md)，在生成任何 PR 之前运行校验。

```bash
bash scripts/validate-registry.sh <registryBaseUrl> [sample-component-name]
```

继续之前修复所有阻断项。常见失败：

- `registry.json` 不公开或路径错误
- 组件 JSON 404
- 官方目录中已有重复的 `@scope`
- `description` 对官方列表来说过长或营销味过重

抓取官方目录检查重复：

```bash
curl -fsSL https://raw.githubusercontent.com/shadcn-ui/ui/main/apps/v4/registry/directory.json | grep -i "<scope>"
```

## 阶段 2：生成产物

根据 registry 档案生成所请求的提交文件。只阅读对应目标的参考文档。

| 目标 | 参考 | 产物 |
|--------|-----------|--------|
| 官方 shadcn-ui/ui | [references/shadcn-ui-official.md](references/shadcn-ui-official.md) | JSON 条目 + PR 描述 |
| registry.directory | [references/registry-directory.md](references/registry-directory.md) | JSON 条目 + PR 描述 |
| shadcntemplates | [references/shadcntemplates.md](references/shadcntemplates.md) | `content/{author}-{name}.md` |
| birobirobiro awesome | [references/awesome-birobirobiro.md](references/awesome-birobirobiro.md) | README 表格行 |
| bytefer awesome | [references/awesome-bytefer.md](references/awesome-bytefer.md) | README 表格行 |
| free-for-dev | [references/free-for-dev.md](references/free-for-dev.md) | README 列表项，以托管的 SaaS 免费档为前提 |
| awesome-ai-devtools | [references/awesome-ai-devtools.md](references/awesome-ai-devtools.md) | README 列表项，仅限带域名派生 `mcpUrl` 的 MCP 服务器 |

按仓库分组展示产物。包含：

1. 要创建或编辑的确切文件路径
2. 要添加的完整内容而非部分 diff
3. 建议的 PR 标题与描述

### PR 标题惯例

官方 shadcn-ui/ui 使用 `feat(registry): add <scope>`。这与 [PR #10896](https://github.com/shadcn-ui/ui/pull/10896) 一致。awesome 清单使用 `docs: add <name> to <section>`，registry.directory 使用 `feat: add <name> registry`。

## 阶段 3：开启 GitHub 拉取请求

GitHub 操作使用 `gh`。除非用户已要求全部开启，否则每个 PR 创建前先询问。

每个仓库的标准 fork-and-PR 流程：

```bash
# Example: official shadcn-ui/ui
gh repo fork shadcn-ui/ui --clone=false
git clone https://github.com/<user>/ui.git /tmp/ui-registry-pr
cd /tmp/ui-registry-pr
git remote add upstream https://github.com/shadcn-ui/ui.git
git fetch upstream && git checkout -b feat/<scope>-directory upstream/main
# append the entry to apps/v4/registry/directory.json
git add apps/v4/registry/directory.json
git commit -m "feat(registry): add <scope>"
git push -u origin HEAD
gh pr create --repo shadcn-ui/ui --title "feat(registry): add <scope>" --body "$(cat <<'EOF'
## Summary
Adds <scope> to the community registry directory.

- Registry URL: `<componentUrlPattern>`
- Homepage: <homepage>
- Description: <description>

## Test plan
- [ ] `curl <registryBaseUrl>/registry.json` returns valid JSON
- [ ] `npx shadcn@latest add <installExample>` installs successfully
EOF
)"
```

除非用户另有选择，按此顺序开启拉取请求：

1. 官方 `shadcn-ui/ui`——曝光最高的列表，也最可能需要维护者审查
2. `rbadillap/registry.directory`
3. `shadcnblocks/shadcntemplates`
4. `birobirobiro/awesome-shadcn-ui` 与 `bytefer/awesome-shadcn-ui`，可并行
5. `jamesmurdza/awesome-ai-devtools`——仅当 registry 在自己的域名上提供已验证的 MCP 服务器
6. `ripienaar/free-for-dev`——仅当 registry 域名提供 SaaS 免费档；审查最慢，最后提交

在发布清单中跟踪拉取请求 URL。在 registry 上线且至少一个目录提交已开启或合并之前，不要将其描述为已发布。

## 阶段 4：起草社交帖子

阅读平台参考文档并产出可直接粘贴的草稿。由用户手动发布。

| 平台 | 参考 |
|----------|-----------|
| Reddit r/shadcn | [references/social/reddit.md](references/social/reddit.md) |
| X | [references/social/x.md](references/social/x.md) |
| Dev.to | [references/social/devto.md](references/social/devto.md) |
| Hacker News | [references/social/hackernews.md](references/social/hackernews.md) |

根据 registry 档案定制每份草稿。包含安装命令、主页与 GitHub 链接。避免炒作；以该 registry 解决的具体问题开头。

社交帖子在预检通过后起草。建议在官方目录拉取请求合并后发布。至少等到 `registry.json` 上线。

## 阶段 5：跟进

PR 开启或合并之后：

1. 分享每个提交的仓库、拉取请求 URL 与状态
2. 提醒用户在 48 小时内回应审查意见
3. 官方合并后，更新社交草稿，提及该 registry 已列入 shadcn registry 目录
4. 如果拉取请求被拒，阅读维护者反馈，修改描述或 registry 格式后重新提交

## 规则

以上阶段尚未涵盖的护栏：

- 官方 `directory.json` 条目追加到数组末尾。
- 每个提交使用同一份 registry 档案。未经用户同意不要发明相互矛盾的描述。
- 对 shadcntemplates 上的付费 registry，说明首个列表免费、额外列表每个 $100。不要承诺一定能通过。
- registry 没有 MCP 服务器时跳过 `awesome-ai-devtools`，没有 SaaS 免费档时跳过 `free-for-dev`。说明原因而不是硬写草稿。
- awesome-ai-devtools 链接从 registry 域名派生（`profile.mcpUrl`，默认 `{homepage}/mcp`），并在起草前验证该端点。

## 附加资源

- Registry 档案 schema：[templates/registry-profile.schema.json](templates/registry-profile.schema.json)
- 示例档案：[templates/registry-profile.example.json](templates/registry-profile.example.json)
- 校验脚本：[scripts/validate-registry.sh](scripts/validate-registry.sh)
