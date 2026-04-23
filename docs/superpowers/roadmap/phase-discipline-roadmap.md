# Phase-Discipline Roadmap (anti-over-engineering edition)

> 本文档是对 `docs/superpowers/specs/phase-discipline-preset.md` v7.1、
> `docs/superpowers/specs/README.md` 以及对应 plan/review 的**路线图层**整合，
> 不新增任何 spec 决策，不替代 spec。
>
> 编写纪律：
>
> - Evidence-first，不做 architecture-first
> - 每一条“下一步”必须指向可验证的信号或可退出的开销
> - 明确禁止 v1.4 之前讨论平台化 / 第二 runtime / 通用 plugin framework
>
> **Authority**：纪律层以 `docs/superpowers/discipline.md` 为准；
> 本文件是 snapshot / 节奏层，若与 `src/` 或 accepted spec 冲突须按 `discipline.md` D11 修正。

## 0. Scope

- 适用对象：`phase-discipline` 条线 + 其在 `auto-mode` 上的落地
- **不适用**：`gsd-2` 主线调度器演进、CLI 通用能力演进
- 生效版本假设（执行前需核验）：`PR-1 / PR-2 / PR-3a / PR-4` 已合并 `main`；`PR-3b` 待执行

## 1. 现状快照

> **Freshness**：本章节是对 `src/` 的只读核验结果，非承诺。
> 若与当前 `src/` 或 accepted spec 冲突以代码为准（见 `discipline.md` D11）。

### 1.1 Verified in `src/` (last re-verify 2026-04-24)

- `PreDispatchHookConfig.action` / `PreDispatchResult.action` 已包含 `"advise"`
  （`src/resources/extensions/gsd/types.ts:419,438`）
- `rule-registry.ts` 已处理 `hook.action === "advise"`
  （`src/resources/extensions/gsd/rule-registry.ts:325`）
- `auto-dispatch.ts` 已落 `honour-phase-discipline-advice` prefix rule
  （`src/resources/extensions/gsd/auto-dispatch.ts:220`）
- `auto/phases.ts` 已实现 advisory 二次 dispatch 路径
  （`src/resources/extensions/gsd/auto/phases.ts:984`）
- `shared-harness/` 边界测试存在
  （`src/resources/extensions/gsd/tests/shared-harness-boundary.test.ts`）
- `main` 未含 `composed-lite/` 运行时目录（0 文件）
- `feat/composed-lite-runtime-owned` 仍是 Lab

### 1.2 Open residue (still missing on `main`)

- `preferences-validation.ts` 仍把 `pre_dispatch_hooks.action` 合法值写死为
  `modify|skip|replace`，拒绝 `advise`
  （`src/resources/extensions/gsd/preferences-validation.ts:498,524-525`）
- `GSDPreferences.milestone_profile` 字段尚未存在
- `phase-discipline/` extension 代码未落地
  （preset / merge / profile-dispatch / reviewer-hook / findings-carry 均缺）
- OQ backlog（见 spec §15）尚未执行
- 无真实 milestone 运行 8-step preset 的证据

## 2. v1 基座 — 当前正在收口

- **已在 `main` 的接线**：`advise` runtime path（types + rule-registry + auto-dispatch + auto/phases）
  与 `shared-harness/` 边界测试——见 §1.1，不再作为 PR-3b 的 blocker
- **剩余 residue（在 PR-3b 内闭合）**：
  - `preferences-validation.ts` 接受 config-authored `action: "advise"`
  - `GSDPreferences.milestone_profile` 字段
  - `phase-discipline/` extension 消费层（preset / merge / profile-dispatch / reviewer-hook / findings-carry）
  - 任何在 PR-3b pre-flight 新发现的 `STATE.md` 通道 / pre-dispatch 多 hook 合成 /
    post-unit bridge ↔ cycle/retry 交互边界问题
- **准入**：以上 residue 全部在 PR-3b 内收口；本文件不替代 PR-3b pre-flight 当权威清单
  （权威 pre-flight 见 `docs/superpowers/plans/2026-04-23-pr-3b-phase-discipline-preset-b-min-skeleton.md`）
- **验收**：PR-3b 落地后执行 v1 集成验收（测试 → lint/typecheck → build → 真实 milestone smoke run）

## 3. v1.1 ~ v1.4 Recommended Capability Migration DAG

