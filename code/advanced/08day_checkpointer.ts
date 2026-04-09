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


/**
 * 在工具中可以传入state来获取上下文，修改上下文，
 * 同时还可以在tool中传入runtime，使用其中的context来实现更多的操作
 * 
 * 结合state,Runnable和middleware，tool可以更完善精准的使用每次invoke
 */
const model = new ChatOpenAI({
  apiKey: process.env.QWEN3_API_KEY,
  configuration: {
    baseURL: process.env.QWEN_BASE_URL
  },
  model: process.env.QWEN_CHAT_MODEL
})
/**
 * MemorySaver  
 * langgraph 提供的一个简单的内存保存器实现，
 * 在每次invoke时自动拦截存储
 * 主要使用deleteThread去除无用上下文
 */

/**
 * state，是当前invoke的messages上下文，
 * 如果没有MemorySaver的实现，state每次都是空的，
 * 除了每次invoke自动获取state
 * 还可以在tool和middleware中手动获取和修改state，
 * 
 */
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

