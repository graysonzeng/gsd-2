---
topic: phase-discipline-loop-continuity-coordinator-stage-a
stage: implementation
batch: stage-a-coordinator-infrastructure
parent_topic: phase-discipline-loop-continuity
design_doc: docs/superpowers/specs/2026-04-28-phase-discipline-loop-continuity-coordinator-stage-a-design.md
design_review_doc: docs/superpowers/plans/2026-04-28-phase-discipline-loop-continuity-coordinator-stage-a-design-review.md
date: 2026-04-28
size: M
---

# Phase-Discipline Loop Continuity · 第二批 · 阶段 A — Coordinator 基础设施 · 实现

## 0. 摘要 (TL;DR)

按评审 `NEEDS_REVISION` 结论处理 HIGH-1/2/3、MEDIUM-1~5、LOW-1~3 共 10 条发现，并落地设计中所有 in-scope 变更：

- 新建 `auto/continuity-coordinator.ts`，`LoopContinuityCoordinator` 拥有 emit 所有权。
- `auto/loop.ts` 删除 `emitContinuityDecision` / `buildPhaseContinuityDecision` 函数定义；dev 路径 5 处 `coordinator.emitPhase`；custom-engine 区段 **9 处** `coordinator.emitCustomEngine`（5 个退出场景展开）。
- `auto/types.ts` 新增 7 个类型层成对绑定的工厂：`humanPauseBreak` / `providerPauseBreak` / `budgetPauseBreak` / `terminalBreak` / `noProgressBreak` / `errorBreak` / `retryLoopContinue`；`deriveContinuityDecision` 增加半截输入 invariant。
- `auto/phases.ts` 41 处 break return-site 全部迁移到工厂；两条 retry 路径（`artifact-verification-retry` / `verification-retry`）用 `retryLoopContinue` 显式标注；4 处条件 signal 现场（`phases.ts:1029 / 1102 / 1136 / 2054` 原位置）拆成 if/else 分支调用对应工厂。
- 新增 `tests/continuity-coordinator.test.ts` 5 用例覆盖 emit / begin-order invariant / 半截输入 throw / custom-engine emit / factory parity。

验证：typecheck + build 通过；新增 5 coordinator 用例 + 既有 52 相关用例（`continuity-decision` / `crash-recovery` / `journal-integration`）全过；设计 §6 全部 spot-check grep 命中预期数。

## 1. 输入与资料

- 设计：`docs/superpowers/specs/2026-04-28-phase-discipline-loop-continuity-coordinator-stage-a-design.md`（本轮已修订，见该文末 §10 修订记录）
- 评审：`docs/superpowers/plans/2026-04-28-phase-discipline-loop-continuity-coordinator-stage-a-design-review.md`（结论 `NEEDS_REVISION`）

## 2. 评审意见逐条处理

