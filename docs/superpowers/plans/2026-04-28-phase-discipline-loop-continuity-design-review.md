# Phase-Discipline Loop Continuity Design — Review

**Review date:** 2026-04-28
**Reviewer:** design-review skill (read-only)
**Subject:** `docs/superpowers/specs/2026-04-28-phase-discipline-loop-continuity-design.md`
**Related code:** `src/resources/extensions/gsd/auto/loop.ts`、`src/resources/extensions/gsd/auto/phases.ts`、`src/resources/extensions/gsd/auto/detect-stuck.ts`
**Related design:** `2026-04-28-phase-discipline-continuation-contract-design.md`、`2026-04-27-phase-discipline-readiness-guard-design.md`

## 1. 评审范围

- 设计目标、非目标与成功标准
- 方案 A/B/C 比较与方案 C 的核心思路
- ContinuitySignal 模型、Loop Continuity Coordinator、断点四分类、continuation budget、no-progress detector 升级、phase 职责调整、milestone close 自动续跑策略
- 错误处理、可观测性、风险与缓解、实施范围、验证计划

阅读对照：`auto/loop.ts`、`auto/phases.ts`（pause/stop 出口）、`auto/detect-stuck.ts`、`continuation-contract-design`。

## 2. 总体判断

**核心方向合理**：当前 phase 层在二十多个出口直接调用 `pauseAuto()` / `stopAuto()`（见 `phases.ts` 中 `pauseAuto` 出现 ~12 次、`stopAuto` 出现 ~15 次），continuity 决策被分散到各个 phase 和 helper 里，随着 phase 演进难免漂移与不一致。把"是否结束本次 invocation"上提到 `autoLoop` 顶层、phase 只产出结构化 `ContinuitySignal` 是符合现有架构、可维护性也更高的方向。方案 C 优于 A/B 的论证站得住脚。

**主要不足**：
- Coordinator 与现有 `pauseAuto()` 副作用（写 `paused-session.json`、closeout、释放锁、`resolveAgentEnd`、`s.active=false`）的"延迟执行"语义没有讲清楚；
- 现有 stuck detector（`detect-stuck.ts`）已经覆盖了相当一部分"no-progress"，文档没有说明新 detector 与旧 detector 的关系；
- 与同期的 `continuation-contract-design` / `readiness-guard-design` 的耦合点没有明确化；
- 部分关键边界（C 类自动续跑触发 budget 后究竟落到哪一类）有歧义。

**结论**：`NEEDS_REVISION` — 主方向不需要推翻，但在进入实现之前必须把上述具体问题补齐，否则实现阶段会被迫做大量隐含决策。

## 3. 主要发现

### [HIGH] 设计/与现状一致性: pauseAuto 的"延迟执行"语义未明确

**位置**：§7.2 Loop Continuity Coordinator、§7.8 `pauseAuto()`、§8 数据流

**问题**：当前 `pauseAuto()` 不只是"标记 s.active=false"，还会写 `paused-session.json`、closeout 当前 unit、释放 session lock、`resolveAgentEnd`。这些副作用是**有顺序、有耦合**的（例如 closeout 需要在 lock 释放之前完成）。设计文档把 `pauseAuto()` 描述为"顶层 coordinator 的最终执行器"，但没有说明：

- phase 已经做了哪些 partial closeout？coordinator 决定"继续"时这些 partial state 怎么回滚？
- coordinator 决定"暂停"时，是否原样调用 `pauseAuto()`，还是需要新增一个"延迟暂停"通道由 coordinator 触发完整的暂停序列？
- 如果 phase 内部已经 `await deps.pauseAuto(ctx, pi)` 又返回了 `pause-human` signal，coordinator 是否要再次调用？语义上是幂等吗？

**影响**：实现阶段如果靠"实现者自由判断"，极易出现 lock 释放顺序错乱、`paused-session.json` 内容与最终 continuity decision 不一致、或重复 closeout 导致 git/registry 异常的回归。

