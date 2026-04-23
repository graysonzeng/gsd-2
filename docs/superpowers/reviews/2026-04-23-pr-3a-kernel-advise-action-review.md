# PR-3a Δ-K1 Kernel Advise Action —— 代码评审

- **被评审实现**：未提交工作区改动（HEAD = `bb709fa5a82208507fcc31dc6c83688e461fff20`）
- **实施计划**：[`docs/superpowers/plans/2026-04-23-pr-3a-kernel-advise-action.md`](../plans/2026-04-23-pr-3a-kernel-advise-action.md)
- **参考规格**：[`docs/superpowers/specs/phase-discipline-preset.md`](../specs/phase-discipline-preset.md) §3.1a Δ-K1
- **整体架构**：[`docs/superpowers/specs/README.md`](../specs/README.md)
- **评审日期**：2026-04-23
- **评审方法**：三方对照（spec ↔ plan ↔ 工作区 diff）＋ 真实测试运行验证 ＋ 消费者 grep 核查
- **评审者**：Cursor code-reviewer subagent（Claude Opus 4.7）

---

## 总体结论：**需要修复再合并（needs fixes）**

核心改动方向是**正确**的：

- 契约扩展最小且零 break
- prefix rule 自递归防御完备
- `runDispatch` 流程重排符合 plan 意图（post-advice unit 作为权威 unit 参与 dispatch-match / stuck detection / prior-slice guard）

但存在几处**直接偏离 plan 明文要求**的缺口、以及若干可观测性和边界语义上的遗漏。完整 4 个测试虽然通过，但其中 `advisedUnitId override reaches IterationData.unitId` 属于"mock 绿、产线断"的误导测试。

---

## 改动范围核对

### 声明的修改（已核实）

| 文件 | 改动行数 | 校验结论 |
|---|---|---|
| `src/resources/extensions/gsd/types.ts` | +11 / -5 | ✅ 符合 plan |
| `src/resources/extensions/gsd/rule-registry.ts` | +11 | ✅ 符合 plan |
| `src/resources/extensions/gsd/auto/loop-deps.ts` | +3 | ✅ 符合 plan |
| `src/resources/extensions/gsd/auto-dispatch.ts` | +70 | ⚠️ 超预算（plan 预期 +50~+55，已预先承认） |
| `src/resources/extensions/gsd/auto/phases.ts` | +60 / -30 | ⚠️ 缺 `dispatch-readvised` 事件（见 C1） |
| `src/resources/extensions/gsd/tests/pre-dispatch-advise.test.ts` | +300（新文件） | ⚠️ 其中一条测试误导（见 I1） |

### 范围外改动（违规）

| 文件 | 性质 | 违规 |
|---|---|---|
| `src/resources/extensions/gsd/auto/run-unit.ts:53` | pre-existing `abortSignal` 类型修复 | 违反 plan Task 4 Step 3 止损条款 |
| `src/resources/extensions/gsd/commands-extensions.ts:15` | pre-existing `semver` createRequire 改造 | 违反 plan Task 4 Step 3 止损条款 |

### 测试验证结果

```
✔ advise honoured when runnable (46ms)
✔ advise ignored with fallback when not runnable (42ms)
✔ empty-hook proceed behaviour unchanged (0.5ms)
✔ advisedUnitId override reaches IterationData.unitId (0.7ms)
tests 4 / pass 4 / fail 0
```

`npm run typecheck:extensions` 失败仅限 pre-existing 错误（`run-unit.ts:53`、`commands-extensions.ts:15`），不在本次改动语义范围内。

---

## Critical 问题（阻塞合并，必须修复）

### C1. `dispatch-readvised` journal 事件**完全缺失** —— 偏离 plan 硬约束

plan 第 503–509 行**硬性**要求：当 advise 成功时必须发射：

```ts
deps.emitJournalEvent({
  ts: new Date().toISOString(),
  flowId: ic.flowId,
  seq: ic.nextSeq(),
  eventType: "dispatch-readvised",
  data: { unitType, unitId, advisedFrom: dispatchResult.matchedRule },
});
```

**实际实现**：`rg "dispatch-readvised"` 全仓 0 命中。`auto/phases.ts:986-992` 在 `advisedDispatch.action === "dispatch"` 分支里只更新了局部变量就结束。

**影响**：这是 phase-discipline 的**核心审计信号**。事后无法从 journal 区分"原调度器直接命中 plan-slice"还是"被 advise 改写成 plan-slice"。PR-3b 的 3-consecutive-disagreement backoff 机制（spec §3.1a.p246）依赖该事件作为唯一可重建的真相源。

