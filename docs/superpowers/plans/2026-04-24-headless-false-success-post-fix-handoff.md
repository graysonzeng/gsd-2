# Headless false-success 修复后续 — 新会话执行文档

- **日期**：2026-04-24
- **目标分支**：`feat/phase-discipline-preset-v1`
- **当前最高优先级**：验证 `headless new-milestone --auto` 在真实 provider 失败时，是否已从过去的 false-success 修正为正确的 `error / exit 1`
- **次级目标**：若 headless false-success 已消失，再继续 phase-discipline 的真实 auto-mode / headless 验证

---

## 0. 本会话前已完成的关键事实

### A. phase-discipline v1.1-v1.4 代码主线

本轮**不要重新审阅或改动**以下主逻辑，除非出现新证据证明问题确实在这里：

- `src/resources/extensions/gsd/phase-discipline/*`
- `src/resources/extensions/gsd/auto-dispatch.ts`
- `src/resources/extensions/gsd/rule-registry.ts`
- `src/resources/extensions/gsd/auto/phases.ts`

当前已知状态：

- v1.1 Admission：已落地
- v1.2 Scout fan-out：已落地
- v1.3 Impl-plan validator：已落地
- v1.4 Verify-fuse：已落地

### B. 阶段 B pre-existing blockers

已完成，**不要重复劳动**。

已存在 commit：

- `e9fb3bb9c`
- `fix(tests): resolve pre-existing workflow-tools DB adapter null + pre-dispatch-fanout implicit-any`

已完成内容：

- `packages/mcp-server/src/workflow-tools.test.ts`
  - 3 条 DB adapter null 测试已修
  - 仅改测试，未改生产代码
- `src/resources/extensions/gsd/tests/pre-dispatch-fanout.test.ts`
  - 6 个 implicit-any 已补显式类型
  - 未改运行时逻辑

验证已通过：

```bash
node --import ./src/resources/extensions/gsd/tests/resolve-ts.mjs \
  --experimental-strip-types --test \
  packages/mcp-server/src/workflow-tools.test.ts

npx tsc --noEmit --project tsconfig.extensions.json
```

### C. 真实 auto-mode 验证暴露的新 blocker

历史真实验证曾发现：

- `scripts/dev-cli.js` 作为入口时，`headless new-milestone --auto` 启动失败：
  - `ERR_MODULE_NOT_FOUND: src/app-paths.js imported from src/loader.ts`
- 改走 `dist/loader.js` 后，provider 失败时出现 **false-success**：
  - 底层 `message_end/turn_end.stopReason = error`
  - 但 `execution_complete.status = completed`
  - headless 最终输出 `Status: complete`
  - exit code `0`
  - `.gsd/milestones/` 无落盘

### D. false-success 已在本轮修复

根因已锁定并已做最小修复：

#### 根因

源头在：

- `packages/pi-coding-agent/src/modes/rpc/rpc-mode.ts`

旧行为：

- `agent_end` 时无条件合成：

```json
{"type":"execution_complete","status":"completed"}
```

因此 headless 对单轮命令（如 `new-milestone`）会误判成功。

#### 已落地修复

涉及文件：

- `packages/pi-coding-agent/src/modes/rpc/rpc-mode.ts`
  - 新增 `deriveExecutionCompleteEvent()`
  - `execution_complete` 改为继承最后一个 assistant message 的 `stopReason`
- `src/headless-events.ts`
  - 新增 `resolveHeadlessTextStatus()`
  - 新增 `resolveHeadlessJsonStatus()`
- `src/headless.ts`
  - 用显式 `timedOut` 区分真实 `error` 与真实 `timeout`

#### 回归测试

- `packages/pi-coding-agent/src/modes/rpc/rpc-protocol-v2.test.ts`
- `src/tests/headless-events.test.ts`

#### 已完成验证

```bash
node --import ./src/resources/extensions/gsd/tests/resolve-ts.mjs \
  --experimental-strip-types --test \
  src/tests/headless-events.test.ts \
  src/tests/headless-cli-surface.test.ts \
  packages/pi-coding-agent/src/modes/rpc/rpc-protocol-v2.test.ts

npx tsc --noEmit --project tsconfig.json
```

结果：

- `129/129 pass`
- `tsconfig.json` 通过

以及：

```bash
npm run build && \
node --import ./src/resources/extensions/gsd/tests/resolve-ts.mjs \
  --experimental-strip-types --test \
  src/tests/integration/e2e-headless.test.ts
```

结果：

- `e2e-headless.test.ts`: `5/5 pass`
- `dist/loader.js` 已包含修复

---

## 1. 新会话的主目标

### 第一优先级

做一次**真实复验**，确认：

- `dist/loader.js` 路径下
- `headless new-milestone --context spec.md --auto`
- 在真实 provider 再次失败时

现在是否已正确表现为：

- `Status: error`
- exit code `1`
- 不再出现 false-success

### 第二优先级

如果第一优先级通过，再判断是否继续：

- 完整走一次 phase-discipline 的真实 auto-mode / headless 验证
- 或者为了更聚焦 phase-discipline，本轮先手工 seed milestone，再直接 `/gsd auto`

---

## 2. 开始前先读这些文件（按顺序）

1. `docs/superpowers/plans/2026-04-24-phase-discipline-auto-mode-validation-findings.md`
2. `docs/superpowers/plans/2026-04-24-headless-false-success-post-fix-handoff.md`
3. `packages/pi-coding-agent/src/modes/rpc/rpc-mode.ts`
4. `packages/pi-coding-agent/src/modes/rpc/rpc-protocol-v2.test.ts`
5. `src/headless.ts`
6. `src/headless-events.ts`
7. `src/tests/headless-events.test.ts`
8. `src/tests/integration/e2e-headless.test.ts`
9. 如需对照 phase-discipline 边界，再看：
   - `src/resources/extensions/gsd/phase-discipline/README.md`
   - `src/resources/extensions/gsd/preferences.ts`

