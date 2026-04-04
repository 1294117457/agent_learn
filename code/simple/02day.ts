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
for await (const chunk of stream){
  process.stdout.write(String(chunk.content))
  // process.stdout.write(String(chunk.content))
}
process.stdout.write("\n")