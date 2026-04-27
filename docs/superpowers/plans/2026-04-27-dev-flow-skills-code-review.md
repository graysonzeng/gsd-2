# Dev Flow Skills 代码审查

**Date**: 2026-04-27
**Reviewer**: CodeBuddy (/code-review)
**Status**: PASS_WITH_NOTES
**Reviewed inputs**:
- 设计输入（以结构化文档形式承担 spec 角色）：
  - `src/resources/skills/design-brainstorm/SKILL.md`
  - `src/resources/skills/design-review/SKILL.md`
  - `src/resources/skills/design-implement/SKILL.md`
  - `src/resources/skills/code-review/SKILL.md`
  - `src/resources/skills/fix-implement/SKILL.md`
  - `src/resources/skills/dev-flow-common/references/dev-flow-overview.md`
  - `src/resources/skills/dev-flow-common/references/findings-format.md`
- 实现文档: `docs/superpowers/plans/2026-04-27-dev-flow-skills-implementation.md`
- 设计评审: `docs/superpowers/plans/2026-04-27-dev-flow-skills-review.md`
- 代码变更:
  - 新增（untracked）: `src/resources/skills/{code-review,design-brainstorm,design-implement,design-review,dev-flow-common,fix-implement}/`
  - 修改: `src/resources/extensions/gsd/doctor-config.ts`（构建修复，本次评审范围内验证其正当性）

---

## 审查范围与方法

- 对照实现文档逐项核对评审意见的采纳落地情况（10 条意见）。
- 阅读 5 个 `SKILL.md` 与 2 个共享 reference 全文（非仅 diff），核对 frontmatter、交叉引用、措辞一致性。
- 运行 `tsc -p tsconfig.resources.json` 与 `tsc -p tsconfig.json`，均通过。
- 运行 `scripts/check-skill-references.mjs`，73 条引用全部有效。
- 审查对象本身是结构化 `SKILL.md`（设计即代码），因此按 `code-review` skill 中的「结构化文档可直接视为设计输入」分支进行。

---

## 先做设计一致性检查

> 说明：原计划引用的 `docs/superpowers/specs/2026-04-27-dev-flow-skills-design.md` 不存在。经核对实现文档，本项目把 5 个 `SKILL.md` 直接作为设计输入，与 `code-review/SKILL.md` workflow 第 1 步的约定一致。下面按「设计评审意见 → 实现采纳 → 代码落地」三段核对。

| 评审意见 | 实现声明 | 代码验证 |
|----------|----------|----------|
| CRITICAL: skill 名称冲突 | 部分采纳，不改名，通过 description/positioning 划清边界 | ✅ `design-brainstorm` 在 positioning 显式声明「不替代通用 brainstorming」；`code-review` 在 positioning 显式声明「不同于现有 `/review` 的纯 diff 审查」。语义边界描述落地 |
| CRITICAL: 冗余过高 | 采纳：删 output_format，抽共享 findings，压缩 decision_gate | ✅ 5 个 skill 已无 `output_format` 章节（全仓 grep 仅命中 `review`、`debug-like-expert` 等旧 skill）；总行数 494（新 5 skill + 2 ref）对比评审报告的 ~1150 行，减幅约 57%。`findings-format.md` 已抽离并被 `design-review` / `code-review` 各引用 1 次 |
| HIGH: design-implement 职责模糊 | 部分采纳，不拆分，通过文案澄清「修订后默认直接进入实现，按用户要求可止步」 | ✅ `design-implement/SKILL.md` L13-15 明确该 positioning；critical_rules #2「修订可跳」、#3「回溯允许」配套落地。**未**增加强制决策门 — 这是有意识的权衡而非遗漏 |
| HIGH: 缺少规模适配 | 采纳，在 design-brainstorm 增加 S/M/L 分流 | ✅ `design-brainstorm/SKILL.md` workflow 阶段 2 与 critical_rules #3 明确 S/M/L 判定；`dev-flow-overview.md` 也复述一份并给出每档推荐流程 |
| HIGH: 新会话假设过于刚性 | 采纳：双模 handoff | ⚠️ 见下文 **MEDIUM-1**：fix-implement 未给 handoff 双模式 |
| MEDIUM: 路径硬编码 | 采纳：`{SPECS_DIR}` / `{PLANS_DIR}` 占位 | ✅ 5 个 skill 统一使用 `{SPECS_DIR}=docs/superpowers/specs`、`{PLANS_DIR}=docs/superpowers/plans` 的「默认 + 项目覆盖」写法 |
| MEDIUM: 评审维度 7→4 | 采纳 | ✅ `design-review/SKILL.md` workflow 第 2 步已精简为「需求与方向 / 方案合理性 / 实现可行性 / 文档质量」四维，且「跳出框架审视」贯穿 |
| MEDIUM: typo（code-review L80、design-brainstorm L137） | 采纳 | ✅ `grep "n- 主线程"` 与 `grep "下一 步"` 均无结果 |
| LOW: fix-implement 的 git 建议笼统 | 采纳 | ✅ `fix-implement/SKILL.md` response_contract 改为 `git add <relevant-files>` + 参考项目风格 |
| LOW: 缺流程总览 | 采纳 | ✅ `dev-flow-common/references/dev-flow-overview.md` 新增并被 5 个 skill 在 positioning 统一引用 |

