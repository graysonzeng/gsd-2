---
topic: phase-discipline-auto-mode-supervised-loop
stage: design-implement
design_doc: docs/superpowers/specs/2026-04-29-phase-discipline-auto-mode-supervised-loop-design.md
review_doc: docs/superpowers/plans/2026-04-29-phase-discipline-auto-mode-supervised-loop-design-review.md
date: 2026-04-29
---

# Phase-Discipline Auto-Mode Supervised Loop · 实现记录

## 1. 评审意见处理摘要

### HIGH-F1：监督者执行模型未定义（已采纳）

已采纳并落到设计协议层，而不是新增 runtime：

- 在设计文档中新增 `Supervisor Protocol`，明确 supervisor 是**独立监督会话**，worker 仍是现有 `/gsd auto` detached session。
- 明确 cadence、轮询顺序、resume 入口、timeout/fuse、supervisor 自身异常恢复策略。
- 明确禁止把 `parallel-orchestrator` 的 signal file 机制误用为单 milestone supervised run 的恢复接口。

### MEDIUM-F2：pause/resume 矩阵与代码脱节（已采纳）

已采纳并落为**代码信号 → 语义场景映射表**：

- 将 `continuity-decision.signal`、`paused-session.json`、`auto-loop-report.json`、`.gsd/parallel/*.signal.json` 与监督语义逐项对齐。
- 明确哪些信号属于可恢复 pause，哪些属于 hard-stop。
- 明确“无法区分时 fail closed”，不允许 supervisor 猜测 pause 来源。

### MEDIUM-F3：milestone seed 过于模糊（已采纳）

已采纳并将 seed 具体化为可 dispatch 的最小验证 milestone：

- 补充 `S01/S02/S03` 三个 slice 的目标与推荐 task。
- 明确必须至少有 1 个 slice 和 2-3 个 task，否则不得启动 `/gsd auto`。
- 明确 seed 不能只写“验证 auto-mode 行为”这种元描述，必须给 dispatch 真正可运行的燃料。

### MEDIUM-F4：自举悖论未识别（已采纳）

已采纳并在风险章节新增自举风险与缓解：

- 新增 self-hosting 风险 R6：运行时代码耦合、`.gsd/` 状态污染、worktree 版本漂移。
- 新增 scope guard：本轮验证 milestone 的 task 不允许修改 `src/resources/extensions/gsd/auto*`、`phase-discipline/*`、`journal.ts`、`session-status-io.ts` 等被测 runtime。
- 新增 worktree-first 与 no-hot-patching 约束。
- 补充为什么即便有自举风险，本轮仍选择当前仓库而不是外部示例仓库。

### MEDIUM-F5：缺少 journal 实时消费方案（已采纳）

已采纳并新增实时消费方案：

- 明确 journal 文件路径 `.gsd/journal/YYYY-MM-DD.jsonl`。
- 明确 `tail -f` / `grep --line-buffered` 的实时监控方式。
- 明确关键告警条件：`guard-block`、`stuck-detected`、`auto-exit`、以及带 stop/pause 信号的 `continuity-decision`。
- 补充 evidence sufficiency 标准，确保一次 supervised run 可以被完整复盘。

### LOW-F6：运行日志缺 iteration 跟踪（已采纳）

已在 run-log 模板中新增 `Iteration tracker` 表，用于记录关键迭代的 dispatch rule、unit、phase outcome、duration 与 notes。

### LOW-F7：决策矩阵缺兜底行（已采纳）

已在 hard-stop 矩阵中补 `未匹配场景`，默认标记为 `needs-human-analysis`。

### LOW-F8：未评估外部仓库验证替代（已采纳）

已在风险章节补充 tradeoff：说明外部仓库更干净，但当前仓库自举能提供更高价值的真实证据。

## 2. 设计修订摘要

本轮修订集中在“让监督方案从概念变成协议”，而不是改 auto runtime：

1. **把 supervisor 落到具体执行模型**
   - supervisor/worker/human 三方角色明确。
   - `/gsd auto` 是唯一恢复入口；parallel signal file 只作为旁证，不作为主控制面。

2. **把 pause/stop 判定从自然语言表述收敛到代码信号**
   - 基于 `continuity-decision`、`paused-session.json`、`auto-loop-report.json`、`/gsd status` 做分类。
   - 未匹配时统一 hard-stop，贯彻 fail-closed。

3. **把 milestone seed 从“方向”具体化为“可 dispatch 任务”**
   - 用最小 slice/task 确保能经过 planning、execute、complete、validate/closeout 链路。

4. **把自举风险正式列为设计对象**
   - 不再默认把“在自己仓库测自己”当成普通验证场景。
   - 引入 scope guard、worktree-first、no-hot-patching 三条硬边界。

5. **把 journal 从事后证据升级为实时监督面**
   - 增补路径、tail 方式、告警条件、证据充分性标准。

## 3. 实现摘要

### 3.1 文档实现（设计主文档）

修改：
- `docs/superpowers/specs/2026-04-29-phase-discipline-auto-mode-supervised-loop-design.md`

本次新增/修订的核心章节：

- `§5.2.1 v1 milestone seed（具体化）`
- `§5.3.1 ~ §5.3.6 Supervisor Protocol`
- `§5.4.1 journal 实时消费方案`
- `§5.4.2 充分性标准`
- `§5.5.1 代码信号 → 语义场景映射`
- `§5.5.3` 中的 hard-stop 兜底行
- `§6` 中的 `R6 自举风险` 与 `R7 为什么仍选择自举`
- `修订记录` 与 `v2 change log`

