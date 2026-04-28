# Phase-Discipline Readiness Guard — A 阶段设计评审

**评审对象：** `docs/superpowers/specs/2026-04-27-phase-discipline-readiness-guard-a-phase-design.md`
**关联文档：** `docs/superpowers/specs/2026-04-27-phase-discipline-readiness-guard-design.md`（总设计）
**评审时间：** 2026-04-27
**评审类型：** design-review（只读）
**最终结论：** `NEEDS_REVISION`

---

## 1. 评审范围

- A 阶段聚焦：`plan-slice` / `execute-task` 的前置 readiness gate
- A/B 阶段切分是否合理
- 方案 A 选择是否站得住脚
- 规则 G1~G3 / P1~P2 / E1~E7 与现有代码是否一致
- Hook 顺序、输入输出契约、错误处理是否可落地
- 相对现有 `profile-dispatch` 与 `deriveState` / auto-loop 的边界是否清晰

评审基于对以下关键代码路径的阅读：

- `src/resources/extensions/gsd/phase-discipline/profile-dispatch.ts`
- `src/resources/extensions/gsd/phase-discipline/phase-guard.ts`
- `src/resources/extensions/gsd/phase-discipline/preset.ts`
- `src/resources/extensions/gsd/rule-registry.ts`（`evaluatePreDispatch`）
- `src/resources/extensions/gsd/auto/phases.ts`（pre-dispatch block/advise 处理）
- `src/resources/extensions/gsd/state.ts`（`deriveState`、`checkReplanTrigger`、`detectPendingEscalation`、`getPendingGateCountForTurn`）
- `src/resources/extensions/gsd/types.ts`（`PreDispatchResult` 形状）

## 2. 总体判断

**核心方向是对的。** 把“输入完整性”这种 authoritative gate 从 soft advice (`profile-dispatch`) 和后置 reviewer 中抽出来，挂在 pre-dispatch 第一层，和 reviewer 最近的教训（把“前置输入问题”误归为 reviewer 职责而冒泡为 `reviewer_unavailable`）方向一致。

**A/B 切分也是合理的。** 不做同轮 re-evaluate、不统一重做失败分类框架，控制在 M 级，明显降低风险。

但当前 A 阶段设计文档把**已经由 `deriveState` + auto-loop `phase === "blocked"` 分支处理的状态（replan trigger、pending escalation、pending gate）再次作为 readiness-guard 的 warning-block 职责**，与现有代码存在职责重叠，会引入“同一条件两处 pause”的可能性。这是必须修订的问题。

此外，E2/E3 规则需要 `taskId` 与 task plan 文件，但设计没交代 `unitId` 是否含 task 段、task plan 的确切 artifact 命名与位置，落地时会有歧义。

## 3. 维度评审

### 3.1 需求与方向

**整体：合理。**

- **问题定义清晰**：把“缺 RESEARCH / PLAN / 未完成前置 gate 却进入 `execute-task` / reviewer”的现象总结得准，与 `project_reviewer_format_correction.md` 的经验吻合。
- **成功标准合理**：把首要口径定为“前移拦截数”而不是 reviewer 失败率，避免了反向激励（reviewer 失败下降可能只是因为 auto-loop 挂得更早）。
- **跳出框架的替代方向**：真正可能更优的替代路径不是 B / C 方案，而是：
  - 把 A 阶段里的 E4/E5/E6（pending gate / replan / escalation）**交回给 `deriveState` 的 `phase = "blocked"` 分支**，readiness-guard 只新增“artifact 是否存在”这一类旁路检查。
  - 设计文档缺少对“为什么这些 gate 要在 pre-dispatch 再查一次、而不是依赖现有 blocked phase”的解释。这是评审里最核心的一个缺口（见 4.1 CRITICAL）。

### 3.2 方案合理性

