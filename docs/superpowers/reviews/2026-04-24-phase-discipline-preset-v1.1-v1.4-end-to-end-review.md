# Phase-Discipline Preset v1.1-v1.4 端到端综合评审

- **评审对象**：`phase-discipline-preset` 在当前工作区中的 v1.1 / v1.2 / v1.3 / v1.4 落地状态
- **设计依据**：`docs/superpowers/specs/phase-discipline-preset.md`、`docs/superpowers/specs/README.md`
- **规划依据**：
  - `docs/superpowers/plans/2026-04-24-v1.1-v1.3-v1.4-parallel-handoff.md`
  - `docs/superpowers/plans/2026-04-24-v1.2-scout-fanout.md`
  - `docs/superpowers/plans/2026-04-23-pr-3b-phase-discipline-preset-b-min-skeleton.md`
- **相关前置评审**：
  - `docs/superpowers/reviews/2026-04-24-v1.1-admission-review.md`
  - `docs/superpowers/reviews/2026-04-24-v1.3-impl-plan-validator-review.md`
  - `docs/superpowers/reviews/2026-04-24-v1.4-verify-fuse-review.md`
  - `docs/superpowers/reviews/2026-04-23-pr-3b-phase-discipline-preset-review.md`
- **评审日期**：2026-04-24
- **评审人**：Cascade
- **评审方法**：spec ↔ plan ↔ implementation ↔ tests ↔ runtime contract 五层对照；以当前代码为准，未复跑测试

---

## 0. 结论速览

| 维度 | 结论 |
|------|------|
| 版本映射完整性 | ✅ v1.1-v1.4 对应 plan / 实现 / 测试 / 文档均可定位 |
| preset 注入与 builtin 边界 | ✅ 当前边界清晰：Admission / findings-to-memories 为 prompt-only，其余 runtime-backed hook 为 builtin |
| merge / validation / runtime / tests 契约闭环 | ✅ 主链路基本闭合 |
| v1.1 Admission | ✅ 已按 prompt-only + retry 语义修正落地 |
| v1.2 Scout fan-out | ✅ 已按 preset-owned builtin 落地，并由 `runDispatch()` 真正消费 |
| v1.3 Impl-plan Validator | ✅ 已进入 gating 主链路，但依赖 markdown artifact 文本格式 |
| v1.4 Verify-fuse | ✅ 已落地；⚠️ 实际强阻断发生在 dispatch guard，而非 hook artifact 本身 |
| 重大风险 | ⚠️ 2 项：v1.4 enforcement authority 漂移；v1.3 gating 依赖弱结构化 artifact |
| 文档 / spec 漂移 | ⚠️ 存在，应优先补文档，不必先改运行代码 |
| 总体判定 | **可接受并可继续演进**；建议先补 schema / doc-sync，再考虑 artifact 结构化 |

---

## 1. 评审范围与版本映射

### 1.1 v1.1 Admission

- **Plan**
  - `docs/superpowers/plans/2026-04-24-v1.1-v1.3-v1.4-parallel-handoff.md`
- **核心实现**
  - `src/resources/extensions/gsd/phase-discipline/preset.ts`
  - `src/resources/extensions/gsd/rule-registry.ts`
  - `src/resources/extensions/gsd/post-unit-hooks.ts`
- **测试**
  - `src/resources/extensions/gsd/phase-discipline/tests/admission.test.ts`
  - `src/resources/extensions/gsd/phase-discipline/tests/merge.test.ts`
  - `src/resources/extensions/gsd/tests/preferences.test.ts`
  - `src/tests/phase-discipline-integration.test.ts`
- **文档**
  - `src/resources/extensions/gsd/phase-discipline/README.md`

### 1.2 v1.2 Scout Fan-out

- **Plan**
  - `docs/superpowers/plans/2026-04-24-v1.2-scout-fanout.md`
