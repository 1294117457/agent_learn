import dotenv from 'dotenv'
dotenv.config({ path: './.env' })
import { ChatOpenAI } from '@langchain/openai'
import { createAgent } from "langchain";
import { HumanMessage, SystemMessage,ToolMessage } from '@langchain/core/messages'
import {Tool, tool} from "@langchain/core/tools"
import {z} from 'zod'

/**
 * using different description for tools
 * to guide agent using right tool
 */
const getWeatherTool = tool(
  (input) => `${input.city}：晴，28°C`,
  {
    name: 'get_weather',
    description: '查询城市天气。仅用于天气相关问题，不用于汇率或时间查询。',
    schema: z.object({ city: z.string().describe('城市名') }),
  }
)

const getExchangeRateTool = tool(
  (input) => `1 ${input.from} = ${(Math.random() * 2 + 6).toFixed(4)} ${input.to}（模拟数据）`,
  {
    name: 'get_exchange_rate',
    description: '查询两种货币之间的汇率。仅用于货币兑换相关问题。',
    schema: z.object({
      from: z.string().describe('源货币，如 USD'),
      to: z.string().describe('目标货币，如 CNY'),
    }),
  }
)

const getCurrentTimeTool = tool(
  () => `当前时间：${new Date().toLocaleString('zh-CN')}`,
  {
    name: 'get_current_time',
    description: '获取当前的日期和时间。',
    schema: z.object({}),
  }
)

const model = new ChatOpenAI({
  apiKey: process.env.QWEN3_API_KEY,
  configuration: {
    baseURL: process.env.QWEN_BASE_URL
  },
  model: process.env.QWEN_CHAT_MODEL
})
const agent = createAgent({
  model:model,
  tools:[getWeatherTool, getExchangeRateTool, getCurrentTimeTool]
})

const messages = [
  new HumanMessage('今天天气怎么样？'),
  new HumanMessage('美元对人民币的汇率是多少？'),
  new HumanMessage('现在几点了？')
]

const result =await agent.invoke({
  messages,
})

for (const msg of result.messages){
  console.log("structure of msg:",msg)
  console.log(`${msg}:`, String(msg.content).slice(0, 80))
}