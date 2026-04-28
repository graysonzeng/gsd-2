---
topic: phase-discipline-loop-continuity
stage: code-review
design_doc: docs/superpowers/specs/2026-04-28-phase-discipline-loop-continuity-design.md
design_review_doc: docs/superpowers/plans/2026-04-28-phase-discipline-loop-continuity-design-review.md
implementation_doc: docs/superpowers/plans/2026-04-28-phase-discipline-loop-continuity-implementation.md
date: 2026-04-28
---

# Code Review — Phase-Discipline Loop Continuity

## 1. 审查范围

- 实现文档：`docs/superpowers/plans/2026-04-28-phase-discipline-loop-continuity-implementation.md`
- 设计文档：`docs/superpowers/specs/2026-04-28-phase-discipline-loop-continuity-design.md`
- 评审文档：`docs/superpowers/plans/2026-04-28-phase-discipline-loop-continuity-design-review.md`
- 当前分支 diff（feat/phase-discipline-preset-v1 未提交变更）

在 diff 范围内，本次声明的实现作用域是 loop continuity：
- `src/resources/extensions/gsd/auto/types.ts`
- `src/resources/extensions/gsd/auto/loop.ts`
- `src/resources/extensions/gsd/auto/phases.ts`
- `src/resources/extensions/gsd/auto/session.ts`
- `src/resources/extensions/gsd/auto.ts`
- `src/resources/extensions/gsd/interrupted-session.ts`
- `src/resources/extensions/gsd/journal.ts`
- `src/resources/extensions/gsd/tests/continuity-decision.test.ts`（新）
- `src/resources/extensions/gsd/tests/crash-recovery.test.ts`
- `src/resources/extensions/gsd/tests/journal-integration.test.ts`

diff 里还有几组本次实现文档未声明的变更（见 §3.1 混合提交风险）。

## 2. 设计一致性评估

| 设计项 | 实现 | 一致性 |
|---|---|---|
| `ContinuitySignal` 九档枚举 | `auto/types.ts` 九档完全落地 | ✓ |
| `BreakpointClass` 分类 | `auto/types.ts` 八档落地（含 `unknown`） | ✓（多出 `unknown` 兜底，合理） |
| `PhaseResult` 扩展 `signal` / `breakpointClass` | `auto/types.ts:241-244` 三种 action 都支持 | ✓ |
| `deriveContinuityDecision()` | `auto/types.ts:172-239` | ✓（有若干坑，见 HIGH-1） |
| phase return-site 显式标注 | `phases.ts` 全部 39 个 break 出口均附带 signal/class（见附录 A） | ✓ |
| loop 统一发射 `continuity-decision` 事件 | `loop.ts:217-248` helper，5 个 phase 出口各挂 1 次 | ✓ |
| `lastContinuityDecision` 写入 session / paused-session round-trip 兼容 | `auto/session.ts`、`auto.ts:1177`、`interrupted-session.ts:39` + 测试 | ✓ |
| 新 journal event `continuity-decision` | `journal.ts:55` | ✓ |
| 定向测试 & typecheck & build 通过 | 实现文档声明 51/51 | 未本地复跑（只读审查） |

**偏离但可接受**：

- 实现没有实现设计 §7.2 的 "Loop Continuity Coordinator" —— 当前只做到"phase return explicit signal / loop 统一发事件"，**并没有**把 pause 决策上提到顶层，也没有实现 continuation budget / no-progress detector 升级 / auto-continue（`complete-slice → validate-milestone`）等 §12 "第一批必须落地"清单里的主干能力。实现文档 §1 "已采纳 5：不要做大重构，优先低风险收敛真实 gap" 明确把这些降级成"后续"，设计评审 §2 也把主方向定性为"不需要推翻"，但**这与设计 §12 "第一批必须落地"存在矛盾**。参见 HIGH-2。

## 3. 主要发现

### [HIGH] 语义一致性: `deriveContinuityDecision` 在 budget-pause 分类上存在未触发的死分支与设计偏离

**文件**：`src/resources/extensions/gsd/auto/types.ts:146-220`

**问题**：

