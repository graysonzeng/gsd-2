# Phase-Discipline Seeded-Auto 下一会话 continue handoff

- 日期：2026-04-24
- 主仓分支：`feat/phase-discipline-preset-v1`
- 隔离 repo：`/Users/sheng/tencent/gsd-phase-discipline-auto-56G8jS`
- 相关 commit：`1c1796bfb` / `8a3faa3b7` / `f5e664dbb`

## 0. 一句话结论

上一会话真实跑通了 phase-discipline seeded-auto 的**主干全流程**到 `validate-milestone (verdict=needs-remediation)`；下一会话只需要做两件事：**（A）改进隔离模板避免 `.gsd` symlink + 临时 HOME 导致 state 被误删**，**（B）seed 一个 verdict 能出 `pass` 的新 milestone**，然后重跑 `headless auto`，观察并记录 `verify-fuse` / `complete-milestone` / `findings-to-memories` 的真实行为。

## 1. 已确认事实（不要重复验证）

- phase-discipline `research-slice → plan-slice → impl-plan-validator → execute-task → complete-slice → validate-milestone` 已**真实跑通**。
- PR-3b reviewer-hook 在 `claude-code` provider 不可用时能自动 fallback 到 `anthropic` provider 并在 `zhumuai` 上成功。
- runtime 写出完整 canonical artifacts：
  - `S01-RESEARCH.md` / `S01-PLAN.md` / `IMPL-PLAN-VALIDATION.md`
  - `T01-PLAN.md` / `T01-SUMMARY.md` / `T01-VERIFY.json`
  - `S01-SUMMARY.md` / `S01-UAT.md`
  - `.phase-discipline/phase-discipline-scout-fanout-M001-S01.json` + 3 份 scout stdout log
- runtime 自己做了 task-level git commit `9bfed32 docs: Appended a concise validation note to docs/notes.md.`（含 `GSD-Task: S01/T01` trailer）。
- **没有发现 `phase-discipline/*` runtime bug**。
- zhumuai（`https://zhumuai.com`）同一把 key 覆盖 OpenAI 兼容 + Anthropic 兼容；`/v1/models` / `/v1/chat/completions` / `/v1/responses` / `/v1/messages` 均 200。
- **pi-ai 的 Node fetch 默认 UA 会被 Cloudflare Error 1010 拦截**；必须在 `models.json.providers.*.headers` 注入 `User-Agent: curl/8.7.1`。
- `~/.zshrc` 已删除 3 行 `sandboxai` 污染；`~/.gsd/agent/models.json` 已删除 `providers.anthropic`。

证据文件：

- `docs/superpowers/plans/2026-04-24-phase-discipline-auto-mode-validation-findings.md` §9
- `docs/superpowers/plans/2026-04-24-phase-discipline-next-session-handoff.md` §10 / §11

## 2. 当前阻塞（两个，都不是 runtime bug）

### 2.1 `.gsd` symlink + 临时 HOME 冲突

`.gsd` 在 isolated repo 里是一个 **symlink**，运行时会被重写到 `$HOME/.gsd/projects/<hash>/`。使用临时 `HOME` 隔离运行后，如果脚本末尾 `rm -rf "$TMP_HOME"`，M001 所有 `.gsd/milestones/*` runtime state 会随之删除。

当前 `.gsd` 指向的目录已经不存在（上一会话清理时被删）：

```text
.gsd -> /tmp/gsd-pd-auto3-tLlX66/.gsd/projects/0dfdd86ee7af   (broken)
```

### 2.2 `validate-milestone` verdict = `needs-remediation`

这是 runtime 的**设计性 pause**（`verify_fuse_on_fail=true` + auto-dispatch `complete-milestone` close guard），不是 bug。但在当前 fixture 下不会自然变 `pass`，需要：

- 写更明确的 acceptance，让 validator 直接给 `pass`；或
- seed 一个 remediation slice 让 runtime 真跑 `verify-fuse`

## 3. 下一会话主目标

