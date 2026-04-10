# Agent 原理细节

> 细节检索版 · 配合 `agent-原理概要.md` 使用

---

## § 1 数据库结构（SQLite · `data/agent.db`）

### 1.1 knowledge_chunks — 向量知识库

```sql
CREATE TABLE knowledge_chunks (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  source_file TEXT    NOT NULL,          -- 文件名（含扩展名）
  chunk_index INTEGER NOT NULL,          -- 同一文件内第几块
  content     TEXT    NOT NULL,          -- 原文文本
  embedding   TEXT    NOT NULL,          -- JSON 数组（float[]）
  created_at  INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX idx_chunks_source ON knowledge_chunks(source_file);
```

**无专用向量索引**：所有向量以 JSON 字符串存储，检索时全量加载到 JS 内存计算余弦相似度。

---

### 1.2 conversations — 对话历史

```sql
CREATE TABLE conversations (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT    NOT NULL,   -- 规则："user_{userId}"，如 "user_42"
  role       TEXT    NOT NULL,   -- "user" 或 "assistant"
  content    TEXT    NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX idx_conv_session ON conversations(session_id, created_at);
```

每次对话取最近 **6 条**（`getHistory(sessionId, 6)`），倒序取出后反转为正序拼入 Prompt。

---

### 1.3 ai_config — 动态 AI 配置

```sql
CREATE TABLE ai_config (
  config_key   TEXT PRIMARY KEY,
  config_value TEXT NOT NULL,
  updated_at   INTEGER NOT NULL DEFAULT (unixepoch())
);
-- 5 个默认 key：
-- system_role / api_key / base_url / chat_model / embedding_model
```

---

## § 2 知识库入库详解

### 2.1 启动时自动入库（seedKnowledge）

- 扫描目录：`docs/加分文件/`（相对于项目根）
- 跳过条件：`source_file` 已存在于 `knowledge_chunks`
- 不重建：修改文件后需手动删除旧记录或通过 API 重新上传

**代码位置**：`src/seed/seedKnowledge.ts` → `main()` 中 `await seedKnowledge()`

---

### 2.2 运行时上传（POST /knowledge/upload）

**完整流程（`src/routes/knowledge.ts`）：**

```
1. multer 接收文件 → 保存到 uploads/{原始文件名}
   - 最大 20MB
   - 支持格式：.pdf .docx .doc .xlsx .xls .md .txt
   - 文件名解码：latin1 → utf8（处理中文文件名）

2. 若 sourceFileExists(fileName) → deleteBySourceFile(fileName)（覆盖更新）

3. parseFile(filePath) → 纯文本字符串
   见 §3 文档解析

4. chunkText(text, 500, 100) → string[]
   见 §4 分块策略

5. getEmbeddings(chunks) → number[][]
   见 §5 向量生成

6. saveChunk(fileName, i, chunk, embedding) × N
   INSERT INTO knowledge_chunks ...

7. fs.unlink(filePath) — 清理临时文件（上传文件不持久化）
```

---

## § 3 文档解析（docParser）

**代码位置**：`src/services/docParser.ts`

| 格式 | 解析库 | 说明 |
|------|--------|------|
| .pdf | pdf-parse v2（PDFParse类） | 仅文字型 PDF，扫描件无法提取 |
| .docx | mammoth | 提取纯文本，丢弃格式 |
| .doc | mammoth | 旧版格式支持有限，解析失败返回空字符串 |
| .xlsx / .xls | xlsx | 每个 Sheet 输出 `【SheetName】\n行\t列` |
| .md / .txt | fs.readFileSync | 直接读 utf-8 |

**multer 临时文件无扩展名问题**：证书分析路由通过 `hintExt` 参数传入原始扩展名，`parseFile(filePath, hintExt)` 优先使用 hintExt。

---

## § 4 分块策略（chunkText）

```typescript
chunkText(text, chunkSize=500, overlap=100)
```

- 预处理：`\r\n` → `\n`，连续3个以上空行压缩为2个
- 滑动窗口：每次前进 `chunkSize - overlap = 400` 字符
- 过滤：长度 < 30 的块丢弃
- 每块最大 512 字符（embedding API 限制，超出部分在 getEmbeddings 中截断）