- **方案 A vs B vs C 的对比是自圆其说的**，但对比没有包含“最小 readiness-guard + 现有 blocked phase”的 baseline，显得方案 A 的选择不够有对照。
- **Hook 顺序（phase-guard → readiness-guard → profile-dispatch → scout-fanout）** 和现有 `evaluatePreDispatch` 的“遇到非 proceed 立即返回”的串行语义兼容，没问题。
- **只读、不写状态** 这条原则非常好，避免与 `deriveState` 打架。
- 但 `profile-dispatch` 现在已经做了“缺 PLAN → advise plan-slice”这条规则（`profile-dispatch.ts:110-123`）。A 阶段把同一条前置输入升级为 warning-block，**并没有显式说明原 advise 规则是否保留、移除、还是由 readiness-guard 吃掉**。这会导致两个 hook 串行时行为叠加或重复（见 4.2 HIGH）。

### 3.3 实现可行性

- **helper 依赖基本可用，但有一个字段存在性问题**：
  - 设计提到 `checkReplanTrigger(...)`。它目前**是 `state.ts:789` 的内部 function，不是 exported**。readiness-guard 要直接调用需要先 export 或者拷贝一份（见 4.3 MEDIUM）。
  - `detectPendingEscalation(tasks, basePath)`、`getPendingGateCountForTurn(...)`、`resolveSliceFile`、`resolveTaskFile`、`getSliceTasks`、`resolveTasksDir` 都已导出，可直接使用。
- **task plan 的 artifact 位置**未明确。E3 只写“task plan 文件缺失”，但 phase-discipline 里现存的 task-level artifact 主要是 `*-SUMMARY.md`（在 `resolveTasksDir`/`countTaskSummaries` 的既有用法里），没有看到一个名为 “TASK-PLAN.md” 的统一 artifact。设计需要点名：到底查的是哪个文件名、在哪个目录（见 4.4 HIGH）。
- **unitId 解析**：G2 说“unitId 解析失败 → block error”。但 `plan-slice` 的 unitId 通常是 `M###/S###`，不含 task 段；`execute-task` 才会是 `M###/S###/T###`。设计没说明 E 规则下缺 task 段是 `invalid_unit_id` 还是 `task_not_found`（见 4.5 MEDIUM）。
- **测试计划覆盖面**大致合理；但没测“readiness-guard + profile-dispatch 串联”的行为（profile-dispatch 现有 advise 规则是否被 readiness-guard 的 block 抢先），而这恰恰是职责边界模糊的风险点。

### 3.4 文档质量

- 结构清晰、可读。
- 但有几处一致性/完整性问题：
  - § 5 方案 A 称“缺 PLAN.md / task plan / pending gate / replan / escalation” 都走 warning-block，和 § 9.3 表保持一致，但与现有 `deriveState` 语义存在重叠（4.1）。
  - § 7 Hook 顺序只声明顺序，未在“与现有组件职责边界”一节强调 readiness-guard **取代** profile-dispatch 里 “缺 PLAN → advise” 的职责（4.2）。
  - § 18 “实施落点”里列 `auto/phases.ts` 为“只消费，无新增 loop 机制”，但没有提到要不要改 `rule-registry.ts::evaluatePreDispatch` 来注册新 builtin hook 分支（现有 switch 是按 builtin 名字列出的）。遗漏了这个变更点。

## 4. 发现

按严重度从高到低列出。

### [CRITICAL] 职责边界: E4/E5/E6 与 `deriveState` 的 "blocked" phase 重叠

**位置**：§ 9.3 执行任务规则 E4–E6；§ 11 数据流；§ 12 错误处理 warning-block 条目。

**问题**：
- `state.ts::deriveState` 已经会在检测到 `checkReplanTrigger(...)` 为 true 时，把 `phase` 置为 `"blocked"`、`blockers` 写入替换原因（`state.ts:1041-1049`、`state.ts:1790-1803`）。
- `state.ts::deriveState` 也会通过 `detectPendingEscalation(tasks, basePath)` 设置 blocked phase（`state.ts:1027` 附近）。
- `state.ts` 也用 `getPendingGateCountForTurn(...)`（`state.ts:986`）影响 phase 推导。
- `auto/phases.ts:870-890` 显式处理 `state.phase === "blocked"`：pause auto 并 notify；所以**现存 auto-loop 已经在 dispatch 之前就能把这些 gate 拦下**。
- A 阶段又在 readiness-guard（pre-dispatch）里把 pending gate / replan / pending escalation 再做一遍 warning-block。

