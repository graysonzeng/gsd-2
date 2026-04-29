# Phase-Discipline Loop Continuity Baseline Validation Design

**Status:** Draft  
**Created:** 2026-04-29  
**Topic:** phase-discipline auto-mode loop baseline validation  
**Scale:** M  
**Related:** `docs/superpowers/specs/2026-04-28-phase-discipline-loop-continuity-design.md`, `src/resources/extensions/gsd/auto/loop.ts`, `src/resources/extensions/gsd/auto/phases.ts`, `src/resources/extensions/gsd/auto/continuity-coordinator.ts`, `src/resources/extensions/gsd/auto/detect-stuck.ts`

## 1. 设计目标

本设计不直接修改 loop continuity 行为层，而是为后续第二批 coordinator 优化建立一份可复核的运行时基线。目标是回答三个问题：

1. 当前 `phase-discipline auto-mode loop` 的实际停机点主要落在哪些环节。
2. 哪些停机点在代码语义上已经被标记为可恢复或可继续，但运行时仍导致本次 invocation 结束。
3. 现有 observability 面是否足以支撑后续 coordinator 改造，以及缺口在哪里。

本设计的产出不是新代码，而是一套最小实证验证方案与文档更新规则，用于避免后续设计只停留在静态代码推断。

## 2. 背景与问题陈述

当前证据已经足够说明：

- loop 主骨架支持多轮推进：`runPreDispatch -> runGuards -> runDispatch -> runUnitPhase -> runFinalize -> while (s.active)`。
- 第一批 continuity 工作已经完成 `ContinuitySignal + BreakpointClass + continuity-decision journal + paused-session round-trip`。
- 当前 coordinator 仍是 emit-only owner，不负责 `signal -> loop action` 决策。
- loop 顶层对大多数 `break` 的处理仍是 `markLoopStop(...); break;`，这意味着 phase 已经提供语义分类，但行为层还没有按分类执行。

因此，“为什么 loop 会中断”这个架构结论已经比较明确；但“当前最常见的用户可见症状是什么、哪些场景最值得优先优化”仍缺少一轮轻量实证验证。

## 3. 非目标

本设计明确不做以下事情：

- 不直接实现 top-level coordinator 行为层。
- 不修改 `pauseAuto()` / `stopAuto()` 的副作用顺序。
- 不在本轮引入新的 continuation budget 模块。
- 不做完整 E2E 大回归。
- 不把 provider、preflight、scout fan-out 的独立问题混入本轮验证范围。

## 4. 规模判断

本次工作定为 **M 级**：

- 范围不是小修，因为要同时覆盖设计、运行时路径、证据面与后续文档衔接。
- 范围也不是 L 级，因为本轮不改行为层代码，只定义最小验证面与证据收集方式。
- 风险主要来自“文档边界写糊”，把验证基线误写成行为层实现设计，或把静态推断误写成已验证事实。

## 5. 方案比较

### 方案 A：直接继续 coordinator 第二批设计，不做运行时基线验证

#### 核心思路

- 认为现有静态代码与已有文档证据已经足够。
- 直接设计 `signal -> decision -> loop action` 的行为层。

#### 优点

- 推进最快。
- 不需要额外准备验证环境。

#### 缺点

- 容易把“代码推断”当成“运行时事实”。
- 后续文档与实现缺乏 before baseline，不利于 code review 判断收益是否真实。
- 若 phase 内已有副作用与顶层决策冲突，容易在行为层改造时误判优先级。

#### 结论

不推荐作为本轮主方案。

### 方案 B：先做最小实证验证，再更新 continuity 文档与第二批设计

#### 核心思路

- 不做大回归，只验证最能代表当前体验割裂的少量场景。
- 固定证据采集面：journal、loop report、paused-session metadata。
- 验证后再更新主设计文档与 next-session handoff。

#### 优点

- 成本可控，证据密度高。
- 能把“当前症状”从讨论转成稳定基线。
- 能明确哪些 gap 是行为层问题，哪些是 observability 不足问题。

#### 缺点

- 需要先梳理最小场景与证据模板。
- 会在第二批实现前增加一个短小的文档/验证步骤。

#### 结论

**推荐作为本轮主方案。**

### 方案 C：先做完整 E2E 回归，再统一更新所有 continuity 文档

