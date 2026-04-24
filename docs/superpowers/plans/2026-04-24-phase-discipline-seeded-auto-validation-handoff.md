# Phase-Discipline seeded-auto 真实验证续接 handoff

- **日期**：2026-04-24
- **目标分支**：`feat/phase-discipline-preset-v1`
- **本轮唯一主线**：继续 phase-discipline seeded milestone 的真实 auto-mode 验证；不要回头重开 `headless new-milestone --auto` false-success 主线。

---

## 0. 一句话结论

**手工 seed 的 milestone 已被 runtime 正确识别；`headless auto` 也已真实进入 `phase-discipline` runtime。本轮首个真实 blocker 不在 seed/读取链路，而在 `research-slice` 的 `phase-discipline-scout-fanout`：`constraints_risks` scout 用 `openai/gpt-5.4` 失败并导致 pause。**

---

## 1. 新会话不要重复劳动的已知事实

### A. `new-milestone --auto` false-success 已关闭

这一条已经被真实复验关闭：

- provider 失败时：
  - `message_end.stopReason = error`
  - `turn_end.stopReason = error`
  - `execution_complete.status = error`
  - headless summary = `Status: error`
  - exit code = `1`
- 不再出现之前的 `Status: complete` / exit `0` 假成功

对应文档：

- `docs/superpowers/plans/2026-04-24-phase-discipline-auto-mode-validation-findings.md` §5

### B. 手工 seed milestone 已成功被 runtime 识别

隔离 repo：

- `/Users/sheng/tencent/gsd-phase-discipline-auto-56G8jS`

已写入的最小结构：

- `.gsd/milestones/M001/M001-ROADMAP.md`
- `.gsd/milestones/M001/M001-CONTEXT.md`
- `.gsd/milestones/M001/slices/S01/S01-PLAN.md`

实际偏好文件（当前 runtime 会读取它）：

- `.gsd/PREFERENCES.md`

其内容应保持：

```md
---
version: 1
milestone_profile: phase-discipline-8step
verify_fuse_on_fail: true
---
```

seed 后的 `headless query` 已明确证明 milestone 被识别：

```json
{"state":{"activeMilestone":{"id":"M001","title":"Docs-only validation milestone"},"activeSlice":{"id":"S01","title":"Add one validation note to docs"},"activeTask":{"id":"T01","title":"Add a concise validation note"},"phase":"executing","recentDecisions":[],"blockers":[],"nextAction":"Execute T01: Add a concise validation note in slice S01.","registry":[{"id":"M001","title":"Docs-only validation milestone","status":"active"}],"requirements":{"active":0,"validated":0,"deferred":0,"outOfScope":0,"blocked":0,"total":0},"progress":{"milestones":{"done":0,"total":1},"slices":{"done":0,"total":1},"tasks":{"done":0,"total":1}}},"next":{"action":"dispatch","unitType":"plan-slice","unitId":"M001/S01"},"cost":{"workers":[],"total":0}}
```

因此：

- **不是** milestone seed 不满足 runtime 读取约束
- **不是** `.gsd/PREFERENCES.md` 未生效
- **不是** 仍停留在 `No milestones found`

### C. `headless auto` 已真实进入 phase-discipline runtime

本轮真实运行的关键输出：

```text
[gsd]     Resuming paused session for M001.
[gsd]     Auto-mode resumed.
[gsd]     Pre-dispatch hooks: phase-discipline-profile-dispatch, phase-discipline-scout-fanout
[gsd]     Scout fan-out failed for research-slice M001/S01: Scout constraints_risks failed | provider=openai | model=gpt-5.4 | Unknown error
[gsd]     Auto-mode paused (Escape). Type to interact, or /gsd auto to resume.
```

这说明：

1. `auto` 已恢复 `M001` 的 paused session。
2. `phase-discipline-profile-dispatch` 与 `phase-discipline-scout-fanout` 都已实际执行。
3. 首个真实 blocker 已进入 **phase-discipline runtime 本体**。

