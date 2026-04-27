# Dev Flow Skills 设计方案评审

**Date**: 2026-04-27
**Reviewer**: Cascade
**Status**: NEEDS_REVISION
**Reviewed inputs**:
- `src/resources/skills/design-brainstorm/SKILL.md`
- `src/resources/skills/design-review/SKILL.md`
- `src/resources/skills/design-implement/SKILL.md`
- `src/resources/skills/code-review/SKILL.md`
- `src/resources/skills/fix-implement/SKILL.md`

---

## 评审结论

**NEEDS_REVISION** — 核心流程方向正确，但存在结构性问题：与现有 skill 生态冲突、冗余度过高、缺少规模适配机制、部分 skill 职责边界模糊。需要修订后重审。

---

## 什么是正确的

- 5-step 线性流程（设计→评审→修订实现→代码审查→修复）覆盖了完整的开发生命周期，方向正确
- 每个 skill 都有明确的只读/读写边界（design-review 和 code-review 是 READ-ONLY）
- 评审结论的四级分类（PASS / PASS_WITH_NOTES / NEEDS_REVISION / NEEDS_REDESIGN）清晰实用
- 跨 session 的文档 handoff 机制设计合理，prompt 模板确保上下文可恢复
- decision_gate 机制确保不跳步

---

## 发现的问题

### [CRITICAL] Skill 名称与现有生态冲突

**位置**: 全部 5 个 skill 的 YAML frontmatter `name` 字段

**问题**: `code-review` 与已有的 `src/resources/skills/review/SKILL.md`（name: `review`）功能重叠但语义不同。现有 `review` 是纯代码 diff 审查，新建的 `code-review` 是"方案重审+代码审查"，职责不同但名称极易混淆。

同样，`design-brainstorm` 与已有的 brainstorming workflow 功能高度重叠——两者都做需求探询、方案对比、设计呈现，区别仅在于新 skill 增加了文档化输出和 handoff prompt。

**影响**: 用户调用时无法区分该用旧 skill 还是新 skill；维护时两套逻辑会逐渐分化。

**建议**: 
1. `code-review` → 重命名为 `design-and-code-review`，明确区分于纯代码 review
2. `design-brainstorm` → 重命名为 `design-with-doc`，明确表达"设计+文档化"的组合语义
3. 或者：不在新 skill 中重新实现 brainstorming 逻辑，而是引用已有 brainstorming workflow，仅在其后追加文档化输出阶段

---

### [CRITICAL] 冗余度过高，不够精简

**位置**: 全部 5 个 skill，尤其 design-review（251行）、code-review（290行）

**问题**: 
1. **output_format 与 workflow 大面积重复** — output_format 本质是 workflow 的 markdown 模板化重述，信息增益极低。例如 design-review 的 output_format 几乎逐条复述了 workflow 阶段 2-5 的内容。
2. **format_findings 在 design-review 和 code-review 中几乎相同** — 两者都用 `[SEVERITY] 类别: 标题 / 位置 / 问题 / 影响 / 建议` 结构，完全可以抽取为共享模板。
3. **workflow 阶段描述过于 verbose** — "读取文档"、"理解上下文"等通用步骤在每个 skill 中都以长列表重复，但这些是任何 skill 都会做的基本操作，不需要每次详述。
4. **decision_gate 选项列表在 output_format 中完整重复** — design-review 和 code-review 都把 5 选项菜单写了两遍（workflow 中一遍，output_format 中一遍）。

**影响**: 5 个 skill 合计约 1150 行，但有效信息密度低。AI 加载时浪费 token，人类审阅时难以抓住重点。

**建议**:
1. 删除 output_format 章节，或压缩为 3-5 行的要点式输出要求
2. 将 format_findings 抽取为共享 references/findings-format.md
3. 通用步骤（读取文档、理解上下文）压缩为一行引用
4. decision_gate 选项列表只出现一次

---

### [HIGH] design-implement 职责边界模糊

