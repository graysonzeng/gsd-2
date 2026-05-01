# Design: Auto-mode Pre-flight Guard 增强（Provider Ping / CONTEXT.md 校验 / Stuck-state 清理）

- Date: 2026-05-01
- Status: Draft
- Scope: M

## 1. 设计目标和范围

### 1.1 要解决的问题

Auto-mode 的三层 pre-flight guard 存在交叉盲区，导致以下问题在 auto-mode 场景下静默失败：
1. Provider 返回 503 但 pre-flight 未检测，auto-mode 白白消耗 retry 预算后才停止
2. CONTEXT.md 缺失时 dispatch 回退到 discuss-milestone（需要人工交互），auto-mode 下变成死循环
3. Stuck-state 跨 session 残留，新 session 误判为 stuck 或走错恢复路径

### 1.2 成功标准

- Provider 不可达时，auto-mode 在启动阶段即报错停止，不进入 dispatch loop
- CONTEXT.md 缺失时，auto-mode 在 pre-dispatch 阶段即报错停止，不回退到 discuss-milestone
- Stuck-state 过期或属于已完成 milestone 时，自动清理不干扰新 session

### 1.3 本次范围

- 修改 `src/resources/extensions/gsd/phase-discipline/preflight.ts`：增加 connectivity ping
- 修改 `src/resources/extensions/gsd/doctor-proactive.ts`：增加 CONTEXT.md 存在性检查
- 修改 `src/resources/extensions/gsd/auto/loop.ts`：增加 stuck-state 过期清理
- 修改 `packages/mcp-server/src/readers/doctor-lite.ts`：条件性提升 missing_context severity

### 1.4 非目标

- 不实现 provider fallback 机制（如 gpt-5.4 不可用时自动切 claude）
- 不改变交互式模式的现有行为（discuss-milestone 在交互式下仍然合理）
- 不引入新的 retry/backoff 策略
- 不新增独立的 health check daemon 或 sidecar

## 2. 背景与约束

### 2.1 现有 pre-flight 层次

| 层级 | 文件 | 检查内容 | 盲区 |
|---|---|---|---|
| L1 bootstrapAutoSession | `auto-start.ts` | CONTEXT.md（仅 pre-planning）| executing 阶段不检查 |
| L2 validatePhaseDisciplinePreflight | `preflight.ts` | model/provider registry | 不做网络请求 |
| L3 preDispatchHealthGate | `doctor-proactive.ts` | crash lock / merge state / STATE.md | 不检查 CONTEXT.md |

### 2.2 约束

- `docs/superpowers/discipline.md` 禁止 overlay / 第二 runtime / 通用 hook platform 化
- ping 不能阻塞启动超过 10s（用户体验底线）
- 修改必须向后兼容：非 phase-discipline 项目不受影响
- 现有测试必须继续通过

## 3. 根因分析（按需）

### 3.1 是否需要根因分析

不需要。三个问题的根因在前序验证过程中已完整定位，代码路径明确。

### 3.2~3.4

不适用。

## 4. 方案对比

### 4.1 方案 A — 在现有 pre-flight 层各自增强（推荐）

- 核心思路：在已有的三层 guard 中各自补上对应检查，不新增层次
  - L2 (`preflight.ts`) 增加 connectivity ping
  - L3 (`doctor-proactive.ts`) 增加 CONTEXT.md 检查
  - `loop.ts` 的 `loadStuckState()` 增加时间衰减
- 优点：改动最小、层次清晰、不引入新架构
- 缺点：三个修改点分散在不同文件
- 适用前提：当前三层结构不变

### 4.2 方案 B — 新增统一 auto-mode-aware pre-flight gate

- 核心思路：在 `startAuto` 入口新增一个 `autoModePreflightGate()` 函数，集中处理所有 auto-mode 特有检查
- 优点：一次调用完成所有检查、逻辑集中便于维护
- 缺点：与现有三层结构重叠、引入"只有 auto-mode 才跑" 的新 gate 概念、与 discipline.md 的"不新增平台化"精神存在张力
- 适用前提：打算长期维护大量 auto-mode-only guard

