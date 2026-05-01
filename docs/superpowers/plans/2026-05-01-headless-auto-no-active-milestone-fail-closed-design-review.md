# Design Review: headless-auto-no-active-milestone-fail-closed

- Date: 2026-05-01
- Reviewed Design: docs/superpowers/specs/2026-05-01-headless-auto-no-active-milestone-fail-closed-design.md
- Review Scope: 根因分析正确性、headless fail-closed 策略设计合理性、STATE.md 假心跳修复

## 1. 整体结论
- **PASS_WITH_NOTES**
- 一句话结论：根因分析准确、方案方向正确且聚焦，但交互策略白名单机制和 `showNextAction` 多处调用的影响面需要补充设计。

## 2. 根因评审结论（按需）
- 适用性：**适用**（方案正确性完全依赖根因判断）
- 结论：**SUPPORTED**
- 理由：代码证据链完整，推翻了监督日志中"等待 select 无人应答"的错误判断

### 2.1 证据检查

**充分。** 以下证据链完整支撑根因结论：

1. `src/headless-ui.ts:215-225` — 明确可见 `select` 的默认行为是选第一个 option；仅对 `Auto-mode is running` 标题做了特殊 `Force start` 处理。
2. `src/resources/extensions/shared/next-action-ui.ts:198-209` — RPC 模式下 `showNextAction` fallback 到 `ctx.ui.select()`，确认 headless 场景走的就是 `select` 方法。
3. `src/resources/extensions/gsd/guided-flow.ts:1647-1668` — "No active milestone" 时 `showNextAction` 的 actions 第一项是 `Create next milestone (recommended)`，选中后 dispatch `discuss-milestone`。
4. `src/headless.ts:100,754` — `auto` 在 `MULTI_TURN_COMMANDS` 中，`execution_complete` 被忽略；只有 terminal notification 才终止。
5. `src/headless.ts:803-804` — 非 supervised 模式下直接调用 `handleExtensionUIRequest` 自动回答。

根因判断"自动选第一项 → 误入 discuss → 无 terminal notification → 无限 idle"成立。

### 2.2 事实 / 假设边界检查

事实与假设区分清晰：
- **事实**：代码逻辑、事件流日志。
- **假设**：无（文档未把任何未验证推断写成事实）。

### 2.3 对方案的影响检查

根因结论直接支撑了方案 A 的选择：
- 问题出在 headless 传输层的"乐观自动回答"策略，所以修复放在 headless 层是最窄且最准确的切面。
- 如果根因是"guided-flow 不该发 select"（方案 C 的前提），则修复面完全不同。代码证据排除了方案 C 的前提。

## 3. 设计方案评审

### 3.1 需求与方向

**合理。** 解决了正确的问题：
- 目标 1（fail-closed）精准打击根因。
- 目标 2（机器可读终态）为 orchestrator/CI 提供明确语义，解决可观测性盲区。
- 目标 3（STATE.md 假心跳）是独立的可观测性修复，合理搭车。

非目标边界划定清晰，不越界修改 phase-discipline。

### 3.2 方案合理性

**整体合理，有两个需要补充的边界问题。**

**优点：**
- "默认 fail-closed + 白名单 safe-auto-response"的策略翻转哲学正确，符合 unsupervised 系统安全设计。
- 退出码复用 `EXIT_BLOCKED = 10`，reason 用 `needs-supervised-input` 做细化，兼容现有 exit code contract。
- `headless_blocked` 结构化事件设计良好，字段充分。

**需补充的问题见 §4 发现。**

### 3.3 实现可行性

- 改动面集中、可控（headless-ui、headless、headless-events/types、workflow-projections）。
- 测试计划覆盖单元 + 集成 + 回归三层。
- 风险分析合理，特别是对"误伤旧场景"的白名单策略。
- 工期评估 M 级合理。

### 3.4 文档质量

- 结构清晰，方案对比有理有据。
- 无未解决 TODO/TBD。
- §5.2 白名单机制的定义稍显抽象（见发现 MEDIUM-1）。

## 4. 主要发现

### CRITICAL

无。

### HIGH

### [HIGH-1] 方案合理性: `showNextAction` 广泛使用——白名单 vs 黑名单策略的影响面未量化

**位置**: §5.2 Headless 交互策略分层

**问题**: `guided-flow.ts` 中 `showNextAction` 被调用 **17 次**（L993, L1153, L1176, L1226, L1245, L1372, L1401, L1557, L1647, L1694, L1735, L1842, L1920, L1986, L2041, L2104 等处）。设计声明"未命中白名单的 select 默认按 requires-supervision 处理"，但文档只给了一个白名单例子（lock-guard Force start）。如果所有 `showNextAction` 的 select 默认被 block，那么绝大多数正常 auto-mode 推进中的 next-action 也会被 block，导致 **auto 模式几乎无法自动推进**。

**影响**: 如果白名单定义不准确，可能造成：(1) 严重回归——正常工作流中的 next-action 全部被 fail-closed 拦截；(2) 或者白名单过于宽松——本次修复的 case 仍可能漏过。

**建议**: 
1. 明确区分 "auto-loop 内部的 next-action select"（即已进入 auto-loop 后由 phase-discipline dispatch 产生的交互）与 "auto-loop 外部/bootstrap 阶段的 select"（如本次 bug 的 "No active milestone" 场景）。
2. 设计应提供白名单策略的 **判定维度**：例如基于 `select` 的 `title` 字段、调用阶段（bootstrap vs in-loop）、或 extension 发出的 metadata annotation。
3. 建议在设计中列出所有 17 处 `showNextAction` 调用的分类（哪些是 safe-auto、哪些是 requires-supervision），确保不回归。

