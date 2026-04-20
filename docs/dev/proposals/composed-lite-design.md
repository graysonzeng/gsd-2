# Proposal: composed-lite on GSD-2 — 修订版设计文档 (Revision 2)

| Field | Value |
|---|---|
| Status | **Draft / Revision 2 — hardened after independent anti-drift review** |
| Target | GSD-2 `main`, feature branch `feat/composed-lite-mvp` |
| Scope | MVP — `full` 模式（Phase 0-7） + `plan` 模式（0-3+7） |
| Source | `/Users/sheng/.claude/skills/composed-lite` (Claude Code skill, v2026.04) |
| Revision basis | (1) v1 code review；(2) 与用户对齐的 anti-drift 互动 brainstorm；(3) 两个独立子 agent 的 anti-drift/平台契约审查 |
| Date | 2026-04-20 |
| Out of scope (MVP) | workflow phase hook 平台化 · temp workspace 自动隔离 · enforcement hooks · compact checkpoints · `/gsd cl` 短别名 · 完整 artifact 父依赖 Merkle 链 · CLI 交互式 reviewer（codex/claude/gemini CLI）· multi-dimensional reviewer capability probe |

---

## 0. TL;DR (Revision 2)

**一句话：** composed-lite 作为 `runtime-owned` workflow 落在 GSD extension 内部（不是新顶层 extension），MVP 只动两处平台接口（`executor_extension`、`modelOverride`），其余所有反漂移能力由 composed-lite runtime 以代码契约方式强制执行。

**与 v1 相比，Rev 2 的本质变化：**

1. **反漂移从"靠 prompt"升级为"靠 runtime 代码契约"**。十条 Anti-Drift Contracts 提升为一级章节（§13），每条都绑定代码位置与验证手段。
2. **Reviewer 硬闸门：严格跨 provider，失败即 fuse。** 删除 `fallback_self_review` 作为"静默兜底"的路径；字段保留为 env-var 后门的审计痕迹（默认 false，逃生开关需要用户显式打开并被写入审计日志），且必须对应独立的 `fuse_reason` 或 `audit flag`。
3. **Admission 变成显式状态机**：`pending → evidence_collected → awaiting_approval → approved/rejected`；`approved` 态生成 `admission_hash` (SHA-256)，后续所有 phase 的 artifact envelope 必须 include 这个 hash 作为锚点。
4. **Artifact 全部经过 `ArtifactEnvelope`**：强制携带 `run_id`、`attempt`、`phase`、`producer_kind`、`producer_id`、`provider`、`model`、`input_hash`、`raw_log_hash`、`output_hash`、`admission_hash` 和父 artifact 的 hash 引用（MVP 仅要求紧邻前序 phase 的 hash）。
5. **Recovery 基于 hash/attempt/run_id**：不再"artifact 存在且能 parse 就算完成"；hash 不匹配或 run_id 不一致则该 phase 必须重跑。
6. **Verification 由 runtime 直接 spawn**：测试/构建/lint/typecheck 由 `verification-runner.ts` 调用 `child_process.spawn` 捕获真实 stdout/stderr/exitCode；`verification-report.md` 由 runtime 组装，reviewer 只读（不能"叙述"结果）。
7. **Git diff 为 truth source**：Phase 4 完成判定依赖 `git diff --numstat` 的真实变更（非注释、非空白、非仅格式），而不是 agent 自我报告 "implemented"。
8. **Audit log 成为硬 schema 并带 hash 链**：`.gsd/composed-lite/logs/audit-<run_id>.jsonl`，每行都有 `seq / prev_digest / entry_digest`，Phase 7 会读取并做 drift 检测（例如 `phase_exit completed` 必须存在对应的 `subagent_call` 和 `reviewer_verdict`）。
9. **新增 `.gsd/STATE.json` marker**：单行 projection，指向 `.gsd/composed-lite/state.yaml`，以保持 `/gsd status` / `/gsd resume` 可发现；`state.yaml` 仍然是唯一 source of truth。
10. **新增 run lock**：`.gsd/composed-lite/run.lock` (pid+ts)，防止并发两个 runtime 同时写同一份 state。
11. **`requires_project: true`** 修正：该 workflow 强依赖 git repo；v1 的 `false` 是错的。
12. **Phase 2 删除 "in-place fix append 模式并继续"**：revision 用尽即 fuse，不再给主 agent "绕过 review" 的通道。

---

## 1. 修订历史

### 1.1 v1 移除的错误假设（保持不变）

- `markdown-phase` 已经提供 phase 状态机骨架；
- `workflow-engine.ts` 是 markdown-phase 的真实执行引擎；
- 现有 workflow engine 已支持 `onPhaseEnter` / `onPhaseExit`；
- 仓库中已有可直接复用的 `implementer` agent；
- 现有 `researcher` 适合 codebase research；
- subagent dispatch 已支持按调用覆盖 provider/model；
- `/gsd cl <req>` 可以像普通 `/gsd` 子命令一样低成本接入；
- `src/resources/extensions/subagent/builtin/reviewer.md` 是当前内置 agent 的正确目录。

### 1.2 Rev 1 立场（保持不变）

- 不碰不存在的平台能力；
- 只补两处平台缺口（plugin runtime 绑定、subagent model override）；
- 业务复杂度封装在 GSD extension 内部；
- 命令入口、状态目录、恢复语义显式化；
- 先做可运行 MVP。

### 1.3 Rev 2 新增改动（本版本关键）

| # | 变更 | 章节 |
|---|---|---|
| R-1 | 严格 reviewer 模式：跨 provider 失败即 fuse | §7.5 / §7.6 / §9 Phase 2 / §13 C2 |
| R-2 | 新增 `ArtifactEnvelope` schema | §7.3 / 附录 C |
| R-3 | Recovery 基于 run_id + attempt + hash | §5.3 / §5.5 / §11.3 |
| R-4 | Admission 显式状态机 + `admission_hash` | §5.3 / §5.4 / §9 Phase 0 |
| R-5 | Verification 由 runtime 直接 spawn | §7.7 / §9 Phase 5 |
| R-6 | Phase 4 完成判定走 git diff truth source | §9 Phase 4 |
| R-7 | Audit log schema + hash chain | §5.1 / §7.8 / 附录 D |
| R-8 | `.gsd/STATE.json` marker（单行 projection） | §5.2 / §6.1 |
| R-9 | Run lock | §7.9 / §5.1 |
| R-10 | `requires_project: true` | 附录 A |
| R-11 | Phase 2 去掉 "in-place fix append" | §9 Phase 2 |
| R-12 | 一级章节 §13 Anti-Drift Contracts | §13 |
| R-13 | Phase 7 drift detection | §9 Phase 7 |
| R-14 | Phase 3 impl-plan `acceptance` 强 schema | §9 Phase 3 |
| R-15 | Capability probe（最小版）进 picker | §7.5 |

### 1.4 有意识推迟到 OOM 的项

| # | 项 | 为什么推迟 |
|---|---|---|
| D-1 | 完整 artifact Merkle 父依赖链（`parent_hashes[]`） | MVP 走 `admission_hash + 紧邻前序 phase hash` 双锚点，已能覆盖主要漂移；完整父图 DAG 留到后续硬化 |
| D-2 | CLI 交互式 reviewer（codex/claude/gemini CLI 接入） | 依赖 CLI 可用性探测、交互式 stdin 管理、输出回收、配额记账；属于独立 epic |
| D-3 | 多维 reviewer capability probe（version/model list/limit） | MVP 只做 env var 级 probe |
| D-4 | `raw/` vs `artifacts/` 双目录 | 概念接受但目录不拆，以 envelope 中 `raw_log_path` 字段指向 `logs/raw/<phase>-<attempt>.jsonl` 即可 |
| D-5 | Phase 3 impl-plan 独立 reviewer 评审 | 由 Phase 2 reviewer 同时覆盖 "design + split 衔接" + impl-plan `acceptance` 强 schema 顶替 |

---

## 2. 背景与目标

### 2.1 问题陈述

用户当前依赖 Claude Code 上的本地 skill `composed-lite` 完成"设计 → 研究 → 独立评审 → 实现 → 验证 → 交付"的一体化流程。原 skill 的问题：

- 绑定 Claude Code CLI 的 skill / subagent / hook 机制；
- review 依赖 `codex-review.sh` 这类外部 shell 脚本；
- 状态目录、enforcement marker、临时工作区、compact checkpoint 均为自建机制；
- 迁移到 GSD-2 时，若照搬机制会与现有 workflow、subagent、git、恢复逻辑重复；
- **主 agent 执行偏移已多次发生**：跳过 reviewer、同模型自审、伪造验证输出、空 diff 假称完成、跳过设计直奔实现。

GSD-2 已经具备：

- workflow plugin 发现与启动；
- GSD 命令系统与 workflow registry；
- 独立 subagent 进程；
- Git service 与 verification command detection；
- `.gsd/` 状态目录与恢复惯例。

因此更合理的策略不是"按原 skill 逐项移植"，而是：

> 用 GSD 现有入口能力启动 composed-lite，但让 composed-lite 自己管理执行循环、artifacts 与反漂移契约。

### 2.2 目标

- **G1** — 支持 `/gsd workflow composed-lite <req>` 启动完整 0-7 流水线；
- **G2** — 支持 `/gsd start composed-lite <req>` 走相同 runtime；
- **G3** — 支持 `plan` 模式（0-3+7），不落代码；
- **G4** — review 阶段使用与主执行模型不同的 reviewer model，**跨 provider 失败即 fuse**；
- **G5** — 所有 composed-lite 状态和 artifacts 落到 `.gsd/composed-lite/`；
- **G6** — 支持中断恢复、verify→implement 回环、budget 熔断；
- **G7** — Phase 6 只提交明确允许进入 git 的文件；
- **G8** — 所有关键 phase 完成事实可从 audit log 独立复核，不能靠主 agent 自述。

