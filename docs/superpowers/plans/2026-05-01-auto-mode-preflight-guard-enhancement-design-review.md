# Design Review: Auto-mode Pre-flight Guard 增强

- Design doc: `docs/superpowers/specs/2026-05-01-auto-mode-preflight-guard-enhancement-design.md`
- Review date: 2026-05-01
- Scope: Provider connectivity ping async 化、`preDispatchHealthGate` 中的 `CONTEXT.md` 检查、stuck-state TTL 清理

## Review Scope

本次重点评审以下 3 点：

1. Provider ping 从同步校验扩展为异步网络探测后，对调用链和接口面的影响是否覆盖完整。
2. `CONTEXT.md` 检查放进 `preDispatchHealthGate()` 后，是否会与 dispatch 恢复规则 `#4671` 发生控制流竞争。
3. stuck-state 的 `24h TTL` 是否会对 pause / resume / 跨 session 恢复场景过于激进。

同时从需求方向、方案合理性、实现可行性和文档完整性四个维度做只读评审。

## Main Findings

### [HIGH] 调用链覆盖: Provider ping async 化的影响面没有覆盖测试与类型契约，文档低估了改动半径

**位置**: 设计文档 5.1/5.5，尤其是“调用方适配只有 `auto-start.ts` 和 `auto.ts` 两处”这一判断

