# PR-1 CLI Tool-Restriction Chain —— 计划评审

- **被评审文档**：`[docs/superpowers/plans/2026-04-23-pr-1-cli-tool-restriction-chain.md](../plans/2026-04-23-pr-1-cli-tool-restriction-chain.md)`
- **参考规格**：`[docs/superpowers/specs/2026-04-23-cli-tool-restriction-chain.md](../specs/2026-04-23-cli-tool-restriction-chain.md)`
- **权威参考实现**：`feat/composed-lite-runtime-owned` 分支上的 `src/cli.ts` / `src/cli-web-branch.ts` / `packages/pi-coding-agent/src/core/sdk.ts` / `packages/pi-coding-agent/src/core/agent-session.ts` 四文件 diff
- **评审日期**：2026-04-23
- **评审方法**：三方对照（spec ↔ plan ↔ feat 分支实际 diff ↔ main 当前代码）

---

## 总体判断

- **核心设计思路**：✅ 合理且正确
- **plan 文档本身**：⚠️ 有多处与权威参考不一致的细节，若直接按 plan 执行会产出既无法通过自身 acceptance（Task 4 Step 2 的 diff-equal 判据），又会引入生产回归的 PR

---

## 一、核心设计是对的

三层 thread `includeBuiltInSkillTool` / `autoActivateNewExtensionTools` 两个布尔的方案，钩子点选得非常准：

- `**_getBuiltinTools()` 是 Skill 唯一注册入口** —— `_includeBuiltInSkillTool` 在这里门控即可，`setActiveToolsByName` 中的 `[...toolNames, ...this._getBuiltinToolNames()]` 会自动退化为 `[...toolNames]`（因为 `_getBuiltinToolNames()` 返回空），**无需**改 `setActiveToolsByName` 本身。
- `**_refreshToolRegistry` / `_buildRuntime` 的 `includeAllExtensionTools` 默认回退到 `_autoActivateNewExtensionTools`** —— 从源头阻止 extension tool 重新激活，而不是在运行时过滤。
- **CLI 层只在 print/JSON 非交互分支（`src/cli.ts:553-574`）注入** —— 不碰 interactive/web 路径。

方向完全正确。问题全出在 plan 的执行细节描述上。

---

## 二、严重问题（会导致 PR 失败或引入回归）

### ❌ 问题 1：Task 2 Step 1 的 helper 实现与 feat 分支实际代码不一致

Plan Line 189-207 给出的 helper 签名：

```ts
export function resolveCreateAgentSessionToolOptions(flags: CliFlags): {
  tools: string[] | undefined;
  extraToolNames: string[];
  includeBuiltInSkillTool: boolean;
  autoActivateNewExtensionTools: boolean;
}
```

但 `feat/composed-lite-runtime-owned` 上的真实签名是：

```ts
export function resolveCreateAgentSessionToolOptions(
  flags: Pick<CliFlags, 'tools' | 'extraToolNames'>,
): CreateAgentSessionToolOptions {
  const tools = flags.tools?.map((name) => builtInTools[name as BuiltInToolName]).filter(Boolean)
  const hasExplicitToolRestriction = !!flags.tools || !!flags.extraToolNames
  const requestedSkill = (flags.extraToolNames ?? []).some((name) => name.toLowerCase() === 'skill')
  return {
    ...(tools && tools.length > 0 ? { tools } : {}),
    ...(flags.extraToolNames && flags.extraToolNames.length > 0
      ? { extraActiveToolNames: flags.extraToolNames }
      : {}),
    ...(hasExplicitToolRestriction ? { includeBuiltInSkillTool: requestedSkill } : {}),
  }
}
```

差异：

- Plan 返回 4 字段扁平结构；feat 返回 `CreateAgentSessionOptions` 子集（最多 3 字段，且 `tools` 是 `Tool[]` 对象不是字符串数组）
- Plan 有 `autoActivateNewExtensionTools` 字段；feat **根本不返回**这个，它在 `sdk.ts` 内部推导
- Plan 的 builtin 判定用 `!name.includes(":")` 启发式；feat 用 `builtInTools` object map + lowercase 精确匹配

