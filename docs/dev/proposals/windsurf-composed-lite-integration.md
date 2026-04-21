# Windsurf × composed-lite 集成方案

> Status: Proposal · Draft v2
> Scope: 让 Windsurf/Cascade 成为 GSD composed-lite 的外层 agent，同时把 composed-lite 本身的执行流程修到"能稳定跑完一整轮"的状态。
> Related: `docs/dev/proposals/composed-lite-design.md`
> Revision history:
> - v1 (initial draft) → 架构方向正确但存在事实错误
> - v2 (本版)：修正 v1 在 `main_model` 驱动范围、reviewer spawn provider 传递、picker 默认 model id、已有修复状态等四处事实偏差；新增 picker `claude-sonnet-4.6` 命名不匹配的 live bug

---

## 1. 背景与目标

### 1.1 背景

用户希望在 Windsurf 中继续使用 GSD composed-lite 工作流：

- **主对话层**：Windsurf/Cascade 内置 agent（如 GPT-5.4）
- **工作流引擎**：GSD composed-lite（scout → design → review → split → implementation → verification）
- **工作流管理工具**：通过 `gsd-mcp-server` 暴露给 Windsurf

### 1.2 关键事实（已代码核实）

- composed-lite 的 scout / design / reviewer / worker 子代理**固定 spawn GSD CLI 子进程**（`node loader.js --mode json -p --no-session ...`），不会直接 spawn `claude` / `codex` 可执行文件。
- **只有 reviewer 在 spawn 时显式传 `--model`**；scout / design / worker 目前 **不传** `--model`，因此子代理用的是 GSD 默认模型，而不是 `main_model` 字段记录的值。`main_model` 目前只是 picker 的依据和 audit 记录字段，不是执行控制入口。（纠正 v1 的事实错误）
- composed-lite 的主模型与 reviewer 模型**不是**由外层 Windsurf 决定，而是由 GSD 内部 provider + model registry + API key 决定。
- `gsd-mcp-server` 目前只暴露 workflow 管理类工具（milestone / slice / task / decision / summary 等），**不暴露 `composed-lite start/resume/status`**。
- GSD 已内置 `externalCli` provider auth 模式，`claude-code` extension 已注册为 `externalCli`（见 `src/resources/extensions/claude-code-cli/index.ts`）；已在 registry 暴露 `claude-opus-4-6` / `claude-opus-4-7` / `claude-sonnet-4-6` / `claude-haiku-4-5`（连字符版本）。Codex 没有对应 extension。
- Anthropic / Opencode / Antigravity 等 built-in provider 的 Claude 4 系列 model id **统一用连字符**（`claude-sonnet-4-6`），只有 github-copilot 用点号（`claude-sonnet-4.6`）。`gemini-2.5-pro` / `gpt-5.4` 等非 Claude 系列用点号。

### 1.3 目标

#### Phase 1（本方案首要目标）
- 通过 **API key** 模式把 composed-lite 一整轮流程（plan 模式 + full 模式）跑通。
- 修复执行流程中的已知 bug，使其在 API key 模式下稳定、错误可诊断、不会把上游 API 错误误判为 parse 失败。
- 让 Windsurf 能够：
  - 通过 MCP 调用 GSD workflow 工具
  - 通过 terminal 触发 composed-lite 运行
  - 在 composed-lite 失败时能看到真实错误原因

#### Phase 2（后续扩展）
- 支持 **externalCli** 模式作为 LLM 后端：
  - 复用现有 `claude-code` provider 让 reviewer 走 Claude Code CLI
  - 新增 `codex` extension，支持 Codex CLI 作为 provider
- 允许 reviewer / scout / design 等角色按策略选择 externalCli 或 API key。

### 1.4 非目标

- **不**把 composed-lite 包装成 MCP tool（短期内保持 terminal 触发）。
- **不**让 Windsurf 内置模型（GPT-5.4 等）替代 composed-lite 子代理 LLM。
- **不**重构 composed-lite 主流程；只做最小必要修复与 override 扩展。

---

## 2. 现状与关键事实审核

### 2.1 composed-lite 子代理 spawn 链路（现状）

文件：`src/resources/extensions/gsd/composed-lite/`

