---
topic: phase-discipline-loop-continuity-coordinator-stage-a
stage: design
batch: stage-a-coordinator-infrastructure
parent_topic: phase-discipline-loop-continuity
parent_design_doc: docs/superpowers/specs/2026-04-28-phase-discipline-loop-continuity-design.md
parent_handoff_doc: docs/superpowers/plans/2026-04-28-phase-discipline-loop-continuity-next-session-handoff.md
date: 2026-04-28
size: M
---

# Phase-Discipline Loop Continuity · 第二批 · 阶段 A — Coordinator 基础设施 · 设计

## 0. 摘要 (TL;DR)

第一批已落地 `ContinuitySignal` / `BreakpointClass` / `deriveContinuityDecision` / `continuity-decision` journal event / paused-session round-trip。本轮（阶段 A）目标：**在不改变 loop 运行行为的前提下，把 continuity emit 从 `loop.ts` 下沉到独立 coordinator 模块，统一 signal→decision→journal 路径，补齐 custom-engine 漏发的 emit 点，并用 helper 工厂 + 运行时 invariant 收紧 signal/breakpointClass 成对契约。**

明确**不做**：

- 不动 `pauseAuto()` 的副作用顺序与调用点。
- 不引入 continuation budget 的数据结构或决策逻辑。
- 不做 complete-slice → validate-milestone / validate-milestone(pass) → complete-milestone / needs-remediation → remediation dispatch 的自动续跑。
- 不升级 `detect-stuck.ts`。
- 不改变跨 milestone 默认暂停行为。

## 1. 背景

参见父文档：

- 设计：`docs/superpowers/specs/2026-04-28-phase-discipline-loop-continuity-design.md`
- 实现：`docs/superpowers/plans/2026-04-28-phase-discipline-loop-continuity-implementation.md`
- 评审：`docs/superpowers/plans/2026-04-28-phase-discipline-loop-continuity-code-review.md`
- 下一步 handoff：`docs/superpowers/plans/2026-04-28-phase-discipline-loop-continuity-next-session-handoff.md`

第一批主分支符号现状（事实复核于 2026-04-28）：

- `src/resources/extensions/gsd/auto/types.ts:73` `ContinuitySignal`
- `src/resources/extensions/gsd/auto/types.ts:84` `BreakpointClass`
- `src/resources/extensions/gsd/auto/types.ts:179` `deriveContinuityDecision`
- `src/resources/extensions/gsd/auto/loop.ts:217` `emitContinuityDecision`
- `src/resources/extensions/gsd/auto/loop.ts:250` `buildPhaseContinuityDecision`
- `src/resources/extensions/gsd/auto/session.ts:146` `lastContinuityDecision`
- `src/resources/extensions/gsd/auto.ts:1177` paused-session 写入

dev 路径在 `loop.ts:778 / 797 / 810 / 862 / 881` 共 5 处调用 `emitContinuityDecision`（pre-dispatch / guard / dispatch / unit / finalize 后）。custom-engine 路径（`loop.ts:579–772`）共 9 个退出点，全部 0 处 emit——本轮要补的最小集是其中 5 个外部可见的退出点。

## 2. 目标与范围

### 2.1 In-scope（最小希望集）

1. 新建 `src/resources/extensions/gsd/auto/continuity-coordinator.ts`，下沉 `buildPhaseContinuityDecision` / `emitContinuityDecision` 现场逻辑。
2. `loop.ts` 顶部构造 `LoopContinuityCoordinator` 实例，每次 iteration 重置 flowId/seq；现有 5 处 dev 路径 emit 改走 coordinator 方法。
3. custom-engine 区段补 **5 个退出场景** 共 **9 个 emit 调用点**（终态、stop、verify-pause、retry-exhausted ×3 outcomes、reconcile-pause/stop/complete）。详见 §3.2 表格。
4. signal/breakpointClass 成对契约：增加 helper 工厂 + 运行时 invariant，phases.ts 现有 break return-site 迁移到工厂。
5. 两条 verification retry 路径（`phases.ts:2342` artifact-verification-retry、`phases.ts:2397` verification-retry）显式给 `reason + signal: "retry-loop" + breakpointClass: "auto-resumable"`，并通过 `retryLoopContinue` 工厂收敛。
6. 去掉 `buildPhaseContinuityDecision` 中 `"X" in args.result` 的冗余守卫（PhaseResult 三个 variant 均含字段，直接读取即可）。
7. 新增一条 coordinator 单元测试，断言 emit 写 journal、刷新 `s.lastContinuityDecision`、invariant 在半截输入时抛错。

### 2.2 Out-of-scope（明确不做）

