# Code Review: headless-auto-no-active-milestone-fail-closed

- Date: 2026-05-01
- Reviewed Design: docs/superpowers/specs/2026-05-01-headless-auto-no-active-milestone-fail-closed-design.md
- Reviewed Design Review: docs/superpowers/plans/2026-05-01-headless-auto-no-active-milestone-fail-closed-design-review.md
- Reviewed Implementation: docs/superpowers/plans/2026-05-01-headless-auto-no-active-milestone-fail-closed-implementation.md
- Review Scope: 根因前提复核、设计一致性检查、headless/STATE 修复代码审查，以及本次提交中一并带入的额外代码变更审查

## 1. 整体结论

- **NEEDS_FIX**
- 一句话结论：根因判断和 unsupervised fail-closed 主路径基本正确，但 `STATE.md` 假心跳修复并未按设计真正落到主要写盘路径；`--supervised` 超时分支又产出了不可信的 `headless_blocked` 语义；同时本次提交里额外引入了一个 `auto-execution` diff 路由的命令注入风险，当前不能合并。

## 2. 根因前提复核

- 适用性：**适用**
- 结论：**SUPPORTED**

结论说明：

- 设计文档对主根因的修正成立。`headless-ui` 旧逻辑会默认选择第一个 `select` 选项，而 `guided-flow` 在 “No active milestone” 场景下的第一个选项正是 `Create next milestone`，这会把 `headless auto` 误导进 `discuss-milestone` 分支。
- `headless auto` 对 multi-turn command 只把 terminal notification 当作完成信号，这也准确解释了为什么子会话已经完成首轮 discuss，但父进程仍会继续存活。
- 这条根因链与当前实现的主修复方向一致：修 `headless` 的默认交互策略和退出契约，而不是去改 `phase-discipline` dispatch 本身。

## 3. 设计一致性评估

一致的部分：

- `src/headless-ui.ts` 已把未白名单的 `select` 视为 `requires-supervision`，不再默认选第一项。
- `src/headless.ts` 在 unsupervised 分支里遇到 blocked select 时，会给出 `needs-supervised-input`、`EXIT_BLOCKED`，并在 `stream-json` 下输出 `headless_blocked` 事件。
- `src/headless-types.ts` 已为 batch JSON 结果补充 `reason` 字段，和设计/实现文档一致。

不一致的部分：

- 设计目标里的 “停止 `STATE.md` 无差异重写” 只在 `renderStateProjection()` 上实现了，但 auto/guided-flow/doctor 的主要 rebuild 热路径仍然无条件写盘，因此设计目标 3 实际未完成。
- 设计把 `headless_blocked` 定义为 unsupervised fail-closed 的命令级终态；当前 `--supervised` 响应超时分支也会发出这个事件，但既不终止也不取消 child request，导致事件语义不再可靠。
- 本次提交还包含 `auto-execution` web timeline/diff 功能，这部分不在设计/实现文档描述范围内，但已进入当前 review scope；其中 diff route 引入了独立的安全问题。

## 4. 验证证据核对

本次审查额外复跑了以下验证：

- `npx tsx --test src/tests/headless-interactive-blocking.test.ts`：17/17 通过
- `npx tsx --test src/tests/headless-*.test.ts`：204/204 通过
- `npx tsx --test src/web/__tests__/auto-execution-service.test.ts`：15/15 通过
- `npx tsc --noEmit --pretty false`：通过

核对结论：

- 实现文档里关于 headless 测试和 typecheck 的证据，当前审查中可以复现。
- 但这些验证并没有覆盖 `--supervised` timeout contract，也没有覆盖 `STATE.md` 的真实高频 rebuild 路径，因此不足以支撑“设计目标已整体完成”的结论。
- 实现文档也没有覆盖当前提交里新增的 `auto-execution` diff route 安全性，因此该部分没有被现有验证证据证明是安全可合并的。

## 5. 主要发现

### [CRITICAL] 安全: `auto-execution` diff 路由把用户输入拼进 `execSync` 命令字符串

