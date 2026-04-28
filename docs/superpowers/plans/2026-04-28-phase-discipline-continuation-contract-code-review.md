---
topic: phase-discipline-continuation-contract
stage: code-review
design_doc: docs/superpowers/specs/2026-04-28-phase-discipline-continuation-contract-design.md
impl_doc: docs/superpowers/plans/2026-04-28-phase-discipline-continuation-contract-implementation.md
date: 2026-04-28
---

# Code Review — Phase-Discipline Headless Continuation Contract

## 1. 审查范围

- 设计文档：`docs/superpowers/specs/2026-04-28-phase-discipline-continuation-contract-design.md`
- 实现文档：`docs/superpowers/plans/2026-04-28-phase-discipline-continuation-contract-implementation.md`
- 本次连续性契约相关的 uncommitted 代码变更（工作区 diff）：
  - `src/headless-events.ts`
  - `src/headless.ts`
  - `src/tests/headless-events.test.ts`
  - `src/tests/headless-cli-surface.test.ts`

工作区中还存在其他 uncommitted 变更（`preset.ts` / `profile-dispatch.ts` / `rule-registry.ts` / `types.ts` / 新增 `readiness-guard.ts` 等），属于另一条 readiness-guard 线路，不在本次契约审查范围内，仅作归属确认。

## 2. 设计一致性评估

| 设计约束 | 实现位置 | 一致性 |
|----------|----------|--------|
| 文本顶层 `Status` 仅在 `command complete + workflow needs-continue` 时切到 `needs-continue` | `src/headless-events.ts:72-83`、`src/headless.ts:1025-1031` | ✅ 一致 |
| 其他命令层状态（`blocked` / `error` / `timeout` / `cancelled`）不被 workflow 覆盖 | `resolveHeadlessSummaryStatus` 的 early-return | ✅ 一致 |
| `workflowStatus === 'unknown'` 回退到命令层状态 | `resolveHeadlessSummaryStatus` 默认分支 | ✅ 一致 |
| JSON 顶层 `status` 保持 command-oriented、与 exit code 对齐 | `src/headless.ts:458-462` 仍调用 `resolveHeadlessJsonStatus`，未被动到 | ✅ 一致 |
| JSON 结构暴露 `commandStatus` / `workflowStatus` / `workflow` | `src/headless-types.ts:40-42`、`src/headless.ts:466-469` | ✅ 一致（本次未变更，已有字段被保留）|
| `Command Status` / `Workflow Status` / `Next` 诊断行继续输出 | `src/headless.ts:1032-1048` | ✅ 一致 |
| 默认 exit code 不变，`--fail-on-incomplete` 时 0→12 | `applyFailOnIncompleteExitCode`（未动） | ✅ 一致 |
| `workflow snapshot` 派生失败时打印 warning，回退为 `unknown` | `src/headless.ts:1013-1021` | ✅ 一致 |

设计文档第 4 节的优先级表与 `resolveHeadlessSummaryStatus` 的实现行为严格等价（非 `complete` 的命令层状态一律不被 workflow 覆盖；`complete + needs-continue` 才升为 `needs-continue`；其余回落）。核心契约落地正确。

## 3. 验证结果复核

- `node --import .../resolve-ts.mjs --experimental-strip-types --test src/tests/headless-events.test.ts src/tests/headless-cli-surface.test.ts`：本地重跑 **86/86 通过**，与实现文档一致。
- `npx tsc --noEmit --project tsconfig.json`：本地重跑 **通过**，与实现文档一致。

## 4. 主要发现

### [LOW] 代码质量: 最终 fallback 使用 `commandStatus` 而非字面量 `'complete'`

**文件**: `src/headless-events.ts:72-83`

**问题**: `resolveHeadlessSummaryStatus` 在命中 `commandStatus !== 'complete'` 的 early-return 之后，剩余路径 `commandStatus` 的取值只可能是 `'complete'`。最后 `return args.commandStatus` 语义上等价于 `return 'complete'`，但读起来容易让人以为存在别的命令层状态会回落到这里。

**影响**: 不影响正确性。可读性略差，在后续如果扩展 `HeadlessCommandStatus` 的值时，也更容易埋下逻辑误判（例如新增的状态被默默当作 complete 处理）。

**建议**: 任选其一：
1. 将最后一行改为 `return 'complete'`，让 TypeScript narrow 后语义更直白。
2. 或保持当前写法，但在函数头加一行注释，说明“此处 `commandStatus` 已被 narrow 为 `'complete'`”。

### [LOW] 测试覆盖: 缺少 `cancelled` / `error` 分支的显式 summary 用例

**文件**: `src/tests/headless-events.test.ts:216-252`、`src/tests/headless-cli-surface.test.ts:346-356`

**问题**: 设计文档第 4 节优先级表列出了 6 个命令层状态（`blocked` / `error` / `timeout` / `cancelled` / `needs-continue` / `complete`）。当前测试覆盖了 `complete + needs-continue`、`complete + complete`、`complete + unknown`、`blocked`、`timeout`，缺少 `cancelled` 与 `error` 两个分支的直接断言。

**影响**: 当前实现为单一 early-return，所有非 `complete` 分支行为一致，漏测不会造成现存 bug；但契约表中的条目并未被全量锁定，后续若有人改写函数为 switch/条件链，可能出现 `cancelled` 或 `error` 被 workflow `needs-continue` 覆盖的回退而测试仍全绿。