### 3.2 文档实现（运行日志模板）

修改：
- `docs/superpowers/plans/2026-04-29-phase-discipline-auto-mode-supervised-loop-run-log.md`

新增：

- `§3.1 Iteration tracker`
- iteration 级记录原则
- 明确关键证据优先引用 `continuity-decision`、`auto-loop-report.json`、`paused-session.json`、`/gsd status`

### 3.3 为什么本轮没有修改 runtime 代码

这是本轮最容易被误读的点，所以单列说明。

经复核，评审指出的 HIGH/MEDIUM 缺口并不是“代码缺少某个能力”，而是**设计没有把现有能力收敛成可执行协议**。现有代码已经提供了本轮需要依赖的关键表面：

- `/gsd auto` 的 pause/resume 主入口：`src/resources/extensions/gsd/auto.ts`
- paused metadata 持久化与恢复读取：`src/resources/extensions/gsd/auto.ts`、`src/resources/extensions/gsd/interrupted-session.ts`
- `continuity-decision` 结构化语义：`src/resources/extensions/gsd/auto/types.ts`
- daily JSONL journal 与 `queryJournal(...)`：`src/resources/extensions/gsd/journal.ts`
- runtime report：`src/resources/extensions/gsd/auto/loop.ts`
- parallel worker signal：`src/resources/extensions/gsd/session-status-io.ts`

所以这轮“实现”的正确落点是：

- 把这些既有能力翻译成一份不歧义的监督协议；
- 把 run-log 模板补到足以承接真实运行证据；
- 明确本轮验证的 scope guard，避免自举过程中把被测对象本身改坏。

如果在这里硬改 runtime，只会把“协议补齐”和“改被测代码”混在一起，反而污染下一轮 supervised validation 的证据质量。

## 4. 验证结果

### 4.1 设计-代码一致性复核

已复核以下实现面，确认设计修订不是空想：

- `src/resources/extensions/gsd/auto.ts`
  - `/gsd auto` fresh-start / resume 路径存在。
  - `pauseAuto(...)` 会写 `.gsd/runtime/paused-session.json`。
- `src/resources/extensions/gsd/interrupted-session.ts`
  - 能读取 paused metadata，并参与 interrupted session assessment。
- `src/resources/extensions/gsd/auto/types.ts`
  - `ContinuitySignal` / `BreakpointClass` / `ContinuityDecision` 已存在，可作为 pause/stop 语义来源。
- `src/resources/extensions/gsd/journal.ts`
  - journal 路径为 `.gsd/journal/YYYY-MM-DD.jsonl`，并提供 `queryJournal(...)`。
- `src/resources/extensions/gsd/auto/loop.ts`
  - `auto-loop-report.json` 会落到 `.gsd/runtime/auto-loop-report.json`。
- `src/resources/extensions/gsd/session-status-io.ts`
  - `sendSignal("pause"|"resume"|"stop")` 属于 parallel worker IPC，适合作为“不要误用”的边界证据。

### 4.2 typecheck

已执行：

```bash
npm run typecheck:extensions
```

结果：**通过**。

### 4.3 lint

未执行，原因：项目根 `package.json` 中**没有定义 `lint` 脚本**。这次不能假装 lint 通过，只能如实记为“不适用”。

### 4.4 构建

已执行：

```bash
npm run build
```

结果：**通过**。

### 4.5 功能确认

本轮改动是设计协议与运行日志模板，不涉及 UI 功能或 runtime 行为变更，因此“功能确认”的正确口径不是“我把 auto-mode 真跑了一遍”，而是：

- 设计修订已与现有实现面对齐；
- 运行日志模板已能承接 supervisor protocol 所需证据；
- 仓库 typecheck / build 仍然通过。

真实的 supervised run 验证属于**下一轮执行动作**，不应在本轮文档修订时伪装成“已完成运行验证”。

## 5. 已知限制

1. 本轮没有启动真实 `/gsd auto` supervised run，因此尚未产出真实的 run-log 证据。
2. 本轮没有新增自动化 supervisor 工具；监督协议仍依赖独立会话按 30-60s cadence 执行观察与判断。
3. `.gsd/` 是否已在当前仓库 gitignore 中处理，本轮没有替用户改 git 策略；只是在设计中要求真实运行时显式记录现状。
4. 评审中提到的“是否先在外部示例仓库验证”已写入 tradeoff，但本轮没有额外设计第二条外部仓库验证流程。

## 6. 下一步

建议下一步进入 `/code-review`，重点看三件事：

1. 设计文档里的 `Supervisor Protocol` 是否足够具体，能否直接指导真实 supervised run。
2. `代码信号 → 语义场景映射` 是否和现有实现面保持一致，没有把 parallel IPC 和单 milestone resume 混淆。
3. 本轮坚持“不改 runtime，只补协议与模板”的边界是否合理，是否还漏了必须同步实现的低风险支撑项。

**同会话继续**:
直接执行 /code-review

**新会话恢复 prompt**:
```text
请阅读设计文档 docs/superpowers/specs/2026-04-29-phase-discipline-auto-mode-supervised-loop-design.md、
实现文档 docs/superpowers/plans/2026-04-29-phase-discipline-auto-mode-supervised-loop-implementation.md，
以及本次提交的代码变更，
使用 /code-review 进行方案重审及代码审查。
```
