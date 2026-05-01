# Design: phase-discipline auto-mode web UI execution timeline

- Date: 2026-05-01
- Status: Draft
- Scope: L

## 1. 设计目标和范围

### 1.1 要解决的问题
- `phase-discipline` 的 auto-mode loop 在 Web UI 中目前主要能看到当前 phase、unit、status、widget、token/cost、活动工具等少量运行状态。
- 用户希望 Web UI 尽可能复刻 Claude Code 的执行展示方式：能看到整个 auto-mode 执行过程里使用的模型、工具、agent/subagent、公开推理片段或推理摘要、代码变更 diff、验证与错误。
- 现有 UI 已有 `auto-mode-console` 与 bridge SSE 基础，但缺少跨 auto unit 的稳定执行事件时间线。auto-mode 每个 unit 会创建 fresh session，浏览器只靠当前 bridge session 事件和 dashboard 聚合，容易退化成“只有状态，没有过程”。

### 1.2 成功标准
- Web UI 能以时间线方式展示一次 auto-mode run 的完整过程：run start、unit start/end、模型选择、agent/session、thinking/message、tool start/update/end、subagent/reviewer/scout、file diff、verification、pause/stop/complete。
- 刷新页面或断线重连后，已完成 unit 的过程信息仍可恢复；当前 live unit 继续流式展示。
- 数据来源可审计：每条 UI 事件能追溯到 bridge event、session transcript、journal entry、git diff 或 closeout artifact，而不是 UI 侧猜测。
- 不引入新的 auto-mode runtime、scheduler overlay、控制平面或顶层 state 语义；本设计只做观测与展示投影。
- 对敏感信息有明确策略：工具参数、环境变量、文件内容、prompt、diff 可按规则截断/脱敏；不尝试重构不可公开的隐藏推理链。

### 1.3 本次范围
- 设计 Web UI 的 auto-mode execution timeline 数据模型、采集点、后端读取接口和前端展示结构。
- 覆盖 `phase-discipline` 相关 agent 面：main unit agent、phase-discipline scout fanout、built-in reviewer hook、post-unit hook、verification。
- 复用现有能力：`BridgeService` SSE、`message_update` / `tool_execution_*` / `agent_end` / `turn_end` events、`AutoDashboardData`、`.gsd/journal/*.jsonl`、session transcript、git summary/diff 能力。
- 定义最小 additive 代码改动范围和验证计划，为后续 `/design-review` 与 `/design-implement` 提供输入。

### 1.4 非目标
- 不做新的 auto-mode scheduler、loop wrapper、overlay state 或 sidecar control plane。
- 不改变 auto-mode 的调度决策、恢复策略、phase-discipline gate 语义。
- 不承诺展示 provider 未暴露的隐藏 chain-of-thought；UI 只展示可被 runtime 合法拿到的 `thinking_delta`、公开摘要、模型/工具事件和证据。
- 不把 Web UI 做成通用 tracing 平台；本轮聚焦 auto-mode / phase-discipline execution surface。
- 不在设计阶段直接改代码或运行完整实现验证。

## 2. 背景与约束

- `docs/superpowers/discipline.md` 明确禁止新的 auto-mode overlay、第二 runtime、平行 scheduler、通用 hook plugin framework；本设计必须保持 additive observability。
- `docs/user-docs/auto-mode.md` 描述 auto-mode 是基于磁盘 state 的 state machine，每个 unit 使用 fresh session，并已有 dashboard、cost/token、HTML report、health surface 等能力。
- `src/resources/extensions/gsd/journal.ts` 已有结构化 JSONL journal，事件包含 iteration、dispatch、unit、terminal、guard、continuity、worktree 等 orchestration 面，但尚未覆盖完整 UI 所需的 message/tool/diff hydration。
- `src/resources/extensions/gsd/auto/types.ts` 中 `AutoDashboardData` 当前只包含 active/paused/currentUnit/completedUnits/cost/tokens 等聚合字段，不足以恢复 unit 级 transcript、model、agent、diff。
- `src/web/bridge-service.ts` 已将 RPC child 输出中的事件转发给浏览器，并对 `agent_end`、`turn_end`、auto retry/compaction 做 live-state invalidation。
- `web/lib/gsd-workspace-store.tsx` 已能消费 `message_update`、`tool_execution_start/update/end`、`agent_end`、`turn_end`，并维护 `currentTurnSegments` / `completedTurnSegments` / `activeToolExecution`。
- `web/components/gsd/auto-mode-console.tsx` 已能渲染 Claude Code 风格的 message、thinking、tool、active-tool、diff、subagent snapshot，但它依赖前端 store 中已有的结构化事件；当历史事件缺失或 session 切换后，UI 只能退回 dashboard/status 展示。
- `web/lib/auto-mode-subagent-details.ts` 已有 subagent result snapshot 解析逻辑，可作为 phase-discipline scout/reviewer 展示的前端基础。

