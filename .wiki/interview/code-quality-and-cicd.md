# Interview Q&A — Code Quality & CI/CD

> Covers: pre-commit formatting, pnpm workspace protocol, GitHub Actions.
> Related tasks: TASK-INFRA-0002, TASK-INFRA-0003.

---

## 1. 格式化工具选型

### Q: 你项目里 8 个服务用了哪些格式化工具，为什么不统一用一个？

每个语言生态有自己事实标准的工具，强行统一反而会损失各生态的最佳实践：

| 服务 | 工具 | 理由 |
|---|---|---|
| bff / frontend / message / frontend-base | **Prettier** | JS/TS 生态事实标准，零配置，不可配置的风格减少争论 |
| bff / frontend | **ESLint** | 抓逻辑错误（未使用变量、错误类型等），Prettier 管不了这些 |
| core / thirdparty | **Spotless + google-java-format** | Maven 插件生态，google-java-format 是 Google/Palantir 推荐的 Java 标准 |
| shop | **Laravel Pint** | Laravel 官方工具，基于 php-cs-fixer，内置 Laravel 风格预设 |
| data | **Ruff** | Rust 实现，比 Black + isort + flake8 快 10-100 倍，一个工具替代三个 |

---

### Q: Prettier 和 ESLint 的区别是什么，为什么要两个都用？

- **Prettier** 只管**格式**：缩进、引号、分号、行宽、换行。它不关心代码逻辑，所有问题都能自动修复。
- **ESLint** 管**代码质量**：未使用变量、隐式类型转换、可达性检查等。部分规则可以 `--fix` 自动修，部分需要人工介入。

两者互补，不重叠。最佳实践是关掉 ESLint 里所有格式规则（用 `eslint-config-prettier`），让 Prettier 独占格式，ESLint 专注逻辑。

---

### Q: Ruff 是什么，和 Black/isort/flake8 相比有什么优势？

Ruff 是用 Rust 写的 Python linter + formatter，单个二进制替代了 Black（格式化）+ isort（import 排序）+ flake8（lint）三个工具的功能组合。

主要优势：
- **速度**：比 Black 快约 100 倍，对大型 Python 项目有感知差异
- **统一配置**：三个工具的规则统一在 `pyproject.toml` 的 `[tool.ruff]` 下管理
- **兼容性**：`ruff format` 输出与 Black 完全兼容，迁移无成本

---

### Q: google-java-format 和 Checkstyle 有什么区别？

- **google-java-format** 是 formatter：直接改写源文件，强制统一格式，没有规则可配，要么全用要么不用。类似 Prettier 对 JS 的定位。
- **Checkstyle** 是 linter：只检查不修改，报告违规，规则可以精细配置。类似 ESLint 对 JS 的定位。

这个项目选 google-java-format 是因为它**自动修复**，不需要开发者记规则，提交前 `spotless:apply` 自动改好。Checkstyle 适合需要自定义规则的大型团队。

---

## 2. Pre-commit Hook

### Q: pre-commit hook 的执行流程是什么？

```
git commit
  │
  ├─ pre-commit hook 触发
  │     ├─ 检测哪些目录有 staged 文件
  │     ├─ Node 服务 → npx lint-staged（ESLint --fix + Prettier --write）
  │     ├─ Java 服务 → mvn spotless:apply → 重新 git add 被修改的 .java 文件
  │     ├─ PHP 服务  → pint <staged .php 文件> → 重新 git add
  │     └─ Python 服务 → ruff format + ruff check --fix → 重新 git add
  │
  ├─ commit-msg hook 触发
  │     └─ 校验格式：<type>(<scope>): <summary>
  │
  └─ commit 写入
```

只处理有 staged 文件的服务，改了 `points-mall-core` 不会触发前端的 lint-staged。

---

### Q: lint-staged 和直接在 pre-commit 里跑 eslint 有什么区别？

直接跑 `eslint src/` 会检查整个目录，哪怕大部分文件没改。lint-staged 只处理本次 `git add` 的文件：

1. 性能：只格式化改动的文件，大项目里差距明显
2. 精确：不会因为别人之前留下的格式问题导致你的提交失败
3. 自动 re-stage：格式化后自动把修改后的文件重新 `git add`，不需要手动操作

---

### Q: 如果 ESLint 有无法自动修复的错误，会发生什么？