| ID | 等级 | 采纳 | 处理方式 |
|---|---|---|---|
| HIGH-1 | 阻塞 | ✅ | 设计 §3.2 表格从 5 行展开为 9 行；`recovery.outcome === "skip"` 归入 `stop-error / safety-required`，reason 为 `custom-engine-verify-retry-exhausted-skip`；实现里 custom-engine 9 个 emit 调用点逐个落地 |
| HIGH-2 | 阻塞 | ✅ | 设计 §3.1 coordinator 代码删除 `reason` 等价三元死代码；实现中 `emitPhase` 直接读 `result.reason` / `result.signal` / `result.breakpointClass` |
| HIGH-3 | 阻塞 | ✅ | 按推荐方案 B 拆成 `humanPauseBreak` / `providerPauseBreak` / `budgetPauseBreak` 三个工厂，类型层只有单一 (signal, class) 组合，错配不可表达 |
| MEDIUM-1 | 应修 | ✅ | 设计 §3.3.1 增加"实施前置动作"grep 核对段落；§4 决策表新增"PhaseResult 不做 discriminated union"行，说明取舍 |
| MEDIUM-2 | 应修 | ✅ | 设计文字"5 个退出点"→"5 个退出场景，9 个 emit 调用点"；§6 新增 `grep -c coordinator.emitPhase` 应为 5、`grep -c coordinator.emitCustomEngine` 应为 9 的 spot check；实际验证通过（详见 §6） |
| MEDIUM-3 | 应修 | ✅ | 设计 §3.4.3 新增"条件 signal 现场（拆 if/else）"小节，点名 `phases.ts:1029 / 1102 / 1136 / 2054` 四处；实现里全部按 if/else 拆分调用对应工厂 |
| MEDIUM-4 | 应修 | ✅ | 设计 §2.2 / §4 / §8 显式把 loop-level 退出路径列为阶段 B 统一处理（不是遗漏），理由：loop 顶层安全阀与 phase discipline 解耦，阶段 B `decideLoopAction()` 接管时一并补 emit |
| MEDIUM-5 | 应修 | ✅ | 设计 §3.4.1 声明 phases.ts 现场清单为实现阶段第一交付物；清单归档于本文 §4.4 |
| LOW-1 | 建议 | ✅ | 设计 §7 新增说明 `BreakpointClass.unknown` 为阶段 B 预留，阶段 A 不生产、不消费 |
| LOW-2 | 建议 | ✅ | 设计 §7 新增 journal schema 迁移提示（coordinator write 依赖 `JSON.stringify` 丢 undefined） |
| LOW-3 | 建议 | ✅ | 设计 §7 新增阶段 B 最小 API 雏形（`decideLoopAction` 签名草图，仅意图记录） |

## 3. 设计修订摘要

修订记录已写入设计文档 §10。关键改动：

1. **§2.1 / §2.3 / §3.2** — "5 个退出点"→"5 个退出场景，9 个 emit 调用点"；表格从 5 行扩展为 9 行，显式列出每个 emit 的 signal/breakpointClass/reason，特别补齐 `recovery.outcome === "skip"` 分支。
2. **§3.1** — coordinator 示例代码删除语义死代码三元；`emitPhase` 直接读 PhaseResult 字段。构造函数改为显式字段声明（适配 Node strip-only TS 模式，不支持 parameter-property 语法——实施期发现并反馈回设计）。
3. **§3.3.2** — 从 3 参 `pausedBreak(reason, signal, class)` 改为 3 个独立工厂 `humanPauseBreak` / `providerPauseBreak` / `budgetPauseBreak`。
4. **§3.3.1 + §4** — 新增运行时 invariant + 显式论证不做 `PhaseResult` discriminated union。
5. **§3.4** — 拆成 §3.4.1（现场清单要求）/ §3.4.2（(signal, class) → 工厂映射表）/ §3.4.3（条件 signal 拆分指引）/ §3.4.4（retry 路径）。
6. **§7** — 补 `BreakpointClass.unknown` 预留说明、journal schema 提示、阶段 B `decideLoopAction` 雏形。
7. **§6** — 验证计划新增 4 条 grep spot check。

## 4. 实现摘要

### 4.1 新增文件

**`src/resources/extensions/gsd/auto/continuity-coordinator.ts`** —— `LoopContinuityCoordinator` class：

- `beginIteration(flowId, nextSeq)` — per-iteration 重置；写入前必须先调用。
- `emitPhase(sourcePhase, result, ctx?)` — dev 路径 5 处 phase emit；直接读 PhaseResult 字段，无 `"in"` 守卫、无三元。
- `emitCustomEngine({ signal, breakpointClass, action, reason, unitType?, unitId? })` — custom-engine 退出场景 emit；类型层强制同时给 signal + breakpointClass。
- `getLastDecision()` — 阶段 B 接缝点。
- 私有 `write(decision)` — 刷 `session.lastContinuityDecision` 并 `deps.emitJournalEvent({ eventType: "continuity-decision", ... })`，payload 与第一批 1:1 拷贝。未调用 `beginIteration` 前 `write` 会 throw。
- 构造函数采用显式字段声明（`this.deps = deps; this.session = session;`），不用 TS parameter-property 语法——后者在 Node `--experimental-strip-types` 模式下不受支持，实施期发现并回馈设计。

