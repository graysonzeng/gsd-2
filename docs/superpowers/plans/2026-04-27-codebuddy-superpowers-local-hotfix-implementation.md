# CodeBuddy `superpowers` 插件本机热修实现记录

**Date:** 2026-04-27  
**Scope:** S 级本机热修  
**Related Spec:** `docs/superpowers/specs/2026-04-27-codebuddy-superpowers-local-hotfix-design.md`

## 1. 评审意见处理摘要

本次没有找到同主题的独立 `design-review` 文档，因此实现阶段直接以运行验证结果作为修订输入。

实际验证推翻了原始设计中的两个假设：

1. **`skills` 不能与 `commands` 一样直接使用字符串目录路径**
   - 原配置：`"skills": "./skills/"`
   - 结果：`SkillExtensionLoader` 将字符串逐字符处理，出现
     - `Skill path not found: .../superpowers/s`
     - `Skill path not found: .../superpowers/k`
     - `Skill path not found: .../superpowers/i`
     - `Skill path not found: .../superpowers/l`
   - 修订：改为 `"skills": ["./skills/"]`

2. **`hooks` 不应纳入本次最小热修集合**
   - 原配置：`"hooks": "hooks/hooks.json"`
   - 结果：早期试错中在 macOS 上触发 `run-hook.cmd`，日志出现 `permission denied 126`
   - 修订：移除显式 `hooks` 字段，但保留对默认 hook 发现链路的单独复验；“未显式声明 hooks”不等于“hooks 不会执行”

## 2. 采纳的设计修订

最终收敛为以下最小可行配置：

```json
{
  "commands": "./commands/",
  "skills": ["./skills/"],
  "agents": "./agents/"
}
```

修订原则：

- 只保留已通过运行验证的字段
- 不把不同 loader 的行为硬类比
- 不为“显式化完整”而引入新的平台副作用

## 3. 实现摘要

修改文件：

- `~/.codebuddy/plugins/marketplaces/codebuddy-plugins-official/external_plugins/superpowers/.codebuddy-plugin/plugin.json`
- `docs/superpowers/specs/2026-04-27-codebuddy-superpowers-local-hotfix-design.md`

落地步骤：

1. 先将 `commands` / `skills` / `agents` / `hooks` 全部显式化
2. 通过新进程验证发现：
   - `ERR_INVALID_ARG_TYPE` 已消失
   - 但 `skills` 出现逐字符误扫告警
   - `hooks` 触发 `run-hook.cmd` 权限错误
3. 进一步将配置收缩为：
   - `commands`: `"./commands/"`
   - `skills`: `["./skills/"]`
   - `agents`: `"./agents/"`
   - 删除 `hooks`
4. 再次以新进程验证，并按“最终验收对应的最新有效运行窗口”确认日志收敛；中间态失败日志保留为试错证据，不再与最终结论混写

## 4. 验证结果

### 4.1 结构验证

- `plugin.json` 已通过 `/opt/homebrew/bin/python3 -m json.tool` 校验
- 字段值与本机安装目录一致

### 4.2 运行验证

使用新进程触发插件加载：

```bash
codebuddy -p --channels plugin:superpowers@codebuddy-plugins-official "reply with OK"
```

最终验收以同一日志文件中的**最新有效运行窗口**为准；本次采用 `16:37:52` 之后的成功窗口作为最终结论依据。

最新有效日志证据：

- `Loaded 3 command(s) from extension: superpowers@codebuddy-plugins-official`
- `Loaded 14 skill(s) from extension: superpowers@codebuddy-plugins-official`
- `Loaded plugin components for superpowers@codebuddy-plugins-official: 1 agent(s), 3 command(s), 14 skill(s), 1 hook(s), 0 MCP server(s), 0 LSP server(s), 0 output style(s)`
- `SessionStart hook provided additional context`

在该最终验收窗口内，不再出现：

- `Failed to load commands from extension: superpowers@codebuddy-plugins-official`
- `Failed to load skills from extension: superpowers@codebuddy-plugins-official`
- `ERR_INVALID_ARG_TYPE`
- `Skill path not found: .../superpowers/s|k|i|l|l|s`

说明：

- 同一日志文件中更早的 `16:30:57` / `16:31:15` 失败记录属于试错过程，不应与最终验收结论混读
- 删除显式 `hooks` 字段并不会阻止默认 hook 发现；最终窗口中 hook 仍被加载并成功提供 SessionStart context

### 4.3 功能验证

#### command 验证

执行：

```bash
codebuddy -p --channels plugin:superpowers@codebuddy-plugins-official "/superpowers:brainstorm 请只回复：BRAINSTORM_OK"
```

结果：

- 输出 `BRAINSTORM_OK`

#### skill 验证

交叉证据：

- 日志出现 `Skill "systematic-debugging" context=undefined, agent=undefined`
- 同时日志稳定显示 `Loaded 14 skill(s) from extension: superpowers@codebuddy-plugins-official`

说明：

- skill 已被系统识别并触发过一次实际调用
- 本次没有进一步对 skill 输出内容做强约束断言，但“发现 + 调用痕迹”已满足最小可用性验证

## 5. 已知限制

1. 本次是本机热修，不处理 marketplace 更新覆盖问题
2. `agents` 目前保留显式路径；虽然已通过验证，但未继续实验是否可以进一步移除
3. 日志中的 `1 hook(s)` 来自默认发现行为；本次只是不再把 `hooks` 纳入最小热修集合，并未改变默认 hook 发现机制，因此是否出现 `.cmd` 相关噪音必须以最新日志窗口单独判断，不对 hook 跨平台策略做上游修复

## 6. 当前状态

`superpowers` 本机热修已完成，设计与实现已按实测结果收敛。

- 同会话继续：`直接执行 /code-review`
- 新会话恢复 prompt：

```text
请阅读设计文档 docs/superpowers/specs/2026-04-27-codebuddy-superpowers-local-hotfix-design.md、
实现文档 docs/superpowers/plans/2026-04-27-codebuddy-superpowers-local-hotfix-implementation.md，
以及本次提交的代码变更，
使用 /code-review 进行方案重审及代码审查。
```
