---
topic: phase-discipline-loop-continuity-coordinator-stage-a
stage: design-review
design_doc: docs/superpowers/specs/2026-04-28-phase-discipline-loop-continuity-coordinator-stage-a-design.md
parent_topic: phase-discipline-loop-continuity
date: 2026-04-28
reviewer: design-review skill
---

# Phase-Discipline Loop Continuity · 阶段 A · 设计评审

## 1. 评审范围

- 评审对象：`docs/superpowers/specs/2026-04-28-phase-discipline-loop-continuity-coordinator-stage-a-design.md`
- 事实复核对象：
  - `src/resources/extensions/gsd/auto/types.ts`（`ContinuitySignal` / `BreakpointClass` / `deriveContinuityDecision` / `PhaseResult`）
  - `src/resources/extensions/gsd/auto/loop.ts`（5 处 dev 路径 emit、custom-engine 区段 9 个退出点）
  - `src/resources/extensions/gsd/auto/phases.ts`（已显式 signal+breakpointClass 的 40+ 处 break return-site、两条 retry 路径）
  - `src/resources/extensions/gsd/tests/continuity-decision.test.ts`（既有 8 条用例全部"两都给"或"两都不给"，无"只给一半"）
  - 父文档：loop-continuity design / implementation / code-review / next-session-handoff
- 评审态度：只读；不修改设计文档。
- 评审维度：需求与方向 / 方案合理性 / 实现可行性 / 文档质量。

## 2. 总体判断

设计方案在核心方向上是 **合理** 的：
- 只抽取 emit owner、不碰 `pauseAuto()` / 副作用顺序 / budget / 行为层续跑 —— 与 handoff §5.2 阶段 A 划分一致，刀口干净。
- 把"signal+breakpointClass 成对契约"用 helper 工厂 + 运行时 invariant 同时收紧，思路正确。
- 新增 coordinator 只做 emit、暴露 `getLastDecision()` 为阶段 B 接缝点、**不预留无实现的接口** —— 符合 handoff §6 "不要预留空接口"原则。
- 补齐 custom-engine 5 个退出点 emit 是对 handoff §5.1 MEDIUM 的正面清偿，且只补"外部可见退出点"、不补 continue 路径，和 dev 路径 semantics 一致。

但设计文档中存在若干 HIGH/MEDIUM 级别的具体漏洞与不严谨之处，进入实现前建议先修订，否则实现阶段会被迫现场做决策或返工。

## 3. 发现

### [HIGH] 方案合理性：custom-engine `retry-exhausted` 映射表覆盖不全

**位置**：§3.2 表格第 4 行（`682–711` retry-exhausted 三种 recover outcome）

**问题**：表格只说"按 outcome 分别对应 `pause-human/human-required` 或 `stop-error/safety-required`"，但 `policy.recover` 实际返回 3 种 outcome：`"pause"` / `"skip"` / `"stop"`（见 `loop.ts:684 / 690 / 706`）。设计只列出了 2 种映射，缺 `"skip"`。且代码里 `"skip"` 分支调用 `stopAuto` 但与 `"stop"` 分支同报 `reason: custom-engine-verify-retry-exhausted`（loop.ts:691–699），两者行为趋同但 reason 构造路径不同 —— 设计需要明确 `"skip"` 的 signal/breakpointClass 归类。另外 3 个 break 退出点分布在 3 个不同行（`688` / `699` / `710`），设计文档只给了"一个表格行"映射，实现者要自行拆 emit 调用位置，容易漏写或错误合并。

**影响**：实现阶段实施者需要现场判断，`"skip"` 可能被错分为 `stop-error/safety-required` 或 `pause-human/human-required`，进而让 `ContinuityDecision.signal` 与实际 workflow 语义偏差，journal 回放时出现误导；也可能发生 3 个退出点里漏打 emit。

**建议**：§3.2 表格中把 `retry-exhausted` 一行拆为 3 行：
- `recovery.outcome === "pause"`（line 688）→ `emitCustomEngine({ signal: "pause-human", breakpointClass: "human-required", action: "break", reason: recovery.reason ?? "custom-engine-verify-retry-exhausted", unitType, unitId })`
- `recovery.outcome === "skip"`（line 699）→ `emitCustomEngine({ signal: "stop-error", breakpointClass: "safety-required", action: "break", reason: "custom-engine-verify-retry-exhausted-skip", unitType, unitId })`（skip outcome 等同于"无法 reconcile 跳过的步骤"，属于 safety-required）
- `recovery.outcome === "stop"` / fallthrough（line 710）→ `emitCustomEngine({ signal: "stop-error", breakpointClass: "safety-required", action: "break", reason: recovery.reason ?? exhaustedReason, unitType, unitId })`

