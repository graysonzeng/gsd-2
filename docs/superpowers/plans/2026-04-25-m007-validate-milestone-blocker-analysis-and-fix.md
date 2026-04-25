# `M007/S02` 追加验证暴露问题的分析与修复方案

- **日期**：2026-04-25
- **来源文档**：`docs/superpowers/plans/2026-04-25-phase-discipline-seeded-auto-e2e-process-summary.md` 第 8 章
- **读者**：下一位实施 phase-discipline / headless runtime 修复的工程师或 agent
- **读完后应能做到**：
  1. 清楚第 8 章列出的三个现象各自指向哪一层代码
  2. 判断每个问题是 provider/runtime/state/prompt/session 中哪一层，并据此选择修复落点
  3. 按优先级实施修复，并知道每个修复需要哪个验证手段（单测 / 集成测 / e2e 回归）
  4. 避免以"让 prompt 更严格"替代"用代码约束"

---

## 0. 指导原则（从原文档抽取，并严格遵循）

这份修复方案必须严格遵循原文档第 8.6 节的设计原则，以及第 5 节的判断准则。任何偏离这些原则的方案都应被拒绝或改写。

以下原则按优先级列出，冲突时靠前者胜：

1. **用代码约束 agent，而不是只靠声明**（§8.6）
   - 规则先做成 artifact verifier / state-machine guard / tool handler 的 structured error
   - 只在以上都不可行时，才回退到 prompt / context 要求

2. **artifact verifier 是硬门禁**（§8.6）
   - `validate-milestone` 必须产出 `M###-VALIDATION.md`
   - frontmatter 必须包含合法 verdict
   - verdict=`pass` 才允许进入 `complete-milestone`
   - verdict=`needs-remediation` 必须产生明确 remediation next unit

3. **workflow snapshot 决定退出码**（§8.6）
   - 默认模式允许 `exit 0 + needs-continue`，但必须稳定输出 `Command Status` 与 `Workflow Status`
   - `--fail-on-incomplete` 必须把 `needs-continue` 映射为 `exit 12`
   - snapshot 无法生成时应明确报错，不应静默

4. **用代码检测 unit 无进展**（§8.6）
   - 同一 `validate-milestone M###` 连续 dispatch 后 state / artifact / next 不变 → 返回 `NO_PROGRESS_ON_UNIT`
   - 错误内容包含 phase、unitType、unitId、缺失 artifact、最近 tool 调用摘要
   - agent 收错后自行修正或重调 canonical tool，而不是继续空转

5. **tool schema / handler 校验输出**（§8.6）
   - `gsd_validate_milestone` 不接受无结构文本作为成功
   - reviewer 结论 / verdict / artifact / remediation plan 要一致
   - 不一致返回 structured error：`VALIDATION_ARTIFACT_MISSING` / `VALIDATION_VERDICT_INVALID` / `REMEDIATION_REQUIRED_BUT_NO_SLICE`

6. **用错误推动迭代**（§8.6）
   - runtime 返回明确错误 + 下一步修复指令
   - 让 agent 根据错误自行迭代，而不是让用户人工解释"哪里不对"
   - 错误尽量机器可读，便于 headless 自动判断 continue / retry / remediate / fail-fast

7. **以 `headless query` 为准**（§5.1）
   - `Status: complete` 不能证明 milestone 完成
   - 最终完成需同时满足 `phase=complete` && `activeMilestone=null` && registry 目标 milestone=`complete`

8. **provider 错误不先归因 runtime**（§5.2）
   - 修复前先排除 provider / key / endpoint / model / quota / gateway

9. **已 auto-commit 的改动不能用 live diff 否定**（§5.3）
   - 靠 committed diff + task summary + verify artifact + 当前文件内容断言
   - 不能只凭"没有未提交 diff"就判未交付

10. **不要过度工程**（CODEBUDDY.md 的通用约束）
    - 修复点精准到本次问题
    - 不做顺手"清理"
    - 不加假想扩展点
    - 不引入 feature flag 或兼容 shim，除非真的有老数据需要兼容