| 阶段 | Spawner | 是否显式传 `--model` | 目前使用的模型 |
|---|---|---|---|
| P1 scout | `phases/p1-research.ts::runScout` | **否** | GSD 默认模型（session / settings） |
| P2 design | `phases/p2-design.ts::generateDesign` | **否** | GSD 默认模型 |
| P2 review | `review-harness.ts::spawnReviewer` | **是**（传 bare `model`，不带 provider） | `review.reviewer_model`（由 picker 决定） |
| P3 split | `phases/p3-split.ts` | **否** | GSD 默认模型 |
| P4 impl | `phases/p4-implementation.ts::spawnWorker` | **否** | GSD 默认模型 |
| P5 verify | `verification-runner.ts` | N/A | 不需要 LLM（runtime 直接执行命令） |

所有 spawner 都用：

```ts
spawn(process.execPath, [gsdBin, ...extensionArgs, ...args], {...});
```

**CLI 模型解析**（`src/cli.ts`）：

```ts
const match =
  available.find((m) => m.id === cliFlags.model) ||
  available.find((m) => `${m.provider}/${m.id}` === cliFlags.model);
```

- 优先匹配 bare `id`，然后匹配 `provider/id`
- **无匹配时静默不 setModel**，保留 session 默认

**结论**：
- 外部 CLI 不是 spawn 目标，只是 GSD CLI 内部通过 `externalCli` provider 可能调用的 LLM 后端。
- 想让 reviewer 稳定命中特定 provider（尤其 `claude-code` vs `anthropic` 共享同一 model id 时），reviewer spawn 必须传 **`provider/id`** 而不是 bare `id`。
- 想让 scout / design / worker 也受 `main_model` 控制，必须给它们补 `--model` plumbing。

### 2.2 reviewer provider 选择

文件：`composed-lite/review-model-picker.ts`

- `inferProvider(modelId)` 通过字符串子串推断 provider（`gpt|o1|codex` → openai；`claude|sonnet|opus|haiku` → anthropic；`gemini` → google）。
- `hasProviderCredentials(provider, env)` **只读 `process.env`**，不查 `auth.json`。
- 默认 reviewer model：anthropic → `claude-sonnet-4.6`；openai → `gpt-5.4`；google → `gemini-2.5-pro`。
- 无跨 provider 可用时，除非 `GSD_COMPOSED_LITE_ALLOW_SELF_REVIEW=1` + `GSD_COMPOSED_LITE_FALLBACK_CONTINUE=1`，否则抛 `ReviewerUnavailableError`。

### 2.3 main_model 来源

文件：`composed-lite/runner.ts`

优先级：
1. `pi.getSessionInfo().model`
2. `process.env.GSD_SESSION_MODEL`
3. `process.env.ANTHROPIC_MODEL`
4. `"unknown"`

### 2.4 已知问题清单（v2 更新）

| # | 严重度 | 位置 | 症状 | 现状 |
|---|---|---|---|---|
| B0 | **Critical (live bug)** | `review-model-picker.ts::defaultReviewerModel` | 当 provider 是 anthropic 时返回 `claude-sonnet-4.6`（点号），但 Anthropic / Claude Code registry 实际注册为 `claude-sonnet-4-6`（连字符）。CLI 严格相等匹配找不到 → 静默回退到 session 默认模型，**跨 provider reviewer 实际没生效** | 未修 |
| B0b | **Critical** | `review-harness.ts::spawnReviewer` | 只传 bare `--model <id>`，不传 provider；当多个 provider 注册了同一 model id（anthropic + claude-code + opencode 都有 `claude-sonnet-4-6`）时无法稳定命中目标 provider | 未修 |
| B1 | High | `review-model-picker.ts::hasProviderCredentials` | 只看 env，auth.json 里的 key 对 picker 不可见；externalCli provider（claude-code）永远判为不可用 | 未修 |
| B2 | High (partial) | 各 phase spawner（`p1-research`, `p2-design`, `p3-split`, `p4-implementation`） | spawn 错误 / exitCode ≠ 0 时默默 resolve 空 output。P2 / P1 已在**结果处理层**接入 `parseSubagentTerminalResult` + audit；但 `runScout` / `generateDesign` / `spawnWorker` 的 Promise 仍然静默回落空串，**spawn 本身没有显式失败语义** | 部分修 |
| B3 | High | `review-harness.ts::runReview` | 上游 API 错误被当 parse 失败，最终报 `review_parse_exhausted` | **已修**：`review-harness.ts:238-286` 现在先跑 `parseSubagentTerminalResult`，命中 terminalError → `throw ComposedLiteFuseError("review_unavailable", ...)`。v1 描述过时 |
| B4 | Medium | `review-model-picker.ts::inferProvider` | 子串匹配脆弱；自定义别名 / 国产模型可能被判为 `unknown` | 未修 |
| B5 | Medium | `runner.ts::main_model` fallback 链 | 没有独立 override 入口，外部 agent 接入时需借用 `GSD_SESSION_MODEL` 语义混淆 | 未修 |
| B6 | Low | `review-harness.ts` reviewer system prompt inline | 定制性差 | 不在本次范围 |
| B7 | Medium（Phase 2 才凸显） | `claude-code-cli/stream-adapter.ts` default permissionMode = `bypassPermissions` + allowed `Write/Edit` | reviewer 继承时权限边界过宽；且默认假设“宿主 Claude Code session 已同意”，在 Windsurf 场景不成立 | 未修 |

