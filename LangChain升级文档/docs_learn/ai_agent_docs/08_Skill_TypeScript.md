# Skill 系统 + 保研助手完整架构 — TypeScript 开发指南

> 本文档综合 Skill 设计、Express API 服务、Java 对接方案，并给出保研助手完整架构

---

## 第一部分：核心概念

### TypeScript 环境下的 Skill

在 TypeScript/Node.js 项目中，Skill 不再是单纯的 Markdown 文件，而是：

```
Markdown Skill（Claude Code 环境）
  └─ .claude/commands/extract.md
  └─ 用户手动触发，适合开发辅助

TypeScript Skill（生产 Agent 环境）
  └─ 封装为 async 函数 + Express 路由
  └─ 被 API 调用触发，适合业务系统
```

**保研助手中，Skill = 标准化的业务流程函数**：

| Skill 名称 | 输入 | 输出 | 触发方式 |
|-----------|------|------|---------|
| `extractMaterial` | PDF/文字 | 结构化JSON | 学生端 POST /extract |
| `calculateScore` | 结构化JSON | 加分明细 | 学生端 POST /score |
| `addPolicy` | PDF/文字 | 成功/失败 | 教师端 POST /policy |
| `queryPolicy` | 问题文字 | 政策解释 | 双端 POST /query |

### 保研助手完整系统架构

```
┌─────────────────────────────────────────────────────────────┐
│                    学生端 / 教师端 前端                       │
└────────────────────────┬────────────────────────────────────┘
                         │ HTTP
┌────────────────────────▼────────────────────────────────────┐
│                   Java Spring Boot 后端                      │
│  - 用户认证（JWT）                                           │
│  - 业务数据存储（MySQL）                                      │
│  - 文件存储（OSS）                                           │
└────────────────────────┬────────────────────────────────────┘
                         │ HTTP（内部调用）
┌────────────────────────▼────────────────────────────────────┐
│               Node.js AI Agent 服务（本项目）                 │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐  │
│  │                   Express Router                      │  │
│  │  POST /api/extract  POST /api/score  POST /api/policy │  │
│  └──────────────────┬───────────────────────────────────┘  │
│                     ↓                                       │
│  ┌──────────────────────────────────────────────────────┐  │
│  │                  Skill Manager                        │  │
│  │  extractMaterial / calculateScore / addPolicy         │  │
│  └──────┬───────────────────────┬────────────────────────┘  │
│         ↓                       ↓                           │
│  ┌─────────────┐       ┌───────────────────┐               │
│  │  Claude API  │       │   向量数据库        │               │
│  │  (LLM推理)   │       │  (Chroma/pgvector) │               │
│  └─────────────┘       └───────────────────┘               │
└─────────────────────────────────────────────────────────────┘
```

---

## 第二部分：快速上手教程

### 环境准备

```bash
npm install express multer cors helmet
npm install @anthropic-ai/sdk @langchain/anthropic @langchain/openai
npm install @langchain/community @langchain/textsplitters langchain
npm install chromadb zod dotenv p-queue
npm install -D @types/express @types/multer @types/cors typescript tsx
```

---

### 教程 1：项目结构

```
src/
├── skills/                    # Skill 函数（核心业务逻辑）
│   ├── extractMaterial.ts     # 材料提取 Skill
│   ├── calculateScore.ts      # 加分计算 Skill
│   ├── addPolicy.ts           # 添加政策 Skill
│   └── index.ts               # 统一导出
├── vectorstore/
│   └── policyStore.ts         # 向量库操作
├── llm/
│   └── client.ts              # LLM 客户端封装
├── routes/
│   ├── student.ts             # 学生端路由
│   └── teacher.ts             # 教师端路由
├── middleware/
│   ├── auth.ts                # 认证中间件
│   └── upload.ts              # 文件上传配置
└── app.ts                     # Express 入口
```

---

### 教程 2：材料提取 Skill

