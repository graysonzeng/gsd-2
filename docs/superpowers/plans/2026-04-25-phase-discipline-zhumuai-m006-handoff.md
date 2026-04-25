# Phase-Discipline seeded-auto 真实 E2E 续接 handoff（zhumuai 路径已完成 M006）

- **日期**：2026-04-25
- **主仓库**：`/Users/sheng/tencent/gsd-2`
- **隔离 repo**：`/Users/sheng/tencent/gsd-phase-discipline-auto-56G8jS`
- **配套 findings**：`docs/superpowers/plans/2026-04-25-phase-discipline-zhumuai-m006-findings.md`
- **前序 handoff**：`docs/superpowers/plans/2026-04-25-phase-discipline-sandboxai-e2e-handoff.md`

---

## 1. 一句话结论

本轮已按要求**不再 resume M005**，而是新 seed `M006`，并用 **zhumuai + 临时 HOME + env key（不落盘 secret）** 路线真实跑通 `M006`。

最新 `headless query`（同一 temp HOME 下）已确认：

- `phase = complete`
- `lastCompletedMilestone = M006`
- `M002 / M003 / M004 / M005 / M006` 均为 `complete`

因此，**下一会话不应把主线定义为“继续 M006”**。`M006` 已完成。

---

## 2. 已验证事实（下一会话不要重复排查）

### 2.1 provider 选择

- sandboxai 持久配置下，Claude 可用但 GPT 路径此前持续异常；本轮没有继续拿它做主线。
- 用户提供的 `zhumuai` key 在本轮已被直接验证：
  - `GET /v1/models`：200
  - `gpt-5.4` `/v1/responses`：200
  - `gpt-5.4` `/v1/chat/completions`：200
  - `claude-opus-4-6` `/v1/messages`：200
- 同一 key 在 **GSD runtime 烟测** 下也已通过：
  - `openai/gpt-5.4` → `OK`
  - `anthropic/claude-opus-4-6` → `OK`

### 2.2 本轮真实完成状态

最终 `query` 已确认：

- `activeMilestone = null`
- `lastCompletedMilestone = M006`
- `phase = complete`
- `next.reason = All milestones complete.`

### 2.3 `M006` 关键 artifact 已落盘

关键文件包括：

- `M006-VALIDATION.md`
- `M006-SUMMARY.md`
- `M006-LEARNINGS.md`
- `S01-RESEARCH.md`
- `S01-PLAN.md`
- `S01-SUMMARY.md`
- `S01-UAT.md`
- `T01-PLAN.md`
- `T01-SUMMARY.md`
- `T01-VERIFY.json`

`M006-VALIDATION.md` 已明确：

- `verdict: pass`
- `All three parallel reviewers returned PASS.`

---

## 3. 当前最重要的环境注意事项

### 3.1 `.gsd` 目前指向 temp HOME project path

isolated repo 当前的 `.gsd` 不是普通目录，而是 symlink：

```text
.gsd -> /tmp/gsd-pd-zhumuai-auto.HMpgXr/.gsd/projects/0dfdd86ee7af
```

所以：

- 当前 `M006` 的完整 state / artifacts 都在这个 temp HOME project path 下
- **不要随手删除 `/tmp/gsd-pd-zhumuai-auto.HMpgXr`**
- 否则 repo 的 `.gsd` 状态会一起消失

### 3.2 本轮使用的 temp HOME 仍应视为当前有效状态源

若下一会话要立即复核状态，请先带上：

```bash
export HOME=/private/tmp/gsd-pd-zhumuai-auto.HMpgXr
```

然后再执行：

```bash
node /Users/sheng/tencent/gsd-2/dist/loader.js headless query
```

---

## 4. 本轮观察到的一个新现象（非阻塞，但值得后续跟踪）

本轮 `M006` 并不是单次 `headless auto` 调用直接闭环完成，而是通过**连续四次**重新执行 `headless auto` 才推进完全部 units：