pre-commit 以非零退出码退出，Git 终止提交。terminal 里显示具体是哪个文件哪一行违反了哪条规则，开发者手动修完再 `git add` 重新提交。这是预期行为——说明代码有真实的逻辑问题，不应该进入仓库。

---

### Q: 开发者可以跳过 pre-commit hook 吗？

可以：`git commit --no-verify`。

但这在团队里是 bad practice，因为 CI 里有同样的检查（`format:check` + lint），跳过 hook 只是把问题推迟到 PR 阶段才暴露，代价更高。

---

## 3. pnpm Workspace 协议

### Q: `workspace:*` 是什么意思？

pnpm 特有的 workspace 协议，表示"从本地 monorepo 中的同名包解析，版本任意匹配"。

```json
// points-mall-frontend/package.json
{
  "dependencies": {
    "@points-mall/frontend-base": "workspace:*"
  }
}
```

效果：pnpm 在 `node_modules/@points-mall/frontend-base` 下创建指向 `../points-mall-frontend-base/` 的符号链接（symlink）。修改 `frontend-base` 的源码，`frontend` 立即看到变化，不需要 publish 到 npm。

---

### Q: `workspace:*` 和 `workspace:^` 有什么区别？

| 协议 | 含义 | 发布到 npm 时转换为 |
|---|---|---|
| `workspace:*` | 任意版本，只关心本地链接 | `*`（不推荐） |
| `workspace:^` | 兼容版本范围 | `^x.y.z`（当前版本） |
| `workspace:~` | 补丁版本范围 | `~x.y.z` |

实际上发布之前 pnpm 会把 `workspace:*` 替换成具体版本号。如果这个 monorepo 里的包需要独立发布到 npm（比如 `frontend-base` 发布成公共组件库），应该用 `workspace:^`；如果只在内部 monorepo 使用，`workspace:*` 更简单。

---

### Q: 为什么 `frontend-base` 不直接发布到 npm，而是用 workspace 链接？

开发阶段用 workspace 链接的好处：
1. **零延迟**：改了 `frontend-base` 立即生效，不需要 `npm publish` + `pnpm update`
2. **原子提交**：`frontend-base` 和 `frontend` 的改动可以在同一个 commit 里，不存在版本不一致的状态
3. **IDE 支持**：TypeScript 类型检查和 Go-to-definition 直接跳到源码，不是 `dist/`

TASKLIST.md T074 计划正式发布到 npm，那时候 `frontend` 会从 workspace link 切换到 npm 包，是很自然的演进路径。

---

## 4. GitHub Actions

### Q: GitHub Actions 的核心执行模型是什么？

触发事件（push/PR）→ 选中对应 workflow 文件 → 并行启动各 job → 每个 job 在独立的虚拟机上执行 steps → 结果上报给 GitHub。

关键点：
- **job 之间相互隔离**：不共享文件系统，如果需要传递产物要用 `actions/upload-artifact`
- **同一 job 的 steps 共享环境**：同一个虚拟机，前一个 step 的文件/环境变量后一步可以看到
- **并行是默认行为**：jobs 默认并行，用 `needs: [job-a, job-b]` 声明依赖才会串行

---

### Q: 这个项目的 ci.yml 如何保证 PR 不能合并直到所有检查通过？

GitHub 仓库需要在 **Settings → Branches → Branch protection rules** 里对 `main` 分支开启：
- ✅ Require status checks to pass before merging
- 选中 ci.yml 里的所有 job 名（bff, core, shop 等）作为 required checks

这样任何一个 job 失败，GitHub 的 Merge 按钮就会变灰，强制 PR 必须修好才能合并。

---

### Q: ci.yml 里 Java job 用了 Maven cache，原理是什么？

```yaml
- uses: actions/cache@v4
  with:
    path: ~/.m2/repository
    key: maven-${{ hashFiles('points-mall-core/pom.xml') }}
```

第一次跑时 `~/.m2/repository` 为空，Maven 从远程下载所有依赖，结束后 Actions 把这个目录打包存到 GitHub 的 cache 存储。

后续跑时，如果 `pom.xml` 没变（hash 相同），直接还原 cache，跳过下载。`pom.xml` 变了（加了新依赖）才重新下载。Java 项目初次 CI 可能需要 3-5 分钟，有 cache 后通常降到 30-60 秒。

