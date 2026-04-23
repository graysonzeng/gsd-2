# Phase-Discipline Preset（v7.1）+ PR-2 Shared-Harness Extraction —— 综合评审

- **被评审文档**：
  - `[docs/superpowers/specs/phase-discipline-preset.md](../specs/phase-discipline-preset.md)` (v7.1)
  - `[docs/superpowers/specs/README.md](../specs/README.md)`
  - `[docs/superpowers/plans/2026-04-23-pr-2-shared-harness-extraction.md](../plans/2026-04-23-pr-2-shared-harness-extraction.md)`
- **评审日期**：2026-04-23
- **评审人**：Cursor / Claude Opus 4.7
- **评审方法**：三层对照（spec ↔ plan ↔ `feat/composed-lite-runtime-owned` 分支源码）
- **权威源码参考**：
  - `composed-lite/review-harness.ts`（369 行）
  - `composed-lite/review-model-picker.ts`（231 行）
  - `composed-lite/subagent-spawn.ts`（211 行）
  - `composed-lite/subagent-terminal.ts`（113 行）
  - `composed-lite/resolve-bin.ts`（44 行）

---

## 总览（TL;DR）


| 层面                 | 结论                                                                                   | 置信度 |
| ------------------ | ------------------------------------------------------------------------------------ | --- |
| **方向与架构**          | ✅ 正确。复用 `post_unit_hooks` + `pre_dispatch_hooks` 而非另建 overlay，是 spec v5 失败后最低代价的正确路径 | 高   |
| **Δ-K1 kernel 约束** | ✅ 合理。`action:"advise"` 作为纯加性扩展，blast radius 小；拒绝 Δ-K2 是对的                            | 高   |
| **分支/PR 拓扑**       | ✅ 清晰。PR-3a 从 PR-3 拆出使 Δ-K1 可独立评审；`feat/composed-lite-runtime-owned` 明确冻结为 Lab        | 高   |
| **PR-2 实施计划**      | 🟡 核心正确，已解决前期 B1–B5 & H1–H3；仍遗留 3 处**中等**实施期注意事项                                     | 中高  |
| **spec 内部一致性**     | 🟡 与 README 高度自洽；但 §6.2 观测目录路径存在一处隐性不一致                                              | 中   |
| **对 PR-3b 后续阻塞**   | ✅ `§9.0 readiness gate` 已正确标注"runtime 已部分落地、validator 未接受 advise"                    | 高   |


**总评**：方案**可开工**。PR-2 进入 subagent-driven 实施不再有 blocker 级问题，但有 3 处实施期注意事项与 4 处 spec 层遗漏需要在 PR-3b 计划中补齐。

---

## 一、Spec 层（phase-discipline-preset.md v7.1 + README.md）评审

### A. 设计正确的地方（确认）

1. **§0 四项"Rejected entirely"清单**正确——特别是"拒绝新 overlay 层 / 拒绝 `--phase-discipline` CLI flag / 拒绝 `SHARED_HARNESS_API_VERSION` 协议"三项守住了 v4.1/v5 的教训。
2. **§3.1a Δ-K1 vs Δ-K2 分析**结论正确。关键决定——"`honour-phase-discipline-advice` 作为 `DISPATCH_RULES[0]` 前缀规则，复用 stock rule 的 runnable 判定"——把"调度器保持纯净、规则系统仍可覆盖"这个不变式守住了。
3. **§3.1b 8-phase 映射**正确处理了两个 v7 错误：
  - v7 误把 `extract-learnings` 列为 dispatch unit（`grep -n extract-learnings auto-dispatch.ts = 0`），v7.1 拆成 §3.1b.1 / §3.1b.2 两张表修正 ✅
  - v7 把 P2/P3 列为 strict-gated，v7.1 降级为 soft（因为 artifact schema 要到 v1.3 才存在） ✅
4. **§3.2.1 Hook 冲突决议**的"full user-hook replacement + `cross_review` 默认为 1 + 双重 `logWarning`"规则，正确规避了"静默继承 preset 字段"这个经典运维坑。
5. **§9.0 Implementation readiness gate**——明确区分"main 已有的 runtime 片段"与"missing 的 validator/preset-consumer"，避免了 v7 那种"假定 Δ-K1 已落"的幻觉。**这是整份 spec 最关键的质量门**。
6. **§12 能力迁移路线图（v1.1→v1.4）**放弃 v6 的时间触发（T1/T2/T3），改用"能力等价"的二进制可验证条件，这是更稳健的 Lab 退役策略。