**示例**（500字文本）：块1 = [0,500]，块2 = [400,500]（无第二块，因为到末尾）

**潜在问题**：固定字符数分块会在词中截断，语义边界不对齐。改进方向：按段落/句子边界分块。

---

## § 5 向量生成（embeddings）

**代码位置**：`src/services/embeddings.ts`

```
API：{baseUrl}/embeddings
模型：text-embedding-v3（可通过 AI 配置修改）
批量：每批最多 6 条（BATCH_SIZE = 6），每条最多 512 字符
超时：单批 60s
```

- 每次调用实时读取 `getApiKey()` / `getBaseUrl()` / `getEmbeddingModel()`（工厂模式）
- 批量返回时按 `index` 字段重排（API 不保证顺序）
- 向量维度：text-embedding-v3 默认 1536 维（存为 JSON 数组）

---

## § 6 向量检索（vectorStore.searchSimilar）

**代码位置**：`src/services/vectorStore.ts`

```typescript
function searchSimilar(queryEmbedding: number[], topK = 5): ChunkRecord[]
```

**实现**：
1. `SELECT * FROM knowledge_chunks`（全量加载）
2. 对每条记录 `JSON.parse(embedding)` → 计算余弦相似度
3. 按相似度降序排列，取前 topK 条

**余弦相似度公式**：
```
similarity = Σ(aᵢ·bᵢ) / (‖a‖·‖b‖)
```

**性能瓶颈**：知识块越多，每次检索越慢。1000块约 2-5ms，10000块可能需要 50-200ms。

---

## § 7 RAG 聊天详解（ragChain）

**代码位置**：`src/services/ragChain.ts`

### 7.1 完整调用栈

```
chatWithAgent(sessionId, userMessage)
  ↓
buildContext(userMessage)
  → getEmbedding(userMessage)    ← 单次 Embedding API 调用
  → searchSimilar(vec, 5)        ← 全量向量检索
  → 格式化为 "[1] ...\n\n[2] ..." 字符串

buildMessages(sessionId, userMessage, contextText)
  → getSystemRole()              ← 从 SQLite 读（内存缓存）
  → SystemMessage: system_role + "\n\n【相关知识库内容】\n" + contextText
  → getHistory(sessionId, 6)     ← 取最近6条对话
  → HumanMessage / AIMessage × N
  → HumanMessage(userMessage)    ← 当前提问

createChatModel()
  → new ChatOpenAI({             ← 工厂模式，每次新建
      apiKey: getApiKey(),
      configuration: { baseURL: getBaseUrl() },
      modelName: getChatModel(),
      temperature: 0.3,
    })

chatModel.invoke(messages) 或 chatModel.stream(messages)

saveMessage(sessionId, 'user', userMessage)
saveMessage(sessionId, 'assistant', reply)
```

### 7.2 流式模式差异（chatWithAgentStream）

- 使用 `chatModel.stream(messages)` 返回 `AsyncIterable`
- 每个 chunk：`String(chunk.content)`（LangChain 自动过滤 thinking tokens）
- 历史保存在 `yield` 全部完成后（流中断时历史也不会保存）
- Generator 函数配合 Express `res.write()` 逐 token 写 SSE

---

## § 8 证书分析详解（analyzeChain）

**代码位置**：`src/services/analyzeChain.ts`

### 8.1 analyzeCertificate

```
输入：certificateText（PDF原文），templates（来自idbackend的模板列表）

1. getEmbedding(certificateText.slice(0, 512))
   → searchSimilar(vec, 5)  ← RAG检索相关政策

2. 精简模板：只保留 id/templateName/templateType/rules[{id,ruleName,ruleScore}]

3. Prompt 结构：
   System: "你是审核专家。只输出 JSON 数组，不要解释文字"
   User:
     - 证明材料原文（前2000字）
     - 加分模板列表（JSON）
     - 知识库政策参考
     - 输出格式要求（6字段 JSON 数组）

4. temperature: 0.1（低随机性，确保JSON格式稳定）

5. 解析输出：
   - 先尝试提取 ```json ... ``` 代码块
   - 再尝试匹配 [...] 数组
   - JSON.parse → AnalyzeSuggestion[]
```

### 8.2 generateApplicationRemark

