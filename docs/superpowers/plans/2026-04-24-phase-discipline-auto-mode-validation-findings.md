# Phase-Discipline v1.1-v1.4 后续执行结果 — B 修复 + 真实 auto-mode 验证 findings

- **日期**：2026-04-24
- **分支**：`feat/phase-discipline-preset-v1`
- **对应 handoff**：`docs/superpowers/plans/2026-04-24-post-review-fix-and-auto-mode-validation-handoff.md`

---

## 1. 阶段 B 已完成

### B1 — `workflow-tools.test.ts` 的 3 条 DB adapter null

处理方式：

- 仅改测试，不改生产代码。
- 将 3 条测试从“handler 返回后直接假设 `_getAdapter()` 仍然保持打开”改为“测试自己 `openDatabase(join(base, ".gsd", "gsd.db"))` 后再校验持久化结果”。
- 保留 DB 级验证强度，但不再把 adapter 生命周期当成 MCP handler 契约的一部分。

涉及文件：

- `packages/mcp-server/src/workflow-tools.test.ts`

### B2 — `pre-dispatch-fanout.test.ts` 的 6 个 implicit-any

处理方式：

- 仅补显式类型，不改运行时逻辑。

涉及文件：

- `src/resources/extensions/gsd/tests/pre-dispatch-fanout.test.ts`

### B 阶段验证

执行命令：

```bash
node --import ./src/resources/extensions/gsd/tests/resolve-ts.mjs \
  --experimental-strip-types --test \
  packages/mcp-server/src/workflow-tools.test.ts

npx tsc --noEmit --project tsconfig.extensions.json
```

结果：

- `workflow-tools.test.ts`：`27/27 pass`
- `tsconfig.extensions.json`：`0 error`

### B 阶段独立 commit

- `e9fb3bb9c` — `fix(tests): resolve pre-existing workflow-tools DB adapter null + pre-dispatch-fanout implicit-any`

---

## 2. 阶段 C 真实 auto-mode 验证

### 2.1 验证环境

使用隔离 repo：

- `/Users/sheng/tencent/gsd-phase-discipline-auto-56G8jS`

初始内容：

- `README.md`
- `docs/notes.md`
- `spec.md`（docs-only 最小 milestone）
- `.gitignore`

偏好文件：

- `.gsd/preferences.yaml`
- `.gsd/PREFERENCES.md`

备注：当前实现实际读取的是 `PREFERENCES.md` / `preferences.md`，不是 `.gsd/preferences.yaml`。运行时代码证据见：

- `src/resources/extensions/gsd/preferences.ts:149-184`

因此本次验证同时写了两份文件：

- `.gsd/preferences.yaml`：保留 handoff 文本所述写法
- `.gsd/PREFERENCES.md`：确保当前实现实际生效

### 2.2 尝试一：`scripts/dev-cli.js` 作为入口

命令：

```bash
node /Users/sheng/tencent/gsd-2/scripts/dev-cli.js \
  headless --verbose --timeout 900000 --max-restarts 0 \
  new-milestone --context spec.md --auto
```

结果：失败，未进入 milestone 创建。

关键错误：

```text
Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/Users/sheng/tencent/gsd-2/src/app-paths.js' imported from /Users/sheng/tencent/gsd-2/src/loader.ts
```

结论：

- 这是 **launcher / dev 入口问题**，不是 phase-discipline runtime 本身的行为证据。
- 按 handoff §2.5 的约束，本轮未修改 runtime / launcher 主路径，只转向现成构建产物 `dist/loader.js` 继续验证。

### 2.3 尝试二：`dist/loader.js` 作为入口

命令：

```bash
node /Users/sheng/tencent/gsd-2/dist/loader.js \
  headless --verbose --timeout 900000 --max-restarts 0 \
  new-milestone --context spec.md --auto
```

表面结果：

```text
[headless] Running /gsd new-milestone...
[agent]   Session started
[headless] Status: complete
[headless] Duration: 2.1s
[headless] Events: 17 total, 0 tool calls
Exit code: 0
```