并在验证计划 §6 中新增 spot check：`grep -n "emitCustomEngine" src/resources/extensions/gsd/auto/loop.ts` 应命中 **7 处**（complete + stop + verify-pause + 3×retry-exhausted + milestone-complete + reconcile-pause + reconcile-stop）—— 当前设计的"5 个退出点"说法过于笼统，实际 emit 调用点应该是 8 个（see MEDIUM-2）。

---

### [HIGH] 方案合理性：`LoopContinuityCoordinator.emitPhase` 里有语义死代码的三元

**位置**：§3.1 coordinator 代码第 126–129 行

**问题**：
```ts
reason: result.action === "continue" || result.action === "next"
  ? result.reason
  : result.reason,
```
两个分支返回相同值。显然是作者复制 `buildPhaseContinuityDecision` 的 `"reason" in args.result ? args.result.reason : undefined` 时的产物，但改写错了：在当前 `PhaseResult<T>` 定义里（`types.ts:248-251`）三个 variant 的 `reason` 字段都在类型层存在（`continue`/`next` 是 optional、`break` 是必填），直接 `result.reason` 就能读到正确值（undefined 或 string），**根本不需要三元**。

这本身是个低风险 bug（行为正确但代码腐败），但它出现在设计文档的核心代码块里，说明作者在写设计时没真正把 §2.1 第 6 条"去掉 `"X" in args.result` 冗余守卫"的意图落到伪代码里 —— 设计和自我一致性有裂痕。

**影响**：
- 实现者如果照抄设计 §3.1 的代码，会把同样的三元死代码带进 production。
- 与 §2.1 第 6 条明确要求"直接读字段不用 in 守卫"自相矛盾，评审/code-review 阶段会反复指出。
- 读者对设计意图产生困惑（"这个三元是不是有什么我没看见的类型细节？"）。

**建议**：§3.1 把这几行改为：
```ts
emitPhase(
  sourcePhase: ContinuitySourcePhase,
  result: PhaseResult<unknown>,
  ctx?: { unitType?: string; unitId?: string },
): ContinuityDecision {
  const decision = deriveContinuityDecision({
    sourcePhase,
    action: result.action,
    reason: result.reason,
    signal: result.signal,
    breakpointClass: result.breakpointClass,
    unitType: ctx?.unitType,
    unitId: ctx?.unitId,
  });
  this.write(decision);
  return decision;
}
```
`PhaseResult` 已保证三个 variant 上 `reason`/`signal`/`breakpointClass` 的读取都是合法的（`undefined` 对 optional，`string` 对 `break.reason` 必填）。

---

### [HIGH] 方案合理性：helper 工厂签名无法强制 signal/breakpointClass 在类型层"成对一致"

**位置**：§3.3.2 `pausedBreak` 签名

**问题**：
```ts
export function pausedBreak(
  reason: string,
  signal: Extract<ContinuitySignal, "pause-human" | "pause-provider" | "pause-budget">,
  breakpointClass: Extract<BreakpointClass, "human-required" | "provider" | "budget">,
): PhaseResult<never>
```
两个参数相互独立，类型系统允许调用 `pausedBreak("uat-pause", "pause-human", "budget")` 这种错配组合，**编译通过但语义错误**。

这直接挑战了 §2.1 第 4 条"类型层 + 运行时双重保证 signal/breakpointClass 成对"的核心诉求 —— 工厂在"必填"层面收紧了，但在"配对一致性"层面没收紧。用户现场误用的概率不为零（特别是 phases.ts 有 pause-human/pause-provider/pause-budget 三种，手指滑一下就错）。运行时 invariant **不能**捕获这种错配（它只检查"两个是否都存在"，不检查"是否一致"）。

**影响**：
- 工厂名字叫 `pausedBreak` 却允许发出互相矛盾的 signal+class 组合，违背"成对契约"设计意图。
- 阶段 A 的卖点之一在此打折扣：强调"类型层 + 运行时双重"，实际只有单侧。
- 未来有人误用，运行时也不会 throw（`deriveContinuityDecision` 两个都有就直接返回，不校验一致性）。

