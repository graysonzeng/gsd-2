# CodeBuddy `superpowers` 插件本机热修设计

**Status:** Draft for review  
**Created:** 2026-04-27  
**Scale:** S 级  
**Author:** AI Assistant  
**Related:**
- `~/.codebuddy/settings.json`
- `~/.codebuddy/plugins/marketplaces/codebuddy-plugins-official/external_plugins/superpowers/.codebuddy-plugin/plugin.json`
- `~/.codebuddy/logs/2026-04-27/gsd-2__e4154a44059123dc29d0cf15a900bff7.log`
- `docs/superpowers/specs/2026-04-27-phase-discipline-readiness-guard-a-phase-design.md`

## 1. 设计目标与范围

本设计只解决一个本机问题：

**在不修改 CodeBuddy 源码的前提下，通过修改本机已安装的 `superpowers` 插件清单，绕过插件自动富化链路中的类型契约缺陷，使 `superpowers` 的 commands / skills 在本机可稳定加载。**

本次成功标准同时满足两项：

1. `superpowers` 加载时不再出现 `ERR_INVALID_ARG_TYPE`
2. slash commands / skills 能稳定显示并可用

### In Scope

- 修改本机已安装 `superpowers` 插件的 `plugin.json`
- 通过新开 CodeBuddy 进程或重启客户端验证插件加载结果
- 验证日志中 `superpowers` 不再触发 commands / skills 的路径类型错误
- 验证 `superpowers` 的 commands / skills 仍可被正常发现

### Out of Scope

- 修改 CodeBuddy 源码
- 修改 marketplace 远端插件包
- 设计团队级、仓库级或上游长期修复方案
- 处理 marketplace 更新后自动保留热修
- 修复与 `superpowers` 无关的其他插件同类问题

## 2. 规模判断

本次属于 **S 级**：

- 目标明确，限定为单机热修
- 预计只改一个已安装插件清单文件
- 不涉及仓库业务代码或产品架构调整
- 接受后续若被插件更新覆盖，再手动重打

虽然根因是平台级缺陷，但本次落地范围是局部、短链路、单点修复，因此不升级到 M/L。

## 3. 问题定义

当前 `superpowers` 的 `plugin.json` 未显式声明 `commands` / `skills`。CodeBuddy 在 `enrichPluginInfo` 中会自动扫描插件目录，并把扫描结果回填到 `plugin.commands` / `plugin.skills`。

问题在于这一步会生成混合数组：

- `commands` 可能是 `{ name, description }` 或 string
- `skills` 可能是 `{ name, description }` 或 string

但后续 `CommandExtensionLoader` / `SkillExtensionLoader` 会把这些项直接当作路径做 `path.join(basePath, item)`。一旦 item 是 object，就会触发：

- `TypeError [ERR_INVALID_ARG_TYPE]: The "path" argument must be of type string. Received an instance of Object`

同时 loader 还会继续扫描默认目录，所以会出现“报错但又部分加载成功”的矛盾日志。

## 4. 方案对比

### 方案 A：按 loader 实际契约显式声明最小路径集合（推荐）

基于 2026-04-27 本机实测，`commands`、`skills`、`hooks` 的契约并不完全一致，不能机械地全部写成字符串。

验证通过的最小组合示意：

```json
{
  "commands": "./commands/",
  "skills": ["./skills/"],
  "agents": "./agents/"
}
```

关键观察：

- `commands` 可接受目录级字符串路径
- `skills` 需要使用数组包裹目录路径；若写成字符串 `"./skills/"`，`SkillExtensionLoader` 会逐字符把 `s/k/i/l/l/s` 当路径处理，产生 `Skill path not found` 告警
- `hooks` 不属于本次最小热修必需项；早期试错中显式声明 `hooks/hooks.json` 曾在 macOS 上触发 `run-hook.cmd` 的 `permission denied 126`，但最终配置即使不显式声明 `hooks`，默认发现链路仍可能继续加载并执行 hook，因此 hook 是否报错必须单独以最终日志窗口复验

**优点**

- 直接短路 `commands` / `skills` 自动富化分支中的类型契约缺陷
- 只保留已验证有效的显式字段，避免把 `hooks` 的平台差异一并引入
- 改动最小，维护成本最低
- 新增命令/技能时通常无需再次改清单

**缺点**

- 依赖本机安装目录结构保持不变
- 插件升级后热修会被覆盖
- `agents` 目前按字符串路径验证通过，但是否还能进一步省略，本次未继续收缩

