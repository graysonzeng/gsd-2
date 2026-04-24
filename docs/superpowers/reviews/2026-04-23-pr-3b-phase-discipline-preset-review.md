# PR-3b Phase-Discipline Preset B-min Skeleton —— 代码评审

- **被评审实现**：工作区改动（`git status` 显示 5 个已修改 + 7 个新增文件）
- **实施计划**：[`docs/superpowers/plans/2026-04-23-pr-3b-phase-discipline-preset-b-min-skeleton.md`](../plans/2026-04-23-pr-3b-phase-discipline-preset-b-min-skeleton.md)
- **参考规格**：[`docs/superpowers/specs/phase-discipline-preset.md`](../specs/phase-discipline-preset.md)
- **整体架构**：[`docs/superpowers/specs/README.md`](../specs/README.md)
- **评审日期**：2026-04-23
- **评审方法**：spec ↔ plan ↔ 工作区代码对照 + 真实测试运行 + typecheck + 消费者 grep 核查
- **评审者**：Cursor code-reviewer（Claude Opus 4.7），按 Quality / Security / Performance / Architecture 四维
- **作者声明**：
  - 未扩展成通用 hook 平台，只做了 phase-discipline 需要的最小桥接
  - `findings-to-memories` 仍是 prompt-driven，无额外代码执行器
  - `profile-dispatch` 是 B-min skeleton，优先锁关键错序场景，非完整 phase runtime

---

## 总体结论：**条件通过（conditional approval）**

核心功能目标已达成：

- ✅ 正确消费 PR-3a 的 Δ-K1 `action: "advise"` + `advisedUnitType` 契约
- ✅ `preset → merge → runtime` 三段式分层清晰，单一职责遵守良好
- ✅ `phase-discipline-8step` preset 真实注入，shadow 规则与 warning 生效
- ✅ 5 个现有单元测试全绿、`npx tsc --noEmit` 干净
- ✅ 作者声明的"最小桥接"范围控制得当

但存在 **4 个 P0 缺口**（阻碍合并主干）与 **5 个 P1 建议**（短期内补齐）。整体属于"方向对、实现可用、但需补齐契约保护与性能/耦合修复"的状态。

---

## 维度评分

| 维度 | 评分 | 关键结论 |
|---|---|---|
| **Quality 质量** | 7.5 / 10 | 结构清晰、类型精确、模块边界好；测试覆盖严重低于计划要求 |
| **Security 安全** | 8.5 / 10 | 无用户注入/SQL/外部调用风险；只在受信仓库路径内读写 |
| **Performance 性能** | 7 / 10 | `newSession()` 在命中 built-in hook 前被预创建；reviewer 无 hard timeout |
| **Architecture 架构** | 8 / 10 | Δ-K1 消费正确；两处硬编码耦合（name-based routing、model 写死） |
| **Plan 符合度** | 7 / 10 | 核心功能到位；`README.md` 与 integration test 缺失，测试行数仅到计划预算 42% |

---

## 改动范围核对

### 声明的修改（已核实）

| 文件 | 性质 | 校验结论 |
|---|---|---|
| `src/resources/extensions/gsd/types.ts` | +`provider`/`cross_review`/`cross_review_models` 字段 | ✅ 与 spec 一致 |
| `src/resources/extensions/gsd/preferences-types.ts` | +`milestone_profile` 枚举 | ✅ |
| `src/resources/extensions/gsd/preferences-validation.ts` | + cross-review 验证 + `advise` action | ✅ 含 clamp（见 L3） |
| `src/resources/extensions/gsd/preferences.ts` | 两段式验证 + preset 注入 | ✅ |
| `src/resources/extensions/gsd/rule-registry.ts` | +`phase-discipline-profile-dispatch` 路由分支 | ⚠️ 硬编码 name（见 B3） |
| `src/resources/extensions/gsd/auto/run-unit.ts` | +built-in hook 短路 | ⚠️ 短路时机偏晚（见 B2） |
| `phase-discipline/preset.ts` (新) | 64 行，preset 声明 | ⚠️ 硬编码 gpt-5.4/openai（见 M4） |
| `phase-discipline/merge.ts` (新) | 78 行，shadow 合并 | ⚠️ 未防 built-in hook 被 shadow（见 B3） |
| `phase-discipline/profile-map.ts` (新) | 21 行，P0-P6 序列 | ✅ |
| `phase-discipline/profile-dispatch.ts` (新) | 133 行，advise 决策 | ⚠️ 进程内状态 + 脆弱 regex（见 M2/L2） |
| `phase-discipline/reviewer-hook.ts` (新) | 353 行，cross-review 执行 | ⚠️ 无 hard timeout（见 B2） |
| `phase-discipline/findings-carry.ts` (新) | 12 行，prompt builder | 🟢 可考虑合入 preset.ts |
| `phase-discipline/tests/*.test.ts` (新) | 176 行，3 个测试文件 | ❌ 低于计划预算 260-420 行 |