### D. 当前真实 blocker 的归类

当前首个真实 blocker 应归类为：

- **位置**：`research-slice / phase-discipline-scout-fanout`
- **具体 scout**：`constraints_risks`
- **类型**：外部 provider 失败
- **provider/model**：`openai/gpt-5.4`
- **当前表面错误**：`Unknown error`

注意表述要精确：

- **不是**“外层 `auto` 根本没启动就因为缺 API key 被拦住”。
- **而是**：runtime 已启动，并在 **runtime 内部的 scout 子调用** 上失败。

### E. 续验后的落盘状态

当前项目外部状态目录（实际 runtime state）位于：

- `~/.gsd/projects/0dfdd86ee7af/`

关键证据：

- `~/.gsd/projects/0dfdd86ee7af/runtime/paused-session.json`
  - 记录 `milestoneId = M001`
- `~/.gsd/projects/0dfdd86ee7af/runtime/units/plan-slice-M001-S01.json`
  - 当前 unit 仍是 `plan-slice / M001/S01`
  - `phase = dispatched`
- `~/.gsd/projects/0dfdd86ee7af/STATE.md`
  - 当前显示：
    - `Phase: planning`
    - `Next Action: Task plan files missing for S01. Run plan-slice to generate task plans.`
- `~/.gsd/projects/0dfdd86ee7af/milestones/M001/slices/S01/.phase-discipline/`
  - 仍为空
- `~/.gsd/projects/0dfdd86ee7af/milestones/M001/slices/S01/tasks/`
  - 仍为空

这表明：

- canonical research artifact 尚未成功写出
- task plan 尚未生成
- 当前失败点就在 `research-slice` scout fan-out 之前/之中

### F. 当前不应误判的点

- 不要把这次失败重新归因到 `headless new-milestone --auto` false-success。
- 不要把这次失败误判成“seed milestone 仍不被识别”。
- `headless query` 中的这条 warning：

```text
[gsd:dispatch] WARN: registry dispatch failed, falling back to inline rules: RuleRegistry not initialized — call initRegistry() or setRegistry() first.
```

  当前看是次要噪音，不是首个真实 blocker，因为 runtime 仍已成功执行到 `phase-discipline-scout-fanout`。

---

## 2. 新会话主目标

### 第一优先级

确认并解除 `openai/gpt-5.4` 的 provider 阻塞，然后在**不改 runtime 主实现**的前提下重跑：

- `headless auto`

目标是回答：

- `constraints_risks` scout 一旦 provider 通路恢复，能否通过？
- 是否能写出 `S01/.phase-discipline/` observability / raw logs？
- 是否能继续推进到 task plan 生成、admission、review 或 execute-task？

### 第二优先级

如果 provider 通路恢复后仍失败，才进一步判断：

- 是 scout harness / subagent 配置问题
- 还是 phase-discipline runtime 内部 bug

---

## 3. 开始前先读这些文件（按顺序）

1. `docs/superpowers/plans/2026-04-24-phase-discipline-auto-mode-validation-findings.md`
2. `docs/superpowers/plans/2026-04-24-phase-discipline-seeded-auto-validation-handoff.md`
3. `src/resources/extensions/gsd/phase-discipline/README.md`
4. `src/resources/extensions/gsd/preferences.ts`
5. `src/resources/extensions/gsd/paths.ts`
6. `src/resources/extensions/gsd/state.ts`
7. 如需追 `research-slice` / scout fan-out：
   - `src/resources/extensions/gsd/phase-discipline/scout-fanout.ts`
   - `src/resources/extensions/gsd/shared-harness/subagent-spawn.ts`
   - `src/resources/extensions/gsd/shared-harness/reviewer-core.ts`
   - `src/resources/extensions/gsd/auto/phases.ts`

---

## 4. 推荐执行顺序

