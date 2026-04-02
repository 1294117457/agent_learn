# MCP Server — TypeScript 开发指南

> MCP 官方 SDK 是 TypeScript 优先的，TS 开发体验比 Python 更好

---

## 第一部分：核心概念

### 包选择

| 包名 | 作用 |
|------|------|
| `@modelcontextprotocol/sdk` | 官方 MCP SDK（TypeScript 原生） |
| `zod` | Schema 定义和参数验证 |
| `express` | 如果需要 HTTP 传输 |

### TypeScript MCP SDK 的核心类

```typescript
// 两种 Server 创建方式
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

// McpServer（推荐）：更高级的封装，直接用装饰器风格注册
// Server（底层）：手动处理请求，灵活但繁琐
```

### TypeScript MCP 的优势

MCP SDK 本身就是用 TypeScript 写的，JS/TS 开发者使用体验最好：
- 完整的类型定义，IDE 自动补全
- 内置 Zod 集成，参数验证开箱即用
- 与 Node.js 生态无缝对接

### MCP 在保研助手中的角色

```
保研助手 MCP Server 提供的工具：
┌────────────────────────────────────────────────┐
│  Tools                                         │
│  ├── extract_material    提取学生材料结构化数据  │
│  ├── calculate_score     根据政策计算加分        │
│  ├── add_policy          添加政策文档到向量库    │
│  └── query_policy        查询相关政策           │
│                                                │
│  Resources                                     │
│  └── policy://current    当前有效政策文件列表   │
└────────────────────────────────────────────────┘
        ↑ Claude Code / 自定义 Agent 通过 MCP 调用
```

---

## 第二部分：快速上手教程

### 环境准备

```bash
npm install @modelcontextprotocol/sdk zod
# TypeScript 配置同前
```

**重要**：MCP SDK 使用 ESM 模块，需要在 package.json 中设置：
```json
{
  "type": "module"
}
```
或使用 `.mjs` 扩展名。（这是 MCP TypeScript 开发最大的坑，后面详述）

---

### 教程 1：用 McpServer 创建基础 Server

```typescript
// src/mcp/server.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// 创建 Server 实例
const server = new McpServer({
  name: "baoyuan-mcp-server",
  version: "1.0.0",
});

// ─── 注册 Tool：提取学生材料 ───────────────────────────

server.tool(
  "extract_student_material",           // 工具名称
  "从学生提交的文字材料中提取比赛奖项和项目经历", // 描述
  {
    // 用 Zod 定义参数 schema（自动生成 JSON Schema）
    rawText: z.string().describe("学生提交的原始材料文字"),
  },
  async ({ rawText }) => {
    // 调用 LLM 提取数据（复用之前实现的函数）
    try {
      // 这里调用你的提取逻辑
      const result = await extractStudentMaterial(rawText);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `提取失败: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// ─── 注册 Tool：计算加分 ──────────────────────────────

server.tool(
  "calculate_score",
  "根据保研政策计算学生的加分项",
  {
    studentMaterial: z.string().describe("结构化的学生材料（JSON格式）"),
    policyVersion: z.string().optional().describe("指定使用的政策版本，默认使用最新版"),
  },
  async ({ studentMaterial, policyVersion }) => {
    const result = await calculateScore(studentMaterial, policyVersion);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  }
);

// ─── 注册 Tool：添加政策文档 ──────────────────────────

server.tool(
  "add_policy_document",
  "将教师提交的保研政策文档添加到知识库",
  {
    content: z.string().describe("政策文档的文字内容"),
    title: z.string().describe("政策文档标题"),
    effectiveDate: z.string().describe("政策生效日期 YYYY-MM-DD"),
  },
  async ({ content, title, effectiveDate }) => {
    await addPolicyToVectorStore(content, { title, effectiveDate });
    return {
      content: [
        {
          type: "text",
          text: `政策文档 "${title}" 已成功添加到知识库`,
        },
      ],
    };
  }
);

// ─── 注册 Resource：查看当前政策列表 ─────────────────

server.resource(
  "policy://current",
  "当前有效的保研政策文档列表",
  async (uri) => {
    const policies = await getCurrentPolicies();
    return {
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify(policies, null, 2),
        },
      ],
    };
  }
);

// ─── 启动 Server ──────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("保研助手 MCP Server 已启动"); // 注意：用 stderr 输出，避免污染 stdout
}

main().catch((error) => {
  console.error("Server 启动失败:", error);
  process.exit(1);
});
```

---

### 教程 2：完整的生产级 MCP Server

```typescript
// src/mcp/production-server.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic();
const server = new McpServer({
  name: "baoyuan-assistant",
  version: "1.0.0",
});