#### 核心思路

- 尽可能模拟完整 milestone 推进。
- 一次性验证更多 phase 与断点类别。

#### 优点

- 覆盖最全。
- 理论上能暴露更多边缘路径。

#### 缺点

- 成本高，准备复杂。
- 容易把“验证基线”变成一个新的大项目。
- 在行为层尚未开始重构前，投入产出比不高。

#### 结论

不适合作为当前阶段的第一步。

## 6. 选定方案

本设计采用 **方案 B：最小实证验证优先**。

原因是：

- 当前根因已经通过代码和文档明确，不需要再用大规模验证证明“是不是这个问题”。
- 但仍需要一份轻量、稳定、可复核的基线，确认当前最值得优化的具体停机点。
- 基线先行可以降低后续 coordinator 设计把阶段副作用、停机语义和用户感知混写在一起的风险。

## 7. 当前 loop 运行链路与关键断点

### 7.1 顶层运行链路

当前 loop 顶层执行顺序为：

1. `runPreDispatch`
2. `runGuards`
3. `runDispatch`
4. `runUnitPhase`
5. `runFinalize`
6. 若 `s.active` 仍为 true，则进入下一轮迭代

该骨架说明 loop 本身支持多 unit 连续推进；真正导致 invocation 收口的是 phase 返回 `break` 后，顶层统一执行 `markLoopStop(...); break;`。

### 7.2 各阶段当前职责

#### Pre-dispatch

负责：资源版本检查、health gate、plan-v2 gate、里程碑切换、terminal/blocked 判断。

特点：职责重，已经直接承担 pause/stop 副作用，是后续 coordinator 设计的高风险边界。

#### Guards

负责：用户 stop/backtrack、budget ceiling、context window 等硬边界。

特点：A/B 类边界浓度高，不应被未来自动续跑策略吞掉。

#### Dispatch

负责：resolve next unit、pre-dispatch hooks、stuck detection、prior-slice blocker、scout fan-out。

特点：这里已经混合了 continue / pause / stop 三类决策，是当前最容易形成“语义已分类、行为仍割裂”的地带。

#### Unit

负责：真实执行 unit。

特点：本层不是当前 continuity 问题的主要矛盾，关键问题更多集中在 finalize 之后是否继续。

#### Finalize

负责：pre/post verification、UAT pause、step-wizard、verification retry。

特点：这里已经具备较强的 continuity 语义，例如 `artifact-verification-retry` 与 `verification-retry` 在 `runFinalize` 中会通过 `retryLoopContinue(...)` 直接返回 `continue`（见 `src/resources/extensions/gsd/auto/phases.ts` 中对应 return-site），是后续 top-level coordinator 最重要的输入面之一。

## 8. 最小验证场景

本轮验证只覆盖最能代表当前 continuity 体验问题的三组场景。

### 场景 A：`complete-slice -> validate-milestone`

#### 验证问题

slice 收口后，若 workflow 仍明确需要 `validate-milestone`，当前 invocation 是否仍然在中间停下。

#### 预计观测

基于现有设计与代码，预计该场景仍可能结束当前 invocation，而不是自动续跑到 milestone validate 完成。

#### 关键代码路径

- loop 顶层在任一 phase 返回 `break` 时，都会执行 `markLoopStop(...); break;`，见 `src/resources/extensions/gsd/auto/loop.ts` 中 pre-dispatch / guard / dispatch / unit / finalize 的 break 分支。
- 本场景重点观察 `complete-slice` 对应 iteration 的 `runFinalize` 返回值：若返回 `break`，invocation 会在 finalize 收口；若返回 `next`，则下一轮应重新进入 `runPreDispatch -> runDispatch`，由 workflow 解析出 `validate-milestone`。
- 因此验证时不能只看“workflow 下一步理论上是什么”，而要同时确认 finalize 返回动作与下一轮 dispatch 是否真的发生。

#### 通过条件

- 能明确记录这次 invocation 在哪个 phase/哪个 reason 停下。
- 能拿到停机前最后一个 `continuity-decision`。
- 能判断这是 A/B 类边界，还是本应属于 C 类 checkpoint 但仍被 break 终止。

### 场景 B：`validate-milestone(pass) -> complete-milestone`

