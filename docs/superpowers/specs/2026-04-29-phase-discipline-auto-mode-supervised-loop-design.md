---
topic: phase-discipline-auto-mode-supervised-loop
stage: design
date: 2026-04-29
size: L
---

# Phase-Discipline Auto-Mode Supervised Loop · 设计

> **Origin** — 本文源自一次 `/design-brainstorm`：目标是在当前仓库 `/Users/sheng/tencent/gsd-2` 上，先补齐 `.gsd` 基座，再开启一轮以 **workflow complete** 为终态的 `phase-discipline` auto-mode 全自动验证；本轮只负责**监控、推进、记录问题**，不在 v1 里改造 `auto/loop.ts` 或新增第二套 runtime。

## 0. Summary & scope

### 0.1 What we are building

本轮要落地的是一个**仓库内自举 + 旁路监督**方案，而不是新的 loop 实现：

1. 把当前仓库初始化成一个可运行的 GSD 项目（生成 `.gsd/STATE.md` 等最小基座）。
2. 为本仓库创建一个专门用于 `phase-discipline` 验证的 milestone / workflow 输入。
3. 使用现有 `/gsd auto`、`/gsd pause`、`/gsd status`、journal、runtime report、forensics 等能力，对 auto-mode 做**监督式推进**，直到 `workflow complete` 或命中明确定义的停止条件。
4. 把运行中遇到的问题沉淀到一份**独立运行日志文档**，便于后续复盘和 `design-implement` 阶段收敛修复点。

### 0.2 What v1 does NOT cover

- 不新增 `auto --loop-wrapper`、`AutoLoopRunner`、overlay state、sidecar runtime。
- 不修改 `src/resources/extensions/gsd/auto/loop.ts`、`auto/phases.ts`、`phase-discipline/*` 的运行逻辑。
- 不在本轮设计里承诺“任意 pause 都自动恢复”；只恢复**可证明安全**的暂停类型。
- 不把“初始化 `.gsd`”与“真实跑 auto 验证”混成一个黑盒命令。
- 不把问题日志写回设计文档本体；运行问题单独沉淀。

### 0.3 Rejected entirely

- 任何新的 `auto-mode` overlay / 第二 runtime / wrapper scheduler。
- 在当前仓库尚无 `.gsd/STATE.md` 时直接启动 `/gsd auto`。
- 只凭单一信号（例如 exit code 或 dashboard）判断 loop 成败；必须交叉验证 journal + state + report + 运行产物。

## 1. Current state and repo facts

### 1.1 当前仓库现状

经只读复核：

- 当前仓库为 git repo，工作树起始时干净。
- 当前仓库**尚未存在** `.gsd/` 目录，因此也不存在 `.gsd/STATE.md`。
- 当前仓库已经具备 GSD 自身源码、命令文档与测试基座，可以作为“自举验证对象”，但不能在未初始化前直接进入 `/gsd auto`。

### 1.2 与本设计直接相关的项目结构

- `src/resources/extensions/gsd/auto.ts`
  - auto-mode 生命周期总控：启动、恢复、暂停、dashboard 状态读取。
- `src/resources/extensions/gsd/auto/loop.ts`
  - 真实 loop 内核，负责 iteration、continuity emit、exit/report。
- `src/resources/extensions/gsd/auto/phases.ts`
  - pre-dispatch / guard / dispatch / unit / finalize 线性 phase pipeline。
- `src/resources/extensions/gsd/auto/continuity-coordinator.ts`
  - continuity decision 发射与 session 记录的集中点。
- `src/resources/extensions/gsd/journal.ts`
  - 结构化 JSONL 事件流，是监督阶段最关键的实时证据面。
- `src/resources/extensions/gsd/phase-discipline/*`
  - readiness guard、phase guard、profile dispatch、review/scout fanout 等 phase-discipline 约束与观测面。
- `docs/user-docs/commands.md`
  - 已有 `/gsd init`、`/gsd auto`、`/gsd pause`、`/gsd forensics`、`/gsd doctor` 等命令面。
- `docs/user-docs/auto-mode.md`
  - auto-mode 的官方用户文档，明确 loop、stuck detection、pause/resume、report 与 health surface。
