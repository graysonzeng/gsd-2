import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";

const DOCS_MAP_MARKER = /^\s*<!--\s*docs-map:\s*v1\s*-->/i;
const TASK_TYPE_MARKER = /<!--\s*task-type:\s*([^>]+?)\s*-->/gi;
const ROUTING_RULE = /^\s*-\s+\*\*(.+?)\*\*\s*(?:→|->)\s*(.+?)\s*$/;
const REQUIRED_SECTIONS = ["identity", "constraints", "routing rules", "invariants"] as const;
const FORBIDDEN_L1_BASENAMES = new Set(["AGENTS.md", "CLAUDE.md"]);
export const MAX_AGENTS_FILE_CHARS = 4_000;
export const MAX_OPTIONAL_SECTION_CHARS = 1_000;
export const MAX_CHAIN_CHARS = 10_000;

type RequiredSectionName = (typeof REQUIRED_SECTIONS)[number];

export interface TaskTypeHintInput {
  unitType: string;
  title?: string;
  filePaths?: string[];
  routingPhrases?: string[];
}

export interface LoadAgentsSectionOptions {
  cwd: string;
  unitType: string;
  title?: string;
  filePaths?: string[];
  bare: boolean;
}

export interface LoadAgentsSectionResult {
  mode: "docs-map-v1";
  l0: string;
  l1: string | null;
  matchedRule: string | null;
  warnings: string[];
  sources: string[];
}

export interface FormatAgentsDocsMapBlockOptions {
  includeAddendum?: boolean;
}

export interface ParsedRoutingRule {
  phrase: string;
  relativePath: string;
  resolvedPath: string;
}

export interface ParsedOptionalSection {
  hint: string;
  content: string;
  chars: number;
}

export interface ParsedAgentsDocsMapFile {
  filePath: string;
  totalChars: number;
  l0: string;
  optionalSections: ParsedOptionalSection[];
  rules: ParsedRoutingRule[];
  warnings: string[];
  hasRoutingRuleError: boolean;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\r\n/g, "\n");
}

function truncateRuntimeContent(value: string, maxChars: number): string {
  return value.length <= maxChars ? value : value.slice(0, maxChars).trimEnd();
}

function applyRuntimeCap(input: {
  content: string;
  maxChars: number;
  warning: string;
  warnings: string[];
}): string {
  if (input.content.length <= input.maxChars) {
    return input.content.trim();
  }
  input.warnings.push(input.warning);
  return truncateRuntimeContent(input.content, input.maxChars);
}

function findRepoCeiling(startDir: string): string | null {
  let currentDir = resolve(startDir);
  const rootDir = resolve("/");

  while (true) {
    if (existsSync(join(currentDir, ".git")) || existsSync(join(currentDir, ".gsd"))) {
      return currentDir;
    }
    if (currentDir === rootDir) {
      return null;
    }
    const parentDir = resolve(currentDir, "..");
    if (parentDir === currentDir) {
      return null;
    }
    currentDir = parentDir;
  }
}

function isWithinOwningDirectory(owningDir: string, resolvedPath: string): boolean {
  const rel = relative(owningDir, resolvedPath);
  return rel !== "" && rel !== "." && rel !== ".." && !rel.startsWith(`..${sep}`);
}

export function resolveDocsMapBare(explicitBare?: boolean, onFallback?: (warning: string) => void): boolean {
  if (typeof explicitBare === "boolean") {
    return explicitBare;
  }
  const argvBare = process.argv.some((arg) => arg === "--bare" || arg === "--bare=true");
  if (argvBare) {
    onFallback?.("docs-map bare flag resolved from argv fallback; prefer explicit runtime plumbing when available");
  }
  return argvBare;
}

export function normalizeRoutingPhrase(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    return trimmed.slice(1, -1).trim().toLowerCase();
  }
  return trimmed.toLowerCase();
}

function splitOptionalSections(content: string): { baseContent: string; optionalSections: ParsedOptionalSection[] } {
  const normalized = normalizeWhitespace(content);
  const matches = Array.from(normalized.matchAll(TASK_TYPE_MARKER));
  if (matches.length === 0) {
    return { baseContent: normalized, optionalSections: [] };
  }

  const firstMarker = matches[0]?.index ?? normalized.length;
  const baseContent = normalized.slice(0, firstMarker);
  const optionalSections: ParsedOptionalSection[] = [];

  for (let index = 0; index < matches.length; index += 1) {
    const current = matches[index];
    if (!current || typeof current.index !== "number") {
      continue;
    }
    const next = matches[index + 1];
    const hint = normalizeRoutingPhrase(current[1] ?? "");
    const blockStart = current.index + current[0].length;
    const blockEnd = typeof next?.index === "number" ? next.index : normalized.length;
    const blockContent = normalized.slice(blockStart, blockEnd).trim();
    optionalSections.push({ hint, content: blockContent, chars: blockContent.length });
  }

  return { baseContent, optionalSections };
}