**建议**：三选一，推荐方案 C：

**A. 函数重载**：
```ts
export function pausedBreak(reason: string, kind: "human"): PhaseResult<never>;
export function pausedBreak(reason: string, kind: "provider"): PhaseResult<never>;
export function pausedBreak(reason: string, kind: "budget"): PhaseResult<never>;
export function pausedBreak(reason: string, kind: "human"|"provider"|"budget"): PhaseResult<never> {
  switch (kind) {
    case "human": return { action: "break", reason, signal: "pause-human", breakpointClass: "human-required" };
    case "provider": return { action: "break", reason, signal: "pause-provider", breakpointClass: "provider" };
    case "budget": return { action: "break", reason, signal: "pause-budget", breakpointClass: "budget" };
  }
}
```

**B. 拆成三个 factory**：`humanPauseBreak(reason)` / `providerPauseBreak(reason)` / `budgetPauseBreak(reason)`。名字即契约，彻底消除错配可能。类型层最简洁。

**C. 在 `deriveContinuityDecision` 的 invariant 中追加"成对一致性"检查**：保留现有 `pausedBreak(reason, signal, class)` 签名，但在 `deriveContinuityDecision`（或 coordinator 的 write）里检查 `PAIR_CONTRACT[signal] === class`，不一致就 throw。**运行时兜底 + 工厂方便使用**。需要显式维护一张 pair 映射表。

推荐方案 B 或 A：类型层解决比运行时 throw 更早更好；方案 C 只作为 invariant 升级补充，**不能替代**工厂错配修复。

建议同步修订 `errorBreak` / `noProgressBreak` / `terminalBreak` 的签名 —— 这四个已经不需要收紧（只有一种 signal），但命名和注释可以更明确（`errorBreak` 对应 `stop-error/safety-required`、`noProgressBreak` 对应 `stop-no-progress/no-progress` 等）。

---

### [MEDIUM] 方案合理性：`ContinuityDecisionInput` 半截 throw 的行为变更未在测试矩阵中明确回归

**位置**：§3.3.1 运行时 invariant；§3.5.2

**问题**：设计把"signal 和 breakpointClass 仅给一半"变成了 **硬错误**（throw）。§3.5.2 声明"既有 `continuity-decision.test.ts` 应继续通过"基于"既有用例已成对给出或两个都不给"。经事实复核（`continuity-decision.test.ts` 第 1–126 行 8 条用例），**结论正确**，既有用例确实都不会触发 invariant。

但这里有两个风险设计文档没展开：

1. **其他调用点**：`deriveContinuityDecision` 在代码里只有一个调用者（`buildPhaseContinuityDecision`），`buildPhaseContinuityDecision` 在 `loop.ts:250-265` 里用 `"signal" in` / `"breakpointClass" in` 守卫（§2.1 第 6 条要去掉的冗余）。去掉冗余后直接 `result.signal` / `result.breakpointClass` —— 此时如果某个现场 `PhaseResult` **只带 signal 不带 breakpointClass**（或反之），新的 invariant 会在 runtime throw。事实复核 `phases.ts` 中 41 处 `signal:` 出现，均搭配 `breakpointClass:`（前面 grep 输出显示每一处都是成对的）。当前分支看起来安全，但设计文档没有交代"实现阶段第一步就该全局 grep 确认没有半截"。

2. **PhaseResult 类型层允许半截**：`PhaseResult` 三个 variant 都把 `signal?` / `breakpointClass?` 独立声明为 optional（`types.ts:248-251`），**类型系统不阻止半截**。这意味着 invariant 只是最后一道防线，不是第一道 —— 跟 §4 "运行时守卫 + helper 工厂 ... 改动半径小"相对照，其实可以把 `PhaseResult` 也做成 discriminated union（当 `signal` 给出时必须伴随 `breakpointClass`，或把两者抽成 `classification?: { signal; breakpointClass }`）。设计选择了运行时守卫方案是可以的，但文档里应该明确交代这是**有意**的取舍而非遗漏。

**影响**：
- 实现者看完 §3.3.1 后不一定会主动全局 grep 核对 phases.ts 是否有半截现场，留下 runtime crash 隐患。
- PhaseResult 类型层不收紧的选择没有被显式论证，后续 review 会反复问"为什么不做 discriminated union"。

