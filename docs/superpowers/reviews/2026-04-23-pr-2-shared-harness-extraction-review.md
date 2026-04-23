# PR-2 Shared-Harness Extraction —— 实现评审

- **被评审对象**：canonical PR-2 方案的实现状态（即"`shared-harness/` 抽取"整个交付）
- **参考计划**：`[docs/superpowers/plans/2026-04-23-pr-2-shared-harness-extraction.md](../plans/2026-04-23-pr-2-shared-harness-extraction.md)`
- **参考规格**：
  - `[docs/superpowers/specs/phase-discipline-preset.md](../specs/phase-discipline-preset.md)`
  - `[docs/superpowers/specs/README.md](../specs/README.md)`
- **评审分支**：`feat/phase-discipline-preset-v1`
- **评审日期**：2026-04-23
- **评审方法**：规格 ↔ 计划 ↔ 本分支实际落地产物 ↔ `feat/composed-lite-runtime-owned` 权威参考 四方对照
- **评审者角色**：Code Review Coordinator（Quality Auditor + Security Analyst + Performance Reviewer + Architecture Assessor）

---

## 总体裁定

**canonical PR-2 未实现。不应在当前分支声称已完成。**

用户本人的表态与代码库实际状态完全一致。canonical PR-2 的范围（见 plan 的 Stage A → D）要求在 `feat/shared-harness-extraction`（从 `feat/composed-lite-runtime-owned` 切出）上**同时完成两件事**：provider 侧（shared-harness 模块）与 consumer 侧（composed-lite adapter + 回归证据）。缺了适配层就失去了 PR-2 的核心价值（证明 composed-lite 行为无回退）——这是**不可部分完成**的 PR。

### 当前分支实际完成度矩阵


| 方面                                                                                          | 计划要求                                            | 当前分支实际状态                       |
| ------------------------------------------------------------------------------------------- | ----------------------------------------------- | ------------------------------ |
| `shared-harness/` 6 个源文件                                                                    | 新建（5 个公共 + 1 个 internal helper）                 | ✅ 存在但**未提交（untracked）**        |
| `composed-lite/review-harness.ts` 重写为 adapter                                               | 必做                                              | ❌ 未做（`composed-lite/` 在本分支不存在） |
| `composed-lite/{subagent-spawn,subagent-terminal,review-model-picker}.ts` 转为 re-export shim | 必做                                              | ❌ 未做                           |
| 17-key 审计载荷不变性回归测试                                                                          | `composed-lite-runtime-regression.test.ts` 必须通过 | ❌ 无此测试                         |
| `feat/shared-harness-extraction` 分支                                                         | canonical PR-2 必在该分支开                           | ❌ 未创建（本地与远端均无）                 |
| 4 个 shared-harness 单元/边界测试                                                                  | 必做                                              | ✅ 存在且 **12/12 通过**；未提交         |
| `npm run typecheck:extensions`                                                              | 必须通过                                            | ✅ 通过                           |


### 优先级分类

- **P0（阻塞 claim）**：canonical PR-2 未完成；当前分支只有 provider 侧而没有 consumer 侧与回归证据。
- **P0（流程风险）**：Stage B 子集（6 源文件 + 4 测试，共 889 行）**全部 untracked**。`git stash` / `git checkout` / `git clean -fdx` 任一操作都会抹掉。
- **P1（命名债）**：`shared-harness` 模块内仍保留 5 个 `GSD_COMPOSED_LITE_`* 环境变量前缀（见 2.1）。语义上把 shared-harness 与 composed-lite 绑死。
- **P2（测试缺口）**：`runReview` 本身无集成测试（仅测了纯函数 `parseReviewerOutput`）。依赖注入缺失，无法在不起子进程的情况下覆盖重试循环。

**Stage B 代码质量本身：良好**，可以作为 canonical PR-2 的 provider 侧原地使用，没有发现阻塞级质量/安全/性能问题。

---

## 一、可验证的观察证据

本评审所有结论均基于以下 shell/test 结果：

```text
git branch --show-current               → feat/phase-discipline-preset-v1（非 feat/shared-harness-extraction）
git branch -a | grep shared-harness     → 0 匹配
git ls-tree -r feat/composed-lite-runtime-owned -- src/resources/extensions/gsd/shared-harness
                                        → 0 文件
git status -u src/.../shared-harness/   → 全部 untracked
npm run typecheck:extensions            → exit 0
node --test src/.../tests/shared-harness-*.test.ts
                                        → tests 12, pass 12, fail 0
```

