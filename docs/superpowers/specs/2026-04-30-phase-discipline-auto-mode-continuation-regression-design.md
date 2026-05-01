---
topic: phase-discipline-auto-mode-continuation-regression
stage: design
date: 2026-04-30
size: L
linked_previous_design: docs/superpowers/specs/2026-04-29-phase-discipline-auto-mode-supervised-loop-design.md
linked_run_log: docs/superpowers/plans/2026-04-29-phase-discipline-auto-mode-supervised-loop-run-log.md
---

# Design: phase-discipline auto-mode continuation regression

- Date: 2026-04-30
- Status: Draft
- Scope: L

## 1. 设计目标和范围

### 1.1 要解决的问题
- 在 `M005 / S02 / T01` 本应继续执行的场景下，auto-mode 实际回退到 `discuss-milestone`，随后又错误访问根级 `.gsd/ROADMAP.md`，最终进一步退回用户访谈模式。
- 本设计要解决的不是单一报错，而是把 **continuity 决策、dispatch 恢复规则、artifact 路径解析、supervised continuation 边界** 四者重新对齐。

### 1.2 成功标准
- 当 continuity 已明确指向 `execute-task` 时，执行入口不会因为错误的 context / path 判定把流程误打回 `discuss-milestone`。
- milestone / slice / task artifact 查找统一走 canonical、milestone-scoped 路径，不再访问根级 `.gsd/ROADMAP.md` 这类旧路径。
- supervised continuation 场景下，若发现内部状态不一致，系统 fail-closed 报告内部问题，而不是重新进入用户访谈模式。
- 新增验证能稳定复现并覆盖本次回退链路，避免以后只能靠人工看 journal 猜原因。

### 1.3 本次范围
- 收敛 continuation regression 的根因链。
- 设计 execution-entry 恢复规则、artifact path resolver、supervised guard 的修复边界。
- 定义最小测试与回归验证策略。

### 1.4 非目标
- 不重构整个 auto-mode loop。
- 不新增第二套 runtime、wrapper scheduler 或 sidecar supervisor。
- 不在本设计中处理与本次回退无关的 phase-discipline 策略优化。
- 不直接修改 milestone 内容来规避问题。

## 2. 背景与约束
- 当前真实运行证据来自 `docs/superpowers/plans/2026-04-29-phase-discipline-auto-mode-supervised-loop-run-log.md`、`.gsd/journal/2026-04-29.jsonl`、`.gsd/journal/2026-04-30.jsonl`。
- 既有测试已证明存在一条明确的 execution-entry recovery 规则：当 milestone `CONTEXT.md` 缺失时，dispatch 会回退到 `discuss-milestone`。
- milestone artifact 的现代规范路径已经是 milestone-scoped，如 `.gsd/milestones/M005/M005-ROADMAP.md`，而不是根级 `.gsd/ROADMAP.md`。
- v1 监督协议是 `observe + classify + safe-resume only`。因此 continuation 失败时必须优先 fail-closed 保证证据可信，而不是重新访谈用户扩散副作用。
- 设计必须遵守已有 discipline：不新增 overlay runtime，不把控制权拆成第二事实源。

## 3. 根因分析

### 3.1 是否需要根因分析
- 需要。
- 理由：当前故障不是简单路径 typo，而是会影响修复边界选择的回归链。若不先区分“真实缺 context”“解析视角错误”“supervised 语义丢失”，就很容易只修表象，留下主故障。

### 3.2 已确认事实
- `continuity-decision` 与实际 dispatch 明确冲突：journal 已给出下一步应为 `execute-task T01`，但实际 `dispatch-match` 是 `execution-entry phase (no context) → discuss-milestone`。证据见运行日志与 `.gsd/journal/2026-04-30.jsonl`。
- 这条回退规则真实存在且已有测试覆盖：缺少 milestone `CONTEXT.md` 时，dispatch 会回退到 `discuss-milestone`。证据见 `src/resources/extensions/gsd/tests/execution-entry-missing-context-4671.test.ts`。
- canonical milestone artifact 路径应为 milestone-scoped / worktree-aware，而不是根级文件。证据见 `src/resources/extensions/gsd/tests/canonical-milestone-artifacts.test.ts`。
- 实际运行中存在 `.gsd/milestones/M005/M005-ROADMAP.md`，但会话仍尝试访问 `.gsd/ROADMAP.md`。证据见运行日志中的 Incident 2。代码核对后应把该事实定位为 `discuss-milestone` 回退后的 prompt / downstream discussion 组装链路问题，而不是 `worktree-manager.ts` canonical resolver 本身的问题：canonical resolver 构造的是 `.gsd/milestones/<MID>/<MID>-*.md`。
- retry session 起草了新的 `ask_user_questions`，说明会话没有把当前 M005 视为“已澄清的 continuation 上下文”。证据见运行日志中的 Incident 3。

