# LLM API — TypeScript/Node.js 开发指南

> 面向场景：保研助手 Agent，对接学生端/教师端 HTTP 接口

---

## 第一部分：核心概念

### 包选择

| 包名 | 版本 | 作用 |
|------|------|------|
| `@anthropic-ai/sdk` | ^0.30+ | 官方 Claude SDK，TypeScript 原生支持 |
| `openai` | ^4.x | OpenAI 官方 SDK（GPT系列） |
| `dotenv` | ^16.x | 读取 `.env` 环境变量 |
| `zod` | ^3.x | 运行时 TypeScript schema 验证（结构化输出必备） |

### TypeScript 与 Python SDK 的核心差异

```
Python SDK                      TypeScript SDK
────────────────────────────────────────────────
client.messages.create()   →   client.messages.create()  ✅ 相同
response.content[0].text  →   response.content[0].text  ✅ 相同
async with stream() as s:  →   使用 async iterator / stream 对象
stream.text_stream         →   stream() 返回 Stream 对象，用 for await
```

### TypeScript 中的类型系统优势

TypeScript SDK 提供完整类型定义，在 IDE 中有完整的代码补全和类型检查：

```typescript
import Anthropic from "@anthropic-ai/sdk";

// 类型推断：response 自动推断为 Message 类型
const response = await client.messages.create({ ... });

// content 块有判别联合类型
for (const block of response.content) {
  if (block.type === "text") {
    console.log(block.text);  // TS 知道这里有 .text 属性
  }
  if (block.type === "tool_use") {
    console.log(block.input); // TS 知道这里有 .input 属性
  }
}
```

### 异步模型

Node.js 是单线程事件循环，天然适合 LLM 的 I/O 密集场景：

```
Python 异步：asyncio + async/await（需要显式创建事件循环）
Node.js 异步：原生 Promise + async/await（事件循环内置，更简单）
```

---

## 第二部分：快速上手教程

### 环境准备

```bash
mkdir baoyuan-agent && cd baoyuan-agent
npm init -y
npm install @anthropic-ai/sdk zod dotenv
npm install -D typescript @types/node ts-node tsx
npx tsc --init
```

`tsconfig.json` 关键配置：
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "lib": ["ES2022"],
    "strict": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "outDir": "./dist",
    "rootDir": "./src"
  }
}
```

`.env` 文件：
```
ANTHROPIC_API_KEY=sk-ant-xxxxxxxx
```

---

### 教程 1：基础调用

```typescript
// src/llm/client.ts
import Anthropic from "@anthropic-ai/sdk";
import "dotenv/config";

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

async function chat(userMessage: string): Promise<string> {
  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1024,
    messages: [{ role: "user", content: userMessage }],
  });

  // TypeScript 类型安全：需要判断 content 类型
  const firstBlock = response.content[0];
  if (firstBlock.type !== "text") {
    throw new Error("期望 text 类型响应");
  }
  return firstBlock.text;
}

// 测试
chat("什么是保研？").then(console.log);
```

---

### 教程 2：流式输出（Streaming）

```typescript
// src/llm/stream.ts
import Anthropic from "@anthropic-ai/sdk";
import "dotenv/config";

const client = new Anthropic();

async function streamChat(prompt: string): Promise<string> {
  let fullText = "";

  // TypeScript 方式：使用 stream() 方法
  const stream = await client.messages.stream({
    model: "claude-sonnet-4-6",
    max_tokens: 2048,
    messages: [{ role: "user", content: prompt }],
  });

  // 方式一：逐 chunk 处理（适合 SSE 推送给前端）
  for await (const chunk of stream) {
    if (
      chunk.type === "content_block_delta" &&
      chunk.delta.type === "text_delta"
    ) {
      process.stdout.write(chunk.delta.text);
      fullText += chunk.delta.text;
    }
  }

  // 方式二：直接等待最终文本（更简单）
  // const finalMessage = await stream.finalMessage();
  // return finalMessage.content[0].text;

  return fullText;
}

streamChat("列出3条保研加分的常见类型").then(() => console.log("\n完成"));
```

---

### 教程 3：结构化提取（保研核心功能）

这是保研助手最核心的功能——从学生提交的文字/PDF中提取结构化数据。

```typescript
// src/llm/extractor.ts
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

const client = new Anthropic();

