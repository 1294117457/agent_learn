import dotenv from 'dotenv'
dotenv.config({ path: './.env' })
import { ChatOpenAI } from '@langchain/openai'
import { MemorySaver } from '@langchain/langgraph'
import { createAgent,createMiddleware } from "langchain";
import { HumanMessage, SystemMessage,ToolMessage,trimMessages } from '@langchain/core/messages'
import {Tool, tool} from "@langchain/core/tools"
import {z} from 'zod'

const model = new ChatOpenAI({
  apiKey: process.env.QWEN3_API_KEY,
  configuration: {
    baseURL: process.env.QWEN_BASE_URL
  },
  model: process.env.QWEN_CHAT_MODEL
})

const trimmer = trimMessages({
    maxTokens: 500,
    tokenCounter: (msgs) => 
        msgs.reduce((n, m) => n + String(m.content).length / 2, 0),
    strategy:'last',
    includeSystem: true,
    allowPartial:false,
}) 

const trimMiddleware = createMiddleware({
  name: "trim-messages-middleware",
  // wrapModelCall：拦截大模型调用
  wrapModelCall: async (request, handler) => {
    // 1) 在发给模型前，先用 trimmer 把长条的 request.messages 裁剪变短
    const trimmedMessages = await trimmer.invoke(request.messages);
    
    // 2) 只有裁剪过的消息发给大模型，但底层的保存器(MemorySaver)依然存着完整的历史！
    return handler({ ...request, messages: trimmedMessages });
  }
});

const agent = createAgent({
    model:model,
    tools:[],
    checkpointer:new MemorySaver(),
    // messageModifier: trimmer,
    middleware: [trimMiddleware],
})

const threadId = 'test-trim'
const questions = [
    '请介绍一下LangChain', '它有哪些核心组件？', '什么是LCEL？',
    '什么是Agent？', '什么是Tool？', '如何创建Tool？',
]
/**
 * trimmer切割了消息，
 * 二次消息会读取不到上次消息的超出部分
 */
for(const q of questions){
    const result = await agent.invoke(
        {messages:[new HumanMessage(q)]},
        {configurable:{thread_id:threadId}}
    )
    const msgs = result.messages
    console.log(`用户：${q}`)
    console.log(`Agent回复 上下文条数：${msgs.length}`)
    console.log(`Agent回复：${String(msgs.at(-1)!.content).slice(0, 50)}...`)

}