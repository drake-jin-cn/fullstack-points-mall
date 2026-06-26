# 部署排错 Q&A — Render 生产环境

> 记录 points-mall 首次部署到 Render 时遇到的真实问题与解决过程。
> 涵盖：静态导出、服务间认证、CORS 跨域。

---

## Q1：前端部署报错 "Publish directory ./out does not exist"

**现象**
```
○  (Static)  prerendered as static content
==> Publish directory ./out does not exist!
==> Build failed 😞
```

**原因**

Render 将前端配置为 **Static Site** 类型，期望构建产物在 `./out` 目录。但 Next.js 默认不生成该目录，必须显式开启静态导出模式。

**解决**

在 `points-mall-frontend/next.config.ts` 中加入 `output: 'export'`：

```ts
const nextConfig: NextConfig = {
  output: 'export',   // ← 新增
  turbopack: {
    root: path.resolve(__dirname),
  },
}
```

`next build` 之后会生成 `./out` 目录，Render Static Site 即可正常部署。

**注意事项**

- 静态导出会禁用 Next.js Middleware、API Routes、Server Actions 等服务端特性。
- 本项目前端为纯客户端渲染（所有数据请求走 BFF），无服务端依赖，可安全使用。
- 若日后需要 SSR，改用 Docker 部署（`render.yaml` 中已有对应配置）。

---

## Q2：登录接口返回 503 "Authentication service unavailable"

**现象**
```json
{ "code": "bff-2099", "message": "Authentication service unavailable" }
```

**原因**

BFF 调用 Core 服务的 `/internal/auth/verify` 接口验证用户凭据。Render 环境变量 `CORE_SERVICE_URL` 未配置，回退默认值 `http://localhost:8080`，生产环境中根本不存在该地址，导致连接失败。

**调用链**
```
前端 → BFF /auth/login → Core /internal/auth/verify
                              ↑ 这里连接失败
```

**解决**

在 Render **BFF 服务**的环境变量中配置：

```
CORE_SERVICE_URL=https://points-mall-core.onrender.com
INTERNAL_API_KEY=<随机生成的密钥>
```

在 Render **Core 服务**的环境变量中配置（两边必须一致）：

```
INTERNAL_API_KEY=<同一个密钥>
```

**附：Render 免费套餐注意事项**

服务闲置后会自动休眠，首次访问冷启动约 30–60 秒。测试前先访问 `https://points-mall-core.onrender.com/health` 唤醒服务。

---

## Q3：INTERNAL_API_KEY 是做什么的？和 JWT 有什么区别？

**两套认证各司其职**

| 场景 | 认证方式 | 说明 |
|------|----------|------|
| 用户 → BFF | JWT（存于 HttpOnly Cookie） | 验证用户身份 |
| BFF → Core 内部接口 | `INTERNAL_API_KEY`（请求头） | 验证服务身份，防止外部绕过 BFF 直接访问 Core |

**代码位置**

```ts
// points-mall-bff/src/connectors/core/core-connector.service.ts
const apiKey = this.config.getOrThrow<string>('INTERNAL_API_KEY');
// ...
headers: { INTERNAL_API_KEY: apiKey }
```

Core 侧通过 `InternalApiKeyFilter` 校验该 Header，不匹配则直接拒绝请求。

**为什么不用 JWT 做服务间认证？**

服务间通信在内网/受控环境中，共享密钥（API Key）更简单直接，无需签发/校验 token 的额外开销。JWT 设计用于无状态的用户身份传递，语义不同。

---

## Q4：前端请求 BFF 被 CORS 拦截

**现象**
```
Access to XMLHttpRequest at 'https://points-mall-bff.onrender.com/auth/login'
from origin 'https://points-mall.onrender.com' has been blocked by CORS policy:
No 'Access-Control-Allow-Origin' header is present on the requested resource.
```

**原因**

`points-mall-bff/src/main.ts` 未调用 `app.enableCors()`，NestJS 默认不设置任何 CORS 响应头，浏览器预检请求（OPTIONS）直接失败。

**解决**

在 `main.ts` 中从环境变量读取允许的域名并启用 CORS：

```ts
const allowedOrigins = (process.env.CORS_ORIGINS ?? 'http://localhost:3003')
  .split(',')
  .map((o) => o.trim());

app.enableCors({
  origin: allowedOrigins,
  credentials: true,   // 必须，前端需要携带 Cookie（JWT）
});
```

在 Render **BFF 服务**的环境变量中配置：

```
CORS_ORIGINS=https://points-mall.onrender.com
```

**为什么必须设置 `credentials: true`？**

前端通过 `withCredentials: true`（axios）发送请求，目的是让浏览器携带 HttpOnly Cookie（存储 JWT access_token）。服务端不开启 `credentials: true` 的话，浏览器会拒绝响应，Cookie 无法传递，后续所有鉴权接口都会 401。
