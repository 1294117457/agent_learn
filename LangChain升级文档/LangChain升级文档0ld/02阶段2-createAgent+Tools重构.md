# 阶段 2：createAgent + Tools 重构方案

> **目标**：将 `analyzeChain.ts` 的线性证书分析流程，升级为基于 `createAgent` + Tool 调用的自主推理 Agent，使其具备多轮自检、动态补充上下文、置信度评估等能力。

---

## 一、当前痛点分析

### 1.1 现有线性流程的问题

当前 `analyzeCertificate()` 的执行路径是固定的单次调用：

```
证书文本
  → getEmbedding()（一次固定检索，Top-5）
  → LCEL chain.invoke()（一次 LLM 调用）
  → 返回 Suggestion[] / 失败
```

**具体问题：**

| 场景 | 现有行为 | 理想行为 |
|------|----------|----------|
| PDF 提到"挑战杯"但未说明等级 | 模型硬猜等级，可能乱填 ruleId | Agent 追加检索政策，反问或标注"证据不足" |
| 证书格式特殊，关键词不在向量检索结果里 | policyContext 为空，靠模型记忆判断 | Agent 换关键词重试检索，扩大 topK |
| 证书包含多个奖项（一文件多证书） | 只分析文本整体，可能漏项 | Agent 逐项抽取，对每项分别匹配模板 |
| 模板列表为空（idbackend 未传入） | 直接返回空数组 | Agent 尝试从 MySQL 获取，或返回带说明的错误 |

### 1.2 核心缺陷根源

```typescript
// analyzeChain.ts 现状：一次性执行，无法回溯
const chain = createAnalyzeCertificateChain()
const result = await chain.invoke({ ... })  // ← 执行完就结束，无法追加上下文
return result  // ← 成功 or 静默失败
```

---

## 二、升级目标与核心思路

### 2.1 升级目标

用 `createAgent` 替换手动 `LCEL chain`，Agent 在内部自主决定：

1. **何时需要补充检索**（调用 `searchPolicyTool`）
2. **如何验证匹配结果**（调用 `validateCertTool`）
3. **何时结果置信度足够可以返回**

### 2.2 Agent 与 LCEL Chain 的根本区别

```
LCEL Chain（现状）          Agent（升级后）
────────────────          ───────────────────────────────────
prompt → model → parser   model → 决策是否调用工具
                              ↓ 调用工具
                          tool执行 → 结果回注
                              ↓
                          model → 决策是否再次调用工具
                              ↓ 不需要了
                          model → 最终输出
```

Agent 的 **工具调用循环** 是关键——模型不再是执行一次就结束，而是可以在多轮工具调用中不断丰富上下文，直到自己认为信息足够才输出结果。

---

## 三、需要安装的新依赖

```bash
npm install langchain @langchain/langgraph
```

| 包 | 用途 |
|----|------|
| `langchain` | 提供 `createAgent`、`tool`、`MemorySaver` 等新统一 API |
| `@langchain/langgraph` | 提供 `MemorySaver`（checkpointer）支持 |

> `@langchain/core` 和 `@langchain/openai` 保持不变，继续使用。

---

## 四、新增文件结构

```
src/
├── tools/                          ← 新增目录
│   ├── searchPolicyTool.ts         ← 知识库检索工具
│   ├── matchTemplateTool.ts        ← 加分模板匹配工具
│   └── validateCertTool.ts         ← 证书信息验证工具
├── agents/                         ← 新增目录
│   └── analyzeAgent.ts             ← 新的分析 Agent 入口
├── chains/
│   └── analyzeChain.ts             ← 保留（generateApplicationRemark 不变）
└── routes/
    └── analyze.ts                  ← 修改：/certificate 路由换用 analyzeAgent
```

---

## 五、三个工具的详细设计

### Tool 1：`searchPolicyTool`（知识库检索）

**职责**：Agent 在需要查阅政策时调用。可多次调用，每次用不同关键词。

**调用时机**：
- 首次分析时自动调用（替代现在固定的一次检索）
- 匹配置信度低时，用更具体的关键词重试

**参数**：
```typescript
z.object({
  query: z.string().describe("检索关键词，如：挑战杯 国家级 加分"),
  topK: z.number().optional().describe("返回条数，默认5，不确定时可用8"),
})
```

**返回值**：格式化的政策文本字符串（供模型直接阅读）

**实现要点**：

