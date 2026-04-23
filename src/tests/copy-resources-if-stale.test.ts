import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, utimesSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'

const require = createRequire(import.meta.url)
const { needsResourceRefresh } = require('../../scripts/copy-resources-if-stale.cjs') as {
  needsResourceRefresh: (rootDir: string) => boolean
}

function writeFile(root: string, relativePath: string, contents: string): string {
  const fullPath = join(root, relativePath)
  mkdirSync(dirname(fullPath), { recursive: true })
  writeFileSync(fullPath, contents)
  return fullPath
}

test('needsResourceRefresh returns true when dist/resources is missing', () => {
  const root = mkdtempSync(join(tmpdir(), 'gsd-copy-resources-'))
  try {
    writeFile(root, 'src/resources/extensions/gsd/index.ts', 'export {}\n')
    assert.equal(needsResourceRefresh(root), true)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('needsResourceRefresh returns false when dist/resources is newer than src/resources', () => {
  const root = mkdtempSync(join(tmpdir(), 'gsd-copy-resources-'))
  try {
    const srcFile = writeFile(root, 'src/resources/extensions/gsd/index.ts', 'export {}\n')
    const distFile = writeFile(root, 'dist/resources/extensions/gsd/index.js', 'export {}\n')
    const older = new Date(Date.now() - 10_000)
    const newer = new Date(Date.now() + 10_000)
    utimesSync(srcFile, older, older)
    utimesSync(distFile, newer, newer)
    assert.equal(needsResourceRefresh(root), false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('needsResourceRefresh returns true when src/resources is newer than dist/resources', () => {
  const root = mkdtempSync(join(tmpdir(), 'gsd-copy-resources-'))
  try {
    const srcFile = writeFile(root, 'src/resources/extensions/gsd/index.ts', 'export {}\n')
    const distFile = writeFile(root, 'dist/resources/extensions/gsd/index.js', 'export {}\n')
    const older = new Date(Date.now() - 10_000)
    const newer = new Date(Date.now() + 10_000)
    utimesSync(distFile, older, older)
    utimesSync(srcFile, newer, newer)
    assert.equal(needsResourceRefresh(root), true)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