`feat/composed-lite-runtime-owned` 上 composed-lite/ 存在 34 个文件，其中 `subagent-spawn.ts` / `subagent-terminal.ts` / `review-model-picker.ts` / `review-harness.ts` / `resolve-bin.ts` 均为 PR-2 计划中要被 shared-harness 取代（或转 shim）的原件。

---

## 二、Detailed Findings

### 2.1 Architecture Assessor — 命名层语义泄漏（P1）

`src/resources/extensions/gsd/shared-harness/review-model-picker.ts` 与 `subagent-spawn.ts` 内保留了 composed-lite 遗留的 5 个环境变量名：

```79:81:src/resources/extensions/gsd/shared-harness/review-model-picker.ts
  const explicitReviewerModel = normalizeTrim(env.GSD_COMPOSED_LITE_REVIEWER_MODEL);
  const explicitReviewerProvider = normalizeTrim(env.GSD_COMPOSED_LITE_REVIEWER_PROVIDER);
```

```52:58:src/resources/extensions/gsd/shared-harness/subagent-spawn.ts
function resolveSubagentTimeoutMs(): number {
  const raw = process.env.GSD_COMPOSED_LITE_SUBAGENT_TIMEOUT_MS?.trim();
```

错误消息同样把用户引导到 composed-lite 命名空间：

```146:148:src/resources/extensions/gsd/shared-harness/review-model-picker.ts
    `Set ANTHROPIC_API_KEY, OPENAI_API_KEY, or GEMINI_API_KEY for an alternate provider, ` +
    `or configure a reviewer explicitly via GSD_COMPOSED_LITE_REVIEWER_MODEL + GSD_COMPOSED_LITE_REVIEWER_PROVIDER. ` +
    `Set GSD_COMPOSED_LITE_ALLOW_SELF_REVIEW=1 and GSD_COMPOSED_LITE_FALLBACK_CONTINUE=1 to allow same-provider review (not recommended).`,
```

**问题**：`phase-discipline-8step` 的使用者（PR-3b 后）根本不会用 composed-lite，却被引导去配置 `GSD_COMPOSED_LITE_`*。结构已解耦（boundary test 通过），但语义仍绑死。

**建议**：**不在 canonical PR-2 内改**——会把回归面扩大，违背"provider 行为 byte-identical"前提。应在 plan 的 `Risks & Alternatives` 新增 `R-naming-debt`，并在 `phase-discipline-preset.md` 新增 OQ-13 记录迁移方案（`GSD_SHARED_HARNESS_`* 新前缀 + warn-on-read 兼容层 + 错误消息同步）。

### 2.2 Architecture Assessor — `runReview` 依赖反转缺失（P2）

`runReview` 直接静态导入 `spawnGsdSubagent`：

```7:9:src/resources/extensions/gsd/shared-harness/reviewer-core.ts
import { spawnGsdSubagent } from "./subagent-spawn.js";
import type { SubagentTerminalResult } from "./subagent-terminal.js";
```

**后果**：

- 无法在不起真实 gsd CLI 子进程的前提下测试重试循环、`parse_exhausted`、`subprocess_failure` 分支。
- `shared-harness-reviewer-core.test.ts` 因此只覆盖了 3 条：export 断言、`parseReviewerOutput` 正常路径、源码正则断言 `--tools read`。**零覆盖 `runReview` 行为**。

**建议**：canonical PR-2 正式开 PR 时，在 `RunReviewInput` 增加 `spawn?: typeof spawnGsdSubagent` 可注入参数（默认真实实现），随后补 3 条测试：

1. 首次 parse 失败 + 第二次成功 → 返回 `RunReviewResult.attempts.length === 2`
2. 所有 attempt parse 均失败 → 抛 `ReviewerCoreError("parse_exhausted", ..., attempts[2])`
3. `terminalError` → 抛 `ReviewerCoreError("subprocess_failure", ..., attempts[1])`

### 2.3 Quality Auditor — `parseReviewerOutput` 类型收窄不足（P2）

```87:90:src/resources/extensions/gsd/shared-harness/reviewer-core.ts
      critical: Array.isArray(parsed.critical) ? parsed.critical as Array<{ id: string; target: string; rationale: string }> : [],
      important: Array.isArray(parsed.important) ? parsed.important as Array<{ id: string; target: string; rationale: string }> : [],
      minor: Array.isArray(parsed.minor) ? parsed.minor as Array<{ id: string; target: string; rationale: string }> : [],
```

