import 'dotenv/config'
import { StateGraph, Annotation, MessagesAnnotation, START, END, interrupt } from '@langchain/langgraph'
import { Command, MemorySaver } from '@langchain/langgraph'
import { ChatOpenAI } from '@langchain/openai'
import { HumanMessage, AIMessage, BaseMessage } from '@langchain/core/messages'
import { z } from 'zod'
/**
 * 使用interrupt和command
 * 实现HITL
 */
const AppState=Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: (old, x) => [...(old ?? []), ...(x ?? [])],
    default: () => [],
  }),
  missingInfo: Annotation<string[]>({
    reducer: (_, x) => x,
    default: () => [],
  })
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
/**
 * 每次validate将HumanMessage拼接起来
 * 校验结果覆盖state.missingInfo
 */
async function validateNode(state:S):Promise<Partial<S>>{
  // 核心修改1：提取用户在多轮对话中说的所有的内容（拼接起来）
  const allUserText = state.messages
    .filter(m => m instanceof HumanMessage)
    .map(m => m.content)
    .join('\n');

  const messages=[new HumanMessage(`
    判断以下材料描述是否完整（需包含：赛事名称、奖项等级、时间、申请人角色）。
    注意：
    1. 赛事名称允许使用简称（如“挑战杯”、“互联网+”、“国创”等），只要提到了即可，不要强求全称。
    
    材料信息：\n${allUserText}
  `)]

  const reply = await validateModel.invoke(messages)
  console.log(' validate: 当前收集到的完整信息:', allUserText.replace(/\n/g, ' '))
  console.log(' validate: 依然缺失:', reply.missing)
  
  return { missingInfo: reply.missing }
}
/**
 * interrupt(question)接收下次用户的Command，
 * 然后和missingInfo一起打包进入全局state.messages
 * 供后续使用
 * 
 * 总体作用是中断graph并接收用户command
 * 
 */
async function askForMoreNode(state:S):Promise<Partial<S>>{
  const question = `材料信息不完整，缺少：${state.missingInfo.join('、')}。请补充这些信息：`
  console.log('  → ask:向用户提问:', question)
  
  const userAnswer = interrupt(question)
  const result = [
      new AIMessage(question),
      new HumanMessage(String(userAnswer)) 
  ]
  
  return {messages: result}
}

async function generateNode(state:S):Promise<Partial<S>>{
  // 核心修改3：生成时，同样参考用户补充的所有信息
  const allUserText = state.messages
    .filter(m => m instanceof HumanMessage)
    .map(m => m.content)
    .join('\n');

  const messages = [new HumanMessage(`
      根据以下多轮补充的材料信息，整理生成最终的申请表单草稿：
      材料信息：${allUserText}
      
      请列出：1.赛事名称 2.申请加分类别 3.时间 4.角色。
      `)]
      
  const reply = await model.invoke(messages)
  console.log('generate:成功生成草稿！：', reply.content)
  return { messages: [reply] }
}
function checkRoute(state:S){
  console.log('state结构：', state)
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
/**
 * 当前状态是否interrupt
 * 可以通过state.next查看是否为空来判断
 */
const curState = await app.getState(threadConfig)
console.log('==当前状态==:',curState)

const result2 = await app.invoke(
  new Command({ resume: '我在2024年3月参加的比赛' }),
  threadConfig
)

await new Promise(r=>setTimeout(r,5000))



const result3 = await app.invoke(
  new Command({ resume: '我作为队长获得全国二等奖，' }),
  threadConfig
)

console.log('==最终申请草稿==:',result3)