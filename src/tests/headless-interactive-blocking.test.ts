/**
 * Tests for headless interactive blocking (fail-closed strategy).
 *
 * Validates that unsupervised headless mode blocks on `select` requests
 * that are not on the safe whitelist, and continues to auto-respond on
 * known-safe select prompts (lock-guard "Force start").
 *
 * Also tests the STATE.md no-diff write skip behavior.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

// ─── Extracted logic (mirrors headless-ui.ts) ────────────────────────────────

const SAFE_SELECT_TITLES: ReadonlyArray<(title: string) => boolean> = [
  (t: string) => t.includes('Auto-mode is running'),
  (t: string) => t.includes('Step-mode is running'),
]

interface MockUIRequest {
  id: string
  method: string
  title?: string
  options?: string[]
  message?: string
  prefill?: string
}

interface MockResponse {
  value?: string
  confirmed?: boolean
  cancelled?: boolean
}

function simulateHandleExtensionUIRequest(event: MockUIRequest): {
  handled: boolean
  response?: MockResponse
  blockedInfo?: { reason: string; method: string; title: string; options?: string[] }
} {
  const { method } = event

  switch (method) {
    case 'select': {
      const title = String(event.title ?? '')
      const isSafe = SAFE_SELECT_TITLES.some(check => check(title))

      if (!isSafe) {
        return {
          handled: false,
          blockedInfo: {
            reason: 'needs-supervised-input',
            method: 'select',
            title,
            options: event.options,
          },
        }
      }

      let selected = event.options?.[0] ?? ''
      if (title.includes('Auto-mode is running') && event.options) {
        const forceOption = event.options.find(o => o.toLowerCase().includes('force start'))
        if (forceOption) selected = forceOption
      }
      if (title.includes('Step-mode is running') && event.options) {
        const forceOption = event.options.find(o => o.toLowerCase().includes('force start'))
        if (forceOption) selected = forceOption
      }
      return { handled: true, response: { value: selected } }
    }
    case 'confirm':
      return { handled: true, response: { confirmed: true } }
    case 'input':
      return { handled: true, response: { value: '' } }
    case 'editor':
      return { handled: true, response: { value: event.prefill ?? '' } }
    case 'notify':
    case 'setStatus':
    case 'setWidget':
    case 'setTitle':
    case 'set_editor_text':
      return { handled: true, response: { value: '' } }
    default:
      return { handled: true, response: { cancelled: true } }
  }
}

// ─── Tests: Fail-Closed Blocking ─────────────────────────────────────────────

test('blocks on "No active milestone" select (the exact bug scenario)', () => {
  const result = simulateHandleExtensionUIRequest({
    id: 'test-1',
    method: 'select',
    title: 'GSD — Get Shit Done',
    options: [
      'Create next milestone (recommended): Define what to build next.',
      'Not yet: Run /gsd when ready.',
    ],
  })

  assert.equal(result.handled, false)
  assert.ok(result.blockedInfo)
  assert.equal(result.blockedInfo!.reason, 'needs-supervised-input')
  assert.equal(result.blockedInfo!.method, 'select')
  assert.equal(result.blockedInfo!.title, 'GSD — Get Shit Done')
  assert.deepEqual(result.blockedInfo!.options, [
    'Create next milestone (recommended): Define what to build next.',
    'Not yet: Run /gsd when ready.',
  ])
})

test('blocks on "All milestones complete" select', () => {
  const result = simulateHandleExtensionUIRequest({
    id: 'test-2',
    method: 'select',
    title: 'GSD — M01: Build Auth',
    options: [
      'Start new milestone (recommended): Define and plan the next milestone.',
      'View status: Review what was built.',
      'Not yet: Run /gsd when ready.',
    ],
  })

  assert.equal(result.handled, false)
  assert.ok(result.blockedInfo)
  assert.equal(result.blockedInfo!.reason, 'needs-supervised-input')
})

test('blocks on "Roadmap exists" select', () => {
  const result = simulateHandleExtensionUIRequest({
    id: 'test-3',
    method: 'select',
    title: 'GSD — M01: Build Auth',
    options: [
      'Go auto (recommended): Execute everything automatically until milestone complete.',
      'View status: See milestone progress and blockers.',
      'Milestone actions: Park, discard, or skip this milestone.',
      'Not yet: Run /gsd status for details.',
    ],
  })

  assert.equal(result.handled, false)
  assert.ok(result.blockedInfo)
})

test('blocks on slice planning select', () => {
  const result = simulateHandleExtensionUIRequest({
    id: 'test-4',
    method: 'select',
    title: 'GSD — M01 / S01: Setup',
    options: [
      'Plan S01 (recommended): Decompose "Setup" into tasks with must-haves.',
      'View status: See milestone progress.',
      'Not yet: Run /gsd when ready.',
    ],
  })

  assert.equal(result.handled, false)
  assert.ok(result.blockedInfo)
})

test('blocks on "Interrupted Session Detected" select', () => {
  const result = simulateHandleExtensionUIRequest({
    id: 'test-5',
    method: 'select',
    title: 'GSD — Interrupted Session Detected',
    options: [
      'Resume with /gsd auto (recommended): Pick up where it left off',
      'Continue manually: Open the wizard as normal',
      'Not yet: Continue when ready.',
    ],
  })

  assert.equal(result.handled, false)
  assert.ok(result.blockedInfo)
})

// ─── Tests: Safe Auto-Response (lock-guard) ──────────────────────────────────

test('auto-responds to "Auto-mode is running" lock-guard with Force start', () => {
  const result = simulateHandleExtensionUIRequest({
    id: 'test-lock-1',
    method: 'select',
    title: 'Auto-mode is running on this project',
    options: [
      'View status: See current progress',
      'Force start: Stop existing and start new',
    ],
  })

  assert.equal(result.handled, true)
  assert.equal(result.response?.value, 'Force start: Stop existing and start new')
})

test('auto-responds to "Step-mode is running" lock-guard with Force start', () => {
  const result = simulateHandleExtensionUIRequest({
    id: 'test-lock-2',
    method: 'select',
    title: 'Step-mode is running on this project',
    options: [
      'View status: See current progress',
      'Force start: Stop existing and start new',
    ],
  })

  assert.equal(result.handled, true)
  assert.equal(result.response?.value, 'Force start: Stop existing and start new')
})

// ─── Tests: Non-select methods still auto-respond ────────────────────────────

test('confirm always auto-responds with true', () => {
  const result = simulateHandleExtensionUIRequest({
    id: 'test-confirm',
    method: 'confirm',
    title: 'Continue?',
  })
  assert.equal(result.handled, true)
  assert.equal(result.response?.confirmed, true)
})

test('input always auto-responds with empty string', () => {
  const result = simulateHandleExtensionUIRequest({
    id: 'test-input',
    method: 'input',
    title: 'Enter name',
  })
  assert.equal(result.handled, true)
  assert.equal(result.response?.value, '')
})

test('editor auto-responds with prefill', () => {
  const result = simulateHandleExtensionUIRequest({
    id: 'test-editor',
    method: 'editor',
    prefill: 'some content',
  })
  assert.equal(result.handled, true)
  assert.equal(result.response?.value, 'some content')
})

test('notify always auto-responds', () => {
  const result = simulateHandleExtensionUIRequest({
    id: 'test-notify',
    method: 'notify',
    message: 'Auto-mode stopped (complete)',
  })
  assert.equal(result.handled, true)
})

test('unknown method auto-responds with cancelled', () => {
  const result = simulateHandleExtensionUIRequest({
    id: 'test-unknown',
    method: 'openBrowser',
    title: 'Open URL',
  })
  assert.equal(result.handled, true)
  assert.equal(result.response?.cancelled, true)
})

// ─── Tests: Source code invariants ───────────────────────────────────────────

test('headless-ui.ts has SAFE_SELECT_TITLES whitelist with fail-closed default', () => {
  const src = readFileSync(join(__dirname, '..', 'headless-ui.ts'), 'utf-8')
  assert.match(src, /SAFE_SELECT_TITLES/)
  assert.match(src, /Auto-mode is running/)
  assert.match(src, /handled:\s*false/)
  assert.match(src, /needs-supervised-input/)
})

test('headless.ts handles blocked result from handleExtensionUIRequest', () => {
  const src = readFileSync(join(__dirname, '..', 'headless.ts'), 'utf-8')
  assert.match(src, /result\.handled/)
  assert.match(src, /result\.blockedInfo/)
  assert.match(src, /headless_blocked/)
  assert.match(src, /blockedReason/)
})

test('headless-types.ts defines HeadlessBlockedEvent', () => {
  const src = readFileSync(join(__dirname, '..', 'headless-types.ts'), 'utf-8')
  assert.match(src, /HeadlessBlockedEvent/)
  assert.match(src, /type:\s*'headless_blocked'/)
  assert.match(src, /reason:\s*'needs-supervised-input'/)
})

test('headless-types.ts HeadlessJsonResult includes reason field', () => {
  const src = readFileSync(join(__dirname, '..', 'headless-types.ts'), 'utf-8')
  assert.match(src, /reason\?\:\s*string/)
})

// ─── Tests: STATE.md no-diff write skip ──────────────────────────────────────

test('workflow-projections.ts skips write when STATE.md content unchanged', () => {
  const src = readFileSync(
    join(__dirname, '..', 'resources', 'extensions', 'gsd', 'workflow-projections.ts'),
    'utf-8',
  )
  // Verify the no-diff guard exists
  assert.match(src, /existing === content/)
  assert.match(src, /readFileSync/)
  // Verify it returns early on match
  assert.match(src, /if \(existing === content\) return/)
})
