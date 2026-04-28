---
topic: phase-discipline-continuation-contract
stage: design-review
design_doc: docs/superpowers/specs/2026-04-28-phase-discipline-continuation-contract-design.md
date: 2026-04-28
---

# Design Review — Phase-Discipline Headless Continuation Contract

## 1. 评审范围

- 设计文档：`docs/superpowers/specs/2026-04-28-phase-discipline-continuation-contract-design.md`
- 交叉参考的现实代码：
  - `src/headless.ts`（`workflowSnapshotFromQuery`、`applyFailOnIncompleteExitCode`、summary 输出、JSON 装配）
  - `src/headless-query.ts`（`deriveHeadlessSnapshot`）
  - `src/headless-events.ts`（`resolveHeadlessTextStatus`、`resolveHeadlessJsonStatus`、`mapStatusToExitCode`、退出码常量）
  - `src/headless-types.ts`（`HeadlessCommandStatus`、`HeadlessWorkflowStatus`、`HeadlessJsonResult`）
  - `src/tests/headless-cli-surface.test.ts`、`src/tests/headless-events.test.ts`

## 2. 总体印象

- 设计围绕一个非常具体的用户痛点："headless auto 在只推进到下一可派发单元时却顶层报告 `Status: complete`，导致用户/CI 误判里程碑已完成"。问题聚焦、方向清晰、scope 边界在 §6 Non-goals 中明确圈定。
- 设计选择走"显式契约化"路线：分离 `commandStatus` 与 `workflowStatus` 两层，默认退出码保持向后兼容，严格模式下由 `--fail-on-incomplete` 触发 `12`。这是一个低风险、可测、可回退的路径，与当前代码结构高度契合。
- **关键事实**：代码侧已经大量落地了设计所述能力：`HeadlessCommandStatus`/`HeadlessWorkflowStatus` 类型、`workflowSnapshotFromQuery()`、`applyFailOnIncompleteExitCode()`、text summary 的 `Command Status` / `Workflow Status` / `Workflow Phase` / `Active Milestone` / `Next` 多行输出都已存在（见 `src/headless.ts:261–301, 1010–1044`），`needs-continue` 也已进入 `HeadlessCommandStatus` 枚举与 `mapStatusToExitCode()`。
- **真正剩下的 gap**（对照设计 §4 和代码 `src/headless.ts:1025`）：顶层 `Status:` 行仍然写的是 `commandStatus`，没有实现"当 `workflowStatus === "needs-continue"` 时顶层 `Status` 切换为 `needs-continue`" 的决定。以及 §5/§9 里关于 JSON 顶层 `status` 是否 workflow-aware 的决策尚未做出——当前 `resolveHeadlessJsonStatus()` 只基于 `exitCode`/`blocked`/`timedOut`，默认模式下永远返回 `success`。
- 设计文档没有把"哪些已经实现、哪些还没实现"的现状显式写清，可能误导后续实现者以为这是从零开工。这是本次评审的一个重要发现（见下文 HIGH-1）。

## 3. 发现（按严重度降序）

### [HIGH] 现状-设计偏差: 设计未标注"已实现/待实现"的边界

**位置**: §2 Current code reality、§3 Contract decision、§4 Text output design

**问题**: 设计文档第 2 节陈述了"current code can already derive `workflowStatus = needs-continue`，`--fail-on-incomplete` can already convert that to exit code 12"，但第 3/4 节之后完全以"从零提出"的口吻描述契约。实际代码中，`workflowSnapshotFromQuery()`、`applyFailOnIncompleteExitCode()`、`Command Status`/`Workflow Status`/`Next` 多行 summary 都已存在。真正未落地的是：
- 顶层 `Status:` 行仍然等于 `commandStatus`（`src/headless.ts:1025` 一行 `const status = commandStatus`），没有把 `workflowStatus === "needs-continue"` 映射到顶层。
- JSON 顶层 `status` 在默认模式下仍然返回 `success`，没有把 `workflowStatus` 的信息反映到顶层字段（`resolveHeadlessJsonStatus()` 在 `src/headless-events.ts:68–78` 只基于 `exitCode`/`blocked`/`timedOut`）。

