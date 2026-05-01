---

## topic: phase-discipline-auto-mode-loop-supervision

stage: run-log
date: 2026-05-01
supervisor_role: observe + classify + record only
linked_prior: docs/superpowers/plans/2026-04-29-phase-discipline-auto-mode-supervised-loop-run-log.md

# Phase-Discipline Auto-Mode Loop · 监督运行日志（2026-05-01）

## 0. 任务说明

用户请求：分析当前项目结构，开启一轮 `phase-discipline` 的 auto-mode loop 全自动验证；监督它直到完成；过程中遇到的问题记录到本文件，便于后续分析。

监督规则：

- 仅 observe + classify + record，不主动改代码、不主动改 plan。
- 每个 `start / iteration / pause / stop / complete / anomaly` 至少留一条 timeline。
- 每条问题包含：时间、症状、证据（命令/文件/行号）、影响、动作、结果。

## 1. Pre-run 项目快照


| 项               | 值                                                                                                                                           |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| 项目              | gsd-pi v2.77.0 (`package.json`)                                                                                                             |
| GSD 数据目录        | `.gsd/` → `~/.gsd/projects/1824bedfc1a9`                                                                                                    |
| 当前活跃 milestone  | 无（`.gsd/STATE.md`：`Active Milestone: None`）                                                                                                 |
| Milestone 注册表   | M001 (CLI environment doctor, ⏸️ parked) · M005 (Phase-discipline supervised validation, ✅ 已完成)                                             |
| 上次 auto-loop 结果 | `.gsd/runtime/auto-loop-report.json` → `status=stopped`, `stopReason=pre-dispatch-break`, 10 iterations，M005 已经在 `complete-milestone` 单元中走完 |
| Phase           | `pre-planning`                                                                                                                              |


### 1.1 Milestones 目录态

```
.gsd/milestones/M001/  parked，仅有 CONTEXT/DISCUSSION/PARKED/ROADMAP；M001-PARKED.md 文件存在但内容为空
.gsd/milestones/M005/  已完成，含 SUMMARY、VALIDATION
```

### 1.2 Phase-discipline 模块代码态

`src/resources/extensions/gsd/phase-discipline/`：含 `preset.ts / merge.ts / phase-guard.ts / impl-plan-validator.ts / verify-fuse.ts / scout-fanout.ts / reviewer-hook.ts / profile-dispatch.ts / readiness-guard.ts / connectivity-probe.ts / preflight.ts / findings-carry.ts / profile-map.ts`，对应 dist 也已构建。

### 1.3 已知风险点（来自上一次 supervised log §3 Timeline）

- 旧 supervised run 出现过 `.gsd/ROADMAP.md` ENOENT 与错误的 `milestones/...` 路径搜索。
- 旧 supervised run 终态为 `auto-exit reason=other` 的 fail-closed。
- 当前监督起点是「M005 已 closeout，注册表里只剩 parked 的 M001」，所以本轮 auto-mode 一启动就会触发 `pre-dispatch-break`（除非先 unpark 或新建 milestone）。

## 2. 监督协议

- 启动命令：`node dist/loader.js headless --output-format stream-json --timeout 1800000 auto`
- 输出文件：
  - stdout (JSONL): `.bg-shell/auto-mode-2026-05-01.jsonl`
  - stderr: `.bg-shell/auto-mode-2026-05-01.stderr.log`
- 实时尾随的关键证据文件：
  - `.gsd/journal/2026-05-01.jsonl`
  - `.gsd/runtime/auto-loop-report.json`
  - `.gsd/STATE.md` / `.gsd/STATE.json`
  - `.gsd/notifications.jsonl`
  - 会话日志：`~/.gsd/agent/sessions/--Users-sheng-tencent-gsd-2--/2026-05-01T11-52-46-447Z_e981a42b...jsonl`

## 3. Timeline


