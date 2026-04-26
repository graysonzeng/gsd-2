# Phase-Discipline preflight 设计 review 续接 handoff
 
 - **日期**：2026-04-26
 - **主仓库**：`/Users/sheng/tencent/gsd-2`
 - **目标**：为 `phase-discipline` 的 auto-mode 设计并落地一个更强的 preflight 机制，在真正进入自动执行前预防更多错误；当前文档记录的是**已定稿的 v1 实现边界**。
 - **当前偏好已确认**：
   - 优先级：**先保运行条件稳定，再补基础需求质量**
   - 处理策略：**分级阻断**（fatal 阻止，warning 继续但提示，advisory 仅记录）

---

## 1. 一句话结论

当前 `phase-discipline preflight` 的真实能力主要仍停留在**模型/provider 可用性检查**，而用户需要的是一套更完整的**启动前运行条件门禁 + 关键相位前轻量复检**。本轮推荐方案为：

 - **L0 启动前总检**
 - **L1 关键 phase 前专项复检**
 - **运行条件优先**，需求质量先做基础弱规则
 - **分级阻断**，避免误杀

 本轮定稿后按该边界实现：保留 `auto-dispatch` 为 authoritative hard stop，仅把高确定性的前置门禁前移到 preflight / pre-dispatch hook。

---

## 2. 本轮已经确认的代码链路

### 2.1 auto-mode 主入口

主入口链路已经确认：

- `src/resources/extensions/gsd/auto.ts`
- `startAuto()`
- `bootstrapAutoSession()` in `src/resources/extensions/gsd/auto-start.ts`

其中 `bootstrapAutoSession()` 是当前 `phase-discipline preflight` 的实际启动前接入点。

### 2.2 当前 preflight 集成点

`bootstrapAutoSession()` 中已有：

- 读取 `loadEffectiveGSDPreferences(base)`
- 调用 `validatePhaseDisciplinePreflight(...)`
- `!ok` 时通过 `ctx.ui.notify(...)` 报错并阻止 auto-mode 启动
- `warnings` 时继续运行但向 UI 发 warning

因此，**现有最佳扩展点仍然是 `validatePhaseDisciplinePreflight()` 所在链路**。

### 2.3 phase-discipline 调度增强链路

已确认 `phase-discipline` 不是单独 runtime，而是基于 preset + hooks + dispatch advice 的调度增强层：

- `src/resources/extensions/gsd/phase-discipline/preset.ts`
  - 定义 `phase-discipline-8step` preset
  - 注入 pre-dispatch hooks / post-unit hooks
- `src/resources/extensions/gsd/phase-discipline/profile-dispatch.ts`
  - `evaluatePhaseDisciplineProfileDispatch()` 根据 phase 顺序给出 advice
- `src/resources/extensions/gsd/auto-dispatch.ts`
  - `honour-phase-discipline-advice` 规则优先消费 advice

结论：

- `profile-dispatch` 更像**运行时纠偏**
- `preflight` 才是**启动前防错**的合适位置

---

## 3. 当前 preflight 的真实边界

### 3.1 已覆盖内容

`src/resources/extensions/gsd/phase-discipline/preflight.ts` 当前主要覆盖：

- provider 是否可解析
- provider 是否 request-ready
- model 是否在 available models 中
- primary model 不可用时 fallback 是否可用
- optional requirement 缺失时是否降级为 warning

### 3.2 明显未覆盖内容

当前 preflight **基本不覆盖**以下类别：

- milestone/context/acceptance/verify 的需求质量
- roadmap / slice plan / task plan 的结构完整性
- phase-discipline 关键 artifact 是否存在、是否足以支持进入下一 phase
- hooks/preset 合并后是否自洽
- 启动时环境虽可启动，但进入某个 unit 必然失败的前置条件缺失

### 3.3 当前系统中已有但不成体系的相关检查

除了 `phase-discipline/preflight.ts` 之外，本轮还确认了几类分散校验：

- `auto-start.ts` 中的 bootstrap 级检查
  - session lock
  - API key / repo / state migration / orphaned branch 等
- `auto.ts` 中 `ensurePreconditions()`
  - dispatch 前的一些目录 / 分支前置条件
- `profile-dispatch.ts`
  - 少量 phase 顺序与 artifact 相关的 advice 逻辑

结论：

