# T007 面试考察点 — BFF JWT 登录与认证体系（NestJS）

> 覆盖范围：JWT 原理与生成、HttpOnly Cookie vs Bearer Token、OAuth 2.0 / OIDC 关系、
> NestJS Guard / Decorator 体系、Redis refresh token、Cookie 安全属性、TraceId 链路追踪、
> Connector 模块设计、ValidationPipe、全局异常过滤器

---

## 一、JWT 基础

**Q1：JWT 是什么？它的结构是怎样的？**

A：JWT（JSON Web Token）是一种紧凑的自包含令牌格式，由三段 Base64URL 编码的字符串组成，用 `.` 分隔：

```
Header.Payload.Signature
```

- **Header**：声明算法和令牌类型，如 `{ "alg": "HS256", "typ": "JWT" }`
- **Payload**：存放声明（claims），如 `{ "sub": 1, "email": "...", "roles": [...], "exp": ... }`
- **Signature**：`HMACSHA256(base64(Header) + "." + base64(Payload), secret)`

Header 和 Payload 只是 Base64 编码，**任何人都能解码看到内容**，不能存放密码等敏感信息。Signature 才是安全保证——没有 secret 就无法伪造有效签名。

---

**Q2：JWT 怎么防止被篡改？**

A：攻击者改了 Payload（比如把 `roles` 从 `["employee"]` 改成 `["admin"]`），但没有服务端的 `JWT_SECRET`，就算不出正确的 Signature。服务端验证时重新计算签名，与 token 里的签名对比，不一致就拒绝。所以篡改 Payload 必然导致签名不匹配，token 失效。

---

**Q3：JWT Payload 里放什么字段？为什么不能放密码？**

A：本项目放 `{ sub: userId, email, roles, iat, exp }`。`sub`（subject）是用户唯一标识，`iat` 是签发时间，`exp` 是过期时间。

不能放密码的原因：Payload 只是 Base64 编码，不是加密，任何人拿到 token 都能解码看到 Payload 的全部内容。

---

**Q4：项目里有两个 secret（`JWT_SECRET` 和 `JWT_REFRESH_SECRET`），为什么要分开？**

A：两种 token 的生命周期和使用频率差异很大——`access_token` 15 分钟，高频验证；`refresh_token` 7 天，只在刷新时用一次。

如果共用一个 secret，`refresh_token` 被盗后可以直接当 `access_token` 使用（它本质上也是一个有效的 JWT）。分开之后，即使 `JWT_SECRET` 泄露，攻击者也无法伪造 `refresh_token`，两个密钥互相隔离风险。

---

**Q5：JWT 是无状态的，那怎么实现"立即吊销"某个用户的令牌？**

A：`access_token` 签发后无法撤销（这是无状态的代价），只能等它自然过期。因此 `access_token` 设计为短期（15 分钟）以降低风险。

`refresh_token` 存在 Redis 里（`refresh:{userId}`），删除这个 key 就相当于吊销——下次 refresh 时服务端查 Redis 找不到 key，拒绝续期，用户在 15 分钟内最多还能用现有的 `access_token`，之后强制重登录。这是"准实时"吊销的常见方案。

---

## 二、Token 存储与安全

**Q6：为什么 access_token 存在 HttpOnly Cookie 里，而不是 localStorage 或 Zustand？**

A：核心原因是 **XSS（跨站脚本）攻击**：

| 存放位置 | JS 能否读取 | XSS 能偷走吗 |
|----------|------------|-------------|
| localStorage / Zustand | ✅ | ✅ 危险 |
| HttpOnly Cookie | ❌ | ❌ 安全 |

`HttpOnly` 标志让浏览器拒绝 JavaScript 读取该 Cookie（`document.cookie` 看不见），所以即使页面被注入恶意脚本，也无法获取 token。

Zustand 里只存展示用的用户信息（`{ id, name, roles }`），丢了也不影响安全。

---

**Q7：HttpOnly Cookie 如果前端 JS 读不到，那如何发送给后端？**

A：浏览器的同域请求会**自动携带 Cookie**，不需要前端做任何事。`axios.get('/api/points/balance')` 发出时，浏览器自动在请求头里附上 `Cookie: access_token=...`，服务端从 `request.cookies` 里读取即可。这也是 T010 说"no manual token storage needed"的原因。

---