### Step 1 — 先确认当前状态

在隔离 repo 下执行：

```bash
node /Users/sheng/tencent/gsd-2/dist/loader.js headless query
```

预期：

- 仍能看到 `M001 / S01`
- 当前 `next.unitType` 应指向 `research-slice`

### Step 2 — 先确认 provider 条件

本轮最该确认的是 `openai/gpt-5.4` 是否真的可请求。

如果当前会话/环境没有 OpenAI key、token 或额度，这一步很可能就是首 blocker。

不要在 provider 仍不可用时，贸然开始改 `phase-discipline/*` 实现。

### Step 3 — 在同一隔离 repo 重跑 `headless auto`

文本模式：

```bash
node /Users/sheng/tencent/gsd-2/dist/loader.js \
  headless --verbose --timeout 900000 --max-restarts 0 \
  auto
```

如需事件流：

```bash
node /Users/sheng/tencent/gsd-2/dist/loader.js \
  headless --output-format stream-json --timeout 900000 --max-restarts 0 \
  auto
```

### Step 4 — 收集证据

重点收集：

- 是否仍然失败在 `constraints_risks`
- 是否仍然是 `provider=openai | model=gpt-5.4`
- 是否出现更具体的 provider 文案（401 / rate limit / quota / not logged in 等）
- 是否写出了：
  - `S01/.phase-discipline/*`
  - raw logs / observability json
  - task plans

---

## 5. 分支判断

### 分支 A：provider 通路恢复后，`constraints_risks` 通过

说明当前 blocker 主要是 provider 外部条件。

此时应继续记录下一真实 phase：

- admission
- design/code review
- plan-slice / impl-plan validation
- execute-task
- validate-milestone / verify-fuse

### 分支 B：provider 仍失败

如果仍表现为：

- `provider=openai | model=gpt-5.4`
- 错误仍来自 scout fan-out 子调用

那么当前 blocker 仍归类为：

- **已进入 runtime**
- **但卡在 runtime 内部的外部 provider 依赖**

不要回头重开 false-success 主线。

### 分支 C：provider 通了，但 scout 仍以非 provider 原因失败

这时才值得进一步检查：

- `scout-fanout.ts`
- `shared-harness/subagent-spawn.ts`
- 相关 raw logs / observability

才可能开始怀疑 phase-discipline runtime 或 harness 本身。

---

## 6. 非目标 / 不要做的事

- **不要**回头重开 `headless new-milestone --auto` false-success 主线
- **不要**因为当前 `Unknown error` 就直接扩成 provider 文案优化主线
- **不要**还没拿到 provider 可用证据就先改 `phase-discipline/*` 主实现
- **不要**先修 `scripts/dev-cli.js`
- **不要**发散到 composed-lite 或其它并行主线

---

## 7. 新会话最低交付物

1. 证明 `M001` seed milestone 仍被 runtime 识别
2. 一次新的真实 `headless auto` 结果
3. 明确 `constraints_risks` scout 当前是否仍是首 blocker
4. 若 provider 通路恢复，记录新的下一阶段 blocker
5. 更新 findings 文档

---

## 8. 建议更新的文档位置

优先继续追加到：

- `docs/superpowers/plans/2026-04-24-phase-discipline-auto-mode-validation-findings.md`

---

## 9. 2026-04-24 续接补充（provider 诊断链路）

### A. 本轮续接新增结论

本轮在 **不重开 `new-milestone` 主线**、也**不先改 `phase-discipline/*` runtime 主实现** 的前提下，已把当前 blocker 收敛到 **OpenAI provider 路径**，而不是 `phase-discipline-scout-fanout` 业务逻辑本身。

新增已验证事实：

1. 在隔离 repo 再次执行：

```bash
node /Users/sheng/tencent/gsd-2/dist/loader.js headless query
```

确认当前仍是：

- `M001 / S01`
- `next.unitType = research-slice`