- 当前系统**不是完全没有前置检查**
- 但这些检查没有被组织成一套**统一、分级、可复用**的 `phase-discipline preflight` 框架

---

## 4. 这次设计所针对的问题模型

用户本轮明确选择的是：

- **优先运行条件**，不是先做主观需求打分
- **分级阻断**，不是一刀切强阻断

因此，本轮设计应优先预防以下错误：

- **启动即失败类**
  - provider/model 不可用
  - runtime 必需资源缺失
  - preset/hook 配置明显断链
- **进入 phase 必炸类**
  - 没有 plan 却进入 `execute-task`
  - 没有验证/summary/evidence 却进入 `validate-milestone`
  - 没有 validation verdict 却进入 `complete-milestone`
- **低歧义需求缺失类**
  - 里程碑 context 空壳
  - acceptance / verify 完全缺席

不建议第一轮就做：

- 重量级自然语言质量评分
- admission/reviewer 的 prompt 级替代审稿
- 把 `query/status` 也改成共享阻断链

---

## 5. 推荐方案（供 review）

### 5.1 方案比较结论

本轮推荐的是：

- **不是**“只增强启动前一次检查”
- **也不是**“全链路所有路径统一拦截”
- **而是**：**启动前总检 + 关键 phase 前轻量复检**

原因：

- 只在启动前检查一次，无法覆盖运行时状态漂移
- 全链路统一框架当前改动面过大，不利于先交付稳定收益
- `phase-discipline` 本身就依赖 dispatch / phase 结构，因此关键 phase 前轻量复检的收益很高

### 5.2 推荐架构

建议分成三层：

#### L0：Bootstrap Preflight

落点：`bootstrapAutoSession()`

职责：

- 启动 auto-mode 前总检
- 可返回 `fatal / warning / advisory`

#### L1：Phase Guard

落点：dispatch 前，按 `unitType` 做轻量专项复检

重点 unit：

- `plan-slice`
- `execute-task`
- `validate-milestone`
- `complete-milestone`

职责：

- 防止进入一个**前置条件显然不满足**的 phase
- 比当前 `profile-dispatch` 更偏“门禁”，而不是单纯 advice

#### L2：Advisory / Prompt Hint

职责：

- 对不需要阻断的问题做提示
- 可进 UI / audit / prompt context

---

## 6. v1 建议落地的检查项

### 6.1 启动前总检（L0）

建议首批纳入：

- **provider/model readiness**
  - 复用当前已有 `validatePhaseDisciplinePreflight()` 能力
- **profile integrity**
  - `milestone_profile=phase-discipline-8step` 时，preset 合并后的 hooks/model 配置是否基本自洽
- **active milestone basic sanity**
  - 当前 active milestone 是否存在且可解析
- **context presence**
  - `CONTEXT` 或等价上下文 artifact 不应为空壳
- **planning baseline**
  - 若当前状态已进入执行路径，应具备最基本的 planning artifact
- **runtime substrate**
  - DB / worktree / basePath 等已知硬前置若异常，直接 fatal

### 6.2 关键 phase 前复检（L1）

#### before `execute-task`

建议检查：

- active slice plan 存在
- task 可解析
- 若该 phase 已声明依赖特定 artifact，则 artifact 必须存在

#### before `validate-milestone`

建议检查：

- 至少存在 task/slice 层 summary / evidence
- 不是“零执行直接验证”的空跑场景

#### before `complete-milestone`

建议检查：

- validation artifact / verdict 存在
- 若 verify-fuse 启用，则关闭条件满足

### 6.3 基础需求质量弱检查

建议只做低歧义规则：

- context 非空且不是纯模板空壳
- acceptance signal 至少存在一种明确可判定条件
- verification signal 至少存在一种可执行或可观察的验证方式

注意：

- 这里应偏向 `warning/advisory`
- 除非完全缺失，否则不要轻易 fatal

---

## 7. 数据结构与实现建议

### 7.1 不建议继续把所有逻辑都塞进一个大函数

建议保留：

- `src/resources/extensions/gsd/phase-discipline/preflight.ts`

但将其演进为统一入口，而不是唯一实现体。

### 7.2 建议的拆分方向

可以考虑拆成以下内部模块：

- `phase-discipline/preflight-models.ts`
- `phase-discipline/preflight-runtime.ts`
- `phase-discipline/preflight-artifacts.ts`
- `phase-discipline/preflight-requirements.ts`