**位置**: `src/resources/skills/design-implement/SKILL.md`

**问题**: "方案修订"和"代码实现"是两种根本不同的活动：
- 修订是分析/设计工作（读评审→判断→改文档）
- 实现是编码工作（写代码→跑测试→验证）

将两者合在一个 skill 中导致：
1. skill 的 core_principle 难以统一——"评审是输入不是圣旨"是修订原则，"渐进实现"是实现原则
2. 工作流阶段 2（修订）和阶段 4（实现）之间没有明确的决策门——用户无法在修订完成后、实现开始前做确认
3. 修订可能发现需要重新设计（回退到 design-brainstorm），但此时 skill 已经进入"实现"模式

**影响**: 实际使用中，用户可能只想做修订不想做实现，或者修订后发现需要回退但 skill 流程不支持。

**建议**: 
- 方案 A：拆为 `design-revise`（修订）和 `design-implement`（实现）两个独立 skill，修订完成后生成 prompt 进入实现
- 方案 B：在阶段 2 和阶段 4 之间增加强制 decision_gate，用户确认修订结果后才进入实现

---

### [HIGH] 缺少规模适配机制

**位置**: 全部 5 个 skill

**问题**: 当前设计假设所有任务都走完整的 5-step 流程。但现实中：
- 一行 bug fix 不需要 brainstorming + design review + implementation + code review + fix
- 配置变更不需要方案设计和评审
- 小功能添加可能只需要设计+实现两步

没有任何机制让用户根据任务规模选择简化路径。

**影响**: 简单任务被过度流程化，用户会绕过 skill 直接操作，导致 skill 形同虚设。

**建议**: 在 design-brainstorm 的阶段 1 增加"规模评估"步骤：
- **S 级**（一行改动/配置调整）→ 直接实现，跳过评审
- **M 级**（小功能/bug fix）→ 设计+实现，跳过独立评审
- **L 级**（架构改动/新模块）→ 完整 5-step 流程

---

### [HIGH] "新会话"假设过于刚性

**位置**: 全部 5 个 skill 的 handoff prompt 机制

**问题**: 每个 skill 结尾都生成"请使用以上 prompt 开启新会话"的 handoff prompt，隐含假设：
1. 每一步都必须在新会话中执行
2. 上下文可以完全从文档恢复
3. 中间状态不会丢失

但实际场景中：
- 用户可能想在同一会话中连续执行多步
- 文档可能不包含所有隐式上下文（如代码阅读中的发现）
- 新会话的冷启动成本不低

**影响**: 强制新会话增加摩擦，用户可能选择跳过某些步骤。

**建议**: handoff prompt 改为两种模式：
- **同会话继续**: "如需在同会话继续，直接执行 /design-review"
- **新会话恢复**: "如需在新会话继续，使用以下 prompt..."

---

### [MEDIUM] 文档路径硬编码

**位置**: 全部 5 个 skill 中的文档路径约定

**问题**: 所有文档路径硬编码为 `docs/superpowers/specs/` 和 `docs/superpowers/plans/`。这是 gsd-2 项目特有的路径，不适用于其他项目。

**影响**: 在其他项目中使用这些 skill 时，文档路径需要手动调整。

**建议**: 使用变量占位符如 `{SPECS_DIR}` 和 `{PLANS_DIR}`，在 skill 首次使用时根据项目结构自动确定，或让用户在首次调用时指定。

---

### [MEDIUM] 评审维度可精简

**位置**: design-review 阶段 2 的 7 个评审维度（A-G）

**问题**: 7 个维度中有明显重叠：
- A（需求理解）和 B（方案合理性）的边界模糊——需求理解错误必然导致方案不合理
- C（跳出框架审视）应该贯穿所有维度，而不是独立一个维度
- G（文档完整性）已在 design-brainstorm 的自我审查中覆盖

**影响**: 评审时维度间跳跃，降低评审效率和一致性。

