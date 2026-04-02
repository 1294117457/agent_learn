##### zod

```
import * as z from "zod";

const Movie = z.object({
  title: z.string().describe("The title of the movie"),
  year: z.number().describe("The year the movie was released"),
  director: z.string().describe("The director of the movie"),
  rating: z.number().describe("The movie's rating out of 10"),
});

//美妙，

import zodToJsonSchema from "zod-to-json-schema";

再用这个转换为JsonSchema
```

#### message

```
import { initChatModel, HumanMessage, SystemMessage } from "langchain";

const model = await initChatModel("gpt-5-nano");

const systemMsg = new SystemMessage("You are a helpful assistant.");
const humanMsg = new HumanMessage("Hello, how are you?");

const messages = [systemMsg, humanMsg];
const response = await model.invoke(messages);  // Returns AIMessage
```

### Core Components

##### model

```
langchain/openai,anthropic...
HumanMessage, AIMessage, SystemMessage
model.stream
zod+tool

```

zod+tool

```
const getWeather = tool(
  (input) => `It's sunny in ${input.location}.`,
  {
    name: "get_weather",
    description: "Get the weather at a location.",
    schema: z.object({
      location: z.string().describe("The location to get the weather for"),
    }),
  },
);

const model = new ChatOpenAI({ model: "gpt-4.1" });
const modelWithTools = model.bindTools([getWeather]);

const response = await modelWithTools.invoke("What's the weather like in Boston?");
```

##### Message

```
HumanMessage,SystemMessaage,AIMessage
	MetaData
Json Schema
invoke.("string")
ToolMessage
```

ToolMessage

```
用户输入message，ai提取关键词，并且根据关键词调用工具，将使用工具返回结果整合返回成人类语言对吗
```

##### Tool

```
createAgent 
	tools，contextSchema
InMemoryStore 
ToolRuntime 
ToolNode
	tool-->tools-->ToolNode
GraphState
	addNode,addEdge,adddConditionalEdges,addEdge
tool
```

tool

```
const updateUserInfo = tool(
  async (_, config: ToolRuntime<typeof CustomState.State>) => {
    const userId = config.state.userId;
    const name = userId === "user_123" ? "John Smith" : "Unknown user";
    return new Command({
      update: {
        userName: name,
        // update the message history
        messages: [
          new ToolMessage({
            content: "Successfully looked up user information",
            tool_call_id: config.toolCall?.id ?? "",
          }),
        ],
      },
    });
  },
  {
    name: "update_user_info",
    description: "Look up and update user info.",
    schema: z.object({}),
  }
);
```



##### Short-term memory

createAgent

```
Memory+Middleware
	trim,delete,summarizationMiddleware