但实际落盘状态：

- `.gsd/milestones/` 为空
- `headless query` 返回：`No milestones found. Run /gsd to create one.`
- `.gitignore` 被自动扩写了一组 baseline ignore 规则

`headless query` 输出：

```json
{"state":{"activeMilestone":null,"activeSlice":null,"activeTask":null,"phase":"pre-planning","recentDecisions":[],"blockers":[],"nextAction":"No milestones found. Run /gsd to create one.","registry":[],"requirements":{"active":0,"validated":0,"deferred":0,"outOfScope":0,"blocked":0,"total":0},"progress":{"milestones":{"done":0,"total":0}}},"next":{"action":"stop","reason":"No milestones found. Run /gsd to create one."},"cost":{"workers":[],"total":0}}
```

### 2.4 原始事件流证据

进一步执行：

```bash
node /Users/sheng/tencent/gsd-2/dist/loader.js \
  headless --output-format stream-json --timeout 900000 --max-restarts 0 \
  new-milestone --context spec.md --auto
```

关键事件：

```json
{"type":"message_end","message":{"role":"assistant","content":[],"api":"openai-responses","provider":"openai","model":"gpt-5.4","usage":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"totalTokens":0,"cost":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"total":0}},"stopReason":"error","timestamp":1777017186551,"errorMessage":"Rate limit exceeded. Please try again later. | status=failed"},"runId":"5f0b9a54-a1ce-4694-93be-7b4f41a19fbb"}

{"type":"turn_end","message":{"role":"assistant","content":[],"api":"openai-responses","provider":"openai","model":"gpt-5.4","usage":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"totalTokens":0,"cost":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"total":0}},"stopReason":"error","timestamp":1777017186551,"errorMessage":"Rate limit exceeded. Please try again later. | status=failed"},"toolResults":[],"runId":"5f0b9a54-a1ce-4694-93be-7b4f41a19fbb"}

{"type":"execution_complete","runId":"5f0b9a54-a1ce-4694-93be-7b4f41a19fbb","status":"completed","stats":{"sessionFile":"/Users/sheng/.gsd/agent/sessions/--Users-sheng-tencent-gsd-phase-discipline-auto-56G8jS--/2026-04-24T07-53-05-730Z_713379d6-dd99-4f9c-a474-74c5d9dab75f.jsonl","sessionId":"713379d6-dd99-4f9c-a474-74c5d9dab75f","userMessages":0,"assistantMessages":1,"toolCalls":0,"toolResults":0,"totalMessages":2,"tokens":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"total":0},"cost":0}}
```

对应 session 文件：

- `/Users/sheng/.gsd/agent/sessions/--Users-sheng-tencent-gsd-phase-discipline-auto-56G8jS--/2026-04-24T07-53-05-730Z_713379d6-dd99-4f9c-a474-74c5d9dab75f.jsonl`

该 session 原文第 5 行同样记录：

```json
{"type":"message","id":"ea7a8f21","parentId":"d5100e3c","timestamp":"2026-04-24T07:53:07.626Z","message":{"role":"assistant","content":[],"api":"openai-responses","provider":"openai","model":"gpt-5.4","usage":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"totalTokens":0,"cost":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"total":0}},"stopReason":"error","timestamp":1777017186551,"errorMessage":"Rate limit exceeded. Please try again later. | status=failed"}}
```

### 2.5 C 阶段结论

本轮 **没有进入 8-phase phase-discipline runtime**。阻塞点更靠前，且证据非常明确：

1. `dev-cli` 开发入口存在 ESM 解析问题，无法完成 headless 启动。
2. 改用 `dist/loader.js` 后，请求真实打到了 provider，但 provider 返回：
   - `Rate limit exceeded. Please try again later. | status=failed`
3. 尽管底层 turn 明确失败，headless/new-milestone 这条链路仍然：
   - 产出 `Status: complete`
   - exit code `0`
   - 没有 `Milestone ready` 信号
   - 没有 `.gsd/milestones/*` 落盘