- 不动 `pauseAuto()` 的调用点与副作用顺序。
- 不引入 continuation budget 的数据结构、字段、journal 标签、决策逻辑。
- 不做 complete-slice → validate-milestone / validate-milestone(pass) → complete-milestone / needs-remediation → remediation dispatch 的自动续跑。
- 不升级 `detect-stuck.ts`。
- 不改变跨 milestone 的默认暂停行为。
- 不预留无实现的接口（避免文档级 TODO）。
- **不补 loop-level 退出路径的 emit**（评审 MEDIUM-4）：`state-unchanged` / `infrastructure-error` / `cooldown-budget-exceeded` / `consecutive-iteration-failures` / `max-iterations` / `memory-pressure` / `session-lock-lost` / `missing-command-context` 等 `while (s.active)` 顶层退出路径（含 catch 块）阶段 A 不发 `continuity-decision`。这些是 loop 顶层安全阀、与 phase discipline 解耦；阶段 B 的 `decideLoopAction()` 会统一接管 loop action 决策时一并补 emit。`ContinuitySourcePhase.loop` 值已在 types.ts:101 预留，阶段 A 不消费。

### 2.3 成功标准

- `loop.ts` 中不再直接持有 `emitContinuityDecision` / `buildPhaseContinuityDecision` 函数定义；取而代之是构造一个 `LoopContinuityCoordinator` 实例并调用其方法。
- custom-engine 5 个退出场景在 break 之前各自调用 coordinator 的对应方法，共 9 个 emit 调用点（terminal-complete + stop + verify-pause + retry-exhausted ×3 + reconcile-complete + reconcile-pause + reconcile-stop）。
- 工厂调用全部 `phases.ts` 现有 break return-site；类型层 + 运行时双重保证 signal/breakpointClass 成对。
- 既有 52 个测试维持通过；新增的 coordinator 测试通过。
- typecheck / build 通过。
- **journal 序列零回归**：dev 路径在 5 个 phase 后的 emit 顺序、payload schema 与第一批保持一致。

## 3. 详细方案

### 3.1 新建 `auto/continuity-coordinator.ts`

```ts
// auto/continuity-coordinator.ts —— Stage-A: emit-only owner
//
// Centralizes ContinuityDecision construction and emission. This module
// does NOT change loop control flow. It is purely an extraction of the
// helpers previously inlined in auto/loop.ts.
//
// Stage B will extend this module to drive `signal -> decision -> loop
// action` decisions. That work is intentionally NOT in this design.

import type { LoopDeps } from "./loop-deps.js";
import type { AutoSession } from "./session.js";
import {
  deriveContinuityDecision,
  type ContinuityDecision,
  type ContinuityDecisionInput,
  type ContinuitySignal,
  type ContinuitySourcePhase,
  type BreakpointClass,
  type PhaseResult,
} from "./types.js";

export class LoopContinuityCoordinator {
  private readonly deps: LoopDeps;
  private readonly session: AutoSession;
  private flowId: string | null = null;
  private nextSeq: (() => number) | null = null;

  constructor(deps: LoopDeps, session: AutoSession) {
    this.deps = deps;
    this.session = session;
  }

  /** Reset per-iteration flow grouping. Called from autoLoop top of each iter. */
  beginIteration(flowId: string, nextSeq: () => number): void {
    this.flowId = flowId;
    this.nextSeq = nextSeq;
  }

  /** Phase-driven emit (pre-dispatch / guard / dispatch / unit / finalize). */
  emitPhase(
    sourcePhase: ContinuitySourcePhase,
    result: PhaseResult<unknown>,
    ctx?: { unitType?: string; unitId?: string },
  ): ContinuityDecision {
    // PhaseResult 三个 variant 在类型层均带 reason/signal/breakpointClass
    // 字段（continue/next 是 optional，break.reason 必填），直接读取无需
    // `"X" in result` 守卫、也无需 action 分支三元 —— 见评审 HIGH-2。
    const decision = deriveContinuityDecision({
      sourcePhase,
      action: result.action,
      reason: result.reason,
      signal: result.signal,
      breakpointClass: result.breakpointClass,
      unitType: ctx?.unitType,
      unitId: ctx?.unitId,
    });
    this.write(decision);
    return decision;
  }

  /** Custom-engine exit-point emit. Used for the 5 visible exit points
   *  in the custom-engine block of loop.ts. */
  emitCustomEngine(args: {
    signal: ContinuitySignal;
    breakpointClass: BreakpointClass;
    action: "continue" | "break" | "next";
    reason?: string;
    unitType?: string;
    unitId?: string;
  }): ContinuityDecision {
    const decision = deriveContinuityDecision({
      sourcePhase: "custom-engine",
      action: args.action,
      signal: args.signal,
      breakpointClass: args.breakpointClass,
      reason: args.reason,
      unitType: args.unitType,
      unitId: args.unitId,
    });
    this.write(decision);
    return decision;
  }

