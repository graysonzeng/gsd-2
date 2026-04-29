---
topic: phase-discipline-loop-continuity-baseline-validation
stage: design-review
design_doc: docs/superpowers/specs/2026-04-29-phase-discipline-loop-continuity-baseline-validation-design.md
parent_topic: phase-discipline-loop-continuity
date: 2026-04-29
reviewer: design-review skill
---

# Phase-Discipline Loop Continuity · Baseline Validation · 设计评审

## 1. 评审范围

- 评审对象：`docs/superpowers/specs/2026-04-29-phase-discipline-loop-continuity-baseline-validation-design.md`
- 事实复核对象：
  - `src/resources/extensions/gsd/auto/loop.ts`（主循环 dev path 的 break/continue 处理，line 800–930）
  - `src/resources/extensions/gsd/auto/phases.ts`（runFinalize 中 retry 路径的 continue 返回）
  - `src/resources/extensions/gsd/auto/types.ts`（`ContinuitySignal` / `BreakpointClass` / `deriveContinuityDecision`）
  - `src/resources/extensions/gsd/auto/continuity-coordinator.ts`（Stage-A emit-only coordinator）
  - 父文档：`docs/superpowers/specs/2026-04-28-phase-discipline-loop-continuity-design.md`
  - Handoff：`docs/superpowers/plans/2026-04-28-phase-discipline-loop-continuity-next-session-handoff.md`
- 评审态度：只读；不修改设计文档。
- 评审维度：需求与方向 / 方案合理性 / 实现可行性 / 文档质量。

## 2. 总体判断

设计方案的核心方向是 **合理且有价值的**：

- "先建基线、再改行为"的思路正确。第一批 signal + observability 已经落地，但"当前最常见的用户可见停机点是什么"确实还停留在静态代码推断层面，缺少一轮运行时实证。
- 方案 B（最小实证验证优先）的选择合理，成本可控，避免了方案 A 的盲目推进和方案 C 的过度投入。
- 三组验证场景的选取覆盖了 continuity 体验问题的核心矛盾：跨 unit 自动续跑（场景 A/B）和 retry 语义一致性（场景 C）。
- 证据采集面的四类证据（journal、loop-report、paused-session、用户可见停机点）与第一批已落地的 observability 能力对齐。
- 风险识别到位，尤其是"把验证基线写成行为层设计"和"把静态推断误写成已验证事实"两个风险，说明作者对文档边界有清醒认识。

但设计文档存在若干 MEDIUM 级别的具体问题，建议在执行前修订，以避免验证过程中出现范围模糊或证据不可复核的情况。

## 3. 发现

### [MEDIUM] 实现可行性：验证执行方式未定义，"最小验证"可能变成"最小讨论"

**位置**：§8 最小验证场景 + §10 验证执行原则

**问题**：设计文档定义了三组验证场景和通过条件，但没有说明验证的具体执行方式。关键问题是：

1. 这三组场景是通过**真实运行** `/gsd auto` 在一个测试项目上触发，还是通过**阅读代码 + 已有测试用例**推断？
2. 如果是真实运行，需要什么样的测试夹具（最小 milestone 状态、mock 还是真实 project）？§10.1 提到"优先使用已有测试夹具、最小 milestone 或可复用工程状态"，但没有说明这些夹具是否已经存在、在哪里、是否足够。
3. 如果是代码阅读 + 测试推断，那"验证"的含义就退化为"更仔细的静态分析"，与方案 A 的区别变小。

**影响**：执行者可能把"验证"理解为"再读一遍代码然后写结论"，这与设计目标"避免后续设计只停留在静态代码推断"矛盾。或者执行者花大量时间准备测试环境，超出 M 级规模预期。

**建议**：在 §10 或 §8 中明确验证执行方式的优先级：
- 首选：利用已有的 `continuity-decision.test.ts` 和 auto-loop 集成测试，构造最小场景触发目标路径，检查 journal/report 输出。
- 次选：在一个真实但最小的 GSD 项目上手动触发 `/gsd auto`，观察运行时行为。
- 兜底：如果前两种都不可行，明确标注为"代码路径分析"而非"已验证"。

---

