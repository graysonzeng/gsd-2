# Phase-Discipline v1.1-v1.4 综合评审后续 — 修复 + 真实 auto-mode 验证 Handoff

- **Handoff 日期**：2026-04-24
- **目标分支**：`feat/phase-discipline-preset-v1`
- **交接范围**：综合评审 P0 + P1 已落地；新会话需清掉 2 项 pre-existing pre-blocker，然后做一次真实 auto-mode 端到端验证
- **前置凭据**：
  - 综合评审：`docs/superpowers/reviews/2026-04-24-phase-discipline-preset-v1.1-v1.4-end-to-end-review.md`
  - 最新 README：`src/resources/extensions/gsd/phase-discipline/README.md`
  - v7.2 spec：`docs/superpowers/specs/phase-discipline-preset.md`

---

## 0. 当前完成度（本会话结束时快照）

### 已完成

| # | 动作 | 证据 |
|---|---|---|
| P0-1 | `planSliceParams.tasks.min(1)` | `@/Users/sheng/tencent/gsd-2/packages/mcp-server/src/workflow-tools.ts:965` |
| P0-2 | `gsd_plan_slice` TypeBox `minItems: 1` | `@/Users/sheng/tencent/gsd-2/src/resources/extensions/gsd/bootstrap/db-tools.ts:536` |
| P0-3 | schema-layer 空 tasks 拒绝回归 | `@/Users/sheng/tencent/gsd-2/packages/mcp-server/src/workflow-tools.test.ts:682-723` |
| P1-1 | README v1.2 carrier semantics + v1.4 enforcement ownership + hook classification | `@/Users/sheng/tencent/gsd-2/src/resources/extensions/gsd/phase-discipline/README.md` |
| P1-2 | 综合评审 §7 状态更新 | `@/Users/sheng/tencent/gsd-2/docs/superpowers/reviews/2026-04-24-phase-discipline-preset-v1.1-v1.4-end-to-end-review.md:386-409` |

### 验证结果

- 目标测试 193/196 通过；新测试 ✅
- `npx tsc --noEmit --project tsconfig.extensions.json`：本轮改动 0 错误

### 尚未完成

| # | 类型 | 状态 |
|---|---|---|
| P2 | 结构化 artifact 载体 | **未实施，后续演进** |
| B1 | `workflow-tools.test.ts` 3 条 DB adapter null 失败 | **pre-existing，新会话处理** |
| B2 | `pre-dispatch-fanout.test.ts` 6 个 implicit-any | **pre-existing，新会话处理** |
| AM | 真实 auto-mode 端到端验证 | **未跑，新会话做** |

---

## 1. 新会话的两个 pre-blocker（必须先清）

### B1 — `workflow-tools.test.ts` DB adapter null 失败（3 条）

**失败位置（当前文件行号）**：

- `@/Users/sheng/tencent/gsd-2/packages/mcp-server/src/workflow-tools.test.ts:830` — `gsd_requirement_save opens the DB before inline requirement writes`（断言在 `:853`）
- `@/Users/sheng/tencent/gsd-2/packages/mcp-server/src/workflow-tools.test.ts:863` — `gsd_plan_task reopens the DB before inline task planning writes`
- 其他 2 条类似 `_getAdapter()!.prepare(...)` → null

**根因假设**：

- 这些测试用 `closeDatabase()` 模拟 "DB 被关闭"，然后期望 workflow tool handler 自己重开 DB 再写入。handler 内部确实调用了 `ensureDbOpen()`，写入成功后测试用 `_getAdapter()` 查 row 验证。
- 当前 `_getAdapter()` 返回 null，说明 handler 路径里 DB 打开后又被关回去了，或者 `_getAdapter()` 的获取对象和 handler 用的不是同一个。
- 需要进源码追 `ensureDbOpen()` 与 `_getAdapter()` 的关系，确认是否 handler 在 executor 路径结束时释放了 adapter，而测试却要求持有后再查。

**调查起点**：

- `@/Users/sheng/tencent/gsd-2/src/resources/extensions/gsd/bootstrap/dynamic-tools.ts`（包含 `ensureDbOpen`）
- `@/Users/sheng/tencent/gsd-2/src/resources/extensions/gsd/gsd-db.ts::_getAdapter()`
- `@/Users/sheng/tencent/gsd-2/packages/mcp-server/src/workflow-tools.ts::runSerializedWorkflowDbOperation` 里 `ensureDbOpen` 的调用点

