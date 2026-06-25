# T006 面试考察点 — 员工认证 API（Spring Boot 后端）

> 覆盖范围：BCrypt、Filter、AOP、Spring Security、Seeder、内部 API 鉴权设计、错误码体系与异常链路透传、Jackson 序列化陷阱、Spring Boot 测试模式

---

## 一、BCrypt 与密码安全

**Q1：为什么存储密码时要用 BCrypt，而不是 MD5 或 SHA-256？**

A：MD5 / SHA-256 是快速哈希算法，单次运算在现代 GPU 上只需纳秒级，攻击者可以用彩虹表或暴力枚举。BCrypt 内置了"工作因子"（cost factor），每次哈希故意消耗大量 CPU 时间，即使拿到数据库也很难反推原文。此外 BCrypt 自带随机 salt，相同密码每次生成的哈希值不同，彻底防止彩虹表攻击。

---

**Q2：BCrypt 的 cost factor（rounds）设置多少合适？默认值是多少？**

A：Spring Security Crypto 的默认值是 10，对应约 100 ms 的哈希时间。一般生产环境选 10–12：太低则运算太快、暴力破解成本低；太高则登录接口响应慢，影响用户体验。可以通过压测登录接口来确定合适的值，目标是让单次 `matches()` 耗时控制在 100–300 ms 以内。

---

**Q3：项目里只引入了 `spring-security-crypto`，而不是 `spring-boot-starter-security`，为什么？**

A：`spring-boot-starter-security` 会触发 Spring Security 的自动配置，带来一系列默认行为：自动生成登录页、激活 CSRF 保护、启用 HTTP Basic 认证、创建 `SecurityFilterChain` 等。对于 Core 服务来说，这些全都不需要（Core 只有内网 API，没有直接面向外部用户的端点）。单独引入 `spring-security-crypto` 只获得 `BCryptPasswordEncoder` 这一个工具类，零副作用。

---

**Q4：`BCryptPasswordEncoder.matches(rawPassword, encodedPassword)` 内部做了什么？**

A：从 `encodedPassword` 中提取 salt 和 cost factor（BCrypt 哈希字符串本身就包含这些信息，格式为 `$2a$10$<22位salt><31位hash>`），然后用同样的参数对 `rawPassword` 进行哈希，再做字符串比较。注意这里必须用 `matches()` 而不能用 `==` 或 `equals()` 直接比较原文与密文。

**关键推论**：`matches()` 读取的 cost factor 来自哈希字符串本身，而不是 `new BCryptPasswordEncoder(strength)` 传入的值。因此，用 strength=4 生成的测试哈希，可以被 strength=12 的 encoder 正确验证——两者的 strength 不必一致。这正是为什么测试代码可以用 `BCryptPasswordEncoder(4)` 提速，而生产代码用 `BCryptPasswordEncoder(12)`。

---

## 二、Filter 与 OncePerRequestFilter

**Q5：`OncePerRequestFilter` 和普通 `javax.servlet.Filter` 有什么区别？**

A：Servlet 规范中，`Filter` 在同一个请求经过 forward 或 include 时可能被多次调用。`OncePerRequestFilter` 是 Spring 提供的抽象类，通过在 request attribute 中设置一个标志位，保证每个 HTTP 请求的完整生命周期内 `doFilterInternal` 只执行一次，避免重复校验或重复写入 response。

---

**Q6：Filter 和 Spring MVC 的 Interceptor 有什么本质区别？**

A：

| 维度 | Filter（Servlet 层） | Interceptor（Spring MVC 层） |
|------|---------------------|------------------------------|
| 规范 | Servlet 规范，容器级别 | Spring 框架，DispatcherServlet 内部 |
| 触发时机 | 在 DispatcherServlet 之前 | 在 DispatcherServlet 之后、Controller 之前 |
| 能拦截的内容 | 所有请求（包括静态资源） | 只有 DispatcherServlet 映射的请求 |
| 能访问 Spring Bean | 需要手动从 ApplicationContext 获取 | 天然支持依赖注入 |
| 适合场景 | 全局认证、日志、跨域（CORS） | 权限校验、登录检查、审计日志 |

对于 INTERNAL_API_KEY 这种"无效则直接拒绝，不需要知道具体 Controller"的场景，Filter 更合适，因为可以在请求到达业务代码之前就短路返回 401。

---

**Q7：为什么不在每个 Controller 方法上用 `@RequestHeader` 检查 `INTERNAL_API_KEY`，而要用 Filter 全局拦截？**

A：逐 Controller 检查有两个致命缺陷：
1. **安全漏洞风险**：新增 `/internal/**` 端点时，如果开发者忘记加注解，就产生了一个未鉴权的接口。
2. **代码重复**：每个方法都要写相同的校验逻辑，违反 DRY 原则。

