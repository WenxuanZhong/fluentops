# FluentOps Bug 修复与逻辑完善计划

> 审查时间：2026-05-01
> 范围：apps/api-gateway、apps/web、packages/shared、scripts、infra、CI

本计划按照「问题→影响→修复策略」分点列出，每一项都映射到具体文件与行号，便于逐步实施。

---

## 1. Prisma schema 与 migrations 漂移（严重）

### 问题
`apps/api-gateway/prisma/schema.prisma` 声明了 6 个索引，但 `apps/api-gateway/prisma/migrations/` 中没有对应的 SQL：

| 模型 | schema 行号 | 索引 | 现有 migration |
|------|------|------|------|
| `Assessment` | 72 | `@@index([userId, status])` | 缺失 |
| `Assessment` | 73 | `@@index([status])` | 缺失 |
| `AssessmentEvent` | 85 | `@@index([assessmentId, seq])` | 缺失 |
| `Order` | 157 | `@@index([userId, status])` | 缺失 |
| `Order` | 158 | `@@index([status])` | 缺失 |
| `CreditLedger` | 170 | `@@index([userId, reason, refId])` | 缺失 |

### 影响
- CI 中 `npx prisma migrate deploy` 部署到真实数据库后，索引不会创建，所有按 `status` 过滤的查询（dashboard 列表、维护任务、订单状态过滤）都走全表扫描。
- 任何后续 `prisma migrate dev` 都会报「schema drift」并强制创建一个新的 baseline，污染历史。
- E2E 真库路径（`pnpm verify:api:e2e:realdb`）的查询性能与生产严重不一致。

### 修复策略
新增一个迁移 `apps/api-gateway/prisma/migrations/20260501000000_align_indexes/migration.sql`，按现有 schema 同步缺失索引。这是纯 `CREATE INDEX IF NOT EXISTS` 操作，可在生产安全执行。

---

## 2. AICoach SSE 流在无效 assessmentId 时无限轮询（严重）

### 问题
`apps/api-gateway/src/ai-coach/ai-coach.service.ts:289-344` 的 `streamEvents()`：

```ts
let verified = false;
const fetchEvents = () => {
  if (!verified) {
    return from(
      this.prisma.assessment.findFirst({ where: { id: assessmentId, userId } }).then((a) => {
        if (!a) return [];   // ← 不存在时返回空数组，verified 永不变 true
        verified = true;
        ...
      }),
    );
  }
  ...
};
```

如果用户用别人的 `assessmentId` 或不存在的 ID 调用 `/ai/assess/:id/stream`，`fetchEvents` 会持续返回 `[]`，`takeWhile` 永远拿不到 final/error，于是连接挂死，定时器以指数退避（最长 3s）持续轮询。

### 影响
- 每个非法请求挂占一个连接，配合默认无限会话 TTL，构成低成本 DoS。
- `since` 不受边界检查，恶意客户端可通过这条路径绕过缓存层做时序探测。

### 修复策略
- 将 ownership 校验提前到 Observable 创建之前：先 `findFirst`，找不到直接抛 `NotFoundException`（HTTP 404，立即关闭 SSE）。
- 给 `since` 加 `@IsInt() @Min(-1) @Max(100000)` 边界。

---

## 3. MediaService.complete 重复调用导致 500（高）

### 问题
`apps/api-gateway/src/media/media.service.ts:49-58` 创建 Recording 时：

```ts
const recording = await this.prisma.recording.create({ data: { ... objectKey: dto.objectKey ... } });
```

`Recording.objectKey` 在 schema 中是 `@unique`。如果客户端因网络重试重复调用 `/media/complete`（同一个 objectKey），第二次 `create` 触发 Prisma `P2002`，最终被 `AllExceptionsFilter` 转成 500 而不是合理状态码。

### 影响
- 上传重试场景下用户看到 500，无法理解错误。
- 实际数据已经写入，但 UI 不会刷新列表。

### 修复策略
- 在 `complete()` 中先 `findFirst({ where: { objectKey } })`，如果存在且属于当前 userId 则直接返回（幂等），属于他人则抛 `ForbiddenException`。
- 只有不存在的 objectKey 才走 `create`。

---

## 4. 邮件通知中存在 HTML 注入（高）

### 问题
`apps/api-gateway/src/notifications/notifications.service.ts:43-70`：

```ts
const lines = [
  `Hi ${assessment.user.email},`,
  ...
  `Input: ${assessment.inputText ?? '(recording)'}`,
  ...
];
return this.deliver({
  ...,
  html: lines.map((line) => `<p>${line}</p>`).join(''),
});
```

