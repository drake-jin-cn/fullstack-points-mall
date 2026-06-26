# T008 + T015 面试考察点 — Token 生命周期、刷新/登出、多语言 JWT 中间件

> 覆盖范围：Token 刷新机制、登出实现、jwtService.decode vs verify、
> Redis 作为服务端 session 的作用、BFF 架构下的服务间认证、
> JWT 加在哪一层、多语言/框架 JWT 中间件实现对比、
> 横切关注点分离、WebFlux WebFilter、Spring Boot 测试模式

---

## 一、Token 刷新机制（T008）

**Q1：为什么需要 refresh token？只用 access token 不行吗？**

A：access token 为了安全必须短命（15分钟）。用户不可能每 15 分钟重新登录一次，所以需要一个长命的 refresh token（7天）来静默续签。

| | access token | refresh token |
|---|---|---|
| 存储位置 | HttpOnly Cookie | Redis（服务端） |
| 有效期 | 15 min | 7 days |
| 作用 | 证明身份，访问受保护接口 | 换取新的 access token |
| 泄露影响 | 最多 15 分钟 | 可服务端主动吊销 |

---

**Q2：POST /auth/refresh 的完整流程是什么？**

A：
```
1. 从 Cookie 读取 access_token（可能已过期）
2. jwtService.decode() 解码（不验签名，不检查过期时间）
3. 从 payload 取出 sub（userId）
4. 查 Redis：EXISTS refresh:{userId}
5. 不存在 → 401 bff-2004（session 过期，请重新登录）
6. 存在 → jwtService.sign({ sub, email, roles }) 生成新 access_token
7. Set-Cookie: access_token=新token; HttpOnly; Secure; SameSite=Strict
8. 返回 200 { code:'OK', data:{ user:{ id, email, roles } } }
```

注意：Redis 的 refresh key TTL 不在 /auth/refresh 时续期（不刷新 refresh token 本身）。

---

**Q3：为什么 refresh 时用 jwtService.decode() 而不是 jwtService.verify()？**

A：verify() 会检查 expiration（exp claim）。access token 过期后 verify() 会抛异常，流程就断了。
而 refresh 的场景恰恰是 token **已经过期**，用户来换新的。所以必须用 decode()——它只解析 payload，不做任何验证。

```typescript
// verify()：验证签名 + 检查 exp → 过期 token 会抛 TokenExpiredError
jwtService.verify(token)

// decode()：只解析 payload，跳过所有验证
jwtService.decode(token)  // 返回 payload 或 null（malformed 时）
```

---

**Q4：decode() 返回 null 是什么情况？代码里怎么处理的？**

A：token 格式完全不对（不是三段 xxx.yyy.zzz 结构）时，decode() 返回 null。
实现里的处理：

```typescript
const payload = this.jwtService.decode(token);
if (!payload || typeof payload.sub !== 'number') {
  throw new UnauthorizedException({ code: 'bff-2003', message: 'Invalid token' });
}
```

两个检查：① payload 不为 null；② sub 是数字（防御性校验，确保是我们签发的 token）。

---

**Q5：POST /auth/refresh 为什么要加 @Public 装饰器？**

A：因为全局 JwtAuthGuard 会拦截所有路由并验证 access token。用户来刷新时，access token 已经过期，Guard 必然会拒绝——形成死循环。@Public 是一个自定义元数据标记，告诉 Guard "这个路由跳过验证"。

---

**Q6：POST /auth/logout 做了哪两件事？顺序重要吗？**

A：
1. `redis.del('refresh:{userId}')` — 服务端吊销 refresh token
2. `res.clearCookie('access_token', { path: '/' })` — 清除客户端 Cookie

顺序不严格，但先删 Redis 更安全——即使清 Cookie 失败（极端情况），服务端也已经失效了 refresh token，用那个 access token 过期后就无法续签。

---

**Q7：logout 之后用户再调 /auth/refresh 会发生什么？**

A：Redis 里的 `refresh:{userId}` 已被删除，第4步查询返回 0，走到 `bff-2004 Session expired` 分支，返回 401。即使用户还保留着旧的（未过期的）access token，最多能用到它自然过期（15分钟内），之后无法续签，相当于强制下线。

---

**Q8：这种 refresh token 方案是"有状态"还是"无状态"？**