- `docs/superpowers/discipline.md`
  - 当前 phase-discipline 的硬纪律；尤其禁止 overlay / 第二 runtime /越界平台化。

### 1.3 当前设计前提

本次用户已明确：

- 绑定目录：`/Users/sheng/tencent/gsd-2`
- 目标终态：`workflow complete`
- 需要独立问题记录文档
- 允许先做“初始化前设计”，暂不直接运行真实 auto

## 2. Goals, constraints, success criteria

### 2.1 Goals

1. 给当前仓库定义一条**最小但可执行**的 `.gsd` 初始化路径。
2. 给 `phase-discipline` 自动验证定义一条**只监控/推进、不改运行时**的执行路径。
3. 定义清晰的**可恢复暂停**与**必须停机**边界，避免误恢复导致证据污染。
4. 为后续真实运行预置独立日志文档，统一记录问题、证据、动作与结论。

### 2.2 Constraints

1. `docs/superpowers/discipline.md` 已明确拒绝新的 overlay / 第二 runtime / 通用 hook platform 化。
2. 当前仓库未初始化 `.gsd`，任何 auto-mode 讨论都必须把“init + seed milestone”作为前置步骤。
3. 当前目标是“监督式完成 workflow”，不是“重构 auto loop 实现”。
4. 运行过程中产生的代码改动、状态写盘、journal、report 都属于真实副作用，不能伪装成纯观测。

### 2.3 Success criteria

满足以下条件，才算本方案在执行阶段成功：

1. 当前仓库生成合法 `.gsd/STATE.md`，并可正常执行 `/gsd status` / `/gsd doctor`。
2. 至少有一个围绕 `phase-discipline` 验证的 milestone/workflow 输入被创建并可进入 `/gsd auto`。
3. 监督动作全部复用现有能力：`/gsd auto`、`/gsd pause`、`/gsd status`、`/gsd forensics`、journal/runtime report/MCP 查询；**无新增 runtime**。
4. 真实运行中每个 pause / stop / terminal 都能在运行日志中落一条带证据的记录。
5. 终态要么达到 `workflow complete`，要么以可复盘的失败原因停止，并保留足够证据支持下一阶段修复。

## 3. Size assessment

本任务判定为 **L 级**。

原因：

- 不是局部代码小改，而是跨 `init → milestone seed → auto run → runtime observability → failure triage → docs artifact` 的全链路设计。
- 需要同时约束 repo 初始化、phase-discipline 行为、auto-mode 生命周期、运行日志沉淀。
- 一旦进入真实执行，会影响 git 工作树、`.gsd/` 状态、journal、报告与可能的代码提交，风险面明显大于一般功能实现。

因此本轮应走：`design-brainstorm -> design-review`；评审通过后，再进入 `design-implement` 或执行阶段。

## 4. Options considered

### 4.1 方案 A（推荐）—— 旁路监督模式

**核心思路**：

- 先用 `/gsd init` 把当前仓库变成合法 GSD 项目。
- 再创建专门的 `phase-discipline` 验证 milestone。
- 真实运行仍由现有 `/gsd auto` 驱动。
- 监督层只消费现有信号：journal、`.gsd/STATE.md`、runtime report、dashboard、forensics、doctor。
- 监督层仅在“安全可恢复”的暂停场景下触发 resume；其他情况只记录并停机。

**优点**：

- 与 `discipline.md` 一致，不引入第二 runtime。
- 复用现有 `auto/loop.ts`、`auto/phases.ts`、`continuity-coordinator.ts` 的真实行为，证据可信。
- 问题如果出现，容易判定属于 init、state、phase-discipline gate、verification、stuck detection 中哪一层。

**缺点**：

- 自动化“推进”能力是保守的，不会尝试跨越所有 pause。
- 前期需要先补 `.gsd` 基座和 milestone 输入，不能一步到位“立刻开跑”。

### 4.2 方案 B（不推荐）—— 新增 loop wrapper / 监督运行器

**核心思路**：

- 在现有 auto-mode 之外再包一层 `AutoLoopRunner` 或 sidecar supervisor。
- 它自己维护 iteration、checkpoint、可恢复状态、loop report，并驱动 `/gsd auto` 单步或多步执行。

**优点**：

- 表面上自动化更强，控制入口更统一。
- 可以在 wrapper 内做统一策略判断。

