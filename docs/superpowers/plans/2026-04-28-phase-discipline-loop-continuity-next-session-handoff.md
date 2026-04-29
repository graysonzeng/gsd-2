---
topic: phase-discipline-loop-continuity
stage: next-session-handoff
design_doc: docs/superpowers/specs/2026-04-28-phase-discipline-loop-continuity-design.md
design_review_doc: docs/superpowers/plans/2026-04-28-phase-discipline-loop-continuity-design-review.md
implementation_doc: docs/superpowers/plans/2026-04-28-phase-discipline-loop-continuity-implementation.md
code_review_doc: docs/superpowers/plans/2026-04-28-phase-discipline-loop-continuity-code-review.md
date: 2026-04-28
---

# Next Session Handoff — Phase-Discipline Loop Continuity

## 1. 当前状态

当前 loop continuity 工作已经完成 **第一批 signal + observability 基线**，并完成对应 code review / fix follow-up。工作树在本 handoff 写入前经只读检查为 clean：

```bash
git status --short
# no output

git diff --stat
# no output
```

本轮不应被理解为“完整 loop continuity 行为层已经完成”。当前已完成的是第一批：显式语义打标、journal 可观测性、paused-session 恢复上下文；第二批 terminal-seeking 行为仍待新 PR 继续。

## 2. 已完成内容

### 2.1 设计与评审

- 设计文档：`docs/superpowers/specs/2026-04-28-phase-discipline-loop-continuity-design.md`
- 设计评审：`docs/superpowers/plans/2026-04-28-phase-discipline-loop-continuity-design-review.md`
- 评审结论：主方向合理，但原设计需要补齐 `pauseAuto` 契约、`detect-stuck.ts` 整合、budget 归类、相邻设计边界、跨 milestone 默认行为等。
- 设计文档已按评审意见修订，并在顶部与 §12 明确分成两批：
  - 第一批：signal + breakpoint class + return-site 标注 + continuity-decision journal + paused-session round-trip。
  - 第二批：top-level coordinator + continuation budget + no-progress detector 升级 + milestone close 自动续跑。

### 2.2 第一批实现

实现文档：`docs/superpowers/plans/2026-04-28-phase-discipline-loop-continuity-implementation.md`

已落地的主要代码能力：

- `src/resources/extensions/gsd/auto/types.ts`
  - 新增 `ContinuitySignal`。
  - 新增 `BreakpointClass`。
  - 新增 `ContinuityDecision` / `ContinuityDecisionInput` / `ContinuitySourcePhase`。
  - 新增 `deriveContinuityDecision()`。
  - 扩展 `PhaseResult`，允许携带 `signal` / `breakpointClass`。
- `src/resources/extensions/gsd/auto/loop.ts`
  - 新增 `buildPhaseContinuityDecision()`。
  - 新增 `emitContinuityDecision()`。
  - 在 `pre-dispatch` / `guard` / `dispatch` / `unit` / `finalize` 后统一发 `continuity-decision` journal event。
  - 每次 emit 同步刷新 `s.lastContinuityDecision`。
- `src/resources/extensions/gsd/auto/phases.ts`
  - 所有关键 `action: "break"` return-site 已显式附带 `signal` / `breakpointClass`。
  - 覆盖 budget、provider、human-required、terminal、no-progress、safety-required 等分类。
- `src/resources/extensions/gsd/auto/session.ts`
  - `AutoSession` 新增 `lastContinuityDecision`，reset 时清空。
- `src/resources/extensions/gsd/auto.ts`
  - `pauseAuto()` 写 `paused-session.json` 时追加 `lastContinuityDecision`。
- `src/resources/extensions/gsd/interrupted-session.ts`
  - `PausedSessionMetadata` 支持读取 `lastContinuityDecision`。
- `src/resources/extensions/gsd/journal.ts`
  - journal event type 支持 `continuity-decision`。

### 2.3 Code review 与修复

Code review 文档：`docs/superpowers/plans/2026-04-28-phase-discipline-loop-continuity-code-review.md`

初始结论为 `PASS_WITH_NOTES`。两项 HIGH 已修复并记录在 code review §7：

- HIGH-1：`deriveContinuityDecision()` 中 `budget-pause` legacy fallback 的语义地雷。
  - 已从 `HUMAN_REQUIRED_REASONS` 中移除 `budget-pause`。
  - 已清理 `breakpointClass` 三元死代码。
  - 已补 `budget-pause legacy fallback` 回归测试。
- HIGH-2：设计 §12 与实现文档 §5 对“第一批/第二批”的范围落差。
  - 已修订设计文档顶部与 §12。
  - 已修订实现文档 §5 / §6。
  - 明确本轮只完成第一批 signal + observability，第二批行为层另起 PR。

修复后结论：第一批达到可合入状态。需要注意：当前分支此前曾混合 loop-continuity / readiness-guard / headless-summary 三个 topic；合入前仍建议按 topic 拆 commit / PR。

## 3. 已验证结果

实现文档和 code review 记录的验证结果：

```bash
node --import ./src/resources/extensions/gsd/tests/resolve-ts.mjs \
  --experimental-strip-types --test \
  src/resources/extensions/gsd/tests/continuity-decision.test.ts \
  src/resources/extensions/gsd/tests/crash-recovery.test.ts \
  src/resources/extensions/gsd/tests/journal-integration.test.ts
# 52/52 passing

npm run typecheck:extensions
# passing

npm run build:core
# passing
```

测试日志中的 `checkpoint creation failed` / `resolveExpectedArtifactPath returned null` 等 warning 来自测试环境构造的非完整 git / artifact 场景，不是本次改动引入的新失败。

## 4. 明确未完成内容

以下是第二批范围，当前代码尚未完整实现：