### 3.3 未确认假设
- `M005-CONTEXT.md` 在 retry session 视角下可能是真缺失，也可能存在但当前 `basePath` / worktree / resolver 组合看不到。区分方法不能只看 boolean，应让 context visibility resolver 返回 canonical 路径、legacy/root fallback 路径、检查过的 lookup bases 与内容状态。
- 根级 `.gsd/ROADMAP.md` 的访问最可能来自 `buildDiscussMilestonePrompt` 触发后的 guided discussion prompt / downstream discussion 分支，而不是 canonical milestone artifact resolver；实现应优先修 prompt 组装层的路径提示与回退入口，而不是在 `worktree-manager.ts` 上加错误限制。
- supervised continuation 的语义丢失方向收敛为：先有上一轮 `continuity-decision` 指向具体执行单元，随后本轮 dispatch 因 missing finalized context recovery 回退到 `discuss-milestone`；因此 guard 应放在 execution-entry recovery rule 内，阻止该回退把内部状态不一致包装成用户访谈。

### 3.5 `hasFinalizedMilestoneContext` 在 continuation 会话中返回 false 的原因分析
- 直接触发点是 `auto-dispatch.ts` 的 `execution-entry phase (no context) → discuss-milestone` 规则调用 `hasFinalizedMilestoneContext(basePath, mid)`；该函数在 `uok/plan-v2.ts` 中只返回 boolean，丢失了“查过哪里、canonical 是否存在、是否只有 legacy/root fallback 存在、是否为空白”的诊断信息。
- 当前 `hasFinalizedMilestoneContext` 通过 `getArtifactLookupBases(basePath)` 检查 `basePath` 与可选 `GSD_PROJECT_ROOT`，每个 base 再调用 `resolveMilestoneFile(candidateBase, milestoneId, "CONTEXT")`。因此返回 false 的候选原因是：
  1. canonical milestone-scoped `M005-CONTEXT.md` 真实不存在；
  2. 文件存在但为空白，`hasFileContent` 按 missing 处理；
  3. 文件存在于 live worktree canonical root，但当前 lookup bases 没有经过 `resolveCanonicalMilestoneRoot`；
  4. 只存在根级旧路径 `.gsd/CONTEXT.md` / `.gsd/context.md`，不应被视为 finalized milestone context。
- 修复前置条件：把 boolean helper 扩展为可诊断 resolver。`hasFinalizedMilestoneContext` 可以保留兼容 boolean，但应委托新函数 `resolveFinalizedMilestoneContextVisibility(basePath, milestoneId)`；后者返回三类主状态：
  - `present`：canonical milestone-scoped artifact 存在且非空；
  - `missing`：canonical 路径和允许的 lookup bases 都不存在非空 artifact；
  - `path-conflict`：canonical 视角未找到非空 artifact，但检测到 root-level / legacy fallback 或 lookup base 与 canonical base 不一致等冲突信号。

### 3.4 对设计的影响
- 不能把问题简化成“补一个 roadmap 路径判断”或“补生成 CONTEXT.md”；否则只会修掉次级症状。
- 修复方案必须区分三类情况：真实 artifact 缺失、canonical path 解析错误、continuation 语义丢失，并给出不同处理路径。
- supervised 模式需要独立 guard；一旦 continuity 已指向具体执行单元，后续内部恢复失败应报告内部不一致，而不是退回用户澄清流程。

## 4. 方案对比

### 4.1 方案 A：局部补丁式修复
- 核心思路：分别修 execution-entry 的 context 判断、根级 `.gsd/ROADMAP.md` 的错误访问，以及 supervised 场景重新提问的问题。
- 优点：改动面较小，短期止血快。
- 缺点：三个点各修各的，continuation 语义仍然分散；以后很容易在别的 artifact 或别的恢复分支上再次出现“表象变了、故障没变”。
- 适用前提：确认本次只是孤立回归，且系统内不存在更多旧路径 / 非 canonical 分支。

### 4.2 方案 B：统一 continuation contract
- 核心思路：把 continuation 恢复判定拆成统一的三层语义：
  1. **continuity target**：下一步应该执行什么；
  2. **artifact visibility**：当前 milestone / slice / task 所需 artifact 是否在 canonical 路径上可见；
  3. **supervised policy**：若 1 与 2 不一致，是否允许回退、还是必须 fail-closed。
- 优点：能一次性把 dispatch、artifact lookup、supervised 恢复边界对齐；更适合补可回归测试。
- 缺点：需要同时触及 dispatch 规则、artifact resolver 使用点和 supervised guard，设计与测试更严谨。
- 适用前提：接受这不是孤立 typo，而是一类 continuation 语义未统一的问题。