**缺点**：

- 与 `docs/superpowers/discipline.md` 的“禁止 overlay / 第二 runtime”直接冲突。
- 会把真实 loop 状态与 wrapper 状态分裂成两套事实源，复盘成本更高。
- 一旦卡住，很难判断问题在 wrapper 还是 `auto/loop.ts` 本体。
- 对当前“先初始化，再验证”的目标来说，属于过度设计。

### 4.3 方案对比结论

选择 **方案 A**。

原因不是“实现更快”这么简单，而是：**当前最需要的是可信证据，而不是更强控制面**。在 `phase-discipline` 仍处于强化与验证周期时，引入第二套控制层只会稀释证据质量、放大定位难度。

## 5. Recommended design

### 5.1 Phase 0 — 初始化当前仓库 `.gsd` 基座

执行目标：让 `/Users/sheng/tencent/gsd-2` 成为一个合法、可诊断、可启动 milestone 的 GSD 项目。

最小要求：

1. 运行 `/gsd init`，在仓库根创建 `.gsd/`。
2. 生成并确认以下基座存在且可读：
   - `.gsd/STATE.md`
   - `.gsd/PROJECT.md`（若 init 生成）
   - `.gsd/REQUIREMENTS.md`（若 init 生成）
   - 其余 init 所需数据库/元数据文件
3. 初始化后立刻执行：
   - `/gsd status`
   - `/gsd doctor`
4. 如果 init 之后 `doctor` 报致命结构错误，则**停止**，不进入 auto。

**设计选择**：

- 本方案不把 init 封装进新脚本；直接使用已有 `/gsd init`。
- 本方案不假设 init 后自动拥有可运行 milestone；milestone seed 是下一阶段。

### 5.2 Phase 1 — 创建专用验证 milestone / workflow 输入

初始化 `.gsd` 后，需要给 auto-mode 一个明确的运行目标。v1 选择创建一个**专门的 phase-discipline 验证 milestone**，而不是让 auto 在空项目上无目标运行。

推荐输入来源二选一：

1. **首选**：使用本设计文档作为 `new-milestone` 的上下文输入，明确告诉 GSD 这是一次“phase-discipline supervised validation”工作。
2. **备选**：补一份更短的 execution brief，只保留运行目标、边界和成功标准。

该 milestone 至少要明确：

- 目标：验证 phase-discipline 在当前仓库上的 auto-mode 工作流行为。
- 范围：init 后的本仓库；关注 readiness guard、profile dispatch、verification、continuity、stuck detection、terminal closure。
- 非范围：不做新 runtime、不做 phase-discipline 逻辑改造。
- 成功标准：能推进到 `workflow complete`，或失败时留下完整结构化证据。

#### 5.2.1 v1 milestone seed（具体化）

为了避免 dispatch 在空 milestone 上空转，v1 不使用抽象目标，而是落一个**最小但可运行**的验证 milestone。推荐 seed 如下：

- **Milestone 名称**：`MXXX Phase-discipline supervised validation`
- **Vision**：在当前仓库上跑通一次受监督的 `/gsd auto`，验证 phase-discipline 的关键链路能推进、能停、能留证据。
- **Boundary**：允许修改 `.gsd/` 规划产物、验证用文档、非运行时代码示例；**不允许修改** `src/resources/extensions/gsd/auto*`、`phase-discipline/*`、`journal.ts` 等被测运行时代码。

推荐至少包含以下 slice / task：

1. **S01 — bootstrap-and-plan-surface**
   - 目标：让 milestone 先经历 `discuss/research/plan` 链路，验证 readiness guard 和计划产物生成。
   - 推荐 task：
     - `T01`：补一份 execution brief / context summary，说明 supervised run 的目标、边界、停止条件。
     - `T02`：把 run-log header 与 pre-run checklist 填充到位。
   - 价值：保证 `research -> plan -> execute` 不是空壳，先把 phase-discipline 的前半链路跑起来。

2. **S02 — safe-doc-implementation-probe**
   - 目标：提供一个低风险、可验证、会产生真实改动的执行单元。
   - 推荐 task：
     - `T01`：更新一个非 runtime 的用户文档或示例文档。
     - `T02`：补对应验证说明或小型回归说明。
   - 价值：验证 profile dispatch、execute-task、post-unit verification、complete-slice 收口，而不污染被测 runtime。