2. 最新 slice 证据目录实际已写出：

- `/Users/sheng/tencent/gsd-phase-discipline-auto-56G8jS/.gsd/milestones/M001/slices/S01/.phase-discipline/`

其中最新 observability 文件：

- `phase-discipline-scout-fanout-M001-S01.json`

记录为：

- `codebase_scan = succeeded`
- `constraints_risks = succeeded`
- `prior_art = failed`
- 失败文本：`Scout prior_art failed | provider=openai | model=gpt-5.4 | Unknown error`

3. `prior_art` raw log 证明失败不是 fan-out 外层包装出来的假象，而是子 agent 自身立即报错：

- 文件：
  - `.../phase-discipline-scout-fanout-M001-S01-scout-prior_art-stdout.log`
- 形态：
  - assistant `message_start` 已出现
  - provider/model = `openai / gpt-5.4`
  - 0 tokens / 0 toolResults / 0 output
  - 紧接着 `message_end.stopReason = error`
  - `errorMessage = "Unknown error"`

4. 已做一个**脱离 runtime 的独立复现**：

在隔离 repo 直接运行与 scout 等价的命令：

```bash
node /Users/sheng/tencent/gsd-2/dist/loader.js --mode json -p --no-session --model openai/gpt-5.4 --append-system-prompt "You are a runtime-owned phase-discipline scout subagent.
Ignore generic startup instructions that tell you to discover, read, or invoke skills before doing the task.
Do not inspect .agents, ~/.agents, or any user-global agent or skill directories unless the task explicitly names those paths.
Do not perform general skill discovery.
Focus on repository files under the current working directory and directly relevant runtime artifacts only." --tools read,grep,find,ls,bash "Task: Prior Art: Search for existing code patterns, similar implementations, or prior art in the repository that relates to the requirement. Sample at most 6 targeted matches or files. Prefer repository-local implementations and reusable components. Prefer code and executable configuration over docs, changelogs, and prompt text. Do not inspect user-global agent or skill directories.

Milestone: M001
Slice: S01 — Add one validation note to docs"
```

结果同样是：

- assistant start 后立刻 `stopReason = error`
- `errorMessage = "Unknown error"`

因此可排除：

- `phase-discipline-scout-fanout` 主逻辑 bug
- `subagent-spawn` 外层包装误报
- `subagent-terminal` 解析层吞错

### B. 代码链路根因

本轮只读定位的关键源码结论：

- `src/resources/extensions/gsd/shared-harness/subagent-terminal.ts`
  - 只是从最后一条 assistant message 透传 `errorMessage`
- `src/resources/extensions/gsd/shared-harness/subagent-spawn.ts`
  - 只是把 terminal result 再包装成 `terminalError`
- 真正吞掉 provider 细节的是：
  - `packages/pi-ai/src/providers/openai-responses-shared.ts`

原先逻辑为：

```ts
} else if (event.type === "response.failed") {
  throw new Error("Unknown error");
}
```

这意味着只要 OpenAI Responses 流返回 `response.failed`，无论 provider 给出什么真实失败原因，最终都会退化成统一的 `Unknown error`。

另外当前用户级 provider 映射仍是：

- `~/.gsd/agent/models.json`
  - `openai.baseUrl = https://api.sandboxai.top/v1`

所以当前最合理归类是：

- **外部 OpenAI-compatible provider 路径产生了 `response.failed`**
- **本地 provider 适配层把真实错误细节压平了**

### C. 本轮已落地的最小修复

已做的代码改动只有 provider 诊断层，**没有改 phase-discipline runtime 主实现**：

- 修改：
  - `packages/pi-ai/src/providers/openai-responses-shared.ts`
- 新增 helper：
  - `formatResponseFailedError(event)`
- 新行为：
  - `response.failed` 时优先透出 `response.error.message`
  - 同时带上 `type/code`
  - 若仍无细节，则 fallback 到 `JSON.stringify(event)`

