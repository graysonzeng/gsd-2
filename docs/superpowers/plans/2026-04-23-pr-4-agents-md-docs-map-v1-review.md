# PR-4 Implementation Review — AGENTS.md Docs-Map v1

**Reviewed plan**: `[2026-04-23-pr-4-agents-md-docs-map-v1.md](./2026-04-23-pr-4-agents-md-docs-map-v1.md)`
**Reviewer**: Claude Opus 4.7 (Code Review Coordinator + 4 specialists)
**Review date**: 2026-04-23
**Branch tip at review**: `54b86ed7e` (branch `feat/phase-discipline-preset-v1`)
**Baseline**: `d007351bc` (`main`)
**Verified against**:

- `docs/superpowers/specs/2026-04-23-agents-md-docs-map-v1.md`
- `docs/superpowers/specs/phase-discipline-preset.md` (v7.1)
- `docs/superpowers/specs/README.md`
- Live code: `agents-md-loader.ts`, `agents-md-lint.ts`, `auto-prompts.ts`, `commands-extract-learnings.ts`, `prompt-loader.ts`, `prompts/execute-task.md`, `scripts/check-agents-docs-map.mts`
- Fixtures: `tests/fixtures/agents-docs-map/{project-root,markerless-root,ancestor-chain,mixed-chain}/`

**Test run**: 21/21 passing (`agents-md-loader.test.ts` + `agents-md-prompt-attachment.test.ts` + `agents-md-lint.test.ts`).
**Lint script**: `scripts/check-agents-docs-map.mts` exits 0 (1 expected sibling-CLAUDE warning).

---

## Verdict

**整体评价：B+（可接受落地，有若干需要短期跟进的安全/一致性事项）。**

Plan 文档内此前 reviewer 标出的三条 High 优先级问题 **已全部闭环**：

- **H1**（`isBareDocsMapBypassed` argv 脆弱性）→ `resolveDocsMapBareBypass` 在 `auto-prompts.ts:91-100` 引入显式 `bare` 优先 + argv fallback + `logWarning`。
- **H2**（spec C11 与 `resource-loader.ts` 语义矛盾）→ spec C11 已改写为 "byte-identical AGENTS.md-then-CLAUDE.md first-match per directory preserved"。
- **H3**（Routing Rule 语法 `**[phrase]`** vs `**phrase**` 不一致）→ `ROUTING_RULE` 正则兼容 `→`/`->`、`normalizeRoutingPhrase` 可选方括号归一化；spec C5 同步措辞兼容。

架构契约（C1–C14）全部符合，平台 `resource-loader.ts` 零侵入（C13），prompt 注入点与 plan 里 "approved attachment points" 一一对应，测试用 `completeMilestonePrompt.match(/## AGENTS\.md Context/g).length === 1` 断言防双重注入。

但评审在 **Security / Quality / Performance / Architecture** 四个维度发现 **3 条 P1（建议本 PR 或紧邻 hotfix 内修）** 和 **3 条 P2（可延至 v1.1）** 事项，记录如下。

---

## Scoring & Priority Classification


| 维度                  | 评分     | 关键判断                                                      |
| ------------------- | ------ | --------------------------------------------------------- |
| Quality（可读性/可维护性）   | **A-** | 模块边界清晰、纯函数与 I/O 分层合理；测试覆盖充分                               |
| Security（越权/暴露）     | **B-** | 祖先目录遍历至 `/`、L1 路径无 jail、运行时缺尺寸 cap —— 低概率但真实存在            |
| Performance（效率）     | **B**  | 同步 I/O 包在 async 里、无缓存、每次 prompt 重解析；当前规模无瓶颈               |
| Architecture（分层/约束） | **A-** | 严格遵循 C13，Plan→Plan slice→Execute→Complete 注入点符合 C1–C14 契约 |



| #   | Issue                                                                   | Area                       | Severity |
| --- | ----------------------------------------------------------------------- | -------------------------- | -------- |
| S1  | 祖先目录遍历至文件系统根 `/`，无仓库边界                                                  | Security                   | P1       |
| S2  | Routing Rules 的 L1 相对路径无 jail，允许 `../` 越界                               | Security                   | P1       |
| S3  | `readFileSync` 失败异常未被捕获                                                 | Security                   | P2       |
| Q1  | 运行时无尺寸 cap，仅 CI lint 兜底                                                 | Quality / Defense-in-Depth | P1       |
| Q2  | `--bare` argv 解析在两个文件里重复实现                                              | Quality / Consistency      | P1       |
| Q3  | `deriveTaskTypeHint` 的 testing/frontend 硬编码 fallback 缺注释                | Quality                    | P2       |
| P1  | 每次 prompt 重新解析 AGENTS.md 链（无缓存）                                         | Performance                | P2       |
| P2  | `loadAgentsSection` async 函数内部全是 `*Sync` I/O                            | Performance                | P2       |
| A1  | `deriveTaskTypeHint` 硬编码 `testing`/`frontend` 打破 "Routing Rules 驱动的中立性" | Architecture               | P2       |


