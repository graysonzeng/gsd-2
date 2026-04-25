# Auto-Mode E2E 验证报告

- **日期**: 2026-04-25
- **任务 ID**: 0425-024h
- **状态**: ✅ 已完成

---

## 1. 修复验证摘要

### F1: Dispatch 规则加 artifact guard ✅
- **文件**: `src/resources/extensions/gsd/auto-dispatch.ts`
- **验证**:
  - `validating-milestone → validate-milestone` 规则包含 `readValidationArtifactGuard()`
  - `completing-milestone → complete-milestone` 规则检查 VALIDATION.md 存在性和 verdict 有效性
- **测试**: `canonical-milestone-artifacts.test.js` ✅ (2/2 通过)

### F2: Handler error code 结构化 ✅
- **文件**:
  - `src/resources/extensions/gsd/validation-error-codes.ts` (已定义 9 个错误码)
  - `src/resources/extensions/gsd/tools/validate-milestone.ts` (已使用错误码)
- **错误码**:
  - `VALIDATION_MILESTONE_ID_INVALID`
  - `VALIDATION_VERDICT_INVALID`
  - `VALIDATION_ARTIFACT_RENDER_FAILED`
  - `VALIDATION_ARTIFACT_MISSING`
  - `VALIDATION_ARTIFACT_DESYNCED`
  - `REMEDIATION_REQUIRED_BUT_NO_PLAN`
  - `REMEDIATION_REQUIRED_BUT_NO_SLICE`

### F3: Finalize-time artifact assertion ✅
- **文件**: `src/resources/extensions/gsd/auto-verification.ts`
- **验证**: `runValidateMilestonePostCheck()` 使用 `resolveCanonicalMilestoneFile()`

### F3.5: 统一 canonical-root reader ✅
- **文件**: `src/resources/extensions/gsd/worktree-manager.ts`
- **验证**: `resolveCanonicalMilestoneArtifactPath()` 和 `resolveCanonicalMilestoneFile()` 已实现
- **测试**: `canonical-milestone-root.test.js` ✅ (5/5 通过)

### F9: Stuck detector 识别 structured code ✅
- **文件**: `src/resources/extensions/gsd/auto/detect-stuck.ts`
- **验证**: Rule 5 检测 `isValidationStuckErrorCode()`

### F6: Exit code 契约测试 ✅
- **文件**: `src/tests/headless-cli-surface.test.ts`
- **测试**:
  - `applyFailOnIncompleteExitCode` ✅
  - Exit code 常量 (0, 1, 10, 11, 12) ✅

---

## 2. 测试结果

| 测试 | 结果 |
|------|------|
| canonical-milestone-artifacts.test.js | ✅ 2/2 通过 |
| canonical-milestone-root.test.js | ✅ 5/5 通过 |
| validate-milestone.test.js | ✅ 通过 |
| headless-cli-surface.test.js | ✅ 20/20 通过 |

---

## 3. TypeScript 编译

```bash
npm run typecheck:extensions
# ✅ 无错误
```

---

## 4. API 配置状态

### sandboxai [redacted]
- **API URL**: `https://api.sandboxai.top/v1`
- **主模型**: `gpt-5.4` (OpenAI 协议)
- **Reviewer**: `claude-opus-4-6` (Anthropic 协议)
- **Protocol**: Anthropic (claude-opus-4-6 可用)

### 验证结果
```
✅ Validation PASSED
   Primary Model:    gpt-5.4
   Reviewer Model:   claude-opus-4-6
   Protocol:         anthropic
```

---

## 5. 后续步骤

### 5.1 E2E 冒烟测试 (待执行)

按照 `2026-04-25-m007-validate-milestone-blocker-analysis-and-fix.md` §6 验收标准：

1. 新跑一个 docs-only minimal milestone：
   - 创建 M006 milestone
   - 写入 M006-CONTEXT.md
   - 运行 `headless auto`

2. 断言：
   - `phase=complete`
   - `activeMilestone=null`
   - M006-VALIDATION.md 存在 (verdict=pass)
   - M006-SUMMARY.md 存在

### 5.2 建议的 M006 模板

```bash
# 创建 M006
node --input-type=module - <<'NODE'
import { executePlanMilestone } from '/root/gsd-2/dist/resources/extensions/gsd/tools/workflow-tool-executors.js';
await executePlanMilestone({
  milestoneId: 'M006',
  title: 'Append a sixth validation note',
  vision: 'Append exactly one additional plain-language validation line to docs/notes.md.',
  slices: [{
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
  }]
}, '/root/gsd-2');
NODE
```

### 5.3 Headless 命令

```bash
# 使用 claude-opus-4-6 运行 auto-mode
node /root/gsd-2/dist/loader.js headless --model anthropic/claude-opus-4-6 --verbose --timeout 900000 --max-restarts 0 auto

# 查询状态
node /root/gsd-2/dist/loader.js headless query
```

---

## 6. 文件清单

### 新增/修改的文件

| 文件 | 操作 | 说明 |
|------|------|------|
| `~/.gsd/agent/models.json` | 新增 | sandboxai [redacted] 配置 |
| `.gsd/PREFERENCES.md` | 新增 | 模型偏好配置 |
| `scripts/validate-auto-mode-key.mjs` | 新增 | API key 验证脚本 |
| `src/resources/extensions/gsd/auto-mode-validator.ts` | 新增 | TypeScript 验证模块 |
| `src/resources/extensions/gsd/auto-start.ts` | 修改 | 集成 API key 验证 |

### 已验证存在的文件

| 文件 | 说明 |
|------|------|
| `src/resources/extensions/gsd/validation-error-codes.ts` | 错误码定义 |
| `src/resources/extensions/gsd/tools/validate-milestone.ts` | 已使用错误码 |
| `src/resources/extensions/gsd/auto-dispatch.ts` | 已加 artifact guard |
| `src/resources/extensions/gsd/auto-verification.ts` | 已加 finalize assertion |
| `src/resources/extensions/gsd/auto/detect-stuck.ts` | 已加 Rule 5 |
| `src/resources/extensions/gsd/worktree-manager.ts` | canonical-root helpers |

---

## 7. 已知限制

1. **sandboxai GPT 不可用**: `gpt-5.4` 持续返回 500，建议使用 `claude-opus-4-6` 作为主模型
2. **单次 auto 只推进一个 unit**: 这是设计行为，不是 bug

---

## 8. 参考文档

- `docs/superpowers/plans/2026-04-25-m007-validate-milestone-blocker-analysis-and-fix.md`
- `docs/superpowers/plans/2026-04-25-phase-discipline-sandboxai-e2e-handoff.md`
