import { MessagesAnnotation, Annotation } from '@langchain/langgraph'

export const CheckTaskState = Annotation.Root({
  documentText: Annotation<string>({ reducer: (_, x) => x, default: () => '' }),
  checkType: Annotation<string>({ reducer: (_, x) => x, default: () => '' })
})
export type CheckTaskStateType = typeof CheckTaskState.State

// === 唯一的超级状态表 ===
export const MainState = Annotation.Root({
  ...MessagesAnnotation.spec, 

  // 主图路由
  intent: Annotation<'consult' | 'apply' | 'insufficient'>({ reducer: (_, x) => x, default: () => 'consult' }),
  missingInfo: Annotation<string[]>({ reducer: (_, x) => x, default: () => [] }),

  // 提取出来的核心材料文本，供 Apply 子图使用
  documentText: Annotation<string>({ reducer: (_, x) => x, default: () => '' }),

  // Apply 子图专用
  checkResults: Annotation<string[]>({ 
    reducer: (old, newVal) => [...(old ?? []), ...(newVal ?? [])], 
    default: () => [] 
  }),

  // Consult 子图专用
  retrievedContext: Annotation<string>({ reducer: (_, x) => x, default: () => '' }),
  answerDraft: Annotation<string>({ reducer: (_, x) => x, default: () => '' }),
})

export type MainStateType = typeof MainState.State

// 导出别名供子图使用，实现完美的类型兼容
export const ApplyState = MainState
export type ApplyStateType = MainStateType
export const ConsultState = MainState
export type ConsultStateType = MainStateType