---

## 1. 问题清单与分类

第 8 章列出三个观察，外加一个必要配套。按因果关系排列如下。

| # | 现象 | 出处 | 所属层 | 是否 blocker |
|---|------|------|--------|-------------|
| P1 | `validate-milestone` 卡住，无 `M007-VALIDATION.md` 落盘 | §8.5 | runtime + tool handler | **是（当前 blocker）** |
| P2 | 单次 `headless auto` 只推进一个 unit，无法一次跑完 milestone | §8.4 | headless main-loop 语义 | 否（可忍受但体验差） |
| P3 | 默认模式下 `exit 0 + Workflow Status: needs-continue` 共存 | §8.2 | headless exit-code contract | 否（已设计如此，需文档化 + 保护） |
| P4 | `--fail-on-incomplete` 已返回 `exit 12`，但无 CI 回归 | §8.3 | 回归测试覆盖 | 否（需加测试防回退） |
| P5 | 同一 unit 无产物地反复 dispatch 没有 no-progress 检测 | §8.4/§8.6 | auto dispatcher 守卫 | 否（触发 P1 时会二次放大影响） |
| P6 | validation/summarization reader 与 handler 的 canonical-root 路径不对称 | review addendum | dispatch + finalize + state/query | **是（P1 的放大器，worktree 下可直接复现）** |

关键点：**P1 仍是唯一的根 blocker，但 P6 已证实是 P1 在 live worktree 场景下的真实实现缺口，必须并入本轮修复**。P2 / P3 是既定设计，其中 P3 应明确文档化并用测试锁住行为；P2 可选择性改善但不应作为紧急修复。P4 / P5 是把当前脆弱处加上代码级护栏，避免下次复现。

### 1.1 层归属判断（按 §5.2 原则）

- **P1**：不是 provider 问题（`gpt-5.4` 直连、GSD smoke、reviewer 都已在 §8.1 验证通过）。不是 session 残留问题（稳定 state path 已隔离）。是 **runtime + tool handler + artifact contract** 问题。
- **P2**：不是 runtime bug，是当前 headless 主循环语义——"每次 `runHeadlessOnce` 只驱动一个 dispatch cycle"。由 `src/headless.ts:226-254` 决定。
- **P3**：是 contract 有意设计（`src/headless.ts:269-281`、`src/headless.ts:945-947`），**必须**保留；本次只需加测试 + 文档化。
- **P4**：代码已存在（`src/headless.ts:945-947`）。缺的是回归测试。
- **P5**：已有 stuck detection（`src/resources/extensions/gsd/auto/detect-stuck.ts`）覆盖 5 条规则，但**没有一条专门针对 "validate-milestone 无 artifact 产出"**。需要补一条 artifact-missing 规则。
- **P6**：代码核对已确认：`handleValidateMilestone()` 已通过 canonical root 写 `VALIDATION`，但 `auto-dispatch.ts`、`auto-post-unit.ts`、`auto-verification.ts` 与 `state.ts` 的相关 reader 仍有直接从 project root 读取 `VALIDATION` / `SUMMARY` 的路径。只要 milestone 运行在 live worktree，这些 reader 就会把“artifact 已写到 worktree”误判成“artifact 缺失”。

---

## 2. 代码画像（落点与当前行为）

为避免修复时再次搜索，先把关键落点固化。所有路径相对 `/Users/sheng/tencent/gsd-2`。