`assessment.inputText` 由用户提交，长度限制 5000，但内容未过滤。如果包含 `<script>` 等标签会原样进入 HTML。多数邮件客户端会沙箱化 `<script>`，但 `<a href="javascript:">`、内联 SVG、CSS 都可能在部分客户端执行；此外，含 `<img>` 的 inputText 会无授权拉取外链造成隐私问题。

### 影响
- 自损型 XSS（用户邮件给自己）— 风险有限但不可接受。
- 未授权资源加载 — 邮件打开 = 状态被泄漏给第三方。

### 修复策略
- 实现一个简单的 HTML 转义工具（`& < > " '`），在 HTML 分支中对每行调用。
- 文本分支保持原样。

---

## 5. useAssessmentRealtime 模块级状态导致并发覆写（高）

### 问题
`apps/web/src/composables/useAssessmentRealtime.ts:11-12`：

```ts
let socket: WebSocket | null = null;
let abortController: AbortController | null = null;
```

这是模块级单例，所有调用 `useAssessmentRealtime()` 的组件共享同一份。如果 `CoachPage` 同时打开两个评估流（例如导航过快、多 tab），后者的 `stop()` 会误关闭前者的 socket。

### 影响
- 大多数场景影响小（只有一个评估流），但在路由切换 / 热更时可能出现「前一个评估的 final 还没发就被 stop」的怪异行为。
- `useMicAnalyzer.ts` 同样问题。

### 修复策略
- 把 `socket`、`abortController`、`audioContext` 移入 `useXxx()` 闭包内，每次 `use` 返回独立实例。
- `CoachPage` / `SpeakingPage` 已经是单一实例使用，行为不变。

---

## 6. AICoachService 时序事件序列号竞争（中）

### 问题
`runWorkflowWithTimeout` 的超时分支在事务里写 `seq = count`：

```ts
const count = await tx.assessmentEvent.count({ where: { assessmentId } });
await tx.assessmentEvent.create({ data: { assessmentId, seq: count, ... } });
```

但与此同时 `runWorkflow` 内部正在异步循环写事件（`seq` 从 0 自增）。如果 `runWorkflow` 还未来得及让最后一次 `writeEvent` 落库，超时分支用 `count` 计算的 `seq` 可能等于 `runWorkflow` 接下来要写的 `seq`，造成重复 seq。

### 影响
- 前端 SSE 接收时按 `seq` 去重的逻辑可能错乱，最终得到错位的进度条。
- 现有 schema 没有 `unique([assessmentId, seq])` 约束，所以不会抛错，但数据已乱。

### 修复策略
- 当 `runWorkflowWithTimeout` 的超时分支触发时，先发出一个取消信号让 `runWorkflow` 循环检查并退出（通过 AbortSignal 或一个内存级取消标志）。
- 简化做法：将超时分支生成的 ERROR 事件 seq 固定为 `Number.MAX_SAFE_INTEGER`（或者基于现有 max seq + 1 加一个跳跃量），并在前端 takeWhile 中一旦看到 `error` 即刻停止。
- 同时给 schema 加一条 `@@unique([assessmentId, seq])`（需要新 migration）— 但这会让前两个 race 中先写入的赢，后来的失败，可能引入新的失败路径。当前周期先用 seq 跳跃方案。

---

## 7. AssessmentEvent 顺序号缺少唯一约束（中）

### 问题
schema 中 `AssessmentEvent` 只有 `@@index([assessmentId, seq])`，不是 `@@unique`。多写入路径（runWorkflow 的进度、超时分支、错误分支）依赖外部协调避免 seq 冲突，缺少 DB 层防护。

### 修复策略
作为问题 6 的补强：在新的 migration 中添加 `@@unique([assessmentId, seq])`，并在写入路径用 try/catch 转化 P2002 为「跳过该 seq」。这是改善「正确性 > 性能」的小代价。

> 注：此修复要求 problem 6 先就绪，否则 race 会真的导致 5xx。本文先列出，留作后续迭代。

---

## 8. SSE since 参数缺乏边界保护（中）

### 问题
`apps/api-gateway/src/ai-coach/ai-coach.controller.ts:88`：

```ts
@Query('since', new DefaultValuePipe(-1), ParseIntPipe) since: number,
```

`ParseIntPipe` 接受任意 32 位以内整数。负无穷 / 负数（除 -1 外）/ 极大值都没有过滤。

### 影响
- `since = -2` 等同 `-1`（因为 `seq > -2` 包含 0）— 行为退化，不报错；
- `since = 1e9` 永远没有事件返回 — 与问题 2 叠加导致挂连接。