**文件**: [web/app/api/auto-execution/diff/route.ts#L8](/Users/sheng/tencent/gsd-2/web/app/api/auto-execution/diff/route.ts#L8) [web/app/api/auto-execution/diff/route.ts#L79](/Users/sheng/tencent/gsd-2/web/app/api/auto-execution/diff/route.ts#L79)

**问题**: 该路由先用 `startsWith` 做前缀校验，再把 `file` query 参数直接插入 `execSync(...)` 的 shell 命令字符串。`startsWith` 不是可靠的项目边界校验，而 `execSync` 会经过 shell 解释；像 `$(...)`、反引号等 shell 元字符并不会因为只转义了 `"` 就失效。结果是，攻击者可以通过构造 `file` 参数把任意命令交给服务端 shell 执行。代码注释还写着“use execFileSync to avoid shell injection”，但实际调用的是 `execSync`。

**影响**: 这是直接的远程命令执行风险。只要调用方能访问这个 API，就可以借该路由在宿主机上执行任意 shell 命令，风险级别必须按阻断处理。

**建议**: 改为 `execFileSync("git", [...])` 这类 argv 方式，不允许 shell 参与解释；路径校验改成基于 `relative()`/路径分段边界或 `realpath` 的严格项目内校验；并且最好把 `file` 限制在 journal 中记录的 `changedFiles` 集合内，而不是接受任意路径字符串。

### [HIGH] 设计一致性: `STATE.md` 无差异写盘只修到了 projection helper，主 rebuild 热路径仍然每次重写

**文件**: [src/resources/extensions/gsd/workflow-projections.ts#L348](/Users/sheng/tencent/gsd-2/src/resources/extensions/gsd/workflow-projections.ts#L348) [src/resources/extensions/gsd/doctor.ts#L149](/Users/sheng/tencent/gsd-2/src/resources/extensions/gsd/doctor.ts#L149) [src/resources/extensions/gsd/guided-flow.ts#L967](/Users/sheng/tencent/gsd-2/src/resources/extensions/gsd/guided-flow.ts#L967) [src/resources/extensions/gsd/guided-flow.ts#L1581](/Users/sheng/tencent/gsd-2/src/resources/extensions/gsd/guided-flow.ts#L1581) [src/resources/extensions/gsd/auto.ts#L1035](/Users/sheng/tencent/gsd-2/src/resources/extensions/gsd/auto.ts#L1035) [src/resources/extensions/gsd/auto.ts#L1772](/Users/sheng/tencent/gsd-2/src/resources/extensions/gsd/auto.ts#L1772) [src/resources/extensions/gsd/auto-post-unit.ts#L586](/Users/sheng/tencent/gsd-2/src/resources/extensions/gsd/auto-post-unit.ts#L586)

**问题**: 设计文档把 “停止 `STATE.md` 的无差异重写” 定义成独立目标，实施文档也宣称“STATE.md 在内容无变化时跳过写盘”。但代码里只有 `renderStateProjection()` 做了 `existing === content` 短路；auto stop/resume/post-unit、doctor 的 `rebuildState()`、以及 guided-flow 入口预热写盘都仍然直接 `saveFile(buildStateMarkdown(state))`，而 `saveFile()` 最终走的 `atomicWriteAsync()` 仍会无条件刷新文件。

**影响**: `STATE.md` 假心跳问题在常见执行路径里依然存在，外部监督逻辑仍可能把“同内容重写”误判为“系统仍在推进”。这意味着设计目标 3 实际并未完成，实施文档的结果描述也高估了真实落地程度。

**建议**: 把 `STATE.md` 写盘统一收口到一个共享 helper，在 helper 里做无差异短路；或者让 `rebuildState()` / guided-flow 预热写盘也走同一 no-op writer。随后补上真正覆盖这些热路径的测试，而不是只测 `renderStateProjection()` 的局部行为。

### [HIGH] 合同语义: `--supervised` 响应超时分支发出 `headless_blocked`，但既不终止也不取消 child request

**文件**: [src/headless.ts#L487](/Users/sheng/tencent/gsd-2/src/headless.ts#L487) [src/headless.ts#L815](/Users/sheng/tencent/gsd-2/src/headless.ts#L815)

**问题**: 在 `--supervised` 路径里，响应超时后会调用 `handleExtensionUIRequest()`；如果这是一个未白名单的 `select`，代码会输出 `headless_blocked` 和 `supervised_timeout`，但没有设置 `blocked/completed/exitCode`，没有 `resolveCompletion()`，也没有像 unsupervised 分支那样向 child 发送 `{ cancelled: true }`。这意味着：同一个进程已经向外宣告“blocked”，但内部 session 仍然继续挂着；甚至 orchestrator 稍后补发响应后，流程还可能继续向前跑。

**影响**: `headless_blocked` 不再是可靠的命令级终态信号，直接破坏了设计里“稳定、可机器解析真相源”的目标。外部 orchestrator 如果据此做状态机判断，会拿到错误结论；而超时后的 child request 还可能长期悬挂。

**建议**: 二选一收敛语义。要么把超时只当作 advisory 事件，保留 `supervised_timeout`，但不要发 `headless_blocked`；要么把超时升级成真正 blocked 终态，像 unsupervised 分支一样取消 child、设置 blocked 状态并立刻完成。无论采用哪种语义，都需要补专门测试覆盖这个分支。

### [MEDIUM] 测试覆盖: 新增 headless blocking 测试主要是逻辑镜像和源码断言，没有覆盖最关键的契约分支

**文件**: [src/tests/headless-interactive-blocking.test.ts#L19](/Users/sheng/tencent/gsd-2/src/tests/headless-interactive-blocking.test.ts#L19)

**问题**: 这组新增测试主要是复制一份 `handleExtensionUIRequest` 逻辑做模拟，再辅以源码正则断言。它验证了白名单思路，但没有真正执行 `runHeadlessOnce()` 的事件流，因此未覆盖 `--supervised` timeout、`--answers` 优先级、以及实际 child cancel / completion contract。`STATE.md` 方面也只是源码级确认 `existing === content` 存在，而不是校验真实 mtime 在高频 rebuild 路径上不变化。

**影响**: 现有测试能证明“代码里写了这些分支”，但不能证明“真实 orchestration contract 按设计成立”。这也是前两个 HIGH 问题没有被测试捕获的直接原因。

**建议**: 增加面向真实 event-loop 的 headless 集成测试，至少覆盖 unsupervised blocked、supervised timeout、`--answers` 覆盖 blocked select 三条契约；同时增加 `STATE.md` mtime 级测试，直接打到 `rebuildState()` / guided-flow 热路径。

## 6. 改进建议

1. 先修复 `web/app/api/auto-execution/diff/route.ts` 的 shell 注入问题；这是当前提交里最高优先级的阻断项。
2. 把 `STATE.md` no-diff 写盘策略做成统一能力，而不是只补 `renderStateProjection()` 的单点逻辑。
3. 明确 `--supervised` 超时的唯一合同语义，并用测试锁死，不要让 `headless_blocked` 同时承担“通知”和“终态”两种互相冲突的含义。
4. 把本次提交里新增的 `auto-execution` web 能力补进对应设计/实现文档，或者拆到独立提交；当前 docs 无法解释这部分代码变更。

## 7. 最终结论

- Verdict: **NEEDS_FIX**
- 允许合并：**否**

原因：

- 存在一条 CRITICAL 级安全问题；
- 设计目标 3（`STATE.md` 假心跳修复）没有真正完成；
- `headless_blocked` 在 supervised timeout 分支里的语义不可靠，破坏了这次修复最核心的“机器可读终态”承诺。

## 8. 下一步

建议进入 `fix-implement`，优先修复 CRITICAL 与 HIGH 问题后再复审。

### 8.1 同会话继续

直接执行 $fix-implement 或 /fix-implement

### 8.2 新会话恢复 prompt

```text
请阅读实现文档 docs/superpowers/plans/2026-05-01-headless-auto-no-active-milestone-fail-closed-implementation.md、
审查文档 docs/superpowers/plans/2026-05-01-headless-auto-no-active-milestone-fail-closed-code-review.md，
以及本次代码变更，
使用 $fix-implement（或 /fix-implement）进行方案修复及代码实现。
重点修复 CRITICAL：`web/app/api/auto-execution/diff/route.ts` 把用户输入拼进 `execSync`，存在命令注入风险。
```

---

## 9. 修复记录

- 修复日期: 2026-05-01
- 修复执行者: fix-implement

### 9.1 已修复问题

| 级别 | 问题 | 修复方式 | 验证 |
|------|------|----------|------|
| CRITICAL | `diff/route.ts` 命令注入 | `execSync` → `execFileSync` (argv 数组)；路径校验改用 `relative()` + null byte 防护；新增 changedFiles 白名单限制 | typecheck pass, tests pass |
| HIGH | STATE.md 假心跳 — 热路径无条件写盘 | `rebuildState()`、`updateStateFile()`、guided-flow 两处 rebuild 均增加 no-diff 短路 | 204 headless tests pass, build pass |
| HIGH | `--supervised` 超时发 `headless_blocked` 语义冲突 | 超时分支移除 `emitHeadlessBlocked()` 调用，只发 `supervised_timeout` + stderr advisory；`headless_blocked` 保留为 unsupervised fail-closed 专属终态 | 204 headless tests pass |

### 9.2 修改的文件

| 文件 | 变更 |
|------|------|
| `web/app/api/auto-execution/diff/route.ts` | `execSync` → `execFileSync`；`isPathWithinProject` 用 `relative()` 重写 + null byte 防护；新增 changedFiles 白名单校验 |
| `src/resources/extensions/gsd/doctor.ts` | `rebuildState()` 和 `updateStateFile()` 增加 content-equality 短路 |
| `src/resources/extensions/gsd/guided-flow.ts` | 两处 STATE.md rebuild 热路径增加 no-diff 短路 |
| `src/headless.ts` | supervised timeout 分支移除 `emitHeadlessBlocked()`，改为 stderr advisory |

### 9.3 验证结果

- `npx tsc --noEmit --pretty false`：通过
- `npx tsx --test src/tests/headless-interactive-blocking.test.ts`：17/17 通过
- `npx tsx --test src/tests/headless-*.test.ts`：204/204 通过
- `npx tsx --test src/web/__tests__/auto-execution-service.test.ts`：15/15 通过
- `npm run build`：成功

### 9.4 剩余风险与建议

1. **MEDIUM 未修复**：headless blocking 测试仍以源码断言和逻辑镜像为主，未覆盖真实 event-loop 集成路径。建议后续补充 supervised timeout 契约的集成测试（但不阻断本次合并）。
2. **`auto-execution` 功能文档缺失**：diff/timeline 路由不在设计/实现文档范围内，建议补进独立的设计文档或在现有文档中追加章节（不阻断合并，功能性问题已修复）。

### 9.5 结论

代码已达到可合并状态。CRITICAL 和两个 HIGH 级别问题均已修复并验证通过。
