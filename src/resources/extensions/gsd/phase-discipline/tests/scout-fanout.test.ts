import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  evaluatePhaseDisciplineScoutFanOut,
  runPhaseDisciplineScoutFanOut,
} from "../../phase-discipline/scout-fanout.ts";
import { buildSliceFileName } from "../../paths.ts";

function makeProject(prefix: string): string {
  const project = mkdtempSync(join(tmpdir(), `${prefix}-`));
  mkdirSync(join(project, ".gsd", "milestones", "M001", "slices", "S01", "tasks"), { recursive: true });
  writeFileSync(
    join(project, ".gsd", "milestones", "M001", "M001-ROADMAP.md"),
    [
      "# M001: Test Milestone",
      "",
      "## Slices",
      "- [ ] **S01**: Test Slice",
      "",
    ].join("\n"),
    "utf8",
  );
  return project;
}

test("evaluatePhaseDisciplineScoutFanOut returns fanOutSpec for single-slice research without existing artifact", () => {
  const project = makeProject("gsd-scout-eval");

  try {
    const result = evaluatePhaseDisciplineScoutFanOut({
      unitType: "research-slice",
      unitId: "M001/S01",
      prompt: "research prompt",
      basePath: project,
    });

    assert.equal(result.action, "proceed");
    assert.equal(result.prompt, "research prompt");
    assert.equal(result.fanOutSpec?.builtin, "phase-discipline-scout-fanout");
    assert.deepEqual(result.fanOutSpec?.scouts.map((scout) => scout.focus), [
      "codebase_scan",
      "constraints_risks",
      "prior_art",
    ]);
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test("evaluatePhaseDisciplineScoutFanOut bypasses parallel research and existing research artifact", () => {
  const project = makeProject("gsd-scout-eval-bypass");

  try {
    const parallel = evaluatePhaseDisciplineScoutFanOut({
      unitType: "research-slice",
      unitId: "M001/parallel-research",
      prompt: "research prompt",
      basePath: project,
    });
    assert.equal(parallel.action, "proceed");
    assert.equal(parallel.fanOutSpec, undefined);

    const researchPath = join(
      project,
      ".gsd",
      "milestones",
      "M001",
      "slices",
      "S01",
      buildSliceFileName("S01", "RESEARCH"),
    );
    writeFileSync(researchPath, "# existing research\n", "utf8");
    const existing = evaluatePhaseDisciplineScoutFanOut({
      unitType: "research-slice",
      unitId: "M001/S01",
      prompt: "research prompt",
      basePath: project,
    });
    assert.equal(existing.action, "proceed");
    assert.equal(existing.fanOutSpec, undefined);
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test("runPhaseDisciplineScoutFanOut writes canonical research artifact, observability, and raw logs on success", async () => {
  const project = makeProject("gsd-scout-run");
  const fanOutSpec = evaluatePhaseDisciplineScoutFanOut({
    unitType: "research-slice",
    unitId: "M001/S01",
    prompt: "research prompt",
    basePath: project,
  }).fanOutSpec!;
  const seenTasks: string[] = [];

  try {
    const result = await runPhaseDisciplineScoutFanOut({
      basePath: project,
      unitType: "research-slice",
      unitId: "M001/S01",
      fanOutSpec,
      spawnImpl: ({ task }) => {
        seenTasks.push(task);
        const focus = task.includes("Codebase")
          ? "codebase_scan"
          : task.includes("Constraints")
            ? "constraints_risks"
            : "prior_art";
        return {
          cancel: () => {},
          promise: Promise.resolve({
            rawOutput: `raw-${focus}`,
            stderrOutput: `stderr-${focus}`,
            exitCode: 0,
            terminalResult: {
              outputText: `output-${focus}`,
              errorMessage: null,
              terminalError: null,
              stopReason: "stop",
              provider: "openai",
              model: "gpt-5.4",
            },
          } as any),
        };
      },
    });

    assert.equal(result.scoutCount, 3);
    assert.equal(seenTasks.length, 3);
    assert.ok(existsSync(result.researchArtifactPath));
    const artifact = readFileSync(result.researchArtifactPath, "utf8");
    assert.match(artifact, /# Slice Research/);
    assert.match(artifact, /## Codebase Scan/);
    assert.match(artifact, /## Constraints & Risks/);
    assert.match(artifact, /## Prior Art/);
    assert.match(artifact, /output-codebase_scan/);
    assert.ok(existsSync(join(result.rawLogDir, "phase-discipline-scout-fanout-M001-S01.json")));
    assert.ok(existsSync(join(result.rawLogDir, "phase-discipline-scout-fanout-M001-S01-scout-codebase_scan-stdout.log")));
    assert.ok(existsSync(join(result.rawLogDir, "phase-discipline-scout-fanout-M001-S01-scout-prior_art-stderr.log")));
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test("runPhaseDisciplineScoutFanOut cancels remaining scouts and does not write research artifact on failure", async () => {
  const project = makeProject("gsd-scout-run-fail");
  const fanOutSpec = evaluatePhaseDisciplineScoutFanOut({
    unitType: "research-slice",
    unitId: "M001/S01",
    prompt: "research prompt",
    basePath: project,
  }).fanOutSpec!;
  const cancelled: string[] = [];

  try {
    await assert.rejects(
      runPhaseDisciplineScoutFanOut({
        basePath: project,
        unitType: "research-slice",
        unitId: "M001/S01",
        fanOutSpec,
        spawnImpl: ({ task }) => {
          if (task.includes("Codebase")) {
            return {
              cancel: () => {
                cancelled.push("codebase_scan");
              },
              promise: Promise.resolve({
                rawOutput: "raw-codebase_scan",
                stderrOutput: "stderr-codebase_scan",
                exitCode: 1,
                terminalResult: {
                  outputText: "",
                  errorMessage: "boom",
                  terminalError: "boom",
                  stopReason: "error",
                  provider: "openai",
                  model: "gpt-5.4",
                },
              } as any),
            };
          }
          let resolvePromise: ((value: any) => void) | undefined;
          const promise = new Promise((resolve) => {
            resolvePromise = resolve;
          });
          return {
            cancel: () => {
              cancelled.push(task.includes("Constraints") ? "constraints_risks" : "prior_art");
              resolvePromise?.({
                rawOutput: "",
                stderrOutput: "cancelled",
                exitCode: 1,
                terminalResult: {
                  outputText: "",
                  errorMessage: "cancelled",
                  terminalError: "cancelled",
                  stopReason: "error",
                },
              });
            },
            promise: promise as Promise<any>,
          };
        },
      }),
      /Scout codebase_scan failed/,
    );

    const researchPath = join(
      project,
      ".gsd",
      "milestones",
      "M001",
      "slices",
      "S01",
      buildSliceFileName("S01", "RESEARCH"),
    );
    assert.equal(existsSync(researchPath), false);
    assert.ok(cancelled.includes("constraints_risks"));
    assert.ok(cancelled.includes("prior_art"));
    assert.ok(existsSync(join(project, ".gsd", "milestones", "M001", "slices", "S01", ".phase-discipline", "phase-discipline-scout-fanout-M001-S01.json")));
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});
