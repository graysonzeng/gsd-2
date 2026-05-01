# Phase-Discipline Auto-Mode Loop 验证报告

> 日期: 2026-05-01
> 项目: /Users/sheng/tencent/gsd-2
> 目标 milestone: M005 (Phase-discipline supervised validation)

## 1. 运行结果摘要

| 项目 | 值 |
|---|---|
| 最终状态 | ✅ **workflow complete** |
| Session ID | `471e2a09-8656-4971-9916-228131ce1a8d` (最终成功的) |
| 起始时间 | 2026-05-01T06:55:19Z |
| 结束时间 | 2026-05-01T07:27:55Z |
| 总耗时 | ~32.6 分钟 (1,956,534ms) |
| 总迭代数 | 10 |
| 成功 unit 数 | 9/9 (全部 completed + verified) |
| Auto-exit reason | `all-complete` |
| Milestone merged | true |

## 2. 执行轨迹

| 迭代 | Unit Type | Unit ID | 状态 | 耗时 |
|---|---|---|---|---|
| 1 | execute-task | M005/S02/T01 | ✅ completed | 21.9min |
| 2 | execute-task | M005/S02/T02 | ✅ completed | 1.2min |
| 3 | complete-slice | M005/S02 | ✅ completed | 1.9min |
| 4 | reassess-roadmap | M005/S02 | ✅ completed | 0.4min |
| 5 | (skipped) | - | skipped | <1s |
| 6 | execute-task | M005/S03/T01 | ✅ completed | 1.9min |
| 7 | complete-slice | M005/S03 | ✅ completed | 2.2min |
| 8 | validate-milestone | M005 | ✅ completed | 1.2min |
| 9 | complete-milestone | M005 | ✅ completed | 1.7min |
| 10 | (terminal) | - | stopped (no-active-milestone) | <1s |

## 3. 验证的关键链路

全部链路验证通过：

1. ✅ **execute-task**: S02/T01, S02/T02, S03/T01 — 三个任务正常执行并产生真实文档改动
2. ✅ **complete-slice**: S02, S03 — slice 完成收口正常
3. ✅ **reassess-roadmap**: S02 后正确触发路线图重评估
4. ✅ **validate-milestone**: M005 验证通过
5. ✅ **complete-milestone**: M005 完成并标记 ✅
6. ✅ **auto-exit (all-complete)**: 正确识别 workflow complete 并退出
7. ✅ **worktree-merge**: milestone 合并成功
8. ✅ **terminal (no-active-milestone)**: 正确停止循环

## 4. 遇到的问题与修复

### 问题 1: GPT-5.4 via sandboxai.top 503 不可用

- **时间**: 2026-05-01 ~06:55 (第一轮尝试)
- **症状**: `503 Service temporarily unavailable`
- **根因**: api.sandboxai.top 代理服务临时不可用
- **影响**: 第一个 session (`de30236b`) 在重试 3 次后仍失败
- **修复**: 将 API base URL 改为 `https://cli.688663.xyz/v1`，使用新的 API key
- **教训**: GSD agent 的 API 端点应与 Claude Code 主进程保持一致的 provider 配置

### 问题 2: M005 缺少 CONTEXT.md 导致 dispatch 回退

- **时间**: 发现于 2026-04-30 (前几轮验证)，本轮修复
- **症状**: dispatch 匹配到 `execution-entry phase (no context) → discuss-milestone` 而非推进 `execute-task`
- **根因**: `src/resources/extensions/gsd/auto-dispatch.ts` 规则 #4671 检测到 executing 阶段但 `resolveFinalizedMilestoneContextVisibility()` 返回 non-present（M005 缺少 `M005-CONTEXT.md`）
- **影响**: 前几轮 auto-mode 全部回退到 milestone 讨论路径，无法推进
- **修复**: 创建 `.gsd/milestones/M005/M005-CONTEXT.md`，包含 milestone 的 vision、scope、constraints
- **教训**: 进入 executing 阶段的 milestone 必须有 CONTEXT.md，否则 dispatch 会触发恢复路径回退到 discuss-milestone。`/gsd doctor` 之前只报 warning 未报 error，建议升级为 error 级别

