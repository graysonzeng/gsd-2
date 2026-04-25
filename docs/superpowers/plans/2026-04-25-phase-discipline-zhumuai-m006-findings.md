# Phase-Discipline seeded-auto 真实 E2E 结果 — zhumuai 临时 HOME 路径跑通 M006

- **日期**：2026-04-25
- **主仓库**：`/Users/sheng/tencent/gsd-2`
- **隔离 repo**：`/Users/sheng/tencent/gsd-phase-discipline-auto-56G8jS`
- **对应前序 handoff**：`docs/superpowers/plans/2026-04-25-phase-discipline-sandboxai-e2e-handoff.md`

---

## 1. 一句话结论

本轮没有继续 resume `M005`，而是按 handoff 要求先复核 `M005` 已完成、seed 新 milestone `M006`，再改走 **zhumuai + 临时 HOME + env key（不把 secret 落盘）** 路线继续真实 `headless auto`。

结果：**`M006` 已真实完成**，最终 `headless query` 返回：

- `phase = complete`
- `lastCompletedMilestone = M006`
- registry 中 `M002 / M003 / M004 / M005 / M006` 全部为 `complete`

但这次过程中观察到一个新的、目前**非阻塞但值得后续跟踪**的现象：同一个 milestone 并不是在单次 `headless auto` 调用里完整闭环，而是需要**连续多次再次执行 `headless auto`**，每次只推进一个后续 unit（`complete-slice` → `validate-milestone` → `complete-milestone`）。

---

## 2. 本轮开始前的复核结果

### 2.1 `M005` 完成态复核

执行：

```bash
node /Users/sheng/tencent/gsd-2/dist/loader.js headless query
```

得到关键状态：

- `phase = complete`
- `lastCompletedMilestone = M005`
- `next.reason = All milestones complete.`

因此本轮主线正确地改为：**新建 `M006`，不要 resume `M005`**。

### 2.2 repo-local `gsd` 残留

复查时曾短暂看到 1 个 repo-local `gsd` 进程，但它在进一步检查前已经自行退出；再次枚举后已无残留。

---

## 3. provider 路径选择：sandboxai 不再作为本轮主线

### 3.1 直接验证 zhumuai key

使用用户提供的：

- `url = https://zhumuai.com`
- `key = sk-7mVUCE6hbRYZkJCYicgqlsxF8NvoKWzyHjLJlDu3qIdLDQ5m`

最小直连探测结果：

- `GET /v1/models`：`200`
- `POST /v1/responses` + `gpt-5.4`：`200`，返回 `OK`
- `POST /v1/chat/completions` + `gpt-5.4`：`200`，返回 `OK`
- `POST /v1/messages` + `claude-opus-4-6`：`200`，返回 `OK`

结论：**zhumuai 当前同时具备 `gpt-5.4` 主模型与 Claude reviewer 所需的真实可用性。**

### 3.2 GSD runtime 烟测（不落盘 secret）

为了避免改动 `~/.gsd/agent/auth.json` / `models.json`，本轮没有回滚持久配置，而是使用：

- 临时 `HOME`
- 临时 `settings.json`
- 临时 `models.json`（只写 `baseUrl` + `User-Agent: curl/8.7.1`）
- `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` 仅走环境变量

关键 runtime 烟测结果：

- `dist/loader.js --bare --no-session --provider openai --model gpt-5.4` → `OK`
- `dist/loader.js --bare --no-session --provider anthropic --model claude-opus-4-6` → `OK`

结论：**zhumuai 的临时 HOME 隔离模板在当前分支上可直接驱动真实 runtime。**

---

## 4. `M006` seed 与 context

### 4.1 官方 seed

本轮通过 `executePlanMilestone()` 官方 seed：

- `milestoneId = M006`
- `title = Append a sixth validation note`
- `vision = Append exactly one additional plain-language validation line to docs/notes.md.`

### 4.2 `M006-CONTEXT.md`

手工补入的 milestone acceptance：

- `docs/notes.md` 在本 milestone 后至少有 6 条非空行
- 不允许修改 `docs/notes.md` 以外的产品文件
- docs-only，不要求测试
- 满足这些显式条件时，`validate-milestone` 应返回 `pass`

### 4.3 seed 后 `query`

seed 后 `headless query` 显示：

- `activeMilestone = M006`
- `phase = planning`
- `next.unitType = research-slice`

说明 `M006` 已被 runtime 正常识别。

---

## 5. 真实 E2E 过程与关键证据

### 5.1 第一轮 `headless auto`

第一轮在 zhumuai 临时 HOME 路径下真实进入：

- `research-slice`
- `plan-slice`
- `execute-task`

关键证据：

- `Slice S01 researched.`
- `gsd_plan_slice M006/S01`
- `edit docs/notes.md`
- `gsd_complete_task M006/S01/T01`
- 自动提交成功：
  - `1e200e9 docs: Appended one additional plain-language validation line to docs/no…`

但第一轮结束后并未真正完成 milestone；`query` 仍显示：