- **核心实现**
  - `src/resources/extensions/gsd/types.ts`
  - `src/resources/extensions/gsd/phase-discipline/preset.ts`
  - `src/resources/extensions/gsd/rule-registry.ts`
  - `src/resources/extensions/gsd/phase-discipline/scout-fanout.ts`
  - `src/resources/extensions/gsd/auto/phases.ts`
  - `src/resources/extensions/gsd/auto/loop-deps.ts`
  - `src/resources/extensions/gsd/auto.ts`
- **测试**
  - `src/resources/extensions/gsd/phase-discipline/tests/scout-fanout.test.ts`
  - `src/resources/extensions/gsd/tests/pre-dispatch-fanout.test.ts`
  - `src/resources/extensions/gsd/tests/rule-registry.test.ts`

### 1.3 Impl-plan Validator

- **Plan**
  - `docs/superpowers/plans/2026-04-24-v1.1-v1.3-v1.4-parallel-handoff.md`
- **核心实现**
  - `src/resources/extensions/gsd/phase-discipline/impl-plan-validator.ts`
  - `src/resources/extensions/gsd/phase-discipline/reviewer-hook.ts`
  - `src/resources/extensions/gsd/phase-discipline/profile-dispatch.ts`
  - `src/resources/extensions/gsd/tools/plan-slice.ts`
  - `src/resources/extensions/gsd/bootstrap/db-tools.ts`
  - `packages/mcp-server/src/workflow-tools.ts`
- **测试**
  - `src/resources/extensions/gsd/phase-discipline/tests/impl-plan-validator.test.ts`
  - `src/resources/extensions/gsd/phase-discipline/tests/profile-dispatch.test.ts`
  - `src/resources/extensions/gsd/tests/plan-slice.test.ts`
  - `src/resources/extensions/gsd/tests/workflow-tool-executors.test.ts`
  - `packages/mcp-server/src/workflow-tools.test.ts`

### 1.4 Verify-fuse

- **Plan**
  - `docs/superpowers/plans/2026-04-24-v1.1-v1.3-v1.4-parallel-handoff.md`
- **核心实现**
  - `src/resources/extensions/gsd/phase-discipline/verify-fuse.ts`
  - `src/resources/extensions/gsd/phase-discipline/reviewer-hook.ts`
  - `src/resources/extensions/gsd/auto-dispatch.ts`
  - `src/resources/extensions/gsd/preferences-types.ts`
  - `src/resources/extensions/gsd/preferences-validation.ts`
- **测试**
  - `src/resources/extensions/gsd/phase-discipline/tests/verify-fuse.test.ts`
  - `src/resources/extensions/gsd/tests/remediation-completion-guard.test.ts`
  - `src/resources/extensions/gsd/tests/preferences.test.ts`

---

## 2. 关键契约与运行时主链路

### 2.1 builtin vs prompt-only 边界

当前 `src/resources/extensions/gsd/phase-discipline/preset.ts` 中的边界是清楚且一致的：

- **prompt-only post-unit hooks**
  - `phase-discipline-admission`
  - `phase-discipline-findings-to-memories`
- **builtin post-unit hooks**
  - `phase-discipline-code-review`
  - `phase-discipline-design-review`
  - `phase-discipline-impl-plan-validator`
  - `phase-discipline-verify-fuse`
- **builtin pre-dispatch hooks**
  - `phase-discipline-profile-dispatch`
  - `phase-discipline-scout-fanout`

`src/resources/extensions/gsd/phase-discipline/reviewer-hook.ts` 证明 builtin post-unit hook 的 runtime ownership 是显式分流的；`src/resources/extensions/gsd/rule-registry.ts` 证明 builtin pre-dispatch hook 也不是 generic YAML 语义，而是专门 runtime 分支。

### 2.2 preset → merge → validation → runtime 的闭环

- `src/resources/extensions/gsd/preferences.ts`
  - 负责应用 `milestone_profile: "phase-discipline-8step"`
  - 注入 preset hooks
  - merge 后重新校验
  - 恢复 merge 后 builtin 标记