A：**有状态的**。虽然 access token 是无状态 JWT，但 refresh 的有效性依赖 Redis 里的 key，这就是服务端状态。好处是可以主动吊销（logout 立刻生效），缺点是多实例部署时需要共享 Redis。纯无状态的方案（只靠 JWT 过期时间）无法做主动吊销。

---

## 二、服务间认证架构

**Q9：这个项目有哪几种服务间认证方式？分别用在哪？**

A：两种：

| 方式 | 用在哪 | 原理 |
|------|--------|------|
| INTERNAL_API_KEY | BFF → Core | 固定 header `X-Internal-API-Key`，服务端比对 |
| Bearer JWT | BFF → Shop/Message/Data/TPC | Authorization header，各服务独立验签 |

Core 单独用 API Key，原因是 Core 的 `/internal/auth/verify` 是登录流程中**生成 JWT 之前**调用的接口，此时用户还没有 JWT，不可能用 JWT 保护。这叫**混合认证（Mixed Authentication）**。

---

**Q10：所有下游服务都只能从 BFF 调用，为什么还要在下游加 JWT 验证？**

A：这是**纵深防御（Defense in Depth）**。即使 BFF 是唯一入口，内网里也可能有：
- 配置错误导致服务直接暴露
- 内网渗透（其他服务被攻击后横向移动）
- 运维误操作直接调用内部接口

每一层都独立验证，即使某层被绕过，下一层还能拦截。代价是每个服务都需要 JWT_SECRET，增加了耦合，但安全收益值得。

---

**Q11：下游服务需要知道"是哪个用户"吗？怎么获得 userId？**

A：取决于业务。积分商城中，订单、积分记录都是用户维度的数据，下游需要 userId 做数据隔离。

有两种传递方式：
- **方案 A（本项目）**：BFF 把用户 JWT 通过 `Authorization: Bearer` 转发给下游，下游 decode 后取 sub
- **方案 B**：BFF 解析 JWT 后，用 `X-User-Id: 123` header + `X-Internal-Key` 传给下游，下游只读 header

方案 A 下游自治，方案 B 下游更简单（不需要 JWT 库）。本项目用方案 A。

---

## 三、JWT 中间件实现对比

**Q12：同样是 JWT 验证，为什么不同服务叫法不同？**

A：概念完全相同，框架叫法不同：

| 服务 | 框架 | 叫法 | 核心接口/机制 |
|------|------|------|--------------|
| BFF | NestJS | Guard | `CanActivate` interface |
| Shop | Laravel | Middleware | `handle(Request, Closure)` |
| Message | Express | Middleware | `(req, res, next) => void` |
| Data | FastAPI | Dependency | `Depends(verify_token)` |
| TPC | Spring WebFlux | WebFilter | `WebFilter` interface，响应式 |

它们都在"请求到达业务逻辑之前"完成认证，属于**横切关注点（Cross-cutting Concern）**。

---

**Q13：JWT 加在哪一层？**

A：**框架的请求管道层（业务层之前）**。具体说：

```
HTTP 请求
    ↓
[网络层] TCP/IP, Nginx
    ↓
[框架基础设施层] ← JWT 验证在这里
  NestJS: Guard
  Laravel/Express: Middleware
  FastAPI: Dependency Injection
  Spring WebFlux: WebFilter
    ↓
[路由层] Controller/Router
    ↓
[业务逻辑层] Service
    ↓
[数据访问层] Repository/ORM
```

业务代码只读 request context 里的 `userId`，不关心验证过程。这叫**关注点分离（Separation of Concerns）**。

---

**Q14：FastAPI 的 Depends() 和其他框架的 Middleware 有什么不同？**

A：最大区别是**粒度**：
- Middleware 是全局的（加在 app 级别，所有路由都走）
- `Depends()` 是路由级的（在需要保护的路由函数参数里声明）

FastAPI 更灵活，可以只给部分路由加依赖：

```python
@app.get("/health")                        # 无 Depends → 不需要 token
async def health(): ...

@app.get("/data", dependencies=[Depends(verify_token)])  # 有 Depends → 需要 token
async def get_data(): ...
```

Laravel/Express 是全局 Middleware，再用 `withoutMiddleware()` 或提前注册 `/health` 来排除特定路由。

---

**Q15：Spring WebFlux 的 WebFilter 和普通 Spring MVC 的 Filter 有什么区别？**

A：本质一样（拦截请求），实现模型不同：

