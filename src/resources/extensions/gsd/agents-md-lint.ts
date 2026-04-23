import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";

import { parseAgentsDocsMapContent } from "./agents-md-loader.js";

const MAX_AGENTS_FILE_CHARS = 4_000;
const MAX_OPTIONAL_SECTION_CHARS = 1_000;
const MAX_CHAIN_CHARS = 10_000;
const FORBIDDEN_L1_BASENAMES = new Set(["AGENTS.md", "CLAUDE.md"]);

export interface LintResult {
  errors: string[];
  warnings: string[];
}

export function validateDocsMapEntry(input: {
  relativePath: string;
  kind: "agents-md-file" | "optional-section" | "l1-file";
  chars: number;
}): LintResult {
  const errors: string[] = [];

  if (input.kind === "agents-md-file" && input.chars > MAX_AGENTS_FILE_CHARS) {
    errors.push(`${input.relativePath} exceeds ${MAX_AGENTS_FILE_CHARS} chars (${input.chars})`);
  }

  if (input.kind === "optional-section" && input.chars > MAX_OPTIONAL_SECTION_CHARS) {
    errors.push(`${input.relativePath} exceeds ${MAX_OPTIONAL_SECTION_CHARS} chars (${input.chars})`);
  }

  if (input.kind === "l1-file" && FORBIDDEN_L1_BASENAMES.has(basename(input.relativePath))) {
    errors.push(`${input.relativePath} uses forbidden docs-map basename ${basename(input.relativePath)}`);
  }

  return { errors, warnings: [] };
}

function walk(root: string, out: string[]): void {
  const entries = readdirSync(root, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(root, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath, out);
      continue;
    }
    if (entry.isFile() && entry.name === "AGENTS.md") {
      out.push(fullPath);
    }
  }
}

function listMarkerFiles(root: string): string[] {
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    return [];
  }
  const files: string[] = [];
  walk(root, files);
  return files.filter((filePath) => parseAgentsDocsMapContent(filePath, readFileSync(filePath, "utf-8")) !== null);
}

function computeChainChars(filePath: string, parsedByPath: Map<string, ReturnType<typeof parseAgentsDocsMapContent>>): number {
  let total = 0;
  let currentDir = dirname(filePath);
  const rootDir = resolve("/");

  while (true) {
    const agentsPath = join(currentDir, "AGENTS.md");
    const parsed = parsedByPath.get(agentsPath);
    if (parsed) {
      total += parsed.totalChars;
    }
    if (currentDir === rootDir) {
      break;
    }
    const parentDir = resolve(currentDir, "..");
    if (parentDir === currentDir) {
      break;
    }
    currentDir = parentDir;
  }

  return total;
}

export async function lintAgentsDocsMap(input: { roots: string[] }): Promise<LintResult> {
  const errors: string[] = [];
  const warnings: string[] = [];

  for (const root of input.roots) {
    const resolvedRoot = resolve(root);
    const markerFiles = listMarkerFiles(resolvedRoot);
    const parsedByPath = new Map<string, NonNullable<ReturnType<typeof parseAgentsDocsMapContent>>>();

    for (const filePath of markerFiles) {
      const parsed = parseAgentsDocsMapContent(filePath, readFileSync(filePath, "utf-8"));
      if (!parsed) {
        continue;
      }
      parsedByPath.set(filePath, parsed);

      const relativePath = relative(resolvedRoot, filePath) || basename(filePath);
      const fileValidation = validateDocsMapEntry({
        relativePath,
        kind: "agents-md-file",
        chars: parsed.totalChars,
      });
      errors.push(...fileValidation.errors);

      for (const optionalSection of parsed.optionalSections) {
        const optionalValidation = validateDocsMapEntry({
          relativePath: `${relativePath}#task-type:${optionalSection.hint}`,
          kind: "optional-section",
          chars: optionalSection.chars,
        });
        errors.push(...optionalValidation.errors);
      }

      const siblingClaude = join(dirname(filePath), "CLAUDE.md");
      if (existsSync(siblingClaude)) {
        warnings.push(`${relativePath} has sibling CLAUDE.md; AGENTS.md remains the first-match loader winner in this directory`);
      }

      for (const warning of parsed.warnings) {
        warnings.push(relative(resolvedRoot, filePath) ? `${relativePath}: ${warning}` : warning);
      }

      for (const rule of parsed.rules) {
        const l1RelativePath = relative(resolvedRoot, rule.resolvedPath) || basename(rule.resolvedPath);
        const l1Validation = validateDocsMapEntry({
          relativePath: l1RelativePath,
          kind: "l1-file",
          chars: existsSync(rule.resolvedPath) ? readFileSync(rule.resolvedPath, "utf-8").length : 0,
        });
        errors.push(...l1Validation.errors);
      }
    }

    for (const filePath of markerFiles) {
      const parsed = parsedByPath.get(filePath);
      if (!parsed) {
        continue;
      }
      const chainChars = computeChainChars(filePath, parsedByPath);
      if (chainChars > MAX_CHAIN_CHARS) {
        const relativePath = relative(resolvedRoot, filePath) || basename(filePath);
        errors.push(`ancestor chain for ${relativePath} exceeds ${MAX_CHAIN_CHARS} chars (${chainChars})`);
      }
    }
  }

  return { errors, warnings };
}
