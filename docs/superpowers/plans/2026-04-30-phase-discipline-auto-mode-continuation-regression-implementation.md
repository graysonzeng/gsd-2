# Implementation: phase-discipline auto-mode continuation regression

- Date: 2026-04-30
- Design Doc: docs/superpowers/specs/2026-04-30-phase-discipline-auto-mode-continuation-regression-design.md
- Review Doc: docs/superpowers/plans/2026-04-30-phase-discipline-auto-mode-continuation-regression-design-review.md
- Status: Completed

## 1. 评审意见处理摘要
- HIGH-1：采纳。设计文档已修正根级 `.gsd/ROADMAP.md` 的来源判断：问题靶点不是 `worktree-manager.ts` canonical resolver，而是错误回退到 `discuss-milestone` 后的 prompt / discussion 组装链路。实现对应修复 `auto-dispatch.ts` 回退入口与 `auto-prompts.ts` 的 discussion artifact path block。
- HIGH-2：采纳。新增 `resolveFinalizedMilestoneContextVisibility(basePath, milestoneId)`，操作化返回 `present` / `missing` / `path-conflict` 三态，并暴露 `canonicalPath`、`checkedBases`、`conflictingPath` / `reason`。
- HIGH-3：采纳。设计文档新增 §3.5，分析 `hasFinalizedMilestoneContext` 返回 false 的候选原因；实现保留 boolean helper，但改为委托三态 resolver。
- MEDIUM-1：采纳。验证计划不再假设 canonical resolver 会访问根级 ROADMAP；改为测试 discussion prompt 的 milestone-scoped path block 与 continuation stop 行为。
- MEDIUM-2：采纳。设计文档 §5.2 已落到 `uok/plan-v2.ts`、`auto-dispatch.ts`、`auto-prompts.ts` 的具体函数和返回结构。
- MEDIUM-3：采纳。continuation 下统一按 artifact visibility mismatch fail-closed，不再在 fail-closed 分支内拆分真实缺失 / 路径冲突 / 语义丢失。
- MEDIUM-4：采纳。设计文档补充了 `DispatchAction.stop`、`dispatch-stop` journal、`closeoutAndStop`、UI/headless reason 和不构造 `discuss-milestone` prompt 的行为。

## 2. 根因前提处理结论（按需）
- 适用性：适用。
- 处理策略：修订后实现。
- 结论：评审给出的 `WEAK_EVIDENCE` 被采纳为边界修订依据；实现不再依赖“canonical resolver 访问根级 ROADMAP”这个过度归因，而依赖已由代码核实的直接链路：execution-entry missing-context recovery 在 continuation target 存在时不应回退到 `discuss-milestone`。

### 2.1 消费的根因评审结论
- WEAK_EVIDENCE：根因方向“continuation contract 未统一”成立，但根级 ROADMAP 归因需要修正。

### 2.2 本次修订的前提边界
- 已确认事实：`auto-dispatch.ts` 的 execution-entry recovery 是 `execute-task → discuss-milestone` 回退直接入口；`worktree-manager.ts` canonical resolver 本身构造 milestone-scoped artifact path；`hasFinalizedMilestoneContext` 原本只返回 boolean，无法解释 missing / conflict。
- 未确认假设：真实 M005 会话中的具体 filesystem 状态仍需 real replay 或现场 artifact 复核才能完全确认。
- 对实现的影响：本次实现主路径修复不依赖该现场状态；无论是真缺失还是 path conflict，只要上一轮 continuity 已指向执行单元，都会 fail-closed 而不是重新访谈用户。

## 3. 采纳的设计修订
- 设计文档 §3.2 第 4 条修正为 prompt / discussion 组装链路问题。
- 设计文档 §3.5 新增 `hasFinalizedMilestoneContext` false 的原因分析。
- 设计文档 §5.1 / §5.2 明确修复靶点、resolver 返回结构、guard entry condition。
- 设计文档 §5.4 合并 supervised continuation fail-closed 分支，并明确停止语义。
- 设计文档 §6 修正测试计划，覆盖三态 resolver、continuation stop 和 discussion prompt path block。