| #   | 时间 (UTC+8)          | 事件                                | 摘要                                                                                                                                                                                                                                                                              |
| --- | ------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T0  | 19:52:05            | pre-run snapshot                  | 见 §1；监督文档创建。`.gsd/STATE.md` Phase=pre-planning, no active milestone。                                                                                                                                                                                                            |
| T1  | 19:52:45            | start                             | `node dist/loader.js headless --output-format stream-json --timeout 1800000 auto` 后台启动，PID=8740。                                                                                                                                                                                |
| T2  | 19:52:51            | extensions ready                  | `extensions_ready` 事件；STATE.md mtime 刷新到 19:52:51（仅是文件被重写，内容未变）。                                                                                                                                                                                                                |
| T3  | 19:52:51–19:53:00   | extension UI 启动噪音                 | `Context7`/`google_search` 两条 warn（已知非阻塞）；`gsd-health` widget 提示「⚠ 1 warning · Spent: $18.55 · Last commit: 2h ago — fix(preflight): wire connectivity probe into auto…」                                                                                                        |
| T4  | ~19:52:54           | **decision-fork emitted**         | extension 发出 `extension_ui_request method=select` (L9 of stream)：标题 "GSD — Get Shit Done"，options=[`Create next milestone (recommended)…`, `Not yet: Run /gsd when ready.`]。**这是 phase-discipline 的 pre-planning 入口分叉**：检测到没有可派发 milestone 时，弹给上层 supervisor 决定是否创建新 milestone。 |
| T5  | 19:52:55–19:53:00   | analysis turns                    | LLM 完成 5 个 turn，调用 7 次工具：1× `Skill(using-superpowers)` + 4× `read(.gsd/STATE.md)` / `read(.gsd/DECISIONS.md)` + 3× `bash(ls / find milestones)`（注意工具名 `read` 被部分调用错配为 `bash` 参数 `command`，见 §4 Issue I-2）。                                                                      |
| T6  | 19:53:09            | **execution_complete: completed** | runId `235111dc`，stats: tools=7, cost=$0.2102, totalTokens=280100。LLM 给出最终 text："`What's the vision?`"。**首个 unit 已正常完成。**                                                                                                                                                       |
| T7  | 19:53:09 → 19:58:58 | 进程进入永久 idle                       | 之后 5+ 分钟内： • 没有再发出 `turn_start` • 没有写入 `.gsd/journal/2026-05-01.jsonl` • 没有更新 `.gsd/runtime/auto-loop-report.json`（仍为 15:27:55 的旧文件） • stdout 仅每数秒 1 条 `setStatus` 噪音 • 进程 STAT=`SN`（idle on FD），CPU=0%                                                                         |
| T8  | 19:58:58            | supervisor 终止                     | 监督员 `kill 8740` 终止进程（已经确认进程不会自动推进）。最终 stdout=197 行 JSONL，stderr 空。                                                                                                                                                                                                              |


## 4. Issues 登记

### I-1 · headless auto-mode 在「无可派发 milestone」时悬挂在 `select` UI 而非 fail-closed

- **时间**：19:53:09 → 19:58:58（持续 ~6 分钟，直到监督员终止）
- **症状**：auto-mode 进入 idle，CPU 0%，但 `journal` 与 `auto-loop-report.json` 完全没有新条目；进程不退出。
- **证据**：
  - `.bg-shell/auto-mode-2026-05-01.jsonl` L9 `extension_ui_request method=select title="GSD — Get Shit Done"` —— 上层从未应答（启动命令未带 `--supervised` 也未带 `--answers`）。
  - `.bg-shell/auto-mode-2026-05-01.jsonl` L185 `execution_complete: completed`（首个 unit 正常完成）。
  - 之后所有 stdout 行 type 全部为 `extension_ui_request method=setStatus`（仅心跳类）。
  - `.gsd/journal/2026-05-01.jsonl` 最新一条仍是 `2026-05-01T07:27:55.994Z terminal no-active-milestone`（=上次 auto run 写入的，与本次无关）。
  - `.gsd/runtime/auto-loop-report.json` mtime=`May 1 15:27:55`（=上次 auto run），本次未刷新。
- **影响**：headless 模式下，缺少 supervised stdin 时遇到 phase-discipline 的 pre-planning 分叉，会导致进程 **无限挂起**（不是 timeout-stop，不是 fail-closed），与上次 supervised log 中 §3 Timeline 描述的「`auto-exit reason=other` 的 fail-closed」终态完全不同。
- **可能根因（待确认）**：
  1. 当 milestone 注册表无可派发条目，phase-discipline 的入口决策被路由到 `extension_ui_request method=select`，但 headless 默认（无 `--supervised`）没有 stdout/stdin 协议层去回应 select。
  2. 该 select 似乎也没有 server-side timeout：`headless --timeout 1800000` 只是 LLM execution 的总超时，不是 UI 请求的超时。
  3. journal/auto-loop-report 在「等待 UI 决策」期间不写「pending-input」之类的事件，导致外部监督者从证据上看不到进程在等什么 —— 与上一次 supervised run 的 `.gsd/ROADMAP.md ENOENT` 类似，是观察盲区问题。
- **动作**：仅记录，不修代码。
- **结果**：监督员人工 `kill -TERM 8740` 终止；建议作为后续 follow-up 提交（修 headless idle/select 协议或允许 `--non-interactive` 自动选 "Not yet"）。

### I-2 · 工具名 `bash` 与 `read` 出现混用，多次调用同一参数

- **时间**：19:52:55–19:53:00 LLM 工具调用阶段
- **症状**：LLM 在 7 个工具调用中至少出现 3 次「`read` 工具收到 `bash`-shape 参数（带 `command` 与 `timeout`）」与「`bash` 工具收到 `read`-shape 参数（带 `path/limit/offset`）」的交错（`.bg-shell/auto-mode-2026-05-01.jsonl` 解析后 calls [2/3/7/8/10/13]）。
- **证据**（来自 stream-json 解析输出）：
  ```
  [2] bash: {"limit": 200, "offset": 1, "path": ".gsd/STATE.md"}
  [7] read: {"command": "ls -la && echo '---' && find . -maxdepth 2 -type f | sort | head -200", "timeout": 10}
  [8] bash: {"command": "ls -la && ...", "timeout": 10}
  ```
