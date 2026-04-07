import dotenv from 'dotenv'
dotenv.config({ path: './.env' })
import { ChatOpenAI, OpenAIEmbeddings } from '@langchain/openai'
import { MemoryVectorStore } from "@langchain/classic/vectorstores/memory";
import { MemorySaver } from '@langchain/langgraph'
import { createAgent,createMiddleware } from "langchain";
import { HumanMessage, SystemMessage, ToolMessage, trimMessages } from '@langchain/core/messages'
import { tool } from "@langchain/core/tools"
import { z } from 'zod'
import type { RunnableConfig } from '@langchain/core/runnables'
/**
 * 引入Embedding，拆解文本为向量到内存数据库MemoryVectorStore
 * 再vectorStore.similaritySearch检索数据
 */

const model = new ChatOpenAI({
  apiKey: process.env.QWEN3_API_KEY,
  configuration: {
    baseURL: process.env.QWEN_BASE_URL
  },
  model: process.env.QWEN_CHAT_MODEL
})
/**
 * 嵌入向量模型
 * Text-to-Vector
 *  输入文本，输出一长串数字，
 * 例如 [0.02, -0.05, 0.12, ...]
 */
const embeddings = new OpenAIEmbeddings({
  apiKey: process.env.QWEN3_API_KEY,
  configuration:{
    baseURL: process.env.QWEN_BASE_URL
  },
  model: process.env.QWEN_EMBEDDING_MODEL
})


const documents = [
  '厦门大学信息学院成立于1997年，目前有计算机科学与技术、软件工程等专业。',
  '信息学院每年招收本科生约200人，研究生约150人，博士生约50人。',
  '学院位于厦门大学翔安校区，拥有现代化实验室和科研设施。',
  '保研推免比例约为20%，综合成绩由学业成绩和加分两部分组成。',
  '加分项目包括学科竞赛、科研成果、社会工作等，最高加分不超过12分。',
]
/**
 * 基于内存的向量数据库
 * 传入文本，文本的metadata，embeddings
 * fromTexts,fromDocuments
 */

/**
 * metadata
 * 标记来源（溯源/引用）：
 *  当大模型通过 similaritySearch 查找到相关的文本时，
 * 往往需要告诉用户这句话是从哪个文件、哪一页拿到的。
 * 你可以把 { source: "厦门大学招生简章.pdf", page: 12, author: "招生办" } 存在 metadata 里。
 * 
 * 精准过滤（元数据过滤）： 在稍微复杂的场景中，你可以在搜索时加上条件。
 * 比如：“只搜索 category 为 '财务' 的文档”，这比纯粹算数学向量距离要精确得多。
 */
const vectorStore = await MemoryVectorStore.fromTexts(
  documents,
  documents.map(() => ({})), //map：数组的遍历方法
  embeddings
)

const searchKnowledgeTool = tool(
  async(input)=>{
    // input.query 例如 "保研加分项"
  // 3 表示返回最相关的 3 条文档
    const results = await vectorStore.similaritySearch(input.query, 3)
    if(results.length===0)  return '没有找到相关文档'
    return results.map((r,i)=>`文档${i+1}：${r.pageContent}`).join('\n')
  },
  {
    name: 'search_knowledge',
    description: 'Search for knowledge in the document store',
    schema: z.object({ query: z.string().describe('检索关键词') }),
  }
)

const agent = createAgent({
  model: model,
  tools: [searchKnowledgeTool]
})

const result = await agent.invoke({
  messages:[new HumanMessage({ content: '保研的加分项目有哪些？最高能加多少分？' })]
})
console.log(String(result.messages.at(-1)!.content))