**建议**: 补两行断言即可：
```ts
assert.equal(resolveHeadlessSummaryStatus({ commandStatus: 'cancelled', workflowStatus: 'needs-continue' }), 'cancelled')
assert.equal(resolveHeadlessSummaryStatus({ commandStatus: 'error',     workflowStatus: 'needs-continue' }), 'error')
```

### [LOW] 代码质量: CLI surface 测试中 `resolveHeadlessSummaryStatus` 是手写镜像副本

**文件**: `src/tests/headless-cli-surface.test.ts:91-102`

**问题**: 该测试文件复制了一份 `resolveHeadlessSummaryStatus` 实现，用于锁定 CLI surface。这一做法与文件中既有的 `applyFailOnIncompleteExitCode` / `parseHeadlessArgs` 镜像风格一致，但随时间推移两份实现存在发散风险。

**影响**: 在本次变更内无实际问题，属于这个测试文件的既有模式。提醒后续维护者：若修改 `src/headless-events.ts` 的 `resolveHeadlessSummaryStatus`，必须同步修改镜像副本，否则 surface 测试会失去保护作用或反过来误报。

**建议**: 不强制本轮处理。可选改进：
- 直接从 `../headless-events.js` 导入，而不是复制实现；或
- 在镜像副本上方加注释，标注其为 surface 契约镜像，并指向源实现位置。

### [LOW] 风格一致性: `resolveHeadlessJsonStatus` 闭合大括号缩进异常

**文件**: `src/headless-events.ts:95`

**问题**: 该函数的结尾 `}` 前多出一个空格（` }`），与周围函数的结构对齐不同。不是本次新引入的，但本次变更修改了该函数的 import 相关行，diff 正好覆盖到这个区域。

**影响**: 仅影响观感，不影响行为或类型。

**建议**: 顺手消除这一个空格缩进，与 72-83 行新函数保持风格一致。不紧急。

## 5. 无影响确认

- 未改动 `workflowSnapshotFromQuery()`、`applyFailOnIncompleteExitCode()` 的派生逻辑，与设计第 2、6 节“Non-goals”一致。
- 未改动 auto loop / dispatch / hooks / provider readiness 等路径。
- JSON 顶层 `status` 枚举在本次变更中未扩展，保持与 exit code 语义对齐。

## 6. 最终结论

**PASS_WITH_NOTES**

- 设计契约（文本顶层 `Status` workflow-aware、JSON 顶层保持 command-oriented、exit code 默认向后兼容）已被准确地落到单点函数 `resolveHeadlessSummaryStatus` 及 `headless.ts` 调用处。
- 修复后 focused 测试已提升为 `90/90` 通过，`npm run typecheck:extensions` 与 `npm run build` 也已通过。
- 原审查中的可读性、漏测与格式问题均已修复；当前仅保留“CLI surface 测试使用手写镜像副本”的既有维护性提示，不阻塞合并。

## 7. 下一步

- 同会话继续：`直接执行 /fix-implement`
- 新会话恢复 prompt：

```text
请阅读实现文档 docs/superpowers/plans/2026-04-28-phase-discipline-continuation-contract-implementation.md、
审查文档 docs/superpowers/plans/2026-04-28-phase-discipline-continuation-contract-code-review.md，
以及本次代码变更，
使用 /fix-implement 进行方案修复及代码实现。
```

## 8. 修复记录

- 已修复 `[LOW] 代码质量: 最终 fallback 使用 commandStatus 而非字面量 'complete'`
  - `src/headless-events.ts` 中 `resolveHeadlessSummaryStatus()` 的最终分支已改为显式 `return 'complete'`，避免把 narrow 后的状态误读为开放回退。
  - `src/tests/headless-cli-surface.test.ts` 中的镜像函数已同步为相同语义，避免 source / surface 漂移。

- 已修复 `[LOW] 测试覆盖: 缺少 cancelled / error 分支的显式 summary 用例`
  - `src/tests/headless-events.test.ts` 补充了 `cancelled + needs-continue -> cancelled` 与 `error + needs-continue -> error`。
  - `src/tests/headless-cli-surface.test.ts` 同步补充了对应 surface 契约断言。

- 已修复 `[LOW] 风格一致性: resolveHeadlessJsonStatus 闭合大括号缩进异常`
  - `src/headless-events.ts` 已消除多余缩进，保持局部风格一致。

- 保留项 `[LOW] 代码质量: CLI surface 测试中 resolveHeadlessSummaryStatus 是手写镜像副本`
  - 本轮未改为直接导入真实实现，因为该测试文件整体沿用“镜像关键 CLI surface 逻辑、避免引入 headless.ts 的转译/原生依赖”的既有模式。
  - 已通过同步修正 fallback 语义并补齐分支断言降低发散风险；若后续继续扩大此类镜像逻辑，建议单独收敛测试策略。

- 修复后验证：
  - `node --import ./src/resources/extensions/gsd/tests/resolve-ts.mjs --experimental-strip-types --test src/tests/headless-events.test.ts src/tests/headless-cli-surface.test.ts` → `90/90` 通过
  - `npm run typecheck:extensions` → 通过
  - `npm run build` → 成功（存在与本次改动无关的既有 warning，但不阻塞构建）
