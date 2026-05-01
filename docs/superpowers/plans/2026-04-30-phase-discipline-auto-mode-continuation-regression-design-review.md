# Design Review: phase-discipline auto-mode continuation regression

- Date: 2026-04-30
- Reviewed Design: `docs/superpowers/specs/2026-04-30-phase-discipline-auto-mode-continuation-regression-design.md`
- Review Scope: 根因分析（§3）+ 方案设计（§4-§5）+ 验证计划（§6）

## 1. 整体结论
- **NEEDS_REVISION**
- 根因链部分成立但关键判断有误；方案方向正确但过于抽象，关键实现路径和操作化定义缺失。

## 2. 根因评审结论

- **适用性**: 适用 —— 文档明确包含"已确认事实"、"未确认假设"和"对设计的影响"三节，且方案正确性依赖根因成立与否。
- **结论**: WEAK_EVIDENCE（部分推断过度）
- **理由**: §3.2 的大部分"已确认事实"经代码核查成立，但 §3.2 第 4 条（"continuity语义丢失发生在 dispatch 前的状态恢复阶段"）属于未锁定单点实现的推断；§3.3 第 2 条对根级 `.gsd/ROADMAP.md` 访问来源的假设与代码事实存在偏差，需要修正。

### 2.1 证据检查

**SUPPORTED（已确认事实第 1-3 条）：**
- ✅ Journal 证据完全吻合：`.gsd/journal/2026-04-30.jsonl` 显示 `nextUnitType: "execute-task"`, `nextUnitId: "T01"` 但 `dispatch-match` 是 `execution-entry phase (no context) → discuss-milestone`，顺序完全对齐。
- ✅ 回退规则真实存在且有测试覆盖：`execution-entry-missing-context-4671.test.ts` 验证了 `hasFinalizedMilestoneContext` 为 false 时触发回退；`auto-dispatch.ts:328-357` 有完整实现。
- ✅ Canonical milestone artifact 路径已实现 milestone-scoped：`worktree-manager.ts` 的 `resolveCanonicalMilestoneArtifactPath` 正确返回 `.gsd/milestones/<MID>/<MID>-<SUFFIX>.md`，`canonical-milestone-artifacts.test.ts` 有完整覆盖。

**WEAK_EVIDENCE（已确认事实第 4 条）：**
- ⚠️ 文档描述"会话仍尝试访问 `.gsd/ROADMAP.md`"，并把根因归为"某条旧路径 helper"或"某个未切到 canonical resolver 的 status/discussion 分支"。经代码核查：
  - `worktree-manager.ts` 的 canonical resolver **不会**访问根级 `.gsd/ROADMAP.md`（路径构造为 milestone-scoped）。
  - 根级 `.gsd/ROADMAP.md` 只在 `write-intercept.ts` 中作为"允许写入的 agent-authored 路径模式"出现，不是 milestone artifact 的读取路径。
  - journal 中的 ENOENT 来自 `discuss-milestone` prompt 组装阶段（`buildDiscussMilestonePrompt`），而非 canonical artifact resolver。但文档 §3.3 第 2 条的推断"旧路径 helper / 未切到 canonical resolver 的 discussion 分支"方向基本正确，**只是不能归咎于 milestone artifact resolver 本身**。

**NOT_EXAMINED（已确认事实第 5 条）：**
- 🔲 `M005-CONTEXT.md` 是否真实缺失，代码层面无法直接确认。经 `auto-dispatch.ts` 的判定逻辑，倒退最直接的触发条件是 `hasFinalizedMilestoneContext` 返回 false（对应代码 `plan-v2.ts`），可能原因：
  1. `M005-CONTEXT.md` 真的不存在或空白；
  2. 存在但当前 basePath / worktree 视角下不可见；
  3. milestone scoped path（`.gsd/milestones/M005/M005-CONTEXT.md`）与 `hasFinalizedMilestoneContext` 查找路径不一致。

### 2.2 事实 / 假设边界检查

- §3.2 第 1-3 条：事实，证据充分。
- §3.2 第 4 条：有一定证据（journal ENOENT），但归因方向有误。根级 `.gsd/ROADMAP.md` 的 ENOENT 不是来自 canonical resolver，而是来自 `discuss-milestone` 的 prompt 组装。
- §3.3 第 2 条：表述为"尚未锁定单点实现"是正确的；但第 1 条"可能是真缺失也可能不可见"没有给出区分方法。
- §3.4 的影响判断整体正确，但第三条"supervised 语义丢失可能发生在 dispatch 前或被错误回退后"范围过宽，缺乏方向性。