**影响**: 实现者看完设计后容易重复造轮子或改错方向；代码审查者无法对齐"这次改动应该动哪些行"；回归风险集中在一两处具体分支上，若不点明，测试覆盖也容易偏。

**建议**: 在 §2 末尾补一小段 "Gap summary"，明确只剩两处需要改：
1. `src/headless.ts:1025` — 顶层 `Status:` 需要基于 `workflowSnapshot?.status === 'needs-continue'` 覆盖 `commandStatus`，前提是命令层也成功。
2. JSON 顶层 `status` 的决策 —— 要么保持 command-oriented（此时必须在 §5 里白纸黑字写清：消费者需读 `workflowStatus`），要么在 workflow 可用时切到 workflow-aware（需要扩展 `resolveHeadlessJsonStatus` 或在 `emitBatchJsonResult` 里二次覆盖）。

### [HIGH] 决策未收敛: JSON 顶层 `status` 的方向在文档里是开放题

**位置**: §5 JSON output design、§9 Recommended next step

**问题**: §5 要求 `status` "should be workflow-aware when a workflow snapshot is available, otherwise command-oriented"，但 §9 又把这一点列为"main review question"交给评审决定。同一份设计里对同一字段给了两种立场，且没有给出任一方向下的具体实现路径。`--fail-on-incomplete` 未启用时 `exitCode` 保持为 0，而 `resolveHeadlessJsonStatus` 当前只看 exitCode，因此"workflow-aware"方向必须要么让 exitCode 带出 `needs-continue`（破坏 §3 的"默认向后兼容"），要么让 JSON 装配在 exitCode 之外再读 `workflowSnapshot`。这两条路径差异很大，不能留给实现者临场决定。

**影响**: 实现阶段会被迫重新开一轮设计讨论；code-review 无法判断实现是否 "符合设计"；JSON 消费者（CI、脚本）的契约不稳定。

**建议**: 评审给出明确倾向——**推荐方案 B：JSON 顶层 `status` 保持 command-oriented（与 exit code 语义对齐），由 `workflowStatus` 字段单独承载 workflow 真相**。理由：
- 与默认退出码策略自洽（exitCode 0 ⇔ status success）。
- 消费者若关心 workflow，读 `workflowStatus`/`workflow.next` 即可；这两字段已经就位。
- 避免 JSON 顶层 status 的语义与 exitCode 出现"0 + incomplete"这种歧义组合。
- 若未来接入 `--fail-on-incomplete` 的 CI 路径，JSON `status` 将自动随 exitCode 变为 `incomplete`，语义一致。

相应地，设计文档应在 §5 去掉"should be workflow-aware when a workflow snapshot is available"一句的前半段，保留后半段"otherwise command-oriented"并明确为唯一方向；并在 §9 把这条开放题改为"已决策"。

### [HIGH] 契约缺口: 顶层 Status 切换的优先级没在 §7 完整列出

**位置**: §4 Text output design、§7 Error handling and edge cases

**问题**: §4 示例直接给出 `Status: needs-continue` 的输出，但没有规定"当 `commandStatus` 为 `complete`、`workflowStatus` 为 `needs-continue`、同时命令层还因某些原因标注 `blocked/cancelled/error/timeout` 时，顶层 `Status` 如何取舍"的完整优先级。§7 列了三条边界（snapshot 失败、command 非 complete、workflowStatus=unknown），但没有给出**统一的优先级决策表**。阅读者需要在三段散文里拼出规则。

**影响**: 实现时容易漏掉某个分支；回归测试也容易漏测 `blocked + needs-continue`、`timeout + needs-continue` 这类组合。

**建议**: 在 §4 或 §7 加一张决策表，语义如下（建议）：

