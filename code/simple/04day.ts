import dotenv from 'dotenv'
dotenv.config({ path: './.env' })
import { ChatOpenAI } from '@langchain/openai'
import { HumanMessage, SystemMessage,ToolMessage } from '@langchain/core/messages'
import {Tool, tool} from "@langchain/core/tools"
import {z} from 'zod'

const getWeather =tool(
  (input)=>{
    const data:Record<string,string> ={
      '厦门':'晴朗，28℃，海风'
    }
    return data[input.city]??'暂无数据'
  },
  {
    name:'get_weather',
    description:'获取天气信息',
    schema:z.object({
      city:z.string()
    }),
  }
)

const model = new ChatOpenAI({
  apiKey: process.env.QWEN3_API_KEY,
  configuration: {
    baseURL: process.env.QWEN_BASE_URL
  },
  model: process.env.QWEN_CHAT_MODEL
}).bindTools([getWeather])
/**
 * 获取到模型第一次响应
 * 工具调用的命令
 *   "tool_calls": [
    {
      "name": "getWeather",
      "args": {
        "city": "厦门"
      },
      "type": "tool_call",
      "id": "call_3e3afbfa724e443fa6f35483"
    }
  ],
 */
const messages = [new HumanMessage("请问厦门天气怎么样？")]
const firstResponse =await model.invoke(messages)
console.log("模型第一次响应",  firstResponse)

/**
 * async 让每次遍历都启动一个异步操作，
 * 然后立马处理下一个，
 * 最后一起等待完成。
 * 
 * map用法等同于遍历
 */
const toolResults: ToolMessage[]  = await Promise.all(
  (firstResponse.tool_calls??[]).map(async(tc)=>{
    const result = await getWeather.invoke(tc.args as { city: string })
    return new ToolMessage({
      content:String(result),
      tool_call_id:tc.id!,
    })
  })
)

// // 等价的 for 循环写法
// const promises: Promise<ToolMessage>[] = []
// for (const tc of (firstResponse.tool_calls ?? [])) {
//   const promise = (async () => {
//     const result = await getWeather.invoke(tc.args.city)
//     return new ToolMessage({
//       content: String(result),
//       tool_call_id: tc.id!,
//     })
//   })()
//   promises.push(promise)
// }
// const toolResults: ToolMessage[] = await Promise.all(promises)

const finalResponse = await model.invoke([
  ...messages,
  firstResponse,
  ...toolResults
])
console.log("原始问题\n", messages)
console.log("工具调用结果\n", toolResults)
console.log("模型最终响应\n", finalResponse)