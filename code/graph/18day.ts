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
  const reply = await validateModel.invoke([
    new HumanMessage(`判断以下材料描述是否完整（需包含：赛事名称、奖项等级、时间、申请人角色）：${userMsg?.content}`)
  ])
  console.log('  → 完整性检查:', reply)
  return {missingInfo:reply.missing}
}

async function askForMoreNode(state:S):Promise<Partial<S>>{
  const question = `材料信息不完整，缺少：${state.missingInfo.join('、')}。请补充这些信息：`
  console.log('  → 暂停，向用户提问:', question)
  const userAnswer = interrupt(question)
  return {
    supplemented:String(userAnswer),
    messages:[new AIMessage(`好的，已记录您补充的信息：${userAnswer}`)],
  }
}

async function generateNode(state:S):Promise<Partial<S>>{
  const userMsg=state.messages.find(m=>m instanceof HumanMessage)!
  const extra = state.supplemented?`\n补充信息:${state.supplemented}`:''
  const reply = await model.invoke([
    new HumanMessage(`
      根据以下材料信息，生成申请表单草稿：
      原始描述：${userMsg.content}${extra}
      请列出：1.申请加分类别 2.预计分值 3.需要提交的材料
      `)
  ])
  return {messages:[reply]}
}
function checkRoute(state:S){
  return state.missingInfo.length===9?'generate':'ask'
}

const graph = new StateGraph(AppState)
  .addNode('validate',validateNode)
  .addNode('ask',askForMoreNode)
  .addNode('generate',generateNode)
  .addEdge(START,'validate')
  .addConditionalEdges('validate',checkRoute)
  .addEdge('ask','validate')
  .addEdge('generate',END)

const checkpointer = new MemorySaver()

const app = graph.compile({checkpointer})
const threadConfig = {configurable:{thread_id:'test-thread'}}

console.log('第一次调用：信息不完整')
const result = await app.invoke(
  {
    messages: [new HumanMessage('我拿了挑战杯的奖，想申请加分')]
  },
  threadConfig
)

const lastMsg1 = result.messages.at(-1)
console.log('暂停后收到问题:',String(lastMsg1?.content??''))

await new Promise(r=>setTimeout(r,500))

console.log('\n=== 第二次调用（用户补充信息，恢复执行）===')
const result2 = await app.invoke(
  new Command({ resume: '全国二等奖，2024年6月，我是队长' }),
  threadConfig
)
const lastMsg2 = result2.messages.filter(m=>m instanceof AIMessage).at(-1)
console.log('\n最终申请草稿:')
console.log(String(lastMsg2?.content ?? ''))