### 4.3 选型结论

选择 **方案 A**。理由：当前只有 3 个明确修复点，每个改动量小且在已有代码路径内自然插入。不需要为 3 个 fix 引入新的 gate 抽象。

## 5. 详细方案

### 5.1 Fix 1: Provider Connectivity Ping

**位置**: `src/resources/extensions/gsd/phase-discipline/preflight.ts`

**控制流**:

1. `validatePhaseDisciplinePreflight()` 执行完现有 registry 检查后
2. 如果 `failures.length === 0`（registry 层面通过），增加 connectivity ping
3. 收集需要 ping 的 **unique provider+model 对**（去重）：
   - default provider / default model（执行主模型）
   - reviewer provider / reviewer model（code-review / design-review hook 使用的模型）
   - 其他在 `checked` 列表中标记为 non-optional 的 provider+model
4. **并行** 对所有 unique provider+model 发送 `max_tokens=1` 的最小请求
5. 单个超时 5s，全部完成后汇总；任一失败 → 加入 failures

**接口变更**:

```typescript
// preflight.ts - 新增
export interface PhaseDisciplinePreflightInput {
  preferences?: GSDPreferences | null;
  modelRegistry: PhaseDisciplinePreflightModelRegistry;
  sessionProvider?: string;
  // 新增：是否执行实际连通性检查（默认 true for auto-mode）
  connectivityCheck?: boolean;
  // 新增：ping 超时（ms），默认 5000
  connectivityTimeoutMs?: number;
}

// 新增内部函数
async function pingProvider(
  provider: string,
  model: string,
  registry: PhaseDisciplinePreflightModelRegistry,
  timeoutMs: number,
): Promise<{ ok: boolean; error?: string; latencyMs?: number }>;

// 新增：收集并去重所有需要验证的 provider+model 对
function collectPingTargets(
  checked: PhaseDisciplinePreflightRequirement[],
): Array<{ provider: string; model: string; role: string }>;
```

**函数签名变更**：`validatePhaseDisciplinePreflight` 变为 `async` 函数（当前是同步的）。

**调用方适配**:
- `auto-start.ts:721` 和 `auto.ts:277` 的调用需要加 `await`
- 传入 `connectivityCheck: true`（仅在 auto-mode 路径中）

**ping 目标收集逻辑**:
```typescript
function collectPingTargets(
  checked: PhaseDisciplinePreflightRequirement[],
): Array<{ provider: string; model: string; role: string }> {
  const seen = new Set<string>();
  const targets: Array<{ provider: string; model: string; role: string }> = [];
  
  for (const req of checked) {
    // 只 ping 非 optional 的、provider 已知的条目
    if (req.optional || req.provider === "unknown") continue;
    const key = `${req.provider}/${req.model}`;
    if (seen.has(key)) continue;
    seen.add(key);
    targets.push({ provider: req.provider, model: req.model, role: req.role });
  }
  return targets;
}
```

**并行 ping 执行**:
```typescript
// 在 validatePhaseDisciplinePreflight 中（registry 检查通过后）
if (input.connectivityCheck && failures.length === 0) {
  const targets = collectPingTargets(checked);
  const results = await Promise.allSettled(
    targets.map(t => pingProvider(t.provider, t.model, input.modelRegistry, timeoutMs))
  );
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const t = targets[i];
    if (r.status === "rejected" || !r.value.ok) {
      const error = r.status === "rejected" 
        ? String(r.reason) 
        : r.value.error ?? "unknown";
      failures.push({
        code: "connectivity_failed",
        level: "fatal",
        stage: "bootstrap",
        role: t.role,
        source: "connectivity-ping",
        provider: t.provider,
        model: t.model,
        reason: "connectivity_failed",
        detail: `Ping to ${t.provider}/${t.model} failed: ${error}`,
      });
    }
  }
}
```