---

### Q: deploy.yml 的部署流程是什么？

```
merge 到 main
  │
  ├─ 7 个 build job 并行
  │     每个 job：docker build → docker push 到 GHCR（GitHub Container Registry）
  │     镜像 tag：commit SHA（精确追踪）+ latest（方便引用）
  │
  └─ deploy job（needs: 所有 build job）
        SSH 到 VPS →
        docker compose pull →    # 拉取刚推送的 latest 镜像
        docker compose up -d →   # 滚动重启
        docker image prune -f    # 清理旧镜像
```

`needs` 保证所有镜像构建成功后才执行部署，任何一个服务构建失败不会触发半成品部署。

---

### Q: 为什么镜像同时打两个 tag（commit SHA 和 latest）？

- **commit SHA**（如 `abc1234`）：不可变，精确对应某次代码状态，用于回滚和审计
- **latest**：可变，永远指向最新版本，`docker compose pull` 拉取时用这个

回滚时只需要把 `docker-compose.yml` 里的镜像 tag 改成某个历史 SHA，重新 `docker compose up`，而不需要重新 build。

---

### Q: Secrets 如何管理，为什么不直接写在 yml 里？

GitHub Secrets（Settings → Secrets and variables → Actions）存储加密，特点：
1. **不出现在日志**：即使 `run: echo ${{ secrets.MY_KEY }}` 也会被替换成 `***`
2. **不进入代码仓库**：yml 文件里只有占位符 `${{ secrets.KEY_NAME }}`
3. **环境隔离**：可以设置 `environment: production`，只有 production 环境的 workflow 才能读取对应 secret

直接写在 yml 里会进入 Git 历史，即使删除也可以从历史 commit 里找回，是严重的安全问题。

---

### Q: 8 个服务都是独立 Git 仓库（submodule），为什么每个子仓库也要有自己的 ci.yml？

这个项目的仓库结构是 **monorepo-as-coordinator + 8 个独立 sub-repo**：

```
fullstack-points-mall/  ← monorepo（Git submodule 宿主）
  .github/workflows/ci.yml   ← 集成 CI（所有服务一起跑）
  points-mall-bff/            ← 独立 Git 仓库（submodule）
    .github/workflows/ci.yml  ← 子仓库 CI（只跑 bff）
  points-mall-core/           ← 独立 Git 仓库（submodule）
    .github/workflows/ci.yml  ← 子仓库 CI（只跑 core）
  ...
```

如果只在 monorepo 维护 CI，直接在子仓库开 PR 时，GitHub 不会触发任何检查——代码完全没有质量门控。新团队成员如果不了解 submodule 工作流，直接在子仓库开发提交，就会绕过所有 CI。

**两层 CI 分工：**

| | monorepo `ci.yml` | 子仓库 `ci.yml` |
|---|---|---|
| 触发时机 | 更新 submodule 指针的 PR | 直接在子仓库开 PR |
| 检查范围 | 所有服务（集成视角） | 只检查该服务自身 |
| 场景 | 跨服务协作变更、发布前验证 | 日常单服务开发 |

两层 CI 都设置 branch protection required checks，无论哪条路径提交都必须通过检查。

---

### Q: `points-mall-frontend` 子仓库 CI 有什么特殊处理？

`frontend` 依赖 `@points-mall/frontend-base`，在 monorepo 里通过 `workspace:*` 解析为本地符号链接。但在子仓库独立 checkout 时，pnpm 找不到这个 workspace 包，`pnpm install` 会失败。

解决方案：在 CI 里额外 checkout `frontend-base` 并动态创建一个临时 workspace 文件：

```yaml
- name: Checkout frontend-base
  uses: actions/checkout@v4
  with:
    repository: ${{ github.repository_owner }}/points-mall-frontend-base
    path: points-mall-frontend-base

- name: Setup pnpm workspace
  run: |
    cat > pnpm-workspace.yaml << 'EOF'
    packages:
      - '.'
      - './points-mall-frontend-base'
    EOF

- run: pnpm install --no-frozen-lockfile
- run: pnpm --filter points-mall-frontend-base build
- run: pnpm lint && pnpm format:check && pnpm build
```

`${{ github.repository_owner }}` 动态读取 org/user 名，不硬编码。这是子仓库之间有 workspace 依赖时的标准处理模式。
