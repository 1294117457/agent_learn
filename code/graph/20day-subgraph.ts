import 'dotenv/config'
import { StateGraph, MessagesAnnotation, Annotation, START, END } from '@langchain/langgraph'
import { ChatOpenAI } from '@langchain/openai'
import { HumanMessage, AIMessage, SystemMessage } from '@langchain/core/messages'
import { z } from 'zod'
/**
 * 将部分路径封装成子图
 */

const model = new ChatOpenAI({
  apiKey: process.env.QWEN3_API_KEY,
  configuration: {
    baseURL: process.env.QWEN_BASE_URL
  },
  model: process.env.QWEN_CHAT_MODEL
})

const ConsultState = Annotation.Root({
  ...MessagesAnnotation.spec,
  retrievedContext: Annotation<string>({ reducer: (_, x) => x, default: () => '' }),
  answerDraft: Annotation<string>({ reducer: (_, x) => x, default: () => '' }),
})

type ConsultS = typeof ConsultState.State
/**
 * 子图节点
 * 常规的先获取state的msg，
 * 结合node生成的msg封装
 * 更新SubState
 */
async function retrieveNode(state:ConsultS):Promise<Partial<ConsultS>>{
  const userMsg = state.messages.find(m=>m instanceof HumanMessage)!
  console.log('子图-检索知识库--')
    const mockContext = `政策条文：挑战杯全国一等奖 6分，二等奖 4.5分，三等奖 3分；
  申请条件：本科在读期间获奖，颁奖机构须为教育部认定赛事。`
  return {retrievedContext:mockContext}
}
async function answerNode(state:ConsultS):Promise<Partial<ConsultS>>{
  const userMsg = state.messages.find(m=>m instanceof HumanMessage)!
  const messages=[
    new SystemMessage(`你是政策咨询助手。根据以下政策条文回答用户问题：\n${state.retrievedContext}`),
    new HumanMessage(String(userMsg.content))
  ]
  console.log('子图-生成回答--')
  
  const reply = await model.invoke(messages)
  return {answerDraft:String(reply.content),messages:[reply]}
}
/**
 * 子图
 */
const consultSubgraph = new StateGraph(ConsultState)
  .addNode('retrieve',retrieveNode)
  .addNode('answer',answerNode)
  .addEdge(START,'retrieve')
  .addEdge('retrieve','answer')
  .addEdge('answer',END)
  .compile()

  const MainState = Annotation.Root({
    ...MessagesAnnotation.spec,
    intent:Annotation<'consult'|'apply'|'ambiguous'>({
      reducer:(_,x)=>x,
      default:()=>'ambiguous' as const
    })
  })

  const intentModel=model.withStructuredOutput(
    z.object({
      intent:z.enum(['consult','apply','ambiguous'])
    })
  )
  type MainS = typeof MainState.State;
/**
 * 主图常规节点
 * 提取msg，添加msg
 * 更新全局MainState
 */
  async function classifyNode(state:MainS):Promise<Partial<MainS>>{
    const lastMsg=state.messages.at(-1)!
    const messages=[
      new SystemMessage('判断用户意图：consult/apply/ambiguous'),
      new HumanMessage(String(lastMsg.content),)
    ]
    const result = await intentModel.invoke(messages)
    return {intent:result.intent}
  }
  /**
   * 该节点调用子图
   * 将子图返回结果提取（最后一个AIMessage）
   * 更新全局MainState
   */
  async function consultRouteNode(state:MainS):Promise<Partial<MainS>>{
    const result = await consultSubgraph.invoke({messages:state.messages})
    const subAI=result.messages.filter(m=>m instanceof AIMessage).at(-1)
    return {messages:subAI?[subAI]:[]}
  }

  async function applyRouteNode(state:MainS):Promise<Partial<MainS>>{
    const userMsg = state.messages.find(m=>m instanceof HumanMessage)!
    const messages=[
      new SystemMessage('你是申请助手，列出申请所需材料清单。'),
      new HumanMessage(String(userMsg.content))
    ]

    const reply = await model.invoke(messages)
    return {messages:[reply]}
  }
  
  async function clarifyRouteNode(state:MainS):Promise<Partial<MainS>>{
    const messages=[
      new AIMessage('您是想**咨询政策规定**，还是要**申请加分**？请描述得更具体一些。')
    ]
    return {messages:messages}
  }

  const mainGraph = new StateGraph(MainState)
    .addNode('classify', classifyNode)
    .addNode('consultRoute', consultRouteNode)//子图作为节点
    .addNode('applyRoute', applyRouteNode)
    .addNode('clarifyRoute', clarifyRouteNode)
    .addEdge(START,'classify')
    .addConditionalEdges('classify', s => s.intent, {
      consult: 'consultRoute',
      apply: 'applyRoute',
      ambiguous: 'clarifyRoute',
    })
    .addEdge('consultRoute', END)
    .addEdge('applyRoute', END)
    .addEdge('clarifyRoute', END)

  const app = mainGraph.compile()

  const result = await app.invoke({
    messages: [new HumanMessage('挑战杯二等奖能加多少分？申请条件是什么？')]
  })
  const lastAI=result.messages.filter(m=>m instanceof AIMessage).at(-1)
  console.log('主图-最终回复--', lastAI?.content??'')