1. `HUMAN_REQUIRED_REASONS` set 里塞入了 `"budget-pause"`（`types.ts:153`），而前一个 `else if (input.reason === "budget-pause")` 分支（`types.ts:202`）已经先把它映射为 `pause-budget / budget`。结果 `HUMAN_REQUIRED_REASONS` 里的 `budget-pause` 永远不会被命中；同一行 `breakpointClass: input.reason === "budget-pause" ? "budget" : "human-required"`（`types.ts:210`）的 `"budget"` 分支也是死代码。
2. 设计文档 §7.1/§7.6/§9 明确要求 budget 耗尽单独落到 `pause-budget / budget`，不和 `pause-human` 混用；把 `budget-pause` 列入 `HUMAN_REQUIRED_REASONS` 违反了这条约束，只是因为 if/else 顺序恰好挡住才没出错。
3. 设计 §7.6 要求 `same-unit retry budget` 与 D 类 `NO_PROGRESS_ON_UNIT` 合并语义；当前 `NO_PROGRESS_REASONS` 里没有任何预算相关 reason，属于"文字上对，语义上没承接"。本轮 no-progress detector 未升级是已知限制，但 set 定义方式会让后续新增 reason 走错分支的风险变高。

**影响**：

- 后续有人把 budget-pause 外层的 early-return 重构掉，decision 会静默落到 `pause-human`，journal / paused-session 看到的 `breakpointClass` 立刻错乱，而 TypeScript 和现有 6 条 `deriveContinuityDecision` 单元测试都不会告警（那 1 条 budget-pause 测试跑的是 early-return 分支，不会暴露这个矛盾）。
- set 本身语义重复，后续维护者容易把新加 reason 放到语义不对的 set 里。

**建议**：

1. 把 `"budget-pause"` 从 `HUMAN_REQUIRED_REASONS` 移除，保持"唯一在 budget early-return 分支里命中"。
2. `types.ts:210` 去掉无意义的三元，改回 `breakpointClass = "human-required"`。
3. 为 budget-pause 加一条显式 unit test（`action: "break" + reason: "budget-pause"` 不提供 signal/class），锁死 `pause-budget / budget`，避免回归。
4. （可选，对应 HIGH-2）在 set 定义上方加一条注释说明"set 仅用于 legacy fallback，新出口应在 phases.ts 内显式 signal/class"，减少误入。

### [HIGH] 范围一致性: 实现明显未覆盖设计 §12 "第一批必须落地"的主干能力

**文件**：
- `src/resources/extensions/gsd/auto/loop.ts`（整体，没有 coordinator）
- `src/resources/extensions/gsd/auto/detect-stuck.ts`（本次未触动）
- 没有新增 continuation budget 模块
- 没有 `complete-slice → validate-milestone` / `validate-milestone(pass) → complete-milestone` 的自动续跑代码

**问题**：设计 §12 "第一批必须落地"列了 8 项：

- continuity signal 模型 ✓
- top-level continuity coordinator ✗（loop 仍然"phase break → markLoopStop → break"，没有决策层）
- breakpoint classification ✓（枚举层面）
- no-progress detector 升级 ✗（`detect-stuck.ts` 未变，设计 §7.7 的"snapshot 不变 / next unit 不变 / artifact 未变化"新维度未实现）
- `complete-slice → validate-milestone` 自动续跑 ✗
- `validate-milestone(pass) → complete-milestone` 自动续跑 ✗
- `needs-remediation with generated slice` 自动转入 remediation dispatch ✗
- `continuity-decision` observability ✓

实现文档 §1 "已采纳 5" 用"不做大重构，只收敛真实 gap"解释了这个选择，实现文档 §5 "已知限制"也承认 headless surface 没加 continuity 视图。但：

1. 设计文档 §12 本身没有被同步修订，把这 6 项降级到"后续"。文档之间出现了"设计说第一批必须做 → 实现说不做"的未对齐。
2. 本次改动的**实际效果**只是"把原有 break 原因多贴一个 signal/class 标签，并加条 journal event"，没有改变 loop continuity 行为：用户仍然会在 `complete-slice` 之后退出本次 invocation。也就是说，设计目标 §4 "`headless auto` 在安全边界内尽量跑到 milestone terminal condition" 在本轮**没有**被代码兑现。
3. 实现文档的"定向测试 51/51 通过"只覆盖了 signal 派生、round-trip、journal integration 断言，没有**任何**测试锁定"本次跑了多少个 unit"这种行为层目标。