**P0（必须修）**：无。

---

## 🔒 Security Analyst

### S1. 祖先目录遍历至文件系统根（P1）

**位置**: `src/resources/extensions/gsd/agents-md-loader.ts:197-222`

```ts
function findDocsMapFiles(cwd: string): ParsedAgentsDocsMapFile[] {
  const files: ParsedAgentsDocsMapFile[] = [];
  let currentDir = resolve(cwd);
  const rootDir = resolve("/");

  while (true) {
    const agentsPath = join(currentDir, "AGENTS.md");
    if (existsSync(agentsPath)) {
      const parsed = parseAgentsDocsMapContent(agentsPath, readFileSync(agentsPath, "utf-8"));
      if (parsed) files.unshift(parsed);
    }
    if (currentDir === rootDir) break;
    const parentDir = resolve(currentDir, "..");
    if (parentDir === currentDir) break;
    currentDir = parentDir;
  }
  return files;
}
```

**问题**：循环一路 `existsSync` 到 `/`，只要用户或 CI runner 的 `$HOME`、`/Users` 或 `/` 下存在一个带 `<!-- docs-map: v1 -->` 标记的 `AGENTS.md`，它的 L0 就会被拼进 prompt。这违背 GSD "repo-local" 的隐含边界。

**建议修复**：在 loader 增加仓库天花板探测（`.git` / `.gsd` 哨兵）：

```ts
function findRepoCeiling(startDir: string): string {
  let dir = resolve(startDir);
  const root = resolve("/");
  while (dir !== root) {
    if (existsSync(join(dir, ".git")) || existsSync(join(dir, ".gsd"))) return dir;
    const parent = resolve(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }
  return startDir;
}
```

然后把 `findDocsMapFiles` 的终止条件改为 "到达 ceiling 或 `/` 取更早者"。

### S2. L1 相对路径无 jail（P1）

**位置**: `src/resources/extensions/gsd/agents-md-loader.ts:144-152`

```ts
const phrase = normalizeRoutingPhrase(match[1] ?? "");
const relativePath = (match[2] ?? "").trim();
const resolvedPath = resolve(dirname(filePath), relativePath);
if (FORBIDDEN_L1_BASENAMES.has(basename(relativePath))) {
  warnings.push(`Routing Rule in ${filePath} points to forbidden L1 file name: ${relativePath}`);
  continue;
}
rules.push({ phrase, relativePath, resolvedPath });
```

**问题**：Routing Rules 支持任意相对路径，`- **prod** → ../../../../etc/passwd` 会被 `readFileSync(resolvedPath, "utf-8")` 成功读取并拼进 prompt。当前 FORBIDDEN 名单只挡 basename 为 `AGENTS.md`/`CLAUDE.md` 的两类文件。

**建议修复**：加 jail 检查，确保 `resolvedPath` 必须位于 `dirname(filePath)` 子树内：

```ts
const owningDir = resolve(dirname(filePath));
if (!resolvedPath.startsWith(owningDir + require("node:path").sep) && resolvedPath !== owningDir) {
  warnings.push(`Routing Rule in ${filePath} escapes owning directory: ${relativePath}`);
  continue;
}
```

（实际写法用 `relative()` 判断前缀是否为 `..` 也可，视代码风格而定。）

### S3. `readFileSync` 异常未被捕获（P2）

**位置**: `agents-md-loader.ts:308` 读取 L1 时；`loadAgentsSection` 整体无 try/catch。

**影响**：权限问题、符号链接断裂、编码异常会让整个 prompt 构建失败而非降级。建议 loader 把最外层包裹 try/catch，异常转 warning 并返回 `null`。

---

## ✨ Quality Auditor

### Q1. 运行时无尺寸 cap，仅 CI lint 兜底（P1）

`agents-md-lint.ts` 里定义了 `MAX_AGENTS_FILE_CHARS=4000` / `MAX_OPTIONAL_SECTION_CHARS=1000` / `MAX_CHAIN_CHARS=10000`，但 `**loadAgentsSection` 运行时完全不检查**。

**后果**：如果用户本地把 `AGENTS.md` 写到 40K chars 并在 CI 之前运行 auto-mode，40K 会直接进每个 prompt，爆掉 context。CI lint 会在 PR 阶段挡下，但 defense-in-depth 缺失。

**建议修复**：在 `parseAgentsDocsMapContent` 入口加软上限（截断 + warning，不是 error）：

```ts
if (normalized.length > 4000) {
  warnings.push(`AGENTS.md at ${filePath} exceeds 4000 chars, runtime truncating`);
  normalized = normalized.slice(0, 4000);
}
```

