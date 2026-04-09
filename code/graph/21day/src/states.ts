import 'dotenv/config'
import { StateGraph, MessagesAnnotation, Annotation, START, END } from '@langchain/langgraph'
import { ChatOpenAI } from '@langchain/openai'
import { HumanMessage, AIMessage, SystemMessage } from '@langchain/core/messages'
import { z } from 'zod'
/**
 * 模拟检索+回答
 */
export const ConsultState = Annotation.Root({
  ...MessagesAnnotation.spec,
  retrievedContext: Annotation<string>({ reducer: (_, x) => x, default: () => '' }),
  answerDraft: Annotation<string>({ reducer: (_, x) => x, default: () => '' }),
})
export type ConsultStateType = typeof ConsultState.State

/**
 * 格式检查+政策匹配，汇总建议
 */
export const ApplyState = Annotation.Root({
  ...MessagesAnnotation.spec,
  
  // 存放待审核的材料文本
  documentText: Annotation<string>({ 
    reducer: (_, x) => x, 
    default: () => '' 
  }),
  
  // 【关键】存放并行检查的结果，必须用追加模式！
  checkResults: Annotation<string[]>({ 
    reducer: (old, newVal) => [...(old ?? []), ...(newVal ?? [])], 
    default: () => [] 
  }),
})
export type ApplyStateType = typeof ApplyState.State

/**
 * 并行子任务的专属状态
 */
export const CheckTaskState = Annotation.Root({
  documentText: Annotation<string>({ 
    reducer: (_, x) => x, 
    default: () => '' 
  }),
  checkType: Annotation<string>({ 
    reducer: (_, x) => x, 
    default: () => '' 
  }) // 例如: 'format_check' 或 'policy_match'
})
export type CheckTaskStateType = typeof CheckTaskState.State