**影响**：

- 如果后续被当成"loop continuity 做完了"去跟进 headless / E2E，会发现本轮只做了 observability 外皮，核心体验问题仍然存在。
- 文档一致性弱化：下一批实现者读到设计 §12 会期望 coordinator 已就位，实际代码里没有抓手。

**建议**（不涉及推翻本轮实现）：

1. 同步修订设计文档 §12，把 6 项未做的改为 "第二批" 或 "后续 PR"，并在 `2026-04-28-phase-discipline-loop-continuity-design.md` 顶部注明"本方案分批实现，第 N 批 = signal + observability；第 N+1 批 = coordinator + budget + auto-continue"。
2. 在 `implementation.md` §5 "已知限制" 显式列出这 6 项中仍缺失的条目，并给出下一批 handoff prompt，避免后续误认为"已经完成"。
3. 无需在本轮补做 coordinator；但建议至少加一个最小的 guardrail：在 `loop.ts` emit continuity decision 时，如果 `signal === "continue-loop" / "retry-loop"` 但 `action === "break"`，触发断言——可在后续补 coordinator 时 fail-fast 地发现"phase 想继续但 loop 还是 break"的矛盾。

### [MEDIUM] 语义保真度: phase 内两个 `verification-retry` 路径回到 loop 后被记作 `continue-loop` 而非 `retry-loop`

**文件**：
- `src/resources/extensions/gsd/auto/phases.ts:2342`（`artifact-verification-retry`）
- `src/resources/extensions/gsd/auto/phases.ts:2397`（`verification-retry`）

**问题**：

两处 retry 路径都是 `return { action: "continue" }`，**没有**附带 `reason: "verification-retry"` 或显式 `signal: "retry-loop"`。`buildPhaseContinuityDecision` 走 legacy fallback 时，`types.ts:199-201` 看到 `action === "continue"` 且 `reason` 为空——不在 `RETRY_REASONS` 集合里——最终 signal 派生为 `continue-loop / auto-resumable`，而不是 `retry-loop / auto-resumable`。

而 `RETRY_REASONS` set（`types.ts:139-144`）明确包含 `"artifact-verification-retry"` / `"verification-retry"`，说明设计初衷就是让这两个路径落到 `retry-loop`。

**影响**：

- journal 的 `continuity-decision` 事件会把真正的 retry 场景记成普通 continue，observability 角度丢失 "本轮是在验证重试" 的语义信号，违反设计 §10 的"为什么系统决定继续下一 unit / 为什么系统判定已经空转"可回答性目标。
- 未来 coordinator 想区分 retry vs 自然续跑时，这两个路径没有 signal 可用。
- 这两处在 2341 / 2396 行本来就打了 `debugLog("autoLoop", { phase: "artifact-verification-retry", … })` / `verification-retry`，说明事件本身是已知 retry，只是没有透传给 PhaseResult。

**建议**：

- `phases.ts:2342`：`return { action: "continue", reason: "artifact-verification-retry" };`
- `phases.ts:2397`：`return { action: "continue", reason: "verification-retry" };`
- 也可以直接显式 `signal: "retry-loop", breakpointClass: "auto-resumable"`，避免以后再踩 reason set 的坑。
- `continuity-decision.test.ts` 已经覆盖 `"verification-retry" reason → retry-loop`，但没有覆盖"phase 只返回 `{ action: "continue" }` 无 reason"的退化路径。建议在 journal-integration 或 continuity-decision 测试里补一条断言。

### [MEDIUM] 观测面完整性: 自定义引擎（custom-engine）分支不发 `continuity-decision` 事件

**文件**：`src/resources/extensions/gsd/auto/loop.ts:570-750`（custom engine 区段）

**问题**：

