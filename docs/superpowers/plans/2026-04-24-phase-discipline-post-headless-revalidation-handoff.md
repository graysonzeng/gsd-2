# Phase-Discipline 真实验证续接 handoff（headless false-success 已复验关闭）

- **日期**：2026-04-24
- **目标分支**：`feat/phase-discipline-preset-v1`
- **当前最新相关 commit**：`5c0e510b8` — `fix(headless): surface provider failures as error exits`
- **本轮唯一主线**：不要再纠结 `headless new-milestone --auto` 的 false-success；它已经被真实复验坐实修复。下一会话应转向 **手工 seed 一个最小 milestone，然后直接跑 `auto`，验证 phase-discipline runtime 本体**。

---

## 0. 当前已知事实（新会话不要重复劳动）

### A. false-success blocker 已关闭

已在隔离 repo：

- `/Users/sheng/tencent/gsd-phase-discipline-auto-56G8jS`

用：

- `/Users/sheng/tencent/gsd-2/dist/loader.js`

对：

- `headless new-milestone --context spec.md --auto`

做过真实复验。

结论：

- provider 失败时，`message_end.stopReason = error`
- `turn_end.stopReason = error`
- `execution_complete.status = error`
- headless summary = `Status: error`
- exit code = `1`
- `.gsd/milestones/` 没有错误地落盘 milestone
- **之前的 false-success（`Status: complete` / exit `0`）已经消失**

对应 findings：

- `docs/superpowers/plans/2026-04-24-phase-discipline-auto-mode-validation-findings.md` §5

### B. 当前不应继续扩 scope 的方向

除非拿到直接证据，否则**不要**优先做这些事：

- 重回 `headless/rpc` completion 链继续怀疑 false-success
- 改 `phase-discipline/*` 主实现
- 改 `auto-dispatch.ts` / `rule-registry.ts` / `auto/phases.ts`
- 处理 `scripts/dev-cli.js` 的 ESM launcher 问题
- 把 provider `Unknown error` 文案不够具体这件事扩成主线

### C. phase-discipline 边界（只作为续接约束）

`src/resources/extensions/gsd/phase-discipline/README.md` 已明确：

- `profile-dispatch.ts` 负责 P3/P4 的 impl-plan validation gating
- `verify-fuse.ts` 只写 artifact / audit，真正 close-blocking 在 `auto-dispatch.ts`
- `phase-discipline-scout-fanout` 是 preset-owned builtin carrier
- prompt-only hooks 仍是：
  - `phase-discipline-admission`
  - `phase-discipline-findings-to-memories`

新会话不要再大范围复盘这些设计，只在出现直接 runtime 证据时局部查看。

---

## 1. 新会话主目标

### 第一优先级

在隔离 repo 中：

- **手工 seed 一个最小 milestone**
- 然后直接执行：
  - `headless auto`

目的不是验证 milestone 创建器，而是验证：

- phase-discipline 预设是否真实进入 runtime
- 能否按真实状态推进到 admission / research / review / split / execute / validate 的某个阶段
- 若失败，失败点是否已经真正位于 phase-discipline runtime，而不再是 `new-milestone` 的前置 false-success

### 第二优先级

如果 `auto` 跑起来了：

- 收集首个真实 blocker 的证据
- 判断 blocker 是：
  - 外部 provider 不稳定
  - milestone seed 不满足 runtime 读取约束
  - phase-discipline runtime 内部行为问题

---

## 2. 开始前先读这些文件（按顺序）

1. `docs/superpowers/plans/2026-04-24-phase-discipline-auto-mode-validation-findings.md`
2. `docs/superpowers/plans/2026-04-24-phase-discipline-post-headless-revalidation-handoff.md`
3. `src/resources/extensions/gsd/phase-discipline/README.md`
4. `src/resources/extensions/gsd/preferences.ts`
5. `src/resources/extensions/gsd/paths.ts`
6. `src/resources/extensions/gsd/state.ts`
7. `src/resources/extensions/gsd/auto-start.ts`
8. 如需确认 markdown 结构模板，再看：
   - `src/resources/extensions/gsd/migrate/writer.ts`
   - `src/resources/extensions/gsd/parsers-legacy.ts`