| 关注点 | 文件 | 关键行 | 当前行为 |
|--------|------|--------|----------|
| Headless 入口与 exit 语义 | `src/headless.ts` | 209-211, 226-254, 941-977 | 解析 `--fail-on-incomplete`；`runHeadless` 外层循环；`runHeadlessOnce` 末尾依据 snapshot 决定 exit code |
| Workflow snapshot 派生 | `src/headless.ts` | 256-281 | 依据 `phase` 与 `next.action` 计算 `complete` / `needs-continue` / `unknown` |
| snapshot 数据源 | `src/headless-query.ts` | `deriveHeadlessSnapshot()` | 读 state + 调 `resolveDispatch()` 干运行 |
| 状态派生 | `src/resources/extensions/gsd/state.ts` | `deriveState()` | DB-first，100ms 缓存 |
| 分发规则表 | `src/resources/extensions/gsd/auto-dispatch.ts` | `DISPATCH_RULES` 数组 | 首匹配胜出，无回溯 |
| `validating-milestone → validate-milestone` 规则 | `src/resources/extensions/gsd/auto-dispatch.ts` | 916-962 | 仅做前置守卫（slice summary 是否齐）；**不检查 VALIDATION artifact 是否已产出** |
| `completing-milestone → complete-milestone` 规则 | `src/resources/extensions/gsd/auto-dispatch.ts` | 964-988+ | 读 existing summary；根据 VALIDATION verdict 判断是否允许 complete |
| `validate-milestone` tool handler | `src/resources/extensions/gsd/tools/validate-milestone.ts` | `handleValidateMilestone()` (91-205+) | 接收结构化参数；DB-first 写入；渲染 `M###-VALIDATION.md`；当前错误仅返回 `{ error }`，未带 machine-readable code |
| tool executor 透传层 | `src/resources/extensions/gsd/tools/workflow-tool-executors.ts` | `executeValidateMilestone()` (349-388) | 当前会把 handler 错误压平成 `details.error` 文本；若要让 auto-loop / headless 消费 structured code，这里也必须透传 `code` |
| `validate-milestone` post-unit guard | `src/resources/extensions/gsd/auto-verification.ts` | `runValidateMilestonePostCheck()` (67-159) | 当前只处理 `needs-remediation 且无 remediation slice`；**缺少 `VALIDATION.md` 缺失/无效时的专用失败信号** |
| 现有回归证明 | `src/resources/extensions/gsd/tests/validate-milestone-stuck-guard.test.ts` | 165-178 | 当前测试明确锁定：`validate-milestone` 结束后若没有 `VALIDATION` 文件，post-check 仍返回 `continue` |
| verdict 解析 | `src/resources/extensions/gsd/verdict-parser.ts` | `extractVerdict()` / `isValidMilestoneVerdict()` | 从 YAML frontmatter 读出 verdict 并校验枚举 |
| Auto loop 主循环 + stuck persistence | `src/resources/extensions/gsd/auto/loop.ts` | 43-84 | 持久化最近 20 个分发到 `.gsd/runtime/stuck-state.json` |
| WindowEntry 错误写回点 | `src/resources/extensions/gsd/auto/phases.ts` | 1780-1794 | 这里只会把 `runUnit()` 的 error / event 文本写进 `loopState.recentUnits[*].error`；post-unit artifact 缺失当前不会落结构化错误 |
| Stuck 模式检测 | `src/resources/extensions/gsd/auto/detect-stuck.ts` | 28-105 | 5 条规则：repeat error / 3×same-unit / 3×in-window / 振荡 / ENOENT 重现 |
| Exit code 常量 | `src/headless-events.ts` | 16-20 | 0=SUCCESS, 1=ERROR, 10=BLOCKED, 11=CANCELLED, 12=INCOMPLETE |
| canonical root helper | `src/resources/extensions/gsd/worktree-manager.ts` | `resolveCanonicalMilestoneRoot()` | handler 已通过它写 artifact，但多个读取侧仍未统一复用 |

**空白处**：除了“没有任何地方在 `validate-milestone` dispatch 后校验 `M###-VALIDATION.md` 是否真的落盘”之外，当前还有一个已证实的不对称：writer 已通过 canonical root 落盘，但多个 reader 仍直接从 project root 读 `VALIDATION` / `SUMMARY`。如果 agent 在 live worktree 中正确写出了 artifact，dispatch / finalize / state/query 仍可能看不到它。

---

## 3. 每个问题的根因假设与修复方案

### 3.1 P1 — `validate-milestone` 无 `M###-VALIDATION.md` 落盘