### 2.3 非目标（MVP）

- ❌ workflow 通用 phase hook 框架；
- ❌ 独立顶层 extension 之间的运行时 RPC；
- ❌ 自动 temp workspace / worktree 隔离；
- ❌ 中途退出强制阻断；
- ❌ compact checkpoint；
- ❌ `/gsd cl` 或 `/cl` 形式的短别名；
- ❌ 抽象成所有 workflow 可复用的公共 review harness；
- ❌ CLI 交互式 reviewer；
- ❌ 完整 artifact 父依赖 Merkle 链。

---

## 3. 现有代码库约束（设计必须服从）

### 3.1 `markdown-phase` 当前只是启动器，不是 phase runtime

现有 markdown-phase 工作流实际行为是：

1. 解析模板；
2. 建 artifact 目录；
3. 写简单的 `STATE.json`；
4. 创建分支；
5. 下发 `workflow-start` prompt 给主 agent。

它**不是**一个在每个 phase 边界回调业务代码的运行时。

### 3.2 当前没有 `onPhaseEnter/onPhaseExit` 之类的 hook API

因此 composed-lite MVP 不能建立在"workflow engine 会在 phase 转移时调用我"的前提上。

### 3.3 当前 subagent 能力边界

- agent 定义来自 `src/resources/agents/*.md`、`~/.gsd/agent/agents/`、`.gsd/agents/`；
- 调用时只能指定 agent 名称和 task；
- model 来自 agent frontmatter，**不能按调用覆盖**；
- 现有内置 agent 中：
  - `researcher` 偏 Web research，不适合 Phase 1；
  - `scout` 更适合 codebase exploration；
  - `worker` 更适合实现工作；
  - 已存在 `reviewer`，但输出格式不是 composed-lite 需要的 YAML。

### 3.4 当前 slash / gsd 命令系统

- `gsd` 是一个统一的顶级命令入口；
- `/gsd workflow <name>` 已支持按 plugin mode 分发；
- `/gsd start <template>` 已支持通过 registry 启动模板；
- 没有现成"给 `/gsd` 动态加短别名子命令"的通用能力；
- 现有 `/gsd status` / `/gsd resume` 扫描 `.gsd/STATE.json`（单文件约定）。

### 3.5 当前 git / verification 基础能力

- Git service 默认用 `smartStage()` 做全局 smart add；
- 已有 `nativeAddPaths()` 可做精确 stage；
- 已有 verification command detection，可从项目脚本中自动探测 test/build/lint/typecheck；
- `child_process.spawn` 可被 runtime 直接使用来跑验证命令，不必通过 agent 间接执行。

---

## 4. 修订后的总体架构

### 4.1 总体原则

MVP 的实现分层如下：

```text
CLI / TUI
  ├─ /gsd workflow composed-lite <req>
  └─ /gsd start composed-lite <req>
        │
        ▼
workflow plugin discovery / registry
        │
        ▼
GSD workflow dispatcher
  ├─ 普通 markdown-phase plugin → 继续走现有 workflow-start prompt
  └─ composed-lite plugin       → 直接调用 composed-lite runtime
        │
        ▼
src/resources/extensions/gsd/composed-lite/
  ├─ runner.ts              # 主循环：phase 推进 / 恢复 / 熔断 / spawn 验证
  ├─ state.ts               # state.yaml 读写 + STATE.json marker projection
  ├─ artifacts.ts           # ArtifactEnvelope 写入 / 校验 / hash
  ├─ budget.ts              # 熔断计数与时间预算
  ├─ review-model-picker.ts # 严格跨 provider 选择 + capability probe
  ├─ review-harness.ts      # 组装 reviewer 调用 + envelope 包装
  ├─ verification-runner.ts # runtime 直接 spawn 验证命令
  ├─ audit-log.ts           # hash-chained JSONL event log
  ├─ run-lock.ts            # pid-based run lock
  ├─ prompts/*.md           # phase prompt 模板（仅影响 agent 行为，不作为契约）
  └─ phases/p0-p7.ts        # phase handlers
        │
        ▼
subagent processes
  ├─ scout (Phase 1)
  ├─ worker (Phase 4)
  └─ composed-lite-reviewer (Phase 2/4/5)
```

**重点：** prompts 只改变 agent 的建议行为，不构成反漂移契约。契约全部在 runtime 代码里用代码强制。

### 4.2 为什么本版把 runtime 放进 `gsd/` 而不是单独 extension

上一版希望新建 `src/resources/extensions/composed-lite/` 顶层 extension。理论上可行，但以当前代码结构实现会新增一个更大的问题：

- workflow plugin dispatch 位于 GSD extension 内；
- 当前没有稳定的"workflow plugin 解析后跨 extension 直接调用 runtime API"的机制；
- 为了做一个 workflow，先造 extension 间运行时调用层，会放大 MVP 范围。

因此本版选择：

- workflow plugin 仍然是 first-class；
- 但其 runtime 实现在 **GSD extension 内部模块**：`src/resources/extensions/gsd/composed-lite/`；
- 未来若有多个类似 workflow，再抽成独立 extension 或公共 runtime。

### 4.3 对 workflow plugin 的修订设计

MVP 仍保留一个 workflow template：

- `src/resources/extensions/gsd/workflow-templates/composed-lite.md`
- registry 中增加 `composed-lite` 条目

新增一个显式绑定字段：

```yaml
executor_extension: composed-lite
```

它的含义不是"phase hook 绑定"，而是：

> 该 plugin 的启动/恢复由 GSD 内部的 composed-lite runtime 接管，而不是走默认 `workflow-start` prompt 路径。

### 4.4 新增但受控的平台改动

1. `TemplateEntry` / `WorkflowPluginMeta` 增加 `executor_extension?: string`；
2. `dispatchPluginByMode()` / `dispatchMarkdownPhasePlugin()` 在检测到 `executor_extension === "composed-lite"` 时，转调 composed-lite runtime；
3. `subagent` tool 增加 `modelOverride?: string`（或同义命名）用于 per-call 覆盖 agent 默认模型；
4. `.gsd/STATE.json` 写入逻辑允许 runtime 写入一个最小 marker（仅 `type: "runtime-owned"`, `runtime: "composed-lite"`, `state_path: ".gsd/composed-lite/state.yaml"`, `updated_at`），使 `/gsd status` / `/gsd resume` 能发现该 run。

除此之外，不引入 workflow phase hooks，不改 workflow engine 基础协议。

---

## 5. 运行时与状态模型

### 5.1 目录结构

```text
.gsd/
├── STATE.json                      # ← marker（单行 projection）见 §5.2
└── composed-lite/
    ├── state.yaml                  # ← source of truth
    ├── run.lock                    # ← pid + started_at，见 §7.9
    ├── artifacts/
    │   ├── admission.yaml
    │   ├── research-brief.yaml
    │   ├── design-doc.md
    │   ├── design-review.yaml
    │   ├── impl-plan.yaml
    │   ├── implementation-summary.md
    │   ├── code-review.yaml
    │   ├── verification-report.md
    │   ├── delivery-report.yaml
    │   └── postmortem-report.yaml
    └── logs/
        ├── audit-<run_id>.jsonl    # ← hash-chained event log，见 §7.8
        └── raw/
            └── <phase>-<attempt>-<producer>.jsonl  # ← subagent/验证命令原始输出
```

所有 artifact 文件的前置 YAML frontmatter（或 yaml 文档的顶部字段）必须是 §7.3 定义的 `ArtifactEnvelope`。Markdown 文件用 `<!-- envelope: {...} -->` 注释承载 envelope（或等价 frontmatter 格式）。

### 5.2 `.gsd/STATE.json` marker（新增）

**目的：** 让现有 `/gsd status` / `/gsd resume` 能发现 composed-lite run，而不需要修改这些命令的扫描逻辑。

**内容（固定极简）：**

```json
{
  "type": "runtime-owned",
  "runtime": "composed-lite",
  "run_id": "cl-20260420-01",
  "state_path": ".gsd/composed-lite/state.yaml",
  "status": "active",
  "updated_at": "2026-04-20T10:03:00Z"
}
```

**写入时机：**

- runtime 启动成功后（lock 获取成功后）立即写；
- 每次 `saveState()` 后同步更新（只更新 `status` 和 `updated_at`）。

**`state.yaml` 仍然是唯一业务 source of truth。** marker 只是导航用，包含的任何字段都可以从 `state.yaml` 投影重建。如果两者不一致，以 `state.yaml` 为准，runtime 启动时会自动重建 marker。

### 5.3 `state.yaml` schema（Rev 2）

