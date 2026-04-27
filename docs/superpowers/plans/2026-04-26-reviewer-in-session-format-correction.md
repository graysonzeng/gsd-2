# Reviewer In-Session Format Correction

**Date**: 2026-04-26
**Status**: Revised after codex review (2026-04-26-reviewer-in-session-format-correction-review.md)
**Scope**:
- `src/resources/extensions/gsd/shared-harness/reviewer-core.ts`
- `src/resources/extensions/gsd/phase-discipline/reviewer-hook.ts`
- `src/resources/extensions/gsd/rule-registry.ts`
- `src/resources/extensions/gsd/auto-post-unit.ts`
- `src/resources/extensions/gsd/tests/shared-harness-reviewer-core.test.ts`
- `src/resources/extensions/gsd/phase-discipline/tests/reviewer-hook.test.ts`
- `src/resources/extensions/gsd/phase-discipline/tests/reviewer-blocking.test.ts`

---

## Problem Statement

当前 reviewer 子代理的格式验证与重试机制存在设计缺陷：**格式问题被等同于基础设施故障**，导致不必要的 auto-mode pause。

### Current Flow

```
runReview() in reviewer-core.ts
  attempt 0: spawn 全新子进程 → 输出 → parseReviewerOutput() → null（格式不对）
  attempt 1: spawn 全新子进程 → 输出 → parseReviewerOutput() → null（格式不对）
  → throw ReviewerCoreError("parse_exhausted")

runPhaseDisciplineReviewerHook() in reviewer-hook.ts
  → Promise.allSettled() 捕获 ReviewerCoreError
  → results.length === 0
  → 写 {artifact}-BLOCKED.md，blockedReason = "reviewer_unavailable"

rule-registry.ts
  → 检测 BLOCKED 哨兵
  → blockedHook.reason = "reviewer_unavailable"

auto-post-unit.ts
  → isHookBlocked() === true
  → consumeBlockedHook()
  → pauseAuto()   ← auto 停摆，等待人工干预
```

### Three Specific Problems（保留）

1. **丢失上下文**：每次 retry 是杀掉旧子进程、重新 spawn 一个全新的；新子进程不知道上轮输出了什么。
2. **重复犯错**：同一模型对同一 prompt 很可能犯同样的格式错误。
3. **浪费 token**：每次重新建立完整 system prompt + target content。

### Root Cause: Two Failure Types Conflated

| 类型                                | 本质                             | 当前处理                         | 正确处理                                                       |
| ----------------------------------- | -------------------------------- | -------------------------------- | ------------------------------------------------------------- |
| **格式问题** (`parse_exhausted`)    | LLM 输出不符合 YAML schema       | 冒泡 `reviewer_unavailable` → pause | reviewer-core 内部做 format repair；仍失败则用独立的 blocked reason |
| **基础设施问题** (`subprocess_failure`) | 401/403/timeout/网络断/OOM       | 冒泡 `reviewer_unavailable` → pause | 保持现状（正确）                                               |

---

## Key Decisions from Review

1. **不** 把 exhausted parse 失败合成为 `issues` verdict——这会默默弱化 review gate。
2. **不** 在首版里做真正的同进程 `continueSession`——那需要改 CLI/RPC/headless 协议，scope 过大。
3. 首版采用 **Reviewer-Local Format Repair Loop**：在 `runReview()` 里再 spawn 一次、把 previous output + parse error + schema 喂进 prompt；不是真正的同进程 continuation，但同样 "不消耗 flow-level retry"。
4. 格式修复仍然失败时，写独立的 `reviewer_format_invalid` blocked reason，**不**伪造 verdict。
5. 保留现有 `subprocess_failure → reviewer_unavailable → BLOCKED → pause` 路径不变。

---

## Revised Design

### Principle

- **格式问题**在 reviewer-core 内部闭环处理，不消耗 post-unit hook 的 `max_cycles`，也不写 `retry_on`。
- **基础设施问题**仍然按原路径升级为 `reviewer_unavailable` 并 pause auto。
- **无法恢复的格式问题**作为一个新的、显式的 blocked reason `reviewer_format_invalid` 上浮，让 operator 知道"reviewer 基础设施没问题，但输出无法解析"——而不是把它和 provider outage 混在一起。