```typescript
// src/tools/searchPolicyTool.ts
import { tool } from "langchain/tools"
import { z } from "zod"
import { getEmbedding } from "../services/embeddings.js"
import { searchSimilar } from "../services/vectorStore.js"

export const searchPolicyTool = tool(
  async (input) => {
    const queryVec = await getEmbedding(input.query)
    const chunks = searchSimilar(queryVec, input.topK ?? 5)

    if (chunks.length === 0) {
      return "知识库中未找到与该关键词相关的政策内容。"
    }

    return chunks
      .map((c, i) => `[政策条目 ${i + 1}]（相似度 ${c.similarity.toFixed(3)}）\n${c.content}`)
      .join("\n\n---\n\n")
  },
  {
    name: "search_policy",
    description: "在加分政策知识库中检索与证书或奖项相关的政策条文。当需要了解某类奖项的加分规则、申请条件或等级认定时调用。",
    schema: z.object({
      query: z.string().describe("检索关键词，应包含证书类型、赛事名称、奖项等级等核心词"),
      topK: z.number().optional().describe("返回最相关的条目数量，默认5，信息不足时可增大到8"),
    }),
  }
)
```

---

### Tool 2：`matchTemplateTool`（模板精确匹配）

**职责**：将已确认的证书信息与指定模板的规则进行精确对比，返回置信度打分和匹配理由。

**调用时机**：
- Agent 提取到具体证书信息后，对每个候选模板分别调用
- 用于区分模棱两可的情况（如"国家级奖项"到底匹配一等奖还是二等奖规则）

**参数**：
```typescript
z.object({
  certificateInfo: z.string().describe("从证书中提取的关键信息，如：挑战杯全国一等奖，2024年，队长"),
  templateId: z.number().describe("要匹配的模板 ID"),
  templateName: z.string().describe("模板名称"),
  rules: z.array(z.object({
    ruleId: z.number(),
    ruleName: z.string(),
    ruleScore: z.number(),
  })).describe("该模板下的所有规则"),
})
```

**返回值**：
```typescript
{
  matched: boolean,           // 是否可以匹配
  ruleId: number | null,      // 匹配到的规则 ID
  estimatedScore: number,     // 预计分数
  confidence: "high" | "medium" | "low",  // 置信度
  reason: string,             // 匹配理由或不匹配原因
  missingEvidence: string[]   // 缺少的证据项
}
```

**实现要点**：

```typescript
// src/tools/matchTemplateTool.ts
import { tool } from "langchain/tools"
import { z } from "zod"

const MatchResultSchema = z.object({
  matched: z.boolean(),
  ruleId: z.number().nullable(),
  estimatedScore: z.number(),
  confidence: z.enum(["high", "medium", "low"]),
  reason: z.string(),
  missingEvidence: z.array(z.string()),
})

// 注意：matchTemplateTool 本身不做 LLM 调用
// 它是一个纯逻辑工具，让 Agent 的主模型自己填写匹配结果
// 实际上这个工具的作用是：强制 Agent 以结构化方式输出每个模板的匹配判断
export const matchTemplateTool = tool(
  async (input) => {
    // 工具本体返回格式化摘要，实际判断逻辑在 Agent 的 LLM 推理中完成
    // （Agent 调用此工具时，参数本身就包含了判断结果）
    const result = {
      templateId: input.templateId,
      templateName: input.templateName,
      matched: input.matched,
      ruleId: input.ruleId,
      estimatedScore: input.estimatedScore,
      confidence: input.confidence,
      reason: input.reason,
      missingEvidence: input.missingEvidence,
    }
    return JSON.stringify(result)
  },
  {
    name: "record_template_match",
    description: "记录一个加分模板的匹配判断结果。对每个候选模板分析完成后调用，记录是否匹配、匹配哪条规则、置信度和缺失证据。",
    schema: z.object({
      templateId: z.number().describe("模板 ID"),
      templateName: z.string().describe("模板名称"),
      matched: z.boolean().describe("是否能匹配该模板"),
      ruleId: z.number().nullable().describe("匹配的规则 ID，不匹配时为 null"),
      estimatedScore: z.number().describe("预计分数，不匹配时为 0"),
      confidence: z.enum(["high", "medium", "low"]).describe("匹配置信度"),
      reason: z.string().describe("匹配理由（匹配时）或不匹配原因（不匹配时）"),
      missingEvidence: z.array(z.string()).describe("缺少的证明材料或信息，如：['奖项等级不明确', '缺少颁奖机构信息']"),
    }),
  }
)
```

