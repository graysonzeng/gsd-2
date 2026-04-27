# Dev Flow Skills 修订与实现记录

**Date**: 2026-04-27
**Status**: implemented
**Review input**: `docs/superpowers/plans/2026-04-27-dev-flow-skills-review.md`
**Design input**: 本次未产出独立 `{SPECS_DIR}/2026-04-27-dev-flow-skills-design.md`；以 5 个 `SKILL.md` 直接作为设计输入，符合 `code-review` skill 关于「结构化文档可直接作为设计输入」的约定。

---

## 评审意见处理

| 评审意见 | 处理决策 | 说明 |
|----------|----------|------|
| Skill 名称与生态冲突 | 部分采纳 | 不激进改名，保留现有目录与 skill 名；通过 description / positioning 明确与现有生态的边界 |
| 冗余度过高 | 采纳 | 压缩重复 output / decision 文案，引入共享 references |
| design-implement 职责边界模糊 | 部分采纳 | 不拆 skill，也不增加强制决策门；改为显式说明“修订后默认直接进入实现，但可按用户要求止步” |
| 缺少规模适配机制 | 采纳 | 在设计与评审入口增加 S/M/L 分流说明 |
| 新会话假设过于刚性 | 采纳 | 所有 handoff 改为“同会话继续 + 新会话恢复”双模式 |
| 文档路径硬编码 | 采纳 | 改为 `{SPECS_DIR}` / `{PLANS_DIR}` 默认约定，并保留默认值说明 |
| 评审维度可精简 | 采纳 | `design-review` 从 7 维压缩为 4 维 |
| 两处 typo | 采纳 | 直接修正 |
| fix-implement 的 git 建议过于笼统 | 采纳 | 改为 `git add <relevant-files>` 并建议遵循项目 commit 风格 |
| 缺少流程总览文档 | 采纳 | 新增共享 `dev-flow-overview.md` |

---

## 实现摘要

1. **共享 references**
   - 新增 `src/resources/skills/dev-flow-common/references/findings-format.md`
   - 新增 `src/resources/skills/dev-flow-common/references/dev-flow-overview.md`
2. **5 个 skill 文档瘦身**
   - 更新 `design-brainstorm`、`design-review`、`design-implement`、`code-review`、`fix-implement`
   - 压缩重复的 output / decision 文案
   - 改为引用共享 findings 模板与流程总览
3. **流程边界澄清**
   - 为 `design-brainstorm` 增加 S/M/L 规模分流
   - 为 `design-implement` 明确“修订后默认直接进入实现”，不增加强制决策门
   - 为各阶段增加同会话/新会话双模式 handoff
   - 为 `design-review`、`design-implement`、`code-review` 明确“结构化文档本身也可作为设计输入”，避免只能处理单一 `design.md` 形态
4. **细节修正**
   - 修复 `design-brainstorm` 与 `code-review` 中的 typo
   - 收紧 `fix-implement` 的 git 建议
5. **验证中发现并修复的构建问题**
   - 修复 `src/resources/extensions/gsd/doctor-config.ts` 对上层 `src/models-resolver.ts` 的跨 `rootDir` 依赖
   - 将 `models.json` 路径解析收回资源层，避免 `tsconfig.resources.json` 构建因越界 import 失败

---

## 验证结果

- 已验证新增引用文件路径存在且可读
- 已验证 5 个 `SKILL.md` 仍保留合法 frontmatter（`name` / `description`）
- 已验证两处 typo 已消失、旧的重复 `output_format` 段落已移除、硬编码示例路径不再主导文案
- 已验证 `design-review`、`design-implement`、`code-review` 已显式支持将 `SKILL.md` 等结构化文档作为设计输入
- 已在验证中发现并修复 `doctor-config.ts` 的资源层跨 `rootDir` import 问题
- 验证命令：

```bash
python3 - <<'PY'
from pathlib import Path
files = [
    Path('src/resources/skills/design-brainstorm/SKILL.md'),
    Path('src/resources/skills/design-review/SKILL.md'),
    Path('src/resources/skills/design-implement/SKILL.md'),
    Path('src/resources/skills/code-review/SKILL.md'),
    Path('src/resources/skills/fix-implement/SKILL.md'),
]
extra = [
    Path('src/resources/skills/dev-flow-common/references/findings-format.md'),
    Path('src/resources/skills/dev-flow-common/references/dev-flow-overview.md'),
    Path('docs/superpowers/plans/2026-04-27-dev-flow-skills-implementation.md'),
]
for p in files + extra:
    if not p.exists():
        raise SystemExit(f'MISSING {p}')
for p in files:
    text = p.read_text()
    if not text.startswith('---\n'):
        raise SystemExit(f'BAD_FRONTMATTER_START {p}')
    end = text.find('\n---', 4)
    if end == -1:
        raise SystemExit(f'BAD_FRONTMATTER_END {p}')
    fm = text[4:end]
    if 'name:' not in fm or 'description:' not in fm:
        raise SystemExit(f'MISSING_FRONTMATTER_KEYS {p}')
print('OK skill docs and shared refs present')
PY
```

输出：`OK skill docs and shared refs present`

---

## 已知限制

1. 本次未引入新的编排 skill，仍保留 5-step 分散式结构
2. 本次未拆分 `design-implement`，仅通过文案和流程边界降低歧义
3. 本次未实现真正的动态文档目录解析，仅统一为”默认路径 + 项目覆盖”约定
4. 本次仅补足结构化文档输入边界说明，未新增自动识别或路由逻辑
5. `doctor-config.ts` 的构建修复来自验证暴露的问题，不属于原始评审意见范围，但必须处理才能满足构建通过要求
6. `resolveModelsJsonPath` 在 `src/models-resolver.ts` 和 `src/resources/extensions/gsd/doctor-config.ts` 各有一份实现（受 tsconfig rootDir 约束无法合并）；两处已通过双向注释标记为 twin 实现，修改任一份需同步更新另一份
