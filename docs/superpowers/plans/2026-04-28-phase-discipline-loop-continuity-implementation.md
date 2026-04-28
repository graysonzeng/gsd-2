---
topic: phase-discipline-loop-continuity
stage: design-implement
design_doc: docs/superpowers/specs/2026-04-28-phase-discipline-loop-continuity-design.md
review_doc: docs/superpowers/plans/2026-04-28-phase-discipline-loop-continuity-design-review.md
date: 2026-04-28
---

# Implementation — Phase-Discipline Loop Continuity

## 1. 评审意见处理摘要

### 已采纳

1. **不要把 continuity 语义继续隐含在 `PhaseResult.action` 和 reason 字符串里**
   - 已采纳。
   - 动作：在 `src/resources/extensions/gsd/auto/types.ts` 新增 `ContinuitySignal`、`BreakpointClass`、`ContinuityDecision` 与 `deriveContinuityDecision()`，把 loop continuity 收敛成显式契约。

2. **pause / stop / retry / continue 需要可区分的结构化语义，而不是统一落到 break/continue/next**
   - 已采纳。
   - 动作：扩展 `PhaseResult`，允许 phase 在保留现有 control-flow 结构的同时，显式附带 `signal` 与 `breakpointClass`。

3. **恢复链路必须保留 continuity 上下文，不能只保存 milestone / unit 粗信息**
   - 已采纳。
   - 动作：把 `lastContinuityDecision` 写入 session 内存与 `paused-session.json`，并补 round-trip 测试锁定兼容性。

4. **需要 observability，外部必须看得到 loop 在每个 phase 上是“继续、重试、暂停还是终止”**
   - 已采纳。
   - 动作：新增 journal event `continuity-decision`，由 loop 在 `pre-dispatch / guard / dispatch / unit / finalize` 每个阶段统一发射。

5. **不要做大重构，优先低风险收敛真实 gap**
   - 已采纳。
   - 动作：本轮没有推倒 loop 主流程；只是在现有 `PhaseResult` / phase return-site / pause metadata / journal 上补显式 continuity 契约。

### 部分采纳

1. **所有 phase 出口一次性完全标准化**
   - 部分采纳。
   - 结论：本轮优先修正真正会误导恢复和外部观测的 break 路径，包括 dispatch-stop、finalize-timeout、budget pause、provider pause、stuck/no-progress、merge/worktree/capability 等；不做无差别重写。

## 2. 设计修订摘要

已更新设计文档 `docs/superpowers/specs/2026-04-28-phase-discipline-loop-continuity-design.md`，主要修订如下：

- 明确区分 loop control action 与 continuity semantics，不再混用。
- 增补 `pause-budget`，避免预算暂停被归入一般 human pause。
- 把 stuck/no-progress 纳入 continuity 体系，而不是作为孤立异常路径。
- 明确 `pauseAuto` / resume / interrupted-session 需要携带 continuity 上下文。
- 增加 journal / headless summary 所需的结构化观测要求。
- 将验证目标从“行为大致可用”收敛为“语义可判定、可恢复、可观测、可回归验证”。

## 3. 实现摘要

### 3.1 continuity 契约与派生逻辑

修改：
- `src/resources/extensions/gsd/auto/types.ts`

实现点：
- 新增 `ContinuitySignal`：
  - `complete`
  - `continue-loop`
  - `retry-loop`
  - `pause-human`
  - `pause-provider`
  - `pause-budget`
  - `stop-error`
  - `stop-terminal`
  - `stop-no-progress`
- 新增 `BreakpointClass`：
  - `human-required`
  - `provider`
  - `safety-required`
  - `auto-resumable`
  - `no-progress`
  - `budget`
  - `terminal`
  - `unknown`
- 新增 `ContinuityDecision` / `ContinuityDecisionInput` / `ContinuitySourcePhase`。
- 新增 `deriveContinuityDecision()`，把旧的 `action + reason` 投影为显式 continuity decision。
- 扩展 `PhaseResult`，允许 phase return-site 直接返回 `signal` 和 `breakpointClass`，减少后续依赖 reason 猜语义。

