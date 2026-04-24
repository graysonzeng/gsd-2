# Phase-Discipline 下一会话续接简报

## 一句话目标

继续 `phase-discipline seeded-auto` 真实验证，但**不要再重复排查 `model_not_found` / blocklist 逻辑**；该链路已经验证通过。下一步直接定位并修复：

- `resumeAutoAfterProviderDelay()` / `startAuto()` 之后，为什么会出现 `s.cmdCtx.newSession is not a function`

## 可直接用于新会话的短 Prompt

```text
继续 /Users/sheng/tencent/gsd-2 的 phase-discipline seeded-auto 后续验证。

已确认并真实验证：zhumuai 的 `model_not_found / No available channel for model ... under group ...` 现在会被正确识别为 `unsupported-model`，自动写入项目级 blocked-models.json，并自动 pause + auto-resume；旧的 900s idle hang 已解除。

不要重复排查 model_not_found、blocklist 或 phase-discipline/* runtime 主实现；也不要重开 new-milestone 主线，不要落盘 secret。

请直接聚焦定位并修复新的 blocker：`Session creation failed: s.cmdCtx.newSession is not a function`。重点检查 `resumeAutoAfterProviderDelay()` -> `startAuto()` -> session creation 路径，以及 resume 后 `s.cmdCtx` 的来源、生命周期和类型是否丢失或被错误替换。

修复后，继续用同一套 isolated repo + 临时 HOME + stable project symlink 模板重跑 headless auto，并补齐 verify-fuse / complete-milestone / findings-to-memories 的产物级证据。
```

## 本轮已确认结论

### 1. 原始 blocker 已解除

本轮已经证明：

- zhumuai 返回的
  - `model_not_found`
  - `No available channel for model ... under group ...`
- 现在会被归类为 `unsupported-model`
- 运行时会自动：
  - block 坏模型
  - 写入项目级 `blocked-models.json`
  - pause
  - auto-resume 一次

因此，旧问题已从：

- `model_not_found` 导致 `research-slice M002/S02` 卡住，最终 900s timeout、0 tool calls

推进为：

- `model_not_found` 被自动恢复链正确处理，不再是当前主 blocker

### 2. 新 blocker 已明确

auto-resume 之后，真实运行进入新的错误：

- `Session creation failed transiently for research-slice M002/S02: Session creation failed: s.cmdCtx.newSession is not a function`

这说明当前真正阻塞继续验证的原因，已经切换到：

- **resume 后 session creation 路径异常**

## 本轮代码改动范围

仅修改了通用恢复层和测试，**没有修改 `phase-discipline/* runtime` 主实现**。

### 修改文件

- `src/resources/extensions/gsd/error-classifier.ts`
- `src/resources/extensions/gsd/bootstrap/agent-end-recovery.ts`
- `src/resources/extensions/gsd/auto-model-selection.ts`
- `src/resources/extensions/gsd/tests/provider-errors.test.ts`
- `src/resources/extensions/gsd/tests/auto-model-selection.test.ts`

### 改动意图

- `error-classifier.ts`
  - 让 zhumuai 的 `model_not_found` 文案命中 `unsupported-model`
- `agent-end-recovery.ts`
  - block 坏模型后不再只提示手工 restart，而是自动 resume 一次
- `auto-model-selection.ts`
  - synthesized dynamic routing 时，跳过 blocked model
  - routed candidates 耗尽时，回退到 `autoModeStartModel`
- 测试
  - 锁住上面两个默认修复行为，避免回归

## 已完成验证

以下验证已通过：

- `node --import ./src/resources/extensions/gsd/tests/resolve-ts.mjs --experimental-strip-types --test src/resources/extensions/gsd/tests/provider-errors.test.ts src/resources/extensions/gsd/tests/auto-model-selection.test.ts`
- `npm run typecheck:extensions`
- `npm run build:core`

## 真实运行证据

### 本轮 headless run 的关键现象

在新的 seeded stable project 上执行真实验证后，输出明确显示：

