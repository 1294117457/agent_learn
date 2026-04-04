import dotenv from 'dotenv'
dotenv.config({ path: './.env' })
import { ChatOpenAI } from '@langchain/openai'
import { createAgent } from "langchain";
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
})
/**
 * agent的使用
 * 绑定llm，绑定tools
 * tools不再绑定在llm上
 * 后续还有middleware，stateSchema,responseFormat，onError,maxToken,maxinterations
 */
const agent = createAgent({
  model:model,
  tools:[getWeather]
})

const result = await agent.invoke({
  messages:[
    new SystemMessage('你是一个天气助手'),
    new HumanMessage('今天厦门天气怎么样')
  ]
})
/**
 * invoke返回结构中含有
 * messages[]，userId,queryCount
 *  Each one of messages[] has content,id,response_metadata...
 *  AIMessage has tool_call,addition_kwargs.tool_call
 */
for(const msg of result.messages){
  console.log("structure of msg:",msg)
  console.log(`${msg}:`, String(msg.content).slice(0, 80))
}
console.log("最终结果:", String(result.messages.at(-1)?.content))