**ping 请求设计**:
```typescript
// 最小请求体，只验证连通性
const body = {
  model,
  messages: [{ role: "user", content: "1" }],
  max_tokens: 1,
};
// 使用 provider SDK 的现有 request 方法，不自己写 fetch
// 这样能复用 baseUrl / headers / auth 配置
```

**错误处理**:
- 超时 → `connectivity_timeout` failure
- 4xx（非 401） → `connectivity_client_error` failure
- 401/403 → `connectivity_auth_failed` failure（这比 "provider_not_ready" 更精确）
- 5xx → `connectivity_server_error` failure
- 网络不可达 → `connectivity_unreachable` failure

**回退策略**: ping 失败时直接 block auto-mode 启动，报错信息包含具体 HTTP status 和 provider/model。不尝试 fallback。

### 5.2 Fix 2: CONTEXT.md 存在性检查

**位置**: `src/resources/extensions/gsd/doctor-proactive.ts` 的 `preDispatchHealthGate()`

**控制流**:

1. 在现有检查之后（STATE.md 存在性检查后）
2. `deriveState(basePath)` 已经在该函数中执行过（integration branch 检查用的）
3. 如果 `state.activeMilestone` 存在且 `state.phase` 属于 `EXECUTION_ENTRY_PHASES`
4. 调用 `resolveFinalizedMilestoneContextVisibility(basePath, mid)`
5. 如果 `visibility.status !== "present"` → 加入 issues，`proceed: false`

**代码片段**:
```typescript
// ── CONTEXT.md existence check for execution-entry phases ──
// If the active milestone is in an execution-entry phase but has no CONTEXT.md,
// dispatch will regress to discuss-milestone which requires human interaction.
// Block pre-dispatch in auto-mode to fail-closed instead of entering a dead loop.
try {
  if (state.activeMilestone && EXECUTION_ENTRY_PHASES.has(state.phase)) {
    const visibility = resolveFinalizedMilestoneContextVisibility(
      basePath, state.activeMilestone.id
    );
    if (visibility.status !== "present") {
      issues.push(
        `${state.activeMilestone.id} is in phase "${state.phase}" but has no CONTEXT.md. ` +
        `Dispatch will regress to discuss-milestone. ` +
        `Create CONTEXT.md or run /gsd doctor heal.`
      );
    }
  }
} catch {
  // Non-fatal — dispatch continues if check fails
}
```

**import 变更**: 从 `uok/plan-v2.ts` 导入 `EXECUTION_ENTRY_PHASES` 和 `resolveFinalizedMilestoneContextVisibility`。

**doctor-lite.ts severity 条件升级**:

```typescript
// packages/mcp-server/src/readers/doctor-lite.ts:91
// 改为：根据 milestone 状态决定 severity
const milestoneStatus = getMilestoneStatus(db, mid); // 从 DB 读取
const isActiveExecution = milestoneStatus === 'active'; // 简化判断
issues.push({
  severity: isActiveExecution ? 'error' : 'warning',
  code: 'missing_context',
  scope: 'milestone',
  unitId: mid,
  message: `${mid} has no CONTEXT.md — milestone lacks defined scope`,
});
```

### 5.3 Fix 3: Stuck-state 过期清理

**位置**: `src/resources/extensions/gsd/auto/loop.ts` 的 `loadStuckState()`

**分场景清理规则**:

| 场景 | 条件 | 动作 |
|---|---|---|
| 同进程写入 | `data.pid === process.pid` | 忽略（当前行为不变） |
| 新进程 + 未过期 | `data.pid !== process.pid && age < 24h` | 正常加载（当前行为不变） |
| 新进程 + 已过期 | `data.pid !== process.pid && age >= 24h` | 清理：返回空状态 |
| milestone 已完成 | stuck 中的 unit key 对应的 milestone 已 complete | 清理对应条目 |
| 文件损坏 / 无 updatedAt | 解析失败或缺少时间戳 | 清理：返回空状态 |

