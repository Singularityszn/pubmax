---
name: tailwind-to-stylex
description: >-
  将 TailwindCSS 迁移到 StyleX。适用于把 Tailwind 的 `className` 工具类字符串转换
  为使用 `stylex.props` 或 `stylex.attrs` 的 `stylex.create`。可用于单个组件或整个
  代码库，覆盖 React、Preact、Solid、Svelte、Vue、Qwik、react-strict-dom 以及
  StyleX 支持的其他 JavaScript 框架。触发词：tailwind-to-stylex、tw-to-stylex，
  或任何把代码从 Tailwind 迁移到 StyleX 的请求。
compatibility: 已配置 @stylexjs/stylex 及其编译器插件的 JavaScript 项目。未配置 StyleX 时，参见 references/stylex-rules.md 的项目设置一节。
---

> English: [SKILL.md](SKILL.md)

# 将 Tailwind 迁移到 StyleX

把 Tailwind 工具类转换为 StyleX 样式。将 `className="..."` 字符串替换为 `stylex.create({...})` 调用中的条目，并用 `stylex.props(...)` 应用它们。

保持渲染结果不变。迁移过程中不要重新设计组件。某个样式无法精确转换时，在第 6 步中标记出来，而不是悄悄改动设计。

## 核心机制：先解析，再重塑

按 `tw-to-stylex` codemod 的同样方式转换类字符串：先把每个类解析成它产出的 CSS，再把这段 CSS 重塑为 StyleX 对象。不要凭类名猜测——计算出的 CSS 才是必须保持完全一致的行为。

```
"px-4 py-2 text-sm font-medium hover:bg-blue-600"
        │
        ▼   resolve to CSS using the project's Tailwind version and config
padding-inline: 1rem; padding-block: .5rem;
font-size: .875rem; line-height: 1.25rem; font-weight: 500;
:hover { background-color: #2563eb }
        │
        ▼   reshape to StyleX with camelCase properties and conditional values
{
  paddingInline: '1rem',
  paddingBlock: '0.5rem',
  fontSize: '0.875rem',
  lineHeight: '1.25rem',
  fontWeight: 500,
  backgroundColor: { default: null, ':hover': '#2563eb' },
}
```

当类使用了任意值（如 `w-[37px]`）、项目自定义主题或插件时，解析成 CSS 依然可行，因为值来自类本身或项目配置。当自定义配置或不熟悉的插件让输出不明确时，查看项目的 `tailwind.config` / CSS `@theme`，或者实际解析它，而不是猜测。

## 两个容易让转换翻车的地方

### 条件写在属性值里

Tailwind 把 `hover:`、`md:`、`dark:` 这类状态与响应式变体分散在不同规则里。StyleX 则把条件嵌在属性值内部。只要属性带有条件，`default` 键就是必需的。没有基础值时用 `null`。缺少 `default` 时，StyleX 可能会忽略该条件。

```tsx
// md:flex hover:opacity-80  ->  conditions live on each property
display: { default: 'block', '@media (min-width: 768px)': 'flex' },
opacity: { default: 1, ':hover': 0.8 },
```

### 某些选择器需要结构性改动

`space-x-*`、`divide-*`、`group`/`group-hover:*`、`peer`/`peer-*:*` 以及 typography 的 `prose` 都依赖后代、兄弟或祖先状态选择器。StyleX 只作用于单个元素，因此这些无法直接映射。对它们做结构性重构并告知用户。例如，用 flex 父元素上的 `gap` 替换 `space-x`，或把 `group-hover` 状态上提到 React 或 CSS 变量中。各情况的处理见 `references/mapping.md`。

## 工作流程

一次处理一个组件文件，让每处改动都保持可评审。

### 第 1 步：确认 StyleX 已就绪

StyleX 需要 `@stylexjs/stylex` 以及适用于 Babel、Vite、Next.js、Webpack 或 rspack 的编译器插件。没有插件时，`stylex.props` 在运行时什么也不返回，迁移看起来像是坏的。检查 `package.json` 和打包器配置。若尚未配置，阅读 `references/stylex-rules.md` 的项目设置一节。用户要求配置时才动手配置，否则在转换前说明缺了什么。同时识别 React DOM 与 `react-strict-dom`，因为它们应用样式的方式不同。

### 第 2 步：找出 Tailwind 的使用点

找出文件里所有的 `className` 和 `class`，包括对 `cn(...)`、`clsx(...)`、`twMerge(...)` 的动态调用、模板字符串和三元表达式。你需要的是每个元素可能应用到的*完整*类集合及其生效条件，才能忠实转换。

### 第 3 步：构建 `stylex.create` 对象

为每个不同的元素或变体创建一个命名条目，例如 `base`、`label` 或 `iconActive`。使用描述性名称而不是 `$1`、`$2`。把每个条目的类解析成 CSS，然后应用以下 StyleX 规则：