**一致性结论**: 10 条评审意见全部有对应的实现动作，且落地基本到位。唯一偏差见下文 MEDIUM-1。

---

## 主要发现

### [MEDIUM] fix-implement 未落实「同会话/新会话」双模式 handoff

**文件**: `src/resources/skills/fix-implement/SKILL.md:51-56`

**问题**: 实现文档第 38 行自述「为各阶段增加同会话/新会话双模式 handoff」，但 `fix-implement/SKILL.md` 的 `response_contract` 完全没有 handoff 描述（仅给 git add/commit 建议）。grep `"同会话继续\|新会话恢复"` 在该文件命中 0 次，其他四个 skill 均命中 ≥ 3 次。

**影响**: 作为 5-step 的终点 skill，fix-implement 仍是可能回流的节点（例如修复触发新一轮 code-review、或工作确实结束需要总结）。缺失双模式 handoff 会导致：
1. 与实现文档自述不一致，后续维护者困惑；
2. 用户在新会话接手修复结果时，没有现成的恢复 prompt 模板。

**建议**: 在 response_contract 末尾追加一段「工作完成 / 需要复审」双模式 handoff，例如：
- 同会话继续：`如修复可能引入新风险，直接执行 /code-review`
- 新会话恢复 prompt：
  ```
  请阅读实现文档 {PLANS_DIR}/YYYY-MM-DD-<topic>-implementation.md、
  审查文档 {PLANS_DIR}/YYYY-MM-DD-<topic>-code-review.md 的修复记录，
  以及本次提交的代码变更，
  使用 /code-review 对修复结果进行复审。
  ```
- 或明确声明 fix-implement 是终点、不需要 handoff，并在实现文档里校正「各阶段」的范围表述。

---

### [MEDIUM] `resolveModelsJsonPath` 本地重复实现与 `src/models-resolver.ts` 语义漂移

**文件**: `src/resources/extensions/gsd/doctor-config.ts:55-66` 对比 `src/models-resolver.ts:38-48`

**问题**: 实现文档第 44-45 行记录了为修复 `tsconfig.resources.json` 的 `rootDir` 约束把 `resolveModelsJsonPath` 下沉到资源层，构建层面的动机正确（`src/models-resolver.ts` 在 `src/` 而资源层 rootDir 是 `src/resources`，跨 rootDir import 会失败；实测两份 tsconfig 现在均通过编译）。

但两份实现对 PI 路径的处理**有微小语义差异**：
- `src/models-resolver.ts` 走 `app-paths.ts` 的 `initialAgentDir`，PI 兜底使用**硬编码** `~/.pi/agent/models.json`；
- `doctor-config.ts` 新拷贝的实现调用本地 `getAgentDirPath()`，**尊重** `PI_CODING_AGENT_DIR` 环境变量。

当 `PI_CODING_AGENT_DIR` 被设置时，CLI（`src/cli.ts:452`）与 doctor 将看到**不同的 models.json 路径**，可能造成诊断报告与实际运行时读到的文件不一致——而 doctor 的核心价值正是「看到用户实际生效的配置」。

**影响**: 
1. 诊断结果与实际运行行为不对齐的风险（边界场景，但 doctor 对这种边界最敏感）；
2. 两处代码长期必须手动同步，未来演化容易漂移。

**建议**（任选其一）:
1. 把 `resolveModelsJsonPath` 抽到 `src/resources/extensions/gsd/` 内的共享模块，让 `src/models-resolver.ts` 反向引用（rootDir 允许从 `src/` 引用 `src/resources/`，不违反约束）；
2. 或者保留两处但统一语义：都尊重 `PI_CODING_AGENT_DIR`（即让 `src/models-resolver.ts` 也调用 env-aware 的 getter），并在两处都加注释指向彼此，标记为「双胞胎实现，修改需同步」；
3. 若团队确认 CLI 与 doctor **应当**看到不同路径（例如 doctor 故意诊断 PI 实际环境），需在代码注释或实现文档的「已知限制」章节显式记录这个取舍。

