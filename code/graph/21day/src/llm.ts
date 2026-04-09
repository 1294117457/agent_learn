import { ChatOpenAI } from '@langchain/openai'
import * as dotenv from 'dotenv'

dotenv.config()

// Qwen模型
export const model = new ChatOpenAI({
  apiKey: process.env.QWEN3_API_KEY,
  configuration: {
    baseURL: process.env.QWEN_BASE_URL
  },
  model: process.env.QWEN_CHAT_MODEL,
  temperature: 0.2, 
})
