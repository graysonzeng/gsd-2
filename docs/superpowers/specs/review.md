按文档内容
/Users/l/tencent/gsd-2/docs/designs/composed-lite-harness-brainstorm.md
目标：以 main 分支代码为基础，把当前 feat/composed-lite-runtime-owned 分支的 composed-lite 能力进行迁移到 main 分支。然后按 composed-lite-harness-brainstorm.md 文档进行实现。
当前需求：按文档内容做只读分析，如果按文档进行理想情况下的完整实现后，composed-lite 改成 auto-mode 后是否能做完整的固定 workflow 的 ai 自动化 codeing 功能，且能随着 gsd-2 的迭代升级进行更新

# 结论

**短答：可以，但不是“天然完整”，而是“在文档假设全部落地且补上少数 contract 缺口后，可以成为完整的固定 workflow AI 自动 coding 宿主”；并且从可演进性看，`auto-mode` 明显比 `composed-lite` 更适合长期跟随 `gsd-2` 升级。**

我的最终判断是：

- **[宿主替换结论]** 把 harness 宿主从 `composed-lite` 改为 `auto-mode`，方向是对的。
- **[功能结论]** 在“理想完整实现”前提下，**能**做你说的“完整的固定 workflow 的 AI 自动化 coding 功能”。
- **[升级结论]** 也**有条件地能**随着 `gsd-2` 迭代升级持续演进，**前提是把 extension point 和 contract 边界做对**，否则会逐步漂移。
- **[保留意见]** 文档当前并不等于“已经证明可以无痛实现”。它证明的是**架构方向正确**，不是**所有工程边界都闭合**。

---

# 我为什么这么判断

## 1. `auto-mode` 已经更像真正的 harness host，而不是 `composed-lite`

这点文档不是空喊，代码证据是够的。

### 已有的固定 workflow 骨架

`auto-mode` 已经具备你要的“固定流程自动 coding”核心骨架：

