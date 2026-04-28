# Phase-Discipline Readiness Guard — A 阶段收敛设计

**Status:** Draft for review  
**Created:** 2026-04-27  
**Scale:** M 级  
**Author:** AI Assistant  
**Related:**
- `docs/superpowers/specs/2026-04-27-phase-discipline-readiness-guard-design.md`
- `docs/superpowers/plans/2026-04-26-reviewer-in-session-format-correction.md`
- `src/resources/extensions/gsd/phase-discipline/profile-dispatch.ts`
- `src/resources/extensions/gsd/phase-discipline/reviewer-hook.ts`

## 1. 设计目标

A 阶段只解决一个核心问题：

**把本应在 pre-dispatch 被拦下的输入不完整问题前移拦截，避免它们继续流入 `execute-task`、reviewer 或后续收口步骤。**

这次优化的首要成功标准不是 reviewer 失败率本身，而是：

- 明显减少缺 `RESEARCH.md` 却继续进入后续规划的情况
- 明显减少缺 `PLAN.md`、缺 task plan 却继续进入 `execute-task` 的情况
- 保持 pending gate / replan / escalation 继续由 `deriveState -> blocked phase` authoritative 处理，避免重复 gate
- 让 operator 在 pause 时看到明确、可操作的原因，而不是先跑错一步再靠 reviewer 或后置 hook 兜底

## 2. 规模判断

本次属于 **M 级**：

- 会改 phase-discipline 的 pre-dispatch 行为
- 会新增一个 builtin pre-dispatch hook
- 会影响 `plan-slice` 与 `execute-task` 两类关键单元的进入条件
- 但**不**修改 auto-loop 的同轮 re-evaluate 语义，不重构 dispatch 内核，不统一重做所有 builtin 失败分类

如果把 “advise 后同轮重新跑 hooks” 也纳入本次，那范围会膨胀到 L 级；本设计明确不这么做。

## 3. 问题定义

当前 phase-discipline 中，部分输入完整性问题发现得太晚：

- `execute-task` 缺少 `PLAN.md` 或 task-level 计划时，仍可能先通过 `profile-dispatch` 软建议路径继续漂移
- `plan-slice` 前若 research 不存在，真实约束分散在 scout-fanout、dispatch advice、post-unit review 之间，定位不集中
- reviewer 已经证明：**让后置步骤承担前置输入不完整的诊断成本，既贵又脆**

因此 A 阶段要做的是：

**把“输入是否 ready”从 reviewer / post-unit / 人工排查，前移到 pre-dispatch 的单一 authoritative gate。**

## 4. 范围与非目标

### 4.1 In Scope

新增 builtin pre-dispatch hook：`phase-discipline-readiness-guard`

仅覆盖两个目标单元：

1. `plan-slice`
2. `execute-task`

只检查**输入就绪性**，不检查内容质量。

### 4.2 Out of Scope

本次明确不做：

- `advise` 后同轮重新跑 hooks
- `research-slice` 深层 gating
- `refine-slice` 深层 gating
- reviewer、scout、verify-fuse 的统一失败分类框架
- artifact 质量评价
- deriveState 重构
- post-unit review 语义修改

这些内容进入 B 阶段讨论。

## 5. 方案对比

### 方案 A：混合策略前置拦截（推荐）

规则：

- 缺 `RESEARCH.md`：`advise research-slice`
- 缺 `PLAN.md` / task plan：`warning` 级 `block`，触发 pause
- task 在 DB 计划中不存在（仅 DB 可用时判定）：`warning` 级 `block`
- 明显状态矛盾：`error` 级 `block`，触发 stop
- pending gate / replan / escalation：继续由 `deriveState -> blocked phase` 处理，不在 readiness-guard 重复判断

**优点**

- 与当前 auto-loop 语义兼容
- 把“可安全自动回退”和“必须人工处理”分开
- 能最大化减少脏输入流入 `execute-task` / reviewer

**缺点**

- `advise` 仍依赖“下一轮再评估”而不是同轮闭环
- 不是完整调度收敛，只是第一层输入 gate

### 方案 B：统一 warning-block

规则：凡是前置条件缺失一律 `warning` 级 `block` + pause。

**优点**

- 语义最简单
- 不会因为 advice 路径导致链路继续漂移

**缺点**