### 问题 3: Interactive select blocker 代替 auto-mode 入口

- **时间**: 2026-05-01 ~15:27 (第二轮取消后重启)
- **症状**: session 启动后弹出交互式选择器 "Create next milestone / Not yet" 而非进入 auto 执行
- **根因**: M005 已在前一个 session 中完成（STATE.md 显示 completed），新 session 看到没有 active milestone 于是进入常规交互流程
- **影响**: 无（属于正常行为——milestone 已完成）
- **教训**: 这不是 bug，是 auto-mode 在 "没有可执行工作" 时的正确行为

### 问题 4: stuck-state.json 残留历史记录

- **时间**: 本轮开始前
- **症状**: stuck-state.json 中记录了 M001 和 M005 之前的 discuss-milestone 错误
- **根因**: 之前多次失败运行写入了 stuck 记录但未清理
- **修复**: 手动重置 stuck-state.json 为空白状态
- **教训**: 跨 session 的 stuck-state 机制（pid 检测）在同一 machine 多次启动时可能出现残留；建议在 `/gsd auto` 启动时加入 stale stuck-state 自动清理

## 5. 关键发现

### 5.1 CONTEXT.md 是 dispatch 的硬依赖

规则 #4671 (`auto-dispatch.ts:376`) 在 execution-entry phase 时检查 CONTEXT.md 存在性。这是一个**隐式前置条件**：
- `/gsd doctor` 仅报 warning（`missing_context`），不阻止操作
- 但 auto-mode dispatch 会直接把执行流重定向到 `discuss-milestone`
- 建议：要么 doctor 对此报 error，要么 auto-mode 在首次缺失时自动生成一个最小 CONTEXT.md

### 5.2 Auto-mode 的 provider transient retry 有效

系统内建的 `auto_retry_start` 机制（3 次重试、2s delay）对 503 类错误有效。但如果 provider 长时间不可用（如本轮的 sandboxai.top），重试耗尽后会直接终止，没有 fallback provider 机制。

### 5.3 全链路验证通过的关键前提

本轮成功的充要条件：
1. CONTEXT.md 存在 → dispatch 不回退
2. Provider 可达 → unit 能执行
3. stuck-state 干净 → 不误判为 stuck
4. doctor ok → 基座健康

### 5.4 Phase-discipline dispatch 链路完整性

journal 证据表明 phase-discipline 的 8 个核心 dispatch 规则全部正确触发：
- `executing → execute-task` (3 次)
- `summarizing → complete-slice` (2 次)
- `reassess-roadmap (post-completion)` (1 次)
- `validating-milestone → validate-milestone` (1 次)
- `completing-milestone → complete-milestone` (1 次)

## 6. 深度分析：为什么 auto-mode 没有在 pre-flight 阶段拦截问题？

### 6.1 Auto-mode 的三层 pre-flight 校验

Auto-mode 启动时有三层校验，但它们**各自关注不同维度，存在交叉盲区**：

| 层级 | 位置 | 检查内容 | 是否检查 CONTEXT.md | 是否检查模型可达 |
|---|---|---|---|---|
| L1: bootstrapAutoSession | `auto-start.ts:668` | 仅在 `pre-planning` 阶段检查 CONTEXT.md 是否存在 | ⚠️ 仅 pre-planning | ❌ |
| L2: validatePhaseDisciplinePreflight | `preflight.ts:311` | 检查 models/providers 可用性、hook 模型配置 | ❌ | ✅ (registry check, 非实际网络请求) |
| L3: preDispatchHealthGate | `doctor-proactive.ts:214` | crash lock / merge state / STATE.md / integration branch | ❌ | ❌ |

### 6.2 问题 1 根因：CONTEXT.md 检查的阶段盲区