`as` 强断言未校验数组内元素结构。若 reviewer 吐出 `critical: ["string-only"]` 或 `critical: [{ id: 1, ... }]`（`id` 为 number），会静默穿透到下游审计载荷。下游的 `cross_review` 合并与 `worst-assessment` 计算会因字段形状不一致而在序列化环节崩。

**建议**：加一个 `coerceFindingItem(raw): { id: string; target: string; rationale: string } | null`，`filter(Boolean)` 过滤无效条目，并在丢弃时记录 warning（可通过 input 可选的 `logger` 注入）。

### 2.4 Quality Auditor — `resolveSubagentTimeoutMs` 双读（P3）

```185:192:src/resources/extensions/gsd/shared-harness/subagent-spawn.ts
      timeoutHandle = setTimeout(() => {
        const timeoutMs = resolveSubagentTimeoutMs();
        try {
          proc.kill("SIGTERM");
        } catch {
        }
        settle(1, `subagent timed out after ${timeoutMs}ms`);
      }, resolveSubagentTimeoutMs());
```

在 schedule 和 settle 消息两个位置各读一次 `process.env`。若启动后修改环境变量（罕见但可能），错误消息里的 `timeoutMs` 将与实际触发的不一致。

**建议**：提取一次到局部变量：

```typescript
const timeoutMs = resolveSubagentTimeoutMs();
timeoutHandle = setTimeout(() => {
  try { proc.kill("SIGTERM"); } catch {}
  settle(1, `subagent timed out after ${timeoutMs}ms`);
}, timeoutMs);
```

### 2.5 Security Analyst — 全部通过（无阻塞）

- 子进程 `shell: false`、参数走 argv 数组 → 无 shell 注入面 ✅
- reviewer 强制 `--tools read`，且有 source-level 正则断言（`shared-harness-reviewer-core.test.ts` 第 37 行）✅
- 临时 prompt 文件 `mode: 0o600` ✅
- YAML 用 `yaml` 库默认 safe 模式（未启用 custom tags）✅
- 无显式日志字符串包含 prompt 明文（不会泄漏到 stderr）✅

### 2.6 Performance Reviewer — 中等风险 1 个（P3）

子进程 stdout/stderr 的聚合方式：

```194:195:src/resources/extensions/gsd/shared-harness/subagent-spawn.ts
      proc.stdout.on("data", (data) => { stdout += data.toString(); });
      proc.stderr.on("data", (data) => { stderr += data.toString(); });
```

字符串拼接 + `data.toString()` 在超长 session（多 MB 输出）下会产生 O(n²) 内存抖动。`parseSubagentTerminalResult` 也会对整个字符串做 `split("\n")`。对 10 分钟 reviewer 来说通常问题不大，但在 `cross_review: 3` 并行场景（PR-3b 会开启）可能叠加。

**建议（可延到 PR-2 之后）**：聚合用 `Buffer[]`，最后 `Buffer.concat().toString("utf8")`；或按行流式解析，省掉 split。

### 2.7 Architecture Assessor — boundary test 覆盖面窄（P3）

```14:17:src/resources/extensions/gsd/tests/shared-harness-boundary.test.ts
    assert.doesNotMatch(source, /from\s+[\"']\.\.\/composed-lite\//, `${name} must not import composed-lite`);
    assert.doesNotMatch(source, /from\s+[\"']\.\.\/phase-discipline\//, `${name} must not import phase-discipline`);
    assert.doesNotMatch(source, /import\(\s*[\"']\.\.\/composed-lite\//, `${name} must not dynamically import composed-lite`);
    assert.doesNotMatch(source, /import\(\s*[\"']\.\.\/phase-discipline\//, `${name} must not dynamically import phase-discipline`);
```

仅针对 `composed-lite/` 与 `phase-discipline/` 两个兄弟目录。其他 gsd 子模块（如 `auto-mode/`、`scheduler/`、`workflows/` 等）未禁。规格上 shared-harness 应为**叶子依赖**，不应导入任何 gsd 兄弟模块。

**建议**：扩展为正则黑名单 `\.\.\/(?!shared-harness\/)[a-z-]+\/`，配合白名单机制允许 `node:`*、第三方包、相对同目录。