#### 根因候选（按概率排序）

P1.A — **agent 没有调用 `gsd_validate_milestone`**，而是用自由文本回答 validation 结论。
- 证据支持：原文档 §8.5 明确说"尚未发现 `M007-VALIDATION.md`"，且 §8.6 列的第一条建议就是"tool schema / handler 校验输出，不接受无结构文本作为成功"。
- 这是文档团队最担心的情况。

P1.B — **handler 调用成功但 disk render 被回滚**。`validate-milestone.ts:154-160` 在 disk render 失败时会删除 DB 行，返回 `{ error: ... }`。如果 canonical-root 解析指向一个不存在的目录或权限不足，文件就不会落盘。
- 证据弱：当前没有日志记录这类错误。

P1.C — **dispatch 规则认为 validate 已完成但实际没完成**。`auto-dispatch.ts:916-962` 在 `validating-milestone` 相位下的 match 只负责 dispatch；它不会标记 validation 已完成。标记完成的职责在 state 派生里，依赖 DB 里的 assessments 行。如果 handler 写了 DB 但文件被回滚、而 state 派生只看 DB，就会出现 "DB 说 validation 存在但文件没有" 的分歧。
- 证据中等：需要用 DB 快照验证。

#### 修复方案（无论候选是哪一个都适用）

**F1 — 在 dispatch 规则里加 artifact 前置断言**（必做）

位置：`src/resources/extensions/gsd/auto-dispatch.ts:964-988+`（`completing-milestone → complete-milestone` 规则）与 `:916-962`（`validating-milestone → validate-milestone` 规则）。

逻辑：

1. `completing-milestone` 入口，在读取 existing summary 之前，先读 `M###-VALIDATION.md`：
   - 文件不存在 → 返回 `action: "stop"`，原因 `VALIDATION_ARTIFACT_MISSING`，level `error`，`reason` 包含期望路径。
   - 文件存在但 frontmatter 无 verdict 或 verdict 不在枚举中 → 返回 `action: "stop"`，原因 `VALIDATION_VERDICT_INVALID`。
   - verdict=`needs-remediation` 且 `remediationPlan` 空或未 seed remediation slice → `REMEDIATION_REQUIRED_BUT_NO_SLICE`。

2. `validating-milestone` 入口：**不能把首次缺失 `VALIDATION.md` 直接当 stop**，否则会阻断正常第一次 dispatch。这里的硬门禁应限定为“已有 validation 痕迹但不一致”场景：
   - DB assessments 已有 `milestone-validation` 行但文件缺失 → `VALIDATION_ARTIFACT_DESYNCED`。
   - 文件已存在但 verdict 无效 → `VALIDATION_VERDICT_INVALID`。
   - 两者都不存在 → 允许正常 dispatch `validate-milestone`。

**原则映射**：§8.6 "artifact verifier 做硬门禁"；§1 原则 2 / 5。

**F2 — 让 `handleValidateMilestone` 返回的错误变成 structured error code，并一直透传到 executor**（必做）

位置：`src/resources/extensions/gsd/tools/validate-milestone.ts:96-160` 与 `src/resources/extensions/gsd/tools/workflow-tool-executors.ts:362-368`。

- 将返回类型从 `{ error: string }` 改为 `{ error: string; code: ValidateMilestoneErrorCode }`。
- `ValidateMilestoneErrorCode` 先收敛到本次闭环所需最小集合：`VALIDATION_MILESTONE_ID_INVALID | VALIDATION_VERDICT_INVALID | VALIDATION_ARTIFACT_RENDER_FAILED | REMEDIATION_REQUIRED_BUT_NO_PLAN`。
- 加一条新的校验：`verdict === "needs-remediation" && !params.remediationPlan` → `REMEDIATION_REQUIRED_BUT_NO_PLAN`。
- `executeValidateMilestone()` 不能再把错误压平成纯文本；应把 `code` 一并放进 `details.code`，这样 headless / auto-loop 才能消费同一套 structured code。
- tool schema（JSON schema 注册处）里同步 `remediationPlan` 的条件必填描述。
- 为避免字符串漂移，`code` 常量抽到共享文件（例如 `src/resources/extensions/gsd/validation-error-codes.ts`），由 handler / executor / stuck detector 共用。

