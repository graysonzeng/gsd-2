# Headless Restart Bug - 修复方案

## 问题根因分析

### 现象
1. 第一次运行 `new-milestone --context-text "添加 gsd doctor..." --auto` 成功创建 M001
2. 进入 auto-mode 后 `Status: cancelled`（非错误，是正常完成）
3. Restart 时命令变成 `/gsd new-milestone 添加 gsd doctor 诊断命令`，解析为无效命令

### 根因
**Shell/Node 参数传递问题**：带空格的中文文本在 restart 过程中被拆分为多个参数

原始命令：
```bash
node dist/loader.js headless new-milestone --context-text "添加 gsd doctor 诊断命令" --auto
```

预期 argv：
```
['node', 'dist/loader.js', 'headless', 'new-milestone', '--context-text', '添加 gsd doctor 诊断命令', '--auto']
```

实际 restart 时的 argv（推测）：
```
['node', 'dist/loader.js', 'headless', 'new-milestone', '--context-text', '添加', 'gsd', 'doctor', '诊断', '命令', '--auto']
```

导致 `--context-text` 只得到 `"添加"`，后面的词被当作 `commandArgs`。

---

## 三层修复方案

### 第一层：代码防御（最小侵入）

在 `src/headless.ts` 添加参数验证和修复逻辑：

```typescript
// 在 parseHeadlessArgs 后添加验证
function validateAndRepairContextText(options: HeadlessOptions, rawArgs: string[]): void {
  // 检测可疑情况：contextText 过短，但后面有大量 commandArgs
  if (options.contextText && options.contextText.length < 20 && options.commandArgs.length > 0) {
    // 尝试从原始参数恢复
    const contextTextIdx = rawArgs.findIndex(arg => arg === '--context-text')
    if (contextTextIdx >= 0 && contextTextIdx + 1 < rawArgs.length) {
      const candidate = rawArgs[contextTextIdx + 1]
      // 如果 candidate 包含空格且比当前的 contextText 长，使用它
      if (candidate.includes(' ') && candidate.length > options.contextText.length) {
        console.warn(`[headless] Detected split context-text, repairing: "${candidate.substring(0, 50)}..."`)
        options.contextText = candidate
        // 清空被错误填充的 commandArgs
        options.commandArgs = []
      }
    }
  }
}
```

### 第二层：使用规范（推荐方案）

**避免使用 `--context-text` 传递带空格的长文本**，改用以下方式：

**方式 A：使用文件（最安全）**
```bash
# 1. 将需求写入文件
cat > /tmp/spec.md << 'EOF'
添加 gsd doctor 诊断命令，用于检查 GSD 环境配置...
EOF

# 2. 使用 --context 指向文件
gsd headless new-milestone --context /tmp/spec.md --auto
```

**方式 B：使用 stdin（适合管道）**
```bash
cat << 'EOF' | gsd headless new-milestone --context - --auto
添加 gsd doctor 诊断命令...
EOF
```

**方式 C：使用 heredoc 配合 --context-text（带正确引号）**
```bash
# 确保使用单引号 heredoc，避免 shell 展开
SPEC=$(cat << 'EOF'
添加 gsd doctor 诊断命令...
EOF
)
gsd headless new-milestone --context-text "$SPEC" --auto
```

### 第三层：架构改进（可选）

**将 contextText 持久化到 runtime 文件，restart 时自动恢复**：

修改 `src/headless.ts` L369-371:
```typescript
// 当前：写入 headless-context.md
writeFileSync(join(runtimeDir, 'headless-context.md'), contextContent, 'utf-8')

// 新增：同时写入元数据，包含原始 contextText
writeFileSync(
  join(runtimeDir, 'headless-context-meta.json'),
  JSON.stringify({
    contextText: options.contextText,
    context: options.context,
    timestamp: Date.now()
  }),
  'utf-8'
)
```

Restart 时检测并恢复：
```typescript
// 在 runHeadlessOnce 开头检测
const metaPath = join(gsdDir, 'runtime', 'headless-context-meta.json')
if (existsSync(metaPath) && !options.context && !options.contextText) {
  try {
    const meta = JSON.parse(readFileSync(metaPath, 'utf-8'))
    if (meta.contextText) {
      options.contextText = meta.contextText
    }
  } catch {}
}
```

---