```yaml
# --- 基础信息 ---
schema_version: 2
run_id: "cl-20260420-01"
requirement: "<user input>"
mode: full                    # full | plan
status: active                # active | fused | completed | abandoned
created_at: "2026-04-20T10:00:00Z"
updated_at: "2026-04-20T10:03:00Z"

# --- 运行锁（由 run-lock.ts 维护） ---
lease:
  pid: 48213
  host: "macbook-pro.local"
  started_at: "2026-04-20T10:00:00Z"

# --- 环境指纹（恢复时校验） ---
env_fingerprint:
  project_root: "/Users/.../gsd-2"
  git_head_at_start: "a1b2c3d..."
  node_version: "v22.9.0"

# --- 当前 phase ---
current_phase: 0              # 0..7
fuse_reason: null             # 见 §13 fuse 原因枚举

# --- 预算 ---
budget:
  max_time_minutes: 120
  elapsed_minutes: 0.0
  verify_reentry_count: 0
  max_verify_reentry: 3
  consecutive_failures: 0
  max_consecutive_failures: 2

# --- Admission 状态机（见 §9 Phase 0） ---
admission:
  state: pending              # pending | evidence_collected | awaiting_approval | approved | rejected
  evidence_message_ids: []    # user 消息 id / 来源指纹
  approved_by: null           # "user" 一经确认写入
  approved_at: null
  admission_hash: null        # SHA-256(canonical(admission.yaml))，一经 approved 锁定

# --- 每个 phase 的状态 + envelope 引用 ---
phases:
  0:
    status: pending           # pending | running | completed | failed | skipped | fused
    started_at: null
    completed_at: null
    attempt: 0                # 重跑一次 +1
    revision_round: 0         # 仅 Phase 2/4 使用
    failure_reason: null
    artifact_envelope:        # 本 phase 产出 artifact 的 envelope 摘要（完整 envelope 在 artifact 文件头）
      path: null
      output_hash: null       # SHA-256(artifact body)
      producer_kind: null     # main | subagent_scout | subagent_worker | subagent_reviewer | runtime | verification_runner
      producer_id: null
      provider: null
      model: null
  1: { status: pending, ... }
  2: { status: pending, ..., revision_round: 0 }
  3: { status: pending, ... }
  4: { status: pending, ..., revision_round: 0 }
  5: { status: pending, ... }
  6: { status: pending, ... }
  7: { status: pending, ... }

last_verify_failure: null     # Phase 5 → Phase 4 回环时写入

# --- Review 选择 ---
review:
  main_model: "<session model id>"
  reviewer_model: "<picked model id>"
  reviewer_provider: "<openai | anthropic | google | ...>"
  cross_provider: true        # 必须为 true；false 仅当 env var 后门打开，见 §7.5
  fallback_self_review: false # 默认 false，env var 后门打开时 true，并同时写 audit log 与 fuse 建议

# --- Git ---
git:
  baseline_sha: "a1b2c3d..."  # Phase 4 开始前记录，用于 diff truth source
  commit_created: false
  commit_sha: null
  committed_files: []
```

### 5.4 生命周期契约

- `status` 是总运行态；
- `current_phase` 指向下一次恢复时应进入的 phase；
- phase 状态只能按 `pending -> running -> completed | failed | skipped | fused` 推进；
- `fuse_reason` 一旦非空，主循环停止业务 phase，**仍然执行 Phase 7**，然后将 `status` 置为 `fused`；
- `last_verify_failure` 仅在 Phase 5 失败时写入；再次验证通过时重置；
- `state.yaml` 用原子写覆盖更新（写到 `.tmp` 后 rename），每次写都同步更新 STATE.json marker；
- `admission.state` 只能按 `pending → evidence_collected → awaiting_approval → approved` 或 `awaiting_approval → rejected` 转移；`approved` 为终态；一旦 `approved`，`admission_hash` 不可更改，若后续检测到不一致则 `fuse_reason = admission_tampered`。

### 5.5 Recovery invariants（新增）

恢复时 runtime **必须**执行以下校验，任一失败都重跑该 phase：

1. **Run ID 一致性：** `state.yaml.run_id` 与每个已声明完成的 phase 的 `artifact_envelope.run_id` 必须一致。
2. **Hash 匹配：** `phases[i].artifact_envelope.output_hash` 必须等于实际 artifact 文件内容的 SHA-256；mismatch ⇒ phase 重置为 `pending`，`attempt += 1`。
3. **Admission 锚点：** 对每个已完成 phase (≥1)，其 artifact envelope 中 `admission_hash` 必须等于 `state.yaml.admission.admission_hash`；mismatch ⇒ 整个 run fuse (`fuse_reason = admission_tampered`)。
4. **Env fingerprint：** `env_fingerprint.project_root` 与当前 `cwd` 一致；`git_head_at_start` 可以不同（允许用户在中断后 commit），但如果 Phase 4 已开始，`git.baseline_sha` 必须仍然在当前 git 历史中可达（否则 Phase 4 必须重跑）。
5. **Lock 检测：** `lease.pid` 若仍然存活（`kill -0` 或等价机制），拒绝启动第二个 runtime；若已死亡，清理 lease 并继续。

---

## 6. 平台改动清单（MVP 必需）

### 6.1 workflow plugin 元数据 + STATE.json marker

**目的：** 区分两类 markdown-phase plugin，同时不破坏 `/gsd status` / `/gsd resume` 既有约定。

**需要修改的文件：**

- `src/resources/extensions/gsd/workflow-templates.ts`
- `src/resources/extensions/gsd/workflow-plugins.ts`
- `src/resources/extensions/gsd/workflow-templates/registry.json`
- `src/resources/extensions/gsd/commands/handlers/workflow.ts`
- `src/resources/extensions/gsd/commands-workflow-templates.ts`

**行为：**

当 plugin 满足 `mode === "markdown-phase"` 且 `executor_extension === "composed-lite"` 时：

- `/gsd workflow composed-lite ...` 不再走默认 `dispatchMarkdownPhasePlugin()` 里的 prompt-only 路径；
- `/gsd start composed-lite ...` 也不再写常规 `STATE.json`（带 phase / artifact_dir 等字段）；
- 改为：
  1. 构造 `ComposedLiteRunRequest` 并调用 composed-lite runtime；
  2. runtime 自行写 `.gsd/composed-lite/state.yaml`；
  3. runtime 写 `.gsd/STATE.json` marker（§5.2 格式）；
  4. `/gsd status` 读到 `type === "runtime-owned"` 时走"委派"路径：直接读 `state_path` 指向的 state.yaml 做展示（MVP 只需在 status handler 加一个分支）。

### 6.2 subagent 增加 per-call `modelOverride`

**背景：** 当前 subagent 只能从 agent frontmatter 读取 `model`，不能按调用覆盖。composed-lite reviewer 需要：

- 主模型是 Claude 时优先选 OpenAI / Gemini reviewer；
- 主模型是 OpenAI 时优先选 Claude reviewer；
- 如果没有对侧 provider 可用：**fuse（默认），或走 env-var 逃生后门但全量写入审计**。

**修改建议：** 在 `subagent` tool 参数中增加：

```ts
modelOverride?: string
```

并让 `buildSubagentProcessArgs()` 优先使用 `modelOverride`，其次才是 `agent.model`。

**需要修改的文件：**

- `src/resources/extensions/subagent/index.ts`
- 相应测试文件

**范围控制：** MVP 只做 `modelOverride`，不做复杂 `providerOverride + modelOverride` 二元结构。当前 GSD 模型标识已足够用字符串表达（如 `gpt-5.4`、`claude-sonnet-4.7`）。

---

## 7. 核心模块设计

目录：

```text
src/resources/extensions/gsd/composed-lite/
├── index.ts
├── runner.ts
├── state.ts
├── budget.ts
├── artifacts.ts
├── review-model-picker.ts
├── review-harness.ts
├── verification-runner.ts   # ← 新增
├── audit-log.ts             # ← 新增
├── run-lock.ts              # ← 新增
├── prompts/
│   ├── 00-admission.md
│   ├── 01-research.md
│   ├── 02-design.md
│   ├── 02-design-review.md
│   ├── 03-split.md
│   ├── 04-implementation.md
│   ├── 04-code-review.md
│   ├── 05-verification.md
│   ├── 05-verification-review.md
│   ├── 06-delivery.md
│   └── 07-postmortem.md
├── phases/
│   ├── p0-admission.ts
│   ├── p1-research.ts
│   ├── p2-design.ts
│   ├── p3-split.ts
│   ├── p4-implementation.ts
│   ├── p5-verification.ts
│   ├── p6-delivery.ts
│   └── p7-postmortem.ts
└── tests/
```

### 7.1 `runner.ts`

**职责：**

- 获取 run lock（§7.9）；
- 初始化 / 恢复 state（§5.5 invariants 全部通过才能跳过已完成 phase）；
- 根据 mode 决定 phase 序列；
- phase 前 budget 检查；
- **显式调用 reviewer（Phase 2/4/5），主 agent 永远不自行 review**；
- **spawn verification 命令（Phase 5），不走 agent**；
- 失败、verify 回环、fuse、Phase 7 收尾；
- 所有关键事件写 audit-log（§7.8）。

接口：

```ts
export interface ComposedLiteRunRequest {
  projectRoot: string;
  requirement: string;
  mode: "full" | "plan";
  source: "workflow-start" | "workflow-run" | "resume";
}

export async function runComposedLite(req: ComposedLiteRunRequest): Promise<void>;
```

### 7.2 `state.ts`

```ts
export interface ComposedLiteState { /* 对应 §5.3 */ }

export function loadState(projectRoot: string): ComposedLiteState | null;
export function initState(projectRoot: string, req: { requirement: string; mode: "full" | "plan" }): ComposedLiteState;
export function saveState(projectRoot: string, state: ComposedLiteState): void;
export function updatePhase(state: ComposedLiteState, phase: number, patch: Partial<PhaseEntry>): void;

export function writeStateMarker(projectRoot: string, state: ComposedLiteState): void; // 写 .gsd/STATE.json marker
```

**不变式：**

- `saveState` 必须：atomic write → 更新 marker → append audit-log `state_save` 事件（含 `state_hash`）。
- `loadState` 必须：校验 schema → 跑 §5.5 invariants → 不通过则抛可被 runner 捕获的 `StateIntegrityError`。

### 7.3 `artifacts.ts` 与 `ArtifactEnvelope`

**ArtifactEnvelope（强 schema，所有 phase artifact 必须携带）：**