3. **S03 — milestone-closeout-probe**
   - 目标：确保在至少一个 slice 完成后，能进入 `run-uat / validate-milestone / complete-milestone` 收口链路。
   - 推荐 task：
     - `T01`：整理 S01/S02 的证据与验收点，保证 milestone validation 有可消费输入。
   - 价值：验证 terminal closure，而不是只验证 stuck detection。

**硬约束**：seed 必须让 dispatch 表能匹配到真实 unit，不能只写“验证 auto-mode 行为”这种元描述。若 `new-milestone` 生成结果没有至少 1 个 slice 和 2-3 个 task，则视为 seed 不合格，需先补全再启动 `/gsd auto`。

### 5.3 Phase 2 — 监督式运行策略

真实运行由现有 `/gsd auto` 驱动；监督只做三类事情：

1. **观察**：读取 runtime 状态、journal、report、doctor、forensics。
2. **分类**：判断当前是 terminal / safe-resumable pause / hard-stop。
3. **动作**：仅对 safe-resumable pause 触发恢复；其余场景只记录并停止。

#### 5.3.1 Supervisor Protocol（v1）

v1 的监督者不是新的 daemon，也不是第二套 runtime，而是**同一仓库上的独立监督会话**：

- **worker**：现有 `/gsd auto` detached session，本体继续按现有 auto-mode 运行。
- **supervisor**：单独的 Claude Code / 终端会话，human-in-the-loop，按固定节奏轮询现有证据面并决定“只记录、恢复、或停机复盘”。
- **human**：最终裁决者；当 supervisor 命中 hard-stop 或未匹配场景时，由人决定是否修 seed / 修环境 / 再次启动。

这意味着 v1 的“旁路监督”是一个**操作协议**，不是新增进程模型。

#### 5.3.2 Supervisor cadence

推荐轮询节奏：

1. `启动后 0-15s`：确认 `/gsd auto` 已真正进入 active 状态。
2. `稳态轮询`：每 **30-60s** 执行一轮监督检查。
3. `命中 pause / anomaly`：立即追加一轮检查，不等待下一个周期。
4. `命中 terminal`：停止轮询，转入 run-log 收尾。

推荐单轮检查顺序：

1. `/gsd status` —— 读取 dashboard / paused / currentUnit / elapsed。
2. journal tail —— 读取最新 `iteration-start`、`dispatch-match`、`guard-block`、`continuity-decision`、`terminal`、`auto-exit`。
3. `.gsd/runtime/auto-loop-report.json` —— 读取 `stopReason`、最近 iteration、duration。
4. 必要时 `/gsd doctor` —— 结构健康复核。
5. 命中 hard-stop 时 `/gsd forensics` —— 做收口证据补充。

#### 5.3.3 Supervisor action contract

监督者允许的动作只有三类：

1. **observe-only**：状态健康且仍在推进。
2. **safe resume**：仅当 pause 被归类为 safe-resumable，执行 `/gsd auto` 恢复。
3. **hard stop + evidence capture**：命中 hard-stop 时，不做任何“强行恢复”；只补 `/gsd doctor` / `/gsd forensics` / state snapshot，并把原因记入 run-log。

**禁止动作**：

- 不直接写 `.gsd/runtime/*` 状态文件。
- 不手工伪造 `paused-session.json` / `auto-loop-report.json` / journal。
- 不使用 `sendSignal(..., "resume")` 之类内部并行 worker IPC 机制替代 `/gsd auto`。
- 不在 supervisor 会话里修改 runtime 代码再继续同一轮被测 run。

#### 5.3.4 Resume / pause semantics

对于单 milestone auto-mode，本设计采用**外部命令恢复**而不是 parallel worker signal：

- **人工/命令暂停**：`/gsd pause` 或 Escape 触发，状态会写入 `.gsd/runtime/paused-session.json`。
- **恢复**：统一使用 `/gsd auto`，由现有 `startAuto(...)` 读取 paused metadata、lock、derived state 后恢复。
- **为什么不是 `sendSignal("resume")`**：那套机制属于 `parallel-orchestrator` 的 worker IPC（`.gsd/parallel/*.signal.json`），并非单 milestone supervised run 的主恢复面。

