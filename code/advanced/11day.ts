import dotenv from 'dotenv'
dotenv.config({ path: './.env' })
import { ChatOpenAI } from '@langchain/openai'
import { MemorySaver } from '@langchain/langgraph'
import { createAgent,createMiddleware } from "langchain";
import { HumanMessage, SystemMessage,ToolMessage,trimMessages } from '@langchain/core/messages'
import {Tool, tool} from "@langchain/core/tools"
import {z} from 'zod'
import type { RunnableConfig } from '@langchain/core/runnables'
/**
 * 将RunnableConfig传入tool
 * 使用RunnableConfig.state.messages
 * 
 */
const smartReminderTool = tool (
    // 💡 必须分开：第一个参数是大模型给的入参（input），第二个参数是系统自动注入的运行时对象（包含 config 和 state）
    // 注意这里我们把第二个参数命名为 runtime (它是 ToolRuntime 类型的变体)
    async (input: { content: string }, runtime: any) => {
        
        // 💡 直接从系统自动注入的 runtime 对象中抽取 state
        const messages = runtime.state.messages || []
        
        // 由于你的工具调用本身也会产生 HumanMessage 和 ToolMessage，通常是一对一对出现的，建议直接除2
        const roundCount = messages.filter(HumanMessage.isInstance).length;
        
        let reminder = `提醒内容：${input.content}。 \n`
        if(roundCount < 2){
            reminder += `这是第${roundCount}轮对话，您可以继续和我聊更多内容，我会在每轮对话结束时提醒您设置的内容。`
            
        }else{
            reminder += `这是第${roundCount}轮对话，您已经和我聊了很多内容了，是否需要我现在提醒您设置的内容？`
        }
  
        return reminder;
    },
    {
        name:'set_reminder',
        description:'设置一条提醒，系统根据对话轮数给出个性化提示',
        // 🚨 这里必须明文规定约束，大模型才能从自然语言中抠出“明天开会”赋值给 content！
        schema: z.object({
            content: z.string().describe('需要提醒的具体内容，比如“明天开会”或“下午喝水”')
        })
    }
)

const model = new ChatOpenAI({
  apiKey: process.env.QWEN3_API_KEY,
  configuration: {
    baseURL: process.env.QWEN_BASE_URL
  },
  model: process.env.QWEN_CHAT_MODEL
})
const agent = createAgent({
    model:model,
    tools:[smartReminderTool],
    checkpointer:new MemorySaver(),
})

const threadId = 'test-reminder'
const messages=[
    '帮我设置一个提醒：明天开会',
    '好的，再设置一个：下午3点喝水',
    '再来一个：记得提交作业',
    '最后一个：晚上锻炼30分钟',
]

for(const msg of messages){
    const result =await agent.invoke(
        {
            messages:[new HumanMessage(msg),
            new SystemMessage("当工具执行完毕并返回结果时，你【必须原封不动】地将工具返回的所有文字汇报给用户，绝不允许省略或总结！"),
        ]},
        {configurable:{thread_id:threadId}}
    )
    console.log(`用户${threadId}：${msg}`)
    // const toolMessage = result.messages.find(m => m._getType() === 'tool');
    // if (toolMessage) {
    //     console.log(`【工具真实返回值】: \n${toolMessage.content}`);
    // }
    
    console.log(`助手: ${String(result.messages.at(-1)!.content)}`)
}