- top-level Loop Continuity Coordinator。
- continuation budget 模块与实际决策逻辑。
- `detect-stuck.ts` 到 phase-discipline-aware no-progress detector 的升级。
- `complete-slice → validate-milestone` 自动续跑。
- `validate-milestone(pass) → complete-milestone` 自动续跑。
- `needs-remediation with generated slice` 自动转入 remediation dispatch。
- 行为层 terminal-seeking，即让单次 `headless auto` 在安全边界内尽量跑到 milestone terminal condition。

当前 loop 主行为仍是原来的：phase 返回 `break` 后走 `markLoopStop` / `break`，不会因为新增 `ContinuitySignal` 自动改变运行行为。

## 5. 剩余 follow-up

### 5.1 第一批的小尾巴

这些不阻塞第一批合入，但建议第二批前或第二批中处理：

- `custom-engine` 分支未发 `continuity-decision`。
  - 相关区域：`src/resources/extensions/gsd/auto/loop.ts` custom engine 区段。
  - 影响：custom-engine 用户 journal / paused-session 没有 continuity 事件。
- 两条 verification retry 路径未显式带 `reason` / `signal`。
  - 影响：journal 会把真实 retry 记作普通 `continue-loop`。
  - 建议：返回 `reason: "artifact-verification-retry"` / `reason: "verification-retry"`，或显式 `signal: "retry-loop", breakpointClass: "auto-resumable"`。
- `ContinuityDecisionInput.signal` 与 `breakpointClass` 类型层允许只给一半。
  - 建议改成 discriminated union，或加运行时守卫。
- `buildPhaseContinuityDecision()` 中 `"X" in args.result` 守卫冗余。
- 缺一条 loop/helper 层测试，直接断言 `emitContinuityDecision` 会写 journal 且刷新 `s.lastContinuityDecision`。

### 5.2 第二批主线

第二批建议不要一次性全做，建议拆成两个阶段：

#### 阶段 A：Coordinator 基础设施

目标：建立真正的 top-level continuity owner，但先尽量不放大自动续跑行为。

建议内容：

- 从 `loop.ts` 中现有 `buildPhaseContinuityDecision()` / `emitContinuityDecision()` 下沉或扩展出 coordinator 模块。
- 明确 `signal -> decision -> loop action` 的统一路径。
- 把 pause owner 逐步从 phase 内部收敛到 loop 顶层。
- 引入 continuation budget 的数据结构和 journal 字段。
- 处理 custom-engine 的 continuity event gap。
- 补 `signal` / `breakpointClass` 成对契约。

#### 阶段 B：Terminal-seeking 行为

目标：真正减少“单次 headless auto 只推进一小步”的体验问题。

建议内容：

- `complete-slice → validate-milestone` 自动续跑。
- `validate-milestone(pass) → complete-milestone` 自动续跑。
- `needs-remediation with generated slice` 自动转入 remediation dispatch。
- no-progress detector 增加 snapshot / next unit / artifact 变化等维度。
- 保留 milestone 边界默认暂停，跨 milestone 续跑作为 opt-in。

## 6. 下一步推荐动作

新会话建议按以下顺序推进：

1. 先读取本 handoff、设计文档、实现文档、code review 文档。
2. 快速复核当前工作树与分支状态。
3. 若目标是合入第一批：
   - 按 topic 拆 commit / PR：loop-continuity、readiness-guard、headless-summary。
   - 不要把第二批行为层混入第一批合入。
4. 若目标是继续第二批：
   - 先使用 `/design-brainstorm` 或 `/design-implement` 明确阶段 A 的最小实现边界。
   - 不要直接上来就改 `pauseAuto()`；先定义 coordinator 如何接管 pause intent 与副作用顺序。
   - 第一批的 `ContinuitySignal` / `BreakpointClass` / `continuity-decision` 是第二批输入契约，优先复用，不要重写。
5. 第二批实现前先补或至少计划处理 §5.1 的 MEDIUM gaps，特别是 custom-engine continuity event 与 retry 语义保真。

## 7. 新会话恢复 prompt

```text
请阅读以下文件：

1. docs/superpowers/plans/2026-04-28-phase-discipline-loop-continuity-next-session-handoff.md
2. docs/superpowers/specs/2026-04-28-phase-discipline-loop-continuity-design.md
3. docs/superpowers/plans/2026-04-28-phase-discipline-loop-continuity-implementation.md
4. docs/superpowers/plans/2026-04-28-phase-discipline-loop-continuity-code-review.md

当前状态：phase-discipline loop continuity 第一批 signal + observability 已实现并通过定向测试、typecheck、build；code review 的 HIGH-1/HIGH-2 已修复。第二批行为层尚未完成，包括 top-level coordinator、continuation budget、no-progress detector 升级、complete-slice → validate-milestone、validate-milestone(pass) → complete-milestone、needs-remediation with generated slice 自动续跑。

请先只读复核当前代码和文档状态，然后根据目标选择：

A. 若目标是合入第一批：按 topic 拆 commit / PR，避免混合 loop-continuity / readiness-guard / headless-summary。
B. 若目标是继续第二批：使用 /design-brainstorm 或 /design-implement，优先设计/实现 coordinator 基础设施，不要直接扩大 auto-continue 行为；复用第一批的 ContinuitySignal / BreakpointClass / continuity-decision 契约。
```

## 8. 不要做

- 不要把第一批误判为“完整 loop continuity 已完成”。
- 不要在未设计 coordinator 副作用顺序前直接移动或删除 `pauseAuto()` 调用。
- 不要默认跨 milestone 自动续跑；设计文档已改为 opt-in。
- 不要把 provider/preflight/scout fan-out 问题混入本 topic 的第二批行为层实现。
- 不要在合入第一批时继续扩大行为变更；第一批应保持 signal + observability 基线。