Filter 路径匹配（`/internal/**`）一次配置、终身生效，新增端点自动受保护。这是"默认拒绝（deny by default）"原则的体现。

---

## 三、AOP 与 Filter 的选择

**Q8：你们为什么用 Filter 而不是 AOP 来做 INTERNAL_API_KEY 鉴权？**

A：
- **AOP** 工作在 Spring Bean 方法调用层面，拦截的是 Java 方法，依赖 Spring 代理机制，必须等请求进入 Spring 容器后才能生效。
- **Filter** 工作在 HTTP 请求层面，在 DispatcherServlet 之前就能截断请求，直接操作 `HttpServletRequest` / `HttpServletResponse`。

对于"非法请求在到达业务层之前就应该被拒绝"的场景，Filter 是更正确的选择——它不会浪费 Spring 容器的资源去解析路由、注入依赖、创建 Controller 实例。

---

**Q9：AOP 适合哪些场景？**

A：AOP 适合横切关注点但不需要操作 HTTP 层的场景：
- 方法级别的权限校验（如 `@PreAuthorize("hasRole('ADMIN')")`）
- 事务管理（`@Transactional`）
- 方法执行耗时统计（性能监控）
- 操作日志审计（记录"谁在什么时间调用了什么方法，参数是什么"）
- 异常统一捕获与转换

---

## 四、Spring Security 架构

**Q10：Spring Security 的核心过滤链（SecurityFilterChain）是怎么工作的？**

A：Spring Security 本质上是一条有序的 Filter 链，注册在 Servlet 容器的 `FilterChainProxy` 中，常见过滤器按顺序执行（部分）：

1. `SecurityContextPersistenceFilter` — 从 Session/其他存储加载 SecurityContext
2. `UsernamePasswordAuthenticationFilter` — 处理表单登录
3. `BearerTokenAuthenticationFilter` — 处理 JWT Bearer Token
4. `ExceptionTranslationFilter` — 捕获认证/授权异常，转换为 401/403 响应
5. `FilterSecurityInterceptor` — 最终权限决策

每个过滤器决定是否继续调用 `chain.doFilter()` 传递请求，或直接写响应终止链路。

---

**Q11：什么场景下应该用完整的 Spring Security，什么场景不需要？**

A：

**应该用**：
- 服务有直接面向外部用户的 API（需要 JWT / OAuth2 / Session 认证）
- 需要细粒度方法级权限（`@PreAuthorize`、`@Secured`）
- 需要 CSRF 保护（表单提交场景）

**不需要**：
- 服务是纯内网 API，只被其他服务通过共享密钥调用（如本项目的 Core）
- 引入后需要禁用大量默认配置（disable CSRF、disable form login、disable session management）才能正常工作——说明默认配置与需求不符，应该选更轻量的方案

本项目 Core 服务属于后者：BFF 是唯一调用方，通过 `INTERNAL_API_KEY` 鉴权，用 `OncePerRequestFilter` 就足够了。

---

## 五、数据库迁移与 Flyway

**Q12：为什么用 Flyway 做数据库迁移，而不是直接修改表结构？**

A：
- **可追溯**：每次 schema 变更都有版本记录（`flyway_schema_history` 表），可以知道数据库在什么时间、被什么脚本改动过。
- **可重复**：新环境（新开发机、测试环境、生产环境）启动时自动执行所有未运行的迁移，确保 schema 与代码同步。
- **不可逆保护**：生产环境执行过的迁移脚本不允许修改（Flyway 会校验 checksum），需要新的迁移脚本来撤销或修改，防止意外数据丢失。

---

**Q13：`V7__add_password_hash_to_employees.sql` 的命名规则是什么？`V` 和 `__` 的含义是什么？**

A：Flyway 默认命名规则：`V{版本号}__{描述}.sql`。
- `V` — 版本化迁移（Versioned），只执行一次
- `{版本号}` — 可以是整数（`V7`）或点分格式（`V1.2.3`），Flyway 按版本号升序执行
- `__`（双下划线）— 版本号与描述的分隔符
- `{描述}` — 人类可读的说明，用下划线代替空格

还有 `R__` 前缀表示可重复执行的迁移（每次 checksum 变化时重新执行，适合视图、存储过程）。

---

**Q14：如果 `password_hash` 列是 `NOT NULL`，但表里已有旧数据（没有密码的员工行），迁移会报错吗？怎么处理？**

A：会报错，因为 `ALTER TABLE employees ADD COLUMN password_hash VARCHAR NOT NULL` 要求所有现有行都有值，但旧数据没有。正确做法是分两步迁移：

