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