连带 Task 1 Step 1 那 4 个 `assert.deepEqual(result.tools, ["read","grep"])` 的测试断言 —— **针对的是一个并不存在的签名**。如果真按 plan 执行，Task 2 Step 5 的 commit 与 Task 4 Step 2 的 `git diff … feat/composed-lite-runtime-owned` acceptance 会直接冲突。

### ❌ 问题 2：plan 明确禁止修改 parseCliArgs，但 feat 分支恰恰修改了它

Plan Line 210-212：

> Keep `parseCliArgs()` simple; do not move generic parsing into `packages/pi-coding-agent/src/cli/args.ts`

但 feat 分支对 `parseCliArgs` 的 `--tools` 分支做了**核心重写**，把 comma-split 结果按 `builtInTools` 白名单拆成 `flags.tools` 和 `flags.extraToolNames` 两个桶：

```ts
} else if (arg === '--tools' && i + 1 < args.length) {
  const toolNames = args[++i].split(',').map((name) => name.trim()).filter(Boolean)
  const builtinByLower = new Map<string, BuiltInToolName>(
    Object.keys(builtInTools).map((name) => [name.toLowerCase(), name as BuiltInToolName]),
  )
  const builtins: string[] = []
  const extras: string[] = []
  for (const name of toolNames) {
    const builtin = builtinByLower.get(name.toLowerCase())
    if (builtin) { builtins.push(builtin) } else { extras.push(name) }
  }
  flags.tools = builtins
  if (extras.length > 0) flags.extraToolNames = extras
}
```

plan 的描述直接矛盾。而且 `CliFlags.extraToolNames?: string[]` 这个新字段和 `builtInTools` / `BuiltInToolName` 类型本身也要加进 `cli-web-branch.ts`—— plan 整个漏了。

### ❌ 问题 3：未声明的 feat 分支回归必须显式过滤

feat 分支在 `agent-session.ts` 上还做了**与本 PR 无关且有害**的改动：

```diff
@@ -1568,8 +1577,6 @@ export class AgentSession {
 async newSession(options?: {
   parentSession?: string;
   setup?: (sessionManager: SessionManager) => Promise<void>;
-  /** See ExtensionCommandContext.newSession for docs (#3731). */
-  abortSignal?: AbortSignal;
 }): Promise<boolean> {
 ...
-  // #3731: If the caller aborted (e.g. runUnit() timed out and restored cwd to
-  // project root), discard this session before capturing process.cwd() and
-  // rebuilding the tool runtime. Without this check, the late newSession()
-  // would rebuild tools with root cwd, breaking worktree isolation.
-  if (options?.abortSignal?.aborted) {
-    return false;
-  }
```

这是 **PR #3731 worktree 隔离修复**。feat 分支分叉时这部分还没合进 main，后续 main 修复了，feat 分支至今滞后。

同时 `src/cli.ts` 的 feat 分支**还删除了 `printExtensionWarnings` 函数及其两处调用** —— 又是 feat 滞后 main 造成的反向 diff。

plan 在 Task 4 Step 2 要求：

```bash
git diff --unified=5 HEAD feat/composed-lite-runtime-owned -- src/cli.ts ... agent-session.ts
```

> Expected: Diff is empty or limited to deliberate test-only/local naming differences

**做不到**。要么 forward-port 把 `abortSignal`/`printExtensionWarnings` 一起删（引入两个生产回归），要么保留它们（diff 不为空，plan acceptance 失败）。plan 没有承认这两段"反向" delta，也没告诉实现者保留哪一边。

### ❌ 问题 4：`CreateAgentSessionOptions` 字段数量不一致

Plan Task 2 Step 3（Line 239-242）要求 widen `CreateAgentSessionOptions` 加**两个**字段：

```ts
includeBuiltInSkillTool?: boolean;
autoActivateNewExtensionTools?: boolean;
```

feat 分支的 sdk.ts 实际只加了**一个** (`includeBuiltInSkillTool`)。`autoActivateNewExtensionTools` 是 sdk.ts 内部从 `options.tools !== undefined || options.extraActiveToolNames !== undefined` 推导出来，**直接传给 AgentSessionConfig**，不暴露到 SDK 公共接口：