**修复**：在 `phases.ts:987` 的 `if (advisedDispatch.action === "dispatch")` 分支内部、更新局部变量之后，按 plan 原文补上 `dispatch-readvised` 发射，`data` 至少包含 `unitType` / `unitId` / `advisedFrom: dispatchResult.matchedRule`。

---

### C2. 作用域漂移 —— 违反 plan 止损条款

`git status` 显示两处**计划外**修改：

- `src/resources/extensions/gsd/auto/run-unit.ts:53` —— 包了一层 `AbortableNewSessionOptions` 临时类型
- `src/resources/extensions/gsd/commands-extensions.ts:15` —— 把 `import semver from "semver"` 换成 `createRequire` + 手写结构类型

plan Task 4 Step 3（line 646–650）**原文**规定：

> If the diff shows any additional file, do **not** "just fix it in the same PR". Instead, stop with this exact summary: "PR-3a exceeded its locked scope. …"

两处都是 pre-existing 的类型噪声，不属于 Δ-K1 语义。即使动机合理（让 `typecheck:extensions` 退出 0），**仍然违反了 plan 明文规定的 no-go 条件**。当前 PR 若合入会把这些补丁永久耦合到"kernel advise"的 commit 历史，污染 bisect 与变更追溯。

**修复（二选一）**：

- (A) 从本 PR **剔除**这两个文件的改动，保留 typecheck 失败原样；另起 follow-up micro-plan 单独修
- (B) 如果 plan 作者同意纳入，在 commit message 里显式标注 "scope exception" 并更新 plan 文档

---

## Important 问题（合并前应修复）

### I1. `advisedUnitId` 产线链路**断裂** —— 测试绿是假象

**契约断层**：

- `PreDispatchHookConfig` 没有 `unit_id` 字段（types.ts diff 只扩了 `unit_type`）
- `RuleRegistry.evaluatePreDispatch()` 的 `advise` 分支（`rule-registry.ts:325-334`）**只**把 `hook.unit_type` 写到 `advisedUnitType`，**从未**设置 `advisedUnitId`
- 因此任何通过 YAML 声明式 hook 走 registry 的调用者都**不可能**产生非 `undefined` 的 `advisedUnitId`

spec §3.1a.p225 明确："`profile-dispatch.ts` emits only `advisedUnitType` in v1 (never `advisedUnitId`); `advisedUnitId` on `PreDispatchResult` is reserved for v1.1+ use cases" —— 与上述一致。

**问题**：测试 `advisedUnitId override reaches IterationData.unitId` 通过 **mock** `runPreDispatchHooks` **直接伪造** `advisedUnitId: "M001/S01/T99"`（`tests/pre-dispatch-advise.test.ts:126`），而**这条路径在产线里没有任何实现可以触发**。等 PR-3b 或 v1.1+ 真正要用时，维护者会发现字段是 dead weight，必须额外动 `PreDispatchHookConfig` + registry。

**现状是最坏组合**：契约字段在、测试绿、真实路径空。会在 PR-3b code review 里再次暴雷。

**修复（二选一）**：

- (A) 本 PR 内一并给 `PreDispatchHookConfig` 加 `unit_id?` 字段，registry advise 分支传播 `hook.unit_id`；这样测试对应的真实产线路径存在
- (B) 保持现状（kernel-only），但**删除**那条误导测试或加注释 "advisedUnitId 字段仅用于 v1.1+ 编程式调用者；当前无法通过 YAML hook 填充"

---

### I2. advise 失败回退**未写入 journal** —— 可观测性断层

`auto-dispatch.ts:229` 用 `logWarning("dispatch", …)` 输出警告，但 journal 里没有 `dispatch-advice-dropped`（或类似）事件。

phase-discipline 的核心运行期需求是"3 次 advise 被拒触发 backoff"（spec §3.1a.p246），backoff 判定只能依赖 journal 流水 —— stderr 日志**不是**审计源。

**修复**：在 prefix rule 返回 null 的分支（advice unit not runnable），或 `phases.ts` `advisedDispatch.action !== "dispatch"` 分支里，发射 `dispatch-advice-dropped` journal 事件，payload 至少包含 `advisedUnitType` / `advisedUnitId` / `fallbackRule`（最终命中的 stock rule 名）。

---

### I3. `advisedDispatch.action !== "dispatch"` **静默吞掉 `stop` / `skip`**