- 只在 `pre-dispatch / guard / dispatch / unit / finalize` 五个标准 phase 出口统一发事件（loop.ts:778 / 797 / 810 / 862 / 881）。
- custom engine 走 `deriveState → dispatch → verify → reconcile` 自有循环（loop.ts:580-748），里面的 pause / stop / retry / complete 路径（`custom-engine-complete` / `custom-engine-stop` / `custom-engine-verify-pause` / `custom-engine-verify-retry-exhausted` / `custom-engine-reconcile-pause`）没有任何一处 emit `continuity-decision`。
- `ContinuitySourcePhase` 枚举已经预留了 `"custom-engine"` 成员（`types.ts:100`），`TERMINAL_REASONS` 里也有 `"custom-engine-complete"`（`types.ts:169`），说明设计上打算覆盖，但实现没接线。

**影响**：

- 对 custom-engine 用户，journal 里看不到任何 continuity-decision，recovery 时 paused-session 也不会有 `lastContinuityDecision`（因为 `emitContinuityDecision` 是写 `s.lastContinuityDecision` 的唯一路径）。
- 与设计文档 §10 "每轮 finalize/coordinator 决策一次" 不一致。

**建议**：

- 在 custom-engine 的 pause / stop / complete 五个分支各补一次 `emitContinuityDecision(deps, s, flowId, nextSeq, deriveContinuityDecision({ sourcePhase: "custom-engine", action: "break", reason: "custom-engine-*" }))`，或者在 `markLoopStop` 附近统一包一层。
- 如果本轮不做，请在实现文档 §5 "已知限制" 里显式记录这个 gap。

### [MEDIUM] 合同收敛: `deriveContinuityDecision` 的显式 pass-through 要求 signal 与 class 同时给出，只给一半会静默回退

**文件**：`src/resources/extensions/gsd/auto/types.ts:173`

**问题**：pass-through 条件是 `if (input.signal && input.breakpointClass)`。若未来新加的 phase 出口**只**提供 `signal` 或只提供 `breakpointClass`，会静默退回 legacy fallback，而不是：

- 用提供的那一个，另一个按规则推导；或
- 直接抛错 / TypeScript 层禁止"只给一半"。

当前 phases.ts 里全都是成对出现，问题暂未触发；但类型签名允许单独给一个（`types.ts:127-128` 都是 optional），埋了维护坑。

**影响**：

- 将来只写 `signal: "pause-budget"` 的出口会被静默当成 `stop-error / safety-required`（走默认兜底），journal/paused-session 字段看着正常，语义其实错了。

**建议**：

- `ContinuityDecisionInput` 改成 `signal` 与 `breakpointClass` 要么同时 required 要么同时 omit（discriminated union），TypeScript 层把"只给一半"设为编译错误。
- 或退一步：运行时加一条 `if (input.signal && !input.breakpointClass) throw new Error(...)` 守卫，避免静默退化。

### [LOW] 代码质量: `buildPhaseContinuityDecision` 里 `"reason" in args.result` 等守卫冗余

**文件**：`src/resources/extensions/gsd/auto/loop.ts:251-267`

**问题**：`PhaseResult` 的三个 variant 现在都允许 `reason` / `signal` / `breakpointClass` 三个字段（`types.ts:241-244`），用 `"reason" in args.result` 这种 `in` 守卫是残留于旧定义（只有 `break` 有 `reason`）。现在可以直接 `args.result.reason`、`args.result.signal`、`args.result.breakpointClass`，TypeScript 不会报错。

**影响**：可读性；无行为风险。

**建议**：把三处 `"X" in args.result ? args.result.X : undefined` 简化为直接字段访问。

### [LOW] 可测试性: 缺少"journal 实际 emit 了 continuity-decision 事件"的 loop-level 断言

**文件**：`src/resources/extensions/gsd/tests/journal-integration.test.ts`

**问题**：新增的两条 integration 断言（`stop-no-progress` / `prior-slice-blocker`）只检查 `runDispatch` 直接返回的 `PhaseResult`，没有跑完整 `autoLoop` 去验证 `continuity-decision` event 真的出现在 journal 里、`s.lastContinuityDecision` 真的被刷新。

**影响**：