**Q8：Cookie 的 `Secure` 属性是什么？为什么开发环境要关闭它？**

A：`Secure` 属性让浏览器只在 **HTTPS** 连接上发送该 Cookie，HTTP 请求会自动忽略它。

生产环境（Render）是 HTTPS，必须开启；本地开发通常是 `http://localhost`，如果设置了 `Secure`，浏览器不会发送 Cookie，登录后每个请求都会被 AuthGuard 拒绝。因此本项目用 `NODE_ENV === 'production'` 来动态控制 `secure` 属性。这不是安全妥协，是环境配置的必要区分。

---

**Q9：Cookie 的 `SameSite=Strict` 是什么，有什么作用？**

A：`SameSite` 控制跨站请求是否携带 Cookie。`Strict` 表示只有**完全同站**的请求才会带上 Cookie，第三方站点发起的请求（包括表单提交、链接跳转）都不会携带。这是防范 **CSRF（跨站请求伪造）** 攻击的现代方案，比传统的 CSRF Token 更简洁。

---

**Q10：Bearer Token 方案和 Cookie 方案各自适合什么场景？**

A：

| 方案 | 适合场景 |
|------|----------|
| HttpOnly Cookie | 浏览器 Web 应用、前后端同域、无 App |
| Bearer header | 移动 App、服务器间调用、开放 API、跨域场景 |

Bearer Token 需要前端手动读取并注入 `Authorization` 头，适合无浏览器 Cookie 机制的客户端（原生 App）或跨域 API。Cookie 方案浏览器自动处理，更适合传统 Web 应用。两者不存在"更好"，只有"更合适"。

---

## 三、JWT vs OAuth 2.0 vs OIDC

**Q11：JWT、OAuth 2.0、OpenID Connect 分别是什么？它们有什么关系？**

A：三个完全不同层面的概念：

- **JWT**：一种 Token **格式**（如何表示和验证身份信息）
- **OAuth 2.0**：一种**授权协议**（第三方应用如何获得访问权限）
- **OpenID Connect (OIDC)**：在 OAuth 2.0 之上的**身份认证层**（如何知道"你是谁"）

关系类比：OAuth 2.0 是"快递流程规范"，JWT 是"快递单格式"——流程规定了怎么寄收，快递单只是信息载体。OAuth 2.0 本身不规定 token 格式，实际上很多 OAuth 实现用 JWT 来表示 access_token。

---

**Q12：OAuth 2.0 解决什么问题？它和登录有什么区别？**

A：OAuth 2.0 解决**授权**问题——"允许第三方应用代表用户访问某些资源"，经典场景是"用 GitHub 登录某网站"。

但 OAuth 2.0 本身不做身份认证，网站拿到 access_token 只知道"可以调 GitHub API"，不知道"这个人是谁"。OIDC 在此基础上加了 `id_token`，专门描述用户身份（`sub, email, name`），id_token 通常就是 JWT 格式。

本项目 T007 是自建认证（email+password → 自签 JWT），T012/T013 是 GitHub OAuth，T097/T098 是 OIDC。三种方式最终都汇聚到 BFF 签发统一格式的 JWT。

---

## 四、NestJS 认证体系

**Q13：NestJS 的 Guard 是什么？它在请求生命周期中处于哪个位置？**

A：Guard 是 NestJS 的守卫，实现 `CanActivate` 接口，决定请求是否能继续执行。它在**中间件之后、拦截器之前**运行，最适合做认证鉴权。

请求生命周期：`Middleware → Guard → Interceptor → Pipe → Handler → Interceptor (after) → Response`

`JwtAuthGuard` 读取 Cookie 中的 `access_token`，验证 JWT 签名和过期时间，通过则将解码后的 payload 附加到 `request.user`，失败则抛出 `UnauthorizedException`。

---

**Q14：`APP_GUARD` 如何实现全局守卫？为什么比 `useGlobalGuards` 更好？**

A：

```ts
// app.module.ts
providers: [{ provide: APP_GUARD, useClass: JwtAuthGuard }]
```

`APP_GUARD` 是 NestJS DI 容器管理的全局守卫，好处是 `JwtAuthGuard` 本身可以通过构造函数注入其他服务（`JwtService`、`ConfigService`、`Reflector`）。

而 `useGlobalGuards()` 在 DI 容器外注册，Guard 实例无法获得注入的依赖，只能手动 `new`，不适合有复杂依赖的守卫。

