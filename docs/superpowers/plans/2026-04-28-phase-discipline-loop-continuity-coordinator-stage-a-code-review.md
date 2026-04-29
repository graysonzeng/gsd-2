# Phase-Discipline Loop Continuity · 第二批 · 阶段 A — Coordinator 基础设施 · Code Review

## 审查范围

- 设计文档：`docs/superpowers/specs/2026-04-28-phase-discipline-loop-continuity-coordinator-stage-a-design.md`
- 实现文档：`docs/superpowers/plans/2026-04-28-phase-discipline-loop-continuity-coordinator-stage-a-implementation.md`
- 代码变更：
  - `src/resources/extensions/gsd/auto/continuity-coordinator.ts`
  - `src/resources/extensions/gsd/auto/loop.ts`
  - `src/resources/extensions/gsd/auto/types.ts`
  - `src/resources/extensions/gsd/auto/phases.ts`
  - `src/resources/extensions/gsd/tests/continuity-coordinator.test.ts`

## 需求拆解

### 目标
- 验证 continuity emit 已从 `loop.ts` 下沉到 coordinator，且行为与设计一致。
- 验证 custom-engine 9 处 emit、PhaseResult 读取方式、pause 工厂成对绑定、phases return-site 迁移与 loop.ts 清理是否全部落地。
- 识别设计一致性偏差、回归风险和测试盲点。

### 范围
- 只读审查，不改代码。
- 既看设计/实现文档，也看完整源码上下文，不只看 diff。
- 重点覆盖用户指定的五项核查点。

### 约束
- 结论必须使用 `PASS / PASS_WITH_NOTES / NEEDS_REVISION / NEEDS_FIX` 之一。
- 发现必须按严重级别记录，并附文件定位。

### 成功标准
- 五项重点核查项均有明确结论。
- 若发现问题，必须说明它是设计偏差、实现偏差还是文档/实现不一致。

## 设计一致性评估

### 已对齐项

1. **§3.2 custom-engine 9 处 emit 基本落地完整**
   - `loop.ts` 中实际存在 9 处 `coordinator.emitCustomEngine(...)`，并覆盖设计表格的 9 个出口场景。
   - `recovery.outcome === "skip"` 已按设计归类为 `stop-error / safety-required`。

2. **§3.1 coordinator.emitPhase 已直接读取 PhaseResult 字段**
   - `continuity-coordinator.ts` 中 `emitPhase()` 直接读取 `result.reason / result.signal / result.breakpointClass`。
   - 未保留三元死代码，也未保留 `"in"` 守卫。

3. **§3.3.2 三个 pause 工厂已按类型层成对绑定实现**
   - `humanPauseBreak / providerPauseBreak / budgetPauseBreak` 都固定产出唯一 `(signal, breakpointClass)` 对。
   - `retryLoopContinue / terminalBreak / noProgressBreak / errorBreak` 也符合设计约束。

4. **phases.ts 工厂迁移基本完成**
   - 设计要求的 4 处条件 signal 已拆成 if/else。
   - 两条 retry continue 路径已迁移为 `retryLoopContinue(...)`。
   - `grep` 结果显示 `phases.ts` 中不再保留字面量 `signal:` / `breakpointClass:` return-site。

5. **loop.ts 清理目标已达成**
   - `loop.ts` 已不再定义 `emitContinuityDecision / buildPhaseContinuityDecision`。
   - 文件内未发现 `"signal" in` / `"breakpointClass" in`。
   - dev 路径 5 处 `emitPhase`、custom-engine 9 处 `emitCustomEngine` 数量都对上设计。

## 审查发现

### [HIGH] 设计一致性: `git-closeout-failure` 被错误归类为 human pause，覆盖了设计要求的 stop-error 语义

**文件**: `docs/superpowers/specs/2026-04-28-phase-discipline-loop-continuity-coordinator-stage-a-design.md:392-397`, `src/resources/extensions/gsd/auto/phases.ts:2140-2149`, `docs/superpowers/plans/2026-04-28-phase-discipline-loop-continuity-coordinator-stage-a-implementation.md:165`

**问题**: 设计 §3.4.2/§3.4.1 明确把 `git-closeout-failure` 归到 `errorBreak(reason)`，即 `stop-error / safety-required`。但实现在 `runFinalize()` 中将 `dispatchedReason = s.lastGitActionFailure ? "git-closeout-failure" : "pre-verification-dispatched"` 统一走 `humanPauseBreak(dispatchedReason)`。这使 `git-closeout-failure` 被错误标记成 `pause-human / human-required`，与设计语义冲突。实现文档 §4.4 也把这一错误实现记录成“已完成”，说明文档与代码一起漂移了。

**影响**: closeout/git 失败本应被 continuity 决策视为 safety-required stop，但当前会被伪装成 human pause。这样会污染 `lastContinuityDecision`、journal 中的 `continuity-decision` 事件以及后续阶段 B 基于 decision 的 loop-action 判定，导致真实错误被误分类成“可恢复暂停”。这不是纯文档问题，而是行为语义错误。

**建议**: 将 `preResult === "dispatched"` 分支拆开处理：`pre-verification-dispatched` 继续走 `humanPauseBreak(...)`，而 `git-closeout-failure` 改为 `errorBreak("git-closeout-failure")`；同时修正实现文档 §4.4 对该 return-site 的记录，并补一条测试覆盖 finalize 预验证 dispatched 且 `lastGitActionFailure` 为真时的 continuity 分类。

## 测试覆盖评估