**影响**：
- 同一种失败原因可能会按两条路径各 `pauseAuto(...)` 一次：一次在 `deriveState -> blocked phase`，一次在 `readiness-guard`（后者只会在前者漏检的情况下才真正生效）。两条路径的 notify 文案和 journal 事件不一致（前者是 `terminal/blocked`，后者是 `pre-dispatch-hook/action:block`），会污染成效指标。
- 如果 `deriveState` 已经决定 blocked → autoLoop 提前 `return break`（`phases.ts:889`），readiness-guard 规则永远跑不到；真正的“前移拦截”只发生在 `deriveState` 没有识别的情况，也就是状态检测有 bug 的情况——那是 `deriveState` 要修的，不是 readiness-guard 要兜底的。
- 设计文档说 “readiness-guard 只读、不写状态”，但同时又承担了本应由状态推导负责的“告诉用户这不能跑”的职责。职责边界和当前总设计 `§ 10 组件职责边界` 里其它说明不一致。

**建议**：
修订为以下二选一：

- **方案 A1（推荐）：明确 readiness-guard 只管 artifact 存在性 + 状态推导未覆盖的 task-level 缺失。**
  - 保留 P2（`plan-slice` 缺 `RESEARCH.md`）的 advise 行为。
  - 保留 E1（`PLAN.md` 缺失）、E3（task plan 文件缺失）、E2（taskId 在 plan/DB 找不到）这些“状态推导不会为你拦的真实 artifact 缺失”。
  - **移除 E4（pending gate）、E5（replan）、E6（pending escalation）**：明确在“§ 组件职责边界”里写，这三项已经由 `deriveState → phase === "blocked"` 处理，readiness-guard 不重复。
  - 这样 readiness-guard 的独立价值就是 artifact 物理存在性，和 `deriveState` 的状态推导不重叠。

- **方案 A2：保留 E4/E5/E6，但把 `deriveState` 里同名 blocker 改为“只记录、不置 blocked phase”。**
  - 不推荐。影响面大，违反 A 阶段“不重构 loop、不改 deriveState”的约束，且需要升级到 L 级。

### [HIGH] 职责冲突: 与 profile-dispatch 现有 "advise" 规则的覆盖关系没写清

**位置**：§ 7 Hook 顺序；§ 10 与现有组件职责边界（profile-dispatch）；§ 9.3。

**问题**：
- `profile-dispatch.ts:110-123` 当前对 `execute-task` 缺 PLAN 这种情况会返回 `action: "advise" → plan-slice`（带 3 次 disagreement backoff）。
- A 阶段把同样条件升级为 `warning-block`。
- 但设计只说 profile-dispatch 保留“advisory + backoff”，没明确说这条规则是否**保留、删除、还是失效**。如果保留，因为 readiness-guard 在 profile-dispatch 之前运行、且返回 block，profile-dispatch 永远跑不到；实现上看上去 OK，但 profile-dispatch 的代码会因此留一条永远达不到的死分支。
- 如果 profile-dispatch 仍保留这段代码，后续迭代里容易再次把职责漂移回去。

**影响**：
- 代码死路径、职责再次漂移的风险。
- 对后续维护者造成混淆：同一条件两处实现，两条路径行为不同。

**建议**：
在 § 10 明确写：

- readiness-guard 接管“execute-task 缺 PLAN / 缺 task plan / pending gate / replan / escalation”的 gate 职责。
- profile-dispatch 的 `hasActiveSlicePlan === false → advise plan-slice` 等效规则应当**一并移除**（或至少标注为 dead code，待 A 阶段实现时同步清理）。
- § 18 实施落点新增 `profile-dispatch.ts` 清理项。

