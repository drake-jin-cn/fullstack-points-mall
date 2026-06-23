# TASK-INFRA-0002 面试问答 — 项目工具链搭建

> 对应提交：`feat(TASK-INFRA-0002): build project toolchain with pnpm workspace, task scripts, Bruno CLI, Git hooks`
> 涉及技术：pnpm workspace · Monorepo · Bruno · Git Hooks · Husky · Conventional Commits

---

## Monorepo & pnpm workspace

### Q1：为什么用 pnpm workspace 而不是分别独立管理 8 个仓库？

**独立仓库（polyrepo）的痛点：**
- 跨服务的公共依赖版本不一致，A 服务用 lodash 4，B 服务用 lodash 3
- 一个功能改动涉及 3 个服务，需要开 3 个 PR、协调 3 次 review
- 本地联调需要手动 `npm link`，繁琐且容易出错

**Monorepo + pnpm workspace 的收益：**
- 单一 `pnpm install` 安装所有依赖，公共依赖只安装一次（hoisting）
- `pnpm --filter points-mall-bff dev` 可以单独启动某个服务
- `frontend` 可以直接引用 `frontend-base` 的本地代码，无需发布即可联调
- 根目录的 task 脚本、CI、Git hooks 统一管理

**pnpm vs npm/yarn workspace：**

| 维度 | pnpm | npm/yarn |
|------|------|----------|
| 磁盘占用 | 极低（硬链接共享） | 高（每个 workspace 各自安装） |
| 幽灵依赖 | 无（严格 node_modules 结构） | 有（被提升的间接依赖可以 require） |
| 速度 | 快 | 慢 |

---

### Q2：什么是"幽灵依赖"（Phantom Dependency）？pnpm 怎么解决它？

**幽灵依赖**：项目 `package.json` 里没有声明，但因为某个依赖把它提升到了根 `node_modules`，代码里可以直接 `require` 到。

```
# npm/yarn 的 node_modules（扁平结构）
node_modules/
  express/         ← 你声明了
  lodash/          ← express 的依赖，被提升上来了
  
# 代码里可以写 require('lodash')，但 package.json 没声明
# 某天 express 升级不再依赖 lodash → 代码崩
```

**pnpm 的解决方案**：每个包有自己的 `node_modules`，只能访问 `package.json` 里声明的依赖。未声明的包即使在磁盘上存在，也不在 `require` 的解析路径里。

---

## API 测试工具

### Q3：Bruno 和 Postman 有什么区别？为什么选 Bruno？

| 维度 | Bruno | Postman |
|------|-------|---------|
| 存储格式 | **纯文本 `.bru` 文件**，可提交 Git | 私有云端同步，不进 Git |
| 协作方式 | PR review，和代码一起版本化 | 团队账号共享，付费 |
| 离线使用 | 完全离线 | 依赖云端 |
| CI 集成 | `bru run --env local` 直接跑 | 需要 Newman 额外工具 |
| 隐私 | 本地完全自主 | 接口信息上传 Postman 云 |

**核心优势**：API 测试文件和代码一起进 Git，当 API 改动时测试文件也要同步更新，Review 时一目了然。这个项目里每个服务的 `.bru` 文件就是 API 的活文档。

---

## Git Hooks

### Q4：Git Hooks 是什么？`commit-msg` hook 做了什么？

Git Hooks 是 Git 在特定操作前后自动执行的脚本，存放在 `.git/hooks/` 目录。

`commit-msg` hook 在 `git commit` 保存提交信息前触发，可以读取并校验消息格式：

```bash
#!/bin/sh
# .git-hooks/commit-msg

COMMIT_MSG=$(cat "$1")
PATTERN='^(feat|fix|chore|test|docs|refactor|ci)\(TASK-[A-Z]+-[0-9]+\): .+'

if ! echo "$COMMIT_MSG" | grep -qE "$PATTERN"; then
  echo "❌ Commit message 格式错误"
  echo "   正确格式: feat(TASK-INFRA-0001): implement health endpoint"
  exit 1
fi
```

这样每一条 git log 都带有 TASK ID，`git log --grep="TASK-INFRA-0001"` 可以精确找到某个任务的所有提交。

---

### Q5：为什么用复制（copy）而不是软链接（symlink）来安装 hook？

软链接在 macOS/Linux 上工作正常，但在 **Windows** 上需要管理员权限才能创建，普通开发环境可能报错。

复制方式：
- 跨平台兼容，Windows 开发者 `pnpm run hooks:install` 直接生效
- 缺点：hook 文件更新后需要重新运行 `hooks:install`（设置了 `prepare` script 自动处理）

```json
"prepare": "node .git-hooks/install.js"
```

`pnpm install` 完成后自动执行 `prepare`，新成员 clone 仓库后只需 `pnpm install` 就完成了 hook 安装。

---

## 任务管理脚本

### Q6：`tasks-sync.js` 解析 YAML frontmatter 是什么原理？

每个 `.tasks/TASK-*.md` 文件头部有被 `---` 包裹的 YAML 元数据：

```markdown
---
id: TASK-INFRA-0001
status: test-pass
assignee: AI
---
正文...
```

脚本逻辑：
1. `fs.readFileSync` 读取文件内容
2. 用正则 `/^---\n([\s\S]*?)\n---/` 提取两个 `---` 之间的内容
3. 用 `yaml.parse()` 解析成 JS 对象
4. 汇总所有任务，生成 Markdown 表格写入 `_index.md`

这种把配置数据内嵌进 Markdown 文件头部的格式叫 **Frontmatter**，Jekyll、Hugo、Next.js 的 `next-mdx-remote` 都使用这个惯例。

---

### Q7：`run-task-tests.js` 的 `--update-status` 怎么自动修改 task 文件状态？

脚本读取文件内容，用**字符串替换**更新 frontmatter 里的 `status` 字段，再追加一条历史记录：

```javascript
// 替换 status 行
content = content.replace(
  /^status: .+$/m,
  `status: ${newStatus}`
);

// 追加历史记录行
const historyRow = `| ${date} | ${oldStatus} | ${newStatus} | script | test:task run |`;
content = content.replace(
  '## Status Change History\n\n| Time |',
  `## Status Change History\n\n${historyRow}\n| Time |`
);

fs.writeFileSync(taskFilePath, content);
```

这个设计让任务状态变化有完整的审计轨迹，且全部存在 Git 里，不依赖任何外部系统（Jira/Linear 等）。