- `tests/continuity-coordinator.test.ts` 覆盖了 coordinator 基本契约、pair invariant 和 factory parity，这部分有效。
- 但当前没有测试覆盖 `runFinalize()` 中 `git-closeout-failure` 与 `pre-verification-dispatched` 的分类分流，因此该偏差未被测试拦住。
- 这暴露出一个风险：factory parity 测试只能证明工厂本身正确，不能证明调用点选择了正确工厂。后续应补 phase-level 分类测试，而不只是 helper-level 测试。

## 证据汇总（对应用户重点核查）

1. **§3.2 custom-engine 9 处 emit**
   - 代码对齐：`src/resources/extensions/gsd/auto/loop.ts:544-549,559-564,628-635,660-667,677-684,697-704,738-745,756-763,774-781`
   - 结论：**通过**，`recovery.outcome === "skip"` 分支也已对齐设计。

2. **§3.1 emitPhase 直接读字段，无三元/无 `in` 守卫**
   - 代码证据：`src/resources/extensions/gsd/auto/continuity-coordinator.ts:49-62`
   - 结论：**通过**。

3. **§3.3.2 三个 pause 工厂类型层成对绑定**
   - 代码证据：`src/resources/extensions/gsd/auto/types.ts:362-390`
   - 结论：**通过**。

4. **phases.ts break return-site 迁移与 4 处条件 signal 拆分**
   - 条件拆分证据：`src/resources/extensions/gsd/auto/phases.ts:946-954,1014-1023,1045-1053,1906-1907`
   - 工厂化证据：`src/resources/extensions/gsd/auto/phases.ts:292,352,390,453,523,596,605,710,718,780,796,814,838,846,874,896,950,954,1018,1023,1049,1053,1129,1167,1192,1216,1284,1290,1362,1373,1421,1494,1737,1846,1906,1907,1919,1933,1954,2149,2173,2184,2207,2218,2250,2256`
   - 结论：**大体通过，但存在 1 处高优先级误分类**（`git-closeout-failure`）。

5. **loop.ts 不再保留旧 helper / `in` 守卫**
   - 代码证据：`src/resources/extensions/gsd/auto/loop.ts:24,360,373,804,820,830,879,896`，且 grep 未发现 `emitContinuityDecision / buildPhaseContinuityDecision / "signal" in / "breakpointClass" in`
   - 结论：**通过**。

## 最终结论

**NEEDS_REVISION**

整体实现质量较好，用户指定的五项重点中有四项实质达成，custom-engine 9 处 emit、coordinator 下沉、pair invariant 与工厂迁移都落到了代码里。但 `git-closeout-failure` 的 continuity 分类与设计明确冲突，且该错误已经扩散到实现文档，说明当前提交还不能算“设计目标被正确落地”。修复该分类问题并补相应测试后，预期可快速复审通过。

## 风险与建议

- 当前最大风险不是“漏 emit”，而是“emit 了错误语义”。这比单纯缺点位更隐蔽，因为日志看起来完整，但 decision 含义是错的。
- 跳出当前思路的一条建议：阶段 B 既然会消费 `lastContinuityDecision` 驱动 loop action，就不要只测 helper/factory；应给 `runFinalize`、`runDispatch` 这类 phase 边界加一层“reason → expected continuity tuple”的表驱动测试，否则以后很容易再出现“工厂对了、调用点错了”的回归。

## 下一步

### 同会话继续

直接执行 /fix-implement

### 新会话恢复 prompt

```text
请阅读实现文档 docs/superpowers/plans/2026-04-28-phase-discipline-loop-continuity-coordinator-stage-a-implementation.md、
审查文档 docs/superpowers/plans/2026-04-28-phase-discipline-loop-continuity-coordinator-stage-a-code-review.md 的修复记录，
对本轮修复结果补做下一轮检查；重点关注文档中记录的剩余风险与复审范围。
```

---

## 修复记录

### fix-implement round 1（2026-04-28）

#### HIGH: `git-closeout-failure` 错误归类修复

**问题**：设计 §3.4.2/§3.4.1 明确把 `git-closeout-failure` 归到 `errorBreak`，即 `stop-error / safety-required`。但实现将 `git-closeout-failure` 与 `pre-verification-dispatched` 统一走 `humanPauseBreak`，错误分类。

**修复内容**：

1. **`src/resources/extensions/gsd/auto/phases.ts`** — 拆分 `preResult === "dispatched"` 分支：
   - `git-closeout-failure` → `errorBreak("git-closeout-failure")`
   - `pre-verification-dispatched` → `humanPauseBreak("pre-verification-dispatched")`

2. **`src/resources/extensions/gsd/tests/continuity-coordinator.test.ts`** — 新增测试用例 `runFinalize git-closeout-failure uses errorBreak, not humanPauseBreak`：
   - 验证 `git-closeout-failure` → `errorBreak` 返回 `{ action: "break", reason: "git-closeout-failure", signal: "stop-error", breakpointClass: "safety-required" }`
   - 对比 `pre-verification-dispatched` 正确使用 `humanPauseBreak`

3. **`docs/superpowers/plans/...-implementation.md` §4.4** — 更新 return-site 记录：
   - 原行 40 拆分为 40a（git-closeout-failure / errorBreak）和 40b（pre-verification-dispatched / humanPauseBreak）
   - 合计从 46 处更新为 47 处工厂调用

**验证结果**：
- ✅ `npm run typecheck:extensions` — 通过
- ✅ `continuity-coordinator.test.ts` — 6/6 pass（含新增用例）
- ✅ `continuity-decision.test.ts` — 33/33 pass
- ✅ `crash-recovery.test.ts` — 全 pass
- ✅ `journal-integration.test.ts` — 19/19 pass

**结论**：所有 CRITICAL/HIGH 问题已关闭，代码达到可合并状态。