---

**Q15：`@Public()` 装饰器是如何实现的？Guard 如何识别它？**

A：

```ts
// 装饰器
export const Public = () => SetMetadata('isPublic', true);

// Guard 中
const isPublic = this.reflector.getAllAndOverride<boolean>('isPublic', [
  context.getHandler(),  // 方法级元数据
  context.getClass(),    // 类级元数据
]);
if (isPublic) return true;
```

`SetMetadata` 把键值对附加到路由处理器的元数据上，`Reflector` 在运行时读取。`getAllAndOverride` 优先取方法级，方法级没有就取类级，任意一级标记为 `true` 就跳过认证。

---

**Q16：NestJS 的 `ValidationPipe` 是做什么的？`whitelist` 和 `forbidNonWhitelisted` 有什么区别？**

A：`ValidationPipe` 结合 `class-validator` 装饰器自动验证和转换请求体。

- `whitelist: true`：自动**剥除** DTO 类里没有声明的字段（请求带了多余字段，直接过滤掉，不报错）
- `forbidNonWhitelisted: true`：遇到多余字段时**直接返回 400**（更严格，防止意外字段被传入服务层）

两者搭配使用能有效防止过度传参（over-posting）攻击。

---

**Q17：`GlobalExceptionFilter` 的作用是什么？为什么不直接让 NestJS 的默认错误处理？**

A：默认的 NestJS 异常响应格式是 `{ statusCode, message, error }`，和业务需要的 `{ code, message, data, traceId }` 格式不同。`GlobalExceptionFilter` 统一接管所有异常：

1. `HttpException` 子类：读取附加的 `bffCode`、`traceId` 属性，组装统一格式
2. 未知异常（数据库崩溃等）：降级为 `bff-9999`，不暴露内部细节
3. 保证所有错误响应格式一致，前端只需处理一种 envelope

---

## 五、Redis 与 refresh token

**Q18：refresh token 为什么存 Redis，而不是存数据库？**

A：refresh token 的操作模式是：验证是否存在 + 写入 + 删除，全是 key-value 操作，不需要复杂查询。Redis 的优势：

1. **TTL 原生支持**：设置 7 天过期，到期自动清除，不需要定时清理任务
2. **速度快**：内存操作，毫秒级响应，不增加数据库压力
3. **原子操作**：`DEL` 操作原子执行，logout 时能可靠删除

如果存数据库，需要额外维护过期清理 job，且每次 refresh 都要查表，性能不如 Redis。

---

**Q19：Redis key 为什么设计成 `refresh:{userId}` 而不是 `refresh:{token}`？**

A：以 userId 为 key 的好处：

1. **单设备强制下线**：直接 `DEL refresh:{userId}`，该用户所有会话立即失效，不管他在几台设备上登录
2. **防止多 token 堆积**：每次登录覆盖写入，自动替换旧 token，不会无限累积

如果用 token 本身做 key，每次登录生成新 key，无法批量撤销同一用户的所有 token（需要遍历），也更难实现"踢下线"功能。

---

## 六、服务间调用设计

**Q20：Connector 模块是什么设计模式？为什么按服务拆分而不是全放一起？**

A：Connector 模块是**防腐层（Anti-Corruption Layer）**模式的实践。每个下游服务有独立的 Connector 模块：

```
src/connectors/
  core/    → 只调 CORE_SERVICE_URL
  shop/    → 只调 SHOP_SERVICE_URL（T017+ 添加）
  data/    → 只调 DATA_SERVICE_URL（T028+ 添加）
```

好处：
1. **可读性**：看到注入的是 `CoreConnectorService`，立即知道这个方法调的是 Core
2. **单一职责**：每个 Connector 只持有一个 baseURL，方法名语义化（`verifyCredentials`），URL 细节封装在内部
3. **易测试**：mock 单个 Connector 而不是整个 HttpService

---

**Q21：为什么 Core 的内部 API 路径设计为 `/internal/auth/verify` 而不是 `/core/internal/auth/verify`？**

A：因为每个服务已经有独立的 baseURL（`CORE_SERVICE_URL=http://core:8080`），服务身份由 base URL 决定，路径只描述资源和动作，不需要重复服务名。在路径里加 `/core/` 会造成信息冗余（`http://core:8080/core/internal/...`，`core` 出现两次）。