```ts
export interface ArtifactEnvelope {
  schema_version: 1;
  run_id: string;                          // 绑定 run
  phase: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
  attempt: number;                          // 0-based
  revision_round?: number;                  // 仅 Phase 2/4 reviewer revision
  artifact_kind:
    | "admission" | "research-brief" | "design-doc" | "design-review"
    | "impl-plan" | "implementation-summary" | "code-review"
    | "verification-report" | "delivery-report" | "postmortem-report";
  producer_kind:
    | "runtime" | "main_agent" | "subagent_scout"
    | "subagent_worker" | "subagent_reviewer" | "verification_runner";
  producer_id: string;                      // subagent spawn id / pid / "runtime"
  provider: string | null;                  // 如 "anthropic" | "openai" | "google" | null (runtime/spawn)
  model: string | null;                     // 模型 id；runtime/spawn 时为 null
  admission_hash: string;                   // 锚定 admission approval；Phase 0 自身是自己 hash 的预占位然后被 replace
  prev_phase_output_hash: string | null;    // 紧邻前一个已完成 phase 的 output_hash（Phase 0 为 null）
  input_hash: string;                       // SHA-256(canonical prompt + inputs 提供给 producer)
  raw_log_hash: string;                     // SHA-256(logs/raw/<phase>-<attempt>-<producer>.jsonl)
  raw_log_path: string;                     // 指向 raw log 的相对路径
  output_hash: string;                      // SHA-256(artifact body excluding envelope itself)
  created_at: string;                       // ISO 8601
}
```

**`artifacts.ts` 对外 API：**

```ts
export const ARTIFACT_PATHS = { /* 保持 v1 */ } as const;

export function writeArtifact(
  projectRoot: string,
  kind: ArtifactEnvelope["artifact_kind"],
  body: string,
  envelope: Omit<ArtifactEnvelope, "output_hash" | "created_at">
): ArtifactEnvelope;

export function readArtifact(
  projectRoot: string,
  kind: ArtifactEnvelope["artifact_kind"]
): { envelope: ArtifactEnvelope; body: string } | null;

export function verifyEnvelope(
  envelope: ArtifactEnvelope,
  body: string,
  ctx: { run_id: string; admission_hash: string; prev_phase_output_hash: string | null }
): { ok: true } | { ok: false; reason: string };
```

**关键不变式：**

- 任何写入 artifact 的路径都必须经过 `writeArtifact`，不允许旁路写；
- `verifyEnvelope` 在 recovery 和 Phase 7 drift detection 中都会被调用。

### 7.4 `budget.ts`

**职责：**

- 维护 elapsed time；
- 维护 verify reentry 次数；
- 维护连续失败次数；
- 给出 fuse reason（§13 枚举）。

### 7.5 `review-model-picker.ts`（Rev 2 严格版）

**职责：**

- 输入主模型 id + 当前 env；
- **capability probe（MVP 最小版）：** 检查 env 是否同时存在 **主 provider 凭据** 与 **对侧 provider 凭据**（例如 ANTHROPIC_API_KEY + OPENAI_API_KEY / GEMINI_API_KEY）；
- 输出 reviewer model id + reviewer provider + cross_provider flag；
- 严格模式下跨 provider 失败直接 throw `ReviewerUnavailableError`，由 runtime 写 `fuse_reason = review_unavailable` 并进入 Phase 7；
- **env-var 后门：** 若设置了 `GSD_COMPOSED_LITE_ALLOW_SELF_REVIEW=1`，退化为同 provider / 自 review，但 runtime 必须：
  - 在 audit log 追加 `reviewer_fallback_self_review` 事件；
  - 在 state 中设置 `review.fallback_self_review = true` 与 `review.cross_provider = false`；
  - 默认仍然 fuse（除非再显式打开 `GSD_COMPOSED_LITE_FALLBACK_CONTINUE=1`）；
  - 在 postmortem 中明确标注"本次非独立评审"。

**接口：**

```ts
export class ReviewerUnavailableError extends Error {}

export function pickReviewerModel(input: {
  mainModel: string;
  env: NodeJS.ProcessEnv;
}): {
  model: string;
  provider: string;
  crossProvider: boolean;
  fallbackSelfReview: boolean;
};
```

### 7.6 `review-harness.ts`（Rev 2 严格版）

**职责：**

