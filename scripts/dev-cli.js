#!/usr/bin/env node

import { spawn, spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const devCliPath = fileURLToPath(import.meta.url)
const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')
const srcLoaderPath = resolve(root, 'src', 'loader.ts')
const resolveTsPath = resolve(root, 'src', 'resources', 'extensions', 'gsd', 'tests', 'resolve-ts.mjs')
const copyResourcesIfStalePath = resolve(root, 'scripts', 'copy-resources-if-stale.cjs')

const syncResult = spawnSync(process.execPath, [copyResourcesIfStalePath], {
  cwd: root,
  stdio: 'inherit',
})

if ((syncResult.status ?? 0) !== 0) {
  process.exit(syncResult.status ?? 1)
}

const child = spawn(
  process.execPath,
  ['--import', resolveTsPath, '--experimental-strip-types', srcLoaderPath, ...process.argv.slice(2)],
  {
    cwd: process.cwd(),
    stdio: 'inherit',
    env: { ...process.env, GSD_BIN_PATH: process.env.GSD_BIN_PATH || devCliPath },
  },
)

child.on('error', (error) => {
  console.error(`[gsd] Failed to launch local dev CLI: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal)
    return
  }
  process.exit(code ?? 0)
})
