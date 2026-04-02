# LangChain.js — TypeScript 开发指南

> 面向场景：保研助手 RAG 系统，处理政策文档、PDF材料

---

## 第一部分：核心概念

### LangChain.js 包结构（必须了解）

LangChain.js 采用 monorepo 结构，按需安装子包，避免安装无用依赖：

| 包名 | 作用 |
|------|------|
| `langchain` | 核心包，Chain、工具函数等 |
| `@langchain/core` | 基础抽象（Runnable、PromptTemplate 等） |
| `@langchain/anthropic` | Claude 模型集成 |
| `@langchain/openai` | OpenAI 模型 + Embeddings |
| `@langchain/community` | 社区集成（PDF加载、向量库等） |
| `@langchain/textsplitters` | 文本分块工具 |

### Python vs JavaScript LangChain 的差异

```
Python                              JavaScript
────────────────────────────────────────────────────────
from langchain_anthropic import   →  import { ChatAnthropic }
  ChatAnthropic                         from "@langchain/anthropic"

from langchain_community           →  import { PDFLoader }
  .document_loaders import PDFLoader     from "@langchain/community/
                                          document_loaders/fs/pdf"

FAISS 向量库（Python）            →  MemoryVectorStore / Chroma
                                       （FAISS 在 JS 中支持有限）

ConversationBufferMemory           →  InMemoryChatMessageHistory
  （旧API，Python仍常用）               （新 API，JS 推荐用法）
```

### 保研助手中 LangChain.js 的核心用途

```
教师端提交政策文档
      ↓
PDF/Word 解析（PDFLoader）
      ↓
文本分块（RecursiveCharacterTextSplitter）
      ↓
向量化（OpenAI Embeddings / 本地模型）
      ↓
存入向量库（Chroma / Pinecone / pgvector）

学生端提交材料
      ↓
从向量库检索相关政策
      ↓
RAG Chain：政策上下文 + 学生材料 → Claude 计算加分
      ↓
返回结构化加分结果给 Java 后端
```

---

## 第二部分：快速上手教程

### 环境准备

```bash
npm install langchain @langchain/core @langchain/anthropic @langchain/openai
npm install @langchain/community @langchain/textsplitters
npm install chromadb          # 向量数据库客户端
npm install pdf-parse          # PDF 解析底层依赖（PDFLoader 需要）
npm install @types/pdf-parse -D
```

> **重要**：`pdf-parse` 是 `PDFLoader` 的底层依赖，必须单独安装。

---

### 教程 1：基础 LCEL Chain（TypeScript 版）

```typescript
// src/chains/basic.ts
import { ChatAnthropic } from "@langchain/anthropic";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { StringOutputParser } from "@langchain/core/output_parsers";

const llm = new ChatAnthropic({
  model: "claude-sonnet-4-6",
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const prompt = ChatPromptTemplate.fromMessages([
  ["system", "你是一个保研政策专家，根据以下政策回答问题：\n{policy}"],
  ["human", "{question}"],
]);

const parser = new StringOutputParser();

// LCEL 管道（与 Python 完全相同的 pipe 语法）
const chain = prompt.pipe(llm).pipe(parser);

async function askPolicy(policy: string, question: string): Promise<string> {
  return chain.invoke({ policy, question });
}

export { askPolicy };
```

---

### 教程 2：PDF 解析与文本分块

```typescript
// src/loaders/pdfLoader.ts
import { PDFLoader } from "@langchain/community/document_loaders/fs/pdf";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import type { Document } from "@langchain/core/documents";
import * as fs from "fs";
import * as path from "path";

async function loadPDF(filePath: string): Promise<Document[]> {
  // PDFLoader 需要文件路径（不是 Buffer）
  const loader = new PDFLoader(filePath, {
    // 是否分割每一页（默认 true）
    splitPages: true,
  });

  const docs = await loader.load();
  console.log(`PDF 加载完成：${docs.length} 页`);
  return docs;
}

async function splitDocuments(docs: Document[]): Promise<Document[]> {
  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: 500,      // 每块 500 字符
    chunkOverlap: 50,    // 重叠 50 字符
    // 中文文档建议设置分隔符
    separators: ["\n\n", "\n", "。", "；", "，", " ", ""],
  });

  const chunks = await splitter.splitDocuments(docs);
  console.log(`分块完成：${chunks.length} 个块`);
  return chunks;
}

// 处理上传的 PDF Buffer（来自 Express multer）
async function processPDFBuffer(
  buffer: Buffer,
  filename: string
): Promise<Document[]> {
  // PDFLoader 不直接接受 Buffer，需要先写到临时文件
  const tempPath = path.join("/tmp", filename);
  fs.writeFileSync(tempPath, buffer);

  try {
    const docs = await loadPDF(tempPath);
    return await splitDocuments(docs);
  } finally {
    // 清理临时文件
    fs.unlinkSync(tempPath);
  }
}

export { loadPDF, splitDocuments, processPDFBuffer };
```

---

### 教程 3：向量库（教师端政策存储）

