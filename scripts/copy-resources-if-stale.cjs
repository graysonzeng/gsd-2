#!/usr/bin/env node
'use strict'

const { spawnSync } = require('node:child_process')
const { readdirSync, statSync } = require('node:fs')
const { join, resolve } = require('node:path')

const IGNORED_DIRS = new Set(['node_modules', '.git', 'dist-test'])

function newestMtime(dir) {
  let max = 0
  const stack = [dir]
  while (stack.length > 0) {
    const current = stack.pop()
    let entries
    try {
      entries = readdirSync(current, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      const fullPath = join(current, entry.name)
      if (entry.isDirectory()) {
        if (!IGNORED_DIRS.has(entry.name)) {
          stack.push(fullPath)
        }
        continue
      }
      try {
        const mtime = statSync(fullPath).mtimeMs
        if (mtime > max) max = mtime
      } catch {
      }
    }
  }
  return max
}

function needsResourceRefresh(rootDir) {
  const srcRoot = join(rootDir, 'src', 'resources')
  const distRoot = join(rootDir, 'dist', 'resources')
  const srcMtime = newestMtime(srcRoot)
  const distMtime = newestMtime(distRoot)
  return distMtime === 0 || srcMtime > distMtime
}

function run(rootDir = resolve(__dirname, '..')) {
  if (!needsResourceRefresh(rootDir)) {
    return 0
  }
  const copyResourcesPath = join(rootDir, 'scripts', 'copy-resources.cjs')
  const result = spawnSync(process.execPath, [copyResourcesPath], {
    cwd: rootDir,
    stdio: 'inherit',
  })
  return result.status ?? 1
}

if (require.main === module) {
  process.exit(run())
}

module.exports = {
  newestMtime,
  needsResourceRefresh,
  run,
}
