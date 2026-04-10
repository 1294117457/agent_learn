# 后端原理概要（idbackend）

> 快速浏览版 · 细节见 `backend-原理细节.md`

---

## 一、整体架构

```
前端（Vue3）
    ↓ HTTP REST（JWT Bearer Token）
Spring Boot :8080
    ├── 认证层：AuthInterceptor（JWT解析 + RBAC校验）
    ├── 业务层：Controller → Service → Mapper → MySQL
    ├── AI层：AIAgentService → ID-AIDemo :3001（OkHttp）
    ├── 文件层：FileController → MinIO
    └── 缓存层：RedisUtil → Redis
```

---

## 二、认证机制（JWT 双 Token）

```
登录 → accessToken（短期）+ refreshToken（长期）
    ↓
每次请求头：Authorization: Bearer {accessToken}
    ↓
AuthInterceptor 拦截，解析 JWT，提取 userId/username
    ↓
写入 request.setAttribute("userId", userId)
（Controller 通过 httpRequest.getAttribute("userId") 取值）
```

| 注解 | 作用 |
|------|------|
| `@PublicAccess` | 跳过认证（登录、注册、验证码） |
| `@RequireRole({"admin"})` | 必须拥有对应角色 |
| `@RequirePermission(...)` | 必须拥有对应权限 |

Token 过期：
- accessToken 过期 → 返回 `code: 403` → 前端自动用 refreshToken 换新 Token
- refreshToken 过期 → 返回 `code: 401` → 前端跳登录页

---

## 三、AI 模块交互模式

**核心原则：idbackend 是唯一数据来源，Agent 只负责 AI 分析**

```
证书分析流程：
  前端上传 PDF
    → AIAnalyzeController 从 MySQL 查激活模板
    → 模板 JSON + PDF 一起发给 Agent
    → Agent 返回推荐列表
    → 后端透传给前端

聊天流程（SSE）：
  前端 fetch /api/chat/stream（带 JWT）
    → ChatController 取 userId → 生成 sessionId "user_{id}"
    → CompletableFuture.runAsync(() → aiAgentService.streamChat(...))
    → OkHttp 读 Agent SSE 流 → SseEmitter.send() 透传
    → 前端逐字渲染
```

**降级兜底：** Agent 不可达时，`AIAgentService` 所有方法 catch 异常，返回 `{"code":500,"msg":"Agent 不可达"}`，非 AI 功能完全不受影响。

---

## 四、主要业务模块

| 模块 | Controller | 说明 |
|------|-----------|------|
| 认证 | LoginController | 登录/注册/验证码/忘记密码/刷新Token |
| 加分申请 | ApplicationController | 学生提交、管理员审核/撤销 |
| 加分模板 | TemplateController | 模板CRUD，含规则和属性 |
| 证明材料 | ProofController | 上传/下载（MinIO） |
| 文件管理 | FileController | 通用文件存储 |
| AI聊天 | ChatController | /send（同步）+ /stream（SSE） |
| AI证书分析 | AIAnalyzeController | certificate + generate |
| 知识库管理 | KnowledgeController | 需管理员权限 |
| AI配置 | AIConfigController | 需管理员权限，代理 Agent config |
| RBAC | Role/Permission/UserRole | 角色权限管理 |

---

## 五、文件存储

```
证明材料、通用文件 → MinIO（S3兼容对象存储）
知识库文件        → 发给 Agent，Agent 解析后丢弃（不持久化）
```

---

## 六、缓存策略（Redis）

- refreshToken 存储与校验
- 验证码（captcha）临时存储
- 其他业务缓存（通过 RedisUtil 操作）

---

## 七、统一响应格式

```json
{ "code": 200, "msg": "成功", "data": {...} }
{ "code": 400, "msg": "参数错误", "data": null }
{ "code": 401, "msg": "未登录", "data": null }
{ "code": 403, "msg": "Token过期", "data": null }
{ "code": 503, "msg": "AI服务不可用", "data": null }
```