> **v1 baseline 限制提醒**（spec §1 明确声明）：
> v1 不是 composed-lite parity；**strict gating 仅限 P4→P5**；
> P0/P1/P2/P3/P5/P6 均为 soft-gated（advisory only，auto-dispatch 可 override）；
> P7 为 out-of-band。期待 composed-lite 级别纪律的用户需等待 v1.4。

> 不是阶梯，是 DAG。按 kernel risk ascending 给出默认顺序，
> 但**不要求串行**。真正的强顺序只出现在 v1.2。

### 3.1 依赖与并行性

| 版本 | 主要行为变化 | 新 kernel delta | 可并行性 |
|---|---|---|---|
| v1.1 Admission | post-unit hook + checklist artifact | 无 | 与 v1.3 / v1.4 可并行 |
| v1.2 Scout fan-out | `PreDispatchHookConfig.action: "fan-out"` + scout merge | **有（唯一）** | 独立 track，不与其他版本合并 |
| v1.3 Impl-plan validator | `gsd_plan_slice` schema 收紧 + validator hook | 无（schema 层） | 与 v1.1 / v1.4 可并行 |
| v1.4 Verify-fuse | `verify_fuse_on_fail?: boolean` + milestone close gate | 无（preference 层） | 与 v1.1 / v1.3 可并行 |

### 3.2 依赖分层（通用模板）

- **Layer 1 能力逻辑**：可早于 PR-3b 同步 / 清洗 / 测试
- **Layer 2 hook adapter**：若需 reviewer-core（如 code-review / design-review）则依赖 `shared-harness/`（PR-2）；
  若为纯 post-unit hook（如 Admission checklist + `retry_on`）则**不依赖** PR-2
- **Layer 3 preset wiring**：依赖 `milestone_profile` + preset merge → 即 PR-3b

**结论**：Layer 1 可并行；Layer 2 视实现形态而定；Layer 3 必须 PR-3b 之后。

### 3.3 每版的主要风险要点

- **v1.1**：checklist 空洞化 / 直接照搬 composed-lite 文案
- **v1.2**：成本放大 / 结果冲突 merge 规则 / reviewer fan-out 与 scout fan-out 过早共享抽象
- **v1.3**：schema 一次收得过死 / 字段只要“存在”不要“质量”
- **v1.4**：默认开太早 / 上游输入质量不足时放大噪音失败

### 3.4 每版的退出信号

- 单元测试 + 集成测试通过
- 至少 1 个真实 milestone 跑过该能力并留下 artifact
- 观测面上能看到该版本的 cost / retry / block 信号（见 §6）

## 4. v1.4 之后 — `Post-Parity Evidence Window`

> **明确撤回**前版本草稿里的
> `v2 Unified Policy Runtime` / `Harness Control Plane` / `契约归一 policy runtime` 等命名。
> 原因：spec §0 rejected list / spec §14 Alternatives 已表态反对平台化运行时层。

### 4.1 目标

- 闭合 composed-lite → auto-mode 的能力迁移
- 退役 Lab
- 积累真实使用证据
- **推迟**所有“平台化 / 抽象归一”决策直到 evidence 足够

### 4.2 必做动作

- **Parity Close-out**（对齐 spec §12 步骤）
  - 归档 `feat/composed-lite-runtime-owned` 为 tag `composed-lite-lab-final`
  - 删除该分支
  - 清理 `main` 上 composed-lite-as-template 的 dispatcher 特殊分支
  - `audit-log.ts` 视情况 graduate 到 `shared-harness/` 或一并删除
- **OQ backlog 按 evidence 逐条推进**（见 §8）
- **观测面持续完善**（见 §6）

### 4.3 不做（硬禁止）

- 统一 policy runtime
- harness control plane
- 通用 phase plugin framework
- 第二 runtime / scheduler fork
- 新增 main 侧持久化状态面
- 引入 `SHARED_HARNESS_API_VERSION` 或类似运行时协议

### 4.4 触发“重新评估是否需要更强抽象”的条件

只有以下任一 evidence 成立，才允许重启平台化讨论（以下为示例性 heuristic，非硬性阈值）：

- OQ-3 / OQ-9 等连续在多项目出现**相同模式**的残余痛点
- 多版能力之间出现多次真实可复现的语义冲突
- Lab 已退役且有充分的真实 milestone 运行数据支撑

未触发前，禁止立项 v2。

## 5. 升级兼容性约束（跟随 `gsd-2` 主线）

### 5.1 保持 friendly 的硬约束