**修复方向（不承诺）**：

- 要么让 handler 在返回前**保持** adapter 打开（调整 `ensureDbOpen` / shared adapter 生命周期）
- 要么改测试，用 handler 自己返回的 result details 验证而不是直接 `_getAdapter()`
- 前者影响生产代码，后者只改测试。**优先后者** — 评审已定调，这 3 条只是测试写法与生产代码不一致。

**验证命令**：

```bash
node --import ./src/resources/extensions/gsd/tests/resolve-ts.mjs \
     --experimental-strip-types --test \
     packages/mcp-server/src/workflow-tools.test.ts
```

### B2 — `pre-dispatch-fanout.test.ts` implicit-any（6 个）

**失败位置**：`@/Users/sheng/tencent/gsd-2/src/resources/extensions/gsd/tests/pre-dispatch-fanout.test.ts`

- `:37` — `stopAuto: async (_ctx, _pi, reason) => { ... }` 三个参数都 implicit-any
- `:128` — `.find((entry) => ...)`
- `:131` — `({ unitType, unitId }) => ...`

**根因**：v1.2 scout fan-out 测试文件（untracked）在写时没有用 `LoopDeps` 完整类型或 TS 明确泛型，`tsc` 在 `tsconfig.extensions.json` 严格模式下报 implicit-any。

**修复方向（非常直接）**：

- `stopAuto` 参数显式标注：`async (_ctx: unknown, _pi: unknown, reason: string | undefined) => void`（或直接从 `LoopDeps["stopAuto"]` 参数推导）
- `entry` 回调参数：根据上下文补类型
- `{ unitType, unitId }`：从 `fanOutCalls` 的声明 `Array<{ unitType: string; unitId: string }>` 推断

**验证命令**：

```bash
npx tsc --noEmit --project tsconfig.extensions.json
```

预期：0 errors。

---

## 2. B1 + B2 清完后 — 真实 auto-mode 端到端验证

### 2.1 准备工作区

新会话可以选择：

- **在一个临时目录**或 **专门的小 repo**（最推荐，防止污染主仓）
- 在 `.gsd/preferences.yaml` 写入：

  ```yaml
  version: 1
  milestone_profile: phase-discipline-8step
  verify_fuse_on_fail: true
  ```

### 2.2 驱动一次完整 8-phase

建议用一个**最小可跑的 milestone**，例如 "在 docs 里加一行 note"。

**期望 phase 路径**：P0 Admission → P1 Research → P2 Design → P3 Split → P4 Implementation → P5 Verification → P6 Synthesis → (P7 out-of-band)

### 2.3 关注点检查表

| Phase | 检查项 | 证据路径 |
|---|---|---|
| P0 | `ADMISSION-CHECKLIST.md` 生成；若 `Admission Decision: needs-rework`，`ADMISSION-RETRY.md` 写入，cycle 2 前主 artifact 被删除 | `.gsd/milestones/{mid}/ADMISSION-CHECKLIST.md` |
| P1 | `phase-discipline-scout-fanout` 触发；3 个 scout 并行；任一失败其余被 cancel；成功写入 canonical `RESEARCH` | `.gsd/milestones/{mid}/slices/{sid}/{sid}-RESEARCH.md`；`.phase-discipline/*.json` |
| P2 | `design-review` 跑出 findings；retry 正常 | `.gsd/.../design-review.md`、`.phase-discipline/` |
| P3 | `IMPL-PLAN-VALIDATION.md` 含 `- Result: pass`；否则 `profile-dispatch.ts` advise 回 `plan-slice` | `.gsd/milestones/{mid}/slices/{sid}/IMPL-PLAN-VALIDATION.md` |
| P4 | `code-review` 跑出 findings；retry 正常；`execute-task` 产出 EVIDENCE | `.gsd/.../tasks/*/EVIDENCE.md` |
| P5 | `validate-milestone` 失败时 `auto-dispatch.ts` `complete-milestone` rule 返回 `stop`；`VERIFY-FUSE.md` 写入 | `.gsd/milestones/{mid}/VERIFY-FUSE.md`，观察 auto-mode 是否真的 block close |
| P6 | `phase-discipline-findings-to-memories` prompt 驱动写 memory；不超过 5 条/slice | memory store entries |

