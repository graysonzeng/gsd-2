# Auto Loop 安全路线改造方案

> **状态**: 评审已响应，第一批增量实现已完成
> **日期**: 2025-04-25
> **作者**: Codex (GPT-5.3)
> **评审**: Claude Opus 4.7
> **修订**: Cascade, 2026-04-25

---

## 一、原设计方案

### 1. 设计目标

实现一个 auto loop 模式：

- 每一轮只调用现有 auto 推进 **一个 unit**
- 每轮结束后执行验证与状态检查
- 只有当前 unit 明确完成且验证通过，才进入下一轮
- 遇到失败、阻塞、无 ready unit、人工确认点、达到上限时立即停止
- 产出清晰的 loop report，说明推进了哪些 unit、在哪停止、原因是什么

**核心原则**：不改变"单次 auto 只推进一个 unit"的内核约束，而是在外层加一个可审计、可停止、逐 unit 验证的循环编排器。

### 2. 为什么现在单次 auto 只推进一个 unit

从 phase discipline 的设计角度看，这通常是为了保证：

1. **验证边界清晰** - 一个 unit 完成后必须检查 artifact / milestone / status。如果一次跨多个 unit，后续失败时难判断是哪一步引入问题。
2. **避免错误级联** - 自动流程一旦误判 ready 状态，连续推进会放大损害。单 unit 模式把 blast radius 限制在最小。
3. **保留人工介入点** - 某些 unit 可能需要 review、确认、外部资源、设计决策。auto 不应默认跨过这些点。
4. **便于恢复** - 每个 unit 都是 checkpoint。失败后可以从明确状态继续，而不是从一坨半完成流程中恢复。

### 3. 推荐架构

新增一个外层编排层，概念上叫：

```
auto --loop / auto-start loop mode
```

结构如下：

```
AutoLoopRunner
  ├─ preflight()
  ├─ while shouldContinue:
  │    ├─ detectNextReadyUnit()
  │    ├─ runSingleAuto()
  │    ├─ validateUnitCompletion()
  │    ├─ runVerificationChain()
  │    ├─ writeCheckpoint()
  │    └─ decideNextIteration()
  └─ writeLoopReport()
```

关键点：`runSingleAuto()` 仍调用现有单 unit auto，不改它的边界语义。

### 4. 状态机设计

**Loop 状态**

```typescript
type AutoLoopStatus =
  | 'idle'
  | 'running'
  | 'stopped'
  | 'completed'
  | 'failed'
  | 'blocked';
```

**单轮结果**

```typescript
type AutoLoopIterationResult =
  | { status: 'advanced'; unitId: string; verification: 'passed'; }
  | { status: 'no-ready-unit'; }
  | { status: 'blocked'; unitId?: string; reason: string; }
  | { status: 'failed'; unitId?: string; reason: string; };
```

**循环停止原因**

```typescript
type AutoLoopStopReason =
  | 'no-ready-unit'
  | 'max-iterations-reached'
  | 'verification-failed'
  | 'auto-failed'
  | 'manual-gate'
  | 'state-unchanged'
  | 'external-cancelled'
  | 'timeout';
```

特别建议加入 `state-unchanged`：如果一轮 auto 运行后没有任何 unit 状态变化，必须停，防止死循环。

### 5. 循环条件

每一轮继续前必须满足：

1. 存在 exactly one 或可明确选择的 next ready unit
2. 当前没有 failed / blocked / manual-review 状态
3. 上一轮验证通过
4. 未超过最大轮数
5. 未超过总 timeout
6. repo/workspace 状态符合预期
7. auto loop lock 未被其他进程持有

伪代码：

```python
while (true) {
  if (iterations >= maxIterations) stop('max-iterations-reached');
  if (Date.now() > deadline) stop('timeout');

  const next = detectNextReadyUnit();
  if (!next) stop('no-ready-unit');
  if (next.requiresManualGate) stop('manual-gate');

  const before = snapshotState();

  const result = await runSingleAuto();
  if (!result.ok) stop('auto-failed');

  const after = snapshotState();
  if (isSameState(before, after)) stop('state-unchanged');

  const completion = validateUnitCompletion(next.id);
  if (!completion.ok) stop('verification-failed');

  const verification = await runVerificationChain(next.id);
  if (!verification.ok) stop('verification-failed');

  writeCheckpoint(next.id);

  continue;
}
```

### 6. 验证链路

每个 unit 后必须执行分层验证，不能只看 auto exit code。