### 2.3 对方案的影响检查

- ✅ 根因"continuation 语义未统一"驱动选择方案 B（统一 contract）而非方案 A（局部补丁），逻辑合理。
- ⚠️ 但由于对根级 `.gsd/ROADMAP.md` 的归因有误，"禁止旁路访问根级 `.gsd/<ARTIFACT>.md`"（§5.1）可能打错靶子。真正需要修复的是 `discuss-milestone` 的 prompt 组装逻辑，让它使用 canonical resolver，而不是在 artifact resolver 层加限制。
- ⚠️ §5.1 增加"continuation 一致性检查"的思路正确，但文档没有定义"解析视角错位"的**操作化判定**：谁判断、哪个阶段判、判定的代码接口是什么。

## 3. 设计方案评审

### 3.1 需求与方向
- ✅ 方向正确：把 continuation 判定语义收敛成单一事实源，比三个点各修各的更有价值。
- ✅ 非目标约束合理（不重构整个 auto-mode loop、不新增第二 runtime）。
- ⚠️ 但没有正面回答最关键的问题：**为什么 `hasFinalizedMilestoneContext` 在 supervised continuation 会话中返回 false？** 这是触发整个回退链的直接原因，方案应该先正面回答这个问题，而不是只做外围防御性检测。

### 3.2 方案合理性
- ✅ 三层语义框架（continuity target / artifact visibility / supervised policy）逻辑上自洽。
- ✅ fail-closed 对 supervised continuation 的约束方向正确，与 v1 supervisor protocol 一致。
- ⚠️ **关键缺失**：没有说明**continuation 一致性检查**具体在哪个阶段、哪个函数、调用哪个 resolver 的哪个方法来实现。方案停留在控制流描述层，没有落到代码接口层面。
- ⚠️ **"解析视角错位"是模糊概念**："期望 artifact 与当前 lookup 根不一致"这个判定依赖于"谁来定义'期望 artifact'"和"谁来比较"。如果就是"canonical resolver 找不到就报 inconsistency"，那和"真实缺失"的区别是什么？两者都需要 resolver 返回 not-found，区别只能来自"resolver 是否在正确的 basePath 上被调用"，而这又回到了"谁决定 basePath"的循环。
- ⚠️ §5.1 "禁止旁路访问根级 `.gsd/<ARTIFACT>.md`"的机制不明确：是 linter 规则、代码审查约束、还是运行时检测？如果是运行时检测，在哪个点检测、怎么检测？

### 3.3 实现可行性
- ⚠️ §5.2 控制流的步骤 2-4 缺乏具体函数签名和数据结构定义。无法从设计文档直接映射到代码修改点。
- ⚠️ §6 验证计划中的单测"当 lookup 试图访问根级 `.gsd/ROADMAP.md` 时应报告 path inconsistency"——这个测试的前提本身就是基于 §3.2 第 4 条的有误归因。如果根级 ROADMAP.md 从来不是 canonical resolver 的访问目标，那这个测试描述的场景根本不存在。
- ✅ 集成 replay harness 设计合理，但需要具体实现为可执行脚本或 harness 代码。
- ⚠️ §5.5 风险"只统一 milestone artifact，漏掉 slice/task artifact 分支"已识别，但缓解措施"列表化 + 代码审查核对"不构成具体实现保证。

### 3.4 文档质量
- ✅ 结构完整，章节清晰，无 TODO/TBD。
- ✅ 方案对比充分，选型理由有层次。
- ⚠️ 存在**循环定义问题**：
  - §5.2 步骤 3："resolver 在当前 basePath / worktree 视角下检查 artifact 可见性"
  - 但 §5.2 步骤 5 的 fallback 逻辑又依赖"是否为 supervised continuation"
  - 这两个判断之间没有定义优先级和依赖关系
- ⚠️ §5.4 错误处理的三种情况（真实缺失 / 解析视角错位 / continuation 语义丢失）边界重叠：
  - "真实缺失"与"解析视角错位"的区别不清晰（见 §3.2 分析）
  - "解析视角错位"与"continuation 语义丢失"在 supervisor 模式下都会 fail-closed，区分意义不大

## 4. 主要发现

### HIGH 发现

#### HIGH-1 根因归因偏差导致修复靶点可能错误

**位置**: 设计文档 §3.2 第 4 条 + §5.1 末段

