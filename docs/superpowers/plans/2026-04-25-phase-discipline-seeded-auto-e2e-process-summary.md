# Phase-Discipline seeded-auto E2E 流程总结

- **日期**：2026-04-25
- **读者**：后续继续执行或复盘 phase-discipline seeded-auto 真实 E2E 的工程师/agent
- **读完后应能做到**：判断当前流程是否遇到阻塞、按正确顺序发起下一轮 E2E、知道哪些节点必须人工确认或由 agent 主动推进。
- **关联结果文档**：
  - `2026-04-25-phase-discipline-zhumuai-m006-findings.md`
  - `2026-04-25-phase-discipline-zhumuai-m006-handoff.md`

---

## 1. 本轮是否遇到阻塞

### 1.1 最终结论

本轮 **没有留下未解决的硬阻塞**。`M006` 最终已经真实完成，最终状态为：

- `phase = complete`
- `lastCompletedMilestone = M006`
- `M002 / M003 / M004 / M005 / M006` 全部为 `complete`

### 1.2 过程中遇到的问题

本轮过程中遇到过几个需要判断或推进的问题，但都没有成为最终 blocker。

#### A. sandboxai GPT 路径不可作为主线

已知背景是 sandboxai 的 Claude 可用，但 GPT 路径持续返回 500。为了避免把 provider 问题误判成 runtime 问题，本轮改走 `zhumuai`。

处理方式：

- 先做 provider 直连测试
- 再做 GSD runtime no-session smoke
- 确认 `gpt-5.4` 和 Claude reviewer 都可用后再启动 E2E

#### B. repo-local `gsd` 残留需要清理/确认

启动新 E2E 前需要确认目标 repo 下没有旧的 `gsd` 进程占用状态。

本轮曾短暂发现残留进程，但复查时已自行退出。后续流程仍应保留这个检查步骤。

#### C. 单次 `headless auto` 没有完整跑完一个 milestone

本轮最值得记录的新现象是：`headless auto` 外层多次显示 `Status: complete / exit 0`，但内部 state 每次只推进一个 unit。

实际推进顺序是：

1. 第一次推进到 `complete-slice` 前后
2. 第二次推进到 `validate-milestone` 前后
3. 第三次推进到 `complete-milestone` 前后
4. 第四次才真正完成 `M006`

这不是本轮的最终阻塞，因为连续重跑后可以继续前进并最终完成。但它是后续值得单独复现的 runtime/headless 一致性观察点。

#### D. `.gsd` symlink 指向临时 HOME

当前成功状态依赖临时 HOME 下的 project state。不要删除该临时目录，否则 `.gsd` state 和 milestone artifacts 会丢失。

---

## 2. 推荐的标准流程

下面是下一轮继续跑 phase-discipline seeded-auto E2E 时建议遵循的步骤。

### Step 1：确认当前 milestone 状态

先用 `headless query` 判断当前是否已经完成，不能凭上一次 `headless auto` 的外层输出下结论。

必须确认：

- 当前 `phase`
- `lastCompletedMilestone`
- registry 中各 milestone 的状态
- `next.action` 与 `next.unitType`

如果 `query` 显示 `phase=complete`，说明当前 milestone 已完成，不要继续 resume 它。

### Step 2：清理或确认 repo-local `gsd` 残留

启动新 E2E 前检查是否有工作目录等于目标 repo 的 `gsd` 进程。

如果有残留：

- 先确认它是否仍在真实工作
- 如果只是孤儿进程或旧会话残留，再清理
- 清理后重新跑 `headless query`

这一步避免旧 PTY/session 锁干扰新验证。

### Step 3：验证 provider/model 可用性

不要直接开始 `headless auto`。先验证模型路径。

本轮验证顺序是：

1. provider 直连探测
2. `gpt-5.4` 最小 responses/chat 请求
3. Claude reviewer 最小 messages 请求
4. GSD runtime no-session smoke

只有这些都通过，才继续跑真实 E2E。

如果 GPT 路径失败但 Claude 路径可用，要先判断本轮验证目标是否允许 Claude 作为主模型；不要把 provider 失败误判成 phase-discipline runtime bug。

### Step 4：seed 新 milestone

如果上一个 milestone 已完成，下一轮应 seed 新 milestone，而不是 resume 旧 milestone。