### 2.8 流程风险 — 未 commit 的 Stage B 产物（P0）

```text
Untracked files:
  src/resources/extensions/gsd/shared-harness/
  src/resources/extensions/gsd/tests/shared-harness-boundary.test.ts
  src/resources/extensions/gsd/tests/shared-harness-review-model-picker.test.ts
  src/resources/extensions/gsd/tests/shared-harness-reviewer-core.test.ts
  src/resources/extensions/gsd/tests/shared-harness-subagent-spawn.test.ts
```

889 行代码 + 测试在工作区游离。**应立即提交**（作为 Stage B 的独立 commit），即便尚未打开 canonical PR-2。

---

## 三、Improvement Recommendations

### 3.1 立即（本次对话内）

**动作 A：提交 Stage B 产物**（阻止丢失）

```bash
git add src/resources/extensions/gsd/shared-harness/ \
        src/resources/extensions/gsd/tests/shared-harness-*.test.ts
git commit -m "feat(shared-harness): land Stage B subset (provider-only)

Extracted shared reviewer/subagent plumbing into src/resources/extensions/gsd/shared-harness/.
This is the Stage B 'safe-to-land-on-main-trunk' subset of the canonical PR-2 plan:
provider side only, no composed-lite adapter rewrite (composed-lite is not on this branch).

- reviewer-core.ts: runReview + parseReviewerOutput + ReviewerCoreError
- review-model-picker.ts: pickReviewerModel + provider inference
- subagent-spawn.ts / subagent-terminal.ts: CLI subagent plumbing
- resolve-bin.ts: internal GSD CLI locator
- index.ts: barrel exports

Canonical PR-2 (composed-lite adapter rewrite + regression snapshot) remains
open on feat/shared-harness-extraction (not yet created).

Refs: docs/superpowers/plans/2026-04-23-pr-2-shared-harness-extraction.md"
```

**动作 B：在 plan 顶部补 "Current Status" 小节**

```markdown
## Current Status (2026-04-23)

- Stage A (shared-harness authoring): DONE on `feat/phase-discipline-preset-v1`
  (as Stage B subset; not on its canonical `feat/shared-harness-extraction` branch)
- Stage B (promotion to consumer branch): DONE (committed 2026-04-23)
- Stage C (validation on consumer branch): DONE (12/12 tests pass, typecheck clean)
- Stage D (handoff to PR-3b): blocked on canonical PR-2 below

Canonical PR-2 remaining work (to be done on `feat/shared-harness-extraction`
branched from `feat/composed-lite-runtime-owned`):
- [ ] cherry-pick / copy shared-harness/ + tests from current branch
- [ ] rewrite composed-lite/review-harness.ts as thin adapter over reviewer-core
- [ ] convert composed-lite/{subagent-spawn,subagent-terminal,review-model-picker}.ts
      into re-export shims (max 3 lines each)
- [ ] add composed-lite-runtime-regression.test.ts covering 17-key audit payload
- [ ] verify `npm run test:extensions` + full validation on consumer branch
- [ ] open PR against `feat/composed-lite-runtime-owned`
```

### 3.2 近期（canonical PR-2 正式落地前）

在 `feat/shared-harness-extraction` 分支上补 `runReview` 3 条集成测试（见 2.2），再补 `composed-lite-runtime-regression.test.ts` 17-key audit payload snapshot。

### 3.3 延后（PR-2.1 或 PR-3b）

- 命名债迁移：`GSD_COMPOSED_LITE_*` → `GSD_SHARED_HARNESS_*`（留双读兼容 2 个 minor 版本）
- `parseReviewerOutput` 内元素形状校验（finding 2.3）
- boundary test 扩展为白名单模式（finding 2.7）
- stdout/stderr Buffer 聚合优化（finding 2.6）

---

## 四、Action Plan