```ts
const hasExplicitToolRestriction = options.tools !== undefined || options.extraActiveToolNames !== undefined;
...
autoActivateNewExtensionTools: !hasExplicitToolRestriction,
```

plan 照抄会把不该暴露的字段暴露出去，再次破坏 Task 4 Step 2 的 diff 相等性。

### ❌ 问题 5：Task 3 Step 2 要求改 `setActiveToolsByName`，但 feat 分支未改

Plan Line 295-305 花大段篇幅说要让 `setActiveToolsByName(...)` 在 restricted 模式下不再强制补 builtins。但 feat 分支 `setActiveToolsByName`（line 809-826）**一行未改**。原因上文已说 —— 门控下沉到 `_getBuiltinTools()` 返回空数组，`setActiveToolsByName` 的 `[...new Set([...toolNames, ...this._getBuiltinToolNames()])]` 自动等价于 `[...toolNames]`。

按 plan 改 `setActiveToolsByName`，多此一举且再次破坏 diff 相等。

### ❌ 问题 6：Task 1 Step 2 的 AgentSession 测试 body 全是 TODO

```ts
it("does not auto-register Skill when includeBuiltInSkillTool=false", async () => {
  // create session with initialActiveToolNames=["read"] and includeBuiltInSkillTool=false
  // assert getActiveToolNames() does not contain "Skill"
});
```

注释占位，没真 assert。Step 3 期望"exit code non-zero / failures mention missing helper …"。但 node test runner 下**空 `it()` 直接 pass**。Step 3 的期望与 Step 1-2 产物互相矛盾。同时触犯 plan 自己在 Line 400-403 "Placeholder scan: No TODO" 的自检条款。

---

## 三、中等问题

### ⚠️ 问题 7：Task 2 Step 5 的 commit 处于失败测试状态

Plan 明确说（Line 254-257）：

> The CLI helper tests now pass. AgentSession tests still fail because runtime honouring is not implemented yet.

但下一步 Step 5 直接 `git commit -m "feat: forward tool restriction options into createAgentSession"`。这意味着提交了一个**测试红**的 commit。如果项目启用了 `pre-push` / CI-per-commit，会被拦。plan 应给出 bisect-friendly 策略（合并提交 or 说明可以接受）。

### ⚠️ 问题 8：pre-flight 无法检测 main 上的关键不变量

Pre-flight Step 1 只 grep 3 个新符号是否 MISSING，没验证：

- `abortSignal` 仍存在于 main 的 `newSession` 签名
- `printExtensionWarnings` 仍存在于 main 的 `cli.ts`

两者是过滤 feat 分支 regression 的前提。应追加：

```bash
grep -n "abortSignal" packages/pi-coding-agent/src/core/agent-session.ts | grep -c newSession
grep -n "printExtensionWarnings" src/cli.ts
```

### ⚠️ 问题 9：非交互 / 交互 / web 三入口的覆盖未列为 non-goals

Plan Line 233 禁止改 interactive createAgentSession (line 723-730) 但没说明语义：**interactive 模式的 `--tools` 会被忽略吗？web 模式呢？**

Spec 侧也模糊。这一断层会让下游 reviewer 或外部用户误用 `--tools` 进入交互模式，然后困惑"为什么 Skill 还在"。建议 plan 的 "Self-review" 节明确 non-goal：

- Interactive (`gsd`) 模式：`--tools` 由用户运行时通过 `/tool` 命令改变，启动时不受限（by design）
- Web (`--web`)：不走 `createAgentSession` 的 `--tools` 路径（by design）
- 只有 Print / JSON / RPC / MCP 非交互入口会 honour `--tools`

### ⚠️ 问题 10：`editMode=hashline` 与 `--tools read,edit` 的交互未测

当 settings 里 editMode=hashline 时，`defaultActiveToolNames = [hashline_read, bash, hashline_edit, write, lsp]`。用户 `--tools read,edit` 会得到 standard read/edit（因为 CLI override default）。