```sql
-- V7__add_password_hash_to_employees.sql
-- Step 1: 先添加可为 NULL 的列
ALTER TABLE employees ADD COLUMN password_hash VARCHAR(60);

-- Step 2: 填充默认值（开发环境用一个固定的 BCrypt 哈希，生产环境用占位符）
UPDATE employees SET password_hash = '$2a$10$placeholder_must_be_changed' WHERE password_hash IS NULL;

-- Step 3: 再改为 NOT NULL
ALTER TABLE employees ALTER COLUMN password_hash SET NOT NULL;
```

---

## 六、Seeder 与环境隔离

**Q15：`@Profile` 注解是如何工作的？激活条件是什么？**

A：`@Profile({"dev","test"})` 告诉 Spring：只有当 active profiles 包含 `dev` 或 `test` 时，才将这个 Bean 注册到容器中。激活方式：
- `application.properties` 中设置 `spring.profiles.active=dev`
- 启动参数 `--spring.profiles.active=dev`
- 环境变量 `SPRING_PROFILES_ACTIVE=dev`

生产环境 `spring.profiles.active=prod`，Seeder Bean 不会被创建，因此不会执行。

---

**Q16：Seeder 用 `ApplicationRunner` 还是 `CommandLineRunner`？有什么区别？**

A：两者都在 Spring 容器完全启动后、应用开始接收请求之前执行。区别：
- `CommandLineRunner.run(String... args)` — 接收原始命令行参数字符串数组
- `ApplicationRunner.run(ApplicationArguments args)` — 接收已解析的 `ApplicationArguments` 对象，可以方便地获取 `--key=value` 形式的参数

对于 Seeder 来说两者都可以，`ApplicationRunner` 更符合 Spring 风格。如果需要多个 Runner 按顺序执行，可以配合 `@Order` 注解。

---

**Q17：Seeder 如何做到幂等性（多次启动不重复插入）？**

A：插入前先查询是否已存在，常见写法：

```java
if (employeeRepository.findByEmail("admin@example.com").isEmpty()) {
    // 插入
}
```

或者利用数据库唯一约束 + `INSERT ... ON CONFLICT DO NOTHING`（PostgreSQL），让数据库保证幂等性而不依赖应用层判断。

---

## 七、内部 API 安全设计

**Q18：`INTERNAL_API_KEY` 应该在哪里存储，怎么传递？**

A：
- **存储**：作为环境变量（`INTERNAL_API_KEY=xxx`）注入到 BFF 和 Core，不硬编码在代码或配置文件中，不提交到 Git。
- **传递**：BFF 调用 Core 时，在 HTTP 请求头中添加 `INTERNAL_API_KEY: {value}`。注意这里用的是自定义 header 名，而不是 `X-Internal-Api-Key`——项目选择直接用环境变量名作为 header 名，减少两者之间的映射认知负担。
- **校验**：Core 的 `OncePerRequestFilter` 读取该 header，与环境变量中的值做**常量时间比较**（`MessageDigest.isEqual()`），避免时序攻击（timing attack）。

---

**Q19：什么是时序攻击（Timing Attack）？在字符串比较中为什么要用常量时间比较？**

A：普通字符串比较（`equals()`）是短路比较，一旦发现不匹配的字符就立即返回 `false`，导致比较时间与"已正确匹配的前缀长度"成正比。攻击者通过统计大量请求的响应时间差异，可以逐字符猜测正确的 key 值。

常量时间比较（如 `MessageDigest.isEqual()`）无论在哪个位置不匹配都会完整遍历整个字节数组，确保比较时间恒定，让攻击者无法从时间差中提取信息。

---

**Q20：除了 `INTERNAL_API_KEY`，还有哪些方式保护内部服务 API？**

A：
1. **网络层隔离**：内部服务只监听私有网络接口（如 Docker 内网），外部完全无法访问——最安全。
2. **mTLS（双向 TLS）**：服务间通信使用客户端证书互认，即使有人截获了流量也无法伪造身份。
3. **Service Mesh（如 Istio）**：在 Kubernetes 环境中，由 Sidecar 代理自动处理服务间的 mTLS 和认证，业务代码无需关心。
4. **JWT 服务账号 Token**：BFF 持有一个服务专用的 JWT（不是用户 JWT），Core 验证签名确认来源。
5. **INTERNAL_API_KEY（本项目方案）**：实现简单，适合中小规模服务；缺点是 key 泄露则需要轮换所有服务配置。

---

**Q20-补充：Render 的"Outbound IP Addresses"是私有网络吗？**

A：不是，这是两个完全不同的概念，容易混淆：

| 概念 | 说明 |
|------|------|
| **出站 IP（Outbound IP）** | 你的服务**向外发起请求**时，对方看到的来源 IP。比如 Core 调用 GitHub API，GitHub 日志里记录的是这个 IP |
| **私有网络（Private Network）** | 服务之间通过内网互通，Core **没有公网入口**，外部根本无法建立连接 |

