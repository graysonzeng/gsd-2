# Design Review: phase-discipline auto-mode web UI execution timeline

- Date: 2026-05-01
- Reviewed Design: docs/superpowers/specs/2026-05-01-phase-discipline-auto-mode-web-ui-execution-timeline-design.md
- Review Scope: 完整方案评审（数据模型、采集点、后端 API、前端展示、discipline 合规性）

## 1. 整体结论
- **PASS_WITH_NOTES**
- 一句话结论：方案方向正确、架构合理、与 discipline 纪律兼容，但在 `runId` 生命周期定义、backbone 持久化机制、hydration 性能边界、以及 slice 拆分粒度上存在需要补充的细节。

## 2. 根因评审结论（按需）
- 适用性：不适用
- 结论：NOT_APPLICABLE
- 理由：这是一个新能力/体验设计文档，不是故障修复。文档 §3 已显式声明"不需要做完整根因分析"，设计方向不依赖任何根因判断。背景事实（现有 live event 能力、fresh session 导致历史丢失、dashboard 字段不足）已在 §2 明确列举且可通过代码验证。

### 2.1 证据检查
- 不适用。

### 2.2 事实 / 假设边界检查
- 不适用。

### 2.3 对方案的影响检查
- 不适用。

## 3. 设计方案评审

### 3.1 需求与方向
- **解决了正确的问题**：现有 Web UI 在 auto-mode 中只能看到当前 session 的 live 事件，跨 fresh session 和页面刷新后丢失过程信息。方案 C 用"薄骨架 + 按需 hydration"统一 live 和 history 展示，符合用户"看到完整执行过程"的核心需求。
- **成功标准清晰**：§1.2 列出了 5 条可验证标准（时间线展示、刷新恢复、数据可审计、不引入新 runtime、脱敏策略），定义明确。
- **方向正确性**：在已有 bridge SSE + journal + session transcript 基础上做 additive observability，比全量 transcript 解析或纯前端拼接都更合理。
- **跳出框架审视**：考虑过是否可以不要 backbone 而直接用 journal 现有事件替代——结论是不行，因为现有 journal 事件缺少 `sessionId/sessionFile/model` 等权威关联键，且缺少 agent-span 粒度。方案 C 的增量最小。

### 3.2 方案合理性
- **技术可行**：所有数据来源（journal、session transcript、bridge event、git）已存在；扩展 `AutoDashboardData` 和 journal data 字段为 optional 是安全的 additive 变更。
- **架构贴合现状**：
  - `BridgeService` 已有 SSE event 转发和 subscribe 模式，新增 timeline API 不冲突。
  - `AutoDashboardData` 现有 `currentUnit` / `completedUnits` 只需加 optional 字段。
  - Web API 路由模式 (`web/app/api/`) Next.js route handler 已有成熟范式。
- **Discipline 合规**：
  - 不新增 auto-mode overlay / runtime / scheduler hook（符合 D2/D7）。
  - 不改变调度决策或恢复策略（符合 §1.4 非目标）。
  - backbone 是 observability 投影，不是控制面（符合 D7 反过度抽象）。
- **边界覆盖**：§5.5 错误处理覆盖了 journal 缺失、transcript 损坏、diff 太大、SSE 断线、旧版本 bridge 等场景。§5.6 风险矩阵合理。

### 3.3 实现可行性
- **规模**：文档标注 Scope: L，涉及后端 service、journal 扩展、Web API、前端 store 升级、UI 组件改造。这是正确的评估。
- **依赖**：
  - 前端依赖后端 timeline API；后端依赖 journal/dashboard 字段扩展；字段扩展依赖 auto loop emit 点。
  - 依赖链清晰，可按 slice 递增交付。
- **可测试性**：§6 验证计划覆盖了单元测试、集成测试、回归测试、手工验证和构建验证，结构完整。
- **风险**：最大实现风险在于 hydration 层的性能（读取多个 session transcript + git diff），以及旧 run 缺少 metadata 时的 degraded path 测试覆盖。

### 3.4 文档质量
- **完整性**：方案对比充分（3 个方案 + 选型理由），数据流 6 步清晰，接口/类型/API 都有具体定义。
- **一致性**：全文术语统一（backbone/hydration/span/degraded）；类型定义与描述一致。
- **无 TODO/TBD**：文档中没有遗留的 TODO 或 TBD。
- **可改进点**：部分实现细节（如 backbone 持久化方式、runId 分配时机）偏抽象，需要在实现阶段细化。

## 4. 主要发现

### HIGH

#### [HIGH-1] 方案合理性: `runId` 生命周期与持久化方式未明确

**位置**: §5.2 第 1 步 / §5.3.1 `AutoExecutionEvent.runId`

**问题**: 文档提到 `autoLoop` 进入 run 时生成 `runId`，但未定义：
1. `runId` 是一次 `/gsd auto` 命令的整个生命周期，还是 pause/resume 后保持同一个 runId？
2. 代码中目前没有 `runId` 概念（grep 确认），需要在哪里生成和持久化？
3. 如果 auto-mode pause 后用户关闭终端再 resume，`runId` 如何恢复？