| commandStatus | workflowStatus | 顶层 Status |
|---------------|----------------|-------------|
| blocked       | 任意            | blocked     |
| error         | 任意            | error       |
| timeout       | 任意            | timeout     |
| cancelled     | 任意            | cancelled   |
| complete      | complete        | complete    |
| complete      | needs-continue  | needs-continue |
| complete      | unknown         | complete（并输出 workflow 详情供诊断） |
| 无 snapshot   | —               | commandStatus |

并在测试计划 §8 把这些分支点明。

### [MEDIUM] 枚举一致性: text 用 `needs-continue`、JSON 保留 `incomplete`

**位置**: §5 末尾 "To reduce ambiguity, text mode should use `needs-continue`, while JSON can continue using the existing `incomplete` enum"

**问题**: 这种"故意分叉"让两个表层契约的枚举不对齐，消费者需要记住"文本说 needs-continue ≈ JSON 说 incomplete"。`HeadlessJsonResult['status']` 目前确实是 `'success' | 'error' | 'blocked' | 'cancelled' | 'timeout' | 'incomplete'`，但既然已经在类型上引入了 `HeadlessWorkflowStatus = 'complete' | 'needs-continue' | 'unknown'`、`HeadlessCommandStatus` 也已加入 `needs-continue`，再保留 `incomplete` 作为 JSON 顶层唯一词表意义不大——特别是当我们采纳"JSON 顶层保持 command-oriented"的决策后，JSON 顶层永远不会直接出现 workflow 词汇，`incomplete` 就只在 `--fail-on-incomplete` 场景出现。

**影响**: 长期看会让契约文档难写、让客户端需要做无意义的词表映射。

**建议**: 二选一，但文档要显式选：
- 选项 A（低改动）：保留现状，在 §5 把"为什么 JSON 保 `incomplete`"写成一条稳定结论（而不是"can continue"这种可选口吻），并在 CHANGELOG/用户文档里明确映射关系。
- 选项 B（更清爽）：JSON `status` 的 `'incomplete'` 改名为 `'needs-continue'`，并加一个 "deprecated alias" 说明窗口。若要走这条路必须单独评估兼容性影响，不属于"低风险第一阶段"。

推荐 A。

### [MEDIUM] 测试计划: 缺 "顶层 Status 优先级" 的组合覆盖

**位置**: §8 Verification plan 第 2 条

**问题**: 当前测试点列了 "command complete + workflow needs-continue → 顶层 needs-continue"、"command complete + workflow complete → 顶层 complete"、"command error → 顶层 error"。但没有覆盖：
- `blocked + workflowSnapshot 存在` 场景（验证 blocked 不被 workflow 状态掩盖）。
- `timeout + workflowSnapshot 存在`（同上）。
- `workflowStatus === 'unknown'` 场景（验证回落到 commandStatus，且仍打印 workflow details）。
- JSON 顶层 `status` 在 `--fail-on-incomplete=false` 且 workflowStatus=needs-continue 时的行为（验证不会意外变成 `incomplete`）。

**影响**: 以上分支若后续被改动，现有测试无法捕获回归。

**建议**: 在 §8 追加上述四条 case，并与 HIGH-3 的决策表一一对应。

### [MEDIUM] 环境字段未触及: `exitCode === 0 + Status: needs-continue` 对现有 CI 脚本的影响

**位置**: §3 Contract decision、§6 Non-goals

**问题**: 设计强调"默认 exit code 保持 0"以保证向后兼容，但顶层文本 `Status: needs-continue` 对于那些通过 grep `Status: complete` 判定成功的脚本/日志监控是**行为变更**。设计没有显式讨论这一类客户端（内部 CI、轮询脚本、外部集成）的迁移路径。

**影响**: 虽然 exit code 未变，但依赖文本的下游可能在升级后出现 "Status 不再匹配 complete" 的告警或误判。属于"低风险"声明与现实之间的一点裂缝。

