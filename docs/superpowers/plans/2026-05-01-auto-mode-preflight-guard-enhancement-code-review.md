# Code Review: Auto-mode Pre-flight Guard 增强

- Design doc: `docs/superpowers/specs/2026-05-01-auto-mode-preflight-guard-enhancement-design.md`
- Design review doc: `docs/superpowers/plans/2026-05-01-auto-mode-preflight-guard-enhancement-design-review.md`
- Implementation doc: `docs/superpowers/plans/2026-05-01-auto-mode-preflight-guard-enhancement-implementation.md`
- Review date: 2026-05-01
- Scope: 设计一致性复核 + 本次代码变更只读审查

## Review Scope

本次审查覆盖以下输入与实现：

- 设计文档、设计评审文档、实现文档三者之间的前提与修订一致性
- 本次变更涉及的完整源码上下文：
  - `src/resources/extensions/gsd/phase-discipline/preflight.ts`
  - `src/resources/extensions/gsd/phase-discipline/tests/preflight.test.ts`
  - `src/resources/extensions/gsd/auto-start.ts`
  - `src/resources/extensions/gsd/auto.ts`
  - `src/resources/extensions/gsd/auto/loop.ts`
  - `packages/mcp-server/src/readers/doctor-lite.ts`
- 相关运行路径与回归语义：
  - `src/resources/extensions/gsd/workflow-projections.ts`
  - `src/resources/extensions/gsd/auto/phases.ts`
  - `src/resources/extensions/gsd/tests/execution-entry-missing-context-4671.test.ts`
  - `packages/mcp-server/src/readers/readers.test.ts`

额外抽样复跑了以下测试以核对实现文档中的验证证据：

- `npx tsx --test src/resources/extensions/gsd/phase-discipline/tests/preflight.test.ts`
- `npx tsx --test packages/mcp-server/src/readers/readers.test.ts`
- `npx tsx --test src/resources/extensions/gsd/tests/execution-entry-missing-context-4671.test.ts`

## Design Consistency Assessment

- 根因前提：一致。设计文档将根因分析标记为“不适用”，实现文档也按该前提延续，没有发现额外前提漂移。
- Fix 1 一致性：不一致。设计修订后的目标是“auto-mode 路径显式启用 connectivity ping”，但当前调用链只完成了 `async` 适配，没有把 probe 真正接入启动路径。
- Fix 2 一致性：部分不一致。设计修订为“不阻断 dispatch，只提升 doctor-lite 诊断严重度”，代码表面上按这个方向实现；但 `doctor-lite` 解析 `STATE.md` 的正则与真实渲染格式不匹配，导致 severity 提升在真实项目上基本不会触发。
- Fix 3 一致性：部分不一致。实现加入了 `72h TTL`、`paused-session` 保护和 closed milestone 过滤，但 milestone 清理后没有同步归零 `stuckRecoveryAttempts`，仍可能把旧 session 的 stuck 恢复级别带到新 milestone。
- 验证证据：不充分。实现文档列出的测试确实可以通过，但没有任何一条测试覆盖“auto-mode 实际启用 connectivity ping”或“doctor-lite 在真实 `STATE.md` 格式下提升 missing_context severity”，因此验证结论高估了已落地范围。

## Main Findings

### [HIGH] 设计落地缺失: auto-mode 启动路径没有启用 connectivity ping，Provider 预检增强实际上未生效

**文件**: `src/resources/extensions/gsd/auto-start.ts:721-725`; `src/resources/extensions/gsd/auto.ts:277-281`; `src/resources/extensions/gsd/phase-discipline/preflight.ts:426-454`; `docs/superpowers/specs/2026-05-01-auto-mode-preflight-guard-enhancement-design.md:18-19`; `docs/superpowers/plans/2026-05-01-auto-mode-preflight-guard-enhancement-implementation.md:31-34`; `docs/superpowers/plans/2026-05-01-auto-mode-preflight-guard-enhancement-implementation.md:104-105`

**问题**: 设计修订后的目标是通过 `connectivityCheck` + `connectivityProbe` 在 auto-mode 启动阶段阻断不可达 provider，但实际两个生产调用点只做了 `await validatePhaseDisciplinePreflight(...)`，既没有传 `connectivityCheck: true`，也没有传 `connectivityProbe`。`preflight.ts` 里的新逻辑因此永远不会进入，runtime 行为仍然是纯 registry 检查。

**影响**: 设计文档的首要成功标准“Provider 不可达时 auto-mode 在启动阶段即报错停止”没有达成，用户仍会在 dispatch loop 内才消耗重试预算。实现文档虽然在“已知限制”里承认 probe 未接线，但文档整体状态仍写成 `Completed`，这会误导后续评审和使用者，以为该根问题已经修复。

**建议**: 在 `auto-start.ts` 和 `auto.ts` 的 auto-mode 启动路径中显式传入 `connectivityCheck: true` 和真实的 `connectivityProbe` 实现，并补一条集成测试验证“provider 503/timeout 时 auto-mode 启动即失败”。在此之前，不应把 Fix 1 标记为完成。

