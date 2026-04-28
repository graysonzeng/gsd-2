# Phase-Discipline Loop Continuity Design

**Status:** Draft  
**Created:** 2026-04-28  
**Topic:** phase-discipline auto-mode loop continuity  
**Related:** `src/resources/extensions/gsd/auto/loop.ts`, `src/resources/extensions/gsd/auto/phases.ts`, `src/resources/extensions/gsd/auto.ts`, `docs/superpowers/specs/2026-04-28-phase-discipline-continuation-contract-design.md`, `docs/superpowers/specs/2026-04-27-phase-discipline-readiness-guard-design.md`

> **分批实现说明（2026-04-28 更新）**
>
> 本方案按两批实现，参见 §12：
>
> - **第一批（本轮已实现）** = `ContinuitySignal` + `BreakpointClass` 语义模型 + phase return-site 显式打标 + loop 统一发射 `continuity-decision` journal 事件 + `lastContinuityDecision` 进入 session / paused-session 并 round-trip 验证。
> - **第二批（后续 PR）** = top-level Loop Continuity Coordinator + continuation budget + no-progress detector 升级 + `complete-slice → validate-milestone` / `validate-milestone(pass) → complete-milestone` 自动续跑 + `needs-remediation with generated slice` 自动转入 remediation dispatch。
>
> 第一批完成后，行为层仍保持原有 "phase break → markLoopStop" 的退出策略，仅补齐语义打标与可观测性；行为层 terminal-seeking 行为需在第二批中落地。


## 1. 设计目标

本设计解决的问题不是“headless 如何更诚实地描述当前状态”，而是更上游的运行时问题：

- 同一条 `headless auto` 调用经常只推进一个或少数几个 unit 就结束
- 外层命令可能成功结束，但 workflow 仍然 `needs-continue`
- 某些阶段会在没有明确人工介入需求的情况下提前结束本次 invocation
- 某些阶段会重复停在同一个 `unitType/unitId`，形成“可恢复但无进展”的空转

本设计的目标是让 `phase-discipline auto-mode` 在**安全前提满足时**尽量于**同一次 invocation 内推进到 milestone terminal condition**，而不是默认把后续 unit 留给下一次 `/gsd auto`。

## 2. 非目标

本设计明确不覆盖以下问题：

- provider/model readiness 的前置可用性设计
- reviewer prompt 质量优化
- scout fan-out 的子进程/子 agent 生命周期重构
- headless continuation contract 的文本展示设计
- 新的需求质量评分器或重量级 admission 机制
- 改写 auto-dispatch 的全部规则系统

这些能力可以与本设计配合，但不属于本次 loop continuity 方案的主目标。

## 3. 当前代码现实

### 3.1 loop 主骨架本身支持多 unit 连续推进

当前 `autoLoop` 的骨架是：

- `runPreDispatch`
- `runGuards`
- `runDispatch`
- `runUnitPhase`
- `runFinalize`
- 再次进入 `while (s.active)`

这说明 loop 主骨架并不是“天然一轮只跑一个 unit”。

### 3.2 真正导致 invocation 结束的是大量 break / pause 路径

当前会结束本次 invocation 的路径包括：

- `dispatch-stop`
- `pre-dispatch-block`
- `pre-dispatch-fanout-failed`
- `prior-slice-blocker`
- `uat-pause`
- `verification-pause`
- `post-verification-stopped`
- `step-wizard`
- `blocked`
- `stuck-detected`
- `stopAuto()` / `pauseAuto()` 直接把 `s.active` 置为 `false`

其中最关键的是 `pauseAuto()`：

- 写 `paused-session.json`
- closeout 当前 unit
- 释放锁
- `resolveAgentEnd`
- `s.active = false`
- `s.paused = true`

一旦进入 `pauseAuto()`，当前 invocation 必然结束，并等待下一次 `/gsd auto`。

### 3.3 当前系统把“所有可恢复中断”都近似当成“必须结束本次命令”

这是 loop continuity 不足的根本原因。当前系统没有把中断细分为：

- 真正需要人工介入的暂停
- 可由系统在同次 invocation 自动继续消费的检查点
- 需要重试但无需结束命令的过渡态
- 虽然可恢复，但已经连续无进展，应明确报错并停止的异常态

因此 runtime 会把很多“理论上可以继续”的场景，过早收敛成“本次先停”。