`bootstrapAutoSession` 的 CONTEXT.md 检查代码 (`auto-start.ts:668-687`):
```typescript
if (state.phase === "pre-planning") {
  const contextFile = resolveMilestoneFile(base, mid, "CONTEXT");
  const hasContext = !!(contextFile && (await loadFile(contextFile)));
  if (!hasContext) { /* 进入 guided-flow discussion */ }
}
```

**设计假设**：如果 milestone 已经进入了 executing 阶段（有 active slice），那 CONTEXT.md 应该早已存在（因为之前的 discuss-milestone 阶段会生成它）。

**假设失效场景**：当 milestone 是通过 MCP tool（`gsd_plan_milestone` / `gsd_plan_slice`）手动创建而非经过标准 discuss → plan 流程时，CONTEXT.md 不会被自动生成。M005 正是这种情况——supervisor 使用 MCP tools 直接创建了 milestone 结构并设置为 active，跳过了 `discuss-milestone` 阶段。

### 6.3 问题 2 根因：Provider 可达性检查是"注册表验证"而非"实际连通性测试"

`validatePhaseDisciplinePreflight` 的检查方式:
```typescript
if (!providerReady(input.modelRegistry, requirement.provider)) {
  // 标记为 failure
}
```

`providerReady` 调用的是 `registry.isProviderRequestReady(provider)`——这只检查 API key 是否配置、provider 是否在注册表中，**不发送实际 HTTP 请求验证模型是否可达**。

**设计权衡**：在每次 pre-flight 发送真实 API 请求会增加启动延迟和成本。但这导致了 "API key 存在但 endpoint 返回 503" 的场景完全没有被捕获。

### 6.4 问题 3 根因：dispatch 规则 #4671 是"恢复路径"不是"guard"

`auto-dispatch.ts:376` 的 `execution-entry phase (no context) → discuss-milestone` 规则的设计意图是**优雅降级**（发现缺 CONTEXT 时不卡死，尝试补齐），而不是**阻断**。

在交互式使用场景下这是合理的：用户在场，discuss-milestone 会启动一轮对话来填充 CONTEXT.md。但在 auto-mode 场景下，这变成了一个**静默失败路径**——auto agent 进入 discuss-milestone 后会：
1. 发起 `ask_user_questions`（auto-mode 无人应答 → block）
2. 或空跑一轮 brainstorming 后循环
3. 或被 stuck detection 杀掉

### 6.5 问题 4 根因：doctor severity 与 auto-mode gate 的断层

`doctor-lite.ts:92`:
```typescript
issues.push({
  severity: 'warning',  // ← 硬编码为 warning
  code: 'missing_context',
  ...
});
```

`preDispatchHealthGate` 只在 `proceed: false` 时阻断，而 doctor 的 warning 不会触发 `proceed: false`。两者之间没有联动逻辑——doctor 发现了问题但 gate 不关心 warning。

### 6.6 修复建议（按优先级排序）

#### P0: 在 preDispatchHealthGate 中增加 CONTEXT.md 存在性检查

位置：`src/resources/extensions/gsd/doctor-proactive.ts:214+`

当 `state.phase` 属于 `EXECUTION_ENTRY_PHASES` 时，检查 CONTEXT.md 是否存在。如果缺失：
- 尝试从 CONTEXT-DRAFT.md 或 milestone DB 元数据自动生成一个最小 CONTEXT.md（auto-heal）
- 如果 auto-heal 失败，则 `proceed: false`，让 auto-mode 停下来而不是进入错误的 dispatch 路径

```typescript
// 建议新增的检查
if (state.activeMilestone && EXECUTION_ENTRY_PHASES.has(state.phase)) {
  const visibility = resolveFinalizedMilestoneContextVisibility(basePath, state.activeMilestone.id);
  if (visibility.status !== "present") {
    // 尝试 auto-heal: 从 DB/roadmap/plan 生成最小 CONTEXT.md
    const healed = await tryGenerateMinimalContext(basePath, state.activeMilestone.id);
    if (healed) {
      fixesApplied.push(`auto-generated CONTEXT.md for ${state.activeMilestone.id}`);
    } else {
      issues.push(`${state.activeMilestone.id} is in ${state.phase} but has no CONTEXT.md — dispatch will regress to discuss-milestone`);
    }
  }
}
```