推荐 docs-only 最小 milestone：

- 只改一个文档文件
- 只追加一行 plain-language validation note
- 明确写入 acceptance criteria
- 明确说明 docs-only，无需测试
- 明确要求 `validate-milestone` 在满足条件时返回 `pass`

### Step 5：补齐 milestone context

官方 seed 可能只生成 roadmap，不一定包含足够清晰的 validator context。为降低 reviewer 误判，建议手工补齐 `M###-CONTEXT.md`。

context 至少包含：

- milestone goal
- acceptance criteria
- 允许修改的文件范围
- 不需要测试的理由
- 通过条件

这一步对 docs-only milestone 很关键。它能避免 validator 因缺少 standalone evidence 或验收条件不明确而返回 `needs-attention`。

### Step 6：启动真实 `headless auto`

启动时应使用已经验证过的 provider 路径。

本轮成功路径是：

- 临时 HOME
- 临时 `settings.json`
- 临时 `models.json`
- API key 只放环境变量
- `gpt-5.4` 作为主模型
- Claude 作为 reviewer

运行时不要只看外层 `Status: complete`。每轮结束后都必须回到 Step 7。

### Step 7：每轮结束后必须重新 `headless query`

这是本轮最重要的经验。

每次 `headless auto` 结束后都要确认：

- 是否真的 `phase=complete`
- `lastCompletedMilestone` 是否更新
- 如果没完成，下一个 `unitType` 是什么

如果 query 显示还有下一个 unit，例如：

- `complete-slice`
- `validate-milestone`
- `complete-milestone`

那就继续执行下一轮 `headless auto`，直到 query 显示 `phase=complete`。

### Step 8：收集完成证据或首个真实 blocker

如果完成，记录：

- 最终 `headless query`
- milestone validation verdict
- milestone summary
- 关键 artifact 列表
- 产品文件实际变化
- 最近 commit

如果阻塞，记录：

- 阻塞发生在哪个 phase/unit
- provider/model
- stderr/session 关键错误
- `headless query` 当前状态
- 是否是 provider、runtime、state、prompt、session 中哪一层

### Step 9：写 findings/handoff

每一轮真实 E2E 后都要写新文档，而不是只依赖对话上下文。

建议至少写两类文档：

- findings：记录事实、证据、结论
- handoff：告诉下一会话该从哪里继续、不要重复排查什么

---

## 3. 流程会产生什么内容

### 3.1 产品改动

docs-only E2E 通常只产生一个产品改动：

- 文档文件追加一行 validation note

本轮 `M006` 的产品结果是 `docs/notes.md` 新增一行 plain-language validation line。

### 3.2 Git commit

执行 task 后，auto-mode 会提交产品改动。

本轮观察到的 commit：

- `1e200e9 docs: Appended one additional plain-language validation line to docs/no…`

### 3.3 Milestone 级产物

完成后应生成：

- `M###-ROADMAP.md`
- `M###-CONTEXT.md`
- `M###-VALIDATION.md`
- `M###-SUMMARY.md`
- `M###-LEARNINGS.md`

### 3.4 Slice 级产物

每个 slice 通常会生成：

- `S##-RESEARCH.md`
- `S##-PLAN.md`
- `S##-SUMMARY.md`
- `S##-UAT.md`
- `S##-PRE-EXEC-VERIFY.json`

### 3.5 Task 级产物

每个 task 通常会生成：

- `T##-PLAN.md`
- `T##-SUMMARY.md`
- `T##-VERIFY.json`

### 3.6 Project 级状态

流程还会更新：

- project state
- project summary
- runtime paused/resume 状态
- learnings/capture_thought 类记录

本轮需要特别注意：这些内容当前落在临时 HOME 指向的 project path 下。

---

## 4. 哪些步骤需要人工/agent 确认和推进

### 4.1 必须确认：是否继续旧 milestone

每次开始前都要确认当前 milestone 是否已经完成。

判断依据只能是 `headless query`，不是上一次命令的外层文本。

如果已经完成：

- 不要 resume
- seed 新 milestone

### 4.2 必须确认：provider 是否真的可用

模型目录可见不代表推理可用。

必须确认：

- 直连推理请求返回 200
- GSD runtime smoke 返回正确内容
- reviewer provider 也可用