## 4. 成功标准

本设计希望达成的成功标准如下：

- 默认目标变为：`headless auto` 在安全边界内尽量跑到 milestone terminal condition
- 不再把所有 warning-level 或 recoverable 情况都自动转换为本次 invocation 结束
- 对每次 invocation 的结束原因提供结构化分类，而不是只给用户一个模糊的 `needs-continue`
- 对同一 unit 的重复停滞提供代码级 `no-progress` 检测与明确错误
- 不破坏已有必须人工介入的暂停语义，例如：UAT、人类 stop/backtrack、缺失 remediation、真实 provider 失败、真实安全门禁

## 5. 方案比较

### 方案 A：仅增强可观测性，不改行为

#### 核心思路

- 保持当前 `pauseAuto()` / `stopAuto()` 语义不变
- 只补 `break reason`、`workflow snapshot`、`no-progress` 观测数据
- 把“为何停下”和“后续是否还可继续”表达得更清楚

#### 优点

- 风险最小
- 不改核心行为
- 易于快速落地

#### 缺点

- 无法解决“同一 invocation 只能推进一小步”的核心体验问题
- 仍然需要多次调用 `/gsd auto`
- 只能解释问题，不能显著减少问题

#### 结论

不满足本次目标，不推荐作为主方案。

### 方案 B：选择性自动续跑

#### 核心思路

- 保留当前大多数 `pauseAuto()` 语义
- 只在少数白名单场景中，从“结束 invocation”改为“继续 loop”
- 例如：`complete-slice` 后若 next 为 `validate-milestone`，且没有任何 blocker，则继续

#### 优点

- 改动面中等
- 可以覆盖最常见的“还差一两步”的 case
- 比方案 A 更有实际收益

#### 缺点

- 行为会逐步变成规则补丁集合
- 容易在不同 phase 形成不一致语义
- 新增 phase 或断点后仍需要持续维护白名单
- 很难从根上回答“哪些中断必须结束 invocation”

#### 结论

比方案 A 好，但仍然偏症状驱动，不适合作为长期主架构。

### 方案 C：引入 loop continuity coordinator，让系统以 terminal-seeking 为默认策略

#### 核心思路

- 不再让所有 phase 直接把“可恢复中断”收敛成命令结束
- 将中断先统一抽象成结构化 `continuity signal`
- 由 loop 顶层的 `continuity coordinator` 决定：
  - 本次继续
  - 本次暂停
  - 本次停止
  - 本次完成
- 默认策略从“保守停下”改为“尽量继续跑到 milestone terminal condition”，但保留硬边界与预算

#### 优点

- 和本次目标最一致
- 能系统性统一各 phase 的暂停/继续语义
- 能把 `needs-continue` 从“下次再说”升级为“只在确实该停时才停”
- 为后续 headless 状态、DX、E2E 稳定性提供统一运行时基础

#### 缺点

- 设计与实现复杂度最高
- 需要调整 `runDispatch` / `runFinalize` / `pauseAuto` 相关路径的职责边界
- 如果 guardrails 不足，可能放大 runaway loop 风险

#### 结论

**推荐作为本次主方案。** 但必须采用“激进目标 + 强 guardrails + 分层回退”的设计，而不是直接删除所有 pause。

## 6. 选定方案

本设计采用：

- **目标层面：方案 C**
- **落地方式：分层推进**
- **安全原则：默认 terminal-seeking，但永远不跨过 human-required / safety-required 边界**

## 7. 核心设计

### 7.1 新概念：Continuity Signal

当前 phase 代码返回的是粗粒度：

- `next`
- `continue`
- `break`

这不足以表达“为什么 break，以及 break 后是否允许同次 invocation 自动续跑”。

设计新增统一概念：`ContinuitySignal`。

建议语义上至少覆盖以下类别：

- `complete`
  - 当前 milestone 或当前 invocation 达到终态
- `continue-loop`
  - 当前 phase 已完成，直接继续下一轮 loop
- `retry-loop`
  - 当前 unit 需要在同次 invocation 内重试
- `pause-human`
  - 必须结束本次 invocation，等待用户/人工动作
- `pause-provider`
  - provider 类故障导致的暂停，结束 invocation
- `pause-budget`
  - continuation budget 耗尽，属于软暂停，保留 resumable state