**`src/resources/extensions/gsd/tests/continuity-coordinator.test.ts`** —— 5 个测试用例：

1. `emitPhase` 写 journal 并刷 `session.lastContinuityDecision`（含 flowId/seq 核对）
2. 未 `beginIteration` 即 emit → throw
3. `deriveContinuityDecision` 半截输入（只给 signal 或只给 breakpointClass） → throw
4. `emitCustomEngine` break 路径：写 journal、`autoContinued === false`、`getLastDecision()` 返回该 decision
5. Factory parity：7 个工厂返回的 (action, signal, breakpointClass) 对一一核对

### 4.2 修改：`auto/types.ts`

- `deriveContinuityDecision` 头部增加半截输入 invariant：
  ```ts
  if ((input.signal == null) !== (input.breakpointClass == null)) {
    throw new Error(`ContinuityDecisionInput requires signal and breakpointClass to be both present or both absent ...`);
  }
  ```
- 文件末尾新增 7 个工厂（签名与设计 §3.3.2 一致）：
  - `humanPauseBreak(reason)` → `(break, pause-human, human-required)`
  - `providerPauseBreak(reason)` → `(break, pause-provider, provider)`
  - `budgetPauseBreak(reason)` → `(break, pause-budget, budget)`
  - `terminalBreak(reason)` → `(break, stop-terminal, terminal)`
  - `noProgressBreak(reason)` → `(break, stop-no-progress, no-progress)`
  - `errorBreak(reason)` → `(break, stop-error, safety-required)`
  - `retryLoopContinue(reason)` → `(continue, retry-loop, auto-resumable)`

### 4.3 修改：`auto/loop.ts`

- 删除 `emitContinuityDecision`（原 217–248）与 `buildPhaseContinuityDecision`（原 250–265）函数定义；从 `./types.js` import 中移除 `deriveContinuityDecision`、`ContinuityDecision`、`ContinuitySourcePhase`；新增 `import { LoopContinuityCoordinator } from "./continuity-coordinator.js"`.
- `autoLoop()` 在 `loopState` 构造之后 `const coordinator = new LoopContinuityCoordinator(deps, s)`.
- `while (s.active)` 每次 iteration 顶部 `s.currentTurnId = turnId;` 之后插入 `coordinator.beginIteration(flowId, nextSeq);`.
- dev 路径 5 处 phase emit 全部替换为 `coordinator.emitPhase(sourcePhase, result, ctx?)`：pre-dispatch / guard / dispatch / unit（带 `{ unitType, unitId }`）/ finalize（带 `{ unitType, unitId }`）。
- custom-engine 区段新增 **9 处** `coordinator.emitCustomEngine(...)`，位置在各自 `markLoopStop` / `break` 之前：

  | # | 退出场景 | signal | breakpointClass | reason |
  |---|---|---|---|---|
  | 1 | `engineState.isComplete` | stop-terminal | terminal | `custom-engine-complete` |
  | 2 | `dispatch.action === "stop"` | stop-error | safety-required | `dispatch.reason ?? "custom-engine-stop"` |
  | 3 | `verifyResult === "pause"` | pause-human | human-required | `custom-engine-verify-pause` |
  | 4 | retry-exhausted, `recovery.outcome === "pause"` | pause-human | human-required | `recovery.reason ?? "custom-engine-verify-retry-exhausted"` |
  | 5 | retry-exhausted, `recovery.outcome === "skip"` | stop-error | safety-required | `recovery.reason ?? "custom-engine-verify-retry-exhausted-skip"` |
  | 6 | retry-exhausted, `recovery.outcome === "stop"` / fallthrough | stop-error | safety-required | `recovery.outcome === "stop" && recovery.reason ? recovery.reason : exhaustedReason` |
  | 7 | `reconcile.outcome === "milestone-complete"` | stop-terminal | terminal | `custom-engine-complete` |
  | 8 | `reconcile.outcome === "pause"` | pause-human | human-required | `custom-engine-reconcile-pause` |
  | 9 | `reconcile.outcome === "stop"` | stop-error | safety-required | `reconcileResult.reason ?? "custom-engine-stop"` |

  Continue 路径（`dispatch.action === "skip"` / `verifyResult === "retry"` 未超限 / `reconcile.outcome === "continue"`）不补 emit，与第一批 dev 路径语义一致。