### 计划要求但**未落地**的交付物

| 文件 | 状态 | 影响 |
|---|---|---|
| `src/resources/extensions/gsd/phase-discipline/README.md` | ❌ 缺失 | 使用文档缺口 |
| `src/tests/phase-discipline-integration.test.ts` | ❌ 缺失 | Δ-K1 回归无 CI 硬保护（见 B1） |

### 测试与构建验证

```
npx tsc --noEmit -p tsconfig.json  → clean
phase-discipline/tests/merge.test.ts           → 2/2 passed
phase-discipline/tests/profile-dispatch.test.ts → 2/2 passed
phase-discipline/tests/reviewer-hook.test.ts    → 1/1 passed
```

---

## Detailed Findings

### 🔴 Blocking / P0（合并前必做）

#### B1. 计划要求的 integration test 未落地

**File**: `src/tests/phase-discipline-integration.test.ts` **不存在**

计划 Task 1 Step 5 明确要求端到端验证：
> 断言当 `profile-dispatch` 返回 `advise` 时，`getOrCreateRegistry().decide*()` 的下一次 pick 是 `advisedUnitType` 而不是原请求的 `unitType`

目前只有单元测试验证 `result.action === "advise"`，**没有任何测试跨 `RuleRegistry.evaluatePreDispatch()` + `auto-dispatch.ts::honour-phase-discipline-advice` + `phases.ts::runDispatch` 二次 resolve 的完整链路**。

**影响**：PR-3a 的 kernel 链路若将来出现细微回归，PR-3b 单元测试仍会全绿，但线上 advise 将静默失效。Δ-K1 与 preset 的绑定在 CI 中缺硬保护。

**修复**：新增 integration test，按计划 Task 1 Step 5 fixture 要求使用 `initRegistry(convertDispatchRules(DISPATCH_RULES), resolvePostUnitHooks(), resolvePreDispatchHooks())` 而非 `[] as any`。

---

#### B2. `run-unit.ts` 短路发生得太晚，浪费 `newSession()`

```169:183:src/resources/extensions/gsd/auto/run-unit.ts
const hookState = unitType.startsWith("hook/") ? getActiveHook() : null;
const hookConfig = hookState
  ? resolvePostUnitHooks(s.basePath).find((hook) => hook.name === hookState.hookName)
  : undefined;
const handledByBuiltinHook = await maybeRunPhaseDisciplineBuiltInHook({
  unitType,
  basePath: s.basePath,
  hookState,
  hookConfig,
  currentModel: s.currentUnitModel,
});
if (handledByBuiltinHook) {
  _clearCurrentResolve();
  return { status: "completed", event: { messages: [] } };
}
```

**问题**：built-in hook 短路位于 `newSession()`（约 line 58）与 `pi.setModel()`（约 line 99）**之后**。这意味着每次 `phase-discipline-code-review` / `design-review` 触发都：

1. 创建一次新的 agent session（100ms+ 代价）
2. 可能调用 provider `setModel`（token 探测）
3. 然后立刻丢弃全部结果

在 B-min 假设（每个 `execute-task` / `plan-slice` 都触发 review）下，这等同于 session 数量翻倍。

**衍生问题**：`runPhaseDisciplineReviewerHook` 内部没有超时。若 reviewer 子进程挂起，此处将永久阻塞——原本由 `unitPromise` 外壳覆盖的 `UNIT_HARD_TIMEOUT_MS` 路径被短路绕过。