- **[状态机调度]** [src/resources/extensions/gsd/auto-dispatch.ts](cci:7://file:///Users/l/tencent/gsd-2/src/resources/extensions/gsd/auto-dispatch.ts:0:0-0:0)
  - 有明确的 dispatch table
  - 按 phase 映射到固定 unit：
    - `research-milestone`
    - `plan-milestone`
    - `research-slice`
    - `plan-slice`
    - `refine-slice`
    - `execute-task`
    - `complete-slice`
    - `validate-milestone`
    - `complete-milestone`
    - `reassess-roadmap`
  - 不是临时 prompt 串联，而是规则驱动的编排

- **[执行循环]** [src/resources/extensions/gsd/auto/loop.ts](cci:7://file:///Users/l/tencent/gsd-2/src/resources/extensions/gsd/auto/loop.ts:0:0-0:0)
  - 主循环是 `derive → dispatch → guards → runUnit → finalize → repeat`
  - 有：
    - 最大迭代保护
    - session lock 校验
    - stuck state 持久化
    - 内存压力保护
    - flow/journal 追踪

- **[单元执行隔离]** [src/resources/extensions/gsd/auto/run-unit.ts](cci:7://file:///Users/l/tencent/gsd-2/src/resources/extensions/gsd/auto/run-unit.ts:0:0-0:0)
  - 每个 unit 新 session
  - 有 session timeout / hard timeout
  - 有 model restore
  - 有 queue flush
  - 这说明它不是“一次长对话撑到底”，而是按 unit 切分执行

### 已有的治理与验证骨架

- **[任务后验证]** [src/resources/extensions/gsd/auto-verification.ts](cci:7://file:///Users/l/tencent/gsd-2/src/resources/extensions/gsd/auto-verification.ts:0:0-0:0)
  - `execute-task` 后有 verification gate
  - 会跑：
    - verification commands
    - runtime errors capture
    - dependency audit
  - 支持 `continue / retry / pause`
  - 对 `validate-milestone` 还有额外 post-check，防止 remediation loop 空转

- **[流程断路/约束]** [auto-dispatch.ts](cci:7://file:///Users/l/tencent/gsd-2/src/resources/extensions/gsd/auto-dispatch.ts:0:0-0:0)
  - escalation 优先阻断
  - UAT gate 阻断非 PASS
  - rewrite attempt cap
  - run-uat attempt cap
  - reactive execution 有 ambiguity fallback

这说明 `auto-mode` 已经不只是“会自动发 prompt”，而是有**固定阶段、固定退出条件、固定恢复逻辑、固定验证点**。  
这正是“固定 workflow 自动 coding”需要的基础。

---

## 2. 文档把“新增设计范围”收窄到 `AGENTS.md`，这个收窄是合理的

文档的核心正确点不是“auto-mode 更强”这种空话，而是它把问题拆开了：

- **[Part A: task decomposition]** 现有
- **[Part B: context assembly]** 绝大部分现有
- **[Part D: knowledge compounding]** 现有
- **[真正缺口]** `AGENTS.md` 这条系统提示词前置注入链没有被 budget / routing 机制覆盖

这个判断我认可，证据也对得上：

- `packages/pi-coding-agent/src/core/resource-loader.ts:57-112`
  - 现在的 `AGENTS.md` / `CLAUDE.md` 是**ancestor walk + full-file slurp**
  - 每层目录 first-match
  - 顺序是 global → ancestor(root→cwd)
  - 没有 section-aware
  - 没有 budget
  - 没有 task-type routing

而 `auto-mode` 现有 context engineering 主要发生在 task prompt 层：

- [context-budget.ts](cci:7://file:///Users/l/tencent/gsd-2/src/resources/extensions/gsd/context-budget.ts:0:0-0:0)
  - [computeBudgets](cci:1://file:///Users/l/tencent/gsd-2/src/resources/extensions/gsd/context-budget.ts:91:0-112:1)
  - [truncateAtSectionBoundary](cci:1://file:///Users/l/tencent/gsd-2/src/resources/extensions/gsd/context-budget.ts:114:0-162:1)

- [auto-prompts.ts](cci:7://file:///Users/l/tencent/gsd-2/src/resources/extensions/gsd/auto-prompts.ts:0:0-0:0)
  - `buildResearchSlicePrompt`
  - `buildPlanSlicePrompt`
  - `buildExecuteTaskPrompt`
  - `inlineGraphSubgraph`
  - carry-forward / resume / runtime inline

- [bootstrap/system-context.ts](cci:7://file:///Users/l/tencent/gsd-2/src/resources/extensions/gsd/bootstrap/system-context.ts:0:0-0:0)
  - [loadMemoryBlock](cci:1://file:///Users/l/tencent/gsd-2/src/resources/extensions/gsd/bootstrap/system-context.ts:227:0-283:1)

也就是说，文档抓到的痛点是准的：  
**现有 harness 够强，但碰不到 loader 先塞进 system prompt 的那部分 `AGENTS.md`。**

---

# 能不能做“完整固定 workflow 自动 coding”

## 我的判断：**能，但要分清“宿主能力完整”和“文档实现完整”**

### 3.1 宿主能力层面：基本已经够

如果你的定义是：

- 能分解任务
- 能分阶段执行
- 能按 slice/task 驱动
- 能带验证闭环
- 能做失败重试/暂停
- 能做记忆注入
- 能控制上下文预算
- 能继续跟 roadmap / milestone 演化

那 `auto-mode` 已经基本满足。

`composed-lite` 相比之下更像：

- 一条更线性的 runtime-owned flow
- 有治理 skeleton
- 但没有 `auto-mode` 这套成熟的 task/slice/milestone harness 生态

所以从“固定 workflow 自动 coding 平台”角度，**宿主切到 `auto-mode` 是正确结论**。

### 3.2 文档实现层面：还差一个关键闭环

文档里新增的 Part C，如果理想实现完成，会补上：

- `AGENTS.md` 从“内容 dump”变成“稳定 preamble + routing table”
- optional sections 按 taskTypeHint 选择
- L1 docs 按需 `read_file`
- 与 memories / graph / knowledge 并存，不重复造轮子

这个补完后，系统在理论上会更接近完整闭环：

- **固定流程编排**：`auto-mode`
- **任务级上下文工程**：`auto-prompts`
- **知识复利**：ADR-013 memories
- **项目静态约束 / 路由图**：`AGENTS.md docs-map`

所以，**理想情况下完整实现后，是可以支撑完整固定 workflow 自动 coding 的。**

---

# 能不能随着 `gsd-2` 迭代升级持续更新

## 我的判断：**可以，但这是“有前提的可以”**

### 有利因素

## 4. `auto-mode` 作为宿主，天然更容易跟随 `gsd-2` 演进

原因有三点。

### 4.1 它本来就在主干演进路径上

`auto-mode` 相关代码量大、集成深，而且是当前主干核心工作流之一：

- [auto.ts](cci:7://file:///Users/l/tencent/gsd-2/src/resources/extensions/gsd/auto.ts:0:0-0:0)
- [auto-dispatch.ts](cci:7://file:///Users/l/tencent/gsd-2/src/resources/extensions/gsd/auto-dispatch.ts:0:0-0:0)
- [auto/loop.ts](cci:7://file:///Users/l/tencent/gsd-2/src/resources/extensions/gsd/auto/loop.ts:0:0-0:0)
- [auto-prompts.ts](cci:7://file:///Users/l/tencent/gsd-2/src/resources/extensions/gsd/auto-prompts.ts:0:0-0:0)
- [auto-verification.ts](cci:7://file:///Users/l/tencent/gsd-2/src/resources/extensions/gsd/auto-verification.ts:0:0-0:0)
- `preferences` / `dispatch` / `worktree` / `metrics` / `journal`

这意味着：

- 主干新能力更可能先接到 `auto-mode`
- bugfix 更可能优先覆盖 `auto-mode`
- 新的 orchestration / verification / gating / telemetry 更容易直接复用

而 `composed-lite` 当前在文档里自己也承认，更像一个 feature-private runtime-owned subtree。

### 4.2 文档 v3.5 选了“extension-only, platform-zero-change”路径

这个选择对**跟随升级**是双刃剑，但总体偏正面。

正面在于：

- 少改 `packages/pi-coding-agent`
- 少碰平台 loader contract
- 降低被上游内部重构波及的面积
- 对开源主干迭代更友好

文档这一点是有自觉的，不是乱拍：

- [packages/pi-coding-agent/src/core/resource-loader.ts](cci:7://file:///Users/l/tencent/gsd-2/packages/pi-coding-agent/src/core/resource-loader.ts:0:0-0:0) 现在 contract 很简单：
  - [getAgentsFiles(): { agentsFiles: Array<{ path, content }> }](cci:1://file:///Users/l/tencent/gsd-2/packages/pi-coding-agent/src/core/resource-loader.ts:31:1-31:76)
- v3.5 明确想避免去扩大它

这对长期演进是好事。

### 4.3 文档也意识到了 `executor_extension` 扩展点必须先稳定

Appendix E 的这个判断我认为很关键，而且是对的：

当前 `composed-lite` 接入 main 的方式，仍有**宿主 special-case** 痕迹：

- [commands/handlers/workflow.ts](cci:7://file:///Users/l/tencent/gsd-2/src/resources/extensions/gsd/commands/handlers/workflow.ts:0:0-0:0)
- [commands-workflow-templates.ts](cci:7://file:///Users/l/tencent/gsd-2/src/resources/extensions/gsd/commands-workflow-templates.ts:0:0-0:0)
- 多处 `if (executorExtension === "composed-lite")`

文档建议先做：

- 统一 `executorExtensionRegistry`
- YAML / markdown / registry loader 对 `executor_extension` 对齐
- [composed-lite/index.ts](cci:7://file:///Users/l/tencent/gsd-2/src/resources/extensions/gsd/composed-lite/index.ts:0:0-0:0) 自注册

这一步如果做了，后续**runtime-owned workflow 扩展点**才是稳定的。  
这是“能随着 gsd-2 升级”的关键前提之一。

---

# 但我要明确泼冷水：这里有几个真实缺口

## 5. 最大风险不是“能不能跑”，而是“contract 会不会漂移”

这是你问题里最容易被忽视的点。

### 5.1 `AGENTS.md` 双路径语义漂移风险

当前真实情况是：

- system prompt 路径：
  - `pi-coding-agent` 的 [loadProjectContextFiles()](cci:1://file:///Users/l/tencent/gsd-2/packages/pi-coding-agent/src/core/resource-loader.ts:74:0-111:1) full slurp

- 文档 v3.5 方案：
  - extension 侧再做一个 `loadAgentsSection(name)`

这意味着会出现**两套读取语义**：

- 同样的 ancestor walk
- 同样的 `AGENTS.md` / `CLAUDE.md` precedence
- 同样的 mixed chain
- 同样的 stop condition

只要未来平台 loader 稍有变化，而 extension 侧 helper 没同步，你就会出现：

- system prompt 看到的是 A
- task prompt 选 optional section 时按的是 B

这种漂移不会立刻报错，但会慢性腐烂。

**所以我的判断是：**
如果没有 golden tests 去强绑这两个 walker 的行为，  
那“能随着 gsd-2 升级更新”这句话就是假的。

### 5.2 文档内部仍有旧表述残留

你也该警惕这个：

- 文档标题/前言说 v3.5 选了 candidate C
- 但中段还有旧的 dual-path / platform-side 说法残留
- 风险段也还有 loader enforcement 风格遗留

这说明文档虽然方向对，但**还没完全收敛为单一实现叙事**。  
如果直接按它开工，不先做一次 contract 清洗，后面一定有人理解错。

### 5.3 “固定 workflow”不等于“永远不需要人工治理”

文档提到：

- Routing Rule promotion 走 `extract-learnings`
- `AGENTS.md` 是 human-authored
- lint/CI enforce cap
- 不允许 agent 直接写 `AGENTS.md`

这是对的，但也意味着：

**这个系统本质上是“agent + deterministic contract + human governance”的自动 coding**，  
不是“完全自生长的自治系统”。

如果你心里想的是“以后它会自己随着 gsd-2 更新而自动适配”，那你想多了。  
**它能演进，但前提是 contract、lint、golden tests、migration guide 这些治理面也一起演进。**

---

# 我对你的问题的直接回答

## 6. 直答版本

### 是否能在理想完整实现后，改成 `auto-mode` 来做完整固定 workflow AI 自动 coding？

**能。**

理由：

- `auto-mode` 已具备完整 workflow 的主要编排能力
- 已有 task decomposition / prompt budgeting / graph context / memory injection / verification / recovery
- 文档新增的 Part C 只是在补 `AGENTS.md` 这个静态项目知识入口
- 所以宿主改成 `auto-mode` 后，整体架构是闭合的

### 是否能随着 `gsd-2` 的迭代升级进行更新？

**能，但前提非常明确：**

- 先把 runtime-owned workflow 的扩展点稳定化
  - 尤其是 `executor_extension` 的统一注册机制
- 给 `AGENTS.md` extension-side helper 和 platform loader 之间补**强一致性测试**
- 把 docs-map v1 的 contract matrix 真正当成“版本化契约”维护，而不是讨论稿 prose

如果这三件事不做，答案就会从“能”退化成“短期能，长期会分叉”。

---

# 我给你的保守结论

## 7. 最严谨的一句话

**按这份文档的理想完整实现，`auto-mode` 可以成为比 `composed-lite` 更完整、更适合作为长期宿主的固定 workflow AI 自动 coding 系统；但它的长期可升级性不取决于 docs-map 本身是否聪明，而取决于你是否把“扩展点统一 + AGENTS 双路径一致性 + contract 版本治理”做成硬约束。**

---

# 你当前思路里的潜在漏洞

- **[漏洞 1]** 你把“宿主换成 auto-mode”与“feat 分支迁移到 main”默认绑定了。  
  实际上这两个问题应该拆开：
  - 宿主架构是否正确
  - 迁移扩展点是否稳定  
  前者现在证据更强，后者还需要专门 migration contract。

- **[漏洞 2]** 你问“理想情况下是否可行”，这会天然掩盖升级漂移问题。  
  真正该问的是：
  - **哪些 contract 必须版本化，系统才配叫长期可演进？**

- **[漏洞 3]** 你可能高估了 docs-map 对“自动 coding 完整性”的贡献。  
  docs-map 很重要，但它只是**项目静态知识入口优化**，不是 workflow 完整性的核心来源。  
  真正核心还是：
  - dispatch contract
  - state machine
  - verification loop
  - recovery / pause / retry
  - artifact / state consistency

---

# 跳出你当前框架的一条建议

- **[建议]** 如果你后续要继续做只读评审，下一步最值得做的不是继续讨论 docs-map 细节，而是专门做一份**“固定 workflow contract 清单”**，只列这些东西：
  - unit types
  - dispatch preconditions
  - artifact expectations
  - verification semantics
  - pause/retry/stop semantics
  - extension-point contracts
  - compatibility invariants

这样你以后判断“能否跟随 gsd-2 升级”时，就不是看文档 prose，而是看**这些 contract 有没有被破坏**。

---

# 完成状态

- **[已完成]** 按文档和当前代码做了只读分析
- **[已回答]** 是否能以 `auto-mode` 实现完整固定 workflow 自动 coding
- **[已回答]** 是否具备随 `gsd-2` 迭代升级的条件
- **[未做]** 没有修改任何代码、没有执行任何命令、没有做迁移方案落地

如果你要，我下一步可以继续只读给你输出一版更硬的东西：

- **选项 A**：`auto-mode` 作为固定 workflow 宿主的**必要 contract 清单**
- **选项 B**：从 `feat/composed-lite-runtime-owned` 迁移到 `main` 前，必须先补齐的**扩展点稳定化检查表**
- **选项 C**：对这份设计文档本身做一次**自相矛盾/未闭环点审计**
