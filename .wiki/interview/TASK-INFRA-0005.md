# TASK-INFRA-0005 面试问答 — 数据库 Schema 设计与迁移

> 对应提交：`feat(TASK-INFRA-0005): full database schema design — Flyway migrations (core) + Laravel migrations (shop) + ER docs`
> 涉及技术：PostgreSQL · Flyway · Laravel Migration · ER 设计 · 跨库引用 · docker-compose

---

## 数据库设计

### Q1：`points_ledger` 同时存了 `delta` 和 `balance_after`，为什么不只存 `delta`，查余额时 SUM 一下？

这是经典的**快照 vs 实时计算**权衡。

只存 `delta` 的问题：用户积分流水可能有几千条，每次查余额都全表 SUM，随数据增长性能越来越差。

`balance_after` 是每次写入时的余额快照，查当前余额只需取最新一条：
```sql
SELECT balance_after FROM points_ledger
WHERE employee_id = ? ORDER BY id DESC LIMIT 1;
```
O(log n) vs O(n)，差距随数据量线性扩大。

代价是写入时必须在事务里原子计算余额，但写是低频的、读是高频的，这个取舍合理。

---

### Q2：`employees.password_hash` 为什么允许 NULL？

系统支持两种登录方式：**邮箱密码** 和 **GitHub OAuth**。

OAuth 用户从来没有设置过密码，强制 NOT NULL 会导致：
- 要么存一个无意义的占位符（数据语义不清晰）
- 要么为 OAuth 用户单独建表（过度设计）

允许 NULL 是最语义清晰的设计：`NULL` 明确表示"该用户没有密码"。代码里 `passwordHash == null` 就能判断不允许密码登录，无需额外标志位。

---

### Q3：`orders.employee_id` 没有加外键约束，为什么？

员工数据在 `points_core` 数据库，订单在 `points_shop` 数据库，两者是物理隔离的 PostgreSQL 数据库实例。

**PostgreSQL 的外键约束只能在同一个数据库内生效，跨库无法建约束。**

解决方案：**应用层保证一致性**——BFF 在创建订单前先调 Core 服务验证员工存在，用索引保证查询性能。这是微服务架构下跨服务数据引用的标准做法，没有人会在微服务间建数据库外键。

---

### Q4：`attendance_records` 为什么单独存 `work_date DATE`，而不直接从 `check_in_at` 派生？

两个原因：

**1. 时区一致性**：`check_in_at` 是带时区的精确时间戳，直接 `DATE(check_in_at)` 在不同时区的服务器上结果不一致。`work_date` 是由业务逻辑写入的明确自然日，与时区无关。

**2. 查询性能**：
```sql
-- 走索引（idx_attendance_employee_date）
WHERE work_date = '2026-06-23'

-- 走不了索引，全表扫描
WHERE DATE(check_in_at) = '2026-06-23'
```
函数运算会破坏索引，导致慢查询。

---

### Q5：为什么把 `points_core` 和 `points_shop` 拆成两个数据库，而不是两个 Schema？

| 维度 | 原因 |
|------|------|
| **独立扩展** | 核心业务和商城的读写压力模型不同，未来可以独立迁移到不同实例 |
| **故障隔离** | 商城慢查询不会影响积分核心业务 |
| **权限隔离** | Java 服务账号只有 `points_core` 权限，PHP 服务只有 `points_shop` 权限，最小权限原则 |
| **服务边界** | 数据库隔离强制了微服务边界，避免开发者绕过 API 直接 JOIN 两个服务的表 |

---

### Q6：`system_configs` 是 key-value 表，这种设计有什么优缺点？

**优点**：灵活，新增配置项不需要跑 schema 迁移，运营人员可动态修改。适合节假日列表、积分汇率等需要频繁调整的运营参数。

**缺点**：
- 类型不安全，`value` 是 TEXT，业务代码需要自己做类型转换和校验
- 不能对单个 value 建外键约束
- 复杂嵌套结构可读性差

本系统用它存标量配置（如 `POINTS_TO_PRICE_RATE=100`、`HOLIDAY_DATES=2026-10-01,2026-10-07`）是合适的，复杂业务对象不建议存这里。

---

## Flyway 迁移机制

### Q7：Flyway 怎么保证迁移不重复执行？

Flyway 首次运行时在数据库里建 `flyway_schema_history` 表，记录每个迁移文件的**版本号 + 校验和 + 执行状态**。

每次 Spring Boot 启动时 Flyway 的判断逻辑：

```
版本号已在表中 + 校验和一致  →  跳过，不执行
版本号不在表中              →  执行新迁移，写入记录
版本号在表中但校验和变了    →  报错，拒绝启动（保护机制）
```

所以只要不修改已有的 `.sql` 文件内容，就永远不会重复执行。

---

### Q8：Flyway 最常见的陷阱有哪些？

**陷阱一：修改已执行的迁移文件**

上线后发现 V2 里字段名拼错，直接编辑 V2 文件 → 下次启动校验和不一致 → 服务拒绝启动。

正确做法：新建 V7 文件执行 `ALTER TABLE` 修正，绝不修改已提交的迁移文件。

**陷阱二：Windows/macOS 换行符不一致**

同一个 SQL 文件在 Windows 上是 CRLF、macOS 上是 LF，校验和不同，团队协作时会出问题。

解决方案：在 `.gitattributes` 里强制 `*.sql text eol=lf`。

---

### Q9：生产数据库已有数据时，怎么安全地加一个 NOT NULL 字段？

不能直接 `ADD COLUMN name VARCHAR NOT NULL`——已有行没有值，PostgreSQL 会拒绝。

**标准三步走（零停机）：**

```sql
-- V7: 先加可空字段
ALTER TABLE products ADD COLUMN source VARCHAR(50);

-- 应用部署，业务开始写入新字段 + 后台脚本 backfill 历史数据
UPDATE products SET source = 'manual' WHERE source IS NULL;

-- V8: 历史数据填充完毕后，再加 NOT NULL 约束
ALTER TABLE products ALTER COLUMN source SET NOT NULL;
```

这就是为什么迁移文件要小步提交，而不是一次性写完所有 DDL。

---

## 架构设计

### Q10：开发环境和生产环境的数据库 schema 怎么保持同步？

靠 Flyway / Laravel Migration 本身。

开发和生产环境启动**同一套应用**，Flyway 根据 `flyway_schema_history` 自动把生产库升级到和开发库一样的版本。迁移文件存进 Git 仓库，迁移历史即 schema 的版本历史，不存在"开发库有这张表、生产库没有"的问题。

CI 里的 `mvn verify` 会用测试数据库跑一遍全部迁移，确保在合并之前迁移文件本身是可执行的。

---

### Q11：docker-compose.yml 上云后还有用吗？

**不应该删，只是用途转变。**

| 阶段 | 用途 |
|------|------|
| 当前 | 提供本地开发所需的全套基础设施（postgres + redis + rabbitmq） |
| 上云后 | 仍作为本地开发环境使用；生产地址写进 `.env.prod`，本地开发用 docker-compose |
| Phase 10 | 升级为包含全部 8 个应用服务的完整本地栈（T090） |

删掉后，其他开发者克隆仓库就没法在本地起数据库，开发体验大幅下降。