**第一层：状态验证**

确认 unit 状态真的推进了：
- ready → running → done
- 或 active milestone 发生预期变化
- 不允许停留在 running/pending
- 不允许多个 unit 被意外推进

**第二层：artifact 验证**

检查 unit 要求产物是否存在且非空：
- handoff 文档
- report
- generated artifact
- status file
- validation marker

**第三层：命令验证**

按现有项目定义运行：
1. related tests
2. lint
3. typecheck
4. build
5. 必要时运行 e2e/smoke

两档设计：
- `--verify=unit` 轻量：unit 相关测试 + typecheck
- `--verify=full` 完整：test + lint + typecheck + build

**第四层：功能验证**

如果 unit 涉及 UI 或流程行为，必须有 smoke check：
- headless browser
- CLI dry run
- snapshot/report existence
- known golden path

### 7. 默认停止策略

auto loop 必须保守停止，不能"猜测继续"。

| 场景 | 停止原因 |
|-----|---------|
| 没有 ready unit | `no-ready-unit` |
| 存在多个 ready 但无明确排序 | `blocked` |
| unit 需要人工确认 | `manual-gate` |
| auto exit 非 0 | `auto-failed` |
| 验证失败 | `verification-failed` |
| 一轮后状态没变化 | `state-unchanged` |
| 产物缺失 | `verification-failed` |
| 达到最大轮数 | `max-iterations-reached` |
| 超时 | `timeout` |
| 工作区出现非预期变更 | `blocked` |

### 8. 配置建议

```typescript
interface AutoLoopOptions {
  enabled: boolean;
  maxIterations: number;
  maxDurationMs: number;
  verifyMode: 'unit' | 'full';
  stopOnDirtyWorkspace: boolean;
  requireArtifactValidation: boolean;
  requireStateChange: boolean;
  allowMultipleReadyUnits: boolean;
  dryRun: boolean;
}
```

推荐默认值：

```json
{
  "enabled": false,
  "maxIterations": 5,
  "maxDurationMs": 1800000,
  "verifyMode": "full",
  "stopOnDirtyWorkspace": true,
  "requireArtifactValidation": true,
  "requireStateChange": true,
  "allowMultipleReadyUnits": false,
  "dryRun": false
}
```

### 9. CLI / UX 设计

**预览**

```bash
auto --loop --dry-run
```

输出：

```
Would run:
1. unit: phase-discipline-auto-mode-validator
2. unit: auto-start-e2e-validation
3. stop: manual gate before release
```

**安全默认**

```bash
auto --loop
```

默认最多 5 个 unit，每个 unit 后完整验证。

**显式上限**

```bash
auto --loop --max-units 3
```

### 10. Report 设计

```json
{
  "status": "stopped",
  "stopReason": "no-ready-unit",
  "startedAt": "...",
  "endedAt": "...",
  "iterations": [
    {
      "index": 1,
      "unitId": "unit-a",
      "autoResult": "passed",
      "artifactValidation": "passed",
      "verification": "passed",
      "durationMs": 120000
    },
    {
      "index": 2,
      "unitId": "unit-b",
      "autoResult": "passed",
      "artifactValidation": "passed",
      "verification": "passed",
      "durationMs": 98000
    }
  ]
}
```

人类可读 summary：

```
Auto loop stopped: no ready unit.
Advanced 2 units:
- unit-a: passed
- unit-b: passed
```

### 11. 并发与锁

必须加 lock，避免两个 auto loop 同时推进：

```
.auto-loop.lock
```

lock 内容：

```json
{
  "pid": 12345,
  "startedAt": "...",
  "command": "auto --loop"
}
```

启动时：
- lock 不存在：创建
- lock 存在且进程活着：拒绝启动
- lock 存在但进程不存在：提示 stale lock，需要显式清理或自动安全清理

### 12. 工作区安全策略

auto loop 开始前检查 git 工作区。

建议策略：
- 如果有用户未提交变更，默认停止
- 如果这些变更是 auto 本轮产生的，允许继续
- 每轮记录 diff summary
- 不自动 commit，除非已有项目约定

### 13. 与现有单次 auto 的关系

不要把原来的 `runAuto()` 改成内部循环。

应该新增 `runAutoLoop()` 并复用 `runAutoOnce()`：

```typescript
export async function runAutoOnce(options): Promise<AutoOnceResult> {
  // 现有逻辑
}

export async function runAutoLoop(options): Promise<AutoLoopResult> {
  // 新增外层循环
}
```