### Approach: Reviewer-Local Format Repair Loop

```
initial spawn → outputText
  → parseReviewerOutput(outputText) → { parsed, error }

if parsed && !terminalError:
  return { review: parsed, ... }

if terminalError:
  // 基础设施故障，不尝试 format repair
  throw ReviewerCoreError("subprocess_failure", ...)

if !parsed && !terminalError:
  // 格式问题：spawn 一次 repair request，把原输出和具体错误塞进 prompt
  for correctionRound in 1..maxCorrectionRounds:
    repairOutput = spawn({
      task: buildRepairTask(previousOutput, parseError, schema),
      modelArg, extraArgs
    })
    if repairOutput.terminalError:
      throw ReviewerCoreError("subprocess_failure", ...)
    { parsed, error } = parseReviewerOutput(repairOutput.outputText)
    if parsed: return { review: parsed, ... }
    previousOutput = repairOutput.outputText

  // repair 轮次耗尽
  throw ReviewerCoreError("parse_exhausted", ...)
```

说明：

- "Repair spawn"是 **独立子进程**，不是真正的同进程 continuation。这不违反 review 的建议——review 认为真同进程 continuation scope 过大，但 "把上次输出喂回去"的小 repair loop 可以接受。
- Repair prompt 只带最少上下文：原 output（截断上限）、parse error 描述、schema。不重发 target content。
- `maxCorrectionRounds` 默认 1（总共最多 2 次 spawn：initial + 1 次 repair）。后续如证明不够再调。
- **保留**原 `maxRetries` 的 fresh-spawn 重试作为兜底（默认 2 次完整 fresh attempt），但 fresh attempt 内部也走 format repair 循环。

### `parseReviewerOutput` — Return Diagnostics

```ts
export interface ParseResult {
  parsed: ReviewResult | null;
  error: ParseError | null;
}

export interface ParseError {
  kind:
    | "empty_output"
    | "yaml_syntax_error"
    | "not_object"
    | "missing_assessment"
    | "invalid_assessment_value"
    | "invalid_finding_list"   // critical/important/minor 顶层不是数组
    | "malformed_finding_item"; // 任一 item 缺 id/target/rationale
  message: string;       // 人类可读，可直接放进 repair prompt
  offendingValue?: string; // 可选：比如 "approved"
}

export function parseReviewerOutput(raw: string): ParseResult
```

**Behavior change（来自 review P2）**：

- 目前 parser 对 malformed finding item 是 **静默 drop**（见 `coerceFindingList`），这条行为由现有测试 `parseReviewerOutput drops malformed finding items` 锁定。
- 新版改为 **strict**：任一 finding item 不合法即返回 `{ parsed: null, error: { kind: "malformed_finding_item", ... } }`，由 repair loop 去让 LLM 纠正。
- 现有测试明确更新为"严格模式"版本，并在注释里解释理由（silent drop 等于静悄悄丢掉 reviewer 的 finding，风险大于让它纠错）。

### `runReview` — Format Repair Loop

```ts
export interface ReviewAttempt {
  attempt: number;                // fresh-spawn sequence index (0-based)
  phase: "initial" | "repair";    // 新增
  correctionRound: number;        // 新增：当前 fresh-spawn 内的 repair 轮次 (0 表示 initial)
  rawOutput: string;
  stderrOutput: string;
  exitCode: number;
  terminalResult: SubagentTerminalResult;
  parsed: ReviewResult | null;
  parseError: ParseError | null;  // 新增
}

export interface RunReviewInput {
  // ...原有字段
  maxRetries?: number;            // fresh-spawn 上限，默认 2
  maxCorrectionRounds?: number;   // 新增：每个 fresh-spawn 内的 repair 轮次上限，默认 1
  signal?: AbortSignal;           // 新增：支持取消
}
```

Pseudocode：