### 修复策略
新建 `SseQueryDto`，使用 class-validator `@IsOptional() @IsInt() @Min(-1) @Max(99999)`，绑定到 `@Query()`。

---

## 9. ensure-pnpm.mjs 每次执行都打印日志（低）

### 问题
`scripts/ensure-pnpm.mjs:33`：

```ts
console.log(`[ensure-pnpm] pnpm wrappers installed to ${targetDir}`);
```

每次 `pnpm dev`、`pnpm build`、`pnpm verify:local` 触发都会执行 `ensure-pnpm.mjs`，每次都重新写入相同内容并打印，构成噪声。

### 修复策略
- 写入前 `existsSync` 三个目标文件，全部存在则跳过 + 静默退出；
- 否则只写入缺失的文件。

---

## 10. AICoachController 的 INSUFFICIENT_CREDITS 双重判断（低）

### 问题
`ai-coach.controller.ts:44-64`：

```ts
async assess(@Req() req, @Body() dto) {
  if (!(await this.billingService.hasCredits(req.user.id))) {
    throw new HttpException('INSUFFICIENT_CREDITS', 402);
  }
  try {
    const result = await this.aiCoachService.createAssessment(...);
    ...
  } catch (error) {
    if (error instanceof BadRequestException && error.message === 'Insufficient credits') {
      throw new HttpException('INSUFFICIENT_CREDITS', 402);
    }
    throw error;
  }
}
```

外层 `hasCredits` 是非原子检查，内层 `deductCredit` 才是原子检查。`hasCredits` 完全可以删掉，依靠 `deductCredit` 抛 `BadRequestException` → 转 402 即可。当前两次查询数据库浪费且可能不一致。

### 修复策略
- 移除外层 `hasCredits` 调用；
- 保留 catch 路径捕获 `Insufficient credits` 并转 402。

---

## 11. RegisterPage 验证规则与后端不严格一致（低）

### 问题
- 后端：`@MinLength(8)` + `(?=.*[a-zA-Z])(?=.*\d)`；
- 前端：`min: 8` + `^(?=.*[a-zA-Z])(?=.*\d).+$`；

两者基本等价，但前端的两条规则同时触发（min 与 pattern），失败时只显示一条。

### 修复策略
- 前端合并为单条带 `validator` 的 rule，UI 显示更清晰；可选优化。

---

## 12. ai-coach.controller.ts 的 BadRequestException 拼写比较脆弱（低）

### 问题
判断 `error.message === 'Insufficient credits'` 是字符串相等，未来如果消息文案更换，会悄悄退化为 500。

### 修复策略
在 `BillingService.deductCredit` 中抛带固定错误码的子类（例如 `class InsufficientCreditsException extends BadRequestException`），controller 用 `instanceof` 判断。

---

## 13. CoachPage 在 onMounted 中并行加载未 await（低）

### 问题
`apps/web/src/pages/CoachPage.vue:277-280`：

```ts
onMounted(() => {
  loadHistory();
  loadBalance();
});
```

未 await，错误会被 `.catch` 在 store 内吞掉，但开发时控制台不直观。这是设计选择，无需变更。

---

## 14. 修复优先级与执行批次

按对生产可用性的影响排序：

| 批次 | 编号 | 类型 | 文件 |
|------|------|------|------|
| 1 | 1 | 数据库 | `apps/api-gateway/prisma/migrations/20260501000000_align_indexes/migration.sql`（新增） |
| 1 | 2 | 业务逻辑 | `apps/api-gateway/src/ai-coach/ai-coach.service.ts`、`ai-coach.controller.ts` |
| 1 | 3 | 业务逻辑 | `apps/api-gateway/src/media/media.service.ts` |
| 1 | 4 | 安全 | `apps/api-gateway/src/notifications/notifications.service.ts` |
| 1 | 5 | 前端 | `apps/web/src/composables/useAssessmentRealtime.ts`、`useMicAnalyzer.ts` |
| 2 | 6 | 业务逻辑 | `apps/api-gateway/src/ai-coach/ai-coach.service.ts` |
| 2 | 8 | 输入校验 | `apps/api-gateway/src/ai-coach/ai-coach.controller.ts`、新建 DTO |
| 2 | 10 | 业务逻辑 | `apps/api-gateway/src/ai-coach/ai-coach.controller.ts` |
| 2 | 12 | 错误码 | `apps/api-gateway/src/billing/billing.service.ts`、`ai-coach.controller.ts` |
| 3 | 9 | 工具脚本 | `scripts/ensure-pnpm.mjs` |
| 3 | 11 | 前端 | `apps/web/src/pages/RegisterPage.vue` |

