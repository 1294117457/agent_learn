import dotenv from 'dotenv'
dotenv.config({ path: './.env' })
import { ChatOpenAI } from '@langchain/openai'
import { MemorySaver } from '@langchain/langgraph'
import { createAgent } from "langchain";
import { HumanMessage, SystemMessage,ToolMessage } from '@langchain/core/messages'
import {Tool, tool} from "@langchain/core/tools"
import {z} from 'zod'

/**
 * 创建一个带记忆的 Agent，
 * 连续提问，让它记住之前说的内容，
 * 然后换一个 `thread_id` 验证隔离效果
 */

const model = new ChatOpenAI({
  apiKey: process.env.QWEN3_API_KEY,
  configuration: {
    baseURL: process.env.QWEN_BASE_URL
  },
  model: process.env.QWEN_CHAT_MODEL
})

const checkpointer = new MemorySaver()

const agent = createAgent({
  model: model,
  tools:[],
  checkpointer
})

async function chat(threadId: string,message:string){
  const result=await agent.invoke(
    {messages:[new HumanMessage(message)]},
    {configurable:{thread_id:threadId}}
  )
  const lastMsg = result.messages.at(-1);
  console.log(`${threadId} 用户：`, message)
  console.log(`${threadId} Agent回复:`, lastMsg?.text)

  console.log("result结构",result)
}

await chat('thread-1', '我是周晨辉，在吉比特实习')
await chat('thread-1', '你还记得我刚才问了什么吗？')

await chat('thread-2', '你知道我是谁吗')
await chat('thread-3', '今天星期几')

console.log("checkpointer结构",checkpointer)