**建议**: 合并为 4 个核心维度：
1. **需求与方向** — 是否解决了正确的问题？是否有更好的方向？
2. **方案合理性** — 技术可行性、架构适配、边界覆盖
3. **实现可行性** — 工期、风险、依赖、可测试性
4. **文档质量** — 完整性、一致性、无歧义

"跳出框架审视"作为贯穿所有维度的评审态度，而非独立维度。

---

### [MEDIUM] code-review 中的 typo

**位置**: `src/resources/skills/code-review/SKILL.md` 第 80 行

**问题**: `n- 主线程阻塞操作` 应为 `- 主线程阻塞操作`（多了一个 `n`）

**影响**: 格式错误。

**建议**: 修正为 `- 主线程阻塞操作`。

---

### [MEDIUM] design-brainstorm 中的 typo

**位置**: `src/resources/skills/design-brainstorm/SKILL.md` 第 137 行

**问题**: `### 下一 步` 应为 `### 下一步`（多了一个空格）

**影响**: 格式不一致。

**建议**: 修正为 `### 下一步`。

---

### [LOW] fix-implement 的 git commit 建议过于笼统

**位置**: `src/resources/skills/fix-implement/SKILL.md` 第 209-211 行

**问题**: `git add .` 会添加所有变更文件，包括可能不相关的文件。`fix: [主题]` 的 commit message 格式过于模板化。

**影响**: 可能提交不相关的变更文件。

**建议**: 改为 `git add <relevant-files>` 并建议参考项目 commit 风格生成 message。

---

### [LOW] 缺少流程总览文档

**位置**: 无

**问题**: 5 个 skill 各自独立，没有一个总览文档说明整体流程、skill 间的关系和跳转规则。fix-implement 的 `<note>` 章节有简要说明，但不够完整。

**影响**: 新用户无法快速理解整体流程。

**建议**: 创建一个 `references/dev-flow-overview.md` 或在某个 skill 中增加流程总览章节。

---

## 跳出框架审视

### 是否有完全不同的更好方案？

**有。** 当前方案是"5 个独立 skill + 文档 handoff"的纯线性流程。替代方案：

**方案 B: 单一编排 skill + 复用现有 skill**

创建一个 `dev-flow` 编排 skill，内部按阶段调用已有 skill：
1. 阶段 1 → 调用已有 brainstorming workflow → 追加文档化输出
2. 阶段 2 → 调用已有 review skill → 扩展评审维度到设计层面
3. 阶段 3 → 直接实现（或调用 writing-plans）
4. 阶段 4 → 调用已有 review skill → 追加设计一致性检查
5. 阶段 5 → 直接修复

**优势**: 不重复实现已有功能，维护成本更低，与生态一致
**劣势**: 编排 skill 的调用机制依赖平台支持，当前可能不完全支持 skill 间的程序化调用

**判断**: 如果平台支持 skill 间调用，方案 B 更优。当前平台限制下，5 个独立 skill 是务实选择，但应尽量引用而非重写已有 skill 的逻辑。

---

## 评审统计

| 严重度 | 数量 |
|--------|------|
| CRITICAL | 2 |
| HIGH | 3 |
| MEDIUM | 4 |
| LOW | 2 |

---

## 推荐修订优先级

**必须修订（合并前）：**
1. 解决 skill 名称冲突（code-review → design-and-code-review 等）
2. 大幅削减冗余（删除/压缩 output_format，抽取共享 format_findings）

**强烈建议修订：**
3. design-implement 增加修订→实现之间的 decision_gate，或拆分为两个 skill
4. 增加规模适配机制（S/M/L 级别）
5. handoff prompt 支持同会话继续模式

**建议修订：**
6. 评审维度从 7 个合并为 4 个
7. 文档路径改为可配置
8. 修正 typo（code-review L80, design-brainstorm L137）
9. fix-implement 的 git 建议更精确
10. 增加流程总览文档