- `phase = summarizing`
- `next.unitType = complete-slice`

另外，第一轮外层包装脚本因为把 shell 变量命名为 `status` 触发了：

```text
zsh:35: read-only variable: status
```

这个错误发生在 `headless` 已经输出 `Status: complete` 之后，属于**我这层包装脚本的问题**，不是 runtime 内部失败。

### 5.2 第二轮 `headless auto`

第二轮复用同一个 temp HOME 与同一个 repo state，直接从收尾阶段继续推进到：

- `verify-before-complete`
- `gsd_complete_slice M006/S01`
- `Slice S01 complete.`

第二轮结束后 `query` 显示：

- `phase = validating-milestone`
- `next.unitType = validate-milestone`

### 5.3 第三轮 `headless auto`

第三轮直接推进 milestone validation：

- `subagent done 52.9s`
- `gsd_validate_milestone M006`

并生成：

- `M006-VALIDATION.md`

验证文档关键结论：

- frontmatter：`verdict: pass`
- 文内：`**Verdict: PASS**`
- `All three parallel reviewers returned PASS.`

第三轮结束后 `query` 显示：

- `phase = completing-milestone`
- `next.unitType = complete-milestone`

### 5.4 第四轮 `headless auto`

第四轮进入 milestone close：

- 读取 `M006-VALIDATION.md`
- 读取 `T01-SUMMARY.md`
- 校验 `docs/notes.md`
- `gsd_complete_milestone M006`
- 写出 `.gsd/PROJECT.md`
- 写出 `M006-LEARNINGS.md`
- 末尾输出：

```text
Milestone M006 complete.
Auto-mode stopped — All milestones complete.
[headless] Status: complete
Exit code: 0
```

---

## 6. 最终成功证据

### 6.1 最终 `headless query`

使用相同 temp HOME 复核：

```json
{
  "state": {
    "activeMilestone": null,
    "lastCompletedMilestone": { "id": "M006", "title": "Append a sixth validation note" },
    "phase": "complete",
    "nextAction": "All milestones complete.",
    "registry": [
      { "id": "M002", "status": "complete" },
      { "id": "M003", "status": "complete" },
      { "id": "M004", "status": "complete" },
      { "id": "M005", "status": "complete" },
      { "id": "M006", "status": "complete" }
    ]
  },
  "next": { "action": "stop", "reason": "All milestones complete." }
}
```

### 6.2 `docs/notes.md` 最终产品结果

文件新增的 trailing line 为：

```text
This plain-language validation line confirms the notes file now includes one additional trailing check.
```

最终 `docs/notes.md` 保留原有内容，仅多出这一行。

### 6.3 milestone artifacts

`M006` 的关键落盘 artifact 已存在：

- `M006-CONTEXT.md`
- `M006-ROADMAP.md`
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

### 6.4 validator 结论

`M006-VALIDATION.md` 直接给出：

- `verdict: pass`
- `All three parallel reviewers returned PASS.`

---

## 7. 本轮新增观察（不是 blocker，但值得后续跟踪）

### 7.1 `headless auto` 看起来没有在单次调用里跑完整个剩余闭环

虽然每一轮外层都输出：

- `Auto-mode started. Will loop until milestone complete.`
- `[headless] Status: complete`
- `Exit code: 0`

但实际 state 推进表现为：

1. 第 1 轮停在 `complete-slice` 前
2. 第 2 轮停在 `validate-milestone` 前
3. 第 3 轮停在 `complete-milestone` 前
4. 第 4 轮才真正完成 `M006`

也就是说，**同一 milestone 的剩余 units 是通过多次重新执行 `headless auto` 才全部走完的。**

这次它最终没有阻塞验证目标，因为连续重跑后确实能前进并最终完成；但它是一个值得后续单独复现/确认的 runtime/headless 一致性观察点。

### 7.2 `.gsd` 当前仍指向 temp HOME project path

本轮结束后，isolated repo 的 `.gsd` 当前是一个 symlink：

```text
.gsd -> /tmp/gsd-pd-zhumuai-auto.HMpgXr/.gsd/projects/0dfdd86ee7af
```

因此当前成功状态与 artifact 都落在这个 temp HOME project path 下。**不要立即删除该 temp dir**，否则 repo 的 `.gsd` 状态与 `M006` artifacts 会一起消失。

---

## 8. 当前结论

截至本轮：

- sandboxai GPT 500 不是当前主线
- zhumuai 的临时 HOME 路径已被真实证明可用
- `gpt-5.4` 主模型 + Claude reviewer 的目标组合已在真实 E2E 中跑通 `M006`
- phase-discipline seeded-auto 在当前分支上已再次拿到一个完整成功样本

如果下一会话继续推进，新的重点不再是“能不能跑通 M006”，而更应该是：

- 是否需要把这次 **多次 `headless auto` 才完成同一 milestone** 的现象做成最小复现；以及
- 是否要把当前 temp HOME project state 迁回稳定路径，避免 `.gsd` 继续依赖 `/tmp/...`。
