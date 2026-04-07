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

process.stdout.write("streaming response: ")
const stream = await model.stream([
  new HumanMessage("用50个字介绍你自己"),
])
/**
 * stream output process.stdout.write() 
 * 直接将内容写入控制台，而不是等待整个响应完成后再输出。这使得你可以实时看到模型生成的内容，尤其适合长文本或需要快速反馈的场景。
 */
for await (const chunk of stream){
  process.stdout.write(String(chunk.content))
  // process.stdout.write(String(chunk.content))
}
process.stdout.write("\n")