```ts
for attempt in 0..maxRetries:
  spawnResult = await spawn(...)
  if signal?.aborted: throw AbortError
  if spawnResult.terminalResult.terminalError:
    throw ReviewerCoreError("subprocess_failure", ...)

  { parsed, error } = parseReviewerOutput(spawnResult.outputText)
  if parsed: return { review: parsed, ... }

  // in-fresh-spawn format repair
  previousOutput = spawnResult.outputText
  previousError = error
  for round in 1..maxCorrectionRounds:
    repairResult = await spawn({
      task: buildRepairTask(previousOutput, previousError, systemPrompt),
      modelArg, extraArgs
    })
    if signal?.aborted: throw AbortError
    if repairResult.terminalResult.terminalError:
      throw ReviewerCoreError("subprocess_failure", ...)
    { parsed, error } = parseReviewerOutput(repairResult.outputText)
    if parsed: return { review: parsed, ... }
    previousOutput = repairResult.outputText
    previousError = error

  // 这个 fresh-spawn 的 repair 全部失败 → 落到 outer loop 再试 fresh spawn

throw ReviewerCoreError("parse_exhausted", ...)
```

### `ReviewerCoreError.kind` 不变

保持 `"subprocess_failure" | "parse_exhausted"` 两种。新的分类责任在 hook 层。

### `runPhaseDisciplineReviewerHook` — Differentiate Error Kinds

```ts
const infraFailures = failed.filter(
  f => f.error instanceof ReviewerCoreError && f.error.kind === "subprocess_failure"
);
const formatFailures = failed.filter(
  f => f.error instanceof ReviewerCoreError && f.error.kind === "parse_exhausted"
);

if (results.length > 0) {
  // 至少一个 reviewer 产出了 parseable verdict → 现有 merged 路径
}

// results.length === 0 时的分类决策：
//   - 有任何 subprocess_failure → reviewer_unavailable（基础设施问题优先）
//   - 全部为 parse_exhausted    → reviewer_format_invalid（新 blocked reason）
//   - 其它（fallback 全失败等）  → reviewer_unavailable（保守）
```

对应写出的 BLOCKED 文件命名不变，仍是 `<artifact>-BLOCKED.md`，但文件里 `Block Reason:` 行区分两种值：

- `reviewer_unavailable`
- `reviewer_format_invalid`

这样 operator 打开文件就知道是 provider 不行、还是 reviewer 输出无法解析。

### `rule-registry.ts` — Extend Blocked Reason Union

```ts
blockedHook: {
  hookName: string;
  triggerUnitType: string;
  triggerUnitId: string;
  reason:
    | "reviewer_unavailable"
    | "reviewer_format_invalid"   // 新增
    | "max_cycles_reached";
  artifactPath?: string;
  cycle: number;
  maxCycles: number;
} | null
```

`_handleHookCompletion` 内，读到 BLOCKED 哨兵后解析其中的 `Block Reason:` 行来决定 `reason` 字段。若文件存在但 `Block Reason:` 行缺失或不可识别，默认 `reviewer_unavailable`（保守）。

### `auto-post-unit.ts` — Differentiate Pause Message

```ts
const reasonLabel = {
  reviewer_unavailable: "reviewer subsystem unavailable (provider/network/timeout)",
  reviewer_format_invalid: "reviewer produced unparseable output after format repair",
  max_cycles_reached: `retry budget exhausted (cycle ${cycle}/${maxCycles})`,
}[blocker.reason];
```

对应的 `renderBlockedArtifact()` 里 Operator Action 段也按 reason 定制：

- `reviewer_unavailable`：验证 provider credentials/网络/baseURL
- `reviewer_format_invalid`：检查 reviewer 模型能否满足 YAML schema，或降级到更稳定的模型；与其它 failure 不同，**这个不是 provider 的问题**

### Timeout Cancellation（来自 review P2）

当前 `runPhaseDisciplineReviewerHook` 用 `Promise.race()` 做超时 reject，但**内部**子进程不会被 kill。format repair 增加了子进程数量，late artifact write 的风险更大。

修法：

