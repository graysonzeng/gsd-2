---
topic: phase-discipline-loop-continuity-baseline-validation
stage: code-review
design_doc: docs/superpowers/specs/2026-04-29-phase-discipline-loop-continuity-baseline-validation-design.md
implementation_doc: docs/superpowers/plans/2026-04-29-phase-discipline-loop-continuity-baseline-validation-implementation.md
date: 2026-04-29
reviewer: code-review skill
---

# Phase-Discipline Loop Continuity · Baseline Validation · 代码审查

## 1. 审查范围

- **设计文档**：`docs/superpowers/specs/2026-04-29-phase-discipline-loop-continuity-baseline-validation-design.md`
- **设计评审**：`docs/superpowers/plans/2026-04-29-phase-discipline-loop-continuity-baseline-validation-design-review.md`
- **实现文档**：`docs/superpowers/plans/2026-04-29-phase-discipline-loop-continuity-baseline-validation-implementation.md`
- **代码变更**：
  - `src/resources/extensions/gsd/auto/loop.ts`（M，coordinator 接入 + summarizeWorkflowState + 证据注入）
  - `src/resources/extensions/gsd/auto/phases.ts`（M，30+ 处内联 PhaseResult → 工厂函数 + git-closeout-failure 重分类）
  - `src/resources/extensions/gsd/auto/types.ts`（M，pair-contract invariant + 7 个工厂函数）
  - `src/resources/extensions/gsd/auto/continuity-coordinator.ts`（新增，emit-only coordinator）
  - `src/resources/extensions/gsd/tests/continuity-coordinator.test.ts`（新增，7 个测试）
  - `src/resources/extensions/gsd/tests/continuity-decision.test.ts`（扩展，+1 个测试）

## 2. 设计一致性评估

### 2.1 设计目标对齐

| 目标 | 结论 | 依据 |
|---|---|---|
| coordinator 仍为 emit-only，不改行为层 | ✅ 一致 | `LoopContinuityCoordinator` 只暴露 `emitPhase` / `emitCustomEngine` / `getLastDecision`，loop.ts 的 break/continue/next 控制流逻辑未变 |
| 补齐 workflow status 证据字段 | ✅ 一致 | 新增 `summarizeWorkflowState()` 并在 pre-dispatch/dispatch/unit/finalize 四个 phase emit 中注入 `workflowStatusBefore/After`、`nextAction`、`nextUnitType`、`nextUnitId` |
| 工厂函数消除手工 (signal, breakpointClass) 配对 | ✅ 一致 | 7 个工厂函数覆盖全部分类；pair-contract invariant 在 `deriveContinuityDecision` 中硬校验 |
| 不扩大验证范围 | ✅ 一致 | 未引入 continuation budget / pause 权责变更 / 新的 E2E 路径 |

### 2.2 评审意见落地对齐

| 评审项 | 处理 |
|---|---|
| MEDIUM-1：明确验证执行方式 | ✅ 设计文档新增 §10.2 三层优先级，实现中通过测试驱动验证确认 |
| MEDIUM-2：场景 A/B 补关键代码路径 | ✅ §8 场景 A/B 已补充 loop 顶层 break 收口与 finalize/dispatch 观察点 |
| MEDIUM-3：补充 workflowStatusBefore/After | ✅ §9 已补充，代码已实现证据字段注入 |
| LOW：observability 充分性标准 | ✅ §12 末尾已补充最小充分性标准 |

### 2.3 设计一致性结论

**完全一致。** 代码变更严格遵循设计文档和评审意见，未发现设计偏离。

## 3. 代码审查发现

### [MEDIUM-1] 鲁棒性: finalize 后额外 deriveState() 调用缺少错误保护

**文件**：`src/resources/extensions/gsd/auto/loop.ts`（finalize 阶段，约 line 941-943）

**问题**：finalize 后为获取 `workflowStatusAfter` 执行了一次额外的 `deriveState()`：

```typescript
const finalizeAfterState = finalizeResult.action !== "break"
  ? await deps.deriveState(s.basePath)
  : undefined;
```

这是纯 observability 用途的调用。但 `deriveState()` 涉及文件 I/O 和状态解析，可能因磁盘满、文件损坏、并发写冲突等原因抛异常。如果抛出，会直接中断当前 loop iteration——导致一个**本应成功完成的 unit 执行**因 observability 采集失败而变成未记录的崩溃。

