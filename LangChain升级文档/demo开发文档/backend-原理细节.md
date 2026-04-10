# 后端原理细节（idbackend）

> 细节检索版 · 配合 `backend-原理概要.md` 使用

---

## § 1 认证拦截器详解（AuthInterceptor）

**代码位置**：`src/main/java/.../config/intercept/AuthInterceptor.java`

### 1.1 拦截流程

```
preHandle(request, response, handler)
  ↓
1. OPTIONS 请求 → 直接 true（CORS 预检）
2. 非 HandlerMethod → 直接 true（静态资源等）
3. @PublicAccess 注解 → 直接 true
4. 取 Authorization header，必须以 "Bearer " 开头
5. JWTUtils.getUserName/getUserId/getTokenType(token)
   - tokenType != "access" → 返回 401
6. request.setAttribute("username", username)
   request.setAttribute("userId", userId)
7. @RequireRole → rbacService.hasAnyRole(userId, roles[])
   失败 → 返回 403
8. @RequirePermission → rbacService.hasAnyPermission(userId, perms[])
   失败 → 返回 403
9. return true（通过）
```

### 1.2 注解优先级

方法级注解 > 类级注解（`getAnnotation` 先查方法再查类）。

### 1.3 异常处理

| 异常 | 含义 | 返回 |
|------|------|------|
| `TokenExpiredException` | accessToken 超期 | 403 "Access Token 已过期，请刷新Token" |
| 其他 Exception | Token 无效/篡改 | 401 "Token 无效" |

### 1.4 错误响应格式

HTTP状态码与业务code一致，body为JSON：
```json
{"code": 403, "msg": "权限不足：需要角色 [admin 或 super_admin]", "data": null}
```

---

## § 2 JWT 机制

**代码位置**：`src/main/java/.../utils/JWTUtils.java`

- 双 Token：accessToken（短期，含 type="access"）/ refreshToken（长期，含 type="refresh"）
- Payload 字段：`username`、`userId`、`tokenType`（"access" 或 "refresh"）
- `TokenExpiredException`：JWTUtils 解析时发现超期则抛出此自定义异常（区别于签名错误）

**刷新流程（前端驱动）：**
```
后端返回 code=403
  → 前端拦截器（http.ts）检测到 403
  → POST /api/auth/token/refresh（带 refreshToken）
  → 后端验证 refreshToken 有效性（Redis + JWT）
  → 返回新 accessToken + refreshToken
  → 前端更新 localStorage，重发原请求
```

---

## § 3 RBAC 权限系统

### 3.1 数据模型

```
users ─── user_roles ─── roles ─── role_permissions ─── permissions
```

- 用户绑定角色（user_roles）
- 角色绑定权限（role_permissions）
- 角色示例：`student`、`teacher`、`admin`、`super_admin`

### 3.2 rbacService 核心方法

```java
hasAnyRole(userId, String[] roles)
// SELECT role_name FROM roles JOIN user_roles WHERE user_id=?
// 任意一个 role 在 roles[] 中 → true

hasAnyPermission(userId, String[] permissions)
// 通过 roles → role_permissions → permissions 链查询
```

---

## § 4 AI Agent 服务层（AIAgentService）

**代码位置**：`src/main/java/.../service/businessService/AIAgentService.java`

### 4.1 OkHttpClient 配置

```java
new OkHttpClient.Builder()
    .connectTimeout(100, SECONDS)
    .readTimeout(120, SECONDS)    // LLM 响应慢，必须足够长
    .writeTimeout(300, SECONDS)
    .build()
```

### 4.2 方法一览

| 方法 | HTTP | Agent 路径 | 说明 |
|------|------|-----------|------|
| `chat()` | POST | /chat/send | 非流式，返回 reply 字符串 |
| `streamChat()` | POST | /chat/stream | OkHttp 读行，透传 SseEmitter |
| `clearConversation()` | POST | /chat/clear | 无返回值 |
| `listKnowledge()` | GET | /knowledge/list | 返回原始 JSON |
| `uploadKnowledge()` | POST | /knowledge/upload | multipart 转发 |
| `deleteKnowledge()` | DELETE | /knowledge/{file} | URL 编码文件名 |
| `analyzeCertificate()` | POST | /analyze/certificate | multipart（PDF + templates） |
| `generateApplication()` | POST | /analyze/generate | JSON body |
| `getAIConfig()` | GET | /config | 返回原始 JSON |
| `updateAIConfig()` | PUT | /config | JSON body |

### 4.3 流式代理实现（streamChat）

```java
// 在 CompletableFuture.runAsync 中执行，不阻塞 Tomcat HTTP 线程
try (Response resp = http.newCall(req).execute()) {
    BufferedReader reader = new BufferedReader(
        new InputStreamReader(resp.body().byteStream(), UTF_8))
    while ((line = reader.readLine()) != null) {
        if (!line.startsWith("data: ")) continue
        String data = line.substring(6).trim()
        if ("[DONE]".equals(data)) break
        emitter.send(SseEmitter.event().data(data))  // 不设 name，纯 data
    }
    emitter.complete()
} catch (Exception e) {
    try { emitter.completeWithError(e) } catch (Exception ignored) {}
}
```

### 4.4 异常兜底规则

所有方法 catch 所有 Exception，返回统一格式：
```
String: null（chat）/ void（clear）
JSON String: {"code":500,"msg":"Agent 不可达","data":null}
```