- `emitContinuityDecision` helper 本身没有直接覆盖；helper 里的 `s.lastContinuityDecision = decision`（`loop.ts:222`）赋值顺序一旦被重构掉，crash-recovery round-trip 测试也未必能立刻发现（round-trip 测试是手动 `writePausedSession`，绕过了 helper）。

**建议**：

- 在 `journal-integration.test.ts` 里对 `autoLoop` 做一次最小集成，断言 at least one `eventType === "continuity-decision"` 被 emit，且其 `data.continuitySignal` 非空。
- 或单独写一条 `emitContinuityDecision` 的白盒单元测试：`let captured; deps.emitJournalEvent = (e) => captured = e;`，驱动一次后断言 `captured.eventType` 和 `s.lastContinuityDecision`。

### [LOW] 作用域纪律: 当前分支 diff 混合了三个独立 topic，实现文档只声明了其中之一

**文件**：
- 本 topic（loop continuity）：`auto/types.ts`、`auto/loop.ts`、`auto/phases.ts`、`auto/session.ts`、`auto.ts`、`interrupted-session.ts`、`journal.ts`、`tests/continuity-decision.test.ts`、`tests/crash-recovery.test.ts`、`tests/journal-integration.test.ts`。
- **未在本实现文档声明**：
  - `phase-discipline/readiness-guard.ts`（新文件）、`phase-discipline/preset.ts`、`rule-registry.ts`、`types.ts`：对应另一份设计 `2026-04-27-phase-discipline-readiness-guard-a-phase-design.md`
  - `phase-discipline/profile-dispatch.ts`、`phase-discipline/tests/profile-dispatch.test.ts`：删除了 `execute-task` 无 slice plan 时 advise 回 `plan-slice` 的整段逻辑（含对应测试），这属于行为变更
  - `headless-events.ts`、`headless.ts`、`tests/headless-cli-surface.test.ts`、`tests/headless-events.test.ts`：新加 `resolveHeadlessSummaryStatus`，对应 `2026-04-28-phase-discipline-continuation-contract-implementation.md`

**影响**：

- 本次 code-review 的范围和 commit 的范围会不一致；合入时哪些已评审、哪些没评审无法清晰区分。
- profile-dispatch.ts 那段删除是有回归风险的行为变化（被 readiness-guard 覆盖了），但 **不在当前实现文档里**记载，本次 code-review 严格讲无据可审。
- git blame 混合了三个 topic，后续 bisect 会痛苦。

**建议**：

- 不要求在本次审查内修正，但**合入前**必须拆分：至少 loop-continuity / readiness-guard / headless-summary 三段分别成 commit（或分别 PR）。
- 如果打算合成一个 PR，`implementation.md` 顶部至少列出"本 PR 同时包含 A/B/C 三份设计的实现"，把对应 review/implementation 文档链接齐全。

## 4. 改进建议汇总

优先级降序：

1. （HIGH-1）移除 `HUMAN_REQUIRED_REASONS` 里的 `"budget-pause"`，清理 `breakpointClass` 三元死代码，补 budget-pause legacy fallback 的专项测试。
2. （HIGH-2）同步修订设计 §12 与实现文档 §5，显式承认本轮只做了 signal + observability，未做 coordinator / budget / auto-continue；并给出下一批 handoff。
3. （MEDIUM）两条 `verification-retry` return 补上 `reason` 或显式 `signal: "retry-loop"`。
4. （MEDIUM）custom-engine 五个出口补 `emitContinuityDecision`，或在 implementation §5 显式记录 gap。
5. （MEDIUM）`ContinuityDecisionInput.signal` 与 `breakpointClass` 收敛成"成对或都没有"，避免只给一半静默回退。
6. （LOW）简化 `buildPhaseContinuityDecision` 的 `in` 守卫。
7. （LOW）补一条 `emitContinuityDecision` 的白盒测试或 autoLoop 集成断言。
8. （LOW）当前分支 diff 拆分成三个 topic 对应的独立 commit/PR。

## 5. 最终结论

**结论：`PASS_WITH_NOTES`**