---

## 3. 推荐执行顺序

### Step 1 — 确认工作区状态

先确认：

- 当前分支仍是 `feat/phase-discipline-preset-v1`
- 本轮修复文件是否都在工作区内
- `dist/loader.js` 是否已经包含最新 build

### Step 2 — 做最小真实复验（最高优先级）

推荐先在**隔离 repo**里复验，避免污染主仓。

历史隔离 repo 例子：

- `/Users/sheng/tencent/gsd-phase-discipline-auto-56G8jS`

如需新建新的临时 repo，也可以。

最小复验命令：

```bash
node /Users/sheng/tencent/gsd-2/dist/loader.js \
  headless --verbose --timeout 900000 --max-restarts 0 \
  new-milestone --context spec.md --auto
```

如需保留完整事件流证据，再执行：

```bash
node /Users/sheng/tencent/gsd-2/dist/loader.js \
  headless --output-format stream-json --timeout 900000 --max-restarts 0 \
  new-milestone --context spec.md --auto
```

### Step 3 — 验证修复是否真实生效

重点检查：

- 如果 provider 失败：
  - `message_end.stopReason` 是否仍为 `error`
  - `execution_complete.status` 是否已变为 `error` 而不是 `completed`
  - headless 文本 summary 是否为 `Status: error`
  - 进程 exit code 是否为 `1`
- 如果 provider 成功：
  - milestone 是否真实落盘
  - 是否出现 `Milestone ready`
  - `--auto` 是否成功链入 auto-mode

### Step 4 — 根据结果分支

#### 分支 A：若 false-success 已消失

说明 headless blocker 已基本清掉。

接下来可选两条路：

- **A1：继续完整真实验证**
  - 继续用 `new-milestone --auto` 跑完整链路
- **A2：绕过 milestone 创建，聚焦 phase-discipline 本体**
  - 手工 seed 一个最小 milestone
  - 直接跑 `/gsd auto` 或 `headless auto`

优先建议：

- 如果 provider 额度/稳定性一般，优先 **A2**，这样更聚焦 phase-discipline runtime

#### 分支 B：若 false-success 仍存在

则不要扩 scope 去动 phase-discipline。

应继续锁定：

- `rpc-mode` completion synthesize
- `RpcClient` / `headless.ts` 事件消费链
- `execution_complete` 与 `message_end/turn_end` 的一致性

并补新的最小回归测试。

---

## 4. 非目标 / 不要做的事

- **不要**重构 phase-discipline 主路径
- **不要**把 scope 扩成“顺手重写 headless 架构”
- **不要**改 `auto-dispatch.ts` / `rule-registry.ts` / `phase-discipline/*`，除非拿到直接证据
- **不要**覆盖已有 findings 文档
- **不要**把 preferences YAML/MD 不一致问题扩成新主线
  - 当前它只是证据记录，不是本轮 blocker
- **不要**优先修 `scripts/dev-cli.js` 的 launcher 问题，除非你明确决定下一轮要把 dev 入口也一起纳入验证面

---

## 5. 建议验证命令

### 已有 targeted tests（如果要确认当前修复面）

```bash
node --import ./src/resources/extensions/gsd/tests/resolve-ts.mjs \
  --experimental-strip-types --test \
  src/tests/headless-events.test.ts \
  src/tests/headless-cli-surface.test.ts \
  packages/pi-coding-agent/src/modes/rpc/rpc-protocol-v2.test.ts

npx tsc --noEmit --project tsconfig.json
```

### 如果要确认 dist / e2e 仍然健康

```bash
npm run build && \
node --import ./src/resources/extensions/gsd/tests/resolve-ts.mjs \
  --experimental-strip-types --test \
  src/tests/integration/e2e-headless.test.ts
```

### 如果继续检查阶段 B 没被误伤

```bash
node --import ./src/resources/extensions/gsd/tests/resolve-ts.mjs \
  --experimental-strip-types --test \
  packages/mcp-server/src/workflow-tools.test.ts

npx tsc --noEmit --project tsconfig.extensions.json
```

---

## 6. 期望交付物

新会话结束时，希望至少产出以下之一：

### 最低交付

1. 一次新的真实复验结果
2. 明确说明 false-success 是否已经消失
3. 如仍失败，给出新的事件流证据
4. 更新 findings 文档

### 理想交付

1. 真实复验证明：provider failure 现在正确返回 `error / exit 1`
2. 在此基础上继续完成一次更接近真实 phase-discipline 的 auto-mode 验证
3. 形成新的 findings / handoff

---

## 7. 已有文档位置

本轮最相关文档：

- `docs/superpowers/plans/2026-04-24-phase-discipline-auto-mode-validation-findings.md`
- `docs/superpowers/plans/2026-04-24-headless-false-success-post-fix-handoff.md`

如果新会话有新发现，优先：

- 继续追加到现有 findings

如果信息量明显变大，可新建：

- `docs/superpowers/plans/2026-04-24-headless-false-success-post-fix-revalidation-findings.md`

---

## 8. 给下一会话 agent 的一句话总结

**当前最值得做的事，不是继续怀疑 phase-discipline，而是先用真实 `dist/loader.js` 复验：provider 失败是否已经从过去的 false-success 变成正确的 `Status: error / exit 1`；只有这一步确认后，后续 auto-mode 结论才可信。**
