export interface RtkSessionSavings {
  commands: number;
  inputTokens: number;
  outputTokens: number;
  savedTokens: number;
  savingsPct: number;
  totalTimeMs: number;
  avgTimeMs: number;
  updatedAt: string;
}

export interface AutoDashboardUnit {
  type: string;
  id: string;
  startedAt: number;
  finishedAt?: number;
  runId?: string;
  unitRunId?: string;
  flowId?: string;
  sessionId?: string;
  sessionFile?: string | null;
  model?: string | null;
  status?: string | null;
  commitSha?: string | null;
  changedFiles?: string[];
}

export interface AutoDashboardData {
  active: boolean;
  paused: boolean;
  stepMode: boolean;
  startTime: number;
  elapsed: number;
  currentUnit: AutoDashboardUnit | null;
  completedUnits: AutoDashboardUnit[];
  basePath: string;
  totalCost: number;
  totalTokens: number;
  rtkSavings?: RtkSessionSavings | null;
  /** Whether RTK is enabled via experimental.rtk preference. False when not opted in. */
  rtkEnabled?: boolean;
}