1. `runReview` 新增 `signal?: AbortSignal` 参数。
2. `runPhaseDisciplineReviewerHook` 用 `AbortController`：timeout 到就 abort。
3. `runReview` 内部每次调 spawn 前检查 `signal.aborted`；用 `spawnGsdSubagentHandle()`（已有）而不是 `spawnGsdSubagent()`，在 abort 时调 `handle.cancel("SIGTERM")`。
4. 加一个测试：timeout 时不会写出 reviewer artifact / BLOCKED 文件。

### Observability Fields

`.phase-discipline/*.json` 日志里的 `reviewerMetrics[i]` 增加：

```ts
interface ReviewerAttemptMetrics {
  reviewer: string;
  status: "succeeded" | "failed" | "fallback_succeeded";
  error?: string;
  outputChars: number;
  attempts: number;                  // 仍是 fresh-spawn 数
  correctionRounds?: number;         // 新增：累计 repair 轮数
  formatRepairSucceeded?: boolean;   // 新增：最终 verdict 来自 initial / repair / fresh 重试
  parseErrorKind?: ParseError["kind"]; // 新增：最终 parseError 类型（若有）
  parseErrorMessage?: string;        // 新增
  wallClockMs?: number;
}
```

`writeReviewerRawLog` 为 initial / repair 两种 attempt 分别保存 stdout/stderr，文件名带 round 后缀（如 `<hook>-<unit>-reviewer0-initial-stdout.log` / `<hook>-<unit>-reviewer0-repair1-stdout.log`）。

---

## Invariants

1. `subprocess_failure → reviewer_unavailable → BLOCKED → pause auto`：保留。
2. 所有 reviewer 都是 `parse_exhausted`：**不**合成 verdict，**不**写 `retry_on`，走新的 `reviewer_format_invalid` blocked reason。
3. 混合情形（任一 `subprocess_failure` + 其他 `parse_exhausted`）：优先归为 `reviewer_unavailable`——provider 问题更严重，先暴露。
4. Format repair **不消耗** post-unit hook 的 `max_cycles`；该 budget 是 flow-level trigger 的 retry 次数。
5. Format repair **不写** `retry_on`——这是 reviewer 内部的事，对 auto loop 不可见。
6. Timeout abort 必须真正停掉子进程，不允许 late artifact write。
7. 至少一个 reviewer 产出 parseable verdict 时，走现有 merged 路径（不变）。

---

## Files to Modify

| File                                                                                             | Change                                                                                                                                |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| `src/resources/extensions/gsd/shared-harness/reviewer-core.ts`                                   | `parseReviewerOutput` 返回 `ParseResult` 带 diagnostics；`runReview` 加 format repair loop 与 `AbortSignal` 支持；`ReviewAttempt` 补字段 |
| `src/resources/extensions/gsd/phase-discipline/reviewer-hook.ts`                                 | `Promise.allSettled` 后区分 `parse_exhausted` / `subprocess_failure`；`renderBlockedArtifact` 写出新 `Block Reason`；timeout 走 AbortController |
| `src/resources/extensions/gsd/rule-registry.ts`                                                  | `blockedHook.reason` union 加 `reviewer_format_invalid`；`_handleHookCompletion` 解析 `Block Reason:` 行                               |
| `src/resources/extensions/gsd/auto-post-unit.ts`                                                 | pause 消息按 reason 定制；debug log 打印 reason                                                                                       |
| `src/resources/extensions/gsd/tests/shared-harness-reviewer-core.test.ts`                        | 删改 `drops malformed finding items` 测试；新增 parse diagnostics / repair loop / terminalError 不触发 repair / AbortSignal 测试       |
| `src/resources/extensions/gsd/phase-discipline/tests/reviewer-hook.test.ts`                      | 新增"all reviewers parse_exhausted 写 `reviewer_format_invalid` BLOCKED"；"一个 subprocess_failure + 其余 parse_exhausted → reviewer_unavailable"；"一个 parseable verdict + 其它 parse_exhausted → 用成功的 verdict" |
| `src/resources/extensions/gsd/phase-discipline/tests/reviewer-blocking.test.ts`                  | 新增"`reviewer_format_invalid` BLOCKED 也能被 registry surface，并在 auto-post-unit 层区分 pause message" 的断言                         |