### B. Spec 中需要关注的遗漏/隐患

#### 🟡 SPEC-M1：§6.2 观测日志目录路径存在**作用域错配**

当前 spec 描述：

```
.gsd/{mid}/{sid}/.phase-discipline/{hookName}-{tid}.json
```

问题：`profile-dispatch.ts`（pre-dispatch hook）在**调度选择下一个 unit** 时触发，此时 `{sid}` 可能**尚不确定**——特别是：

- 在 `discuss-milestone` 阶段尚无 active slice；
- `slice_parallel` 场景下同时存在多个 `{sid}`。

而 `{tid}`（task id）只对 `execute-task` 后的 code-review 才有意义。对 pre-dispatch hook 而言应该是 milestone-scoped 日志，路径更接近 `.gsd/{mid}/.phase-discipline/profile-dispatch-{seq}.json`。

**建议**：在 §6.2 区分"milestone-scoped 事件"与"slice/task-scoped 事件"的路径规则；PR-3b 的 `reviewer-hook.ts` 与 `profile-dispatch.ts` 可能走不同目录。现用一把通用 glob 描述，PR-3b 实现时必然要重新讨论。

#### 🟡 SPEC-M2：`slice_parallel` 下 profile-dispatch "aggregate 语义" 欠规格

§4.1 表格 + §8 错误处理表都写"多个 active slice 时 profile-dispatch 应用 aggregate 语义"，但**没有定义什么是 aggregate**。至少三种可能：

- (a) 所有 slice 必须同相位，任意一个未进入则 advise 拉回最老相位；
- (b) 每个 slice 独立看相位，profile-dispatch 只对当前 dispatch 的那条 slice 做判定；
- (c) 主 slice 进相位决定 advise，侧 slice 忽略。

三种行为差异很大。

**建议**：§3.1a 末尾或 §4.1 slice_parallel 行中显式锁定一种语义，并在 §10 testing strategy 加一行 `profile-dispatch.parallel-slices.test.ts`。

#### 🟡 SPEC-M3：`GSD_COMPOSED_LITE_SUBAGENT_TIMEOUT_MS` 环境变量归属没有 escalation 计划

PR-2 plan 记录 nit-1："迁入 `shared-harness/` 后保留旧前缀，不改"——这是合理的 PR-2 决策。但 spec 主体**没有把这条 OQ 正式录入 §15 OQ 列表**。

当 `phase-discipline/reviewer-hook.ts` 走 `shared-harness/subagent-spawn.ts` 时，新调用方也要忍受 `GSD_COMPOSED_LITE_`* 前缀——从 naming hygiene 讲，这违反"shared-harness 与 composed-lite 解耦"的 §3.4 scope guard（虽然不违反边界测试，因为边界测试只看 import）。

**建议**：在 §15 加 OQ-13 "shared-harness env-var 前缀迁移"，并在 R-15 明确记录"`GSD_COMPOSED_LITE_`* 前缀是 PR-2 的 debt，PR-3b 或 v1.1 选择是否引入 `GSD_SHARED_HARNESS_*` 别名并保留兼容期"。否则这是一处容易被遗忘的"语义污染"。

#### 🟡 SPEC-M4：`reviewer-core` 对 `--tools read` 的硬约束在 spec 文本中没有显式契约化

§3.4 描述了 `shared-harness/reviewer-core.ts` 的职责，但**没有在 spec 层**说"reviewer-core 内部调用 spawn 时必须传 `--tools read`"。

现在 PR-2 plan 用源码级 regex 断言守住（`shared-harness-reviewer-core.test.ts` Step 2 第 3 个 test），这是计划层的保护；但 spec 层只在 §5 "CLI restriction enforcement" 有一句叙述。

**建议**：§3.4 `reviewer-core.ts` 契约处明确加一行：

> Invariant: `reviewer-core` subprocess invocation MUST include `['--tools', 'read']`; enforced by structural test + PR-1 SDK chain.

