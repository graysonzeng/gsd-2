---
topic: headless-auto-no-active-milestone-fail-closed
stage: design
date: 2026-05-01
size: M
---

# Headless Auto No-Active-Milestone Fail-Closed · 设计

## 0. Summary

本设计解决的是一个**headless orchestration contract** 问题，不是 phase-discipline 主 runtime 调度问题。

2026-05-01 的监督日志正确抓到了现象：`headless auto` 在“无 active milestone，仅剩 parked milestone”场景下没有正常终止，而是进入长时间 idle。  
但日志对 I-1 的主根因判断不准确：**进程并不是卡在“无人应答的 select”**，而是 headless 默认自动响应了这个 `select`，错误地选择了 `Create next milestone`，随后把 `auto` 会话引入了一个需要真实用户输入的 `discuss-milestone` 分支，最终父进程又因为 multi-turn completion contract 不完整而长期存活。

因此，修复重点应放在：

1. `headless auto` 在 unsupervised 模式下，对这类会改变控制流的 interactive `select` **不得默认选第一项**。
2. 一旦遇到这类不安全交互，headless 必须 **fail-closed**，给出明确的 machine-readable 终态，而不是静默挂住。
3. `STATE.md` 的无差异重写应停止，避免把“仍在推进”与“仅重写同内容”混淆。

本设计**不修改** `phase-discipline/*` 的 dispatch 规则，也不引入新的 runtime / wrapper。

## 1. 结论复核

### 1.1 哪些结论是合理的

- 监督日志对 **现象** 的判定是合理的：这次运行不满足“全自动验证完成”，因为既没有 loop terminal journal，也没有 headless 命令级终态退出。
- I-2 关于工具 schema 错配导致成本放大，证据成立，但它不是本次 hang 的阻塞根因。
- I-3 关于 `STATE.md` 被同内容重写、误导外部活性检测，证据成立，是独立的可观测性问题。

### 1.2 哪些结论不准确

I-1 的“等待 `select` 无人应答”不是主根因。

代码与现场证据表明：