## 3. 根因分析（按需）

### 3.1 是否需要根因分析
- 不需要做完整根因分析。
- 理由：这是新能力/体验设计，不是未知故障修复。当前代码事实已足够支持方案设计：现有系统具备 live event 与部分 UI 渲染能力，但缺少跨 fresh session 的持久执行事件索引与 hydration contract。进一步排查“为什么某次只能显示状态”会影响具体 bug fix，但不影响本次设计方向。

### 3.2 已确认事实
- 不适用。本节不展开根因证据；相关代码事实已写入第 2 节背景与约束。

### 3.3 未确认假设
- 不适用。本设计的关键不依赖未知环境差异或某次复现日志。

### 3.4 对设计的影响
- 不适用。本设计按“现有能力不足，需要补 execution timeline contract”推进，而不是按单次失败根因定制修复。

## 4. 方案对比

### 4.1 方案 A：前端继续拼接现有 bridge live events 与 dashboard 状态
- 核心思路：不改后端 contract，只增强 `auto-mode-console`，把现有 `message_update`、`tool_execution_*`、dashboard、status/widget 尽量排版得更像 Claude Code。
- 优点：改动最小，主要集中在 Web 前端；不会触碰 auto loop。
- 缺点：无法解决 fresh session 和页面刷新后的历史丢失；completed unit 缺少 sessionFile/model/diff 元数据；当 live events 没到前端时仍只能显示状态；无法稳定展示完整 run。
- 适用前提：只追求当前页面在线时的“看起来更好”，不要求完整可恢复 timeline。

### 4.2 方案 B：离线读取所有 session transcript，前端按时间重建执行过程
- 核心思路：Web API 读取 project sessions 目录和 SessionManager messages，把相关 session 全部解析成 timeline；journal/dashboard 只用作辅助排序。
- 优点：历史恢复能力强；能复用已有 session transcript，不需要在 auto loop 上新增大量事件。
- 缺点：缺少 unit -> sessionFile 的权威映射时容易误配；每次读取大量 transcript 成本高；很难准确关联 phase-discipline scout/reviewer、model selection、verification、diff；排序和归因会变成 heuristic。
- 适用前提：短期做 forensic view 或人工调试页，而不是 live auto console 的主路径。

### 4.3 方案 C（推荐）：薄 execution event backbone + transcript/diff hydration
- 核心思路：在现有 auto loop / bridge / journal 旁边补一个很薄的“执行事件骨架”。骨架只记录 run/unit/span 的权威元数据和可恢复索引；详细内容通过 session transcript、live bridge events、tool result details、git diff/closeout artifact 按需 hydration。
- 优点：不引入第二 runtime；能把 live streaming 与历史恢复统一到同一 timeline contract；模型、agent、tool、diff、verification 都有明确来源；前端现有 `auto-mode-console` 可渐进复用。
- 缺点：需要小幅扩展 auto dashboard/journal/session metadata 和 Web API；需要定义脱敏/截断策略；需要处理旧 run 没有新 metadata 时的 degraded view。
- 适用前提：接受本轮是 Web observability 的 L 级改造，按 slice 渐进实现。

### 4.4 选型结论
- 选择：方案 C。
- 理由：用户要的是“整个执行过程”的稳定展示，不是单纯视觉排版。方案 A 解决不了跨 session 与刷新恢复；方案 B 历史恢复强但归因不可靠。方案 C 用最薄的权威索引连接已有 journal、session transcript、bridge event 和 git diff，既满足 Claude Code 风格展示，又符合 phase-discipline 的反第二 runtime 纪律。

## 5. 详细方案

### 5.1 核心思路
- 把 auto-mode UI 分成两层：
  - **Execution backbone**：权威但轻量的 run/unit/span 索引，记录“什么时候、哪个 unit、哪个 session、哪个模型、哪个 agent/span、状态如何、对应哪些 artifacts”。
  - **Hydrated timeline**：Web API 根据 backbone 按需读取 live bridge events、session transcript、tool result details、journal、git diff，生成 Claude Code 风格 timeline item。
