import 'dotenv/config'
import { StateGraph, Annotation, MessagesAnnotation, START, END, interrupt, Send } from '@langchain/langgraph'
import { Command, MemorySaver } from '@langchain/langgraph'
import { ChatOpenAI } from '@langchain/openai'
import { HumanMessage, AIMessage, BaseMessage } from '@langchain/core/messages'
import { z } from 'zod'

/**
 * 使用send实现并行node
 */

const MainState = Annotation.Root({
  ...MessagesAnnotation.spec,
  documentText:Annotation<string>({
    reducer: (old, x) => x,
    default: () => '',
  }),
  checkResults: Annotation<string[]>({
    reducer: (existing, newVal) => [...existing, ...newVal],  // ✅ 追加，而不是替换！
    default: () => [],
  }),
})

const CheckTaskState = Annotation.Root({
  documentText: Annotation<string>({ reducer: (_, x) => x, default: () => '' }),
  checkType: Annotation<string>({ reducer: (_, x) => x, default: () => '' }),
})

type MainS = typeof MainState.State
type CheckS = typeof CheckTaskState.State
const model = new ChatOpenAI({
  apiKey: process.env.QWEN3_API_KEY,
  configuration: {
    baseURL: process.env.QWEN_BASE_URL
  },
  model: process.env.QWEN_CHAT_MODEL
})

/**
 * Send分发任务
 * send传入接受节点的name和对应节点需要的参数，
 * 比如runCheck和需要的CheckS参数
    然后在graph定义时使用
 */
function dispatchChecks(state:MainS){
  const checks = ['policy_match', 'format_check', 'time_validity']
  return checks.map(checkType=>new Send('runCheck',{
    documentText: state.documentText,
    checkType
  }))
}

async function runCheckNode(state:CheckS):Promise<Partial<MainS>>{
  const prompts:Record<string,string>={
    policy_match: `检查这份材料是否符合推免加分政策（50字以内）：${state.documentText}`,
    format_check: `检查这份材料的格式是否完整（包含赛事名称/等级/时间）（50字以内）：${state.documentText}`,
    time_validity: `检查材料的时间是否在有效申请期内（一般要求本科期间）（50字以内）：${state.documentText}`,
  }
  const prompt=prompts[state.checkType]??'未知类型'
  const result = await model.invoke([new HumanMessage(prompt)])
  const checkResult = `[${state.checkType}] ${String(result.content)}`
  console.log('  完成检查:', checkResult.slice(0, 60))
  return { checkResults: [checkResult] }  // 追加到主 state 的 checkResults 数组
}

async function summarizeNode(state:MainS):Promise<Partial<MainS>>{
  const allResults = state.checkResults.join('\n')
  const summary = await model.invoke(
    [new HumanMessage(`综合以下检查结果，给出最终评估意见（100字以内）：\n${allResults}`),]
  )
  return {messages:[summary]}
}
function dispatchNode(state: MainS): Partial<MainS> {
  return {}
}
const graph = new StateGraph(MainState)
  .addNode('dispatch', dispatchNode)      // 1. 显式注册起点分发节点
  .addNode('runCheck', runCheckNode)      // 并行执行节点
  .addNode('summarize', summarizeNode)    // 汇总节点
  .addEdge(START, 'dispatch')             // 2. 规范的 START 到 节点 的连线
  .addConditionalEdges('dispatch', dispatchChecks) // 3. 将包含 Send 的路由挂载在节点上
  .addEdge('runCheck', 'summarize')
  .addEdge('summarize', END)

const app = graph.compile()

console.log('开始并行检查...')
const result = await app.invoke({
  messages: [new HumanMessage('请检查我的材料')],
  documentText: '第十八届挑战杯全国大学生课外学术科技作品竞赛，二等奖，2024年6月，本科二年级',
})

console.log('\n所有检查结果:')
result.checkResults.forEach((r: string) => console.log(' ', r))
console.log('\n综合评估:')
const lastAI = result.messages.filter((m) => m instanceof AIMessage).at(-1)
console.log(String(lastAI?.content ?? ''))