#### 验证问题

milestone validate 判定通过后，当前 invocation 是否会继续进入 `complete-milestone`，还是仍然要求用户再次启动。

#### 预计观测

基于主设计文档中对第二批目标的描述，预计该场景目前仍未打通自动续跑。

#### 关键代码路径

- 本场景同样受 loop 顶层 `break => markLoopStop(...); break;` 约束，见 `src/resources/extensions/gsd/auto/loop.ts` 的 finalize / dispatch break 分支。
- 重点观察 `validate-milestone(pass)` 所在 iteration 的 `runFinalize` 返回值，以及下一轮 `runDispatch` 是否将 workflow 解析为 `complete-milestone`。
- 若 validate 已成功，但 finalize 仍返回 `break` 或下一轮 dispatch 没有出现 `complete-milestone`，则应将其记录为“validate 成功但 invocation 已结束”的已验证停机点。

#### 通过条件

- 能确认是否存在“validate 成功但 invocation 已结束”的现象。
- 若结束，能定位收口点是 finalize 语义、dispatch 解析还是 pre-dispatch 终态处理。

### 场景 C：retry 类路径是否真正在同次 invocation 内继续

覆盖两个重点：

- `artifact-verification-retry`
- `verification-retry`

#### 验证问题

这些路径虽然在代码上已经返回 `continue`，但运行时 report、journal 与用户可见状态是否也一致表达为“同次 invocation 内继续”，而不是被误读为 pause/stop。

#### 预计观测

该场景应当体现为 loop 内继续，而不是 paused-session 收口。

#### 通过条件

- `continuity-decision` 与 `auto-loop-report` 对 retry 语义一致。
- 不生成误导性的 paused-session 证据。
- 用户可见状态不会把 retry 误呈现成“需要人工恢复”。

## 9. 证据采集面

每个场景最少采集以下四类证据：

1. **journal 中的 `continuity-decision` 事件**
   - 确认 `sourcePhase`、`continuitySignal`、`breakpointClass`、`reason`。
   - 同时检查 `workflowStatusBefore` / `workflowStatusAfter` 是否被正确填充，以及它们是否足以解释“为什么当前 iteration 结束后 workflow 仍应继续”。
2. **`auto-loop-report.json`**
   - 确认 iteration 级别的 `status`、`failureClass`、`stopReason`。
3. **`paused-session.json`**
   - 仅在 pause 收口时采集，重点看 `lastContinuityDecision` 是否与 journal 一致。
4. **最终用户可见停机点**
   - 包括 UI notify / stop reason / 是否要求用户再次运行 `/gsd auto`。

可选补充证据：

- `runtime/stuck-state.json`，仅在场景 C 或 stuck 相关路径中需要。
- 对应 canonical artifact 是否已经落盘，用于判定“看似完成但 workflow 未前进”的矛盾场景。

## 10. 验证执行原则

### 10.1 最小而稳定

- 不追求一次覆盖所有断点类型。
- 每个场景只验证一条最关键链路。
- 优先使用已有测试夹具、最小 milestone 或可复用工程状态。

### 10.2 验证执行方式分层

本轮“验证”必须显式区分三种执行方式，并按以下优先级收集证据；未达到更高层时，不得把低层证据写成“已真实验证运行时行为”。

1. **测试驱动验证（首选）**
   - 优先扩展现有 auto-loop / continuity 相关测试，直接构造最小场景并断言 `continuity-decision`、`auto-loop-report`、必要时的 `paused-session` 元数据。
   - 适用：场景 C 的 retry 语义一致性；以及场景 A/B 中能通过最小 loop 夹具稳定复现的代码路径。
   - 结论口径：可声明为“已通过测试验证代码路径与产物证据”。

2. **真实运行验证（次选）**
   - 当测试不足以覆盖用户可见停机点时，在最小真实 GSD 项目上手动运行 `/gsd auto`，记录 journal、report、paused-session 与 UI stop reason。
   - 适用：场景 A/B 中“validate 成功但 invocation 已结束”这类需要结合用户可见表现判断的问题。
   - 结论口径：可声明为“已在最小真实项目上观察到的运行时行为”。

