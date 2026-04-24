import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
} from "@gsd/pi-coding-agent";

import {
  getAutoCommandContext,
  getAutoDashboardData,
  startAuto,
  type AutoDashboardData,
} from "../auto.js";
import { resetTransientRetryState } from "./agent-end-recovery.js";
import { resetSessionTimeoutState } from "../auto/phases.js";

type AutoResumeSnapshot = Pick<AutoDashboardData, "active" | "paused" | "stepMode" | "basePath">;

function hasCommandContext(
  ctx: ExtensionContext | ExtensionCommandContext | null | undefined,
): ctx is ExtensionCommandContext {
  return typeof (ctx as Partial<ExtensionCommandContext> | null | undefined)?.newSession === "function";
}

export interface ProviderErrorResumeDeps {
  getSnapshot(): AutoResumeSnapshot;
  resetTransientRetryState(): void;
  resetSessionTimeoutState(): void;
  resolveCommandContext(ctx: ExtensionContext): ExtensionCommandContext | null;
  startAuto(
    ctx: ExtensionCommandContext,
    pi: ExtensionAPI,
    base: string,
    verboseMode: boolean,
    options?: { step?: boolean },
  ): Promise<void>;
}

const defaultDeps: ProviderErrorResumeDeps = {
  getSnapshot: () => getAutoDashboardData(),
  resetTransientRetryState,
  resetSessionTimeoutState,
  resolveCommandContext: (ctx) => (hasCommandContext(ctx) ? ctx : getAutoCommandContext()),
  startAuto,
};

export async function resumeAutoAfterProviderDelay(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  deps: ProviderErrorResumeDeps = defaultDeps,
): Promise<"resumed" | "already-active" | "not-paused" | "missing-base" | "missing-command-context"> {
  const snapshot = deps.getSnapshot();

  if (snapshot.active) return "already-active";
  if (!snapshot.paused) return "not-paused";

  if (!snapshot.basePath) {
    ctx.ui.notify(
      "Provider error recovery delay elapsed, but no paused auto-mode base path was available. Leaving auto-mode paused.",
      "warning",
    );
    return "missing-base";
  }

  // Reset retry counters before restarting — without this, counters
  // accumulate across pause/resume cycles and permanently lock out
  // auto-resume after their respective MAX thresholds.
  deps.resetTransientRetryState();
  deps.resetSessionTimeoutState();

  const resumeCommandCtx = deps.resolveCommandContext(ctx);
  if (!resumeCommandCtx) {
    ctx.ui.notify(
      "Provider error recovery delay elapsed, but no resumable command context was available. Leaving auto-mode paused.",
      "warning",
    );
    return "missing-command-context";
  }

  await deps.startAuto(
    resumeCommandCtx,
    pi,
    snapshot.basePath,
    false,
    { step: snapshot.stepMode },
  );
  return "resumed";
}