**影响**：observability 采集失败不应让主链路崩溃。在高并发或磁盘压力场景下，这个未保护调用是一个潜在的可用性风险。

**建议**：用 try/catch 包裹，失败时降级为 `undefined` 并记录 warning：

```typescript
let finalizeAfterState: GSDState | undefined;
if (finalizeResult.action !== "break") {
  try {
    finalizeAfterState = await deps.deriveState(s.basePath);
  } catch {
    // Observability-only — do not let state derivation crash the loop
  }
}
```

---

### [MEDIUM-2] 文档完整性: retry 路径信号分类变更未在实现文档中显式记录

**文件**：`src/resources/extensions/gsd/auto/phases.ts`（runFinalize 中两处 retry 返回）

**问题**：旧代码的 retry 路径返回 `{ action: "continue" }` 不携带 reason/signal/breakpointClass。经 `buildPhaseContinuityDecision` → `deriveContinuityDecision` legacy fallback 时，因 reason 为 undefined，`RETRY_REASONS.has("")` 为 false，最终分类为 `continue-loop` / `auto-resumable`。

新代码使用 `retryLoopContinue("artifact-verification-retry")`，显式设置 `signal: "retry-loop"`。

这是**语义上正确的修正**——retry 路径确实应该是 `retry-loop` 而非 `continue-loop`。但这构成一个 journal 层面的 observable 行为变更：`continuitySignal` 从 `continue-loop` 变为 `retry-loop`。

**影响**：任何依赖 journal 中 `continuitySignal === "continue-loop"` 来过滤 retry 事件的下游消费者会受影响。实现文档只提到"新增断言"，没有将此分类变更记录为已知行为变化。

**建议**：在实现文档 §5"已知限制"中补一条，说明 retry 路径的 signal 从 `continue-loop` 修正为 `retry-loop`，确认这是预期行为修正而非无意副作用。

---

### [MEDIUM-3] 覆盖度: summarizeWorkflowState phase 映射不完整

**文件**：`src/resources/extensions/gsd/auto/loop.ts`（`summarizeWorkflowState` 函数）

**问题**：当前映射只覆盖 5 个 GSD phase：

| phase | nextUnitType |
|---|---|
| `validating-milestone` | `validate-milestone` |
| `completing-milestone` | `complete-milestone` |
| `verifying` | `run-uat` |
| `executing` / `summarizing` | `execute-task` |
| 其它 | `undefined` |

缺少 `planning`（plan-slice/plan-task）、`completing-slice`（complete-slice）、`reassessing`（reassess-roadmap）等 phase 的映射，这些 phase 的 `nextUnitType` 将为 `undefined`。

**影响**：对当前基线验证的三组场景（A/B/C）不影响——这三组场景涉及的 phase 都已覆盖。但后续如果扩大验证范围或 coordinator 行为层依赖 `nextUnitType` 做续跑决策，这些 gap 会浮现。

**建议**：至少补充 `planning` → `"plan-slice"` 和 `completing-slice` → `"complete-slice"` 的映射，或在函数旁加注释标记已知 gap 与 follow-up 计划。

---

### [LOW-1] 语义修正: git-closeout-failure 信号重分类

**文件**：`src/resources/extensions/gsd/auto/phases.ts`（runFinalize "dispatched" 分支）

**问题**：旧代码将 `git-closeout-failure` 和 `pre-verification-dispatched` 合并为同一个 `humanPauseBreak` 分类（`pause-human` / `human-required`）。新代码将两者拆开：

- `git-closeout-failure` → `errorBreak`（`stop-error` / `safety-required`）
- `pre-verification-dispatched` → `humanPauseBreak`（`pause-human` / `human-required`）

这是语义修正——git closeout failure 是系统级错误而非人工干预需求。已有专门测试覆盖（`runFinalize git-closeout-failure uses errorBreak, not humanPauseBreak`）。

**影响**：journal 中 `git-closeout-failure` 事件的 signal 从 `pause-human` 变为 `stop-error`。不阻塞合入。

**建议**：无需额外操作，已测试覆盖。

---

### [LOW-2] 完整性: emitCustomEngine 不支持 workflow status fields

**文件**：`src/resources/extensions/gsd/auto/continuity-coordinator.ts`（`emitCustomEngine` 方法）