### Q2. `--bare` argv 解析重复实现（P1）

- `auto-prompts.ts:91-100` 已有 `resolveDocsMapBareBypass` helper（显式优先 + argv fallback + `logWarning`）。
- `commands-extract-learnings.ts:474-478` 又手写了一份同逻辑的 `process.argv.some(...)`，而且**没有 warning**。

```ts
// commands-extract-learnings.ts（当前实现）
const agentsLoaded = await loadAgentsSection({
  cwd: basePath,
  unitType: "extract-learnings",
  title: milestoneName,
  bare: process.argv.some((arg) => arg === "--bare" || arg === "--bare=true"),
});
```

**建议修复**：把 helper 提到 `agents-md-loader.ts` 导出（或 `shared-harness/` 预留点），两处 import 同一个：

```ts
export function resolveDocsMapBare(explicitBare?: boolean, log?: (msg: string) => void): boolean {
  if (typeof explicitBare === "boolean") return explicitBare;
  const argvBare = process.argv.some((arg) => arg === "--bare" || arg === "--bare=true");
  if (argvBare && log) log("docs-map bare flag resolved from argv fallback");
  return argvBare;
}
```

### Q3. `deriveTaskTypeHint` fallback 的设计意图缺注释（P2）

`agents-md-loader.ts:244-253` 硬编码了 `testing` / `frontend` 两个 fallback 正则，但没有 JSDoc 解释为什么这两个词是"一等公民"。建议 2–3 行注释或直接在 A1 里处理。

---

## ⚡ Performance Reviewer

### P1. 每次 prompt 重新解析（P2）

`loadAgentsSection` 每个 slice/task/milestone prompt 都会：

1. 从 `cwd` 向上 walk 到 `/`（~10+ 次 `existsSync`）
2. 读 + 解析所有命中的 `AGENTS.md`
3. 可能再读 L1 文件

在 "10 slices × 5 tasks" 的 milestone 里重复 ~60 次。单次 < 1ms，**当前完全可接受**。Plan 里 M3 "undefined caching strategy" 就是这一项。

**建议（v1.1）**：简单 `(path, mtimeMs)` → parsed 缓存即可，5–10 行实现：

```ts
const cache = new Map<string, { mtime: number; parsed: ParsedAgentsDocsMapFile | null }>();

function parseCached(filePath: string): ParsedAgentsDocsMapFile | null {
  const mtime = statSync(filePath).mtimeMs;
  const hit = cache.get(filePath);
  if (hit && hit.mtime === mtime) return hit.parsed;
  const parsed = parseAgentsDocsMapContent(filePath, readFileSync(filePath, "utf-8"));
  cache.set(filePath, { mtime, parsed });
  return parsed;
}
```

### P2. 同步 I/O 包在 async 函数里（P2）

`loadAgentsSection` 签名 `Promise<LoadAgentsSectionResult | null>` 但内部全是 `readFileSync`/`existsSync`，会阻塞 event loop。与相邻 `inlineFile`（已用 `fs/promises`）风格不统一。

**建议（v1.1）**：切 `fs/promises`，为 PR-5 phase-discipline 的 cross-review 并发路径铺路。保留当前 `async` 签名是对的。

---

## 🏛️ Architecture Assessor

### A1. `deriveTaskTypeHint` 的硬编码 fallback 破坏中立性（P2）

**位置**: `agents-md-loader.ts:244-253`

```ts
const fallbacks = [
  { phrase: "testing", re: /test|spec|assert|vitest|jest|playwright/ },
  { phrase: "frontend", re: /react|tsx|jsx|css|tailwind|component|frontend/ },
];

for (const fallback of fallbacks) {
  if (phrases.includes(fallback.phrase) && fallback.re.test(haystack)) {
    return fallback.phrase;
  }
}
```

**问题**：Spec C9 说这是 "deterministic pure function"，但这里把 `testing`/`frontend` 两个词当成一等公民。若用户在 AGENTS.md 写 `- **qa** → .docs-map/qa.md`，哪怕任务标题是 "Add unit tests"，当前代码**不会**匹配到 `qa` —— 破坏了 Routing Rules 驱动的中立性。

**建议（v1.1）**：二选一

- **方案 A（推荐）**：删除 fallbacks，严格依赖 substring 匹配；用户自己在 title/filename 里使用 phrase。
- **方案 B**：把 alias 放进 AGENTS.md 本身：`- **testing** (aliases: test, spec, vitest) → .docs-map/testing.md`，loader 解析时扩展匹配。

### A2. Prompt 注入点审计（PASS）