---

### Tool 3：`validateCertTool`（完整性验证）

**职责**：检查证书文本中是否包含申请所需的关键要素，返回缺失项清单。

**调用时机**：
- 在 Agent 尝试匹配之前调用，先验证证书信息的完整性
- 若发现信息不足，Agent 可决定是否需要补充检索

**参数**：
```typescript
z.object({
  certificateText: z.string().describe("证书原文"),
  checkItems: z.array(z.string()).describe("需要检查的要素"),
})
```

**实现要点**：

```typescript
// src/tools/validateCertTool.ts
import { tool } from "langchain/tools"
import { z } from "zod"

export const validateCertTool = tool(
  async (input) => {
    // 工具返回检查报告，供 Agent 决策下一步
    // 实际校验逻辑由调用时 Agent 的 LLM 自行判断并填写 presentItems/missingItems
    const present = input.presentItems
    const missing = input.missingItems

    if (missing.length === 0) {
      return `✅ 证书信息完整，包含所有必要要素：${present.join("、")}`
    }
    return `⚠️ 证书信息不完整。\n已有：${present.join("、") || "无"}\n缺失：${missing.join("、")}\n建议：${input.suggestion}`
  },
  {
    name: "validate_certificate_info",
    description: "验证证书文本中是否包含申请加分所需的关键信息（如奖项名称、等级、颁奖机构、时间、申请人身份等）。在开始匹配模板前调用。",
    schema: z.object({
      presentItems: z.array(z.string()).describe("证书中已明确包含的信息项，如：['赛事名称:挑战杯', '奖项等级:一等奖', '颁奖时间:2024年6月']"),
      missingItems: z.array(z.string()).describe("证书中缺失或不明确的信息项，如：['颁奖机构不明', '申请人身份(队长/队员)不明']"),
      suggestion: z.string().describe("对缺失信息的处理建议，如：'建议查看政策中对该赛事等级的规定'"),
    }),
  }
)
```

---

## 六、`analyzeAgent.ts` 完整设计

### 6.1 Agent 初始化与 System Prompt

```typescript
// src/agents/analyzeAgent.ts
import { createAgent } from "langchain"
import { ChatOpenAI } from "@langchain/openai"
import { searchPolicyTool } from "../tools/searchPolicyTool.js"
import { matchTemplateTool } from "../tools/matchTemplateTool.js"
import { validateCertTool } from "../tools/validateCertTool.js"
import { getApiKey, getBaseUrl, getChatModel } from "../services/aiConfig.js"
import type { ScoreTemplate } from "../types/scoreTemplate.js"
import type { Suggestion } from "../schemas/analyzeSchemas.js"

// System Prompt：指导 Agent 的分析策略和工具使用顺序
const ANALYZE_SYSTEM_PROMPT = `你是厦门大学信息学院推免加分审核专家。
你将收到一份学生上传的证明材料文本，以及可申请的加分模板列表。

## 你的分析流程（必须按此顺序）

**第一步：验证证书信息**
- 调用 validate_certificate_info，列出证书中已有和缺失的关键信息

**第二步：检索相关政策**
- 调用 search_policy，用证书中的关键词检索加分政策
- 若初次检索结果与证书类型不匹配，换更精确的关键词重试

**第三步：逐模板匹配**
- 对每个可能相关的加分模板，调用 record_template_match 记录判断结果
- 置信度规则：
  - high：证书明确包含奖项等级、颁奖机构、时间，且政策有明确对应条文
  - medium：证书信息部分满足，需合理推断
  - low：证书信息不足，存在较大不确定性

**第四步：汇总输出**
- 只输出 confidence 为 high 或 medium 的匹配结果
- 若所有结果均为 low，输出空数组并说明原因
`

// Context Schema：通过 runtime context 安全传递模板数据（不暴露给 LLM）
// 注意：templates 不放在 prompt 里，而是在工具执行时通过 config.context 获取
```

### 6.2 Agent 调用入口函数