**问题**：Custom engine 路径的 `continuity-decision` 事件不携带 `workflowStatusBefore/After`、`nextAction`、`nextUnitType`、`nextUnitId` 字段。与 `emitPhase` 的证据面不对称。

**影响**：对当前基线验证无影响（三组场景不涉及 custom engine）。后续如需对 custom engine 路径做类似 observability 分析，需扩展此接口。

**建议**：标记为 follow-up，不阻塞本次合入。

---

### [LOW-3] 精确性: summarizeWorkflowState 中 nextUnitId fallback 链语义偏差

**文件**：`src/resources/extensions/gsd/auto/loop.ts`（`summarizeWorkflowState` 函数）

**问题**：

```typescript
nextUnitId: state.activeTask?.id
  ?? state.activeSlice?.id
  ?? state.activeMilestone?.id
  ?? state.lastCompletedMilestone?.id
  ?? undefined,
```

最后一级 fallback `lastCompletedMilestone?.id` 语义为"上一个已完成的 milestone"，与"下一个要执行的 unit" 语义不一致。

**影响**：对基线验证不构成阻塞。后续 coordinator 行为层如果依赖此值做决策可能产生误判。

**建议**：移除 `lastCompletedMilestone` 这一级 fallback，或在注释中标注其语义限制。

## 4. 验证闭环确认

| 检查项 | 结果 |
|---|---|
| 相关测试 | ✅ 15/15 通过（continuity-coordinator + continuity-decision） |
| typecheck | ✅ `npm run typecheck:extensions` 通过，无报错 |
| 构建 | ✅ `npm run build` 通过（实现文档 §4.4 已记录） |
| lint | ⚠️ 项目无 lint 脚本，不适用 |
| 功能确认 | ✅ 本轮为 observability 接线，不涉及独立 UI 入口；通过测试+typecheck+build 确认 |

## 5. 结论

**PASS_WITH_NOTES**

方案与设计目标、评审意见高度对齐，设计一致性无偏离。代码质量良好——工厂函数体系消除了 30+ 处手工 (signal, breakpointClass) 配对，pair-contract invariant 提供编译期+运行时双重保障，coordinator 提取干净、边界清晰。测试覆盖充分。

当前剩余关注点：
1. **MEDIUM-2**：retry 路径信号分类变更是正确修正，但需在实现文档中显式记录为已知行为变化。
2. **MEDIUM-3**：phase 映射不完整，对当前三组场景无影响，可标记为 follow-up。

## 6. 修复记录

### 本轮修复摘要

- 已修复 **MEDIUM-1**：`src/resources/extensions/gsd/auto/loop.ts` 在 `finalize` 后追加的 observability-only `deriveState(...)` 已改为 `try/catch` 降级；失败时仅写 warning，不再让 loop iteration 走入异常恢复分支。
- 已补充回归测试：`src/resources/extensions/gsd/tests/auto-loop.test.ts` 新增用例，验证 finalize 观测性 `deriveState(...)` 抛错时 loop 仍能继续并完成后续收口。
- 已同步更新实现文档，记录本次修复与新增验证证据。

### 验证结果

- ✅ 定向回归测试通过：
  - `node --import ./src/resources/extensions/gsd/tests/resolve-ts.mjs --experimental-strip-types --test --test-name-pattern "autoLoop continues when finalize observability deriveState fails" src/resources/extensions/gsd/tests/auto-loop.test.ts`
- ✅ continuity 相关测试通过：
  - `node --import ./src/resources/extensions/gsd/tests/resolve-ts.mjs --experimental-strip-types --test src/resources/extensions/gsd/tests/continuity-coordinator.test.ts src/resources/extensions/gsd/tests/continuity-decision.test.ts`
- ✅ `npm run typecheck:extensions` 通过
- ✅ `npm run build` 通过
- ⚠️ lint 不适用：项目根 `package.json` 无 `lint` 脚本

### 剩余风险 / 后续关注

- `MEDIUM-2` 与 `MEDIUM-3` 仍属于文档完整性 / 覆盖面 follow-up，不阻塞本轮合入。
- 本次新增的 targeted auto-loop 验收是精准回归验证，不代表 `src/resources/extensions/gsd/tests/auto-loop.test.ts` 全量当前完全绿；该文件中仍存在与本次修复无关的既有失败，应避免误判为本轮回归。

## 7. 下一步

代码已达到可合并状态，无需额外 handoff。