**建议**：补一节"pauseAuto 重构契约"，至少明确：
1. phase 不再直接调用 `pauseAuto()`，而是通过 signal 返回 pause 意图；coordinator 是 `pauseAuto()` 的唯一调用方。
2. 列出 `pauseAuto()` 的副作用清单与执行顺序（closeout → lock 释放 → resolveAgentEnd → 标记 active=false）。
3. 明确"pause 决策点"必须发生在 phase 内任何不可逆副作用之前——即 phase 在产出 `pause-*` signal 之前不应做 closeout。

### [HIGH] 设计/与现有组件的关系: 与 detect-stuck.ts 的关系未说明

**位置**：§7.7 no-progress detector 升级

**问题**：`auto/detect-stuck.ts` 已经实现了 5 条 stuck 规则（同 unit 3 次、A↔B 振荡、ENOENT 重复、validation code 重复、连续相同错误），并通过 `loopState.recentUnits` 持久化到 `runtime/stuck-state.json`。设计 §7.7 提出的"phase-discipline-aware NoProgressDetector"和现有 detector 的关系完全没有交代：

- 是替换旧 detector 还是叠加？
- 旧 detector 触发的 `stuck-detected` 在新模型下属于 D 类还是 B 类？文档 §7.3 把 "stuck hard stop" 划到 B 类（safety-required），把"连续两次落到同一 unitType/unitId"划到 D 类（suspicious no-progress），但旧 detector 的 Rule 2 就是"同 unit 3 次"——这两个分类边界互相冲突。
- 旧 detector 已经有 `stuckRecoveryAttempts` 这种"恢复尝试"语义；新模��里 retry-loop / no-progress 与之如何映射？

**影响**：实现阶段会出现两个 detector 并存、各自维护 window、彼此判定结果不一致的情况；分类边界不明会导致同一现象有时被当成 safety-required 立刻停、有时被当成 no-progress 报错，对用户体验和测试都很难收敛。

**建议**：在 §7.7 增加"detector 整合策略"小节：
1. 明确 NoProgressDetector 是 detect-stuck.ts 的**演进**还是**替换**；推荐演进——保留现有 5 条规则，新增"workflow snapshot 不变"、"next unit 不变"、"artifact 未变化"等维度。
2. 给出 stuck/no-progress 的统一映射表：哪些规则归 B 类（不可恢复，立即结束），哪些归 D 类（带明确错误码结束）。Rule 1（同错误重复）、Rule 4（ENOENT 重复）、Rule 5（validation code 重复）属 B；Rule 2/2b/3 + 新增 snapshot/next/artifact 不变 属 D。
3. 复用 `recentUnits` 持久化通道，避免引入第二份 stuck 状态文件。

### [HIGH] 设计/语义边界: budget 耗尽的归属类别未指定

**位置**：§7.6 continuation budget、§9 错误处理

**问题**：文档说"预算耗尽不是错误，但必须被清晰记录"，并新增了 `continuity-budget-exhausted`，但没有把它纳入 §7.1 的 ContinuitySignal 枚举，也没有放进 §7.3 的四类断点之一。具体疑问：

- per-invocation max unit budget 耗尽：归 A？B？D？还是新加一类"natural pause"？
- same-unit retry budget 耗尽：与 D 类 NO_PROGRESS 是否重叠？
- 行为差异：budget 耗尽时是 `pauseAuto()`（保留 paused-session）还是 `stopAuto()`（终止）？headless summary 中 workflow 是 `needs-continue` 还是 `blocked`？

**影响**：headless 用户最常碰到的"为什么这次只跑了 N 步"将无法被一致地解释；与 `continuation-contract-design` 的 commandStatus/workflowStatus 契约也对不上。

**建议**：
1. 把 `continuity-budget-exhausted` 加入 ContinuitySignal 枚举，明确归类为"软暂停"（行为等同 pause-human 但 reason class 不同）。
2. 明确 budget 耗尽默认走 `pauseAuto()`，`workflowStatus = needs-continue`，summary 中以 reason class 区分于人工 pause。
3. same-unit retry budget 耗尽与 D 类 NO_PROGRESS 合并语义——"重复尝试无进展"统一报 `NO_PROGRESS_ON_UNIT`，而不是分两条路径。