ToolMessage, type ToolRuntime 
```

Memory+Middleware

```
const trimMessages = createMiddleware({...
const checkpointer = new MemorySaver();
const agent = createAgent({
  model: "gpt-4.1",
  tools: [],
  middleware: [trimMessages],
  checkpointer,
});
```

##### Stream

```
StreamMode
	update+message+mode
```

##### Structured output

```
responseFormat
	
```

##### MiddleWare

createAgent

```
const agent = createAgent({
  model: "gpt-4.1",
  tools: [weatherTool, calculatorTool],
  middleware: [
    summarizationMiddleware({
      model: "gpt-4.1-mini",
      trigger: { tokens: 4000 },
      keep: { messages: 20 },
    }),
  ],
});

createMiddleware
```

##### Guardrails

```
PII
	piiType,detector,strategy,applyToInput/applyOutInput
HumanInTheLoop
```

##### Global Context & Memory

```
LangGraph 全局三大参数及其常用方法 (Global Context & Memory)
 │
 ├── 1. State (状态) —— 承载当前会话业务数据
 │   ├── [概念作用]: 单次会话的生命周期载体，大模型推理依据。
 │   ├── [常用属性]: 
 │   │   ├── state.messages                 // 获取当前对话的历史消息数组
 │   │   └── state.custom_var               // 获取你在 StateSchema 中定义的自定义变量
 │   └── [更新方法]: (无显式调用方法) 在节点函数中直接 return { messages: [新消息] } 来自动追加。
 │
 ├── 2. Config (运行时配置) —— 控制底层执行环境
 │   ├── [概念作用]: 每次 invoke/stream 时临时挂载的通行证。
 │   ├── [常用传入]: agent.invoke(state, { configurable: { thread_id: "123" } })
 │   └── [常用属性与方法]: 
 │       ├── config.writer("...")           // (通信) 在 custom 流模式下向前端推送实时进度
 │       ├── config.configurable.thread_id  // (提取) 获取当前传入的会话 ID
 │       └── config.callbacks               // (提取) 挂载或拦截底层日志与 Token 消耗
 │
 └── 3. Store (全局仓库) —— 跨会话的永久存储
     ├── [概念作用]: 独立于单个对话的全局档案室（如用户画像记忆）。
     ├── [常用挂载]: createAgent({ store: memoryStore })
     └── [常用持久化API]:
         ├── store.put(["users"], "UID", {age: 18})  // (写) 保存全局记忆
         ├── store.get(["users"], "UID")             // (读) 读取全局记忆
         ├── store.search(["users"], {query: "..."}) // (搜) 搜索全量记忆
         └── store.delete(["users"], "UID")          // (删) 清除特定记忆
```

##### Runtime

`config` 和 `runtime` 其实都指向同一个对象类型：**`RunnableConfig`**

```
runtime (运行环境配置与上下文)
 │
 ├── 1. context (自定义业务上下文)
 │   └── [作用]: 通过 contextSchema 校验的安全黑盒，主要传自定义私有变量。
 │   └── [示例]: runtime.context.userName, runtime.context.db_token
 │
 ├── 2. configurable (底层系统配置)
 │   └── [作用]: 传递给内库或状态保存器 (Checkpointer) 的系统配置信息。
 │   └── [示例]: runtime.configurable.thread_id (当前对话的 Session ID)
 │
 ├── 3. callbacks (回调与流式推送)
 │   └── [作用]: 挂载底层的事件监听器、LangSmith 监控、流式发送器等。
 │   └── [示例]: runtime.callbacks.handleLLMNewToken (接收大模型打字机流)
 │
 └── 4. 可观测性与打标 (Observability)
     ├── tags: string[]          // [示例]: ["production", "middle-ware-test"]
     └── metadata: object        // [示例]: { "user_tier": "VIP" }
```

##### Context Engineering

```
model context
	state,store,runtime context
		use
	System prompt,messages,tools,model,response format
```

##### LangGraph

```
LangGraph 核心执行上下文与数据流转 (State & Config/Runtime)
 │
 ├── 1. State (状态) —— 承载当前单次会话业务数据 (数据流转)
 │   ├── [结构关系]: 贯穿单次会话的生命周期，负责在图的各节点 (Node) 间传递业务数据。
 │   ├── [常用属性]: 
 │   │   ├── state.messages                 // 获取当前对话的历史消息数组
 │   │   └── state.custom_var               // 获取在 StateSchema 中定义的自定义变量
 │   └── [调用更新]: (无显式调用API) 节点函数中直接 return { messages: [新消息] } 实现更新/追加。
 │
 └── 2. Config / Runtime (运行时配置) —— 控制底层执行环境 (RunnableConfig)
     ├── [结构关系]: 每次 invoke/stream 临时挂载的通行证，与 State 平行传入节点或工具。
     ├── [流式调用]:
     │   └── config.writer("...")           // (通信) 自定义流模式向前端推送实时进度块
     └── [核心子属性与获取方法]: 
         ├── .context (自定义业务黑盒)
         │   └── config.context.*           // 获取传参注入的全局私有变量 (如 .userName, .db_token)
         ├── .configurable (系统配置提取)
         │   └── config.configurable.thread_id // 获取当前对话的 Session ID
         ├── .callbacks (事件回调监控)
         │   └── config.callbacks.*         // 挂载底部的回调监听 (如 .handleLLMNewToken 接收流式打字)
         └── 可观测性 (Observability)
             ├── config.tags                // ["production"] 环境打标
             └── config.metadata            // { "user_tier": "VIP" } 附加元数据
```

##### MCP

```
const client = new MultiServerMCPClient{....

const tools = await client.getTools
const agent = createAgent({
    model: "claude-sonnet-4-6",
    tools,
});
```

##### HITL

Human-In-The-Loop

```
approve,edit,reject
```

```
import { createAgent, humanInTheLoopMiddleware } from "langchain";
import { MemorySaver } from "@langchain/langgraph";


```

```
agent再调用任何tools时，
都会先进入这个middleware进行判断是否要hitl，
如果要hitl旧再checkpointer中存储上下文
const agent = createAgent({
    model: "gpt-4.1",
    tools: [writeFileTool, executeSQLTool, readDataTool],
    middleware: [
        humanInTheLoopMiddleware({...


    checkpointer: new MemorySaver(),
});
```

#### UnitTest

##### fackmodel

```
respond()
	AIMessage,Error
alwatsThrow
```

##### INTTest

```
测试消息类型
	toBeHumanMessage,toBeSystemMessage,toBeAIMessage,toBeToolMessage
测试工具调用行为
	toHaveToolCalls,toHaveToolCallCount,toContainToolCall,
测试执行结果
	toHaveToolMessages,toHaveBeenInterrupted,toHaveStructuredResponse
```

##### response

```
model-----const response = await fakemodel.invoke()...
	{
      content: "It's 72°F and sunny.", 
      tool_calls: [
        { 
          name: "get_weather", 
          args: { city: "San Francisco" }, 
          id: "call_123", 
          type: "tool_call" 
        }
      ],
	 response_metadata: {
        tokenUsage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
        finish_reason: "stop", // 或 "tool_calls"
        model_name: "gpt-4.1"
      },
      id: "msg_abc123",
      additional_kwargs: {} 
    }
agent-----const response =await agent.invoke().....
	{
      messages: [
        HumanMessage { content: "What's the weather like in SF?" },
        AIMessage { content: "", tool_calls: [{ name: "get_weather"... }] },
        ToolMessage { content: "72°F", tool_call_id: "call_123" },
        AIMessage { content: "It's 72°F and sunny in SF." }
      ],
      custom_var_1: "something",
      extracted_data: { user_intent: "query_weather" } 
    }
```

```
import { tool } from "@langchain/core/tools";
import { createAgent } from "langchain";
import { z } from "zod";

// 1. 定义一个工具，它同时需要读取 State 和 Runtime
const checkBalanceTool = tool(
  async (input, config) => {
    // ❌ 错误做法：让大模型自己生成 token 发过来（极其不安全）
    // ✅ 正确做法：从 Runtime (运行环境) 中偷偷拿取底层配置的私钥
    const dbToken = config.context.db_token; 
    // ✅ 顺便看看 State (状态) 里的历史对话记录
    const messageHistoryLength = config.state.messages.length;
    console.log(`[工具后台日志] 使用私钥 ${dbToken} 查询数据库... (当前是第 ${messageHistoryLength} 轮对话)`);
    return `你的账户余额是 $1000。`;
  },
  {
    name: "check_balance",
    description: "查询用户的账户余额",
    schema: z.object({}), 
  }
);

// 2. 创建 Agent
const agent = createAgent({
  model: "gpt-4",
  tools: [checkBalanceTool],
});

// 3. 发起调用 (invoke)
async function run() {
  const result = await agent.invoke(

    { 
      messages: [ { role: "user", content: "帮我查一下我的余额。" } ] 
    },
    {
      configurable: { thread_id: "user_123" }, // 告诉保存器存在哪里
      context: { db_token: "super_secret_key_888" }, // 传递给工具的私密变量
    }
  );
  console.log("最终的 State 结果:", result.messages.at(-1).content);
}

run();
```

##### runtime-state

```
tools中使用runtime，获取tool被使用时刻的全局上下文

state是最终状态，用result记录了


```

