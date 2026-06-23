# TASK-INFRA-0001 面试问答 — 多框架服务骨架搭建

> 对应提交：`feat(TASK-INFRA-0001): initialize all 8 service skeletons`
> 涉及技术：NestJS · Spring Boot · Spring WebFlux · Laravel · Express/TS · FastAPI · Next.js · Rollup

---

## 框架选型

### Q1：为什么 BFF 层用 NestJS 而不是 Express？

NestJS 是 Express 的上层框架，两者底层相同，但 NestJS 带来：

- **依赖注入（DI）**：`@Injectable()` 、`@Module()` 形成清晰的模块边界，BFF 需要组合多个下游服务（core、shop、message），DI 让各 client 可单独 mock 测试
- **装饰器驱动**：`@Controller`、`@Get`、`@UseGuards` 与 Spring Boot 注解风格一致，减少团队切换成本
- **内置 Swagger**：`@nestjs/swagger` 一行装饰器自动生成 API 文档，BFF 是唯一对外接口，文档尤其重要
- **TypeScript-first**：类型安全覆盖整个请求/响应链路

纯 Express 需要手动组织以上内容，在中大型项目里容易演变成"意大利面条"结构。

---

### Q2：`points-mall-thirdparty-connector` 为什么从 Express/TS 改成了 Spring Boot WebFlux？

这个服务的核心工作是**调用外部 API**（GitHub OAuth、Amazon API、SendGrid）——本质是大量 I/O 等待。

**WebFlux + WebClient 的优势：**
- **非阻塞 I/O**：基于 Netty，线程不阻塞等待 HTTP 响应，可用少量线程处理大量并发外部调用
- **背压（Backpressure）**：Reactor 的 `Mono` / `Flux` 天然支持背压，防止上游过载
- **WebClient**：WebFlux 的 HTTP client，天然异步，比 Spring MVC 的 `RestTemplate` 更适合这个场景

**对比传统 Spring MVC：**
```
Spring MVC（同步）：每个请求占一个线程，等 GitHub 返回期间线程阻塞
Spring WebFlux（异步）：请求挂起，线程去处理其他请求，GitHub 回来再恢复
```

在 CPU 核心数有限的容器里，WebFlux 吞吐量显著更高。

---

### Q3：NestJS 的模块系统是什么概念？

NestJS 的 `@Module` 是**依赖声明的边界单元**：

```typescript
@Module({
  imports: [],      // 引入其他模块
  controllers: [],  // 处理 HTTP 请求的 controller
  providers: [],    // service、repository 等可注入的 provider
  exports: [],      // 暴露给其他模块使用的 provider
})
export class HealthModule {}
```

根模块 `AppModule` 导入所有功能模块，形成模块树。优点：
- 按业务边界划分，auth 模块改动不会影响 shop 模块
- 便于测试：`TestingModule` 可以只加载需要的模块，mock 其他依赖

---

### Q4：Spring Boot 的自动配置（Auto-configuration）是什么原理？

Spring Boot 在启动时扫描 classpath，通过 `@Conditional` 条件注解自动装配 Bean：

```
spring-boot-autoconfigure.jar 里列了几百个 AutoConfiguration 类
↓
每个类上有 @ConditionalOnClass、@ConditionalOnMissingBean 等条件
↓
满足条件 → 自动注册 Bean；不满足 → 跳过
```

例如：检测到 classpath 有 `spring-webmvc` → 自动配置 `DispatcherServlet`；检测到有 `application.yml` 里的 `spring.datasource.*` → 自动配置 `DataSource`。

开发者只需引入 starter 依赖，不需要写 XML 配置，这就是"约定优于配置"的体现。

---

### Q5：Rollup 和 Webpack 有什么区别？为什么组件库用 Rollup？

| 维度 | Rollup | Webpack |
|------|--------|---------|
| 设计目标 | **库打包**（输出干净的 ESM/CJS） | **应用打包**（代码分割、HMR、devServer） |
| Tree-shaking | 原生、效果好 | 需要配置，效果一般 |
| 输出产物 | 干净，无 runtime 胶水代码 | 有 Webpack runtime 开销 |
| 配置复杂度 | 简洁 | 复杂 |

`frontend-base` 是一个给 `frontend` 消费的**组件库**，需要：
1. 支持 Tree-shaking（消费者只打包用到的组件）
2. 输出 ESM（现代打包工具优先）+ CJS（兼容 CommonJS 环境）
3. 生成 `.d.ts` 类型声明文件

这三点 Rollup 天然擅长，Webpack 做库打包反而要额外配置才能做到同等效果。

---

### Q6：Next.js App Router 和 Pages Router 的核心区别？

| 维度 | Pages Router | App Router |
|------|-------------|------------|
| 目录 | `pages/` | `app/` |
| 默认渲染 | 客户端组件 | **Server Components**（服务端组件） |
| 数据获取 | `getServerSideProps` / `getStaticProps` | 组件内直接 `async/await` |
| 布局 | `_app.tsx` + `_document.tsx` | `layout.tsx` 嵌套布局 |
| Streaming | 不支持 | 支持（`<Suspense>`） |

App Router 的核心优势：Server Components 默认不向客户端发送 JS，页面体积更小；嵌套 layout 共享状态更自然。本项目全程用 App Router，SSR/ISR/SSG 策略在 T075 里按页面类型差异化配置。

---

## 工程实践

### Q7：`pnpm build` 输出 ESM + CJS 双格式，为什么要双格式？

- **ESM（.mjs）**：现代打包工具（Vite、Rollup、esbuild）优先消费，支持静态分析 → Tree-shaking
- **CJS（.cjs）**：Node.js `require()` 场景，老版本打包工具兼容性

`package.json` 里用 `exports` 字段按条件导出：
```json
{
  "exports": {
    ".": {
      "import": "./dist/index.mjs",
      "require": "./dist/index.cjs"
    }
  }
}
```

打包工具会根据自身支持的格式自动选择，库作者提供两份，消费者无需关心。