这可能正是设计意图，也可能是 pit fall。至少需要一条回归测试："editMode=hashline + `--tools read,edit` yields standard read/edit"，或反过来 "editMode=standard + `--tools hashline_read,hashline_edit` works"。plan 完全没覆盖。

### ⚠️ 问题 11：`lsp` 不在 feat 分支的 `builtInTools` 白名单

feat 分支的 `builtInTools` 只列 9 个（read, bash, edit, write, grep, find, ls, hashline_edit, hashline_read），**没有 `lsp`**。但 sdk.ts 的 `defaultActiveToolNames` 默认就包含 `lsp`。

实际行为：`--tools read,bash,lsp` 下 `lsp` 会落到 `extraToolNames`，传到 `extraActiveToolNames`，AgentSession 再从 registry 查到 `lsp` tool → 最终仍被激活。**能 work，但绕了一圈**。plan 可以选择：

- 在 cli-web-branch 的 `builtInTools` 加 `lsp`（对称）
- 或在 spec/plan 注明 `lsp` 是已知例外，通过 extras 路径激活（不对称但无副作用）

小瑕疵，非 blocker。

### ⚠️ 问题 12：命名不对称（`extraToolNames` vs `extraActiveToolNames`）缺解释

Plan Line 411 承认断层但不解释。建议一句注释：

> 名字差异由历史原因造成：CLI 层聚焦"用户在 --tools 里写的 extras"，SDK 层聚焦"会实际 activate 的 extras"。保留是为了最小化 main-feat 交换面。

---

## 四、缺失 / 遗漏清单（按影响程度排序）

1. **Regression 过滤清单**（必加）—— `newSession.abortSignal` 必须保留，`printExtensionWarnings` 必须保留，Task 4 Step 2 的 acceptance 相应放宽为"diff 只剩 main-newer/feat-older 的已知 delta"。
2. **parseCliArgs 的 `--tools` 改造**（必加）—— Task 2 新增一个 Step，列出 `builtInTools` map 常量、`BuiltInToolName` 类型、`CliFlags.extraToolNames?: string[]` 字段、split-into-two-buckets 循环。
3. `**setActiveToolsByName` 不改** 的说明（必加）—— 明确门控在 `_getBuiltinTools()` 返回值，不在 `setActiveToolsByName` 拼装处。
4. **SDK 只新增 1 个字段** 的说明（必加）—— `autoActivateNewExtensionTools` 不进 `CreateAgentSessionOptions`，仅是 `AgentSessionConfig` 的字段，sdk.ts 内部推导。
5. **Task 1 测试 body** 必须落实 assert（必加），并且"期望 fail"需要真的 fail。
6. **Pre-flight 追加** `abortSignal`/`printExtensionWarnings` 探针（建议）。
7. **Non-goals 章节** 明列 interactive/web（建议）。
8. **editMode × `--tools` 交互测试**（建议）。
9. **commit-level CI 状态** 说明或合并策略（建议）。

---

## 五、建议修订版 plan 骨架

如果要让 plan 真的可执行，建议按下面 5 个 commit 组织（避免红 commit，避免 feat 分支 regression）：

1. `test: add failing coverage for cli tool restriction chain`
  —— helper + AgentSession 两个文件，body 全部写齐实 assert
2. `feat(cli): split --tools into builtin/extras buckets in parseCliArgs`
  —— 加 `builtInTools` / `BuiltInToolName` / `CliFlags.extraToolNames` / parseCliArgs 分桶逻辑
3. `feat(cli): resolveCreateAgentSessionToolOptions helper`
  —— 真的照 feat 分支签名：`Pick<CliFlags,'tools'|'extraToolNames'>` → `CreateAgentSessionToolOptions` 子集
4. `feat(sdk): includeBuiltInSkillTool option + internal autoActivate derivation`
  —— 只加 1 个 public 字段，sdk.ts 内部推导 autoActivate 传 AgentSessionConfig
