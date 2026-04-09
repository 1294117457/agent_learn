import 'dotenv/config'
import { StateGraph, MessagesAnnotation, Annotation, START, END } from '@langchain/langgraph'
import { ChatOpenAI } from '@langchain/openai'
import { HumanMessage, AIMessage, SystemMessage,BaseMessage } from '@langchain/core/messages'
import { z } from 'zod'
/**
 * Annotation，
 * Annotation.Root定义state
 * Annotation.reducer定义reducer来复用
 * 
 */
const AppState = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: (old, x) => [...(old ?? []), ...(x ?? [])],
    default: () => [],
  }),
  intent:Annotation<'consult'|'apply'|'ambiguous'>({
    reducer:(_,x)=>x,
    default:()=>'ambiguous' as const
  }),
  documentText:Annotation<string>({
    reducer:(_,x)=>x,
    default:()=>'',
  }),
  confidence:Annotation<'high'|'medium'|'low'>({
    reducer:(_,x)=>x,
    default:()=>'low' as const  //as const 断言为字面量类型，避免被推断为宽泛的字符串类型
  })
})
/**
 * Annotation创建的是一个state对象，后续传入graph使用的
 * 定义node时要用到state类型
 *  通过LangGraph封装的方法AppState.State提取state的类型
 */
type AppStateType = typeof AppState.State

const model = new ChatOpenAI({
  apiKey: process.env.QWEN3_API_KEY,
  configuration: {
    baseURL: process.env.QWEN_BASE_URL
  },
  model: process.env.QWEN_CHAT_MODEL
})
const intentModel = model.withStructuredOutput(
  z.object({
    intent:z.enum(['consult','apply','ambiguous']),
    confidence:z.enum(['high','medium','low']),
    reason:z.string(),
  })
)
/**
 * Partial 声明只返回部分参数
 * LangGraph自动更新到最新状态
 */
async function classifyNode(state:AppStateType):Promise<Partial<AppStateType>>{
  const lastMsg = state.messages.at(-1)!
  const reply = await intentModel.invoke([
    new SystemMessage(`
      判断用户意图：
        - consult：用户在询问政策、规定、条件等咨询类问题
        - apply：用户要提交材料、申请加分、生成申请表等操作类请求
        - ambiguous：描述不清，无法判断
      回答要简短，reason 不超过15字。
      `),
    new HumanMessage(lastMsg.content),
  ])
  console.log(`  → 意图: ${reply.intent}（${reply.confidence}置信度）原因: ${reply.reason}`)
  return {intent:reply.intent,confidence:reply.confidence}
}

async function consultNode(state:AppStateType):Promise<Partial<AppStateType>>{
  const userMsg = state.messages.find(m=>m instanceof HumanMessage)
  const context = state.documentText?`用户提供材料:${state.documentText.slice(0,500)}`:''
  const reply = await model.invoke([
    new SystemMessage(`你是推免政策咨询助手。${context}`),
    new HumanMessage(String(userMsg?.content)),
  ])
  return {messages:[reply]}
}

async function applyNode(state:AppStateType):Promise<Partial<AppStateType>>{
  const userMsg = state.messages.find(m=>m instanceof HumanMessage)
  const reply = await model.invoke([
    new SystemMessage('你是申请表单助手。根据用户描述，列出需要准备的材料清单（用 markdown 列表）。'),
    new HumanMessage(String(userMsg?.content)),
  ])
  return {messages:[reply]}
}

async function ambiguousNode(state:AppStateType):Promise<Partial<AppStateType>>{
  return {
    messages: [new AIMessage(
      '您的描述比较模糊，请告诉我：\n1. 您是想**咨询某项政策**的具体规定？\n2. 还是要**申请加分**，需要我帮您准备材料？'
    )]
  }
}

function routeIntent(state:AppStateType){
  return state.intent
}
/**
 * addConditionalEdges第一个参数是接上前面的.addEdge(START, 'classify')
 * 第二个参数是路由，实际意思是这里会传入state，返回对应路由的名称
 *  这里路由的名称实际就是addNode时定义的每个node的名称
 *  根据路由返回的node，选择下一步用哪个node
 * 路由返回的route和addNode名称能直接对上，就可以省去第三个mapping参数
 */
const graph = new StateGraph(AppState)//传入定义好的state类型
  .addNode('classify', classifyNode)
  .addNode('consult', consultNode)
  .addNode('apply', applyNode)
  .addNode('ambiguous', ambiguousNode)
  .addEdge(START, 'classify')
  .addConditionalEdges('classify', routeIntent, {
    consult: 'consult',
    apply: 'apply',
    ambiguous: 'ambiguous',
  })
  .addEdge('consult', END)
  .addEdge('apply', END)
  .addEdge('ambiguous', END)

  const app = graph.compile()

  const result = await app.invoke({
    messages: [new HumanMessage('我有一个全国竞赛的获奖证书')],
    documentText: '第十八届挑战杯全国大学生课外学术科技作品竞赛，二等奖，2024年6月',
  })
  
console.log('\n最终 State:')
console.log('  intent:', result.intent)
console.log('  confidence:', result.confidence)
const lastAI = result.messages.filter(m => m instanceof AIMessage ).at(-1)
console.log('  回复:', String(lastAI?.content ?? '').slice(0, 120))