Phase 1 必须修：**B0 / B0b / B1 / B2 剩余部分 / B4 / B5**。  
B3 已修，v2 不再重复设计。  
B6 / B7 留到后续。

---

## 3. 架构

```
┌─────────────────────────────────────────────────────────┐
│ Windsurf / Cascade                                      │
│  - 主对话 agent（Cascade 内置模型，例如 GPT-5.4）       │
│  - 代码编辑、调试、终端命令                             │
│  - MCP client                                           │
└───────────────┬──────────────────┬──────────────────────┘
                │                  │
                │ MCP (stdio)      │ terminal (shell)
                ▼                  ▼
   ┌─────────────────────┐  ┌──────────────────────────────┐
   │ gsd-mcp-server      │  │ gsd CLI                      │
   │ - workflow tools    │  │ - /gsd start composed-lite   │
   │ - milestone / slice │  │ - runner.ts 驱动 P1..P5       │
   │ - summary / decision│  │ - spawn 子代理（仍是 gsd CLI）│
   └─────────┬───────────┘  └────────────┬─────────────────┘
             │                           │
             ▼                           ▼
     ┌──────────────────────────────────────┐
     │ GSD runtime shared state             │
     │ - ~/.gsd/agent/auth.json             │
     │ - ~/.gsd/agent/models.json           │
     │ - .gsd/composed-lite/{STATE, logs}   │
     └──────────────────────────────────────┘
                  │
                  ▼
     ┌──────────────────────────────────────┐
     │ LLM 后端                             │
     │  Phase 1: API key providers          │
     │    - openai / anthropic / google     │
     │  Phase 2: externalCli providers      │
     │    - claude-code (已存在)            │
     │    - codex (新增 extension)          │
     └──────────────────────────────────────┘
```

关键边界：

- **Windsurf 内置模型** 只在 Cascade 主对话里生效；从不进入 composed-lite。
- **composed-lite 主模型 & reviewer 模型** 由 GSD 内部解析（provider + auth）决定。
- **API key / externalCli** 的选择权在 GSD 而非 Windsurf。

---

## 4. Phase 1 — API key 模式端到端跑通

### 4.1 先决条件

1. Node ≥ 22，GSD 仓库已 `npm install && npm run build`
2. 至少持有两个 provider 的 API key（用于跨 provider reviewer），例如：
   - `OPENAI_API_KEY`
   - `ANTHROPIC_API_KEY`
3. 通过 `~/.gsd/agent/auth.json` **或** 环境变量写入（见 4.2）
4. Windsurf 已安装，且 `~/.codeium/mcp_config.json` 可写

### 4.2 Key 放置策略

GSD 的完整加载优先级（见 `packages/pi-coding-agent/src/core/auth-storage.ts`）：

```
runtime override (--api-key)
  > auth.json
  > 环境变量（OPENAI_API_KEY / ANTHROPIC_API_KEY / …）
  > models.json fallback（仅 custom provider）
```

**推荐配置**：
- 主路径：`auth.json`（`gsd auth login <provider>` 或在 onboarding 中写入）
- 冗余：对 composed-lite 的 picker 而言，env 是**必须**的（见 B1）。

