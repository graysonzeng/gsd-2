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

## 12. 续接结果（2026-04-24 晚间，`gpt-5.5` 尝试）

### 12.1 本轮完成了什么

- 已按 §4 修复 isolated repo 的 `.gsd` symlink：
  - `.gsd -> /Users/sheng/.cache/gsd-pd-stable/.gsd/projects/0dfdd86ee7af`
- 已重 seed `M002`，包括：
  - `M002-CONTEXT.md`
  - `M002-ROADMAP.md`
  - `slices/S01/S01-PLAN.md`
- 已修复 `M002-ROADMAP.md` 的解析问题：补 `## Slices`
- 已在 isolated repo 的 `.gsd/PREFERENCES.md` 临时覆写主模型到 `openai/gpt-5.5`
- 已同时 shadow `phase-discipline-scout-fanout` hook，使首个 `research-slice` scout 也尝试走 `openai/gpt-5.5`

### 12.2 已验证的事实

- 直连 zhumuai provider：
  - `/v1/models` 返回列表中包含 `gpt-5.5`
  - `/v1/chat/completions` + `model=gpt-5.5` + `Reply with exactly OK...` 返回 `OK`
- 因此 `gpt-5.5` 在 zhumuai **业务层面是可用的**

### 12.3 新 blocker（与之前不同）

真实 `headless auto` 没有进入 provider 推理阶段，而是在 dispatch `plan-slice/M002/S01` 前被本地 model policy 拦下：

```text
Model policy denied dispatch for plan-slice/M002/S01 before prompt send
```

代码来源：

- `src/resources/extensions/gsd/auto-model-selection.ts`

关键证据：

- `audit/events.jsonl` 对 `plan-slice:M002/S01` 记录了大量 `model-policy-allow`
- allow 列表里能看到很多 openai / claude-code 模型，包括 `gpt-5.4`
- 但**没有任何 `gpt-5.5` 命中**
- 工作区全文搜索也**没有任何 `gpt-5.5` 命中**，而 `gpt-5.4` 在 generated model lists / tests / preset 中大量存在

因此本轮结论是：

- **不是** zhumuai 不支持 `gpt-5.5`
- **不是** phase-discipline runtime 主逻辑 bug
- **而是**当前仓库本地 model inventory / registry 体系还不认识 `gpt-5.5`

### 12.4 当前状态

- `headless query` 仍显示：
  - `Active Milestone = M002`
  - `Active Slice = S01`
  - `Phase = executing`
  - `Next Action = Execute T01: Append second validation note in slice S01.`
- 本轮**没有**推进到：
  - `verify-fuse`
  - `complete-milestone`
  - `findings-to-memories`

### 12.5 下一会话不要重试什么

- **不要**在当前仓库状态下继续盲重试 `gpt-5.5` 的 `headless auto`
- **不要**把本轮 blocker 误判成 zhumuai API 故障或 phase-discipline runtime bug
- **不要**为了解这个 blocker 去改 `phase-discipline/*` runtime 主实现

### 12.6 下一步建议

如果原始目标仍是“继续 seeded-auto full-loop 验证”，最小继续动作应是：

1. 把 isolated repo 的 `.gsd/PREFERENCES.md` 从 `gpt-5.5` 临时覆写恢复到仓库已认识的 `openai/gpt-5.4`
2. 保留本轮稳定 `.gsd` symlink 与 `M002` seed
3. 用同样的临时 `HOME` + 临时 `models.json` + 仅进程 env key 模板，继续跑 `headless auto`
4. 观察是否终于推进到：
   - `verify-fuse`
   - `complete-milestone`
   - `findings-to-memories`

如果用户想继续坚持 `gpt-5.5`，那已经不再是“继续验证”问题，而是**新的模型接入/注册任务**。

### 12.7 按建议配置后的真实结果

在本轮继续里，已经按最小范围完成两项配置：

1. 将 isolated repo `.gsd/PREFERENCES.md` 从 `gpt-5.5` 恢复到 `openai/gpt-5.4`
2. 加入：
   - `dynamic_routing.tier_models.light = openai/gpt-5.4-mini`
   - 项目级 `runtime/blocked-models.json`，屏蔽 `anthropic/claude-3-5-haiku-20241022`

结果：

- 真实 `headless auto` 中明确出现：

  ```text
  Skipping blocked model anthropic/claude-3-5-haiku-20241022
  ```

- 说明 Haiku `model_not_found` 已被成功规避
- 运行继续推进完成：
  - `plan-slice M002/S01`
  - `execute-task T01`
  - `gsd_complete_task`
  - `gsd_complete_slice`
  - `gsd_validate_milestone M002`

### 12.8 最终停点

本轮最终并没有卡在模型路由，而是重新回到了 milestone 验收层：

```text
Milestone M002 validation complete — verdict: needs-remediation.
Milestone M002 validation returned verdict=needs-remediation but no remediation slices were added.
```

最终 `headless query`：

- `phase = blocked`
- `slices.done = 1 / 1`
- blocker =

  ```text
  Milestone M002 validation verdict is needs-remediation but all slices are complete.
  Add remediation slices via gsd_reassess_roadmap or override the verdict manually.
  ```

### 12.9 本轮不要再误判的点

- **不要**再把当前 blocker 归因到 `claude-3-5-haiku-20241022`
- **不要**再把当前 blocker 归因到 `gpt-5.5` / model registry
- **不要**据此改 `phase-discipline/*` runtime 主实现

截至本轮，模型路由层面的结论已经足够：

- `gpt-5.5` 不适合作为当前仓库验证主线（本地 registry 未接入）
- Haiku 已可通过项目级最小配置规避
- 剩余 blocker 已重新收敛为 `needs-remediation`

### 12.10 下一步最小继续动作

如果还要继续朝 `verify-fuse / complete-milestone / findings-to-memories` 推进，下一步不该再调模型，而应只做以下二选一：

1. **继续 tighten M002 acceptance**，让 validator 直接给 `pass`
2. **手工追加 remediation slice**，再 resume auto

在当前证据下，第一优先级已经不再是 provider 或路由，而是**如何让 milestone validator 对 M002 给出 `pass`**。
