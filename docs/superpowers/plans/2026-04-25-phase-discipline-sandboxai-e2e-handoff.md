# Phase-Discipline seeded-auto 真实 E2E 续接 handoff（sandboxai 切换后）

- **日期**：2026-04-25
- **目标仓库**：`/Users/sheng/tencent/gsd-phase-discipline-auto-56G8jS`
- **主仓库**：`/Users/sheng/tencent/gsd-2`
- **当前目标**：为下一会话继续 phase-discipline seeded-auto 的真实端到端 E2E 验证提供最小但完整的续接材料。

---

## 1. 一句话结论

当前 isolated repo 上的 `M005` **已经完成**，不应继续 resume `M005`。最新一次用 `anthropic/claude-opus-4-6` 发起的 `headless auto` 在外层表现为 `timeout after 900s`，但 `headless query` 已确认项目状态是 `phase=complete`，且 `lastCompletedMilestone=M005`。

因此，**下一会话的正确目标不是“继续 M005”**，而是：

1. 确认 `M005` 完成态依旧成立；
2. 基于当前 provider 状态决定路线；
3. 新建一个后续 milestone（建议 `M006`）并发起下一轮真实 seeded-auto E2E。

---

## 2. 已验证事实（新会话不要重复排查）

### 2.1 里程碑状态

最新 `headless query` 输出要点：

- `phase = complete`
- `lastCompletedMilestone = M005`
- registry 中 `M002 / M003 / M004 / M005` 均为 `complete`
- `next.reason = All milestones complete.`

这意味着：

- **不要**继续尝试“resume M005”作为主线
- **不要**把这轮当成“仍停在 validating-milestone / complete-milestone”
- 下一轮 E2E 应从 **新 milestone** 开始

### 2.2 最近一次 Claude resume 的外层现象

最近一次后台命令（Claude 主模型）表现为：

- `Resuming paused session for M005.`
- `Auto-mode resumed.`
- `Resume: applied 2 fix(es) to state.`
- 已进入 `validate-milestone` reviewer fan-out
- 最终外层 headless 记录：
  - `Timeout after 900s`
  - `Child process exited unexpectedly with code 0`
  - `Status: timeout`
  - `Events: 2020 total, 1 tool calls`

但这与最终 `query` 的 `phase=complete` 并不矛盾；就当前交接判断而言，**项目真实状态以 `query` 为准**。

### 2.3 之前已经修复并验证过的 auto-mode blocker

以下三项此前已经被真实复验闭环，不要在新会话里重新怀疑为首要 blocker：

1. `validate-milestone` reviewer 路径已改为 canonical `.gsd/milestones/{milestoneId}/...`
2. `complete-milestone` 已接受 committed diff / artifact-backed evidence，而不是只看当前 worktree diff
3. `web/lib/pty-manager.ts` 已在最后 listener 断开 5 秒后清理 orphaned `gsd` PTY session（不影响普通 shell session）

---

## 3. 当前 provider / gateway 状态（sandboxai）

### 3.1 已替换的持久配置

当前 `~/.gsd/agent` 已从 zhumuai 切换到 sandboxai：

- `auth.json`
- `models.json`

并已创建备份：

- `~/.gsd/agent/auth.json.20260425-023025.bak`
- `~/.gsd/agent/models.json.20260425-023025.bak`

### 3.2 验证结果

对 `https://api.sandboxai.top` 的验证结果：

- `/v1/models`：能看到 GPT 和 Claude 模型
  - 示例 GPT：`gpt-5.4`, `gpt5.4`
  - 示例 Claude：`claude-opus-4-6`, `claude-opus-4-6-thinking`, `claude-opus-4-7` 等
- `Anthropic /v1/messages`：`claude-opus-4-6` **200 OK**
- `OpenAI /v1/chat/completions`：`gpt-5.4` / `gpt5.4` 持续 **500**
- `OpenAI /v1/responses`：`gpt-5.4` 持续 **500**

错误统一为：

```text
Service temporarily unavailable. Please try again.
```

### 3.3 当前结论

对 sandboxai：

- **Claude 协议当前可用**
- **GPT 模型目录可见，但真实调用当前不可用**

所以如果下一会话仍沿用 sandboxai，**不要默认假设 `openai/gpt-5.4` 可正常跑完整 E2E**。

---

## 4. 推荐的下一会话主线

### 主线建议

优先走：**继续 phase-discipline seeded-auto 的下一轮真实 E2E，但不要再 resume M005；改为新建 `M006` 后再启动。**

### 推荐顺序

1. 清理 isolated repo 上残留的 repo-local `gsd` 进程
2. 用 `headless query` 再次确认当前仍是：
   - `phase=complete`
   - `lastCompletedMilestone=M005`
3. 为 isolated repo 新建 `M006`
4. 写入最小 `M006-CONTEXT.md`
5. 根据 provider 状态二选一：
   - **A 路线（推荐）**：继续使用 sandboxai，但本轮临时用 `anthropic/claude-opus-4-6` 作为主模型启动 `headless auto`
   - **B 路线（更保守）**：回滚到 zhumuai 备份，再用之前成功轨道继续 `openai/gpt-5.4`
6. 记录下一轮真实结果：
   - 若完成，记录 `complete` 证据
   - 若出现新 blocker，记录其为新的首个真实 blocker

---

## 5. `M006` 的最小建议模板

建议继续沿用已多次验证成功的 docs-only 最小 E2E 模板。