- [`src/headless.ts`](/Users/sheng/tencent/gsd-2/src/headless.ts#L763) 在非 `--supervised` 场景下，收到 `extension_ui_request` 会直接走 `handleExtensionUIRequest(...)`。
- [`src/headless-ui.ts`](/Users/sheng/tencent/gsd-2/src/headless-ui.ts#L215) 对通用 `select` 的默认行为是**选第一个 option**。
- 现场事件流在 [`.bg-shell/auto-mode-2026-05-01.jsonl`](/Users/sheng/tencent/gsd-2/.bg-shell/auto-mode-2026-05-01.jsonl#L10) 发出 `select` 后，没有出现“等待响应”的报错或超时，而是继续进入分析、读 `.gsd/STATE.md` / `.gsd/DECISIONS.md`，最后输出 `What’s the vision?`。
- [`src/resources/extensions/gsd/guided-flow.ts`](/Users/sheng/tencent/gsd-2/src/resources/extensions/gsd/guided-flow.ts#L1647) 在 “No active milestone” 场景下，如果选择 `Create next milestone`，会 dispatch `discuss-milestone`。
- [`src/resources/extensions/gsd/prompts/discuss.md`](/Users/sheng/tencent/gsd-2/src/resources/extensions/gsd/prompts/discuss.md#L3) 明确要求先问用户 `What's the vision?`。
- [`src/headless.ts`](/Users/sheng/tencent/gsd-2/src/headless.ts#L749) 对 `auto` 这类 multi-turn command 会忽略 `execution_complete` 作为终止条件，只依赖 terminal notification；这就解释了为什么子会话首个 unit 已完成，但父进程还会长期存活。

换句话说，真正的控制流是：

1. `select` 被 **自动回答**，不是无人回答。
2. 自动回答选错了分支，把 `auto` 带进了 interactive discuss。
3. discuss unit 完成后没有形成 `auto-mode stopped ...` terminal notification。
4. headless 父进程缺少对此类“非 terminal 的 multi-turn 偏航”终止契约，于是长期 idle。

## 2. 目标与范围

### 2.1 目标

1. 让 `headless auto` 在“无 active milestone，但需要交互选择下一步”时 **fail-closed**，不再默认走 interactive discuss。
2. 给 orchestrator / CI / 监督员一个清晰、稳定、可机器解析的终态：本次停止是因为 `needs-supervised-input`，不是 provider timeout，不是 loop terminal，也不是成功完成。
3. 修正 `STATE.md` 的假心跳问题，避免外部监督者误判进度。

### 2.2 非目标

1. 不修改 `phase-discipline/*` preset、dispatch 规则、readiness guard、reviewer hook。
2. 不引入新的 auto-mode wrapper、第二 runtime、或 sidecar loop。
3. 不顺手解决 I-2 的模型工具 schema 错配问题。
4. 不把“无 active milestone”时自动创建 milestone 变成默认行为。

## 3. 规模评估

本任务判定为 **M 级**。

原因：

- 改动跨 `headless.ts`、`headless-ui.ts`、`headless-events/headless-types`、部分测试，以及 `STATE.md` 渲染写盘逻辑；
- 但问题边界明确，仍集中在 headless contract 与可观测性层，不涉及新的架构层次；
- 风险主要是行为兼容性和 CLI/orchestrator 语义，而不是大规模运行时重构。

因此本轮适合走：`design-brainstorm -> design-review`。

## 4. 方案对比

### 4.1 方案 A：在 headless 传输层 fail-closed 处理不安全交互（推荐）

核心思路：

- 保持 extension / guided-flow 的现有交互语义不变；
- 由 `headless` 自己判断“这是不是可以在 unsupervised 模式下自动回答的 UI 请求”；
- 对不安全的 `select` 直接输出结构化终态并退出，而不是默认选第一项。

优点：

- 修复点准确，直击错误控制流；
- 不把 transport 语义泄漏到 `phase-discipline` runtime；
- 对 supervised / `--answers` 场景兼容性好；
- 与 fail-closed 设计哲学一致。

缺点：

- 需要在 headless 层显式维护“哪些交互允许自动回答”的策略；
- 需要补齐新的命令级 blocked/terminal contract。

### 4.2 方案 B：新增 `--non-interactive`，默认自动选 `Not yet`

核心思路：

- 当 `headless auto` 遇到此类 `select`，自动选 `Not yet`，映射到 `no-active-milestone` 或等价终态；
- 通过新 flag 或默认策略覆盖当前“选第一项”的行为。

优点：

- 用户视角简单；
- 对“没有工作就退出”这一场景很贴近直觉。

缺点：

- 会把“真的没有工作”与“其实遇到了需要人决策的 interactive bootstrap 分叉”压成同一个终态；
- 丢失关键诊断语义，不利于监督与 CI 判断；
- 仍然没有定义“哪些交互允许自动选默认项，哪些不允许”。

### 4.3 方案 C：在 guided-flow / auto-start 里检测 `GSD_HEADLESS=1` 并直接绕开 `select`

核心思路：

- 在 extension 端一旦看到 `headless + no active milestone`，直接走 `no-active-milestone` break 或特殊 bootstrap 分支，不再发 `select`。

优点：

- 运行时路径短；
- 行为最直接。

缺点：

- 把 transport/entrypoint 语义侵入业务层；
- 后续 supervised headless、answer injection、remote question routing 会更难统一；
- 容易让同一个 guided-flow 在 TUI / supervised headless / unsupervised headless 三种模式下分叉过多。

### 4.4 选型结论

选择 **方案 A**。

理由：

- 本问题的本质不是 phase-discipline 不会停，而是 **headless 自动回答了一个本不该自动回答的 interactive `select`**；
- 所以最稳妥的修复面就是 `headless` 自己的交互策略与退出契约；
- 方案 A 还能为未来其他“interactive but unsafe” 请求提供统一处理框架。

方案 B 可以作为后续增强能力存在，但不应替代 fail-closed 主修复。方案 C 不采纳。

## 5. 详细设计

### 5.1 正确的根因模型

本次 bug 由两个条件同时成立触发：

1. **错误的默认交互策略**  
   `headless-ui` 对通用 `select` 一律选第一项；在 “No active milestone” 的 next-action UI 中，第一项恰好是 `Create next milestone`。

2. **multi-turn 终止契约不完整**  
   `headless auto` 对 `execution_complete` 不作为完成条件，必须等 `Auto-mode stopped...` 一类 terminal notification；而被误导进 `discuss-milestone` 后，这个 terminal notification 根本不会出现。

只有修掉这两个环节，才能彻底关闭这类 hang。

### 5.2 Headless 交互策略分层

给 `headless` 增加一个明确的交互分类层，而不是继续把所有 `select` 视为可自动回答。

新增内部分类概念：

1. `fire-and-forget`
   - `notify` / `setStatus` / `setWidget` / `setTitle` / `set_editor_text`
   - 保持当前行为

2. `safe-auto-response`
   - 经过明确白名单允许的交互
   - 当前唯一已知必须保留的例子，是“Auto-mode is running / Force start”这类 lock-guard prompt

3. `requires-supervision`
   - 会改变产品控制流、需要真实人类意图的交互
   - 例如 “Create next milestone / Not yet” 这种 next-action `select`

规则变更：

- unsupervised `headless auto` 遇到 `requires-supervision` 时，不再 auto-select first option；
- `--supervised` 继续把这类请求交给 orchestrator；
- `--answers` 若显式提供匹配答案，仍允许回答；
- 未命中白名单的 `select` 默认按 `requires-supervision` 处理，而不是 `safe-auto-response`。

这意味着默认策略要从“乐观自动选择”改成“保守 fail-closed”。

### 5.3 命令级 fail-closed 终态

当 unsupervised `headless auto` 遇到 `requires-supervision` 的 UI 请求时，立刻进入新的命令级停止路径。

#### 5.3.1 终态语义

- `commandStatus`: `blocked`
- `exitCode`: 使用现有 blocked 退出码 `10`
- `workflowStatus`: `unknown`
- `reason`: 新增 `needs-supervised-input`

这里**不复用** `no-active-milestone`，因为这次停止不是“已确认没有工作”，而是“继续前需要人类决策”。

#### 5.3.2 结构化输出

新增一类 headless 自身产出的结构化事件，名称建议为：

- `headless_blocked`

字段建议：

```json
{
  "type": "headless_blocked",
  "reason": "needs-supervised-input",
  "command": "auto",
  "method": "select",
  "title": "GSD — Get Shit Done",
  "options": [
    "Create next milestone (recommended): Define what to build next.",
    "Not yet: Run /gsd when ready."
  ]
}
```

目的：

- 让外部 orchestrator、CI、监督脚本不必靠 stderr 文案猜测；
- 即使 `.gsd/journal` 不会写入，也有命令级、机器可读的真相源。

#### 5.3.3 stderr / text mode 文案

text mode 要有等价可读信息，例如：

```text
[headless] Blocked: interactive request requires supervision
[headless] Reason: needs-supervised-input
[headless] Request: select "GSD — Get Shit Done"
[headless] Hint: rerun with --supervised, provide --answers, or create/unpark a milestone first
```

### 5.4 父进程完成条件补强

当前 `headless.ts` 对 multi-turn command 只信 terminal notification。新设计增加一个**第二完成源**：

- 如果 headless 自己认定发生了 `headless_blocked(reason=needs-supervised-input)`，则立即 `resolveCompletion()`；
- 不再继续等待 child session 后续是否会再发 terminal notification；
- 如 child 之后自然退出，视为已完成后的资源清理，不影响主终态。

这样可以彻底消除“首个 discuss unit 已结束，但父进程无限 idle”的状态。

### 5.5 可观测性边界

本设计明确区分两类终态：

1. **auto-loop 内部 terminal**
   - 由 `stopAuto()` / loop phase 产生
   - 写 `.gsd/journal` / `auto-loop-report.json`

2. **headless 命令级 blocked**
   - 发生在 bootstrap / guided-flow / interactive branch 还没进入真正 auto-loop 的阶段
   - 不强行伪造 `.gsd/journal` terminal
   - 事实源是 `headless_blocked` 结构化输出 + 最终 JSON 结果 + stderr

这样既能解释本次为什么没有 journal/report，也避免为了“表面一致”而把 loop 之外的失败硬塞进 loop journal。

### 5.6 `STATE.md` 假心跳修复

[`src/resources/extensions/gsd/workflow-projections.ts`](/Users/sheng/tencent/gsd-2/src/resources/extensions/gsd/workflow-projections.ts#L348) 当前每次 render 都会 `atomicWriteSync`，即使内容完全一致，也会刷新 mtime。

修复策略：

1. 渲染新内容前，若目标文件已存在，则先读取旧内容；
2. 若新旧内容完全一致，则直接 return，不写盘；
3. 只有内容变化时才执行 `atomicWriteSync`。

这会把 `STATE.md` 从“写即活性”改回“内容变化才代表状态推进”。

### 5.7 非主修复项处理

#### I-2 工具 schema 错配

不纳入本设计。

原因：

- 它放大 token/cost，但没有触发 hang；
- 根因更接近 provider/model/tool dispatch 稳定性，不属于本次 headless interactive contract。

#### “自动帮用户新建 milestone”

不纳入本设计。

原因：

- 这改变的是产品默认行为，不是修 bug；
- 在 auto validation / CI 语境下风险太高。

## 6. 关键文件与改动面

预计涉及：

- `src/headless.ts`
  - 增加 `headless_blocked` 终态分支
  - 在 multi-turn command 中接受该终态作为完成条件

- `src/headless-ui.ts`
  - 将通用 `select` 从“默认选第一项”改为“按 policy 分类后决定 auto-respond 或 fail-closed”

- `src/headless-events.ts`
  - 扩展 headless 终态 reason / status 映射（如需）

- `src/headless-types.ts`
  - 若 JSON 结果中需要暴露 `reason` 字段，则补齐类型

- `src/resources/extensions/gsd/workflow-projections.ts`
  - 跳过 `STATE.md` 的无差异重写

- 测试：
  - `src/tests/headless-v2-migration.test.ts`
  - 新增 headless interactive blocking 测试
  - `src/resources/extensions/gsd/tests/...` 中补 `STATE.md` no-op render 测试

## 7. 风险与缓解

### 7.1 风险：误伤依赖“默认选第一项”的旧 headless 场景

缓解：

- 只对 `select` 改策略，不动 `confirm` / `input` / `editor`；
- 保留已知必要白名单，例如 lock-guard 的 `Force start`；
- 用 focused tests 锁定允许继续 auto-answer 的 select 形状。

### 7.2 风险：blocked 语义与现有 `incomplete/needs-continue` 混淆

缓解：

- `needs-supervised-input` 明确映射为 `blocked`，不是 `incomplete`；
- 文档与帮助文案中说明：`blocked` 表示必须外部干预，`needs-continue` 表示可以无歧义续跑。

### 7.3 风险：外部脚本已依赖“无 active milestone 时 exit 0”

缓解：

- 这类脚本当前其实拿到的是假 hang，不是稳定 exit 0；
- 若未来确实需要“自动选 Not yet”，应作为显式 opt-in 能力单独设计，而不是继续保留错误默认值。

## 8. 验证计划

### 8.1 单元测试

1. `unsupervised headless auto` 遇到普通 `select` 时，不再选第一项，而是产出 `needs-supervised-input` blocked 终态。
2. `--supervised` 下同一 `select` 仍转发给 orchestrator，不被本地 fail-closed。
3. `--answers` 显式命中时，仍允许回答该 `select`。
4. lock-guard 的 `Force start` prompt 仍保持当前自动响应行为。
5. `STATE.md` 新旧内容一致时，不写盘、不刷新 mtime。

### 8.2 集成验证

构造与监督日志同构的项目状态：

- `Active Milestone: None`
- 仅剩 parked milestone

执行：

```bash
node dist/loader.js headless --output-format json auto
```

预期：

1. 进程在秒级退出，不再 hang；
2. `status=blocked`；
3. reason 为 `needs-supervised-input`；
4. 不再输出 `What’s the vision?`；
5. 不会误写新的 loop terminal journal。

### 8.3 回归验证

1. 已有 `headless next` / `headless query` / `headless --supervised auto` 不回归。
2. 已有 phase-discipline 正常 milestone 继续能跑到真实 loop terminal。
3. `STATE.md` 内容变化时仍正常写盘。

## 9. 关键决策

1. 本次主修复放在 `headless` 层，不改 `phase-discipline` runtime。
2. unsupervised `headless auto` 对未白名单的 `select` 默认 fail-closed，不再选第一项。
3. 新增命令级 blocked reason：`needs-supervised-input`。
4. bootstrap/guided-flow 阶段的 blocked 不伪造成 auto-loop journal terminal，而是通过 headless 结构化输出表达。
5. `STATE.md` 必须停止无差异写盘，修复假心跳。

## 10. Handoff

### 10.1 同会话继续

直接执行 $design-review 或 /design-review

### 10.2 新会话恢复 prompt

```text
请阅读设计文档 docs/superpowers/specs/2026-05-01-headless-auto-no-active-milestone-fail-closed-design.md，
使用 $design-review（或 /design-review）对该方案进行评审，分析设计方案及核心思路是否合理，
是否有遗漏需要补充，或需要推翻重新设计。
```

## 修订记录

### 2026-05-01 实现阶段修订

基于评审文档 HIGH-1 的建议，在实现中做了如下修订：

1. **白名单策略简化**：未采用 annotation-based 方式（会增加 extension 层侵入），而是在 headless 层采用"默认 block 所有 `select` + 安全标题白名单"策略。白名单仅包含 lock-guard 类 `select`（`Auto-mode is running` / `Step-mode is running`）。
2. **为什么这样做是安全的**：`showNextAction` 的 17 处调用全部走 `ctx.ui.custom()` → 当在 RPC 模式返回 undefined 时 fallback 到 `ctx.ui.select()`。这些 select 的 title 字段（如 "GSD — Get Shit Done"、"GSD — M01: Build Auth"、"GSD — Interrupted Session Detected"）与 lock-guard title（"Auto-mode is running..."）无一重叠。因此默认 block 不会误伤任何非白名单场景。
3. **auto-loop 内部不受影响**：auto-loop 内部的 dispatch 不经过 `showNextAction` UI——它由 `resolveDispatch` → 直接调用 execution，不走 select 交互。只有 `showSmartEntry`（即 `/gsd` 入口）和 `showDiscuss` 等入口才需要 select 交互。
4. **MEDIUM-2 采纳**：`headless_blocked` 在 `stream-json` 模式下作为独立事件行输出。
5. **MEDIUM-3 部分采纳**：headless 在 block 时向 child session 发送 `cancelled` 响应，child 将自然退出。