5. `feat(agent-session): honour includeBuiltInSkillTool & autoActivateNewExtensionTools`
  改动点：
  - `AgentSessionConfig` 加 2 字段、constructor 默认值
  - `_getBuiltinTools` 门控
  - `_buildRuntime` / `_refreshToolRegistry` 里 `includeAllExtensionTools` 回退到 `_autoActivateNewExtensionTools`
  - **不**改 `setActiveToolsByName`
  - **不**动 `newSession` 的 `abortSignal`
  - **不**动 `cli.ts` 的 `printExtensionWarnings`

最后 `git diff HEAD feat/composed-lite-runtime-owned -- …` 预期只剩：

- `agent-session.ts` 的 `newSession abortSignal` 相关段（main 有、feat 无）
- `cli.ts` 的 `printExtensionWarnings` 函数与两处调用（main 有、feat 无）

这两段是 acceptance 允许的"main-ahead delta"。其他字节相等。

---

## 六、评分


| 维度                                          | 评分      | 说明                                                |
| ------------------------------------------- | ------- | ------------------------------------------------- |
| 问题定义（Skill/extension auto-activate 确需 PR-1） | ✅ 10/10 | spec + plan 背景叙述清楚                                |
| 核心钩子点选择（三层 2 booleans）                      | ✅ 10/10 | 从源头阻断，不是运行时过滤                                     |
| 边界与 non-goals                               | ⚠️ 5/10 | interactive / web 未列入 non-goals                   |
| 对 authoritative reference 的忠实度              | ❌ 3/10  | helper 签名、parseCliArgs 改动、字段数量、setActive 处理 4 处走偏 |
| Regression 防护                               | ❌ 2/10  | `abortSignal` / `printExtensionWarnings` 未处理      |
| 测试骨架完整性                                     | ⚠️ 4/10 | CLI 测试断言针对错签名、AgentSession 测试 body 是 TODO         |
| Commit 流程可执行性                               | ⚠️ 6/10 | 中间存在测试红 commit，未说明                                |
| pre-flight 覆盖                               | ⚠️ 6/10 | 漏 main-only 不变量探针                                 |


---

## 七、结论

核心设计**正确**，plan 需要一次**中等程度返工**再交给 subagent 执行，否则会产出：

1. 偏离 feat 分支的实现（helper 签名、parseCliArgs、字段数量、setActive 改动四处不一致）
2. Task 4 Step 2 acceptance 不通过（未处理 feat 分支的反向 regression）
3. 两个生产回归（#3731 worktree 隔离 + printExtensionWarnings 丢失）

建议按上面的"修订版骨架"把 plan 重写一遍，再进入实现阶段。

---

## 附录 A：对照用的关键代码指针