1. 第 1 轮：推进到 `complete-slice` 前后
2. 第 2 轮：推进到 `validate-milestone` 前后
3. 第 3 轮：推进到 `complete-milestone` 前后
4. 第 4 轮：真正完成 `M006`

每一轮外层都显示：

- `Auto-mode started. Will loop until milestone complete.`
- `[headless] Status: complete`
- `Exit code: 0`

但内部 state 是“每轮只前进一步”。

这次现象**没有阻断目标**，因为连续重跑可以最终完成 milestone；但如果下一会话要继续提高系统确定性，这条现象值得单独最小复现并确认它是否是：

- 真实 runtime/loop 语义问题；或
- 当前 headless / session lifecycle 的表现差异；或
- 某种“每次只消费一个剩余 unit”的预期外行为

---

## 5. 如果下一会话还要继续 phase-discipline seeded-auto

因为 `M006` 已完成，下一会话正确主线应是：

1. 先确认是否要保留当前 `/tmp/gsd-pd-zhumuai-auto.HMpgXr` 作为有效 project state
2. 若要继续真实 E2E，**新建后续 milestone（例如 `M007`）**，不要 resume `M006`
3. 继续优先使用本轮已验证可用的 **zhumuai 临时 HOME 模板**，除非你明确决定改回持久 provider 路线

### 推荐顺序

1. `export HOME=/private/tmp/gsd-pd-zhumuai-auto.HMpgXr`
2. `headless query` 复核 `M006` 仍是 `complete`
3. 若要继续新一轮 E2E，则官方 seed `M007`
4. 写入最小 `M007-CONTEXT.md`
5. 用同一套临时 HOME + env key 路线跑下一轮真实 `headless auto`

---

## 6. 如果下一会话要做“巩固而不是继续新 milestone”

最有价值的两个方向是：

### A. 稳定化当前成功状态

把当前 project state 从 `/tmp/...` 迁回稳定位置，避免 `.gsd` 持续依赖临时目录。

### B. 最小复现“多次 auto 才走完同一 milestone”

保留当前 `M006` 证据不变，构造一个新的最小 docs-only milestone，记录：

- 每次调用前 `query` 的 `phase / next.unitType`
- 每次 `headless auto` 的末尾 `Status / exit code`
- 每次调用后 `query` 的 state 差异

如果现象可稳定复现，就能把它从“观察”升级成明确的 runtime/headless 一致性问题。

---

## 7. 下一会话不要做的事

- **不要**把主线重新定义成 `resume M005` 或 `resume M006`
- **不要**在没有证据前回头重改已经闭环的 `validate-milestone` canonical path / committed diff evidence / PTY cleanup 修复
- **不要**在当前成功状态仍依赖 `/tmp/...` 时贸然删除该 temp HOME
- **不要**把本轮成功样本误判成“sandboxai 已恢复 GPT”——本轮成功走的是 zhumuai 路线

---

## 8. 最小复核命令

### 8.1 当前完成态复核

```bash
export HOME=/private/tmp/gsd-pd-zhumuai-auto.HMpgXr
node /Users/sheng/tencent/gsd-2/dist/loader.js headless query
```

### 8.2 查看 `.gsd` symlink

```bash
ls -ld /Users/sheng/tencent/gsd-phase-discipline-auto-56G8jS/.gsd
```

### 8.3 最近提交

```bash
git -C /Users/sheng/tencent/gsd-phase-discipline-auto-56G8jS log --oneline -5
```

---

## 9. 下一会话完成标准

如果下一会话继续工作，建议完成标准二选一：

1. **继续成功标准**
   - 新 milestone（如 `M007`）真实完成
   - `headless query` 显示 `lastCompletedMilestone = M007`
   - 有新的 key stderr / query / artifact 证据

2. **巩固标准**
   - 明确解释并最小复现“为何需要多次 `headless auto` 才走完一个 milestone”
   - 或把当前 `.gsd` / project state 迁移到稳定路径，消除 `/tmp/...` 依赖