Render 免费套餐没有私有网络，所有服务都有公网地址，任何人只要知道 URL 就能发请求。`INTERNAL_API_KEY` 此时是唯一的防线。

**Outbound IP 的实际用途**：数据库 IP 白名单。比如你的 PostgreSQL 只允许特定 IP 连接，就把这段 IP 加进白名单，防止其他人的服务连进你的数据库。

**实际项目建议**：
- 开发/测试阶段：用 `INTERNAL_API_KEY` 就够，接受 Core 有公网地址
- 生产阶段：用 Render 付费版 Private Network，或迁移到 AWS/GCP 的 VPC，让 Core 彻底没有公网入口

---

## 八、综合设计题

**Q21：如果未来 Core 服务需要开放给第三方合作伙伴直接调用（不经过 BFF），认证方案需要如何改造？**

A：需要引入完整的认证体系：
1. 为合作伙伴颁发 **API Key + Secret**（类似 AWS 的 Access Key ID + Secret Key），通过 HMAC 签名请求。
2. 或者颁发 **OAuth2 Client Credentials** 流程的 Access Token，Core 作为资源服务器验证 JWT 签名。
3. 同时引入 `spring-boot-starter-security`，配置 `SecurityFilterChain` 区分内部路由（`/internal/**` 用 INTERNAL_API_KEY）和外部路由（`/external/**` 用 JWT/API Key）。

关键设计原则：内部调用路径与外部调用路径必须在认证机制上严格隔离，不能共用同一套鉴权逻辑。

---

**Q22：`POST /internal/auth/verify` 返回的 response body 应该包含什么？不应该包含什么？**

A：

**应该包含**：
```json
{
  "employeeId": 1,
  "email": "admin@example.com",
  "name": "张三",
  "role": "ADMIN",
  "departmentId": 1,
  "status": "ACTIVE"
}
```

**不应该包含**：
- `password_hash` — 哈希值本身不需要返回，泄露后可用于离线暴力破解
- 内部自增 ID 以外的数据库实现细节
- 无关字段（如 `created_at`、`updated_at`），最小化暴露面

BFF 拿到这个响应后，将 `employeeId`、`role` 等信息打包进 JWT payload，后续请求中不再需要查询 Core。

---

## 九、配置安全与 Fail-Fast

**Q23：`INTERNAL_API_KEY` 为什么不设置默认值？启动时如果没有配置会怎样？**

A：不设默认值是主动的安全决策，原因有两点：

1. **防止带默认值上线**：如果默认值是 `dev-secret-key`，开发者很可能忘记在生产环境覆盖，导致所有环境共用同一个 key，攻击者只需读一遍源码就能调用任意 `/internal/**` 接口。
2. **强制显式配置**：没有默认值意味着每个环境必须主动设置，配置行为是可见的、有意识的。

正确做法是在应用启动时就校验，如果 key 未配置则**立即崩溃（fail-fast）**并打印清晰的错误信息：

```java
@Value("${internal.api.key}")  // 不提供 : 默认值
private String internalApiKey;

@PostConstruct
public void validate() {
    if (!StringUtils.hasText(internalApiKey)) {
        throw new IllegalStateException(
            "INTERNAL_API_KEY is not configured. " +
            "Set the environment variable INTERNAL_API_KEY before starting."
        );
    }
}
```

这样服务在启动阶段就报错退出，而不是在第一个请求到来时才发现配置缺失，避免了"部分功能正常、部分功能静默失败"的危险中间状态。

---

**Q24：什么是 Fail-Fast 原则？它在配置校验中为什么重要？**

A：Fail-Fast 是指系统在检测到错误条件时，立即停止运行并给出明确报错，而不是带着错误继续执行、等到更晚的阶段才暴露问题。

在配置校验中的价值：
- **排查成本低**：启动时报错，错误原因直接就是"配置缺失"；运行中报错则可能表现为业务异常，需要反向追踪才能找到根因。
- **环境一致性**：确保每个部署环境（dev/test/prod）都经过完整的配置检查，不会出现"在我机器上能跑"的情况。
- **与 12-Factor App 原则一致**：第三条"在环境变量中存储配置"要求所有配置显式声明，Fail-Fast 是该原则的执行保障。

---

## 十、错误码体系与异常链路透传

**Q25：你们的错误码是如何设计的？为什么按服务前缀区分而不是用 HTTP 状态码？**

A：本项目采用服务前缀 + 四位数字的格式，**全小写**，例如 `core-1001`、`bff-2001`、`tpc-3001`（ThirdPartyConnector）。

HTTP 状态码（401、404、500）只能描述**请求结果的类别**，无法区分：
- 是哪个服务产生的错误
- 同类状态码下的不同业务含义（同样是 400，可能是"密码格式错误"也可能是"邮箱已注册"）