- `src/resources/extensions/gsd/preferences-validation.ts`
  - 校验 `pre_dispatch_hooks` 的 `action`、`unit_type`、`before`
  - 校验 `milestone_profile`
  - 校验 `verify_fuse_on_fail`
- `src/resources/extensions/gsd/rule-registry.ts`
  - pre-dispatch 路径：消费 builtin `profileDispatch` / `scoutFanOut`
  - post-unit 路径：负责 cycle、idempotency、retry_on、artifact 语义
- `src/resources/extensions/gsd/auto/phases.ts`
  - `runDispatch()` 是 `fanOutSpec` 的真正消费端
- `src/resources/extensions/gsd/auto-dispatch.ts`
  - `complete-milestone` 的真正 close guard 在这里

结论：主链路不是单点式，而是分散在 `preferences.ts`、`rule-registry.ts`、`auto/phases.ts`、`auto-dispatch.ts` 四处；当前这些环节已经能形成闭环，但有两处职责分布需要文档补明。

---

## 3. 分版本审计结论

## 3.1 v1.1 Admission

### 已落地

- Admission 已保持为 **prompt-only**，不再误标成 runtime-backed builtin。
- prompt 已带精确 artifact 路径与 retry 说明。
- `rule-registry.ts` 在存在 `retry_on` 且仍允许下一轮时，会删除主 artifact 后置 `retryPending`，确保 cycle 2 真能再派发。
- `admission.test.ts` 覆盖了：
  - 首次 dispatch
  - artifact 完成即结束
  - retry 触发后二次派发
  - `max_cycles` 耗尽

### 当前判断

- **实现状态**：闭合
- **设计一致性**：与目前 README 和测试一致
- **风险**：低

### 注意点

- 该能力对 hook engine 的隐式要求是：**prompt-only hook 若需要 retry，engine 必须在 retry 时删除主 artifact**。这条约束当前在 `rule-registry.ts` 中成立，但应继续保留为文档级不变量。

## 3.2 v1.2 Scout Fan-out

### 已落地

- `src/resources/extensions/gsd/types.ts` 新增：
  - `PreDispatchFanOutSpec`
  - `PreDispatchResult.fanOutSpec`
- `src/resources/extensions/gsd/phase-discipline/scout-fanout.ts`
  - evaluator 决定何时对 `research-slice` 触发 fan-out
  - executor 执行三个 scouts
  - 首个 scout 失败时取消其余 scout
  - 写 canonical `RESEARCH` artifact 与 `.phase-discipline` observability / raw logs
- `src/resources/extensions/gsd/rule-registry.ts`
  - 支持 `profile-dispatch` proceed 后继续叠加 `scout-fanout`
- `src/resources/extensions/gsd/auto/phases.ts`
  - 在 dispatch-match / stuck / prior-slice-blocker 之后消费 `fanOutSpec`
  - 成功 `continue`
  - 失败 `pause + break`

### 当前判断

- **实现状态**：闭合
- **runtime 边界**：清晰
- **风险**：低到中

### 注意点

- `preset.ts` 中 `phase-discipline-scout-fanout` 的 carrier 配置仍是 `action: "modify"`；但 runtime 真正语义是 builtin evaluator 返回 `action: "proceed" + fanOutSpec`。这不会破坏实现，但**只看配置会误解**，文档应明确说明。

## 3.3 v1.3 Impl-plan Validator

### 已落地

- `src/resources/extensions/gsd/phase-discipline/impl-plan-validator.ts`
  - 校验 task plan frontmatter 中的：
    - `rollback_hint`
    - `acceptance`
    - `files[]`
  - 写 `IMPL-PLAN-VALIDATION.md`
  - 失败时写 `IMPL-PLAN-RETRY.md`
  - 成功时清理陈旧 retry 标记
- `src/resources/extensions/gsd/tools/plan-slice.ts`
  - 生成与 validator 对应的 frontmatter
- `src/resources/extensions/gsd/bootstrap/db-tools.ts`
  - tool 参数已纳入 `rollbackHint` / `acceptance` / `files`
- `packages/mcp-server/src/workflow-tools.ts`
  - MCP schema 已同步上述字段