### [MEDIUM] 设计/与同期方案的耦合: 与 continuation-contract / readiness-guard 的边界未澄清

**位置**：§1 设计目标、§10 可观测性

**位置**：相关 specs `2026-04-28-phase-discipline-continuation-contract-design.md` 与 `2026-04-27-phase-discipline-readiness-guard-design.md` 都在做相邻领域的改造。

**问题**：
- continuation-contract 已经定义了 `commandStatus` / `workflowStatus` / `Next` 这套 headless 输出契约。本设计新增的 `breakpointClass`、`continuitySignal`、`humanRequired` 是否要进入 headless 输出？如果要，是 `commandStatus` 增加新枚举值，还是新增 `pauseClass` 字段？
- readiness-guard 是 dispatch 之前的"前置可用性"检查，其失败路径属于 A/B 类的哪一类？readiness 失败时是否允许进入"retry-loop"重试？

**影响**：三份设计如果不在边界上对齐，实现阶段三方都会假设对方"会做"，最后落空；headless 输出可能出现"workflowStatus=needs-continue 但其实是 budget 耗尽"等用户难以诊断的状态。

**建议**：在本文档加一节"与相邻设计的契约对接"：
1. 列出本设计需要 continuation-contract 增加的字段（建议至少 `pauseClass`、`continuationBudgetRemaining`），并标注是否要进入 JSON 契约。
2. 明确 readiness-guard 失败属 B 类（safety-required）；readiness 自身的 retry 仍由 readiness-guard 内部完成，coordinator 看到的失败即为终态。

### [MEDIUM] 设计/可观测性: continuity-decision 事件缺少落盘与回放约定

**位置**：§10 可观测性

**问题**：文档列了 `continuity-decision` 的 14 个字段，但没有说明：

- 落到哪里？现有有 `auto-loop-report.json`、journal events、`paused-session.json`，应该和哪个共存？
- 是否每轮都要发？高频写盘可能拖慢长 invocation。
- 是否要进入 paused-session 以便恢复时人能看到"上次为什么 pause"？

**影响**：可观测性是本设计成立的关键支撑（验证计划 §13.3 的多个 case 都依赖它），如果落盘策略不定，���证阶段会发现"事件存在但拿不到"。

**建议**：明确 continuity-decision 事件复用 journal 通道（与现有 `iteration-end` 同处），并在 `paused-session.json` 中冗余存储**最后一次** decision，方便用户在恢复时看清原因。

### [MEDIUM] 设计/A 类边界: "需要确认的 escalation / gate"过于模糊

**位置**：§7.3 A. Human-required breakpoint

**问题**：当前 phases.ts 中能映射到 A 类的明确出口包括：UAT pause、user-stop/backtrack、step-wizard、context-window pause、health-gate-failed、plan-v2-gate-failed、merge-reconciliation-blocked、context-window 等。但"明确需要用户确认的 escalation / gate"是个开放定义，新加的 gate（例如未来 budget gate、quality gate）默认归哪一类没有规则。

**影响**：随着 gate 增加，A 类白名单会无规则膨胀，本设计想避免的"症状驱动补丁"问题会以另一种形式回来。

**建议**：把 A 类定义改为**显式 opt-in**：每个 gate 必须在自身代码处声明 `breakpointClass: "human-required"` 才会被 coordinator 当成 A 类，否则默认走 D 类（可疑）+ 报错码，让设计上的健忘症变成显式失败而不是隐式跳过。

### [MEDIUM] 设计/跨 milestone 续跑: complete-milestone → next milestone 的人工边界缺失

**位置**：§7.9 `complete-milestone -> next milestone`

**问题**：文档把"跨 milestone 自动续跑"作为默认行为。但 milestone 边界往往是用户最希望介入的检查点（review、demo、stakeholder sign-off）。文档只说"除非预算耗尽或显式 human-required 命中"，没有讨论：

- 是否需要 milestone 级 opt-out（preference 配置）？
- 是否在 milestone 结束时给一个"软暂停"机会（默认通过、可配置成默认停）？
- 如果下一个 milestone 的第一个 unit 是 planning/research，这种长串自动续跑对 LLM 预算的影响？