### [HIGH] 实现结果失效: doctor-lite 的 STATE.md 解析规则不匹配真实渲染格式，missing_context severity 提升不会触发

**文件**: `packages/mcp-server/src/readers/doctor-lite.ts:52-63`; `src/resources/extensions/gsd/workflow-projections.ts:305-308`; `packages/mcp-server/src/readers/readers.test.ts:449-451`; `docs/superpowers/plans/2026-05-01-auto-mode-preflight-guard-enhancement-implementation.md:36-38`; `docs/superpowers/plans/2026-05-01-auto-mode-preflight-guard-enhancement-implementation.md:86-87`

**问题**: `parseActivePhaseFromState()` 只匹配 `active_milestone:` / `phase:` 或 `## Active Milestone:` 这类文本，但真实 `STATE.md` 是由 `workflow-projections.ts` 渲染成 `**Active Milestone:** ...` 和 `**Phase:** ...`。当前正则因此无法从真实状态文件中提取 active milestone 与 phase，`checkMilestoneLevel()` 中的 `isActiveExecution` 基本恒为 false，severity 永远停留在 `warning`。

**影响**: 设计修订后唯一保留的 Fix 2 落地点就是 doctor-lite 的 severity 提升；该逻辑失效后，文档声称的“active milestone + execution-entry phase 时将 missing_context 提升为 error”并未真正实现。现有 `readers.test.ts` 也没有覆盖这个分支，所以实现文档中的“doctor-lite 测试无回归”不能证明新行为已生效。

**建议**: 让 `doctor-lite` 按真实 `STATE.md` 格式解析 `**Active Milestone:**` / `**Phase:**`，或复用现有轻量解析 helper；同时新增测试覆盖 active execution milestone 缺失 `CONTEXT.md` 时 severity 必须为 `error`。

### [HIGH] 状态污染仍在: closed milestone 条目被清理后，旧 stuck 恢复级别仍会带入新 session

**文件**: `src/resources/extensions/gsd/auto/loop.ts:131-149`; `src/resources/extensions/gsd/auto/phases.ts:1094-1156`; `docs/superpowers/specs/2026-05-01-auto-mode-preflight-guard-enhancement-design.md:20`; `docs/superpowers/plans/2026-05-01-auto-mode-preflight-guard-enhancement-implementation.md:40-43`

**问题**: `loadStuckState()` 会过滤掉已完成 milestone 的 `recentUnits`，但返回时仍保留原始 `stuckRecoveryAttempts`。一旦旧 session 已经把该计数升到 `1`，新 session 即使 recent window 已被清空，也会在下一次 stuck 检测时直接进入 `auto/phases.ts` 的二级 hard stop 分支，跳过一级“invalidate caches and retry”恢复。

**影响**: 这正好违背了本次设计对 Fix 3 的成功标准“Stuck-state 过期或属于已完成 milestone 时，自动清理不干扰新 session”。当前实现只清了窗口，不清恢复级别，旧 milestone 的 stuck 结论仍会污染后续里程碑，用户会在新 session 中得到过早的 hard stop。

**建议**: 当 milestone 清理删除了全部 `recentUnits`，或删除后剩余条目已经不再支撑当前 `stuckRecoveryAttempts` 语义时，同步将 `stuckRecoveryAttempts` 归零；并新增针对“closed milestone 清理后首次 stuck 应仍走 level-1 recovery”的回归测试。

### [MEDIUM] 文档前后冲突: 设计正文仍保留被 design-review 否决的旧方案，导致设计修订与实现说明不可直接对齐

**文件**: `docs/superpowers/specs/2026-05-01-auto-mode-preflight-guard-enhancement-design.md:18-27`; `docs/superpowers/specs/2026-05-01-auto-mode-preflight-guard-enhancement-design.md:320-377`; `docs/superpowers/specs/2026-05-01-auto-mode-preflight-guard-enhancement-design.md:403-411`; `docs/superpowers/plans/2026-05-01-auto-mode-preflight-guard-enhancement-implementation.md:36-43`

**问题**: 设计文档正文仍然写着“CONTEXT.md 缺失时在 pre-dispatch 阶段报错停止”“修改 `doctor-proactive.ts`”“Stuck-state 使用 24h TTL”等旧方案，而末尾修订记录和实现文档又改成了“只做 doctor-lite severity 提升”“72h + paused-session 保护”。当前读者必须手动合并正文与修订记录，才能得到真实方案。

**影响**: 这会直接削弱本次变更最关键的“设计修订可追踪性”。后续若继续修复或复审，容易错误地把正文当成最终方案，重复走回已被 design-review 否掉的路径。

**建议**: 把设计文档正文重写为当前有效方案，不要只在末尾追加 `Rev 1`。至少应同步更新成功标准、范围、错误处理、验证计划和关键决策摘要，保证正文与修订记录一致。

## Verification Notes

- 抽样复跑的 3 组测试均通过，但它们只证明当前单测覆盖面内没有回归，不足以证明三项设计目标全部落地。
- 特别是 Fix 1 与 Fix 2 的关键运行时行为都缺少能够直接证明“真实 auto-mode / 真实 STATE.md 格式下生效”的测试。