这说明当前更高优先级的问题不是 phase-discipline 8-phase 本身，而是：

- **`new-milestone` 失败信号没有正确映射到 headless 退出状态 / 阻塞状态**
- 在 provider 失败时出现了 **false-success / 假成功**

如果下一轮要继续追，最高价值的最小复现应聚焦：

- `headless new-milestone --context ... --auto` 在底层 `message_end.stopReason=error` / `turn_end.errorMessage` 时，为什么仍然 `execution_complete.status=completed` 且最终 headless exit `0`
- `isMilestoneReadyNotification` / `blocked` / `mapStatusToExitCode` 这一整条链是否漏接了 provider error 场景

---

## 3. 当前建议

- **不要**基于本次结果去修改 phase-discipline v1.2/v1.3/v1.4 实现代码；这次还没跑到那里。
- 如果要继续 C 阶段，建议先把 `headless new-milestone` 的 false-success 行为做成一个最小回归测试，再决定是否修 CLI/headless 层。
- 如果只是为了继续 phase-discipline 验证，可以在 provider/配额稳定后，优先绕过 `new-milestone`，手工 seed 一个最小 milestone，再直接跑 `/gsd auto M###`，这样更聚焦 phase-discipline 本身。

---

## 4. False-success 根因定位 + 最小修复（本次续接）

### 4.1 根因

这次续接确认：**false-success 的源头不在 phase-discipline，也不在 `new-milestone` workflow 本身，而在 RPC v2 completion 语义。**

关键代码路径：

- `packages/pi-coding-agent/src/modes/rpc/rpc-mode.ts`
- `src/headless.ts`

具体表现：

1. 底层 provider 失败时，session / `message_end` / `turn_end` 已经明确携带：
   - `stopReason: "error"`
   - `errorMessage: "Rate limit exceeded... | status=failed"`
2. 但 RPC v2 在 `agent_end` 时会**无条件**合成：

   ```json
   {"type":"execution_complete","status":"completed"}
   ```

3. `src/headless.ts` 对单轮命令（包括 `new-milestone`）默认**信任 `execution_complete.status`**，因此把本次执行判成成功并退出 `0`。

换句话说，之前的错误链路是：

- `message_end/turn_end = error`
- `execution_complete = completed`（错误合成）
- `headless => Status: complete / exit 0`

### 4.2 最小修复

本次仅修改 headless / RPC completion 相关层，**没有修改 phase-discipline v1.2/v1.3/v1.4 runtime 逻辑**。

涉及文件：

- `packages/pi-coding-agent/src/modes/rpc/rpc-mode.ts`
  - 新增 `deriveExecutionCompleteEvent()`
  - `agent_end` 合成 `execution_complete` 时，改为继承最后一个 assistant message 的 `stopReason`
  - `error -> status: "error"`
  - `aborted -> status: "cancelled"`
  - 正常完成才保留 `status: "completed"`
- `src/headless-events.ts`
  - 新增 `resolveHeadlessTextStatus()`
  - 新增 `resolveHeadlessJsonStatus()`
- `src/headless.ts`
  - summary / batch-json 状态改为使用显式 `timedOut` 布尔值区分 `error` 与 `timeout`
  - 不再通过 `totalEvents > 0` 这类启发式把真实 provider error 混成 timeout

### 4.3 回归测试

新增/更新的回归覆盖：

- `packages/pi-coding-agent/src/modes/rpc/rpc-protocol-v2.test.ts`
  - 锁定 `deriveExecutionCompleteEvent()` 对 `error` / `aborted` / 正常完成的派生语义
- `src/tests/headless-events.test.ts`
  - 锁定 headless `error` 与 `timeout` 的显式区分

### 4.4 验证结果

已通过：

```bash
node --import ./src/resources/extensions/gsd/tests/resolve-ts.mjs \
  --experimental-strip-types --test \
  src/tests/headless-events.test.ts \
  src/tests/headless-cli-surface.test.ts \
  packages/pi-coding-agent/src/modes/rpc/rpc-protocol-v2.test.ts

npx tsc --noEmit --project tsconfig.json
```

