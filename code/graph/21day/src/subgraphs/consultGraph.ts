import {model} from '@/llm'
import {ConsultState,ConsultStateType} from '@/states'
import { HumanMessage, SystemMessage } from '@langchain/core/messages'
import { StateGraph,  START, END } from '@langchain/langgraph'
/**
 * mock 检索Node
 *  
 */
async function retrieveNode(state: ConsultStateType): Promise<Partial<ConsultStateType>> {
  const userMsg = state.messages.find(m => m instanceof HumanMessage)!
  const messages = [
    new SystemMessage('你是政策咨询助手，简洁回答用户问题'),
    new HumanMessage(String(userMsg.content)),
  ]
  const reply = await model.invoke(messages)
  return { messages: [reply] }
}
/**
 * 回答node
 * @param state 
 * @returns 
 */
async function answerNode(state:ConsultStateType):Promise<Partial<ConsultStateType>>{
  const userMsg = state.messages.find(m=>m instanceof HumanMessage)!
  const messages=[
    new SystemMessage(`你是政策咨询助手。根据以下政策条文回答用户问题：\n${state.retrievedContext}`),
    new HumanMessage(String(userMsg.content))
  ]
  console.log('子图-生成回答--')
  
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