- Live 阶段优先使用 SSE 事件即时渲染；unit 完成后由 session transcript + journal 元数据补齐并归档到 timeline。
- 对 phase-discipline 的 scout/reviewer/hook 使用统一 span 概念，而不是新增 unit type 或 scheduler 分支。
- UI 展示遵循“证据先于展示”：每个 timeline item 标注 source 类型，至少内部数据结构保留 source pointer，方便调试。

### 5.2 关键数据流 / 控制流
1. `startAuto` 进入一次新的 auto run 时生成 `runId`；`runId` 表示一次 `/gsd auto` 从启动到 complete/cancel 的完整生命周期，pause/resume、崩溃恢复后继续沿用同一个 `runId`。
   - `runId` 持久化不新建独立 runtime：运行中复用现有 `.gsd/auto.lock` 扩展字段保存；pause 时复用 `.gsd/runtime/paused-session.json` 扩展字段保存；resume 时优先从这些现有状态恢复。
   - `flowId` 继续表示单次 iteration 的 journal 关联键。
   - `unitRunId` 本轮直接复用 `flowId`，不引入第二个 per-unit UUID；Web contract 中保留 `unitRunId` 命名，只是其值等于权威 `flowId`。
   - backbone 物理存储仍是现有 journal JSONL；timeline API 从 journal 扩展字段读取 run/unit 索引，再按需 hydrate transcript / diff / artifact。
2. `autoLoop` 进入 iteration/unit 时通过现有 journal emit unit start/end、dispatch、continuity 等 backbone 事件，并在相关 `data` 中补 `runId` 与 `unitRunId(flowId)`。
2. `selectAndApplyModel` 完成后，把实际应用模型、provider、routing tier、fallback/escalation 信息写入当前 unit metadata，并同步到 dashboard-facing current dispatched model。
3. `runUnit` 创建 fresh session 后，将 `sessionId`、`sessionFile`、unitType、unitId、model metadata 写入 backbone；后续 live bridge event 可以用 active session 归属到该 unit。
4. Bridge SSE 继续实时转发 `message_update`、`tool_execution_start/update/end`、`agent_end`、`turn_end`；前端保留现有 current turn 渲染。
5. Web API `GET /api/auto-execution/timeline` 根据 project、runId、unitRunId、cursor 参数读取 backbone，并对已完成 unit 执行 hydration：
   1. 从 session transcript 解析 assistant text、公开 thinking、tool calls、tool results。
   2. 从 tool result details 读取 `diff`、subagent `results`、error payload。
   3. 从 journal 读取 phase transition、continuity decision、guard block、verification、terminal。
   4. 从 git/closeout metadata 读取 changed files、commit sha、per-unit diff summary。
6. 前端 `deriveAutoModeTimeline` 升级为接受 hydrated timeline payload；live item 与 hydrated item 使用同一 row model，避免两套 UI。
7. 页面刷新或 SSE 重连后，先拉取 hydrated timeline，再接上 live SSE tail；同一个 `eventId` 去重。

### 5.2.1 Agent / session 可见性边界
- main unit agent 和通过主 session 内 `Agent` tool 触发的 subagent，属于 bridge-visible / session-visible，可从 bridge SSE 与 session transcript hydrate。
- phase-discipline scout fanout、built-in reviewer、post-unit verification 中不一定都拥有独立 bridge session；这类 non-bridge-visible agent 先以 journal + artifact pointer + summary row 呈现，必要时降级为 `agent summary only`。
- UI 不假设“所有 agent 都有独立 transcript”；缺少 transcript 时，仍显示 unit start/end、模型、status、artifact pointer，并明确 source 来源。

### 5.3 接口 / 配置 / 数据结构变更

#### 5.3.1 Auto execution event contract

补充约束：`AutoExecutionEvent` 是 Web API 暴露给前端的展示层合成类型，不是新的持久化文件格式。持久化 truth 仍是 journal、session transcript、git/artifact。

新增 Web-facing 类型，建议放在 `web/lib/auto-execution-types.ts`，后端对应类型可放在 `src/web/auto-execution-service.ts` 或共享 `src/shared`：