结果：

- `129/129 pass`
- `tsconfig.json`：通过

另外已执行：

```bash
npm run build && \
node --import ./src/resources/extensions/gsd/tests/resolve-ts.mjs \
  --experimental-strip-types --test \
  src/tests/integration/e2e-headless.test.ts
```

结果：

- `e2e-headless.test.ts`：`5/5 pass`
- 构建完成，`dist/loader.js` 已包含本次修复

### 4.5 备注

- `npm run build` 过程中 `next build` 仍出现 `better-sqlite3` 的 web-side warning，但**本次 headless false-success 修复与验证不依赖该 warning 的处理**，且整体 build 与 `e2e-headless` 最终均通过。

### 4.6 下一步建议

现在**可以建议继续下一次真实 auto-mode / headless 验证**，因为本轮最关键的“provider 失败却假成功”问题已经在源头 completion 语义上修正。

建议最小复现/复核命令仍保持你上一轮的真实路径：

```bash
node /Users/sheng/tencent/gsd-2/dist/loader.js \
  headless --verbose --timeout 900000 --max-restarts 0 \
  new-milestone --context spec.md --auto
```

预期：

- 若 provider 再次失败，应返回 `Status: error`（而不是 `complete`）
- exit code 应为 `1`
- 不应再出现“无 milestone 落盘但 headless exit 0”的 false-success

---

## 5. 2026-04-24 修复后真实复验（`dist/loader.js`）

### 5.1 复验环境

沿用隔离 repo：

- `/Users/sheng/tencent/gsd-phase-discipline-auto-56G8jS`

入口：

- `/Users/sheng/tencent/gsd-2/dist/loader.js`

上下文：

- `spec.md`

### 5.2 文本模式复验

执行命令：

```bash
node /Users/sheng/tencent/gsd-2/dist/loader.js \
  headless --verbose --timeout 900000 --max-restarts 0 \
  new-milestone --context spec.md --auto
```

结果：

- 进程 exit code：`1`
- headless summary：`Status: error`
- `.gsd/milestones/` 仍无 milestone 落盘

关键 stderr 证据：

```text
[headless] Running /gsd new-milestone...
[agent]   Session started
[headless] Status: error
[headless] Duration: 1.9s
[headless] Events: 17 total, 0 tool calls
[headless] Last events:
  message_start
  cost_update
  message_end
  turn_end
  execution_complete
```

### 5.3 `stream-json` 复验

执行命令：

```bash
node /Users/sheng/tencent/gsd-2/dist/loader.js \
  headless --output-format stream-json --timeout 900000 --max-restarts 0 \
  new-milestone --context spec.md --auto
```

结果：

- 进程 exit code：`1`
- stderr summary：`Status: error`
- `headless query` 仍返回 `No milestones found. Run /gsd to create one.`

关键事件：

```json
{"type":"message_end","message":{"role":"assistant","content":[],"api":"openai-responses","provider":"openai","model":"gpt-5.4","usage":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"totalTokens":0,"cost":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"total":0}},"stopReason":"error","timestamp":1777018319271,"errorMessage":"Unknown error"},"runId":"e05f654e-1855-4a8f-9bfd-ae1d7b065d18"}

{"type":"turn_end","message":{"role":"assistant","content":[],"api":"openai-responses","provider":"openai","model":"gpt-5.4","usage":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"totalTokens":0,"cost":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"total":0}},"stopReason":"error","timestamp":1777018319271,"errorMessage":"Unknown error"},"toolResults":[],"runId":"e05f654e-1855-4a8f-9bfd-ae1d7b065d18"}

{"type":"execution_complete","runId":"e05f654e-1855-4a8f-9bfd-ae1d7b065d18","status":"error","reason":"Unknown error","stats":{"sessionFile":"/Users/sheng/.gsd/agent/sessions/--Users-sheng-tencent-gsd-phase-discipline-auto-56G8jS--/2026-04-24T08-11-58-496Z_39c538f1-9da6-43b2-92e3-d9ea8b6db9ca.jsonl","sessionId":"39c538f1-9da6-43b2-92e3-d9ea8b6db9ca","userMessages":0,"assistantMessages":1,"toolCalls":0,"toolResults":0,"totalMessages":2,"tokens":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"total":0},"cost":0}}
```