为让 picker 能正确感知可用 provider，Phase 1 要求：
- 运行 composed-lite 的 shell 必须能看到 `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `GEMINI_API_KEY` 中**至少两个** provider 的 key。
- 或者按 4.3.1 的 B1 修复，让 picker 也查 auth.json。

### 4.3 Bug 修复清单（v2）

#### B0. 修正 picker 默认 reviewer model id（Critical · live bug）

**修改**：`review-model-picker.ts::defaultReviewerModel`

- 把 anthropic 分支默认值从 `claude-sonnet-4.6` 改为 **`claude-sonnet-4-6`**，与 Anthropic / Claude Code / Opencode registry 的连字符命名对齐。
- 同步修正 default fallback 分支。
- openai (`gpt-5.4`) 与 google (`gemini-2.5-pro`) 保持点号，已与 registry 一致。

**验证**：单测确保 `pickReviewerModel({ mainModel: "gpt-5.4" })` 选出的 anthropic reviewer model id 不包含点号 `.` 在 `4-6` 位置。

#### B0b. reviewer spawn 传 provider-qualified model（Critical）

**修改**：`review-harness.ts::spawnReviewer`

- 调用方改传完整 `{ provider, model }`，harness 内部构造 `${provider}/${model}` 作为 `--model` 参数。
- CLI 的第二条匹配分支（`${m.provider}/${m.id}`）即可稳定命中目标 provider，不受 bare-id 冲突影响。

**不改 CLI 解析逻辑**：现有二段匹配足够。

**验证**：审核模式下读源码级断言 `--model`, `${pickerResult.provider}/${pickerResult.model}` 组合出现；单测检查 spawn args。

#### B1. picker 依赖 `isProviderReady` 回调（High）

**修改**：`review-model-picker.ts`

- `pickReviewerModel` 新签名：
  ```ts
  pickReviewerModel(input: {
    mainModel: string;
    env: NodeJS.ProcessEnv;
    isProviderReady?: (provider: string) => boolean;
  }): PickerResult
  ```
- `isProviderReady` 未提供时，退化为当前基于 env 的默认实现（向后兼容、单测可直接跑）。
- `runner.ts` 注入 `modelRegistry.isProviderRequestReady.bind(modelRegistry)`，从而同时覆盖：
  - apiKey provider：`auth.json` 或 env
  - externalCli provider（Phase 2A 使用）：`isReady()` 已内置

**关键设计决策**：放弃 `hasCredentials` 这个词，直接复用 GSD 已有的 `ModelRegistry.isProviderRequestReady` 抽象。Phase 2 接入 externalCli 时**无需再重构 picker API**。

**验证**：单测中注入模拟 `isProviderReady`，验证 picker 在不同 provider readiness 组合下的行为。

#### B2 剩余部分. spawn 层显式失败（High）

**现状**：P1 / P2 的**结果处理**已接入 `parseSubagentTerminalResult`；但 `runScout` / `generateDesign` / `spawnWorker` 在 `proc.on('error')` 或 `gsdBin == null` 时仍静默 resolve 空串。

**修改（本次范围内只做与 Windsurf 接通相关的最小改动）**：
- 结构性重构统一 spawner 留到独立 ticket（不在 Windsurf 集成这一轮的阻塞路径）。
- 本轮仅确保 reviewer 一侧 spawn 错误不会被 rawOutput 为空遮蔽（由 B3 既有修复承接）。

**留给后续 ticket**：新增 `composed-lite/subagent-spawn.ts` 统一共享，5 个 spawner 迁移，见 §7 Sprint 1b。

#### B4. provider 推断扩展（Medium）

**修改**：`review-model-picker.ts`

- 新增 `GSD_COMPOSED_LITE_MAIN_MODEL_PROVIDER`：当设置时，跳过 `inferProvider` 的子串推断，直接使用该值。
- 当 override 不存在且 `inferProvider` 返回 `unknown` → picker 继续用原逻辑尝试其它 provider，不影响既有行为。

#### B5 + override 设计（High，Phase 1 必需）

新增四个 override 环境变量：

| 环境变量 | 作用 | 优先级 |
|---|---|---|
| `GSD_COMPOSED_LITE_MAIN_MODEL` | 强制 composed-lite `main_model` 字段 | > `GSD_SESSION_MODEL` > session info > `ANTHROPIC_MODEL` > `unknown` |
| `GSD_COMPOSED_LITE_MAIN_MODEL_PROVIDER` | 强制主 provider | > `inferProvider(main_model)` |
| `GSD_COMPOSED_LITE_REVIEWER_MODEL` | 强制 reviewer model | > `defaultReviewerModel(provider)` |
| `GSD_COMPOSED_LITE_REVIEWER_PROVIDER` | 强制 reviewer provider | > `inferProvider(reviewer_model)` |

**校验逻辑**（在 `pickReviewerModel` 中）：
- 显式 `REVIEWER_MODEL` + `REVIEWER_PROVIDER` 都存在：
  - 必须通过 `isProviderReady(provider)` 校验
  - 否则抛 `ReviewerUnavailableError`，message 里带“显式指定但 provider 未就绪”
- 只显式了 `REVIEWER_MODEL`：
  - 通过 `inferProvider(reviewerModel)` 推断 provider
  - 再走 readiness 校验
- 都没显式：维持现有跨 provider 自动选择 + `defaultReviewerModel` 回落

**修改位置**：
- `composed-lite/runner.ts`：main_model 初始化新增 override，runner 里同时解析 `GSD_COMPOSED_LITE_MAIN_MODEL_PROVIDER` 并直接写入 state（供 picker 跳过 inferProvider）。
- `composed-lite/review-model-picker.ts`：reviewer 选择新增 override 与 readiness 校验。

### 4.4 Windsurf 接入配置

#### 4.4.1 MCP server

Windsurf 的 MCP 配置文件：`~/.codeium/mcp_config.json`（**不是** `.mcp.json`）。

推荐配置（本地开发 repo 场景）：

```json
{
  "mcpServers": {
    "gsd-workflow": {
      "command": "node",
      "args": [
        "/ABS/PATH/TO/gsd-2/packages/mcp-server/dist/cli.js"
      ],
      "cwd": "/ABS/PATH/TO/your-project",
      "env": {
        "GSD_CLI_PATH": "/ABS/PATH/TO/gsd-2/dist/loader.js",
        "GSD_BIN_PATH": "/ABS/PATH/TO/gsd-2/dist/loader.js",
        "GSD_PROJECT_ROOT": "/ABS/PATH/TO/your-project"
      }
    }
  }
}
```

**注意**：
- API key 不建议写进 `mcp_config.json`（会以明文落盘）。
- 依赖 `auth.json` 或 shell inherit 到 Windsurf 进程的 env。
- 配置改完在 Windsurf 的 `Settings → Tools → Windsurf Settings` 里按 Refresh。

#### 4.4.2 composed-lite 触发

当前阶段通过 **terminal 工具**触发：

```bash
# 进入 Windsurf 终端或让 Cascade 代你跑
cd /ABS/PATH/TO/your-project