#### 5.3.5 Timeout / fuse

为了避免 supervisor 自身变成无穷轮询，本设计定义两层熔断：

- **单次 pause 等待上限**：15 分钟内若仍无法明确归类为 safe-resumable 或 terminal，则停止并记为 `needs-human-analysis`。
- **整轮 supervised run 上限**：默认 4 小时；超过后停止监督并记录“超出本轮验证预算”，是否继续由人决定。

#### 5.3.6 Supervisor failure handling

若 supervisor 会话自身中断：

1. 不视为 worker 自动失败。
2. 新 supervisor 会话先执行 `/gsd status` + 读取最新 journal/report，确认 worker 是否仍活着。
3. 若 worker 仍活着，继续按本协议监督。
4. 若 worker 已停且原因不明，先补 `/gsd doctor` 与 `/gsd forensics`，不要盲目 resume。

### 5.4 可观测信号面

监督时必须至少交叉查看以下证据：

1. **结构化 journal**
   - 路径：`.gsd/journal/YYYY-MM-DD.jsonl`
   - 关注事件：`iteration-start`、`dispatch-match`、`dispatch-readvised`、`unit-start`、`unit-end`、`artifact-verification-retry`、`continuity-decision`、`terminal`、`iteration-end`、`auto-exit`
2. **`.gsd/STATE.md` 与 milestone/slice/task 状态**
   - 用来确认 workflow 是否真正推进，而不是只看会话是否仍存活
3. **runtime report**
   - 路径：`.gsd/runtime/auto-loop-report.json`
   - 用来读取 `stopReason`、每轮状态与持续时间
4. **paused-session metadata**
   - 路径：`.gsd/runtime/paused-session.json`
   - 用来识别是否真的进入可恢复 paused state，以及记录的 `milestoneId / worktreePath / unitType / unitId / lastContinuityDecision`
5. **dashboard / `/gsd status`**
   - 用来读当前 unit、paused/active 状态、cost、elapsed
6. **`/gsd doctor` 与 `/gsd forensics`**
   - 用来诊断结构错误、stuck loop、missing artifact、anomaly
7. **phase-discipline 产物**
   - `RESEARCH.md`
   - `IMPL-PLAN-VALIDATION.md`
   - `VERIFY-FUSE.md`
   - `.phase-discipline/*.json`

#### 5.4.1 journal 实时消费方案

v1 不新增 reader service，直接消费现有 JSONL：

- **实时查看**：`tail -f .gsd/journal/$(date +%F).jsonl`
- **只看关键事件**：`tail -f .gsd/journal/$(date +%F).jsonl | grep --line-buffered 'continuity-decision\|guard-block\|stuck-detected\|terminal\|auto-exit'`
- **事后结构化查询**：复用现有 `queryJournal(...)` 能力或对应 bootstrap/journal tools，而不是手写另一套 parser

推荐告警条件：

- 出现 `guard-block`
- 出现 `stuck-detected`
- 出现 `auto-exit`
- 出现 `continuity-decision` 且 `signal` 属于 `pause-human` / `pause-budget` / `stop-error` / `stop-no-progress`

#### 5.4.2 充分性标准

一次 supervised run 至少要能从以下组合里重建链路：

- `continuity-decision`（为什么继续/暂停/停止）
- `auto-loop-report.json`（最终 stop reason 与 iteration 轨迹）
- `paused-session.json`（若本轮进入 paused）
- `STATE.md` / roadmap 产物（workflow 实际是否推进）

如果做不到，说明不是“证据不足以恢复”，而是**监督设计本身没落到可复盘程度**。

**硬规则**：禁止只凭单一信号判定“完成”或“可恢复”。

### 5.5 Pause / stop 决策矩阵

#### 5.5.1 代码信号 → 语义场景映射

本节用于把“代码里实际能看到的东西”映射到监督语义，避免只写自然语言分类。