目的：

- 职责分离
- 便于 phase guard 复用子检查器
- 测试粒度更清晰

### 7.3 结果模型建议

当前结果结构以 `ok / failures / warnings` 为主；下一轮实现建议扩展为更明确的级别体系，例如：

- `fatal`
- `warning`
- `advisory`

并保留：

- `checked`
- `issues`
- `code`
- `detail`
- `source`
- `unitType?`

这样更适合后续：

- 启动前总检
- 相位前专项复检
- UI 文案统一格式化

---

## 8. review 时最值得挑战的点

下一会话如果是做 review，优先挑战这些问题：

### 8.1 L1 phase guard 放在哪里最合适

需要 review 的不是“要不要做”，而是“挂在哪条链路成本最低、语义最稳定”：

- 是 dispatch rule 前统一跑
- 还是在特定 unit dispatch 前插入 guard
- 还是复用现有 pre-dispatch hook 机制承载 gating

### 8.2 `profile-dispatch` 与 `phase guard` 的职责边界

当前 `profile-dispatch` 已在做部分 artifact 检查与 advice；需要 review：

- 哪些逻辑继续保留在 advice 层
- 哪些逻辑应升级为真正的 gate
- 如何避免两边重复检查、提示冲突

### 8.3 “需求质量弱检查”的误报边界

需要 review 的是：

- 哪些规则足够低歧义，适合第一轮进入 preflight
- 哪些规则太主观，应该留在 admission / reviewer / planner

### 8.4 结果结构与文案格式

需要 review：

- 是否保留当前 `formatPhaseDisciplinePreflightFailure()` 风格
- 是否统一成 code-based issue formatting
- warning/advisory 是否需要单独 formatter

---

## 9. 已定稿的实现边界

 本轮实现只覆盖以下内容：

 1. `PhaseDisciplinePreflightResult` 扩展为统一 `issues[]`，并保留 `failures / warnings`
 2. 新增 preset-owned builtin pre-dispatch hook：`phase-discipline-phase-guard`
 3. `phase-guard` 顺序上必须早于 `phase-discipline-profile-dispatch`
 4. `validate-milestone` 与 `complete-milestone` 增加高确定性 L1 guard
 5. `PreDispatchResult` 扩展 `block` action，`runDispatch()` 负责 pause/stop 行为闭环
 6. `auto-dispatch` 既有 hard stop 保持不变，作为最终 authoritative safety net

---

## 10. 下一会话不要做的事

 - **不要**把第一轮实现继续扩张成重量级需求审稿器
 - **不要**把 `profile-dispatch` 改成 hard gate；它仍应保持 advice / reroute 角色
 - **不要**用 L1 guard 取代 `auto-dispatch` 的 authoritative hard stop
 - **不要**把第一轮 preflight 做成重量级需求审稿器
 - **不要**忽略当前系统里已有的 bootstrap / dispatch / profile-dispatch 检查，避免重复造轮子

---

## 11. 给新会话的短 prompt

 ```text
 请接手 phase-discipline preflight v1：已确认实现边界为“L0 启动前总检 + L1 phase-guard 轻量门禁”。L1 挂在 pre-dispatch hook pipeline，使用新的 preset builtin `phase-discipline-phase-guard`，并且顺序上必须早于 `phase-discipline-profile-dispatch`。当前 v1 只做高确定性规则：validate-milestone 前至少要有 task SUMMARY；complete-milestone 前必须有 VALIDATION artifact 和合法 verdict；若 `verify_fuse_on_fail` 命中则 block warning。`PreDispatchResult` 已扩展 `block` action；`auto-dispatch` 既有 hard stop 继续保留为 authoritative net。不要把本轮范围扩张成重量级需求审稿器。
 ```

---

## 12. 当前状态

 - **已完成**：项目结构、主入口、dispatch 链路、现有 preflight 边界梳理
 - **已完成**：设计方向收敛与用户偏好确认
 - **已完成**：v1 实现边界定稿（L0 issues[]、L1 phase-guard、block action、hook 顺序）
 - **已完成**：定向测试覆盖与首轮验证
 - **未完成**：更大范围回归验证

 因此，当前最准确的状态是：

 - `t1` 已完成
 - `t2` 已完成
 - `t3` 进入验证/收尾阶段