**原则映射**：§8.6 "用错误推动迭代"；§1 原则 5 / 6。

**F3 — 给 `validate-milestone` unit 增加 finalize-time artifact assertion，并把 structured code 写回 `WindowEntry.error`**（必做）

位置：主逻辑放在 `src/resources/extensions/gsd/auto-post-unit.ts` 的 `postUnitPreVerification()`；`needs-remediation` 的现有 post-check 继续放在 `src/resources/extensions/gsd/auto-verification.ts`；错误写回点放在 `src/resources/extensions/gsd/auto/phases.ts:1780-1794` 附近。

原因：真正决定“当前 unit 产物是否落盘”的阶段已经在 `postUnitPreVerification()`。`validate-milestone-stuck-guard.test.ts:165-178` 证明现状是“没有 `VALIDATION.md` 也继续”，所以最小修复应直接在现有 artifact verification 里补 machine-readable 失败信号；而 `needs-remediation 且无 remediation slice` 仍由现有 post-check 负责。

逻辑：

- 如果本次 dispatched unit 的 `unitType === "validate-milestone"`，finalize 时读取 `M###-VALIDATION.md`：
  - 文件不存在 → 写入可机读失败信号 `VALIDATION_ARTIFACT_MISSING`。
  - 文件存在但 verdict 无效 → 写入 `VALIDATION_VERDICT_INVALID`。
  - verdict=`needs-remediation` 且无 remediation slice → 继续沿用现有 pause 逻辑，但错误码统一到共享常量。
- `auto/phases.ts` 在消费 pre/post verification 结果时，把上述 structured code 写入当前最后一个 `WindowEntry.error`，而不是只在 `runUnit()` 出错时写 error。
- 这是对 F1 的运行时映像，确保即便 state 派生滞后，auto-loop 也能以 stuck 形式感知。

**原则映射**：§8.6 "用代码检测 unit 无进展"。

**F3.5 — 统一 validation / summary reader 的 canonical-root 解析**（必做）

位置：`src/resources/extensions/gsd/auto-dispatch.ts`、`src/resources/extensions/gsd/auto-post-unit.ts`、`src/resources/extensions/gsd/auto-verification.ts`、`src/resources/extensions/gsd/state.ts`。

- 为 `VALIDATION` / `SUMMARY` 的读取补一个共享 canonical helper，而不是在各处手写 `resolveCanonicalMilestoneRoot()`。
- dispatch guard、finalize pre/post check、以及 `deriveState()` 读 milestone terminal artifact 时统一走该 helper。
- `skip_milestone_validation` 的 pass-through 写文件路径也要与同一 canonical helper 对齐，否则 writer/reader 仍可能分裂。
- 这项改动不改变“写入 contract 由调用方 basePath 决定”的大方向，只修复当前 validate/summary 判断链上已经出现的 canonical-root 不一致。

**原则映射**：§5.1 以 `headless query` 为准；§8.6 artifact verifier 做硬门禁；§1 原则 2 / 3。

#### P1 的验证手段

- 单元测试：新增 `tests/unit/auto-dispatch.validate-milestone-guard.test.ts`
  - case 1：validation 文件不存在 → `action: "stop"`，reason 含 `VALIDATION_ARTIFACT_MISSING`
  - case 2：verdict=`pass` → `action: "dispatch" complete-milestone`
  - case 3：verdict=`needs-remediation` 无 remediationPlan → stop + `REMEDIATION_REQUIRED_BUT_NO_PLAN`
- Handler 测试：`tests/unit/tools.validate-milestone.errors.test.ts`
  - 覆盖每个新的 error code 分支
- e2e 冒烟：按原文档 §2 流程跑一个 docs-only minimal milestone，断言最终产物包含 `M###-VALIDATION.md` 且 verdict=`pass`

