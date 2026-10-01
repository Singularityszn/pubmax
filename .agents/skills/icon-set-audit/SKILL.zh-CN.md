---
name: icon-set-audit
description: >-
  审计一套已有的 SVG 图标集，并按可见度与修复成本对不一致之处排定优先级。
  适用于整套一致性审查、解释一套图标为何显得不均衡，或在安全的机械修复与重绘工作之间做出划分。
  当用户想要添加或重新设计指定图标时，请使用 icon-set-extend。
compatibility: 任何包含 .svg 文件目录的项目。随附脚本只需标准库 python3。
---

> English: [SKILL.md](SKILL.md)

# 审计一套图标集

一个图标单独看可能是对的，但仍会破坏整套。有用的缺陷是关系性的：一个箭头头部与其他六个不同、某个字形携带了更多的视觉重量，或者两个文件以不同名字装载了同一幅画。

交付物是一份分诊报告。按实际渲染尺寸下的可见度和修复成本对发现排序。一份点名一个清晰首步的短报告，好过一份完整的 linter 倾倒。

## 工作流程

### 第 1 步：确立标准

在提问之前先检查项目。寻找 `style-spec.json`、设计系统笔记、使用位置和渲染尺寸 token。只询问仓库无法回答的信息。

记录这些事实：

- 既定规范；若无规范，则为集合中的多数派
- 最小的公共渲染尺寸
- 遵循独立规则的文件，如品牌标志或第三方 logo

当不存在书面规范时，分析器可以推断多数派。在把该多数派视为正确之前，先检查最近的 git 历史。接近五五开的分裂可能意味着这套图标正在迁移中。

当标准、渲染尺寸和排除项已知（或被明确表述为假设）时，此步骤完成。

### 第 2 步：运行分析器

```bash
python3 scripts/audit_icons.py path/to/icons/ --report audit.html
```

存在既定规范时传入该规范：

```bash
python3 scripts/audit_icons.py path/to/icons/ \
  --spec path/to/style-spec.json --report audit.html
```

当结构化输出能让大集合更易于排序时使用 `--json`。分析器检查规范一致性、重复部件、近似重复、光学尺寸、间隙、内边距、坐标卫生、复杂度、命名和固定颜色。

当命令成功且 HTML 报告存在时，此步骤完成。

### 第 3 步：检查对照表

打开报告并在目标尺寸下检查每一个图标。在给发现分类之前先阅读 `references/failure-modes.md`。它解释了机器结果以及脚本无法检测的视觉缺陷。

在整张对照表上检查这些盲区：

- 同一概念由多个图标表示，或一个图标用于相互冲突的概念
- 混合的透视、绘制模式、细节层次或斜线方向
- 范围内的产品界面所需图标的缺失

当每条机器发现都已对照对照表核查、且每个图标都已就视觉盲区被考虑过时，此步骤完成。

### 第 4 步：对每条保留的发现分诊

将每条保留的发现放入一个桶：

- **在渲染尺寸下破损。** 图标被裁剪、糊成一团、变得不可读，或无法适配主题化。立即修复。
- **系统性。** 集合存在分歧的共享部件、相互冲突的规则，或没有一致认可的标准。估算整套修复成本。
- **值得在被触碰时修复。** 缺陷真实存在，但可见度不足以证明立即动手的合理性。

丢弃那些不可见、无害、且不太可能影响未来工作的发现。记录你考虑过但有意省略的内容。

当每条分析器结果和视觉观察都已被放入某个桶、或被记录为有意省略时，此步骤完成。

### 第 5 步：撰写报告

使用这个结构：

```markdown
## Verdict
[State whether the set holds together and name the first repair.]

## Breaks at render size
[Finding, files, visible effect, repair]

## Systemic
[Relational problem, affected icons, estimated work]

## Worth fixing when touched
[Grouped list]

## Deliberately not flagged
[Items inspected and omitted]
```

保持健康集合的报告简短。报告完成的标志是点名一个第一修复，并覆盖第 4 步中每条保留或省略的发现。

### 第 6 步：应用已批准的机械修复

仅当用户请求修复或批准该提议时才运行 `--fix`：

```bash
python3 scripts/audit_icons.py path/to/icons/ --fix
```

当第 2 步的审计使用了规范时，重复传入 `--spec path/to/style-spec.json` 参数。

该命令会归一化无歧义的根属性、剥离 `id` 和 `class`、并对有噪声的 path、point 和 shape 坐标取整。它打印每个被修改的文件。它把这些决定留给人类：

- 固定颜色，因为品牌图可能需要它们
- 文件名，因为重命名可能破坏导入
- 感知层面的变更，因为光学尺寸、合并形状和混合隐喻需要重绘

修复后再次运行同一审计命令。当第二份报告展示出真实的剩余发现、且最终摘要把已修复文件与重绘工作分开时，此步骤完成。

审计负责诊断和已批准的机械清理。`icon-set-extend` 负责新图标和必须匹配现有集合的指定重绘。除非用户扩大范围，否则把指定重绘与整套清理分开。

## 参考文件

- 在第 3 步期间阅读 `references/failure-modes.md`。它定义了每种失效、其在渲染尺寸下的可见度及其可能的修复成本。
- 当 `icon-set-generator` 可用时，仅当用户询问某个发现背后的几何原因时，才阅读其 `references/construction.md`。