- 当前 main `agent-session.ts` 工具相关入口：
  - `AgentSessionConfig`：`packages/pi-coding-agent/src/core/agent-session.ts:150-172`
  - `setActiveToolsByName`：`packages/pi-coding-agent/src/core/agent-session.ts:809-826`
  - `_getBuiltinTools`：`packages/pi-coding-agent/src/core/agent-session.ts:1271-1273`
  - `_refreshToolRegistry`：`packages/pi-coding-agent/src/core/agent-session.ts:2144-2206`
  - `_buildRuntime`：`packages/pi-coding-agent/src/core/agent-session.ts:2208-2266`
  - `newSession` (含 #3731 `abortSignal` 修复)：`packages/pi-coding-agent/src/core/agent-session.ts:1568+`
- 当前 main `cli.ts` 中需保留的函数：`printExtensionWarnings`
- 当前 main `cli-web-branch.ts` 中 `--tools` 解析：Line 89-90（仅 comma split，未分桶）
- 当前 main `sdk.ts` `CreateAgentSessionOptions`：`packages/pi-coding-agent/src/core/sdk.ts:79+`

## 附录 B：对照用的 feat 分支 diff stat

```
 packages/pi-coding-agent/src/core/agent-session.ts | 34 +++++------
 packages/pi-coding-agent/src/core/sdk.ts           |  5 ++
 src/cli-web-branch.ts                              | 65 +++++++++++++++++++++-
 src/cli.ts                                         | 18 ++----
 4 files changed, 90 insertions(+), 32 deletions(-)
```

其中 `agent-session.ts` 34 行含 `newSession abortSignal` 回滚段（main-ahead delta），`cli.ts` 18 行含 `printExtensionWarnings` 删除段（main-ahead delta）。

---

## 第二轮评审（v2，plan 修订后）

- **被评审文档**：同一份 plan，经修订后的新版本
- **评审日期**：2026-04-23（同日续评）
- **评审方法**：逐条核对 v1 的 12 条问题是否关闭 + 重新读整份 plan 找新遗漏 + 抽查 `main` 当前代码验证测试用例的构造签名合法性

### 总体判断

- **核心设计**：✅ 仍然正确（未变）
- **plan v2 可执行性**：✅ **可以进入实现阶段**
- **残留问题**：仅剩 4 条非阻塞瑕疵，不影响本 PR 交付

### v1 问题关闭情况

| # | v1 问题 | v2 状态 | 证据（plan 行号）                                                                                               |
| - | ----- | ----- | ------------------------------------------------------------------------------------------------------ |
| 1 | helper 签名错 | ✅ 关闭 | Line 308-328：签名与 feat 分支字节一致（`Pick<CliFlags,'tools'\|'extraToolNames'>` → `CreateAgentSessionToolOptions`） |
| 2 | parseCliArgs 改造未列 | ✅ 关闭 | Line 289-302：明确 `builtInTools` / `BuiltInToolName` / `CliFlags.extraToolNames` / 分桶循环                    |
| 3 | abortSignal / printExtensionWarnings 未处理 | ✅ 关闭 | Line 7、20、34、47-48、58、64-66、351、460、521-525：多处强制"保留"并在 pre-flight 加探针                                 |
| 4 | SDK 字段数量 | ✅ 关闭 | Line 353-376：只加 `includeBuiltInSkillTool`，`autoActivate` 由 `sdk.ts` 内部从 `hasExplicitToolRestriction` 推导 |
| 5 | 误改 setActiveToolsByName | ✅ 关闭 | Line 30、424-443：明文"do not rewrite"，门控下沉到 `_getBuiltinTools()` |
| 6 | 测试 body 是 TODO | ✅ 关闭 | Line 103-162（CLI 测试）、168-263（AgentSession 测试）：全部写成真实 assertion，无一处 TODO |
| 7 | 中间红 commit | ✅ 关闭 | Line 278-280、391-393：明确"No red public commit by default"，本地 WIP 须 squash |
| 8 | pre-flight 覆盖不全 | ✅ 关闭 | Line 58：同一条命令同时探测 3 个 MISSING 与 2 个 FOUND，一次到位 |
| 9 | non-goals 未列 interactive/web/mcp | ✅ 关闭 | Line 547-551：明列 interactive、web、mcp 都不在 PR-1 范围 |
| 10 | editMode × `--tools` 未测 | ⚠️ 仍缺 | v1 即标注为"建议"，非阻塞 |
| 11 | lsp 不在白名单 | ✅ 关闭 | Line 154-162 专门测试 `"lsp currently travels through the extras path for feat parity"` |
| 12 | `extraToolNames` vs `extraActiveToolNames` 命名不对称缺注释 | ⚠️ 仍缺 | v1 即标注为"建议"，非阻塞 |

12 条中 10 条关闭，2 条仍是原本就被标注"建议/非阻塞"的小瑕疵。

### 对 main 当前代码的交叉核对

核对点（都是 plan v2 测试/改动的前置假设）：

- `AgentSessionConfig.customTools?: ToolDefinition[]` —— **已存在**（`packages/pi-coding-agent/src/core/agent-session.ts:160`）
- `AgentSessionConfig.initialActiveToolNames?: string[]` —— **已存在**（`agent-session.ts:164`）
- `CreateAgentSessionOptions.tools?: Tool[]` —— **已存在**（`sdk.ts:98`）
- `CreateAgentSessionOptions.customTools?: ToolDefinition[]` —— **已存在**（`sdk.ts:100`）
- `CreateAgentSessionOptions.extraActiveToolNames?: string[]` —— **已存在**（`sdk.ts:110`）
- `_getBuiltinTools()` 当前实现 —— **存在**（`agent-session.ts:1271-1273`），单点门控完全可行
- `src/resources/extensions/gsd/tests/resolve-ts.mjs` 测试 loader —— **存在**
- 三个新符号在 `main` 上 —— **全部 MISSING**（`resolveCreateAgentSessionToolOptions`、`includeBuiltInSkillTool`、`autoActivateNewExtensionTools`）
- `abortSignal` 仍在 `newSession` —— **存在**
- `printExtensionWarnings` 仍在 `src/cli.ts` —— **存在**

结论：plan v2 的所有前置假设与 `main` 实际一致，**可安全进入实施阶段**。

### 新发现（v2 自身引入的小瑕疵）

#### N1. Task 1 的两个测试代码块未闭合 Markdown fence ⚠️ 格式

- Line 105 的 ```ts 开启，但直到 Line 163 开始下一个 bullet `- [ ] **Step 2**` 之前都没看到闭合的 ``` 行
- Line 168 的 ```ts 同样问题：Line 262 `});` 之后直接是 Line 264 的 `- [ ] **Step 3**`

**影响**：只是 Markdown 渲染问题；执行者从代码块里直接复制不会出错，但阅读体验差。
**修复**：在 162 和 263 下一行各补一个 ``` 闭合标记。**非阻塞**。