### 14. 测试方案

**单元测试**

覆盖：
1. no ready unit → stop
2. one ready unit + pass → continue
3. auto failure → stop
4. verification failure → stop
5. state unchanged → stop
6. max iterations reached → stop
7. manual gate → stop
8. multiple ready units without ordering → stop
9. stale lock handling
10. dry run 不执行 auto

**集成测试**

构造 mini phase plan：

```
unit-a ready
unit-b blocked by unit-a
unit-c blocked by unit-b
```

运行：

```bash
auto --loop --max-units 3
```

断言：
- unit-a/b/c 依次完成
- 每个 unit 产物存在
- report 记录 3 轮
- 第 4 轮因 no-ready-unit 停止

**回归测试**

必须保证 `auto` 仍然只推进一个 unit。

### 15. 分阶段落地计划

**Phase 1：只读 dry-run**

目标：先能判断 loop 会跑什么，但不执行。

交付：
- `auto --loop --dry-run`
- next ready unit 检测
- stop reason
- report preview

**Phase 2：loop runner，但每轮只调用现有 auto once**

目标：真正连续推进，但不改 auto 内核。

交付：
- runAutoLoop
- max iterations
- timeout
- lock
- state snapshot
- report

**Phase 3：验证链路接入**

目标：每轮后强校验。

交付：
- artifact validator
- test/lint/typecheck/build runner
- verification summary
- failure stop

**Phase 4：开发体验优化**

目标：让用户能放心使用。

交付：
- readable console output
- resume hint
- failed unit diagnosis
- maybe `--verify=unit/full`

### 16. 最小可行版本

如果想第一版尽快可用，建议只做：

```bash
auto --loop --max-units N
```

行为：
1. 创建 lock
2. 循环 N 次
3. 每次执行现有 auto once
4. 检查状态是否变化
5. 调用现有 validator
6. 失败即停
7. 输出 report
8. 保证原 auto 不变

不要第一版就做：
- until done
- 自动 commit
- 自动修复失败
- 多 ready unit 智能选择
- 跳过验证
- 后台 daemon

### 17. 最终方案建议

第一版采用：

```bash
auto --loop --max-units 5 --verify=full
```

默认行为：
- 保留 auto 单 unit
- `--loop` 显式开启
- 每轮严格验证
- 任意异常立即停止
- 生成 loop report
- 不自动 commit
- 不跨 manual gate
- 不处理多个 ambiguous ready units
- 不支持无限 until-done

**一句话**：让它自动继续，但每一步都像现在单次 auto 一样严肃验收。

---

## 二、代码评审

### 1. 总体评估

**方案方向正确，但需要重大修订**

原方案与现有架构存在**高度重叠**。`auto/loop.ts` 已经实现了核心循环逻辑。描述的很多内容需要以"增量增强"而非"重新设计"的方式实现。

### 2. 现有架构 vs 提案对照

| 提案功能 | 现有实现 | 状态 |
|---------|---------|------|
| 单次迭代一个 unit | `autoLoop` 本身就是 | ✅ 已有 |
| 迭代次数限制 | `MAX_LOOP_ITERATIONS=500` | ✅ 已有 |
| 状态快照对比 | 无状态变化检测 | ❌ **缺失** |
| 验证链路 | `runPostUnitVerification` | ✅ 已有 |
| loop report | 无结构化 report | ❌ **缺失** |
| `state-unchanged` 停止条件 | 无 | ❌ **缺失** |
| `auto-loop.lock` | 只有 `auto.lock` 和 session-lock | ⚠️ 部分 |
| `--dry-run` 预览 | 无 | ❌ **缺失** |
| `--max-units` 限制 | 无（硬编码500） | ⚠️ 可配置化 |

### 3. 核心问题：提案假设了架构不存在

提案第 3 节描述：

```
AutoLoopRunner
  ├─ preflight()
  ├─ while shouldContinue:
  │    ├─ detectNextReadyUnit()
  │    ├─ runSingleAuto()
  │    ├─ validateUnitCompletion()
  │    ├─ runVerificationChain()
  │    ├─ writeCheckpoint()
  │    └─ decideNextIteration()
  └─ writeLoopReport()
```

**实际架构** (`auto/loop.ts:268-813`)：

