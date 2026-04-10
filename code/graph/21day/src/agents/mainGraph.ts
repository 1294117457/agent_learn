import {model} from '@/llm'
import {MainState, MainStateType} from '@/states'
import { applySubgraph } from './subgraphs/applyGraph'
import { consultSubgraph } from './subgraphs/consultGraph'
import { StateGraph, START, END, interrupt } from '@langchain/langgraph'
import { HumanMessage, AIMessage } from '@langchain/core/messages'
import { z } from 'zod'
import { RunnableConfig } from '@langchain/core/runnables'
import { MemorySaver,Command} from '@langchain/langgraph'
/**
 * 主线程配置
 */
const config:RunnableConfig={
  configurable: {
    thread_id: 'test-thread21',
    use_id: 'zch'
  }
}
const checkpointer = new MemorySaver()
const classifierModel = model.withStructuredOutput(
  z.object({
    intent: z.enum(['consult', 'apply', 'insufficient']).describe("如果是咨询政策为consult；如果想要申请加分但欠缺赛事名称/时间/等级信息为insufficient；如果要申请且信息完整为apply"),
    missing: z.array(z.string()).describe("只有在 intent 为 insufficient 时，列出缺失的字段"),
    documentText: z.string().describe("只有在 intent 为 apply 时，提取用户用来申请的完整材料原文")
  })
)
// 2. 意图分类与提取节点
async function classifyNode(state: MainStateType): Promise<Partial<MainStateType>> {
  // 提取用户在多轮对话中说的所有的内容（拼接起来）
  const allUserText = state.messages
    .filter(m => m instanceof HumanMessage)
    .map(m => m.content)
    .join('\n')

  const messages = [new HumanMessage(`
    分析以下用户的多轮输入，判断意图并提取信息：
    
    【分类与校验规则】：
    1. 如果用户是单纯询问政策或了解相关信息（如“挑战杯能加多少分”），意图记为 consult。
    2. 如果用户表达了“想申请加分”或正在提交比赛凭证，必须严格校验其提供的信息是否完整！
       完整材料必须同时包含以下4个关键要素：【赛事名称】、【奖项等级】、【时间】、【申请人角色】。
       * 特别注意：赛事名称允许使用简称（如“挑战杯”、“互联网+”、“国创”等），只要提到了即可，不要强求全称。
    3. 如果是申请意图，但上述4个要素有任何缺失，意图必须记为 insufficient，并在 missing 数组中准确列出还缺少的要素名称。
    4. 如果是申请意图，且上述4个要素全部齐备，意图记为 apply，并将所有用于申请的原始材料文本合并提取到 documentText 中。
    
    【用户输入历史】：
    ${allUserText}
  `)]
  
  const reply = await classifierModel.invoke(messages)
  
  console.log(`-main:classifyNode: 当前收集信息: ${allUserText.replace(/\n/g, ' ')}`)
  console.log(`-main:classifyNode: 意图: ${reply.intent}, 缺失: ${reply.missing}, 材料提取: ${reply.documentText?.slice(0,10)}...`)
  
  return { 
    intent: reply.intent, 
    missingInfo: reply.missing || [],
    documentText: reply.documentText || ''
  }
}


// 3. 追问节点
async function askForMoreNode(state: MainStateType): Promise<Partial<MainStateType>> {
  const question = `申请材料不完整，还缺：${state.missingInfo.join('、')}。请补充：`
  console.log(`-main:askForMoreNode: ${question}`)

  const userAnswer = interrupt(question)
  return {
    messages: [
      new AIMessage(question),
      new HumanMessage(String(userAnswer)) 
    ]
  }
}

export const mainGraph = new StateGraph(MainState)
  .addNode('classify', classifyNode)
  .addNode('ask', askForMoreNode)
  .addNode('applyGraph', applySubgraph)     // 完美的嵌套：子图直接作为节点插入
  .addNode('consultGraph', consultSubgraph) 
  
  .addEdge(START, 'classify')
  .addConditionalEdges('classify', (s) => s.intent, {
    insufficient: 'ask',
    apply: 'applyGraph',
    consult: 'consultGraph'
  })
  .addEdge('ask', 'classify') // 补充后再次回来校验提取
  .addEdge('applyGraph', END)
  .addEdge('consultGraph', END)

  export const app = mainGraph.compile({ checkpointer })

// // 测试运行代码 (可以单独写在一个文件，或者在文件末尾执行)
// async function run() {
//   console.log("=== 第一轮：信息不足 ===")
//   const res1 = await app.invoke({
//     messages: [new HumanMessage("我想申请加分")]
//   }, config)
  
//   console.log("=== 第二轮：二次输入唤醒 ===")
//   const res2 = await app.invoke(
//     new Command({ resume: "我是队长，2023年9月获得了‘挑战杯’全国一等奖" }), 
//     config
//   )
//   console.log(res2.messages.at(-1)?.content)
// }

// run()