- 对缺 `RESEARCH.md` 这种可安全自动回退的情况过于保守
- 明显降低 auto-mode 自推进能力
- 容易把本可自动修复的问题都变成 operator 负担

### 方案 C：尽量自动 advise 回退

规则：大多数缺失都转成 `advise` 到上游 unit，仅坏状态才 block。

**优点**

- 自动化最强
- 人工打断最少

**缺点**

- 在当前“不做同轮 re-evaluate”的前提下，语义不够稳
- 容易把“必须人工判断”的问题继续拖进后续步骤
- 会重复 reviewer 之前的教训：错误分类太乐观

### 结论

本次采用 **方案 A：混合策略前置拦截**。

## 6. 设计原则

1. **前置 gate 只做输入完整性，不做内容质量评价**
2. **可安全自动回退的问题用 `advise`，需要 operator 介入的问题用 `block`**
3. **本 hook 不写 artifact、不修改 GSD DB 业务状态、不补产物、不修改 prompt 语义；auto-loop 的 pause/stop 副作用仍由 `runDispatch()` 承担**
4. **本 hook 必须在 profile-dispatch 之前运行，成为更强的输入 gate**
5. **A 阶段不改变现有“advise 后下一轮再评估”的 loop 语义**

## 7. Hook 顺序

preset pre-dispatch hooks 顺序定义为：

1. `phase-discipline-phase-guard`
2. `phase-discipline-readiness-guard`
3. `phase-discipline-profile-dispatch`
4. `phase-discipline-scout-fanout`

理由：

- `phase-guard` 继续负责 validate/complete 等收口保护
- `readiness-guard` 成为输入完整性的 authoritative gate
- `profile-dispatch` 退回 soft advice 角色
- `scout-fanout` 仍只负责 `research-slice` 的生成型 fan-out

## 8. 输入 / 输出契约

### 输入

沿用现有 pre-dispatch hook 接口：

- `unitType`
- `unitId`
- `prompt`
- `basePath`

### 输出

`PreDispatchResult`

可能值：

- `proceed`
- `advise`
- `block`

约束：

- `advise` 只用于 `plan-slice` 缺 `RESEARCH.md`
- `warning` 级 `block` 只用于“当前 agent 无法安全自修，但状态并不矛盾”
- `error` 级 `block` 只用于“状态矛盾或基础定位失败”

## 9. 详细规则

### 9.1 全局规则

#### G1. 非目标 unit

如果 `unitType` 不属于 `{plan-slice, execute-task}`，直接 `proceed`。

#### G2. unitId 解析失败

如果无法从 `unitId` 中解析 milestone / slice：

- `action: block`
- `level: error`
- `code: invalid_unit_id`

对于 `execute-task`，若缺少 task 段，也视为 `invalid_unit_id`，而不是 `task_not_found`。

#### G3. 目录基础路径不存在

如果 milestone 或 slice 的 canonical path 不存在：

- `action: block`
- `level: error`
- `code: slice_not_found`

这是状态矛盾，不允许自动继续。

### 9.2 `plan-slice` 规则

#### P1. `RESEARCH.md` 存在

- `proceed`

#### P2. `RESEARCH.md` 缺失

- `action: advise`
- `advisedUnitType: research-slice`
- `code: research_artifact_missing`

原因：这是可安全自动回退的问题，不需要 operator 先介入。

### 9.3 `execute-task` 规则

#### E1. `PLAN.md` 缺失

- `action: block`
- `level: warning`
- `code: plan_artifact_missing`

#### E2. taskId 在 DB 计划中找不到（仅 DB 可用时）

- `action: block`
- `level: warning`
- `code: task_not_found`

说明：这里检查的是 `getTask(mid, sid, tid)` 是否存在，用于识别“dispatch 到了一个不在当前 slice 计划里的 task”。若 DB 当前不可用，不在 readiness-guard 重复制造降级告警，而是交回既有执行链路处理。

#### E3. task plan 文件缺失

- `action: block`
- `level: warning`
- `code: task_plan_missing`

说明：task-level execution contract 以 `tasks/T##-PLAN.md` 为准；它由 DB 中的 task planning / `full_plan_md` 渲染生成，执行 prompt 会直接内联该文件。

#### E4. 全部通过

- `proceed`

#### E5. 不在本 hook 重复检查的项

以下项继续由 `deriveState -> blocked phase` authoritative 处理，不在 readiness-guard 重复判断：