---

### 3.2 P2 — 单次 `headless auto` 只推进一个 unit

#### 当前行为

`src/headless.ts:226-254` 的 `runHeadless` 是一个带重启逻辑的外层循环，但**每次 `runHeadlessOnce` 只发起一次 `/gsd auto` 会话**，等终止信号后就返回。`Workflow Status: needs-continue` 指的是"下次你还得再调一次"，不是"我本次应继续"。

这与 CLI 侧 auto-mode 的单 unit 驱动是一致的——真正驱动多 unit 的是交互模式下的持续会话，headless 每次调用只跑一个 dispatch cycle 后退出。

#### 判断

按原则 10（避免过度工程）与 §8.6（修 runtime 而不是改 prompt）：这是一个**设计选择**而不是 bug。headless 每次单 unit 有可取之处：
- 每个 unit 结束即结算 cost / event / snapshot，外部调度方（CI、shell 脚本、MCP 客户端）可以做决策
- 失败 isolation 更好
- 与 `--fail-on-incomplete` 天然组合：给外部调度方一个简单 `exit 12 → retry` 契约

#### 修复方案

**F5 — 不改行为，而是：**

1. 在 `--help` / README 里明确"headless auto 单次调用只推进一个 unit；若要推完整个 milestone，用 `--fail-on-incomplete` 配合 shell `while` 循环或新增 `--loop-until-complete` 开关"。
2. 可选：新增 `--loop-until-complete` flag。作用是把 `runHeadless` 外层 while 改为 "当 snapshot.status === 'needs-continue' 且未超 max-iterations → 再调一次 runHeadlessOnce"。这是**增项**不是改项，原契约保留。
   - 默认 `max-iterations` 建议 20（足以跑完正常 milestone，但不会无限循环）。
   - 达到 max 仍 needs-continue → exit 12。
   - 遇到 exit 1 / 10 / 11 → 立即退出，不再循环。

**原则映射**：§8.6 "workflow snapshot 决定退出码"；§1 原则 3。

默认不开 loop 模式 → 保留当前 CI 契约；显式开启 → 提供便利。

#### P2 的验证手段

- 若仅做文档：在 `docs/cli/headless.md`（或等价文件）加一节 "Running to completion"，演示两种用法
- 若加 flag：`tests/unit/headless.loop-until-complete.test.ts` 覆盖三种终止条件

---

### 3.3 P3 — `exit 0 + needs-continue` 共存

#### 当前行为

`src/headless.ts:269-281`：
- `status = complete` 仅当 `phase === 'complete' && !activeMilestone`
- 否则若 `next.action === 'dispatch'` → `needs-continue`
- 否则 → `unknown`

`src/headless.ts:941-954`：
- 仅当 `ranAutoMode && commandExitCode === EXIT_SUCCESS && !blocked` 才计算 snapshot
- 若 `failOnIncomplete && status === 'needs-continue'` → exit 12

#### 判断

这是**有意的默认契约**，不应改。`exit 0` 表示"本次命令进程没出错"；`Workflow Status` 才表示 workflow 层是否完成。两者正交。

#### 修复方案

**F6 — 用测试锁住这个契约**（必做，轻量）

新增 `tests/integration/headless.workflow-status.test.ts`：

1. 在真实 minimal `.gsd` fixture 上，制造 `phase=validating-milestone / next.action=dispatch` 的 state，跑 `headless auto`（走一个已 mock 的 auto dispatcher）。
2. 断言：
   - `process.exitCode === 0`
   - stderr 依次出现：`Status: complete`、`Command Status: complete`、`Workflow Status: needs-continue`、`Workflow Phase:`、`Active Milestone:`、`Next: dispatch ...`
3. 再以同 fixture 跑 `headless --fail-on-incomplete auto`：
   - `process.exitCode === 12`
   - stderr 输出不变（关键行顺序一致）

**F7 — 在文档里标注该契约**（必做，与 F6 配对）