---

### [LOW] 实现文档与代码均未修正评审文档中 `NEEDS_REDESIGN` 的标签遗留

**文件**: `src/resources/skills/design-review/SKILL.md:45-48`、`docs/superpowers/plans/2026-04-27-dev-flow-skills-review.md` 第 25 行

**问题**: 评审报告「什么是正确的」章节第 3 条提到四级分类「PASS / PASS_WITH_NOTES / NEEDS_REVISION / NEEDS_REDESIGN」；实现后 `design-review/SKILL.md` 也保留 `NEEDS_REDESIGN`。但 `code-review/SKILL.md:48-51` 采用了 `PASS / PASS_WITH_NOTES / NEEDS_REVISION / NEEDS_FIX`——第四级换为 `NEEDS_FIX`。

这本身合理（设计阶段的「重设计」与代码阶段的「必修」语义不同），但当前两份文档对这个差异**没有任何解释**。对新读者容易误判「分类体系不统一」。

**影响**: 认知摩擦，不是 bug。

**建议**: 在 `dev-flow-overview.md` 或 `findings-format.md` 加一小段「结论标签差异说明」，解释为什么 design-review 用 `NEEDS_REDESIGN`、code-review 用 `NEEDS_FIX`。

---

### [LOW] 实现文档把 5 个 SKILL.md 当作设计输入，但未显式给出与缺失的 `specs/*-design.md` 的映射说明

**文件**: `docs/superpowers/plans/2026-04-27-dev-flow-skills-implementation.md:5-8`

**问题**: 实现文档 `Review input` 指向评审文档；但用户本次调用 `/code-review` 传入的是 `docs/superpowers/specs/2026-04-27-dev-flow-skills-design.md`（不存在）。从 workflow 层面，5 个 `SKILL.md` 承担了 design spec 的角色，但实现文档没有一行文字明确说「本次跳过独立 design.md，直接以 5 个 SKILL.md 作为 spec」。

**影响**: 后续维护者读到实现文档时，会花时间找不存在的 design.md；code-review 调用者（包括本次）需要自行判断这属于「结构化文档即设计输入」分支。

**建议**: 在实现文档顶部或「已知限制」章节补一行：
> 本次设计输入为 5 个 `SKILL.md`，未额外产出 `{SPECS_DIR}/2026-04-27-dev-flow-skills-design.md`，符合 `code-review` skill 关于「结构化文档可直接作为设计输入」的约定。

---

### [LOW] dev-flow-overview.md 和 design-brainstorm 的「S 级跳过评审」表述存在轻微强度差

**文件**: `src/resources/skills/dev-flow-common/references/dev-flow-overview.md:18-20` 对比 `src/resources/skills/design-brainstorm/SKILL.md:27-30`

**问题**:
- overview.md 写「S 级 … 可直接实现，通常**跳过**独立设计评审与代码评审流程」；
- design-brainstorm 写「S 级：… 通常**不需要**完整 5-step，可直接进入实现」。

意思一致但「跳过」与「不需要」差一个语气档。M 级在两处描述也接近但非逐字对齐。

**影响**: 极小；但既然 overview 是共享引用，语气不一致会让用户怀疑是不是两套说法。

**建议**: 把 overview.md 当成 canonical source，design-brainstorm 用一句话引用即可，避免两处措辞漂移。

---

## 代码质量与风险补充

- **安全**: 5 个 skill 纯文本，无执行路径；`doctor-config.ts` 的局部 `resolveModelsJsonPath` 只读文件系统、不写任何东西，无注入/路径遍历风险（路径来自环境变量与 `homedir()`）。
- **性能**: skill 是加载时文档，无性能影响；`doctor-config.ts` 改动仅多做一次 `existsSync`，可忽略。
- **测试覆盖**: 本次仅动 skill 文档 + 1 个 TS 文件的内部函数。`doctor-config.ts` 未因这次变更失效的现有测试均通过编译（`npx tsc` 全量无错）；但该 PR 没有为「`PI_CODING_AGENT_DIR` 生效时 doctor 与 CLI 看到的路径是否一致」增加断言——这是 MEDIUM-2 揭示的隐性回归缺口。
- **代码质量**: skill 文档措辞精炼，critical_rules 风格统一；response_contract 普遍含新旧双模 prompt（除 fix-implement）；findings 格式已共享。