- `stop-error`
  - 结构性错误或安全错误，结束 invocation
- `stop-terminal`
  - 合法终态停止，例如 all complete
- `stop-no-progress`
  - 检测到空转，结束 invocation 并给明确错误

与现有 `PhaseResult.action` 的关系明确为：

- 第一批实现中，**保留** `PhaseResult.action = next | continue | break` 作为 loop/phase 的控制流骨架
- 新增 `ContinuitySignal` 作为 `break` / `continue` 路径的**结构化语义层**，例如 `PhaseResult.signal`
- 等 continuity contract 稳定后，再考虑是否让 `ContinuitySignal` 彻底取代现有 action 枚举

这样做的原因是：当前 loop、observer、journal、测试都强依赖 `PhaseResult.action`；首批落地不应同时重写控制流枚举和连续性语义层，否则回归面过大。

这里的关键不是名字，而是：**phase 不再只说“break”，还必须说“break 的语义类别”。**

### 7.2 新组件：Loop Continuity Coordinator

在 `autoLoop` 顶层新增 continuity 决策层，位置在每轮 `runFinalize` 之后、下一轮 `deriveState` 之前。

职责：

- 接收 phase 返回的 `ContinuitySignal`
- 重新读取 workflow snapshot
- 判断是否继续消费下一个 unit
- 应用 continuation budget / no-progress budget / deadline / safety gates
- 决定是否真的调用 `pauseAuto()` 或 `stopAuto()`

这意味着：

- `pauseAuto()` 不再是所有可恢复场景的默认出口
- phase 层优先产出“中断意图”
- 顶层 coordinator 再决定这次 invocation 是否真的结束

### 7.3 断点分类模型

所有可能导致 invocation 收口的事件，统一分成四类：

#### A. Human-required breakpoint

必须结束本次 invocation，不允许自动续跑：

- 用户 stop/backtrack
- UAT 需要人执行
- `needs-remediation` 但没有生成 remediation slice
- **显式声明** 为 `human-required` 的 escalation / gate
- 明确要求 pause 的交互式 wizard

这里采用 **opt-in** 规则，而不是开放白名单：

- 每个 gate / escalation 必须在自身结果里显式声明 `breakpointClass: "human-required"`
- 未声明者默认**不能**自动落入 A 类
- 若 coordinator 看到“需要确认”但没有明确分类，应按 D 类异常处理并报错，而不是静默替它做人工边界判断

这样可以避免随着 gate 增加，A 类边界再次变成无规则膨胀的补丁集合。

#### B. Safety-required breakpoint

必须结束本次 invocation：

- provider 失败
- session lock 丢失
- stuck hard stop
- invalid unit / artifact contradiction / DB contradiction
- budget hard ceiling
- infrastructure error

#### C. Auto-resumable checkpoint

原则上不应该结束本次 invocation，而应该继续 loop：

- `complete-slice` 后 next 为 `validate-milestone`
- `validate-milestone` 成功且 verdict=`pass`，next 为 `complete-milestone`
- `complete-milestone` 后 next 为后续 milestone 的 planning/research
- scout fan-out 成功后进入下一轮 dispatch
- artifact verification retry 仍在预算内

#### D. Suspicious no-progress breakpoint

不应无声结束 invocation，而应显式报错：

- 连续两次落到同一 `unitType/unitId`，workflow snapshot 不变
- next unit 不变，关键 artifact 未变化
- phase 宣称完成，但 canonical artifact 不存在
- workflow 声称 `needs-continue`，但 coordinator 无法拿到有效 next

### 7.4 新原则：只有 A/B 类断点才允许直接结束 invocation

这条原则是本设计最重要的行为改变。

当前问题的根因之一是：

- C 类 checkpoint 也常被转成 `pauseAuto()`

设计后：

- **A 类**：结束 invocation，暂停
- **B 类**：结束 invocation，暂停或停止
- **C 类**：默认继续 loop，不结束 invocation
- **D 类**：结束 invocation，但报 `NO_PROGRESS` 类明确错误，而不是静默 `needs-continue`

### 7.5 workflow snapshot 驱动的继续判定

coordinator 不能只依赖 phase 自己说“可以继续”，还要重新读取 workflow snapshot，至少看：

- `phase`
- `activeMilestone`
- `activeSlice`
- `activeTask`
- `next.action`
- `next.unitType`
- `next.unitId`
- registry 状态
- 关键 canonical artifact 是否存在