| | Spring MVC Filter | Spring WebFlux WebFilter |
|--|--|--|
| 线程模型 | 阻塞 I/O，每个请求一个线程 | 非阻塞 I/O，少量线程处理所有请求 |
| 返回值 | `void` | `Mono<Void>`（响应式） |
| 请求对象 | `HttpServletRequest` | `ServerWebExchange` |
| 服务器 | Tomcat/Jetty | Netty |

WebFlux 适合 TPC（需要大量调用外部 API，I/O 密集），Netty 的事件循环模型比 Tomcat 线程池更高效。

---

**Q16：/health 为什么要排除在 JWT 验证之外？**

A：健康检查由 **运维基础设施**（Kubernetes liveness probe、负载均衡器、docker-compose healthcheck）调用，不是用户发起的请求，没有用户 JWT。如果 /health 也要验证 JWT：
- 容器编排系统认为服务不健康，触发重启
- 监控系统报警
- 负载均衡器把服务从池里摘除

所以 /health 是约定俗成的"免认证"端点。

---

## 四、错误码设计

**Q17：为什么要有 bff-2003 和 bff-2004 两个错误码，用一个 401 不行吗？**

A：都是 401，但原因不同，前端需要区分：
- `bff-2003`（token 解析失败）：token 本身坏了，刷新也没用，需要重新登录
- `bff-2004`（session 已过期）：Redis 里的 refresh key 不存在，通常是主动登出或过期，需要重新登录

如果只返回 401，前端无法判断是"token 格式错误"还是"session 过期"，提示信息和处理逻辑都不同。

---

**Q18：下游服务的错误码（shop-4001、msg-5001 等）是怎么设计的？**

A：按服务前缀 + 错误类型编号：

| 服务 | 错误码 | 含义 |
|------|--------|------|
| BFF | bff-2003 | token 无效 |
| BFF | bff-2004 | session 过期 |
| Shop | shop-4001 | 未授权 |
| Message | msg-5001 | 未授权 |
| Data | data-6001 | 未授权 |
| TPC | tpc-7001 | 未授权 |

统一格式 `{ code, message, data }` 让前端处理标准化，不需要针对每个服务写不同的错误解析逻辑。

---

## 五、测试策略

**Q19：这次测试覆盖了哪些场景？为什么要测"invalid signature"和"expired"两个分支？**

A：每个服务都覆盖：
1. 有效 token → 通过
2. 无 Authorization header → 401
3. token 签名错误（wrong key）→ 401
4. token 已过期 → 401
5. token 格式错误（malformed）→ 401
6. /health 无 token → 200

"invalid signature"和"expired"是**两种不同的 JwtException 子类**，需要分开测证代码里的 catch 块确实捕获了这两种情况，而不是只测了其中一种。

---

**Q20：BFF 测试和下游服务测试有什么不同？**

A：
- **BFF（NestJS）**：Jest 单元测试，用 mock 替换 JwtService、RedisService，测试 service 方法的逻辑。速度快，不启动真实服务器。
- **Shop（Laravel）**：PHPUnit 单元测试，不启动完整 Laravel 应用（避免 IoC 容器依赖），用 `new JsonResponse()` 代替 `response()->json()`。
- **Message（Express）**：Vitest，mock `jsonwebtoken.verify`，单元测试中间件函数。
- **Data（FastAPI）**：pytest + httpx，集成测试，启动真实 FastAPI 应用。
- **TPC（Spring WebFlux）**：JUnit 集成测试，`WebEnvironment.RANDOM_PORT` 启动真实 Netty 服务器，用 `WebTestClient` 发真实 HTTP 请求。

越靠近业务逻辑用 mock（快），越接近框架行为用集成测试（准）。

---

## 六、坑和注意事项

**Q21：PHP 的 firebase/php-jwt 有什么限制？**

A：v7 版本要求 HMAC 密钥长度 **≥ 32 字节**，短于此长度会抛异常。测试时要确保 JWT_SECRET 够长（"dev-insecure-secret-at-least-32-chars!!" 是 40 个字符）。

---

**Q22：PyJWT 验证 sub claim 时有什么坑？**

A：PyJWT 2.x 默认要求 sub 是字符串。但 BFF（NestJS）签发 JWT 时 sub 是数字（`{ sub: number }`）。解决方案：

```python
payload = jwt.decode(
    token, secret, algorithms=["HS256"],
    options={"verify_sub": False}   # 跳过 sub 类型检查
)
```

如果不加这个选项，所有请求都会报 `InvalidSubjectError`，即使 token 完全有效。

---