---

## 3. 当前隔离 repo 与偏好状态

隔离 repo：

- `/Users/sheng/tencent/gsd-phase-discipline-auto-56G8jS`

当前已存在：

- `spec.md`
- `docs/notes.md`
- `.gsd/PREFERENCES.md`
- `.gsd/preferences.yaml`

偏好内容（实际运行时以 `PREFERENCES.md` / `preferences.md` 为准）：

```md
---
version: 1
milestone_profile: phase-discipline-8step
verify_fuse_on_fail: true
---
```

注意：

- `preferences.ts` 当前实际读取的是：
  - `.gsd/PREFERENCES.md`
  - 兼容 fallback：`.gsd/preferences.md`
- **不是** `.gsd/preferences.yaml`

因此新会话不要误以为只写 YAML 就够了。

---

## 4. 推荐执行顺序

### Step 1 — 先看当前 repo 状态

在隔离 repo 下先执行：

```bash
node /Users/sheng/tencent/gsd-2/dist/loader.js headless query
```

预期此时仍然会看到：

- `No milestones found. Run /gsd to create one.`

### Step 2 — 手工 seed 一个最小 milestone

#### 2.1 最小目录结构

根据 `paths.ts` 当前权威命名约定：

- milestone 目录：`.gsd/milestones/M001/`
- milestone 文件：`M001-ROADMAP.md`, `M001-CONTEXT.md`
- slice 目录：`.gsd/milestones/M001/slices/S01/`
- slice 文件：`S01-PLAN.md`

建议先只 seed **一层 milestone + 一层 slice**，不要一开始造太多 artifact。

#### 2.2 推荐最小文件内容

`M001-ROADMAP.md`

```md
# M001: Docs-only validation milestone

**Vision:** Validate phase-discipline auto-mode on a tiny docs-only milestone.

## Success Criteria

- Auto-mode can select and advance this milestone without false-success or state corruption
- The run either produces canonical phase-discipline artifacts or stops with a clear blocker
- Scope remains docs-only

## Slices

- [ ] **S01: Add one validation note to docs** `risk:low` `depends:[]`
  > After this: docs/notes.md contains one concise validation note.
```

`M001-CONTEXT.md`

```md
# M001: Docs-only validation milestone

## Scope

- Keep the work docs-only
- Prefer editing `docs/notes.md`
- Make only one tiny but real documentation change

## Validation intent

- This milestone exists to validate phase-discipline runtime behavior
- If the run blocks, preserve artifacts and evidence instead of expanding scope
```

`S01-PLAN.md`

```md
# S01: Add one validation note to docs

**Goal:** Make one tiny docs-only change and drive phase-discipline runtime.
**Demo:** `docs/notes.md` includes one concise validation note.

## Must-Haves

- Keep scope docs-only
- Prefer editing `docs/notes.md`
- Avoid unrelated refactors

## Tasks

- [ ] **T01: Add a concise validation note** `est:small`
  - Edit `docs/notes.md` with one short, real note

## Files Likely Touched

- `docs/notes.md`
```

#### 2.3 推荐 shell 操作

```bash
mkdir -p .gsd/milestones/M001/slices/S01
```

然后把以上 3 个文件写入：

- `.gsd/milestones/M001/M001-ROADMAP.md`
- `.gsd/milestones/M001/M001-CONTEXT.md`
- `.gsd/milestones/M001/slices/S01/S01-PLAN.md`

### Step 3 — 确认 runtime 能识别 milestone

再次执行：

```bash
node /Users/sheng/tencent/gsd-2/dist/loader.js headless query
```

预期至少不应再是：

- `No milestones found`

如果依然看不到 milestone，优先检查：

