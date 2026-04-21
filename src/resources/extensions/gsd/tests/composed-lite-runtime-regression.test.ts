import test from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getElapsedBudgetMinutes, pauseBudget, resumeBudget } from "../composed-lite/budget.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..", "..", "..", "..");
const RUN_LOCK_SOURCE = readFileSync(join(__dirname, "..", "composed-lite", "run-lock.ts"), "utf-8");
const COMPOSED_LITE_INDEX_SOURCE = readFileSync(join(__dirname, "..", "composed-lite", "index.ts"), "utf-8");
const PHASE0_SOURCE = readFileSync(join(__dirname, "..", "composed-lite", "phases", "p0-admission.ts"), "utf-8");
const PHASE4_SOURCE = readFileSync(join(__dirname, "..", "composed-lite", "phases", "p4-implementation.ts"), "utf-8");
const RUNNER_SOURCE = readFileSync(join(__dirname, "..", "composed-lite", "runner.ts"), "utf-8");
const REVIEW_HARNESS_SOURCE = readFileSync(join(__dirname, "..", "composed-lite", "review-harness.ts"), "utf-8");
const STATE_SOURCE = readFileSync(join(__dirname, "..", "composed-lite", "state.ts"), "utf-8");
const PENDING_REVIEW_SOURCE = readFileSync(join(__dirname, "..", "composed-lite", "pending-review-findings.ts"), "utf-8");
const P1_SOURCE = readFileSync(join(__dirname, "..", "composed-lite", "phases", "p1-research.ts"), "utf-8");
const P2_SOURCE = readFileSync(join(__dirname, "..", "composed-lite", "phases", "p2-design.ts"), "utf-8");
const P3_SOURCE = readFileSync(join(__dirname, "..", "composed-lite", "phases", "p3-split.ts"), "utf-8");
const MODEL_ARG_SOURCE = readFileSync(join(__dirname, "..", "composed-lite", "model-arg.ts"), "utf-8");
const TYPES_SOURCE = readFileSync(join(__dirname, "..", "composed-lite", "types.ts"), "utf-8");
const SUBAGENT_TERMINAL_PATH = join(__dirname, "..", "composed-lite", "subagent-terminal.ts");
const SUBAGENT_TERMINAL_SOURCE = existsSync(SUBAGENT_TERMINAL_PATH)
  ? readFileSync(SUBAGENT_TERMINAL_PATH, "utf-8")
  : "";
const SUBAGENT_SPAWN_PATH = join(__dirname, "..", "composed-lite", "subagent-spawn.ts");
const SUBAGENT_SPAWN_SOURCE = existsSync(SUBAGENT_SPAWN_PATH)
  ? readFileSync(SUBAGENT_SPAWN_PATH, "utf-8")
  : "";
const START_DISPATCH_SOURCE = readFileSync(join(__dirname, "..", "commands-workflow-templates.ts"), "utf-8");
const WORKFLOW_DISPATCH_SOURCE = readFileSync(join(__dirname, "..", "commands", "handlers", "workflow.ts"), "utf-8");
const LOADER_SOURCE = readFileSync(join(REPO_ROOT, "src", "loader.ts"), "utf-8");
const DEV_CLI_SOURCE = readFileSync(join(REPO_ROOT, "scripts", "dev-cli.js"), "utf-8");
const START_RUNTIME_OWNED_BRANCH = START_DISPATCH_SOURCE.slice(
  START_DISPATCH_SOURCE.indexOf("// ─── Runtime-owned dispatch (composed-lite) ─────────────────────────────"),
  START_DISPATCH_SOURCE.indexOf("// Load the workflow template content — prefer a project/global plugin"),
);
const RESUME_RUNTIME_OWNED_BRANCH = START_DISPATCH_SOURCE.slice(
  START_DISPATCH_SOURCE.indexOf("if (runtimeMarker?.status === \"active\") {"),
  START_DISPATCH_SOURCE.indexOf("const inProgress = findInProgressWorkflows(basePath);"),
);
const MARKDOWN_RUNTIME_OWNED_BRANCH = START_DISPATCH_SOURCE.slice(
  START_DISPATCH_SOURCE.indexOf("if (plugin.meta.executorExtension === \"composed-lite\") {"),
  START_DISPATCH_SOURCE.indexOf("if (isAutoActive()) {", START_DISPATCH_SOURCE.indexOf("if (plugin.meta.executorExtension === \"composed-lite\") {")),
);

function makeRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "gsd-composed-lite-"));
  execSync("git init -b main", { cwd: dir, stdio: "ignore" });
  execSync("git config user.email test@test.com", { cwd: dir, stdio: "ignore" });
  execSync("git config user.name Test", { cwd: dir, stdio: "ignore" });
  writeFileSync(join(dir, ".gitignore"), ".gsd/\n", "utf-8");
  writeFileSync(join(dir, "README.md"), "hello\n", "utf-8");
  execSync("git add README.md .gitignore", { cwd: dir, stdio: "ignore" });
  execSync("git commit -m init", { cwd: dir, stdio: "ignore" });
  return dir;
}

test("run-lock allows only same-run reacquire or pending-to-real upgrade for the same process", () => {
  assert.match(RUN_LOCK_SOURCE, /const sameRun = existing\.run_id === runId/);
  assert.match(RUN_LOCK_SOURCE, /const pendingUpgrade = existing\.run_id === "pending"/);
  assert.match(RUN_LOCK_SOURCE, /!sameProcess \|\| \(!sameRun && !pendingUpgrade\)/);
});

test("composed-lite dispatch arg parser strips plan and admission flags consistently", () => {
  assert.match(COMPOSED_LITE_INDEX_SOURCE, /export function parseComposedLiteDispatchArgs/);
  assert.match(COMPOSED_LITE_INDEX_SOURCE, /mode: isPlan \? "plan" : "full"/);
  assert.match(COMPOSED_LITE_INDEX_SOURCE, /admissionAction: hasReject \? "reject" : hasApprove \? "approve" : null/);
  assert.match(COMPOSED_LITE_INDEX_SOURCE, /carryForwardReviewAction: hasIgnore \? "ignore" : hasCarry \? "carry" : null/);
  assert.match(COMPOSED_LITE_INDEX_SOURCE, /--carry-review-findings/);
  assert.match(COMPOSED_LITE_INDEX_SOURCE, /--ignore-review-findings/);
  assert.match(COMPOSED_LITE_INDEX_SOURCE, /replace\(/);
});

test("Phase 0 admission waits for explicit approval and supports reject", () => {
  assert.match(PHASE0_SOURCE, /state\.admission\.state = "awaiting_approval"/);
  assert.match(PHASE0_SOURCE, /if \(admissionAction === "reject"\)/);
  assert.match(PHASE0_SOURCE, /if \(admissionAction !== "approve"\)/);
  assert.match(PHASE0_SOURCE, /throw new AdmissionPendingSignal/);
  assert.match(PHASE0_SOURCE, /approved_by = "explicit-user"/);
  assert.match(PHASE0_SOURCE, /pauseBudget\(state\)/);
  assert.match(PHASE0_SOURCE, /resumeBudget\(state\)/);
  assert.doesNotMatch(PHASE0_SOURCE, /Auto-approved \(MVP\)/);
});

test("budget excludes time spent paused for admission decisions", () => {
  const state: any = {
    created_at: "2026-04-21T09:00:00.000Z",
    budget: {
      max_time_minutes: 120,
      elapsed_minutes: 0,
      verify_reentry_count: 0,
      max_verify_reentry: 3,
      consecutive_failures: 0,
      max_consecutive_failures: 2,
      pause_started_at: null,
      total_paused_minutes: 0,
    },
  };

  pauseBudget(state, "2026-04-21T09:10:00.000Z");
  assert.equal(getElapsedBudgetMinutes(state, Date.parse("2026-04-21T09:40:00.000Z")), 10);

  resumeBudget(state, "2026-04-21T09:25:00.000Z");
  assert.equal(state.budget.pause_started_at, null);
  assert.equal(Math.round((state.budget.total_paused_minutes ?? 0) * 10) / 10, 15);
  assert.equal(getElapsedBudgetMinutes(state, Date.parse("2026-04-21T09:40:00.000Z")), 25);
});

test("Phase 0 requires an explicit carry-forward review selection when unresolved findings exist", () => {
  assert.match(PHASE0_SOURCE, /carryForwardReviewAction/);
  assert.match(PHASE0_SOURCE, /getLatestPendingReviewFindingsBundle/);
  assert.match(PHASE0_SOURCE, /--carry-review-findings/);
  assert.match(PHASE0_SOURCE, /--ignore-review-findings/);
  assert.match(PHASE0_SOURCE, /carry_forward_review_action/);
});

test("runner pauses cleanly on admission pending and allows active-run resume without a fresh requirement", () => {
  assert.match(RUNNER_SOURCE, /const canResumeActiveRun = Boolean\(existing && existing\.status === "active"\)/);
  assert.match(RUNNER_SOURCE, /if \(!requestedRequirement && !canResumeActiveRun\)/);
  assert.match(RUNNER_SOURCE, /if \(err instanceof AdmissionPendingSignal\)/);
  assert.match(RUNNER_SOURCE, /outcome: "pending_approval"/);
  assert.match(RUNNER_SOURCE, /Re-run with --approve or --reject/);
  assert.match(RUNNER_SOURCE, /allowAdmissionDecisionBeforeBudgetCheck/);
  assert.match(RUNNER_SOURCE, /state\.admission\.state === "awaiting_approval"/);
});

test("runner returns immediately after a non-fuse phase failure instead of masking it as state_integrity_error", () => {
  assert.match(RUNNER_SOURCE, /if \(!state\.fuse_reason && state\.phases\[phaseNum\]\.status === "failed"\)/);
  assert.match(RUNNER_SOURCE, /Fix the issue and re-run with \/gsd start resume\./);
  assert.match(RUNNER_SOURCE, /saveState\(projectRoot, state\);\s*\n\s*if \(!state\.fuse_reason && state\.phases\[phaseNum\]\.status === "failed"\)/);
});

test("runner rejects silently reusing an active composed-lite run for a different requirement", () => {
  assert.match(RUNNER_SOURCE, /const requestedRequirement = req\.requirement\.trim\(\)/);
  assert.match(RUNNER_SOURCE, /requestedRequirement && requestedRequirement !== existing\.requirement\.trim\(\)/);
  assert.match(RUNNER_SOURCE, /Active composed-lite run .* already exists for a different requirement/);
  assert.match(RUNNER_SOURCE, /Resume the active run with \/gsd start resume/);
});

test("both composed-lite dispatch entrypoints forward parsed admission flags", () => {
  assert.match(START_DISPATCH_SOURCE, /const parsed = parseComposedLiteDispatchArgs\(input\)/);
  assert.match(START_DISPATCH_SOURCE, /admissionAction: parsed\.admissionAction/);
  assert.match(WORKFLOW_DISPATCH_SOURCE, /await dispatchComposedLiteRuntime\(base, args, "workflow-run", ctx, pi\)/);
});

test("handleStart runtime-owned composed-lite branch delegates to the shared helper", () => {
  assert.match(START_RUNTIME_OWNED_BRANCH, /await dispatchComposedLiteRuntime\(basePath, description, "workflow-start", ctx, pi\)/);
});

test("composed-lite runtime dispatch is centralized in an awaited helper", () => {
  assert.match(START_DISPATCH_SOURCE, /async function dispatchComposedLiteRuntime/);
  assert.match(START_DISPATCH_SOURCE, /await runComposedLite\(/);
  assert.match(START_RUNTIME_OWNED_BRANCH, /await dispatchComposedLiteRuntime\(/);
  assert.match(RESUME_RUNTIME_OWNED_BRANCH, /await dispatchComposedLiteRuntime\(/);
  assert.match(MARKDOWN_RUNTIME_OWNED_BRANCH, /await dispatchComposedLiteRuntime\(/);
});

test("workflow command callers await composed-lite and markdown dispatch entrypoints", () => {
  assert.match(WORKFLOW_DISPATCH_SOURCE, /async function dispatchPluginByMode/);
  assert.match(WORKFLOW_DISPATCH_SOURCE, /await dispatchComposedLiteRuntime\(/);
  assert.match(WORKFLOW_DISPATCH_SOURCE, /await dispatchMarkdownPhasePlugin\(/);
  assert.match(WORKFLOW_DISPATCH_SOURCE, /await dispatchPluginByMode\(plugin, rest, ctx, pi\)/);
});

test("/gsd start resume recognizes the runtime-owned composed-lite STATE marker", () => {
  assert.match(START_DISPATCH_SOURCE, /interface RuntimeOwnedStateMarker/);
  assert.match(START_DISPATCH_SOURCE, /function readRuntimeOwnedStateMarker/);
  assert.match(START_DISPATCH_SOURCE, /const isResumeCommand =/);
  assert.match(START_DISPATCH_SOURCE, /parsed\.type === "runtime-owned" && parsed\.runtime === "composed-lite"/);
  assert.match(START_DISPATCH_SOURCE, /if \(runtimeMarker\?\.status === "active"\)/);
  assert.match(START_DISPATCH_SOURCE, /parseComposedLiteDispatchArgs\(/);
  assert.match(START_DISPATCH_SOURCE, /admissionAction: parsed\.admissionAction/);
  assert.match(START_DISPATCH_SOURCE, /source: "resume"/);
});

test("/gsd start resume supports composed-lite runtime status and abandon/reset controls", () => {
  assert.match(START_DISPATCH_SOURCE, /function normalizeRuntimeControlAction/);
  assert.match(START_DISPATCH_SOURCE, /trimmed === "status" \|\| trimmed === "--status"/);
  assert.match(START_DISPATCH_SOURCE, /trimmed === "--abandon"/);
  assert.match(START_DISPATCH_SOURCE, /trimmed === "--reset"/);
  assert.match(START_DISPATCH_SOURCE, /showComposedLiteRuntimeStatus/);
  assert.match(START_DISPATCH_SOURCE, /abandonComposedLiteRuntime/);
  assert.match(START_DISPATCH_SOURCE, /event: "run_abandoned"/);
});

test("Phase 4 reruns implementation round-by-round before each follow-up review", () => {
  const roundLoop = PHASE4_SOURCE.indexOf("for (let round = 0; round <= MAX_REVISION_ROUNDS; round++)");
  const executeRound = PHASE4_SOURCE.indexOf("const summary = await executeImplementationRound");
  const reviewCall = PHASE4_SOURCE.indexOf("const reviewResult = await runReview");
  assert.ok(roundLoop >= 0, "Phase 4 must iterate over revision rounds");
  assert.ok(executeRound >= 0, "Phase 4 must execute an implementation round");
  assert.ok(reviewCall >= 0, "Phase 4 must run review after each implementation round");
  assert.ok(executeRound < reviewCall, "Implementation must run before the follow-up review in each round");
  assert.match(PHASE4_SOURCE, /reviewFeedback = reviewResult/);
  assert.match(PHASE4_SOURCE, /Re-running implementation for revision round/);
});

test("state initializes and recovers carry_forward_review defaults", () => {
  assert.match(STATE_SOURCE, /carry_forward_review: \{/);
  assert.match(STATE_SOURCE, /action: null/);
  assert.match(STATE_SOURCE, /entries: \[\]/);
  assert.match(STATE_SOURCE, /if \(!state\.carry_forward_review\)/);
  assert.match(STATE_SOURCE, /pause_started_at: null/);
  assert.match(STATE_SOURCE, /total_paused_minutes: 0/);
  assert.match(STATE_SOURCE, /if \(typeof state\.budget\.total_paused_minutes !== "number"\)/);
});

test("dev CLI preserves a runnable wrapper path for headless RPC subprocesses", () => {
  assert.match(DEV_CLI_SOURCE, /GSD_BIN_PATH: process\.env\.GSD_BIN_PATH \|\| devCliPath/);
  assert.match(LOADER_SOURCE, /process\.env\.GSD_BIN_PATH = process\.env\.GSD_BIN_PATH \|\| process\.argv\[1\]/);
});

test("pending review findings helper persists unresolved review bundles and supports carry-forward summaries", () => {
  assert.match(PENDING_REVIEW_SOURCE, /recordPendingReviewFindings/);
  assert.match(PENDING_REVIEW_SOURCE, /markPendingReviewFindingsResolved/);
  assert.match(PENDING_REVIEW_SOURCE, /getLatestPendingReviewFindingsBundle/);
  assert.match(PENDING_REVIEW_SOURCE, /formatCarryForwardReviewContext/);
  assert.match(PENDING_REVIEW_SOURCE, /pending-review-findings\.yaml/);
});

test("Phase 4 worker tasks include review feedback, round-aware raw logs, and restore implementation-summary on pass", () => {
  assert.match(PHASE4_SOURCE, /Code review findings to address before continuing:/);
  assert.match(PHASE4_SOURCE, /worker-step-\$\{i\}-r\$\{round\}/);
  assert.match(PHASE4_SOURCE, /path: "implementation-summary"/);
  assert.match(PHASE4_SOURCE, /Revision round: \$\{round\}/);
});

test("review-harness records parsed_ok truthfully and stores the actual raw log path", () => {
  assert.match(REVIEW_HARNESS_SOURCE, /parsed_ok: Boolean\(result\)/);
  assert.match(REVIEW_HARNESS_SOURCE, /buildRunScopedRawLogFileName/);
  assert.match(REVIEW_HARNESS_SOURCE, /rawLogRelPath = `logs\/raw\/\$\{rawLogFileName\}`/);
  assert.doesNotMatch(REVIEW_HARNESS_SOURCE, /reviewer-final/);
});

test("subagent terminal parser is centralized and extracts provider errors", () => {
  assert.match(SUBAGENT_TERMINAL_SOURCE, /export function parseSubagentTerminalResult/);
  assert.match(SUBAGENT_TERMINAL_SOURCE, /stopReason/);
  assert.match(SUBAGENT_TERMINAL_SOURCE, /errorMessage/);
  assert.match(SUBAGENT_TERMINAL_SOURCE, /terminalError/);
});

test("shared subagent spawn helper synthesizes explicit terminal failures for B2", () => {
  assert.match(SUBAGENT_SPAWN_SOURCE, /export function resolveSubagentTerminalResult/);
  assert.match(SUBAGENT_SPAWN_SOURCE, /spawnErrorMessage: "GSD CLI binary not found"/);
  assert.match(SUBAGENT_SPAWN_SOURCE, /spawn failed:/);
  assert.match(SUBAGENT_SPAWN_SOURCE, /input\.exitCode !== 0/);
  assert.match(SUBAGENT_SPAWN_SOURCE, /subagent exited with code \$\{input\.exitCode\}/);
});

test("shared subagent spawn helper enforces a bounded timeout for composed-lite phases", () => {
  assert.match(SUBAGENT_SPAWN_SOURCE, /DEFAULT_SUBAGENT_TIMEOUT_MS = 10 \* 60 \* 1000/);
  assert.match(SUBAGENT_SPAWN_SOURCE, /GSD_COMPOSED_LITE_SUBAGENT_TIMEOUT_MS/);
  assert.match(SUBAGENT_SPAWN_SOURCE, /setTimeout\(/);
  assert.match(SUBAGENT_SPAWN_SOURCE, /proc\.kill\("SIGTERM"\)/);
  assert.match(SUBAGENT_SPAWN_SOURCE, /subagent timed out after \$\{timeoutMs\}ms/);
});

test("composed-lite raw log helpers scope filenames by run_id to avoid cross-run collisions", () => {
  assert.match(TYPES_SOURCE, /export function buildRunScopedRawLogFileName/);
  assert.match(TYPES_SOURCE, /sanitizeRunIdForFileName/);
  assert.match(P1_SOURCE, /buildRunScopedRawLogFileName/);
  assert.match(P2_SOURCE, /buildRunScopedRawLogFileName/);
  assert.match(P3_SOURCE, /buildRunScopedRawLogFileName/);
  assert.match(PHASE4_SOURCE, /buildRunScopedRawLogFileName/);
  assert.match(REVIEW_HARNESS_SOURCE, /buildRunScopedRawLogFileName/);
});

test("review harness classifies terminal provider errors as review_unavailable instead of parse exhaustion", () => {
  assert.match(REVIEW_HARNESS_SOURCE, /spawnResult\.terminalResult/);
  assert.match(REVIEW_HARNESS_SOURCE, /terminalError/);
  assert.match(REVIEW_HARNESS_SOURCE, /throw new ComposedLiteFuseError\(\s*"review_unavailable"/);
});

test("review harness spawns reviewer with a provider-qualified --model arg (B0b)", () => {
  assert.match(MODEL_ARG_SOURCE, /export function buildModelArg\(/);
  assert.match(MODEL_ARG_SOURCE, /return `\$\{trimmedProvider\}\/\$\{model\}`/);
  assert.match(REVIEW_HARNESS_SOURCE, /import \{ buildModelArg \} from "\.\/model-arg\.js"/);
  assert.match(REVIEW_HARNESS_SOURCE, /reviewer: \{ model: string; provider: string \| null \| undefined \}/);
  assert.match(
    REVIEW_HARNESS_SOURCE,
    /\{ model: reviewerModel, provider: reviewerProvider \}/,
  );
});

test("model-arg helper resolves main-agent --model from composed-lite state (Sprint 1c)", () => {
  assert.match(MODEL_ARG_SOURCE, /export function resolveMainModelArg\(state: ComposedLiteState\): string \| null/);
  assert.match(MODEL_ARG_SOURCE, /state\.review\?\.main_model/);
  assert.match(MODEL_ARG_SOURCE, /state\.review\?\.main_model_provider/);
  assert.match(MODEL_ARG_SOURCE, /model === "unknown"/);
});

test("scout / design / split / worker spawners plumb --model from state (Sprint 1c)", () => {
  assert.match(SUBAGENT_SPAWN_SOURCE, /\.\.\.\(options\.modelArg \? \["--model", options\.modelArg\] : \[\]\),/);

  assert.match(P1_SOURCE, /import \{ resolveMainModelArg \} from "\.\.\/model-arg\.js"/);
  assert.match(P1_SOURCE, /import \{ spawnGsdSubagent \} from "\.\.\/subagent-spawn\.js"/);
  assert.match(P1_SOURCE, /modelArg: string \| null,/);
  assert.match(P1_SOURCE, /return spawnGsdSubagent\(\{/);
  assert.match(P1_SOURCE, /resolveMainModelArg\(state\)/);

  assert.match(P2_SOURCE, /import \{ resolveMainModelArg \} from "\.\.\/model-arg\.js"/);
  assert.match(P2_SOURCE, /import \{ spawnGsdSubagent \} from "\.\.\/subagent-spawn\.js"/);
  assert.match(P2_SOURCE, /modelArg: string \| null,/);
  assert.match(P2_SOURCE, /return spawnGsdSubagent\(\{/);

  assert.match(P3_SOURCE, /import \{ resolveMainModelArg \} from "\.\.\/model-arg\.js"/);
  assert.match(P3_SOURCE, /import \{ spawnGsdSubagent \} from "\.\.\/subagent-spawn\.js"/);
  assert.match(P3_SOURCE, /const modelArg = resolveMainModelArg\(state\)/);
  assert.match(P3_SOURCE, /return spawnGsdSubagent\(\{/);

  assert.match(PHASE4_SOURCE, /import \{ resolveMainModelArg \} from "\.\.\/model-arg\.js"/);
  assert.match(PHASE4_SOURCE, /import \{ spawnGsdSubagent \} from "\.\.\/subagent-spawn\.js"/);
  assert.match(PHASE4_SOURCE, /modelArg: string \| null,/);
  assert.match(PHASE4_SOURCE, /return spawnGsdSubagent\(\{/);
});

test("scout / design / split / worker audits surface the configured model hint (Sprint 1c + review hardening)", () => {
  assert.match(P1_SOURCE, /model: auditModel/);
  assert.match(P1_SOURCE, /provider: auditProvider/);
  assert.match(P2_SOURCE, /model: auditModel/);
  assert.match(P2_SOURCE, /provider: auditProvider/);
  assert.match(P3_SOURCE, /model: auditModel/);
  assert.match(P3_SOURCE, /provider: auditProvider/);
  assert.match(PHASE4_SOURCE, /model: auditModel/);
  assert.match(PHASE4_SOURCE, /provider: auditProvider/);
});

test("P2 design generation emits subagent_call and subagent_result audit events (review fix)", () => {
  assert.match(P2_SOURCE, /event: "subagent_call",[\s\S]*?agent: `design-agent-\$\{round\}`/);
  assert.match(P2_SOURCE, /event: "subagent_result",[\s\S]*?agent: `design-agent-\$\{round\}`/);
  assert.match(P2_SOURCE, /parsed_ok: !terminalResult\.terminalError/);
});

test("P3 split generation emits subagent_call and subagent_result + terminal-error check (review fix)", () => {
  assert.match(P3_SOURCE, /event: "subagent_call",[\s\S]*?agent: `split-agent-\$\{state\.phases\[3\]\.attempt\}`/);
  assert.match(P3_SOURCE, /event: "subagent_result",[\s\S]*?agent: `split-agent-\$\{state\.phases\[3\]\.attempt\}`/);
  assert.match(P3_SOURCE, /const terminalResult = result\.terminalResult/);
  assert.match(P3_SOURCE, /if \(terminalResult\.terminalError\)/);
});

test("P2 / P3 artifact envelopes carry declared main model + provider (review fix)", () => {
  assert.match(P2_SOURCE, /const envelopeModel = mainModelArg \? state\.review\.main_model : null/);
  assert.match(P2_SOURCE, /const envelopeProvider = state\.review\.main_model_provider \?\? null/);
  assert.match(P2_SOURCE, /provider: envelopeProvider,\s*model: envelopeModel,/);

  assert.match(P3_SOURCE, /const envelopeModel = modelArg \? state\.review\.main_model : null/);
  assert.match(P3_SOURCE, /const envelopeProvider = state\.review\.main_model_provider \?\? null/);
  assert.match(P3_SOURCE, /provider: envelopeProvider,\s*model: envelopeModel,/);
});

test("runner honours GSD_COMPOSED_LITE_MAIN_MODEL and _PROVIDER overrides (B5)", () => {
  assert.match(RUNNER_SOURCE, /GSD_COMPOSED_LITE_MAIN_MODEL/);
  assert.match(RUNNER_SOURCE, /GSD_COMPOSED_LITE_MAIN_MODEL_PROVIDER/);
  assert.match(RUNNER_SOURCE, /state\.review\.main_model_provider = mainProviderOverride \|\| null/);
});

test("Phase 2 injects ModelRegistry.isProviderRequestReady into the picker (B1)", () => {
  assert.match(P2_SOURCE, /isProviderRequestReady/);
  assert.match(P2_SOURCE, /mainProvider: state\.review\.main_model_provider/);
  assert.match(P2_SOURCE, /isProviderReady,?/);
});

test("Phase 2 defers exhausted design review instead of fusing and records pending findings", () => {
  assert.match(P2_SOURCE, /recordPendingReviewFindings/);
  assert.match(P2_SOURCE, /markPendingReviewFindingsResolved/);
  assert.match(P2_SOURCE, /Design review deferred after/);
  assert.match(P2_SOURCE, /continuing to Phase 3/);
  assert.doesNotMatch(P2_SOURCE, /design_review_exhausted/);
});

test("Phase 1/2/3/4 prompts include carry-forward review context", () => {
  assert.match(P1_SOURCE, /formatCarryForwardReviewContext/);
  assert.match(P2_SOURCE, /formatCarryForwardReviewContext/);
  assert.match(P3_SOURCE, /formatCarryForwardReviewContext/);
  assert.match(PHASE4_SOURCE, /formatCarryForwardReviewContext/);
  assert.match(PHASE4_SOURCE, /carryForwardContext/);
});

test("research and design subagent runners use the shared spawn helper", () => {
  assert.match(P1_SOURCE, /spawnGsdSubagent/);
  assert.match(P2_SOURCE, /spawnGsdSubagent/);
  assert.match(P3_SOURCE, /spawnGsdSubagent/);
  assert.match(PHASE4_SOURCE, /spawnGsdSubagent/);
});

test("Phase 1 constraints_risks scout prompt is bounded to representative files", () => {
  assert.match(P1_SOURCE, /Sample representative evidence only/);
  assert.match(P1_SOURCE, /up to 2 CI workflow files/);
  assert.match(P1_SOURCE, /up to 4 representative tests/);
  assert.match(P1_SOURCE, /Do not exhaustively enumerate the entire test suite/);
});

test("Phase 4 worker subagent failures are surfaced immediately instead of degrading to empty diff", () => {
  assert.match(PHASE4_SOURCE, /const terminalResult = result\.terminalResult/);
  assert.match(PHASE4_SOURCE, /parsed_ok: !terminalResult\.terminalError/);
  assert.match(PHASE4_SOURCE, /if \(terminalResult\.terminalError\)/);
  assert.match(PHASE4_SOURCE, /Worker step \$\{i \+ 1\} failed/);
});

test("Phase 4 defers exhausted code review instead of fusing and records pending findings", () => {
  assert.match(PHASE4_SOURCE, /recordPendingReviewFindings/);
  assert.match(PHASE4_SOURCE, /markPendingReviewFindingsResolved/);
  assert.match(PHASE4_SOURCE, /Code review deferred after/);
  assert.match(PHASE4_SOURCE, /continuing to Phase 5/);
  assert.doesNotMatch(PHASE4_SOURCE, /code_review_exhausted/);
});

test("baseline-to-HEAD diff misses working tree edits while baseline working tree diff sees them", () => {
  const repo = makeRepo();
  try {
    const baselineSha = execSync("git rev-parse HEAD", { cwd: repo, encoding: "utf-8" }).trim();
    writeFileSync(join(repo, "README.md"), "hello\nworld\n", "utf-8");
    writeFileSync(join(repo, "new-file.ts"), "export const value = 1;\n", "utf-8");
    writeFileSync(join(repo, ".gsd-ignore-check"), "not ignored\n", "utf-8");

    const oldDiff = execSync(`git diff --numstat ${baselineSha}..HEAD`, { cwd: repo, encoding: "utf-8" }).trim();
    const workingTreeDiff = execSync(`git diff --numstat ${baselineSha}`, { cwd: repo, encoding: "utf-8" }).trim();
    const statusOutput = execSync("git status --porcelain", { cwd: repo, encoding: "utf-8" }).trim();

    assert.equal(oldDiff, "", "HEAD range diff should miss uncommitted changes");
    assert.match(workingTreeDiff, /README\.md/);
    assert.match(statusOutput, /\?\? new-file\.ts/);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});