**修复建议**：
1. 把 built-in hook 的检测提前到 `newSession()` 之前
2. 给 reviewer 加绝对超时（建议复用 `resolveAutoSupervisorConfig().hard_timeout_minutes`）

---

#### B3. `phase-discipline-profile-dispatch` 硬编码 name 路由，存在静默语义劫持

```326:338:src/resources/extensions/gsd/rule-registry.ts
if (hook.name === "phase-discipline-profile-dispatch") {
  firedHooks.push(hook.name);
  const result = evaluatePhaseDisciplineProfileDispatch({
    unitType, unitId, prompt: currentPrompt, basePath,
  });
  return { ...result, firedHooks };
}
```

**问题**：`rule-registry` 通过 hook 的 `name` 字段（而非类型、协议或标签）硬绑定到内置评估函数。

- 用户若在 preferences 手写同名 hook 并被 `merge.ts::mergePreDispatchHooks` 视为 shadow，用户 hook 会被塞进 merged 数组，`rule-registry` 仍走 `evaluatePhaseDisciplineProfileDispatch`，**静默忽略** 用户配置的 `unit_type`/`prepend`/`append`。
- 计划文档的 shadow 规则（"user names win"）对此 hook **不适用**，但目前没有任何报错或警告。

**修复建议**：两选一
- 方案 A：在 `merge.ts::mergePreDispatchHooks` 拦截此名称，拒绝用户 shadow 并 `logError`。
- 方案 B：给 `PreDispatchHookConfig` 加 opaque `builtin?: "phase-discipline-profile-dispatch"` 字段，由 preset 注入，`rule-registry` 按此字段路由，用户即使同名也走用户 hook。

推荐方案 B（更符合架构开放扩展原则）。

---

#### B4. 计划要求的 `README.md` runbook 未落地

**File**: `src/resources/extensions/gsd/phase-discipline/README.md` **不存在**

计划明确要求创建该文件作为 preset 的使用说明与 runbook 入口。缺失后续 onboarding 成本增加。

**修复**：按计划提纲创建，至少覆盖：
- preset 作用范围与 opt-in 方式（`milestone_profile: "phase-discipline-8step"`）
- 8 步序列与 gating 说明（强引用 `profile-map.ts`）
- cross-review 工作机制（默认 2 个 reviewer）
- shadow 规则与 warning 含义

---

### 🟡 Medium / P1（短期内补齐）

#### M1. 测试覆盖显著低于计划要求

| 计划要求 | 实际 | 缺口 |
|---|---|---|
| `profile-dispatch.test.ts` 覆盖 6+ 场景（3 个 advise 路径、P4 strict gate、3 次 disagreement backoff、proceed 回路） | 2 个 advise 测试 | ❌ `complete-slice`/`complete-milestone` P4 gate、**3 次分歧 backoff 全周期**、`clearDisagreement` proceed 路径 未测 |
| `reviewer-hook.test.ts` 覆盖 4+ 场景（`cross_review=1`、`cross_review=3`、missing artifact fallback、全 reviewer 失败 fallback、`cross_review_models` override） | 1 个测试 | ❌ 4 个关键 fallback / override 分支未测 |
| `merge.test.ts` 覆盖 preset off、pre-dispatch shadow、order invariant | 2 个测试 | ❌ `milestone_profile === "auto"` off 分支、pre-dispatch shadow、"preset hook 排在用户 hook 之前"顺序断言 未测 |
| 集成测试 | 0 个 | ❌ 见 B1 |

行数佐证：计划预算测试 `~260-420` 行，实际 **176** 行（42% 达成）。

#### M2. `disagreementCounts` 为进程内 Map，重启即丢

```9:src/resources/extensions/gsd/phase-discipline/profile-dispatch.ts
const disagreementCounts = new Map<string, number>();
```

重启进程后 backoff 计数归零，用户可能陷入更长的 advise 循环才触发 backoff。spec §3.1 明确"无需持久化"，但从可观测性角度是盲点。建议至少在 `logWarning` 加入 structured context（current / advised unit、连续计数）方便日志追踪。