### 4.3 选型结论
- 选择：**方案 B**。
- 理由：当前最值钱的不是“快点让这轮不报错”，而是把 continuation 的判定语义收敛成单一事实源。否则修完 `.gsd/ROADMAP.md` 后，`execute-task → discuss-milestone` 仍可能继续复发。

## 5. 详细方案

### 5.1 核心思路
- 保留已有 continuity 决策机制，但把 execution-entry 的恢复判断改成基于可诊断 canonical artifact visibility，而不是只依赖 boolean 路径探测。
- 修复靶点分两层：
  - `uok/plan-v2.ts`：新增 context visibility resolver，让 `hasFinalizedMilestoneContext` 和 dispatch recovery 使用同一个诊断来源；
  - `auto-dispatch.ts` / `auto-prompts.ts`：在 execution-entry recovery 里消费该诊断，并确保 `buildDiscussMilestonePrompt` 给出的 artifact 路径是 milestone-scoped，避免 downstream discussion 再访问根级 `.gsd/ROADMAP.md`。
- 在 execution-entry recovery rule 内增加“continuation 一致性检查”：当 `session.lastContinuityDecision` 指向 `execute-task` / `evaluate-gates` / `validate-milestone` / `complete-milestone` 等执行单元时，若 finalized context visibility 不是 `present`，则把它视为 continuation target 与 artifact visibility 不一致。
- 对 supervised continuation 增加 fail-closed guard：若当前会话是 continuation，且 artifact 可见性与 continuity target 冲突，则上报 internal inconsistency，不回退到用户访谈。
- roadmap / context / validation / summary 等 milestone artifact 的 prompt 路径提示统一使用 milestone-scoped helpers；本次不在 `worktree-manager.ts` canonical resolver 层禁止根级 `.gsd/<ARTIFACT>.md`，因为评审已确认 resolver 本身不是根级 ROADMAP 访问来源。

### 5.2 关键数据流 / 控制流
1. `LoopContinuityCoordinator` 已把上一阶段决策保存在 `AutoSession.lastContinuityDecision`，其中包含 `nextUnitType`、`nextUnitId`、`nextAction`。
2. `auto-dispatch.ts` 的 `execution-entry phase (no context) → discuss-milestone` 规则进入时调用 `resolveFinalizedMilestoneContextVisibility(basePath, mid)`，返回：
   - `status: "present"`：含 `path`、`canonicalPath`、`basePath`；
   - `status: "missing"`：含 `canonicalPath`、`checkedBases`、`reason`；
   - `status: "path-conflict"`：含 `canonicalPath`、`conflictingPath`、`conflictKind`、`checkedBases`。
3. `path-conflict` 的操作化定义是：canonical milestone-scoped 路径没有非空 finalized context，但 resolver 同时发现下列至少一种冲突信号：
   - live worktree canonical root 与当前 lookup base 不同，且 artifact 只在另一个视角可见；
   - 根级 `.gsd/CONTEXT.md` / legacy bare context 存在，容易被误当 milestone context；
   - resolver 返回的实际路径不在 `.gsd/milestones/<MID>/` 下。
4. `auto-dispatch.ts` 用 `isContinuationTarget(session.lastContinuityDecision)` 判断是否为 continuation guard entry：上一轮 decision 是 auto-resumable continue/retry，且 `nextUnitType` 属于执行入口单元集合。
5. 若 visibility 为 `present`，execution-entry recovery rule fall through，后续正常 dispatch `execute-task` / `complete-slice` / `validate-milestone`。
6. 若 visibility 不是 `present`：
   - 非 continuation：保留 #4671 既有 recovery，允许回退 `discuss-milestone`；
   - continuation：返回 `DispatchAction.stop`，level=`error`，reason 包含 `internal inconsistency`、expected next unit、visibility status、canonical path、conflicting path / checked bases；不调用 `buildDiscussMilestonePrompt`，因此不会触发 `ask_user_questions`。
7. `buildDiscussMilestonePrompt` 在合法 discussion 场景中显式传入 milestone-scoped roadmap/context 路径提示，避免 guided discussion prompt 或 downstream branch 继续使用根级 `.gsd/ROADMAP.md`。

### 5.3 接口 / 配置 / 数据结构变更
- 接口：
  - 不新增对外 CLI 命令。
  - 允许在内部 dispatch / status 流程中引入统一的 continuation artifact resolution helper。
- 配置：
  - 不新增用户可配置项。
  - supervised 行为继续由既有运行模式决定，但内部 guard 语义更严格。
- 数据结构：
  - 可考虑在 continuity / dispatch 上下文里显式带上“expected artifact kind / canonical base”这一类内部字段，减少下游二次猜测。
  - 若新增内部诊断结构，应优先写入 journal / status 供定位，而不是新增外部持久协议。

