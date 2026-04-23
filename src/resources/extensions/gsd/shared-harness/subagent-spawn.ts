import { spawn } from "node:child_process";
import { delimiter } from "node:path";

import { resolveGsdBin } from "./resolve-bin.js";
import { parseSubagentTerminalResult, type SubagentTerminalResult } from "./subagent-terminal.js";

const DEFAULT_SUBAGENT_TIMEOUT_MS = 10 * 60 * 1000;
const liveSubagentProcesses = new Set<{ kill(signal?: NodeJS.Signals | number): boolean }>();
let cleanupHandlersInstalled = false;

export function trackLiveSubagentProcess(
  proc: { kill(signal?: NodeJS.Signals | number): boolean },
): () => void {
  liveSubagentProcesses.add(proc);
  return () => {
    liveSubagentProcesses.delete(proc);
  };
}

export function cleanupTrackedSubagentProcesses(signal: NodeJS.Signals = "SIGTERM"): number {
  let cleaned = 0;
  for (const proc of [...liveSubagentProcesses]) {
    liveSubagentProcesses.delete(proc);
    try {
      proc.kill(signal);
      cleaned++;
    } catch {
    }
  }
  return cleaned;
}

function installSubagentCleanupHandlers(): void {
  if (cleanupHandlersInstalled) return;
  cleanupHandlersInstalled = true;

  process.once("exit", () => {
    cleanupTrackedSubagentProcesses("SIGTERM");
  });

  const handleSignal = (signal: NodeJS.Signals, exitCode: number) => {
    process.once(signal, () => {
      cleanupTrackedSubagentProcesses(signal);
      process.exit(exitCode);
    });
  };

  handleSignal("SIGINT", 130);
  handleSignal("SIGTERM", 143);
}

function resolveSubagentTimeoutMs(): number {
  const raw = process.env.GSD_COMPOSED_LITE_SUBAGENT_TIMEOUT_MS?.trim();
  if (!raw) return DEFAULT_SUBAGENT_TIMEOUT_MS;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_SUBAGENT_TIMEOUT_MS;
  return parsed;
}

export interface SpawnGsdSubagentOptions {
  projectRoot: string;
  task: string;
  modelArg?: string | null;
  extraArgs?: string[];
}

export interface SpawnGsdSubagentResult {
  rawOutput: string;
  stderrOutput: string;
  exitCode: number;
  terminalResult: SubagentTerminalResult;
}

export function resolveSubagentTerminalResult(input: {
  rawOutput: string;
  stderrOutput?: string;
  exitCode: number;
  spawnErrorMessage?: string | null;
}): SubagentTerminalResult {
  const parsed = parseSubagentTerminalResult(input.rawOutput);
  if (parsed.terminalError) {
    return parsed;
  }

  const spawnErrorMessage = input.spawnErrorMessage?.trim() ?? "";
  if (spawnErrorMessage) {
    const timeoutWithProgress = spawnErrorMessage.includes("subagent timed out after")
      ? [
        spawnErrorMessage,
        `assistant_started=${parsed.assistantStarted ? "yes" : "no"}`,
        `message_updates=${parsed.messageUpdateCount}`,
        `tool_uses=${parsed.toolExecutionCount}`,
        `output_chars=${parsed.outputText.length}`,
      ].join(" | ")
      : spawnErrorMessage;
    return {
      ...parsed,
      stopReason: parsed.stopReason ?? "error",
      errorMessage: parsed.errorMessage ?? timeoutWithProgress,
      terminalError: timeoutWithProgress,
    };
  }

  if (input.exitCode !== 0) {
    const stderrOutput = input.stderrOutput?.trim() ?? "";
    const exitMessage = parsed.errorMessage ?? (stderrOutput || `subagent exited with code ${input.exitCode}`);
    return {
      ...parsed,
      stopReason: parsed.stopReason ?? "error",
      errorMessage: parsed.errorMessage ?? exitMessage,
      terminalError: exitMessage,
    };
  }

  return parsed;
}

export async function spawnGsdSubagent(options: SpawnGsdSubagentOptions): Promise<SpawnGsdSubagentResult> {
  installSubagentCleanupHandlers();

  const args: string[] = [
    "--mode", "json",
    "-p",
    "--no-session",
    ...(options.modelArg ? ["--model", options.modelArg] : []),
    ...(options.extraArgs ?? []),
    `Task: ${options.task}`,
  ];

  const bundledPaths = (process.env.GSD_BUNDLED_EXTENSION_PATHS ?? "")
    .split(delimiter)
    .map((segment) => segment.trim())
    .filter(Boolean);
  const extensionArgs = bundledPaths.flatMap((extensionPath) => ["--extension", extensionPath]);

  return new Promise((resolve) => {
    const gsdBin = resolveGsdBin();
    if (!gsdBin) {
      resolve({
        rawOutput: "",
        stderrOutput: "",
        exitCode: 1,
        terminalResult: resolveSubagentTerminalResult({
          rawOutput: "",
          exitCode: 1,
          spawnErrorMessage: "GSD CLI binary not found",
        }),
      });
      return;
    }

    let settled = false;
    let stdout = "";
    let stderr = "";
    let timeoutHandle: NodeJS.Timeout | null = null;

    const settle = (exitCode: number, spawnErrorMessage: string | null = null) => {
      if (settled) return;
      settled = true;
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
        timeoutHandle = null;
      }
      resolve({
        rawOutput: stdout,
        stderrOutput: stderr,
        exitCode,
        terminalResult: resolveSubagentTerminalResult({
          rawOutput: stdout,
          stderrOutput: stderr,
          exitCode,
          spawnErrorMessage,
        }),
      });
    };

    try {
      const proc = spawn(
        process.execPath,
        [gsdBin, ...extensionArgs, ...args],
        { cwd: options.projectRoot, shell: false, stdio: ["ignore", "pipe", "pipe"] },
      );
      const untrack = trackLiveSubagentProcess(proc);
      const timeoutMs = resolveSubagentTimeoutMs();

      timeoutHandle = setTimeout(() => {
        try {
          proc.kill("SIGTERM");
        } catch {
        }
        settle(1, `subagent timed out after ${timeoutMs}ms`);
      }, timeoutMs);

      proc.stdout.on("data", (data) => { stdout += data.toString(); });
      proc.stderr.on("data", (data) => { stderr += data.toString(); });
      proc.on("close", (code) => {
        untrack();
        settle(code ?? 1);
      });
      proc.on("error", (error) => {
        untrack();
        const message = error instanceof Error ? `spawn failed: ${error.message}` : "spawn failed";
        settle(1, message);
      });
    } catch (error) {
      const message = error instanceof Error ? `spawn failed: ${error.message}` : "spawn failed";
      settle(1, message);
    }
  });
}