## 4. 实现摘要
- `src/resources/extensions/gsd/uok/plan-v2.ts`
  - 新增 `MilestoneContextVisibility` 三态类型。
  - 新增 `resolveFinalizedMilestoneContextVisibility()`。
  - `hasFinalizedMilestoneContext()` 改为委托三态 resolver。
  - `compileUnitGraphFromState()` 的 finalized context 判断同步使用该 helper。
- `src/resources/extensions/gsd/auto-dispatch.ts`
  - execution-entry recovery 改为读取 visibility 诊断。
  - 当 `AutoSession.lastContinuityDecision` 是 auto-resumable execution target 且 visibility 非 `present` 时，返回 error-level `DispatchAction.stop`。
  - stop reason 包含 internal inconsistency、expected next unit、canonical path、checked bases 和 conflict/missing details。
- `src/resources/extensions/gsd/auto-prompts.ts`
  - `buildDiscussMilestonePrompt()` 增加 milestone-scoped artifact path block，明确 context / context draft / roadmap 路径，并禁止使用根级 `.gsd/ROADMAP.md` / `.gsd/CONTEXT.md` 作为 milestone artifact。
- `src/resources/extensions/gsd/tests/execution-entry-missing-context-4671.test.ts`
  - 增加三态 resolver 覆盖。
  - 增加 continuation missing / path-conflict fail-closed 覆盖。
  - 增加 discussion prompt milestone-scoped path 覆盖。
  - 保留既有非 continuation missing-context recovery 和 `GSD_PROJECT_ROOT` fallback 行为。

## 5. 验证结果
- 测试：`node --import ./src/resources/extensions/gsd/tests/resolve-ts.mjs --experimental-strip-types --test src/resources/extensions/gsd/tests/execution-entry-missing-context-4671.test.ts`，16/16 pass。
- 测试 + typecheck：`node --import ./src/resources/extensions/gsd/tests/resolve-ts.mjs --experimental-strip-types --test src/resources/extensions/gsd/tests/canonical-milestone-artifacts.test.ts src/resources/extensions/gsd/tests/execution-entry-missing-context-4671.test.ts && npx tsc --noEmit --project tsconfig.json`，18/18 pass，`tsc` exit 0。
- 兼容性测试：`node --import ./src/resources/extensions/gsd/tests/resolve-ts.mjs --experimental-strip-types --test src/resources/extensions/gsd/tests/uok-plan-v2-wiring.test.ts`，7/7 pass。
- 构建：未单独运行完整 build；本轮以 targeted regression + full TypeScript check 覆盖实现面。
- 功能验证：测试确认 continuation target + missing/path-conflict 不再 dispatch `discuss-milestone`，而是 error stop；合法 discussion prompt 包含 milestone-scoped roadmap/context 路径。

## 6. 已知限制与后续建议
- 尚未执行真实 M005 replay harness；如果需要端到端证明，应使用固定 `.gsd` 树和 journal 前置条件重放 `S02/T01 → discuss-milestone → roadmap ENOENT → ask_user_questions` 链路。
- 本次修复只覆盖 finalized milestone context 的 continuation guard 与 discussion prompt path；slice/task artifact visibility 可在后续按同样模式扩展。
- `GSD_PROJECT_ROOT` fallback 为兼容既有行为仍可返回 `present`；只有存在 live milestone worktree canonical root 重定向时，另一个视角的 context 才被视为 `lookup-base-mismatch`。

## 7. Handoff

### 7.1 同会话继续
`直接执行 /code-review`

### 7.2 新会话恢复 prompt
```text
请阅读设计文档 docs/superpowers/specs/2026-04-30-phase-discipline-auto-mode-continuation-regression-design.md、
评审文档 docs/superpowers/plans/2026-04-30-phase-discipline-auto-mode-continuation-regression-design-review.md、
实现文档 docs/superpowers/plans/2026-04-30-phase-discipline-auto-mode-continuation-regression-implementation.md，
以及本次提交的代码变更。
重点核对根因前提（如有）、设计修订、实现结果与验证证据是否一致，
使用 /code-review 进行方案重审及代码审查。
```
