/**
 * Models.json resolution with fallback to ~/.pi/agent/models.json
 *
 * GSD uses ~/.gsd/agent/models.json, but for a smooth migration/development
 * experience, this module provides resolution logic that:
 *
 * 1. Reads ~/.gsd/agent/models.json if it exists
 * 2. Falls back to ~/.pi/agent/models.json if GSD file doesn't exist
 * 3. Merges both files if both exist (GSD takes precedence)
 */

import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { agentDir as initialAgentDir } from './app-paths.js'

function getGsdModelsPath(): string {
  const currentAgentDir = process.env.GSD_HOME
    ? join(process.env.GSD_HOME, 'agent')
    : initialAgentDir
  return join(currentAgentDir, 'models.json')
}

function getPiModelsPath(): string {
  return join(homedir(), '.pi', 'agent', 'models.json')
}

/**
 * Resolve the path to models.json with fallback logic.
 *
 * Priority:
 * 1. ~/.gsd/agent/models.json (exists) → return this path
 * 2. ~/.pi/agent/models.json (exists) → return this path (fallback)
 * 3. Neither exists → return GSD path (will be created)
 *
 * IMPORTANT: Twin implementation exists in
 * src/resources/extensions/gsd/doctor-config.ts:resolveModelsJsonPath
 * (kept separate due to tsconfig rootDir constraints).
 * If you change path resolution logic here, update the twin as well.
 *
 * @returns The path to use for models.json
 */
export function resolveModelsJsonPath(): string {
  const gsdModelsPath = getGsdModelsPath()
  const piModelsPath = getPiModelsPath()
  if (existsSync(gsdModelsPath)) {
    return gsdModelsPath
  }
  if (existsSync(piModelsPath)) {
    return piModelsPath
  }
  return gsdModelsPath
}