```typescript
// src/agents/analyzeAgent.ts（续）

export interface AnalyzeContext {
  templates: ScoreTemplate[]
  certificateText: string
}

/**
 * 新的证书分析入口，替代 analyzeChain.ts 中的 analyzeCertificate()
 */
export async function runAnalyzeAgent(
  certificateText: string,
  templates: ScoreTemplate[],
): Promise<Suggestion[]> {
  const model = new ChatOpenAI({
    apiKey: getApiKey(),
    configuration: { baseURL: getBaseUrl() },
    modelName: getChatModel(),
    temperature: 0.1,
  })

  // 精简模板，只传给 LLM 必要字段，减少 token 消耗
  const templatesForLLM = templates.map((t) => ({
    id: t.id,
    templateName: t.templateName,
    templateType: t.templateType,
    rules: t.rules.map((r) => ({
      id: r.id,
      ruleName: r.ruleName,
      ruleScore: r.ruleScore,
    })),
  }))

  const agent = createAgent({
    model,
    tools: [searchPolicyTool, matchTemplateTool, validateCertTool],
    systemPrompt: ANALYZE_SYSTEM_PROMPT,
  })

  // 将模板和证书文本注入初始消息
  const initialMessage = `
## 待分析证明材料
${certificateText.slice(0, 2000)}

## 可用加分模板列表
${JSON.stringify(templatesForLLM, null, 2)}

请按照系统要求的步骤分析，并记录每个相关模板的匹配结果。
  `.trim()

  const result = await agent.invoke({
    messages: [{ role: "user", content: initialMessage }],
  })

  // 从 ToolMessage 中提取 record_template_match 的调用结果
  return extractSuggestionsFromAgentResult(result.messages, templates)
}

/**
 * 从 Agent 执行结果的消息链中，提取所有 record_template_match 工具调用的结果
 * 过滤掉 confidence=low 的条目，转换为标准 Suggestion 格式
 */
function extractSuggestionsFromAgentResult(
  messages: unknown[],
  templates: ScoreTemplate[],
): Suggestion[] {
  const suggestions: Suggestion[] = []

  for (const msg of messages) {
    // 找到 ToolMessage（工具返回结果）
    if (
      typeof msg === "object" &&
      msg !== null &&
      "name" in msg &&
      (msg as { name: string }).name === "record_template_match"
    ) {
      try {
        const content = (msg as { content: string }).content
        const matchResult = JSON.parse(content) as {
          templateId: number
          templateName: string
          matched: boolean
          ruleId: number | null
          estimatedScore: number
          confidence: "high" | "medium" | "low"
          reason: string
          missingEvidence: string[]
        }

        // 只收录 matched=true 且 confidence 不为 low 的结果
        if (matchResult.matched && matchResult.ruleId != null && matchResult.confidence !== "low") {
          // 从原始 templates 数组中找到完整的 templateName（防止 LLM 改写）
          const originalTemplate = templates.find((t) => t.id === matchResult.templateId)

          suggestions.push({
            templateId: matchResult.templateId,
            templateName: originalTemplate?.templateName ?? matchResult.templateName,
            ruleId: matchResult.ruleId,
            ruleName:
              originalTemplate?.rules.find((r) => r.id === matchResult.ruleId)?.ruleName ??
              "未知规则",
            estimatedScore: matchResult.estimatedScore,
            reason: matchResult.reason,
          })
        }
      } catch {
        // 解析失败，跳过该条目
      }
    }
  }

  return suggestions
}
```

---

## 七、路由层修改（`analyze.ts`）

```typescript
// src/routes/analyze.ts 修改点
// 将 analyzeCertificate（来自 analyzeChain.ts）替换为 runAnalyzeAgent

// 修改前：
import { analyzeCertificate, generateApplicationRemark } from "../chains/analyzeChain.js"

// 修改后：
import { runAnalyzeAgent } from "../agents/analyzeAgent.js"
import { generateApplicationRemark } from "../chains/analyzeChain.js"  // 备注生成保持不变

// /certificate 路由中：
// 修改前：
const suggestions = await analyzeCertificate(certificateText, templates)

// 修改后：
const suggestions = await runAnalyzeAgent(certificateText, templates)
```

> **注意**：`generateApplicationRemark`（`/analyze/generate` 路由使用）不需要改动，它本身已经是一次性生成任务，LCEL 链完全足够。

---

## 八、新旧流程对比

### 8.1 行为对比

| 维度 | 旧 analyzeChain | 新 analyzeAgent |
|------|----------------|-----------------|
| 知识库检索次数 | 固定 1 次（Top-5） | 1~3 次（Agent 自决） |
| 模板匹配逻辑 | LLM 黑盒一次性判断 | 逐模板显式记录，可追溯 |
| 置信度 | 无概念，只有结果 | 分 high/medium/low，可过滤 |
| 缺失信息反馈 | 静默失败 / 乱猜 | 明确返回 `missingEvidence` |
| 错误恢复 | 无，返回空数组 | Agent 可换词重试检索 |
| 结果可解释性 | 只有 `reason`（50字） | 完整工具调用链，每步可查 |