### 3.2 session / pause metadata 持久化

修改：
- `src/resources/extensions/gsd/auto/session.ts`
- `src/resources/extensions/gsd/auto.ts`
- `src/resources/extensions/gsd/interrupted-session.ts`

实现点：
- `AutoSession` 新增 `lastContinuityDecision`，并在 reset 时清空。
- `pauseAuto` 写入 `paused-session.json` 时新增 `lastContinuityDecision`。
- `PausedSessionMetadata` 扩展为可读取 `lastContinuityDecision`。
- 保持向后兼容：旧版没有该字段的 paused metadata 仍可正常读取。

### 3.3 loop 统一发射 continuity-decision journal event

修改：
- `src/resources/extensions/gsd/journal.ts`
- `src/resources/extensions/gsd/auto/loop.ts`

实现点：
- `JournalEventType` 新增 `continuity-decision`。
- loop 中新增统一 helper，把 phase result 转换为 `ContinuityDecision` 并写入 journal。
- 在以下 phase 后统一发射 continuity 事件：
  - `pre-dispatch`
  - `guard`
  - `dispatch`
  - `unit`
  - `finalize`
- 每次发射同时刷新 `s.lastContinuityDecision`，保证 pause/resume 看到的是最新真实决策。

### 3.4 phase return-site 显式 continuity 标注

重点修改：
- `src/resources/extensions/gsd/auto/phases.ts`

本轮显式标注了真实会影响恢复/观测判断的 break 路径，包括但不限于：

- `finalize-pre-timeout` / `finalize-post-timeout`
  - `pause-human` / `human-required`
- `resources-stale`
  - `stop-error` / `safety-required`
- `health-gate-failed`
  - `pause-human` / `human-required`
- `plan-v2-gate-failed`
  - `pause-human` / `human-required`
- `slice-parallel-dispatched`
  - `stop-terminal` / `terminal`
- `merge-conflict`
  - `pause-human` / `human-required`
- `merge-failed`
  - `stop-error` / `safety-required`
- `no-active-milestone`
  - `stop-terminal` / `terminal`
- `merge-reconciliation-blocked`
  - `pause-human` / `human-required`
- `no-milestone-after-reconciliation`
  - `stop-error` / `safety-required`
- `milestone-complete`
  - `stop-terminal` / `terminal`
- `blocked`
  - `pause-human` / `human-required`
- `dispatch-stop`
  - warning 级：`pause-human` / `human-required`
  - 其他级：`stop-error` / `safety-required`
- `pre-dispatch-block`
  - warning 级：`pause-human` / `human-required`
  - 其他级：`stop-error` / `safety-required`
- `complete-milestone-artifact-db-mismatch`
  - `stop-no-progress` / `no-progress`
- `stuck-detected`
  - `stop-no-progress` / `no-progress`
- `prior-slice-blocker`
  - `pause-human` / `human-required`
- `pre-dispatch-fanout-failed`
  - `pause-human` / `human-required`
- `user-stop` / `user-backtrack`
  - `pause-human` / `human-required`
- `stop-guard-error`
  - `stop-error` / `safety-required`
- `budget-halt` / `budget-pause`
  - `pause-budget` / `budget`
- `context-window`
  - `pause-human` / `human-required`
- `worktree-invalid`
  - `stop-error` / `safety-required`
- `workflow-capability`
  - `stop-error` / `safety-required`
- `provider-pause`
  - `pause-provider` / `provider`
- `session-timeout`
  - 可自动恢复：`pause-provider` / `provider`
  - 不可自动恢复：`pause-human` / `human-required`
- `unit-hard-timeout`
  - `pause-human` / `human-required`
- `session-failed`
  - `stop-error` / `safety-required`
- `git-closeout-failure` / `pre-verification-dispatched`
  - `pause-human` / `human-required`
- `uat-pause`
  - `pause-human` / `human-required`
- `verification-pause`
  - `pause-human` / `human-required`
- `post-verification-stopped`
  - `stop-error` / `safety-required`