1. **不要** 改 `phase-discipline/*` runtime 主实现。
2. **不要** 把 key 写入本机 `~/.gsd/agent/auth.json`、仓库或 shell 配置。
3. 改进隔离模板，避免 `.gsd` symlink 被临时 HOME 删除。
4. Seed 一个 verdict 能直接 `pass` 的新 milestone（建议 `M002`）。
5. 用修好的模板重跑 `headless auto`，真实跑过 `verify-fuse` + `complete-milestone` + `findings-to-memories`。
6. 把结果写进 `docs/superpowers/plans/2026-04-24-phase-discipline-auto-mode-validation-findings.md` §10（新增），同时在本文件末尾追加 "12. 续接结果"。

## 4. 推荐的隔离模板（修复 symlink 副作用）

核心思路：**`agent` 目录（auth.json + models.json）放临时路径，`projects/<hash>` 放稳定路径。**

```bash
ZK='<zhumuai-openai-compatible-key>'          # 在当前会话 terminal export 再使用
BASE=/Users/sheng/tencent/gsd-phase-discipline-auto-56G8jS
STABLE_HOME="$HOME/.cache/gsd-pd-stable"      # 稳定位置，跨会话保留
TMP_AGENT="$(mktemp -d /tmp/gsd-pd-agent-XXXXXX)"

# 1. 重建 .gsd symlink 指向稳定 projects 目录
rm -f "$BASE/.gsd"
mkdir -p "$STABLE_HOME/.gsd/projects/0dfdd86ee7af"
ln -s "$STABLE_HOME/.gsd/projects/0dfdd86ee7af" "$BASE/.gsd"

# 2. 临时 agent dir 只放 auth.json + models.json
mkdir -p "$TMP_AGENT/.gsd/agent"
cat > "$TMP_AGENT/.gsd/agent/models.json" <<'JSON'
{
  "providers": {
    "openai": {
      "baseUrl": "https://zhumuai.com/v1",
      "headers": { "User-Agent": "curl/8.7.1" }
    },
    "anthropic": {
      "baseUrl": "https://zhumuai.com",
      "headers": { "User-Agent": "curl/8.7.1" }
    }
  }
}
JSON
printf '{"openai":{"type":"api_key","key":"%s"},"anthropic":{"type":"api_key","key":"%s"}}\n' "$ZK" "$ZK" \
  > "$TMP_AGENT/.gsd/agent/auth.json"
# projects 指到 stable
ln -s "$STABLE_HOME/.gsd/projects" "$TMP_AGENT/.gsd/projects"
chmod 700 "$TMP_AGENT/.gsd" "$TMP_AGENT/.gsd/agent"
chmod 600 "$TMP_AGENT/.gsd/agent/"*

# 3. 跑 gsd
env -u OPENAI_API_KEY -u ANTHROPIC_API_KEY -u ANTHROPIC_BASE_URL \
    -u OPENAI_BASE_URL -u OPENAI_API_BASE -u ANTHROPIC_MODEL \
    HOME="$TMP_AGENT" \
    node /Users/sheng/tencent/gsd-2/dist/loader.js \
    headless --verbose --timeout 1800000 --max-restarts 0 auto

# 4. 运行结束后只清理临时 agent dir（auth.json 里有 key），projects 保留
find "$TMP_AGENT" -type f -exec shred -uz {} + 2>/dev/null || \
  find "$TMP_AGENT" -type f -exec rm -f {} +
rm -rf "$TMP_AGENT"
```

验证点：运行后 `ls -la $BASE/.gsd` 应仍指向 `$STABLE_HOME/.gsd/projects/0dfdd86ee7af/` 并且该目录仍存在。

## 5. Seed M002 的最小 fixture（让 verdict 直接 pass）

`M001` 已被运行时当作完成但 `needs-remediation`。建议开新 milestone `M002`，acceptance 写明"append 一行到 docs/notes.md 即视为 pass"。

### 5.1 `M002-CONTEXT.md`

```md
# Append a second validation note

Milestone goal: append exactly one plain-language validation line to docs/notes.md.

Acceptance (explicit for milestone validator):
- docs/notes.md must contain at least 4 non-empty lines after this milestone.
- No files outside docs/notes.md may be modified.
- No tests are required; this milestone is docs-only.
- If these two bullets are satisfied, validate-milestone must return verdict=pass.
```

### 5.2 `M002-ROADMAP.md`

```md
# M002: Append second validation note

- [ ] **S01: Append one more line** `risk:low` `depends:[]`
  > After this: docs/notes.md has at least 4 non-empty lines; no other files change.
```

### 5.3 `slices/S01/S01-PLAN.md`