```ts
export type AutoExecutionEventKind =
  | "run-start"
  | "run-end"
  | "unit-start"
  | "unit-end"
  | "model-selected"
  | "agent-span-start"
  | "agent-span-end"
  | "thinking"
  | "message"
  | "tool-start"
  | "tool-update"
  | "tool-end"
  | "file-diff"
  | "verification"
  | "continuity"
  | "guard"
  | "error"

export interface AutoExecutionEvent {
  id: string
  ts: string
  runId: string
  unitRunId?: string
  unit?: { type: string; id: string }
  session?: { id?: string; file?: string; name?: string }
  model?: { provider?: string; id?: string; tier?: string; fallback?: boolean }
  agent?: { kind: "main" | "scout" | "reviewer" | "hook" | "verification"; name?: string; step?: number }
  kind: AutoExecutionEventKind
  title: string
  body?: string
  tool?: { callId: string; name: string; argsPreview?: string; resultPreview?: string; isError?: boolean }
  diff?: { files: string[]; patchPreview?: string; commitSha?: string }
  source: {
    type: "bridge-event" | "session-transcript" | "journal" | "git" | "closeout-artifact"
    path?: string
    flowId?: string
    seq?: number
  }
}
```

注：`source.type` 允许后续按需扩展，例如 reviewer/scout 独立 artifact，可新增 `review-artifact` 一类 source，而不是强行塞进现有枚举语义。

#### 5.3.2 AutoDashboardData additive fields

保留现有字段，给 `currentUnit` 与 `completedUnits` 加可选字段：

```ts
type AutoDashboardUnit = {
  type: string
  id: string
  startedAt: number
  finishedAt?: number
  runId?: string
  unitRunId?: string
  flowId?: string
  sessionId?: string
  sessionFile?: string
  model?: { provider?: string; id?: string; tier?: string }
  status?: "running" | "completed" | "cancelled" | "error" | "paused"
  commitSha?: string
  changedFiles?: string[]
}
```

这些字段都是 optional，确保旧 bridge / 旧 dashboard 数据仍可渲染 degraded view。

#### 5.3.3 Journal additive events

在 `JournalEventType` 增加少量观测事件，或在现有 `unit-start` / `unit-end` / `continuity-decision` data 中扩展字段。优先少加 event type。backbone 物理存储明确为 journal，不新增独立 `.gsd/execution-timeline/*.jsonl`：

- `run-start` / `run-end`: 仅记录 `runId`、run status、pause/stop reason 等 run 级边界，便于 timeline API 定位一次完整 run；不是新的控制平面。
- `unit-start`: data 增加 `runId`、`unitRunId(=flowId)`、`sessionId?`、`sessionFile?`、`model?`、`routing?`。
- `unit-end`: data 增加 `runId`、`unitRunId(=flowId)`、`status`、`durationMs`、`commitSha?`、`changedFiles?`、`summaryArtifactPath?`。
- `model-selected`: 只在模型选择变化、fallback、downgrade、retry escalation 时 emit。
- `agent-span`: 用于 scout/reviewer/hook 这类 unit 内 agent，不改变 scheduler unit type。

其中：
- `runId` 由 auto session 生命周期管理；pause/resume、crash-recovery 继续沿用。
- `unitRunId` 只是 Web-facing alias，实际值等于 journal 既有 `flowId`，避免额外 ID 漂移。

#### 5.3.4 Web API

- `GET /api/auto-execution/timeline?runId=&unitRunId=&cursor=&limit=`
  - 返回按时间排序的 `AutoExecutionEvent[]`、`nextCursor`、`watermark`。
  - 默认返回当前 project 最新 active/paused run。
  - 支持 `degraded: true`，当旧 run 缺少新 metadata 时使用 dashboard/status/journal 基础事件。
  - 默认 `limit=20` 个 unit；`cursor` 以 unit 边界分页，而不是对单条 message/tool event 生硬分页。
  - hydration 分层：
    - backbone-only：只返回 run/unit/model/status 索引，目标是低延迟首屏。
    - summary hydration：补 assistant text / thinking / tool / diff preview，作为本轮默认。
    - full hydration：大 diff / 大结果通过按需接口单独拉取，不在列表首屏全量展开。
  - transcript 读取必须懒加载并限制在当前 page 对应的 sessionFile 集合内，不全量扫描 project sessions。