// 工具1：智能提取
server.tool(
  "extract_material",
  "从学生材料中提取比赛奖项和项目经历，返回结构化 JSON",
  {
    text: z.string().min(10).describe("学生材料原文，至少10个字符"),
    extractType: z
      .enum(["competition", "project", "all"])
      .default("all")
      .describe("提取类型：competition(仅比赛)/project(仅项目)/all(全部)"),
  },
  async ({ text, extractType }) => {
    const typeInstruction =
      extractType === "competition"
        ? "只提取比赛获奖信息，忽略项目经历"
        : extractType === "project"
        ? "只提取项目经历信息，忽略比赛获奖"
        : "提取全部信息";

    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 2048,
      system: `你是一个材料提取专家。${typeInstruction}。严格按照要求的 JSON 格式输出，不要输出其他内容。`,
      tools: [
        {
          name: "output_result",
          description: "输出提取结果",
          input_schema: {
            type: "object" as const,
            properties: {
              competitions: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    name: { type: "string" },
                    level: {
                      type: "string",
                      enum: ["国际级", "国家级", "省级", "校级", "其他"],
                    },
                    award: {
                      type: "string",
                      enum: ["特等奖", "一等奖", "二等奖", "三等奖", "优秀奖", "其他"],
                    },
                    isTeam: { type: "boolean" },
                    year: { type: "number" },
                  },
                  required: ["name", "level", "award", "isTeam", "year"],
                },
              },
              projects: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    name: { type: "string" },
                    role: { type: "string" },
                    level: {
                      type: "string",
                      enum: ["国家级", "省级", "校级", "院级", "其他"],
                    },
                    startDate: { type: "string" },
                    endDate: { type: "string", nullable: true },
                    description: { type: "string" },
                  },
                  required: ["name", "role", "level", "startDate", "description"],
                },
              },
            },
            required: ["competitions", "projects"],
          },
        },
      ],
      tool_choice: { type: "tool", name: "output_result" },
      messages: [{ role: "user", content: `请提取以下材料：\n\n${text}` }],
    });

    const toolUse = response.content.find((b) => b.type === "tool_use");
    if (!toolUse || toolUse.type !== "tool_use") {
      return {
        content: [{ type: "text", text: "提取失败：模型未返回结构化数据" }],
        isError: true,
      };
    }

    return {
      content: [{ type: "text", text: JSON.stringify(toolUse.input, null, 2) }],
    };
  }
);

// 工具2：加分计算（带参数验证）
server.tool(
  "calculate_bonus_score",
  "根据提取的结构化材料计算保研加分，需要先调用 extract_material",
  {
    extractedData: z.string().describe("extract_material 工具返回的 JSON 字符串"),
    policyContext: z
      .string()
      .optional()
      .describe("相关政策条文，不提供则使用默认政策"),
  },
  async ({ extractedData, policyContext }) => {
    let parsedData: any;
    try {
      parsedData = JSON.parse(extractedData);
    } catch {
      return {
        content: [{ type: "text", text: "参数错误：extractedData 不是有效的 JSON" }],
        isError: true,
      };
    }

    const defaultPolicy = `
默认加分政策：
- 国际级比赛：一等奖20分，二等奖15分，三等奖10分
- 国家级比赛：一等奖15分，二等奖10分，三等奖7分
- 省级比赛：一等奖10分，二等奖7分，三等奖5分
- 校级比赛：一等奖5分，二等奖3分，三等奖2分
- 团队奖项加分乘以0.8系数
- 国家级项目：10分
- 省级项目：7分
- 校级项目：5分
    `;

    const policy = policyContext || defaultPolicy;

    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 2048,
      system: `你是一个保研加分计算专家。严格按照政策计算加分，每项要说明依据。`,
      messages: [
        {
          role: "user",
          content: `政策：\n${policy}\n\n学生材料：\n${JSON.stringify(parsedData, null, 2)}\n\n请计算加分，输出 JSON 格式。`,
        },
      ],
    });

    const text = response.content[0];
    return {
      content: [
        {
          type: "text",
          text: text.type === "text" ? text.text : "计算失败",
        },
      ],
    };
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("✅ 保研助手 MCP Server 启动成功");
}