**问题**: 文档将根级 `.gsd/ROADMAP.md` 的 ENOENT 归因为"某条旧路径 helper"或"未切到 canonical resolver 的 artifact resolver"。经代码核查，canonical milestone artifact resolver（`worktree-manager.ts`）本身**不会**访问根级 `.gsd/ROADMAP.md`，其路径构造正确（`.gsd/milestones/<MID>/<MID>-*.md`）。真正问题更可能是 `buildDiscussMilestonePrompt`（构建 milestone 讨论 prompt 的逻辑）使用了错误的路径读取 ROADMAP 内容。

**影响**: §5.1 "禁止旁路访问根级 `.gsd/<ARTIFACT>.md`"的修复靶点打在 artifact resolver 层，但实际问题可能在 prompt 组装层。打错靶子会导致投入大量设计实现但问题不减。

**建议**: 先用 `/gsd forensics` 或直接阅读 `buildDiscussMilestonePrompt` 及其调用链，确认 `.gsd/ROADMAP.md` 的 ENOENT 实际来自哪个函数。然后修正 §3.2 第 4 条的根因描述，并相应调整 §5.1 的修复范围。

#### HIGH-2 "解析视角错位"缺乏操作化定义

**位置**: 设计文档 §5.2 控制流步骤 3 + §5.4 错误处理

**问题**: "解析视角错位"是方案的核心区分概念之一，但它不是一个可操作的代码接口。方案描述为"期望 artifact 与当前 lookup 根不一致"，但：
1. "期望 artifact"由谁定义？continuity coordinator 还是 dispatch？
2. "不一致"在哪个函数、哪个返回值里判断？
3. 它与"真实缺失"的区别是什么——两者都是 resolver 返回 not-found？

**影响**: 如果实现者不能从代码中找到唯一映射，"解析视角错位"会被实现成另一种"真实缺失"，方案 B 和方案 A 实质上没有区别。

**建议**: 在 §5.2 控制流中补充：给出具体函数名（或描述输入/输出接口），说明 resolver 的"可见性检查"如何同时返回"存在/不存在/路径冲突"三种状态，以及 supervisor guard 的 entry condition。

#### HIGH-3 直接原因未被正面触及

**位置**: 设计文档全文（尤其 §3 和 §5）

**问题**: 整个回退链的直接触发条件是 `hasFinalizedMilestoneContext` 返回 false，但设计文档从未正面回答：为什么 supervised continuation 会话中 `hasFinalizedMilestoneContext` 返回 false？

可能的候选原因（从代码分析）：
1. `M005-CONTEXT.md` 真的不存在或空白（真缺失）
2. `M005-CONTEXT.md` 存在但路径在 `worktree` vs `basePath` 层面不一致
3. `hasFinalizedMilestoneContext` 的 `getArtifactLookupBases` 覆盖范围不够

方案只在外围加一致性检查，而不是正面修复这个判断函数。

**影响**: 即使加了"continuation 一致性检查"并 fail-closed，下次 continuation session 仍然可能因为同样原因触发回退。方案变成了"检测问题"而不是"修复问题"。

**建议**: §3.3 或新增 §3.5，专门分析 `hasFinalizedMilestoneContext` 在本次场景下为什么返回 false，给出区分（真缺失 vs 路径不一致）的具体方法。这应该是设计的前置条件，而不是留给实现阶段猜测。

### MEDIUM 发现

#### MEDIUM-1 验证计划中的测试场景基于有误归因

**位置**: 设计文档 §6 验证计划"单测：当 lookup 试图访问根级 `.gsd/ROADMAP.md` 时应报告 path inconsistency"

**问题**: 如果根级 `.gsd/ROADMAP.md` 从来不是 canonical milestone artifact resolver 的访问目标，那么这个测试场景的前提就是错的。

**建议**: 修正 §6 中的相关测试描述，使其与修正后的根因对齐。如果该场景不成立，需要补充其他能够真正验证"root-level fallback 被阻止"的测试场景。

#### MEDIUM-2 方案停留在控制流层，缺乏代码接口定义

**位置**: 设计文档 §5.1-§5.2

**问题**: 整个方案描述的是"在 dispatch 前增加检查"和"resolver 区分三种情况"，但没有给出一个函数签名、输入/输出接口、或关键数据结构的定义。实现者和评审者都无法判断"在哪里加这段检查逻辑"。