#### N2. Task 3 Step 3 的 `reload()` 未给精确行号 ⚠️ 文档精度

- plan Line 398 `agent-session.ts:150-172, 302-320, 1267-1273, 1568+, 2144+` 给出了改动区间，但没覆盖 `reload()`
- plan Line 450 说 "`reload()`: replace hardcoded `includeAllExtensionTools: true` with `this._autoActivateNewExtensionTools`"，但没给行号

**影响**：subagent 必须 grep 一下 `reload` 函数。小成本，非阻塞。
**修复建议**：在 Task 3 Step 3 bullet 列表前加一句 `"具体行号：使用 grep 定位 'includeAllExtensionTools: true' 三处调用点"`，或直接 grep 后把行号补进去。

#### N3. `_autoActivateNewExtensionTools` 默认值的语义陷阱 ⚠️ 正确性

plan Line 420：

```ts
this._autoActivateNewExtensionTools = config.autoActivateNewExtensionTools ?? (config.initialActiveToolNames === undefined);
```

这个默认值的语义是：**如果**没传 `autoActivateNewExtensionTools`，就按"调用方有没有传 `initialActiveToolNames`"判定——有 = 受限，没 = 默认激活。

- 走 `sdk.ts → createAgentSession → new AgentSession({ autoActivateNewExtensionTools: !hasExplicitToolRestriction })` 路径时，fallback 不会触发（✅ 安全）
- 走**直接 new AgentSession**（即 Task 1 Step 2 的测试构造）时，fallback 会触发，行为如下：
    - `initialActiveToolNames: ["read"]` + 不传 `autoActivateNewExtensionTools` → fallback = **false**（不 auto-activate）
    - 完全不传 `initialActiveToolNames` + 不传 `autoActivateNewExtensionTools` → fallback = **true**（auto-activate）

这个 fallback 让 Task 1 Step 2 的三个 AgentSession 测试恰好都 pass。**逻辑上一致、无 bug，但隐式耦合了两个字段的默认值，未来重构时容易误解**。建议在 AgentSessionConfig 的字段注释里明注一句：

```ts
/**
 * Default derivation when omitted: when initialActiveToolNames is defined,
 * the session is assumed restricted and extension tools are not auto-activated.
 */
autoActivateNewExtensionTools?: boolean;
```

**非阻塞**，但属于"今天不加，明年维护时会被 issue 质问"的那类隐式语义。

#### N4. `lsp` 实际激活路径的隐性依赖 ⚠️ 文档缺失

plan Line 154-162 与 Line 551 都说 "`lsp currently travels through the extras path for feat parity`"，即 `lsp` 会通过 `extraActiveToolNames` → `AgentSession.setActiveToolsByName` 找到真正的 `lsp` tool 并激活。

这条路径能 work 有两个**未明确声明**的前置条件：