```typescript
while (s.active) {
  // 1. deriveState → resolveDispatch (对应 detectNextReadyUnit)
  // 2. runUnitPhase (对应 runSingleAuto)
  // 3. runPostUnitVerification (对应 runVerificationChain)
  // 4. writeCheckpoint 不存在
  // 5. loop report 不存在
  // 6. state-unchanged 检测不存在
}
```

**问题**：提案假设 `runSingleAuto()` 是黑盒，但实际是内联逻辑，无法直接替换。需要重构才能实现"外层循环调用现有 auto"。

### 4. 具体建议

#### 4.1 必须添加的功能

**A. `state-unchanged` 检测（第 5 节）**

当前缺失，需要在 `auto/loop.ts` 的每轮迭代结束时添加：

```typescript
// 在 runFinalize 之后
const afterState = await deps.deriveState(s.basePath);
if (isStateUnchanged(beforeState, afterState)) {
  await deps.stopAuto(ctx, pi, "State unchanged — no progress made");
  break;
}
```

**B. 结构化 Loop Report（第 10 节）**

```typescript
interface LoopIteration {
  index: number;
  unitId: string;
  autoResult: 'passed' | 'failed';
  artifactValidation: 'passed' | 'failed';
  verification: 'passed' | 'failed';
  durationMs: number;
}

interface LoopReport {
  status: 'completed' | 'stopped' | 'failed';
  stopReason: AutoLoopStopReason;
  startedAt: string;
  endedAt: string;
  iterations: LoopIteration[];
}
```

**C. 可配置的 `maxIterations`**

将硬编码的 500 改为可配置：

```typescript
interface AutoLoopConfig {
  maxIterations: number;  // 默认 5（提案建议）
  maxDurationMs: number;
  // ...
}
```

#### 4.2 缺失的停止条件（第 7 节）

| 停止条件 | 实现建议 |
|---------|---------|
| `state-unchanged` | 添加状态快照对比逻辑 |
| `no-ready-unit` | `resolveDispatch` 返回 stop 时已有 |
| `verification-failed` | `runPostUnitVerification` 返回 pause 时已有 |
| `manual-gate` | 需要新增检测逻辑 |

#### 4.3 Lock 机制（第 11 节）

现有 lock 已有：
- `auto.lock` - crash recovery
- `session-lock` - 进程级锁

需要新增 `.auto-loop.lock` 来防止并发的 loop 实例。

### 5. 架构建议

**不要创建新的 `AutoLoopRunner` 类**，而是扩展现有 `autoLoop`：

```typescript
// 建议方案：在 auto/loop.ts 中添加

interface LoopOptions {
  maxIterations?: number;  // 默认 5
  maxDurationMs?: number; // 默认 30min
  verifyMode?: 'unit' | 'full';
  stopOnStateUnchanged?: boolean;  // 默认 true
  dryRun?: boolean;
  // ...
}

// 扩展现有 while 循环
while (s.active) {
  if (iteration > maxIterations) break;
  if (Date.now() > deadline) break;

  const beforeState = snapshotState();

  // ... 现有逻辑 ...

  const afterState = snapshotState();
  if (stopOnStateUnchanged && isStateUnchanged(beforeState, afterState)) {
    await deps.stopAuto(ctx, pi, "State unchanged");
    loopReport.stopReason = 'state-unchanged';
    break;
  }
}

writeLoopReport(loopReport);
```

### 6. 风险评估

| 风险 | 级别 | 建议 |
|-----|-----|------|
| 重构 `autoLoop` 影响现有功能 | **高** | 渐进式修改，添加 feature flag |
| `--dry-run` 需要完整的状态推导但不执行 | 中 | 可复用现有 `resolveDispatch` 逻辑 |
| 状态快照性能开销 | 低 | 快照应只比较关键字段 |

### 7. 总结

**方案可行性**：✅ 可行，但需要修订

**主要修订方向**：
1. **不是"新建外层循环"**，而是**扩展现有 `autoLoop`**
2. **不是"调用现有单次 auto"**，而是**添加缺失的检查点**
3. **关注 gap**：状态变化检测、结构化 report、`maxIterations` 可配置化

**工作量评估**：
- `state-unchanged` 检测：~50 行
- Loop report 结构：~100 行
- 配置化 `maxIterations`：~20 行
- Lock 增强：~50 行

**不需要改动**：
- 验证链路（已有）
- 单 unit 推进逻辑（已有）
- Dispatch 规则（已有）

---

## 三、关键代码位置