  /** Last decision currently held on the session. Stage B will use this
   *  as the input to decideLoopAction(); Stage A only exposes a getter. */
  getLastDecision(): ContinuityDecision | null {
    return this.session.lastContinuityDecision ?? null;
  }

  private write(decision: ContinuityDecision): void {
    if (this.flowId == null || this.nextSeq == null) {
      throw new Error(
        "LoopContinuityCoordinator.write called before beginIteration()",
      );
    }
    this.session.lastContinuityDecision = decision;
    this.deps.emitJournalEvent({
      ts: new Date().toISOString(),
      flowId: this.flowId,
      seq: this.nextSeq(),
      eventType: "continuity-decision",
      data: {
        sourcePhase: decision.sourcePhase,
        continuitySignal: decision.signal,
        breakpointClass: decision.breakpointClass,
        reason: decision.reason,
        unitType: decision.unitType,
        unitId: decision.unitId,
        autoContinued: decision.autoContinued,
        workflowStatusBefore: decision.workflowStatusBefore,
        workflowStatusAfter: decision.workflowStatusAfter,
        nextAction: decision.nextAction,
        nextUnitType: decision.nextUnitType,
        nextUnitId: decision.nextUnitId,
        continuationBudgetRemaining: decision.continuationBudgetRemaining,
        sameUnitRepeatCount: decision.sameUnitRepeatCount,
        noProgressEvidence: decision.noProgressEvidence,
      },
    });
  }
}
```

要点：

- 构造函数注入 `deps` / `session`，与 loop 解耦。
- 每次 iteration 顶部 `beginIteration(flowId, nextSeq)`；写入前检查二者已设置——否则 throw（防御开发期错用）。
- `emitPhase` 复用第一批 `buildPhaseContinuityDecision` 的语义。`result.reason` / `result.signal` / `result.breakpointClass` 在三个 variant 上都属类型层字段（continue/next 为 optional，break.reason 必填）——直接读取，不要保留 `"in"` 守卫，也不要按 action 分支三元（消除 handoff §5.1 第 4 条 + 评审 HIGH-2）。
- `emitCustomEngine` 强制 caller 同时给 `signal` + `breakpointClass`（类型层必填），契合方案 1 最小集语义。
- `getLastDecision` 是阶段 B 的接缝点；阶段 A 不引入 `decideLoopAction`。

### 3.2 修改 `auto/loop.ts`

变更内容：

- 删除 `emitContinuityDecision`（行 217–248）和 `buildPhaseContinuityDecision`（行 250–265）函数定义；保留 import `LoopContinuityCoordinator`。
- `autoLoop()` 在 `loopState` 构造之后追加：
  ```ts
  const coordinator = new LoopContinuityCoordinator(deps, s);
  ```
- 每次 iteration 顶部，在 `s.currentTraceId = flowId; s.currentTurnId = turnId;` 之后插入：
  ```ts
  coordinator.beginIteration(flowId, nextSeq);
  ```
- dev 路径 5 处现有调用形如：
  ```ts
  emitContinuityDecision(deps, s, flowId, nextSeq, buildPhaseContinuityDecision({
    sourcePhase: "pre-dispatch",
    result: preDispatchResult,
  }));
  ```
  替换为：
  ```ts
  coordinator.emitPhase("pre-dispatch", preDispatchResult);
  ```
  含 `unitType` / `unitId` 的（unit / finalize）传 `{ unitType: iterData.unitType, unitId: iterData.unitId }`。
- custom-engine 区段在以下 9 个 emit 调用点前插入 `coordinator.emitCustomEngine(...)`，每个对应一个 break/退出语句紧前位置：

  | # | 行（第一批） | 退出场景 | 调用 |
  |---|---|---|---|
  | 1 | 588–592 | `engineState.isComplete` | `emitCustomEngine({ signal: "stop-terminal", breakpointClass: "terminal", action: "break", reason: "custom-engine-complete" })` |
  | 2 | 597–601 | `dispatch.action === "stop"` | `emitCustomEngine({ signal: "stop-error", breakpointClass: "safety-required", action: "break", reason: dispatch.reason ?? "custom-engine-stop" })` |
  | 3 | 660–668 | `verifyResult === "pause"` | `emitCustomEngine({ signal: "pause-human", breakpointClass: "human-required", action: "break", reason: "custom-engine-verify-pause", unitType, unitId })` |
  | 4 | 684–688 | retry-exhausted, `recovery.outcome === "pause"` | `emitCustomEngine({ signal: "pause-human", breakpointClass: "human-required", action: "break", reason: recovery.reason ?? "custom-engine-verify-retry-exhausted", unitType, unitId })` |
  | 5 | 690–699 | retry-exhausted, `recovery.outcome === "skip"` | `emitCustomEngine({ signal: "stop-error", breakpointClass: "safety-required", action: "break", reason: recovery.reason ?? "custom-engine-verify-retry-exhausted-skip", unitType, unitId })` — `skip` outcome 等同于"无法 reconcile 的跳过"，归入 safety-required（评审 HIGH-1）|
  | 6 | 701–710 | retry-exhausted, `recovery.outcome === "stop"` / fallthrough | `emitCustomEngine({ signal: "stop-error", breakpointClass: "safety-required", action: "break", reason: (recovery.outcome === "stop" && recovery.reason) ? recovery.reason : exhaustedReason, unitType, unitId })` |
  | 7 | 735–744 | `reconcile.outcome === "milestone-complete"` | `emitCustomEngine({ signal: "stop-terminal", breakpointClass: "terminal", action: "break", reason: "custom-engine-complete", unitType, unitId })` |
  | 8 | 745–753 | `reconcile.outcome === "pause"` | `emitCustomEngine({ signal: "pause-human", breakpointClass: "human-required", action: "break", reason: "custom-engine-reconcile-pause", unitType, unitId })` |
  | 9 | 755–765 | `reconcile.outcome === "stop"` | `emitCustomEngine({ signal: "stop-error", breakpointClass: "safety-required", action: "break", reason: reconcileResult.reason ?? "custom-engine-stop", unitType, unitId })` |

  **注意：`dispatch.action === "skip"`、`verifyResult === "retry"` 未超限、`reconcile.outcome === "continue"` 这三个 continue 路径本轮不补 emit**，与第一批 dev 路径"continue 不一定每次 emit"一致。
- 不动 `runUnitPhaseViaContract`、不动 `pauseAuto` 调用点、不动 markLoopStop / finishTurn。

### 3.3 修改 `auto/types.ts`

#### 3.3.1 新增运行时 invariant

`deriveContinuityDecision` 顶部插入：

```ts
if ((input.signal == null) !== (input.breakpointClass == null)) {
  throw new Error(
    `ContinuityDecisionInput requires signal and breakpointClass to be both present or both absent (sourcePhase=${input.sourcePhase}, action=${input.action}, reason=${input.reason ?? ""}, hasSignal=${input.signal != null}, hasBreakpointClass=${input.breakpointClass != null})`,
  );
}
```

invariant 是防御性的：阶段 A 完成迁移后所有现场要么都给（工厂强制），要么都不给（legacy fallback 路径，如 sidecar dispatch 标签）。invariant 保证未来误改也立刻暴露。

**实施前置动作（评审 MEDIUM-1）**：实现第一步先运行
```bash
grep -n "signal:" src/resources/extensions/gsd/auto/phases.ts
grep -n "breakpointClass:" src/resources/extensions/gsd/auto/phases.ts
```
逐行核对每个 `signal:` 现场都**紧邻** `breakpointClass:`（含同一对象字面量内的两行）；条件 signal 现场（`phases.ts:1029 / 1102 / 1136 / 2054 / 2055`）按相同 condition 同步给出条件 breakpointClass。否则 invariant 上线瞬间 throw。事实复核（2026-04-28）下 41 处 `signal:` 与 41 处 `breakpointClass:` 一一配对，`continue` 路径中**只有两条** `artifact-verification-retry` / `verification-retry` 暂时只带 `action: "continue"`、不带 signal/class，本轮通过 `retryLoopContinue` 工厂补齐。

#### 3.3.2 新增 helper 工厂

文件末尾追加：

```ts
/** Construct a `break` PhaseResult signalling a human-required pause. */
export function humanPauseBreak(reason: string): PhaseResult<never> {
  return {
    action: "break",
    reason,
    signal: "pause-human",
    breakpointClass: "human-required",
  };
}