# 注意：此处只影响 reviewer 的模型选择与 audit 记账；
# scout / design / worker 仍然使用 GSD 的 session 默认模型
# （由 ~/.gsd/agent/settings.json 或 /model 选择决定）
export GSD_COMPOSED_LITE_MAIN_MODEL=gpt-5.4              # 主 agent 用 OpenAI
export GSD_COMPOSED_LITE_MAIN_MODEL_PROVIDER=openai
export GSD_COMPOSED_LITE_REVIEWER_MODEL=claude-sonnet-4-6  # 注意连字符
export GSD_COMPOSED_LITE_REVIEWER_PROVIDER=anthropic

gsd --project . -c "/gsd start composed-lite plan \"任务描述...\""
```

Windsurf 的 Cascade 可以直接代执行这类命令；composed-lite 的 state / log / artifact 都会写到 `.gsd/composed-lite/`。

**现状 vs 目标**：

| 能力 | Phase 1 现状（Sprint 1a + 1c 后） | 备注 |
|---|---|---|
| reviewer 模型受控 | **是**（Sprint 1a 修复 B0 / B0b 后稳定命中指定 provider） | picker + `--model provider/id` |
| scout / design / split / worker 模型受控 | **是**（Sprint 1c `--model` plumbing 落地） | 读 `state.review.main_model[_provider]`，未设置时仍回退 session 默认 |
| 终端错误分类 | 部分（reviewer 已修 B3；P1 / P2 结果层已接 terminal parser） | 余下 spawner 的结构化 spawn-error 层留给 Sprint 1b.1 |

#### 4.4.3 模型 id 存在性预检

在跑之前必须确认：

```bash
gsd models list        # 或等价命令
```

- 确认待用的 main/reviewer model id 都在 registry 里。
- 不在的话，通过 `~/.gsd/agent/models.json` 自定义，或换用已存在的别名。

### 4.5 验证计划（Phase 1）

**验证 1**：auth 路径
- `gsd doctor providers` 显示 openai + anthropic 均为 ✓（source 来源清晰）。

**验证 2**：单测
- `review-model-picker.test.ts` 覆盖 B1/B4/B5 的新逻辑。
- `review-harness.test.ts` 覆盖 B3 错误分类。
- 每个 phase 的 spawner 单测覆盖 B2。

**验证 3**：plan 模式最小 E2E
- 随便挑一个小需求跑 `gsd /gsd start composed-lite plan "…"`。
- 预期：phase 1、phase 2、phase 3 全部 pass，产出 `research-brief.yaml`、`design-doc.md`、`impl-plan.yaml`、对应 review artifact。

**验证 4**：坏 key 回归
- 故意把 `ANTHROPIC_API_KEY` 设成无效值，跑 plan 模式。
- 预期：fuse 类型为 `review_invocation_failed`（不再是 `review_parse_exhausted`），错误信息指向 API 401。

**验证 5**：full 模式小改动
- 跑一个只改一行的 full 模式 composed-lite。
- 预期：P4 worker 完成，P5 verification 命令成功，`git diff` 非空。

**验证 6**：Windsurf 端到端
- 在 Windsurf 里让 Cascade 通过 MCP 查看当前 milestone 列表。
- 在 Windsurf 里通过 Cascade 终端执行 composed-lite plan 命令。
- 完成后 Cascade 读取产物并继续后续对话。

---

## 5. Phase 2 — externalCli 作为 LLM 后端

> 前置条件：Phase 1 / 1b / 1c 全部验证通过；不在 Phase 1 并行开发。

### 5.1 目标（拆分为 2A / 2B）

- **Phase 2A**：**reviewer** 支持 externalCli（claude-code 已现成；codex 新增 extension）。风险最小，因为 reviewer spawn 在 B0b 后已具备 provider-qualified model 能力。
- **Phase 2B**：scout / design / worker 支持指定 provider / model（包括 externalCli）。需要先完成 Phase 1c 的 spawner plumbing。

用户订阅的 Claude Max / Codex plan 可直接被 composed-lite 利用，**不消耗独立 API 计费**。

### 5.2 Phase 2A：reviewer 走 externalCli

#### 5.2.1 接入点

- `claude-code` provider 已注册为 `externalCli`，`baseUrl=local://claude-code`。
- reviewer 通过 `GSD_COMPOSED_LITE_REVIEWER_MODEL=claude-opus-4-6` + `GSD_COMPOSED_LITE_REVIEWER_PROVIDER=claude-code` 指向 externalCli provider。
- 由于 Phase 1 已把 reviewer spawn 改成传 `provider/model`，Phase 2A 无需再动 spawner。