### 5.4 错误处理与回退策略
- 非 continuation 的真实缺失：保留 #4671 既有 recovery，允许回退到 `discuss-milestone`。
- continuation 下的 visibility mismatch：不再区分“真实缺失 / 解析视角错位 / continuation 语义丢失”三个 fail-closed 分支；统一作为 `continuation artifact visibility mismatch` 内部一致性错误处理。
- fail-closed 后的系统行为：
  - `resolveDispatch` 返回 `DispatchAction.stop`，`level: "error"`；
  - `runDispatch` 现有 `dispatch-stop` journal 事件记录 matched rule 与 reason；
  - `closeoutAndStop` 停止 auto-mode，保留当前工作树与 `.gsd` artifacts；
  - UI / headless 输出包含内部不一致 reason、expected next unit、canonical path 与 checked bases；
  - 不构造 `discuss-milestone` prompt，不调用 `ask_user_questions`，不把内部状态不一致包装成用户缺信息。

### 5.5 风险与缓解
- 风险：把真正合法的缺 context 场景也误判为内部错误。
  - 缓解：保留“非 supervised + 首次执行前缺 context”这一显式允许回退的分支，并补针对性测试。
- 风险：只统一 milestone artifact，漏掉 slice / task artifact 分支。
  - 缓解：测试覆盖 milestone、slice、task 三层 canonical lookup，而不只测 ROADMAP 一种文件。
- 风险：修复后只在单一路径生效，status / discussion / verification 仍有旧 helper。
  - 缓解：把 resolver 使用点列表化，在代码审查时逐项核对。

## 6. 验证计划
- 单测：
  - 当 continuity 已指向 `execute-task` 且 milestone context 在 canonical 路径可见时，execution-entry 不得回退到 `discuss-milestone`。
  - 当 continuity 已指向 `execute-task` 且 finalized context visibility 为 `missing` / `path-conflict` 时，execution-entry recovery 应返回 error stop，而不是 dispatch `discuss-milestone`。
  - context visibility resolver 应分别覆盖 `present`、`missing`、`path-conflict` 三种返回状态，包括 root-level legacy context 冲突和 canonical worktree/basePath 视角冲突。
  - `buildDiscussMilestonePrompt` 的合法 discussion prompt 应包含 milestone-scoped roadmap/context 路径，不应提示根级 `.gsd/ROADMAP.md`。
  - supervised continuation 模式下，内部一致性错误不得触发 `ask_user_questions`。
- 集成验证：
  - 用固定 `.gsd` 树和 journal 前置条件做最小 replay harness，复现 `S02/T01 → discuss-milestone → roadmap ENOENT → ask_user_questions` 链路。
  - 修复后重放同一 harness，断言流程留在 continuation 语义内。
- 手工验证：
  - 复核 `.gsd/milestones/<MID>/<MID>-ROADMAP.md`、`<MID>-CONTEXT.md`、slice/task plan artifact 在 worktree 与主树两种视角下的可见性。
- 构建验证：
  - 运行相关测试、typecheck、构建，确保没有引入新的 resolver 回归。

## 7. 关键决策摘要
- 把本次故障定义为 continuation contract 未统一，而不是单一路径 typo。
- 选择统一 continuation contract，而不是三个点各修各的局部补丁。
- 把 supervised continuation 的错误恢复策略定为 fail-closed，不允许重新进入用户访谈模式。
- 把最小 replay harness 视为本次修复的必要验证资产，而不是可选补充。

## 8. 修订记录
- 2026-04-30：根据设计评审修订 HIGH-1~3 与 MEDIUM-1~4：
  - 将根级 `.gsd/ROADMAP.md` 来源修正为 prompt / discussion 组装链路，而不是 canonical resolver；
  - 操作化定义 context visibility resolver 的 `present` / `missing` / `path-conflict` 三态；
  - 新增 §3.5 分析 `hasFinalizedMilestoneContext` 返回 false 的候选原因与修复前置条件；
  - 调整 §5.2 控制流到具体文件/函数，简化 continuation fail-closed 分支，并补充 journal、UI、exit reason 行为；
  - 修正 §6 中基于错误归因的根级 ROADMAP 测试描述。

## 9. Handoff

### 9.1 同会话继续
`直接执行 /design-review`

### 9.2 新会话恢复 prompt
```text
请阅读设计文档 docs/superpowers/specs/2026-04-30-phase-discipline-auto-mode-continuation-regression-design.md，
使用 /design-review 对该方案进行评审；若文档包含根因分析，
请一并分析根因判断、证据与设计方案是否正确、合理，以及两者是否一致。
```