### [MEDIUM] 方案合理性：场景 A/B 的"预计观测"缺少代码路径定位

**位置**：§8 场景 A（line 186）和场景 B（line 200）

**问题**：场景 A 说"预计该场景仍可能结束当前 invocation"，场景 B 说"预计该场景目前仍未打通自动续跑"，但都没有指出具体是哪段代码导致了这个行为。

通过阅读 `loop.ts:800-910`，实际的代码路径是：
- dev path 中，每个 phase 返回 `break` 后，loop 顶层执行 `markLoopStop(...); finishTurn(...); break;`（line 805-808, 821-824, 831-834, 883-886, 900-906）。
- `complete-slice` 完成后，下一轮迭代的 `runPreDispatch` 或 `runDispatch` 会重新 deriveState，如果 workflow 需要 `validate-milestone`，dispatch 应该能解析出来。关键问题不在于 loop 是否支持续跑，而在于 `complete-slice` 的 finalize 阶段是否返回了 `break` 而非 `next`。

设计文档应该把"预计观测"与具体代码路径关联起来，否则验证时仍然需要先做一轮代码定位，等于重复工作。

**影响**：验证执行者需要先自行定位代码路径，增加验证成本，也增加了"把代码推断当成验证结论"的风险。

**建议**：在场景 A/B 的"预计观测"下方各补一段"关键代码路径"，指出：
- 场景 A：重点观察 `runFinalize` 在 `complete-slice` 后返回的 `PhaseResult.action` 是 `next` 还是 `break`，以及 `runPreDispatch` 在下一轮是否能正确解析出 `validate-milestone`。
- 场景 B：重点观察 `validate-milestone` 完成后 `runFinalize` 的返回值，以及 `runDispatch` 在下一轮是否能解析出 `complete-milestone`。

---

### [MEDIUM] 文档质量：§7.1 顶层运行链路描述与代码不完全一致

**位置**：§7.1（line 131-141）

**问题**：设计文档描述的执行顺序是 `runPreDispatch -> runGuards -> runDispatch -> runUnitPhase -> runFinalize`，这与 `loop.ts` 文件头注释（line 4: `derive → dispatch → guards → runUnit → finalize`）不一致。实际代码（line 800-910）的顺序是 `runPreDispatch -> runGuards -> runDispatch -> runUnitPhase -> runFinalize`，设计文档的描述是正确的，但 loop.ts 文件头注释是过时的。

这不影响本设计的正确性，但如果验证过程中执行者同时参考了 loop.ts 文件头注释，可能产生困惑。

**影响**：轻微，但在验证文档中引用时可能造成混淆。

**建议**：在验证执行时顺手更新 `loop.ts` 文件头注释，使其与实际代码一致。这属于 observability gap 的一种（文档与代码不同步）。

---

### [MEDIUM] 方案合理性：证据采集面缺少对 `workflowStatusBefore/After` 的利用

**位置**：§9 证据采集面

**问题**：`ContinuityDecision` 类型（types.ts:111-112）已经包含 `workflowStatusBefore` 和 `workflowStatusAfter` 字段，这两个字段对于判断"workflow 是否真正前进"至关重要。但 §9 的证据采集面只提到了 `sourcePhase`、`continuitySignal`、`breakpointClass`、`reason`，没有提到 `workflowStatusBefore/After`。

对于场景 A（complete-slice -> validate-milestone），`workflowStatusBefore` 应该是 slice 完成前的状态，`workflowStatusAfter` 应该反映 milestone 需要 validate 的状态。这个差异正是判断"是否应该自动续跑"的关键证据。

**影响**：验证结论可能缺少"workflow 状态变化"这一维度的证据，导致后续 coordinator 设计时仍需补采。

**建议**：在 §9 第 1 项中补充：确认 `workflowStatusBefore` / `workflowStatusAfter` 是否被正确填充，以及它们是否足以支撑后续 coordinator 的"是否续跑"决策。

---

### [LOW] 文档质量：§7.2 各阶段职责描述偏概括，与验证场景的关联不够紧密

**位置**：§7.2（line 144-172）

