# Agent 原理概要

> 快速浏览版 · 细节见 `agent-原理细节.md`

---

## 一、系统定位

Agent（ID-AIDemo）是独立的 Node.js HTTP 服务（:3001），只被动响应 idbackend 的 HTTP 调用，不主动连接任何数据库或外部系统。所有业务数据（用户、模板）由 idbackend 维护；Agent 只管 AI 能力。

```
学生/管理员前端
    ↓ REST (JWT)
idbackend :8080   ←→   MySQL / Redis / MinIO
    ↓ HTTP (OkHttp)
ID-AIDemo :3001
    ↓ HTTPS
Qwen API (阿里云)
```

---

## 二、知识库：文件 → 向量的完整流程

```
上传文件 (.pdf/.docx/.xlsx/.md/.txt)
    │
    ▼
docParser  ── 提取纯文本
    │
    ▼
chunkText  ── 滑动窗口分块（500字/块，100字重叠）
    │
    ▼
getEmbeddings ── 批量调用 text-embedding-v3（每批≤6块）
    │
    ▼
SQLite knowledge_chunks
  (source_file, chunk_index, content, embedding: JSON数组)
```

**两种入库途径：**
- 启动时自动：`seedKnowledge` 扫描 `docs/加分文件/`，未入库的文件自动处理
- 运行时上传：管理员 `POST /knowledge/upload` → 同样走上面流程，已入库则先删旧再重建

---

## 三、RAG 聊天流程

```
用户消息
  → 1. Embedding（用户消息 → 向量）
  → 2. 向量检索（内存全量余弦相似度，取 Top-5 知识块）
  → 3. 拼装 Prompt
       [ system_role + 知识库摘录 + 最近6条历史 + 用户消息 ]
  → 4. 调用 Qwen3 LLM
  → 5. 流式返回 token / 保存对话历史
```

---

## 四、证书智能分析流程

```
学生上传 PDF
  → idbackend 从 MySQL 查加分模板
  → 模板 + PDF 一起发给 Agent
  → Agent：PDF解析 → RAG检索 → LLM分析 → 返回推荐列表
  → 学生选择推荐项
  → Agent：LLM生成申请备注（remark）
  → 前端预填申请表单
```

---

## 五、AI 配置管理

- 配置存于 SQLite `ai_config` 表（5个key：system_role / api_key / base_url / chat_model / embedding_model）
- **内存缓存**：写入后 invalidate，下次读时重新从 DB 加载
- **工厂模式**：每次对话调用时新建 `ChatOpenAI` 实例，配置改动立即生效
- API Key 回退链：DB非空值 → 环境变量 `QWEN3_API_KEY`

---

## 六、流式输出（SSE）

```
chatModel.stream()          ← LangChain 流式 API
  → for await chunk          ← AsyncGenerator
    → res.write("data: {...token...}\n\n")   ← Express SSE
      → OkHttp readLine()    ← idbackend 逐行读
        → SseEmitter.send()  ← Spring 透传
          → fetch ReadableStream ← 前端逐字追加
```

历史消息在流完成后（`[DONE]`前）统一保存到 SQLite。

---

## 七、主要优化方向

| 问题 | 当前方案 | 优化建议 |
|------|---------|---------|
| 向量检索慢（全量扫描） | JS内存余弦计算 O(n) | 引入 sqlite-vec 扩展或 Qdrant |
| 对话响应慢 | qwen3-max（30-60s） | 聊天改用 qwen-turbo（3-8s） |
| 分块质量 | 固定500字滑动窗口 | 按段落/语义边界分块 |
| PDF解析局限 | pdf-parse（仅文字型PDF） | 加 OCR 支持扫描件 |
| 无Rerank | Top-5直接喂给LLM | 加 rerank 模型二次排序 |
| 向量模型单一 | 每次请求实时调用 | 高频查询缓存 embedding |
