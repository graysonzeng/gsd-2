# CodeBuddy `superpowers` 插件本机热修代码审查

**Date:** 2026-04-27  
**Scope:** 只读设计一致性 + 代码审查  
**Target:** `~/.codebuddy/plugins/marketplaces/codebuddy-plugins-official/external_plugins/superpowers/.codebuddy-plugin/plugin.json`

## 1. 审查范围

本次审查覆盖以下输入与证据：

- 设计文档：`docs/superpowers/specs/2026-04-27-codebuddy-superpowers-local-hotfix-design.md`
- 实现文档：`docs/superpowers/plans/2026-04-27-codebuddy-superpowers-local-hotfix-implementation.md`
- 实际热修文件：`/Users/sheng/.codebuddy/plugins/marketplaces/codebuddy-plugins-official/external_plugins/superpowers/.codebuddy-plugin/plugin.json`
- 运行日志：`/Users/sheng/.codebuddy/logs/2026-04-27/gsd-2__e4154a44059123dc29d0cf15a900bff7.log`
- 相关 hook 文件：
  - `/Users/sheng/.codebuddy/plugins/marketplaces/codebuddy-plugins-official/external_plugins/superpowers/hooks/run-hook.cmd`
  - `/Users/sheng/.codebuddy/plugins/marketplaces/codebuddy-plugins-official/external_plugins/superpowers/hooks/session-start.sh`

## 2. 设计一致性评估

整体结论：**热修目标已基本达成，实现与设计主线一致，但文档对 hooks 行为和验证证据的表述存在偏差。**

一致部分：

- 实际 `plugin.json` 与设计落点一致，显式声明为：
  - `commands: "./commands/"`
  - `skills: ["./skills/"]`
  - `agents: "./agents/"`
- 最终运行日志表明：
  - `superpowers` 的 commands / skills / agents 能稳定加载
  - `ERR_INVALID_ARG_TYPE` 未再出现在 `superpowers` 上
  - 最新有效运行窗口内未再出现 `Skill path not found`

偏差部分：

- 设计/实现文档把 `run-hook.cmd` 权限噪音与“显式声明 hooks”强绑定，但最终配置下默认 hook 发现仍会加载并执行 `run-hook.cmd`
- 实现文档对“已不再出现某类日志”的描述没有显式区分“中间态失败日志”与“最终验收日志窗口”

## 3. 主要发现

### [MEDIUM] 文档一致性: hooks 行为描述与最终运行证据不一致

**文件**:
- `docs/superpowers/specs/2026-04-27-codebuddy-superpowers-local-hotfix-design.md:83-86`
- `docs/superpowers/specs/2026-04-27-codebuddy-superpowers-local-hotfix-design.md:183-186`
- `docs/superpowers/plans/2026-04-27-codebuddy-superpowers-local-hotfix-implementation.md:122-124`
- `/Users/sheng/.codebuddy/logs/2026-04-27/gsd-2__e4154a44059123dc29d0cf15a900bff7.log:10624-10626`
- `/Users/sheng/.codebuddy/logs/2026-04-27/gsd-2__e4154a44059123dc29d0cf15a900bff7.log:11232-11277`
- `/Users/sheng/.codebuddy/plugins/marketplaces/codebuddy-plugins-official/external_plugins/superpowers/hooks/run-hook.cmd:15-19`

**问题**: 设计与实现文档都把 `run-hook.cmd` 的问题表述成“显式声明 `hooks` 才会触发”，但最终有效配置下 `HookExtensionLoader` 仍会通过默认发现加载 hooks，并执行 `run-hook.cmd`。最新运行中它并未再报 126，且 `SessionStart hook provided additional context` 说明 hook 实际成功参与了启动流程。

**影响**: 后续维护者会被误导，以为“删除 `hooks` 字段 = 禁止 hook 执行”。一旦后面再看到 hook 相关日志，很容易沿着错误方向排障。