#### P1: 提升 doctor-lite 的 `missing_context` severity 为 error（条件性）

修改 `packages/mcp-server/src/readers/doctor-lite.ts:92`:
- 如果 milestone status 为 active 且 phase 属于 execution-entry → severity: `error`
- 如果 milestone status 为 planned/draft → 保持 severity: `warning`

#### P2: 在 bootstrapAutoSession 的 CONTEXT 检查中去掉 phase 过滤

当前只在 `pre-planning` 检查。建议扩展到所有 phase：
- `pre-planning` / `needs-discussion`：走 guided-flow（当前行为）
- execution-entry phases：尝试 auto-heal 或 block with clear error

#### P3: 增加 provider 实际可达性检测（lightweight ping）

在 `validatePhaseDisciplinePreflight` 中增加一个可选的 connectivity check：
- 对每个 unique provider 发送一个极低成本的请求（如 `max_tokens=1` 的 empty prompt）
- 超时 5s，失败则标记为 warning（不直接 block，因为可能是暂时的）
- 通过 preferences 控制是否启用：`preflight.connectivity_check: true/false`

#### P4: stuck-state 自动过期清理

在 `loadStuckState()` 中增加时间过期判断：
- 如果 `updatedAt` 距今 > 24h 且 pid 不在运行 → 自动清理
- 当前只有 pid 检查，没有时间衰减

## 7. 设计层面的总结

这些问题本质上是 **"auto-mode 的 guard 层次设计是面向交互式场景优化的"**：

- 交互式场景：CONTEXT.md 缺失 → 弹对话框让用户补 → 用户补完 → 继续（完全合理）
- Auto-mode 场景：CONTEXT.md 缺失 → 无人应答 → 要么 stuck 要么走错路径（静默故障）

核心矛盾在于：**auto-mode 复用了交互式流程的 "优雅降级" 路径，但这些降级路径在无人值守时变成了无限循环或错误路径。**

修复方向不是"把所有 warning 都变成 error"，而是：**在 auto-mode 上下文中，对那些需要人工干预才能恢复的降级路径，增加一个 "auto-mode aware" 的 guard，在检测到降级即将发生时主动 fail-closed 停下来。**

## 8. 后续建议（Action Items）

1. **P0 — preDispatchHealthGate 增加 CONTEXT.md 检查**：防止 dispatch 回退到 discuss-milestone
2. **P1 — doctor severity 条件升级**：active milestone 在 executing 阶段缺 CONTEXT 应为 error
3. **P2 — bootstrapAutoSession CONTEXT 检查去除 phase 过滤**：覆盖所有阶段
4. **P3 — Provider connectivity ping（可选）**：避免 503 等网络问题白白消耗 retry 预算
5. **P4 — stuck-state 时间过期清理**：避免历史残留干扰新 session

## 7. 文件证据

- Journal: `.gsd/journal/2026-05-01.jsonl` (89 events)
- Runtime report: `.gsd/runtime/auto-loop-report.json`
- M005 SUMMARY: `.gsd/milestones/M005/M005-SUMMARY.md`
- S02 T01 SUMMARY: `.gsd/milestones/M005/slices/S02/tasks/T01-SUMMARY.md`
- S02 T02 SUMMARY: `.gsd/milestones/M005/slices/S02/tasks/T02-SUMMARY.md`
- S03 T01 SUMMARY: `.gsd/milestones/M005/slices/S03/tasks/T01-SUMMARY.md`
- CONTEXT.md (本轮创建): `.gsd/milestones/M005/M005-CONTEXT.md`
- 设计文档: `docs/superpowers/specs/2026-04-29-phase-discipline-auto-mode-supervised-loop-design.md`
- 历史 run-log: `docs/superpowers/plans/2026-04-29-phase-discipline-auto-mode-supervised-loop-run-log.md`