这一步通常由 agent 执行，但需要用户提供可用 key 或确认使用哪条 provider 路线。

### 4.3 必须确认：是否允许清理残留进程

如果发现 repo-local `gsd` 残留，清理前要判断它是不是仍在真实工作。

清理进程属于有副作用操作，通常需要用户确认或至少明确它是孤儿/残留。

### 4.4 必须推进：补齐 milestone context

如果 seed 后只有 roadmap 或 context 不够明确，agent 应主动补齐 context。

尤其是 docs-only milestone，context 要把 acceptance 写清楚，否则 validator 可能因为证据不足而 pause。

### 4.5 必须推进：每轮 auto 后继续 query

本轮证明，单次 `headless auto` 的 `Status: complete` 不能证明 milestone 完成。

agent 必须在每轮后执行 `headless query`，并根据 query 决定：

- 停止
- 继续下一轮 auto
- 记录 blocker

### 4.6 必须确认：是否继续多轮推进

如果 query 显示还有下一个 unit，但外层命令已经 `Status: complete`，agent 应向用户说明状态差异。

在本轮中，继续多轮推进最终完成了 `M006`。后续如果再次出现，应优先继续推进到明确终态，同时记录该现象。

### 4.7 必须记录：成功证据或首个 blocker

流程结束后，agent 必须写文档沉淀。

如果成功：

- 写完成证据
- 写 artifacts
- 写最终 query
- 写下一步注意事项

如果阻塞：

- 写第一个真实 blocker
- 写直接证据
- 写不要重复排查的旧问题

---

## 5. 判断流程状态的准则

### 5.1 以 `headless query` 为准

`headless auto` 的外层状态只能说明这次命令进程如何结束，不能单独证明 milestone 完成。

最终完成必须满足：

- `phase = complete`
- `activeMilestone = null`
- `lastCompletedMilestone` 是目标 milestone
- registry 中目标 milestone 为 `complete`

### 5.2 provider 错误不要先归因 runtime

如果错误发生在模型调用处，先验证：

- key 是否正确
- base URL 是否正确
- endpoint 是否可用
- 模型名是否可用
- 是否被 rate limit / quota / gateway 500 阻断

只有排除 provider 后，才考虑 runtime bug。

### 5.3 已 auto-commit 的产品改动不能用 live diff 否定

如果产品改动已经被 auto-mode commit，close 阶段可能看不到 live worktree diff。

此时应使用：

- committed diff evidence
- task summary
- verify artifact
- current file content assertion

不能只用“当前没有未提交 diff”判定没交付。

### 5.4 临时 HOME 是状态源时不要清理

如果 `.gsd` 指向临时 HOME project path，那么临时目录就是当前状态源。

删除临时目录会删除：

- milestone artifacts
- project state
- query 可见状态

---

## 6. 下一次执行的最小 checklist

1. 读最新 handoff/findings。
2. 设置正确 HOME 或确认当前 `.gsd` 状态源。
3. 执行 `headless query`。
4. 如果上一 milestone 已完成，seed 新 milestone。
5. 验证 provider/model。
6. 补齐 `M###-CONTEXT.md`。
7. 启动 `headless auto`。
8. 每轮结束后再次 `headless query`。
9. 如果还有 next unit，继续跑下一轮。
10. 如果 complete，收集 query、validation、summary、artifacts、commit。
11. 如果 blocker，记录第一个真实 blocker。
12. 写新的 findings/handoff。

---

## 7. 本轮最终状态

本轮最终状态是成功：

- `M006` 已完成
- `validate-milestone` verdict 为 `pass`
- `complete-milestone` 已执行
- `M006-SUMMARY.md` 和 `M006-LEARNINGS.md` 已写出
- `headless query` 显示所有 milestone 完成

当前仅剩两个后续建议：

1. 把 `.gsd` project state 从临时 HOME 迁到稳定路径，避免误删。
2. 单独复现并解释“为什么同一 milestone 需要多次 `headless auto` 才走完”。

---

## 8. `M007/S02` 追加验证暴露的问题

### 8.1 验证背景

在 `M006` 成功后，后续使用稳定 state path 继续 seed 并验证 `M007`，重点验证 commit `9e6fb07c7` 后新增的 headless workflow status 输出，以及 `--fail-on-incomplete` 的退出码语义。

本轮关键环境：