**建议**: 将文档改成更准确的说法：本次热修只避免 `commands` / `skills` 自动富化导致的契约错误；删除显式 `hooks` 声明并不会阻止默认 hook 发现，hook 是否报错需要单独以最新日志窗口验证。

### [LOW] 验证证据: “不再出现 Skill path not found” 缺少最终日志窗口说明

**文件**:
- `docs/superpowers/plans/2026-04-27-codebuddy-superpowers-local-hotfix-implementation.md:81-92`
- `docs/superpowers/specs/2026-04-27-codebuddy-superpowers-local-hotfix-design.md:244-248`
- `/Users/sheng/.codebuddy/logs/2026-04-27/gsd-2__e4154a44059123dc29d0cf15a900bff7.log:9654-9660`
- `/Users/sheng/.codebuddy/logs/2026-04-27/gsd-2__e4154a44059123dc29d0cf15a900bff7.log:10620-10626`

**问题**: 同一日志文件里同时存在中间态失败记录（`16:30:57` / `16:31:15` 仍有 `Skill path not found`）和最终成功记录（`16:37:52` 以后已收敛）。当前文档写法像是在对整份日志做全局断言，容易造成“明明 grep 得到失败行，文档却说没有”的表面矛盾。

**影响**: 复审者很容易误判热修失败，或者反过来忽略中间态试错过程，降低审计可追溯性。

**建议**: 在设计/实现文档里显式标注“最终验收以最新有效运行窗口为准”，并引用具体日志时间或行号，而不是只写抽象结论。

## 4. 改进建议

1. 保留当前 `plugin.json` 热修内容，不建议再扩大改动面。
2. 修正文档中关于 hooks 的机制描述，避免把“未显式声明”误写成“不会执行”。
3. 将验证结果按“中间态尝试 / 最终验收”分段记录，减少未来复核歧义。
4. 如果后续要长期保留这类本机热修，建议补一段最小复现与验收脚本；否则只靠混合日志回看，迟早会把自己绕进去。

## 5. 最终结论

**PASS_WITH_NOTES**

原因：

- 实际热修文件与设计主方案一致
- 最终运行证据显示 `superpowers` 的 commands / skills / agents 已稳定加载
- 本次未发现必须阻止合并/继续使用的代码级缺陷
- 但文档层面对 hooks 行为和日志证据的描述不够严谨，建议尽快修正

## 6. 下一步

- 若你要对修复结果做复审：`直接执行 /code-review`
- 新会话恢复 prompt：

```text
请阅读实现文档 docs/superpowers/plans/2026-04-27-codebuddy-superpowers-local-hotfix-implementation.md、
审查文档 docs/superpowers/plans/2026-04-27-codebuddy-superpowers-local-hotfix-code-review.md 的修复记录，
以及本次代码变更，
使用 /code-review 对修复结果进行复审。
```

## 7. 修复记录

- 2026-04-27：已按审查意见修正设计文档与实现文档中的 hooks 表述
  - 明确“未显式声明 hooks”仅表示 hooks 不属于本次最小热修集合，不等于默认 hook 发现链路被禁用
  - 补充最终成功证据：`SessionStart hook provided additional context`，说明最终验收窗口内 hook 已成功执行
- 2026-04-27：已修正验证口径
  - 将“日志不再出现失败项”的断言限定为“最终验收对应的最新有效运行窗口”
  - 保留 `16:30:57` / `16:31:15` 的 `Skill path not found` 作为中间态试错证据，不再与最终验收结论混写
- 2026-04-27：已完成复验
  - `plugin.json` 通过 `/opt/homebrew/bin/python3 -m json.tool` 校验
  - 最新成功窗口已推进到日志 `17:14:55`，仍持续出现 `Loaded 3 command(s)`、`Loaded 14 skill(s)` 与 `SessionStart hook provided additional context`
  - 在该最终窗口内未见 `superpowers` 相关 `ERR_INVALID_ARG_TYPE` 或 `Skill path not found`