当前代码：

```ts
if (advisedDispatch.action === "dispatch") {
  unitType = advisedDispatch.unitType;
  unitId = advisedDispatch.unitId;
  prompt = advisedDispatch.prompt;
  pauseAfterUatDispatch = advisedDispatch.pauseAfterDispatch ?? false;
  dispatchMatchRule = advisedDispatch.matchedRule;
}
```

如果二次 `resolveDispatch()` 命中了 `pause-for-escalation` 返回 `{ action: "stop", level: "error", reason: ... }`，当前代码**忽略**它并继续使用第一次 dispatch 的 unit —— 相当于**吞掉合法的停止信号**。`skip` 同理。

二次 `resolveDispatch` 传入了 `ctx.advisedUnit`，而 `pause-for-escalation` 这类"interrupt"规则不理会 `advisedUnit` —— 所以是**可能触发**的场景（比如 advise 到来后、某个错误条件刚好满足）。

**修复**：在 advise 分支的 `action !== "dispatch"` 子路径里，把 `stop` / `skip` 透传到 `runDispatch` 的顶层返回（`return { action: "continue" }` 或相应错误），而不是掉到后续代码继续用老 unit。

---

### I4. `pre-dispatch-hook` journal 事件**丢失 advisory payload**

`phases.ts:958`:

```ts
deps.emitJournalEvent({
  …,
  eventType: "pre-dispatch-hook",
  data: { firedHooks: preDispatchResult.firedHooks, action: preDispatchResult.action }
});
```

对 `action === "advise"` 这个特殊形态，`data` **不含** `advisedUnitType` / `advisedUnitId`。调试时必须与紧跟的 `dispatch-match` 交叉比对，而 `dispatch-match` 已被改为 post-advice rule（见 C1 缺的 `dispatch-readvised`），重建链路更困难。

**修复**：当 `action === "advise"`，在 `data` 里补上 `advisedUnitType` / `advisedUnitId`；不是 advise 时保持原 payload 形态。

---

### I5. 硬编码规则名字符串 + **静默覆盖风险**

`DISPATCH_RULES_BY_UNIT_TYPE.get("plan-slice")!.push(byName("planning → plan-slice"), byName("executing → execute-task (recover missing task plan → plan-slice)"));`

耦合问题：

1. 规则名是 18+ 个包含空格/箭头的**魔法字符串**（`auto-dispatch.ts:1078-1105`）。未来任意一个 stock rule 重命名，`byName()` 会在**模块加载时**抛 TypeError —— 这是"响亮失败"，可以接受
2. 但**反向风险更重要**：加一条新 stock rule 时，如果维护者**忘记**在 Map 里注册它，advise 到该 unit type 会走 `stockRules = []` → `logWarning` → **静默回退**。没有编译期或测试期检查能抓到这种疏忽
3. `parallel-research-slices` 合成规则被映射到 `research-slice`（`auto-dispatch.ts:1092`）语义模糊：advise `research-slice` 时若命中 `parallel-research-slices`，会一次性拉起多个 slice —— 与"advise 一个 unit"的用户心智不一致。spec 未对此澄清

**修复建议**（至少完成 A 或 B）：

- (A) 在 `auto-dispatch.ts` 尾部加 assertion：遍历 `DISPATCH_RULES`（跳过 `honour-phase-discipline-advice` 和 `pause-for-escalation`），确保每条规则都至少有一个 unit_type 键映射到它，否则抛错 —— 把"静默遗漏"变成"模块加载崩溃"
- (B) 把初始化 + 注册合并成一张表 `[["rewrite-docs", ["rewrite-docs (override gate)"]], …]`，一次性构造 Map，消除两边漂移
- (C) 为 `parallel-research-slices` 加 doc comment 说明 advise semantics（"advise to research-slice in multi-slice planning state may fan out"）

---

## Minor 问题（可延后，值得记录）

### M1. `PreDispatchResult.unitId` 是无法填充的死字段

types.ts 加了 `unitId?: string`；`phases.ts` 消费它；但 `evaluatePreDispatch` 从不写这个字段，`PreDispatchHookConfig` 也没有对应键。字段类型可行、产线永远 `undefined`。

**建议**：在 types.ts 对该字段加 JSDoc，说明"保留给编程式（非 YAML）pre-dispatch hook 填充；v1 registry 不产生此值"。

### M2. 实现与 spec 偏差：单 rule → 多 rule array