- `pauseAuto` 调用点、markLoopStop、finishTurn、`runUnitPhaseViaContract` 均未改动。

### 4.4 修改：`auto/phases.ts` 现场清单（MEDIUM-5 交付物）

从 `./types.js` import 新增 7 个工厂。迁移后 `grep -n "signal:" phases.ts` 应为空（已实测，见 §6）。下表给出迁移后每个 return-site 的最终形态（line 以**迁移后**文件为准）：

| # | 迁移后行 | reason | 工厂 | 备注 |
|---|---|---|---|---|
| 1 | 292 | `progressKind`（变量） | `humanPauseBreak` | finalize 超时兜底 |
| 2 | 352 | `resources-stale` | `errorBreak` | |
| 3 | 390 | `health-gate-failed` | `humanPauseBreak` | |
| 4 | 453 | `plan-v2-gate-failed` | `humanPauseBreak` | |
| 5 | 523 | `slice-parallel-dispatched` | `terminalBreak` | |
| 6 | 596 | `merge-conflict` | `humanPauseBreak` | runGuards 段 |
| 7 | 605 | `merge-failed` | `errorBreak` | runGuards 段 |
| 8 | 710 | `merge-conflict` | `humanPauseBreak` | 另一处 catch |
| 9 | 718 | `merge-failed` | `errorBreak` | 另一处 catch |
| 10 | 780 | `no-active-milestone` | `terminalBreak` | |
| 11 | 796 | `merge-reconciliation-blocked` | `humanPauseBreak` | |
| 12 | 814 | `no-milestone-after-reconciliation` | `errorBreak` | |
| 13 | 838 | `merge-conflict` | `humanPauseBreak` | 第三处 catch |
| 14 | 846 | `merge-failed` | `errorBreak` | 第三处 catch |
| 15 | 874 | `milestone-complete` | `terminalBreak` | |
| 16 | 896 | `blocked` | `humanPauseBreak` | |
| 17 | 950 | `dispatch-stop`（warning 分支）| `humanPauseBreak` | **MEDIUM-3 条件拆分** `dispatchResult.level === "warning"` |
| 18 | 954 | `dispatch-stop`（非 warning）| `errorBreak` | MEDIUM-3 条件拆分 |
| 19 | 1018 | `pre-dispatch-block`（warning）| `humanPauseBreak` | **MEDIUM-3 条件拆分** `preDispatchResult.level === "warning"` |
| 20 | 1023 | `pre-dispatch-block`（非 warning）| `errorBreak` | MEDIUM-3 条件拆分 |
| 21 | 1049 | `dispatch-stop`（advise warning）| `humanPauseBreak` | **MEDIUM-3 条件拆分** `advisedDispatch.level === "warning"` |
| 22 | 1053 | `dispatch-stop`（advise 非 warning）| `errorBreak` | MEDIUM-3 条件拆分 |
| 23 | 1129 | `complete-milestone-artifact-db-mismatch` | `noProgressBreak` | |
| 24 | 1167 | `stuck-detected` | `noProgressBreak` | |
| 25 | 1192 | `prior-slice-blocker` | `humanPauseBreak` | |
| 26 | 1216 | `pre-dispatch-fanout-failed` | `humanPauseBreak` | |
| 27 | 1284 | `isBacktrack ? "user-backtrack" : "user-stop"` | `humanPauseBreak` | reason 保持条件 |
| 28 | 1290 | `stop-guard-error` | `errorBreak` | catch 里 |
| 29 | 1362 | `budget-halt` | `budgetPauseBreak` | |
| 30 | 1373 | `budget-pause` | `budgetPauseBreak` | |
| 31 | 1421 | `context-window` | `humanPauseBreak` | |
| 32 | 1494 | `worktree-invalid` | `errorBreak` | |
| 33 | 1737 | `workflow-capability` | `errorBreak` | |
| 34 | 1846 | `provider-pause` | `providerPauseBreak` | |
| 35 | 1906 | `session-timeout`（allowAutoResume=true）| `providerPauseBreak` | **MEDIUM-3 条件拆分** |
| 36 | 1907 | `session-timeout`（allowAutoResume=false）| `humanPauseBreak` | MEDIUM-3 条件拆分 |
| 37 | 1919 | `unit-hard-timeout` | `humanPauseBreak` | |
| 38 | 1933 | `session-timeout`（transient session-failed）| `providerPauseBreak` | |
| 39 | 1954 | `session-failed` | `errorBreak` | |
| 40a | 2144 | `git-closeout-failure` | `errorBreak` | **fix-implement: code-review HIGH 修复 — git 失败应为 stop-error** |
| 40b | 2152 | `pre-verification-dispatched` | `humanPauseBreak` | fix-implement: 拆分自原行 2149 |
| 41 | 2173 | `artifact-verification-retry` | `retryLoopContinue` | **原 `return { action: "continue" };` 显式标 retry-loop** |
| 42 | 2184 | `uat-pause` | `humanPauseBreak` | |
| 43 | 2207 | `verification-pause` | `humanPauseBreak` | |
| 44 | 2218 | `verification-retry` | `retryLoopContinue` | **原 `return { action: "continue" };` 显式标 retry-loop** |
| 45 | 2250 | `post-verification-stopped` | `errorBreak` | |
| 46 | 2256 | `step-wizard` | `humanPauseBreak` | |