#### M3. `clearDisagreement` 做 O(N) 线性扫描

```63:69:src/resources/extensions/gsd/phase-discipline/profile-dispatch.ts
function clearDisagreement(basePath, milestoneId, phase, currentUnitType): void {
  for (const key of disagreementCounts.keys()) {
    if (key.startsWith(`${basePath}:${milestoneId}:${phase}:${currentUnitType}->`)) {
      disagreementCounts.delete(key);
    }
  }
}
```

每次 proceed 都扫描整个 Map。Map 规模通常小（O(几十)），可用 nested Map `Map<scopeKey, Map<advisedUnitType, count>>` 做 O(1) clear。非阻塞。

#### M4. `preset.ts` 硬编码模型与 provider

```16:18:src/resources/extensions/gsd/phase-discipline/preset.ts
model: "gpt-5.4",
provider: "openai",
cross_review: 2,
```

强耦合到特定模型名。若用户无 openai 凭证，整个 `phase-discipline-8step` preset 默认都会失败（fallback 写入 `reviewer-subprocess-failure` artifact，触发 retry，形成循环直到 `max_cycles: 2` 耗尽）。

**建议**：从 `preferences.review_models` / `context.model` 动态解析；或文档明确声明此 preset 要求 openai 凭证。

#### M5. Observability v1 结构化日志未实现

计划 §Observability v1 要求：
> Per-hook structured JSON log for reviewer status and metrics

当前实现只在失败路径 `logWarning("dispatch", ...)` 字符串日志。成功路径（primary + cross reviewer 的 assessment、耗时、artifact path）完全无结构化记录。建议至少接入项目已有的 `workflow-logger` 并采用 structured fields。

---

### 🟢 Low / P2（Nit / v1.1）

#### L1. `reviewer-hook.ts` 三处 artifact 渲染逻辑重复

Missing-artifact / all-reviewers-failed / success 三个分支都构造相似的 markdown lines 数组。可抽取 `buildFallbackArtifact({ criticalId, criticalRationale })` 助手。非阻塞。

#### L2. `profile-dispatch.ts::parseStateMarkdown` 用脆弱正则解析

```15:17:src/resources/extensions/gsd/phase-discipline/profile-dispatch.ts
const milestoneMatch = content.match(/\*\*Active Milestone:\*\*\s+([^\n]+)/);
const sliceMatch = content.match(/\*\*Active Slice:\*\*\s+([^\n]+)/);
const phaseMatch = content.match(/\*\*Phase:\*\*\s+([^\n]+)/);
```

直接 regex 解析 `STATE.md`。若 STATE.md 格式演化（加空格、改粗体为标题），会静默退化为 `milestoneId undefined`，触发 `return { action: "proceed" }`——profile-dispatch 完全失效但无告警。

**建议**：复用项目已有的 state reader（如存在 `state.ts` API），或 regex miss 时 `logWarning`。

#### L3. `preferences-validation.ts` `cross_review` clamp 静默

```474:477:src/resources/extensions/gsd/preferences-validation.ts
if (Number.isFinite(cr)) {
  validHook.cross_review = Math.max(1, Math.min(5, Math.round(cr)));
}
```

用户配 `cross_review: 10` 被静默裁剪到 5。建议加 warning 到 `warnings` 数组。

#### L4. `findings-carry.ts` 仅 12 行、1 个 pure 函数

单独成文件理由偏弱，可合入 `preset.ts`。不影响功能。

---

## Architecture Assessment

### ✅ 做得好的部分

1. **边界清晰**：`preset.ts`（声明）/ `merge.ts`（合并）/ `profile-dispatch.ts`（决策）/ `reviewer-hook.ts`（执行）单一职责遵守良好。
2. **忠实复用既有契约**：没有发明新 hook 机制，直接消费 Δ-K1 的 `action: "advise"` + `advisedUnitType`。
3. **两段式验证**：`preferences.ts` 先校验用户输入，再注入 preset，再做二次校验——保证 preset 注入的 hook 自身合法。
4. **最小桥接**：`findings-to-memories` 保持 prompt-driven，`profile-dispatch` 只锁关键错序场景——符合作者"不扩展通用 hook 平台"的声明。