**代码变更**:
```typescript
function loadStuckState(basePath: string): { recentUnits: Array<{ key: string }>; stuckRecoveryAttempts: number } {
  try {
    const data = JSON.parse(readFileSync(stuckStatePath(basePath), "utf-8"));
    
    // 同进程写入 → 跳过（现有逻辑不变）
    if (data.pid === process.pid) {
      return { recentUnits: [], stuckRecoveryAttempts: 0 };
    }
    
    // 时间过期检查（新增）
    const updatedAt = data.updatedAt ? new Date(data.updatedAt).getTime() : 0;
    const ageMs = Date.now() - updatedAt;
    const STUCK_STATE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
    if (ageMs > STUCK_STATE_TTL_MS || updatedAt === 0) {
      debugLog("autoLoop", { 
        phase: "stuck-state-expired", 
        ageHours: Math.round(ageMs / 3600000),
        updatedAt: data.updatedAt 
      });
      // 清理过期文件
      try { unlinkSync(stuckStatePath(basePath)); } catch {}
      return { recentUnits: [], stuckRecoveryAttempts: 0 };
    }
    
    // 正常加载（现有逻辑不变）
    return {
      recentUnits: Array.isArray(data.recentUnits) ? data.recentUnits : [],
      stuckRecoveryAttempts: typeof data.stuckRecoveryAttempts === "number" ? data.stuckRecoveryAttempts : 0,
    };
  } catch (err) {
    debugLog("autoLoop", { phase: "load-stuck-state-failed", error: err instanceof Error ? err.message : String(err) });
    return { recentUnits: [], stuckRecoveryAttempts: 0 };
  }
}
```

### 5.4 错误处理与回退策略

| 修复点 | 失败时行为 | 用户可见信息 |
|---|---|---|
| Provider ping 失败 | 阻断 auto-mode 启动 | `Phase-discipline preflight failed: connectivity check to {provider}/{model} failed ({status/reason}). Auto-mode blocked.` |
| CONTEXT.md 缺失 | 阻断 pre-dispatch | `{mid} is in phase "{phase}" but has no CONTEXT.md. Dispatch will regress. Create CONTEXT.md or run /gsd doctor heal.` |
| Stuck-state 过期 | 静默清理 + debug log | 无用户可见通知（属于自愈行为） |

### 5.5 风险与缓解

- **风险**: Provider ping 增加 auto-mode 启动延迟（最多 5s，多 provider 并行不叠加）
  - 缓解: 所有 ping 并行执行（`Promise.allSettled`），总延迟等于最慢的那个；去重后通常只有 1-2 个 unique provider+model 对；成功时通常 < 1s
- **风险**: `validatePhaseDisciplinePreflight` 从同步变异步，可能影响调用方
  - 缓解: 只有两个调用点（`auto-start.ts` 和 `auto.ts`），且都在 async context 中
- **风险**: CONTEXT.md 检查可能阻断合法的"从零开始" milestone
  - 缓解: 只在 `EXECUTION_ENTRY_PHASES` 阶段检查；pre-planning/needs-discussion 阶段不检查
- **风险**: 24h TTL 可能对某些长时间暂停的 session 过于激进
  - 缓解: stuck-state 清理后只是重置计数器，不会导致数据丢失；最差情况是 stuck detection 延迟一轮重新积累

## 6. 验证计划

### 6.1 单元测试

- **Provider ping**:
  - 测试 default + reviewer 都可达 → preflight ok
  - 测试 default 可达 + reviewer 不可达 → preflight failure（含 reviewer role 信息）
  - 测试 default 不可达 → preflight failure with `connectivity_failed`
  - 测试 ping 超时 → preflight failure with timeout error
  - 测试 ping 5xx → preflight failure with server error
  - 测试多个 provider 并行 ping 去重（同 provider+model 只 ping 一次）
  - 测试 `connectivityCheck: false` → 跳过 ping（兼容交互式模式）
  - 测试 optional requirement → 不参与 ping
  