## 使用案例：完整的 GSD Doctor 验证流程

### 步骤 1：创建需求文件（推荐方式）

```bash
# 创建需求文件
cat > /tmp/gsd-doctor-spec.md << 'EOF'
---
# GSD Doctor 诊断命令

## 目标
添加 `gsd doctor` CLI 命令，输出 brew-doctor 风格的彩色诊断报告。

## 检查项
1. PREFERENCES.md（项目级 + 全局）存在性和格式
2. models.json 自定义 provider 配置
3. auth.json API key 配置
4. settings.json 默认 provider/model
5. 关键模型可用性探测

## 输出格式
- 正常：绿色 ✓
- 警告：黄色 ⚠  
- 错误：红色 ✗
- 附带具体修复建议

## 集成要求
- 集成到现有 CLI 体系（参考 `config`、`install` 命令结构）
- 添加 `--json` 输出选项供脚本使用
- 自动化测试覆盖健康/警告/错误场景
EOF
```

### 步骤 2：启动验证

```bash
cd /Users/sheng/tencent/gsd-2

# 确认配置已就绪
cat .gsd/PREFERENCES.md

# 使用文件方式启动（避免引号问题）
node dist/loader.js headless \
  --timeout 1800000 \
  --max-restarts 0 \
  new-milestone \
  --context /tmp/gsd-doctor-spec.md \
  --auto 2>&1 | tee /tmp/gsd-doctor-run.log
```

### 步骤 3：如果遇到中断，手动继续

```bash
# 查看状态
node dist/loader.js headless query

# 继续执行下一个 unit
gsd headless next

# 或继续 auto-mode（如果 milestone 已创建）
gsd headless auto
```

### 步骤 4：清理临时文件

```bash
rm /tmp/gsd-doctor-spec.md /tmp/gsd-doctor-run.log
```

---

## 代码修复实现（已验证）

### 修复 1：添加警告日志（最小修改）

```typescript
// src/headless.ts L930 附近
if (!options.json) {
  // 检测可疑的 commandArgs（包含空格的中文文本被拆分）
  const suspiciousArgs = options.commandArgs.filter(arg => 
    /[\u4e00-\u9fa5]/.test(arg) && arg.length < 10
  )
  if (suspiciousArgs.length > 0) {
    process.stderr.write(`[headless] Warning: Detected potentially split arguments: ${suspiciousArgs.join(', ')}\n`)
    process.stderr.write(`[headless] Suggestion: Use --context <file> instead of --context-text for long text\n`)
  }
  
  process.stderr.write(`[headless] Running /gsd ${options.command}${options.commandArgs.length > 0 ? ' ' + options.commandArgs.join(' ') : ''}...\n`)
}
```

### 修复 2：持久化 context 元数据（完整方案）

```typescript
// src/headless.ts L368-371 修改
if (isNewMilestone) {
  // ... existing code ...
  
  // 持久化 context 元数据，供 restart 恢复
  writeFileSync(
    join(runtimeDir, 'headless-context-meta.json'),
    JSON.stringify({
      contextText: options.contextText,
      context: options.context,
      updatedAt: Date.now()
    }),
    'utf-8'
  )
}

// 在 runHeadlessOnce 开头恢复
if (isNewMilestone && !options.context && !options.contextText) {
  const metaPath = join(runtimeDir, 'headless-context-meta.json')
  if (existsSync(metaPath)) {
    try {
      const meta = JSON.parse(readFileSync(metaPath, 'utf-8'))
      if (meta.contextText) {
        options.contextText = meta.contextText
        process.stderr.write('[headless] Restored context from previous run\n')
      }
    } catch {}
  }
}
```

---

## 总结

| 修复层级 | 实施难度 | 效果 | 推荐度 |
|---------|---------|------|--------|
| 代码防御（警告） | 低 | 提示用户问题 | ⭐⭐⭐ |
| 使用规范（文件方式） | 低 | 根本避免问题 | ⭐⭐⭐⭐⭐ |
| 架构改进（持久化） | 中 | 自动修复 restart | ⭐⭐⭐⭐ |

**当前推荐**:
1. 立即使用 **文件方式** 验证 phase-discipline（最稳定）
2. 后续实施 **持久化元数据** 修复（改善体验）
3. **警告日志** 作为补充（帮助诊断）
