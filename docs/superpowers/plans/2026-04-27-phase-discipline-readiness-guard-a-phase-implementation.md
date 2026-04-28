# Phase-Discipline Readiness Guard — A 阶段实现记录

**设计文档：** `docs/superpowers/specs/2026-04-27-phase-discipline-readiness-guard-a-phase-design.md`  
**评审文档：** `docs/superpowers/plans/2026-04-27-phase-discipline-readiness-guard-a-phase-design-review.md`  
**完成时间：** 2026-04-27

## 1. 评审意见处理摘要

### 已采纳

1. **移除 readiness-guard 对 pending gate / replan / escalation 的重复拦截**
   - 这些状态已由 `deriveState -> blocked phase` authoritative 处理。
   - A 阶段实现改为只覆盖 artifact-level readiness 和 task dispatch 映射问题。

2. **明确 task plan 的定义**
   - `execute-task` 的 task-level execution contract 以 `tasks/T##-PLAN.md` 为准。
   - 该文件由 DB task planning / `full_plan_md` 渲染生成；执行 prompt 会直接内联它。

3. **明确 `execute-task` 的 unitId 缺 task 段属于 `invalid_unit_id`**
   - 不再模糊落到 `task_not_found`。

4. **补齐 preset / registry / profile-dispatch 的实现边界**
   - 新增 readiness-guard builtin 接线。
   - 同步移除 `profile-dispatch` 中与 readiness-guard 重叠的“缺 slice PLAN -> advise plan-slice”分支。

5. **补齐 issue-code 表与修订记录**
   - 设计文档已同步更新，避免后续 review 再次围绕旧语义打转。

### 未采纳 / 转化处理

1. **仅用 DB 作为 task plan 判据**
   - 未直接采纳。
   - 原因：`execute-task` prompt 会直接内联 `tasks/T##-PLAN.md`，见 `src/resources/extensions/gsd/auto-prompts.ts:1594`。如果只看 DB、不看文件，会放过“执行契约文件未生成”的脏状态。
   - 最终实现改为：
     - `task_not_found`：仅在 DB 可用时检查 `getTask(mid, sid, tid)`
     - `task_plan_missing`：强制检查 `tasks/T##-PLAN.md`

## 2. 设计修订摘要

本次将 A 阶段方案收敛为 **A1 路线**：

- `plan-slice`
  - 缺 `RESEARCH.md` → `advise research-slice`
- `execute-task`
  - 缺 slice `PLAN.md` → `warning block`
  - DB 可用且 task 不在当前 slice 计划中 → `warning block`
  - 缺 `tasks/T##-PLAN.md` → `warning block`
  - `unitId` 缺 task 段 / 缺 milestone/slice → `error block`
- `pending gate / replan / escalation`
  - 继续由 `deriveState -> blocked phase` authoritative 处理
  - readiness-guard 不重复判断

## 3. 实现摘要

### 3.1 新增 readiness-guard builtin

新增文件：
- `src/resources/extensions/gsd/phase-discipline/readiness-guard.ts`

实现点：
- 非目标 unit 直接 `proceed`
- `plan-slice` 缺 `RESEARCH.md` 时返回 `advise research-slice`
- `execute-task` 在以下场景返回 block：
  - `invalid_unit_id`
  - `slice_not_found`
  - `plan_artifact_missing`
  - `task_not_found`（仅 DB 可用时）
  - `task_plan_missing`

### 3.2 接入 preset 和 registry

修改：
- `src/resources/extensions/gsd/phase-discipline/preset.ts`
- `src/resources/extensions/gsd/rule-registry.ts`
- `src/resources/extensions/gsd/types.ts`

实现点：
- 新增 `phase-discipline-readiness-guard` builtin 名称
- 将其插入 pre-dispatch hooks 顺序：
  1. `phase-discipline-phase-guard`
  2. `phase-discipline-readiness-guard`
  3. `phase-discipline-profile-dispatch`
  4. `phase-discipline-scout-fanout`
- `PhaseDisciplineCheckStage` 新增 `readiness-guard`

### 3.3 清理 profile-dispatch 的重叠职责

修改：
- `src/resources/extensions/gsd/phase-discipline/profile-dispatch.ts`
- `src/resources/extensions/gsd/phase-discipline/tests/profile-dispatch.test.ts`

实现点：
- 删除 `execute-task` 缺 slice `PLAN.md` 时 advise 回 `plan-slice` 的旧分支
- 保留 P3 / `IMPL-PLAN-VALIDATION.md` 的 advisory 逻辑

### 3.4 补测试

新增：
- `src/resources/extensions/gsd/phase-discipline/tests/readiness-guard.test.ts`

覆盖：
- `plan-slice` 缺 `RESEARCH.md`
- `execute-task` 缺 task 段
- `execute-task` 缺 slice `PLAN.md`
- `execute-task` DB task 不存在
- `execute-task` 缺 `T##-PLAN.md`
- readiness-guard 通过
- readiness-guard 在 preset 中先于 profile-dispatch 运行

## 4. 验证结果

### 4.1 定向测试

已执行：

```bash
node --import ./src/resources/extensions/gsd/tests/resolve-ts.mjs --experimental-strip-types --test \
  src/resources/extensions/gsd/phase-discipline/tests/readiness-guard.test.ts \
  src/resources/extensions/gsd/phase-discipline/tests/profile-dispatch.test.ts \
  src/resources/extensions/gsd/phase-discipline/tests/phase-guard.test.ts \
  src/resources/extensions/gsd/tests/pre-dispatch-advise.test.ts
```

结果：**24/24 通过**

### 4.2 Typecheck

已执行：

```bash
npm run typecheck:extensions
```

结果：**通过**

### 4.3 Build

已执行：

```bash
npm run build
```

结果：**通过**

说明：构建过程中出现了已有的 Next / `better-sqlite3` 相关 warning，但未导致本次构建失败，且不属于本次改动引入。

### 4.4 功能验证结论

- `plan-slice` 的 research readiness 已前移到 authoritative pre-dispatch gate
- `execute-task` 的 artifact-level readiness 已前移到 authoritative pre-dispatch gate
- `profile-dispatch` 不再重复承担缺 slice `PLAN.md` 的 gate 职责
- `deriveState -> blocked phase` 对 pending gate / replan / escalation 的既有 authoritative 角色保持不变

## 5. 已知限制

1. `task_not_found` 仅在 DB 可用时生效
   - 这是有意为之，避免在 DB 不可用时制造错误的强拦截

2. A 阶段仍不做 `advise` 后同轮 re-evaluate
   - 这仍属于 B 阶段议题

3. 本次未统一所有 builtin 的失败分类框架
   - 只把 readiness 问题前移，不扩成全链路重构

## 6. 下一步

- 同会话继续：`直接执行 /code-review`
- 新会话恢复 prompt：

```text
请阅读设计文档 docs/superpowers/specs/2026-04-27-phase-discipline-readiness-guard-a-phase-design.md、
实现文档 docs/superpowers/plans/2026-04-27-phase-discipline-readiness-guard-a-phase-implementation.md，
以及本次提交的代码变更，
使用 /code-review 进行方案重审及代码审查。
```