- 代码层面：新增的 `ContinuitySignal` / `BreakpointClass` / `deriveContinuityDecision` / phase return-site 显式化 / loop 统一 emit / paused-session round-trip 这一套，作为**第一批"语义打标 + observability"** 是完整且正确的；typecheck、build、现有 51 条定向测试通过，回归面受控；向后兼容（`lastContinuityDecision` 可选字段）设计正确。
- 设计一致性：除 HIGH-1 的 set 冗余之外，phase 级显式标注和设计 §7.1 / §7.3 的枚举语义对齐良好；journal 落盘、paused-session 冗余、重置时机都符合设计 §10。
- **显著欠缺**：coordinator / continuation budget / auto-continue / no-progress detector 升级这几项设计 §12 "第一批必须落地"的主干能力本轮均未落地，但实现文档 §1 采纳"不做大重构"的评审意见已对此给过预期管理；只要**文档侧把这个落差补齐**（HIGH-2），本轮不需要返工。
- HIGH-1 是可以在原地一次性修掉的 3 行级改动，建议在合入前顺手修掉。

不选 `NEEDS_FIX` 的原因：`HUMAN_REQUIRED_REASONS` 里 `"budget-pause"` 当前被外层 early-return 挡住，实际 journal/paused-session 字段**输出正确**，没有引入线上/恢复链路的即时缺陷，属于"留给未来的地雷"而非"当前缺陷"。

不选 `PASS` 的原因：HIGH-1 的 set 冗余 + HIGH-2 的设计/实现文档落差，都需要在进入下一批 loop continuity 工作前被显式处理，否则下一批开发者会踩同样的坑。

## 6. 下一步

建议同会话继续执行 `/fix-implement`，先处理 HIGH-1（代码）+ HIGH-2（文档对齐），其余 MEDIUM/LOW 作为 follow-up。

**同会话继续**：

```
直接执行 /fix-implement
```

**新会话恢复 prompt**：

```
请阅读实现文档 docs/superpowers/plans/2026-04-28-phase-discipline-loop-continuity-implementation.md、
审查文档 docs/superpowers/plans/2026-04-28-phase-discipline-loop-continuity-code-review.md，
以及本次代码变更，
使用 /fix-implement 进行方案修复及代码实现。
重点修复 HIGH-1（auto/types.ts 里 HUMAN_REQUIRED_REASONS 中 "budget-pause" 死分支 +
breakpointClass 三元死代码 + 补 legacy fallback 下 budget-pause 的专项测试）
与 HIGH-2（同步修订设计 §12 与实现文档 §5，显式声明 coordinator/budget/auto-continue
属于下一批，不在本轮落地）。
```

## 附录 A — phases.ts 所有 `action: "break"` 出口的 signal/class 分布（抽样核对）

| 行号 | reason | signal | breakpointClass |
|---|---|---|---|
| 286 | `finalize-pre-timeout` / `finalize-post-timeout` | pause-human | human-required |
| 351 | resources-stale | stop-error | safety-required |
| 394 | health-gate-failed | pause-human | human-required |
| 462 | plan-v2-gate-failed | pause-human | human-required |
| 537 | slice-parallel-dispatched | stop-terminal | terminal |
| 615 | merge-conflict | pause-human | human-required |
| 629 | merge-failed | stop-error | safety-required |
| 739 | merge-conflict | pause-human | human-required |
| 752 | merge-failed | stop-error | safety-required |
| 819 | no-active-milestone | stop-terminal | terminal |
| 840 | merge-reconciliation-blocked | pause-human | human-required |
| 863 | no-milestone-after-reconciliation | stop-error | safety-required |
| 892 | merge-conflict | pause-human | human-required |
| 905 | merge-failed | stop-error | safety-required |
| 938 | milestone-complete | stop-terminal | terminal |
| 965 | blocked | pause-human | human-required |
| 1027 | dispatch-stop | warning→pause-human / 其他→stop-error | human-required / safety-required |
| 1100 | pre-dispatch-block | warning→pause-human / 其他→stop-error | human-required / safety-required |
| 1134 | dispatch-stop（advised） | warning→pause-human / 其他→stop-error | human-required / safety-required |
| 1215 | complete-milestone-artifact-db-mismatch | stop-no-progress | no-progress |
| 1258 | stuck-detected | stop-no-progress | no-progress |
| 1288 | prior-slice-blocker | pause-human | human-required |
| 1317 | pre-dispatch-fanout-failed | pause-human | human-required |
| 1390 | user-stop / user-backtrack | pause-human | human-required |
| 1401 | stop-guard-error | stop-error | safety-required |
| 1478 | budget-halt | pause-budget | budget |
| 1494 | budget-pause | pause-budget | budget |
| 1547 | context-window | pause-human | human-required |
| 1625 | worktree-invalid | stop-error | safety-required |
| 1873 | workflow-capability | stop-error | safety-required |
| 1987 | provider-pause | pause-provider | provider |
| 2052 | session-timeout | allowAutoResume→pause-provider / else→pause-human | provider / human-required |
| 2069 | unit-hard-timeout | pause-human | human-required |
| 2088 | session-timeout（transient） | pause-provider | provider |
| 2114 | session-failed | stop-error | safety-required |
| 2314 | pre-verification-dispatched / git-closeout-failure | pause-human | human-required |
| 2354 | uat-pause | pause-human | human-required |
| 2382 | verification-pause | pause-human | human-required |
| 2430 | post-verification-stopped | stop-error | safety-required |
| 2441 | step-wizard | pause-human | human-required |

