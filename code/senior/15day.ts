import dotenv from 'dotenv'
dotenv.config({ path: './.env' })
import { ChatOpenAI } from '@langchain/openai'
import { MemorySaver,StateGraph, END, START } from '@langchain/langgraph'
import { createAgent,createMiddleware } from "langchain";
import { HumanMessage, SystemMessage,ToolMessage,trimMessages } from '@langchain/core/messages'
import {Tool, tool} from "@langchain/core/tools"
import {z} from 'zod'
/**
 * 创建graph和对应的Node
 * 一个分析路由Node，三个处理Node
 * 最后在StateGraph连接，
 *  addNode，addEdge，addConditionalEdges
 */

/**
 *  之前agent的state是简单的messages，
    而现在是通过graph，自定义state中的字段，不再是messages
    而是比如这里的MyState，
    然后又通过graph的Node，Edge来实现图拓扑处理对吗
 */
interface MyState{
  userInput:string
  intent:'weather'|'greeting'|'unknown'
  response:string
}

const model = new ChatOpenAI({
    apiKey: process.env.QWEN3_API_KEY,
    configuration: {
        baseURL: process.env.QWEN_BASE_URL
    },
    model: process.env.QWEN_CHAT_MODEL,
    temperature:0,
}).withStructuredOutput(
  z.object({
    intent:z.enum(['weather','greeting','unknown'])
  })
)
/**
 * 返回意图分析结果
 * return { intent: result.intent }只是局部更新
 */
async function analyzeIntentNode(state: MyState): Promise<Partial<MyState>> {
  const result = await model.invoke(
    [new HumanMessage(`判断以下句子的意图：${state.userInput}`)]
  ) 
  console.log('  → 意图分析结果:', result.intent)
  return { intent: result.intent }
}
async function handleWeatherNode(state: MyState): Promise<Partial<MyState>> {
  console.log(state.userInput)
  return { response: `收到天气查询请求："${state.userInput}",当前天气晴，25℃` }
}
async function handleGreetingNode(state: MyState): Promise<Partial<MyState>> {
  return { response: `你好！有什么可以帮助你的吗？` }
}
async function handleUnknownNode(state: MyState): Promise<Partial<MyState>> {
  return { response: `抱歉，我目前只能回答天气和问候相关的问题。` }
}
/**
 * .addConditionalEdges('analyze', (state) => state.intent)
 * 提取state中的intent，作为下一Edge的name
 */
const graph = new StateGraph<MyState>({
  channels: {
    userInput: { default: () => '', reducer: (_, x) => x },
    intent: { default: () => 'unknown' as const, reducer: (_, x) => x },
    response: { default: () => '', reducer: (_, x) => x },
  }
})
  .addNode('analyze', analyzeIntentNode)
  .addNode('weather', handleWeatherNode)
  .addNode('greeting', handleGreetingNode)
  .addNode('unknown', handleUnknownNode)
  .addEdge(START, 'analyze')
  .addConditionalEdges('analyze', (state) => state.intent)  // 根据意图分流
  .addEdge('weather', END)
  .addEdge('greeting', END)
  .addEdge('unknown', END)

const app = graph.compile()

for (const input of ['厦门今天天气怎么样？', '你好', '帮我写一首诗']) {
  console.log(`\n输入: ${input}`)
  const result = await app.invoke({ userInput: input })
  console.log(`输出: ${result.response}`)
}