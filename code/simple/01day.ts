import dotenv from 'dotenv'
import { ChatOpenAI } from '@langchain/openai'
import { HumanMessage, SystemMessage } from '@langchain/core/messages'
dotenv.config({ path: './.env' })

const model = new ChatOpenAI({
  apiKey: process.env.QWEN3_API_KEY,
  configuration: {
    baseURL: process.env.QWEN_BASE_URL
  },
  model: process.env.QWEN_CHAT_MODEL
})

const response = await model.invoke([
  new SystemMessage("你是一个简洁的助手，回答不超过30字"),
  new HumanMessage("TypeScript比JavaScript最大的优势是什么?"),
])

console.log("内容：", response)
console.log('token cost', response.response_metadata)
console.log("消息类型：", response.type)