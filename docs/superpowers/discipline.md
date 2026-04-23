# Superpowers Discipline

> 本文件把 `docs/superpowers/specs/*` 与 `docs/superpowers/plans/*` 里
> 已经反复出现、已在评审中沉淀的**硬纪律**集中到一处。
>
> 它不是 spec，不是计划，也不引入新决策。它只做两件事：
>
> 1. 把已有纪律**去重、收紧、可引用化**
> 2. 让后续 spec / plan / review / roadmap 只需**引用**，不必每次重新写
>
> 若本文件与 source spec / approved plan 存在偏差，**以 source 文档为准**，本文件需跟随修正。

## 0. 适用范围

- 适用：`docs/superpowers/` 下的所有产物（specs / plans / reviews / roadmap）
- 适用：`src/resources/extensions/gsd/` 下 `composed-lite` / `shared-harness` / `phase-discipline` 相关改动
- 不适用：`gsd-2` 主线调度器 / CLI 通用能力的独立演进（但改动它们的 PR 需要另行评估）

## 1. 硬纪律

### D1. Evidence-first，禁止 architecture-first
- 任何“抽象 / 平台化 / 新 runtime / 新运行时协议”的提案，必须先给出
  可验证的 evidence（spec §15 要求每条 OQ 写明 `Evidence needed: …`）
- capability parity 等二进制可验证条件优于时间触发（spec §12 取消 v6 的 T1/T2/T3）
- pre-flight 与 readiness gate 必须对 `src/` 实证核验，不对 `dist/` / 文档断言
  （spec §9.0 两次纠偏）

### D2. Rejected / Deferred 列表

**Rejected entirely**（非经新证据 + 评审通过不得翻案）：
- 任何新的 `auto-mode` overlay 层 / `OVERLAY-STATE.json` sidecar（spec §0）
- 任何 `--phase-discipline` CLI flag（只允许 preference 面）（spec §0）
- 任何 `RuntimeOwnedExecutor` 接口泛化（spec §0）
- `composed-lite` 运行时作为平行 main 入口（spec §0）
- 新 `reviewer_model?` 字段（复用现有 `model?`）（spec §0）
- `SHARED_HARNESS_API_VERSION` 运行时版本协议（spec §0）
- docs-map candidate C / D（docs-map spec §2）
- 显式 `.review-overrides.md` 评审否决机制（spec §14 OQ-9）

**Deferred to v2**（不在当前 scope，待 evidence 后再评估）：
- docs-map candidate A（loader truncation）（docs-map spec §2）
- docs-map candidate E-H（各类 capability-driven / override / loader-branch 变体）（docs-map spec §2）

Rejected 项翻案须在本文件补"新证据条目"并评审通过；Deferred 项按 evidence 自然推进。

### D3. 模块边界 (scope guard) 不可越界
- `shared-harness/*` 永远**不 import** `../composed-lite/` / `../phase-discipline/`
  （spec §3.4 + PR-2 boundary test，`non-negotiable`）
- `docs-map` 为 extension-only；平台 `resource-loader.ts` **不改**（docs-map C13）
- `phase-discipline/` **extension-side** 不新增 unit type / DispatchRule / CLI command
  （spec §3.4 “no new unit type, no new DispatchRule, no new CLI command”）
- main-side additive consumer glue（例如 `honour-phase-discipline-advice` prefix rule，
  `src/resources/extensions/gsd/auto-dispatch.ts:220`）必须单独 spec + 评审，不归此条

### D4. Kernel / main-side 克制
- 所有 kernel 改动必须 **additive**；legacy 调用 byte-identical
  （Δ-K1 设计原则；spec §11 多处强调）
- `main` 侧 footprint 目标值（heuristic，非硬限制）：**< 5 files / < 100 LOC**
  （来源：spec §11 估算 4 files × ~80 LOC；作为设计参考，非 gate 条件）
- **在 v1 baseline / PR-3b scope 内**不扩展 `STATE.md` / `SLICE-STATE.json` / `preferences` 顶层，
  仅允许单一枚举面 `milestone_profile`；超出此 scope 的顶层新字段须单独 spec + 评审