#### 5.2.2 Picker 对 externalCli 的感知

**Phase 1 的 `isProviderReady` 抽象已经覆盖 externalCli 场景**（`ModelRegistry.isProviderRequestReady` 内部对 externalCli 走 `isReady()`），所以 Phase 2A 不需要扩 picker API，只需确保 Phase 1 的 `runner.ts` 注入链路在 externalCli provider 上生效。

#### 5.2.3 选型策略扩展

Phase 2A 新增 env：

| 环境变量 | 作用 |
|---|---|
| `GSD_COMPOSED_LITE_REVIEWER_PREFER_EXTERNAL_CLI=1` | picker 优先选择 externalCli reviewer（前提是 `isProviderRequestReady` 通过） |

#### 5.2.4 reviewer 权限最小化（B7 应对）

- `claude-code-cli/stream-adapter.ts` 默认 `permissionMode="bypassPermissions"` 且 allowed tools 含 `Write/Edit`。reviewer 的职责是只读评审，不应继承写权限。
- 新增契约：当 `claude-code` provider 被用于 reviewer subagent 时：
  - 默认切换到 `permissionMode="plan"`
  - 允许工具裁剪为 `Read` / `Glob` / `Grep`（及只读 `Bash`）
  - 可通过 `GSD_COMPOSED_LITE_REVIEWER_PERMISSION_MODE` 显式覆盖
- 在 `buildSdkOptions` 外层引入按“subagent 角色”读的 hint（可通过 env 或 `GSD_SUBAGENT_ROLE=reviewer` 标识），具体接法在 Phase 2A 设计时再敲定。

### 5.3 Phase 2B：新增 `codex-cli` extension

复用 `src/resources/extensions/claude-code-cli/` 作为模板：

1. 新目录：`src/resources/extensions/codex-cli/`
2. 注册：

```ts
pi.registerProvider("codex", {
  authMode: "externalCli",
  api: "openai-responses",     // 或 "openai-chat-completions"，取决于 codex CLI 能暴露的协议
  baseUrl: "local://codex",
  isReady: isCodexReady,       // 检查 codex CLI 是否在 PATH 且已登录
  streamSimple: codexStreamSimple,
});
```