// 用 Zod 定义数据结构
const CompetitionAwardSchema = z.object({
  name: z.string().describe("比赛名称"),
  level: z
    .enum(["国际级", "国家级", "省级", "校级", "其他"])
    .describe("比赛层级"),
  award: z
    .enum(["特等奖", "一等奖", "二等奖", "三等奖", "优秀奖", "其他"])
    .describe("获奖等级"),
  isTeam: z.boolean().describe("是否为团队奖项"),
  year: z.number().int().describe("获奖年份"),
  description: z.string().optional().describe("补充描述"),
});

const ProjectExperienceSchema = z.object({
  name: z.string().describe("项目名称"),
  role: z.string().describe("在项目中的角色"),
  startDate: z.string().describe("开始时间，格式 YYYY-MM"),
  endDate: z.string().nullable().describe("结束时间，null 表示进行中"),
  level: z
    .enum(["国家级", "省级", "校级", "院级", "其他"])
    .describe("项目级别"),
  description: z.string().describe("项目简介"),
});

const StudentMaterialSchema = z.object({
  competitions: z.array(CompetitionAwardSchema).describe("比赛获奖列表"),
  projects: z.array(ProjectExperienceSchema).describe("项目经历列表"),
  extractionNotes: z.string().describe("提取过程中的备注，如信息不完整的说明"),
});

// 转换 Zod schema 为 Anthropic tool 格式
function zodToAnthropicTool(
  name: string,
  description: string,
  schema: z.ZodObject<any>
) {
  return {
    name,
    description,
    input_schema: {
      type: "object" as const,
      properties: Object.fromEntries(
        Object.entries(schema.shape).map(([key, value]) => {
          const zodField = value as z.ZodTypeAny;
          return [key, zodField.description ? { description: zodField.description } : {}];
        })
      ),
      // 注意：实际项目中用 zod-to-json-schema 包转换更准确
    },
  };
}

type StudentMaterial = z.infer<typeof StudentMaterialSchema>;

async function extractStudentMaterial(
  rawText: string
): Promise<StudentMaterial> {
  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 4096,
    system: `你是一个专业的保研材料分析助手。
你的任务是从学生提交的材料中提取结构化信息。
提取时注意：
- 比赛层级需要根据主办单位判断：教育部/科技部等部委主办 = 国家级
- 如果信息不完整，在 extractionNotes 中说明
- 时间格式统一为 YYYY-MM`,
    tools: [
      {
        name: "extract_student_material",
        description: "提取学生材料中的比赛获奖和项目经历",
        input_schema: {
          type: "object" as const,
          properties: {
            competitions: {
              type: "array",
              description: "比赛获奖列表",
              items: {
                type: "object",
                properties: {
                  name: { type: "string", description: "比赛名称" },
                  level: {
                    type: "string",
                    enum: ["国际级", "国家级", "省级", "校级", "其他"],
                    description: "比赛层级",
                  },
                  award: {
                    type: "string",
                    enum: [
                      "特等奖",
                      "一等奖",
                      "二等奖",
                      "三等奖",
                      "优秀奖",
                      "其他",
                    ],
                    description: "获奖等级",
                  },
                  isTeam: { type: "boolean", description: "是否为团队奖项" },
                  year: { type: "number", description: "获奖年份" },
                  description: { type: "string", description: "补充描述" },
                },
                required: ["name", "level", "award", "isTeam", "year"],
              },
            },
            projects: {
              type: "array",
              description: "项目经历列表",
              items: {
                type: "object",
                properties: {
                  name: { type: "string", description: "项目名称" },
                  role: { type: "string", description: "项目角色" },
                  startDate: {
                    type: "string",
                    description: "开始时间 YYYY-MM",
                  },
                  endDate: { type: "string", nullable: true },
                  level: {
                    type: "string",
                    enum: ["国家级", "省级", "校级", "院级", "其他"],
                  },
                  description: { type: "string", description: "项目简介" },
                },
                required: ["name", "role", "startDate", "level", "description"],
              },
            },
            extractionNotes: { type: "string", description: "提取备注" },
          },
          required: ["competitions", "projects", "extractionNotes"],
        },
      },
    ],
    tool_choice: { type: "tool", name: "extract_student_material" },
    messages: [
      {
        role: "user",
        content: `请从以下材料中提取信息：\n\n${rawText}`,
      },
    ],
  });

  // 获取 tool_use block
  const toolUseBlock = response.content.find((b) => b.type === "tool_use");
  if (!toolUseBlock || toolUseBlock.type !== "tool_use") {
    throw new Error("模型未返回结构化数据");
  }

  // 用 Zod 验证并返回类型安全的结果
  return StudentMaterialSchema.parse(toolUseBlock.input);
}