- `src/resources/extensions/gsd/phase-discipline/profile-dispatch.ts`
  - 若无 `IMPL-PLAN-VALIDATION.md` 或 artifact 中记录 `Result: fail`，会 advise 回 `plan-slice`

### 当前判断

- **实现状态**：闭合
- **gating 状态**：成立
- **风险**：中

### 主要问题

- `profile-dispatch.ts` 允许执行的依据不是结构化 machine contract，而是 validator artifact 的 markdown 文本内容，尤其是 `Result: pass|fail` 这一行。
- 因此 v1.3 当前的 gating 是**文本格式耦合**，不是强结构化契约。

### 额外发现

- `packages/mcp-server/src/workflow-tools.ts` 的 `planSliceParams.tasks` 目前没有 `.min(1)`。
- `src/resources/extensions/gsd/bootstrap/db-tools.ts` 的 `gsd_plan_slice` `tasks` 也没有 `minItems: 1`。
- 真正拒绝空 tasks 的仍是 `src/resources/extensions/gsd/tools/plan-slice.ts::validateTasks()`。

这说明 v1.3 在 **executor 层闭环**，但还没有在 **schema 层前置闭环**。

## 3.4 v1.4 Verify-fuse

### 已落地

- `src/resources/extensions/gsd/preferences-types.ts`
  - 新增 `verify_fuse_on_fail`
- `src/resources/extensions/gsd/preferences-validation.ts`
  - 新增 boolean 校验
- `src/resources/extensions/gsd/phase-discipline/verify-fuse.ts`
  - 读取 validation verdict
  - 输出 `VERIFY-FUSE.md`
  - 清理 retry artifact
- `src/resources/extensions/gsd/auto-dispatch.ts`
  - 在 `completing-milestone → complete-milestone` 规则里，根据 validation verdict 与 `verify_fuse_on_fail` 决定是否阻断 milestone close
- `src/resources/extensions/gsd/tests/remediation-completion-guard.test.ts`
  - 覆盖：
    - `needs-remediation` 默认阻断
    - `needs-attention + verify_fuse_on_fail` 阻断
    - `verify_fuse_on_fail` 优先级
    - `pass` 不触发 guard

### 当前判断

- **实现状态**：闭合
- **实际 enforcement**：存在漂移
- **风险**：中

### 主要问题

当前实现中，真正阻断 milestone close 的权威点是：

- `src/resources/extensions/gsd/auto-dispatch.ts`

而 `src/resources/extensions/gsd/phase-discipline/verify-fuse.ts` 更接近：

- verdict 读取辅助
- hook artifact 生成
- 审计/记录

因此 v1.4 的真实模型不是“verify-fuse hook 自己严格阻断”，而是：

- **dispatch guard 负责 enforcement**
- **verify-fuse hook 负责记录与解释**

如果 spec / README 继续把 v1.4 描述成“hook 级 strict fuse”，就会和实际实现产生歧义。

---

## 4. 横向问题与隐性耦合

### 4.1 主要隐藏耦合

- **artifact 文本耦合**
  - v1.3 依赖 `IMPL-PLAN-VALIDATION.md` 的文本格式
- **职责分散耦合**
  - v1.4 的 enforcement 不在 hook，而在 dispatch rule
- **runtime-owned builtin 耦合**
  - v1.2 / v1.4 的真实语义不能仅从 YAML-like hook 字段理解，必须结合 runtime 分支阅读

### 4.2 当前没有看到的高风险问题

- 没有看到 v1.1-v1.4 中会直接使主链路失效的硬故障
- 没有看到 builtin vs prompt-only 边界再次混乱
- 没有看到 merge 后 builtin 标记丢失

---

## 5. 分类结论

## 5.1 Blocking Issues

当前未发现必须立刻阻断继续开发的 blocking 级问题。

## 5.2 Major Issues

### Major-1：v1.4 的 enforcement authority 与文档表述容易漂移