---

## § 5 ChatController 详解

**代码位置**：`src/main/java/.../controller/businessController/ChatController.java`

### 5.1 /send（同步）

```java
@PostMapping("/send")
public ResultVo chat(@RequestBody ChatRequestDTO request, HttpServletRequest httpRequest) {
    Integer userId = (Integer) httpRequest.getAttribute("userId")
    String sessionId = userId != null ? "user_" + userId : "anonymous"
    String reply = aiAgentService.chat(request.getMessage(), sessionId)
    if (reply == null) return ResultVo.error(503, "AI 服务暂时不可用")
    return ResultVo.success("成功", reply)
}
```

### 5.2 /stream（SSE）

```java
@PostMapping(value = "/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
public SseEmitter streamChat(...) {
    SseEmitter emitter = new SseEmitter(120_000L)  // 120s 超时
    // ... 参数校验 ...
    CompletableFuture.runAsync(() ->
        aiAgentService.streamChat(message, sessionId, emitter)
    )
    return emitter  // 立即返回，后台线程负责写入和完成
}
```

**SseEmitter 生命周期**：Spring 在 emitter.complete() 或超时后关闭连接。
**线程模型**：Tomcat 线程处理请求并返回 emitter；独立线程池线程（ForkJoinPool.commonPool）执行 streamChat。

---

## § 6 AIAnalyzeController 详解

**代码位置**：`src/main/java/.../controller/businessController/AIAnalyzeController.java`

### 6.1 /certificate

```
1. templateMapper.findAllActive()
   → 查所有 status=ACTIVE 的加分模板

2. 对每个模板调用 ruleService.getRuleDetailsByTemplateId(id)
   → 查规则列表（含 ruleScore、description）

3. 序列化为 ScoreTemplateDto 列表
   → aiAgentService.analyzeCertificate(file, templates)
   → multipart: file=PDF, templates=JSON字符串

4. 解析响应 code == 200 → 透传 data（certificateText + suggestions[]）
```

### 6.2 /generate

```
1. templateMapper.findById(selectedTemplateId)
   → 重新从 DB 取完整模板（不信任前端传来的模板数据）

2. ruleService.getRuleDetailsByTemplateId(...)
   → 取规则详情

3. aiAgentService.generateApplication(
       certificateText, selectedTemplateId, selectedRuleId, templateDto)

4. 返回 { templateName, templateType, scoreType, applyScore, ruleId, remark }
   （与 ScoreApplicationIDTO 字段对齐，前端可直接填入申请表单）
```

---

## § 7 文件存储（MinIO）

**代码位置**：`src/main/java/.../config/MinioConfig.java`、`FileController.java`、`ProofController.java`

- MinIO：S3 兼容对象存储，本地部署或云端
- 证明材料（ProofController）：上传后存 MinIO，返回文件 URL
- 知识库文件：经由 MultipartFile 直接转发给 Agent，**不写入 MinIO**，Agent 处理后删除临时文件

---

## § 8 统一响应封装（ResultVo）

**代码位置**：`src/main/java/.../controller/dto/ResultVo.java`

```java
ResultVo.success("成功")              // code=200
ResultVo.success("成功", data)        // code=200, data=data
ResultVo.error("错误信息")            // code=500
ResultVo.error(400, "参数错误")       // 自定义code
```

---

## § 9 全局异常处理（GlobalExceptionHandler）

**代码位置**：`src/main/java/.../config/GlobalExceptionHandler.java`

- `@ControllerAdvice` 捕获所有未处理异常
- 返回 `ResultVo.error(500, e.getMessage())`
- 防止 Spring 默认 error 页面泄露栈信息

---

## § 10 WebConfig（CORS + 拦截器注册）

**代码位置**：`src/main/java/.../config/WebConfig.java`

```java
// CORS：允许所有来源（开发环境，生产应限制）
registry.addMapping("/**")
    .allowedOriginPatterns("*")
    .allowedMethods("GET","POST","PUT","DELETE","OPTIONS")
    .allowedHeaders("*")
    .allowCredentials(true)

// 拦截器：除 /api/auth/** 以外的所有路径
registry.addInterceptor(authInterceptor)
    .addPathPatterns("/api/**")
    .excludePathPatterns("/api/auth/**")  // 登录等公开路径由 @PublicAccess 补充控制
```

---

## § 11 数据层（MyBatis Mapper）

```
Mapper接口（.java）
  ↓ XML 映射 / 注解 SQL
MySQL
```

**主要 Mapper：**

| Mapper | 表 | 说明 |
|--------|-----|------|
| LoginMapper | users | 用户登录、注册 |
| RoleMapper/PermissionMapper | roles/permissions | RBAC基础表 |
| UserRoleMapper/RolePermissionMapper | 关联表 | RBAC关系 |
| TemplateMapper | score_templates | 加分模板（含 findAllActive） |
| RuleMapper | score_rules | 加分规则 |
| FileMapper | files | 文件元数据 |

---

## § 12 Redis 用途

**代码位置**：`src/main/java/.../utils/RedisUtil.java`

| key 规则 | 用途 | TTL |
|---------|------|-----|
| `refresh_token:{userId}` | 存 refreshToken（登出/刷新时删除） | refreshToken 有效期 |
| `captcha:{uuid}` | 验证码图片对应的文字 | 5分钟 |
| 其他业务 key | 按需缓存 | 业务决定 |