| 可观测信号 | 代码/文件来源 | 语义归类 | supervisor 动作 |
|---|---|---|---|
| `continuity-decision.signal = pause-provider` | journal `continuity-decision`；来自 `providerPauseBreak(...)` 或 legacy `provider-pause` fallback | provider transient pause | 等待 cooldown 后用 `/gsd auto` 恢复 |
| `continuity-decision.signal = pause-budget` | journal `continuity-decision`；来自 `budgetPauseBreak(...)` 或 legacy `budget-pause` fallback | budget pause | 不自动恢复；记录预算命中并停机 |
| `continuity-decision.signal = pause-human` 且 `reason = context-window` | journal；`auto/types.ts` legacy fallback | context-window pause | 仅在 state/doctor 健康且人确认时恢复 |
| `.gsd/runtime/paused-session.json` 存在，且 `milestoneId` / `unitType` / `unitId` 完整 | `pauseAuto(...)` 持久化；`interrupted-session.ts` 读取 | 可恢复 paused state 已落盘 | 可进入 resume 候选，再结合 journal/report 分类 |
| `/gsd status` 显示 paused，且 journal 无 `guard-block/stuck-detected/auto-exit(stop-error)` | dashboard + journal 交叉验证 | remote/manual pause but state healthy | 记录后可恢复 |
| `continuity-decision.signal = stop-no-progress` | journal；如 `stuck-detected`、`state-unchanged`、`complete-milestone-artifact-db-mismatch` | no-progress / stuck | 停止；跑 `/gsd forensics` |
| `continuity-decision.signal = stop-error` | journal；如 `doctor fatal`、`worktree invalid`、`workflow capability`、`post-verification-stopped` | hard-stop | 停止；补 doctor/forensics |
| `continuity-decision.signal = stop-terminal` | journal；如 `milestone-complete`、`no-active-milestone` | terminal | 停止监督并收尾 run-log |
| `auto-loop-report.stopReason = session-lock-lost` 或 `missing-command-context` | `.gsd/runtime/auto-loop-report.json` | runtime integrity failure | 停止；不要自动恢复 |
| `.gsd/parallel/*.signal.json` 中的 `resume/pause/stop` | `session-status-io.ts` / parallel orchestrator | **parallel worker IPC，不属于本协议主恢复面** | 单 milestone supervised run 忽略；不拿它替代 `/gsd auto` |

如果当前证据无法区分具体 pause 来源，则统一按 **hard-stop / needs-human-analysis** 处理，而不是猜测。

#### 5.5.2 可安全恢复（supervisor 可推进）

以下场景允许监督层尝试恢复：

| 场景 | 判据 | 动作 |
|---|---|---|
| provider transient pause | `continuity-decision.signal = pause-provider`，或 report/journal 明确是 rate limit / server error / temporary overload | 等待建议冷却时间后恢复 |
| remote/manual pause but state healthy | `/gsd status` 显示 paused，`paused-session.json` 完整，doctor 与 journal 无错误 | 记录原因后恢复 |
| context-window pause with intact state | `continuity-decision.signal = pause-human` 且 `reason = context-window`，未伴随结构错误 | 记录并恢复 |

#### 5.5.3 必须停机并记录（supervisor 不自动恢复）

| 场景 | 判据 | 动作 |
|---|---|---|
| phase-discipline preflight fail | provider/model/preset 预检失败 | 停止；记录缺失能力与证据 |
| readiness guard block | `guard-block` / 前置产物缺失 | 停止；记录缺失 artifact |
| verify fuse / milestone validation fail | verdict 非 pass 且 gate 不允许继续 | 停止；记录 validation 证据 |
| stuck detection | `stuck-detected`、`stop-no-progress`、ABAB 振荡、ENOENT 重复等 | 停止；执行 `/gsd forensics` |
| state unchanged / no progress | 状态签名无变化或 report 明示无进展 | 停止；保留前后状态快照 |
| doctor fatal | `.gsd` 结构错误、损坏、依赖文件缺失 | 停止；先修结构问题 |
| verification retry exhausted | 自动修复耗尽、产物仍非法 | 停止；记录失败命令与产物 |
| session-lock-lost / missing command context | 会话锁或上下文损坏 | 停止；不要强行 resume |
| budget pause | `continuity-decision.signal = pause-budget` | 停止；由人决定是否提高预算后重启 |
| 未匹配场景 | 无法归类到上述任一类型 | 停止；记录完整状态快照并标记为 `needs-human-analysis` |

### 5.6 问题记录文档设计

独立运行日志文档路径固定为：

- `docs/superpowers/plans/2026-04-29-phase-discipline-auto-mode-supervised-loop-run-log.md`

