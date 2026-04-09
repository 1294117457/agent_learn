import { model } from "@/llm"
import {ApplyState,ApplyStateType,CheckTaskState,CheckTaskStateType} from '@/states'
import { StateGraph, Annotation, MessagesAnnotation, START, END, interrupt, Send } from '@langchain/langgraph'
import { HumanMessage, AIMessage  } from '@langchain/core/messages'
/** 
 * 申请node
 * 返回对应格式参数
 * 帮助用户完成申请
 */

// 显式的入口派发节点（无实际状态修改，仅作路由前置占位）
function dispatchNode(state: ApplyStateType): Partial<ApplyStateType> {
  console.log("--apply:dispatchSTART")
  return {}
}

/**
 * 路由
 * 分发三个检查任务
 * send并行执行
 */
function dispatchRoute(state:ApplyStateType){
  console.log("--apply:dispatchRoute")
  const checks = ['policy_match', 'format_check', 'time_validity']
  return checks.map(checkType=>new Send('runCheck',{
    documentText: state.documentText,
    checkType
  }))
}
/**
 * 运行任务的Node
 * @param state 
 * @returns 
 */
async function runCheckNode(state:CheckTaskStateType):Promise<Partial<ApplyStateType>>{
  console.log("--apply:runCheckNode")

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
/**
 * 最后总结的Node
 */
async function summarizeNode(state:ApplyStateType):Promise<Partial<ApplyStateType>>{
  console.log("--apply:summarizeNode")

  const allResults = state.checkResults.join('\n')
  const summary = await model.invoke(
    [new HumanMessage(`综合以下检查结果，给出最终评估意见（100字以内）：\n${allResults}`),]
  )
  return {messages:[summary]}
}
export const applySubgraph = new StateGraph(ApplyState)
  .addNode('dispatch', dispatchNode)      // 1. 显式注册起点分发节点
  .addNode('runCheck', runCheckNode)      // 并行执行节点
  .addNode('summarize', summarizeNode)    // 汇总节点
  .addEdge(START, 'dispatch')             // 2. 规范的 START 到 节点 的连线
  .addConditionalEdges('dispatch', dispatchRoute) // 3. 将包含 Send 的路由挂载在节点上
  .addEdge('runCheck', 'summarize')
  .addEdge('summarize', END)
  .compile()