**影响**：从"单次只推一两步"一下跳到"单次跨多个 milestone"，跨度很大，实际用户可能反而不舒服；E2E 验证里也会出现"一次 headless auto 跑了几十分钟"的 case，难以诊断。

**建议**：在 §7.9 增加：
1. 默认行为保留为"跑到 milestone terminal condition 后暂停"，跨 milestone 续跑作为 opt-in（preference flag 或 `--continuous-milestones` 标志）。
2. 即使 opt-in，per-invocation budget 默认值应保守（如 N=1 milestone）。

### [LOW] 设计/命名一致性: ContinuitySignal 命名与现有 PhaseResult 重叠

**位置**：§7.1 Continuity Signal

**问题**：当前 phase 已经返回 `PhaseResult` 含 `action: "next" | "continue" | "break"`。新加 `ContinuitySignal` 没有说明二者关系——是替换 `PhaseResult.action`，还是作为附加字段（`PhaseResult.signal`）？

**影响**：实现阶段两个枚举并存会让 phase 代码被迫同时维护两个语义维度。

**建议**：明确 ContinuitySignal **取代** `PhaseResult.action` 中的 break/continue，并保留 next 作为"phase 内部还要走下一步"的纯 phase-内意图。或者反过来——保留 action，把 ContinuitySignal 作为 break 的子类型。任选其一，但必须挑一个。

### [LOW] 设计/验证计划: 缺少回归门槛

**位置**：§13 验证计划

**问题**：列出了正面 case 和负面 case，但没有给出回归门槛（例如"所有现有 phase-discipline E2E 通过"、"`auto-loop-report.json` schema 不变"）。

**建议**：加一条"现有 phase-discipline 测试套件全部通过 + 现有 paused-session.json schema 向后兼容"作为最低回归要求。

## 4. 改进建议汇总

为帮助实现阶段对齐，建议在进入 `/design-implement` 之前对设计文档做如下补充修订：

1. 新增 §7.10 "pauseAuto 重构契约"：明确副作用顺序与 phase 端禁令。
2. 改写 §7.7：明确 NoProgressDetector 与 detect-stuck.ts 的演进关系与统一映射表。
3. 在 §7.1 ContinuitySignal 枚举中加入 `continuity-budget-exhausted`，并在 §7.6 / §9 给出归类与行为。
4. 新增"与相邻设计的契约对接"小节：列出对 continuation-contract 的字段需求与 readiness-guard 的边界划分。
5. 在 §10 增加 continuity-decision 事件落盘与 paused-session 冗余的明确约定。
6. 把 §7.3 A 类改为"显式 opt-in"模型，避免默认 A 类白名单无规则膨胀。
7. §7.9 跨 milestone 续跑改为 opt-in，明确默认 budget 与配置入口。
8. §7.1 明确 ContinuitySignal 与 PhaseResult.action 的取舍。
9. §13 增加回归门槛。

## 5. 最终结论

**结论：`NEEDS_REVISION`**

- 方案的核心思路（把 continuity 决策上提到顶层 coordinator、phase 只产出 signal、断点分四类、保留硬 budget）是合理的，与现有 `auto/loop.ts` 骨架契合，能够系统性地解决"loop 推进只动一两步"的体验问题。
- 但在进入实现之前必须补齐：pauseAuto 副作用契约、与 detect-stuck.ts 的整合策略、budget 耗尽归类、与 continuation-contract / readiness-guard 的边界、跨 milestone 续跑的默认值。否则实现阶段会被迫做大量隐含设计决策，回归风险高。

不需要推翻重设计。

## 6. 下一步

修订设计文档后，建议进入 `/design-implement`。

- 同会话继续：`直接执行 /design-implement`
- 新会话恢复 prompt：

```
请阅读设计文档 docs/superpowers/specs/2026-04-28-phase-discipline-loop-continuity-design.md
和评审文档 docs/superpowers/plans/2026-04-28-phase-discipline-loop-continuity-design-review.md，
使用 /design-implement 进行方案修订及实现。
```