- `GET /api/auto-execution/diff?unitRunId=&file=`
  - 返回某 unit 的 diff patch 或文件级 diff。
  - 后端必须限制在 project cwd 内，复用现有 secure path / git summary 保护。
- 配置：本轮不新增 preference；如需要关闭，可先通过前端 feature flag 或实验开关处理，不进入 GSD 顶层配置。

选择 SSE + REST 而不是 WebSocket：已有 bridge SSE 基础设施已覆盖“服务端单向推送 + 浏览器按需补历史”的需求；本轮不为 execution timeline 再引入第二条长连接协议。

### 5.4 UI 展示结构

- Header：
  - `auto`、`bridge`、`phase`、`unit`、`model`、`session`、`tokens`、`cost`、`elapsed`。
  - 当前已有字段保留，新增 per-unit model/status 时优先显示 unit metadata。
- Main timeline：
  - `user prompt`：自动 dispatch prompt 可折叠显示 prompt summary、prompt hash、context artifacts，不默认展开完整 prompt。
  - `model`：显示 provider/model、routing tier、fallback/downgrade/escalation reason。
  - `agent`：main/scout/reviewer/hook/verification 分组，subagent snapshot 可折叠。
  - `thinking`：仅显示 runtime 已公开的 `thinking_delta` 或 agent 公开摘要；没有公开内容时显示 `reasoning not exposed by provider`，不伪造隐藏推理。
  - `tool`：沿用现有 tool row，扩展 args/result preview、duration、exit status、streaming partial result。
  - `diff`：edit/multiedit 优先用 tool result `details.diff`；bash/脚本改文件则用 unit closeout 的 git diff summary hydrate。
  - `verification`：展示命令、结果、失败摘要、retry 次数。
  - `continuity`：展示 continue/retry/pause/stop/terminal 与 breakpointClass。
- Right detail pane：
  - 点击 timeline item 展开 source pointer、raw JSON、session transcript excerpt、artifact path。
  - 对 prompt、tool args、diff、large output 默认截断，并提供“open artifact / open file”入口。
- Degraded states：
  - 缺少新 metadata 时，继续显示当前 status/widget/dashboard，并明确标注 `limited history`，避免误导用户以为没有执行过程。

### 5.5 错误处理与回退策略
- Journal 缺失：UI 显示 degraded status view，并提示缺少 execution metadata；不阻塞 auto-mode。
- Session transcript 缺失或损坏：保留 unit start/end、model、status、diff summary；详细 message/tool 显示为 unavailable。
- Tool result 太大：后端截断 preview，保留 artifact/source pointer；前端默认折叠。
- Diff 太大或包含二进制：只显示 file list、stat、commit sha，文件级 diff 按需拉取。
- SSE 断线：前端记录最后 `eventId` / cursor，重连后先调用 timeline API 补洞，再接 live tail。
- 旧版本 bridge：所有新增字段 optional；前端按现有 dashboard/status 渲染。
- 隐私/敏感信息：后端统一脱敏 env、token、secret-like key；prompt 与 tool args 默认 preview，不默认暴露完整内容。

### 5.5.1 脱敏 / 截断默认规则
- `tool.argsPreview` 默认最多 500 chars；`resultPreview` 默认最多 1000 chars；超出部分截断并保留 source pointer。
- unified diff preview 默认最多 200 行或 12 KB 文本；超出后只保留 file list / stat / source pointer。
- prompt preview 默认最多 800 chars，不默认回传完整 prompt body。
- 使用关键字 + 模式双重脱敏：`API_KEY` / `TOKEN` / `SECRET` / `PASSWORD` / `AUTH` 等键名，配合 bearer、`sk-...`、`xox...` 等常见 secret 模式。
- 二进制内容、超长日志、疑似凭证值不进入 timeline inline body，只进入 artifact/source pointer。

### 5.6 风险与缓解
- 风险：把 observability 误做成第二 runtime 或控制面。
  - 缓解：本设计只读取/投影事件，不参与调度决策；不得新增 auto loop wrapper、overlay state、scheduler hook。
- 风险：记录过多 message/tool/diff 导致性能和磁盘压力。
  - 缓解：backbone 只存索引；详细内容按需从 session transcript、artifact、git 读取；API 分页和截断。
- 风险：展示隐藏推理引发安全/合规问题。
  - 缓解：只展示 provider/runtime 已公开的 thinking events 或 agent 自写摘要；UI 文案明确未暴露时不展示。