```
输入：certificateText, templateName, ruleName, estimatedScore

Prompt：生成 ≤100字 的申请备注，包含关键信息（名称/等级/时间）
temperature: 0.1
返回：纯文本字符串（直接作为申请表 remark 字段）
```

---

## § 9 AI 配置详解（aiConfig）

**代码位置**：`src/services/aiConfig.ts`

### 9.1 缓存机制

```typescript
let _cache: Record<string, string> | null = null

function loadAll(): Record<string, string> {
  if (_cache) return _cache   // 命中缓存
  // SELECT all FROM ai_config
  _cache = ...
  return _cache
}

function invalidate(): void { _cache = null }
```

`updateConfig()` 在事务写入后调用 `invalidate()`，下次读时重新从 DB 加载。

### 9.2 API Key 回退链

```
getApiKey():
  DB值非空 → 返回DB值
  DB值为空 → process.env.QWEN3_API_KEY ?? ''
```

### 9.3 掩码规则

```
原始长度 ≥ 8：前4位 + "****" + 后4位
原始长度 1-7：全部显示为 "****"
原始长度 0（未设置）：返回空字符串
```

### 9.4 工厂模式的意义

模块级 `const model = new ChatOpenAI(...)` 在导入时执行，使用的是启动时的配置。
改为 `function createModel()` 工厂函数后，每次对话调用时读取最新配置，实现热更新。

---

## § 10 SSE 流式链路完整细节

### Agent 端（routes/chat.ts）

```typescript
res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
res.setHeader('Cache-Control', 'no-cache')
res.setHeader('Connection', 'keep-alive')
res.setHeader('X-Accel-Buffering', 'no')  // 禁止 Nginx 缓冲，立即推送
res.flushHeaders()                          // 立即发送响应头

for await (const token of chatWithAgentStream(...)) {
  res.write(`data: ${JSON.stringify({ token })}\n\n`)
}
res.write('data: [DONE]\n\n')
res.end()
```

### idbackend 代理端（AIAgentService.streamChat）

```java
// OkHttp 持有连接读流
BufferedReader reader = new BufferedReader(
    new InputStreamReader(resp.body().byteStream(), StandardCharsets.UTF_8))
while ((line = reader.readLine()) != null) {
    if (!line.startsWith("data: ")) continue
    String data = line.substring(6).trim()
    if ("[DONE]".equals(data)) break
    emitter.send(SseEmitter.event().data(data))  // 透传给前端
}
emitter.complete()
```

### 前端（apiAIagent.ts + ai-agent/index.vue）

```
fetch POST /api/chat/stream（带 Authorization: Bearer token）
  → response.body.getReader()
  → 逐 chunk decode → 按 \n 分行 → 解析 SSE data 字段
  → token → messages[aiMsgIndex].content += token（Vue 响应式，自动渲染）
  → [DONE] → onDone()
AbortController：组件卸载时 controller.abort() 中断请求
```

---

## § 11 接口清单

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | /chat/send | 非流式聊天（兼容保留） |
| POST | /chat/stream | 流式聊天（SSE） |
| POST | /chat/clear | 清除 session 历史 |
| GET  | /knowledge/list | 知识库文件列表 |
| POST | /knowledge/upload | 上传并入库 |
| DELETE | /knowledge/:sourceFile | 删除知识块 |
| POST | /analyze/certificate | PDF证书 → 推荐列表 |
| POST | /analyze/generate | 选定模板 → 申请预填数据 |
| GET  | /config | 查看AI配置（apiKey掩码） |
| PUT  | /config | 更新AI配置 |
| GET  | /health | 健康检查 |

---

## § 12 关键技术选型说明

| 组件 | 选型 | 原因/限制 |
|------|------|---------|
| LLM | LangChain + ChatOpenAI | 兼容 OpenAI SDK 格式，切换模型只改配置 |
| 向量存储 | SQLite + JSON | 零额外依赖，<1万块时性能可接受 |
| 对话历史 | SQLite | 持久化，重启不丢失 |
| 文档解析 | pdf-parse/mammoth/xlsx | 纯 JS，无需安装系统库 |
| HTTP服务 | Express | 轻量，SSE 原生支持 |
| DB驱动 | better-sqlite3 | 同步 API，避免 async 回调复杂性 |