| 注入点                                     | L0  | L1                        | 位置                     | 契约状态 |
| --------------------------------------- | --- | ------------------------- | ---------------------- | ---- |
| `plan-milestone`                        | ✅   | ❌ `includeAddendum:false` | research anchor 之后     | 符合   |
| `plan-slice` / `refine-slice`           | ✅   | ✅                         | `renderSlicePrompt` 最前 | 符合   |
| `execute-task`                          | ✅   | ✅                         | `inlinedTemplates` 头部  | 符合   |
| `complete-slice` / `complete-milestone` | ✅   | ❌                         | roadmap 之前             | 符合   |
| `extract-learnings`                     | ✅   | ❌                         | Prompt 中段              | 符合   |


测试 `plan/refine/execute/complete prompts attach docs-map at approved points` 对每点都有 positive + negative 断言，`completeMilestonePrompt.match(/## AGENTS\.md Context/g).length === 1` 显式防重复注入。**契约 OK**。

### A3. 与 `resource-loader.ts` 的零侵入（PASS）

`git diff main..HEAD -- 'src/**/resource-loader.ts'` 为空。L1 只通过 loader 自己的 `readFileSync` 加载，不进入平台 resource 缓存，符合 **C13**。

### A4. 与 PR-5 phase-discipline 的契约（前瞻）

Spec `phase-discipline-preset.md` 明确 reviewer subagents 拿到的是**完整** AGENTS.md L0，**不带** optional L0 sections（除非显式指示）。PR-4 实现不阻塞该契约；建议 PR-5 reviewer 接线时重走 `loadAgentsSection`（传 `unitType: "review-<...>"`，routingPhrases 走 reviewer 自己的 hint），而不是复用父 prompt 的 L0 拼出的片段。建议 PR-5 plan 内显式加一条 contract 测试。

---

## Improvement Recommendations

按 effort 排序：


| ID     | 描述                                               | 优先级 | 工时   | 覆盖 Issue |
| ------ | ------------------------------------------------ | --- | ---- | -------- |
| **R1** | 提取 `resolveDocsMapBare` 到 loader，两处引用            | P1  | 15m  | Q2       |
| **R2** | L1 path jail + 仓库根封顶（`.git`/`.gsd` ceiling）      | P1  | 20m  | S1, S2   |
| **R3** | 运行时尺寸 cap + 截断 warning                           | P1  | 20m  | Q1       |
| **R4** | `(path, mtime)` → parsed 缓存                      | P2  | 1h   | P1       |
| **R5** | `fs/promises` + 真 async                          | P2  | 2h   | P2, S3   |
| **R6** | `deriveTaskTypeHint` 去硬编码（方案 A）或 alias 元数据（方案 B） | P2  | 1.5h | A1, Q3   |


**归属建议**：R1 + R2 + R3（合计 ~1h）进本 PR 或紧邻 hotfix；R4–R6 作为 v1.1 backlog。

---

## Action Plan

### 立即（本 PR 或紧邻 hotfix）

1. 实施 R1（共享 `resolveDocsMapBare`）。
2. 实施 R2（L1 jail + repo ceiling），补 2 个 fixture 测试：`escapes jail`、`stops at .git ceiling`。
3. 实施 R3（运行时截断 + warning），补 1 个测试：oversize truncation warning。
4. 重跑 `node --test src/resources/extensions/gsd/tests/agents-md-*.ts`，全绿后合并。

### PR-5 启动前

1. 把 R4–R6 写进 `docs/superpowers/plans/` 的 v1.1 backlog（或续到本 plan 文件 "Capability Migration" 节之后）。
2. 在 PR-5 phase-discipline-preset plan 内增加一条 reviewer-subagent 契约测试：`reviewer prompt 应包含完整 L0，不应包含 optional L0 sections`。

### 进入 canary 后的监控项

1. CI `check-agents-docs-map.mts` 命中 error 的频率（期望为 0）。
2. `logWarning("prompt", "...")` argv fallback 路径的触发率（验证 R1 落地效果）。
3. 生产 prompt `## AGENTS.md Context` 命中率（建议加轻量 metric）。

---

## Next Actions（follow-up review checkpoints）

- **本 PR 合并前**：R1/R2/R3 落地后，请 reviewer 再过一次 loader + 测试。
- **PR-5 开分支前**：确认本评审 P2 项已进入 v1.1 backlog，避免 phase-discipline-preset 接线时踩到 A1 / P2。
- **PR-6 lab-branch-retirement 前**：确认 `composed-lite` 到 `auto-mode` 的能力迁移路径已打通 L0 + L1 双通道（spec `phase-discipline-preset.md` §Capability Migration）。

---

**最终结论：PR-4 整体实现扎实，已闭环 plan 里 reviewer 标出的 H1/H2/H3。建议把 R1/R2/R3 三项低成本加固合并后再 ship，即可开启 PR-5（phase-discipline-preset）的合并路径。**