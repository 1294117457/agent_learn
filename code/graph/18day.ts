import 'dotenv/config'
import { StateGraph, Annotation, MessagesAnnotation, START, END, interrupt } from '@langchain/langgraph'
import { Command, MemorySaver } from '@langchain/langgraph'
import { ChatOpenAI } from '@langchain/openai'
import { HumanMessage, AIMessage, BaseMessage } from '@langchain/core/messages'
import { z } from 'zod'

const AppState=Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: (old, x) => [...(old ?? []), ...(x ?? [])],
    default: () => [],
  }),
  missingInfo: Annotation<string[]>({
    reducer: (_, x) => x,
    default: () => [],
  }),
  supplemented:Annotation<string>({
    reducer:(_,x)=>x,
    default:()=> '',
  }),
})

type S = typeof AppState.State

const model = new ChatOpenAI({
  apiKey: process.env.QWEN3_API_KEY,
  configuration: {
    baseURL: process.env.QWEN_BASE_URL
  },
  model: process.env.QWEN_CHAT_MODEL
})
const validateModel = model.withStructuredOutput(
  z.object({
    isComplete:z.boolean(),
    missing:z.array(z.string()),
  })
)

async function validateNode(state:S):Promise<Partial<S>>{
  const userMsg = state.messages.find(m=>m instanceof HumanMessage)!
  const messages=[new HumanMessage(`判断以下材料描述是否完整（需包含：赛事名称、奖项等级、时间、申请人角色）：${userMsg?.content}`)]
  const reply = await validateModel.invoke(messages)
  console.log(' validate: 输入内容:', messages)
  console.log(' validate: 返回内容:', reply)
  return {missingInfo:reply.missing}
}

async function askForMoreNode(state:S):Promise<Partial<S>>{
  const question = `材料信息不完整，缺少：${state.missingInfo.join('、')}。请补充这些信息：`
  console.log('  → ask:向用户提问:', question)
  const userAnswer = interrupt(question)
  return {
    supplemented:String(userAnswer),
    messages:[new AIMessage(`好的，已记录您补充的信息：${userAnswer}`)],
  }
}

async function generateNode(state:S):Promise<Partial<S>>{
  const userMsg=state.messages.find(m=>m instanceof HumanMessage)!
  const extra = state.supplemented?`\n补充信息:${state.supplemented}`:''
  const messages = [new HumanMessage(`
      根据以下材料信息，生成申请表单草稿：
      原始描述：${userMsg.content}${extra}
      请列出：1.申请加分类别 2.预计分值 3.需要提交的材料
      `)]
  const reply = await model.invoke(messages)
  console.log('generate:传入内容', messages)
  console.log('generate:返回内容', reply.content.slice(0,50))
  return {messages:[reply]}
}
function checkRoute(state:S){
  return state.missingInfo.length===0?'generate':'ask'
}

const graph = new StateGraph(AppState)
  .addNode('validate',validateNode)
  .addNode('ask',askForMoreNode)
  .addNode('generate',generateNode)
  .addEdge(START,'validate')
  .addConditionalEdges('validate',checkRoute)
  .addEdge('ask','validate')
  .addEdge('generate',END)

/**
 * 必须有checkpoiner，interrupt才能保存断点
 */
const checkpointer = new MemorySaver()

const app = graph.compile({checkpointer})
const threadConfig = {configurable:{thread_id:'test-thread'}}


const result = await app.invoke(
  {
    messages: [new HumanMessage('我拿了挑战杯的奖，想申请加分')]
  },
  threadConfig
)
await new Promise(r=>setTimeout(r,5000))



const result2 = await app.invoke(
  new Command({ resume: '全国二等奖，2024年6月，我是队长' }),
  threadConfig
)
console.log('==最终申请草稿==:',result2)