### 5.4 结论

这次真实复验说明：

- **之前的 false-success 已消失**
- 当底层 provider 失败时：
  - `message_end.stopReason = error`
  - `turn_end.stopReason = error`
  - `execution_complete.status = error`
  - headless 最终表现为：
    - `Status: error`
    - exit code `1`
- 不再出现“底层失败但 headless 显示 complete / exit 0”的假成功

因此，本轮最高优先级 blocker（`headless new-milestone --auto` 的 false-success）可以视为**已被真实复验坐实修复**。

### 5.5 新的边界观察

- 本次 provider 失败表面文案是 `Unknown error`，不如之前的 `Rate limit exceeded ... | status=failed` 具体。
- 但这已经**不再影响 headless 状态映射正确性**；它属于后续若需要再单独追的 provider 错误细节问题，不应抢占当前 phase-discipline 验证主线。

### 5.6 下一步建议

既然 false-success 已经消失，下一步建议改为：

- 继续做真实 phase-discipline 验证；或
- 若想更聚焦 phase-discipline runtime，优先手工 seed 一个最小 milestone，再直接跑 `/gsd auto`

优先建议后者，因为它可以绕过当前 `new-milestone` 前置创建路径，把验证重点放回 phase-discipline 本身。

---

## 6. 2026-04-24 手工 seed milestone 后的真实 `headless auto` 续验

### 6.1 seed 前后状态

继续使用隔离 repo：

- `/Users/sheng/tencent/gsd-phase-discipline-auto-56G8jS`

手工写入最小 milestone：

- `.gsd/milestones/M001/M001-ROADMAP.md`
- `.gsd/milestones/M001/M001-CONTEXT.md`
- `.gsd/milestones/M001/slices/S01/S01-PLAN.md`

seed 前 `headless query`：

- `No milestones found. Run /gsd to create one.`

seed 后 `headless query`：

```json
{"state":{"activeMilestone":{"id":"M001","title":"Docs-only validation milestone"},"activeSlice":{"id":"S01","title":"Add one validation note to docs"},"activeTask":{"id":"T01","title":"Add a concise validation note"},"phase":"executing","recentDecisions":[],"blockers":[],"nextAction":"Execute T01: Add a concise validation note in slice S01.","registry":[{"id":"M001","title":"Docs-only validation milestone","status":"active"}],"requirements":{"active":0,"validated":0,"deferred":0,"outOfScope":0,"blocked":0,"total":0},"progress":{"milestones":{"done":0,"total":1},"slices":{"done":0,"total":1},"tasks":{"done":0,"total":1}}},"next":{"action":"dispatch","unitType":"plan-slice","unitId":"M001/S01"},"cost":{"workers":[],"total":0}}
```

结论：

- **seed 结构满足 runtime 读取约束**
- 当前首个 blocker **不再是 milestone 识别 / `new-milestone` 链路**

### 6.2 真实 `headless auto` 运行摘要

本轮真实运行输出（关键片段）：

```text
[gsd]     Resuming paused session for M001.
[gsd]     Auto-mode resumed.
[gsd]     Pre-dispatch hooks: phase-discipline-profile-dispatch, phase-discipline-scout-fanout
[gsd]     Scout fan-out failed for research-slice M001/S01: Scout constraints_risks failed | provider=openai | model=gpt-5.4 | Unknown error
[gsd]     Auto-mode paused (Escape). Type to interact, or /gsd auto to resume.
```

这里的关键事实是：

