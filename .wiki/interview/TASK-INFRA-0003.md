# TASK-INFRA-0003 面试问答 — 多环境配置管理

> 对应提交：`feat(TASK-INFRA-0003): multi-environment config setup for all 8 services`
> 涉及技术：12-Factor App · dotenv · Spring Profiles · NestJS ConfigModule · Next.js Env · Secrets 管理

---

## 配置管理原则

### Q1：什么是 12-Factor App 的配置原则？这个项目怎么实践的？

[12-Factor App](https://12factor.net/) 第三条原则：**将配置存储在环境变量中，与代码严格分离。**

判断标准很直接：把代码开源出去，会不会泄露任何凭据？如果配置都在代码里，开源就等于泄露。

**本项目的实践：**
- 所有密码、API key、连接字符串 → 环境变量，不出现在任何源文件
- `.env.example` 提交到 Git：记录"需要哪些变量"，但值全是占位符
- 真实 `.env.*` 文件（`.env.dev`、`.env.prod` 等）在 `.gitignore` 里，只存在本地或部署环境

```bash
# .env.example（提交 Git）
DB_HOST=localhost
DB_PASSWORD=          ← 空值，告诉开发者"这里要填密码"

# .env.dev（不提交 Git，本地自己填）
DB_HOST=localhost
DB_PASSWORD=points_dev
```

---

### Q2：各框架的多环境配置机制有什么不同？

| 框架 | 机制 | 环境切换方式 |
|------|------|------------|
| NestJS | `@nestjs/config` 加载 `.env.${NODE_ENV}` | `NODE_ENV=prod pnpm start` |
| Spring Boot | `application-{profile}.yml` | `SPRING_PROFILES_ACTIVE=prod` |
| Laravel | 单一 `.env` 文件 | 部署时替换整个 `.env` |
| Express/TS | `dotenv` 加载 `.env.${NODE_ENV}` | `NODE_ENV=prod node dist/index.js` |
| FastAPI | `python-dotenv` 加载 `.env.${ENVIRONMENT}` | `ENVIRONMENT=prod uvicorn main:app` |
| Next.js | 内置机制，`.env.{development,production,test}` | 构建时自动选择 |

**Spring Boot 的特殊点**：Spring 不读 `.env` 文件，而是把配置分散在多个 YAML 文件里，主文件 `application.yml` 通过 `spring.profiles.active` 激活对应的 profile 文件：

```yaml
# application.yml
spring:
  profiles:
    active: ${SPRING_PROFILES_ACTIVE:dev}  # 默认 dev，可被环境变量覆盖
```

---

### Q3：为什么 `dotenv` 的 `load_dotenv` 要在所有 `import` 之前执行？

以 FastAPI 为例：

```python
# ❌ 错误顺序
from database import db_client  # db_client 在模块加载时就读了 DB_URL
load_dotenv('.env.dev')          # 太晚了，DB_URL 还是空

# ✅ 正确顺序
load_dotenv('.env.dev')          # 先把环境变量写进 os.environ
from database import db_client  # 这时候 DB_URL 已经有值了
```

Python 模块只加载一次（缓存在 `sys.modules`），模块级代码（类定义、全局变量初始化）在第一次 `import` 时执行。如果 DB client 在模块顶层读取 `os.environ['DB_URL']`，必须确保 `dotenv` 在它之前运行。

---

### Q4：Next.js 的环境变量有什么特殊规则？

Next.js 有两类变量，访问权限完全不同：

**服务端变量（只在 Node.js 进程里可用）：**
```
DB_PASSWORD=secret   ← 浏览器里 process.env.DB_PASSWORD === undefined
```

**客户端可访问变量（必须加 `NEXT_PUBLIC_` 前缀）：**
```
NEXT_PUBLIC_API_URL=http://localhost:4000  ← 打包时内联进浏览器 JS
```

原理：Next.js 构建时扫描所有 `NEXT_PUBLIC_*` 变量，用字面量替换掉代码里的 `process.env.NEXT_PUBLIC_XXX`（类似 Webpack DefinePlugin）。没有 `NEXT_PUBLIC_` 前缀的变量**不会**被打包进浏览器 bundle，防止密码意外暴露。

---

### Q5：`.env.example` 和真实 `.env` 文件应该怎么管理，什么该提交，什么不该？

```
提交 Git ✅
├── .env.example          ← 记录所有变量名 + 安全默认值/占位符
└── .env.development      ← Next.js 约定：development 环境的非敏感默认值可提交

不提交 Git ❌（在 .gitignore 里）
├── .env.dev              ← 本地开发用，含真实密码
├── .env.test             ← 测试环境，含 CI 密码
└── .env.prod             ← 生产环境，含生产密码（通常由 CD pipeline 注入）
```

**生产环境最佳实践**：生产密码不存文件，而是通过 CI/CD 环境变量注入（GitHub Actions Secrets、Kubernetes Secret、AWS Parameter Store）。`.env.prod` 文件只在本机调试时临时使用。

---

### Q6：如果不小心把含密码的 `.env` 文件提交进了 Git，怎么处理？

**错误做法**：在下一个 commit 里删除文件。Git 历史里还有记录，`git log` 可以找回来。

**正确步骤：**

1. **立刻轮转（rotate）所有泄露的凭据**——改密码、重新生成 token，这是第一优先级
2. 从 Git 历史彻底删除：
   ```bash
   git filter-branch --force --index-filter \
     "git rm --cached --ignore-unmatch .env.prod" \
     --prune-empty --tag-name-filter cat -- --all
   ```
   或用更现代的 `git-filter-repo` 工具
3. `git push --force` 强推所有分支和 tag
4. 通知所有协作者重新 clone，旧的本地 clone 都可能含有泄露历史
5. 在 `.gitignore` 里补上对应规则，避免再次发生

关键点：**先换密码，再清历史**，顺序不能反。