继续同次 invocation 的必要条件：

- 当前没有 A/B 类断点
- `workflowStatus = needs-continue`
- 存在明确的 `next.dispatch`
- next unit 与当前状态形成合法前进，而不是原地重复
- continuation budget 未耗尽

### 7.6 continuation budget

激进模式不能等于无限继续。需要新增预算限制：

- **per-invocation max unit budget**
  - 单次 invocation 最多连续消费 N 个 unit
- **same-unit retry budget**
  - 同一 unit 可重试的上限
- **same-phase no-progress budget**
  - 同一 phase 允许无结构性进展的最大次数
- **global deadline**
  - 继续复用现有 `maxDurationMs`

推荐原则：

- milestone terminal-seeking 是目标
- budget exhaustion 时，返回结构化 `pause-budget` / `continuity-budget-exhausted`，并保留可 resume 状态
- 预算耗尽不是错误，但必须被清晰记录

分类与行为明确如下：

- `per-invocation max unit budget` 耗尽
  - 归类为 **软暂停**，映射到 `pause-budget`
  - 行为等同 `pauseAuto()`，但 reason class 明确不是 human-required
  - `workflowStatus` 保持 `needs-continue`
- `same-unit retry budget` 耗尽
  - 与 `stop-no-progress` 合并语义
  - 统一报 `NO_PROGRESS_ON_UNIT`，避免同时存在“预算耗尽”和“空转”两套解释
- `same-phase no-progress budget` 耗尽
  - 归入 `stop-no-progress`
  - 不允许静默留给下一次碰运气

因此预算模型不是第五类 breakpoint，而是：

- 可安全恢复的 continuation 上限 → `pause-budget`
- 重试/重复已无进展 → `stop-no-progress`

### 7.7 no-progress detector 升级

当前 stuck detection 偏“重复派发同一 unit”。本设计将其升级为 phase-discipline-aware 的 `NoProgressDetector`。

判定维度：

- 最近两轮或三轮的 `unitType/unitId`
- workflow snapshot 是否变化
- 关键 artifact mtime/hash 是否变化
- validation verdict 是否变化
- next dispatch 是否变化

明确错误码建议包括：

- `NO_PROGRESS_ON_UNIT`
- `NO_PROGRESS_ON_VALIDATION`
- `WORKFLOW_SNAPSHOT_MISSING`
- `NEXT_UNIT_UNRESOLVABLE`
- `ARTIFACT_EXPECTED_BUT_MISSING`

#### 与现有 `detect-stuck.ts` 的整合策略

本设计不引入第二套平行 detector。`NoProgressDetector` 视为对现有 `auto/detect-stuck.ts` 的**演进**：

- 继续复用 `recentUnits` 滑动窗口与 `runtime/stuck-state.json` 持久化通道
- 保留现有 5 条规则作为第一层“快速 stuck 信号”
- 在其上增补 workflow snapshot / next dispatch / artifact 变化等 phase-discipline 维度
- 避免再创建第二份 stuck/no-progress 状态文件

统一映射原则：

- 现有 Rule 1（相同错误重复）、Rule 4（ENOENT 重复）、Rule 5（结构化 validation code 重复）
  - 归类为 **B 类 safety-required**
  - 更接近“继续也不会自愈”的结构性失败
- 现有 Rule 2 / 2b（同 unit 重复）、Rule 3（A↔B 振荡）
  - 归类为 **D 类 suspicious no-progress**
  - 这些问题需要明确报错，但不应再冒充 provider/safety 级故障
- 新增的 snapshot 不变 / next unit 不变 / artifact 未变化
  - 统一并入 D 类

也就是说：

- `detect-stuck.ts` 不是被废弃，而是被 continuity coordinator 重新解释和扩展
- “stuck hard stop”只保留给真正不可恢复的结构性 stuck
- “重复但未前进”默认进入 `stop-no-progress`

目标是让系统在“继续不了又没明显硬错”时，给出可操作错误，而不是继续靠用户人工猜测为什么要再跑一遍。

### 7.8 phase 级职责调整

#### `runDispatch`

当前很多路径在 dispatch 阶段直接 `pauseAuto()` 或 `stopAuto()`。

设计后：