- 每个属性都用 camelCase。例如 `border-radius` 写作 `borderRadius`。
- 使用 longhand 或单值 shorthand。StyleX 会对多值 shorthand 发出警告，因为它们引发合并冲突。把 `border: '1px solid red'` 拆成 `borderWidth: 1, borderStyle: 'solid', borderColor: 'red'`。双值 `padding` 拆成 `paddingBlock` / `paddingInline`。像 `padding: 16` 这样的单值 shorthand 是合法的。
- 长度属性的数字代表 px。`width: 24` 即 24px。其他单位保持字符串形式，如 `'1.5rem'`、`'50%'`、`'100vh'`。
- 条件属于属性值且必须有 `default`。按 mobile-first 顺序，无前缀的类就是 `default`；断点变成带 `min-width` 的 `@media` 键。
- 状态、暗色模式、结构选择器、任意值、渐变与动画的修饰符到条件的对照表在 `references/mapping.md`。遇到纯工具类之外的任何东西都去读它。

### 第 4 步：应用样式

对每个框架，前三步都相同。变化的只是应用器（applicator）：

- 在 React DOM、Preact、react-strict-dom 及其他 JSX 展开框架中，展开 `stylex.props(...)`，它返回 `{ className, style }`。
- 在 Solid、Svelte、Vue、Qwik 及其他非 React 框架中，使用 `stylex.attrs(...)`。它返回普通 `class` 字符串和字符串形式的 `style` 值，绑定到元素上。样式传入顺序与 `stylex.props` 相同。

之后，无论使用哪种应用器：

- 把结果直接应用到 `div`、`span`、`button` 这类小写宿主元素上。替换掉原来的 `className` 或 `class`。
- 组件不会自动接受 `stylex.props` 或 `stylex.attrs` 的输出。通过 `style` prop 传递样式 token，让组件在自己的宿主元素上应用它们。不要把应用器输出直接倒在组件上就默认它能用。
- 保留条件组合。应用器从左到右合并、后者胜出，与 `cn(...)` 一致。`cn('base', isActive && 'active')` 变成 `stylex.props(styles.base, isActive && styles.active)` 或同样的 `stylex.attrs` 调用。外部传入的覆盖值保持在最后，调用方仍然能赢。

### 第 5 步：在有价值时提取重复的设计 token

如果品牌色、间距步进或其他主题值在文件里反复出现，或项目使用语义化 token，考虑在 `.stylex.ts` 文件中用 `stylex.defineVars`，而不是写死。`createTheme` 的变量还能替代基于类的 `dark:` 主题方案。参见 `references/stylex-rules.md` 的主题化一节。一次性出现的值不要强行套用。

### 第 6 步：报告未转换的部分

在总结中列出基于选择器的工具类、未能解析的类，以及没有直接映射的标记改动。未加提示就丢失 hover、暗色模式或响应式样式，是这里最要命的失败。

### 第 7 步：验证

对改动过的文件运行类型检查和 linter。若项目装有 StyleX ESLint 插件，它会捕获非法 shorthand、缺失的 `default` 和未知属性。修复它报出的每一项。确认已迁移元素上没有遗留的 `className` / Tailwind 导入。只有在整个代码库都迁移完成之后才移除 Tailwind 指令与配置，而不是迁完一个文件就动手。若依赖未安装，如实说明，并把该检查标记为结构性检查，而不是声称它已运行。

## 完整示例

```tsx
// Before
import { cn } from '@/lib/utils'

export function Badge({ active, className }: Props) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold',
        active ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600',
        className,
      )}
    >
      Status
    </span>
  )
}
```

```tsx
// After
import * as stylex from '@stylexjs/stylex'

const styles = stylex.create({
  base: {
    display: 'inline-flex',
    alignItems: 'center',
    borderRadius: '9999px',
    paddingInline: '0.625rem',
    paddingBlock: '0.125rem',
    fontSize: '0.75rem',
    lineHeight: '1rem',
    fontWeight: 600,
  },
  active: { backgroundColor: '#dcfce7', color: '#166534' },
  inactive: { backgroundColor: '#f3f4f6', color: '#4b5563' },
})

export function Badge({ active, style }: Props) {
  return (
    <span
      {...stylex.props(styles.base, active ? styles.active : styles.inactive, style)}
    >
      Status
    </span>
  )
}
```

`text-xs` 同时产出 `font-size` 和 `line-height`，所以转换把两者都保留。调用方的覆盖值从 `className` 移到了 `style`，因为 StyleX 传递的是样式而不是类字符串。`cn` 的三元表达式变成了 `stylex.props` 的三元表达式，后者胜出的顺序不变。本示例使用 React。在 Solid、Svelte、Vue 和 Qwik 中，`styles` 对象逐字节相同，只是 `stylex.props` 调用换成 `stylex.attrs`，并按各框架绑定属性的方式绑定返回的 `class`/`style`。

## 参考文件

- `references/mapping.md` 包含 Tailwind 修饰符与变体对照表，以及处理 `space-x`、`divide`、`group`、`peer`、暗色模式、任意值、渐变、伪元素、动画和 `sr-only` 的方法。遇到纯单值工具类之外的任何内容都去读它。
- `references/stylex-rules.md` 涵盖 StyleX 编写规则、常见错误、项目设置、`stylex.props` 与 `stylex.attrs` 的框架支持，以及 `defineVars` 和 `createTheme` 的主题化。配置 StyleX、迁移非 React 框架，或 ESLint 插件报出问题时去读它。