**问题**：§7.2 对五个阶段的职责描述是正确的，但偏概括。例如 Finalize 阶段提到"已经具备较强的 continuity 语义"，但没有说明具体是哪些 return-site 返回了 `continue`（即 `retryLoopContinue`），也没有说明哪些 return-site 仍然返回 `break`。

这些细节对于场景 C 的验证至关重要：验证者需要知道 `artifact-verification-retry` 和 `verification-retry` 在 `runFinalize` 中的具体位置和返回值。

**影响**：验证者需要自行在 phases.ts 中定位这些路径，增加验证成本。

**建议**：可以在 §7.2 Finalize 段落中补充 `retryLoopContinue` 的两个具体 return-site 引用（phases.ts 中的行号或函数名），或者在场景 C 中直接给出代码定位。

---

### [LOW] 文档质量：§12 文档更新规则中"observability 是否充分"的判断标准不明确

**位置**：§12（line 289-294）

**问题**：§12 要求验证后回答"observability 是否充分"，但没有给出判断标准。什么算"充分"？是"journal 中能看到 continuity-decision 事件"就算充分，还是需要"能从 journal + report + paused-session 三者交叉验证出完整的停机链路"才算充分？

**影响**：不同执行者可能给出不同标准的"充分"结论，降低基线的可复核性。

**建议**：补充一个最小充分性标准，例如："对于每个验证场景，如果仅凭 journal + auto-loop-report 就能还原出完整的停机链路（从哪个 phase、什么 reason、什么 signal/breakpointClass 导致了 invocation 结束），则 observability 充分；否则记录具体缺口。"

## 4. 跳出框架审视

### 是否存在更好的替代方向？

评审过程中考虑了以下替代方向：

**替代 1：直接在已有测试套件中补充集成测试，而非独立的"验证设计"**

如果 `continuity-decision.test.ts` 已经覆盖了 `deriveContinuityDecision` 的分类逻辑，那么场景 C（retry 路径是否真正 continue）可以直接通过扩展已有测试来验证，不需要独立的验证设计文档。场景 A/B 的核心问题是"finalize 返回 break 还是 next"，这也可以通过集成测试验证。

但这个替代方向的问题是：它只能验证代码路径，不能验证"用户可见停机点"（§9 第 4 项）。设计文档要求的"最终用户可见停机点"包括 UI notify、stop reason、是否要求用户再次运行，这些需要更接近真实运行的验证方式。

**结论**：当前方向合理，但建议明确区分"代码路径验证"（可通过测试）和"用户体验验证"（需要真实运行或手动检查），避免两者混为一谈。

**替代 2：跳过验证基线，直接在第二批 coordinator 实现中内嵌 before/after 对比**

即在实现 coordinator 行为层时，先记录当前行为作为 before baseline，实现后记录 after baseline，用 diff 证明改进。

这个方向的问题是：如果 before baseline 和行为层改造在同一个 PR 中完成，code reviewer 无法独立验证 before baseline 的准确性。当前设计把 baseline 独立出来，让 before 和 after 分属不同 PR，reviewer 可以分别验证，这是更严谨的做法。

**结论**：当前方向更优。

## 5. 结论

**PASS_WITH_NOTES**

设计方向正确，"先建基线、再改行为"的思路值得肯定。三组验证场景选取合理，证据采集面与已有 observability 能力对齐。

主要补充建议：
1. 明确验证执行方式（测试驱动 vs 真实运行 vs 代码分析），避免"验证"退化为"更仔细的静态分析"。
2. 在场景 A/B 中补充关键代码路径定位，降低验证成本。
3. 在证据采集面中补充 `workflowStatusBefore/After` 的利用。
4. 补充 observability 充分性的最小判断标准。

这些补充不影响核心方向，可以在执行前快速修订。

## 6. 下一步

**同会话继续**:
直接执行 /design-implement

**新会话恢复 prompt**:
```
请阅读设计文档 docs/superpowers/specs/2026-04-29-phase-discipline-loop-continuity-baseline-validation-design.md
和评审文档 docs/superpowers/plans/2026-04-29-phase-discipline-loop-continuity-baseline-validation-design-review.md，
使用 /design-implement 进行方案修订及实现。
重点修订 MEDIUM-1：明确验证执行方式（测试驱动 vs 真实运行 vs 代码分析）。
```
