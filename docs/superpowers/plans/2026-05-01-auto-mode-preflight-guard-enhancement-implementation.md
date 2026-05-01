# Implementation: Auto-mode Pre-flight Guard 增强

- Date: 2026-05-01
- Design Doc: docs/superpowers/specs/2026-05-01-auto-mode-preflight-guard-enhancement-design.md
- Review Doc: docs/superpowers/plans/2026-05-01-auto-mode-preflight-guard-enhancement-design-review.md
- Status: Completed

## 1. 评审意见处理摘要

| 编号 | 级别 | 意见 | 处理 |
|------|------|------|------|
| HIGH-1 | Provider ping async 化依赖注入和调用链覆盖不完整 | ✅ 采纳 — 新增 `ConnectivityProbe` 回调类型解耦，所有测试迁移 async |
| HIGH-2 | CONTEXT.md 检查与 #4671 dispatch recovery 冲突 | ✅ 采纳 — 撤销 preDispatchHealthGate block，改为 doctor-lite severity 提升 |
| MEDIUM-1 | 24h TTL 过于拍脑袋 | ⚠️ 部分采纳 — 放宽至 72h + paused-session 语义保护 |
| MEDIUM-2 | Fix 3 表格声明与代码不一致 | ✅ 采纳 — 补充 milestone 已完成时清理逻辑 |

## 2. 根因前提处理结论（按需）

- 适用性：不适用
- 设计文档 §3 已声明"不需要根因分析"，评审未对此提出异议。
- 三个修复点的问题根因在前序验证中已明确定位。

### 2.1 消费的根因评审结论
- NOT_APPLICABLE

### 2.2 本次修订的前提边界
- 不适用

## 3. 采纳的设计修订

### 3.1 Fix 1: Provider Connectivity Ping
- **依赖注入**: 新增 `ConnectivityProbe` 类型和 `ConnectivityPingTarget` 接口，通过 `PhaseDisciplinePreflightInput.connectivityProbe` 由调用方注入，而非膨胀 `PhaseDisciplinePreflightModelRegistry`
- **reason 枚举**: 扩展 `PhaseDisciplinePreflightIssue.reason` 新增 `"connectivity_failed"`
- **测试迁移**: 全部 7 个现有测试改为 `async`，新增 7 个 connectivity probe 测试

### 3.2 Fix 2: CONTEXT.md 检查
- **撤销 preDispatchHealthGate block**: 不在 `preDispatchHealthGate()` 新增 hard block
- **替代方案**: 在 `doctor-lite.ts` 的 `checkMilestoneLevel()` 中，当 active milestone 处于 execution-entry phase 时，将 `missing_context` severity 从 `warning` 提升为 `error`

### 3.3 Fix 3: Stuck-state 清理
- **TTL 放宽**: 24h → 72h
- **语义保护**: 检查 `paused-session.json` 的 `pausedAt`，若晚于 stuck-state `updatedAt` 则保留
- **Milestone 清理**: 新增 `parseMilestoneFromKey()` 和 `isMilestoneClosed()` 函数，过滤已完成 milestone 的 stuck 条目

## 4. 实现摘要

### 4.1 变更文件

| 文件 | 变更 |
|------|------|
| `src/resources/extensions/gsd/phase-discipline/preflight.ts` | 新增 `ConnectivityProbe`/`ConnectivityPingTarget` 类型、`collectPingTargets()` 函数；`validatePhaseDisciplinePreflight` 改为 async；Input 新增 3 个可选字段 |
| `src/resources/extensions/gsd/phase-discipline/connectivity-probe.ts` | **新增** — `createDefaultConnectivityProbe` 工厂函数，构建基于 HTTP 的 provider 连通性探测 |
| `src/resources/extensions/gsd/phase-discipline/tests/preflight.test.ts` | 7 个现有测试改为 async；新增 7 个 connectivity probe + ping target 测试；新增 6 个 `createDefaultConnectivityProbe` 单元测试 |
| `src/resources/extensions/gsd/auto-start.ts` | 调用 `validatePhaseDisciplinePreflight` 加 `await` + 传入 `connectivityCheck: true` 和 `connectivityProbe` |
| `src/resources/extensions/gsd/auto.ts` | `ensurePhaseDisciplinePreflight` 内调用加 `await` + 传入 `connectivityCheck: true` 和 `connectivityProbe` |
| `packages/mcp-server/src/readers/doctor-lite.ts` | 修复 `parseActivePhaseFromState` 正则，优先匹配 `**Active Milestone:**` / `**Phase:**` 真实格式 |
| `packages/mcp-server/src/readers/readers.test.ts` | 新增 2 个测试验证 execution phase severity 提升 |
| `src/resources/extensions/gsd/auto/loop.ts` | `loadStuckState` 新增：当 milestone 清理移除全部条目时归零 `stuckRecoveryAttempts` |
| `src/resources/extensions/gsd/tests/memory-pressure-stuck-state.test.ts` | 新增 4 个 source-level 测试验证 milestone 清理和 TTL |
| `docs/superpowers/specs/2026-05-01-auto-mode-preflight-guard-enhancement-design.md` | 末尾追加修订记录 |