---

**Q22：`X-Trace-Id` 为什么要从 BFF 透传到 Core？**

A：在微服务架构中，一个用户请求往往跨越多个服务。如果每个服务各自生成日志 ID，出问题时很难把跨服务的日志串联起来。`X-Trace-Id` 在 BFF 层生成（或从客户端透传），并随请求传递给所有下游服务。Core 把同一个 traceId 记录到自己的日志里，排查 BFF 报错时，用这个 ID 在 Render 的 Core 日志里就能找到对应的 Core 操作记录。这是分布式链路追踪的简化版本（完整方案会用 OpenTelemetry + Jaeger）。

---

## 七、NestJS 模块化设计

**Q23：`@Global()` 装饰器的作用是什么？什么时候应该使用它？**

A：`@Global()` 让模块在整个应用中只注册一次，其导出的 provider 在任何其他模块中都可以直接注入，不需要在每个用到的模块里重复 `imports: [RedisModule]`。

适用场景：整个应用都会用到的基础设施（Redis、数据库连接、日志服务、配置服务）。`ConfigModule.forRoot({ isGlobal: true })` 本质上也是这个原理。

滥用 `@Global()` 会让模块依赖变得隐式，不易维护，只对真正的"全局单例"使用。

---

**Q24：`APP_FILTER` 和 `APP_GUARD` 都是通过 DI 注册的，这和直接调 `useGlobalFilters()`/`useGlobalGuards()` 有什么本质区别？**

A：

| 注册方式 | DI 支持 | 作用范围 |
|----------|---------|----------|
| `APP_GUARD` / `APP_FILTER` | ✅ 可注入依赖 | 全局 |
| `useGlobalGuards()` | ❌ 手动 `new` | 全局 |

`useGlobalGuards(new JwtAuthGuard(...))` 要手动 `new` 并传入依赖，一旦依赖变多就很麻烦。`APP_GUARD` 让 NestJS 的 DI 容器管理实例生命周期，构造函数依赖自动注入，是更 NestJS 化的写法。

---

**Q25：`HttpModule.registerAsync()` 和 `HttpModule.register()` 有什么区别？**

A：

- `register()`：直接传入静态配置对象，不能读取 `ConfigService`
- `registerAsync()`：通过工厂函数异步获取配置，工厂函数可以注入 `ConfigService` 等依赖

本项目 `CoreConnectorModule` 用 `registerAsync` 从 env 读取 `CORE_SERVICE_URL`，确保不同环境（dev/test/prod）使用不同的 baseURL，而不是硬编码。

---

## 八、其他工程实践

**Q26：为什么用 `crypto.randomUUID()` 而不是 `uuid` npm 包？**

A：`uuid` v14 是纯 ESM 模块，与 Jest（CommonJS 模式）存在兼容性问题，需要额外配置 `moduleNameMapper` 或 `transformIgnorePatterns`，增加配置复杂度。

Node.js 从 v14.17 开始内置了 `crypto.randomUUID()`，生成标准 UUID v4，零依赖、零配置、无兼容问题。对于只需要生成随机 UUID 的场景，直接用内置方法是最简洁的选择。

---

**Q27：BFF 的 `POST /auth/login` 为什么把验证逻辑放在 Core 而不是 BFF 直接访问数据库？**

A：这是**职责分离**原则。BFF（Backend For Frontend）的职责是：聚合数据、适配前端、管理会话（JWT）。它不应该了解密码验证的具体实现（BCrypt、数据库结构）。

Core 服务拥有员工数据，它是验证凭证的权威来源。如果 BFF 直连数据库验证密码，就形成了"两个服务访问同一张表"的问题，破坏了服务边界，后期迁移数据库或修改密码方案都要改多个服务。

---

**Q28：如何防止 `password` 字段出现在日志里？**

A：本项目通过以下方式保证：

1. `LoginDto` 只在传输层使用，不序列化到日志
2. `AuthService.login()` 接收 email 和 password 参数后，立即调用 `CoreConnectorService`，不在 Logger 输出中包含 password 参数
3. `CoreConnectorService` 只记录 `verifyCredentials failed status=... traceId=...`，不记录请求体

在更严格的生产环境中，可以在 `LoginDto` 的 `password` 字段上加 `@Exclude()` 或自定义序列化，确保即使框架层面做了日志拦截也不会泄露。