```typescript
// src/vectorstore/policyStore.ts
import { OpenAIEmbeddings } from "@langchain/openai";
import { Chroma } from "@langchain/community/vectorstores/chroma";
import type { Document } from "@langchain/core/documents";

// 使用 OpenAI Embeddings（需要 OPENAI_API_KEY）
// 替代方案：HuggingFaceTransformersEmbeddings（免费但需要本地模型）
const embeddings = new OpenAIEmbeddings({
  model: "text-embedding-3-small", // 便宜且效果好
});

// Chroma 向量数据库（本地运行）
// 启动：docker run -p 8000:8000 chromadb/chroma
const CHROMA_URL = process.env.CHROMA_URL || "http://localhost:8000";
const COLLECTION_NAME = "baoyuan_policies";

async function addPolicyDocuments(docs: Document[]): Promise<void> {
  // 添加元数据
  const docsWithMeta = docs.map((doc, index) => ({
    ...doc,
    metadata: {
      ...doc.metadata,
      addedAt: new Date().toISOString(),
      source: doc.metadata.source || "unknown",
    },
  }));

  await Chroma.fromDocuments(docsWithMeta, embeddings, {
    collectionName: COLLECTION_NAME,
    url: CHROMA_URL,
  });

  console.log(`成功添加 ${docs.length} 个文档块到向量库`);
}

async function getPolicyRetriever() {
  const vectorstore = await Chroma.fromExistingCollection(embeddings, {
    collectionName: COLLECTION_NAME,
    url: CHROMA_URL,
  });

  return vectorstore.asRetriever({
    k: 5, // 返回最相关的5个文档块
    searchType: "similarity",
  });
}

export { addPolicyDocuments, getPolicyRetriever };
```

---

### 教程 4：RAG Chain（保研加分计算核心）

```typescript
// src/chains/scoringChain.ts
import { ChatAnthropic } from "@langchain/anthropic";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { StringOutputParser } from "@langchain/core/output_parsers";
import { RunnablePassthrough, RunnableSequence } from "@langchain/core/runnables";
import { getPolicyRetriever } from "../vectorstore/policyStore";
import type { Document } from "@langchain/core/documents";

const llm = new ChatAnthropic({ model: "claude-sonnet-4-6" });

const SCORING_PROMPT = ChatPromptTemplate.fromMessages([
  [
    "system",
    `你是一个保研加分计算专家。根据以下保研政策文件，对学生提交的材料进行加分计算。

## 保研政策参考
{context}

## 计算要求
1. 严格按照政策文件中的标准进行加分
2. 每项加分要列出对应的政策依据
3. 如果政策文件中没有明确规定，标注"政策未覆盖"
4. 最终输出 JSON 格式的加分明细`,
  ],
  [
    "human",
    `请计算以下学生材料的保研加分：

{studentMaterial}

请输出以下格式的 JSON：
{{
  "items": [
    {{
      "category": "比赛获奖/项目经历",
      "name": "具体名称",
      "score": 加分数值,
      "basis": "政策依据原文",
      "notes": "备注"
    }}
  ],
  "totalScore": 总加分,
  "summary": "加分情况总结"
}}`,
  ],
]);

function formatDocs(docs: Document[]): string {
  return docs.map((doc) => doc.pageContent).join("\n\n---\n\n");
}

async function buildScoringChain() {
  const retriever = await getPolicyRetriever();

  // 类型安全的 LCEL 链
  const chain = RunnableSequence.from([
    {
      context: retriever.pipe(formatDocs),
      studentMaterial: new RunnablePassthrough(),
    },
    SCORING_PROMPT,
    llm,
    new StringOutputParser(),
  ]);

  return chain;
}

interface ScoringItem {
  category: string;
  name: string;
  score: number;
  basis: string;
  notes: string;
}

interface ScoringResult {
  items: ScoringItem[];
  totalScore: number;
  summary: string;
}

async function calculateScore(studentMaterial: string): Promise<ScoringResult> {
  const chain = await buildScoringChain();
  const rawResult = await chain.invoke(studentMaterial);

  // 解析 JSON 输出（处理可能的 markdown 代码块）
  const jsonMatch = rawResult.match(/```json\n?([\s\S]*?)\n?```/) ||
                    rawResult.match(/(\{[\s\S]*\})/);

  if (!jsonMatch) {
    throw new Error("模型未返回有效的 JSON 格式");
  }

  return JSON.parse(jsonMatch[1]);
}

export { calculateScore, ScoringResult };
```

---

### 教程 5：带记忆的对话链（学生咨询功能）