### 8.2 Token 消耗变化

| 情况 | 旧版（单次调用） | 新版（Agent 多轮） |
|------|-----------------|-------------------|
| 标准证书（信息完整） | ~1500 tokens | ~2500 tokens（多工具调用） |
| 复杂证书（信息不全） | ~1500 tokens（但结果不准） | ~3500 tokens（多次检索） |
| 模板数量多（10+） | ~2000 tokens | ~3000 tokens（按需匹配） |

> **结论**：Token 消耗略有增加，但换来了显著更高的分析准确率和可解释性。

---

## 九、执行流程示例

以"挑战杯全国二等奖"证书为例，Agent 的实际执行轨迹：

```
用户输入：
  证书文本：第十八届挑战杯全国大学生课外学术科技作品竞赛，获得二等奖，2024年6月

Agent 执行轨迹：
  Step 1 → 调用 validate_certificate_info
    presentItems: ["赛事名称:挑战杯", "奖项等级:二等奖", "时间:2024年6月"]
    missingItems: ["颁奖机构不明（全国 vs 学校？）", "申请人身份未标注"]
    → 返回：信息基本完整，但颁奖级别存疑

  Step 2 → 调用 search_policy（query: "挑战杯 全国 加分规则"）
    → 返回：[政策条目1] 学科竞赛加分：国家级二等奖 4.5分，要求颁奖机构为教育部...

  Step 3 → 调用 record_template_match（templateId: 1, 学科竞赛加分）
    matched: true, ruleId: 2, estimatedScore: 4.5
    confidence: "high"（政策明确指出挑战杯为国家级赛事）
    reason: "挑战杯为教育部认定国家级赛事，二等奖对应规则2，4.5分"
    missingEvidence: []

  Step 4 → 最终输出
    Suggestion[]: [{ templateId:1, ruleId:2, estimatedScore:4.5, confidence:"high", ... }]
```

---

## 十、实施步骤清单

| # | 步骤 | 文件 | 备注 |
|---|------|------|------|
| 1 | `npm install langchain @langchain/langgraph` | — | 新增依赖 |
| 2 | 创建 `src/tools/searchPolicyTool.ts` | 新建 | 复用已有 `embeddings.ts` + `vectorStore.ts` |
| 3 | 创建 `src/tools/matchTemplateTool.ts` | 新建 | 纯 Zod schema 工具 |
| 4 | 创建 `src/tools/validateCertTool.ts` | 新建 | 纯 Zod schema 工具 |
| 5 | 创建 `src/agents/analyzeAgent.ts` | 新建 | `createAgent` 主文件 |
| 6 | 补充 `src/types/scoreTemplate.ts` | 修改 | 当前为空文件，补充类型定义 |
| 7 | 修改 `src/routes/analyze.ts` | 修改 | `/certificate` 路由换用 `runAnalyzeAgent` |
| 8 | 回归测试 `/analyze/certificate` 接口 | — | 用 `test_generate.json` 验证 |

---

## 十一、风险与注意事项

### 11.1 `createAgent` API 的包来源

笔记中 `import { createAgent } from "langchain"` 要求安装 `langchain`（非 `@langchain/core`）。
安装前先确认版本兼容性：

```bash
npm info langchain version  # 确认最新稳定版
npm info @langchain/core version
```

如果 `createAgent` API 尚未在稳定版中发布，**备选方案**是用 `@langchain/langgraph` 的 `createReactAgent` 实现同样效果：

```typescript
import { createReactAgent } from "@langchain/langgraph/prebuilt"
// API 基本一致，需调整 systemPrompt → state_modifier 参数名
```

### 11.2 Qwen3 对工具调用的支持

Qwen3-max 支持 Function Calling（tool use），但需要注意：
- 工具数量建议 ≤ 5 个（过多会影响调用准确率）
- 工具 description 应简洁明确，避免语义重叠
- temperature 保持 `0.1` 以获得稳定的工具调用行为

### 11.3 向后兼容

`/analyze/generate` 路由（备注生成）**不受影响**，继续使用现有 LCEL chain。
旧的 `analyzeCertificate()` 函数可保留一段时间作为 fallback，待新 Agent 稳定后再删除。