- `runDispatch` 只返回结构化 continuity intent
- 对 A/B 类断点返回：`pause-human` / `pause-provider` / `stop-error`
- 对 scout 成功、advice 后合法跳转等 C 类场景，返回 `continue-loop`
- 不直接决定“本次命令是否结束”

#### `runFinalize`

`runFinalize` 是 loop continuity 的关键位置。

设计后：

- `verification-pause` 这类结果必须携带 pause reason class
- `post-verification-stopped` 必须区分：
  - 真的 terminal stop
  - human-required pause
  - suspicious no-progress stop
- `retry` 与 `continue-loop` 的语义边界明确化

#### `pauseAuto()`

`pauseAuto()` 保留，但只在 coordinator 最终决定本次 invocation 必须暂停时调用。

即：

- `pauseAuto()` 从“recoverable condition 的默认落点”
- 变成“顶层 continuity 决策的最终执行器”

### 7.9 `validate-milestone` / `complete-milestone` 特殊策略

A 方向最值得优先治理的是 milestone close 末段，因此设计要求：

#### `complete-slice -> validate-milestone`

若满足：

- slice 已完整 closeout
- verification 通过
- 当前 milestone 仍 active
- next = `validate-milestone`

则默认**同次 invocation 继续**，不因为“当前 unit 完成”就结束。

#### `validate-milestone -> complete-milestone`

若满足：

- `M###-VALIDATION.md` 存在
- verdict=`pass`
- close gate 满足

则默认**同次 invocation 继续**进入 `complete-milestone`。

若 verdict=`needs-remediation`：

- 已自动生成 remediation slice：继续 loop 到 remediation dispatch
- 未生成 remediation slice：`pause-human`

#### `complete-milestone -> next milestone`

若当前 milestone 完成后 registry 中仍有下一 milestone：

- **默认行为改为：暂停在当前 milestone terminal condition**
- 跨 milestone 自动续跑改为 opt-in 能力，例如 phase-discipline profile flag / headless 显式参数
- 即使 opt-in 生效，也必须受独立 budget 约束，推荐默认最多跨 **1 个 milestone**

原因不是技术上不能继续，而是 milestone 边界天然更接近用户希望介入的 review/demo/sign-off 检查点。把“跨 milestone 连跑”设为默认，会把本次设计从“修复 loop continuity”误扩展成“重定义 milestone 操作语义”。

## 8. 数据流

### 当前数据流

- phase 代码中途决定 pause/stop
- `pauseAuto()` 直接结束 invocation
- headless 再基于最终状态展示 `needs-continue`

### 目标数据流

- phase 产出 `ContinuitySignal`
- coordinator 读取最新 workflow snapshot
- coordinator 判定：继续 / 暂停 / 停止 / 完成
- 只有最终确认必须暂停时才调用 `pauseAuto()`
- headless 读取的是已经经过 continuity 规则处理后的终态

这会把“继续还是暂停”的 authoritative ownership 从零散 phase 挪到 loop 顶层。

## 9. 错误处理

### 9.1 provider 类错误

直接归为 `pause-provider` 或 `stop-error`：

- 不自动续跑
- 不冒充 `needs-continue`
- 保留 resumable state

### 9.2 人工介入类错误

直接归为 `pause-human`：

- 写 paused-session
- 给出明确恢复动作
- headless summary 明确展示 `human-required`

### 9.3 可疑空转

归为 `stop-no-progress`：

- 不再默认下一次继续碰运气
- 返回明确错误码、当前 unit、next unit、缺失 artifact 路径
- 让后续修复聚焦真实 contract 问题

### 9.4 workflow snapshot 异常

若 phase 声称可继续，但 snapshot 无法生成或 next 无法解析：

- 不允许静默结束为 `complete`
- 返回 `WORKFLOW_SNAPSHOT_MISSING` 或 `NEXT_UNIT_UNRESOLVABLE`
- 视为 `stop-error`

## 10. 可观测性

新增统一 `continuity-decision` 事件，建议记录：

- `sourcePhase`
- `unitType`
- `unitId`
- `continuitySignal`
- `breakpointClass`
- `workflowStatusBefore`
- `workflowStatusAfter`
- `nextAction`
- `nextUnitType`
- `nextUnitId`
- `humanRequired`
- `autoContinued`
- `continuationBudgetRemaining`
- `sameUnitRepeatCount`
- `noProgressEvidence`