| #   | 动作                                                                                        | 优先级    | 估时     | 影响                      |
| --- | ----------------------------------------------------------------------------------------- | ------ | ------ | ----------------------- |
| 1   | 提交 Stage B 的 untracked 文件到当前分支                                                            | **P0** | 2 min  | 防止 889 行工作丢失            |
| 2   | 在 PR-2 plan 顶部补 "Current Status / Canonical remaining" 小节                                 | **P0** | 10 min | 防止下次误以为 PR-2 已完成        |
| 3   | 创建 `feat/shared-harness-extraction`，cherry-pick 动作 1 的 commit，再补 composed-lite adapter 重写 | **P1** | 4-6 h  | 真正完成 canonical PR-2     |
| 4   | 补 `runReview` 3 条行为测试（注入 spawn）                                                           | **P1** | 1 h    | 补齐 PR-2 测试缺口            |
| 5   | 补 `composed-lite-runtime-regression.test.ts`                                              | **P1** | 2-3 h  | 证明 adapter 无行为回退        |
| 6   | 新增 OQ-13：命名债（`GSD_COMPOSED_LITE_`* → `GSD_SHARED_HARNESS_*`）迁移方案                          | **P2** | 15 min | 提示后续 PR 处理              |
| 7   | `parseReviewerOutput` 元素校验                                                                | **P2** | 30 min | 防静默数据错误传染               |
| 8   | boundary test 扩展为白名单                                                                      | **P3** | 20 min | 提高未来重构安全网               |
| 9   | stdout/stderr Buffer 聚合优化                                                                 | **P3** | 30 min | `cross_review:3` 场景内存友好 |


**关键依赖**：动作 1-2 可在当前分支立即做。动作 3-5 必须在 `feat/shared-harness-extraction` 分支上做，**不应**污染当前 `feat/phase-discipline-preset-v1`。动作 6-9 可在 PR-3b 或独立清理 PR 中处理。

---

## 五、Next Actions

1. **立刻**：执行动作 1（提交 Stage B）+ 动作 2（同步 plan 的 Current Status）。两件都是零风险操作。
2. **规划**：在 PR-3b 启动前必须先完成动作 3-5（canonical PR-2 落地 + 合并回 `feat/composed-lite-runtime-owned`）。PR-3b 才能消费稳定的 shared-harness。
3. **监控**：
  - canonical PR-2 landing 后，在 `composed-lite-runtime-owned` 上跑 `npm run test:extensions` 全量，比对 17-key audit 载荷 snapshot diff（期望 0 差异）。
  - 合并前在 `feat/shared-harness-extraction` 本地跑一次 `rg "GSD_COMPOSED_LITE_" src/resources/extensions/gsd/shared-harness/`，把 5 处命中存档为 `phase-discipline-preset.md` 的 OQ-13 证据。
4. **跟进 review**：canonical PR-2 PR 开出后，对 `composed-lite/review-harness.ts` 的 adapter 做专门 review——这是整个 PR-2 的核心风险点（状态/审计/artifact 侧效如何与 pure provider 解耦）。Stage B 的 provider 侧这次已过审查门。

---

## 附录 A：评审时的代码/文件清单

### shared-harness/ 模块（6 文件，668 行）


| 文件                       | 行数  | 职责                                                           |
| ------------------------ | --- | ------------------------------------------------------------ |
| `index.ts`               | 13  | barrel exports                                               |
| `resolve-bin.ts`         | 29  | GSD CLI 路径定位（internal）                                       |
| `review-model-picker.ts` | 152 | provider 推断 + reviewer model 选择（含 5 处 `GSD_COMPOSED_LITE_`*） |
| `reviewer-core.ts`       | 164 | `runReview` + `parseReviewerOutput` + `ReviewerCoreError`    |
| `subagent-spawn.ts`      | 210 | 子进程生命周期 + 信号清理（含 1 处 `GSD_COMPOSED_LITE_*`）                  |
| `subagent-terminal.ts`   | 113 | JSONL 流解析为 `SubagentTerminalResult`                          |


### 测试（4 文件，208 行；12 个测试用例 100% 通过）


| 文件                                           | 行数  | 用例数 |
| -------------------------------------------- | --- | --- |
| `shared-harness-boundary.test.ts`            | 19  | 1   |
| `shared-harness-reviewer-core.test.ts`       | 39  | 3   |
| `shared-harness-subagent-spawn.test.ts`      | 100 | 4   |
| `shared-harness-review-model-picker.test.ts` | 50  | 4   |


### 未在本分支出现但 canonical PR-2 要求的产物

- `src/resources/extensions/gsd/composed-lite/review-harness.ts`（adapter 重写）
- `src/resources/extensions/gsd/composed-lite/{subagent-spawn,subagent-terminal,review-model-picker,resolve-bin}.ts`（转 re-export shim）
- `src/resources/extensions/gsd/tests/composed-lite-runtime-regression.test.ts`（17-key 审计载荷 snapshot）

均需在 `feat/shared-harness-extraction` 分支上完成。