1. `lsp` tool 在 `AgentSession` 的 `allToolNames`（即 registry）中**必然存在**
2. 当 `initialActiveToolNames=["read"]`、`extraActiveToolNames=["lsp"]` 时，`setActiveToolsByName` 不会因为 `_getBuiltinToolNames()` 返回 `[]`（因 `includeBuiltInSkillTool=false`）而误把 lsp 过滤掉

两个条件都成立（已查阅 `sdk.ts:330-333` 与 `agent-session.ts:1268`），**但 plan 没有任何测试断言"`lsp` 最终落进 `session.getActiveToolNames()`"**。Task 1 的 5 个 CLI 测试只断言 helper 返回值，**没有端到端断言 lsp 被真的激活**。

**影响**：若未来有人把 `lsp` 从 registry 中移除，本 PR 的回归测试不会失败，但生产行为会回退。
**建议**：在 Task 3 Step 4 "flesh out" 阶段加一条 `it("routes lsp through extras path and activates it via registry lookup")`，断言 `session.getActiveToolNames().includes("lsp")`。**非阻塞**，但锁死这条隐式合同对长期维护有益。

### v1 仍未关闭的建议（原本就是非阻塞）

- **B1**（对应 v1 问题 10）：`editMode=hashline × --tools` 交互回归测试仍缺。plan 可在 Task 1 补一个 `"editMode=standard + --tools hashline_read returns the hashline_read variant via extras path"` 或对称测试。**非阻塞**。
- **B2**（对应 v1 问题 12）：`extraToolNames`（CLI 层）与 `extraActiveToolNames`（SDK 层）命名不对称缺注释。`src/cli-web-branch.ts` helper 上补一行 `/** CLI uses "extraToolNames"; SDK uses "extraActiveToolNames". Kept asymmetric to minimise the feat↔main swap surface. */` 即可。**非阻塞**。

### 评分（v2）

| 维度 | v1 评分 | v2 评分 | 说明 |
| - | - | - | - |
| 问题定义 | ✅ 10/10 | ✅ 10/10 | 未变 |
| 核心钩子点选择 | ✅ 10/10 | ✅ 10/10 | 未变 |
| 边界与 non-goals | ⚠️ 5/10 | ✅ 9/10 | interactive/web/mcp 已明列 |
| 对 authoritative reference 的忠实度 | ❌ 3/10 | ✅ 9/10 | helper 签名、字段数量、setActive 处理全部对齐 |
| Regression 防护 | ❌ 2/10 | ✅ 9/10 | abortSignal / printExtensionWarnings 两处都有明文保留 + pre-flight 探针 |
| 测试骨架完整性 | ⚠️ 4/10 | ✅ 9/10 | 两份测试都有完整 assertion；`lsp` 端到端仍缺（N4） |
| Commit 流程可执行性 | ⚠️ 6/10 | ✅ 9/10 | 明确拒绝红 commit；WIP 须 squash |
| pre-flight 覆盖 | ⚠️ 6/10 | ✅ 9/10 | 一条命令同时探测 5 个不变量 |
| 文档精度 | —— | ⚠️ 7/10 | `reload()` 无行号（N2）、Markdown fence 未闭合（N1） |

### 结论

- **设计方案是否合理正确**：✅ 合理且正确
- **核心思路是否有遗漏**：❌ 无硬伤遗漏，仅剩 4 条非阻塞建议（N1-N4 + B1/B2）
- **是否足够完整可以进入下一步开发实现**：✅ **是**。plan v2 已经达到"可由 subagent 按步执行且与 feat 分支产生字节可验证对齐"的水平

**推荐动作**：

1. **立即可做**：修掉 N1（Markdown fence）与 N2（`reload()` 行号），这两条是零成本的文档修复
2. **建议做**：补 N4（`lsp` 端到端断言），`editMode × --tools`（B1），extras 命名不对称注释（B2）
3. **开工前顺手做的 pre-flight**：运行 plan 里的 Pre-flight Step 1-3，确保返回符合期望，不符合立即报告而不是硬推进

没有修 N1-N4 / B1-B2 也**不会**阻止本 PR 通过 Task 4 Step 1-2 的 acceptance（tests green + diff 干净），所以在时间紧的前提下可以直接进入实施。