3. 实现 `codex-stream-adapter.ts`：把 pi-ai 的 `SimpleStreamOptions` 转成 `codex exec` 或 `codex` 子进程调用，逐段读取并转成 pi-ai 事件流。
4. 在 extension 入口注册一组 model id（例如 `codex/gpt-5.4`、`codex/o1-pro` 等），与 Codex CLI 当前可用模型对齐。

**风险**：Codex CLI 的输出格式可能与 Claude Code SDK 不一样，streamSimple 的实现会需要类似 `stream-adapter.ts` 的翻译层。Phase 2 中规划成一个独立子任务。

### 5.4 Phase 2 验证

- 单测：
  - Picker 在 `PREFER_EXTERNAL_CLI=1` 下选 claude-code / codex。
  - Picker 在 externalCli 不 ready 时回落到 API key provider。
- 集成：
  - reviewer 走 Claude Code CLI，跑完 plan 模式，audit 显示 `provider=claude-code`。
  - reviewer 走 Codex CLI，跑完 plan 模式，audit 显示 `provider=codex`。

---

## 6. 风险与未决问题

| 风险 | 说明 | 缓解 |
|---|---|---|
| R1 | composed-lite 子代理在 GSD CLI 子进程里初始化时仍需要联通 auth.json；若 Windsurf 终端环境和 shell 环境不一致，可能造成"手动 cli 能跑、Windsurf 触发不能跑" | 文档明确：Windsurf 终端继承环境由 Windsurf 决定；建议把 key 放 auth.json 而非依赖 shell profile |
| R2 | B1 修好后，picker 查 auth.json 需要一个安全的接口（不能泄漏 key）；必须只暴露 `hasAuth(provider)` 布尔接口 | 在 `review-model-picker` 注入 boolean 回调，不传 AuthStorage 实例本身 |
| R3 | override 环境变量数量增加，组合空间变大；某些组合可能互斥（如显式指定 reviewer provider 但与 model 不匹配） | 在 `runner.ts` 启动时做一次校验并落到 audit，不符合就直接 fail fast |
| R4 | Phase 2 的 codex-cli extension 工程量不小（stream 翻译层 + 登录态检测） | 按独立 ticket 推进，不与 Phase 1 耦合 |
| R5 | MCP `gsd-workflow` 暴露面与 composed-lite 不一致：用户可能期望通过 MCP 直接驱动 composed-lite | 文档明确边界；如需，未来再新增 MCP tool 包装 |

---

## 7. 实施节奏（v2）

### Sprint 1a（本轮要做）：修 live bug + reviewer override

- **T1a.1** `review-model-picker.ts`：
  - B0 修正 anthropic default reviewer model id（点→连字符）
  - B1 新增 `isProviderReady` 回调 param
  - B4 支持 `GSD_COMPOSED_LITE_MAIN_MODEL_PROVIDER`
  - B5 支持 `GSD_COMPOSED_LITE_REVIEWER_MODEL` / `GSD_COMPOSED_LITE_REVIEWER_PROVIDER`
- **T1a.2** `review-harness.ts::spawnReviewer`：B0b 改用 `provider/model`
- **T1a.3** `runner.ts`：
  - `GSD_COMPOSED_LITE_MAIN_MODEL` / `_PROVIDER` 覆盖 `state.review.main_model` / `main_model_provider`
  - 注入 `modelRegistry.isProviderRequestReady` 给 picker
- **T1a.4** 单测（`review-model-picker.test.ts`）：
  - default reviewer model 命名
  - override 优先级
  - `isProviderReady` 注入行为
  - reviewer model / provider 显式 + 未就绪 → 抛错

### Sprint 1b：spawner 统一 + 文档

- T1b.1 新增 `composed-lite/subagent-spawn.ts` 共享工具，迁移 5 个 spawner（B2 完整版）— **未做**，拆到独立 ticket
- ✅ T1b.2 面向用户文档：合并到 `docs/user-docs/composed-lite.md`（含 Windsurf 集成小节）+ `docs/zh-CN/user-docs/composed-lite.md`，两处 README 索引同步；独立的 `windsurf-integration.md` 因内容重合而撤销
- T1b.3 `custom-models.md` / `providers.md` 把新 override env 补进去 — **未做**。env 已进 `composed-lite.md`，其余两篇继续保持 provider / models.json 的单一职责，不加重叠内容

### Sprint 1c：scout / design / worker plumbing ✅ 已完成