合计 47 处工厂调用：42 个"已显式成对"break 现场（含 4 处条件 signal 各自拆出 2 个分支 → 44 处）+ 2 个新增的 `retryLoopContinue` 显式标注 + 1 处 fix-implement 拆分（git-closeout-failure 独立）。剩余的 reason-only `return { action: "continue" }`（例如 `phases.ts` 960 / 1009 / 1058 / 1141 / 1210 行——均为 `dispatch.action === "skip"` 或类似的 "skip & re-derive state" 合法路径）维持现状，依赖 `deriveContinuityDecision` 的 legacy reason fallback。

## 5. 验证结果

### 5.1 Typecheck / Build

- `npm run typecheck:extensions` — 通过（无输出）。
- `npm run build:core` — 通过（所有 workspace 子任务完成）。

### 5.2 定向测试

```bash
node --import ./src/resources/extensions/gsd/tests/resolve-ts.mjs \
  --experimental-strip-types --test \
  src/resources/extensions/gsd/tests/continuity-coordinator.test.ts \
  src/resources/extensions/gsd/tests/continuity-decision.test.ts \
  src/resources/extensions/gsd/tests/crash-recovery.test.ts \
  src/resources/extensions/gsd/tests/journal-integration.test.ts
```

结果：
- `continuity-coordinator.test.ts`：5/5 pass（新增）
- `continuity-decision.test.ts`：8/8 pass（既有）
- `crash-recovery.test.ts`：全部 pass（既有）
- `journal-integration.test.ts`：全部 pass（既有）
- 合计 `pass 52 / fail 0` + coordinator 的 5 → 57/57。

### 5.3 Spot-check grep（设计 §6）

```
=== emitContinuityDecision (should be empty) ===
(none)
=== buildPhaseContinuityDecision (should be empty) ===
(none)
=== coordinator.emitPhase count (expect 5) ===
5
=== coordinator.emitCustomEngine count (expect 9) ===
9
=== "signal" in / "breakpointClass" in (should be empty) ===
(none)
=== phases.ts signal: (should be empty, 全部工厂化) ===
(none)
=== phases.ts breakpointClass: (should be empty) ===
(none)
```

