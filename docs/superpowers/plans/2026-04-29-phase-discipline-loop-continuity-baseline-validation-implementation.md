---
topic: phase-discipline-loop-continuity-baseline-validation
stage: design-implement
design_doc: docs/superpowers/specs/2026-04-29-phase-discipline-loop-continuity-baseline-validation-design.md
review_doc: docs/superpowers/plans/2026-04-29-phase-discipline-loop-continuity-baseline-validation-design-review.md
date: 2026-04-29
---

# Phase-Discipline Loop Continuity · Baseline Validation · 实现记录

## 1. 评审意见处理摘要

### MEDIUM-1：明确验证执行方式（采纳）

已采纳并落地为两层内容：

1. **设计修订**
   - 在设计文档中新增“测试驱动验证 → 真实运行验证 → 代码路径分析”的优先级与结论口径。
   - 明确只有前两类才能写成“已验证现状”，代码路径分析只能写成静态推断。

2. **实现支撑**
   - 将 `workflowStatusBefore` / `workflowStatusAfter` / `nextAction` / `nextUnitType` / `nextUnitId` 真正接入 `continuity-decision` 事件。
   - 让 baseline 验证不再只依赖人工拼接 phase return-site，而是能直接从 journal 看到“workflow 当前状态、结束后状态、理论下一步”。

### MEDIUM-2：场景 A/B 补关键代码路径（采纳）

已在设计文档中补充 loop 顶层 break 收口与 finalize / dispatch 观察点，降低后续执行验证时的重复定位成本。

### MEDIUM-3：补充 `workflowStatusBefore/After` 证据面（采纳）

已在设计文档中明确要求采集，并在代码中真正填充这些字段，避免文档要求与运行时证据脱节。

### LOW：observability 充分性标准不明确（采纳）

已在设计文档中补充最小充分性标准：至少能用 `continuity-decision` + `auto-loop-report.json`，并在 pause 场景下辅以 `paused-session.json`，还原一次 invocation 的收口/继续链路。

## 2. 设计修订摘要

本次设计修订聚焦“验证到底怎么做、什么证据算数”：

- 明确验证方式分层，避免“最小验证”退化成“再读一遍代码”。
- 明确场景 A/B 的关键代码路径，后续验证时优先观察 `runFinalize` 返回值和下一轮 dispatch 是否发生。
- 明确 retry 场景的预期是“同次 invocation 内继续”，而不是 paused-session 收口。
- 明确 observability 充分性的判断标准。

## 3. 实现摘要

### 3.1 `auto/continuity-coordinator.ts`

扩展 `emitPhase(...)` 的上下文入参，允许 phase emit 时携带：

- `workflowStatusBefore`
- `workflowStatusAfter`
- `nextAction`
- `nextUnitType`
- `nextUnitId`
- 以及后续可能继续使用的 continuation 相关扩展字段

这些字段会进入 `deriveContinuityDecision(...)`，并最终写入 `continuity-decision` journal payload。

### 3.2 `auto/loop.ts`

新增最小 workflow 状态摘要逻辑，并在 phase emit 时填充证据字段：

- 修正文件头注释，使 loop 相位顺序与实际代码一致：`pre-dispatch -> guards -> dispatch -> runUnit -> finalize -> repeat`。
- 新增 `summarizeWorkflowState(state)`，将 `GSDState.phase` 映射为 baseline 验证需要的：
  - `workflowStatus`
  - `nextAction`
  - `nextUnitType`
  - `nextUnitId`
- 在 `pre-dispatch` / `dispatch` / `unit` / `finalize` 的 `coordinator.emitPhase(...)` 中注入这些证据字段。
- 对 `finalize` 阶段在 `action !== "break"` 时额外 `deriveState(...)` 一次，用于拿到本轮 unit 结束后的 workflow 状态，支撑场景 A/B：
  - `complete-slice -> validate-milestone`
  - `validate-milestone(pass) -> complete-milestone`
- 这样后续 baseline 验证时，可以直接从 `continuity-decision` 看到“before/after phase 是否变化、理论下一步 unit 是什么”，而不必只靠 report + 人工代码定位。

### 3.3 测试更新

#### `src/resources/extensions/gsd/tests/continuity-coordinator.test.ts`

新增断言：

- `emitPhase(...)` 能把 `workflowStatusBefore/After`
- `nextAction`
- `nextUnitType`
- `nextUnitId`

写入 decision 对象和 journal payload。

#### `src/resources/extensions/gsd/tests/continuity-decision.test.ts`

新增断言：

- `deriveContinuityDecision(...)` 在显式输入 workflow 状态与 next-action 证据时，会完整保留这些字段。

#### `src/resources/extensions/gsd/tests/auto-loop.test.ts`

