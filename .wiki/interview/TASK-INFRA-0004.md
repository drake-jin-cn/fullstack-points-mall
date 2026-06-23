# TASK-INFRA-0004 面试问答 — 标准化健康检查端点

> 对应提交：`feat(TASK-INFRA-0004): standardized health check endpoint for all backend services`
> 涉及技术：Liveness/Readiness Probe · HTTP 健康检查设计 · 各框架实现细节 · 运维可观测性

---

## 健康检查设计

### Q1：Liveness Probe 和 Readiness Probe 有什么区别？这个接口是哪种？

这是 Kubernetes 里的两个核心概念：

| 维度 | Liveness Probe | Readiness Probe |
|------|---------------|----------------|
| **含义** | 进程还活着吗？ | 可以接收流量吗？ |
| **失败后果** | K8s 重启容器 | K8s 从 Service 负载均衡里摘掉该实例 |
| **检查对象** | 进程本身（有没有死锁、OOM） | 依赖项（DB、缓存、队列是否就绪） |
| **适合频率** | 低频（30s 一次） | 较高频（10s 一次） |

**本任务的接口**是两者的**混合型**：
- `status: "ok"` 说明进程活着（Liveness）
- `db: "ok"|"error"` 说明依赖状态（Readiness 的部分信息）
- 始终返回 HTTP 200（当前阶段）——T093 会升级成 503 表示 degraded，届时才真正成为 Readiness Probe

---

### Q2：为什么 DB 连接失败时，`/health` 仍然返回 HTTP 200 而不是 503？

**当前阶段的设计选择**，原因如下：

1. **Phase 0 阶段**：DB 表还不存在（迁移未跑），如果返回 503，Docker Compose 的 `depends_on: healthy` 会阻止服务启动，形成死锁——服务等 DB 健康，但 DB 等服务运行迁移
2. **渐进式暴露**：先让运维能看到 DB 连接状态（通过 `db` 字段），但不影响服务上线
3. **监控分离**：503 会触发告警和自动重启，而 DB 短暂不可达不一定需要重启服务

T093（Phase 10）会升级为：DB 失败时返回 HTTP 503，`status: "degraded"`，届时 K8s Readiness Probe 才能正确摘掉不健康的实例。

---

### Q3：`SELECT 1` 为什么能探测数据库连通性？能不能用更复杂的查询？

`SELECT 1` 是最轻量的合法 SQL：

- **不访问任何表**：只让 DB 引擎解析并执行一个常量表达式，不涉及磁盘 I/O
- **能证明什么**：TCP 连接建立 ✓、认证通过 ✓、SQL 解析器工作 ✓
- **执行时间**：微秒级，不会影响服务响应时间

用更复杂的查询（如 `SELECT COUNT(*) FROM employees`）有副作用：
- 占用 DB 连接时间更长
- 健康检查会成为额外的查询负载
- 如果表不存在（迁移未跑）会报错，误判为 DB 不健康

Spring Boot 的 `connection.isValid(1)` 是超时 1 秒的连接有效性检查，底层也是发送 `SELECT 1`（JDBC 驱动实现）。

---

### Q4：各框架怎么获取进程 uptime？

```java
// Spring Boot (Java)
ManagementFactory.getRuntimeMXBean().getUptime() / 1000
// getRuntimeMXBean().getUptime() 返回毫秒，/1000 转秒
```

```typescript
// NestJS / Node.js
Math.floor(process.uptime())
// process.uptime() 返回秒（浮点），floor 取整
```

```typescript
// Express / Message 服务（无 process.uptime 的准确起始点时）
const startTime = Date.now();
// ...
const uptime = Math.floor((Date.now() - startTime) / 1000);
// 手动记录启动时间，用差值计算
```

```python
# FastAPI
import time
_start_time = time.time()  # 模块加载时记录
# ...
uptime = int(time.time() - _start_time)
```

```php
// Laravel
(int) round(microtime(true) - LARAVEL_START)
// LARAVEL_START 是 Laravel 框架在 public/index.php 里定义的浮点秒时间戳
```

---

### Q5：`timestamp` 字段为什么要用 UTC ISO 8601 格式，而不是本地时间？

```
UTC ISO 8601：2026-06-23T10:00:00.000Z
本地时间：    2026-06-23 18:00:00 +08:00
```

**问题场景**：服务部署在不同时区的服务器上（国内 +08:00、海外 UTC），如果用本地时间：
- 日志聚合时时间对不上，很难排查跨服务问题
- 前端显示需要知道服务器时区才能正确转换

**UTC + ISO 8601 的优势**：
- 全球唯一性：不同地区的服务返回的时间戳可以直接比较大小
- 末尾 `Z` 表示 UTC，是国际标准（RFC 3339），各语言解析库都支持
- 前端按需转成用户本地时区展示（T083 时区适配任务）

Java 的 `Instant.now().toString()` 、Python 的 `datetime.now(timezone.utc).isoformat()` 都输出符合标准的 UTC 时间。

---

### Q6：这个健康检查接口在实际运维里怎么用？

**负载均衡层**（Nginx / AWS ALB / K8s Service）：
```
每隔 10s 向所有实例发 GET /health
→ 返回 200  → 继续转发流量到这个实例
→ 连续 3 次失败  → 从池里摘掉，停止转发
```

**容器编排**（docker-compose）：
```yaml
healthcheck:
  test: ["CMD", "wget", "-qO-", "http://localhost:4000/health"]
  interval: 10s
  timeout: 5s
  retries: 3
# depends_on: { bff: { condition: service_healthy } }
# 依赖该服务的其他服务等 /health 返回 200 后才启动
```

**监控告警**（Prometheus + Grafana / 自定义轮询）：
- T094 会做一个纯前端的服务状态看板，每 30s 轮询所有 `/health`
- `db: "error"` 触发告警，提示运维去排查数据库连接问题

**CI 流程**：
- `docker-compose up -d` 后等待所有服务变成 `healthy`，再运行 Bruno API 测试
- 确保测试时服务已经就绪，避免因服务未启动导致测试误失败
