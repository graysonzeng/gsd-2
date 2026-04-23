# Composed-Lite Timeout Validation Handoff

**Date:** 2026-04-22  
**Scope:** Document timeout guidance, validate a real composed-lite run with longer windows, and capture the next true blocker for the next session.

## What changed

### Documentation updates
The following user-facing docs were updated so future runs do not accidentally use unrealistic timeout windows:

- `docs/user-docs/composed-lite.md`
- `docs/zh-CN/user-docs/composed-lite.md`

Both docs now explicitly state:

- Real end-to-end validation should not casually clamp subagents to `20000` / `30000` ms.
- `GSD_COMPOSED_LITE_SUBAGENT_TIMEOUT_MS` controls the inner per-subagent timeout.
- Headless outer `--timeout` must be set comfortably larger than the inner subagent timeout.
- A practical starting point for real validation is:

```bash
env GSD_COMPOSED_LITE_SUBAGENT_TIMEOUT_MS=180000 \
  gsd headless --timeout 600000 start composed-lite --approve "..."
```

## Real validation run that was executed

### Run identity
- **Run ID:** `cl-20260422-11`
- **Mode:** `full`
- **Main model:** `gpt-5.4` via `openai`
- **Reviewer model:** `claude-opus-4-6` via `claude-code`

### Command shape used for the successful long-window validation
A fresh `start composed-lite` attempt was blocked because an active runtime-owned run already existed for a different requirement string, so the run was continued with `resume`.

The validating resume command was:

```bash
env \
  GSD_COMPOSED_LITE_MAIN_MODEL=gpt-5.4 \
  GSD_COMPOSED_LITE_MAIN_MODEL_PROVIDER=openai \
  GSD_COMPOSED_LITE_REVIEWER_MODEL=claude-opus-4-6 \
  GSD_COMPOSED_LITE_REVIEWER_PROVIDER=claude-code \
  GSD_COMPOSED_LITE_SUBAGENT_TIMEOUT_MS=180000 \
  GSD_HEADLESS_HEARTBEAT_MS=5000 \
  npm run gsd -- headless --verbose --timeout 1200000 --max-restarts 0 \
    start resume --approve --ignore-review-findings
```

## Verified outcomes

### Resolved / no longer the front blocker
Phase 1 scout timeout is no longer the active blocker when realistic timeout windows are used.

Evidence from `./.gsd/composed-lite/logs/audit-cl-20260422-11.jsonl`:

- `seq 9`: `scout-prior_art` completed successfully
- `seq 10`: `scout-constraints_risks` completed successfully
- `seq 11`: `scout-codebase_scan` completed successfully
- `seq 12`: Phase 1 exited with `outcome: "completed"`

This confirms that the earlier short-window failures were budget-related, not the current root blocker.

### Current true blocker
The current real blocker is **Phase 2 reviewer timeout**.

Evidence from `./.gsd/composed-lite/logs/audit-cl-20260422-11.jsonl`:

- `seq 21`: reviewer subagent invoked in Phase 2 with:
  - `agent: composed-lite-reviewer`
  - `model: claude-opus-4-6`
  - `provider: claude-code`
- `seq 22`: reviewer returned:
  - `stop_reason: error`
  - `error_message: subagent timed out after 180000ms`
  - `parsed_ok: false`
- `seq 23`: runtime fused with `fuse_reason: review_unavailable`
- `seq 24`: Phase 2 exited fused with failure reason:
  - `Reviewer invocation failed | subagent timed out after 180000ms`

Final runtime result:

- `Phase 7: Postmortem — fused`
- `Fuse reason: review_unavailable`

## Important interpretation

The work completed in this session establishes the following:

- **Phase 1 scout timeout is no longer the main issue** under realistic timeout settings.
- **The next true blocker has moved to Phase 2 reviewer execution.**
- With `GSD_COMPOSED_LITE_SUBAGENT_TIMEOUT_MS=180000`, the reviewer is still timing out.
- The current blocker is therefore no longer “use longer timeout for Phase 1”, but rather:
  - determine whether reviewer simply needs a larger budget, or
  - determine whether reviewer is getting stuck / drifting / waiting in a pathological way.

## Key evidence files for the next session

### Audit log
- `./.gsd/composed-lite/logs/audit-cl-20260422-11.jsonl`

### Raw logs
- Phase 1 scout raw logs:
  - `./.gsd/composed-lite/logs/raw/cl-20260422-11-1-0-scout-prior_art.jsonl`
  - `./.gsd/composed-lite/logs/raw/cl-20260422-11-1-0-scout-constraints_risks.jsonl`
  - `./.gsd/composed-lite/logs/raw/cl-20260422-11-1-0-scout-codebase_scan.jsonl`
- Phase 2 design raw logs:
  - `./.gsd/composed-lite/logs/raw/cl-20260422-11-2-0-design-0.jsonl`
  - `./.gsd/composed-lite/logs/raw/cl-20260422-11-2-1-design-0.jsonl`
- **Most important next file to inspect:**
  - `./.gsd/composed-lite/logs/raw/cl-20260422-11-2-1-reviewer-0.jsonl`

## Recommended next-session starting point

### Primary recommendation
Start the new session by inspecting the reviewer raw log first:

- `./.gsd/composed-lite/logs/raw/cl-20260422-11-2-1-reviewer-0.jsonl`

Goal:

- determine whether the reviewer was making forward progress and merely needed more than 180 seconds, or
- determine whether it got stuck in a repeated or pathological pattern.

### Suggested next prompt for the new session
Use something close to this:

> Continue the composed-lite timeout investigation from `docs/superpowers/plans/2026-04-22-composed-lite-timeout-validation-handoff.md`. Do not revisit the Phase 1 timeout hypothesis first. Start by comparing `./.gsd/composed-lite/logs/raw/cl-20260422-11-2-1-reviewer-0.jsonl` with `./.gsd/composed-lite/logs/raw/cl-20260422-15-2-0-reviewer-0.jsonl`, and determine whether the repeated Phase 2 reviewer failure is a pure timeout-budget issue or a reviewer-behavior issue. Only after that, propose the minimal next fix and validation plan.

## Operational notes

- The resume command worked because it reused the existing runtime-owned run while it was still resumable in-session.
- The final state of `cl-20260422-11` is fused with `review_unavailable`; treat this run primarily as evidence, not as the next run to continue feature work from.
- A later failed Phase 1 run (`cl-20260422-14`) recorded `provider=openai model=gpt-5.4 ... status=401`, but subsequent minimal retests from the same repo/shell path succeeded for both a bare OpenAI call and a scout-like `--mode json --tools read,grep,find,ls,bash` call. Treat that `401` as a likely transient external/auth event unless a new real validation reproduces it.
- A fresh real validation run (`cl-20260422-15`) has now been executed with the recommended long-window settings. Phase 1 completed successfully, Phase 2 design completed successfully, and the run fused again at the reviewer with `review_unavailable`, so the active blocker has cleanly shifted back to the reviewer path.
- If a new validation run is needed after a fix, prefer a fresh run with a stable requirement string and realistic timeout budgets.

## Preflight and retry runbook for the next real validation

Use this sequence to avoid burning another long validation on stale runtime state or a transient provider issue.

### 1. Check current runtime state first

```bash
npm run gsd -- headless --verbose --max-restarts 0 --timeout 15000 start resume --status
```

Interpretation:

- If status is `active` and the lease PID still appears live, clear it deliberately before a fresh run.
- If status is `failed`, `fused`, `completed`, or `abandoned`, a fresh `start composed-lite ...` run is safe; no reset is required just to start a new requirement.

### 2. If an old local runtime is still live, force-abandon it

```bash
npm run gsd -- headless --verbose --max-restarts 0 --timeout 15000 start resume --abandon --force
```

Authority for this control lives in `src/resources/extensions/gsd/commands-workflow-templates.ts`; it SIGTERMs the live local lease, appends `run_abandoned`, and releases the run lock before the next attempt.

### 3. Reconfirm OpenAI preflight only if the previous failure shape was auth/provider-related

```bash
npm run gsd -- --bare --no-session --no-tools -p --provider openai --model gpt-5.4 "Reply with exactly OK and nothing else."

npm run gsd -- --mode json -p --no-session --tools read,grep,find,ls,bash --provider openai --model gpt-5.4 "Reply with exactly OK and nothing else."
```

If both succeed, do not keep looping on provider suspicion; proceed to the real run and let the new runtime evidence decide.

### 4. Launch the real reviewer validation

```bash
env \
  GSD_COMPOSED_LITE_MAIN_MODEL=gpt-5.4 \
  GSD_COMPOSED_LITE_MAIN_MODEL_PROVIDER=openai \
  GSD_COMPOSED_LITE_REVIEWER_MODEL=claude-opus-4-6 \
  GSD_COMPOSED_LITE_REVIEWER_PROVIDER=claude-code \
  GSD_COMPOSED_LITE_SUBAGENT_TIMEOUT_MS=180000 \
  GSD_HEADLESS_HEARTBEAT_MS=5000 \
  npm run gsd -- headless --verbose --timeout 720000 --max-restarts 0 \
    start composed-lite --approve "Reviewer validation after guard/stall instrumentation"
```

### 5. Capture the new run identity and evidence immediately after the run

First fetch the runtime marker again:

```bash
npm run gsd -- headless --verbose --max-restarts 0 --timeout 15000 start resume --status
```

Then collect, at minimum:

- `./.gsd/STATE.json`
- `./.gsd/composed-lite/state.yaml`
- `./.gsd/composed-lite/logs/audit-<run-id>.jsonl`
- `./.gsd/composed-lite/logs/raw/<run-id>-2-0-reviewer-0.jsonl` if reviewer runs
- `./.gsd/composed-lite/logs/raw/<run-id>-2-0-design-0.jsonl` if Phase 2 fails before reviewer

### 6. Decision rule for the next session

- If Phase 1 fails again with a fresh `401`, re-open provider/auth/environment investigation.
- If Phase 1 passes and reviewer fails again, treat reviewer behavior/timeout as the active blocker and analyze the new reviewer raw log before changing code. In the latest run (`cl-20260422-15`), reviewer failure again matched a zero-progress stall: `assistant_started=yes | message_updates=0 | tool_uses=0 | output_chars=0`.
- If the run completes Phase 2 cleanly, advance the investigation to the next failing phase instead of revisiting reviewer timeout history.

## Bottom line

This session completed the documentation update and the requested long-window real validation.

The validated conclusion to carry into the next session is:
 
- **Phase 1 is no longer the blocker.**
- **Phase 2 reviewer timeout is now the true blocker.**
- **The latest real validation `cl-20260422-15` reproduced the same reviewer zero-progress stall after Phase 1 and Phase 2 design both succeeded.**
- **The next highest-value action is to compare `cl-20260422-11-2-1-reviewer-0.jsonl` with `cl-20260422-15-2-0-reviewer-0.jsonl` before changing code or raising timeouts again.**