spec §3.1a.p209 示例：`const stockRule = DISPATCH_RULES_BY_UNIT_TYPE[advice.unitType]`（单条）。
实现改成：`Map<string, DispatchRule[]>`（多条遍历、任意一条返回 dispatch 即停）。

这是**正确的主动改进** —— `plan-slice` / `research-slice` / `discuss-milestone` 确实有多条候选 rule —— 但 spec 未同步更新。

**建议**：顺手把 spec §3.1a 的代码示例改为多条形态，或加注释说明"实现里是 array-valued 以容纳多候选规则"。

### M3. `prefix rule` 强制覆盖 `unitId` 的下游风险

```ts
return advice.unitId ? { ...stockAction, unitId: advice.unitId } : stockAction;
```

`planning → plan-slice` stock rule 返回 `unitId = M001/S01`（基于 `state.activeSlice.id`）。若调用方 advise `unitId = M001/S01/T99`（task-level id），prefix rule 原样覆盖，stock rule 本身不能产生 task-level unit —— 下游 `run-unit` 才会发现 id 不合法。spec §3.1a.p227 明确承认了这是刻意设计："keeps scheduler pure"。

**建议**：加一条负面测试 —— "advise 非法 unitId 的回路" —— 验证下游失败能被正确捕获。

### M4. `replace` / `advise` / `proceed` 控制流可读性

当前 `phases.ts` 用 `if (action === "advise" && advisedUnitType) { ... }` → `if (action === "replace") { ... } else if (action !== "advise" && prompt) { ... }` → `if (action !== "advise" && unitId) { ... }` 串联。三个独立 if + 重复的 `!== "advise"` 守卫，易读性差。

**建议**：重构为单 `switch (preDispatchResult.action)`，每个 case 独立分支。纯 style，不影响正确性。

### M5. 测试过度 mock，集成覆盖薄

- `advise honoured when runnable` / `advise ignored with fallback when not runnable` 直接调 `resolveDispatch` → 真实走 registry + prefix rule ✅
- `advisedUnitId override reaches IterationData.unitId` 通过 mock `resolveDispatch` 走完 `phases.ts` → **没有**验证 prefix rule 对 `unitId` 的覆盖是否真的生效
- `empty-hook proceed behaviour unchanged` 只构造 `new RuleRegistry([])` → 覆盖 registry 层边界 ✅

**缺测场景**（与 Critical/Important 对应）：

1. advise + `advisedDispatch.action === "stop"` —— 对应 I3
2. advise + `advisedUnitType` 不在 Map 中 —— 验证 `stockRules ?? []` fallback 走通
3. advise 成功时 `pre-dispatch-hook` journal 事件 payload 包含 `advisedUnitType` —— 对应 I4
4. `dispatch-readvised` journal 事件发射 —— 对应 C1
5. 多个 pre-dispatch hook 串联，第一个 advise 返回，后续 hook 被截断（当前 registry for-loop 里 `return` 后 `modify` hook 不再执行）—— 验证这是预期行为
6. advise `unitType="research-slice"` 但当前状态会命中 `parallel-research-slices` 的 fan-out 路径 —— 对应 M3
7. 真实 DISPATCH_RULES + `advice.unitId !== stockAction.unitId` 的单元 assertion

**建议**：至少补 1、3、4 这三条（与 Critical/Important 直接挂钩）。

### M6. advisory re-dispatch 不触发 pre-dispatch hooks —— 故意但未测试

plan line 527 说明这是 intentional loop guard。实现里 advise 的二次 `resolveDispatch` 之后，代码直接走到 `dispatch-match` 发射，不再调用 `runPreDispatchHooks`。

这一**决策没有对应测试**。未来若有人"优化"代码误以为可以链式调用 hooks，会破坏 loop guard。

**建议**：加一条 assertion 测试 "advise 成功后，`runPreDispatchHooks` 只被调用一次（针对原 unit），不针对 advised unit"。

### M7. 预算超标（轻微）

plan 预期 `auto-dispatch.ts` 改动 `+50 到 +55`。实际 +80 行，主要是 16 条 explicit registration 行。plan 第 47 行已预先承认过这个超支（"The auto-dispatch.ts increase is expected"），所以是合规超支。

**建议**：考虑是否用 I5 建议 (B) 的表驱动写法压缩。

---

## Strengths（做对的地方）

### S1. 契约扩展最小且正确