**建议**: 在 §3 或 §6 显式加一句："文本 summary 顶层 `Status` 行语义从 command-oriented 变为 workflow-aware，grep `Status: complete` 的脚本需改为 grep `Command Status: complete` 或检查 exit code。"并考虑在 release notes / CHANGELOG 中点名这一条。

### [LOW] 文案细节: `Workflow Status: needs-continue` 与 `Status: needs-continue` 并列时信息冗余

**位置**: §4 示例输出

**问题**: 当顶层 `Status` 也是 `needs-continue` 时，紧随其后的 `Workflow Status: needs-continue` 会让人产生"两行说一样的话"的观感。虽然严格说前者是"顶层解读"、后者是"原始工作流状态"，但可读性有下降。

**影响**: 非阻断，只是观感问题。

**建议**: 可考虑在顶层 `Status` 与 `Command Status`/`Workflow Status` 相同或互相推导时，省略重复行；或者保持现状但在文档里点明"冗余是为了让 diagnostic 字段在异常场景（unknown 等）保持稳定位置"。推荐保持现状并在设计备注里一句带过——不值得为此加复杂逻辑。

### [LOW] 非目标的表述: "这份设计不解决真实多次调用原因"可以更主动

**位置**: §6 Non-goals 第 1 段

**问题**: 设计明确把"为什么种子 phase-discipline 里程碑有时需要多次 `headless auto`"排除出本期 scope，但没有留下一个后续任务的钩子（例如："完成本契约后，单独发起一个 investigation 记录在 plans/"）。未来很容易忘。

**影响**: 潜在 follow-up 容易遗失。

**建议**: 在 §6 末尾加一行"后续动作：在本契约合入后，单独创建调研任务 tracking multi-invocation 的根因（归档到 `{PLANS_DIR}/`）"。

## 4. 对核心方向的再审视（跳出框架）

- 问："是否存在更好的方向，彻底绕开这种双层 Status 的暴露？"
  - 替代 A：让 `headless auto` 在 `workflowStatus === needs-continue` 时内部自动循环，直到真正 terminal。**不采纳**：与 §6 明确的 non-goal "Avoid changing auto-loop scheduling" 冲突；风险高、回归面大；且用户可能恰恰希望外部编排器拥有调度权。
  - 替代 B：默认 exit code 直接带出 `needs-continue`（即把 `--fail-on-incomplete` 行为变成默认）。**不采纳**：破坏向后兼容，CI/脚本大面积受影响；而真正的价值——让人类读到的 summary 不再误导——不需要破坏 exit code 也能实现。
  - 替代 C：保留双层，但把 `commandStatus/workflowStatus` 合并为单一 `status` 语义。**不采纳**：会丢失"这次进程调用是否成功"与"整个工作流是否完成"两个独立信号，诊断性变差。

结论：**当前方向（双层 status + 顶层 workflow-aware + 默认 exit code 兼容）是正确选择**，不建议推翻。

## 5. 结论

- **结论标签**：`NEEDS_REVISION`
- 方向没问题，但文档本身存在两处需要在实现前定清的开放题（HIGH-2 的 JSON `status` 方向、HIGH-3 的顶层 Status 优先级决策表），以及一处"现状-设计边界"（HIGH-1）必须补齐以避免实现偏移。MEDIUM/LOW 级条目不阻断进入实现，但建议在修订时一并吸收。

## 6. 下一步

- 同会话继续：`直接执行 /design-implement`（建议在实现前先做一轮轻量的文档修订，把上述 HIGH 级条目补入设计文档，再开始改代码）。
- 新会话恢复 prompt：
  ```
  请阅读设计文档 docs/superpowers/specs/2026-04-28-phase-discipline-continuation-contract-design.md
  和评审文档 docs/superpowers/plans/2026-04-28-phase-discipline-continuation-contract-design-review.md，
  使用 /design-implement 进行方案修订及实现。
  ```