```typescript
// src/skills/extractMaterial.ts
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

const client = new Anthropic();

// ─── 数据模型定义 ─────────────────────────────────────

export const CompetitionSchema = z.object({
  name: z.string().describe("比赛名称"),
  level: z.enum(["国际级", "国家级", "省级", "校级", "其他"]),
  award: z.enum(["特等奖", "一等奖", "二等奖", "三等奖", "优秀奖", "其他"]),
  isTeam: z.boolean().describe("是否团队项目"),
  memberCount: z.number().optional().describe("团队人数"),
  year: z.number().int().min(2000).max(2030),
  organizer: z.string().optional().describe("主办单位"),
  certificateNumber: z.string().optional().describe("证书编号"),
});

export const ProjectSchema = z.object({
  name: z.string().describe("项目名称"),
  role: z.string().describe("担任角色"),
  level: z.enum(["国家级", "省级", "校级", "院级", "其他"]),
  startDate: z.string().regex(/^\d{4}-\d{2}$/, "格式必须为 YYYY-MM"),
  endDate: z.string().regex(/^\d{4}-\d{2}$/).nullable(),
  fundingSource: z.string().optional().describe("资助来源/项目编号"),
  description: z.string(),
});

export const ExtractionResultSchema = z.object({
  competitions: z.array(CompetitionSchema),
  projects: z.array(ProjectSchema),
  confidence: z.enum(["high", "medium", "low"]).describe("提取置信度"),
  missingInfo: z.array(z.string()).describe("缺失或不明确的信息列表"),
});

export type ExtractionResult = z.infer<typeof ExtractionResultSchema>;

// ─── Skill 函数 ───────────────────────────────────────

export async function extractMaterial(rawText: string): Promise<ExtractionResult> {
  const jsonSchema = zodToJsonSchema(ExtractionResultSchema, {
    name: "ExtractionResult",
    target: "openApi3",
  });

  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 4096,
    system: `你是一个专业的保研材料分析专家。

任务：从学生提交的材料中精确提取结构化信息。

注意事项：
1. 比赛层级判断依据（优先查看主办单位）：
   - 国际级：国际组织/跨国比赛
   - 国家级：教育部、科技部、工信部等部委，或全国性学会主办
   - 省级：省级政府部门或省级学会主办
   - 校级：学校或学院主办
2. 时间格式统一转换为 YYYY-MM
3. 如果信息模糊或缺失，在 missingInfo 中说明
4. 置信度：信息完整清晰=high，有部分推断=medium，信息很少=low`,
    tools: [
      {
        name: "output_extraction",
        description: "输出提取结果",
        input_schema: (jsonSchema as any).definitions?.ExtractionResult || jsonSchema,
      },
    ],
    tool_choice: { type: "tool", name: "output_extraction" },
    messages: [{ role: "user", content: `请提取以下材料：\n\n${rawText}` }],
  });

  const toolUse = response.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error("提取失败：模型未返回结构化数据");
  }

  // 用 Zod 验证数据完整性
  return ExtractionResultSchema.parse(toolUse.input);
}
```

---

### 教程 3：加分计算 Skill

```typescript
// src/skills/calculateScore.ts
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { ExtractionResult } from "./extractMaterial";
import { getPolicyRetriever } from "../vectorstore/policyStore";

const client = new Anthropic();

export const ScoreItemSchema = z.object({
  itemId: z.string().describe("唯一标识"),
  category: z.enum(["competition", "project"]),
  name: z.string(),
  baseScore: z.number().describe("基础加分"),
  coefficient: z.number().default(1).describe("系数（如团队系数0.8）"),
  finalScore: z.number().describe("最终加分 = baseScore * coefficient"),
  policyBasis: z.string().describe("政策条文依据"),
  notes: z.string().optional(),
});

export const ScoreResultSchema = z.object({
  items: z.array(ScoreItemSchema),
  totalScore: z.number(),
  breakdown: z.object({
    competitionScore: z.number(),
    projectScore: z.number(),
  }),
  summary: z.string(),
  warnings: z.array(z.string()).describe("警告信息，如某项可能不符合政策"),
});

export type ScoreResult = z.infer<typeof ScoreResultSchema>;

export async function calculateScore(
  extractedData: ExtractionResult,
  options?: { policyVersion?: string }
): Promise<ScoreResult> {
  // 从向量库检索相关政策
  let policyContext = "";
  try {
    const retriever = await getPolicyRetriever();
    const query = extractedData.competitions
      .map((c) => `${c.level}${c.award}比赛加分`)
      .concat(extractedData.projects.map((p) => `${p.level}项目经历加分`))
      .join("，");

    const relevantDocs = await retriever.invoke(query);
    policyContext = relevantDocs.map((d) => d.pageContent).join("\n\n");
  } catch (error) {
    // 向量库不可用时使用默认政策
    console.error("向量库不可用，使用默认政策:", error);
    policyContext = DEFAULT_POLICY;
  }

  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 4096,
    system: `你是一个保研加分计算专家。

政策文件：
${policyContext}