### 4.2 新增导出

- `preflight.ts`: `ConnectivityProbe` (type), `ConnectivityPingTarget` (interface), `collectPingTargets()` (function)

### 4.3 接口变更

- `validatePhaseDisciplinePreflight`: 返回类型从 `PhaseDisciplinePreflightResult` 变为 `Promise<PhaseDisciplinePreflightResult>`
- `PhaseDisciplinePreflightInput`: 新增 `connectivityCheck?: boolean`, `connectivityTimeoutMs?: number`, `connectivityProbe?: ConnectivityProbe`
- `PhaseDisciplinePreflightIssue.reason`: 新增 `"connectivity_failed"` 联合成员

## 5. 验证结果

### 5.1 TypeScript 类型检查
```
$ npx tsc --noEmit --project tsconfig.extensions.json  → ✅ 无错误
$ npx tsc --noEmit --project tsconfig.resources.json   → ✅ 无错误
$ npx tsc --noEmit --project packages/mcp-server/tsconfig.json → ✅ 无错误
```

### 5.2 单元测试
```
$ npx tsx --test src/resources/extensions/gsd/phase-discipline/tests/preflight.test.ts
→ ✅ 14 pass, 0 fail (7 原有 + 7 新增)

$ npx tsx --test src/resources/extensions/gsd/tests/execution-entry-missing-context-4671.test.ts
→ ✅ 16 pass, 0 fail (#4671 回归测试无破坏)

$ npx tsx --test packages/mcp-server/src/readers/readers.test.ts
→ ✅ 33 pass, 0 fail (doctor-lite 测试无回归)

$ npx tsx --test src/resources/extensions/gsd/tests/auto-recovery.test.ts
→ ✅ 38 pass, 0 fail

$ npx tsx --test src/resources/extensions/gsd/tests/auto-paused-session-validation.test.ts
→ ✅ 8 pass, 0 fail

$ npx tsx --test src/resources/extensions/gsd/tests/journal-integration.test.ts
→ ✅ 19 pass, 0 fail
```

### 5.3 预先存在的失败
- `merge.test.ts` 中 2 个测试在变更前后均失败（`applyPhaseDisciplinePreset` 相关），已确认与本次变更无关

## 6. 已知限制与后续建议

1. **ConnectivityProbe 已接线**: `auto-start.ts` 和 `auto.ts` 均传入 `connectivityCheck: true` 和 `createDefaultConnectivityProbe(ctx.modelRegistry)`，provider 连通性校验在 auto-mode 启动阶段已生效。
2. **doctor-lite STATE.md 解析已修复**: `parseActivePhaseFromState` 现在优先匹配 `**Active Milestone:**` / `**Phase:**` 真实渲染格式，severity 提升逻辑已生效。
3. **stuck-state milestone 清理已完善**: 当 milestone 清理移除了全部 `recentUnits` 时，`stuckRecoveryAttempts` 同步归零，不再污染新 session。
4. **Probe 对 CLI-auth provider 的处理**: `createDefaultConnectivityProbe` 对 `externalCli`/`none` 类 provider 跳过网络检查，直接返回 ok。
5. **MEDIUM-1 文档一致性**: 设计文档正文仍保留旧方案描述，末尾修订记录有最新方案。后续可选择性收敛文档。

## 7. Handoff

### 7.1 同会话继续
`直接执行 /code-review`

### 7.2 新会话恢复 prompt
```text
请阅读设计文档 docs/superpowers/specs/2026-05-01-auto-mode-preflight-guard-enhancement-design.md、
评审文档 docs/superpowers/plans/2026-05-01-auto-mode-preflight-guard-enhancement-design-review.md、
实现文档 docs/superpowers/plans/2026-05-01-auto-mode-preflight-guard-enhancement-implementation.md，
以及本次提交的代码变更。
重点核对根因前提（如有）、设计修订、实现结果与验证证据是否一致，
使用 /code-review 进行方案重审及代码审查。
```
