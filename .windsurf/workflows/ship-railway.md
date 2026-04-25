---
description: 提交当前代码、push 到 GitHub、触发 Railway 部署，并在缺少 git 身份、未 link Railway 项目、未选择 service、Railway 日志异常等常见阻塞下继续推进
---
# /ship-railway

用于当前项目 `/root/gsd-2` 的标准发版流程。目标是把当前工作树提交到 GitHub，并触发 Railway 部署；同时把本项目里已经遇到过的问题和处理经验内建进流程，避免下次新会话重复排查。

## 适用场景

- 用户明确要求“提交代码并 push 到 GitHub，再触发 Railway 部署”
- 当前工作基于仓库 `/root/gsd-2`
- 需要覆盖 GitHub 与 Railway 两段链路，而不是只做本地 commit

## 执行原则

1. 先检查，再提交，再 push，再部署
2. 没有 fresh evidence 不要声称部署成功
3. 遇到可恢复阻塞时优先继续推进，不要过早停住
4. 只有在目标不明确时才向用户提问
5. 所有外部副作用动作都要谨慎：`git commit`、`git push`、`railway link`、`railway up`

## 固定检查顺序

按下面顺序执行，不要跳步：

1. 检查 git 当前状态
   - `git branch --show-current`
   - `git status --short`
   - `git remote -v`
2. 确认 Railway CLI 是否可用
   - `command -v railway || true`
3. 如需了解当前仓库是否已 link Railway
   - `railway status`

## Commit 阶段

1. 先根据 diff 生成准确的单行 commit message
2. 仅添加与当前任务直接相关的文件，不要顺手提交无关改动
3. 执行 commit

推荐命令模式：

```bash
git add <relevant-files> && git commit -m "<message>"
```

### 常见阻塞 1：Git 缺少作者身份

如果 commit 失败并出现类似：

- `Author identity unknown`
- `fatal: unable to auto-detect email address`

按下面方式处理：

1. 先读取最近提交作者，给用户最小选择集
   - `git log -5 --pretty=format:'%an <%ae>' | sort -u`
2. 优先推荐与当前仓库远端 owner 一致的身份
3. 只配置当前仓库，不要默认改全局配置

本项目曾验证可用的仓库级配置示例：

```bash
git config user.name "graysonzeng"
git config user.email "916028390@qq.com"
```

配置后重新执行 `git add` + `git commit`。

## Push 阶段

commit 成功后执行：

```bash
git push -u origin <current-branch>
```

完成后要确认：

- push 成功
- 当前分支已经建立 upstream tracking

## Railway 部署阶段

### 第一步：确认 Railway 账号与项目

如果 `railway status` 返回：

- `No linked project found. Run railway link to connect to a project`

按下面顺序处理：

1. 查看当前登录账号与项目列表
   - `railway whoami`
   - `railway list`
2. 如果账号下只有一个项目，优先推荐它
3. 如果用户未指定项目，先让用户确认项目目标，再 link

本项目已验证过的 Railway 目标：

- workspace: `grayson's Projects`
- project: `gleaming-ambition`
- environment: `production`

可直接使用：

```bash
railway link -p gleaming-ambition
```

link 后再执行：

```bash
railway status
```

预期至少应看到：

- `Project: gleaming-ambition`
- `Environment: production`

### 第二步：确认 service

如果 `railway status` 显示：

- `Service: None`

说明项目和环境已绑定，但 service 还没选。

这时不要盲 deploy，先列出服务：

```bash
railway service status --all
```

本项目曾出现的 services：

- `web`
- `api`
- `probe`
- `Postgres`

处理规则：

- `Postgres` 不做代码部署
- 如果用户没有明确说目标 service，就必须问清楚
- 如果用户选择多个 service，按顺序逐个部署，并分别确认结果

### 第三步：触发部署

推荐使用 CI 模式，避免一直挂在日志流上：

```bash
railway up -c -s <service> -e production -m "deploy <short-sha> <summary>"
```

例如本项目曾成功执行：

```bash
railway up -c -s web -e production -m "deploy 1dbbd5e0 auth-storage backoff fix"
```

## 部署结果验证

每个 service 部署后都要单独验证，不要只依赖 `railway up` 的即时输出。

推荐检查：

```bash
railway service status -s <service> -e production
railway service status -s <service> -e production --json
```

成功标准：

- `status` 为 `SUCCESS`

## 本项目已遇到的典型问题与处理经验

### 问题 1：`web` 部署成功但 `api` 部署失败

本项目已出现过：

- `web` 部署成功
- `api` 部署失败

因此不要把某个 service 的成功误报为整个 Railway 发布成功。

### 问题 2：`api` 部署时 CLI 日志流失败

曾出现过：

- `Failed to stream build logs: Failed to retrieve build log`
- `Deployment does not have an associated build`

遇到这类情况时，按以下顺序处理：

1. 不要立刻假设是本地命令错误
2. 先查 service 状态

```bash
railway service status -s api -e production --json
```

3. 如果状态已经是 `FAILED`，说明问题真实存在，不是单纯日志拉取失败
4. 允许做一次带详细日志的重试，用于拿更多证据：

```bash
railway up -c --verbose -s api -e production -m "deploy <sha> <summary> verbose retry"
```

5. 如果重试后仍然是同样现象：
   - 停止重复触发部署
   - 明确向用户报告：这是稳定复现的问题
   - 判断为 Railway service 侧配置、构建类型或平台日志链路问题的概率更高

### 问题 3：日志抓不到，但状态可以确认

如果：

- `railway service logs` 拿不到有效日志
- 但 `railway service status --json` 能返回明确状态

优先以 `status` 作为最终证据，不要因为日志空白就说“未知”。

## 推荐输出模板

完成后向用户汇报时至少包含：

- commit sha
- commit message
- push 到的分支名
- Railway project / environment
- 每个 service 的部署结果
- 如果失败，给出失败证据与下一步建议

推荐结构：

1. 已完成事项
2. 验证证据
3. Railway 各 service 状态
4. 遇到的问题
5. 建议的下一步

## 结束前必须执行的收尾检查

```bash
git status --short
git rev-parse --short HEAD
```

预期：

- `git status --short` 为空或符合用户预期
- HEAD 与刚提交的 commit 一致

## 本项目默认经验值

当缺少更强信号时，可参考以下已验证默认值：

- repo path: `/root/gsd-2`
- Railway project: `gleaming-ambition`
- Railway environment: `production`
- 常见代码 services: `web`、`api`
- Git 身份优先推荐：`graysonzeng <916028390@qq.com>`（仅限当前仓库配置，不默认改全局）

如果未来这些默认值变化，优先以实时命令输出为准，不要盲信历史经验。