- 风险：unit 与 session 关联错误导致 UI 误归因。
  - 缓解：由 auto loop 在 unit start 时写入 `unitRunId/sessionId/sessionFile`，禁止前端用时间窗口猜测归属。
- 风险：phase-discipline scout/reviewer 原始日志格式不统一。
  - 缓解：先通过 `agent-span` + raw artifact pointer 展示最小信息，再逐步给常见 result shape 做 adapter。
- 风险：代码 diff 来源不完整，尤其 Bash 生成文件。
  - 缓解：unit start 记录 git baseline，unit end/closeout 记录 changed files/commit sha；无法生成 patch 时至少展示 stat 和 commit。

### 5.7 建议切片
- Slice 1：runId 生命周期打通 + journal backbone 扩展 + AutoDashboardData additive fields。
- Slice 2：timeline 后端 service + `GET /api/auto-execution/timeline` summary hydration。
- Slice 3：前端 console 接入 hydrated history，并与现有 live SSE timeline 拼接。
- Slice 4：diff / subagent / verification 细化展示与 degraded 标识。
- Slice 5：更细的 agent-span adapters、性能打磨、回归补强。

## 6. 验证计划

- 单元测试：
  - `web/lib/auto-execution-types` / timeline derivation：覆盖 model、thinking、tool、subagent、diff、degraded view。
  - `web/lib/auto-mode-subagent-details`：补 scout/reviewer 多 agent、多 step、tool result error 的解析用例。
  - `web/lib/power-mode-context`：覆盖 hydrated events 与 live events 去重、排序、waiting tail。
  - `src/web/auto-execution-service`：用 fixture journal + session transcript + git metadata 生成 timeline。
- 集成测试：
  - bridge SSE 事件到 workspace store 的 live timeline：message/tool/thinking/turn boundary 顺序不乱。
  - `/api/auto-execution/timeline` 在新旧 metadata 下分别返回 full/degraded payload。
  - 页面刷新后：completed unit 从 hydration 恢复，active unit 接续 live SSE。
- 回归测试：
  - `npm test -- web/lib/__tests__/power-mode-context.test.ts web/lib/__tests__/auto-mode-subagent-details.test.ts`
  - 相关 `src/tests/headless-events.test.ts`、`src/tests/headless-cli-surface.test.ts` 不能回退现有 headless 行为。
- 手工验证：
  - 在一个小型 `.gsd` 项目运行 `/gsd auto`，确认 UI 依次显示 model、unit、thinking/message、tool、diff、verification、unit done。
  - 人为刷新页面，确认历史 unit 仍可展开。
  - 模拟 provider pause、verification failure、tool error，确认 continuity/error row 清晰可见。
- 构建验证：
  - `npm run typecheck`
  - `npm run build`
  - Web 包相关测试按项目脚本执行。

## 7. 关键决策摘要
- 选择“薄 execution event backbone + transcript/diff hydration”，不选择纯前端拼接或全 transcript heuristic 重建。
- 新增能力定位为 Web observability，不参与 auto-mode 调度、恢复或控制。
- 使用 `runId + unitRunId(=flowId) + sessionFile/model` 作为 run 与 unit 过程信息的权威关联键。
- Live 展示继续走 bridge SSE；历史恢复走 timeline API hydration。
- 推理展示只使用公开 thinking 或摘要，不暴露或伪造隐藏 chain-of-thought。
- Diff 展示分两层：tool result inline diff 优先，unit closeout/git diff 作为 Bash/脚本改动补充。
- 所有新增 contract optional，旧 run 与旧 bridge 走 degraded view。

## 7.1 修订记录
- 2026-05-01：根据 design-review 补充 `runId` 生命周期定义与持久化边界，明确 backbone 物理存储=journal，规定 `unitRunId` 直接复用 `flowId`。
- 2026-05-01：补充 timeline API 的分页/性能策略、agent 可见性边界、脱敏/截断默认规则、以及分 slice 实施建议。

## 8. Handoff

### 8.1 同会话继续
`直接执行 $design-review 或 /design-review`

### 8.2 新会话恢复 prompt
```text
请阅读设计文档 docs/superpowers/specs/2026-05-01-phase-discipline-auto-mode-web-ui-execution-timeline-design.md，
使用 $design-review（或 /design-review）对该方案进行评审；若文档包含根因分析，
请一并分析根因判断、证据与设计方案是否正确、合理，以及两者是否一致。
```
