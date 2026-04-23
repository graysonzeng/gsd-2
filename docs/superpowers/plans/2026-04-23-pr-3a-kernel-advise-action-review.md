# PR-3a Plan Review — Kernel Advise Action

**Reviewed plan**: `[2026-04-23-pr-3a-kernel-advise-action.md](./2026-04-23-pr-3a-kernel-advise-action.md)`
**Reviewer**: Claude Opus 4.7 (code-review pass)
**Review date**: 2026-04-23
**Base branch tip**: `bb709fa5a` (per plan's pre-flight)
**Verified against**:

- `docs/superpowers/specs/phase-discipline-preset.md` (v7.1)
- `docs/superpowers/specs/README.md`
- Live `main`: `types.ts`, `rule-registry.ts`, `auto-dispatch.ts`, `auto/phases.ts`, `auto/loop-deps.ts`

---

## Verdict

**Direction correct,骨架可用，但按当前文字直接执行会 fail。** Δ-K1 的核心思路（新 `action: "advise"` + 前置 dispatch 规则 + `runDispatch()` 中 re-resolve）合理地落在了既有契约边界内，不自造新子系统。范围锁定、预算守卫、self-review checklist 也是好的实践。

但有 **3 个 Critical 级缺陷** 会让计划在 TDD 循环里 red/green 都走不通，另有 **3 个 High 级设计缺口** 会留下隐式契约债。

---

## Classification summary


| #   | Issue                                                           | Task/Step     | Severity |
| --- | --------------------------------------------------------------- | ------------- | -------- |
| C1  | `makeMockDeps().resolveDispatch` 无法区分第一次/advise 后第二次调用          | T1 Step 2     | Critical |
| C2  | `runDispatch()` 测试用 `{ deps } as any` 缺 `IterationContext`      | T1 Step 1-2   | Critical |
| C3  | T1 Step 1 的 Test 1/2 fixture 无法匹配真实 stock 规则                    | T1 Step 1     | Critical |
| H1  | T3 Step 2 只展示 advise 分支，未展示与 skip/replace/proceed 的共存顺序         | T3 Step 2     | High     |
| H2  | advise 生效后 stuck detection / `pauseAfterDispatch` / journal 未同步 | T3 Step 2     | High     |
| H3  | advised unit 不再跑 pre-dispatch hooks，契约未声明                       | T3 Step 2     | High     |
| M1  | `auto-dispatch.ts` 预算低估 ~2×                                     | §Budget guard | Medium   |
| M2  | `advise_if_mismatch` 声明但 `evaluatePreDispatch` 不消费              | T2 Step 1-2   | Medium   |
| M3  | 前置规则内 `matchedRule` 赋值与 dispatch loop 重复                        | T3 Step 1     | Medium   |
| M4  | `DISPATCH_RULES_BY_UNIT_TYPE` 是硬编码闭集，新增 unit 需手动同步              | T3 Step 1     | Medium   |
| L1  | 行号锚点 `types.ts:413-447` 容易漂移                                    | T2 Step 1     | Low      |
| L2  | `logWarning` 复用既有 import，计划未注明                                  | T3 Step 1     | Low      |
| L3  | Pre-flight Step 2 的 `milestone_profile` 检查与 PR-3a scope 无关      | §Pre-flight   | Low      |
| L4  | "legacy modify skip replace" 测试只覆盖 empty-hooks 分支               | T1 Step 1     | Low      |
| L5  | T3 Step 3 的"final assertions"没有完整 arrange 代码                    | T3 Step 3     | Low      |


---

## 🔴 Critical（按现状执行会失败）

### C1. 测试 mock 无法模拟"re-dispatch"：Test 4 不可能通过

**位置**：Task 1 Step 2 (plan lines 177-249)

**问题**：Task 1 Step 2 的 `makeMockDeps()` 把 `resolveDispatch` 写成静态返回值：

```ts
resolveDispatch: async () => ({
  action: "dispatch",
  unitType: "execute-task",
  unitId: "M001/S01/T01",
  prompt: "do the thing",
}),
```

但 Task 3 Step 2 的实现路径里，`runDispatch()` **会调用 `deps.resolveDispatch` 两次**：

1. 第一次不带 `advisedUnit` — 期望返回 `execute-task`
2. 第二次带 `advisedUnit: { unitType: "plan-slice", unitId: "M001/S01/T99" }` — 期望返回 `plan-slice`

静态 mock 两次返回相同结果 → 第二次仍返回 `execute-task` → Task 3 Step 3 里的这两条断言会失败：

```ts
assert.equal(result.data.unitType, "plan-slice");
assert.equal(result.data.unitId, "M001/S01/T99");
```

**补丁**：`makeMockDeps` 的 `resolveDispatch` 必须按 `ctx.advisedUnit` 分支：

```ts
resolveDispatch: async (ctx) => {
  if (ctx.advisedUnit?.unitType === "plan-slice") {
    return {
      action: "dispatch",
      unitType: "plan-slice",
      unitId: ctx.advisedUnit.unitId ?? "M001/S01",
      prompt: "plan slice",
      matchedRule: "honour-phase-discipline-advice",
    };
  }
  return {
    action: "dispatch",
    unitType: "execute-task",
    unitId: "M001/S01/T01",
    prompt: "do the thing",
  };
},
```

不做这个改动，TDD 循环在 Task 3 Step 4 的 green 阶段永远无法通过。

---

### C2. `runDispatch()` 的 `IterationContext` 不能用 `{ deps } as any`

**位置**：Task 1 Step 1 (plan lines 153-164)

**问题**：`runDispatch()` 第一行就是：

```ts
const { ctx, pi, s, deps, prefs } = ic;
// ...
const provider = ctx.model?.provider;
const authMode = provider && typeof ctx.modelRegistry?.getProviderAuthMode === "function"
  ? ctx.modelRegistry.getProviderAuthMode(provider) : undefined;
const activeTools = typeof pi.getActiveTools === "function" ? pi.getActiveTools() : [];
```

Test 4 的 scaffold `{ deps } as any` 缺 `ctx/pi/s/prefs/iteration/flowId/nextSeq`。首次访问 `ctx.model?.provider` 就是 `TypeError: Cannot read properties of undefined`，连断言都到不了。

Task 1 Step 2 虽然写了 `makeMockDeps()` 模板，**但完全没提 `IterationContext` 怎么造**。

**补丁**：追加 `makeIterationContext()` helper（参考 `auto-loop.test.ts:623-739`）：

```ts
function makeIterationContext(overrides?: Partial<IterationContext>): IterationContext {
  return {
    ctx: {
      model: {},
      modelRegistry: undefined,
      ui: { notify: () => {} },
    } as ExtensionContext,
    pi: { getActiveTools: () => [] } as ExtensionAPI,
    s: {
      basePath: "/tmp/phase-discipline-advice",
      pendingVerificationRetry: false,
    } as AutoSession,
    prefs: undefined,
    deps: makeMockDeps(),
    iteration: 0,
    flowId: "test-flow",
    nextSeq: () => 1,
    ...overrides,
  } as IterationContext;
}
```

否则 Task 1 Step 4 commit 下去的测试文件连"按预期方式失败"都做不到。

---

### C3. T1 Step 1 的 Test 1/2 fixture 无法匹配真实 stock 规则

**位置**：Task 1 Step 1 (plan lines 128-144)

**问题**：Test 1 / Test 2 直接调 `resolveDispatch(...)`，**不经过 mock**，走 `auto-dispatch.ts` 真实 `DISPATCH_RULES` 表。fixture 是：

```ts
state: { phase: "executing", activeTask: { id: "T01" }, ... }
```

Test 1 用 `advisedUnit: { unitType: "plan-slice" }` 期望命中前置规则：

- `DISPATCH_RULES_BY_UNIT_TYPE.get("plan-slice")` 返回：
  - `planning → plan-slice`：要求 `state.phase === "planning"` → **不匹配**
  - `executing → execute-task (recover missing task plan → plan-slice)`：要求 phase 为 executing **且**当前 task 无 plan 文件，依赖 FS 上 `basePath = "/tmp/phase-discipline-advice"` 的状态 → **不确定**

结果：Test 1 的 `matchedRule === "honour-phase-discipline-advice"` 很可能永远失败，无论实现是否正确。Test 2 的 `assert.notEqual` 倒是会通过，但**是因为所有规则都不匹配、命中 `<no-match>` fallback 的错误原因过的**，不是因为 advise 逻辑正确。

**补丁（二选一）**：

- **方案 A**：把 fixture `phase` 改成 `"planning"`，让 `planning → plan-slice` 能在纯 state 判定阶段命中。需先确认该规则的 match 体不依赖 DB/FS。
- **方案 B（推荐）**：Test 1/2 不测真实 `resolveDispatch`，而是注入一个**最小 stub DispatchRule 表**（两条假规则：plan-slice 永远 match / validate-milestone 永远不 match），测的是"前置规则查询候选表、有合法就用、无合法就 fall through"这个纯函数逻辑。

方案 B 更符合单元测试的隔离原则。

---

## 🟠 High（设计缺口，不补会留坑）

### H1. Task 3 Step 2 只展示 advise 分支，未展示与 skip/replace/proceed 共存顺序

**位置**：Task 3 Step 2 (plan lines 494-533)

**问题**：计划原文说"Replace the current pre-dispatch block in `auto/phases.ts` with this flow"，但代码块只有 advise 分支。之后的 "Preserve these existing invariants" 列了 skip/replace/prompt 的要求，但没示意在最终源码里三者如何**交织**。

实现者照着 Step 2 的代码块把 `auto/phases.ts:1049-1062` 原 skip/replace/proceed 逻辑**删掉**是完全可能的。

**当前代码（`auto/phases.ts:1049-1062`）**：

```ts
if (preDispatchResult.action === "skip") {
  ctx.ui.notify(...);
  await new Promise(...);
  return { action: "continue" };
}
if (preDispatchResult.action === "replace") {
  prompt = preDispatchResult.prompt ?? prompt;
  if (preDispatchResult.unitType) unitType = preDispatchResult.unitType;
} else if (preDispatchResult.prompt) {
  prompt = preDispatchResult.prompt;
}
```

**补丁**：Step 2 应展示完整最终块，明确顺序：

```ts
// 1. Skip has highest priority — 'don't run this unit' beats 'change which unit'
if (preDispatchResult.action === "skip") { return { action: "continue" }; }

// 2. Advise re-resolves dispatch once. advised unit does NOT re-trigger hooks (loop guard).
if (preDispatchResult.action === "advise" && preDispatchResult.advisedUnitType) {
  const advisedDispatch = await deps.resolveDispatch({ ..., advisedUnit: {...} });
  if (advisedDispatch.action === "dispatch") {
    unitType = advisedDispatch.unitType;
    unitId = advisedDispatch.unitId;
    prompt = advisedDispatch.prompt;
  }
}

// 3. Replace / modify still operate on the (possibly advised) unit.
else if (preDispatchResult.action === "replace") {
  prompt = preDispatchResult.prompt ?? prompt;
  if (preDispatchResult.unitType) unitType = preDispatchResult.unitType;
} else if (preDispatchResult.prompt) {
  prompt = preDispatchResult.prompt;
}
```

关键澄清：**skip 优先于 advise**（"不跑"强于"改跑"），**advise 与 replace/modify 互斥**（同一次 hook 评估只会返回一种 action）。

---

### H2. Advise 生效后 stuck detection / `pauseAfterDispatch` / journal 未同步

**位置**：Task 3 Step 2 (plan lines 526-532 "preserve invariants")

**问题**：`auto/phases.ts:940-1033` 有三块逻辑在 pre-dispatch 之前基于**原始** `dispatchResult` 采样：

- **Line 940**：`dispatch-match` journal 事件记录原始 `matchedRule/unitType/unitId`
- **Line 945**：`const pauseAfterUatDispatch = dispatchResult.pauseAfterDispatch ?? false;`
- **Line 948**：`const derivedKey = ${unitType}/${unitId}` → 推入 stuck detection 滑动窗口

advise 改写 `unitType/unitId` 之后：

1. **Stuck window** 仍记的是原始 key。如果 phase-discipline 反复把 `execute-task` advise 成 `plan-slice`，stuck detection 会误判 `execute-task` 在 6 次窗口内"一直在被调度"而触发 level 1 recovery，甚至 level 2 hard stop。
2. `**pauseAfterUatDispatch`** 可能从原始 `run-uat` (`pauseAfterDispatch=true`) 被 advise 到 `plan-slice`，plan-slice 不应该 pause 但会被保留。
3. **Journal** 上看不到"实际真正跑的 unit"，排障困难。

**补丁（二选一）**：

- **方案 A（正确）**：advise 生效后重置 `derivedKey` / `pauseAfterUatDispatch`（改为 `advisedDispatch.pauseAfterDispatch ?? false`），并追加一条 `dispatch-readvised` journal 事件。
- **方案 B（暂时 punt）**：在计划里显式记录"PR-3a 暂不处理这三项副作用，留 PR-3b 或 OQ-N 跟进"。至少让实现者知情，别无声无息放行。

推荐方案 A，因为 stuck detection 的误判对 phase-discipline 场景几乎是必发的。

---

### H3. Advised unit 不再跑 pre-dispatch hooks，契约未声明

**位置**：Task 3 Step 2 (全 Step)

**问题**：Step 2 的代码在 advise 生效后直接把 `unitType/unitId/prompt` 替换完就走了，**不会**对新 unit 再调 `runPreDispatchHooks`。

这个选择本身是**正确的**（否则 phase-discipline 自己可能触发自身再 advise → 死循环），但：

1. 用户可能在 `plan-slice` 上注册了 `modify` hook 来做 prompt 裁剪，advise 路径会**悄无声息地跳过**这些 hook。
2. `phase-discipline-preset.md` §3.1a 契约**没说**这点。
3. 万一未来有人"为了让 advise 生效也让子 hook 跑"而打开了第二轮 hook，立刻得死循环。

**补丁**：计划里显式写进契约：

> **Advisory re-dispatch does NOT re-trigger pre-dispatch hooks on the advised unit.** This is an intentional loop guard. If a future feature needs hooks-on-advised-unit, add an explicit depth cap (e.g. `maxAdviseDepth=1`) before relaxing this constraint. Preset authors who need to modify prompts on advised units should do so via `replace` on the advising hook, not via a separate hook.

同时在代码里加注释标记这是有意设计，而不是 forget-to-call 的 bug。

---

## 🟡 Medium

### M1. `auto-dispatch.ts` 预算低估 ~2×

**位置**：§Budget guard (plan lines 38-47)

**问题**：计划说 `auto-dispatch.ts: approximately +25 lines`。实际需要：


| 项                                               | 行数       |
| ----------------------------------------------- | -------- |
| `DispatchContext` 加 `advisedUnit?` 字段           | +1       |
| `DISPATCH_RULES_BY_UNIT_TYPE` Map 声明（16 个 unit） | +17      |
| 前置规则 body（prefix rule）                          | +15      |
| `byName` helper + 16 条 push                     | +18      |
| **合计**                                          | **≈ 50** |


是预算的 **2×**。budget guard 目前写成这样，实现者会触发 stop-and-rescope，反而打断工作流。

**补丁**：修正预算到 `+50 ~ +55`，并把差距归因到"候选表+register 部分"——这是一次性的数据注册成本，不是"失控"。

---

### M2. `advise_if_mismatch` 声明但 `evaluatePreDispatch` 不消费

**位置**：Task 2 Step 1-2 (plan lines 283-329)

**问题**：Task 2 Step 1 给 `PreDispatchHookConfig` 加了 `advise_if_mismatch?: "prefer" | "block"`，但 Step 2 的 `evaluatePreDispatch` 扩展**完全没读**这个字段：

```ts
if (hook.action === "advise") {
  firedHooks.push(hook.name);
  return {
    action: "advise",
    prompt: currentPrompt,
    advisedUnitType: hook.unit_type,
    model: hook.model,
    firedHooks,
  };
}
```

PR-3a 范围内等价于死代码。

**补丁（二选一）**：

- **方案 A**：注释里明确"PR-3a 只声明类型，PR-3b 的 preset 消费"。
- **方案 B**：从 PR-3a types 里拿掉，PR-3b 连同 preset 一起加。

推荐方案 B，理由：`phase-discipline-preset.md` §3.1a 把 `advise_if_mismatch` 归在"preset-level config"，更合理在 PR-3b 落地。否则 review 看到 types 里有这个字段、实现却不用，会怀疑漏了分支。

---

### M3. 前置规则内 `matchedRule` 赋值与 dispatch loop 重复

**位置**：Task 3 Step 1 prefix rule body (plan lines 448-451)

**问题**：前置规则的 `match` 返回时显式赋 `matchedRule: "honour-phase-discipline-advice"`：

```ts
return advice.unitId
  ? { ...stockAction, unitId: advice.unitId, matchedRule: "honour-phase-discipline-advice" }
  : { ...stockAction, matchedRule: "honour-phase-discipline-advice" };
```

但 `resolveDispatch` 的外层 loop（`auto-dispatch.ts:1063`）和 `RuleRegistry.evaluateDispatch`（`rule-registry.ts:133`）都会：

```ts
if (result.action !== "skip") result.matchedRule = rule.name;
```

两层一致能工作，但冗余。至少写个注释说明意图：

```ts
// Explicit matchedRule survives even if future code returns a cloned
// DispatchAction from a stock rule (would otherwise show stock rule's name).
```

---

### M4. `DISPATCH_RULES_BY_UNIT_TYPE` 是硬编码闭集

**位置**：Task 3 Step 1 map declaration + push calls (plan lines 419-485)

**问题**：未来任何 `auto-dispatch.ts` 新增规则**必须同步这张表**，否则 advise 对新 unit 静默失效。计划没安排 safeguard。

**补丁**：Task 4 Self-review 加一条 grep-based 守卫：

```bash
node -e "
const fs=require('node:fs');
const src=fs.readFileSync('src/resources/extensions/gsd/auto-dispatch.ts','utf8');
const nameCount = (src.match(/^    name: \"/gm) || []).length;
// 1 prefix rule + N stock rules should equal total in DISPATCH_RULES_BY_UNIT_TYPE sum
console.log('Rule names in file:', nameCount);
console.log('Verify: DISPATCH_RULES_BY_UNIT_TYPE sum + 1 (prefix) === nameCount');
"
```

长期方案（out-of-scope for PR-3a）：把候选表**自动构建**，比如给 `DispatchRule` 加一个 `producesUnitType` 声明，`DISPATCH_RULES_BY_UNIT_TYPE` 从 `DISPATCH_RULES.filter(...)` 动态派生。但 PR-3a 范围内不强求。

---

## 🟢 Low

### L1. 行号锚点 `types.ts:413-447` 漂移风险

**位置**：§Locked scope (plan lines 17-22)

文件有改动就位移。建议结构锚点，如"包含 `PreDispatchHookConfig` 和 `PreDispatchResult` 定义的两段"。

### L2. `logWarning` 复用既有 import 未注明

**位置**：Task 3 Step 1 prefix rule

前置规则用 `logWarning("dispatch", ...)`。`auto-dispatch.ts:1057` 已有该 import，无需新加。计划顺手注明可减少实现者焦虑。

### L3. Pre-flight Step 2 的 `milestone_profile` 检查与 PR-3a scope 无关

**位置**：§Pre-flight Step 2 (plan lines 71-86)

`preferences-types.ts: MISSING milestone_profile` 是正确的期望，但这是 PR-3b 的范畴，放在 PR-3a pre-flight 容易让实现者误以为 PR-3a 也要动预设字段。建议挪到 PR-3b pre-flight，PR-3a 的 pre-flight 只保留前 3 项。

### L4. "legacy modify skip replace" 测试只覆盖 empty-hooks 分支

**位置**：Task 1 Step 1 Test 3 (plan lines 146-151)

```ts
test("legacy modify skip replace behaviour stays unchanged", () => {
  const registry = new RuleRegistry([] as any);
  const result = registry.evaluatePreDispatch("execute-task", "M001/S01/T01", "prompt", "/tmp/test");
  assert.equal(result.action, "proceed");
  assert.equal(result.prompt, "prompt");
});
```

没有任何注册的 hook 时直接走 `hooks.length === 0` 回退分支，根本没测到 `modify`/`skip`/`replace` 三条路径。标题与实测行为不符。

**补丁**：把这个 test 要么改标题（"returns proceed with no hooks registered"），要么真的注册 3 个 hook（modify/skip/replace 各一）并分别断言。

### L5. T3 Step 3 的 "final assertions" 没有完整 arrange 代码

**位置**：Task 3 Step 3 (plan lines 538-568)

示例里只有断言片段，没有 arrange 代码。新手照抄会得到不可编译文件。Step 3 应写成完整 test body，或明确"这些断言整合到 Step 1 已写的测试里"。

---

## 正面评价（应当保留）

1. **契约局部化**：advise 只在 pre-dispatch + dispatch 之间加新通道，不动 hook registry 结构、不动 rule evaluation 顺序语义。尊重了"kernel delta 最小化"原则。
2. **前置规则 + 候选表**：比"往每条 stock rule 里塞 advise 感知"干净得多，保持 stock rule 不变性。
3. **Fallback 明确**：advise 不可行时记 `logWarning` 并放行给下一个规则，不静默不抛异常。正确的软失败语义。
4. `**types.ts` 增量纯 additive**：`"advise"` 是 union 新增成员，新字段全 optional，不撕裂既有 caller。
5. **Scope 划清**：明确把 `preferences-validation.ts` 授权 UX 挡在 PR-3a 外，防止 scope creep。
6. **Spec 反思**：`§"Reality check versus the spec"` 指出 spec v7.1 漏了 `auto/phases.ts` 和 `loop-deps.ts`，主动补进 locked scope。好的 plan 质量。

---

## 结论

**方案骨架正确，可以继续推进**，但在执行前必须处理：

- **必须**（阻塞 red/green 切换）：C1、C2、C3、H1
- **强烈建议**（否则留下隐式契约债）：H2、H3
- **应该顺手修**（文字级）：M1、M2、M3、L4

修完后计划可进入执行期，结构性思路（kernel delta + prefix rule + re-dispatch）无需重写。

建议下一步动作：

1. 由 plan author 按本评审做一次 patched revision（diff 最小化）。
2. 或：加一个 `§Amendments` 章节，把 C1-C3 / H1-H3 的修正 patch 直接 inline 进去，保留原结构。

选项 2 对 review 历史更友好。