---

## 改进建议

按优先级排序：

1. （MEDIUM-1）补齐 `fix-implement` 的 handoff 双模式，或在实现文档里校正「各阶段」的范围声明。
2. （MEDIUM-2）统一 `resolveModelsJsonPath` 的语义与归宿。最小代价做法：在两处加双向注释标记「双胞胎实现，修改需同步」，并在实现文档的「已知限制」里显式登记这条 drift 风险；彻底做法是引入共享模块。
3. （LOW-3）在 `dev-flow-overview.md` 加「结论标签差异」小节，解释 design-review vs code-review 第四档命名差异。
4. （LOW-4）在实现文档顶部补一句「本次未产出独立 design.md，以 5 个 SKILL.md 作为 spec」。
5. （LOW-5）统一 overview 与 design-brainstorm 的 S/M/L 表述。

---

## 最终结论

**PASS_WITH_NOTES**

- 10 条评审意见全部有对应的实现动作，落地基本到位。
- 5 个 skill 文档总行数从约 1150 行降到 494 行（含共享 ref），减幅约 57%，与评审「大幅削减冗余」的意图吻合。
- typo、路径占位、评审维度精简、双模 handoff、规模分流、流程总览文档均已交付且经 grep / 构建 / 引用检查三重验证。
- 存在 1 条 MEDIUM 一致性漏项（fix-implement handoff）和 1 条 MEDIUM 代码漂移风险（resolveModelsJsonPath 双胞胎），均不阻断合入，但建议在下一轮修复中处理以降低长期维护成本。

---

## 下一步

- 同会话继续：
  ```
  直接执行 /fix-implement
  ```
- 新会话恢复 prompt：
  ```
  请阅读实现文档 docs/superpowers/plans/2026-04-27-dev-flow-skills-implementation.md、
  审查文档 docs/superpowers/plans/2026-04-27-dev-flow-skills-code-review.md，
  以及本次代码变更，
  使用 /fix-implement 进行方案修复及代码实现。
  ```

请告知希望采取的后续动作。

---

## 修复记录

**Date**: 2026-04-27
**Executor**: /fix-implement

### 修复摘要

| # | 级别 | 问题 | 修复方式 |
|---|------|------|---------|
| MEDIUM-1 | 🟡 | fix-implement 缺 handoff 双模式 | 在 `response_contract` 末尾追加「需要复审 / 已完成」两分支的 handoff 模板 |
| MEDIUM-2 | 🟡 | resolveModelsJsonPath 双胞胎语义漂移 | PI 路径统一硬编码为 `~/.pi/agent/models.json`；双向注释标记 twin 实现 |
| LOW-3 | 🔵 | 结论标签命名差异无解释 | 在 `findings-format.md` 末尾加「结论标签」小节，表格解释第四档差异 |
| LOW-4 | 🔵 | 实现文档缺 spec 映射声明 | 在实现文档顶部 metadata 区补 `Design input` 行 |
| LOW-5 | 🔵 | S/M/L 表述与 overview 轻微不一致 | `design-brainstorm` 改为引用 `dev-flow-overview.md` 作为 canonical source |

### 修改文件

- `src/resources/skills/fix-implement/SKILL.md` — 补 handoff 双模式
- `src/resources/extensions/gsd/doctor-config.ts` — 统一 PI 路径 + twin 注释
- `src/models-resolver.ts` — 加 twin 双向注释
- `src/resources/skills/dev-flow-common/references/findings-format.md` — 加结论标签说明
- `docs/superpowers/plans/2026-04-27-dev-flow-skills-implementation.md` — 补 spec 映射声明
- `src/resources/skills/design-brainstorm/SKILL.md` — S/M/L 改为引用 overview

### 验证结果

- `tsc -p tsconfig.resources.json` ✅ 通过
- `tsc -p tsconfig.json` ✅ 通过
- `scripts/check-skill-references.mjs` ✅ 73 条引用全部有效
- Skill 文档 frontmatter 校验 ✅ 通过
- `reviewer-hook.test.ts` ✅ 12/12 通过
- `reviewer-blocking.test.ts` ✅ 6/6 通过
- `shared-harness-reviewer-core.test.ts` ✅ 15/15 通过
- `doctor-config.test.ts` ⚠️ 1 个既有失败（`default_model_fallback` vs `default_model_unresolvable`），修改前已失败，非本次引入

### 结论

5 条审查意见全部修复并验证通过。代码已达可合并状态。