**建议**：
- §3.3.1 补一句："实施第一步先 `grep -rn 'signal:' src/resources/extensions/gsd/auto/` 确认所有 `signal:` 现场都**紧邻** `breakpointClass:`，否则 invariant 上线瞬间 throw"。
- §4 "决策与取舍"新增一行："PhaseResult 类型层不收紧成对契约 —— 选择运行时 invariant 方案，理由：改动半径小、legacy fallback 路径（如无显式 signal 的 reason-only break）仍然兼容。阶段 B 重审此取舍"。
- §3.5.1 测试用例 3 已覆盖这一场景，保留即可。

---

### [MEDIUM] 方案合理性：custom-engine emit 调用点数量与退出点数量不一致（8 vs 5）

**位置**：§2.1 第 3 条、§3.2 表格、§6 验证计划

**问题**：设计反复说"5 个外部可见退出点"，但 §3.2 表格展开后实际 emit 调用点是：
- `engineState.isComplete` → 1 处（line 588–592）
- `dispatch.action === "stop"` → 1 处（line 597–601）
- `verifyResult === "pause"` → 1 处（line 660–668）
- retry-exhausted 三种 outcome → **3 处**（line 688 / 699 / 710，三个 break）
- reconcile.outcome 三种 → **3 处**（line 735–744 complete / 745–753 pause / 755–765 stop）

合计 **9 处 emit 调用**（不含 skip / continue 等不 emit 路径）。§6.5 的 spot check `grep -n "emitContinuityDecision"` 应为空（正确，已下沉），但对应的 `grep -n "emitCustomEngine\|coordinator.emitCustomEngine"` 预期命中数设计里没给出。"5 个退出点"是**概念粒度**而不是**代码行粒度**，文档混用会误导实现。

**影响**：实现者可能按"5 次"机械 emit，把 3 个 retry-exhausted 分支合并成一次（错误），或把 reconcile 的 3 个 outcome 合并（错误）。

**建议**：
- §2.1 第 3 条改为："custom-engine 区段补 5 个**退出场景**的 emit，展开为 9 个 emit 调用点"。
- §3.2 表格拆行，见 HIGH-1 建议。
- §6 验证计划新增："`grep -c 'coordinator\.emitCustomEngine' src/resources/extensions/gsd/auto/loop.ts` 应返回 9"（或基于最终拆分后的数字）。

---

### [MEDIUM] 文档质量：loop-level 退出路径（`state-unchanged` / `infrastructure-error` / `consecutive-iteration-failures` / `cooldown-budget-exceeded` / `max-iterations`）继续不发 emit 的决策未显式交代

**位置**：§2.2 Out-of-scope；§3.2 "不动" 列表

**问题**：第一批就没给 loop 顶层退出路径（位于 `while (s.active)` 主循环外层或 catch 块）发 `continuity-decision`，阶段 A 也没覆盖。这些退出路径 **都会命中** paused/stopped session 的 journal，但 `lastContinuityDecision` 在 paused-session.json 里会留下**上一个 phase emit** 而不是真正造成终止的 loop-level 原因，可能误导 session 恢复时的 UI 展示。

- `state-unchanged`（loop.ts:907）
- `infrastructure-error`（catch 块）
- `consecutive-iteration-failures` / `cooldown-budget-exceeded`（catch 块 / 后续分支）
- `max-iterations`（loop.ts:475）
- `memory-pressure` / `session-lock-lost` / `missing-command-context`

`ContinuitySourcePhase` union 中 `"loop"` 值就是为这些预留的（types.ts:101），但阶段 A 不用。

设计没说"为什么不用" —— 是刻意分到阶段 B？还是遗漏？

**影响**：
- paused-session round-trip 语义有歧义：`lastContinuityDecision.sourcePhase` 永远不会是 `"loop"`，但 `pauseAuto` / `stopAuto` 是从 loop 顶层调用的。
- handoff §5.1 提到"custom-engine 分支未发 continuity-decision" 作为 MEDIUM gap；loop-level 退出相同性质，但从未被 MEDIUM 化。