**问题**: 方案明确将 `validatePhaseDisciplinePreflight()` 从同步改为异步，但设计文档只列出了两个业务调用点，却没有覆盖同一函数的测试调用点和类型契约变化。当前代码里除了 [auto-start.ts](/Users/sheng/tencent/gsd-2/src/resources/extensions/gsd/auto-start.ts#L721) 与 [auto.ts](/Users/sheng/tencent/gsd-2/src/resources/extensions/gsd/auto.ts#L277) 外，现有单测 [preflight.test.ts](/Users/sheng/tencent/gsd-2/src/resources/extensions/gsd/phase-discipline/tests/preflight.test.ts#L29) 到 [preflight.test.ts](/Users/sheng/tencent/gsd-2/src/resources/extensions/gsd/phase-discipline/tests/preflight.test.ts#L178) 全部按同步返回值写法使用该函数；同时 `PhaseDisciplinePreflightModelRegistry` 当前只暴露 `getAvailable` / `isProviderRequestReady` / `getProviderAuthMode`，并不具备执行真实 ping 所需的 request 能力，文档中的 `pingProvider(..., registry, ...)` 也没有说明要把什么能力注入到 registry 或从哪里拿认证信息。

**影响**: 如果按当前文档直接实现，调用方并不止两处，测试会批量失效；更重要的是，ping 能力的宿主对象没有定义清楚，容易把 `preflight.ts` 强行绑到比现在更重的 runtime/SDK 依赖上，造成实现阶段返工。

**建议**: 在设计里显式补齐三部分内容：
1. 把 `validatePhaseDisciplinePreflight()` 的所有调用面分成“生产调用点”和“测试调用点”两类列出，并把测试迁移到 `await` 作为明确工作项。
2. 不要继续把 ping 能力含糊地挂在现有 registry 接口上；应新增独立依赖，例如 `connectivityProbe?: (provider, model, opts) => Promise<...>`，由 `auto.ts/auto-start.ts` 传入，避免把 `PhaseDisciplinePreflightModelRegistry` 膨胀成网络客户端。
3. 明确 `formatPhaseDisciplinePreflightFailure`、issue `reason` 枚举和测试 fixture 也要同步升级，否则文档声称的细粒度错误分类无法落地。

### [HIGH] 控制流竞争: 在 `preDispatchHealthGate()` 阻断缺失 CONTEXT 会直接推翻现有 #4671 dispatch 恢复语义

**位置**: 设计文档 5.2；现有实现链路见 [auto/phases.ts](/Users/sheng/tencent/gsd-2/src/resources/extensions/gsd/auto/phases.ts#L366) 到 [auto/phases.ts](/Users/sheng/tencent/gsd-2/src/resources/extensions/gsd/auto/phases.ts#L440)、[auto-dispatch.ts](/Users/sheng/tencent/gsd-2/src/resources/extensions/gsd/auto-dispatch.ts#L364) 到 [auto-dispatch.ts](/Users/sheng/tencent/gsd-2/src/resources/extensions/gsd/auto-dispatch.ts#L399)

**问题**: 当前真实控制流是先跑 `preDispatchHealthGate()`，再 `deriveState()` / `plan-v2 gate`，最后进入 dispatch 规则；而 `#4671` 的设计目的是“缺失 finalized `CONTEXT.md` 时，不在 pre-dispatch 阶段暂停，而是把控制权交给 dispatch recovery rule 重派发到 `discuss-milestone`”。这一行为已被回归测试固定在 [journal-integration.test.ts](/Users/sheng/tencent/gsd-2/src/resources/extensions/gsd/tests/journal-integration.test.ts#L733) 到 [journal-integration.test.ts](/Users/sheng/tencent/gsd-2/src/resources/extensions/gsd/tests/journal-integration.test.ts#L783)；dispatch 规则自身也对 continuation 场景做了更细的 stop-vs-redispatch 区分，见 [execution-entry-missing-context-4671.test.ts](/Users/sheng/tencent/gsd-2/src/resources/extensions/gsd/tests/execution-entry-missing-context-4671.test.ts#L225) 到 [execution-entry-missing-context-4671.test.ts](/Users/sheng/tencent/gsd-2/src/resources/extensions/gsd/tests/execution-entry-missing-context-4671.test.ts#L262)。把同一检查前移到 `preDispatchHealthGate()` 并在 `visibility.status !== "present"` 时统一 `proceed: false`，会让 dispatch 根本拿不到执行机会，直接与 #4671 竞争，而且行为从“自动恢复到 discuss”变成“立刻 pause”，与现有契约相反。

**影响**: 这不是简单的“多一道保险”，而是语义覆盖。实现后会打破现有 #4671 回归测试，且会丢失 continuation 场景下 `path-conflict` / `lookup-base-mismatch` 的精细诊断路径，把所有情况都粗暴收敛成 health-gate block。

**建议**: 不建议按文档把该检查做成 `preDispatchHealthGate()` 的 hard block。更合理的路径有两种，二选一：
1. 保持 `#4671` 为唯一控制点，只在 doctor/doctor-lite 中增强诊断和提示，不改变 pre-dispatch 的放行语义。
2. 如果一定要前移检查，则 `preDispatchHealthGate()` 只能对“确定应 stop 的 continuation inconsistency”做阻断；对普通缺失 context 的 execution-entry 场景必须显式 `proceed: true`，让 dispatch recovery rule 接管。换句话说，health gate 只能补充 dispatch 无法表达的异常态，不能抢走 dispatch recovery 的主路径。

### [MEDIUM] 状态保留策略: stuck-state 用固定 24h TTL 过于拍脑袋，没有和 pause / interrupted-session 元数据对齐

**位置**: 设计文档 5.3/5.5；现有持久化逻辑见 [auto/loop.ts](/Users/sheng/tencent/gsd-2/src/resources/extensions/gsd/auto/loop.ts#L55) 到 [auto/loop.ts](/Users/sheng/tencent/gsd-2/src/resources/extensions/gsd/auto/loop.ts#L84)

**问题**: 现有 stuck-state 的价值是“跨 session 延续 stuck 检测预算”，防止用户每次重启都重新烧一轮窗口和一次恢复机会。检测窗口本身很小，6 个 unit 就会命中 stuck，见 [auto/phases.ts](/Users/sheng/tencent/gsd-2/src/resources/extensions/gsd/auto/phases.ts#L915) 与 [auto/phases.ts](/Users/sheng/tencent/gsd-2/src/resources/extensions/gsd/auto/phases.ts#L1098)；因此 TTL 一旦清空，相当于给问题 session 完全重置预算。设计里把 24h 作为唯一过期条件，但没有和 paused session 元数据、`pausedAt`、interrupted-session 评估结果建立任何关联。对“周五 pause，周一 resume”这类现实使用场景，24h 很容易误杀，尤其是在真正卡死的问题尚未解决时，会让系统忘记它已经试过一次 stuck recovery。

**影响**: 长暂停后的恢复会重新经历完整 stuck 检测和一次一级恢复，用户体感是“明明上次已经卡过并提示过，这次又从头来一遍”。这不是数据丢失，但会削弱跨 session 防抖目标，和该文件最初引入持久化的动机相冲突。

**建议**: 把 TTL 从固定时间改为“时间 + 会话语义”的组合判定：
1. 优先基于 milestone/phase 是否仍匹配、单位 key 对应的 milestone 是否仍 active 来清理，而不是先看固定 24h。
2. 若存在 [interrupted-session.ts](/Users/sheng/tencent/gsd-2/src/resources/extensions/gsd/interrupted-session.ts#L21) 定义的 `paused-session.json` 且 `pausedAt` 晚于 stuck-state `updatedAt`，则应优先保留 stuck-state，说明这是明确的 pause/resume，而不是陈旧垃圾。
3. 如果仍需要时间阈值，至少改成更保守的默认值并允许配置，或者只在“无 paused session、无 active milestone 对应、且超过阈值”时清理。

### [MEDIUM] 文档一致性: Fix 3 表格声明了“milestone 已完成时清理对应条目”，但示例代码并未实现

**位置**: 设计文档 5.3 场景表与代码片段

**问题**: 场景表里明确写了“milestone 已完成 | stuck 中的 unit key 对应的 milestone 已 complete | 清理对应条目”，但后面的代码片段只实现了 PID 检查、`updatedAt` TTL 检查和损坏文件回退，没有任何按 unit key 解析 milestone 并查询当前 state/DB 后清理条目的逻辑。

**影响**: 读者会误以为方案已经覆盖“旧 milestone 污染新 session”的核心诉求，但实际示例代码没有支撑这一点。实现阶段容易出现按代码片段落地、遗漏表格承诺的情况。

**建议**: 二选一处理：
1. 如果这是必须目标，就补充完整算法，说明如何从 `recentUnits.key` 解析 milestone、如何判断 complete、清理后如何保留剩余窗口。
2. 如果不打算本次实现，就把表格里的这一行移出本次范围，避免设计承诺与实现草图不一致。

## Positive Notes

- Provider ping 放在 registry/preflight 通过之后再执行，并且只针对 non-optional target 做去重，这个方向是合理的，能避免把明显配置错误和网络错误混在一起。
- `resolveFinalizedMilestoneContextVisibility()` 已经统一了 canonical path、project-root fallback 和 path-conflict 语义，任何关于 `CONTEXT.md` 的增强都应该复用它，而不是重新写一套文件存在性判断。
- 对 stuck-state 增加 `updatedAt` 并在损坏文件时 fail-open 清空，本身是有益的健壮性补强。

## Conclusion

结论：`NEEDS_REVISION`

当前方案的主方向基本合理，但至少有两个进入实现前必须修订的问题：

1. Provider ping async 化的依赖注入和调用链覆盖范围描述不完整，当前文档低估了改动半径。
2. `CONTEXT.md` 检查前移到 `preDispatchHealthGate()` 会与现有 #4671 dispatch recovery 规则直接冲突，不能按现写法实现。

stuck-state 24h TTL 不是必须推翻方案的根本错误，但需要用更贴近 pause/resume 语义的规则替代或收紧，否则会削弱跨 session stuck 检测的原始目标。

## Recommended Next Step

- 先修订设计文档，明确 provider ping 的依赖边界与测试迁移面。
- 重新定义 `CONTEXT.md` 检查的责任边界，避免抢占 #4671 的 dispatch 恢复控制流。
- 收紧 stuck-state 清理规则，使其与 paused session / active milestone 状态联动。

## Handoff

**同会话继续**:

`直接执行 /design-implement`

**新会话恢复 prompt**:

```text
请阅读设计文档 docs/superpowers/specs/2026-05-01-auto-mode-preflight-guard-enhancement-design.md
和评审文档 docs/superpowers/plans/2026-05-01-auto-mode-preflight-guard-enhancement-design-review.md，
使用 /design-implement 进行方案修订及实现。
```
