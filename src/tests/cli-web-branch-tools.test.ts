import test from 'node:test'
import assert from 'node:assert/strict'

import { parseCliArgs, resolveCreateAgentSessionToolOptions } from '../cli-web-branch.ts'

function toolNames(result: ReturnType<typeof resolveCreateAgentSessionToolOptions>) {
  return result.tools?.map((tool) => tool.name)
}

test('no --tools preserves default createAgentSession behaviour', () => {
  const flags = parseCliArgs(['node', 'gsd', '-p', 'hello'])
  assert.equal(flags.tools, undefined)
  assert.equal(flags.extraToolNames, undefined)

  const result = resolveCreateAgentSessionToolOptions(flags)
  assert.equal(result.tools, undefined)
  assert.equal(result.extraActiveToolNames, undefined)
  assert.equal(result.includeBuiltInSkillTool, undefined)
})

test('parseCliArgs normalizes built-in --tools and preserves extension tool names separately', () => {
  const flags = parseCliArgs([
    'node',
    'gsd',
    '--print',
    '--tools',
    'Read,Bash,gsd_complete_task,browser_navigate',
    'Task: hi',
  ])

  assert.deepEqual(flags.tools, ['read', 'bash'])
  assert.deepEqual(flags.extraToolNames, ['gsd_complete_task', 'browser_navigate'])
})

test('resolveCreateAgentSessionToolOptions maps built-in and extension tools for print/json subagents', () => {
  const result = resolveCreateAgentSessionToolOptions({
    tools: ['read', 'bash'],
    extraToolNames: ['gsd_complete_task', 'browser_navigate'],
  })

  assert.deepEqual(toolNames(result), ['read', 'bash'])
  assert.deepEqual(result.extraActiveToolNames, ['gsd_complete_task', 'browser_navigate'])
  assert.equal(result.includeBuiltInSkillTool, false)
})

test('resolveCreateAgentSessionToolOptions keeps built-in Skill only when explicitly requested', () => {
  const result = resolveCreateAgentSessionToolOptions({
    tools: ['read'],
    extraToolNames: ['Skill'],
  })

  assert.deepEqual(toolNames(result), ['read'])
  assert.deepEqual(result.extraActiveToolNames, ['Skill'])
  assert.equal(result.includeBuiltInSkillTool, true)
})

test('lsp currently travels through the extras path for parity with the reference chain', () => {
  const flags = parseCliArgs(['node', 'gsd', '-p', '--tools', 'read,lsp'])
  assert.deepEqual(flags.tools, ['read'])
  assert.deepEqual(flags.extraToolNames, ['lsp'])

  const result = resolveCreateAgentSessionToolOptions(flags)
  assert.deepEqual(toolNames(result), ['read'])
  assert.deepEqual(result.extraActiveToolNames, ['lsp'])
  assert.equal(result.includeBuiltInSkillTool, false)
})