- **证据文件**：
  - `src/resources/extensions/gsd/phase-discipline/verify-fuse.ts`
  - `src/resources/extensions/gsd/auto-dispatch.ts`
  - `src/resources/extensions/gsd/tests/remediation-completion-guard.test.ts`
- **问题描述**：
  - hook 写 artifact
  - dispatch rule 真正阻断 close
- **影响**：
  - 后续维护者若只改 hook，不改 dispatch guard，容易出现“文档说能挡、实际挡不住”或反过来的问题

### Major-2：v1.3 gating 依赖 markdown artifact 文本而非结构化契约

- **证据文件**：
  - `src/resources/extensions/gsd/phase-discipline/impl-plan-validator.ts`
  - `src/resources/extensions/gsd/phase-discipline/profile-dispatch.ts`
  - `src/resources/extensions/gsd/phase-discipline/tests/profile-dispatch.test.ts`
- **问题描述**：
  - `Result: pass|fail` 是调度器关键输入
- **影响**：
  - 后续 artifact 文案调整可能静默破坏 gating

## 5.3 Minor Issues

### Minor-1：v1.2 的 carrier action 命名不直观

- **证据文件**：`src/resources/extensions/gsd/phase-discipline/preset.ts`
- **问题描述**：配置面是 `modify`，运行面是 builtin `proceed + fanOutSpec`

### Minor-2：v1.3 的 schema 层还未完全前置闭环

- **证据文件**：
  - `src/resources/extensions/gsd/tools/plan-slice.ts`
  - `packages/mcp-server/src/workflow-tools.ts`
  - `src/resources/extensions/gsd/bootstrap/db-tools.ts`
- **问题描述**：`tasks` 非空约束主要仍在 executor 层生效

---

## 6. 文档 / spec 同步建议

### 6.1 建议优先改文档，不必先改代码

- **[verify-fuse]**
  - 明确写成：
    - `verify-fuse.ts` 负责生成 fuse audit artifact
    - 真正的 milestone close blocking 在 `auto-dispatch.ts`
- **[scout-fanout]**
  - 明确它是 preset-owned builtin pre-dispatch fan-out carrier
  - 配置中的 `action: "modify"` 不应被解释为普通 prompt mutate hook
- **[builtin vs prompt-only]**
  - 在 `phase-discipline/README.md` 中保留一张清晰表格，标明：
    - 哪些 hook 只是 prompt contract
    - 哪些 hook 有 runtime handler

### 6.2 建议优先改代码的点

- **[schema 收紧]**
  - 将 `plan-slice` 的 `tasks non-empty` 等约束前移到 TypeBox / Zod schema
- **[artifact 结构化]**
  - 给 `IMPL-PLAN-VALIDATION` 和 `VERIFY-FUSE` 增加 machine-readable frontmatter 或 sidecar JSON

---

## 7. 建议的后续动作

### 7.1 短期

1. ✅ **已落地 (2026-04-24)** — 收紧 `plan-slice` schema，使 executor 前就能挡掉明显非法输入。
   - `packages/mcp-server/src/workflow-tools.ts`：`planSliceParams.tasks` 增加 `.min(1, "tasks must contain at least one item")`
   - `src/resources/extensions/gsd/bootstrap/db-tools.ts`：`gsd_plan_slice` 的 `tasks` TypeBox 数组增加 `minItems: 1`
   - 回归用例补齐在 `packages/mcp-server/src/workflow-tools.test.ts::"gsd_plan_slice rejects an empty tasks array at the MCP schema layer"`，验证 Zod 层前置拒绝、避免进入 executor 层
2. ✅ **已落地 (2026-04-24)** — 同步 `phase-discipline/README.md`：
   - v1.2 builtin carrier 语义（`action: "modify"` 仅是 carrier，runtime 语义是 `proceed + fanOutSpec`）
   - v1.4 dispatch-guard ownership（真正 close guard 在 `auto-dispatch.ts`，`verify-fuse.ts` 只负责 artifact/audit）
   - Built-in vs prompt-only 清单、prompt-only 的 retry 删除主 artifact 不变量
   - v1.3 P3/P4 gating 依赖 `IMPL-PLAN-VALIDATION.md` 文本