main().catch(console.error);
```

---

### 教程 3：在 Claude Code 中配置使用

**项目级配置**（`.claude/settings.json`）：

```json
{
  "mcpServers": {
    "baoyuan-assistant": {
      "command": "node",
      "args": ["dist/mcp/production-server.js"],
      "cwd": "/path/to/your/project",
      "env": {
        "ANTHROPIC_API_KEY": "sk-ant-xxxxxxxx",
        "OPENAI_API_KEY": "sk-xxxxxxxx",
        "CHROMA_URL": "http://localhost:8000"
      }
    }
  }
}
```

**使用 tsx 直接运行 TypeScript（开发时）**：
```json
{
  "mcpServers": {
    "baoyuan-assistant": {
      "command": "npx",
      "args": ["tsx", "src/mcp/production-server.ts"],
      "cwd": "/path/to/your/project"
    }
  }
}
```

---

### 教程 4：HTTP 传输（供 Java 后端调用）

如果 Java 后端需要调用 MCP Server（而不是 Claude Code），用 HTTP/SSE 传输：

```typescript
// src/mcp/http-server.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";
import { z } from "zod";

const app = express();
app.use(express.json());

const server = new McpServer({
  name: "baoyuan-http-server",
  version: "1.0.0",
});

// 注册工具（与 stdio 版本相同）
server.tool(
  "extract_material",
  "提取学生材料",
  { text: z.string() },
  async ({ text }) => {
    // ... 实现
    return { content: [{ type: "text", text: "result" }] };
  }
);

// HTTP 端点
app.post("/mcp", async (req, res) => {
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => Math.random().toString(36).slice(2),
  });

  res.on("close", () => transport.close());

  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

app.listen(3001, () => {
  console.log("MCP HTTP Server 运行在 http://localhost:3001/mcp");
});
```

---

## 第三部分：坑点解析

### 坑 1：ESM 模块问题（最大的坑）

MCP SDK 强制使用 ESM 模块：

```json
// package.json 必须设置
{ "type": "module" }
```

```json
// tsconfig.json 必须配置
{
  "compilerOptions": {
    "module": "NodeNext",
    "moduleResolution": "NodeNext"
  }
}
```

**连锁问题**：设置 `"type": "module"` 后，`require()` 不能用了，所有导入改 `import`。

**最省事的解决方案**：用 `tsx` 直接运行 `.ts` 文件，不用编译：
```bash
npm install -D tsx
# package.json scripts
"start:mcp": "tsx src/mcp/server.ts"
```

---

### 坑 2：日志输出不能用 console.log

MCP stdio 传输通过**标准输入输出**通信，`console.log` 会污染协议数据：

```typescript
// ❌ 错误：污染 stdout，MCP 通信失败
console.log("Server 已启动");

// ✅ 正确：使用 stderr 输出日志
console.error("Server 已启动");
```

---

### 坑 3：工具返回格式必须严格

```typescript
// ❌ 错误：返回裸字符串
return "结果文本";

// ✅ 正确：返回规定格式
return {
  content: [
    {
      type: "text",
      text: "结果文本",
    },
  ],
};

// 错误情况要标记 isError
return {
  content: [{ type: "text", text: "错误信息" }],
  isError: true,
};
```

---

### 坑 4：Zod Schema 与 JSON Schema 的兼容

MCP SDK 内部会把 Zod schema 转为 JSON Schema，但有些 Zod 特性不被支持：

```typescript
// ✅ 支持
z.string().describe("描述")
z.number().min(0).max(100)
z.enum(["a", "b", "c"])
z.boolean()
z.array(z.string())
z.object({ key: z.string() })
z.optional()

// ⚠️ 可能有问题
z.union([z.string(), z.number()])  // 部分客户端不支持 anyOf
z.record(z.string())               // Map 类型支持有限
z.tuple([z.string(), z.number()])  // 建议改用 object
```

---

### 坑 5：与 Java 后端的集成方式

Java 后端不直接支持 MCP 协议，有两种集成方案：

**方案 A（推荐）：不用 MCP，暴露 REST API**
```
Java 后端 → HTTP 请求 → Node.js Express API → 调用 LLM
```
这是最简单的方案，Node.js 作为 AI 处理服务，Java 作为业务后端。

**方案 B：MCP + Claude Code 作为中间层**
```
Java 后端 → 触发 → Claude Code / Agent（有 MCP）→ MCP Server
```
适合工程师用 Claude Code 辅助开发，不适合生产业务流程。

**方案 C：HTTP 传输 MCP（实验性）**
```
Java 后端 → HTTP POST /mcp → Node.js MCP HTTP Server
```
Java 端需要实现 JSON-RPC 2.0 客户端，成本较高。

---

### 小结：MCP TypeScript 开发要点

```
✅ 用 McpServer（高级API）而不是 Server（底层API）
✅ 参数用 Zod 定义，自动生成 JSON Schema
✅ 日志全部用 console.error，避免污染 stdout
✅ ESM 模块问题：设置 "type": "module" 或用 tsx 直接运行
✅ 工具返回必须是 { content: [{type, text}] } 格式
✅ 与 Java 后端集成优先选 REST API，而非 MCP 协议
```