这样 Spec 和 Plan 双重保护。

#### 🟢 SPEC-N1：§9.0 readiness gate 未提及 preset 集成测试是否 mock Δ-K1

当 PR-3a 已落地但 validator 仍拒绝时，PR-3b 的集成测试若 mock 了 validator 行为，可能造成"PR-3b 测试通过但运行时 preference 加载失败"。

**建议**：§10 testing strategy 在 "Integration — preset-in-auto-mode" 行补一句：

> 必须用真实 `resolvePostUnitHooks` 管道而非 mock，以捕获 validator 未同步时的 fail-fast 行为。

---

## 二、PR-2 实施计划评审

### A. 计划的强项（确认）

1. **分支护栏严密**——`test "$(git rev-parse --abbrev-ref HEAD)" = "feat/shared-harness-extraction"` + `git merge-base --is-ancestor feat/composed-lite-runtime-owned HEAD` 双重检查，彻底阻止在 `main` 直接实施的可能。
2. **4-Stage 分级投递**（Stage A 独立 worktree / Stage B 选择性 cherry-pick / Stage C 当前分支验证 / Stage D handoff 话术）——这是**最严谨的 cross-branch 交付设计**，有效隔离 `composed-lite/` runtime 不污染当前 `feat/phase-discipline-preset-v1` 分支。
3. **用结构源码测试代替 ESLint**（因为仓库目前没有 root ESLint 配置）。这是一处务实的 infra 降级，加 `fileURLToPath(import.meta.url)` 路径解析与仓库其他 test 一致——修复前期 B5 的路径陷阱。
4. **Task 1 TDD**（先写 failing test → 再迁移 → 再改 adapter）符合 `test-driven-development` skill 的建议；Task 2 Step 5 提前跑 picker/subagent-spawn 回归，Task 3 Step 4 再跑 composed-lite runtime regression，Task 4 Step 1 用 `npm run test:unit` 做总网。分层次验证清晰。
5. `**ReviewerCoreError { kind, attempts }` 契约明确**——解决了 H2（错误类型泄漏），adapter 层可以按 `err.kind` 精确映射而非字符串匹配。

### B. 遗留的实施期注意事项（非 blocker，但建议在 subagent prompt 中显式告知实施者）

#### 🟡 PLAN-M1：Task 3 Step 2 composed-lite adapter 重写的**完整职责**在计划中仍是叙述式，未提供伪码骨架

现在计划说 adapter 要做：

- gather state/req/phase/…
- derive providerReady
- build modelArg
- call runReview
- on success → persist attempts + update envelope
- on error → persist + remap + rethrow
- write artifact + update state

这涉及约 10 个副作用点（raw-log 写入、envelope 回写、audit 事件 `reviewer_preflight` / `subagent_call` / `subagent_result` / `reviewer_verdict`、`ComposedLiteFuseError` 两种 kind 的映射）。369 行 → 估计仍在 150–200 行的 adapter，**不是"thin"的**。

**风险**：若实施者按"thin adapter"字面理解，可能把 raw-log 或 envelope 回写意外丢掉。Task 3 Step 3 的 `REQUIRED_AUDIT_KEYS = [...]` 常量是一道守门，能捕获 audit key 丢失，但捕获不到**更深层的状态机错误**（如 `envelope.output_hash` 写错）。

**建议**：在 subagent 实施指令中额外附上 `review-harness.ts` 原文（L60-L369）作为"源对照"——实施者必须对齐每一处副作用，而非按自然语言推断。

#### 🟡 PLAN-M2：`shared-harness/index.ts` 用 `export `* 有类型碰撞静默风险

```ts
export * from "./reviewer-core.js";
export * from "./review-model-picker.js";
export * from "./subagent-spawn.js";
export * from "./subagent-terminal.js";
```

`reviewer-core.ts` 会导出 `ReviewResult`、`ReviewAttempt`、`RunReviewInput` 等；`review-model-picker.ts` 有 `ReviewerUnavailableError` + `PickReviewerInput`。TypeScript 不会报冲突，但**如果未来新增重名会静默丢 export**（barrel `export `* 的已知陷阱）。

**风险等级**：低（当前 4 个文件无重名），但 v1.1+ 新增 shared-harness 文件（例如 §12 OQ 提到的 `model-arg.ts`）可能踩坑。