### ⚠️ 值得关注的耦合

1. **B3**：`rule-registry` 通过 hook name 字符串硬编码到 built-in 分支。建议换 opaque `builtin?` 字段路由。
2. **B2**：`run-unit.ts` 的 built-in hook 桥接插在 `newSession()` 之后。架构上更干净的做法是 dispatcher 分派前识别"纯代码执行 hook"走 fast-path。

---

## Action Plan

### P0（合并前必做，估计 2-4 小时）

| # | 任务 | 文件 | 影响 |
|---|---|---|---|
| 1 | 创建 `src/tests/phase-discipline-integration.test.ts`，端到端验证 `RuleRegistry.evaluatePreDispatch` + `honour-phase-discipline-advice` 链路 | new file | 防 Δ-K1 回归 |
| 2 | `run-unit.ts` built-in hook 短路前移到 `newSession()` 之前 | `run-unit.ts` | 性能 + 稳定性 |
| 3 | 给 `runPhaseDisciplineReviewerHook` 加 hard timeout（复用 `hard_timeout_minutes`） | `reviewer-hook.ts` | 稳定性 |
| 4 | `merge.ts::mergePreDispatchHooks` 拒绝或明确警告 `phase-discipline-profile-dispatch` 被用户 shadow | `merge.ts` | 消除静默语义劫持 |
| 5 | 创建 `src/resources/extensions/gsd/phase-discipline/README.md` | new file | onboarding 文档 |

### P1（推荐短期内补）

| # | 任务 | 文件 |
|---|---|---|
| 6 | 补齐 `profile-dispatch.test.ts`：P4 `complete-slice` gate、3 次 disagreement backoff、`clearDisagreement` 路径 | tests |
| 7 | 补齐 `reviewer-hook.test.ts`：missing artifact fallback、all reviewers fail fallback、`cross_review_models` override | tests |
| 8 | 补齐 `merge.test.ts`：preset off 分支、pre-dispatch shadow、preset 在 user hook 前的顺序断言 | tests |
| 9 | 给 `disagreementCounts` 的 warning 加 structured context | `profile-dispatch.ts` |
| 10 | `preset.ts` 默认模型改为从 preferences 动态解析，不再硬编码 `gpt-5.4` | `preset.ts` |

### P2（可放到 v1.1）

| # | 任务 |
|---|---|
| 11 | 实现 Observability v1 结构化 JSON 日志 |
| 12 | `parseStateMarkdown` 复用 state reader API，regex miss 时 `logWarning` |
| 13 | `cross_review` clamp 时加 warning |
| 14 | `reviewer-hook.ts` 抽取 `buildFallbackArtifact` 消除 3 处渲染重复 |
| 15 | `clearDisagreement` 改 nested Map 做 O(1) 清理 |

---

## Next Actions

1. **合并前**：完成 P0 五项。建议 `npx tsx --test` 跑完整 `phase-discipline` 套件 + 新增 integration test 验证绿灯。
2. **合并后监控**：上线后用 `milestone_profile: "phase-discipline-8step"` 真实跑一个完整 milestone，观察：
   - 每个 `execute-task` 是否都触发两个 reviewer（primary + picker）
   - `disagreementCounts` 是否真的进入 3 次 backoff
   - reviewer 耗时分布（为 hard-timeout 阈值提供数据）
3. **文档同步**：在 `docs/superpowers/specs/phase-discipline-preset.md` §Observability 节补上"v1 仅 warning-level 文本日志、v1.1 再加 structured JSON"的真实状态，避免 spec 与实现漂移。

---

## 最终判定

PR-3b 作为 B-min skeleton 的功能目标已达成：核心 advise-pipe 可工作、测试绿灯、typecheck 干净、作者声明的"最小桥接"范围控制得当。

但 **P0 列出的 5 项**（尤其 integration test 缺失、`run-unit` 短路时机、name-based 硬编码路由）建议在合并 main 之前处理，否则后续在 auto-mode 回归或用户自定义 hook 场景下排障难度较高。