/** Construct a `break` PhaseResult signalling a provider-side pause. */
export function providerPauseBreak(reason: string): PhaseResult<never> {
  return {
    action: "break",
    reason,
    signal: "pause-provider",
    breakpointClass: "provider",
  };
}

/** Construct a `break` PhaseResult signalling a budget-imposed pause. */
export function budgetPauseBreak(reason: string): PhaseResult<never> {
  return {
    action: "break",
    reason,
    signal: "pause-budget",
    breakpointClass: "budget",
  };
}

/** Construct a `break` PhaseResult signalling terminal completion
 *  (e.g. `milestone-complete`, `no-active-milestone`, `custom-engine-complete`). */
export function terminalBreak(reason: string): PhaseResult<never> {
  return {
    action: "break",
    reason,
    signal: "stop-terminal",
    breakpointClass: "terminal",
  };
}

/** Construct a `break` PhaseResult signalling a no-progress stop
 *  (e.g. `stuck-detected`, `state-unchanged`,
 *  `complete-milestone-artifact-db-mismatch`). */
export function noProgressBreak(reason: string): PhaseResult<never> {
  return {
    action: "break",
    reason,
    signal: "stop-no-progress",
    breakpointClass: "no-progress",
  };
}

/** Construct a `break` PhaseResult signalling a safety-required stop
 *  (catch-all for `stop-error` / `safety-required`). */