function extractSectionBlocks(content: string): Map<string, string> {
  const normalized = normalizeWhitespace(content);
  const headingRegex = /^##\s+(.+?)\s*$/gm;
  const headings = Array.from(normalized.matchAll(headingRegex)).map((match) => ({
    title: (match[1] ?? "").trim().toLowerCase(),
    start: match.index ?? 0,
  }));

  const sections = new Map<string, string>();
  for (let index = 0; index < headings.length; index += 1) {
    const current = headings[index];
    const next = headings[index + 1];
    const end = next ? next.start : normalized.length;
    const block = normalized.slice(current.start, end).trim();
    sections.set(current.title, block);
  }
  return sections;
}

function parseRoutingRulesSection(filePath: string, sectionBlock: string): {
  rules: ParsedRoutingRule[];
  warnings: string[];
  hasRoutingRuleError: boolean;
} {
  const warnings: string[] = [];
  const rules: ParsedRoutingRule[] = [];
  let hasRoutingRuleError = false;
  const lines = normalizeWhitespace(sectionBlock).split("\n").slice(1);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    if (!trimmed.startsWith("-")) {
      continue;
    }
    const match = line.match(ROUTING_RULE);
    if (!match) {
      hasRoutingRuleError = true;
      warnings.push(`Malformed Routing Rule in ${filePath}: ${trimmed}`);
      continue;
    }
    const phrase = normalizeRoutingPhrase(match[1] ?? "");
    const relativePath = (match[2] ?? "").trim();
    const owningDir = resolve(dirname(filePath));
    const resolvedPath = resolve(owningDir, relativePath);
    if (FORBIDDEN_L1_BASENAMES.has(basename(relativePath))) {
      warnings.push(`Routing Rule in ${filePath} points to forbidden L1 file name: ${relativePath}`);
      continue;
    }
    if (!isWithinOwningDirectory(owningDir, resolvedPath)) {
      warnings.push(`Routing Rule in ${filePath} escapes owning directory: ${relativePath}`);
      continue;
    }
    rules.push({ phrase, relativePath, resolvedPath });
  }

  return { rules, warnings, hasRoutingRuleError };
}

export function parseAgentsDocsMapContent(filePath: string, content: string): ParsedAgentsDocsMapFile | null {
  const normalized = normalizeWhitespace(content);
  if (!DOCS_MAP_MARKER.test(normalized)) {
    return null;
  }

  const { baseContent, optionalSections } = splitOptionalSections(normalized);
  const sections = extractSectionBlocks(baseContent);
  const warnings: string[] = [];
  const l0Sections: string[] = [];

  for (const requiredSection of REQUIRED_SECTIONS) {
    const block = sections.get(requiredSection);
    if (!block) {
      warnings.push(`Missing mandatory section \"${requiredSection}\" in ${filePath}`);
      continue;
    }
    l0Sections.push(block.trim());
  }

  const routingSection = sections.get("routing rules") ?? "";
  const parsedRoutingRules = parseRoutingRulesSection(filePath, routingSection);
  warnings.push(...parsedRoutingRules.warnings);

  return {
    filePath,
    totalChars: normalized.length,
    l0: l0Sections.join("\n\n"),
    optionalSections,
    rules: parsedRoutingRules.rules,
    warnings,
    hasRoutingRuleError: parsedRoutingRules.hasRoutingRuleError,
  };
}

function formatSourcedSection(sourceRoot: string, filePath: string, content: string): string {
  const rel = relative(sourceRoot, filePath) || basename(filePath);
  return [`### Source: \`${rel}\``, "", content.trim()].join("\n");
}

function findDocsMapFiles(cwd: string): ParsedAgentsDocsMapFile[] {
  const files: ParsedAgentsDocsMapFile[] = [];
  let currentDir = resolve(cwd);
  const rootDir = resolve("/");
  const ceilingDir = findRepoCeiling(currentDir) ?? currentDir;

  while (true) {
    const agentsPath = join(currentDir, "AGENTS.md");
    if (existsSync(agentsPath)) {
      const parsed = parseAgentsDocsMapContent(agentsPath, readFileSync(agentsPath, "utf-8"));
      if (parsed) {
        files.unshift(parsed);
      }
    }

    if (currentDir === ceilingDir || currentDir === rootDir) {
      break;
    }
    const parentDir = resolve(currentDir, "..");
    if (parentDir === currentDir) {
      break;
    }
    currentDir = parentDir;
  }

  return files;
}