### MEDIUM

### [MEDIUM-1] 方案合理性: 白名单策略的可维护性机制缺失

**位置**: §5.2 交互分类层

**问题**: 设计在 headless 层硬编码"哪些 select 可以自动回答"，但没有定义扩展协议——新增 extension 或新 `showNextAction` 调用时，如何让开发者知道需要同步更新白名单？

**影响**: 长期维护风险。随着 guided-flow 演进，白名单可能逐渐失效或不完整。

**建议**: 
- 考虑在 `showNextAction` 调用侧增加一个 metadata 字段（如 `headlessPolicy: 'auto' | 'supervised'`），让 extension 显式声明该交互是否可被 headless 自动回答。headless 层只需要读这个 annotation 即可。
- 或者退一步：在 headless 层基于 `title` 的模式匹配做白名单，但在设计中明确列出模式规则。

### [MEDIUM-2] 实现可行性: `headless_blocked` 事件在 stream-json 模式下的输出位置

**位置**: §5.3.2 结构化输出

**问题**: 设计定义了 `headless_blocked` 事件和最终 JSON 结果中的语义，但没有说明：
- 在 `--output-format stream-json` 模式下，`headless_blocked` 是作为一个独立事件行输出？还是只在最终 summary 中体现？
- 在 `--output-format text` 模式下，stderr 文案的输出时机和格式已定义，但 stdout 是否也需要输出？

**影响**: 外部 orchestrator 可能依赖 stream-json 逐行解析事件来做实时判断。

**建议**: 明确 `headless_blocked` 在三种输出格式（text/json/stream-json）下的行为。

### [MEDIUM-3] 方案合理性: `resolveCompletion()` 后 child session 的清理时序

**位置**: §5.4 父进程完成条件补强

**问题**: 设计说"如 child 之后自然退出，视为已完成后的资源清理"。但如果 child session（discuss-milestone）在 `resolveCompletion()` 之后还在执行（因为 `select` 被 block 后 child session 收到的是 cancel 还是什么？），child 的资源清理如何保证？是否需要显式 kill child process？

**影响**: 潜在的进程泄漏或孤儿进程。

**建议**: 补充 child session 终止机制：headless 在 `resolveCompletion()` 后是否需要发送 cancel/abort 到 child session，或设置一个 cleanup timeout？

### LOW

### [LOW-1] 文档质量: §5.3.1 中 `workflowStatus: unknown` 的语义可以更精确

**位置**: §5.3.1 终态语义

**问题**: 当 `headless auto` 因 `needs-supervised-input` 退出时，`workflowStatus` 设为 `unknown`。但此时我们明确知道状态是"无 active milestone"，用 `unknown` 不够精确。

**影响**: 较小，但外部脚本可能需要区分"真不知道状态"和"知道状态但需要人决策"。

**建议**: 考虑是否在 `HeadlessWorkflowSnapshot` 中补充 `reason` 字段，或者复用 `workflow.next.reason` 来传递更精确的语义。

## 5. 修订建议

1. **[必须]** 补充白名单策略的具体判定维度与完整分类表（HIGH-1），确保 17 处 `showNextAction` 都有明确分类。建议采用"annotation-based"方式让 extension 声明 headless policy，而非 headless 层硬编码匹配。
2. **[建议]** 明确 `headless_blocked` 在 stream-json 模式下的输出行为（MEDIUM-2）。
3. **[建议]** 补充 child session cleanup 时序说明（MEDIUM-3）。
4. **[可选]** 考虑在 `workflowStatus` 或 snapshot 中承载更精确的退出原因（LOW-1）。

## 6. 下一步建议

- 进入 **design-implement**：整体方向正确，根因成立，修复策略合理。HIGH-1 的补充应在实现阶段同步解决（即在实现白名单时完成分类表），不需要回到 design-brainstorm。
- 理由：核心设计决策（fail-closed 策略翻转、headless_blocked 终态）是正确的；需补充的是实现细节层面的边界定义，适合在实现中迭代完善。

## 7. Handoff

### 7.1 如果进入修订及实现
**同会话继续**
直接执行 $design-implement 或 /design-implement

**新会话恢复 prompt**
```text
请阅读设计文档 docs/superpowers/specs/2026-05-01-headless-auto-no-active-milestone-fail-closed-design.md
和评审文档 docs/superpowers/plans/2026-05-01-headless-auto-no-active-milestone-fail-closed-design-review.md，
重点核对根因分析（如有）、事实/假设边界、以及方案修订点，
使用 $design-implement（或 /design-implement）进行方案修订及实现。
```

### 7.2 如果回退重新设计
**同会话继续**
直接执行 $design-brainstorm 或 /design-brainstorm

**新会话恢复 prompt**
```text
请阅读设计文档 docs/superpowers/specs/2026-05-01-headless-auto-no-active-milestone-fail-closed-design.md
和评审文档 docs/superpowers/plans/2026-05-01-headless-auto-no-active-milestone-fail-closed-design-review.md，
重新评估根因分析（如需要）与设计方案，必要时推翻并重新设计。
使用 $design-brainstorm（或 /design-brainstorm）重新设计该方案。
```