**Q23：Node.js 的 vitest 有什么版本兼容性问题？**

A：vitest v4.x 在 macOS arm64 上有 native binding 问题（rolldown 的 `@rolldown/binding-darwin-arm64` 缺失），会报 `UnsatisfiedLinkError`。需要降级到 vitest@2（v2.1.9 可用）。这是工具链问题，不是代码问题。

---

**Q24：Spring Boot 4.x 的 WebTestClient 怎么注入？**

A：Spring Boot 4.x 中 `@AutoConfigureWebTestClient` 被移除了。正确做法：

```java
// ❌ 旧方式（Spring Boot 3.x，4.x 不可用）
@Autowired
private WebTestClient webTestClient;

// ✅ 新方式（Spring Boot 4.x）
@SpringBootTest(webEnvironment = WebEnvironment.RANDOM_PORT)
class MyTest {
    @LocalServerPort private int port;
    private WebTestClient webTestClient;

    @BeforeEach
    void setUp() {
        webTestClient = WebTestClient.bindToServer()
            .baseUrl("http://localhost:" + port).build();
    }
}
```

---

## 七、架构大图（串起来）

**Q25：从用户登录到访问受保护接口，完整的 token 流转是怎样的？**

A：

```
[登录]
前端 POST /auth/login { email, password }
  → BFF 验证 → 调 Core /internal/auth/verify (INTERNAL_API_KEY)
  → Core bcrypt 验证密码 → 返回用户信息
  → BFF 签发 access_token (JWT, 15min) → Set-Cookie
  → BFF 存 Redis: SET refresh:{userId} "1" EX 604800
  → 返回 200

[访问受保护接口]
前端 GET /orders (带 Cookie: access_token=xxx)
  → BFF JwtAuthGuard 验证 token → 放行
  → BFF 调 Shop GET /api/orders (Authorization: Bearer xxx)
  → Shop JwtAuthMiddleware 验证 → 放行
  → 返回数据

[access_token 过期，静默刷新]
前端 POST /auth/refresh (带过期的 Cookie)
  → BFF decode() 不验过期 → 取 sub
  → Redis EXISTS refresh:{userId} → true
  → 签发新 access_token → Set-Cookie
  → 返回 200

[登出]
前端 POST /auth/logout (带 Cookie)
  → BFF JwtAuthGuard 验证 → 放行
  → Redis DEL refresh:{userId}
  → clearCookie('access_token')
  → 返回 200
```

---

**Q26：为什么 Core 不需要 JWT 验证，而其他服务需要？**

A：因为 Core 的职责是**创建 JWT**（验证密码后签发），不是**消费 JWT**。

流程是：BFF → Core → （Core 验密码返回用户信息）→ BFF 签发 JWT。Core 在 JWT 存在之前就被调用了，天然无法用 JWT 保护自己，只能用另一套机制（INTERNAL_API_KEY）。

这是架构上"循环依赖"的经典解法：认证系统的源头不能被它自己所认证。

---

**Q27：什么是横切关注点（Cross-cutting Concern）？JWT 是例子吗？**

A：横切关注点是指和业务逻辑无关、但每个模块都需要的功能——比如认证、日志、监控、事务管理。它们"横切"了所有业务模块。

JWT 中间件是典型例子：Shop 的订单逻辑不关心"怎么验 token"，它只需要知道"请求已验证，userId 是 42"。把验证逻辑从业务里剥离出来放到中间件/Guard，就是横切关注点分离。好处：
- 业务代码更纯粹
- 认证逻辑改了只改一处
- 更容易测试（可以单独测中间件，也可以单独测业务）

---

**Q28：HS256 和 RS256 有什么区别？什么时候该升级到 RS256？**

A：

| | HS256 | RS256 |
|--|--|--|
| 算法 | 对称 HMAC（共享密钥） | 非对称 RSA（公私钥对） |
| 签名 | `HMAC(payload, secret)` | `RSA_sign(payload, private_key)` |
| 验证 | 需要 secret | 只需 public_key |
| 密钥分发 | 所有服务都要有 secret | private_key 只有签发方，public_key 可公开 |
| 适用 | 内部服务，少数可信节点 | 多租户、第三方需要验证 token |

本项目用 HS256 是合理的（所有服务都在同一私有网络，JWT_SECRET 通过环境变量统一管理）。当有第三方平台需要验证我们签发的 JWT 时，才需要升级到 RS256——把 public key 发布出去，第三方自己验签，不需要共享 secret。