- `phase-discipline/` 仅依赖稳定扩展面：`post_unit_hooks` / `pre_dispatch_hooks` / `preferences`
- `profile-dispatch.ts` 只输出 `advise`，不接管 scheduler
- main-side footprint 维持在“薄契约 + 小 preference 面”
- 不扩展顶层 state schema（`STATE.md` / `SLICE-STATE.json` 等）

### 5.2 每版必过的 Upstream Compatibility Scorecard

- Kernel touch count：目标 0
- main-side touched files / LOC：目标 < 5 files / < 100 LOC（heuristic，基于 spec §11 估算）
- New persistent state surfaces：0
- Need for versioned runtime protocol：No
- Expressible via existing hook/advice interfaces：Yes

以上为设计目标值；显著偏离时应回审设计。

### 5.3 双向风险

- **我方**克制是必要条件，不是充分条件
- **上游**仍可能动 `PreDispatchResult` / `rule-registry.ts` / `auto-dispatch.ts`
- 这三处应定期巡检 upstream churn，一旦有显著变化，`profile-dispatch.ts` / `merge.ts` / `shared-harness/reviewer-core.ts` 需跟随适配

## 6. 观测面（必须先于 v1.1 或并行）

不做以下观测，前 4 版无法量化评估，也无法支撑 §4.4 的触发条件。

- **OQ-7** hook-level cost metrics 接入 `UnitMetrics`
- **OQ-10** reviewer stdout/stderr 捕获
- **R-12** `.phase-discipline/` 目录膨胀监控
- 真实 milestone 的 run log 至少保留一个滚动窗口

## 7. Lab 纪律

- `feat/composed-lite-runtime-owned` 自 v1 基座 PR-3b 落地后进入 **freeze 模式**
- freeze 模式允许：bug fix、与 `shared-harness/` 同步
- freeze 模式禁止：新增能力、新增 phase、新增 state
- v1.4 能力等价达成后立即退役（spec §12 步骤）

## 8. OQ backlog（evidence-gated 执行顺序）

按“最可能最先产生真实 evidence”排序：

- **OQ-4** `reviewer_model_fallbacks`（很可能最先需要，补丁级）
- **OQ-7 / OQ-10** 观测面（前置条件）
- **OQ-13** *(review-proposed, 未正式收录于 spec §15)* `GSD_COMPOSED_LITE_*` → `GSD_SHARED_HARNESS_*` 命名债（低风险长期清理）
- **OQ-11** reviewer docs-map L1 继承
- **OQ-8** CI lint `mergePresetIntoHooks` dry-run
- **OQ-12** 每 milestone profile 可选
- **OQ-5 / OQ-6 / OQ-9 / OQ-3** 纯 evidence-gated，不做预判

## 9. 显式撤回项（前版本草稿中不再采纳）

- “v1.1~v1.4 是软→硬治理阶梯”这种叙事
- “v2 Unified Policy Runtime”
- “Harness Control Plane”
- “契约归一 policy runtime 作为下一计划主线”
- “每版只引入一个主要行为变化”对 v1.2 不成立的断言

## 10. phase-discipline 条线的 immediate next step

1. 收口 PR-3b plan 的 blocking residue
2. 执行 PR-3b
3. 完成 v1 集成验收
4. 启动观测面（OQ-7 / OQ-10）与 `OQ-4` 补丁
5. 按 §3 DAG 选择下一块能力迁移（v1.1 / v1.3 / v1.4 任一可并行；v1.2 单独 track）

## 11. 变更记录

| Version | Date | Summary |
|---|---|---|
| v0.1 | 2026-04-23 | 首版，基于对 v1 基座 / 升级兼容性 / v2 命名撤回 / OQ 排序的综合 review |
| v0.2 | 2026-04-23 | Review-response 修订：§0 PR 状态改为执行假设；§2 补 validator residue 例外；补 v1 baseline 限制标注；§3.2 修正 Admission 依赖；§4.4 数字降为 heuristic；§5.2 scorecard 降级；OQ-13 标注 review-proposed |
| v0.3 | 2026-04-24 | Review-response 精简修订：§1 拆分为 1.1 verified / 1.2 open residue（经 `src/` re-verify，`advise` runtime 路径已落地）；§2 去除已闭合的 blocking residue 项，改以 PR-3b pre-flight 为权威；§10 标题去绝对化；顶部补 DISCIPLINE authority 引用 |