- pending gate-evaluate
- replan trigger
- pending escalation

## 10. 与现有组件的职责边界

### `phase-discipline-profile-dispatch`

保留，但角色收缩为：

- 软建议
- backoff
- phase ordering advisory
- `IMPL-PLAN-VALIDATION.md` 通过前的 plan/execution phase advisory

它不再承担“最低输入就绪性 gate”的主职责。

A 阶段实现时同步移除其旧的 `execute-task` 缺 slice `PLAN.md` → `advise plan-slice` 分支，避免与 readiness-guard 的 authoritative gate 重叠。

### `scout-fanout`

继续负责 `research-slice` 的 fan-out 生成。

readiness guard 不直接创建 research，也不消费 scout 输出；只判断 `RESEARCH.md` 是否已经就绪。

### reviewer hooks

reviewer 不再承担“发现 execute-task 根本不该开始”的前置职责。

成功标准是：

**更多输入不完整问题在 readiness guard 被截住，而不是流到 reviewer 才暴露。**

## 11. 数据流

### `plan-slice`

1. loop 选出 `plan-slice`
2. `phase-guard` 先运行（通常直接放行）
3. `readiness-guard` 检查 `RESEARCH.md`
4. 如果缺失：返回 `advise research-slice`
5. 本轮 dispatch 结束；下一轮再从 `research-slice` 路径推进

### `execute-task`

1. loop 选出 `execute-task`
2. `phase-guard` 先运行（通常直接放行）
3. `readiness-guard` 检查 `PLAN.md`、task plan，以及（DB 可用时）当前 task 是否存在于 slice 计划中
4. 如果任一不满足：返回 `warning` 级 `block`
5. `runDispatch()` 负责 notify + pause
6. operator 修复后再 resume
7. pending gate / replan / escalation 若存在，仍由 `deriveState -> blocked phase` 在 dispatch 之前截住

## 12. 错误处理

### warning-block

适用于：

- 缺 `PLAN.md`
- 缺 task plan
- task 不存在（仅 DB 可用时）

处理方式：

- `ctx.ui.notify(reason, "warning")`
- `pauseAuto()`
- 保持会话可恢复

原因：这些问题通常不是“系统坏了”，而是当前输入未就绪，agent 不应盲目继续。

### error-block

适用于：

- `unitId` 解析失败
- slice/milestone path 缺失
- 其他明确状态矛盾

处理方式：

- `ctx.ui.notify(reason, "error")`
- `closeoutAndStop()`

原因：这类问题继续自动化只会扩大混乱。

## 13. 成效指标

A 阶段主指标：

1. `execute-task` 被 readiness guard 拦截的次数中，缺 `PLAN.md` / task plan / `task_not_found` 的比例
2. 进入 reviewer 前，其 trigger artifact 实际上本可前置拦截的问题次数下降
3. `plan-slice` 因缺 `RESEARCH.md` 被安全回退到 `research-slice` 的次数

辅助指标：

- reviewer `reviewer_format_invalid` 次数
- reviewer `reviewer_unavailable` 次数
- `max_cycles_reached` 次数

这些辅助指标可以下降，但**不是 A 阶段的首要验收口径**。

## 14. 风险与缓解

### 风险 1：guard 过严，auto-mode 频繁 pause

缓解：

- 只对 `execute-task` 使用 warning-block
- `plan-slice` 缺 research 走 advise，不直接 pause
- 不在 A 阶段扩到更多 unit

### 风险 2：guard 过松，收益不明显

缓解：

- `execute-task` 的 artifact-level 前置项全部纳入首批
- pending gate / replan / escalation 保持由既有 blocked phase 处理，避免职责空洞
- 验证时统计“本可前置拦截但仍流到 reviewer”的残留案例

### 风险 3：职责边界再次漂移到 profile-dispatch

缓解：

- 文档明确：最低输入就绪性属于 readiness-guard
- profile-dispatch 只保留 advisory/backoff 角色

### 风险 4：A/B 边界被打穿

缓解：

- 明确不做同轮 re-evaluate
- 统一失败分类框架延后到 B 阶段

## 15. 验证计划

### 单元测试

#### `plan-slice`

- research exists → proceed
- research missing → advise research-slice
- invalid unitId → block error
- slice path missing → block error

#### `execute-task`