---

## Required Test Coverage

### Parser diagnostics（`shared-harness-reviewer-core.test.ts`）

- empty output → `empty_output`
- invalid YAML syntax → `yaml_syntax_error`
- missing `overall_assessment` → `missing_assessment`
- invalid `overall_assessment` (`approved`) → `invalid_assessment_value`，`offendingValue = "approved"`
- `critical` 不是数组 → `invalid_finding_list`
- 有一个 malformed finding item → `malformed_finding_item`（**更新原 silent-drop 测试**）

### `runReview()` repair behavior

- initial invalid + repair valid → 返回 review，`attempts` 包含 2 条（initial + repair1），`correctionRound` = 1
- `terminalError` 在 initial 触发 → 不做 repair，直接 `subprocess_failure`
- `terminalError` 在 repair 触发 → `subprocess_failure`（关键不变量）
- repair 轮次耗尽 + fresh-spawn 也耗尽 → `parse_exhausted`，`attempts` 记录全部轮次
- `AbortSignal.aborted` 在 initial 之后触发 → 直接 reject（不再 spawn），且不 throw 泛 error（用一致的错误类型）

### `runPhaseDisciplineReviewerHook` behavior

- 一个 reviewer `parse_exhausted`、另一个成功 → 用成功的 verdict，不 BLOCKED
- 全部 reviewer `subprocess_failure` → `reviewer_unavailable` BLOCKED 文件（保留）
- 全部 reviewer `parse_exhausted` → `reviewer_format_invalid` BLOCKED 文件，不写 retry_on
- 混合（1 个 subprocess_failure + N 个 parse_exhausted）→ `reviewer_unavailable`（保守升级）
- timeout abort 不产生 reviewer artifact，也不写 BLOCKED 写到一半的状态

### Registry & auto loop

- `reviewer_format_invalid` BLOCKED 哨兵 surface via `isHookBlocked()`，`consumeBlockedHook().reason === "reviewer_format_invalid"`
- `auto-post-unit.ts` pause message 区分两种 reason
- `max_cycles_reached` 语义保持不变

### Observability

- `correctionRounds`、`parseErrorKind`、`formatRepairSucceeded` 字段写入 observability JSON
- 原始 repair stdout/stderr 被保存

---

## Out of Scope / Deferred

- **Phase 3: 真正的同进程 `continueSession`**：留给后续独立 plan。prerequisites 包括：CLI `-p --session` continuation 协议、output framing / turn delimiter、headless 下的 parent-timeout 协议、`subagent-spawn` / `subagent-terminal` 的 stdin 管线改造。该 phase 不在本 PR 范围。
- **Prompt-level self-verification（Approach A）**：可以作为一个小改动"顺便"做（在 system prompt 里加一句"请在提交前自检 YAML schema"），但它对本 PR 不是必须的，也不改变上述流程不变量。若 scope 允许，在 `reviewer-hook.ts` 的 `systemPrompt` 中追加一行即可。

---

## Context

This analysis originated from understanding the phase-discipline auto mode loop mechanism. Two distinct failure classes are currently conflated at the reviewer hook boundary:

- **Reviewer subsystem failure** (`reviewer_unavailable`): infrastructure issue—provider down, network timeout, credentials invalid. Correctly pauses auto for operator intervention.
- **Format parse failure** (`parse_exhausted`): LLM output doesn't conform to YAML schema. Incorrectly pauses auto with a misleading message.

Codex review rejected two earlier proposals:

1. Synthesizing an `issues` verdict from unparseable output (unsafe—weakens review gate silently).
2. Implementing real same-process `continueSession` in this PR (scope too large, would spread into CLI/RPC/headless protocol).

This revised plan adopts the middle ground: a **reviewer-local format repair loop** that re-spawns with previous output + parse error feedback, combined with a new **`reviewer_format_invalid`** blocked reason to surface format problems distinctly from infrastructure problems.