1. runtime 已成功恢复 `M001` 的 paused session。
2. `phase-discipline-profile-dispatch` 与 `phase-discipline-scout-fanout` 都已实际执行。
3. 首个真实失败点已进入 **phase-discipline runtime 内部**，而不是 `new-milestone` 或 seed 识别。

### 6.3 续验后的当前状态证据

续验后再次执行 `headless query`：

```json
{"state":{"activeMilestone":{"id":"M001","title":"Docs-only validation milestone"},"activeSlice":{"id":"S01","title":"Add one validation note to docs"},"activeTask":null,"phase":"planning","recentDecisions":[],"blockers":[],"nextAction":"Task plan files missing for S01. Run plan-slice to generate task plans.","registry":[{"id":"M001","title":"Docs-only validation milestone","status":"active"}],"requirements":{"active":0,"validated":0,"deferred":0,"outOfScope":0,"blocked":0,"total":0},"progress":{"milestones":{"done":0,"total":1},"slices":{"done":0,"total":1},"tasks":{"done":0,"total":1}}},"next":{"action":"dispatch","unitType":"research-slice","unitId":"M001/S01"},"cost":{"workers":[],"total":0}}
```

额外落盘证据：

- `~/.gsd/projects/0dfdd86ee7af/runtime/paused-session.json` 记录了 `milestoneId = M001` 与 paused 时间。
- `~/.gsd/projects/0dfdd86ee7af/runtime/units/plan-slice-M001-S01.json` 仍显示当前 unit 为 `plan-slice` / `M001/S01`，状态 `dispatched`。
- `~/.gsd/projects/0dfdd86ee7af/STATE.md` 当前显示：
  - `Phase: planning`
  - `Next Action: Task plan files missing for S01. Run plan-slice to generate task plans.`
- `S01/.phase-discipline/` 仍为空，`tasks/` 也为空，说明 canonical research artifact 与 task plan 尚未成功写出。

### 6.4 结论

这次续验说明：

- **不是**“还没进 runtime 就因为没 API key 被外层 `auto` 启动前拦住”。
- **而是**：runtime 已真实进入 `phase-discipline`，并在 **`research-slice` 的 scout fan-out** 上首次失败。
- 当前首个真实 blocker 可归类为：
  - **位置**：phase-discipline runtime 本体内部（`research-slice / phase-discipline-scout-fanout`）
  - **类型**：外部 provider 失败（`openai/gpt-5.4`）
  - **具体 scout**：`constraints_risks`

因此当前最准确的说法是：

- `auto` 本身已经启动并进入 runtime；
- 但 **runtime 内的 OpenAI scout 子调用** 失败并导致 pause；
- 尚不能据此断言 phase-discipline 后续 phase（admission/review/execute/validate）是否还有新的内部 blocker。

### 6.5 当前不应误判的点

- 不要把这次失败重新归因到 `headless new-milestone --auto` false-success；那条主线已经关闭。
- 不要把这次失败误判成“milestone seed 仍不被识别”；seed 已被明确识别。
- `headless query` 中出现的

  ```text
  [gsd:dispatch] WARN: registry dispatch failed, falling back to inline rules: RuleRegistry not initialized — call initRegistry() or setRegistry() first.
  ```

  当前看是次要噪音，不是首个真实 blocker，因为 runtime 仍已成功执行到 `phase-discipline-scout-fanout`。

### 6.6 下一步建议

下一轮最高价值动作应聚焦：

1. 确认 / 补齐 `openai/gpt-5.4` 的可用凭据或 provider 可用性。
2. 在相同隔离 repo、保留当前 seed milestone 的前提下，重新执行 `headless auto`。
3. 一旦 provider 通路恢复，观察：
   - `constraints_risks` scout 是否通过；
   - 是否写出 `S01/.phase-discipline/` observability / raw logs；
   - 是否进一步推进到 task plan 生成、admission、review 或 execute-task。

在拿到 provider 可用条件前，**不建议**直接改 `phase-discipline/*` 主实现，因为当前最直接证据仍指向外部 provider 失败，而非已证实的 runtime 逻辑 bug。