**建议**：§2.2 或 §4 "决策与取舍"显式写一行："loop-level 退出路径（`state-unchanged` / catch 块 / `max-iterations` / `memory-pressure` / `session-lock-lost`）阶段 A 不补 emit，原因：这些是 loop 顶层安全阀、与 phase discipline 无关；阶段 B 引入 coordinator 接管 loop action 决策时再统一补"。如果实际判断是"遗漏"，就把补 emit 加入阶段 A in-scope（增加 ~6 处 coordinator.emitLoopLevel 调用点，复杂度 low）。

---

### [MEDIUM] 实现可行性：phases.ts 中 **条件 signal** 现场无法直接用单一 factory

**位置**：§3.4 迁移列表

**问题**：事实复核 `phases.ts` 中，以下三处 signal 取值是**运行时条件**（不是单一 enum value）：
- `phases.ts:1029` `signal: dispatchResult.level === "warning" ? "pause-human" : "stop-error"`
- `phases.ts:1102` `signal: preDispatchResult.level === "warning" ? "pause-human" : "stop-error"`
- `phases.ts:1136` `signal: advisedDispatch.level === "warning" ? "pause-human" : "stop-error"`

这三处不能直接用 `pausedBreak(...)` 或 `errorBreak(...)` 工厂替换，必须拆成 if/else：
```ts
if (dispatchResult.level === "warning") {
  return pausedBreak("...", "pause-human", "human-required");
}
return errorBreak("...");
```

§3.4 写"迁移原则：仅替换'现已显式 signal+breakpointClass'的 break return-site"，这三处**确实**显式写了 signal+breakpointClass，因此符合迁移范围。但设计文档没点名条件分支的拆解办法，实现者可能"卡住"或跳过这几处。

**影响**：实现阶段如果照搬"直接工厂替换"，编译不过；如果跳过这三处，§2.3 "成功标准"第 3 条"工厂调用全部 `phases.ts` 现有 break return-site"不达成。

**建议**：§3.4 新增一小段："条件 signal 现场（grep 结果：`phases.ts:1029 / 1102 / 1136` 三处 `signal: ... === "warning" ? "pause-human" : "stop-error"`）需要拆成 if/else 两次工厂调用，不要保留三元表达式"。或者干脆在迁移列表里把这三个 reason 显式列出来（advise-dispatch-*）。

---

### [MEDIUM] 文档质量：§3.4 迁移列表给出的 reason 与 phases.ts 现有 reason 未核对

**位置**：§3.4 迁移点清单

**问题**：§3.4 给的 reason 列表（`uat-pause` / `verification-pause` / `provider-pause` / `budget-pause` / `milestone-complete` / `no-active-milestone` / `stuck-detected` / `state-unchanged` / `complete-milestone-artifact-db-mismatch` / `git-closeout-failure`）只有 **10 项**，但 `phases.ts` 中 `signal:` 出现 **41 处**，即使合并条件分支后仍远超 10 项。

- 例如 `phases.ts:1549` `signal: "pause-human"` 对应的 reason 没出现在 §3.4 列表里。
- `phases.ts:1627` `signal: "stop-error"` 对应的 reason 也没出现。
- `phases.ts:2054` `signal: allowAutoResume ? "pause-provider" : "pause-human"`（又一个条件 signal，与 MEDIUM-3 同类）
- `phases.ts:1480 / 1496` `signal: "pause-budget"` 对应的 reason 没出现。

§3.4 末尾写"实施时具体迁移点以代码现状为准，由实现阶段逐一确认"，这是好防御，但评审角度看这是**把设计决策甩给实现阶段**。实现者可能因"清单没列就不改"，留下一半迁移、一半裸字面量的混合状态。

**影响**：
- 迁移完整性难以核验。
- §2.3 "成功标准"第 3 条"工厂调用全部现有 break return-site"弹性很大，验收时不知道怎么算通过。
- code-review 阶段会反复追问"为什么某处没用工厂"。

**建议**：§3.4 要求实现阶段先出一份**现场清单**（`grep -n 'signal:' src/resources/extensions/gsd/auto/phases.ts` 结果 + 手动分类），作为实现文档的输入；清单里每个现场标注：(a) 迁移到哪个工厂 / (b) 保留为裸字面量的原因（通常是 legacy fallback 或条件分支）。这份清单不需要在设计文档里提前穷举，但设计应明确"清单是实现阶段的第一交付物"。

---

### [LOW] 方案合理性：`BreakpointClass` 中的 `"unknown"` 分类未在工厂 / fallback 中出现，语义悬空

