import dotenv from 'dotenv'
dotenv.config({ path: './.env' })
import { ChatOpenAI } from '@langchain/openai'
import { MemorySaver } from '@langchain/langgraph'
import { createAgent } from "langchain";
import { HumanMessage, SystemMessage,ToolMessage } from '@langchain/core/messages'
import {Tool, tool} from "@langchain/core/tools"
import {z} from 'zod'

import type { RunnableConfig } from '@langchain/core/runnables'

/**
 * Record，用法类似Array，gradeDB[userId]
 * 遍历for (const userId in gradeDB) { console.log(gradeDB[userId]); }
 *  or (const [userId, grades] of Object.entries(gradeDB)) { console.log(userId, grades); }  
 */
const gradeDB: Record<string,Record<string,number>>={
    'user_001':{'math':92,'english':88,'digtial_structure':88},
    'user_002':{'math':82,'english':78,'digtial_structure':85},
}

const QueryGradeTool = tool(
    async(input , config: RunnableConfig)=>{
        const userId = (config as {context?:{userId?:string}}).context?.userId
        if(!userId){
            return "error:there is no userId in context"
        }
        const grades = gradeDB[userId]
        if(!grades){
            return "error: no grades found for the given userId"
        }
        if(input.subject){
            const score = grades[input.subject]
            return score!=null?`${input.subject}成绩为${score}`:`error: no grade found for subject ${input.subject}`
        }
        return Object.entries(grades).map(([subject,score])=>`${subject}:${score}`).join('\n')
    },
    {
        name:'query_grade',
        description:"查询当前登录用户的课程成绩",
        schema:z.object({
            subject:z.string().optional().describe('课程名称，不填则查询所有成绩')
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
    tools:[QueryGradeTool]
})
/**
 * configurable中传入的threadId实际不起效，
 *  因为没有MemorySaver的实现，
 *  无法根据threadId区分不同用户的上下文，
 * 实际每次invoke传入context:userId，
 *  在工具中使用时从RunnableConfig中读取区分用户
 */
for(const userId  of['user_001','user_002']){
    console.log(`\n===用户${userId}的会话===`)
    const result = await agent.invoke(
        {messages:[new HumanMessage('请告诉我我的math成绩')],},
        {
            configurable:{thread_id:userId},
            context:{userId}
        }
    )
    console.log(String(result.messages.at(-1)?.content))
}