计算规则：
- 严格按照政策文件中的标准，没有政策依据的项目不得加分
- 团队奖项系数通常为 0.8（除非政策特别说明）
- 同一比赛的不同奖项不重复计算
- 在 policyBasis 中引用政策原文`,
    tools: [
      {
        name: "output_score",
        description: "输出加分计算结果",
        input_schema: {
          type: "object" as const,
          properties: {
            items: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  itemId: { type: "string" },
                  category: { type: "string", enum: ["competition", "project"] },
                  name: { type: "string" },
                  baseScore: { type: "number" },
                  coefficient: { type: "number" },
                  finalScore: { type: "number" },
                  policyBasis: { type: "string" },
                  notes: { type: "string" },
                },
                required: ["itemId", "category", "name", "baseScore", "coefficient", "finalScore", "policyBasis"],
              },
            },
            totalScore: { type: "number" },
            breakdown: {
              type: "object",
              properties: {
                competitionScore: { type: "number" },
                projectScore: { type: "number" },
              },
              required: ["competitionScore", "projectScore"],
            },
            summary: { type: "string" },
            warnings: { type: "array", items: { type: "string" } },
          },
          required: ["items", "totalScore", "breakdown", "summary", "warnings"],
        },
      },
    ],
    tool_choice: { type: "tool", name: "output_score" },
    messages: [
      {
        role: "user",
        content: `请计算以下学生材料的保研加分：\n${JSON.stringify(extractedData, null, 2)}`,
      },
    ],
  });

  const toolUse = response.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error("加分计算失败");
  }

  return ScoreResultSchema.parse(toolUse.input);
}

const DEFAULT_POLICY = `
默认保研加分政策：
竞赛类：
- 国际级：一等奖20分、二等奖15分、三等奖10分
- 国家级：一等奖15分、二等奖10分、三等奖7分
- 省级：一等奖10分、二等奖7分、三等奖5分
- 校级：一等奖5分、二等奖3分、三等奖2分
团队项目系数：0.8

科研项目类：
- 国家级项目（主持）：10分
- 国家级项目（参与）：6分
- 省级项目（主持）：7分
- 省级项目（参与）：4分
- 校级项目：3分
`;
```

---

### 教程 4：Express API 服务（对接 Java 后端）

```typescript
// src/app.ts
import express from "express";
import cors from "cors";
import helmet from "helmet";
import multer from "multer";
import { extractMaterial } from "./skills/extractMaterial";
import { calculateScore } from "./skills/calculateScore";
import { addPolicyFromText, addPolicyFromPDF } from "./skills/addPolicy";
import { processPDFBuffer } from "./loaders/pdfLoader";

const app = express();

// 中间件
app.use(helmet());
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(",") || ["http://localhost:8080"],
}));
app.use(express.json({ limit: "10mb" }));

// 文件上传（内存存储，不写磁盘）
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
  fileFilter: (req, file, cb) => {
    const allowed = ["application/pdf", "text/plain"];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("只支持 PDF 和 TXT 文件"));
    }
  },
});

// 简单的内部服务认证（Java 后端调用时带上此 Header）
function requireInternalAuth(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) {
  const token = req.headers["x-internal-token"];
  if (token !== process.env.INTERNAL_API_TOKEN) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}

// ─── 学生端接口 ────────────────────────────────────────

/**
 * 提取材料接口
 * Java 后端调用：传入文字或 PDF，返回结构化数据
 */
app.post(
  "/api/student/extract",
  requireInternalAuth,
  upload.single("file"),
  async (req, res) => {
    try {
      let rawText: string;

      if (req.file) {
        // 上传了 PDF 文件
        const docs = await processPDFBuffer(req.file.buffer, req.file.originalname);
        rawText = docs.map((d) => d.pageContent).join("\n\n");
      } else if (req.body.text) {
        // 纯文字输入
        rawText = req.body.text;
      } else {
        res.status(400).json({ error: "请提供文字或上传 PDF 文件" });
        return;
      }

      const result = await extractMaterial(rawText);
      res.json({ success: true, data: result });
    } catch (error) {
      console.error("提取失败:", error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : "提取失败",
      });
    }
  }
);

/**
 * 加分计算接口
 * Java 后端调用：传入提取结果，返回加分明细
 */
app.post("/api/student/score", requireInternalAuth, async (req, res) => {
  try {
    const { extractedData } = req.body;
    if (!extractedData) {
      res.status(400).json({ error: "缺少 extractedData 参数" });
      return;
    }

    const result = await calculateScore(extractedData);
    res.json({ success: true, data: result });
  } catch (error) {
    console.error("加分计算失败:", error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "计算失败",
    });
  }
});

/**
 * 一站式处理接口（提取 + 计算合并）
 */
app.post(
  "/api/student/process",
  requireInternalAuth,
  upload.single("file"),
  async (req, res) => {
    try {
      let rawText: string;

      if (req.file) {
        const docs = await processPDFBuffer(req.file.buffer, req.file.originalname);
        rawText = docs.map((d) => d.pageContent).join("\n\n");
      } else {
        rawText = req.body.text;
      }

      // 串行执行两个 Skill
      const extracted = await extractMaterial(rawText);
      const scored = await calculateScore(extracted);

      res.json({
        success: true,
        data: {
          extracted,  // 结构化提取结果
          scored,     // 加分计算结果
        },
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : "处理失败",
      });
    }
  }
);

// ─── 教师端接口 ────────────────────────────────────────

/**
 * 上传政策文档接口
 */
app.post(
  "/api/teacher/policy",
  requireInternalAuth,
  upload.single("file"),
  async (req, res) => {
    try {
      const { title, effectiveDate } = req.body;

      if (!title || !effectiveDate) {
        res.status(400).json({ error: "缺少 title 或 effectiveDate 参数" });
        return;
      }

      if (req.file) {
        await addPolicyFromPDF(req.file.buffer, req.file.originalname, {
          title,
          effectiveDate,
        });
      } else if (req.body.content) {
        await addPolicyFromText(req.body.content, { title, effectiveDate });
      } else {
        res.status(400).json({ error: "请提供文字内容或上传 PDF 文件" });
        return;
      }

      res.json({ success: true, message: `政策 "${title}" 已成功添加` });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : "添加政策失败",
      });
    }
  }
);

// ─── 健康检查 ──────────────────────────────────────────

app.get("/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// ─── 全局错误处理 ──────────────────────────────────────

app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error(err.stack);
  res.status(500).json({ error: err.message });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`保研助手 Agent 服务运行在 http://localhost:${PORT}`);
});