## Conclusion

结论：`NEEDS_REVISION`

当前实现并未完整兑现设计修订后的承诺：Fix 1 在生产路径上尚未生效，Fix 2 的替代实现因解析规则错误而基本失效，Fix 3 仍残留跨 milestone 的 stuck 恢复级别污染。建议先修复上述 HIGH 问题，并同步收敛设计/实现文档后再复审。

## Next Step

- 先修复 HIGH-1，确保 auto-mode 真实执行 connectivity ping。
- 再修复 doctor-lite 的 STATE.md 解析与 stuck-state 计数器归零逻辑。
- 补齐对应回归测试后，重新执行 code review。

## Handoff

**同会话继续**:

直接执行 $fix-implement 或 /fix-implement

**新会话恢复 prompt**:

```text
请阅读实现文档 docs/superpowers/plans/2026-05-01-auto-mode-preflight-guard-enhancement-implementation.md、
审查文档 docs/superpowers/plans/2026-05-01-auto-mode-preflight-guard-enhancement-code-review.md，
以及本次代码变更，
使用 $fix-implement（或 /fix-implement）进行方案修复及代码实现。
重点修复 HIGH-1：auto-mode 启动路径未传入 connectivityCheck / connectivityProbe，provider 连通性校验实际上未生效。
```

## 修复记录

### 修复日期: 2026-05-01

#### HIGH-1: auto-mode 启动路径未传入 connectivityCheck / connectivityProbe ✅ 已修复

**修复方案**:
1. 新建 `src/resources/extensions/gsd/phase-discipline/connectivity-probe.ts`，导出 `createDefaultConnectivityProbe` 工厂函数
   - 接收 `ProbeModelRegistry` 接口（解耦依赖），返回 `ConnectivityProbe` 实例
   - 对 CLI-auth 类 provider 直接返回 `ok: true`（host CLI 管连通性）
   - 对 API 类 provider 用 provider 的 models list endpoint 做轻量 GET 请求，配合 AbortController 超时
   - 4xx 视为 reachable（auth 问题由 registry 检查覆盖），5xx/network error 视为 unreachable
2. 在 `auto-start.ts` 和 `auto.ts` 的调用点显式传入 `connectivityCheck: true` 和 `createDefaultConnectivityProbe(ctx.modelRegistry)`
3. 新增 6 个测试覆盖 probe 各分支 + 1 个集成测试验证 503 时 auto-mode preflight 失败

#### HIGH-2: doctor-lite STATE.md 解析规则不匹配真实格式 ✅ 已修复

**修复方案**:
- `parseActivePhaseFromState()` 正则优先匹配 `**Active Milestone:** M001` 和 `**Phase:** executing`（`workflow-projections.ts` 渲染的真实格式）
- 保留旧格式正则作为 fallback（`active_milestone:`、`## Active Milestone:`）
- 新增 2 个测试：验证 execution phase 时 severity 为 `error`，planning phase 时保持 `warning`

#### HIGH-3: closed milestone 清理后 stuckRecoveryAttempts 未归零 ✅ 已修复

**修复方案**:
- 在 `loadStuckState()` 中，当 milestone 清理移除了全部 `recentUnits`（`filteredUnits.length === 0 && recentUnits.length > 0`），同步将 `stuckRecoveryAttempts` 归零
- 新增 4 个 source-level 测试验证 milestone 清理逻辑和 TTL 常量

### 验证结果

| 测试套件 | 结果 |
|----------|------|
| `preflight.test.ts` | ✅ 20 pass (14 原有 + 6 新增) |
| `readers.test.ts` (doctor-lite) | ✅ 35 pass (33 原有 + 2 新增) |
| `memory-pressure-stuck-state.test.ts` | ✅ 14 pass (10 原有 + 4 新增) |
| `execution-entry-missing-context-4671.test.ts` | ✅ 16 pass (无回归) |
| `auto-recovery.test.ts` | ✅ 38 pass (无回归) |
| `auto-paused-session-validation.test.ts` | ✅ 8 pass (无回归) |
| `journal-integration.test.ts` | ✅ 19 pass (无回归) |
| TypeScript: `tsconfig.extensions.json` | ✅ 无错误 |
| TypeScript: `tsconfig.resources.json` | ✅ 无错误 |
| TypeScript: `packages/mcp-server/tsconfig.json` | ✅ 无错误 |

### 剩余风险

- **MEDIUM-1** (文档正文与修订记录不一致) 未在本轮修复——属于文档收敛工作，不影响功能。如有需要可在下一轮处理。
- `createDefaultConnectivityProbe` 使用 `globalThis.fetch`，在不支持 fetch 的旧 Node (< 18) 环境会报错；但项目已要求 Node 18+，风险可控。

### 建议下一轮重点检查范围

- 验证 `createDefaultConnectivityProbe` 在真实 CI 环境中是否与 provider endpoint 兼容（特别是 Vertex、自定义 baseUrl provider）
- 确认 MEDIUM-1 文档一致性问题是否阻碍后续维护