### D5. PR 必须守 scope，漂移即停
- 每个 PR 必须列
  - Files that must change
  - Files intentionally out of scope
  - 行数 / 文件数 budget
- Scope drift 不得“顺手修”。必须使用当前 PR plan 中定义的固定 halt 文案
  （具体文案见各 `docs/superpowers/plans/` 对应 plan 文件）
- 下游 PR **禁止**在自己分支里“顺手补”上游未完成的依赖
  （PR-3b plan Hard dependency gate）

### D6. Readiness gate 必须 real-code verified
- 任何“依赖已落地”的断言必须通过 `grep`/`rg` 对真实 `src/` 核验
- README.md `Implementation sequencing hard constraints` 的 No-Go 清单是
  **prescriptive, not advisory**
- `composed-lite-harness-brainstorm.md` 已 **superseded**，不得作为实现依据

### D7. 反过度抽象（反“第二 runtime / 平台化”）
- 禁止把任何 phase-discipline 能力泛化成 generic hook plugin framework
  （PR-3b plan Task 4 Step 3 的固定 halt 文案）
- 在 capability parity 闭合 + 充分 evidence 之前，禁止立项以下方向：
  - "第二 runtime / scheduler fork"
  - "control plane / policy runtime"
  - "runtime version protocol"
- 上述禁令是 evidence-gated，非永久封死；解锁条件见 roadmap §4.4
- 优先选择：**窄桥接、薄契约、advisory 而非 override**

### D8. 测试与验证纪律
- **TDD**：先写 failing test，再实现
- 模块边界使用**结构性 boundary test**，不依赖 ESLint
- preference 采用**两阶段 schema 校验**（raw → merged）
- reviewer 子代理一律 `--no-session --tools read`
- 对**实际改动**必须走完：测试 → lint/typecheck → build → 功能验证

### D9. 文档卫生
- 每份 spec 必含：
  - 标题带版本号
  - `> **Origin**` provenance 块
  - `## 0. Summary & scope` 含 “what we build / what v1 does NOT cover / rejected entirely”
  - `## N. Change log`
- 跨 spec 引用使用**仓库绝对路径** `docs/superpowers/<...>.md`
- 单文件单职责：spec / plan / review / roadmap 四类不混写
  （roadmap 层引入后，纯路线图内容不再塞进 spec）
- 本条 D9 仅规范 **spec** 的最低结构；plan / review / roadmap 的最低结构约定另行规定，
  不在本文件 scope

### D10. Lab 纪律与升级兼容
- `feat/composed-lite-runtime-owned` 仅为 Lab，非 main 着陆目标
- Lab **freeze 模式**（v1 基座 PR-3b 落地后生效）：
  - 允许：bug fix / 与 `shared-harness/` 同步
  - 禁止：新增能力、新增 phase、新增 state
- `v1.4` capability parity 达成后立即退役（spec §12 步骤）
- 升级兼容：仅依赖稳定扩展面（`post_unit_hooks` / `pre_dispatch_hooks` /
  `preferences`），advisory 不 override scheduler
- upstream churn 巡检点：
  `rule-registry.ts` / `auto-dispatch.ts` / `PreDispatchResult`

### D11. 文档新鲜度
- 当 `src/` 或 accepted spec / approved plan 的变更影响本文件或
  `docs/superpowers/roadmap/*` 条目时，必须在同一 PR 或紧随其后的文档修订中同步更新
- roadmap 的 “现状快照” 章节必须带 `last re-verify YYYY-MM-DD` 标签
- 任何引用 `src/` 位置（文件路径 + 行号）的断言在超过 30 天未 re-verify 时视为 stale，
  读者须以代码为准

## 2. 新提案自检 checklist

任何新 spec / plan / roadmap 立项前，至少过一次：

- **E1** 是否有可验证的 evidence，而非架构直觉？
- **E2** 是否未触碰 §1.D2 Rejected 清单？若触碰，是否已写“新证据条目”？
- **E3** 是否未越过 §1.D3 模块边界？
- **E4** main-side footprint 是否落在 Scorecard 约束内？
- **E5** 是否列出 `Files intentionally out of scope` + 行数预算？
- **E6** 是否只依赖稳定扩展面，不引入新 runtime / 版本协议？
- **E7** 是否没有泛化成“通用平台 / 第二 runtime”？
- **E8** 是否具备 TDD / boundary test / 两阶段校验的测试策略？
- **E9** 是否按 §1.D9 结构撰写？
- **E10** 是否明确了 Lab 影响与升级兼容影响？