### 2.4 失败时的诊断入口

- `.gsd/.phase-discipline/*.json` — 每次 hook 执行的结构化日志
- `.gsd/.phase-discipline/*-stdout.log` / `-stderr.log` — reviewer / validator 子进程原始输出
- auto-mode 自身 journal：`.gsd/runtime/*`
- `dispatch-match` 相关日志可定位 `profile-dispatch.ts` advise 是否被 honour

### 2.5 如果 auto-mode 跑不通

**不要**先改 runtime 主路径。先做：

1. 截图/复制失败 artifact 文本与 `.phase-discipline/*.json` 内容
2. 对照 `src/resources/extensions/gsd/phase-discipline/README.md` 的 "Enforcement ownership" 表格判断失败属于 artifact owner 还是 enforcement point
3. 如果是 artifact 文本格式变了导致 gating 失败，这正是 P2 要解决的；先记下，不急着改
4. 如果是 runtime bug，写一个最小复现，再决定是否需要改代码

---

## 3. 完成后期望交付物

新会话结束时应该有：

- [ ] B1 3 条测试全部 pass
- [ ] B2 6 个 TS 错误清零
- [ ] `npx tsc --noEmit --project tsconfig.extensions.json` 绿
- [ ] `node --import ./src/resources/extensions/gsd/tests/resolve-ts.mjs --experimental-strip-types --test packages/mcp-server/src/workflow-tools.test.ts` 绿
- [ ] 一次真实 auto-mode 跑的日志快照（成功/失败都行，**失败比成功更有价值**）
- [ ] 更新这份 handoff 的 "执行结果" 段，或写一份 `2026-04-25-*-findings.md`

---

## 4. 不要做的事

- **不要**重写 runtime 主路径（`auto-dispatch.ts` / `auto/phases.ts` / `rule-registry.ts` / `preferences*.ts`）— 评审已锁定
- **不要**动 v1.2 scout-fanout / v1.3 impl-plan-validator / v1.4 verify-fuse 的实现代码（有 bug 先记录再决策）
- **不要**合并 P2 结构化载体（IMPL-PLAN-VALIDATION frontmatter / VERIFY-FUSE sidecar JSON）— 要有真实 trigger 再做
- **不要**在测试里 `skip`/`todo` 三条 B1 测试 — 必须修

---

## 5. 参考：本轮 evidence 速查

- **综合评审**：`@/Users/sheng/tencent/gsd-2/docs/superpowers/reviews/2026-04-24-phase-discipline-preset-v1.1-v1.4-end-to-end-review.md`
- **spec v7.2**：`@/Users/sheng/tencent/gsd-2/docs/superpowers/specs/phase-discipline-preset.md`
- **v1.1 admission review**：`@/Users/sheng/tencent/gsd-2/docs/superpowers/reviews/2026-04-24-v1.1-admission-review.md`
- **v1.3 impl-plan review**：`@/Users/sheng/tencent/gsd-2/docs/superpowers/reviews/2026-04-24-v1.3-impl-plan-validator-review.md`
- **v1.4 verify-fuse review**：`@/Users/sheng/tencent/gsd-2/docs/superpowers/reviews/2026-04-24-v1.4-verify-fuse-review.md`
- **README**：`@/Users/sheng/tencent/gsd-2/src/resources/extensions/gsd/phase-discipline/README.md`

---

## 6. git 工作区状态（handoff 时）

本次会话已修改但未 commit：

- `packages/mcp-server/src/workflow-tools.ts`（P0-1）
- `packages/mcp-server/src/workflow-tools.test.ts`（P0-3）
- `src/resources/extensions/gsd/bootstrap/db-tools.ts`（P0-2）
- `src/resources/extensions/gsd/phase-discipline/README.md`（P1-1）
- `docs/superpowers/reviews/2026-04-24-phase-discipline-preset-v1.1-v1.4-end-to-end-review.md`（P1-2）

其他修改来自之前会话（v1.1-v1.4 主体实现、scout-fanout 等），不属于本轮。

新会话建议**先 commit 本轮 P0+P1 为一个原子 commit**，再开始 B1/B2 修复。