**建议**: 在 §5.2 控制流中，每个步骤补充：调用的函数名（或"需要新增的函数名"）、关键参数、返回值含义。至少给出 §5.1 的 continuation 一致性检查在 `auto-dispatch.ts` 还是 `auto/phases.ts` 中实现。

#### MEDIUM-3 三种错误情况边界重叠，fail-closed 分支实际合并

**位置**: 设计文档 §5.4 错误处理

**问题**: "真实缺失 + supervised 模式允许回退"和"解析视角错位 + supervised 模式 fail-closed"实际上要求实现者在 dispatch 前精确区分两种 not-found。如果区分不清，supervisor 的 fail-closed 保护可能实际无效（边界情况都走到了"允许回退"分支）。"continuation 语义丢失"与"解析视角错位"在 supervisor 模式下都会 fail-closed，实现上可能合并。

**建议**: §5.4 明确：supervised 模式下的 fail-closed 分支只保留一种条件（artifact visibility 与 continuity target 不一致），不再区分"为什么不一致"。§5.4 中"真实缺失 + supervised 允许回退"的例外场景（"首次进入执行前缺上下文"）是否适用于本次 continuation 场景，需要明确。

#### MEDIUM-4 缺少失败场景的详细描述

**位置**: 设计文档 §5.4

**问题**: 方案描述了"若 continuity target 与 artifact visibility 一致，则按正常执行分支继续"，但没有描述"若不一致"时 fail-closed 之后系统具体进入什么状态：输出什么错误信息？记录什么 journal 事件？session 以什么 exit reason 终止？用户收到什么反馈？

**建议**: 补充 §5.4 的 fail-closed 行为描述，与 §5.3 的 supervisor protocol 中"internal inconsistency"场景对齐。

## 5. 修订建议

1. **[HIGH-1]** 修正 §3.2 第 4 条的根因描述：根级 `.gsd/ROADMAP.md` ENOENT 的来源不是 canonical artifact resolver，而是 `buildDiscussMilestonePrompt` 或其调用链。§5.1 "禁止旁路访问根级 `.gsd/<ARTIFACT>.md`"需要区分是在哪里禁止（resolver 层 vs prompt 组装层）。
2. **[HIGH-2]** 在 §5.2 中为"continuation 一致性检查"补充具体实现位置（函数名/文件/调用阶段）和 resolver 返回类型的操作化定义（三种可见性状态的具体形式）。
3. **[HIGH-3]** 新增 §3.5（或扩充 §3.3）：分析 `hasFinalizedMilestoneContext` 在本次 continuation 场景下为什么返回 false，给出真缺失 vs 路径不一致的区分方法。这应该是设计的前置条件。
4. **[MEDIUM-1]** 修正 §6 验证计划中基于有误归因的测试场景描述。
5. **[MEDIUM-2]** §5.2 每个控制流步骤补充关键函数名/输入/输出接口。
6. **[MEDIUM-3]** 简化 §5.4 的 supervised 模式 fail-closed 分支，合并"解析视角错位"与"continuation 语义丢失"，只保留"artifact visibility 与 continuity target 不一致"一个判断条件。
7. **[MEDIUM-4]** 补充 §5.4 fail-closed 后的系统行为描述（journal 事件、错误信息、exit reason）。

## 6. 下一步建议

- 进入 **design-implement**（修订后），理由：方案方向（统一 continuation contract、fail-closed supervisor guard）正确，但关键根因有误、核心概念缺乏操作化定义、实现路径不具体，需要先修订再实现。

## 7. Handoff

### 7.1 如果进入修订及实现

**同会话继续**

```
直接执行 /design-implement
```

**新会话恢复 prompt**

```
请阅读设计文档 docs/superpowers/specs/2026-04-30-phase-discipline-auto-mode-continuation-regression-design.md
和评审文档 docs/superpowers/plans/2026-04-30-phase-discipline-auto-mode-continuation-regression-design-review.md，
重点核对：
1. 根因 §3.2 第 4 条（根级 ROADMAP.md 访问来源）与 §5.1 的修复靶点是否对准
2. HIGH-2："解析视角错位"的操作化定义（resolver 如何同时返回"存在/不存在/路径冲突"三种状态）
3. HIGH-3：新增 §3.5 分析 hasFinalizedMilestoneContext 为什么在 continuation 会话中返回 false
4. MEDIUM-1~4 的修订点
使用 /design-implement 进行方案修订及实现。
```

### 7.2 如果回退重新设计

不需要回退。方向正确，主要问题是根因细节和概念操作化，不是否定方案本身。