3. **代码路径分析（仅兜底）**
   - 仅当当前没有稳定测试夹具、且真实运行成本超出本轮 M 级边界时，允许退回到代码路径分析。
   - 必须明确标记为“代码路径分析/静态推断”，不得写成“已验证现状”。
   - 适用：尚未补齐测试夹具但需要先收敛下一步验证计划的场景。

### 10.3 先记录现状，再讨论优化

- 本轮不得在验证前先修改 coordinator 行为层。
- 如发现证据缺失，先记录 observability gap，再决定是否补测或补日志。
- 不把“预计观测”当成“已验证事实”写回主设计文档。
- 若某场景最终只完成到“代码路径分析”，必须在结论中单独标注，避免与测试驱动或真实运行证据混写。

### 10.4 验证结果必须能反哺文档

验证结束后，至少要更新两类文档：

- 主 continuity 设计文档：把“预计行为”替换为“已验证现状 + 目标行为”的差距描述。
- next-session handoff：补一段简短基线结论，说明第二批优先优化的真实停机点。

## 11. 风险与缓解

### 风险 1：把验证基线写成行为层设计

**缓解：** 本文档只定义验证目标、场景、证据与更新规则，不定义 coordinator 的具体实现细节。

### 风险 2：把静态代码推断误写成已验证事实

**缓解：** 文中涉及尚未跑通的结论一律使用“预计观测”表述；只有验证完成后才能更新为“已观察到”。

### 风险 3：验证范围膨胀

**缓解：** 固定为三组场景；新增场景只能在三组完成后再讨论，不在本设计内扩张。

### 风险 4：忽略 phase 内已存在的 pause/stop 副作用

**缓解：** 每次验证都同时看 `continuity-decision` 与 `paused-session.json`，避免只看顶层 report 就误判行为来源。

## 12. 验证完成后的文档更新规则

验证完成后，应将结果按如下结构补回主 continuity 文档或实施文档：

- **现状已验证行为**：列出真实停机点、触发 phase、reason、signal、breakpointClass，以及本次结论属于“测试驱动验证 / 真实运行验证 / 代码路径分析”中的哪一类。
- **与目标行为的差距**：说明该停机点为何不符合 C 类 checkpoint 应继续的预期。
- **observability 是否充分**：说明现有 journal/report/paused-session 是否足够，若不足则列为独立 gap。
- **对第二批优先级的影响**：说明应优先做 top-level coordinator、pause 权责收敛、还是 no-progress detector 升级。

最小充分性标准：如果仅凭 `continuity-decision` journal + `auto-loop-report.json`，并在 pause 场景下辅以 `paused-session.json`，就能还原“哪个 phase、什么 reason、什么 signal/breakpointClass 导致当前 invocation 结束或继续”，则 observability 视为充分；否则必须明确记录缺失字段或断裂环节。

## 13. 推荐下一步

验证基线文档确认后，下一步建议顺序为：

1. 依据本设计执行三组最小验证。
2. 将验证结果回写到 continuity 主设计与 handoff 文档。
3. 再进入第二批 coordinator 行为层设计或实现。

这样可以确保后续优化是建立在“当前系统真实表现”之上，而不是只建立在静态代码阅读之上。

## 14. 修订记录

- 2026-04-29：根据设计评审补充验证执行方式分层，明确“测试驱动验证 → 真实运行验证 → 代码路径分析”的优先级与结论口径。
- 2026-04-29：为场景 A/B 补充关键代码路径定位，避免执行时重复做静态代码定位。
- 2026-04-29：在证据采集面中加入 `workflowStatusBefore` / `workflowStatusAfter`，并补充 observability 充分性的最小判断标准。

## 15. 新会话恢复 prompt

```text
请阅读设计文档 docs/superpowers/specs/2026-04-29-phase-discipline-loop-continuity-baseline-validation-design.md，
先按文档执行 phase-discipline auto-mode loop 的最小实证验证设计，
重点验证以下三组场景：
1. complete-slice -> validate-milestone
2. validate-milestone(pass) -> complete-milestone
3. artifact-verification-retry / verification-retry 是否在同次 invocation 内继续

请收集 continuity-decision journal、auto-loop-report.json、paused-session.json(lastContinuityDecision) 等证据，
验证完成后再决定是否更新主 continuity 设计文档，以及第二批 coordinator 优化的优先方向。
```