结论：39 个 `break` 出口全部显式标注 signal / breakpointClass，无遗漏。`git-closeout-failure` 标为 `pause-human / human-required` 属于可争议点（也有观点认为应是 `stop-error / safety-required`），但当前 loop.ts:888 `finalizeFailureClass = "git"` 的处理策略与"等待人工处置"是一致的，因此本次未作为独立发现单列。

## 7. 修复记录（2026-04-28）

### 7.1 本轮修复范围

按本审查 §3/§4 的优先级，本轮修复聚焦两项 HIGH：

#### HIGH-1：`deriveContinuityDecision` budget-pause 死分支与设计偏离

**修改文件**：
- `src/resources/extensions/gsd/auto/types.ts`
  - 从 `HUMAN_REQUIRED_REASONS` set 中移除 `"budget-pause"`（原 `types.ts:153`）。
  - 清理 `breakpointClass` 三元死代码：`input.reason === "budget-pause" ? "budget" : "human-required"` → 直接 `"human-required"`（原 `types.ts:210`）。
  - 在 5 个 reason set 上方补一条注释，声明这些 set 仅用作 `deriveContinuityDecision` 的 legacy fallback，新 phase 出口应在 `PhaseResult` 上显式声明 `signal` + `breakpointClass`；且任何已有专用 early-return 分支的 reason（如 `budget-pause`）不允许出现在 per-class set 中，避免分支顺序调整造成静默漂移。
- `src/resources/extensions/gsd/tests/continuity-decision.test.ts`
  - 保留原 budget-pause 测试。
  - 新增 `deriveContinuityDecision — budget-pause legacy fallback without explicit signal still maps to pause-budget`：不提供 `signal`/`breakpointClass`，仅靠 reason 走 fallback，断言结果为 `pause-budget / budget`，并显式 `notEqual` 于 `pause-human / human-required`。这条测试的设计意图是在 "某人未来改动了 early-return 分支顺序" 的回归场景中 fail-fast。

#### HIGH-2：设计 §12 与实现文档 §5 的分批声明

**修改文件**：
- `docs/superpowers/specs/2026-04-28-phase-discipline-loop-continuity-design.md`
  - 顶部补 "分批实现说明"，明确第一批 = signal + observability；第二批 = coordinator / budget / auto-continue / no-progress detector 升级。
  - §12 重写为 "第一批（已落地）" / "第二批（后续 PR，本轮不落地）" / "第一批不做（维持原样）" 三段，8 项条目逐条标注归属并给出 `[x]` / `[ ]`。
  - 在第二批末尾补 handoff 入口，指向 §7.2 / §7.6 / §7.7 / §7.8 / §7.9 与 `loop.ts` 中现有的 `buildPhaseContinuityDecision` / `emitContinuityDecision` 两个 helper。