export function deriveTaskTypeHint(input: TaskTypeHintInput): string | null {
  const phrases = Array.from(new Set((input.routingPhrases ?? [])
    .map((phrase) => normalizeRoutingPhrase(phrase))
    .filter(Boolean)));
  if (phrases.length === 0) {
    return null;
  }

  const haystack = [
    input.unitType,
    input.title ?? "",
    ...(input.filePaths ?? []),
  ].join("\n").toLowerCase();

  for (const phrase of phrases) {
    if (haystack.includes(phrase)) {
      return phrase;
    }
  }

  const fallbacks = [
    { phrase: "testing", re: /test|spec|assert|vitest|jest|playwright/ },
    { phrase: "frontend", re: /react|tsx|jsx|css|tailwind|component|frontend/ },
  ];

  for (const fallback of fallbacks) {
    if (phrases.includes(fallback.phrase) && fallback.re.test(haystack)) {
      return fallback.phrase;
    }
  }

  return null;
}

export async function loadAgentsSection(options: LoadAgentsSectionOptions): Promise<LoadAgentsSectionResult | null> {
  if (options.bare) {
    return null;
  }

  const docsMapFiles = findDocsMapFiles(options.cwd);
  if (docsMapFiles.length === 0) {
    return null;
  }

  const warnings = docsMapFiles.flatMap((file) => file.warnings);
  const routingPhrases = docsMapFiles.flatMap((file) => file.rules.map((rule) => rule.phrase));
  const hint = deriveTaskTypeHint({
    unitType: options.unitType,
    title: options.title,
    filePaths: options.filePaths,
    routingPhrases,
  });

  const totalChainChars = docsMapFiles.reduce((sum, file) => sum + file.totalChars, 0);
  const l0Blocks = docsMapFiles.flatMap((file) => {
    const blocks: string[] = [];
    if (file.l0.trim().length > 0) {
      const cappedL0 = applyRuntimeCap({
        content: file.l0,
        maxChars: MAX_AGENTS_FILE_CHARS,
        warning: `AGENTS.md at ${file.filePath} exceeds ${MAX_AGENTS_FILE_CHARS} chars at runtime; truncating prompt attachment`,
        warnings,
      });
      blocks.push(formatSourcedSection(options.cwd, file.filePath, cappedL0));
    }
    if (hint) {
      const matchedOptionalSections = file.optionalSections.filter((section) => section.hint === hint && section.content.trim().length > 0);
      for (const section of matchedOptionalSections) {
        const cappedSection = applyRuntimeCap({
          content: section.content,
          maxChars: MAX_OPTIONAL_SECTION_CHARS,
          warning: `Optional docs-map section "${section.hint}" in ${file.filePath} exceeds ${MAX_OPTIONAL_SECTION_CHARS} chars at runtime; truncating prompt attachment`,
          warnings,
        });
        blocks.push(formatSourcedSection(options.cwd, file.filePath, cappedSection));
      }
    }
    return blocks;
  });

  let l1: string | null = null;
  let matchedRule: string | null = null;
  const hasRoutingRuleError = docsMapFiles.some((file) => file.hasRoutingRuleError);
  const sources = docsMapFiles.map((file) => file.filePath);

  if (hint && !hasRoutingRuleError) {
    for (let index = docsMapFiles.length - 1; index >= 0; index -= 1) {
      const file = docsMapFiles[index];
      const matched = file.rules.find((rule) => rule.phrase === hint);
      if (!matched) {
        continue;
      }
      matchedRule = matched.phrase;
      if (!existsSync(matched.resolvedPath)) {
        warnings.push(`Docs-map L1 file not found for ${file.filePath}: ${matched.relativePath}`);
        break;
      }
      const l1Content = readFileSync(matched.resolvedPath, "utf-8").trim();
      l1 = formatSourcedSection(options.cwd, matched.resolvedPath, l1Content);
      sources.push(matched.resolvedPath);
      break;
    }
  }

  let l0 = l0Blocks.join("\n\n---\n\n").trim();
  if (totalChainChars > MAX_CHAIN_CHARS || l0.length > MAX_CHAIN_CHARS) {
    warnings.push(`AGENTS.md ancestor chain for ${options.cwd} exceeds ${MAX_CHAIN_CHARS} chars at runtime; truncating prompt attachment`);
    l0 = truncateRuntimeContent(l0, MAX_CHAIN_CHARS);
  }

  return {
    mode: "docs-map-v1",
    l0,
    l1,
    matchedRule,
    warnings,
    sources,
  };
}

export function buildAgentsDocsMapPromptBlock(
  result: LoadAgentsSectionResult,
  options: FormatAgentsDocsMapBlockOptions = {},
): string {
  const includeAddendum = options.includeAddendum !== false;
  const parts = ["## AGENTS.md Context", "", result.l0.trim()];
  if (includeAddendum && result.l1) {
    parts.push("", "## Docs-Map Addendum", "", result.l1.trim());
  }
  return parts.join("\n").trim();
}