新增回归断言：

- `finalize` 后用于 observability 的额外 `deriveState(...)` 一旦抛错，只记录 warning，不把整轮 iteration 打成异常退出；
- loop 仍会继续进入后续 `deriveState(...)` / terminal 收口，而不是被 `Iteration error` 分支接管。

### 3.4 `finalize` 观测性 deriveState 降级保护

针对 code-review 的 MEDIUM-1，在 `src/resources/extensions/gsd/auto/loop.ts` 的 `finalize` 收口补上了显式降级保护：

- 仅在 `finalizeResult.action !== "break"` 时尝试额外 `deriveState(...)`；
- 用 `try/catch` 包裹这次观测性读取；
- 失败时通过 `logWarning("dispatch", ...)` 记录告警，并回退为 `workflowStatusAfter = undefined`；
- 不再允许 observability 采集失败把本应成功完成的 unit 变成 loop 级异常。

这使 `workflowStatusAfter` 的采集重新回到“尽力而为但不影响主链路”的正确优先级。

## 4. 验证结果

### 4.1 相关测试

已通过：

```bash
node --import ./src/resources/extensions/gsd/tests/resolve-ts.mjs --experimental-strip-types --test --test-name-pattern "autoLoop continues when finalize observability deriveState fails" src/resources/extensions/gsd/tests/auto-loop.test.ts
```

结果：1/1 通过，覆盖 `finalize` 后观测性 `deriveState(...)` 抛错时 loop 继续运行的回归场景。

已通过：

```bash
node --import ./src/resources/extensions/gsd/tests/resolve-ts.mjs --experimental-strip-types --test src/resources/extensions/gsd/tests/continuity-coordinator.test.ts src/resources/extensions/gsd/tests/continuity-decision.test.ts
```

结果：15/15 通过。

### 4.2 typecheck

已通过：

```bash
npm run typecheck:extensions
```

过程中发现并修复了一个真实问题：我最初错误地把不存在的 phase `running-uat` 写进了 `summarizeWorkflowState(...)` 映射，typecheck 直接指出类型不匹配，随后改为现有 phase `verifying`。

### 4.3 lint

未执行，原因：项目根 `package.json` 中**没有定义 `lint` 脚本**（已复核 scripts 列表），因此本轮只能记录为“不适用”，不能伪造 lint 结论。

### 4.4 构建

已通过：

```bash
npm run build
```

结果：构建成功。

补充说明：web build 输出了已有 warning（Next.js middleware convention / `better-sqlite3` web import warning / `file-lock.ts` critical dependency warning），但本次构建未失败，且这些 warning 与本次 continuity baseline 改动无直接因果关系。

### 4.5 功能确认

本轮是后端/运行时 observability 改动，不涉及独立 UI 交互入口；因此功能确认方式为：

- 通过定向测试确认 decision/journal 字段落盘契约；
- 通过 typecheck 与全量 build 确认改动可编译、可集成；
- 为下一步“真实运行验证场景 A/B”补齐运行时证据字段。

换句话说，本次并未声称“场景 A/B 已经真实跑完”，而是完成了使这些场景能够被**测试驱动或真实运行方式可靠观测**的基础接线。

## 5. 已知限制

1. 本次没有直接执行最小真实项目上的 `/gsd auto` 验证，因此场景 A/B 当前仍属于“已补齐观测能力，待运行时取证”。
2. `finalize` 阶段为了拿到 `workflowStatusAfter`，在 `action !== "break"` 时多执行了一次 `deriveState(...)`；这是刻意的 observability 交换成本，后续若要长期保留，可再评估是否需要缓存或只在特定 unitType 上开启。
3. 项目当前没有统一 lint 脚本，验证闭环里这一环只能如实标记为不适用。
4. `src/resources/extensions/gsd/tests/validate-milestone.test.ts` 当前存在与本次改动无关的既有失败（`#4658` 相关断言），因此未将其作为本次改动的验收门。

## 6. 下一步

建议下一步直接进入 `/code-review`，重点看两件事：

1. `workflowStatusBefore/After` 与 `nextUnitType` 的证据字段是否足够支撑 baseline 场景 A/B。
2. `finalize` 后补一次 `deriveState(...)` 的 observability 成本是否可接受，是否需要更窄的触发条件。

**同会话继续**:
直接执行 /code-review

**新会话恢复 prompt**:
```text
请阅读设计文档 docs/superpowers/specs/2026-04-29-phase-discipline-loop-continuity-baseline-validation-design.md、
实现文档 docs/superpowers/plans/2026-04-29-phase-discipline-loop-continuity-baseline-validation-implementation.md，
以及本次提交的代码变更，
使用 /code-review 进行方案重审及代码审查。
```