export function errorBreak(reason: string): PhaseResult<never> {
  return {
    action: "break",
    reason,
    signal: "stop-error",
    breakpointClass: "safety-required",
  };
}

/** Construct a `continue` PhaseResult signalling a bounded retry loop
 *  (used by `artifact-verification-retry` / `verification-retry`). */
export function retryLoopContinue(reason: string): PhaseResult<never> {
  return {
    action: "continue",
    reason,
    signal: "retry-loop",
    breakpointClass: "auto-resumable",
  };
}
```

工厂签名让 `signal` / `breakpointClass` 在构造点**类型层成对绑定**：每个工厂只产出一种 `(signal, class)` 组合，调用方不可能写出 `humanPauseBreak("...", "budget")` 之类的错配（评审 HIGH-3 推荐方案 B）。

`PhaseResult<T>` union 不变；现有"只给 reason、不给 signal/breakpointClass"的 continue 路径（除两条 retry 之外）仍合法，由 `deriveContinuityDecision` 的 legacy fallback 处理。

### 3.4 修改 `auto/phases.ts`

按工厂迁移 break return-site。原则：仅替换"现已显式 signal+breakpointClass"的现场，其余 break（如不带 signal 的 reason-only break，依赖 legacy fallback）维持现状——不在本轮扩大改动半径。

#### 3.4.1 实现阶段第一交付物：现场清单（评审 MEDIUM-5）

实现首步先生成 phases.ts 的现场清单（grep 输出 + 手动分类），作为后续迁移的输入：

```bash
grep -n "signal:" src/resources/extensions/gsd/auto/phases.ts
grep -n "breakpointClass:" src/resources/extensions/gsd/auto/phases.ts
```

事实复核（2026-04-28）下 41 个 `signal:` 现场。每个现场标注：(a) 迁移到哪个工厂；(b) 是否为条件分支需要拆 if/else；(c) 暂不迁移的原因（极少数 legacy fallback 路径）。完成迁移后整张清单归档进 implementation 文档。

#### 3.4.2 (signal, class) → 工厂映射

| 现有 (signal, class) | 工厂 |
|---|---|
| `("pause-human", "human-required")` | `humanPauseBreak(reason)` |
| `("pause-provider", "provider")` | `providerPauseBreak(reason)` |
| `("pause-budget", "budget")` | `budgetPauseBreak(reason)` |
| `("stop-terminal", "terminal")` | `terminalBreak(reason)` |
| `("stop-no-progress", "no-progress")` | `noProgressBreak(reason)` |
| `("stop-error", "safety-required")` | `errorBreak(reason)` |

预期典型改动（reason 与 phases.ts 现状对应；具体 reason 全集以 §3.4.1 清单为准）：

- `uat-pause` / `verification-pause` / `step-wizard` / `pre-verification-dispatched` 等 → `humanPauseBreak(reason)`
- `provider-pause` / `provider-pause-budget` 等 → `providerPauseBreak(reason)`
- `budget-pause` 等 → `budgetPauseBreak(reason)`
- `milestone-complete` / `no-active-milestone` / `custom-engine-complete` → `terminalBreak(reason)`
- `stuck-detected` / `state-unchanged` / `complete-milestone-artifact-db-mismatch` → `noProgressBreak(reason)`
- `dispatch-stop`（错误分支）/ `post-verification-stopped` / `git-closeout-failure` / 其它已显式标 `stop-error` 的现场 → `errorBreak(reason)`

#### 3.4.3 条件 signal 现场（拆 if/else，评审 MEDIUM-3）

以下 4 处不能用单一工厂替换，必须按条件拆成两次工厂调用：

- `phases.ts:1029–1030` `signal: dispatchResult.level === "warning" ? "pause-human" : "stop-error"` → 拆为：
  ```ts
  if (dispatchResult.level === "warning") return humanPauseBreak("dispatch-stop");
  return errorBreak("dispatch-stop");
  ```
- `phases.ts:1102–1103` `preDispatchResult.level === "warning"` 同上结构（reason 取现场原值）。
- `phases.ts:1136–1137` `advisedDispatch.level === "warning"` 同上结构。
- `phases.ts:2054–2055` `signal: allowAutoResume ? "pause-provider" : "pause-human"` → 拆为：
  ```ts
  if (allowAutoResume) return providerPauseBreak("session-timeout");
  return humanPauseBreak("session-timeout");
  ```

所有条件分支保留原有 `reason` 字面量。

#### 3.4.4 两条 retry 路径

- `phases.ts:2342` artifact-verification-retry：`return retryLoopContinue("artifact-verification-retry");`
- `phases.ts:2397` verification-retry：`return retryLoopContinue("verification-retry");`

### 3.5 测试

#### 3.5.1 新增 `tests/continuity-coordinator.test.ts`

最小用例集：

1. **基本 emit 路径**：构造 fake `deps` + fake `session`，`beginIteration` 后 `emitPhase("pre-dispatch", { action: "continue" })` →
   - `deps.emitJournalEvent` 被调用一次，eventType 为 `"continuity-decision"`，flowId/seq 与 begin 注入一致。
   - `session.lastContinuityDecision` 被刷新。
2. **forgot beginIteration**：未 begin 直接 `emitPhase` 应 throw。
3. **pair invariant**：直接 `deriveContinuityDecision({ ..., signal: "stop-terminal" })`（缺 breakpointClass）应 throw 含特定字段；同样仅给 breakpointClass 时也 throw。
4. **custom-engine emit**：`emitCustomEngine({ signal: "pause-human", breakpointClass: "human-required", action: "break", reason: "custom-engine-verify-pause" })` → journal 被写、`getLastDecision()` 返回该 decision、`autoContinued === false`。
5. **factory parity**：`humanPauseBreak("uat-pause")` / `providerPauseBreak("provider-pause")` / `budgetPauseBreak("budget-pause")` / `terminalBreak("milestone-complete")` / `noProgressBreak("stuck-detected")` / `errorBreak("dispatch-stop")` / `retryLoopContinue("verification-retry")` 等结果对象的字段值与预期一致（防止后续误改），并核对每个 break 工厂返回的 `(signal, breakpointClass)` 对正确。

#### 3.5.2 既有测试预期不修改

- `tests/continuity-decision.test.ts` 应继续通过（`deriveContinuityDecision` 函数行为未变，仅在缺一半时 throw——既有用例已成对给出或两个都不给）。
- `tests/crash-recovery.test.ts` 验证 paused-session round-trip 含 `lastContinuityDecision`，coordinator 行为对此透明。
- `tests/journal-integration.test.ts` 验证 dev 路径 `continuity-decision` 事件序列，coordinator 必须保持 payload 一致。

#### 3.5.3 验证矩阵

```bash
node --import ./src/resources/extensions/gsd/tests/resolve-ts.mjs --experimental-strip-types --test \
  src/resources/extensions/gsd/tests/continuity-coordinator.test.ts \
  src/resources/extensions/gsd/tests/continuity-decision.test.ts \
  src/resources/extensions/gsd/tests/crash-recovery.test.ts \
  src/resources/extensions/gsd/tests/journal-integration.test.ts