**影响**: 如果 `runId` 跨 pause/resume 不持久，则 timeline API 无法聚合完整 run；如果持久，需要定义存储位置（`.gsd/auto-state.json`？journal？`run-lock`？）。

**建议**: 在 §5.3 明确：
- `runId` = 一次 auto 命令到 complete/cancel 的整个生命周期（跨 pause/resume 保持）。
- 持久化位置建议写入 `.gsd/auto-lock.json` 或 `.gsd/auto-run-state.json`（已有 lock 机制可复用）。
- Pause/resume 时从持久化位置恢复 `runId`。

---

#### [HIGH-2] 方案合理性: backbone 事件持久化机制未定义

**位置**: §5.1 / §5.2 / §5.3

**问题**: 文档定义了 `AutoExecutionEvent` 数据结构，但未明确 backbone 本身如何持久化。选项包括：
- A) 复用 journal JSONL（在现有 journal 事件中扩展字段）
- B) 新增独立 JSONL 文件（如 `.gsd/execution-timeline/`）
- C) 仅在内存中维护 + dashboard sync

当前设计在 §5.3.3 提到在 journal 中扩展字段，但 §5.3.1 的 `AutoExecutionEvent` 又像一个独立的展示层类型。两者的映射关系不明确。

**影响**: 实现时需要决定：hydration 层从哪里读取 backbone 索引？如果是 journal，则 timeline API 需要按 `runId/unitRunId` 过滤 journal entries 并 join 其他源；如果是独立存储，则需要新增 emit 点。

**建议**: 明确声明 backbone 物理存储 = journal（扩展后的 `unit-start`/`unit-end`/`model-selected`/`agent-span` 事件），`AutoExecutionEvent` 是 Web API 的展示层类型（由 hydration service 从 journal + session transcript + git 合成），不是新的持久化格式。

---

#### [HIGH-3] 实现可行性: Hydration 性能边界与分页策略不足

**位置**: §5.3.4 Web API / §5.2 第 5 步

**问题**: Timeline API 需要按需 hydrate 已完成 unit 的 transcript/diff，但未定义：
1. 单次 hydration 的最大 unit 数（如果一次 run 有 100+ units？）
2. Session transcript 文件可能很大（几万行），hydration 时如何避免全量读取？
3. Git diff 可能涉及大量文件，performance budget 未定义。

**影响**: 如果不设限，timeline API 可能导致 Web 后端长时间阻塞或内存压力。

**建议**: 
- 定义分页策略：默认 `limit=20` units，cursor 翻页。
- Hydration 分层：backbone-only 响应（< 10ms）→ summary hydration（transcript 摘要，< 100ms）→ full hydration（完整 message/tool/diff，按需延迟加载）。
- 对 transcript 大文件做 stream/lazy 读取，只提取 assistant/tool 消息。

---

### MEDIUM

#### [MEDIUM-1] 实现可行性: `unitRunId` 与现有 `flowId` 的关系需厘清

**位置**: §5.2 第 1 步 / §5.3.2 / §5.3.3

**问题**: 现有 journal 已有 `flowId`（per iteration UUID），设计新增 `unitRunId`。文档 §5.2 同时提到"生成或传递 `runId`、`unitRunId`、`flowId`"，但未说明三者关系：
- `flowId` = per iteration（已存在）
- `unitRunId` = ?（似乎也是 per iteration/unit？那与 flowId 什么区别？）
- `runId` = per auto run（新增）

**影响**: 如果 `unitRunId === flowId`，则不需要新增概念；如果不同（比如一个 iteration 可能有多个 unit？），需要明确。

**建议**: 如果 1 iteration = 1 unit（目前代码如此），建议 `unitRunId` 直接复用 `flowId`，避免引入冗余 ID。若有不同语义，需文档说明差异。

---

#### [MEDIUM-2] 方案合理性: agent-span 对 scout/reviewer 的 session 关联不明确

**位置**: §5.1 / §5.3.3 / §5.4 agent 展示

**问题**: Phase-discipline 的 scout fanout 和 reviewer hook 是否有自己的 session（bridge child）？如果是 main session 内的 subagent（通过 Agent tool），它们的 transcript 在 main session 内。如果是独立 subprocess/fanout，可能没有 bridge event 可观测。

**影响**: UI 设计假设所有 agent 都能通过 bridge event 或 session transcript 获取，但如果某些 scout/reviewer 通过外部调用（如 codeagent-wrapper），则可能无法 hydrate。

**建议**: 在设计中明确哪些 agent 是 bridge-visible 的（main session subagent），哪些需要通过 closeout artifact / journal / external log 获取。定义 degraded 展示策略。

---

#### [MEDIUM-3] 文档质量: 缺少 Slice 拆分建议

**位置**: §1.3 / 全文