| 模块 | 文件路径 | 说明 |
|-----|---------|------|
| 主循环 | `src/resources/extensions/gsd/auto/loop.ts` | `autoLoop()` 函数 |
| 类型定义 | `src/resources/extensions/gsd/auto/types.ts` | `LoopState`, `IterationContext` |
| 验证逻辑 | `src/resources/extensions/gsd/auto-verification.ts` | `runPostUnitVerification()` |
| Dispatch 规则 | `src/resources/extensions/gsd/auto-dispatch.ts` | `resolveDispatch()` |
| Session 状态 | `src/resources/extensions/gsd/auto/session.ts` | `AutoSession` 类 |
| Lock 机制 | `src/resources/extensions/gsd/session-lock.ts` | `acquireSessionLock()` |
| Crash recovery lock | `src/resources/extensions/gsd/crash-recovery.ts` | `writeLock()`, `clearLock()` |

---

## 四、/review-response

### 1. 评审结论

Claude Code 的评审内容**总体合理，采纳其核心方向**：

1. **不新建外层 `AutoLoopRunner`**：现有 `auto/loop.ts` 已经是主循环，重新包一层 runner 会造成重复状态机、重复锁与重复恢复路径。
2. **不把现有 auto 拆成 `runAutoOnce()` 再由外层调用**：当前 auto loop 的真实边界是 `derive → dispatch → guard → runUnit → finalize`，并且已经承载 crash recovery、verification retry、sidecar queue、custom engine、session lock、budget/context guard 等逻辑。强行抽象成黑盒 once 会引入高风险重构。
3. **以 gap 补强为主**：应该优先补 `state-unchanged` 检测、结构化 report、`maxIterations`/timeout 可配置化，而不是改写调度内核。

### 2. 对评审的补充判断

评审中也有需要修正的点：

1. **`maxIterations` 默认值不应立即改成 5**：现有默认 `MAX_LOOP_ITERATIONS=500` 是长期 auto-mode 的逃逸保护。直接改成 5 会破坏现有自动推进语义。第一批实现保留 500 默认值，只允许通过 `auto_loop.max_iterations` 或测试级 `AutoLoopOptions.maxIterations` 覆盖。
2. **`state-unchanged` 不应默认开启**：现有状态 derivation 不一定覆盖所有 side effect，默认硬停可能误杀有效 unit。第一批实现将其作为 `auto_loop.stop_on_state_unchanged` 的显式安全开关。
3. **`.auto-loop.lock` 暂不新增**：现有 `session-lock` 已经提供进程级互斥，另加 loop lock 需要和 crash recovery / paused resume 语义一起设计，不能在第一批低风险改动中仓促落地。
4. **`--dry-run` 暂缓**：dry-run 需要 CLI 参数、dispatch preview、hook/sidecar/custom engine 预览语义，独立于本次安全闭环，放入后续阶段。

### 3. 修订后的第一批实施方案

第一批只做低侵入、可测试、与现有架构一致的增量增强：

1. **配置化 loop safety**
   - 增加 `auto_loop.max_iterations`
   - 增加 `auto_loop.max_duration_ms`
   - 增加 `auto_loop.stop_on_state_unchanged`
   - 增加 `auto_loop.write_report`

2. **结构化 loop report**
   - auto-loop 退出时写入 `.gsd/runtime/auto-loop-report.json`
   - 记录 `status`、`stopReason`、起止时间、总耗时、总迭代数、每轮 unit/status/failureClass/error

3. **可选 `state-unchanged` 停止条件**
   - 在 dispatch 后记录关键状态签名
   - finalize 成功后重新 derive state
   - 如果签名不变且开关开启，则 `stopAuto` 并以 `state-unchanged` 写入 report

4. **保守默认**
   - 不改变原 auto-mode 默认推进能力
   - 不默认开启状态无变化硬停
   - 不改变验证链路、dispatch 规则、custom engine 核心语义

## 五、下一步行动

1. **已完成**: 在 `auto/loop.ts` 中添加可选 `state-unchanged` 检测
2. **已完成**: 添加结构化 `AutoLoopReport` 类型和写入逻辑
3. **已完成**: 将 `MAX_LOOP_ITERATIONS` 变为可通过 `auto_loop.max_iterations` / `AutoLoopOptions.maxIterations` 覆盖
4. **后续阶段**: 设计并实现 `--dry-run` 模式支持
5. **后续阶段**: 评估是否需要 loop 级别 lock，避免和现有 `session-lock`/crash recovery 重叠