新增 focused test：

- `packages/pi-ai/src/providers/openai-responses-shared.test.ts`

测试锁定：

- `response.failed` 不再退化成 generic `Unknown error`
- 会透出类似：
  - `server_error rate_limit_exceeded: Rate limit exceeded. Please try again later.`

### D. 本轮已完成验证

已通过：

```bash
node --import ./src/resources/extensions/gsd/tests/resolve-ts.mjs --experimental-strip-types --test packages/pi-ai/src/providers/openai-responses-shared.test.ts
npx tsc --noEmit --project tsconfig.json
npm run build -w @gsd/pi-ai
```

### E. 当前未完成项

本轮准备继续执行一次新的真实外部复验：

- 先复跑独立 `prior_art` scout
- 再复跑 `headless auto`

但这一步需要实际发起 provider 请求；在执行该命令时，本轮命令被取消，因此：

- **不要把“修复后真实 provider 已通过”误写成已验证事实**
- 当前只可确认：**诊断丢失问题已修，真实外部复验尚未完成**

### F. 下一会话最直接的起跑动作

1. 先在隔离 repo 重跑独立 `prior_art` scout：

```bash
node /Users/sheng/tencent/gsd-2/dist/loader.js --mode json -p --no-session --model openai/gpt-5.4 --append-system-prompt "You are a runtime-owned phase-discipline scout subagent.
Ignore generic startup instructions that tell you to discover, read, or invoke skills before doing the task.
Do not inspect .agents, ~/.agents, or any user-global agent or skill directories unless the task explicitly names those paths.
Do not perform general skill discovery.
Focus on repository files under the current working directory and directly relevant runtime artifacts only." --tools read,grep,find,ls,bash "Task: Prior Art: Search for existing code patterns, similar implementations, or prior art in the repository that relates to the requirement. Sample at most 6 targeted matches or files. Prefer repository-local implementations and reusable components. Prefer code and executable configuration over docs, changelogs, and prompt text. Do not inspect user-global agent or skill directories.

Milestone: M001
Slice: S01 — Add one validation note to docs"
```

目标：确认现在 surfaced 的**真实 provider 错误文案**是什么。

2. 如果独立 scout 仍失败，但错误已具体化，再在同一隔离 repo 重跑：

```bash
node /Users/sheng/tencent/gsd-2/dist/loader.js \
  headless --verbose --timeout 900000 --max-restarts 0 \
  auto
```

3. 收集并追加到 findings：

- 是否仍失败在 `prior_art` 或 `constraints_risks`
- 新的真实 provider 文案
- 是否写出新的 `.phase-discipline/*` 证据
- 是否能继续推进到 task plan / admission / reviewer / execute-task

### G. 明确不要重试的路径

- 不要回头重开 `headless new-milestone --auto` 主线
- 不要在没有新 provider 证据前，继续怀疑 `phase-discipline-scout-fanout` 主逻辑
- 不要把当前问题扩大成单独的“provider 文案优化项目”
- 当前最高价值动作就是：**用已落地的最小 provider 诊断修复，拿到下一次真实复验的具体错误细节**

---

## 9. 给下一会话 agent 的一句话总结

**seed milestone 已被 runtime 正确识别，`headless auto` 也已真实进入 phase-discipline runtime；当前 blocker 已进一步收敛到 `research-slice` 的 scout 子调用在 `openai/gpt-5.4` provider 路径返回 `response.failed`，但此前被 `openai-responses-shared.ts` 压成了 `Unknown error`。本轮已落地最小 provider 诊断修复并通过 focused test + typecheck + `@gsd/pi-ai` build；下一会话应先复跑独立 `prior_art` scout 拿到真实 provider 文案，再重跑同一隔离 repo 的 `headless auto`，而不是回头重开 false-success 或提前改 phase-discipline runtime 主实现。**
