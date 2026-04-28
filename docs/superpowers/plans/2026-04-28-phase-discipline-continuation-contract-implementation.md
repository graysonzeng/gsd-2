---
topic: phase-discipline-continuation-contract
stage: design-implement
design_doc: docs/superpowers/specs/2026-04-28-phase-discipline-continuation-contract-design.md
review_doc: docs/superpowers/plans/2026-04-28-phase-discipline-continuation-contract-design-review.md
date: 2026-04-28
---

# Implementation — Phase-Discipline Headless Continuation Contract

## 1. 评审意见处理摘要

### HIGH

- `HIGH-1 现状-设计边界不清`
  - 处理：已采纳。
  - 动作：在设计文档中补充了 “Gap summary”，明确哪些能力已存在，哪些是本次真正需要落地的剩余 gap。

- `HIGH-2 JSON 顶层 status 方向未收敛`
  - 处理：已采纳。
  - 决策：JSON 顶层 `status` 保持 command-oriented，与 `exitCode` 对齐；workflow 真相由 `workflowStatus` 与 `workflow` 承载。

- `HIGH-3 顶层 Status 优先级未表格化`
  - 处理：已采纳。
  - 动作：在设计文档中新增优先级表，并将实现收敛为一个单点函数 `resolveHeadlessSummaryStatus()`。

### MEDIUM

- `MEDIUM-1 text/JSON 枚举不一致`
  - 处理：部分采纳。
  - 结论：本轮保持低风险路径，不改 JSON 顶层既有 `incomplete` 枚举；同时把这一点写成明确结论，不再保持开放口吻。

- `MEDIUM-2 测试计划缺组合覆盖`
  - 处理：已采纳。
  - 动作：补充 `blocked` / `timeout` / `unknown` 等优先级分支测试，以及 JSON 顶层保持 command-oriented 的验证。

- `MEDIUM-3 grep Status: complete 的脚本兼容性`
  - 处理：已采纳。
  - 动作：在设计文档中补充兼容性说明，明确建议改读 `Command Status: complete` 或检查 exit code + workflow 字段。

### LOW

- `LOW-1 Workflow Status 行与顶层 Status 行冗余`
  - 处理：不采纳逻辑变更，仅采纳文档说明思路。
  - 原因：保持字段位置稳定更利于诊断，本轮不值得为去重增加条件分支。

- `LOW-2 多次调用根因缺 follow-up`
  - 处理：已采纳。
  - 动作：在设计文档中补充后续单独 investigation 的跟踪建议。

## 2. 设计修订摘要

已更新设计文档 `docs/superpowers/specs/2026-04-28-phase-discipline-continuation-contract-design.md`，主要修订如下：

- 补充现状与剩余 gap 的明确边界。
- 锁定 JSON 顶层 `status` 为 command-oriented。
- 增加文本顶层 `Status` 的优先级决策表。
- 扩展验证计划，覆盖 `blocked` / `timeout` / `unknown` 分支。
- 增加文本契约变更对 grep 型脚本的兼容性说明。
- 补充后续 investigation 钩子与修订记录。

## 3. 实现摘要

### 3.1 生产代码

- `src/headless-events.ts`
  - 新增 `resolveHeadlessSummaryStatus()`。
  - 该函数封装了顶层文本 summary 的统一规则：
    - 若 `commandStatus !== 'complete'`，始终返回命令层状态。
    - 仅当 `commandStatus === 'complete'` 且 `workflowStatus === 'needs-continue'` 时，返回 `needs-continue`。
    - 其余情况显式返回字面量 `'complete'`，避免把 TypeScript narrow 后的状态误读为开放回退分支。
  - 顺手修正了 `resolveHeadlessJsonStatus()` 结尾的大括号缩进，使该区域风格一致。

- `src/headless.ts`
  - Summary 输出不再直接使用 `commandStatus` 作为顶层 `Status`。
  - 改为调用 `resolveHeadlessSummaryStatus({ commandStatus, workflowStatus })`。
  - `Command Status` / `Workflow Status` / `Next` 等诊断行保持不变。
  - JSON 顶层 `status` 逻辑未改，继续由 `resolveHeadlessJsonStatus()` 基于 exit code 决定。

### 3.2 测试代码

- `src/tests/headless-events.test.ts`
  - 新增 `resolveHeadlessSummaryStatus()` 的优先级测试：
    - `complete + needs-continue -> needs-continue`
    - `complete + complete -> complete`
    - `blocked + needs-continue -> blocked`
    - `timeout + needs-continue -> timeout`
    - `cancelled + needs-continue -> cancelled`
    - `error + needs-continue -> error`
    - `complete + unknown -> complete`

- `src/tests/headless-cli-surface.test.ts`
  - 新增镜像版 `resolveHeadlessSummaryStatus()` 测试，锁定 CLI surface 契约。
  - 镜像函数同步改为在 fallback 分支显式返回 `'complete'`，避免与源实现语义漂移。
  - 新增 JSON 契约测试，确认默认 incomplete workflow 下：
    - 顶层 `status === 'success'`
    - `workflowStatus === 'needs-continue'`
    - `workflow.next.action === 'dispatch'`
  - 补充 `cancelled` / `error` 在 workflow `needs-continue` 下仍保持命令层状态的 surface 断言。

## 4. 验证结果

### 4.1 定向测试

已执行：

```bash
node --import ./src/resources/extensions/gsd/tests/resolve-ts.mjs --experimental-strip-types --test src/tests/headless-events.test.ts src/tests/headless-cli-surface.test.ts
```

结果：`90/90` 通过。

### 4.2 类型检查

已执行：

```bash
npm run typecheck:extensions
```

结果：通过。

### 4.3 构建验证

已执行：

```bash
npm run build
```

结果：构建成功。

备注：构建过程中仍存在与本次改动无关的既有 warning（Next.js `middleware` 弃用提示、`better-sqlite3` 在 web 构建链路中的 unresolved warning），但未导致本次构建失败。

## 5. 已知限制

- 本次只修正 headless continuation contract 的展示与契约表达，不改变 auto loop 调度本身。
- 若真实 phase-discipline milestone 仍需多次 `headless auto` 才到 terminal，这一根因仍需单独 investigation。
- 本次没有引入新的 E2E rerun；当前变更以 focused tests + typecheck + full build 作为验证证据。

## 6. 下一步

- 同会话继续：`直接执行 /code-review`
- 新会话恢复 prompt：

```text
请阅读设计文档 docs/superpowers/specs/2026-04-28-phase-discipline-continuation-contract-design.md、
实现文档 docs/superpowers/plans/2026-04-28-phase-discipline-continuation-contract-implementation.md，
以及本次提交的代码变更，
使用 /code-review 进行方案重审及代码审查。
```
