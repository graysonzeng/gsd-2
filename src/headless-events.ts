/**
 * Headless Event Detection — notification classification and command detection
 *
 * Detects terminal notifications, blocked notifications, milestone-ready signals,
 * and classifies commands as quick (single-turn) vs long-running.
 *
 * Also defines exit code constants and the status→exit-code mapping function.
 */

import type {
  HeadlessCommandStatus,
  HeadlessJsonResult,
  HeadlessWorkflowStatus,
} from './headless-types.js'

// ---------------------------------------------------------------------------
// Exit Code Constants
// ---------------------------------------------------------------------------

export const EXIT_SUCCESS = 0
export const EXIT_ERROR = 1
export const EXIT_BLOCKED = 10
export const EXIT_CANCELLED = 11
export const EXIT_INCOMPLETE = 12

/**
 * Map a headless session status string to its standardized exit code.
 *
 *   success   → 0
 *   complete  → 0
 *   completed → 0
 *   error     → 1
 *   timeout   → 1
 *   blocked   → 10
 *   cancelled → 11
 *
 * Unknown statuses default to EXIT_ERROR (1).
 */
export function mapStatusToExitCode(status: string): number {
  switch (status) {
    case 'success':
    case 'complete':
    case 'completed':
      return EXIT_SUCCESS
    case 'error':
    case 'timeout':
      return EXIT_ERROR
    case 'blocked':
      return EXIT_BLOCKED
    case 'cancelled':
      return EXIT_CANCELLED
    case 'incomplete':
    case 'needs-continue':
      return EXIT_INCOMPLETE
    default:
      return EXIT_ERROR
  }
}

export function resolveHeadlessTextStatus(args: {
  blocked: boolean
  exitCode: number
  timedOut: boolean
}): 'complete' | 'blocked' | 'cancelled' | 'error' | 'timeout' | 'needs-continue' {
  if (args.blocked) return 'blocked'
  if (args.exitCode === EXIT_CANCELLED) return 'cancelled'
  if (args.exitCode === EXIT_INCOMPLETE) return 'needs-continue'
  if (args.exitCode === EXIT_ERROR) return args.timedOut ? 'timeout' : 'error'
  return 'complete'
}

export function resolveHeadlessSummaryStatus(args: {
  commandStatus: HeadlessCommandStatus
  workflowStatus?: HeadlessWorkflowStatus
}): HeadlessCommandStatus {
  if (args.commandStatus !== 'complete') {
    return args.commandStatus
  }
  if (args.workflowStatus === 'needs-continue') {
    return 'needs-continue'
  }
  return 'complete'
}

export function resolveHeadlessJsonStatus(args: {
  blocked: boolean
  exitCode: number
  timedOut: boolean
}): HeadlessJsonResult['status'] {
  if (args.blocked) return 'blocked'
  if (args.exitCode === EXIT_CANCELLED) return 'cancelled'
  if (args.exitCode === EXIT_INCOMPLETE) return 'incomplete'
  if (args.exitCode === EXIT_ERROR) return args.timedOut ? 'timeout' : 'error'
  return 'success'
}

// ---------------------------------------------------------------------------
// Completion Detection
// ---------------------------------------------------------------------------

/**
 * Detect genuine auto-mode termination notifications.
 *
 * Only matches the actual stop signals emitted by stopAuto():
 *   "Auto-mode stopped..."
 *   "Step-mode stopped..."
 *
 * Does NOT match progress notifications that happen to contain words like
 * "complete" or "stopped" (e.g., "Override resolved — rewrite-docs completed",
 * "All slices are complete — nothing to discuss", "Skipped 5+ completed units").
 *
 * Blocked detection is separate — checked via isBlockedNotification.
 */
export const TERMINAL_PREFIXES = ['auto-mode stopped', 'step-mode stopped']
export const IDLE_TIMEOUT_MS = 15_000
// new-milestone is a long-running creative task where the LLM may pause
// between tool calls (e.g. after mkdir, before writing files). Use a
// longer idle timeout to avoid killing the session prematurely (#808).
export const NEW_MILESTONE_IDLE_TIMEOUT_MS = 120_000
// Auto-mode completes via terminal notification from stopAuto(). The idle
// fallback is disabled for auto-mode to avoid killing long synchronous phases
// (deriveState, resolveDispatch, finalize). Use a generous hard ceiling instead
// so headless doesn't hang forever if the child freezes silently.
export const MAX_AUTO_DURATION_MS = 2 * 60 * 60 * 1000 // 2 hours
const INTERACTIVE_HEADLESS_TOOLS = new Set(['ask_user_questions', 'secure_env_collect'])

