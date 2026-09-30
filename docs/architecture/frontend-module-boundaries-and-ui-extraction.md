# 前端 Module 边界与 UI 沉淀规范

状态：阶段二规范，2026-09-30

本文是 Uni-Lab 前端组件拆分、样式归属和 `lab-ui` 沉淀的规范。它适用于
`apps/*`、`packages/*` 中的 React UI、headless domain、Scenario 和 Adapter。

本文不规定具体页面的视觉方案，也不要求一次性重写所有历史 Module。后续改造按本文
逐个 Module 迁移，每次迁移都必须保持既有行为和可观察状态语义。

## 1. 术语和判断原则

本文使用以下架构术语：

- **Module**：有 Interface 和 Implementation 的单元，可以是页面、组件、Scenario、
  Domain slice、package 或 Adapter。
- **Interface**：调用者使用 Module 所需知道的全部内容，包括类型、状态、事件、约束、
  错误、排序、配置和样式语义，不只是 TypeScript 签名。
- **Implementation**：Module 内部的 JSX、状态、查询、映射、样式和副作用。
- **Depth**：Interface 提供的 Leverage 与 Implementation 复杂度之间的比例。Deep Module
  用较小 Interface 隐藏较多行为；Shallow Module 的 Interface 几乎等于 Implementation。
- **Seam**：Interface 所在的位置，行为可以在不修改调用方的情况下替换或扩展。
- **Adapter**：在 Seam 上提供具体实现的 Module，例如 OS Adapter 或宿主 Adapter。
- **Leverage**：调用者从 Module 获得的行为价值。
- **Locality**：维护者为了理解、修改和修复一个行为，需要跨越的范围。

判断一个拆分是否有价值时，使用三个测试：

1. **Deletion test**：删除这个 Module 后，如果复杂度只是原样移动到调用方，它是
   Shallow Module，不应为了行数而抽取。
2. **Interface test**：调用者是否可以只通过语义 Interface 使用它，而无需知道内部
   DOM、query、CSS class、backend URL 或状态存储。
3. **Seam test**：是否存在真实的第二个 caller 或第二个 Adapter。只有一个 caller 时，
   默认先保持 Feature-local；不要为了“可能复用”提前建通用抽象。

## 2. Module 分层

### 2.1 Product Host

Product Host 包括 Browser、Desktop、Workbench 和应用壳层。

负责：

- 进程、窗口、路由、工作区和文件系统接入
- Host layout、导航和能力开关呈现
- 选择 Scenario、注入 Adapter、挂载 UI Module

不负责：

- Workflow、Task、Job、Device、Material、Site、Inventory 等领域事实
- 领域状态机、资源准入、结算和 OS command 语义
- 为业务组件拼接 backend URL 或 wire DTO

### 2.2 Scenario Module

Scenario 是面向用户任务的编排 Module，例如 Run Preparation、Workflow Debugging、
Device Action Debugging 和 Laboratory Operations。

负责：

- 组合多个 Domain Port
- 保存场景草稿、selection、highlight 和 command intent
- 将 Domain projection 转换成 Scenario ViewModel
- 处理页面级 loading、error、empty 和 capability 降级

不负责：

- 复制 OS 事实
- 直接读取 React Query cache 作为权威
- 直接访问 `fetch`、URL 或 backend profile
- 把领域状态机塞进展示组件

### 2.3 Headless Domain Module

Headless Domain Module 位于 `packages/core` 等无 UI package 中。

负责：

- 投影类型和不变量
- Domain Port、错误和 capability 语义
- codec、presentation mapper 和可测试的纯规则

不允许依赖：

- React、Theia、Electron、AntD、Sass、CSS 或 design-v2 视觉实现
- Product Host、Feature UI、`lab-ui` 或旧兼容协议

`packages/core` 中的 codec 和 contract test 即使超过 400 行，也不能套用 React UI
拆分规则；应按 wire contract、projection 和错误语义判断是否需要建立新的 Seam。

### 2.4 Feature UI Module

Feature UI 是只服务一个业务场景或 feature 的 UI Module，例如任务详情、试剂库存表、
工作流节点编辑器和物料画布。

负责：

- 领域语义的展示和局部交互
- 由 Scenario 传入的 ViewModel 和 intent callback
- feature 自己的组合状态和视觉样式

允许依赖：

- 当前 feature 的 presentation mapper
- `lab-ui` 和 `design-v2` 的稳定 UI Module/token
- Scenario 提供的稳定 id、selection、highlight 和 command intent

不允许依赖：

- 其他 feature 的内部样式或内部状态
- 页面级 query cache 作为事实来源
- 直接访问 OS/backend

### 2.5 `lab-ui` Module

`lab-ui` 是跨 feature 的语义 UI Module，不是业务状态容器，也不是页面片段仓库。