**位置**：§3.3.2 工厂列表；`types.ts:84-92`

**问题**：`BreakpointClass` union 声明了 `"unknown"`，但：
- 没有工厂生产 `"unknown"`
- `deriveContinuityDecision` legacy fallback 的 7 个分支覆盖了全部 7 种其他 class，走不到 `"unknown"`
- 既没有任何现场 explicit 传 `"unknown"`

这个值是死代码，还是阶段 B 预留给"未分类突破"？设计未交代。

**影响**：低。但 union 成员里留死值是 type hygiene 问题，后续可能诱发 `switch` / `match` 时的 exhaustive 警告，或让新人困惑。

**建议**：§4 或 §7 "与阶段 B 的接缝点" 补一句："`BreakpointClass.unknown` 为阶段 B 预留，用于 coordinator 主动分类失败的兜底；阶段 A 不生产、不消费"。或者阶段 A 就把它从 union 里删掉，阶段 B 再加。推荐前者（改动半径更小）。

---

### [LOW] 文档质量：§7 "阶段 B 接缝点"提到的字段已在第一批就位，但与阶段 A 行为有隐含耦合

**位置**：§7 第 3 行 "`ContinuationBudgetRemaining` / `sameUnitRepeatCount` / `noProgressEvidence` 字段已在第一批就位"

**问题**：这三个字段在 `ContinuityDecision` 上是 optional，当前所有 emit 都不传，journal 里永远是 undefined。阶段 A coordinator 的 `write()` 把这三个字段无条件地 include 进 journal data 中，journal 现有 payload schema（如果有 schema 校验）会收到 `undefined` 字段 —— 取决于序列化策略，`JSON.stringify` 会丢掉 undefined，但**如果 journal 后续用 schema 校验（如 zod）就会有 drift**。

**影响**：低。当前 `emitJournalEvent` 走 `JSON.stringify` 就没问题；如果某天改为 schema validator，需要同步更新 schema。

**建议**：§7 补一句："coordinator 的 `write()` 无条件 include 未来字段，journal emit 依赖 `JSON.stringify` 丢 undefined；若 journal 引入 schema 校验，需同步更新"。或者阶段 A 的 `write()` 改为按字段存在性 include（略啰嗦）。

---

### [LOW] 文档质量：§3.1 coordinator 注释 "Stage B will extend this module to drive signal -> decision -> loop action decisions" 与 handoff §5.1 表述一致，但设计文档缺阶段 B 的最小 API 草图

**位置**：§3.1 coordinator 顶部注释；§7

**问题**：阶段 A 说好"不预留无实现的接口"，但 `getLastDecision()` 其实**就是**阶段 B 的接缝。设计文档 §7 第 1 条说"阶段 B 的 `decideLoopAction(decision)` 直接基于此"但没说 `decideLoopAction` 的签名、所在位置、调用时机。这不是阻塞性问题（阶段 A 不做），但设计文档作为"分阶段 handoff"的载体，如果阶段 A 文档里连阶段 B 的 API 雏形都没有，阶段 B 开工时会**重新 brainstorm** 而不是"延续阶段 A 接缝"。

**影响**：低。跨阶段一致性略差。

**建议**：§7 在"与阶段 B 的接缝点"补一段 2–3 行的 API 雏形，例如：
```ts
// Stage B (NOT in this design): LoopContinuityCoordinator adds
//   decideLoopAction(decision: ContinuityDecision): "auto-continue" | "pause" | "stop"
// called in autoLoop at the top of each iteration after beginIteration.
```
明确标注"Stage B"、不写实现、不改类型 —— 仅记录意图，方便阶段 B 延续。

## 4. 跳出框架的反思

评审者刻意问了以下三个"有没有更好方向"的问题：

1. **是否应该现在就把 `pauseAuto()` 收敛到 coordinator？**
   不。设计正确地把 `pauseAuto` 排除（§2.2）。`pauseAuto` 副作用顺序（写 paused-session.json → closeout → 释放锁 → resolveAgentEnd → s.active = false）涉及并发、锁、文件 IO、session 状态，改动风险远高于 emit-only。阶段 A 先抽 emit、阶段 B 再考虑 pause owner 是正确的切法。handoff §6 也明确"不要在未设计 coordinator 副作用顺序前直接移动 `pauseAuto()`"。