```md
# S01: Append one more line

**Goal:** Add one more plain-language validation line to docs/notes.md.
**Demo:** docs/notes.md has ≥ 4 non-empty lines after this slice.

## Must-Haves
- Only edit docs/notes.md
- One short line, consistent with existing tone
- No other files changed

## Tasks

- [ ] **T01: Append second validation note** `est:small`
  - Edit `docs/notes.md`
```

只需要 `M002-CONTEXT.md` + `M002-ROADMAP.md` + `slices/S01/S01-PLAN.md` 这三份即可（参考 M001 的已写布局）。

## 6. 主流程（全步骤）

1. 在当前会话 terminal：
   ```bash
   export ZHUMUAI_OPENAI_KEY='<your-zhumuai-key>'
   ```
2. 使用 §4 的隔离模板脚本（替换 `ZK=$ZHUMUAI_OPENAI_KEY`）。
3. 先清理现有坏 symlink，按 §4 建立 stable projects。
4. 在 isolated repo seed `M002`（§5 三份文件）。
5. 运行 `headless query` 确认 `next.unitType=research-slice`、`unitId=M002/S01`。
6. 跑 `headless --verbose --timeout 1800000 --max-restarts 0 auto`。
7. 预期事件链：
   - scout fan-out 3/3 ✓
   - plan-slice ✓
   - impl-plan-validator ✓
   - execute-task T01 ✓（edit docs/notes.md）
   - complete-slice ✓
   - validate-milestone verdict=pass ✓（acceptance 已写明）
   - verify-fuse ✓
   - complete-milestone ✓
   - findings-to-memories ✓
8. 收集 `headless query` 最终状态：milestones done=1/1，activeMilestone=null。

## 7. 退出条件

下一会话只要满足以下任一，就可以正式退出：

- `M002` 完整跑完 `verify-fuse / complete-milestone / findings-to-memories`，runtime 回 idle。
- 或者真实发现某个 phase bug（在此前尚未发现的），并写回 findings。

如果 `validate-milestone` 仍 verdict=`needs-remediation`，说明 M002 的 acceptance 还不够明确，下一动作是再 tighten `M002-CONTEXT.md`（不是改 runtime）。

## 8. 禁止事项

- 不重开 `new-milestone --auto` 主线
- 不改 `phase-discipline/*` runtime 主实现
- 不修改 `~/.gsd/agent/auth.json` 或 `~/.gsd/agent/models.json` 原文件
- 不修改 `~/.zshrc` / 其他 shell rc 文件
- 不把 `zhumuai` key 写到仓库、`env` 文件或任何被 git tracked 的位置
- 不 `git push`
- 不 `rm -rf $HOME` 或 `rm -rf /tmp/*`（只删自己本轮 mktemp 生成的 `agent` 目录）

## 9. 已知 side-findings（保留，不做）

- `~/.gsd/agent/models.json` 仍保留 `providers.openai.baseUrl=https://api.sandboxai.top/v1`。本轮**不动**；如下一会话想让非隔离环境默认走 zhumuai，再改这一条。
- `~/.gsd/agent/auth.json` 里 openai/anthropic 都是旧 sandboxai key。本轮**不动**。
- 仓库根的 `env` 文件含明文 sandboxai key 且未 gitignore。**建议用户手工**处理（删除 或 加入 `.gitignore`）；下一会话的 agent **不要** 自动 `git add` 它或改它。

## 10. 相关文档索引

- findings：`docs/superpowers/plans/2026-04-24-phase-discipline-auto-mode-validation-findings.md` §9
- 上一轮 handoff：`docs/superpowers/plans/2026-04-24-phase-discipline-next-session-handoff.md` §10 / §11
- 本文件：`docs/superpowers/plans/2026-04-24-phase-discipline-seeded-auto-continue-handoff.md`

## 11. 给下一会话 agent 的一句话总结

**phase-discipline seeded-auto 的主干已经真实跑通到 `validate-milestone verdict=needs-remediation`，没有 runtime bug；本会话只负责修好 `.gsd` symlink 被清理的副作用、seed 一个 verdict 能直接 `pass` 的新 milestone、在隔离模板下跑完 `verify-fuse / complete-milestone / findings-to-memories`，然后把结果追加到 findings §10 与本文件 §12。不要改 runtime 主实现，不要落盘 secret。**