记录规则：

1. 一次真实执行共用一份日志。
2. 每次状态变化（start / pause / resume / stop / complete / anomaly）至少记一条 timeline。
3. 每条问题必须包含：
   - 时间
   - 症状
   - 证据指针（journal event / file path / command output）
   - 影响
   - 采取动作
   - 结果
4. 对于“未自动恢复”的暂停，必须显式写出“不恢复”的理由。

### 5.7 执行顺序（推荐）

1. `/gsd init`
2. `/gsd status`
3. `/gsd doctor`
4. 创建 phase-discipline 验证 milestone
5. 打开运行日志文档并写入 run header
6. 启动 `/gsd auto`
7. 进入监督循环：
   - 读 status/journal/report
   - 分类当前状态
   - 如果 safe-resumable，则恢复
   - 如果 hard-stop，则停机并跑 `/gsd forensics`
8. 若 `workflow complete`，补全 run summary 与证据链接

## 6. Risks and mitigations

### R1. `.gsd` 初始化成功，但 milestone 输入不足，导致 auto 空跑或错误规划

**Mitigation**：init 与 milestone seed 分阶段执行；未看到明确 milestone/active workflow 前不启动 `/gsd auto`。

### R2. 监督层把不可恢复 pause 误判为可恢复，导致证据污染

**Mitigation**：使用 §5.5 决策矩阵；对 readiness/validation/stuck/doctor fatal 一律 fail closed。

### R3. worktree / root 路径混淆，导致读错 journal/report/state

**Mitigation**：真实执行阶段每次先记录当前实际运行目录；日志中统一写 root path 与 active worktree path。

### R4. 运行问题与初始化问题缠在一起，无法定位根因

**Mitigation**：先过 `init -> status -> doctor`，只有基座健康后才进入 auto run。

### R5. 仅靠 dashboard 误判成功

**Mitigation**：完成判定至少要求 `STATE.md` / journal terminal / runtime report 三方一致。

### R6. 自举风险（self-hosting paradox）

当前方案是在 **GSD 自身仓库** 上运行 GSD 的 auto-mode 来验证 phase-discipline，这天然带来三类额外风险：

1. **运行时代码与被测对象同仓**
   - 如果本轮 task 修改 `src/resources/extensions/gsd/` 下的 runtime 代码，正在执行的 worker 行为可能中途改变，导致证据失真。
2. **`.gsd/` 状态污染主工作树**
   - init 与 run 会持续写 `.gsd/STATE.md`、journal、report、runtime metadata；若直接在主树跑，git status 与真实代码改动会混在一起。
3. **worktree 版本漂移**
   - 若 auto-mode 进入 worktree，而 supervisor 仍在主树观察，必须确认 `worktreePath` 与 `originalBasePath`，否则会把不同树的状态混读。

**Mitigation**：

- **scope guard**：本轮验证 milestone 的 task **不允许修改** `src/resources/extensions/gsd/auto*`、`phase-discipline/*`、`journal.ts`、`session-status-io.ts` 等运行时代码；只允许改 `.gsd/` 规划产物、验证文档、低风险非 runtime 文件。
- **worktree-first**：优先使用现有 worktree 隔离模式，让 worker 在 milestone worktree 内执行；supervisor 在 run-log 中同时记录 `Repo root`、`Actual run root`、`Worktree path`。
- **git hygiene**：把 `.gsd/` 视为运行时状态目录处理，不把它混入“代码改动是否成功”的判断；是否纳入 gitignore 取决于项目现状，但 run-log 必须显式记录当前仓库如何处理 `.gsd/`。
- **no hot patching**：一旦 supervised run 已开始，本轮不在同一次 run 中修改被测 runtime 代码；若必须改 runtime，先停机、记录、另起验证轮次。

### R7. 为什么仍选择自举而不是外部示例仓库

外部示例仓库确实更干净，没有自举悖论；但本轮仍选择当前仓库，原因是：

- 目标不只是“auto-mode 能跑”，而是验证 **phase-discipline 在真实 GSD 仓库约束下** 的表现；
- 许多关键路径（worktree、doctor、forensics、verification、milestone closeout）只有在真实仓库上才有代表性；
- 只要按 R6 的 scope guard + worktree 隔离 + fail-closed 监督执行，自举风险是可控的。