服务前缀码的优势：
- **溯源**：前端看到 `tpc-3001` 立刻知道错误来自 ThirdPartyConnector 的第三方 API 调用
- **业务语义**：每个 code 对应唯一含义，可以在文档里直接查
- **多语言支持**：前端根据 code 映射到对应 locale 的提示文案，和 message 字段解耦

本项目实际使用的 CoreErrorCode：
```
core-1001  INVALID_CREDENTIALS   — 邮箱或密码错误（包含"邮箱不存在"，防枚举）
core-1002  ACCOUNT_DISABLED      — 账号已禁用（HTTP 403）
core-1003  UNAUTHORIZED_CALLER   — 缺少或无效的 INTERNAL_API_KEY（HTTP 401）
core-1010  VALIDATION_FAILED     — 请求参数校验失败（HTTP 400）
core-1099  INTERNAL_ERROR        — 未预期的内部错误（HTTP 500）
```

---

**Q26：下游服务的异常应该如何透传到上游？整条链路是什么样的？**

A：透传原则是：**code 全程透传，message 天然安全（枚举硬编码），stack trace 绝对不出服务边界**。

每个服务维护一个 `ErrorCode` 枚举，所有 message 都是编译时硬编码的字符串常量，无法泄露 SQL、堆栈、内网 IP 等运行时信息：

```java
public enum CoreErrorCode {
    INVALID_CREDENTIALS  ("core-1001", "Invalid credentials"),
    ACCOUNT_DISABLED     ("core-1002", "Account disabled"),
    UNAUTHORIZED_CALLER  ("core-1003", "Missing or invalid API key"),
    VALIDATION_FAILED    ("core-1010", "Request validation failed"),
    INTERNAL_ERROR       ("core-1099", "Unexpected internal error");

    private final String code;
    private final String message;

    CoreErrorCode(String code, String message) {
        this.code = code;
        this.message = message;
    }
}
```

完整透传链路示例（GitHub OAuth 回调失败）：

```
ThirdPartyConnector
  └─ GitHub API 返回 401
  └─ 抛出: ThirdPartyException(TpcErrorCode.GITHUB_TOKEN_EXCHANGE_FAILED)
  └─ GlobalExceptionHandler 拦截，返回:
     { "code": "TPC-2001", "message": "GitHub token exchange failed", "traceId": "abc-123" }

BFF
  └─ 收到上游 4xx/5xx，读取响应体中的 code 和 traceId
  └─ 直接透传给前端（message 已是安全的枚举字符串，无需额外过滤）:
     { "code": "TPC-2001", "message": "GitHub token exchange failed", "traceId": "abc-123" }
  └─ 可选：前端用 code 在 i18n 文件里查本地化文案覆盖 message

前端
  └─ 展示本地化文案（或兜底用 message 原文）
  └─ DevTools 可见: code: "TPC-2001", traceId: "abc-123"（支持人工排查）
```

枚举设计的核心价值：**信息安全问题在编译时解决，而不是依赖运行时过滤**。只要所有异常都通过枚举抛出，`message` 字段天然安全，上游直接透传即可。

关键设计点：
- `code` 保留原始来源，便于溯源
- `message` 来自枚举常量，绝无敏感信息（SQL / 堆栈 / IP 等永远不进入枚举）
- `traceId` 作为独立字段贯穿全链路（见 Q28）

---

**Q26-补充：`traceId` 为什么要作为独立字段，而不是拼进 `message` 字符串？**

A：拼进 message（如 `"GitHub token exchange failed [trace: abc-123]"`）有三个问题：

1. **破坏 i18n**：前端无法直接用 `code` 查 locale 文案替换 message，因为 message 里混入了动态 UUID
2. **日志查询低效**：ELK / Loki 需要用正则才能从字符串中提取 traceId，而结构化字段可以直接索引
3. **职责不清**：message 是面向用户的描述，traceId 是面向运维的元数据，两者语义不同，不应混在同一字段

推荐的统一错误响应结构：

```json
{
  "code": "TPC-2001",
  "message": "GitHub token exchange failed",
  "traceId": "550e8400-e29b-41d4-a716-446655440000"
}
```

前端展示时可以组合：`"操作失败（请求 ID：550e8400，请联系管理员）"` — code 用于 i18n 翻译，traceId 单独展示给用户用于反馈。

---

**Q27：为什么 stack trace 绝对不能出服务边界？**

A：Stack trace 包含大量敏感信息：
- **类名和包路径**：暴露技术栈和内部结构，方便攻击者针对已知框架的 CVE 漏洞
- **数据库 SQL**：ORM 抛出的异常往往包含完整 SQL 语句，暴露表名、字段名、查询条件
- **文件路径**：服务器的目录结构
- **内网 IP 和端口**：微服务内网拓扑

