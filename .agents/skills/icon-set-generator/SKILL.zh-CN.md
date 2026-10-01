---
name: icon-set-generator
description: >-
  在一套固定的视觉规范之上创建全新的产品专属 SVG 图标体系。适用于用户明确要求一批
  连贯的原创图标、且不存在目标图标集的场景，包括拒绝使用现成图标库的请求。
  已有目标图标集时请使用 icon-set-extend。
compatibility: 任何项目。随附脚本只需标准库 python3。
---

> English: [SKILL.md](SKILL.md)

# 生成一套连贯的图标集

单个图标可以靠即兴发挥过关，一整套不行。描边、光学尺寸、间隙与循环部件里的微小偏差会累积成漂移。先冻结这些决策再动笔，然后整批对照规范校验。

## 工作流程

### 第 1 步：拿到简报

提问之前先检查项目里的品牌规则与使用尺寸。只收集缺失的事实：

- 产品、受众与气质
- 最小渲染尺寸，以及每一个有别的尺寸区间
- 必需的图标清单，以及它们出现的界面
- 图标需要与之并置的既有字体、界面或品牌视觉

12 至 20px 渲染用 16 网格，22px 及以上用 24 网格。当两个区间都重要时，分别绘制小尺寸与大尺寸两套。完整区间需要各自独立的绘制。

此步骤完成于：网格、气质、清单来源与相邻视觉系统均已明确，或被表述为显式假设。

### 第 2 步：确认清单

阅读 `references/icon-inventory.md`。走查范围内的产品界面，然后按用途给拟定图标分组，让缺漏与重复概念一目了然。为语义别名复用同一张绘制。

如果用户给的是完整清单，只确认冲突与可能的缺漏。如果用户让你来选清单，动笔前先把清单摆出来。

此步骤完成于：范围内每个界面都有图标或有明确的排除决定，且每张绘制只有一个文件名外加若干语义别名。

### 第 3 步：冻结规范

阅读 `references/style-presets.md`。用户给出精确值时照用。否则推荐一个预设并给出具体理由，动笔前先确认。

把确认后的预设值复制进 `icons/style-spec.json`。加入集合名称、对角轴线与空的 `icons` 数组。绘制期间视该文件为冻结。若某个形态暴露出坏规则，修订规范一次，并把改动应用到整套集合。

此步骤完成于：`style-spec.json` 包含全部根样式与栅格决策、且任何后续修订都同步应用到了整批图标。

### 第 4 步：绘制图标

阅读 `references/construction.md` 之后动笔。每个形态先把锚点图标画到完美，再从它出发构造其余图标。逐个登记共享部件。

- 先画锚点，再画变体。
- 遵循 `style-spec.json` 的栅格与描边设置。
- 数值取整。修改后回归对照表。
- 从零绘制每个形态。禁止直接从其他图标集复制路径——结构随风格漂移，而且多数图标库的许可并非宽松许可。

画完每个图标后立即校验，不要攒批。

### 第 5 步：校验与登记

```bash
python3 scripts/validate_icons.py icons/
python3 scripts/register_elements.py icons/
```

`validate_icons.py` 检查规范一致性、重复部件与坐标卫生。`register_elements.py` 写出 `elements.md` 部件登记表。

把每个警告当缺陷对待。修复、或记录保留该警告的具体理由。当同一形态出现两次以上时，提取为共享部件并重建受影响图标。

### 第 6 步：预览与终检

```bash
python3 scripts/build_preview.py icons/
```

先检查整张对照表：集合感是否连贯、是否有成员在视觉重量或细节层次上脱离。再在浅色与深色背景下，以原生尺寸和两倍原生尺寸逐个检查图标。更新 `style-spec.json` 里的 `icons` 数组，重建预览，并确认它列出了每个 SVG。

最终目录包含：

```text
icons/
|-- style-spec.json
|-- elements.md
|-- preview.html
|-- arrow-right.svg
`-- calendar.svg
```

任务完成于：获准清单、规范、登记表、干净校验、警告处置与最终预览全部一致。

## SVG 规则

- 每个可主题化的颜色都用 `currentColor`。轮廓图标用 `fill="none"` 加 `stroke="currentColor"`。实心形态用 `fill="currentColor"`。
- 共享样式属性放在根 `<svg>` 上，且各文件保持一致。
- 只在文档说明存在光学修正时才在子元素上写 `stroke-width`。
- 根元素不带 `id` 与 `class`。根变换直接烘焙进坐标。
- 最多保留两位小数。优先整数与半单位。
- 选最少又能清晰表达形态的 SVG 元素。

```xml
<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"
     fill="none" stroke="currentColor" stroke-width="1.5"
     stroke-linecap="round" stroke-linejoin="round">
  <path d="M3 10.5 12 3l9 7.5"/>
  <path d="M5 9.5v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-10"/>
</svg>
```

## 参考文件

- 第 2 步阅读 `references/icon-inventory.md`。
- 第 3 步阅读 `references/style-presets.md`。
- 第 5 步之前通读 `references/construction.md`。
- 当具体绘制需要时，只阅读 `references/svg-patterns.md` 里的相关形态。