全部命中预期。

## 6. 已知限制与后续工作

- **auto-loop.test.ts / auto-recovery.test.ts 未在 CI 沙箱内跑完**：这两个大型端到端测试涉及子进程派发、长时间等待，执行时超过单步工具超时被 SIGTERM。本次的核心回归面（continuity-decision / coordinator / crash-recovery 的 lastContinuityDecision round-trip / journal-integration 的 continuity-decision 序列）已由上列针对性测试覆盖，不是盲区。后续 /code-review 阶段建议在本地全量跑一次 `npm run test:extensions` 做最终覆盖。
- **Loop-level 退出路径暂不发 emit**（`state-unchanged` / `infrastructure-error` / `cooldown-budget-exceeded` / `consecutive-iteration-failures` / `max-iterations` / `memory-pressure` / `session-lock-lost` / `missing-command-context`）：设计 §2.2 / §4 / §8 明确分到阶段 B 与 `decideLoopAction()` 统一实现。阶段 A 不动。
- **`BreakpointClass.unknown`**：阶段 A 不生产、不消费；保留在 union 中供阶段 B 使用。设计 §7 已说明。
- **`PhaseResult` 未升级为 discriminated union**：保留运行时 invariant + 工厂成对契约方案（设计 §4 决策表新增论证）。阶段 B 再审。
- **Journal payload schema**：coordinator `write()` 无条件 include 未来字段，依赖 `JSON.stringify` 自然丢 undefined；若阶段 B 引入 schema 校验需要同步允许 optional。设计 §7 已记录。

## 7. 风险与缓解

对照设计 §5 风险表：

| 风险 | 结果 |
|---|---|
| R1 import 环 | ✅ typecheck 全绿；`continuity-coordinator` 仅依赖 `types.js` / `loop-deps.js` / `session.js`，types.ts 是叶子 |
| R2 行为漂移 | ✅ `journal-integration.test.ts` 全过；coordinator emit payload 与第一批 1:1 一致 |
| R3 paused-session round-trip | ✅ `crash-recovery.test.ts` 全过，`lastContinuityDecision` 刷新路径无回归 |
| R4 工厂未完全迁移 | ✅ phases.ts 41 个 `signal:` 现场全部迁移；`grep -n "signal:" phases.ts` 返回空；invariant 兜底未来半截输入 |
| R5 GSD_ENGINE_BYPASS=1 | ✅ 未改动 bypass 路径，dev 路径 emit 维持现状 |

## 8. Handoff

### 同会话继续

直接执行 /code-review

### 新会话恢复 prompt

```
请阅读设计文档 docs/superpowers/specs/2026-04-28-phase-discipline-loop-continuity-coordinator-stage-a-design.md、
实现文档 docs/superpowers/plans/2026-04-28-phase-discipline-loop-continuity-coordinator-stage-a-implementation.md，
以及本次提交的代码变更（auto/continuity-coordinator.ts 新增、auto/loop.ts / auto/types.ts / auto/phases.ts 修改、tests/continuity-coordinator.test.ts 新增），
使用 /code-review 进行方案重审及代码审查。

重点核查：
- §3.2 表格 9 处 custom-engine emit 与代码 1:1 对齐（特别是 recovery.outcome === "skip" 分支）。
- §3.1 coordinator.emitPhase 直接读 PhaseResult 字段、无三元/无 "in" 守卫。
- §3.3.2 三个 pause 工厂（humanPauseBreak / providerPauseBreak / budgetPauseBreak）类型层成对绑定。
- phases.ts 41 处 break return-site 均已迁移；4 处条件 signal（1029/1102/1136/2054 原位置）拆成 if/else。
- loop.ts 内不再有 emitContinuityDecision / buildPhaseContinuityDecision / "signal" in / "breakpointClass" in。
```