**问题**: 标注 Scope: L，但未给出建议的实现 slice 拆分。L 级改造需要 3-5 个可独立交付的 slice 才能渐进验证。

**影响**: 实现阶段缺少里程碑拆分参考，可能一次性改太多或并发冲突。

**建议**: 建议补充 slice 建议，例如：
1. Slice 1: Journal 扩展（unit-start/end 加字段 + model-selected event）+ backbone 读取 utility
2. Slice 2: AutoDashboardData additive fields + dashboard sync
3. Slice 3: Timeline Web API + hydration service（summary level）
4. Slice 4: 前端 timeline store 改造（接受 hydrated payload + live tail 合并）
5. Slice 5: 完整 UI 渲染 + diff/subagent/verification 展示

---

#### [MEDIUM-4] 方案合理性: 脱敏/截断策略缺少具体规则

**位置**: §5.5 隐私/敏感信息 / §1.2 成功标准第 5 条

**问题**: 文档提到"后端统一脱敏 env、token、secret-like key"，但未定义：
- 脱敏规则（正则？关键词？配置？）
- 截断阈值（tool args 多少字符？diff 多少行？）
- 是否可配置（preference？硬编码？）

**影响**: 实现时缺少明确规格，可能导致过度脱敏（信息丢失）或不足脱敏（泄露敏感信息）。

**建议**: 定义默认阈值（如 tool args preview ≤ 500 chars, diff ≤ 200 lines, result ≤ 1000 chars），以及 env/secret 脱敏的正则模式（如 `/(API_KEY|TOKEN|SECRET|PASSWORD)=.*/`）。可在实现阶段细化，但设计应给方向。

---

### LOW

#### [LOW-1] 文档质量: `source.type` 枚举可能需要扩展

**位置**: §5.3.1 `AutoExecutionEvent.source.type`

**问题**: 当前定义了 `"bridge-event" | "session-transcript" | "journal" | "git" | "closeout-artifact"`。Phase-discipline 的 scout/reviewer 如果有独立的 result file（如 `.gsd/reviews/`），是否需要新增 source type？

**影响**: 低影响，可在实现时按需扩展。

**建议**: 保持当前定义，但在文档注释中说明"可按需扩展"。

---

#### [LOW-2] 文档质量: 缺少 WebSocket 备选考虑

**位置**: §5.3.4 / §5.2 第 4 步

**问题**: 当前方案使用 SSE + REST API 分页。是否考虑过 WebSocket 双向通道来减少 reconnect 开销？

**影响**: SSE 方案已有基础设施且满足需求。仅作为远期演进考虑。

**建议**: 不需要改方案，但可在文档中简短说明"保持 SSE + REST 是因为已有基础设施、单向推送满足需求"。

## 5. 修订建议

1. **[HIGH-1]** 明确 `runId` 的生命周期（跨 pause/resume）和持久化位置。
2. **[HIGH-2]** 明确 backbone 物理存储 = 现有 journal 扩展字段，`AutoExecutionEvent` 是展示层合成类型。
3. **[HIGH-3]** 补充 hydration 分页策略和性能预算（默认 limit、分层 hydration、lazy transcript 读取）。
4. **[MEDIUM-1]** 厘清 `unitRunId` 与 `flowId` 的关系，如果等价则复用 flowId。
5. **[MEDIUM-2]** 明确 scout/reviewer 的 session 归属和 non-bridge-visible agent 的 degraded 展示策略。
6. **[MEDIUM-3]** 补充建议的 Slice 拆分（5 个 slice）。
7. **[MEDIUM-4]** 定义脱敏/截断的默认阈值和规则方向。

## 6. 下一步建议
- 进入 design-implement 修订上述 HIGH 和 MEDIUM 发现后实现。
- 理由：方案方向正确，核心设计合理，主要发现属于细节补充而非方向性问题。不需要重新设计。

## 7. Handoff

### 7.1 如果进入修订及实现
**同会话继续**
`直接执行 /design-implement`

**新会话恢复 prompt**
```text
请阅读设计文档 docs/superpowers/specs/2026-05-01-phase-discipline-auto-mode-web-ui-execution-timeline-design.md
和评审文档 docs/superpowers/plans/2026-05-01-phase-discipline-auto-mode-web-ui-execution-timeline-design-review.md，
重点核对根因分析（如有）、事实/假设边界、以及方案修订点，
使用 /design-implement 进行方案修订及实现。
```

### 7.2 如果回退重新设计
**同会话继续**
`直接执行 /design-brainstorm`

**新会话恢复 prompt**
```text
请阅读设计文档 docs/superpowers/specs/2026-05-01-phase-discipline-auto-mode-web-ui-execution-timeline-design.md
和评审文档 docs/superpowers/plans/2026-05-01-phase-discipline-auto-mode-web-ui-execution-timeline-design-review.md，
重新评估根因分析（如需要）与设计方案，必要时推翻并重新设计。
使用 /design-brainstorm 重新设计该方案。
```