任一项 No，必须先修正再提交评审。

## 3. “必须停”的触发信号

以下任一信号出现，**立即停止实施**并按对应 halt 文案回报：

- PR diff 出现 locked scope 之外的文件 → 对应 PR 的 halt 文案
- 实现压力要求“顺便做成通用 hook plugin framework” → PR-3b halt 文案
- Pre-flight grep 发现 readiness gate 未达成 → 停工，回到依赖 PR
- 某个 main-side 改动要求扩展顶层 state schema → 停工，回评审
- 某个改动要求引入 runtime version protocol → 停工，回评审
- 某个改动要求平行 main 运行时 → 停工，回评审

## 4. 与 roadmap 的关系

- 本文件定义**纪律（不变）**
- `docs/superpowers/roadmap/*` 定义**节奏（随 evidence 变化）**
- `docs/superpowers/specs/*` 定义**契约（按版本迭代）**
- `docs/superpowers/plans/*` 定义**单次实施路径**
- `docs/superpowers/reviews/*` 定义**对已发生改动的评估**

若本文件与 source spec / approved plan 冲突，**以 source 文档为准**；
本文件需跟随修正。新 spec/plan 引入的纪律变更应同步更新至本文件。

## 5. 变更记录

| Version | Date | Summary |
|---|---|---|
| v0.1 | 2026-04-23 | 首版；从 specs/plans/reviews 中梳理 10 条硬纪律 + checklist + halt 信号 |
| v0.2 | 2026-04-23 | Review-response 修订：反转优先级（source spec/plan 优先）；D2 拆分 rejected/deferred；D4 降为 heuristic；D5 halt 文案改引用；D7 改为 evidence-gated；D10 freeze 时间修正；补 source mapping appendix |
| v0.3 | 2026-04-24 | Review-response 精简修订：D3 区分 extension-side / main-side DispatchRule 约束；D4 顶层禁令收窄到 v1 baseline / PR-3b scope；D9 明确仅规范 spec 结构；新增 D11 文档新鲜度；Appendix A 补 D11 source |
| v0.4 | 2026-04-24 | 重命名 `DISCIPLINE.md` → `discipline.md`：避免全大写冒充仓库根级宪章的视觉信号，与同目录其他 kebab-case 文档对齐；同步更新 roadmap authority 引用与 Appendix A 自指 |

## Appendix A. Source Mapping

| 条目 | Source 文档 | 章节 |
|---|---|---|
| D1 | `specs/phase-discipline-preset.md` | §15 OQ format, §12 (T1/T2/T3 取消), §9.0 |
| D2 Rejected | `specs/phase-discipline-preset.md` | §0 Rejected entirely |
| D2 Rejected (docs-map) | `specs/2026-04-23-agents-md-docs-map-v1.md` | §2 Candidate C/D |
| D2 Deferred | `specs/2026-04-23-agents-md-docs-map-v1.md` | §2 Candidate A/E-H |
| D3 | `specs/phase-discipline-preset.md` | §3.4 boundary; docs-map spec C13 |
| D4 | `specs/phase-discipline-preset.md` | §11 (footprint estimate), §3.1a (additive) |
| D5 | `plans/2026-04-23-pr-3b-*.md` | scope guard / halt 文案 |
| D6 | `specs/README.md` | No-Go list; §9.0 readiness gates |
| D7 | `specs/phase-discipline-preset.md` | §0, §14 Alternatives |
| D8 | `specs/phase-discipline-preset.md` | §10, §3.2.1 validation order |
| D9 | 各 spec/plan 格式惯例 | — |
| D10 | `specs/phase-discipline-preset.md` | §12 capability migration, §11 upgrade |
| D11 | — （本次 review-response，对应 `src/` 实证与 `discipline.md` §4 authority） | — |