- ✅ T1c.1 给 `runScout` / `generateDesign` / `spawnWorker` / split spawner 加 `--model` 支持
- ✅ T1c.2 从 `state.review.main_model` + `main_model_provider` 统一注入 provider-qualified model；抽出 `composed-lite/model-arg.ts` 共享 `buildModelArg` + `resolveMainModelArg`
- ✅ T1c.3 单测（`composed-lite-model-arg.test.ts`）+ 源码级 regression 断言（`composed-lite-runtime-regression.test.ts` 新增两条）

### Sprint 2（Windsurf 接入验证）

- T2.1 Windsurf 端到端跑 plan + full 模式
- T2.2 归档 audit 样本

### Sprint 3（Phase 2A: externalCli reviewer）

- T3.1 reviewer permission mode 裁剪（B7）
- T3.2 `GSD_COMPOSED_LITE_REVIEWER_PREFER_EXTERNAL_CLI`
- T3.3 externalCli reviewer 端到端验证

### Sprint 4（Phase 2B: codex extension + main role externalCli）

- T4.1 `codex-cli` extension 骨架
- T4.2 Codex stream 翻译层
- T4.3 externalCli main role（scout/design/worker）
- T4.4 externalCli 端到端验证

---

## 8. 附录

### 8.1 新增 / 修改的环境变量汇总

| 环境变量 | Phase | 作用 |
|---|---|---|
| `GSD_COMPOSED_LITE_MAIN_MODEL` | P1 | 强制主模型 id |
| `GSD_COMPOSED_LITE_MAIN_MODEL_PROVIDER` | P1 | 强制主 provider |
| `GSD_COMPOSED_LITE_REVIEWER_MODEL` | P1 | 强制 reviewer 模型 id |
| `GSD_COMPOSED_LITE_REVIEWER_PROVIDER` | P1 | 强制 reviewer provider |
| `GSD_COMPOSED_LITE_ALLOW_SELF_REVIEW` | 已存在 | 允许 self-review fallback |
| `GSD_COMPOSED_LITE_FALLBACK_CONTINUE` | 已存在 | 与上条配合才真正生效 |
| `GSD_COMPOSED_LITE_REVIEWER_PREFER_EXTERNAL_CLI` | P2 | picker 优先选 externalCli reviewer |

### 8.2 文件改动索引

**Phase 1**
- `src/resources/extensions/gsd/composed-lite/subagent-spawn.ts`（新增）
- `src/resources/extensions/gsd/composed-lite/review-harness.ts`（改）
- `src/resources/extensions/gsd/composed-lite/review-model-picker.ts`（改）
- `src/resources/extensions/gsd/composed-lite/runner.ts`（改）
- `src/resources/extensions/gsd/composed-lite/phases/p1-research.ts`（改）
- `src/resources/extensions/gsd/composed-lite/phases/p2-design.ts`（改）
- `src/resources/extensions/gsd/composed-lite/phases/p3-split.ts`（改）
- `src/resources/extensions/gsd/composed-lite/phases/p4-implementation.ts`（改）
- `docs/user-docs/custom-models.md` / `docs/zh-CN/user-docs/custom-models.md`（文档更新）
- `docs/user-docs/providers.md` / `docs/zh-CN/user-docs/providers.md`（文档更新）
- `docs/user-docs/windsurf-integration.md` / `docs/zh-CN/user-docs/windsurf-integration.md`（新增面向用户文档）

**Phase 2**
- `src/resources/extensions/codex-cli/`（新增目录）
- `src/resources/extensions/gsd/composed-lite/review-model-picker.ts`（进一步扩展）

### 8.3 已放弃的思路

- **让 Windsurf 内置 GPT-5.4 驱动 composed-lite 内部子代理**：架构上做不到，子代理是 GSD CLI 子进程，不由 Windsurf 调度。
- **把 composed-lite 完整流程包装成 MCP tool**：工程量大，短期收益低，Phase 3 再评估。
- **通过 Windsurf `mcp_config.json` 直接写 API key**：安全性差，优先依赖 auth.json。
- **新增 `review_invocation_failed` fuse reason**：现有 `review_unavailable` 足以承载 terminal failure，新增枚举会引发 state / audit / 测试连锁改动，v2 已放弃。
- **在 Phase 1 一次性统一所有 spawner**：现状下 reviewer 是唯一显式传 `--model` 的 spawner，修 B0 / B0b 即可让 Windsurf 场景用起来；scout / design / worker plumbing 改动范围更大，拆到 Sprint 1c 降风险。
- **用 `hasCredentials` 作为 picker 抽象**：已改成 `isProviderReady`，一次抽象即可覆盖 apiKey / oauth / externalCli / none 四种模式，避免 Phase 2 再重构。
