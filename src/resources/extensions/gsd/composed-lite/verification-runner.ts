/**
 * composed-lite/verification-runner.ts — Runtime-spawned verification commands.
 *
 * Contract C3: Verification by runtime spawn, not agent.
 */

import { spawnSync } from "node:child_process";
import { writeFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";

import { RAW_LOGS_DIR, buildRunScopedRawLogFileName } from "./types.js";
import { writeArtifact, sha256 } from "./artifacts.js";
import type { ComposedLiteState } from "./types.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface VerifyCommandResult {
  kind: "test" | "build" | "lint" | "typecheck";
  command: string;
  exit_code: number;
  duration_ms: number;
  stdout_tail: string;
  stderr_tail: string;
}

// ─── Command discovery ───────────────────────────────────────────────────────

function discoverVerificationCommands(projectRoot: string): Array<{ kind: VerifyCommandResult["kind"]; command: string }> {
  const commands: Array<{ kind: VerifyCommandResult["kind"]; command: string }> = [];

  // Check package.json for scripts
  const pkgPath = join(projectRoot, "package.json");
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as Record<string, unknown>;
      const scripts = pkg.scripts as Record<string, string> | undefined;
      if (scripts) {
        if (scripts.typecheck) commands.push({ kind: "typecheck", command: "npm run typecheck" });
        else if (scripts["type-check"]) commands.push({ kind: "typecheck", command: "npm run type-check" });

        if (scripts.lint) commands.push({ kind: "lint", command: "npm run lint" });

        if (scripts.test) commands.push({ kind: "test", command: "npm test" });

        if (scripts.build) commands.push({ kind: "build", command: "npm run build" });
      }
    } catch { /* ignore */ }
  }

  return commands;
}

// ─── Tail helper ─────────────────────────────────────────────────────────────

function tail(text: string, maxBytes: number = 4096): string {
  if (text.length <= maxBytes) return text;
  return "...(truncated)\n" + text.slice(-maxBytes);
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Run all discovered verification commands and return results.
 */
export function runVerification(
  projectRoot: string,
  runId: string,
  attempt: number,
): VerifyCommandResult[] {
  const commands = discoverVerificationCommands(projectRoot);
  if (commands.length === 0) {
    return [{
      kind: "test",
      command: "(no verification commands discovered)",
      exit_code: 0,
      duration_ms: 0,
      stdout_tail: "No package.json scripts found for typecheck/lint/test/build.",
      stderr_tail: "",
    }];
  }

  const results: VerifyCommandResult[] = [];

  for (const cmd of commands) {
    const start = Date.now();
    const result = spawnSync(cmd.command, {
      cwd: projectRoot,
      shell: true,
      timeout: 120_000, // 2 minute timeout per command
      encoding: "utf-8",
      maxBuffer: 10 * 1024 * 1024, // 10MB
    });
    const duration = Date.now() - start;

    results.push({
      kind: cmd.kind,
      command: cmd.command,
      exit_code: result.status ?? 1,
      duration_ms: duration,
      stdout_tail: tail(result.stdout || ""),
      stderr_tail: tail(result.stderr || ""),
    });
  }

  // Write raw log
  const rawLogPath = join(projectRoot, RAW_LOGS_DIR, buildRunScopedRawLogFileName(runId, `5-${attempt}-verification.jsonl`));
  const rawLogDir = dirname(rawLogPath);
  if (!existsSync(rawLogDir)) mkdirSync(rawLogDir, { recursive: true });
  const logContent = results.map(r => JSON.stringify(r)).join("\n");
  writeFileSync(rawLogPath, logContent);

  return results;
}

/**
 * Build a verification report from results.
 */
export function buildVerificationReport(
  results: VerifyCommandResult[],
  state: ComposedLiteState,
  projectRoot: string,
): string {
  const allPassed = results.every(r => r.exit_code === 0);

  const sections = results.map(r => {
    const status = r.exit_code === 0 ? "PASS" : "FAIL";
    return [
      `## ${r.kind}: ${status}`,
      `Command: \`${r.command}\``,
      `Exit code: ${r.exit_code}`,
      `Duration: ${r.duration_ms}ms`,
      "",
      r.exit_code !== 0 ? `### stderr\n\`\`\`\n${r.stderr_tail}\n\`\`\`` : "",
      r.stdout_tail ? `### stdout (tail)\n\`\`\`\n${r.stdout_tail}\n\`\`\`` : "",
    ].filter(Boolean).join("\n");
  });

  return [
    `# Verification Report`,
    ``,
    `Overall: ${allPassed ? "ALL PASSED" : "SOME FAILED"}`,
    `Run: ${state.run_id}`,
    `Attempt: ${state.phases[5].attempt}`,
    ``,
    ...sections,
  ].join("\n\n");
}

/**
 * Extract a failure summary for the last_verify_failure field.
 */
export function extractFailureSummary(results: VerifyCommandResult[]): string | null {
  const failed = results.filter(r => r.exit_code !== 0);
  if (failed.length === 0) return null;

  return failed.map(r => {
    const errorTail = r.stderr_tail.slice(0, 500);
    return `${r.kind} (${r.command}): exit ${r.exit_code} — ${errorTail}`;
  }).join("\n");
}