export default app;
```

---

### 教程 5：Java 后端调用 Node.js 服务

Java 侧（Spring Boot）调用 Node.js AI 服务：

```java
// BaoYuanAiService.java
@Service
public class BaoYuanAiService {

    @Value("${ai.service.url:http://localhost:3000}")
    private String aiServiceUrl;

    @Value("${ai.service.internal-token}")
    private String internalToken;

    private final RestTemplate restTemplate;

    public BaoYuanAiService(RestTemplate restTemplate) {
        this.restTemplate = restTemplate;
    }

    public ProcessResult processStudentMaterial(String text) {
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        headers.set("x-internal-token", internalToken);

        Map<String, String> body = Map.of("text", text);
        HttpEntity<Map<String, String>> request = new HttpEntity<>(body, headers);

        ResponseEntity<ProcessResult> response = restTemplate.postForEntity(
            aiServiceUrl + "/api/student/process",
            request,
            ProcessResult.class
        );

        return response.getBody();
    }

    // 上传 PDF 文件
    public ProcessResult processStudentPDF(MultipartFile file) throws IOException {
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.MULTIPART_FORM_DATA);
        headers.set("x-internal-token", internalToken);

        MultiValueMap<String, Object> body = new LinkedMultiValueMap<>();
        body.add("file", new ByteArrayResource(file.getBytes()) {
            @Override
            public String getFilename() { return file.getOriginalFilename(); }
        });

        HttpEntity<MultiValueMap<String, Object>> request = new HttpEntity<>(body, headers);
        ResponseEntity<ProcessResult> response = restTemplate.postForEntity(
            aiServiceUrl + "/api/student/process",
            request,
            ProcessResult.class
        );

        return response.getBody();
    }
}
```

---

## 第三部分：坑点解析

### 坑 1：Multer 与 TypeScript 类型

```typescript
// ❌ TypeScript 报错：req.file 可能是 undefined
app.post("/upload", upload.single("file"), async (req, res) => {
  const buffer = req.file.buffer; // 可能 undefined
});

// ✅ 类型检查
app.post("/upload", upload.single("file"), async (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: "未上传文件" });
    return; // return 后 TS 知道下面 req.file 一定存在
  }
  const buffer = req.file.buffer; // ✅ 类型安全
});
```

---

### 坑 2：Express 路由处理函数的类型

```typescript
// ❌ 混用 async 和同步导致未捕获的 Promise rejection
app.get("/api/test", async (req, res) => {
  throw new Error("未处理的错误"); // Express 捕获不到 async 错误
});