- 目录名是否是 `M001` / `S01`
- 文件名是否是 `M001-ROADMAP.md` / `S01-PLAN.md`
- 是否写到了 repo 的 `.gsd/` 下，而不是别处
- 是否仍然只有 YAML 偏好而没有 `PREFERENCES.md`

此分支下**先不要怀疑 phase-discipline runtime 本体**。

### Step 4 — 跑真实 `auto`

文本模式：

```bash
node /Users/sheng/tencent/gsd-2/dist/loader.js \
  headless --verbose --timeout 900000 --max-restarts 0 \
  auto
```

事件流模式：

```bash
node /Users/sheng/tencent/gsd-2/dist/loader.js \
  headless --output-format stream-json --timeout 900000 --max-restarts 0 \
  auto
```

### Step 5 — 收集证据

至少收集这些内容：

- 文本 summary：
  - `Status: ...`
  - exit code
- `stream-json` 的关键事件片段
- `headless query` 前后状态
- `.gsd/milestones/M001/` 下新增/变化的 artifact
- 如有 `.phase-discipline/` observability / raw logs，也一并记录

---

## 5. 分支判断

### 分支 A：`auto` 成功进入 phase-discipline runtime

说明下一轮问题已经不在 `new-milestone` 前置链路。

此时应该：

- 继续跑到首个真实 blocker
- 记录 blocker 所在阶段
- 明确是：
  - admission
  - research-slice / scout fan-out
  - design/code review
  - plan-slice / impl-plan validation
  - execute-task
  - validate-milestone / verify-fuse

### 分支 B：`auto` 看不到你 seed 的 milestone

此时优先锁定：

- `paths.ts`
- `state.ts::getActiveMilestoneId()`
- `deriveState()` 的文件系统 fallback
- 你 seed 的文件结构 / 文件名 / roadmap markdown 解析是否符合 `parseRoadmap()` / `parsePlan()`

**不要**直接怀疑 phase-discipline runtime。

### 分支 C：`auto` 再次遇到 provider failure

如果表现为：

- `Status: error`
- exit code `1`

则说明 **false-success 仍然保持关闭**，这只是新的外部 provider 问题。

除非你再次看到：

- provider 已失败
- 但 headless 显示 `complete` / exit `0`

否则**不要**回头重开 `headless false-success` 主线。

---

## 6. 非目标 / 不要做的事

- **不要**再优先排查 `headless new-milestone --auto` false-success
- **不要**顺手改 `phase-discipline/*` 主实现
- **不要**把这轮任务扩成 provider 文案修饰或错误翻译优化
- **不要**先修 `scripts/dev-cli.js` launcher 问题
- **不要**覆盖已有 findings 文档
- **不要**发散到 composed-lite、reviewer stall 或其它并行主线

---

## 7. 新会话建议交付物

### 最低交付

1. 证明手工 seed 的 milestone 已被 runtime 识别
2. 一次真实 `headless auto` 运行结果
3. 明确当前 blocker 已经是否进入 phase-discipline runtime 主体
4. 更新 findings 文档

### 理想交付

1. `auto` 真实进入 phase-discipline runtime
2. 收到至少一个 canonical phase-discipline artifact / observability 证据
3. 明确首个真实 blocker 位于哪个 phase
4. 给出下一轮是否该改代码的结论

---

## 8. 建议更新的文档位置

优先继续追加到：

- `docs/superpowers/plans/2026-04-24-phase-discipline-auto-mode-validation-findings.md`

如果信息量明显变大，可新建：

- `docs/superpowers/plans/2026-04-24-phase-discipline-seeded-auto-validation-findings.md`

---

## 9. 给下一会话 agent 的一句话总结

**headless false-success 已经被真实复验关闭；下一步最有价值的工作不是继续怀疑 headless，而是在隔离 repo 手工 seed 一个最小 milestone，然后直接跑 `headless auto`，确认 phase-discipline runtime 本体的首个真实 blocker 到底在哪里。**