落盘与回放约定：

- 第一优先：复用现有 journal 事件通道，与 `iteration-end` 同域保存
- 不新增第三套独立 JSON report，避免和 `auto-loop-report.json`、`paused-session.json` 再次分叉
- 若本轮最终进入 pause，则将**最后一次** `continuity-decision` 冗余写入 `paused-session.json`
  - 目的是让用户恢复前能直接看到“上次为什么停”
- 事件频率以“每轮 finalize/coordinator 决策一次”为上限，不要求 phase 内每个细枝末节都落盘

这样才能在真实 E2E 中快速回答：

- 为什么本次结束
- 为什么本次没有结束
- 为什么系统决定继续下一 unit
- 为什么系统判定已经空转

### 7.10 `pauseAuto()` 重构契约

评审指出的核心问题是：当前 `pauseAuto()` 不只是标记 `s.active = false`，它还承担多项有顺序的不可逆副作用。因此本设计明确约束如下：

- 第一批实现目标：**phase 不再把 `pauseAuto()` 当作 recoverable condition 的默认出口**
- `pauseAuto()` 的唯一权威调用方应逐步收敛到 top-level coordinator
- phase 层优先返回 pause intent，而不是自己完成 pause 副作用

`pauseAuto()` 的副作用顺序应被视为契约：

1. closeout 当前 unit（若需要）
2. 写 paused session / continuity snapshot
3. 释放 session lock
4. `resolveAgentEnd`
5. 设置 `s.active = false`、`s.paused = true`

由此衍生的 phase 端禁令：

- 在返回 `pause-*` signal 之前，不应做不可逆 closeout
- 不应在 phase 内部既执行 `pauseAuto()`，又返回一个还要让 coordinator 二次 pause 的 signal
- 若过渡阶段不得不保留历史代码路径，也必须把这些路径视为“legacy pause executor”，并在实现文档中列为待清理项

这条契约的意义不是首批就删光所有 `pauseAuto()` 调用，而是先把**唯一 authoritative owner** 从“分散 phase”明确迁移到“loop 顶层”。

### 7.11 与相邻设计的契约对接

#### 与 continuation-contract 的对接

本设计不重新定义 headless 的 command/workflow 双层状态，而是在其之上新增 continuity 细节。建议对接字段为：

- `pauseClass`
  - 例如 `human-required` / `provider` / `budget` / `no-progress`
- `continuitySignal`
  - 当前 invocation 最终的 continuity 决策
- `continuationBudgetRemaining`
  - 可选，便于解释为什么本次没继续

第一批不要求把所有字段都暴露到最外层 JSON 契约；但至少要保证：

- 内部 journal / paused-session 能看到这些字段
- headless summary 后续若要展示 pause class，有可复用来源

#### 与 readiness-guard 的对接

readiness-guard 属于 pre-dispatch 前置可用性约束，其失败默认归 **B 类 safety-required / stop-error** 范畴，而不是 C 类 auto-resumable checkpoint。

原因：

- 它表达的是“输入不满足当前 unit 的最低启动条件”
- 这类失败不应由 coordinator 自行 retry-loop 猜测恢复
- readiness 内部若要做轻量 retry，应在 readiness-guard 自身完成；coordinator 看到的 readiness failure 应视为已经定性的结果

## 11. 风险与缓解

### 风险 1：runaway loop

#### 风险

更激进地自动续跑，可能放大无限循环风险。

#### 缓解

- continuation budget
- same-unit retry budget
- no-progress detector
- 现有 maxIterations / maxDuration 保留

### 风险 2：误把人工检查点当成自动续跑点

#### 风险

可能跳过本应暂停等待人的步骤。

#### 缓解

- 明确 A 类 human-required breakpoint 白名单
- UAT / stop/backtrack / unresolved remediation 永远不可自动续跑
- 评审时重点审查 breakpoint classification

### 风险 3：phase 间职责重叠

#### 风险

`runDispatch`、`runFinalize`、`pauseAuto()`、headless summary 可能产生新一轮语义冲突。

#### 缓解

- 以 coordinator 为唯一 authoritative continuation owner
- phase 只返回 signal，不再各自决定命令生命周期
- headless 仅读取最终 continuity decision 结果

### 风险 4：行为变化影响已有脚本预期

#### 风险

