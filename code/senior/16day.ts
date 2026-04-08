import 'dotenv/config'
import { StateGraph, MessagesAnnotation, START, END } from '@langchain/langgraph'
import { ChatOpenAI } from '@langchain/openai'
import { HumanMessage, AIMessage, SystemMessage } from '@langchain/core/messages'
import { z } from 'zod'
//创建一个model
const model = new ChatOpenAI({
  apiKey: process.env.QWEN3_API_KEY,
  configuration: {
    baseURL: process.env.QWEN_BASE_URL
  },
  model: process.env.QWEN_CHAT_MODEL
})
//单独绑定OutPutStructure
const intentModel = model.withStructuredOutput(
  z.object({intent:z.enum(['consult','apply','other'])})
)
//分析intentnode
/**
 * 这里的invoke是model层面的单独调用
 * 无状态
 * 而agent或graph的invoke，有对应state的传入和更新
 */
async function classifyNode(state: typeof MessagesAnnotation.State): Promise<string> {
  const lastMsg = state.messages.at(-1)!
  const result = await intentModel.invoke([
    new SystemMessage('判断用户意图：consult=咨询问题,apply=申请表单,other=其他'),
    new HumanMessage(String(lastMsg.content)),
  ])
  console.log('意图分析结果:', result.intent)
  return {messages:[new AIMessage({content:'',additional_kwargs:{intent:result.intent}})]}
}
/**
 * find，遍历，找到并返回第一个符号条件元素
 * !，Non-null Assertion Operator，
 *  断言操作符，告诉编译器这个值不可能是null或undefined
 * m instanceof HumanMessage ====
 *  m instanceof HumanMessage
 */
async function consultNode(state:typeof MessagesAnnotation.State){
  const userMsg = state.messages.find(m=>m instanceof HumanMessage)!
  const messages =[
    new SystemMessage('你是政策咨询助手，简洁回答用户问题'),
    new HumanMessage(String(userMsg.content)),
  ]

  const result = await model.invoke(messages)
  return { messages: [result] }
}
async function applyNode(state:typeof MessagesAnnotation.State){
  const userMsg = state.messages.find(m=>m instanceof HumanMessage)!
  const messages = [
    new SystemMessage('你是申请表单助手，引导用户填写申请材料，列出需要准备的信息'),
    new HumanMessage(String(userMsg.content)),
  ]

  const result = await model.invoke(messages)
  return {messages:[result]}  
}

async function otherNode(state:typeof MessagesAnnotation.State){
  return {
    messages:[
      new AIMessage('您的问题我暂时无法处理，请描述您是要"咨询政策"还是"申请加分"？')
    ]
  }
}
/**
 * 路由
 * FP
 */
function routeIntent(state:typeof MessagesAnnotation.State){
    return state.messages
      .filter(m=>m instanceof AIMessage)
      .at(-1)?.additional_kwargs?.intent ?? 'other'
}
/**
 * graph的invoke有状态
 * additional_kwargs  keyword_args
 * 存储自定义的关键词
 */
const graph = new StateGraph(MessagesAnnotation)
  .addNode('classify',classifyNode)
  .addNode('consult',consultNode)
  .addNode('apply',applyNode)
  .addNode('other',otherNode)
  .addEdge(START,'classify')
  .addConditionalEdges('classify',routeIntent)
  .addEdge('consult',END)
  .addEdge('apply',END)
  .addEdge('other',END)

  const app = graph.compile()

  const inputs = [
    '推免加分里，挑战杯国家级一等奖能加多少分？',
    '我想申请科研成果加分，需要准备什么材料？',
    '明天天气怎么样？',
  ]
/**
 * 并发异步，每个input都发送，
 * 其中await只是针对对应的input的，
 * 而所有input实际是并发的
 */
  // inputs.forEach(async(input)=>{
  //   const result = await app.invoke({messages:[new HumanMessage(input)]})
  //   const lastAI = result.messages
  //     .filter(m => m instanceof AIMessage)
  //     .at(-1)?.content ?? '无内容'
  //   console.log('输出:', lastAI)
  // })
/**
 * async/await
 * async标记function会返回Promise
 * await会暂停当前async函数的执行，直到Promise被解决
 *  await将当前任务放入microtask，
 *  由nodejs底层c++的libuv库处理
 */
  for(const input of inputs){
    console.log('输入:', input)
    const result = await app.invoke({messages:[new HumanMessage(input)]})
    const lastAI = result.messages
      .filter(m => m instanceof AIMessage)
      .at(-1)?.content ?? '无内容'
    console.log('输出:', lastAI)
  }

  /**
   * map,遍历，返回处理后的新数组
   * find，遍历，找到并返回第一个符号条件元素
   * filter,遍历，筛选所有符合条件的元素
   * 
   *  const users = [{ name: 'Alice' }, { name: 'Bob' }];
      const names = users.map(user => user.name); 
      // 结果: ['Alice', 'Bob']
   */