### [HIGH] 规则语义: "task plan 文件" 具体指哪个 artifact 没定义

**位置**：§ 9.3 E3；§ 附录 issue codes `task_plan_missing`。

**问题**：
- phase-discipline 的 task-level artifacts 目前主要是 `*-SUMMARY.md`（产出物，不是 plan）。没看到名为 `TASK-PLAN.md` 或 `<taskId>-PLAN.md` 的统一 artifact 约定。
- 设计没说清 E3 要检查什么。如果查的是 SUMMARY 反而不对（它是结果不是 plan）；如果查的是 slice-level PLAN.md 里的某个 section，那属于 PLAN 内容检查，已经越界到 E1 的质量评价范畴。

**影响**：
- 落地阶段会临时拍脑袋定一个 artifact 名字，容易与现状脱节，导致规则在实际环境里始终为 false（漏检）或始终为 true（误报）。

**建议**：
- 在设计里点名 task plan 指的是 `PLAN.md` 里的 task 段、还是独立文件、还是 DB 行（`getSliceTasks` 返回的 plan 字段）。推荐**定义为 DB 里 `getSliceTasks(mid, sid)` 能找到该 taskId 且其 plan/prompt 字段非空**，比 artifact 文件更稳定。
- 如果最终决定要文件，需要明确 artifact 命名与查找规则（类比 `resolveTaskFile(basePath, mid, sid, tid, "PLAN")` 且 suffix 约定）。

### [MEDIUM] 接口依赖: `checkReplanTrigger` 目前不是 exported

**位置**：§ 8 Artifact Helpers（来自总设计文档）；§ 9.3 E5。

**问题**：
- `state.ts:789` 的 `checkReplanTrigger(...)` 没有 `export`。
- 设计默认这是“可复用的 canonical helper”。

**影响**：
- 实现时必须补 export，或者在 readiness-guard 里复制逻辑；前者小改 `state.ts`，后者违反“复用既有 helper”的设计原则。

**建议**：
- 只有在采纳 4.1 方案 A2 时才会用到；如果按 4.1 方案 A1 移除 E5，这个问题自动消失。
- 如果仍然需要，最好在设计里声明“将 `checkReplanTrigger` 提升为 exported helper”，并列入 § 18 实施落点。

### [MEDIUM] 规则粒度: unitId 解析失败的归类未区分

**位置**：§ 9.1 G2；§ 9.3 E2。

**问题**：
- `plan-slice` 的 unitId 通常是 `M###/S###`；`execute-task` 通常是 `M###/S###/T###`。
- G2 规定“unitId 解析失败 → error-block (`invalid_unit_id`)”，但没说“execute-task unitId 缺 T 段”是属于 G2 还是 E2。
- `execute-task` 被调度时 unitId 没 task 段，是状态矛盾（`error`）还是 task 找不到（`warning`）？体验差别很大：`error` 会 stop，`warning` 只是 pause。

**影响**：
- 落地时两种分级都可以写，不同的写法造成不同的运维体验。
- 与未来 B 阶段的“统一失败分类框架”冲突。

**建议**：
- 明确写：对 `execute-task`，unitId 缺 T 段 → `error-block / invalid_unit_id`；T 段存在但 DB / plan 找不到 → `warning-block / task_not_found`。
- 或者反之，但要定下来。

### [MEDIUM] 扩展点: rule-registry 的 builtin 分发未在实施落点列出

**位置**：§ 18 实施落点。

**问题**：
- `rule-registry.ts::evaluatePreDispatch` 目前用 `if (hook.builtin === PHASE_DISCIPLINE_PRESET_HOOK_NAMES.phaseGuard) { ... }` 这种显式 switch 分派到具体 evaluator（`phase-guard`、`profile-dispatch`、`scout-fanout`）。
- 新增 `readiness-guard` 必须在这里加一个新的 `if` 分支并导入 `evaluatePhaseDisciplineReadinessGuard`。
- § 18 “实施落点”未列 `rule-registry.ts`，实施时容易漏掉。