- **影响**：每个错误参数会被工具拒绝并回到 LLM，触发重试，从而在仅 1 个 unit 内消耗了 7 次工具调用 + 5 个 turn（cost=$0.2102，tokens=280100）。这是观察到的成本放大，但本身没有阻塞 auto-loop。
- **可能根因（待确认）**：模型是 `gpt-5.4`（usage 上 model 字段确认）；该 schema 错配可能与 `openai-responses` provider 在 multi-tool prompt 下的 args dispatch 有关。也可能是 LLM 自身把两组 schema 看成一个。
- **动作**：仅记录。
- **结果**：未影响首个 unit 的 `completed` 终态；建议作为成本/可靠性 follow-up。

### I-3 · STATE.md 在 auto-mode 启动后被「重写为同内容」

- **时间**：19:52:51（auto-mode startup）
- **症状**：`.gsd/STATE.md` mtime 刷新但内容未改变（仍报 Active Milestone: None）。这与 phase-discipline 文档说的 admission 阶段会写 STATE 不一致。
- **证据**：`stat -f "%Sm" .gsd/STATE.md` → `May 1 19:52:51 2026`；diff 与启动前版本无差异。
- **影响**：使用 STATE.md mtime 做心跳/活性检测的外部监督者会被误导（看到 mtime 刷新，以为 loop 在推进，实则只在写 0 字节差异）。
- **动作**：仅记录。
- **结果**：和 I-1 互相印证，构成「auto-mode idle 但表层文件 mtime 仍在动」的观察盲区。

## 5. 终态摘要


| 项                          | 值                                                                                                                                                                   |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 监督起点                       | 2026-05-01 19:52:05 (UTC+8)                                                                                                                                         |
| auto-mode 启动               | 2026-05-01 19:52:45 (UTC+8)                                                                                                                                         |
| auto-mode 终止               | 2026-05-01 19:58:58 (UTC+8)，由监督员 `kill -TERM` 触发（**非自动终止**）                                                                                                         |
| 总用时                        | ~6 分 13 秒                                                                                                                                                           |
| 完成的 LLM unit               | 1 个（首次 admission/discovery turn）：`execution_complete: completed`，tools=7, cost=$0.2102, tokens=280100                                                               |
| 写入 journal 条目              | 0 条（journal mtime 未变）                                                                                                                                               |
| 更新 `auto-loop-report.json` | 否（mtime 未变）                                                                                                                                                         |
| Active milestone 变化        | 无（仍为 None）                                                                                                                                                          |
| 终态分类                       | **不正常的 idle hang**：headless 在 phase-discipline pre-planning 分叉时悬挂等 select UI 应答；与正常的 `pre-dispatch-break` 或 `auto-exit reason=no-active-milestone`（fail-closed）都不同。 |
| 是否符合「全自动验证完成」标准            | **❌ 否**。fail-closed 的语义要求要么写入终态 journal，要么进程退出 —— 本次两者都没有发生。                                                                                                        |


## 6. 给下一位监督员/工程师的建议（仅供参考，不在本次执行）

1. 复现这次悬挂：在与本次相同的 `.gsd/STATE.md` 状态（无 active milestone、唯一其它 milestone parked）下重新跑 `node dist/loader.js headless --output-format stream-json auto`，预期会再次悬挂在 select。
2. 修复方向（任选其一）：
  - headless 的 `extension_ui_request method=select` 在没有 supervised orchestrator 时应该回退为「拒绝 + 写 fail-closed journal `terminal reason=needs-supervised-input`」并退出非 0。
  - 或者新增 `--non-interactive` flag，对 select 自动选 default（这里的 default 是 `Not yet`，对应 fail-closed `auto-exit reason=no-active-milestone`）。
  - 或者 phase-discipline preset 在检测到 headless + 无 active milestone 时，直接走 `pre-dispatch-break` 路径，绕开 select UI。
3. 同步修 I-3：admission 阶段无实际状态变更时不要 touch STATE.md mtime，否则破坏外部活性检测。
4. I-2 是模型层面的可观察成本放大，可加一个 `tool_args_schema_mismatch` 计数器，监控 multi-tool prompt 在 `gpt-5.4 + openai-responses` 下的稳定性。

## 7. 证据文件清单（不要清理）

- `docs/superpowers/plans/2026-05-01-phase-discipline-auto-mode-loop-supervision-log.md`（本文件）
- `.bg-shell/auto-mode-2026-05-01.jsonl`（197 行 stream-json 全量）
- `.bg-shell/auto-mode-2026-05-01.stderr.log`（空）
- `~/.gsd/agent/sessions/--Users-sheng-tencent-gsd-2--/2026-05-01T11-52-46-447Z_e981a42b-ad92-4f72-9c79-7eec44d86958.jsonl`（LLM session 全量）
- `.gsd/runtime/auto-loop-report.json`（**未在本次更新**，mtime=15:27:55；用作对照）
- `.gsd/journal/2026-05-01.jsonl`（**未在本次新增条目**，最后一行 ts=07:27:55；用作对照）

