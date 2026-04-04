import dotenv from 'dotenv'
dotenv.config({ path: './.env' })
import { ChatOpenAI } from '@langchain/openai'
import { createAgent } from "langchain";
import { HumanMessage, SystemMessage,ToolMessage } from '@langchain/core/messages'
import {Tool, tool} from "@langchain/core/tools"
import {z} from 'zod'
/**
 * 定义情感分析的输出格式
 */
const SentimentSchema = z.object({
  sentiment:z.enum(['positive','negative','neutral']).describe('情感倾向'),
  score:z.number().min(0).max(100).describe('情感分数,0=极负面，100=极正面'),
  keywords:z.array(z.string()).describe('关键词，不超过5个'),
  summary:z.string().describe('情感分析的总结,不超过30字'),
})

const model = new ChatOpenAI({
  apiKey: process.env.QWEN3_API_KEY,
  configuration: {
    baseURL: process.env.QWEN_BASE_URL
  },
  model: process.env.QWEN_CHAT_MODEL
}).withStructuredOutput(SentimentSchema)

const text = '这次厦门之旅非常愉快，海鲜很新鲜，但酒店隔音效果一般，总体来说还是值得推荐的。'

const result = await model.invoke([
  new SystemMessage('你是情感分析专家，请分析用户文本的情感。'),
  new HumanMessage(`分析以下文本：${text}`),
])

console.log('情感分析结果:')
console.log('  倾向:', result.sentiment)
console.log('  分数:', result.score)
console.log('  关键词:', result.keywords)
console.log('  摘要:', result.summary)

console.log('完整结果对象:', result)