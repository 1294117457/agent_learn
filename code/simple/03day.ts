import dotenv from 'dotenv'
dotenv.config({ path: './.env' })
import { ChatOpenAI } from '@langchain/openai'
import { HumanMessage, SystemMessage } from '@langchain/core/messages'
import {tool} from "@langchain/core/tools"
import {z} from 'zod'

//定义工具，schema描述输入
const getWeatherTool = tool(
  (input) => {
    const weatherMap: Record<string, string> = {
      "北京": "晴天",
      "上海": "阴天",
      "广州": "小雨"
    }
    return weatherMap[input.city] || `${input.city}：暂无天气数据`
  },
  {
    name: "getWeather",
    description: "获取天气信息",
    schema: z.object({
      city:z.string().describe("城市名称")
    })
  }
)
/**
 * model.bindTools
 */
//绑定工具到模型
const modelWithTools = new ChatOpenAI({
  apiKey: process.env.QWEN3_API_KEY,
  configuration: {
    baseURL: process.env.QWEN_BASE_URL
  },
  model: process.env.QWEN_CHAT_MODEL
}).bindTools([getWeatherTool])

const response = await modelWithTools.invoke([
  new HumanMessage("厦门天气怎么样"),
])

console.log("model response", response)
console.log("模型对于工具调用结果", response.tool_calls)