- **CONTEXT.md 检查**:
  - 测试 executing phase + 有 CONTEXT → proceed: true
  - 测试 executing phase + 无 CONTEXT → proceed: false + 正确 issue message
  - 测试 pre-planning phase + 无 CONTEXT → proceed: true（不阻断）
  - 测试 non-active milestone → 不检查

- **Stuck-state 清理**:
  - 测试 age < 24h → 正常加载
  - 测试 age > 24h → 返回空状态 + 删除文件
  - 测试无 updatedAt → 返回空状态
  - 测试同进程 pid → 忽略（现有行为不变）

### 6.2 集成测试

- 补充 `phase-discipline-integration.test.ts` 场景：auto-mode 启动时 CONTEXT.md 缺失 → 正确 block
- 运行现有测试套件确认无回归：`npm run test:unit`

### 6.3 手工验证

- 在真实项目上重现：创建 milestone 跳过 discuss 直接设为 executing → 确认 auto-mode 启动时正确报错
- Provider 断网测试：修改 baseUrl 为不可达地址 → 确认 auto-mode 启动被阻断

## 7. 关键决策摘要

1. **Provider 检查选择方案 A (轻量 ping)**：对所有 non-optional provider+model 对发真实 `max_tokens=1` 请求，5s 超时，并行执行，任一失败即 block
2. **ping 覆盖所有 non-optional 角色**：包括 default provider（执行模型）和 reviewer provider（code-review/design-review hook 模型），去重后并行验证
3. **ping 只在 auto-mode 路径执行**：交互式启动不 ping，避免增加常规使用延迟
3. **CONTEXT.md 检查放在 preDispatchHealthGate**：复用现有 per-iteration gate，而非 bootstrap 一次性检查（因为 CONTEXT 可能在运行中被删除）
4. **Stuck-state 使用时间 TTL 清理**：24h 过期阈值，配合现有 pid 检查
5. **不引入新 gate 层次**：在现有三层中分别增强，符合 discipline.md 约束

## 8. Handoff

### 8.1 同会话继续
`直接执行 /design-review`

### 8.2 新会话恢复 prompt
```text
请阅读设计文档 docs/superpowers/specs/2026-05-01-auto-mode-preflight-guard-enhancement-design.md，
使用 /design-review 对该方案进行评审，重点关注：
1. Provider ping 从同步到异步的改造对调用链的影响是否完整覆盖
2. CONTEXT.md 检查在 preDispatchHealthGate 中的位置是否会与 dispatch 规则 #4671 产生竞争
3. Stuck-state 24h TTL 是否对长时间 pause 场景过于激进
```

## 修订记录

### Rev 1 (2026-05-01) — 响应 design-review 评审

#### Fix 1: Provider Connectivity Ping 修订

- **[HIGH] 采纳 — 依赖注入独立化**: `validatePhaseDisciplinePreflight` 不再要求 registry 具备 request 能力。新增独立 `ConnectivityProbe` 回调类型，由调用方注入。
- **[HIGH] 采纳 — 测试调用面覆盖**: 所有 7 个现有测试从同步改为 `async/await`。新增 7 个 connectivity probe 测试。
- **reason 枚举扩展**: 新增 `connectivity_failed`。

#### Fix 2: CONTEXT.md 检查 修订

- **[HIGH] 采纳 — 不做 preDispatchHealthGate hard block**: 撤销原方案中将检查前移到 `preDispatchHealthGate()` 的设计。保持 #4671 dispatch recovery rule 为唯一控制点。
- **替代方案**: 仅在 `doctor-lite.ts` 中对 active milestone + execution-entry phase 时将 `missing_context` 从 warning 提升为 error（纯诊断，不改变 dispatch 控制流）。

#### Fix 3: Stuck-state 清理 修订

- **[MEDIUM] 部分采纳 — 语义化清理**: TTL 从 24h 放宽至 72h，并新增 paused-session 保护（`pausedAt >= updatedAt` 时不清理）。
- **[MEDIUM] 采纳 — 补充 milestone 已完成清理**: 实现设计表格中"milestone 已完成时清理对应条目"的逻辑，通过 DB 查询判断 `isClosedStatus`。