npm run typecheck:extensions
npm run build:core
```

`continuity-decision.test.ts` 中"半截输入"用例可能不存在；本设计把"半截输入 throw"作为新的契约，由 `continuity-coordinator.test.ts` 覆盖即可，不强制修改 `continuity-decision.test.ts`。

## 4. 关键决策与取舍

| 决策点 | 选择 | 理由 |
|---|---|---|
| coordinator 形态 | 新文件 `auto/continuity-coordinator.ts`，class 形态 | 真正下沉，阶段 B 自然延伸；loop.ts 减肥 |
| custom-engine emit 粒度 | 5 个外部可见退出场景，9 个 emit 调用点 | 与 dev 路径"break/退出点 emit"语义一致；不引入"假 phase"；retry-exhausted 与 reconcile 各自的 outcome 分支必须各自 emit（评审 HIGH-1 / MEDIUM-2）|
| 成对契约方案 | 运行时守卫 + 单一 (signal, class) 工厂（拆 humanPauseBreak / providerPauseBreak / budgetPauseBreak）| 改动半径小、使用现场清晰；类型层即固定 (signal, class) 配对，错配在编译期就不可表达；invariant 对 legacy 半截输入兜底（评审 HIGH-3 推荐方案 B）|
| `PhaseResult` 类型层不收紧成对契约 | 不改 union 结构 | 改动半径大幅超阶段 A 目标（41 处现场需类型重标注），且需要决定 legacy `reason-only` 路径是否兼容；本轮通过工厂强制构造点成对、运行时 invariant 兜底 legacy 路径，已足以覆盖 99% 场景。阶段 B 重审此取舍（评审 MEDIUM-1）|
| loop-level 退出路径不补 emit | 阶段 A 不动 | `state-unchanged` / `infrastructure-error` / `cooldown-budget-exceeded` / `consecutive-iteration-failures` / `max-iterations` / `memory-pressure` / `session-lock-lost` / `missing-command-context` 是 loop 顶层安全阀，与 phase discipline 解耦；阶段 B 引入 `decideLoopAction()` 时统一接管（评审 MEDIUM-4）|
| retry 路径标注 | 显式 signal+factory（`retryLoopContinue`）| 与第一批"显式成对"精神一致；削弱 legacy fallback 依赖 |
| 阶段 B 接缝 | 仅 `getLastDecision()` getter | 不留空接口；阶段 B 再加 `decideLoopAction` |

## 5. 风险与缓解

| 风险 | 影响 | 缓解 |
|---|---|---|
| R1 import 环 | typecheck 失败 | types.ts 是叶子；coordinator 仅依赖 types/loop-deps/session；通过 `npm run typecheck:extensions` 验证 |
| R2 行为漂移 | dev 路径 journal 序列回归 | `journal-integration.test.ts` 覆盖；coordinator emit payload 与第一批 1:1 拷贝 |
| R3 paused-session round-trip 受影响 | custom-engine pause 退出后 `lastContinuityDecision` 写入 paused-session.json，可能与历史数据格式预期不符 | 第一批已支持 `lastContinuityDecision` 字段，本轮只是让 custom-engine 路径开始填它——**这是修复，不是回归**。`crash-recovery.test.ts` 提供回归断言 |
| R4 工厂未完全迁移 | 某些 break 现场仍是裸字面量 | 迁移范围限定在"已显式标 signal+breakpointClass"的现场；其他维持 legacy fallback；invariant 在缺一半时立即暴露 |
| R5 GSD_ENGINE_BYPASS=1 路径 | bypass 时不走 custom-engine 区段，走 dev 路径 | dev 路径 emit 维持现状；无影响 |

## 6. 验证计划

1. **代码自查**：迁移后 `loop.ts` 内不再有 `emitContinuityDecision` / `buildPhaseContinuityDecision` 函数定义；不再有 `"signal" in args.result` / `"breakpointClass" in args.result` 表达式。
2. **typecheck**：`npm run typecheck:extensions` 全绿。
3. **build**：`npm run build:core` 成功。
4. **定向测试**：`continuity-coordinator.test.ts` 5 用例全过；既有 `continuity-decision.test.ts` / `crash-recovery.test.ts` / `journal-integration.test.ts` 全过。
5. **手动 spot check**：
   - `grep -n "emitContinuityDecision" src/resources/extensions/gsd/auto/loop.ts` 应为空（函数已下沉）。
   - `grep -n "buildPhaseContinuityDecision" src/resources/extensions/gsd/auto/loop.ts` 应为空。
   - `grep -c "coordinator\.emitPhase" src/resources/extensions/gsd/auto/loop.ts` 应返回 **5**（dev 路径 5 处 phase emit）。
   - `grep -c "coordinator\.emitCustomEngine" src/resources/extensions/gsd/auto/loop.ts` 应返回 **9**（custom-engine 9 个 emit 调用点，对应 §3.2 表格 9 行）。
   - `grep -nE '"signal" in|"breakpointClass" in' src/resources/extensions/gsd/auto/loop.ts` 应为空。

## 7. 与阶段 B 的接缝点

- coordinator 暴露 `getLastDecision(): ContinuityDecision | null`，阶段 B 的 `decideLoopAction(decision)` 直接基于此。
- coordinator 持有 `session` 引用，阶段 B 可在 coordinator 内部读取 `session.recentUnits` / `session.stuckRecoveryAttempts` 实现 no-progress detector 升级。
- `ContinuityDecision.continuationBudgetRemaining` / `sameUnitRepeatCount` / `noProgressEvidence` 字段已在第一批就位，阶段 B 引入 budget 后只填字段、coordinator 写入路径不需要再改。
- 新增的 7 个 helper 工厂可被阶段 B 复用：例如阶段 B 自动续跑流程返回 `terminalBreak("milestone-complete")` 仍是同一类型。
- `BreakpointClass.unknown`（types.ts:84-92）阶段 A 不生产、不消费；为阶段 B 预留，用于 coordinator 主动分类失败的兜底（评审 LOW-1）。
- coordinator 的 `write()` 当前**无条件 include** `continuationBudgetRemaining` / `sameUnitRepeatCount` / `noProgressEvidence` 等未来字段，依赖 `JSON.stringify` 自然丢弃 `undefined`。若阶段 B 后续给 journal 引入 schema 校验（zod 等），需要同步更新 schema 允许 `undefined`/缺省（评审 LOW-2）。

阶段 B 的最小 API 雏形（**仅作意图记录，本轮不实现、不引入类型**）：

```ts
// Stage B (NOT in this design): LoopContinuityCoordinator adds
//   decideLoopAction(decision: ContinuityDecision):
//     | { kind: "auto-continue" }
//     | { kind: "pause"; reason: string }
//     | { kind: "stop"; reason: string }
// called in autoLoop at the top of each iteration after beginIteration(),
// driven by session.recentUnits / session.stuckRecoveryAttempts /
// continuationBudgetRemaining.
```

阶段 A 不写任何阶段 B 代码、不引入任何阶段 B 字段。

## 8. Out-of-scope 重述

- `pauseAuto()` 调用点与副作用顺序——本轮零修改。
- continuation budget 数据结构、字段、journal 标签、决策逻辑——本轮零引入。
- complete-slice → validate-milestone / validate-milestone(pass) → complete-milestone / needs-remediation → remediation dispatch 自动续跑——本轮零行为变更。
- `detect-stuck.ts`——本轮不动。
- 跨 milestone 默认续跑 opt-in 切换——本轮不动。
- loop-level 顶层退出路径（`state-unchanged` / catch 块 / `max-iterations` / `memory-pressure` / `session-lock-lost` / `missing-command-context` / `cooldown-budget-exceeded` / `consecutive-iteration-failures`）的 `continuity-decision` emit——阶段 B 统一补。

## 9. Handoff

阶段 A 设计完成。下一步走 `/design-review`：

- 同会话继续：直接执行 `/design-review`
- 新会话恢复 prompt：

```
请阅读设计文档 docs/superpowers/specs/2026-04-28-phase-discipline-loop-continuity-coordinator-stage-a-design.md，
使用 /design-review 对该方案进行评审，分析设计方案及核心思路是否合理，
是否有遗漏需要补充，或需要推翻重新设计。
```

## 10. 修订记录

### 2026-04-28 — 评审反馈吸收（design-review → design-implement）

依据 `docs/superpowers/plans/2026-04-28-phase-discipline-loop-continuity-coordinator-stage-a-design-review.md`，结论 **NEEDS_REVISION**，本次修订处理：

- **HIGH-1**（§3.2）：表格按 emit 调用点粒度从 5 行展开为 9 行，把 retry-exhausted 拆为 `recovery.outcome === "pause" / "skip" / "stop"` 三行（line 688 / 699 / 710），把 reconcile 拆为 milestone-complete / pause / stop 三行（line 735 / 745 / 755）。`recovery.outcome === "skip"` 显式归类为 `stop-error / safety-required`，reason 为 `custom-engine-verify-retry-exhausted-skip`（与 stop 分支区分）。
- **HIGH-2**（§3.1）：删除 `emitPhase` 中 `result.action === "continue" || result.action === "next" ? result.reason : result.reason` 的等价三元死代码，改为直接读取 `result.reason` / `result.signal` / `result.breakpointClass`，与 §2.1 第 6 条"去掉 `"X" in args.result` 冗余守卫"自洽。要点段同步更新。
- **HIGH-3**（§3.3.2）：删除 `pausedBreak(reason, signal, breakpointClass)` 三参签名（无法防止 signal 与 class 错配），改为类型层成对绑定的三个独立工厂 `humanPauseBreak(reason)` / `providerPauseBreak(reason)` / `budgetPauseBreak(reason)`。`terminalBreak` / `noProgressBreak` / `errorBreak` / `retryLoopContinue` 保持单参签名。
- **MEDIUM-1**（§3.3.1 + §4）：§3.3.1 增加"实施前置动作"段落，要求实现首步 `grep -n "signal:" / "breakpointClass:"` 双向核对成对，并交代 41 处 `signal:` 现状一一配对的事实复核结论。§4 决策表新增"PhaseResult 类型层不收紧成对契约"行，显式论证为何不做 discriminated union。
- **MEDIUM-2**（§2.1 + §2.3 + §3.2 + §6）：把"5 个退出点"改为"5 个退出场景，9 个 emit 调用点"，文字统一；§6 验证计划新增 `grep -c "coordinator\.emitPhase"` 应为 5、`grep -c "coordinator\.emitCustomEngine"` 应为 9 的 spot check。
- **MEDIUM-3**（§3.4.3）：新增"条件 signal 现场（拆 if/else）"小节，明确 `phases.ts:1029 / 1102 / 1136 / 2054` 四处条件分支必须拆成两次工厂调用，给出具体改写片段。
- **MEDIUM-4**（§2.2 + §4 + §8）：§2.2 显式列出 loop-level 退出路径并标注"阶段 B 统一补 emit"是刻意选择；§4 决策表新增对应行；§8 重述同步更新。
- **MEDIUM-5**（§3.4.1）：将 phases.ts 现场清单（grep 输出 + 工厂分类）作为实现阶段第一交付物，归档进 implementation 文档。给出 (signal, class) → 工厂的映射表。
- **LOW-1**（§7）：补 `BreakpointClass.unknown` 为阶段 B 预留的说明。
- **LOW-2**（§7）：补 coordinator `write()` 无条件 include 未来字段、依赖 `JSON.stringify` 丢 undefined 的说明，以及 schema 校验引入时的同步更新提示。
- **LOW-3**（§7）：新增阶段 B 最小 API 雏形（`decideLoopAction` 签名草图，仅意图记录、不实现）。

§3.5.1 测试用例 5 同步更新工厂名称。其余章节保持原意，仅文字微调与表格扩展。