### 方案 B：在 `plugin.json` 中逐项列出每个 command / skill 的相对路径

示意：

```json
{
  "commands": [
    "./commands/brainstorm.md",
    "./commands/plan.md",
    "./commands/review.md"
  ],
  "skills": [
    "./skills/brainstorming",
    "./skills/systematic-debugging"
  ]
}
```

**优点**

- 输入最显式，便于单项定位
- 若目录结构复杂，路径语义最清楚

**缺点**

- 维护成本高，容易漏项
- `superpowers` 技能数量较多，列举易出错
- 后续插件升级或增删 skill 时需要再次同步

### 方案 C：不改安装目录，只依赖旁路配置或禁用功能绕过

示意：

- 关闭 `superpowers`
- 只保留其他插件
- 或只接受“报错存在但功能部分可用”状态

**优点**

- 不触碰安装目录
- 回滚最简单

**缺点**

- 无法同时满足本次两个成功标准
- 不能消除 `ERR_INVALID_ARG_TYPE`
- 也不能保证 slash commands / skills 稳定可用

## 5. 方案结论

本次采用 **方案 A：按 loader 实际契约显式声明最小路径集合**。

原因：

1. 你要求同时满足“报错消失 + commands / skills 可用”
2. 实测证明 `commands` 与 `skills` 的 loader 契约不同，不能统一按字符串处理
3. 实测证明显式 `hooks` 会在 macOS 上引入 `run-hook.cmd` 权限问题，不应纳入最小热修
4. 对 `superpowers` 这种命令/技能较多的插件，`skills` 使用目录数组比逐项枚举更稳，且维护成本更低

## 6. 详细设计

### 6.1 热修对象

目标文件：

- `~/.codebuddy/plugins/marketplaces/codebuddy-plugins-official/external_plugins/superpowers/.codebuddy-plugin/plugin.json`

当前状态：只有基础元数据，没有 `commands` / `skills` / `agents` / `hooks` 的显式路径声明。

### 6.2 热修内容

在不破坏原有基础元数据的前提下，向 `plugin.json` 增加最小必需的显式路径字段：

```json
{
  "commands": "./commands/",
  "skills": ["./skills/"],
  "agents": "./agents/"
}
```

说明：

- `commands`：交给 command loader 按目录扫描所有 `.md`
- `skills`：必须使用数组包裹目录路径；实测若写成字符串，skill loader 会逐字符误扫
- `agents`：保持 agent 发现路径显式化，已实测可正常加载
- `hooks`：不显式声明，因为它不属于本次为 `commands` / `skills` 契约缺陷止血所必需的最小集合；但这并不等于禁用 hook，默认发现链路仍可能继续加载并执行 `hooks` 目录下的 hook 文件

### 6.3 数据流变化

#### 热修前

1. CodeBuddy 读取 `plugin.json`
2. 因 `commands` / `skills` 缺失，进入 `enrichPluginInfo`
3. 自动扫描目录并生成 object/string 混合数组
4. loader 将数组项当路径做 `path.join`
5. 遇到 object 报 `ERR_INVALID_ARG_TYPE`
6. 同时默认目录扫描继续进行，导致“报错但又加载成功”的矛盾表现

#### 热修后

1. CodeBuddy 读取 `plugin.json`
2. `commands` / `skills` 已存在，跳过自动富化分支
3. `CommandExtensionLoader` 直接拿到目录字符串路径；`SkillExtensionLoader` 拿到目录数组
4. 目录被正常扫描并解析出 commands / skills
5. 不再触发 object 参与 `path.join`，也不再把 `skills` 字符串逐字符当路径处理
6. 加载结果与日志语义收敛

## 7. 错误处理与回滚

### 7.1 可能失败点

1. `plugin.json` 写错导致 JSON 解析失败
2. 相对路径写错导致 commands / skills 未加载
3. `skills` 若误写为字符串而非数组，会产生 `Skill path not found: .../s,k,i,l,l,s` 告警
4. 若显式声明 `hooks`，macOS 下可能触发 `run-hook.cmd` 权限错误
5. CodeBuddy 未完全重启，仍使用旧缓存或旧进程状态
6. marketplace 更新覆盖热修内容

### 7.2 处理方式