现有依赖“单次调用只推进一部分”的脚本可能观察到更长运行时间或不同中间输出。

#### 缓解

- 增加显式配置开关，先以 phase-discipline profile 受控启用
- 保留 strict CI 语义与 timeout 控制
- 提供 parity/audit 事件对比

## 12. 实施范围建议

> **分批状态（2026-04-28 更新）**：本节原始定义为“第一批必须落地”8 项。经设计评审与实现评估后，拆成两批实现，避免单批改动面过大。下方清单按实际分批标注。

### 第一批（本轮已落地）

- [x] continuity signal 模型（`ContinuitySignal` / `BreakpointClass` 枚举 + `deriveContinuityDecision`）
- [x] breakpoint classification（枚举层面 + phase return-site 显式标注）
- [x] `continuity-decision` observability（journal event + `lastContinuityDecision` 持久化 + round-trip 兼容）

### 第二批（后续 PR，本轮不落地）

- [ ] top-level continuity coordinator
  - loop 主流程仍保持 "phase break → markLoopStop → break"；coordinator 决策层尚未上提。
- [ ] no-progress detector 升级
  - `detect-stuck.ts` 未变；§7.7 所列 snapshot 不变 / next unit 不变 / artifact 未变化的新维度尚未实现。
- [ ] `complete-slice → validate-milestone` 自动续跑
- [ ] `validate-milestone(pass) → complete-milestone` 自动续跑
- [ ] `needs-remediation with generated slice` 自动转入 remediation dispatch

> **第二批 handoff 入口**：新 PR 应以本设计 §7.2 / §7.6 / §7.7 / §7.8 / §7.9 为主线，引用第一批已落地的 signal/class 契约作为输入；可从 `loop.ts` 中 `buildPhaseContinuityDecision` / `emitContinuityDecision` 两个 helper 下沉出 coordinator 模块。

### 第一批不做（维持原样，与批次无关）

- 所有 phase 的一次性全面重构
- provider retry policy 重新设计
- reviewer prompt 改写
- query/status 协议重写

## 13. 验证计划

### 13.1 单元测试

- continuity signal mapping
- breakpoint classification
- continuation budget exhaustion
- no-progress detector
- snapshot missing / next unresolvable paths

### 13.2 集成测试

- `complete-slice` 后同次 invocation 自动进入 `validate-milestone`
- `validate-milestone(pass)` 后同次 invocation 自动进入 `complete-milestone`
- `needs-remediation` 且已生成 remediation slice 时继续 loop
- `needs-remediation` 且未生成 remediation slice 时 pause-human
- provider failure 仍 pause-provider，不自动续跑
- UAT pause 仍必须暂停

### 13.3 真实 E2E 验证

在隔离 repo 上至少验证：

- docs-only milestone 能于单次 `headless auto` 中尽量推进到 milestone terminal condition
- 若因安全原因未终结，headless summary 能明确给出 pause class
- 不再出现“只是需要继续下一 unit，但本次无明确原因提前结束”的模糊状态
- 若重复停在同一 `validate-milestone`，能够给出 `NO_PROGRESS` 错误，而不是继续模糊 `needs-continue`

### 13.4 回归门槛

除新增测试外，至少满足：

- 现有 phase-discipline 相关测试套件全部通过
- 现有 headless surface 测试全部通过
- `paused-session.json` 现有 schema 保持向后兼容（允许追加字段，不允许删除既有恢复所需字段）
- `auto-loop-report.json` 不因本次 continuity 改动而破坏既有消费方

## 14. 关键决策

- loop continuity 的 owner 应该在 `autoLoop` 顶层，而不是散落在 phase 内部
- `pauseAuto()` 必须从默认 recoverable 退出路径，降级为顶层最终执行器
- 默认策略从“保守停下”改为“在安全边界内尽量跑到 terminal condition”
- 只有 human-required / safety-required breakpoint 才能直接结束 invocation
- 对异常重复和伪继续，必须给结构化 `no-progress` 错误

## 15. 推荐后续

本设计属于 **L 级** 方案，下一步建议：

- 先执行 `/design-review` 做只读评审
- 重点挑战：
  - breakpoint classification 是否过激
  - coordinator ownership 是否清晰
  - auto-continue 边界是否会误跨人工 gate
  - no-progress detector 是否足够客观

如果评审通过，再进入 `/design-implement`。