- 隔离 repo：`/Users/sheng/tencent/gsd-phase-discipline-auto-56G8jS`
- 稳定 state：`/Users/sheng/.cache/gsd-pd-stable-zhumuai-m007-current/.gsd/projects/0dfdd86ee7af`
- 临时 HOME：`/private/tmp/gsd-pd-zhumuai-m007-workflow-status`
- CLI 路线：`/Users/sheng/tencent/gsd-2/dist/loader.js`
- API key：仅通过进程环境变量传入，不写入文档或 state 文件

### 8.2 默认模式确认仍可能是 `exit 0 + needs-continue`

`headless auto` 默认模式已经确认会出现以下组合：

```text
[headless] Status: complete
[headless] Command Status: complete
[headless] Workflow Status: needs-continue
[headless] Workflow Phase: planning
[headless] Active Milestone: M007
[headless] Next: dispatch research-slice M007/S02
```

另一轮默认模式在完成 `S02` 后也输出：

```text
[headless] Status: complete
[headless] Command Status: complete
[headless] Workflow Status: needs-continue
[headless] Workflow Phase: validating-milestone
[headless] Active Milestone: M007
[headless] Next: dispatch validate-milestone M007
```

结论：

- `Command Status: complete` 只表示本次命令调用没有以进程错误结束。
- `Workflow Status: needs-continue` 表示 workflow 仍有可 dispatch 的后续 unit。
- 因此默认模式下 **`exit 0` 与 `needs-continue` 可以同时成立**，后续判断不能只看进程退出码或 `Status: complete`。

### 8.3 `--fail-on-incomplete` 已确认返回 `exit 12`

使用 built dist 路线执行：

```bash
node /Users/sheng/tencent/gsd-2/dist/loader.js headless --model openai/gpt-5.4 --verbose --timeout 900000 --max-restarts 0 --fail-on-incomplete auto
```

关键结果：

```text
manual_fail_exit=12
[headless] Status: complete
[headless] Command Status: complete
[headless] Workflow Status: needs-continue
[headless] Workflow Phase: executing
[headless] Active Milestone: M007
[headless] Next: dispatch execute-task M007/S02/T02
```

结论：

- `--fail-on-incomplete` 能把 `Workflow Status: needs-continue` 映射为进程退出码 `12`。
- 这次 tail 中没有观察到 restart banner；在当前命令形态下，`exit 12` 没有触发自动 restart。
- 这组证据已通过官方 `executeTaskComplete()` 固化到 `M007/S02/T02-SUMMARY.md`。

### 8.4 “单次调用只推进一个 unit” 现象仍然存在

`M007/S02` 期间再次观察到：单次 `headless auto` 并没有把 milestone 剩余闭环一次跑完，而是每次推进到一个新的 `next` 后停止。

已观察到的推进链路：

1. 完成 `T02` 后，`headless query` 显示：
   - `phase = summarizing`
   - `next.unitType = complete-slice`
   - `next.unitId = M007/S02`
2. 再跑默认 `headless auto` 后，完成 `S02`，但停止在：
   - `phase = validating-milestone`
   - `next.unitType = validate-milestone`
   - `next.unitId = M007`
3. 再跑一轮默认 `headless auto` 后，仍停留在：
   - `phase = validating-milestone`
   - `next.unitType = validate-milestone`
   - `next.unitId = M007`

结论：

- `M006` 中观察到的“多次 `headless auto` 才走完整个 milestone”并非偶发。
- 在 `M007` 中该现象不仅复现，而且在 `validate-milestone` 阶段进一步表现为无法推进到 `complete-milestone`。
- 后续修复时需要明确区分：
  - 命令进程是否成功结束
  - workflow 是否仍有 next unit
  - 当前 unit 是否真的产出了期望 artifact

### 8.5 `validate-milestone` 阶段当前卡住

`M007` 当前卡在 `validate-milestone`：

```json
{
  "state": {
    "activeMilestone": { "id": "M007" },
    "activeSlice": null,
    "activeTask": null,
    "phase": "validating-milestone",
    "nextAction": "Validate milestone M007 before completion."
  },
  "next": {
    "action": "dispatch",
    "unitType": "validate-milestone",
    "unitId": "M007"
  }
}
```

复查 stable state 和工作区后，尚未发现：