正确做法是每个服务都有全局异常处理器（Spring 的 `@RestControllerAdvice`），捕获所有未处理异常，**只记录到日志（含 traceId），返回给调用方的只有 code + message**。

---

**Q28：`traceId` 怎么在多个服务之间传递？**

A：通过 HTTP 请求头传递，约定为 `X-Trace-Id`：

1. **BFF 收到前端请求时**：如果没有 `X-Trace-Id`，生成一个 UUID，写入当前请求的 MDC（Mapped Diagnostic Context），并在所有出向请求中带上这个 header。
2. **下游服务（Core、ThirdPartyConnector）**：从请求头读取 `X-Trace-Id`，写入 MDC，所有日志自动附带这个 ID，出向请求同样透传。
3. **返回给前端**：BFF 在响应体中包含 `traceId` 字段。

这样一个 traceId 就能在 ELK / Loki 等日志平台中过滤出整条请求链路的所有日志，无论中间跨了多少个服务。

```java
// Spring Boot 示例：MDC 写入
@Component
public class TraceIdFilter extends OncePerRequestFilter {
    @Override
    protected void doFilterInternal(HttpServletRequest req, HttpServletResponse res, FilterChain chain)
            throws ServletException, IOException {
        String traceId = Optional.ofNullable(req.getHeader("X-Trace-Id"))
                .orElse(UUID.randomUUID().toString());
        MDC.put("traceId", traceId);
        res.setHeader("X-Trace-Id", traceId);
        try {
            chain.doFilter(req, res);
        } finally {
            MDC.clear(); // 防止线程池复用时 MDC 污染
        }
    }
}
```

---

**Q29：错误码的数字段如何规划，避免不同团队/模块之间冲突？**

A：按模块划分号段，类似 HTTP 状态码的分层设计：

| 服务 | 前缀 | 号段示例 | 说明 |
|------|------|----------|------|
| Core | `core` | 1001–1099 认证；1100–1199 员工；1200–1299 积分 | 按业务模块划分 |
| BFF | `bff` | 2001–2099 网关级；2100–2199 聚合逻辑 | |
| ThirdPartyConnector | `tpc` | 3001–3099 GitHub；3100–3199 OIDC | 按对接的第三方划分 |
| Shop | `shop` | 4001–4099 商品；4100–4199 订单 | |

每个服务维护一个 `ErrorCode` 枚举或常量文件，新增 code 前先检查号段，保证全局唯一。

---

## 十一、Jackson 序列化陷阱

**Q30：Java 中 `boolean isActive` 字段，JSON 序列化后的 key 是什么？会有什么坑？**

A：这是一个非常容易踩的 Java + Jackson 陷阱。

Java 的命名规范规定：`boolean` 类型的 getter 方法以 `is` 开头，所以 `boolean isActive` 对应的 getter 是 `isActive()`。Jackson 在确定 JSON key 时，会从 getter 方法名中**剥掉 `is` 前缀**，把 `isActive()` 映射为 `"active"`，而不是 `"isActive"`。

```java
private boolean isActive;      // ← 字段名
public boolean isActive() { return isActive; }  // ← getter

// Jackson 序列化结果：
// { "active": true }  ← 不是 "isActive"！
```

**后果**：接口文档写的是 `isActive`，实际返回的是 `active`，前端写了 `data.isActive` 一直拿到 `undefined`，而且单元测试（测的是 Java 对象，不是 JSON）全部绿灯，问题被掩盖。

**修复方式**：用 `@JsonProperty("isActive")` 显式指定 JSON key：

```java
@JsonProperty("isActive")
private boolean isActive;
```

---

**Q31：`@JsonInclude(NON_NULL)` 有什么用？项目里在哪里用到了？**

A：`@JsonInclude(JsonInclude.Include.NON_NULL)` 告诉 Jackson：序列化时跳过所有值为 `null` 的字段，不把它们写进 JSON。

本项目的 `ApiResponse<T>` 用了这个注解：

```java
@JsonInclude(JsonInclude.Include.NON_NULL)
public class ApiResponse<T> {
    private String code;
    private String message;
    private T data;
    private String traceId;  // 只在出错时才有值
}
```

效果：
- 成功响应：`{ "code": "OK", "data": {...} }` — `traceId` 是 null，不出现在 JSON 里
- 错误响应：`{ "code": "core-1001", "message": "...", "traceId": "550e..." }` — `data` 是 null，不出现

不用这个注解的话，成功响应会是 `{ "code": "OK", "data": {...}, "traceId": null }`，多余的 null 字段造成噪音，前端还要判断 `traceId !== null`。

---

