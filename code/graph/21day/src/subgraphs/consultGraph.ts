import {model} from '@/llm'
import {ConsultState,ConsultStateType} from '@/states'
import { HumanMessage, SystemMessage } from '@langchain/core/messages'
import { StateGraph,  START, END } from '@langchain/langgraph'

/**
 * mock 检索Node
 * 回答用户的咨询
 *  
 */
async function retrieveNode(state: ConsultStateType): Promise<Partial<ConsultStateType>> {
  console.log("--consult:retrieveNode")

  const userMsg = state.messages.filter(m=>m instanceof HumanMessage).at(-1)!
    const mockContext = `政策条文：挑战杯全国一等奖 6分，二等奖 4.5分，三等奖 3分；
  申请条件：本科在读期间获奖，颁奖机构须为教育部认定赛事。`
  return {retrievedContext:mockContext}
}
/**
 * 回答node
 * @param state 
 * @returns 
 */
async function answerNode(state:ConsultStateType):Promise<Partial<ConsultStateType>>{
  console.log("--consult:answerNode")

  const userMsg = state.messages.filter(m=>m instanceof HumanMessage).at(-1)!
  const messages=[
    new SystemMessage(`你是政策咨询助手。根据以下政策条文回答用户问题：\n${state.retrievedContext}`),
    new HumanMessage(String(userMsg.content))
  ]
  const reply = await model.invoke(messages)
  return {answerDraft:String(reply.content),messages:[reply]}
}

export const consultSubgraph = new StateGraph(ConsultState)
  .addNode('retrieve',retrieveNode)
  .addNode('answer',answerNode)
  .addEdge(START,'retrieve')
  .addEdge('retrieve','answer')
  .addEdge('answer',END)
  .compile()