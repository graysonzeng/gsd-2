---
topic: phase-discipline-auto-mode-supervised-loop
stage: design-review
date: 2026-04-29
reviewed_doc: docs/superpowers/specs/2026-04-29-phase-discipline-auto-mode-supervised-loop-design.md
run_log_template: docs/superpowers/plans/2026-04-29-phase-discipline-auto-mode-supervised-loop-run-log.md
---

# Phase-Discipline Auto-Mode Supervised Loop · 设计评审

## 0. 评审范围

- 设计文档：`docs/superpowers/specs/2026-04-29-phase-discipline-auto-mode-supervised-loop-design.md`
- 运行日志模板：`docs/superpowers/plans/2026-04-29-phase-discipline-auto-mode-supervised-loop-run-log.md`
- 交叉参照：`docs/superpowers/discipline.md`（硬纪律）、`src/resources/extensions/gsd/auto.ts`、`auto/loop.ts`、`auto/phases.ts`、`auto/continuity-coordinator.ts`、`journal.ts`、`forensics.ts`、`doctor.ts`、`phase-discipline/*`、`auto-dispatch.ts`、`init-wizard.ts`、`session-status-io.ts`

## 1. 总体评价

设计的核心方向——**旁路监督而非新 runtime**——是正确的。它与 `discipline.md` D2/D7 的硬约束完全一致，避免了 overlay / 第二 runtime 的陷阱。分阶段执行（init → seed → run → observe）的策略合理，fail-closed 的暂停哲学也是正确的安全姿态。运行日志与设计文档分离的决策值得肯定。

但设计存在 **一个 HIGH 级盲区** 和 **若干 MEDIUM 级缺失**，需要修订后才能安全进入执行阶段。

## 2. 需求与方向

方向正确，不需要推翻。具体分析：

- **解决的是正确的问题**：当前仓库没有 `.gsd` 基座，直接跑 auto 必死；先 init 再 seed 再 run 是唯一合理路径。
- **成功标准清晰可验证**（§2.3 五条全部可客观判定）。
- **方案选择合理**：方案 A（旁路监督）vs 方案 B（新 wrapper runtime）的对比论证充分，拒绝 B 的理由"当前最需要的是可信证据，而不是更强控制面"直击要害。
- **不存在明显更好的替代方向**。

## 3. 主要发现

### [HIGH] 架构缺失: 监督者执行模型未定义

**位置**: §5.3 Phase 2、§5.7 执行顺序

**问题**: 设计反复提到"监督层"做观察、分类、动作三类事，但从未定义**监督者自身是谁、在什么进程/会话中运行、如何感知 auto-mode 状态变化**。具体地：

1. **同会话 vs 异步轮询？** `/gsd auto` 以 detached session 方式运行（见 `startAutoDetached`），意味着启动后控制权已交出。监督者是在同一个 Claude Code 会话中轮询 `/gsd status`？还是开另一个终端/会话？设计未说。
2. **触发频率与时机？** §5.7 说"进入监督循环"但没有定义循环间隔、退出条件、超时上限。一个没有节奏定义的 loop 不是 loop，只是概念。
3. **恢复操作的具体接口？** "触发恢复"具体是执行什么命令？是 `/gsd auto --resume`？还是 `gsd_resolve_blocker`？代码中 resume 走的是 `session-status-io.ts` 的 `sendSignal` 机制，设计文档完全没提。
4. **监督者与 auto-mode 的生命周期耦合？** 如果监督者 session 断了但 auto 还在跑（或反过来），设计没有处理方案。

**影响**: 这不是实现细节——它决定了"旁路监督"到底是一个可操作的 protocol 还是一个纯概念。进入执行阶段时，执行者会因为缺乏具体 protocol 而临场发挥，导致行为不可预测。

**建议**: 在 §5.3 补充一个明确的 **Supervisor Protocol** 小节，至少回答：
- 监督者运行环境：同会话 human-in-the-loop / 脚本自动 / 另一 AI session
- 轮询机制：间隔（建议 30-60s）、使用的具体命令序列（`/gsd status` → journal tail → doctor）
- 恢复操作：具体命令与参数
- 超时/熔断：总运行时长上限、单次 pause 等待上限
- 监督者自身异常处理：session 断连后的恢复策略

---

### [MEDIUM] 映射缺失: Pause/resume 决策矩阵与代码机制脱节

**位置**: §5.5 Pause/stop 决策矩阵

**问题**: §5.5 的三列表格使用的是**语义描述**（如"provider transient pause""context-window pause with intact state"），但代码中的 pause 机制是通过 `session-status-io.ts` 的信号系统和 `.gsd/runtime/paused-session.json` 持久化的。设计没有建立从 **代码信号/状态文件 → 语义场景** 的映射。

具体地：
- 代码中 pause 的来源包括：`sendSignal('pause')` 手动暂停、stuck-detection 触发的自动暂停、context-window 压力暂停、provider rate-limit 暂停。但这些在 `paused-session.json` 里的表征是什么？哪个字段区分了它们？
- 恢复一个 paused session 需要什么前置条件？`ensurePreconditions` 在 resume 路径上检查了什么？