当前仓库没有现成的 `docs/cli/headless.md`，因此文档落点应放到现有计划/流程文档体系（例如本文件与 `2026-04-25-phase-discipline-seeded-auto-e2e-process-summary.md`），把上述矩阵固化：

| 进程退出码 | Command Status | Workflow Status | 含义 |
|-----------|----------------|-----------------|------|
| 0 | complete | complete | milestone 完成 |
| 0 | complete | needs-continue | 单元已完成，workflow 还有 next unit（默认模式） |
| 12 | complete | needs-continue | 同上，但用 `--fail-on-incomplete` 放大 |
| 1 | error | (不生成 snapshot) | 命令进程错误 |
| 10 | blocked | (不生成 snapshot) | 被 BLOCKED |
| 11 | cancelled | (不生成 snapshot) | 被 SIGINT / SIGTERM |

**原则映射**：§5.1 以 `headless query` 为准；§8.6 "workflow snapshot 决定退出码"；§1 原则 3 / 6。

---

### 3.4 P4 — `--fail-on-incomplete` 已返回 `exit 12`，但无回归

已由 F6 覆盖。额外：

**F8 — 把 P4 / P3 的集成测试串成一个 CI-friendly 脚本**（可选）

`scripts/ci-headless-exit-code-matrix.sh`：建一个临时 fixture、跑一遍三种组合、断言 exit code。用在 GitHub Actions 的 headless 套件里。只在 F6 之后作为守门。

---

### 3.5 P5 — 同一 unit 无产物地反复 dispatch 没有 no-progress 检测

#### 当前行为

`detect-stuck.ts` 覆盖：
- 连续两次相同 error → stuck
- 连续 3 次 same-unit 或窗口内 3 次 → stuck
- 振荡 → stuck
- ENOENT 同路径 2 次 → stuck

**空白**：若同一 `validate-milestone M007` 被 dispatch 两次但两次都**没有 error**（因为 agent 输出了自由文本、tool 未报错），stuck detector 看不到 error，只能靠 Rule 2b 的 "3 次窗口内同 unit" 兜底，这需要第 3 次才触发。

#### 修复方案

**F9 — 给 `detect-stuck.ts` 加一条规则：structured validation code 连续出现 2 次即触发**（必做）

与 F3 配对。F3 会把 `VALIDATION_ARTIFACT_MISSING` / `VALIDATION_VERDICT_INVALID` / `REMEDIATION_REQUIRED_BUT_NO_PLAN` 这类 code 写进 `WindowEntry.error`。F9 在 `detect-stuck.ts` 识别这类 code 时，**同一 code 出现 2 次就触发 stuck**（与 ENOENT 规则同构）。

改动极小：在 `detect-stuck.ts:86-102` 的 ENOENT 规则后新增一个 `structured-validation-code` 分支，匹配共享常量中的 validation error codes，而不是手写字符串正则。

**原则映射**：§8.6 "用代码检测 unit 无进展"；§1 原则 4。

---

## 4. 实施顺序与最小闭环

按依赖关系与风险从低到高排序：

1. **F2**（handler error code 结构化）—— 孤立改动，零 breaking
2. **F1**（dispatch 规则加 artifact guard）—— 依赖 F2 的 error code 枚举
3. **F3**（finalize-time artifact assertion）—— 依赖 F1 的契约
4. **F3.5**（统一 canonical-root reader）—— 依赖 F1/F3 的 artifact contract，且直接影响 `headless query` 真实性
5. **F9**（stuck detector 识别 structured code）—— 依赖 F3 写入的 error
6. **F6 / F7**（exit code 契约测试 + 文档）—— 与上面彼此独立，可并行
7. **F8**（CI 脚本）—— 可选
8. **F5**（P2 文档 / 可选 flag）—— 不紧急
9. **F4**（agent 工具调用守卫）—— 等 F1 在实际 e2e 观察一轮后再决定是否必要

**最小闭环**（解 blocker 所必须，其他可后续补）：

- F2 + F1 + F3 + F3.5 + F9 + F6

