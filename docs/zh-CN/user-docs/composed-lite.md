# Composed-lite 工作流

Composed-lite 是 GSD 的第二套工作流运行时——一个严格按阶段推进的循环
（准入 → 调研 → 设计 → 拆分 → 实施 → 验证 → 交付 → 复盘），并内建跨
provider 的代码评审。与自动模式不同，每个阶段都会产出一份已签名的工件，
且每次评审都在**独立子代理**中完成，**不能**与主代理共享上下文。

适合使用 composed-lite 的场景：

- 任务风险较高，需要一个独立的代码评审者。
- 你希望逐阶段检查工件化的检查点。
- 你想把 GSD 与外层 agent（Windsurf / Claude Code / Codex）组合，同时把
  阶段执行留在 GSD 内部。

## 目录

- [快速开始](#快速开始)
- [模型选择](#模型选择)
  - [各角色当前使用的模型](#各角色当前使用的模型)
  - [Reviewer 选型（picker）](#reviewer-选型picker)
  - [环境变量覆盖](#环境变量覆盖)
- [Windsurf 集成](#windsurf-集成)
- [状态与工件](#状态与工件)
- [故障排查](#故障排查)

## 快速开始

```bash
cd /path/to/git/repo

# 进入交互式 GSD session
gsd

# Plan 模式：走完准入 + 调研 + 设计 + 评审即停
/gsd start composed-lite --plan "给 /api/upload 加限流"

# Full 模式：plan + 实施 + 验证 + 交付
/gsd start composed-lite "给 /api/upload 加限流"

# 恢复一次被打断的运行（读取 .gsd/STATE.json 标记）
/gsd start resume

# 对处于 admission 暂停状态的运行予以批准
/gsd start resume --approve

# Headless 模式也会在首个命令之后保留 composed-lite 的内层 flags
gsd headless start composed-lite --plan "给 /api/upload 加限流"
gsd headless start resume --approve
```

Composed-lite 当前通过内联 flag 解析模式与准入控制：使用 `--plan`、`--approve`、`--reject`。像 `plan`、`full` 这样的裸位置参数会被当作 requirement 文本的一部分，而不是模式选择器。

如果通过 `gsd headless start` 启动，headless 现在会保留首个位置命令之后的未知 flag，并把它们透传给内层 `/gsd start ...`。也就是说，`--plan`、`--approve`、`--reject` 这类 composed-lite 内联 flag 现在在交互式与 headless 两条路径里都能正常工作。

Composed-lite 要求仓库必须是 git 仓库，否则会直接拒绝运行。全新项目请先 `git init`。

## 模型选择

Composed-lite 需要运行多种子代理角色。每个角色都会 spawn 一个全新的 GSD CLI 子进程（`node loader.js --mode json -p --no-session ...`）。模型选择是**按角色独立**的：主 agent（scout / design / split / worker）设置了 `GSD_COMPOSED_LITE_MAIN_MODEL[_PROVIDER]` 时遵循它，否则回退到子 CLI 的 session 默认；reviewer 角色则始终由 reviewer picker 决定。

### 各角色当前使用的模型

| 角色 | Spawner | 模型来源 |
|------|---------|----------|
| P1 scout | `runScout` | 已设置 `GSD_COMPOSED_LITE_MAIN_MODEL[_PROVIDER]` 时用它，否则沿用 GSD session 默认 |
| P2 design | `generateDesign` | 同 scout |
| P3 split | 内联 split spawner | 同 scout |
| P4 impl | `spawnWorker` | 同 scout |
| P2 / P4 review | `spawnReviewer` | **Reviewer picker**（见下文）——始终以 `--model provider/id` 形式传入 |
| P5 verify | `verification-runner` | 不调用 LLM（只执行命令 / 校验） |

若**未**设置 `GSD_COMPOSED_LITE_MAIN_MODEL`，主 agent spawner 不会追加 `--model`，子 GSD CLI 会使用自己的 session 默认模型——这是 Sprint 1c 之前 的默认行为，也是当前的兜底行为。

### Reviewer 选型（picker）

Reviewer picker 负责落实 Contract C2——**跨 provider 评审**，解析顺序如下：

1. **显式覆盖**：`GSD_COMPOSED_LITE_REVIEWER_MODEL` 与/或
   `GSD_COMPOSED_LITE_REVIEWER_PROVIDER`。两者都会被校验；若目标 provider
   不可用，composed-lite 会以 `review_unavailable` 触发 fuse，而**不会**
   静默回退。
2. **自动跨 provider 选择**：从 `[anthropic, openai, google]` 中剔除主
   provider，取第一个就绪的候选。
3. **自审逃生舱**：只有同时设置 `GSD_COMPOSED_LITE_ALLOW_SELF_REVIEW=1`
   与 `GSD_COMPOSED_LITE_FALLBACK_CONTINUE=1` 时才启用。仅适合试验用途，
   因为单 provider 自审违背 picker 的意义。

就绪判定会综合考虑 GSD 支持的所有凭据来源（`auth.json`、env、OAuth、
外部 CLI 如 `claude-code`），不只看环境变量。

### 环境变量覆盖

从 v2.77 起新增（对应 Windsurf 集成的 Sprint 1a）。所有变量都在
`runComposedLite` 启动时读取，并写入 `.gsd/composed-lite/state.yaml` 的
`review.*` 字段。

| 变量 | 作用 | 示例 |
|------|------|------|
| `GSD_COMPOSED_LITE_MAIN_MODEL` | 强制 scout / design / split / worker 子代理使用的 model id，同时驱动 reviewer picker。未设置时，主 agent spawner 回退到子 CLI 的 session 默认。 | `gpt-5.4` |
| `GSD_COMPOSED_LITE_MAIN_MODEL_PROVIDER` | 用 provider 限定 `main_model`（以 `--model provider/id` 传入）；同时在 reviewer picker 中跳过子串推断。`main_model` 是自定义别名或多 provider 注册同一 id 时必须设置。 | `openai` |
| `GSD_COMPOSED_LITE_REVIEWER_MODEL` | 强制指定 reviewer model id。 | `claude-sonnet-4-6` |
| `GSD_COMPOSED_LITE_REVIEWER_PROVIDER` | 强制指定 reviewer provider。与 `REVIEWER_MODEL` 同时使用，可以在多 provider 注册同一 id 时消歧。 | `anthropic` |
| `GSD_COMPOSED_LITE_ALLOW_SELF_REVIEW` | `1` 时允许 reviewer picker 回退到主 provider。 | `1` |
| `GSD_COMPOSED_LITE_FALLBACK_CONTINUE` | `1` 时才真正启用自审回退。两个 flag 必须同时设置。 | `1` |
| `GSD_COMPOSED_LITE_SUBAGENT_TIMEOUT_MS` | 覆盖 scout / design / split / worker / reviewer 子进程的默认超时。默认 10 分钟。 | `900000` |

> **Model id 踩坑提醒**：Anthropic / Claude Code / Opencode 上的
> Claude 4 系列注册为 `claude-sonnet-4-6`（连字符），只有 GitHub Copilot
> 使用 `claude-sonnet-4.6`（点号）。CLI 做严格匹配，id 不匹配会**静默
> 回退到 session 默认模型**。拿不准时，用 GSD session 内的 `/model` 查
> 一下 registry 实际暴露的 id。

示例：

```bash
export ANTHROPIC_API_KEY=sk-ant-...
export OPENAI_API_KEY=sk-...
export GSD_COMPOSED_LITE_MAIN_MODEL=gpt-5.4
export GSD_COMPOSED_LITE_MAIN_MODEL_PROVIDER=openai
export GSD_COMPOSED_LITE_REVIEWER_MODEL=claude-sonnet-4-6
export GSD_COMPOSED_LITE_REVIEWER_PROVIDER=anthropic

gsd
/gsd start composed-lite --plan "..."
```

## Windsurf 集成

Windsurf / Cascade 担任**外层 agent**——处理对话、运行工具（MCP、
终端）——而 composed-lite 跑在一个终端里的 GSD 子进程中。关键分工：

- **Windsurf 模型**（例如 GPT-5.4）负责 IDE 里的聊天 UX、代码编辑、终端
  命令。
- **Composed-lite 子代理**是 GSD CLI 子进程。它们的模型选择由 GSD 的凭据
  与上面那张 env 表控制，**与 Windsurf 无关**。

### 配置步骤

1. **确保凭据对 Windsurf 继承的终端可见**。推荐走 `auth.json`（通过
   `gsd config` 落盘），比依赖 shell profile 的 env 更稳。
2. **在 `~/.codeium/mcp_config.json` 里注册 `gsd-mcp-server`**：

   ```json
   {
     "mcpServers": {
       "gsd-workflow": {
         "command": "npx",
         "args": ["-y", "gsd-mcp-server@latest", "--project", "/ABS/PATH/TO/your/project"]
       }
     }
   }
   ```

   在 **Settings → Tools → Windsurf Settings** 里 Refresh 工具列表。注意
   `gsd-mcp-server` 只暴露工作流管理类工具（milestone / slice / task /
   decision / summary 等）；composed-lite 的 `start` / `resume` /
   `status` **不是** MCP 工具，只能从终端运行。

3. **通过 Cascade 的终端工具触发 composed-lite**：

   ```bash
   cd /ABS/PATH/TO/your/project
   export GSD_COMPOSED_LITE_REVIEWER_MODEL=claude-sonnet-4-6
   export GSD_COMPOSED_LITE_REVIEWER_PROVIDER=anthropic
   gsd
   /gsd start composed-lite --plan "..."
   ```

4. **查看 state 与工件** — Cascade 可直接读取
   `.gsd/composed-lite/state.yaml` 以及 `.gsd/composed-lite/artifacts/`
   下的产物，继续与你对话。

### Windsurf 现阶段做不到的事情

- **让 Windsurf 的内置模型驱动 composed-lite 的子代理**。子代理是 GSD
  CLI 子进程，Windsurf 的模型触及不到。
- **通过 MCP 触发 composed-lite**。目前只能用终端工具；MCP 包装未来再评估。

## 状态与工件

Composed-lite 在项目内独占以下路径：

- `.gsd/composed-lite/state.yaml` — 运行时权威 state（phase 指针、admission
  hash、review 裁决、fuse 原因）。
- `.gsd/composed-lite/artifacts/` — 每个阶段的签名 YAML / Markdown 产物
  （`research-brief.yaml`、`design-doc.md`、`code-review.yaml`、
  `implementation-summary.md` 等）。
- `.gsd/composed-lite/logs/audit-cl-YYYYMMDD-NN.jsonl` — 仅追加的审计日志。
  每一次 spawn / review / budget / fuse 事件都会落在这里。
- `.gsd/composed-lite/logs/raw/` — 子代理的原始 JSONL 输出，用于事后复盘。文件名现在按 `run_id` 分域（例如 `cl-20260421-04-2-0-reviewer-0.jsonl`），避免不同运行之间相互覆盖。
- `.gsd/STATE.json` — 单写标记，`/gsd start resume` 通过它发现运行。

运行时在项目粒度上遵循单写原则：同一时刻只有一个 composed-lite 运行能持锁。
崩溃恢复基于 state 文件 + lock。

## 故障排查

### `ReviewerUnavailableError`：`No cross-provider reviewer available`

当前只有单个 provider 的凭据可用，picker 无法选出跨 provider 的 reviewer。
可选方案：

- 追加第二个 provider 的 key（`ANTHROPIC_API_KEY` / `OPENAI_API_KEY` /
  `GEMINI_API_KEY`）。
- 显式设置 `GSD_COMPOSED_LITE_REVIEWER_MODEL` + `_REVIEWER_PROVIDER`
  （对 externalCli provider 如 `claude-code` 尤其有用）。
- 作为最后手段，同时设置 `GSD_COMPOSED_LITE_ALLOW_SELF_REVIEW=1` 与
  `GSD_COMPOSED_LITE_FALLBACK_CONTINUE=1`。

### `ReviewerUnavailableError`：`...has no vetted default model`

你把 `GSD_COMPOSED_LITE_REVIEWER_PROVIDER` 设成了一个 picker 没有内置默认
reviewer model 的 provider（例如 `openai-codex`、`github-copilot` 或任意
自定义 provider）。解决办法：同时设置 `GSD_COMPOSED_LITE_REVIEWER_MODEL`
为该 provider 上注册的具体 model id。picker 故意**不会**回退到通用的
`claude-sonnet-4-6`——否则会静默命中错误的 provider 产生错误计费。

当前内置默认模型的 provider 列表：`anthropic`、`openai`、`google`、
`claude-code`。

### `ComposedLiteFuseError`：`review_unavailable`

Reviewer 子代理以上游 provider 错误终止（401、quota 耗尽、spawn 失败
等）。查看 `.gsd/composed-lite/logs/raw/<run-id>-<phase>-<attempt>-reviewer-<round>.jsonl`
拿到原始 API 报错，修复凭据 / provider 就绪状态后 `/gsd start resume`。

### 某个阶段看起来像被慢子代理卡住了

scout / design / split / worker / reviewer 子进程现在都有统一超时保护。
默认每个子代理 10 分钟；如果你的环境需要更短或更长的窗口，可以在开跑前设置
`GSD_COMPOSED_LITE_SUBAGENT_TIMEOUT_MS`。超时会以显式 terminal error 的形式落到
audit log 和 raw log 中，而不是把整个 phase 无限挂住。

### Reviewer 命中了错误的 provider

症状：日志显示 `--model claude-sonnet-4-6`，但计费落到了 Claude Code（本
来想用 Anthropic API）。

原因：多个 provider 注册了同一 model id。Composed-lite 会构造
`--model provider/id` 来消歧，但前提是它知道 reviewer provider。请把
`GSD_COMPOSED_LITE_REVIEWER_PROVIDER` 一起设上（或直接让 picker 自动
选）。

### `claude-sonnet-4.6` 静默回退到 session 默认模型

Model id 是严格相等匹配。Anthropic / Claude Code / Opencode 注册的都是
`claude-sonnet-4-6`（连字符），点号版本只在 GitHub Copilot 存在。除非你
真的针对 Copilot，否则都应该用连字符。

### 运行卡在 `awaiting_approval`

这是设计行为：composed-lite 在 admission 阶段默认暂停。带 `--approve`
或 `--reject` 重新触发即可：

```bash
gsd
/gsd start resume --approve
/gsd start resume --reject
```

### 锁被其他进程持有

Composed-lite 在项目粒度强制单写，lock 位于
`.gsd/composed-lite/run.lock`。上一次运行如果崩溃，直接删掉 lock 再跑；
如果确认还有进程在跑，就等它结束。

---

架构与设计讨论见
[`docs/dev/proposals/composed-lite-design.md`](../../dev/proposals/composed-lite-design.md)
和
[`docs/dev/proposals/windsurf-composed-lite-integration.md`](../../dev/proposals/windsurf-composed-lite-integration.md)。