7、13 列为后续迭代项（需要 schema 变更或纯 UX 优化），不在本次范围内强制修复。

---

## 15. 验证方式

每完成一个修复后跑：

```bash
node ./scripts/run-pnpm.mjs --filter @fluentops/shared build
node ./scripts/run-pnpm.mjs --filter api-gateway typecheck
node ./scripts/run-pnpm.mjs --filter api-gateway test
node ./scripts/run-pnpm.mjs --filter web typecheck
node ./scripts/run-pnpm.mjs --filter web test
```

完整流程：

```bash
pnpm verify:local
```

由于本机环境可能未安装 corepack/pnpm/Docker 等依赖，遇到工具缺失时会在文档中标注「待人工执行」。

## 16. 实施状态（2026-05-01）

| 编号 | 状态 | 说明 |
|------|------|------|
| 1 索引迁移 | 已完成 | 新增 `prisma/migrations/20260501000000_align_indexes/migration.sql`，使用 `IF NOT EXISTS` 安全可重入 |
| 2 SSE 流防御性校验 | 已完成 | 新增 `AICoachService.ensureOwnership`，控制器先校验所有权再返回 Observable |
| 3 MediaService.complete 幂等 | 已完成 | 同 objectKey 重复调用直接返回已有记录；他人 objectKey 抛 Forbidden |
| 4 邮件 HTML 转义 | 已完成 | `escapeHtml` 工具函数，HTML 分支整行转义；text 分支不变 |
| 5 useAssessmentRealtime / useMicAnalyzer 状态隔离 | 已完成 | 模块级 `let` 移入 `useXxx()` 闭包内部 |
| 6 时序事件 seq 竞争 | 未实施 | 当前架构下需要更深入改造（取消信号 / 唯一约束），列入后续迭代 |
| 7 AssessmentEvent 唯一约束 | 未实施 | 同上，需要先做 6 才能加 unique 不破坏运行 |
| 8 SSE since 边界 | 已完成 | 新增 `StreamQueryDto`，`@IsInt @Min(-1) @Max(99999)` |
| 9 ensure-pnpm 噪声 | 已完成 | 仅在文件缺失时写入并打印 |
| 10 移除冗余 hasCredits | 已完成 | 删掉外层检查，依赖 `deductCredit` 抛 `InsufficientCreditsException` |
| 11 RegisterPage 前端规则合并 | 未实施 | 纯 UX 项，不影响功能；维持现状 |
| 12 错误码类型化 | 已完成 | 新增 `billing/billing.errors.ts`，`InsufficientCreditsException` 自带 402 状态码 |
| 13 onMounted 并行调用 | 未实施 | 设计选择，无需变更 |

附带的同步改动：

- `BillingService.deductCredit` 现在抛 `InsufficientCreditsException`；`billing.service.spec.ts` 同步更新
- `MediaService.complete` 多了 `findUnique` 调用；`media.service.spec.ts` 增加幂等与跨用户两条用例；`in-memory-prisma.ts` 补上 `recording.findUnique` 与 `deleteMany`
- `ai-coach.controller.ts` 不再注入 `BillingService`，新增 `StreamQueryDto` 入参

## 17. 本机验证局限

撰写本文档的本机环境存在以下限制，导致无法当场跑完 `pnpm verify:local`：

1. 本机 Node 版本是 22.19.0；旧契约固定为 Node 20.x（`package.json:engines.node="20"`、`.nvmrc=20`），现已放宽为 `>=20`，Node 22 已在工作区契约内。
2. Windows + pnpm 软链 + Node 22 组合下，`tsc` 与 `vitest` 都无法通过 `node_modules/.bin` 的 shim 直接调用，主要表现为「Cannot find module …\node_modules\typescript\bin\tsc」。
3. `pnpm exec` 也无法跨过同样的 shim 解析问题。

因此修复后的代码仅通过逐文件人工审查（含 import / 类型签名 / 方法调用一致性）来确认。建议用户在符合契约的环境（Node `>=20`，例如 Node 20.x 或 22.x；`corepack pnpm@9.15.4`）中运行：

```bash
pnpm install                          # 重新生成 .bin shim
pnpm doctor:env                       # 应当除了既有 dep audit 外全绿
pnpm verify:local                     # 跑完 lint / typecheck / test / build / api e2e
pnpm --filter api-gateway prisma migrate deploy  # 应用新增的索引迁移
```

E2E 与 typecheck 都覆盖到了改动的服务和控制器，应当能立即暴露任何手工审查遗漏的问题。