**影响**: 执行时，监督者无法可靠地从状态文件判断当前 pause 属于哪个分类，可能误判。

**建议**: 补充一张 **信号-场景映射表**，左列是代码中可观测的信号/字段/文件内容，右列是 §5.5 中的语义分类。如果当前代码不支持区分某些场景，应明确标注为"当前不可区分，统一走 hard-stop"。

---

### [MEDIUM] 方案缺失: Milestone seed 策略过于模糊

**位置**: §5.2 Phase 1

**问题**: §5.2 给了"首选"和"备选"两个输入来源，但都停留在描述层面。具体地：
- "使用本设计文档作为 `new-milestone` 的上下文输入"——这个 milestone 的 slices / tasks 是什么？auto-mode 的 dispatch 规则（`DISPATCH_RULES` in `auto-dispatch.ts`）需要有可匹配的 unit 才能推进。如果 milestone 只有 vision 没有 task，dispatch 会立刻进入 stuck。
- "验证 phase-discipline 在当前仓库上的 auto-mode 工作流行为"——这不是一个可 dispatch 的工作目标，而是一个元观察。auto-mode 需要**实际的编码/验证/文档任务**才能驱动 phase pipeline。

**影响**: 如果 milestone seed 不充分，auto-mode 会在 dispatch 阶段空转或立即 stuck，验证就变成了"验证 stuck detection 是否工作"而非"验证 phase-discipline 工作流"。

**建议**: 明确定义至少一个具体的 slice + 2-3 个 task，这些 task 应该能触发 phase-discipline 的核心路径：
- 至少 1 个需要 research → plan → implement → verify 全链路的 task（验证 readiness guard + verify fuse）
- 至少 1 个涉及代码变更的 task（验证 profile dispatch + reviewer hook）
- 给出 task 粒度的预估，确保 auto-mode 有足够的"燃料"跑完一轮

---

### [MEDIUM] 风险遗漏: 自举悖论未识别

**位置**: §6 Risks and mitigations

**问题**: 本方案要在 GSD 自身的仓库上运行 GSD 的 auto-mode 来验证 GSD 的 phase-discipline——这是一个**自举（self-hosting）场景**。设计没有识别自举特有的风险：

1. **代码与被测对象耦合**：如果 auto-mode 在执行过程中修改了 `src/resources/extensions/gsd/` 下的代码（例如 task 要求修复某个 phase-discipline bug），那正在运行的 auto-mode 本身的行为可能因此改变。这是经典的"一边开飞机一边换引擎"问题。
2. **`.gsd/` 状态污染仓库**：init 会在仓库根创建 `.gsd/` 并写入大量状态文件。这些文件是否应该 gitignore？如果不 ignore，会污染工作树和 git status；如果 ignore，doctor 在跨 session 恢复时可能找不到状态。
3. **worktree 交互**：代码中有 worktree 相关的 journal 事件（`worktree-enter`, `worktree-created` 等）。如果 auto-mode 在自举场景中创建 worktree，worktree 里的 GSD 源码版本可能与主树不一致。

**影响**: 自举问题不处理，可能导致运行结果不可信——你不知道观察到的行为是 phase-discipline 的真实表现，还是自举耦合的副产物。

**建议**: 在 §6 补充 R6（自举风险），至少明确：
- auto-mode 执行的 task **不应修改** `src/resources/extensions/gsd/` 下的运行时代码（scope guard）
- `.gsd/` 是否 gitignore（建议 yes，并在 run-log 中记录）
- 是否使用 worktree 隔离（建议 yes，在 worktree 中运行以保护主树）

---

### [MEDIUM] 可观测性: 缺少 journal 实时消费方案

**位置**: §5.4 可观测信号面

**问题**: §5.4 列了 6 类信号面，但没有说明**如何实时消费 journal**。Journal 是 JSONL 格式（`journal.ts` 中的 `emitJournalEvent`），文件路径在 `.gsd/runtime/` 下。监督者需要：
- 知道 journal 文件的确切路径
- 有 tail -f 或等效的实时读取手段
- 能解析 JSONL 并提取关键事件

如果监督者是人工的，需要告诉他用什么命令；如果是自动化的，需要定义 parsing 逻辑。

**影响**: 没有实时消费方案，journal 就只能事后分析，失去了"实时监督"的意义。

**建议**: 在 §5.4 或 §5.7 补充：
- Journal 文件路径模式（可通过 `/gsd status` 获取或固定约定）
- 实时监控命令示例（如 `tail -f .gsd/runtime/journal.jsonl | jq '.eventType'`）
- 关键事件的告警条件（如 `stuck-detected`、`guard-block`、`auto-exit` 出现即告警）

---

### [LOW] 文档质量: 运行日志模板缺少 iteration 级跟踪

**位置**: 运行日志模板 §3 Timeline

**问题**: Timeline 只有 5 列（Time / State change / Evidence / Action / Outcome），粒度是"状态变化"级别。但 auto-mode 是**迭代驱动**的（每轮 iteration 有 start/end），一轮可能包含多个 phase。当前模板无法追踪"第 N 轮迭代进入了什么 phase、dispatch 了什么 unit、耗时多少"。

