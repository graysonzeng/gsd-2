/**
 * Tests for `--events` flag — JSONL event stream filtering.
 *
 * Validates argument parsing and the event filter logic used by
 * the headless orchestrator to reduce stdout noise for orchestrators.
 *
 * Uses extracted parsing logic (mirrors headless.ts) to avoid
 * transitive @gsd/native import that breaks in test environment.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

// ─── Extracted parsing logic (mirrors headless.ts) ─────────────────────────

interface HeadlessOptions {
  timeout: number
  json: boolean
  model?: string
  command: string
  commandArgs: string[]
  context?: string
  contextText?: string
  auto?: boolean
  verbose?: boolean
  maxRestarts?: number
  supervised?: boolean
  responseTimeout?: number
  answers?: string
  eventFilter?: Set<string>
}

function parseHeadlessArgs(argv: string[]): HeadlessOptions {
  const options: HeadlessOptions = {
    timeout: 300_000,
    json: false,
    command: 'auto',
    commandArgs: [],
  }

  const args = argv.slice(2)

  const isKnownHeadlessFlag = (value: string): boolean => {
    return value === '--timeout'
      || value === '--json'
      || value === '--model'
      || value === '--context'
      || value === '--context-text'
      || value === '--auto'
      || value === '--verbose'
      || value === '--max-restarts'
      || value === '--answers'
      || value === '--events'
      || value === '--supervised'
      || value === '--response-timeout'
  }

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === 'headless') continue

    if (arg.startsWith('--')) {
      if (arg === '--timeout' && i + 1 < args.length) {
        options.timeout = parseInt(args[++i], 10)
      } else if (arg === '--json') {
        options.json = true
      } else if (arg === '--model' && i + 1 < args.length) {
        options.model = args[++i]
      } else if (arg === '--context' && i + 1 < args.length) {
        options.context = args[++i]
      } else if (arg === '--context-text' && i + 1 < args.length) {
        options.contextText = args[++i]
      } else if (arg === '--auto') {
        options.auto = true
      } else if (arg === '--verbose') {
        options.verbose = true
      } else if (arg === '--max-restarts' && i + 1 < args.length) {
        options.maxRestarts = parseInt(args[++i], 10)
      } else if (arg === '--answers' && i + 1 < args.length) {
        options.answers = args[++i]
      } else if (arg === '--events' && i + 1 < args.length) {
        options.eventFilter = new Set(args[++i].split(','))
        options.json = true
      } else if (arg === '--supervised') {
        options.supervised = true
        options.json = true
      } else if (arg === '--response-timeout' && i + 1 < args.length) {
        options.responseTimeout = parseInt(args[++i], 10)
      } else if (options.command !== 'auto' && !isKnownHeadlessFlag(arg)) {
        options.commandArgs.push(arg)
      }
    } else if (options.command === 'auto') {
      options.command = arg
    } else {
      options.commandArgs.push(arg)
    }
  }

  return options
}

// ─── parseHeadlessArgs: --events flag ──────────────────────────────────────

test('--events parses comma-separated event types into a Set', () => {
  const opts = parseHeadlessArgs(['node', 'gsd', 'headless', '--events', 'agent_end,extension_ui_request', 'auto'])
  assert.ok(opts.eventFilter instanceof Set)
  assert.equal(opts.eventFilter!.size, 2)
  assert.ok(opts.eventFilter!.has('agent_end'))
  assert.ok(opts.eventFilter!.has('extension_ui_request'))
})

test('--events implies --json', () => {
  const opts = parseHeadlessArgs(['node', 'gsd', 'headless', '--events', 'agent_end', 'auto'])
  assert.equal(opts.json, true)
})

test('--events with single type', () => {
  const opts = parseHeadlessArgs(['node', 'gsd', 'headless', '--events', 'agent_end', 'auto'])
  assert.equal(opts.eventFilter!.size, 1)
  assert.ok(opts.eventFilter!.has('agent_end'))
})

test('no --events flag means no filter', () => {
  const opts = parseHeadlessArgs(['node', 'gsd', 'headless', '--json', 'auto'])
  assert.equal(opts.eventFilter, undefined)
})

test('--events with all common types', () => {
  const types = 'agent_start,agent_end,tool_execution_start,tool_execution_end,extension_ui_request'
  const opts = parseHeadlessArgs(['node', 'gsd', 'headless', '--events', types, 'auto'])
  assert.equal(opts.eventFilter!.size, 5)
})

test('--events combined with other flags', () => {
  const opts = parseHeadlessArgs(['node', 'gsd', 'headless', '--timeout', '60000', '--events', 'agent_end', '--verbose', 'next'])
  assert.equal(opts.timeout, 60000)
  assert.equal(opts.verbose, true)
  assert.equal(opts.command, 'next')
  assert.ok(opts.eventFilter!.has('agent_end'))
  assert.equal(opts.json, true)
})

// ─── Event filter matching logic ───────────────────────────────────────────

test('filter allows matching event types', () => {
  const filter = new Set(['agent_end', 'extension_ui_request'])
  assert.ok(filter.has('agent_end'))
  assert.ok(filter.has('extension_ui_request'))
  assert.ok(!filter.has('message_update'))
  assert.ok(!filter.has('tool_execution_start'))
})

test('no filter allows all event types (undefined check)', () => {
  const filter: Set<string> | undefined = undefined
  const shouldEmit = (activeFilter: Set<string> | undefined, type: string) => !activeFilter || activeFilter.has(type)
  assert.ok(shouldEmit(filter, 'agent_end'))
  assert.ok(shouldEmit(filter, 'message_update'))
  assert.ok(shouldEmit(filter, 'tool_execution_start'))
})

test('empty filter blocks all events', () => {
  const filter = new Set<string>()
  const shouldEmit = (type: string) => !filter || filter.has(type)
  assert.ok(!shouldEmit('agent_end'))
  assert.ok(!shouldEmit('message_update'))
})

import {
  mapStatusToExitCode,
  EXIT_SUCCESS,
  EXIT_ERROR,
  EXIT_BLOCKED,
  EXIT_CANCELLED,
  isTerminalCommandNotification,
  getTerminalCommandNotificationExitCode,
  isInteractiveHeadlessTool,
  shouldArmHeadlessIdleTimeout,
} from '../headless-events.js'

// ─── mapStatusToExitCode ─────────────────────────────────────────────────

test('mapStatusToExitCode: "complete" returns EXIT_SUCCESS', () => {
  assert.equal(mapStatusToExitCode('complete'), EXIT_SUCCESS)
})

test('mapStatusToExitCode: "completed" returns EXIT_SUCCESS', () => {
  assert.equal(mapStatusToExitCode('completed'), EXIT_SUCCESS)
})

test('mapStatusToExitCode: "success" returns EXIT_SUCCESS', () => {
  assert.equal(mapStatusToExitCode('success'), EXIT_SUCCESS)
})

test('mapStatusToExitCode: "error" returns EXIT_ERROR', () => {
  assert.equal(mapStatusToExitCode('error'), EXIT_ERROR)
})

test('mapStatusToExitCode: "timeout" returns EXIT_ERROR', () => {
  assert.equal(mapStatusToExitCode('timeout'), EXIT_ERROR)
})

test('mapStatusToExitCode: "blocked" returns EXIT_BLOCKED', () => {
  assert.equal(mapStatusToExitCode('blocked'), EXIT_BLOCKED)
})

test('mapStatusToExitCode: "cancelled" returns EXIT_CANCELLED', () => {
  assert.equal(mapStatusToExitCode('cancelled'), EXIT_CANCELLED)
})

test('mapStatusToExitCode: unknown status returns EXIT_ERROR', () => {
  assert.equal(mapStatusToExitCode('unknown'), EXIT_ERROR)
})

test('isTerminalCommandNotification: no in-progress workflows is terminal', () => {
  assert.equal(isTerminalCommandNotification({
    type: 'extension_ui_request',
    method: 'notify',
    message: 'No in-progress workflows found.',
  }), true)
})

test('isTerminalCommandNotification: composed-lite lock failure is terminal', () => {
  assert.equal(isTerminalCommandNotification({
    type: 'extension_ui_request',
    method: 'notify',
    message: 'Cannot start composed-lite: Another composed-lite runtime (PID 123, run cl-1) is already active. Kill it first or wait for it to finish.',
  }), true)
})

test('isTerminalCommandNotification: composed-lite waiting for admission is terminal', () => {
  assert.equal(isTerminalCommandNotification({
    type: 'extension_ui_request',
    method: 'notify',
    message: 'Composed-lite run cl-1 is waiting for admission approval. Re-run with --approve or --reject.',
  }), true)
})

test('isTerminalCommandNotification: composed-lite non-fuse failure stop is terminal', () => {
  assert.equal(isTerminalCommandNotification({
    type: 'extension_ui_request',
    method: 'notify',
    message: 'Composed-lite run cl-1 stopped at phase 1 (research) after a non-fuse failure. Fix the issue and re-run with /gsd start resume.',
  }), true)
})

test('isTerminalCommandNotification: composed-lite finished failed is terminal', () => {
  assert.equal(isTerminalCommandNotification({
    type: 'extension_ui_request',
    method: 'notify',
    message: 'Composed-lite run cl-1 finished: failed',
  }), true)
})

test('getTerminalCommandNotificationExitCode: info notifications resolve success', () => {
  assert.equal(getTerminalCommandNotificationExitCode({
    type: 'extension_ui_request',
    method: 'notify',
    message: 'No in-progress workflows found.',
    notifyType: 'info',
  }), EXIT_SUCCESS)
})

test('getTerminalCommandNotificationExitCode: error notifications resolve error', () => {
  assert.equal(getTerminalCommandNotificationExitCode({
    type: 'extension_ui_request',
    method: 'notify',
    message: 'Cannot start composed-lite: Another composed-lite runtime is already active.',
    notifyType: 'error',
  }), EXIT_ERROR)
})

test('isInteractiveHeadlessTool: ask_user_questions is interactive', () => {
  assert.equal(isInteractiveHeadlessTool('ask_user_questions'), true)
})

test('isInteractiveHeadlessTool: secure_env_collect is interactive', () => {
  assert.equal(isInteractiveHeadlessTool('secure_env_collect'), true)
})

test('isInteractiveHeadlessTool: non-interactive tools stay false', () => {
  assert.equal(isInteractiveHeadlessTool('bash'), false)
  assert.equal(isInteractiveHeadlessTool(undefined), false)
})

test('shouldArmHeadlessIdleTimeout: arms after tool calls when no interactive tool is in flight', () => {
  assert.equal(shouldArmHeadlessIdleTimeout(1, 0), true)
  assert.equal(shouldArmHeadlessIdleTimeout(3, 0), true)
})

test('shouldArmHeadlessIdleTimeout: stays disarmed while interactive tools are in flight (#3714)', () => {
  assert.equal(shouldArmHeadlessIdleTimeout(1, 1), false)
  assert.equal(shouldArmHeadlessIdleTimeout(5, 2), false)
})

test('shouldArmHeadlessIdleTimeout: stays disarmed before any tool call has started', () => {
  assert.equal(shouldArmHeadlessIdleTimeout(0, 0), false)
  assert.equal(shouldArmHeadlessIdleTimeout(0, 1), false)
})