换句话说：**自举不是最干净的环境，但它提供了最有价值的证据**。

## 7. Validation plan

真实执行阶段的验证顺序固定如下：

### 7.1 基座验证

- `.gsd/STATE.md` 存在
- `/gsd status` 正常返回
- `/gsd doctor` 无阻断性错误

### 7.2 milestone 输入验证

- active milestone 已创建
- 对应 plan/roadmap/task 产物存在
- `/gsd status` 能识别当前 workflow 状态

### 7.3 运行时验证

- journal 持续产生事件
- `currentUnit` 与 `STATE.md` 变化一致
- runtime report 可落盘

### 7.4 问题复盘验证

- 所有 stop / pause / anomaly 均有日志记录
- 每条关键问题都能回链到至少一个文件证据或命令证据
- 若失败，`/gsd forensics` 输出被纳入日志

### 7.5 完成判定验证

- `workflow complete` 已体现在状态文件 / journal terminal / runtime report 中
- 运行日志已补全最终结论与后续建议

## 8. Key decisions

1. **选择 L 级流程**：先设计，再评审，再实现/执行。
2. **选择旁路监督而非 wrapper runtime**：保持证据单源，避免违反 discipline。
3. **先 init，再 seed milestone，再跑 auto**：避免把问题混成一团。
4. **问题日志独立于设计文档**：运行事实与设计意图分离，便于后续修复评审。
5. **监督只恢复安全暂停**：其余场景 fail closed。

## 9. Self-check

本文自查结论：

- 已明确规模级别：`L`
- 已明确目标 / 范围 / 非范围 / 成功标准
- 已提出并比较两个方案，且给出推荐理由
- 已给出独立问题日志文档路径与记录规则
- 无 `TODO` / `TBD`
- 无“先跑再看”的黑箱步骤
- 与 `docs/superpowers/discipline.md` 的边界约束一致

## 10. Next-step handoff

### 10.1 推荐下一步

先进入独立评审：`/design-review`

### 10.2 同会话继续

```text
直接执行 /design-review
```

### 10.3 新会话恢复 prompt

```text
请阅读设计文档 docs/superpowers/specs/2026-04-29-phase-discipline-auto-mode-supervised-loop-design.md，
以及运行日志模板 docs/superpowers/plans/2026-04-29-phase-discipline-auto-mode-supervised-loop-run-log.md，
使用 /design-review 对该方案进行评审，分析设计方案及核心思路是否合理，
是否有遗漏需要补充，或需要推翻重新设计。
```

## 11. Change log

| Version | Date | Summary |
|---|---|---|
| v2 | 2026-04-29 | 根据 design-review 补齐 Supervisor Protocol、代码信号到 pause/stop 语义映射、具体 milestone seed、自举风险缓解、journal 实时消费方案，并补 hard-stop 兜底与自举 tradeoff 说明。 |
| v1 | 2026-04-29 | 首版：基于当前仓库缺失 `.gsd` 基座的事实，提出“先 init、再 seed milestone、再用现有 auto/journal/status 做旁路监督”的 L 级设计，并单独定义运行问题日志文档。 |

## 修订记录

- 采纳 HIGH-F1：新增 §5.3.1~§5.3.6，明确 supervisor 是独立监督会话而非新 runtime，并补 cadence / resume / timeout / supervisor failure protocol。
- 采纳 MEDIUM-F2：新增 §5.5.1，把 `continuity-decision`、`paused-session.json`、`auto-loop-report.json`、parallel signal file 映射到监督语义。
- 采纳 MEDIUM-F3：新增 §5.2.1，把 validation milestone seed 细化为 3 个可 dispatch 的 slice/task 结构。
- 采纳 MEDIUM-F4：新增 R6/R7，显式处理 self-hosting 风险与“为何仍选自举”的 tradeoff。
- 采纳 MEDIUM-F5：新增 §5.4.1/§5.4.2，明确 journal 路径、tail 方式、告警条件和证据充分性标准。
- 采纳 LOW-F7/F8：新增未匹配场景兜底，以及自举 vs 外部示例仓库的取舍说明。
- 采纳 LOW-F6：运行日志模板已同步补 iteration tracker。 |