适合沉淀的内容包括：任务进度、状态徽标、定义列表、Schema 字段、库存摘要、运行前
检查结果和稳定的选择器。页面编排、路由、query、mutation、capability 判断和领域
规则不进入 `lab-ui`。

### 2.6 Style Module

每个 UI Module 的结构和状态样式必须有明确 owner。Style Module 是 UI Module 的
Implementation，不是独立的全局覆盖层。

`packages/design-v2` 只拥有 foundation token、semantic token、主题、图标和第三方
适配；它不拥有任务、试剂、物料或工作流的业务样式。

## 3. Interface 与 Seam 规范

### 3.1 UI Module 的 Interface

UI Module 的 Interface 应优先使用语义 props：

```tsx
<TaskTimeline entries={entries} selectedTaskId={selectedTaskId} onSelectTask={onSelectTask} />
```

Interface 至少明确：

- 输入数据的稳定类型和缺失值语义
- loading、empty、error、unknown 和 disabled 状态
- 用户事件和事件顺序
- selection、highlight、stable id 的含义
- 可访问性要求
- 是否允许局部布局变体

Interface 不应暴露：

- `classNames` 对象或页面侧 CSS slot
- query key、React Query result、Zustand store
- backend/profile id 分支
- DOM selector、内部 class 名和实现细节
- 将 unknown 强制转换为零值或成功状态的隐式约定

根节点可以接受一个 `className` 用于宿主布局组合，但它只能影响宿主布局，不能作为
内部视觉规则的注入通道。`lab-ui` Module 默认不接受 `classNames` 对象和视觉 `style`
对象；需要尺寸或第三方宿主适配时，应使用明确的语义 prop 或公开的宿主 Seam。

### 3.2 什么时候建立 Seam

建立新 Seam 必须满足以下条件中的大部分：

- 有两个真实 caller，或有第二个真实 Adapter
- 概念在领域语言中稳定，而不是某个页面临时命名
- 调用者需要相同的状态、错误和可访问性语义
- 删除该 Module 会让多个 caller 重复实现同一复杂度
- Interface 可以比 Implementation 明显更小
- 可以通过 Interface 做独立测试

只有一个 caller 且只是把 JSX 逐行搬到新文件时，不建立公共 Seam；保持 Feature-local，
先收紧职责和 Locality。

### 3.3 页面与 Feature 的分界

页面 Module 可以编排，但不能同时拥有以下全部内容：

- 多个 query/mutation
- 领域 projection
- 多个独立交互意图
- 多个 modal/drawer/table/detail 视图
- 大量 DOM 结构和状态样式

如果页面同时包含其中三类以上，应先拆出 Feature-local Module。拆分顺序应是：

1. 先提取 projection、formatter 和纯状态转换
2. 再提取拥有完整交互意图的 presentation Module
3. 最后让页面只保留 Scenario/Feature 编排和布局

不要先按视觉区域拆出只转发 props 的浅层 wrapper。

## 4. `lab-ui` 沉淀门槛

一个 Module 只有同时满足以下条件，才可以从 Feature 提升到 `lab-ui`：

### 必须条件

- 有稳定、跨页面的语义名称
- Interface 不依赖具体页面、路由和 backend
- 样式由 Module 自己拥有
- 不接受 Feature 侧 `classNames` slot
- 不直接读写 query cache、store 或 OS Adapter
- 有覆盖主要状态和事件的测试
- 迁移后旧 Feature style owner 可以删除

### 推荐条件

- 至少两个真实 Feature caller
- 两个 caller 的视觉结构和状态语义一致
- Module 的删除测试表明复杂度会在多个 caller 间重复出现
- Module 有可复用的无障碍和 error/empty/unknown 语义

### 不应沉淀的内容

- 只有一个页面使用的完整页面 section
- 只为了降低行数而提取的 JSX wrapper
- 需要传入大量 `classNames`、`renderX` 和页面状态的“通用组件”
- 包含 query、mutation、capability 和 route 的业务容器
- 仍然依赖 `apps/developer-web` 样式的半迁移 Module

### 完整迁移单元

`lab-ui` 的一次沉淀至少包含：

```text
packages/lab-ui/src/<domain>/<Module>.tsx
packages/lab-ui/src/<domain>.module.scss
packages/lab-ui/src/<domain>/<Module>.test.tsx
packages/lab-ui/src/index.ts
```

如果存在独立公共类型，再增加 `types.ts`；不要把类型、样式或测试留在原 Feature
作为隐式 Implementation。

## 5. 样式 owner 合同

### 5.1 归属规则

