# AI Agent 开发学习路径

## Python 版文档（概念入门）

| 文档 | 主题 | 核心内容 |
|------|------|---------|
| [01_LLM.md](./01_LLM.md) | 大语言模型 API | Messages格式、多轮对话、Tool Use、Streaming |
| [02_LangChain.md](./02_LangChain.md) | LangChain 框架 | LCEL管道、RAG、Agent、结构化输出 |
| [03_MCP.md](./03_MCP.md) | 模型上下文协议 | MCP Server开发、工具/资源定义、与Client集成 |
| [04_Skill.md](./04_Skill.md) | Agent 技能系统 | Slash Command、Skill设计、子技能组合 |

## TypeScript/Node.js 版文档（保研助手实战）

| 文档 | 主题 | 核心内容 |
|------|------|---------|
| [05_LLM_TypeScript.md](./05_LLM_TypeScript.md) | LLM API (TS) | @anthropic-ai/sdk、Zod结构化提取、ESM坑点 |
| [06_LangChain_TypeScript.md](./06_LangChain_TypeScript.md) | LangChain.js | PDF解析、Chroma向量库、RAG链、中文分块 |
| [07_MCP_TypeScript.md](./07_MCP_TypeScript.md) | MCP Server (TS) | McpServer、HTTP传输、与Java后端集成方案 |
| [08_Skill_TypeScript.md](./08_Skill_TypeScript.md) | 保研助手完整架构 | Express API、Multer上传、加分计算、Java对接 |

---

## 推荐学习顺序

```
LLM API（基础）
    ↓
LangChain（框架层）
    ↓
MCP（工具扩展）
    ↓
Skill（任务编排）
```

---

## 四者关系速览

```
┌────────────────────────────────────────────────────┐
│                   AI Agent                         │
│                                                    │
│  ┌─────────┐  ┌──────────────┐  ┌───────────────┐ │
│  │  Skill  │  │  LangChain   │  │  MCP Server   │ │
│  │ 任务模板 │  │  编排框架    │  │  工具/数据源   │ │
│  └────┬────┘  └──────┬───────┘  └───────┬───────┘ │
│       └──────────────┴──────────────────┘          │
│                       ↓                            │
│                   LLM API                          │
│              （Claude / GPT / ...）                 │
└────────────────────────────────────────────────────┘
```

- **LLM**：推理引擎，理解语言、生成回复
- **LangChain**：胶水层，连接 LLM 与其他组件
- **MCP**：标准化工具接口，让 Agent 能访问外部系统
- **Skill**：任务标准化，让 Agent 按规范执行复杂任务
