# Implementation: headless-auto-no-active-milestone-fail-closed

- Date: 2026-05-01
- Design Doc: docs/superpowers/specs/2026-05-01-headless-auto-no-active-milestone-fail-closed-design.md
- Review Doc: docs/superpowers/plans/2026-05-01-headless-auto-no-active-milestone-fail-closed-design-review.md
- Status: Completed

## 1. 评审意见处理摘要

| 编号 | 意见 | 决定 | 理由 |
|------|------|------|------|
| HIGH-1 | 白名单策略需量化所有 17 处 `showNextAction` | 采纳（简化实现） | 默认 block 所有 `select` + title 白名单；17 处 `showNextAction` 的 title 均不与 lock-guard title 重叠 |
| MEDIUM-1 | annotation-based 可维护性机制 | 未采纳 | 侵入 extension 层；当前白名单仅 2 条规则，可维护性风险低 |
| MEDIUM-2 | `headless_blocked` 在 stream-json 模式输出 | 采纳 | 作为独立事件行输出 |
| MEDIUM-3 | child session cleanup 时序 | 部分采纳 | block 时向 child 发送 `cancelled` 响应 |
| LOW-1 | `workflowStatus: unknown` 可以更精确 | 保留 | 被 block 时 workflow 状态确实未知（未进入 auto-loop） |

## 2. 根因前提处理结论（按需）
- 适用性：适用
- 处理策略：沿用
- 结论：根因前提稳定，实现直接建立在该前提上

### 2.1 消费的根因评审结论
- **SUPPORTED**：代码证据链完整，"自动选第一项 → 误入 discuss → 无 terminal notification → 无限 idle" 成立

### 2.2 本次修订的前提边界
- 已确认事实：
  - `headless-ui.ts` 对 `select` 默认选第一项（L215-225）
  - `showNextAction` fallback 到 `ctx.ui.select()` 在 RPC mode 下（next-action-ui.ts L198-209）
  - `auto` 在 `MULTI_TURN_COMMANDS` 中，只信 terminal notification（headless.ts L100, L754）
  - `discuss-milestone` 完成后不产生 `Auto-mode stopped...` terminal notification
- 未确认假设：无
- 对实现的影响：方案 A 直接可行，修复在 headless 传输层

## 3. 采纳的设计修订
1. 白名单策略：默认 block 所有未白名单的 `select`，白名单仅包含 `Auto-mode is running` 和 `Step-mode is running`
2. `handleExtensionUIRequest` 返回类型从 `void` 改为 `HandleUIRequestResult`，包含 `handled` 和 `blockedInfo`
3. `headless_blocked` 事件在 `stream-json` 模式下作为独立事件行输出
4. block 时向 child session 发送 `cancelled` 响应（而非 hang）
5. STATE.md 在内容无变化时跳过写盘

## 4. 实现摘要

### 修改的文件

| 文件 | 改动 |
|------|------|
| `src/headless-ui.ts` | 新增 `SAFE_SELECT_TITLES` 白名单；`handleExtensionUIRequest` 返回 `HandleUIRequestResult`；未白名单 select 返回 `handled: false` + `blockedInfo` |
| `src/headless-types.ts` | 新增 `HeadlessBlockedEvent` 接口；`HeadlessJsonResult` 增加可选 `reason` 字段 |
| `src/headless.ts` | 新增 `blockedReason` 变量；处理 `handleExtensionUIRequest` 的 blocked result：emit event → stderr → cancel child → resolve；`emitBatchJsonResult` 输出 `reason`；新增 `emitHeadlessBlocked` helper |
| `src/resources/extensions/gsd/workflow-projections.ts` | `renderStateProjection` 增加 readFileSync 比对，内容不变时 return |
| `src/tests/headless-interactive-blocking.test.ts` | 新增 17 个测试覆盖 fail-closed、safe-auto-response、非 select 方法、源码不变量、STATE.md no-diff |

### 核心行为变化

1. **Before**: unsupervised `headless auto` 遇到任何 `select` → 自动选第一项
2. **After**: unsupervised `headless auto` 遇到非白名单 `select` → fail-closed，输出 `headless_blocked` 事件，exit 10

## 5. 验证结果
- 测试：`npx tsx --test src/tests/headless-interactive-blocking.test.ts` → 17 pass, 0 fail
- 回归测试：`npx tsx --test src/tests/headless-*.test.ts` → 204 pass, 0 fail
- typecheck：`npx tsc --noEmit --pretty` → 无错误
- 构建：`npm run build` → 成功，输出正常

## 6. 已知限制与后续建议
1. **白名单硬编码**：当前白名单基于 title 字符串匹配。新增 lock-guard 类 select 时需同步更新白名单。建议在新增 `select` 时用 `headless-interactive-blocking.test.ts` 验证不会被误 block。
2. **`--answers` 优先级**：answer injection 在 fail-closed 检查之前执行（headless.ts 现有逻辑），因此 `--answers` 可以覆盖被 block 的 select。这是有意为之。
3. **非 `auto` 命令的行为**：当前改动只影响 unsupervised 模式的非 supervised 路径。`headless next`、`headless query` 等命令如果触发 select（极少见），同样会被 block。这是 fail-closed 哲学的正确行为。
4. **集成验证建议**：部署后应构造"无 active milestone"场景跑 `node dist/loader.js headless --output-format json auto`，验证秒级退出且 `status=blocked`。

## 7. Handoff

### 7.1 同会话继续
直接执行 $code-review 或 /code-review

### 7.2 新会话恢复 prompt
```text
请阅读设计文档 docs/superpowers/specs/2026-05-01-headless-auto-no-active-milestone-fail-closed-design.md、
评审文档 docs/superpowers/plans/2026-05-01-headless-auto-no-active-milestone-fail-closed-design-review.md、
实现文档 docs/superpowers/plans/2026-05-01-headless-auto-no-active-milestone-fail-closed-implementation.md，
以及本次提交的代码变更。
重点核对根因前提（如有）、设计修订、实现结果与验证证据是否一致，
使用 $code-review（或 /code-review）进行方案重审及代码审查。
```