- `step-wizard`
  - `pause-human` / `human-required`

### 3.5 测试补强

新增：
- `src/resources/extensions/gsd/tests/continuity-decision.test.ts`

修改：
- `src/resources/extensions/gsd/tests/crash-recovery.test.ts`
- `src/resources/extensions/gsd/tests/journal-integration.test.ts`

覆盖点：
- `deriveContinuityDecision()` 的核心语义映射：
  - `next -> continue-loop`
  - `verification-retry -> retry-loop`
  - `provider-pause -> pause-provider`
  - `budget-pause -> pause-budget`
  - `milestone-complete -> stop-terminal`
  - `stuck-detected -> stop-no-progress`
  - 显式 signal/class 透传
- `paused-session.json` 对 `lastContinuityDecision` 的 round-trip 持久化。
- integration 测试新增断言：
  - `complete-milestone-artifact-db-mismatch` 返回 `stop-no-progress / no-progress`
  - genuinely stuck 的 repeated dispatch 返回 `stop-no-progress / no-progress`
  - `prior-slice-blocker` 返回 `pause-human / human-required`

## 4. 验证结果

### 4.1 定向测试

已执行：

```bash
node --import ./src/resources/extensions/gsd/tests/resolve-ts.mjs --experimental-strip-types --test src/resources/extensions/gsd/tests/continuity-decision.test.ts src/resources/extensions/gsd/tests/crash-recovery.test.ts src/resources/extensions/gsd/tests/journal-integration.test.ts
```

结果：**51/51 通过**。

说明：测试日志中出现的 recovery / safety warning 来自测试环境刻意构造的非完整 git / artifact 场景，不影响断言结果，也不是本次改动引入的新失败。

### 4.2 Typecheck

已执行：

```bash
npm run typecheck:extensions
```

结果：**通过**。

### 4.3 Build

已执行：

```bash
npm run build:core
```

结果：**通过**。

## 5. 已知限制

> **批次声明（2026-04-28 更新）**：本实现文档对应设计 §12 **第一批（signal + observability）**。原 §12 中列出的 "第一批必须落地" 8 项已在设计文档顶部与 §12 重新标注为两批，以下 6 项属于**第二批（后续 PR，不在本轮落地）**：
>
> - top-level continuity coordinator（loop 主流程仍为 "phase break → markLoopStop"，尚未上提决策层）
> - continuation budget（尚未新增模块）
> - no-progress detector 升级（`detect-stuck.ts` 未变，设计 §7.7 的 snapshot / next unit / artifact 新维度未实现）
> - `complete-slice → validate-milestone` 自动续跑
> - `validate-milestone(pass) → complete-milestone` 自动续跑
> - `needs-remediation with generated slice` 自动转入 remediation dispatch
>
> 本轮的实际效果是：为原有 break / pause 出口补齐显式 `signal` / `breakpointClass`，并把决策落盘到 journal 与 paused-session。**用户行为层面仍会在 `complete-slice` 后结束本次 invocation**，terminal-seeking 行为需在第二批落地。请勿据此认为 "loop continuity 已完成"。

1. 本轮没有把 `auto/phases.ts` 所有 return-site 机械式统一重写
   - 只优先处理了会误导 continuity / resume / observability 的关键出口。

2. continuity decision 目前已进入 journal 与 paused metadata，但 headless surface 还没有单独新增 continuity 视图
   - 当前仍以 journal / recovery metadata / phase result 契约为主。

3. `deriveContinuityDecision()` 仍保留对 legacy reason 的兼容推断
   - 这是有意保留的过渡层，避免一次性要求所有 phase 调用点同步完成重构。
   - 本轮已修复 code-review HIGH-1：`HUMAN_REQUIRED_REASONS` set 中的 `"budget-pause"` 死分支已移除，`breakpointClass` 三元死代码已清理，并补上 `budget-pause` legacy fallback 的专项回归测试。
   - set 上方已补注释声明 "仅用于 legacy fallback，新出口应在 phase return-site 显式声明 signal/breakpointClass"。

