# Composed-lite Workflow

Composed-lite is GSD's second workflow runtime — a strict, phase-driven loop
(admission → research → design → split → implementation → verify → delivery →
postmortem) with cross-provider code review built in. Unlike auto mode, every
phase produces a signed artifact and every review runs in a subagent that
**cannot** share the main agent's context.

Use composed-lite when:

- The task is high-stakes enough to warrant an independent code reviewer.
- You want artifact-based checkpoints you can inspect phase-by-phase.
- You want to compose GSD with an outer agent (Windsurf / Claude Code / Codex)
  while keeping phase execution inside GSD.

## Table of Contents

- [Quick Start](#quick-start)
- [Model Selection](#model-selection)
  - [What each role uses today](#what-each-role-uses-today)
  - [Reviewer selection (picker)](#reviewer-selection-picker)
  - [Environment overrides](#environment-overrides)
- [Windsurf Integration](#windsurf-integration)
- [State and Artifacts](#state-and-artifacts)
- [Troubleshooting](#troubleshooting)

## Quick Start

```bash
cd /path/to/git/repo
gsd

# Plan mode: run through admission + research + design + review, then stop
/gsd start composed-lite --plan "Add rate limiting to /api/upload"

# Full mode: plan + implementation + verify + delivery
/gsd start composed-lite "Add rate limiting to /api/upload"

# Resume an interrupted run (reads .gsd/STATE.json marker)
/gsd start resume

# Approve a run paused at admission
/gsd start resume --approve

# Headless mode preserves inner composed-lite flags after the first command
gsd headless start composed-lite --plan "Add rate limiting to /api/upload"
gsd headless start resume --approve
```

Composed-lite currently parses mode and admission control from inline flags:
use `--plan`, `--approve`, and `--reject`. Positional words like `plan` or
`full` are treated as part of the requirement text, not as mode selectors.

When launching through `gsd headless start`, headless now preserves unknown
flags after the first positional command and forwards them to the inner
`/gsd start ...` command. That means inline composed-lite flags like `--plan`,
`--approve`, and `--reject` work in both interactive and headless flows.

Composed-lite requires a git repository and will refuse to run if it doesn't
find `.git/`. Run `git init` first on greenfield projects.

## Model Selection

Composed-lite runs multiple subagent roles. Each role spawns a fresh GSD CLI
subprocess (`node loader.js --mode json -p --no-session ...`). Model selection
is **role-specific**: main-agent roles (scout / design / split / worker)
honour `GSD_COMPOSED_LITE_MAIN_MODEL[_PROVIDER]` when set and otherwise
fall through to the child CLI's session default; the reviewer role is
always driven by the reviewer picker.

### What each role uses today

| Role | Spawner | Model source |
|------|---------|--------------|
| P1 scout | `runScout` | `GSD_COMPOSED_LITE_MAIN_MODEL[_PROVIDER]` if set, else GSD session default |
| P2 design | `generateDesign` | Same as scout |
| P3 split | inline split spawner | Same as scout |
| P4 impl | `spawnWorker` | Same as scout |
| P2 / P4 review | `spawnReviewer` | **Reviewer picker** (see below) — always sent as `--model provider/id` |
| P5 verify | `verification-runner` | No LLM (runs commands / checks only) |

When `GSD_COMPOSED_LITE_MAIN_MODEL` is **not** set, main-agent spawners omit
`--model` entirely and the child GSD CLI uses its own session default —
this is the pre-Sprint-1c behaviour and remains the default.

### Reviewer selection (picker)

The reviewer picker enforces Contract C2 — **cross-provider review** — with
this resolution order:

1. **Explicit override** via `GSD_COMPOSED_LITE_REVIEWER_MODEL` and/or
   `GSD_COMPOSED_LITE_REVIEWER_PROVIDER`. Both fields are validated; if the
   named provider isn't ready, composed-lite fuses with
   `review_unavailable` rather than falling back silently.
2. **Automatic cross-provider** selection from
   `[anthropic, openai, google]`, skipping whichever provider is inferred
   from `main_model`. First ready candidate wins.
3. **Self-review escape hatch** when `GSD_COMPOSED_LITE_ALLOW_SELF_REVIEW=1`
   and `GSD_COMPOSED_LITE_FALLBACK_CONTINUE=1` are both set. Only use this
   for experiments — single-provider review defeats the point of the picker.

Readiness recognises all credential sources GSD supports (`auth.json`, env
vars, OAuth, external CLI like `claude-code`), not just environment
variables.

### Environment overrides

Added in v2.77 (Sprint 1a of the Windsurf integration). All variables are
read by `runComposedLite` at run start and persisted into
`.gsd/composed-lite/state.yaml` under `review.*`.

| Variable | Purpose | Example |
|----------|---------|---------|
| `GSD_COMPOSED_LITE_MAIN_MODEL` | Force the model id passed to scout / design / split / worker subagents, and drive the reviewer picker. When unset, main-agent spawners fall through to the child CLI's session default. | `gpt-5.4` |
| `GSD_COMPOSED_LITE_MAIN_MODEL_PROVIDER` | Qualify `main_model` with a provider (sent as `--model provider/id`). Also skips substring-based provider inference in the reviewer picker. Required when `main_model` is a custom alias or when multiple providers expose the same id. | `openai` |
| `GSD_COMPOSED_LITE_REVIEWER_MODEL` | Force a specific reviewer model id. | `claude-sonnet-4-6` |
| `GSD_COMPOSED_LITE_REVIEWER_PROVIDER` | Force the reviewer provider. Together with `REVIEWER_MODEL`, disambiguates when multiple providers register the same id. | `anthropic` |
| `GSD_COMPOSED_LITE_ALLOW_SELF_REVIEW` | `1` to permit the reviewer picker to fall back to the main provider. | `1` |
| `GSD_COMPOSED_LITE_FALLBACK_CONTINUE` | `1` to actually take the self-review fallback. Both flags are required. | `1` |
| `GSD_COMPOSED_LITE_SUBAGENT_TIMEOUT_MS` | Override the default per-subagent timeout for scout / design / split / worker / reviewer subprocesses. Defaults to 10 minutes. | `900000` |

> **Model id gotcha**: Claude 4 models register as `claude-sonnet-4-6`
> (connector) on Anthropic / Claude Code / Opencode, but `claude-sonnet-4.6`
> (dotted) on GitHub Copilot. The CLI does exact-match resolution; a
> mismatched id silently falls back to the session default. When in doubt,
> run `/model` inside a GSD session to confirm what your registry exposes.

Example:

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

## Windsurf Integration

Windsurf / Cascade acts as the **outer agent** — it drives the conversation
and runs tools (MCP, terminal) — while composed-lite runs inside a terminal
GSD subprocess. The split is important:

- **Windsurf model** (e.g. GPT-5.4) handles the chat UX, code edits, and
  terminal commands in the IDE.
- **Composed-lite subagents** are GSD CLI subprocesses. Their model choice is
  controlled by GSD credentials + the env vars above, not by Windsurf.

### Setup

1. **Ensure credentials are visible to the terminal Windsurf inherits from**.
   `auth.json` (via `gsd config`) is the recommended persistent path.
2. **Add `gsd-mcp-server` to `~/.codeium/mcp_config.json`**:

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

   Refresh tools from **Settings → Tools → Windsurf Settings**. Note that
   `gsd-mcp-server` exposes only workflow-management tools (milestones,
   slices, tasks, decisions, summaries) — composed-lite `start` / `resume` /
   `status` are **not** MCP tools and must be run from the terminal.

3. **Trigger composed-lite from the Cascade terminal tool**:

   ```bash
   cd /ABS/PATH/TO/your/project
   export GSD_COMPOSED_LITE_REVIEWER_MODEL=claude-sonnet-4-6
   export GSD_COMPOSED_LITE_REVIEWER_PROVIDER=anthropic
   gsd
   /gsd start composed-lite --plan "..."
   ```

4. **Inspect state and artifacts** — Cascade can read
   `.gsd/composed-lite/state.yaml` and anything under
   `.gsd/composed-lite/artifacts/` to continue the conversation.

### What Windsurf cannot do today

- **Drive composed-lite subagents with its inner model**. Subagents are GSD
  CLI subprocesses; Windsurf's model never reaches them.
- **Invoke composed-lite via MCP**. Use the terminal tool until a dedicated
  MCP wrapper exists.

## State and Artifacts

Composed-lite owns these paths inside the project:

- `.gsd/composed-lite/state.yaml` — canonical runtime state (phase cursor,
  admission hash, review verdicts, fuse reason).
- `.gsd/composed-lite/artifacts/` — signed YAML / Markdown outputs per
  phase (`research-brief.yaml`, `design-doc.md`, `code-review.yaml`,
  `implementation-summary.md`, etc.).
- `.gsd/composed-lite/logs/audit-cl-YYYYMMDD-NN.jsonl` — append-only audit
  log. Every spawn, review, budget, and fuse event is here.
- `.gsd/composed-lite/logs/raw/` — raw subagent JSONL output for
  post-mortems. Filenames are scoped by `run_id` (for example,
  `cl-20260421-04-2-0-reviewer-0.jsonl`) so concurrent or historical runs do
  not overwrite each other.
- `.gsd/STATE.json` — single-writer marker so `/gsd start resume`
  discovers the run.

The runtime is single-writer within a project: only one composed-lite run can
hold the lock at a time. Crash-recovery uses the state file plus the lock.

## Troubleshooting

### `ReviewerUnavailableError`: "No cross-provider reviewer available"

You have credentials for only one provider, so the picker cannot pick a
cross-provider reviewer. Options:

- Add a key for a second provider (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, or
  `GEMINI_API_KEY`).
- Set `GSD_COMPOSED_LITE_REVIEWER_MODEL` + `GSD_COMPOSED_LITE_REVIEWER_PROVIDER`
  explicitly (useful for externalCli providers like `claude-code`).
- As a last resort, set both `GSD_COMPOSED_LITE_ALLOW_SELF_REVIEW=1` and
  `GSD_COMPOSED_LITE_FALLBACK_CONTINUE=1`.

### `ReviewerUnavailableError`: "...has no vetted default model"

You set `GSD_COMPOSED_LITE_REVIEWER_PROVIDER` to a provider the picker does
not have a vetted default reviewer model for (e.g. `openai-codex`,
`github-copilot`, or any custom provider). Fix: also set
`GSD_COMPOSED_LITE_REVIEWER_MODEL` to a concrete model id registered on that
provider. The picker deliberately refuses to fall back to a generic
`claude-sonnet-4-6` — that would silently mis-bill the wrong provider.

Currently vetted providers with built-in defaults:
`anthropic`, `openai`, `google`, `claude-code`.

### `ComposedLiteFuseError`: "review_unavailable"

The reviewer subagent exited with a terminal provider error (401, quota
exhausted, process spawn failed). Check the raw log at
`.gsd/composed-lite/logs/raw/<run-id>-<phase>-<attempt>-reviewer-<round>.jsonl` for
the underlying API message. Fix credentials or provider readiness and
re-run `/gsd start resume`.

### A phase looks stuck on a slow subagent

Scout / design / split / worker / reviewer subprocesses now have a bounded
timeout. By default each subagent gets 10 minutes; if that is too low or too
high for your environment, set `GSD_COMPOSED_LITE_SUBAGENT_TIMEOUT_MS` before
starting the run. Timeout failures surface in the audit log and raw logs as
explicit terminal errors instead of leaving the phase hanging forever.

### Reviewer picked the wrong provider

Symptom: logs show `--model claude-sonnet-4-6` but the run consumed
credentials from the wrong provider (e.g. billing landed on Claude Code when
you expected Anthropic API).

Cause: multiple providers registered the same model id. Composed-lite builds
`--model provider/id` to disambiguate, but only when it knows the reviewer
provider. Make sure `GSD_COMPOSED_LITE_REVIEWER_PROVIDER` is set (or let the
picker pick it for you).

### `claude-sonnet-4.6` silently falls back to the session default

Model ids are matched exactly. The Anthropic / Claude Code / Opencode
providers register `claude-sonnet-4-6` (connector style). The dotted form
only exists on GitHub Copilot. Use the connector form unless you really are
targeting Copilot.

### Run is stuck in `awaiting_approval`

Composed-lite pauses at admission by design. Re-run with `--approve` or
`--reject`:

```bash
gsd
/gsd start resume --approve
/gsd start resume --reject
```

### Lock held by another process

Composed-lite enforces a per-project single-writer lock at
`.gsd/composed-lite/run.lock`. If a previous run crashed, delete the lock
and re-run. If another process is actively running, wait for it to finish.

---

For the architecture and design discussion see
[`docs/dev/proposals/composed-lite-design.md`](../dev/proposals/composed-lite-design.md)
and
[`docs/dev/proposals/windsurf-composed-lite-integration.md`](../dev/proposals/windsurf-composed-lite-integration.md).