1. 命中坏模型：
   - `anthropic/claude-3-5-haiku-20241022`
2. 立即 block：
   - `Blocked anthropic/claude-3-5-haiku-20241022 for this project`
3. 自动恢复：
   - `Re-dispatching with blocked-model recovery.. Auto-resuming in 1s...`
   - `Server error recovery delay elapsed. Resuming auto-mode.`
   - `Auto-mode resumed.`
4. 随后切换到新的 blocker：
   - `Session creation failed: s.cmdCtx.newSession is not a function`

### 产物证据路径

当前这轮真实运行的关键产物位于临时 HOME 映射的 project 目录下：

- `runtime/blocked-models.json`
- `journal/2026-04-24.jsonl`
- `notifications.jsonl`

本轮读取到的关键内容包括：

- `runtime/blocked-models.json` 已包含：
  - `provider: anthropic`
  - `id: claude-3-5-haiku-20241022`
- `journal/2026-04-24.jsonl` 已包含两次关键 `unit-end`：
  - 第一次：`category: provider`, `isTransient: true`, message 含 `Re-dispatching with blocked-model recovery.`
  - 第二次：`category: session-failed`, `isTransient: true`, message 为 `Session creation failed: s.cmdCtx.newSession is not a function`

## 运行环境与约束

### 仓库与路径

- 主仓：`/Users/sheng/tencent/gsd-2`
- isolated repo：`/Users/sheng/tencent/gsd-phase-discipline-auto-56G8jS`

### 继续验证的约束

- 不重开 `new-milestone` 主线
- 不修改 `phase-discipline/* runtime` 主实现，除非新 blocker 明确要求触及通用 auto/session 恢复逻辑
- 不落盘 secret
- 继续用临时 HOME + 临时 provider 配置 + stable project symlink 模板

## 推荐下一步

### 第一优先级

定位 `s.cmdCtx.newSession is not a function`：

- 检查 `resumeAutoAfterProviderDelay()` 调 `startAuto()` 时传入的 `ctx`
- 检查 `startAuto()` 在 resume 路径上是否重建了一个不完整的 `s.cmdCtx`
- 检查 `s.cmdCtx` 是否被 `ExtensionContext` / `ExtensionCommandContext` 混用
- 检查 auto-resume 后 `sessionManager` / `newSession` 所需对象是否只在初始 command context 存在

### 第二优先级

修复后继续真实验证：

- 仍用相同隔离模板重跑 `headless auto`
- 目标是重新进入 `research-slice M002/S02`
- 确认是否能继续推进到：
  - `verify-fuse`
  - `complete-milestone`
  - `findings-to-memories`

### 第三优先级

如果 session-resume 修复后 provider 仍不稳定，再将这轮新 blocker与验证结果补写回：

- `docs/superpowers/plans/2026-04-24-phase-discipline-auto-mode-validation-findings.md`
- `docs/superpowers/plans/2026-04-24-phase-discipline-next-session-handoff.md`

## 建议先读的文件

新会话建议优先读这些文件：

- `docs/superpowers/plans/2026-04-24-phase-discipline-next-session-handoff.md`
- `docs/superpowers/plans/2026-04-24-phase-discipline-auto-mode-validation-findings.md`
- `src/resources/extensions/gsd/bootstrap/provider-error-resume.ts`
- `src/resources/extensions/gsd/bootstrap/agent-end-recovery.ts`
- `src/resources/extensions/gsd/auto.ts`
- `src/resources/extensions/gsd/auto-start.ts`
- `src/resources/extensions/gsd/auto/phases.ts`
- `src/resources/extensions/gsd/auto-model-selection.ts`

## 当前任务状态

- `model_not_found` 默认修复：**已完成并真实验证**
- blocked-model 自动恢复链：**已完成并真实验证**
- M002 后续 full flow：**未完成，当前被 `newSession` blocker 截断**
- 下一会话的核心目标：**修 session-resume 路径，再继续验证**