2. **是否应该一次性把 `PhaseResult` 升级为 discriminated union（signal+breakpointClass 成对或都缺，不允许半截）？**
   可以但不必。当前设计选择"运行时 invariant + 工厂"已经能覆盖 99% 场景，PhaseResult 改 discriminated union 会让现有 41 处 `signal:` 现场全部需要类型重标注，改动半径大幅超过阶段 A 目标。建议按 MEDIUM-1 建议，在 §4 显式论证这个取舍即可，保留现在方案。

3. **是否应该跳过阶段 A、直接做阶段 B？**
   不。handoff §5.2 已论证阶段 A 是阶段 B 的基础设施。跳过阶段 A，阶段 B 的 coordinator 会**同时**背负 emit 下沉 + action 决策 + budget + terminal-seeking，PR 太大、回归测试覆盖不足、回滚代价高。阶段 A 作为独立 PR 就是为了把"纯下沉 + 契约收紧"这一块单独验证。

综上，**核心方向无需推翻**。

## 5. 结论

**NEEDS_REVISION**

核心方向（emit-only coordinator + 工厂 + invariant）是合理的，但设计文档在以下几点需要修订后再进入实现：

1. HIGH-1：§3.2 表格把 `retry-exhausted` 与 `reconcile` 拆分到 emit 调用点粒度，共 9 个调用点（而非"5 个退出点"）。补齐 `recovery.outcome === "skip"` 的映射。
2. HIGH-2：§3.1 coordinator 代码删除 `reason:` 的冗余三元。
3. HIGH-3：§3.3.2 `pausedBreak` 签名改为重载或拆三个工厂，类型层强制 signal↔class 一致（推荐方案 B：`humanPauseBreak` / `providerPauseBreak` / `budgetPauseBreak`）。
4. MEDIUM-1：§3.3.1 补"实施第一步全局 grep 确认 phases.ts 没有半截现场"的前置动作；§4 显式论证"PhaseResult 不做 discriminated union"的取舍。
5. MEDIUM-2：§2.1 第 3 条从"5 个退出点"改为"5 个退出场景，共 9 个 emit 调用"；§6 新增 grep 计数 spot check。
6. MEDIUM-3：§3.4 补"条件 signal 现场拆 if/else"的显式指引（3 处 advise-dispatch-*、1 处 `phases.ts:2054`）。
7. MEDIUM-4：§2.2 或 §4 显式交代"loop-level 退出路径阶段 A 不补 emit 是刻意决定"（或把它纳入 in-scope）。
8. MEDIUM-5：§3.4 要求实现阶段以"phases.ts signal 现场清单 + 分类"作为第一交付物。
9. LOW 项（§3 `BreakpointClass.unknown` 语义 / §7 阶段 B API 雏形 / §7 journal schema 迁移提示）建议一并在修订中处理。

其中 HIGH-1 / HIGH-3 是**进入实现前必须解决**的阻塞项：HIGH-1 不解决实现者会漏写 emit 或错分 signal，HIGH-3 不解决"成对契约"的卖点在工厂层落空、留下运行时都查不出来的错配隐患。HIGH-2 是代码级 bug，修订成本极低，不修就进 production。

MEDIUM 级别建议在实现阶段起手前一次性吸收；LOW 级别可以在 implement / code-review 过程中顺手处理。

## 6. 下一步

### 同会话继续

```
直接执行 /design-implement
```

### 新会话恢复 prompt

```
请阅读设计文档 docs/superpowers/specs/2026-04-28-phase-discipline-loop-continuity-coordinator-stage-a-design.md
和评审文档 docs/superpowers/plans/2026-04-28-phase-discipline-loop-continuity-coordinator-stage-a-design-review.md，
使用 /design-implement 进行方案修订及实现。

重点处理：
- HIGH-1：§3.2 表格按 emit 调用点粒度拆分（9 处），补齐 recovery.outcome === "skip" 的映射。
- HIGH-2：§3.1 coordinator emitPhase 里的 reason 三元死代码删除，改为直接 result.reason。
- HIGH-3：§3.3.2 pausedBreak 工厂签名改为类型层强制 signal↔class 成对（推荐拆三个工厂：humanPauseBreak / providerPauseBreak / budgetPauseBreak）。

其余 MEDIUM/LOW 项按评审 §5 清单逐条处理。
```