```text
M007-VALIDATION.md
```

  结论：

  - 当前不是 `S02/T02` 证据缺失问题；`T02` 已经通过 DB-backed `complete_task` 完成。
  - 当前 blocker 更像是 `validate-milestone` unit 没有成功产出 canonical validation artifact，或者产出失败后没有把错误显式反馈为可修复状态。
  - 后续代码核对进一步确认：`handleValidateMilestone()` 已经按 milestone canonical root 写 artifact，但 dispatch guard、finalize post-check、以及 `deriveState()` / `headless query` 的部分读取路径仍可能直接从 project root 取 `VALIDATION` / `SUMMARY`。一旦 milestone 运行在 live worktree，这会把“artifact 已写到 worktree”误判成“artifact 缺失”。
  - 这类问题不能只靠 prompt 要求 agent “记得写 validation”；应该由 runtime 或 validator 代码检查 artifact 是否存在、内容是否满足 schema，并在不满足时返回明确错误。

### 8.6 后续修复设计原则：用代码约束 agent，而不是只靠声明

后续设计修复方案时，应优先把规则做成代码级约束、artifact 校验器、状态机 guard 或 tool 返回错误，而不是只在 prompt / context 中声明“agent 应该怎么做”。

建议原则：

  - **用 artifact verifier 做硬门禁**
  - 对 `validate-milestone` 要求 `M###-VALIDATION.md` 必须存在。
  - frontmatter 必须包含合法 `verdict`。
  - verdict 为 `pass` 时才允许进入 `complete-milestone`。
  - verdict 为 `needs-remediation` 时必须产生明确 remediation next unit。
  - 所有参与判断的 reader（dispatch / finalize / state / query）必须与 writer 使用同一 canonical milestone root。
  - **用 workflow snapshot 决定退出码**
  - 默认模式可以保留 `exit 0 + Workflow Status: needs-continue`，但必须稳定输出 `Command Status` 和 `Workflow Status`。
  - `--fail-on-incomplete` 必须把 `needs-continue` 映射为 `exit 12`。
  - 如果 workflow snapshot 无法生成，应明确返回 snapshot 缺失错误，而不是只输出 `Status: complete`。

- **用代码检测 unit 无进展**
  - 如果连续两次 dispatch 同一个 `validate-milestone M007` 后 state、artifact、next 都没有变化，应返回类似 `NO_PROGRESS_ON_UNIT` 的错误。
  - 错误内容应包含当前 `phase`、`unitType`、`unitId`、缺失 artifact 路径、最近一次 tool 调用摘要。
  - agent 收到该错误后应自行修正上下文、补交 artifact 或重新调用 canonical tool，而不是继续空转。

- **用 tool schema 和 handler 校验输出**
  - `gsd_validate_milestone` 不应接受无结构文本作为成功。
  - handler 应校验 reviewers 结论、validation artifact、verdict、remediation plan 是否一致。
  - 不一致时直接返回 structured error，例如 `VALIDATION_ARTIFACT_MISSING`、`VALIDATION_VERDICT_INVALID`、`REMEDIATION_REQUIRED_BUT_NO_SLICE`。

- **用错误推动迭代**
  - 当 agent 输出不满足条件时，runtime 应返回明确错误和下一步修复指令。
  - 目标不是让用户人工解释“哪里不对”，而是让 agent 根据错误自行再次迭代输出。
  - 错误应尽量包含机器可读字段，方便 headless 模式自动判断是否继续、重试、remediate 或 fail-fast。

### 8.7 后续排查优先级

  建议下一步优先排查：

  - 1. `validate-milestone` 为什么没有落 `M007-VALIDATION.md`，以及 live worktree 下 reader/writer 是否使用了同一 canonical milestone root。
  - 2. headless loop 为什么在 `Workflow Status: needs-continue` 时仍以默认 `exit 0` 结束且不继续消费 next unit。
  - 3. 是否需要为 `--fail-on-incomplete` 增加更强的 CI 回归测试，覆盖：
    - default mode：`exit 0 + needs-continue`
    - fail-on-incomplete mode：`exit 12 + needs-continue`
    - missing validation artifact：明确错误，而不是静默停留在同一 unit
  - 4. 是否需要在 auto dispatcher 中增加 no-progress detector，阻止同一个 unit 无产物地重复运行。