**Q32：Spring Boot 4.x 的 Jackson 3 和 Jackson 2.x 的 import 路径有什么不同？**

A：Jackson 3 将包名从 `com.fasterxml.jackson` 改成了 `tools.jackson`。如果项目用 Spring Boot 4.x，所有 Jackson 的 import 都需要用新路径：

```java
// Spring Boot 3.x / Jackson 2.x
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.annotation.JsonInclude;

// Spring Boot 4.x / Jackson 3.x
import tools.jackson.databind.ObjectMapper;
import tools.jackson.annotation.JsonInclude;
```

这个变化很隐蔽，编译器报错是 "cannot find symbol"，如果不了解背景很难定位原因。

---

## 十二、Spring Boot 测试模式

**Q33：`@Valid` 注解不生效，参数校验没有触发，可能是什么原因？**

A：最常见原因是**缺少依赖**。`@Valid`、`@NotBlank`、`@Email` 这些注解来自 Jakarta Bean Validation 规范，需要一个具体实现（Hibernate Validator）才能运行。

`spring-boot-starter-web` **不包含** Bean Validation 实现。需要额外引入：

```xml
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-validation</artifactId>
</dependency>
```

没有这个依赖，`@Valid @RequestBody` 上的 `@NotBlank`、`@Email` 等注解会被完全忽略，传入任何格式的数据都不会报错，就好像注解不存在一样。

---

**Q34：集成测试里如何提前往数据库插入测试数据？`@Sql` 是怎么用的？**

A：Spring Test 提供 `@Sql` 注解，可以在测试前后执行 SQL 脚本：

```java
@SpringBootTest(webEnvironment = WebEnvironment.RANDOM_PORT)
@ActiveProfiles("test")
@Sql(
    scripts = {"/db/seed-roles.sql", "/db/seed-test-employee.sql"},
    executionPhase = Sql.ExecutionPhase.BEFORE_TEST_CLASS  // 整个测试类运行前执行一次
)
class AuthVerifyControllerTest {
    // ...
}
```

SQL 文件放在 `src/test/resources/db/` 目录下，会被自动打包进测试 classpath。

**重要细节**：如果多个测试类共用同一个 Spring 上下文（Spring Test 会缓存上下文），`BEFORE_TEST_CLASS` 的 SQL 可能运行多次。建议使用 `ON CONFLICT DO NOTHING`（PostgreSQL）让插入操作幂等：

```sql
INSERT INTO roles (id, name) VALUES (1, 'ADMIN') ON CONFLICT (id) DO NOTHING;
```

---

**Q35：`MockMvcBuilders.standaloneSetup()` 和 `@AutoConfigureMockMvc` 有什么区别？什么时候用哪个？**

A：

| 维度 | `standaloneSetup()` | `@AutoConfigureMockMvc` |
|------|---------------------|-------------------------|
| 加载范围 | 只加载指定 Controller，轻量 | 加载完整 Spring MVC 配置 |
| 启动速度 | 快（毫秒级） | 慢（需要完整上下文） |
| 过滤器 | 手动 `.addFilters(new XxxFilter())` | 自动注册所有 Filter |
| 异常处理器 | 手动 `.setControllerAdvice(new GlobalExceptionHandler())` | 自动 |
| 适合场景 | 单个 Controller 的业务逻辑测试 | 端到端集成测试（含 Filter、Security 等） |

本项目 `AuthVerifyControllerTest` 用 `standaloneSetup`：测试业务逻辑时不带 Filter（速度快）；需要测试 Filter 行为时，手动 `.addFilters(new InternalApiKeyFilter(...))` 创建独立的 `filteredMockMvc`。

---

**Q36：为什么测试用 BCrypt strength=4，生产用 strength=12，它们能互通吗？**

A：能互通，因为 BCrypt 哈希字符串本身就存储了 cost factor。

```
$2a$04$N9qo8uLO...  ← $04$ 表示这个哈希是用 strength=4 生成的
$2a$12$N9qo8uLO...  ← $12$ 表示用 strength=12
```

`BCryptPasswordEncoder.matches()` 先从存储的哈希里读出 cost factor（这里是 4），然后用 4 轮来对输入密码哈希，最后比较。它**完全不理会** `new BCryptPasswordEncoder(12)` 里的 12。

实际意义：
- 测试里用 strength=4，每次验证约 1ms，测试套件不会因为 BCrypt 哈希变慢
- 生产里 seeder 用 strength=12，插入的哈希值带 `$12$`，登录时也会用 12 轮验证（约 300ms）
- 两套哈希字符串在同一个数据库里和平共存，互不干扰

---

## 十三、Spring 组件注册陷阱

**Q37：`@Component` + `FilterRegistrationBean` 同时存在，会发生什么？**