**影响**: 如果 auto-mode 跑了 20 轮迭代，timeline 要么记录过于稀疏（只记 start/pause/stop），要么每轮都记导致格式不合。

**建议**: 在 Timeline 和 Incident log 之间加一个 **Iteration tracker** 表，列：`Iteration# / Dispatch rule / Unit / Phase outcome / Duration / Notes`。只记关键迭代（如 dispatch 变化、phase 失败、stuck），不必每轮都记。

---

### [LOW] 文档质量: §5.5 决策矩阵缺少兜底行

**位置**: §5.5.1 和 §5.5.2

**问题**: 两张表覆盖了已知场景，但没有"未匹配到任何已知场景"的兜底行。如果运行中出现了表中未列举的暂停类型（例如代码中新增了一种 pause 原因但设计未更新），监督者没有指导。

**影响**: 未知场景下的默认行为不确定。

**建议**: 在 §5.5.2 末尾加一行兜底：`| 未匹配场景 | 无法归类到上述任一类型 | 停止；记录完整状态快照并标记为"需人工分析" |`。这与 fail-closed 哲学一致。

---

### [LOW] 跳出框架思考: 是否应该先在非自身仓库上验证？

**位置**: 全局方向

**问题**: 设计选择了在 GSD 自身仓库上自举验证。但如果目标是"验证 phase-discipline 的 auto-mode 行为"，在一个**独立的示例仓库**上验证会更干净——没有自举悖论、没有源码耦合、`.gsd/` 不会污染真实项目。

**影响**: 这不是设计缺陷，而是一个值得评估的替代路径。在自身仓库验证有"吃自己的狗粮"的价值，但也有上述 R6 自举风险。

**建议**: 如果 §6 补充了 R6 的缓解措施（scope guard + gitignore + worktree 隔离），在自身仓库验证是可接受的。但建议在设计中显式记录这个 tradeoff，说明为什么选择自举而非外部仓库。

## 4. 对设计亮点的肯定

1. **方案对比论证扎实**（§4）：不是简单列 pros/cons，而是从"证据质量"角度论证，直击问题本质。
2. **fail-closed 暂停哲学**（§5.5）：对不可恢复场景一律停机是正确的安全姿态。
3. **交叉验证要求**（§5.4 硬规则）："禁止只凭单一信号判定"直接封堵了最常见的误判路径。
4. **分阶段解耦**（§5.1→§5.2→§5.3）：init、seed、run 严格分离，问题定位效率高。
5. **运行日志独立于设计文档**（§5.6）：事实与意图分离，复盘时不会相互污染。
6. **自查清单完备**（§9）：所有常见遗漏项都过了一遍。

## 5. 改进建议汇总

| # | 严重度 | 标题 | 建议动作 |
|---|---|---|---|
| F1 | HIGH | 监督者执行模型未定义 | §5.3 补充 Supervisor Protocol 小节 |
| F2 | MEDIUM | Pause/resume 矩阵与代码脱节 | 补信号-场景映射表 |
| F3 | MEDIUM | Milestone seed 策略过于模糊 | 定义具体 slice + tasks |
| F4 | MEDIUM | 自举悖论未识别 | §6 补 R6 + 缓解措施 |
| F5 | MEDIUM | 缺少 journal 实时消费方案 | §5.4 补监控命令与告警条件 |
| F6 | LOW | 运行日志缺 iteration 跟踪 | 加 Iteration tracker 表 |
| F7 | LOW | 决策矩阵缺兜底行 | §5.5.2 加未匹配场景兜底 |
| F8 | LOW | 未评估外部仓库验证替代 | §6 或 §4 记录 tradeoff |

## 6. 结论

**PASS_WITH_NOTES**

设计核心方向正确，方案选择合理，与 discipline 约束一致。无需推翻重设计。但 F1（监督者执行模型）是进入执行前必须补充的——它不改变方案方向，但决定方案能否落地。F2-F5 建议在修订中一并处理，F6-F8 可视情况处理。

修订后不需要重新评审，可直接进入 `design-implement`。

## 7. 下一步

### 7.1 同会话继续

```text
直接执行 /design-implement
```

### 7.2 新会话恢复 prompt

```text
请阅读设计文档 docs/superpowers/specs/2026-04-29-phase-discipline-auto-mode-supervised-loop-design.md
和评审文档 docs/superpowers/plans/2026-04-29-phase-discipline-auto-mode-supervised-loop-design-review.md，
使用 /design-implement 进行方案修订及实现。
重点补充 HIGH-F1：监督者执行模型（Supervisor Protocol），
以及 MEDIUM-F2~F5：pause 信号映射、milestone seed 具体化、自举风险缓解、journal 实时消费。
```

## 8. Change log

| Version | Date | Summary |
|---|---|---|
| v1 | 2026-04-29 | 首版评审：结论 PASS_WITH_NOTES；1 HIGH（监督者执行模型未定义）、4 MEDIUM（pause 映射 / milestone seed / 自举风险 / journal 消费）、3 LOW（iteration 跟踪 / 兜底行 / 替代路径 tradeoff） |