- plan exists + task valid → proceed
- plan missing → warning-block
- task missing (DB available) → warning-block
- task plan missing → warning-block
- execute-task unitId missing task segment → error-block

### 集成测试

- preset hook order: `phase-guard -> readiness-guard -> profile-dispatch -> scout-fanout`
- `plan-slice` 缺 research 时，dispatch advice 指向 `research-slice`
- `execute-task` 缺前置输入时，`runDispatch()` 产生 warning pause
- `profile-dispatch` 现有 soft advice/backoff 不被破坏

### 非回归验证

- validate/complete 仍由 `phase-guard` 保护
- `scout-fanout` 仍负责 `research-slice` fan-out
- reviewer hook 现有 blocked reason 语义不变

## 16. B 阶段预告（不属于本次实现）

B 阶段再讨论：

1. `advise` 后同轮重新跑 pre-dispatch hooks
2. scout-fanout / reviewer / impl-plan-validator 的统一“不可自修失败分类”
3. target-missing 与 reviewer_unavailable 的进一步拆分
4. `max_cycles_reached` 的自动诊断摘要

## 17. 关键决策

1. 本次是 **M 级**，不升到 L 级流程重构
2. A 阶段只做 `plan-slice` / `execute-task` 两类 unit 的 readiness guard
3. 采用 **混合策略**：缺 research 用 advise，缺 plan/task plan/DB task 映射用 warning-block，状态矛盾用 error-block
4. pending gate / replan / escalation 继续由 `deriveState -> blocked phase` authoritative 处理
5. 本次不修改 loop 的同轮 re-evaluate 语义
6. A 阶段首要成功标准是 **前移拦截**，不是 reviewer 失败率

## 18. 实施落点

建议变更文件：

- `src/resources/extensions/gsd/phase-discipline/readiness-guard.ts`（新增）
- `src/resources/extensions/gsd/phase-discipline/preset.ts`
- `src/resources/extensions/gsd/rule-registry.ts`
- `src/resources/extensions/gsd/phase-discipline/profile-dispatch.ts`（移除与 readiness-guard 重叠的缺 plan advise 分支）
- `src/resources/extensions/gsd/types.ts`（新增 `readiness-guard` issue stage）
- `src/resources/extensions/gsd/phase-discipline/tests/readiness-guard.test.ts`（新增）
- `src/resources/extensions/gsd/phase-discipline/tests/profile-dispatch.test.ts`（同步清理旧职责测试）
- `src/resources/extensions/gsd/tests/pre-dispatch-advise.test.ts`（验证 block/pause 语义；无需新增 loop 机制）

## 19. Issue Codes

| Code | Level | Meaning |
| --- | --- | --- |
| `research_artifact_missing` | advisory | `plan-slice` 缺 `RESEARCH.md`，安全回退到 `research-slice` |
| `plan_artifact_missing` | warning | `execute-task` 缺 slice `PLAN.md` |
| `task_not_found` | warning | `execute-task` 指向的 task 不在当前 DB slice plan 中（仅 DB 可用时判定） |
| `task_plan_missing` | warning | `execute-task` 缺 `tasks/T##-PLAN.md` |
| `invalid_unit_id` | fatal | unitId 缺 milestone/slice，或 `execute-task` 缺 task 段 |
| `slice_not_found` | fatal | milestone/slice 目录无法解析 |

## 20. 修订记录

- 2026-04-27：采纳设计评审的 A1 路线，移除 readiness-guard 对 pending gate / replan / escalation 的重复检查，明确这些状态继续由 `deriveState -> blocked phase` authoritative 处理。
- 2026-04-27：将 `task plan` 定义收敛为 `tasks/T##-PLAN.md`，并说明它由 DB task planning / `full_plan_md` 渲染生成；`task_not_found` 仅在 DB 可用时生效。
- 2026-04-27：明确 `profile-dispatch` 不再承担 `execute-task` 缺 slice `PLAN.md` 的 advise 职责，避免与 readiness-guard 重叠。

---

**结论：**

A 阶段不是“再修 reviewer”，而是把 reviewer 之前本该被挡住的输入不完整问题前移到一个新的 authoritative pre-dispatch gate 中。这样 auto-mode 仍保持一定自推进能力，但不再把明显未 ready 的输入继续交给 `execute-task`、reviewer 或后续收口步骤。