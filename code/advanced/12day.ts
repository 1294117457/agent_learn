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
 * 模拟DB和config
 * 
 */
interface TimerRecord{
    taskName:string;
    minutes:number;
    startTime:Date;
    status: 'running' | 'finished';
}
const timerDB = new Map<string,TimerRecord[]>();
const taskDB = new Map<string,string[]>();

const config = {
    configurable:{
        thread_id:'test-thread',
        userId:'user_001'
    }
}

const startTimerTool = tool(
    async(input:{minutes:number;taskName:string},config?:RunnableConfig)=>{
        const userId = config?.configurable?.userId || 'unknown_user';
        const timers = timerDB.get(userId)||[];
        timers.push({
            taskName:input.taskName,
            minutes:input.minutes,
            startTime:new Date(),
            status:'running'
        });
        timerDB.set(userId,timers);
        
        const ms = input.minutes *  1000;
        setTimeout(()=>{
            console.log(`提醒：${userId}，请完成${input.taskName}任务！`);
            console.log(`👉 您现在可以直接回复我：“帮我记录为完结”，或者“还没做完，再加15分钟”来继续。\n`);

            const userTimers = timerDB.get(userId);
            if(userTimers){
                const currentTask = [...userTimers].reverse().find(t => t.taskName === input.taskName && t.status === 'running');
                if (currentTask) currentTask.status = 'finished';
            }
        },ms);
        return `已为您启动并记录 ${input.minutes} 分钟的定时器来专注【${input.taskName}】。您现在可以去全身心投入了，时间到了我会通知您。`;
    },
    {
        name:'start_timer',
        description:'设置一个定时器，提醒用户完成某个任务',
        schema:z.object({
            minutes:z.number().describe('定时器的分钟数'),
            taskName:z.string().describe('需要提醒的任务名称')
        })
    }
)
const logTaskTool = tool(
    async(input: {taskName:string},config?:RunnableConfig)=>{
    const userId = config?.configurable?.userId || 'unknown_user';
    const completedTasks=
    }
)