**影响**：
- 漏掉该改动会导致新 hook 配置上 preset 里但从不会被执行；集成测试的“hook 顺序 & 语义”用例会挂。

**建议**：
- § 18 追加 `src/resources/extensions/gsd/rule-registry.ts`，说明“新增对 readiness-guard builtin 的分发”。
- 并在 `PHASE_DISCIPLINE_PRESET_HOOK_NAMES` 里加上 `readinessGuard: "phase-discipline-readiness-guard"`（这条已暗含在 § 7 但未写进 preset.ts 的实施落点）。

### [MEDIUM] 成效指标: 反指标缺失，容易只看"被拦到的数量"

**位置**：§ 13 成效指标。

**问题**：
- 主指标只计“被拦截的次数 / 比例”，可能被“guard 过严”骗高。
- 风险 1（§ 14）已经识别“guard 过严导致频繁 pause”，但缺对应反指标。

**影响**：
- 上线后无法客观判断是 guard 产生了收益、还是只是制造了更多 pause。

**建议**：
- 补 1 条反指标：`execute-task` readiness-guard warning-block 引起的 auto pause 后，用户 resume 的平均用户可执行动作数（或 resume 后立刻重新触发同一 block 的比例）。
- 补 1 条基线：对 reviewer `reviewer_format_invalid` 的周度变化和“前置拦截覆盖率”联动看。

### [LOW] 表述: "authoritative gate" vs "hook 只读不写"存在语义模糊

**位置**：§ 6 设计原则 2 & 3；§ 10。

**问题**：
- 第 2 条把 readiness-guard 定义为“必须 operator 介入则 block”，第 3 条又说“hook 只读、不写状态”。
- block + pause 本身是对 auto-loop 状态的有效副作用，通过 `pauseAuto(...)` 写了 session state。
- “不写状态”实际上指的是“不写 artifact、不改 DB”，措辞不精确。

**影响**：
- 语义上不致命，但新维护者可能误解。

**建议**：
- 改为“hook 不写 artifact、不修改 GSD DB 的业务状态；auto-loop 的 pause/stop 副作用由 `runDispatch` 承担”。

### [LOW] 命名一致性: 总设计与 A 阶段 code 枚举略有出入

**位置**：总设计 `§ Appendix Issue Codes` 与 A 阶段 `§ 附录 Issue Codes`（在 A 阶段文档里是 § 9 规则里零散出现的 code）。

**问题**：
- 两份文档里的 code 基本一致，但 A 阶段没收束成一张附录表，评审时需要跨章节拼凑。

**影响**：
- 维护性轻微变差。

**建议**：
- 在 A 阶段文档里补一个 issue-code 表（参考总设计附录格式）。

## 5. 结论与下一步

**结论：`NEEDS_REVISION`。**

核心方向正确，但必须修订 3 个问题后再实现：

1. **CRITICAL 4.1** 修订 E4/E5/E6 与 `deriveState` 的职责重叠；推荐按“方案 A1”只保留 artifact-存在性 + task-not-found。
2. **HIGH 4.2** 明确 profile-dispatch 里 “execute-task 缺 PLAN → advise plan-slice” 的处置（建议同步清理）。
3. **HIGH 4.3** 明确 “task plan 文件”的 artifact 定义或改用 DB 判据。

修订完建议同时吸收 4.4 / 4.5 / 4.6 / 4.7，文档会更完整。

**下一步：** 回到方案修订与实现阶段。

- 同会话继续：`直接执行 /design-implement`
- 新会话恢复 prompt：
  ```
  请阅读设计文档 docs/superpowers/specs/2026-04-27-phase-discipline-readiness-guard-a-phase-design.md
  和评审文档 docs/superpowers/plans/2026-04-27-phase-discipline-readiness-guard-a-phase-design-review.md，
  使用 /design-implement 进行方案修订及实现。
  ```