3. 为 v1.3 / v1.4 artifact 契约补结构化载体设计说明（P2，待后续演进；见 §7.3）。

### 7.2 中期

1. 增加真正跨 `preset → merge → dispatch → artifact` 的 end-to-end smoke test。
2. 逐步减少调度器对 markdown 文本格式的依赖。

### 7.3 后续演进 (P2)

尚未实施，建议在下一轮演进中考虑：

- 为 `IMPL-PLAN-VALIDATION.md` 与 `VERIFY-FUSE.md` 增加 machine-readable frontmatter 或 sidecar JSON（例如 `validation.yaml` with `result: pass|fail`），让 `profile-dispatch.ts` 与 `auto-dispatch.ts` 不再依赖 markdown 文本格式。
- 若最终落地 machine-readable 载体，同步撤除本次 README 中 "v1.3 gating via validation artifact text" 的措辞。

---

## 8. 最终判定

`phase-discipline-preset` 的 v1.1-v1.4 当前不是“设计未落地”，而是“**核心能力已经落地，剩余问题主要集中在职责表达、schema 前置闭环、以及 artifact 契约结构化不足**”。

综合判断如下：

- **可以继续作为当前 phase-discipline 主线能力使用**
- **不建议再大改运行时代码主路径**
- **建议优先补文档同步与 schema 闭环**
- **v1.3 / v1.4 若继续演进，应尽量把关键 gate 依据从 markdown 文本升级为结构化契约**

---

## 9. 与本次综合评审对应的核心证据文件

- `src/resources/extensions/gsd/phase-discipline/preset.ts`
- `src/resources/extensions/gsd/phase-discipline/reviewer-hook.ts`
- `src/resources/extensions/gsd/phase-discipline/profile-map.ts`
- `src/resources/extensions/gsd/phase-discipline/profile-dispatch.ts`
- `src/resources/extensions/gsd/phase-discipline/impl-plan-validator.ts`
- `src/resources/extensions/gsd/phase-discipline/verify-fuse.ts`
- `src/resources/extensions/gsd/phase-discipline/scout-fanout.ts`
- `src/resources/extensions/gsd/rule-registry.ts`
- `src/resources/extensions/gsd/post-unit-hooks.ts`
- `src/resources/extensions/gsd/auto/phases.ts`
- `src/resources/extensions/gsd/auto-dispatch.ts`
- `src/resources/extensions/gsd/preferences.ts`
- `src/resources/extensions/gsd/preferences-validation.ts`
- `src/resources/extensions/gsd/preferences-types.ts`
- `src/resources/extensions/gsd/tools/plan-slice.ts`
- `src/resources/extensions/gsd/bootstrap/db-tools.ts`
- `packages/mcp-server/src/workflow-tools.ts`
- `src/resources/extensions/gsd/phase-discipline/tests/admission.test.ts`
- `src/resources/extensions/gsd/phase-discipline/tests/scout-fanout.test.ts`
- `src/resources/extensions/gsd/phase-discipline/tests/impl-plan-validator.test.ts`
- `src/resources/extensions/gsd/phase-discipline/tests/profile-dispatch.test.ts`
- `src/resources/extensions/gsd/phase-discipline/tests/verify-fuse.test.ts`
- `src/resources/extensions/gsd/phase-discipline/tests/merge.test.ts`
- `src/resources/extensions/gsd/tests/pre-dispatch-fanout.test.ts`
- `src/resources/extensions/gsd/tests/plan-slice.test.ts`
- `src/resources/extensions/gsd/tests/workflow-tool-executors.test.ts`
- `src/resources/extensions/gsd/tests/remediation-completion-guard.test.ts`
- `src/resources/extensions/gsd/tests/preferences.test.ts`
- `src/resources/extensions/gsd/tests/rule-registry.test.ts`
- `src/tests/phase-discipline-integration.test.ts`