A：Filter 会被**注册两次**，导致同一个请求触发两次 `doFilterInternal`。

原因：
1. `@Component` 让 Spring Boot 的自动配置检测到这个 Filter Bean，自动将它注册到 `/*`（所有路径）
2. `FilterRegistrationBean` 又注册了一次，限定到 `/internal/*`

`OncePerRequestFilter` 有防重复执行的机制（在 request attribute 里设标志位），但它是根据 Filter 的名字（`getFilterName()`）来判断的。两次注册的名字不同，所以防重机制失效，`doFilterInternal` 真的会跑两次。

**正确做法**：二选一。本项目选择 `FilterRegistrationBean` 方式，让配置集中在一处，Filter 类本身不加 `@Component`：

```java
// FilterConfig.java
@Bean
public FilterRegistrationBean<InternalApiKeyFilter> internalApiKeyFilter(
    ObjectMapper objectMapper,
    @Value("${internal.api-key}") String apiKey) {
  var reg = new FilterRegistrationBean<>(new InternalApiKeyFilter(objectMapper, apiKey));
  reg.addUrlPatterns("/internal/*");
  reg.setOrder(1);
  return reg;
}
```

---

**Q38：`OncePerRequestFilter` 的 `shouldNotFilter()` 方法有什么用？**

A：用来声明"哪些请求这个 Filter 不处理"，是 Spring 提供的惯用写法，比在 `doFilterInternal` 里手动检查 URI 更清晰：

```java
// 推荐写法
@Override
protected boolean shouldNotFilter(HttpServletRequest request) {
    return !request.getRequestURI().startsWith("/internal/");
}

// 不推荐（功能一样，但放错了地方）
@Override
protected void doFilterInternal(...) {
    if (!request.getRequestURI().startsWith("/internal/")) {
        chain.doFilter(request, response);
        return;
    }
    // ... 鉴权逻辑
}
```

配合 `FilterRegistrationBean.addUrlPatterns("/internal/*")`，两者可以只保留其中一个。如果只有 `FilterRegistrationBean` 的 URL 模式限定，Filter 根本不会被调用到非 `/internal/*` 的路径，`shouldNotFilter` 就不必要了。

---

**Q39：什么是用户枚举攻击（User Enumeration）？登录接口如何防御？**

A：攻击者通过登录接口的不同错误提示来判断某个邮箱/账号是否存在。

**有漏洞的设计**：
- 邮箱不存在 → `"该邮箱未注册"` — 攻击者知道这个邮箱没账号
- 密码错误 → `"密码不正确"` — 攻击者知道这个邮箱有账号

有了这个区别，攻击者可以批量验证一批邮箱地址，建立"有效账号列表"，再针对性地暴力破解密码。

**防御**：无论是邮箱不存在还是密码错误，都返回**完全相同的响应**：

```java
// EmployeeAuthService.verify()
Employee employee = repository.findByEmail(email)
    .orElseThrow(() -> new BusinessException(CoreErrorCode.INVALID_CREDENTIALS));
                                         // ↑ 不抛 "EMAIL_NOT_FOUND"

if (!encoder.matches(rawPassword, employee.getPasswordHash())) {
    throw new BusinessException(CoreErrorCode.INVALID_CREDENTIALS);
}                              // ↑ 和上面同一个 code，同一条 message
```

这样攻击者无法从响应中区分"邮箱不存在"和"密码错误"，枚举攻击失效。

注意还要确保两种情况的**响应时间也相近**（否则时序攻击仍可利用）。本项目通过先查 DB 再调 BCrypt 的顺序保证了这一点：邮箱不存在时立即抛异常，没有 BCrypt 运算，响应会更快——这是一个可以优化的细节（可在找不到邮箱时做一次假的 BCrypt 运算来对齐响应时间）。

---

**Q40：`@RestControllerAdvice` 和 `@ControllerAdvice` 有什么区别？**

A：`@RestControllerAdvice` = `@ControllerAdvice` + `@ResponseBody`。

`@ControllerAdvice` 是通用的全局增强注解，适用于 MVC 项目（返回 View）。`@RestControllerAdvice` 在此基础上默认将返回值序列化为 JSON 写入响应体，适合 REST API 项目。

```java
@RestControllerAdvice
public class GlobalExceptionHandler {

    @ExceptionHandler(BusinessException.class)
    public ResponseEntity<ApiResponse<Void>> handleBusiness(BusinessException ex) {
        // 返回 ApiResponse 对象，自动序列化为 JSON
        return ResponseEntity.status(httpStatus)
            .body(ApiResponse.error(ex.getCode(), ex.getMessage(), UUID.randomUUID().toString()));
    }
}
```

不需要在每个方法上加 `@ResponseBody`，也不需要操作 `HttpServletResponse`，代码更简洁。