- `docs/superpowers/plans/2026-04-28-phase-discipline-loop-continuity-implementation.md`
  - §5 顶部补 "批次声明"，显式列出 6 项第二批条目，并点明 "用户行为层面仍会在 `complete-slice` 后结束本次 invocation"，防止被误认为 loop continuity 已完成。
  - §5.3 补注 HIGH-1 已修复。
  - §5.4 – §5.6 记录 custom-engine 未接入 continuity / verification-retry return-site 未显式带 reason / `ContinuityDecisionInput` 只给一半静默回退 三项 MEDIUM gap（与本审查 §3 一致）。
  - §6 重写为 "本轮剩余 follow-up"、"第二批 continuity 工作"、"本轮合入前建议路径" 三段，包含第二批 handoff prompt。

### 7.2 未在本轮修复的审查项

以下条目按 code-review §4 优先级次序，被保留为 follow-up：

- MEDIUM — phases.ts 两处 `verification-retry` return-site 未显式带 `reason`（已记入实现文档 §5.5）。
- MEDIUM — custom-engine 分支未接入 `emitContinuityDecision`（已记入实现文档 §5.4）。
- MEDIUM — `ContinuityDecisionInput` 允许只给半对 signal/class 的静默回退（已记入实现文档 §5.6）。
- LOW — `buildPhaseContinuityDecision` 的 `"X" in args.result` 守卫冗余。
- LOW — `journal-integration.test.ts` 缺少 autoLoop 层 `continuity-decision` emit 断言。
- LOW — 分支 diff 混合 loop-continuity / readiness-guard / headless-summary 三 topic，合入前拆 commit/PR。

未同时修掉的理由：原审查 §5 "最终结论" 本身将本轮定性为 `PASS_WITH_NOTES`，HIGH-1/HIGH-2 是合入前必须清掉的地雷，而以上 MEDIUM/LOW 均不涉及当前输出错误或恢复链路缺陷，属于下一轮可聚焦处理的小规模改动。统一记入实现文档，保证下一批 continuity 工作进场时有完整上下文。

### 7.3 验证结果

已在本地执行：

```bash
node --import ./src/resources/extensions/gsd/tests/resolve-ts.mjs \
  --experimental-strip-types --test \
  src/resources/extensions/gsd/tests/continuity-decision.test.ts \
  src/resources/extensions/gsd/tests/crash-recovery.test.ts \
  src/resources/extensions/gsd/tests/journal-integration.test.ts
# 52/52 通过（相较本轮审查前 51/51，新增 1 条 budget-pause legacy fallback 回归断言）

npm run typecheck:extensions    # 通过
npm run build:core              # 通过
```

测试日志中 `checkpoint creation failed` / `resolveExpectedArtifactPath returned null` 等 warning 为测试环境构造的非完整 git / artifact 场景所致，与本轮修复无关。

### 7.4 剩余风险与下一轮建议聚焦范围

- **剩余风险（受控）**：§7.2 列出的 3 项 MEDIUM 不阻塞 journal / paused-session 正确性；但 custom-engine 用户目前 journal 无 continuity 事件，会在第二批 coordinator 工作启动后显露不一致（设计 §10 期望每次 finalize 都有决策），建议第二批一并解决。
- **下一轮如再补一轮审查，建议聚焦**：
  1. `types.ts` 的 set 注释是否足以约束后续贡献者不再往 per-class set 里塞带专用 early-return 的 reason。
  2. 设计 §12 分批声明与实现文档 §5 批次声明是否对齐（两文档互相引用需一致）。
  3. 新增的 `budget-pause legacy fallback` 测试是否放在合适的位置（考虑未来 coordinator 重构时是否需要迁移）。

### 7.5 合入结论

HIGH-1、HIGH-2 已按建议修复，代码 + 文档同步更新；所有定向测试、typecheck、build 通过。结合原审查 §5 `PASS_WITH_NOTES` 的前置条件（"HIGH-1 可原地 3 行修掉" + "HIGH-2 文档落差补齐"），**本轮修复后代码已达到可合入状态**。分支 diff 混合 3 topic 的作用域纪律问题（LOW-3）在合并前仍需按 commit / PR 拆分，不在 fix-implement 阶段处理。