export function isTerminalNotification(event: Record<string, unknown>): boolean {
  if (event.type !== 'extension_ui_request' || event.method !== 'notify') return false
  const message = String(event.message ?? '').toLowerCase()
  return TERMINAL_PREFIXES.some((prefix) => message.startsWith(prefix))
}

export function isBlockedNotification(event: Record<string, unknown>): boolean {
  if (event.type !== 'extension_ui_request' || event.method !== 'notify') return false
  const message = String(event.message ?? '').toLowerCase()
  // Blocked notifications come through stopAuto as "Auto-mode stopped (Blocked: ...)"
  return message.includes('blocked:')
}

export function isMilestoneReadyNotification(event: Record<string, unknown>): boolean {
  if (event.type !== 'extension_ui_request' || event.method !== 'notify') return false
  return /milestone\s+m\d+.*ready/i.test(String(event.message ?? ''))
}

export function isInteractiveHeadlessTool(toolName: string | undefined): boolean {
  return INTERACTIVE_HEADLESS_TOOLS.has(String(toolName ?? ''))
}

export function shouldArmHeadlessIdleTimeout(toolCallCount: number, interactiveToolCount: number): boolean {
  return toolCallCount > 0 && interactiveToolCount === 0
}

export function shouldUseHeadlessIdleFallback(command: string): boolean {
  return !['auto', 'new-milestone', 'next', 'discuss', 'plan'].includes(command)
}

export interface UnexpectedChildExitDiagnosticInput {
  code: number | null
  signal?: NodeJS.Signals | string | null
  command: string
  totalEvents: number
  toolCallCount: number
  pendingTurn: boolean
  lastRunId?: string
  lastSessionId?: string
  recentEvents: readonly { type: string; detail?: string }[]
}

export function buildUnexpectedChildExitDiagnostic(input: UnexpectedChildExitDiagnosticInput): string {
  const lines = [
    `[headless] Child process exited unexpectedly with code ${input.code ?? 'null'}${input.signal ? ` (signal ${input.signal})` : ''}`,
    `[headless] Diagnostic: command: ${input.command}; pending turn: ${input.pendingTurn ? 'yes' : 'no'}; events: ${input.totalEvents} total, ${input.toolCallCount} tool calls`,
  ]
  if (input.lastRunId) lines.push(`[headless] Diagnostic: last run: ${input.lastRunId}`)
  if (input.lastSessionId) lines.push(`[headless] Diagnostic: last session: ${input.lastSessionId}`)
  if (input.recentEvents.length > 0) {
    lines.push('[headless] Recent events:')
    for (const event of input.recentEvents.slice(-5)) {
      lines.push(`  ${event.type}${event.detail ? `: ${event.detail}` : ''}`)
    }
  }
  return `${lines.join('\n')}\n`
}

// ---------------------------------------------------------------------------
// Quick Command Detection
// ---------------------------------------------------------------------------

export const FIRE_AND_FORGET_METHODS = new Set(['notify', 'setStatus', 'setWidget', 'setTitle', 'set_editor_text'])

export const QUICK_COMMANDS = new Set([
  'status', 'queue', 'history', 'hooks', 'export', 'stop', 'pause',
  'capture', 'skip', 'undo', 'knowledge', 'config', 'prefs',
  'cleanup', 'migrate', 'doctor', 'remote', 'help', 'steer',
  'triage', 'visualize',
])

const QUICK_WORKFLOW_SUBCOMMANDS = new Set(['list', 'validate'])

export function isQuickCommand(command: string, commandArgs: readonly string[] = []): boolean {
  if (QUICK_COMMANDS.has(command)) return true
  return command === 'workflow' && QUICK_WORKFLOW_SUBCOMMANDS.has(commandArgs[0] ?? '')
}