// ✅ 方案1：手动 try-catch
app.get("/api/test", async (req, res) => {
  try {
    const result = await someAsyncOperation();
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// ✅ 方案2：封装 asyncHandler（推荐）
function asyncHandler(fn: express.RequestHandler): express.RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

app.get("/api/test", asyncHandler(async (req, res) => {
  const result = await someAsyncOperation();
  res.json(result);
}));
```

---

### 坑 3：PDF 中文乱码

`pdf-parse` 处理某些中文 PDF 会出现乱码：

```typescript
// 问题：部分中文 PDF 使用非标准编码
// 解决方案1：使用 pdfjs-dist（更强的解析能力）
npm install pdfjs-dist

// 解决方案2：在 PDFLoader 中指定
const loader = new PDFLoader(filePath, {
  pdfjs: () => import("pdfjs-dist/legacy/build/pdf.mjs"),
});

// 解决方案3：前端上传前转换为 UTF-8 文本
// 如果 PDF 质量很差，考虑让用户直接复制文字提交
```

---

### 坑 4：LLM 调用超时

AI 请求通常需要 10-30 秒，Express 默认超时可能导致问题：

```typescript
// Java 后端的 RestTemplate 也需要设置足够的超时
@Bean
public RestTemplate restTemplate() {
    HttpComponentsClientHttpRequestFactory factory =
        new HttpComponentsClientHttpRequestFactory();
    factory.setConnectionTimeout(5000);
    factory.setReadTimeout(60000);  // AI 请求可能需要 60 秒
    return new RestTemplate(factory);
}

// Node.js 侧：给 Anthropic 客户端设置超时
const client = new Anthropic({
  timeout: 60000,  // 60 秒
  maxRetries: 2,   // 失败自动重试 2 次
});
```

---

### 坑 5：并发请求下的向量库性能

Chroma HTTP 客户端在高并发时可能成为瓶颈：

```typescript
// 方案1：使用连接池（Chroma JS 客户端本身支持）

// 方案2：查询结果缓存（相同问题不重复查库）
import NodeCache from "node-cache"; // npm install node-cache
const cache = new NodeCache({ stdTTL: 300 }); // 缓存5分钟

async function cachedPolicyQuery(query: string) {
  const cacheKey = `policy:${query}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const result = await getPolicyRetriever().then(r => r.invoke(query));
  cache.set(cacheKey, result);
  return result;
}

// 方案3：对于保研系统，政策变更不频繁
// 可以在服务启动时预加载所有政策到内存向量库
```

---

### 坑 6：向量库数据的版本管理

政策每年更新，旧数据需要清理：

```typescript
// 在文档 metadata 中存储版本信息
const docsWithMeta = docs.map(doc => ({
  ...doc,
  metadata: {
    ...doc.metadata,
    policyYear: "2025",
    effectiveDate: "2025-09-01",
    isActive: true,
  }
}));

// 查询时过滤只取有效政策
const retriever = vectorstore.asRetriever({
  filter: { isActive: true },
});

// 更新政策时，先标记旧政策为无效
async function deactivateOldPolicy(year: string) {
  // Chroma 支持 metadata 过滤删除
  await collection.delete({
    where: { policyYear: year }
  });
}
```

---

### 补充：需要了解的其他知识

除了四大核心模块，保研助手开发还需要：

#### 文件处理
```
pdf-parse / pdfjs-dist   ← PDF 解析
mammoth                  ← Word 文档解析（npm install mammoth）
multer                   ← Express 文件上传中间件
```

#### 向量数据库选型
```
开发测试：MemoryVectorStore（内存，零配置）
小规模生产：HNSWLib（文件存储，无需服务）
中大规模：Chroma（需要 Docker 服务）
企业级：pgvector（PostgreSQL 扩展，与业务 DB 合并）
          Pinecone（云服务，按用量计费）
```

#### 与 Java 后端集成
```
认证方案：内部服务用共享密钥（x-internal-token header）
协议：REST JSON（最简单）
部署：同机器不同端口 或 Docker Compose
注意：设置足够长的超时时间（AI 调用可能 30-60s）
```

#### 监控与可观测性
```
pino / winston           ← 结构化日志
@opentelemetry/sdk-node  ← 链路追踪
langsmith                ← LangChain 专属的调用追踪（调试神器）
```

---

### 小结：保研助手 TypeScript 开发要点

```
✅ Skill = async 函数 + Zod 类型定义，是核心业务单元
✅ Express 暴露 REST API，Java 后端通过 HTTP 调用
✅ 文件上传用 multer，PDF 解析用 pdf-parse（注意中文乱码）
✅ async 路由必须用 try-catch 或 asyncHandler 包装
✅ LLM 调用超时设 60s，Java 的 RestTemplate 也要同步设置
✅ 向量库给文档加 metadata（年份/是否有效），便于后续管理
✅ 高并发下对 LLM 请求用 p-queue 限流，对政策查询加缓存
```