- JSON 解析失败：恢复原始 `plugin.json`
- 路径写错：改为与安装目录一致的正确相对路径后重试
- `skills` 逐字符误扫：把 `skills` 从字符串改为数组形式 `['./skills/']`
- `hooks` 权限报错：移除显式 `hooks` 声明，回到默认发现行为
- 未完全重启：新开 CodeBuddy 进程进行干净验证
- 被更新覆盖：按文档重新热修

### 7.3 回滚策略

回滚只需恢复 `plugin.json` 的原始内容即可。由于本次只改一个本机插件清单文件，回滚成本低。

## 8. 验证计划

### 8.1 结构验证

- `plugin.json` 仍是合法 JSON
- 新增字段值与 loader 契约一致：`commands` / `agents` 为字符串路径，`skills` 为单元素数组路径
- 路径在插件安装目录下实际存在

### 8.2 运行验证

用新进程启动 CodeBuddy，并检查：

1. 在**最终验收对应的最新有效运行窗口**内，`superpowers` 不再出现：
   - `Failed to load commands from extension: superpowers@codebuddy-plugins-official`
   - `Failed to load skills from extension: superpowers@codebuddy-plugins-official`
   - `ERR_INVALID_ARG_TYPE`
   - `Skill path not found: .../superpowers/s|k|i|l|l|s`

2. 在同一最终验收窗口内，`superpowers` 仍能出现：
   - `Loaded 3 command(s) from extension: superpowers@codebuddy-plugins-official`
   - `Loaded 14 skill(s) from extension: superpowers@codebuddy-plugins-official`

3. 若同一日志文件中存在更早的试错记录（例如中间态仍出现 `Skill path not found`），应将其视为实现收敛过程的一部分，而不是对最终验收结论的反证

### 8.3 功能验证

至少验证一个 command 和一个 skill：

- command 能在 slash command 列表中发现或触发
- skill 能被正常发现或按命名触发

### 8.4 验收标准

以下同时成立才算完成：

1. 在最终验收对应的最新有效运行窗口内，`superpowers` 的 commands / skills 加载日志不再报类型错误，也不再出现 `Skill path not found`
2. `superpowers` 的 commands / skills 数量与当前安装内容一致
3. 交互层能稳定使用至少一个 command 和一个 skill

## 9. 风险与缓解

### 风险 1：更新覆盖热修

**缓解：** 这是已接受风险；本次不做自动保留，只保留可手动重打的文档化步骤。

### 风险 2：目录扫描结果与当前隐式扫描不完全一致

**缓解：** 通过运行日志和最小功能验证双重确认，而不是只看日志消错。

### 风险 3：只修 `superpowers`，其他插件未来仍可能报同类错误

**缓解：** 本次明确限定为 `superpowers` 本机热修；若后续出现同类插件，可复用本设计思路，但不在本次扩展。

## 10. 关键决策

1. 本次按 **S 级本机热修** 处理，不上升到团队级方案
2. 采用 **按 loader 契约显式声明最小路径集合**，而不是逐项枚举 command / skill
3. 验证必须同时覆盖 **日志消错** 和 **功能可用**，不能只满足其中之一
4. 接受 marketplace 更新覆盖后手动重打
5. 本次只处理 `superpowers`，不顺手扩展到其他插件

## 11. 实施落点

预期只变更一个文件：

- `~/.codebuddy/plugins/marketplaces/codebuddy-plugins-official/external_plugins/superpowers/.codebuddy-plugin/plugin.json`

建议新增字段：

```json
{
  "commands": "./commands/",
  "skills": ["./skills/"],
  "agents": "./agents/"
}
```

---

**结论：**

本次最快、最稳的本机热修不是继续绕日志或禁用功能，而是让 `superpowers` 的 `plugin.json` 按 loader 的真实契约显式提供最小路径集合：`commands` 用字符串目录、`skills` 用数组目录、`agents` 用字符串目录，且不显式声明 `hooks`。这样可以直接切断 `commands` / `skills` 自动富化导致的类型错误，并避免 `skills` 字符串路径带来的逐字符误扫；至于 hooks，是否执行与是否报错需要按默认发现链路和最终日志窗口单独验证，而不能简单等同于“未显式声明即不会触发”。

## 12. 修订记录

- 2026-04-27：基于本机实测修订方案 A
  - 将 `skills` 从字符串路径修订为数组路径 `['./skills/']`
  - 从最小热修集合中移除显式 `hooks`
  - 补充 `Skill path not found` 与 `run-hook.cmd permission denied 126` 的失败模式
  - 更新实施落点与验证标准，使其与真实 loader 行为一致