这六项实施完成后即可关闭 §8.5 描述的 blocker，并避免在 live worktree 下被 `headless query` / finalize reader 再次误判。

---

## 5. 不做的事情（显式排除）

按 CODEBUDDY.md 与原则 10：

- **不**重写 `runHeadlessOnce` 让它自动循环。P2 的当前行为是合同，不在本次动。
- **不**引入 feature flag / 兼容旧 state。所有改动直接生效，新老项目都应走新逻辑。
- **不**把 prompt 里的 "请记得调用 validate_milestone" 改得更严。这是 §8.6 明令反对的路径。
- **不**顺手重构 `auto-dispatch.ts` 的 80+ 规则表。F1 只增一小段在现有两条规则里，不动架构。
- **不**给 `validate-milestone.ts` 加 UOK gate 额外维度。`:167-199` 的 gates 已经在运作，不扩展。
- **不**扩大 `detect-stuck.ts` 的窗口大小或持久化范围。F9 只加一条规则。
- **不**在 memory 里写任何"已修复 P1"之类的进度条；memory 用于跨会话稳定事实，不是进度追踪。

---

## 6. 验收与判定

按 §5.1 原则，以下条件**同时**满足才算修复闭环：

1. 新跑一个 docs-only minimal milestone：
   - `headless query` 最终 `phase=complete`、`activeMilestone=null`、目标 milestone `complete`
   - 目标 milestone 目录下同时存在 `M###-VALIDATION.md`（verdict=`pass`）、`M###-SUMMARY.md`
2. 故意构造一个 "agent 不调用 validate_milestone" 的 reproducer（例如改 prompt 为 no-op）：
   - 默认模式返回 `exit 0 + Workflow Status: needs-continue`，`Next: dispatch validate-milestone M###`，连续两轮后 stuck detector 命中 `VALIDATION_ARTIFACT_MISSING`，返回 stop + 错误 reason
   - `--fail-on-incomplete` 模式同样 stderr 输出，`exit 12`
3. 故意写一个 verdict 缺失的 `M###-VALIDATION.md`（模拟 F1 分支）：
   - dispatch 规则直接 stop，reason 含 `VALIDATION_VERDICT_INVALID`
4. F6 的集成测试全部通过

验收的证据沉淀按原文档 Step 8 / Step 9：写 findings 与 handoff，不要把结论只留在对话上下文里。

---

## 7. 风险与已知权衡

- **风险 1**：F1 把 artifact 缺失变成 stop，若现存项目因历史原因已经跳过 validation（例如用了 `prefs.phases.skip_milestone_validation`），不会受影响——该分支已在 `auto-dispatch.ts:933-954` 写入一个 minimal pass-through VALIDATION 文件，会通过 F1 的 frontmatter 校验。验证测试里需显式覆盖这条路径。
- **风险 2**：F3 / F3.5 的 canonical-root 解析若不一致，可能在 writer 已写入 worktree 时被 reader 误报缺失。缓解：将 `VALIDATION` / `SUMMARY` 读路径统一到同一 helper，并用 worktree regression test 锁定。
- **风险 3**：F9 新增的 code 匹配正则需与 F2 的枚举精确对齐。建议把 code 定义放在一个共享常量文件（`src/resources/extensions/gsd/validation-error-codes.ts`）并在 F2、F3、F9 中 import 同一个常量，避免字符串漂移。
- **权衡**：F4 路径 A（post-unit tool-call 校验）更彻底，但改动 auto/phases 语义，本次按"最小闭环 + 先观察"原则放在 F1 之后再评估。

---

## 8. 与 memory 系统的关系

原文档本身是跨会话的"流程经验"，已经写进 `docs/superpowers/plans/`。本修复方案属于**进行中的工作**，不写入 memory 系统。

若本方案将来验收通过、产生两条值得跨会话复用的事实，再按 memory 规范写 feedback 类型（例如："docs-only milestone 必须断言 `M###-VALIDATION.md` 存在，reason: 2026-04-25 的 M007/S02 卡在 validate-milestone"）。但现在还没到那一步。