4. custom-engine 分支 (`loop.ts` 570-750) 的 pause / stop / retry / complete 出口尚未接入 `emitContinuityDecision`
   - 对应 code-review MEDIUM 项；journal 层对 custom engine 用户无 continuity 事件。
   - 计划在第二批一并补齐，或单独作为 MEDIUM follow-up 在下次小规模修复中处理。

5. `phases.ts` 中两处 `verification-retry` / `artifact-verification-retry` 路径的 `return { action: "continue" }` 未显式带 `reason` / `signal`，会走 legacy fallback 落到 `continue-loop` 而非 `retry-loop`
   - 对应 code-review MEDIUM 项；不改变行为层，仅影响 journal 语义保真度。
   - 已列入 MEDIUM follow-up。

6. `ContinuityDecisionInput.signal` 与 `breakpointClass` 在类型层允许只给一半
   - 对应 code-review MEDIUM 项；当前 phases.ts 调用点均成对出现，未触发；建议后续改为 discriminated union 或加运行时守卫。

## 6. 下一步

### 本轮剩余 follow-up（MEDIUM/LOW，不阻塞合入）

- custom-engine 五个出口补 `emitContinuityDecision` 或在本文档显式记录 gap（已记录于 §5.4）。
- 两条 `verification-retry` 路径补 `reason`（或显式 `signal: "retry-loop"`）（已记录于 §5.5）。
- `ContinuityDecisionInput` 收敛 signal/class 成对契约（已记录于 §5.6）。
- `buildPhaseContinuityDecision` 的 `"X" in args.result` 守卫简化为直接字段访问。
- `journal-integration.test.ts` 或单独 helper 白盒测试：断言 `autoLoop` 中 `continuity-decision` event 真的被 emit 且 `s.lastContinuityDecision` 被刷新。
- 当前分支 diff 混合 loop-continuity / readiness-guard / headless-summary 三 topic，合入前按 topic 拆 commit / PR。

### 第二批 continuity 工作（另起 PR）

设计 §12 第二批条目：

- top-level Loop Continuity Coordinator
- continuation budget
- no-progress detector 升级（§7.7）
- `complete-slice → validate-milestone` / `validate-milestone(pass) → complete-milestone` 自动续跑
- `needs-remediation with generated slice` 自动 dispatch

**第二批 handoff prompt**（新会话）：

```text
请阅读设计文档 docs/superpowers/specs/2026-04-28-phase-discipline-loop-continuity-design.md
（重点 §7.2 / §7.6 / §7.7 / §7.8 / §7.9 与 §12 第二批清单），
以及第一批实现文档 docs/superpowers/plans/2026-04-28-phase-discipline-loop-continuity-implementation.md
（作为契约输入，复用其 ContinuitySignal / BreakpointClass / emitContinuityDecision），
使用 /design-brainstorm 开启 phase-discipline loop continuity 第二批设计与实现。
目标：在 autoLoop 顶层落地 Loop Continuity Coordinator，引入 continuation budget，
升级 no-progress detector，实现 complete-slice → validate-milestone、
validate-milestone(pass) → complete-milestone、
needs-remediation with generated slice 的自动续跑行为。
```

### 本轮合入前建议路径

- 同会话继续：`直接执行 /code-review`
- 新会话恢复 prompt：

```text
请阅读设计文档 docs/superpowers/specs/2026-04-28-phase-discipline-loop-continuity-design.md、
实现文档 docs/superpowers/plans/2026-04-28-phase-discipline-loop-continuity-implementation.md、
审查文档 docs/superpowers/plans/2026-04-28-phase-discipline-loop-continuity-code-review.md（含修复记录），
以及本次提交的代码变更，
对 HIGH-1 / HIGH-2 修复结果做一次补审，确认 legacy fallback 测试覆盖到位、文档落差已消除。
```

- 短恢复 prompt：

```text
请读取 docs/superpowers/plans/2026-04-28-phase-discipline-loop-continuity-implementation.md 和当前分支 diff，继续做 /code-review。
```