// 测试
const sampleText = `
我是计算机学院大三学生，有以下经历：
1. 2024年参加全国大学生数学建模竞赛，获得全国二等奖（团队，3人）
2. 2023年参加省级ACM程序设计大赛，个人赛银奖
3. 参与国家自然科学基金项目"深度学习在医疗影像中的应用"，担任研究助理，2023年3月至今
`;

extractStudentMaterial(sampleText).then((result) => {
  console.log(JSON.stringify(result, null, 2));
});
```

---

### 教程 4：多轮对话 + 上下文管理

```typescript
// src/llm/conversation.ts
import Anthropic from "@anthropic-ai/sdk";

type Message = Anthropic.MessageParam;

class ConversationManager {
  private client: Anthropic;
  private history: Message[] = [];
  private systemPrompt: string;

  constructor(systemPrompt: string) {
    this.client = new Anthropic();
    this.systemPrompt = systemPrompt;
  }

  async chat(userInput: string): Promise<string> {
    this.history.push({ role: "user", content: userInput });

    const response = await this.client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 2048,
      system: this.systemPrompt,
      messages: this.history,
    });

    const textBlock = response.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      throw new Error("无文本响应");
    }

    this.history.push({ role: "assistant", content: textBlock.text });

    // 历史截断：超过20轮时保留最近15轮（避免 token 爆炸）
    if (this.history.length > 40) {
      this.history = this.history.slice(-30);
    }

    return textBlock.text;
  }

  clearHistory() {
    this.history = [];
  }
}

export { ConversationManager };
```

---

## 第三部分：坑点解析

### 坑 1：ESM vs CommonJS 混用问题

**现象**：`import Anthropic from "@anthropic-ai/sdk"` 报错，或运行时 `require` 找不到模块。

**原因**：Node.js 的模块系统有 ESM（`import`）和 CJS（`require`）两套，部分包只支持其中一种。

```json
// package.json 的两种方案
// 方案A：使用 CommonJS（更兼容，推荐新手）
{ "type": "commonjs" }

// 方案B：使用 ESM（现代，但有更多配置）
{ "type": "module" }
// 同时 tsconfig.json 设置 "module": "ESNext", "moduleResolution": "bundler"
```

**推荐**：保研助手这种服务端项目，用 CommonJS + `ts-node` 最省事。

---

### 坑 2：流式响应的类型判断

```typescript
// ❌ 错误：直接访问 delta.text 可能报 TS 错误
for await (const chunk of stream) {
  console.log(chunk.delta.text); // TS 报错：delta 可能没有 text 属性
}

// ✅ 正确：先判断类型
for await (const chunk of stream) {
  if (
    chunk.type === "content_block_delta" &&
    chunk.delta.type === "text_delta"
  ) {
    process.stdout.write(chunk.delta.text); // 类型安全
  }
}
```

---

### 坑 3：Tool Use 的 `tool_choice` 强制调用

```typescript
// 不设置 tool_choice 时，模型可能直接回答文字而不调用工具
// 提取结构化数据时务必强制指定：
tool_choice: { type: "tool", name: "extract_student_material" }
```

---

### 坑 4：JSON Schema 与 Zod 的转换

手写 JSON Schema 容易出错，用 `zod-to-json-schema` 自动转换：

```bash
npm install zod-to-json-schema
```

```typescript
import { zodToJsonSchema } from "zod-to-json-schema";
import { z } from "zod";

const MySchema = z.object({ name: z.string(), age: z.number() });

const jsonSchema = zodToJsonSchema(MySchema, { target: "openApi3" });

// 直接用于 Anthropic input_schema
const tool = {
  name: "my_tool",
  description: "...",
  input_schema: jsonSchema as any,
};
```

---

### 坑 5：并发请求与速率限制

保研系统可能多名学生同时提交，需要控制并发：

```typescript
import PQueue from "p-queue"; // npm install p-queue

// 限制同时最多 3 个 API 请求（避免触发速率限制）
const queue = new PQueue({ concurrency: 3 });

async function processStudents(students: string[]) {
  const results = await Promise.all(
    students.map((text) =>
      queue.add(() => extractStudentMaterial(text))
    )
  );
  return results;
}
```

---

### 小结：TypeScript LLM 开发要点

```
✅ 用 @anthropic-ai/sdk 官方包，有完整 TS 类型支持
✅ 用 zod + zod-to-json-schema 定义和验证结构化输出
✅ tool_choice 强制工具调用，确保返回结构化数据
✅ 注意 ESM/CJS 模块系统问题，新手推荐 CommonJS
✅ 流式输出需要判断 chunk.type 才能安全访问属性
✅ 用 p-queue 控制并发，避免触发 API 速率限制
```