**建议**：Task 2 Step 4 barrel 改为显式命名导出：

```ts
export { runReview, parseReviewerOutput, ReviewerCoreError } from "./reviewer-core.js";
export type { RunReviewInput, RunReviewResult, ReviewAttempt, ReviewResult } from "./reviewer-core.js";
export { pickReviewerModel, ReviewerUnavailableError, inferProvider, defaultReviewerModel } from "./review-model-picker.js";
export type { PickReviewerInput } from "./review-model-picker.js";
// ... etc
```

代价：barrel 文件多 10 行；收益：类型边界可见、防回归。

#### 🟡 PLAN-M3：Pre-flight 没显式验证 `tsconfig.extensions.json` 的 glob 是否涵盖 `shared-harness/`

`npm run typecheck:extensions` 使用 `tsconfig.extensions.json`（package.json L94）。如果该 tsconfig 的 `include` 字段硬编码了 `src/resources/extensions/gsd/composed-lite/**/*.ts` 而非 `src/resources/extensions/gsd/**/*.ts`，新 `shared-harness/` 目录会被**静默跳过 typecheck**。

**建议**：Pre-flight Step 4 加一行：

```bash
grep -A 20 '"include"' tsconfig.extensions.json
```

确认 include pattern 足够宽（即包含 `shared-harness/`），或在 Task 2 Step 6 commit 前显式加入 tsconfig include。

#### 🟢 PLAN-N1：`composed-lite-subagent-spawn.test.ts` 的修改意图仍是模糊的

计划把它列入 "Files that must change"，但 Task 3 Step 3 只描述得很泛："add equivalent shared-harness imports and keep one legacy-shim smoke assertion"。**具体要加几条断言、改几行**没定。实施者可能改错或漏改。

**建议**：subagent prompt 附带该测试文件当前 HEAD 的内容，明确指令：

> 在原文件保留所有 test 的前提下，在文件顶部插入
> `import { spawnGsdSubagent as sharedSpawn } from '../shared-harness/subagent-spawn.js'`
> 并在已有的第一个 test 中加断言
> `assert.equal(sharedSpawn, spawnGsdSubagent)` 证明 shim 是纯 re-export。

#### 🟢 PLAN-N2：`resolve-bin.ts` 虽不 barrel-export，但**边界测试会扫描它**

Task 1 Step 1 的 boundary test `readdirSync(DIR).filter(name => name.endsWith(".ts"))` 会把 `resolve-bin.ts` 纳入扫描。`resolve-bin.ts` 当前实现（`git show` 确认）只引 `node:fs / node:path / node:url` + `process.env.GSD_BIN_PATH`，无 composed-lite import，测试可通过。

但若日后有人在 `resolve-bin.ts` 里添加对 composed-lite 的路径引用字符串（非 `import`），boundary test 也不会挂（它只匹配 `from "../composed-lite/..."` 形式）——这是设计内的。仅供知悉。

---

## 三、对 PR-3b 未来阻塞项的提前告警

以下是 PR-2 无需处理、但 PR-3b 实施计划需要解决的点（**Spec 层已识别但未落实到测试清单**）：


| #   | 项目                                                                                                   | 来源                                                       |
| --- | ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| F1  | validator 接受 `action:"advise"`（PR-3a 残留）                                                             | §9.0 已标                                                  |
| F2  | `profile-dispatch` 的 slice_parallel 语义                                                               | **SPEC-M2 本评审新提**                                        |
| F3  | 观测日志路径 milestone vs slice scope                                                                      | **SPEC-M1 本评审新提**                                        |
| F4  | `reviewer-hook.ts` 的 cross_review 失败合并（all-fail → `reviewer_unavailable`）与 reviewer-core 单次失败路径的契约对齐 | §8 有表格，但未链到 Plan 测试                                      |
| F5  | `merge.ts` 的 "re-validate merged hook list" 步骤（§3.2.1 invariant）                                     | §3.2.1 已定，但 §10 测试清单只测 merge 功能，未测 re-validate fail-fast |


---

## 四、结论与下一步

### 核心问题回答