### 5.1 建议的 milestone 内容

- **milestoneId**：`M006`
- **title**：`Append a sixth validation note`
- **vision**：`Append exactly one additional plain-language validation line to docs/notes.md.`

### 5.2 建议的 `M006-CONTEXT.md`

```md
# Append a sixth validation note

Milestone goal: append exactly one additional plain-language validation line to `docs/notes.md`.

Acceptance (explicit for milestone validator):
- `docs/notes.md` must contain at least 5 non-empty lines after this milestone.
- No files outside `docs/notes.md` may be modified.
- No tests are required; this milestone is docs-only.
- If these two bullets are satisfied, `validate-milestone` should return verdict=`pass`.
```

---

## 6. 可直接复用的命令

### 6.1 先确认当前完成态

```bash
node /Users/sheng/tencent/gsd-2/dist/loader.js headless query
```

### 6.2 查看并清理 isolated repo 的 repo-local `gsd` 残留

```bash
for p in $(pgrep -x gsd || true); do
  cwd=$(lsof -a -p "$p" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p')
  if [ "$cwd" = "/Users/sheng/tencent/gsd-phase-discipline-auto-56G8jS" ]; then
    ps -p "$p" -o pid=,ppid=,etime=,command=
  fi
done
```

```bash
for p in $(pgrep -x gsd || true); do
  cwd=$(lsof -a -p "$p" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p')
  if [ "$cwd" = "/Users/sheng/tencent/gsd-phase-discipline-auto-56G8jS" ]; then
    kill "$p" || true
  fi
done
```

### 6.3 官方 seed `M006`

```bash
node --input-type=module - <<'NODE'
import { executePlanMilestone } from '/Users/sheng/tencent/gsd-2/dist/resources/extensions/gsd/tools/workflow-tool-executors.js';
const result = await executePlanMilestone({
  milestoneId: 'M006',
  title: 'Append a sixth validation note',
  vision: 'Append exactly one additional plain-language validation line to docs/notes.md.',
  slices: [
    {
      sliceId: 'S01',
      title: 'Add one validation note',
      risk: 'low',
      depends: [],
      demo: 'docs/notes.md gains one additional plain-language validation line.',
      goal: 'Append one new validation line to docs/notes.md.',
      successCriteria: 'docs/notes.md includes exactly one more plain-language validation note and no other files change.',
      proofLevel: 'smoke',
      integrationClosure: 'validate-milestone confirms the docs-only update passes.',
      observabilityImpact: 'Milestone summary and validation artifacts capture the docs-only proof.'
    }
  ]
}, '/Users/sheng/tencent/gsd-phase-discipline-auto-56G8jS');
console.log(JSON.stringify(result, null, 2));
NODE
```

### 6.4 写入 `M006-CONTEXT.md`

```bash
cat > /Users/sheng/tencent/gsd-phase-discipline-auto-56G8jS/.gsd/milestones/M006/M006-CONTEXT.md <<'EOF'
# Append a sixth validation note

Milestone goal: append exactly one additional plain-language validation line to `docs/notes.md`.

Acceptance (explicit for milestone validator):
- `docs/notes.md` must contain at least 5 non-empty lines after this milestone.
- No files outside `docs/notes.md` may be modified.
- No tests are required; this milestone is docs-only.
- If these two bullets are satisfied, `validate-milestone` should return verdict=`pass`.
EOF
```

### 6.5 如果继续用 sandboxai，推荐用 Claude 主模型跑下一轮

```bash
node /Users/sheng/tencent/gsd-2/dist/loader.js headless --model anthropic/claude-opus-4-6 --verbose --timeout 900000 --max-restarts 0 auto
```

### 6.6 如果决定回滚到 zhumuai 备份

```bash
cp ~/.gsd/agent/auth.json.20260425-023025.bak ~/.gsd/agent/auth.json
cp ~/.gsd/agent/models.json.20260425-023025.bak ~/.gsd/agent/models.json
```

然后再走之前成功过的主线（通常是 `openai/gpt-5.4`）。

---

## 7. 新会话不要做的事

- **不要**把主线继续定义为“resume M005”
- **不要**在没有证据前，把当前 sandboxai 的 GPT 500 误判成 runtime 逻辑问题
- **不要**重新打开 `new-milestone --auto` 那条旧 false-success 主线
- **不要**优先回改已经被真实复验关闭的 prompt / PTY cleanup 修复
- **不要**在没有必要时改 `phase-discipline/*` 主实现

---

## 8. 新会话完成标准

如果新会话继续后续真实 E2E，完成标准应是以下二者之一：

1. **成功标准**
   - 新 milestone（建议 `M006`）完成
   - `headless query` 显示 `lastCompletedMilestone=M006`
   - 记录关键 stderr / query 证据

2. **阻塞标准**
   - 出现新的首个真实 blocker
   - 能明确说明：
     - 阻塞发生在哪个 unit / phase
     - 是 provider / runtime / state / prompt / session 哪一层
     - 有哪些直接证据

---

## 9. 给下一会话的最小行动建议

新会话一开始，优先按这个顺序：

1. 读本文件
2. `headless query` 确认 `M005` 仍 complete
3. 清理 repo-local `gsd` 残留
4. seed `M006`
5. 若 sandboxai 的 GPT 仍 500，则直接用 `anthropic/claude-opus-4-6` 跑新一轮真实 auto
6. 把结果追加到新的 findings / handoff 文档