```typescript
// src/chains/consultChain.ts
import { ChatAnthropic } from "@langchain/anthropic";
import { ChatPromptTemplate, MessagesPlaceholder } from "@langchain/core/prompts";
import { StringOutputParser } from "@langchain/core/output_parsers";
import { RunnableWithMessageHistory } from "@langchain/core/runnables";
import { InMemoryChatMessageHistory } from "@langchain/core/chat_history";

const llm = new ChatAnthropic({ model: "claude-sonnet-4-6" });

const prompt = ChatPromptTemplate.fromMessages([
  ["system", "你是一个保研咨询助手，帮助学生了解保研政策和加分规则。"],
  new MessagesPlaceholder("history"),
  ["human", "{input}"],
]);

const chain = prompt.pipe(llm).pipe(new StringOutputParser());

// Session 存储（生产环境应用 Redis 替代）
const sessionStore = new Map<string, InMemoryChatMessageHistory>();

function getSessionHistory(sessionId: string): InMemoryChatMessageHistory {
  if (!sessionStore.has(sessionId)) {
    sessionStore.set(sessionId, new InMemoryChatMessageHistory());
  }
  return sessionStore.get(sessionId)!;
}

const chainWithMemory = new RunnableWithMessageHistory(chain, getSessionHistory, {
  inputMessagesKey: "input",
  historyMessagesKey: "history",
});

async function consult(sessionId: string, question: string): Promise<string> {
  return chainWithMemory.invoke(
    { input: question },
    { configurable: { sessionId } }
  );
}

export { consult };
```

---

## 第三部分：坑点解析

### 坑 1：PDFLoader 的 `pdf-parse` 依赖必须显式安装

```bash
# ❌ 只安装 @langchain/community 不够
npm install @langchain/community

# ✅ 还需要安装底层依赖
npm install pdf-parse
npm install -D @types/pdf-parse
```

**现象**：运行时报 `Cannot find module 'pdf-parse'`，但 @langchain/community 是有的。

---

### 坑 2：Chroma 需要单独启动服务

LangChain.js 的 Chroma 集成是 **HTTP 客户端**，需要本地运行 Chroma 服务：

```bash
# 方式1：Docker（推荐）
docker run -d -p 8000:8000 --name chromadb chromadb/chroma

# 方式2：Python 安装
pip install chromadb
chroma run --host localhost --port 8000
```

**替代方案（无需额外服务）**：
```typescript
// MemoryVectorStore：纯内存，重启丢失，适合开发测试
import { MemoryVectorStore } from "langchain/vectorstores/memory";
const vectorstore = await MemoryVectorStore.fromDocuments(docs, embeddings);

// HNSWLib：文件持久化，无需服务，适合小规模生产
import { HNSWLib } from "@langchain/community/vectorstores/hnswlib";
```

---

### 坑 3：RunnableSequence 的类型推断

```typescript
// ❌ TypeScript 可能推断不出正确类型
const chain = prompt.pipe(llm).pipe(parser);
// 如果中间有复杂分支，类型推断可能失败

// ✅ 用 RunnableSequence.from() 更明确
import { RunnableSequence } from "@langchain/core/runnables";

const chain = RunnableSequence.from([
  prompt,
  llm,
  parser,
]);
```

---

### 坑 4：中文文档分块的分隔符

默认分隔符是英文的，中文文档需要额外配置：

```typescript
// ❌ 默认分隔符可能在句中截断中文
const splitter = new RecursiveCharacterTextSplitter({ chunkSize: 500 });

// ✅ 添加中文标点符号作为分隔符
const splitter = new RecursiveCharacterTextSplitter({
  chunkSize: 500,
  chunkOverlap: 50,
  separators: ["\n\n", "\n", "。", "！", "？", "；", "，", " ", ""],
});
```

---

### 坑 5：Embeddings 的成本与替代方案

OpenAI Embeddings 收费，大量文档时成本高。替代方案：

```typescript
// 方案1：使用更便宜的 OpenAI 模型
const embeddings = new OpenAIEmbeddings({
  model: "text-embedding-3-small",  // 比 ada-002 便宜5倍
});

// 方案2：HuggingFace 本地模型（免费，但需要下载模型）
import { HuggingFaceTransformersEmbeddings } from
  "@langchain/community/embeddings/hf_transformers";
// npm install @xenova/transformers
const embeddings = new HuggingFaceTransformersEmbeddings({
  model: "Xenova/multilingual-e5-small",  // 支持中文的多语言模型
});

// 方案3：Ollama 本地模型（需要安装 Ollama）
import { OllamaEmbeddings } from "@langchain/community/embeddings/ollama";
const embeddings = new OllamaEmbeddings({ model: "nomic-embed-text" });
```

---

### 坑 6：LangChain 版本更新频繁，API 不稳定

LangChain.js 迭代很快，Stack Overflow 或博客上的代码可能已过时。

**建议**：
- 始终查阅官方文档：[js.langchain.com](https://js.langchain.com)
- 锁定版本号：`package-lock.json` 提交到 git
- 遇到 API 变动，先查 [GitHub Releases](https://github.com/langchain-ai/langchainjs/releases)

---

### 小结：LangChain.js 开发要点

```
✅ 按需安装子包（@langchain/anthropic、@langchain/community 等）
✅ PDF 解析需要单独安装 pdf-parse 底层依赖
✅ 中文文档分块要自定义分隔符
✅ 向量库选择：开发用 MemoryVectorStore，生产用 Chroma/pgvector
✅ Embeddings 成本：用 text-embedding-3-small 或本地 HuggingFace 模型
✅ 用 RunnableSequence.from() 构建类型安全的 LCEL 链
✅ LangChain.js API 变动频繁，遇到问题先查官方文档
```