- **方案是否合理正确**：✅ 整体合理。v7.1 相对 v7 的修订（Δ-K1 是真缺口、P2/P3 降软门、P7 拆出、§9.0 readiness gate）是必要且正确的修复。Δ-K1 用"前缀规则 + 第二次 resolveDispatch"的实现路径是最低耦合选择。PR-2 把 `composed-lite` 降级为 adapter + 使用结构测试替代 ESLint 是务实且可验证的。
- **PR-2 计划是否可开工**：🟢 可以。前期 B1-B5 + H1-H3 已内化到 plan 正文。仍建议实施时补上本评审 §二.B 的 3 条中等事项（尤其 PLAN-M1 给 subagent 附源对照、PLAN-M3 pre-flight 加 tsconfig 检查）。
- **是否有遗漏**：有 4 处 spec-level 遗漏（SPEC-M1~~M4）+ 4 处 plan-level 注意事项（PLAN-M1~~M3 + PLAN-N1~N2）。**其中 SPEC-M1 / SPEC-M2 会直接影响 PR-3b 的实现正确性，建议在 PR-3b 计划启动前先修订 spec**。PR-2 本身不受这些 spec 遗漏阻塞——可并行推进。

### 推荐下一步行动（按优先级）

1. **SPEC 层**：将 SPEC-M1/M2/M3/M4 以"spec 残留 OQ"形式加入 `phase-discipline-preset.md` §15（不触发 v7.2 版本号，作为 v1 附录）。
2. **PLAN 层**：PR-2 subagent 实施指令中加上 PLAN-M1/M3 的显式检查（源对照 + tsconfig include 验证）。
3. **执行层**：启动 PR-2 实施（`feat/shared-harness-extraction` 分支，worktree 隔离）。
4. **并行**：启动 PR-1 和 PR-3a（后者验证"advise validator"是否真缺失，若缺失只需加 ~10 行 validator 分支 + ~120 行测试）。
5. **最终合流**：三者皆合并 `main` 后，再开 PR-3b。

---

## 附录 A：环境验证记录

评审时实际执行的状态验证（供后续追溯）：


| 验证点                                                       | 结果                                                    |
| --------------------------------------------------------- | ----------------------------------------------------- |
| 当前分支                                                      | `feat/phase-discipline-preset-v1`                     |
| 当前分支 `composed-lite/` 存在否                                 | ❌ 不存在（符合预期）                                           |
| 当前分支 `shared-harness/` 存在否                                | ❌ 不存在（符合预期）                                           |
| `origin/main` 的 `composed-lite/` 文件数                      | 0（符合 spec §2.3 声明）                                    |
| 本地 `main` 的 `composed-lite/` 文件数                          | 30（本地 `main` 领先 `origin/main` 一个 commit，不影响 spec 有效性） |
| `feat/composed-lite-runtime-owned` 的 `composed-lite/` 存在性 | ✅ 存在，与 plan "base branch" 定义一致                        |
| `package.json` 测试脚本                                       | ✅ `test:unit` 自动链式调用 `test:compile`                   |
| `src/resources/extensions/gsd/tests/resolve-ts.mjs` 存在性   | ✅ 存在（plan 假设成立）                                       |


## 附录 B：源码读取摘要

- `**composed-lite/review-harness.ts`（369 行）**：`runReview()` 函数深度依赖 `ComposedLiteState` / `ArtifactEnvelope` / `buildRunScopedRawLogFileName` 等 composed-lite 内部状态；提取 `reviewer-core.ts` 时必须做 state-agnostic 改造。
- `**composed-lite/review-model-picker.ts`（231 行）**：纯函数 + `ReviewerUnavailableError`，无 state 依赖——适合直接迁移。
- `**composed-lite/subagent-spawn.ts`（211 行）**：依赖 `./resolve-bin.js` 与 `./subagent-terminal.js`，使用环境变量 `GSD_COMPOSED_LITE_SUBAGENT_TIMEOUT_MS`（前缀遗留问题见 SPEC-M3）。
- `**composed-lite/subagent-terminal.ts`（113 行）**：纯 terminal utility，无外部依赖。
- `**composed-lite/resolve-bin.ts`（44 行）**：只引 Node 内置模块 + `process.env.GSD_BIN_PATH`，适合作为 `shared-harness/` 的 internal helper（不 barrel-export）。