- 为 reviewer 组装 prompt（读 §7 prompts/*.md）；
- 通过 subagent 调用 `composed-lite-reviewer`，**始终带 `modelOverride`**；
- 将 subagent 原始输出写入 `logs/raw/<phase>-<attempt>-reviewer.jsonl`；
- 严格解析 reviewer YAML（schema 校验）；
- 解析失败重试 1 次，仍失败 → `ReviewerParseError` → runtime fuse `review_parse_exhausted`；
- 对 reviewer 输出做**合法性验证**（`overall_assessment ∈ {pass, issues, fail}`、每条 critical/important/minor 必须带 `id/target/rationale`）；
- 通过 `writeArtifact()` 落盘 review artifact，envelope 中 `producer_kind = subagent_reviewer`。

**关键不变式：**

- **主 agent 不能自己执行 review**：review-harness 是唯一合法入口，runner 在每个 review phase 只能调 review-harness，不能调用 `main_agent.review(...)` 之类的伪 API；
- review artifact envelope 中 `provider` 必须 ≠ 主模型 provider（除非 fallback self-review 且审计 flag 打开）。

### 7.7 `verification-runner.ts`（新增）

**职责：**

- 探测项目验证命令（复用现有 verification command detection）；
- **由 runtime 直接 `child_process.spawn`**，不经 agent；
- 捕获 stdout/stderr/exitCode + duration；
- 写 `logs/raw/5-<attempt>-verification.jsonl`；
- 组装 `verification-report.md`（纯 runtime 模板填充，不走 agent）；
- 通过 `writeArtifact()` 落盘，envelope `producer_kind = verification_runner`，`provider/model = null`；
- 从 exitCode / stderr 结构化提取 `last_verify_failure`（一级：哪个命令失败；二级：错误摘要 ≤ 500 字节）。

**接口：**

```ts
export interface VerifyCommandResult {
  kind: "test" | "build" | "lint" | "typecheck";
  command: string;
  exit_code: number;
  duration_ms: number;
  stdout_tail: string; // last 4KB
  stderr_tail: string; // last 4KB
}

export async function runVerification(projectRoot: string, run_id: string, attempt: number): Promise<VerifyCommandResult[]>;
```

### 7.8 `audit-log.ts`（新增）

**职责：** append-only JSONL，hash-chained，供 Phase 7 与外部审计使用。

**事件 schema（所有事件共同字段）：**

```ts
export interface AuditEventBase {
  seq: number;                    // 单调递增
  ts: string;                     // ISO 8601
  run_id: string;
  prev_digest: string | null;     // 前一行 entry_digest；第 0 行为 null
  entry_digest: string;           // SHA-256(canonical(this entry without entry_digest itself))
}
```

**事件类型（MVP 必需）：**

| `event` | 触发时机 | payload |
|---|---|---|
| `run_start` | runtime 获取 lock 后第一件事 | `mode, requirement_hash, main_model, env_fingerprint` |
| `admission_evidence` | Admission evidence_collected 转移时 | `evidence_message_ids[]` |
| `admission_approved` | 用户 approve 后 | `admission_hash` |
| `admission_rejected` | 用户 reject 后 | `reason` |
| `phase_enter` | phase 状态转 running | `phase, attempt, revision_round` |
| `phase_exit` | phase 完成/失败/跳过 | `phase, attempt, outcome, failure_reason, output_hash` |
| `subagent_call` | review-harness 或 scout/worker 调用前 | `phase, agent, model, provider, input_hash` |
| `subagent_result` | subagent 返回后 | `phase, agent, raw_log_hash, parsed_ok` |
| `reviewer_verdict` | review 解析成功 | `phase, overall_assessment, critical_count, important_count` |
| `reviewer_fallback_self_review` | 后门打开时 | `main_model, fallback_model, env_vars_set` |
| `verification_run` | verification-runner 完成 | `results[]`（§7.7） |
| `git_commit` | Phase 6 提交 | `sha, committed_files[]` |
| `fuse` | fuse 触发 | `fuse_reason` |
| `state_save` | 每次 state.yaml 写入 | `state_hash` |
| `postmortem_complete` | Phase 7 完成 | `drift_warnings[]` |

**API：**

```ts
export function appendAudit(projectRoot: string, run_id: string, event: Omit<AuditEventBase, "seq" | "prev_digest" | "entry_digest"> & { event: string; payload: unknown }): void;

export function readAuditLog(projectRoot: string, run_id: string): AuditEvent[];

export function verifyAuditChain(events: AuditEvent[]): { ok: true } | { ok: false; bad_seq: number; reason: string };
```

### 7.9 `run-lock.ts`（新增）

**职责：**

- `.gsd/composed-lite/run.lock` 里写 `{ pid, host, started_at, run_id }`；
- 启动时：
  - 若 lock 不存在 → 创建，继续；
  - 若 lock 存在且 `pid` 在当前 host 还活着（`kill -0` / `process.kill(pid, 0)` 不抛错）→ refuse，打印清晰 error；
  - 若 lock 存在但 pid 已死 → 覆盖，继续（并在 audit log 写 `run_start.lock_stale_cleared`）；
- 退出时（包括 fuse）：清理 lock；
- 每 N 秒"心跳"更新 lock 的 `updated_at`（MVP 可省略；v2 只需 start/end）。

---

## 8. Agent 设计（修订版）

### 8.1 Phase 1 不复用现有 `researcher`

原因：当前 `researcher` 是 Web research agent，而不是 codebase recon agent。

MVP 方案：

- 复用现有 `scout` 做代码扫描；
- 通过 parallel subagent 启 2-3 个 scout，关注不同维度：
  - `codebase_scan`
  - `constraints_risks`
  - `prior_art_in_repo`

### 8.2 Phase 4 不再写 `implementer`

仓库当前没有 `implementer` agent。MVP 直接复用 `worker`。

如果后续需要更强约束，再新增 `composed-lite-worker`，但 MVP 不要求。

### 8.3 新增专用 reviewer agent

新增：

```text
src/resources/agents/composed-lite-reviewer.md
```

而不是覆盖现有 `reviewer.md`。

理由：

- 现有 `reviewer.md` 输出 markdown summary，不是严格 YAML；
- composed-lite reviewer 需要更强的格式契约；
- 避免影响全局 reviewer 行为。

**frontmatter 建议：**

```yaml
---
name: composed-lite-reviewer
description: Independent structured reviewer for composed-lite phases 2/4/5
model: sonnet
---
```

运行时通过 `modelOverride` 覆盖为 picker 选中的 reviewer 模型。**如果 picker fail，runtime 不会调用本 agent**；主 agent 也没有权限绕过 review-harness 直接调用（契约 C1 / C2）。

**输出格式（严格 YAML，必须）：**

```yaml
overall_assessment: pass | issues | fail
critical:
  - id: C1
    target: "path/to/file#section"
    rationale: "..."
important: []
minor: []
rationale: "..."
```

### 8.4 主 agent 的权责边界（显式）

主 agent 在整条流水线里：

- 可以写 artifact body（design-doc 等主 agent 产物）；
- **不能**执行 review 动作；
- **不能**执行 verification 命令（它只能通过 runtime 间接看到 verification 结果）；
- **不能**跳过 phase（每个 phase 的 `phase_enter` 由 runtime 显式发起）；
- **不能**修改 `state.yaml` 或 `.gsd/STATE.json`；
- **不能**直接写 audit log。

---

## 9. 八个 Phase 的详细行为（Rev 2）

> Phase 行为 = 主动作 + runtime contract + 产出 artifact + 失败处理。prompts 是建议，contracts 才是强制。

### Phase 0 — Admission

**状态机（§5.3 admission.state）：**

```
pending → evidence_collected → awaiting_approval → approved   (go)
                            \→ rejected                       (fuse: admission_rejected)
```

**主动作：**

1. `pending → evidence_collected`：
   - 读取 `requirement` 与最近一次用户消息；
   - 主 agent 可在主对话追问 0-3 个澄清问题（runtime 限制 max 3 轮）；
   - 将用户答复的消息 id / 指纹写入 `admission.evidence_message_ids[]`；
   - runtime 写 audit `admission_evidence`。
2. `evidence_collected → awaiting_approval`：
   - runtime 基于 requirement + evidence 生成 `admission.yaml` 草稿（fields：`requirement_type`、`target_paths`、`scope_boundary`、`acceptance_criteria`）；
   - **完整展示**草稿给用户；
   - 要求用户显式回复 `approve` 或 `reject`。
3. `awaiting_approval → approved`：
   - 用户回复 `approve` → runtime 计算 `admission_hash = SHA-256(canonical(admission.yaml))`；
   - 写入 `state.yaml.admission`（approved_by / approved_at / admission_hash 锁定）；
   - 写 audit `admission_approved`；
   - 通过 `writeArtifact(kind="admission", ...)` 落盘。
4. `awaiting_approval → rejected`：
   - `fuse_reason = admission_rejected`；仍然执行 Phase 7。

**Runtime contract（C6）：**

- 任何后续 phase 启动前，runtime 必须校验 `state.admission.state === "approved"` 且 `admission_hash` 非空；否则拒绝进入 Phase 1。
- 所有后续 artifact envelope 必须 carry `admission_hash`；mismatch → fuse `admission_tampered`。

**产出：** `admission.yaml` (with envelope)。

### Phase 1 — Research

**主动作：**

- 并发启动 2-3 个 `scout` subagent；
- 每个 scout 的 input_hash 记录；
- 主 runtime 综合各 scout 输出 → `research-brief.yaml`；
- `research-brief.yaml` 必须包含 `derived_from: [scout_producer_id_1, scout_producer_id_2, ...]`，每项对应 scout 的 raw_log_hash；
- artifact 硬损坏（schema 不合法）：phase failed；
- soft mismatch（字段存在但内容空/无效）：重试 1 次，再失败即 phase failed，累计 `consecutive_failures`。

**Runtime contract（C4 / C7）：**

- `phase_enter` 前必须 `current_phase === 1` 且 Phase 0 `status === completed`；
- `research-brief.yaml` envelope `producer_kind === "main_agent"`（因为是主 agent 汇总），但必须包含 `derived_from` 指向 scout producers。

**产出：** `research-brief.yaml`。

### Phase 2 — Design

**主动作：**

- 主 runtime 驱动主 agent 生成 `design-doc.md`（envelope `producer_kind = main_agent`）；
- runtime 显式调用 review-harness → `design-review.yaml`（envelope `producer_kind = subagent_reviewer`, provider ≠ main provider）；
- 若 review `overall_assessment === "pass"`：phase completed；
- 若 `issues` 或 `fail`：
  - `revision_round += 1`；
  - 最多 2 轮 revision；
  - **revision 用尽仍未 pass → `fuse_reason = design_review_exhausted`**（**Rev 2 移除 v1 的"in-place fix append"通道**）。

**Runtime contract（C1 / C2 / C11）：**

- review 必须通过 review-harness；主 agent 无权直接写 `design-review.yaml`；
- reviewer 必须通过 picker；picker fail → 整个 run fuse `review_unavailable`；
- revision 路径是 `design-doc.md` 重写（`attempt` 保持，`revision_round += 1`），而不是"在原 doc 末尾追加修改"。

**产出：** `design-doc.md`, `design-review.yaml`。

### Phase 3 — Split

**主动作：**

- 将 design 拆成 `<= 8` 个 ordered steps；
- 每步至少包含：`title` / `files` / `acceptance` / `rollback_hint`；
- **`acceptance` 为强 schema（Rev 2 新增）：** 必须是一个 `list of verifiable assertions`，每项形如：
  ```yaml
  - kind: file_exists | file_contains | grep | ast_match | test_pass
    target: "path/to/file"
    pattern: "..."            # grep/file_contains 用
    node: "function foo"       # ast_match 用
    test_name: "..."           # test_pass 用
  ```
- runtime 在 Phase 4 每步完成后会**逐条检查** acceptance；
- plan 模式到此结束业务 phase。

**Runtime contract（C14 / C4）：**

- `impl-plan.yaml` envelope 校验失败（schema 不合法、acceptance 非 list、未达最低 assertion 数 = 1 per step）→ phase failed；
- Phase 2 reviewer 的 target 包含 design + split 衔接性；如果 reviewer 指出 split 不合理，视为 design review fail 的一部分。

**产出：** `impl-plan.yaml`。

### Phase 4 — Implementation（plan 模式跳过）

**主动作：**

- runtime 记录 `git.baseline_sha = git rev-parse HEAD`；
- 顺序执行 `impl-plan.yaml` 中的 steps；
- 每步调用 `worker` subagent（producer_kind = subagent_worker）；
- 每步完成后 runtime **逐条执行** `acceptance` assertions；任何一条失败 → 该 step `failed`，进入 step-level retry（最多 1 次），再失败即整个 phase failed；
- 全部 step 完成后，runtime 计算 `git diff --numstat baseline..HEAD` 与 `git diff` 内容：
  - 若无任何变更 → `fuse_reason = implementation_empty_diff`；
  - 若仅空白/仅注释/仅格式化 → 累计 soft fail，允许 1 次 replay，否则 `implementation_noop_diff`；
- 产出 `implementation-summary.md`（runtime 拼装，含 steps + diff stats + acceptance pass/fail）；
- runtime 显式调用 review-harness → `code-review.yaml`；
- review 失败同 Phase 2 的 revision 语义；
- 若由 Phase 5 回填 `last_verify_failure`，在下一轮实现 prompt 中显式带上。

**Runtime contract（C5 / C3 / C1）：**

- **git diff 是真值源**。主 agent 自述 "implemented" 不算完成；
- implementation-summary `producer_kind` 可以是 `runtime`（因为是运行时拼装），但 summary 中"做了什么"段落由主 agent 提供（并被 runtime 与实际 diff 校对一致）；
- review 必须经 review-harness，同 Phase 2。

**产出：** `implementation-summary.md`, `code-review.yaml`。

### Phase 5 — Verification（plan 模式跳过）

**主动作：**

- runtime 调 `verification-runner.runVerification(...)`：
  - 直接 spawn test / build / lint / typecheck；
  - 捕获 stdout/stderr/exitCode；
  - 写 `logs/raw/5-<attempt>-verification.jsonl`；
- runtime 组装 `verification-report.md`（模板填充：命令、exit、耗时、tail 片段）；
- runtime 显式调 review-harness 让 reviewer 评审"证据能否证明需求达成"（reviewer 只读 report + acceptance criteria，不能执行命令）；
- 如 verification 存在任一 non-zero exit：
  - 结构化提取 `last_verify_failure`；
  - 回到 Phase 4；
  - `verify_reentry_count++`；
  - 最多 3 次重入，否则 fuse `verify_reentry_exhausted`。

**Runtime contract（C3 / C1）：**

- 验证动作必须由 `verification-runner` 执行；主 agent / reviewer 都不能声称 "tests pass" 而不经过 runtime；
- `verification-report.md` envelope `producer_kind = verification_runner`；
- reviewer 只改变是否 pass 的判断（基于证据），不能捏造证据。

**产出：** `verification-report.md`（+ reviewer verdict 嵌入 `verification-report.md` 的 "reviewer_verdict" section 或作为附加 artifact，MVP 选嵌入）。

### Phase 6 — Delivery（plan 模式跳过）

**主动作：**

- 不使用 `smartStage()` 直接全量提交；
- 根据 impl-plan 与 changed files 构造允许提交列表；
- 使用 `nativeAddPaths()` 精确 stage；
- 默认排除 `.gsd/composed-lite/**` 与 `.gsd/STATE.json`；
- 创建一次 commit；
- 写 `delivery-report.yaml`；
- 不自动 push；
- audit log 写 `git_commit`。

**Runtime contract（C7）：**

- `delivery-report.yaml` envelope `producer_kind = runtime`；
- `committed_files[]` 必须是 `allowlist ∩ actually_changed` 的交集；runtime 校验：任何不在 allowlist 的文件被 staged → 直接失败。

**产出：** `delivery-report.yaml`。

### Phase 7 — Postmortem

**主动作（Rev 2 强化）：**

- 读 `.gsd/composed-lite/logs/audit-<run_id>.jsonl`；
- 调 `verifyAuditChain()` → 若 chain broken → `fuse_reason = audit_log_tampered`（即使前面没 fuse）；
- 做 drift detection（每条都 required）：
  1. 每个 `phase_exit outcome=completed` 对应的 phase，若 phase 在 `[2, 4, 5]` 中：
     - 必须存在至少一条 `reviewer_verdict` 且 `phase` 匹配；
     - 否则写 `drift_warnings` 一条 "review_missing"；
  2. 每个 `phase_exit` 的 `output_hash` 必须能在 artifact 文件中对得上；不对上则写 "artifact_hash_mismatch"；
  3. 若 `reviewer_fallback_self_review` 出现过 → 写 "self_review_used"；
  4. 若 Phase 4 `implementation-summary.md` 的 diff stats 与 `git_commit.committed_files` 明显不一致 → 写 "diff_stats_mismatch"；
- 产出 `postmortem-report.yaml`（含 outcome、drift_warnings、fuse_reason、time_used、reviewer_identity、git_sha）；
- 将 `status` 置为 `completed` 或 `fused` 终态；
- 即使前面 fuse，本 phase **仍然执行**（确保有 postmortem）。

**产出：** `postmortem-report.yaml`。

---

## 10. `plan` 模式设计

`plan` 模式不是 workflow 平台层的原生 mode，而是 composed-lite runtime 自己解析的业务模式。

### 10.1 入口规则

支持：

- `/gsd workflow composed-lite --plan <req>`
- `/gsd start composed-lite --plan <req>`

其中 `--plan` 由 composed-lite runtime 自己从参数字符串中解析。

### 10.2 执行差异

| Phase | full | plan |
|---|---|---|
| 0 Admission | ✅ | ✅ |
| 1 Research | ✅ | ✅ |
| 2 Design | ✅ | ✅ |
| 3 Split | ✅ | ✅ |
| 4 Implementation | ✅ | ⏭ skip marker |
| 5 Verification | ✅ | ⏭ skip marker |
| 6 Delivery | ✅ | ⏭ skip marker |
| 7 PostMortem | ✅ | ✅ |

plan 模式下 skip marker 也要走 `writeArtifact`，envelope `producer_kind = runtime`，body 为 `{ skipped: true, reason: "plan_mode" }`。

### 10.3 为什么不把 `plan` 做成 workflow mode

因为当前 workflow plugin mode 是平台级枚举：`oneshot / yaml-step / markdown-phase / auto-milestone`。把 `plan` 做成平台级 mode 会扩大改动面，且没有必要。MVP 直接把它作为 composed-lite 的业务开关更合适。

---

## 11. 触发与 UX

### 11.1 MVP 入口

**支持：**

- `/gsd workflow composed-lite <req>`
- `/gsd workflow composed-lite --plan <req>`
- `/gsd start composed-lite <req>`
- `/gsd start composed-lite --plan <req>`

**不支持（MVP）：**

- `/gsd cl <req>`
- `/gsd composed-lite <req>` 作为新的独立 `/gsd` 子命令
- `/cl <req>` 顶级命令

这些都可以在 runtime 稳定后再加。

### 11.2 为什么先不做 `/gsd cl`

当前 GSD 命令系统对 `/gsd` 的子命令和顶级 slash command 是两套注册路径。为了一个短别名同时改 catalog / completions / handler，会把 MVP 拉偏；收益不高。

### 11.3 恢复 UX（Rev 2）

**恢复规则（按顺序执行，全部通过才能接续）：**

1. 启动 composed-lite 时，若发现 `.gsd/STATE.json` 且 `type === "runtime-owned"` 且 `runtime === "composed-lite"`，或直接发现 `.gsd/composed-lite/state.yaml`，提示恢复；
2. 获取 run lock；若其他 pid 持有且存活 → 拒绝；若 stale → 清理；
3. `loadState()` 跑完 §5.5 所有 invariants；任一 fail：
   - hash mismatch / run_id mismatch → 对应 phase 重置为 pending，`attempt += 1`；
   - admission_hash 不一致 → `fuse_reason = admission_tampered`，仍执行 Phase 7；
4. 对每个 `status === "running"` 的 phase，视为崩溃中断，重置为 pending 后重跑；
5. 对每个 `status === "completed"` 的 phase，额外校验：其 envelope `run_id == state.run_id` 且 `admission_hash == state.admission_hash` 且 `output_hash` 与文件实际内容一致；pass 才允许跳过；
6. 从 `current_phase` 继续。

**`/gsd status` 显示：** 读取 `.gsd/STATE.json` marker → 走 runtime-owned 分支 → 打印 `state.yaml` 摘要（run_id, current_phase, status, reviewer_model, fuse_reason if any）。

---

## 12. Git 与 artifact 策略（修订版）

### 12.1 默认不提交 `.gsd/composed-lite/**` 与 `.gsd/STATE.json`

原因：

- `.gsd/composed-lite/state.yaml` 是运行态，不应进入 git；
- review / verification / postmortem artifacts 更适合作为本地可恢复状态；
- marker 更是运行态；
- 若直接复用 `smartStage()`，这些文件容易被误带入 commit。

**MVP 规则：**

- `state.yaml`：永不提交；
- `artifacts/*.yaml|md`：默认不提交；
- `logs/**`：永不提交；
- 只有用户明确要求"把 design doc 一起提交"时，才允许白名单加入。

### 12.2 Phase 6 的提交实现

MVP 直接使用底层 git 能力：

- `nativeAddPaths()` 精确 stage；
- `nativeCommit()` 创建 commit；
- `GitServiceImpl.autoCommit()` / `commit()` 不作为默认交付实现，因为它们内部会走 `smartStage()`。

### 12.3 commit message

MVP 采用固定前缀：

- `feat(composed-lite): <summary>`
- `fix(composed-lite): <summary>`
- `refactor(composed-lite): <summary>`

类型可按 impl-plan 总结推断；若无法判断则默认 `feat(composed-lite)`。

---

## 13. Anti-Drift Contracts（一级章节·Rev 2 新增）

以下契约全部由 **runtime 代码强制**，不依赖 prompt 自律。每条含：场景、防御实现、验证手段。

### C1 — 主 agent 永不执行 review 动作

**场景：** 主 agent 跳过 reviewer，自己写 review 结果。
**防御：** `review-harness.ts` 是 review 唯一入口；`runner.ts` 在 Phase 2/4/5 直接调用 harness；`writeArtifact` 对 `artifact_kind ∈ {design-review, code-review}` 校验 envelope `producer_kind === "subagent_reviewer"`（或 `runtime` 仅当 fallback self-review 开启且审计 flag 对应）。
**验证：** 单测：让 runner mock 一个"主 agent 返回已 reviewed"的响应，runtime 仍必须调 harness；Phase 7 drift detection 会检查每个 review phase `phase_exit` 前都有 `subagent_call`+`reviewer_verdict`。

### C2 — 跨 provider reviewer，失败即 fuse

**场景：** Picker 悄悄退化到主 provider 同模型，"看起来 reviewed"。
**防御：** `review-model-picker.ts` 严格模式；env 缺对侧凭据 → `ReviewerUnavailableError` → runner fuse `review_unavailable`。env var 后门开启才允许 fallback，且同时写 audit log + state flag + Phase 7 drift warning。
**验证：** 单测：主 Claude 无 OpenAI/Gemini 凭据时 picker 必须 throw；E2E：开启后门后 postmortem 报告必须出现 `self_review_used`。

### C3 — Verification 由 runtime 直接 spawn

**场景：** Agent 编造 "all tests passed"。
**防御：** `verification-runner.ts` `child_process.spawn`；report 由 runtime 拼装；envelope `producer_kind = verification_runner`，`provider/model = null`；主 agent / reviewer 只读。
**验证：** 单测：把 `npm test` 映射到 `exit 1`，runner 必须在 `verification-report.md` 中写真实 exit 1 且 Phase 5 标 fail；drift warning 捕获任何声称 pass 但 exit ≠ 0 的情况。

### C4 — Phase 顺序由代码强制

**场景：** Agent 跳过 research 直接 design。
**防御：** `runner.ts` 硬编码 phase 序列；每个 phase 进入前校验前序 phase `status === completed`（或 skipped in plan mode）；反向跳跃会被 reject。
**验证：** 单测：人为把 state.yaml 改成 `current_phase = 4` 但 Phase 1-3 没 completed，runtime 必须拒绝并重置。

### C5 — Git diff 是实现真值源

**场景：** Agent 报告 "implemented" 但无实际代码改动或仅改注释。
**防御：** Phase 4 结束前 runtime 跑 `git diff baseline..HEAD`；空 diff → `implementation_empty_diff` fuse；仅 whitespace/注释/格式化 → `implementation_noop_diff`（1 次 retry）。
**验证：** 单测：mock worker 返回 "done" 但不改任何文件，Phase 4 必须 fail。

### C6 — Admission 显式批准闸门

**场景：** Runtime 无用户确认就进入 Phase 1。
**防御：** `admission.state` 状态机；`admission_hash` 锁定；所有后续 artifact envelope carry `admission_hash`；后续 phase 启动校验 `state.admission.state === "approved"`。
**验证：** 单测：人为把 `admission.state = awaiting_approval` 但调 Phase 1 enter → 必须 reject；人为改 `admission.yaml` 但不更新 hash → 下次 phase 启动触发 `admission_tampered`。

### C7 — Artifact envelope 强 schema

**场景：** 主 agent 人工写一个假的 `design-review.yaml` 放到位。
**防御：** 所有 artifact 必须经 `writeArtifact` 写入；`verifyEnvelope` 在 recovery / phase enter / postmortem 都会调；envelope 缺字段 / hash 不匹配 / run_id 不匹配 / admission_hash 不匹配 → reject。
**验证：** 单测：手写一个没有 envelope 的 `design-review.yaml` → recovery 时 Phase 2 必须 `pending` 并重跑。

### C8 — Audit log hash 链

**场景：** 事后修改日志掩盖 drift。
**防御：** `audit-log.ts` 每条事件 `prev_digest + entry_digest`；`verifyAuditChain()` 在 Phase 7 必跑；broken chain → `audit_log_tampered`。
**验证：** 单测：删除中间一行 → verify 必须 fail 并指出 bad_seq。

### C9 — Recovery 走 hash 验证而非存在性

**场景：** 手动把旧的 `design-doc.md` 拷进来，runtime 误以为 Phase 2 已完成。
**防御：** §5.5 invariants 在 `loadState` 必跑；`output_hash` 对不上就重置 phase。
**验证：** 单测：state 标 Phase 2 completed + envelope 合法，但 design-doc.md 被 touch → recovery 重置 Phase 2。

### C10 — Run lock，单 executor

**场景：** 两个终端同时 `/gsd workflow composed-lite`。
**防御：** `run-lock.ts` pid-based；存活 pid 持锁 → refuse。
**验证：** 单测：mock 第一个 runtime 写了 live lock，第二个启动必须报错退出。

### C11 — Revision 不走"追加模式"

**场景：** Phase 2 design reviewer fail 两轮后，主 agent 在原 doc 末尾"补一段然后自宣 pass"。
**防御：** Phase 2 revision 路径是 design-doc.md 重写；revision 用尽 → fuse；无"in-place append"绕道。
**验证：** 单测：让 reviewer 连续两轮 fail，runtime 必须 fuse `design_review_exhausted`，不可进入 Phase 3。

### C12 — Subagent 身份不可伪造

**场景：** 主 agent 伪造一个 "我是 reviewer 的输出"。
**防御：** review-harness 是唯一生成 review artifact 的通道；envelope 中 `producer_id` 由 subagent runner 注入，主 agent 无法控制；`provider/model` 来自 picker 决议而非 agent 自称。
**验证：** 代码审查 + 单测：envelope producer_id/provider/model 字段写入只发生在 harness 内部。

### C13 — Phase 7 强制执行

**场景：** fuse 后直接退出，掩盖 drift。
**防御：** runner fuse 分支不 `return`，而是 `goto Phase 7`；Phase 7 完成后再设置终态。
**验证：** 单测：任意 fuse 路径都产生 `postmortem-report.yaml`。

### C14 — `impl-plan.acceptance` 强 schema

**场景：** Phase 3 主 agent 给出 `acceptance: code exists` 的假断言，Phase 4 轻松"通过"。
**防御：** `artifacts.ts` 对 `impl-plan.yaml` 做 schema 校验，每 step 至少 1 条 `kind ∈ {file_exists, file_contains, grep, ast_match, test_pass}` 的可机器验证断言；Phase 4 runtime 逐条执行。
**验证：** 单测：人写一个无合法 acceptance 的 impl-plan → Phase 3 必须 fail。

---

## 14. 错误处理与熔断

### 14.1 熔断原因枚举

```
budget_time_exhausted
verify_reentry_exhausted
consecutive_failures
admission_rejected
admission_tampered               # 新增 (C6)
review_unavailable               # 新增 (C2)
review_parse_exhausted           # 新增 (review-harness 解析重试用尽)
design_review_exhausted          # 新增 (C11)
code_review_exhausted
implementation_empty_diff        # 新增 (C5)
implementation_noop_diff         # 新增 (C5)
audit_log_tampered               # 新增 (C8)
state_integrity_error            # 新增 (C9，loadState invariants fail 且无法恢复)
lock_conflict                    # 新增 (C10) — 注意：此 case 是 startup refuse，不进入 state；但 audit log 记录
```

### 14.2 触发效果

- 设置 `status: fused`；
- 当前业务 phase 停止推进；
- **仍执行 Phase 7** 生成 postmortem（C13）。

### 14.3 reviewer 失败处理

- reviewer 输出无法 parse 成 YAML：重试 1 次；
- 连续失败：`fuse_reason = review_parse_exhausted`（Rev 2 不再默认降级为 "issues"）；
- 解析成功但 `overall_assessment = fail` 或 `issues`：进入 revision 流程（Phase 2/4 的 revision_round），用尽后按 `design_review_exhausted` / `code_review_exhausted` fuse。

### 14.4 verify 回环

- Phase 5 失败时抽取 `last_verify_failure`；
- 回到 Phase 4；
- `verify_reentry_count++`；
- 达到上限则 fuse `verify_reentry_exhausted`。

---

## 15. 文件清单（修订版）

### 15.1 新建

```text
src/resources/extensions/gsd/composed-lite/
├── index.ts
├── runner.ts
├── state.ts
├── budget.ts
├── artifacts.ts
├── review-model-picker.ts
├── review-harness.ts
├── verification-runner.ts          # ← Rev 2 新增
├── audit-log.ts                    # ← Rev 2 新增
├── run-lock.ts                     # ← Rev 2 新增
├── prompts/
├── phases/
└── tests/

src/resources/extensions/gsd/workflow-templates/composed-lite.md
src/resources/agents/composed-lite-reviewer.md
```

### 15.2 修改

| 文件 | 改动 | 原因 |
|---|---|---|
| `src/resources/extensions/gsd/workflow-templates/registry.json` | 新增 `composed-lite` 条目及 `executor_extension` | registry 发现与 `/gsd start` 支持 |
| `src/resources/extensions/gsd/workflow-templates.ts` | `TemplateEntry` 增 `executor_extension?` | 读取 registry 元数据 |
| `src/resources/extensions/gsd/workflow-plugins.ts` | `WorkflowPluginMeta` 增 `executorExtension?`，解析 markdown meta / registry | plugin runtime 绑定 |
| `src/resources/extensions/gsd/commands/handlers/workflow.ts` | runtime-owned markdown plugin 分发到 composed-lite runtime | `/gsd workflow composed-lite` |
| `src/resources/extensions/gsd/commands-workflow-templates.ts` | `/gsd start composed-lite` 走 runtime-owned dispatch | `/gsd start composed-lite` |
| `src/resources/extensions/gsd/commands/handlers/status.ts`（或同类） | 识别 STATE.json marker `type === "runtime-owned"` 分支，显示 runtime state 摘要 | `/gsd status` 可发现 |
| `src/resources/extensions/gsd/commands/handlers/resume.ts`（或同类） | 识别 marker 后委派 composed-lite runtime 恢复 | `/gsd resume` 可发现 |
| `src/resources/extensions/subagent/index.ts` | 增加 `modelOverride` 支持 | reviewer 独立模型 |
| `docs/dev/proposals/composed-lite-design.md` | 本文档 | Rev 2 |

### 15.3 明确不改

- `src/resources/extensions/gsd/workflow-engine.ts`
- `src/resources/extensions/gsd/workflow-events.ts`
- `src/resources/extensions/gsd/git-service.ts` 的默认 smartStage 语义
- `src/resources/extensions/slash-commands/*`

---

## 16. 测试策略（按 Anti-Drift Contract 交叉覆盖）

### 16.1 Unit

| 测试 | 覆盖契约 |
|---|---|
| `state.ts`：初始化 / 恢复 / 默认值补齐 / 原子写 / marker projection / invariants | C4, C6, C7, C9 |
| `budget.ts`：三类 fuse | — |
| `artifacts.ts`：envelope 校验 / hash 校验 / 非法 kind 拒绝 / impl-plan acceptance schema | C7, C14 |
| `review-model-picker.ts`：主 Claude 时 picker 行为（OpenAI 可用 / 不可用 / fallback 后门） | C2 |
| `review-harness.ts`：主 agent 不能绕过；YAML parse / retry / fuse | C1, C2 |
| `verification-runner.ts`：真实 spawn test fake 脚本（exit 0 / exit 1）；tail 截断；结果落盘 | C3 |
| `audit-log.ts`：append-only；hash 链；`verifyAuditChain` 能检出断链 | C8 |
| `run-lock.ts`：stale lock 清理；live lock 拒绝 | C10 |

### 16.2 Integration

- `/gsd workflow composed-lite <req>` 可启动 runtime；
- `/gsd start composed-lite <req>` 可启动同一 runtime；
- plan 模式跳过 4/5/6 并生成 skip marker artifact；
- verify→implement 回环（3 次上限 fuse）；
- reviewer parse failure 重试一次后 fuse；
- Phase 6 精确 stage 不带入 `.gsd/composed-lite/**` 与 `.gsd/STATE.json`；
- Admission reject → fuse + Phase 7；
- Admission approved_hash 被篡改 → recovery fuse。

### 16.3 End-to-end（mock subagent）

- mock scout / worker / reviewer；
- 跑 full 模式；
- 断言所有 artifacts envelope 合法、audit chain 完整、state 终态、git commit；
- 模拟崩溃后恢复（phase running → pending，hash mismatch 重跑）；
- 模拟 reviewer fallback self-review 后门 → postmortem 报告 `self_review_used`；
- 模拟 verify reentry 超限 fuse；
- 模拟主 agent"报告已实现"但 diff 为空 → fuse `implementation_empty_diff`；
- 模拟 audit log 手动改动 → Phase 7 报 `audit_log_tampered`。

---

## 17. 里程碑计划（修订版）

| 里程碑 | 内容 | 交付 |
|---|---|---|
| D1 | workflow metadata 绑定 + runtime-owned dispatch 骨架 + STATE.json marker | `/gsd workflow composed-lite` / `/gsd start composed-lite` 能调到空 runtime；`/gsd status` 可发现 marker |
| D2 | state / budget / artifacts / envelope / audit-log / run-lock / runner 主循环 | 本地 full / plan 骨架可跑，所有契约框架就位 |
| D3 | Phase 0-3：admission 状态机 + scout research + design review + impl-plan 强 schema | plan 模式走通 + C4/C6/C7/C11/C14 单测通过 |
| D4 | subagent `modelOverride` + picker 严格模式 + review-harness + verification-runner + Phase 4/5 | review / verify 回环走通 + C1/C2/C3/C5 单测通过 |
| D5 | Phase 6/7 + git 精确提交 + Phase 7 drift detection + E2E 补齐 | full 模式 PR ready + C8/C9/C10/C12/C13 覆盖 |

---

## 18. Open Questions（修订后）

| # | 问题 | 选项 | 当前建议 |
|---|---|---|---|
| Q1 | plugin 与 runtime 的绑定字段命名 | `extension` / `executor_extension` / `runtime_extension` | **`executor_extension`** |
| Q2 | composed-lite runtime 放哪 | 顶层 extension / `gsd/composed-lite/` | **放进 gsd/** |
| Q3 | reviewer 模型选择的数据源 | 当前 session model / model router / prefs | 先封装在 `review-model-picker.ts`，实现时从现有 model/router 层取值 |
| Q4 | Phase 0 澄清问题是否走 remote questions | 主对话 / remote questions | **主对话** |
| Q5 | design-doc 是否允许进入 git | 默认不提交 / 默认提交 | **默认不提交** |
| Q6 | 是否需要额外 codebase research agent | 复用 scout / 新增专用 | **先复用 scout** |
| Q7 | 恢复时若 state 与 artifacts 不一致 | 优先 state / 优先 artifact 校验 | **优先 artifact hash 校验**（§5.5） |
| Q8 | 后续是否再加 `/gsd cl` | 否 / 是 | **后续再加** |
| Q9 (Rev 2) | `fallback_self_review` 是完全删除还是 env-var 后门保留 | 删除 / 保留后门 | **保留后门**，默认 fuse，打开后需显式 env var 且全量审计 |
| Q10 (Rev 2) | artifact 父依赖是否做完整 Merkle 链 | 紧邻前序 hash / 完整父图 | **MVP 只做紧邻前序 + admission_hash 锚点**；完整父图入 OOM |
| Q11 (Rev 2) | Phase 7 drift detection 不通过是否影响 exit code | 仅记录 / 影响 | **仅记录为 drift_warnings**；不自动回写 fuse（除 chain broken / hash mismatch 这类硬证据）|
| Q12 (Rev 2) | CLI 交互式 reviewer（codex/claude/gemini CLI） | MVP / OOM | **OOM**，独立 epic |

---

## 19. 验收标准（MVP Done）

### 19.1 功能

- [ ] `composed-lite` 已加入 workflow registry，且可通过 `/gsd workflow composed-lite ...` 启动；
- [ ] `/gsd start composed-lite ...` 可启动同一 runtime；
- [ ] 不依赖 workflow phase hooks；
- [ ] `.gsd/composed-lite/state.yaml` 可初始化、恢复、更新；
- [ ] `.gsd/STATE.json` marker 被写入，`/gsd status` 可发现；
- [ ] plan 模式可跑 0-3+7，并写 4/5/6 skip marker artifact；
- [ ] full 模式可跑 0-7；
- [ ] reviewer 支持 per-call model override；
- [ ] verify 失败可回到 implement，并最多重入 3 次。

### 19.2 反漂移契约（每条都需专项测试）

- [ ] C1  主 agent 不能执行 review（runner 强制调 harness）；
- [ ] C2  跨 provider reviewer 失败即 fuse；
- [ ] C3  Verification 由 runtime spawn；
- [ ] C4  Phase 顺序由代码强制；
- [ ] C5  git diff 是真值源（空 diff → fuse）；
- [ ] C6  Admission 显式 approve 状态机 + `admission_hash` 锁定；
- [ ] C7  ArtifactEnvelope 校验（hash、run_id、admission_hash）；
- [ ] C8  Audit log hash 链，Phase 7 必验；
- [ ] C9  Recovery hash 验证 > 存在性；
- [ ] C10 Run lock 拒绝并发；
- [ ] C11 Phase 2 revision 用尽即 fuse，无 append 后门；
- [ ] C12 Subagent 身份由 harness 注入，不可伪造；
- [ ] C13 Fuse 仍执行 Phase 7；
- [ ] C14 impl-plan.acceptance 强 schema。

### 19.3 基础

- [ ] Phase 6 只提交白名单文件，`.gsd/composed-lite/**` 与 `.gsd/STATE.json` 默认不进入 commit；
- [ ] `npm test` / `npm run build` 通过；
- [ ] 文档与测试补齐。

---

## 20. 后续工作（Out of MVP）

1. 把 composed-lite runtime 从 `gsd/` 内部模块抽成独立 extension；
2. 抽象公共 review harness 给其他 workflow 复用；
3. 支持 `/gsd cl` / `/cl`；
4. 支持 temp workspace / worktree 隔离；
5. 支持退出防护；
6. 完整 reviewer capability probe（version / model list / 配额）；
7. 完整 artifact 父依赖 Merkle 链；
8. CLI 交互式 reviewer（codex/claude/gemini CLI 接入）；
9. 把 learnings 注入 knowledge graph；
10. 若未来平台化 phase hooks，再考虑把 composed-lite runtime 回收为统一 workflow engine 插件。

---

## 附录 A — workflow template 草稿（修订版）

```markdown
# Composed-Lite Design Pipeline

<template_meta>
name: composed-lite
version: 1
mode: markdown-phase
requires_project: true
artifact_dir: null
executor_extension: composed-lite
triggers: composed-lite, design-and-ship, full design, 设计方案
</template_meta>

<purpose>
Run the composed-lite design-to-delivery workflow using the dedicated GSD runtime.
This template is runtime-owned: it does not use the default workflow-start prompt path.
Requires a git project; state lives in .gsd/composed-lite/.
</purpose>

<phases>
0. admission
1. research
2. design
3. split
4. implementation
5. verification
6. delivery
7. postmortem
</phases>
```

---

## 附录 B — reviewer agent 草稿

```markdown
---
name: composed-lite-reviewer
description: Independent structured reviewer for composed-lite phases 2/4/5
model: sonnet
---

You are an independent reviewer for the composed-lite workflow.

Rules:
1. Read only the provided targets.
2. Do not propose implementation unless needed to explain a defect.
3. Output EXACTLY one YAML document.
4. Keys must be:
   - overall_assessment
   - critical
   - important
   - minor
   - rationale
5. Each item in critical/important/minor must include: id, target, rationale.
6. If reviewing design, focus on correctness, coverage, edge cases, missing alternatives,
   and whether the proposed split can actually produce a working implementation.
7. If reviewing code, focus on correctness, security, and contract adherence.
8. If reviewing verification, focus on whether the evidence really proves the feature works.
9. Do not claim to have executed commands; verification evidence comes from runtime spawns,
   not from you.
```

---

## 附录 C — ArtifactEnvelope TypeScript types

```ts
export type ArtifactKind =
  | "admission"
  | "research-brief"
  | "design-doc"
  | "design-review"
  | "impl-plan"
  | "implementation-summary"
  | "code-review"
  | "verification-report"
  | "delivery-report"
  | "postmortem-report";

export type ProducerKind =
  | "runtime"
  | "main_agent"
  | "subagent_scout"
  | "subagent_worker"
  | "subagent_reviewer"
  | "verification_runner";

export interface ArtifactEnvelope {
  schema_version: 1;
  run_id: string;
  phase: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
  attempt: number;
  revision_round?: number;
  artifact_kind: ArtifactKind;
  producer_kind: ProducerKind;
  producer_id: string;
  provider: string | null;
  model: string | null;
  admission_hash: string;
  prev_phase_output_hash: string | null;
  input_hash: string;
  raw_log_hash: string;
  raw_log_path: string;
  output_hash: string;
  created_at: string;
}
```

---

## 附录 D — Audit log 事件 schema

所有事件共享 base：

```ts
interface AuditEventBase {
  seq: number;
  ts: string;
  run_id: string;
  prev_digest: string | null;
  entry_digest: string;
  event: string;
  payload: unknown;
}
```

MVP 事件类型与 payload：

```ts
type AuditEvent =
  | (AuditEventBase & { event: "run_start"; payload: { mode: "full" | "plan"; requirement_hash: string; main_model: string; env_fingerprint: EnvFingerprint } })
  | (AuditEventBase & { event: "admission_evidence"; payload: { evidence_message_ids: string[] } })
  | (AuditEventBase & { event: "admission_approved"; payload: { admission_hash: string } })
  | (AuditEventBase & { event: "admission_rejected"; payload: { reason: string } })
  | (AuditEventBase & { event: "phase_enter"; payload: { phase: number; attempt: number; revision_round?: number } })
  | (AuditEventBase & { event: "phase_exit"; payload: { phase: number; attempt: number; outcome: "completed" | "failed" | "skipped" | "fused"; failure_reason: string | null; output_hash: string | null } })
  | (AuditEventBase & { event: "subagent_call"; payload: { phase: number; agent: string; model: string; provider: string; input_hash: string } })
  | (AuditEventBase & { event: "subagent_result"; payload: { phase: number; agent: string; raw_log_hash: string; parsed_ok: boolean } })
  | (AuditEventBase & { event: "reviewer_verdict"; payload: { phase: number; overall_assessment: "pass" | "issues" | "fail"; critical_count: number; important_count: number } })
  | (AuditEventBase & { event: "reviewer_fallback_self_review"; payload: { main_model: string; fallback_model: string; env_vars_set: string[] } })
  | (AuditEventBase & { event: "verification_run"; payload: { results: VerifyCommandResult[] } })
  | (AuditEventBase & { event: "git_commit"; payload: { sha: string; committed_files: string[] } })
  | (AuditEventBase & { event: "fuse"; payload: { fuse_reason: string } })
  | (AuditEventBase & { event: "state_save"; payload: { state_hash: string } })
  | (AuditEventBase & { event: "postmortem_complete"; payload: { drift_warnings: string[] } });
```

---

*End of Rev 2.*