`PreDispatchHookConfig.action` 扩联合类型、`PreDispatchResult` 加四个可选字段（`unitId` / `advisedUnitType` / `advisedUnitId` / action 的 `"advise"`），对现有消费者零 break。grep 确认 `PreDispatchResult` 只有 `phases.ts` 一个运行期消费者，已正确同步。

### S2. prefix rule 自递归防御完备

`stockRule.match({ ...ctx, advisedUnit: undefined })` 在递归调用 stock rule 的 `match` 时清空 `advisedUnit`，**避免了无限递归**。这是评审维度明确点名的隐患，实现已处理。

### S3. `runDispatch` 流程重排对齐 plan

dispatch-match / stuck detection / prior-slice guard 三个关键 side effect 都使用 post-advice 的 `unitType` / `unitId` —— 正是 plan Task 3 Step 2 要求的"post-advice unit is authoritative"。这对 phase-discipline 非常关键（否则 advise 后 stuck detection 还在用老 unit 的 key，滑窗检测会失效）。

### S4. 保留 `pause-for-escalation` 最高实效优先级

prefix rule 在 index 0，但只在 `ctx.advisedUnit` 设置时动作；未设置 advisedUnit 时立刻返回 null，不干扰 ADR-011 Phase 2 的 `pause-for-escalation` 语义。

### S5. `matchedRule` 策略正确

plan Task 3 Step 1 要求"Rely on the outer `evaluateDispatch()` loop to stamp `matchedRule`"。实现里 prefix rule 确实**没有**手写 `matchedRule`，由外层 `RuleRegistry.evaluateDispatch` 统一 stamp 为 `"honour-phase-discipline-advice"`。避免了 spec 示例与 plan 之间的冲突点。

### S6. 向后兼容完备

- `PreDispatchHookConfig.action` 新增 `"advise"` 是**联合类型扩展**，既有 YAML 不受影响
- `preferences-validation.ts` 当前 `validActions` 不含 `"advise"`，已在 plan 中显式排除 —— 合入后新写 `action: "advise"` 的 YAML 会被 preferences 层拒绝，PR-3b 再打开这个闸门，属于 feature-flag 式部署
- `PreDispatchResult` 所有 consumer（grep `PreDispatchResult` → rule-registry / types / rule-types / post-unit-hooks）无需 switch/case 同步更新（post-unit-hooks 不消费 `action` 字段）

### S7. 测试覆盖边界场景

`advise ignored with fallback when not runnable` 验证了**真实** `DISPATCH_RULES` 的回退路径（`initRegistry(convertDispatchRules(DISPATCH_RULES))`），包括命中 `planning → plan-slice` 作为 fallback —— 这是最有代表性的回路。

---

## 合并前最小必做清单

按优先级排序：

1. **修复 C1**：在 `phases.ts:987` 的 dispatch 分支补发 `dispatch-readvised` journal 事件
2. **处理 C2**：决定 `run-unit.ts` + `commands-extensions.ts` 两个范围外文件是**剔除**还是在 commit/plan 中**显式标注** "scope exception"
3. **修复 I3**：advise 二次 dispatch 的 `stop` / `skip` 透传到 `runDispatch` 顶层
4. **修复 I4**：advise 时 `pre-dispatch-hook` journal payload 补齐 `advisedUnitType` / `advisedUnitId`
5. **修复 I5**：补模块级 assertion 防止 stock rule 遗漏注册（推荐方案 A 或 B）
6. **I1 二选一**：要么本 PR 补 `PreDispatchHookConfig.unit_id` 字段，要么删误导测试 + 加 JSDoc
7. **补回归测试**：覆盖新发 journal 事件（C1）、stop 透传（I3）、advise payload（I4）—— 对应 M5 的 (1) (3) (4)

完成后：

- `npm run typecheck:extensions`（除 C2 剔除后的 pre-existing 错误外）保持原状
- 现有 4 个 advise 测试 + 新补 3+ 条回归测试全部绿

---

## 参考

- Spec §3.1a.p209：prefix rule 原始设计（单条 DispatchRule 形态）
- Spec §3.1a.p225：`advisedUnitId` v1 / v1.1+ 演进规划
- Spec §3.1a.p227：强制覆盖 `unitId` 是刻意设计（keeps scheduler pure）
- Spec §3.1a.p246：3-consecutive-disagreement backoff（依赖 `dispatch-readvised` + `dispatch-advice-dropped`）
- Plan line 503-509：`dispatch-readvised` 事件硬约束
- Plan line 527：advisory re-dispatch 不链式触发 hooks 的 loop guard
- Plan line 646-650：作用域漂移止损条款