| 样式内容                                    | 唯一 owner                     |
| ------------------------------------------- | ------------------------------ |
| token、主题、颜色模式、图标                 | `packages/design-v2`           |
| Host layout、导航、分栏、页面网格           | Product Host 或页面 Feature    |
| 业务 Module 结构、状态和交互态              | 该 UI Module 自己的 CSS Module |
| React Flow、Pascal、Theia 等第三方 DOM 合同 | 对应宿主/Adapter package       |
| core/domain 逻辑                            | 不拥有 CSS                     |

### 5.2 文件约定

组件和样式应尽量在同一个目录或同一个 domain 入口中：

```text
<Module>.tsx
<Module>.module.scss
<Module>.test.tsx
```

多个 Module 共享样式时，必须先确认它们共享的是稳定语义，而不是碰巧相似的 DOM。
共享样式应由明确的 domain Module 入口导出，不能通过全局 CSS 或聚合映射隐式共享。

### 5.3 禁止事项

- 新增 `styleMaps.ts` 或扩大现有全量 class 聚合
- 在多个业务 Module 定义相同的全局 class owner
- 从 `developer-web` 反向给 `lab-ui` 提供内部样式
- 用 `!important` 解决 owner 不清或加载顺序问题
- 在业务样式中复制 design-v2 token 的定义
- 通过 import 顺序决定两个 Module 的最终视觉结果

迁移期间允许保留 `styleMaps.ts` 作为兼容层，但只能减少引用，不能增加新 caller。
每次迁移必须同时删除旧 style owner 或标记明确的删除任务。

## 6. 拆分触发器

400 行不是硬阈值。以下信号用于决定是否需要重划 Module：

### 强触发器

- 一个 Module 同时处理三个以上独立交互意图
- 一个页面同时拥有 query、command、projection 和多个视图
- 组件需要 8 个以上 Hook，且 Hook 跨越多个职责
- 组件通过 5 个以上 style slot 接收外部样式
- 同一个样式文件覆盖两个以上业务领域
- 修改一个状态需要同时编辑页面、共享样式和 `styleMaps`

### 辅助信号

- 格式化后仍超过 400 行
- JSX 嵌套深度和条件分支明显增加
- 单文件无法通过 Interface 做独立测试
- 同一行为在两个 Feature 中复制
- 维护者需要跨三个以上目录才能理解一个交互

只有辅助信号而没有职责耦合时，不进行机械拆分。

## 7. 测试和验收

### Feature UI Module

测试：

- ViewModel 到 UI 的主要状态映射
- 用户事件和 intent callback
- loading、empty、error、unknown、disabled
- 关键可访问性标签和状态表达

禁止只用 snapshot 证明 Module 已经合理拆分。

### `lab-ui` Module

除上述测试外，还必须覆盖：

- 两个真实 caller 所需的 Interface
- 独立样式 owner 不依赖应用侧 class
- 状态 modifier 和语义 token
- 旧 Feature 样式删除后的页面回归

### Page/Scenario Module

测试页面编排、capability 降级、query/command 连接和真实错误语义；不重复测试已经由
`lab-ui` 完成的 DOM 细节。

### 每次迁移的完成定义

- [ ] Module 分类明确：Host、Scenario、Domain、Feature UI 或 `lab-ui`
- [ ] Interface、状态和事件语义写清楚
- [ ] Seam 不泄漏 query、store、route、backend 或 CSS class
- [ ] TSX、样式、类型和测试一起迁移
- [ ] 旧样式 owner 已删除或有明确删除任务
- [ ] 没有新增重复 class、变量或全量 style map 引用
- [ ] 目标 package typecheck 通过
- [ ] 相关单元测试和页面 smoke test 通过
- [ ] 无新增 `console.error`、`pageerror` 或未处理 Promise rejection

## 8. 改造工作流

每个后续改造批次按以下顺序执行：

1. 在盘点表中标记当前 Module 类型、caller 和 style owner。
2. 用 deletion test 判断应保持 Feature-local，还是建立新的 Seam。
3. 写出最小 Interface，包括状态、错误、事件和可访问性语义。
4. 将 projection、interaction、presentation 和样式拆成有 Locality 的 Module。
5. 若满足 `lab-ui` 门槛，同时迁移 TSX、样式、类型、测试和导出。
6. 迁移所有 caller，删除旧 owner 和兼容 class slot。
7. 运行 typecheck、测试、style quality 和页面验证。
8. 使用独立提交记录一个业务 Module 的完整迁移，不把无关 token 清理混入其中。

## 9. 非目标

本规范不要求：

- 立刻把所有组件移动到 `lab-ui`
- 为每个文件建立新的 wrapper 或 facade
- 把所有颜色一次性重命名成新 token
- 用 400 行规则阻断所有构建
- 将 `packages/core` 的 codec 按 React UI 方式拆分
- 恢复旧 Cloud panel、旧 Runtime 或第二套事实 store

后续阶段三应以本文为准，先选择一个 Feature-local Module 做完整迁移，再根据真实
caller 决定是否提升到 `lab-ui`。
