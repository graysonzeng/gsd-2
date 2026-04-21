import test from 'node:test'
import assert from 'node:assert/strict'

import * as cliWebBranch from '../cli-web-branch.js'

test('parseCliArgs normalizes built-in --tools and preserves extension tool names separately', () => {
  const flags = cliWebBranch.parseCliArgs([
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

test('cli-web-branch exports a helper to map root CLI --tools to createAgentSession options', () => {
  assert.equal(typeof (cliWebBranch as Record<string, unknown>).resolveCreateAgentSessionToolOptions, 'function')
})

test('resolveCreateAgentSessionToolOptions maps built-in and extension tools for print/json subagents', () => {
  const resolveCreateAgentSessionToolOptions = (cliWebBranch as {
    resolveCreateAgentSessionToolOptions?: (flags: {
      tools?: string[]
      extraToolNames?: string[]
    }) => {
      tools?: Array<{ name: string }>
      extraActiveToolNames?: string[]
      includeBuiltInSkillTool?: boolean
    }
  }).resolveCreateAgentSessionToolOptions

  assert.equal(typeof resolveCreateAgentSessionToolOptions, 'function')

  const result = resolveCreateAgentSessionToolOptions!({
    tools: ['read', 'bash'],
    extraToolNames: ['gsd_complete_task', 'browser_navigate'],
  })

  assert.deepEqual(result.tools?.map((tool) => tool.name), ['read', 'bash'])
  assert.deepEqual(result.extraActiveToolNames, ['gsd_complete_task', 'browser_navigate'])
  assert.equal(result.includeBuiltInSkillTool, false)
})

test('resolveCreateAgentSessionToolOptions keeps built-in Skill only when explicitly requested', () => {
  const resolveCreateAgentSessionToolOptions = (cliWebBranch as {
    resolveCreateAgentSessionToolOptions?: (flags: {
      tools?: string[]
      extraToolNames?: string[]
    }) => {
      includeBuiltInSkillTool?: boolean
    }
  }).resolveCreateAgentSessionToolOptions

  assert.equal(typeof resolveCreateAgentSessionToolOptions, 'function')

  const result = resolveCreateAgentSessionToolOptions!({
    tools: ['read'],
    extraToolNames: ['Skill'],
  })

  assert.equal(result.includeBuiltInSkillTool, true)
})
