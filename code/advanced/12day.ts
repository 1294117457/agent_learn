import dotenv from 'dotenv'
dotenv.config({ path: './.env' })
import { ChatOpenAI } from '@langchain/openai'
import { MemorySaver } from '@langchain/langgraph'
import { createAgent,createMiddleware } from "langchain";
import { HumanMessage, SystemMessage, ToolMessage, trimMessages } from '@langchain/core/messages'
import { tool } from "@langchain/core/tools"
import { z } from 'zod'
import type { RunnableConfig } from '@langchain/core/runnables'

/**
 * 模拟DB和config
 */
interface TimerRecord {
    taskName: string;
    minutes: number;
    startTime: Date;
    status: 'running' | 'finished';
}

const timerDB = new Map<string, TimerRecord[]>();
const taskDB = new Map<string, string[]>();

const config = {
    configurable: {
        thread_id: 'test-thread',
        userId: 'user_001'
    }
}

const startTimerTool = tool(
    async (input: { minutes: number; taskName: string }, config?: RunnableConfig) => {
        const userId = config?.configurable?.userId || 'unknown_user';
        const timers = timerDB.get(userId) || [];
        
        const timerRecord: TimerRecord = {
            taskName: input.taskName,
            minutes: input.minutes,
            startTime: new Date(),
            status: 'running'
        };
        
        timers.push(timerRecord);
        timerDB.set(userId, timers);
        
        console.log(`⏱️  [${userId}] 启动定时器：${input.taskName} - ${input.minutes} 分钟`);
        
        const ms = input.minutes * 1000; // 改为秒 * 1000
        setTimeout(() => {
            console.log(`\n⏰ 提醒：${userId}，请完成${input.taskName}任务！`);
            console.log(`👉 您现在可以直接回复我："帮我记录为完结"，或者"还没做完，再加15分钟"来继续。\n`);

            const userTimers = timerDB.get(userId);
            if (userTimers) {
                const currentTask = [...userTimers].reverse().find(t => t.taskName === input.taskName && t.status === 'running');
                if (currentTask) currentTask.status = 'finished';
            }
        }, ms);
        
        return `已为您启动并记录 ${input.minutes} 分钟的定时器来专注【${input.taskName}】。您现在可以去全身心投入了，时间到了我会通知您。`;
    },
    {
        name: 'start_timer',
        description: '设置一个定时器，提醒用户完成某个任务',
        schema: z.object({
            minutes: z.number().describe('定时器的分钟数'),
            taskName: z.string().describe('需要提醒的任务名称')
        })
    }
)

const logTaskTool = tool(
    async (input: { taskName: string }, config?: RunnableConfig) => {
        const userId = config?.configurable?.userId || 'unknown_user';
        const userTimers = timerDB.get(userId) || [];
        
        // 查找是否存在这个任务且状态为 'finished'
        const taskIndex = userTimers.findIndex(
            t => t.taskName === input.taskName && t.status === 'finished'
        );
        
        if (taskIndex === -1) {
            return `❌ 未找到已完成的任务【${input.taskName}】。请确保该任务已经完成（定时器时间已到）。`;
        }
        
        // 从 timerDB 中移除该任务
        const completedTask = userTimers.splice(taskIndex, 1)[0];
        timerDB.set(userId, userTimers);
        
        // 添加到 taskDB 完成列表
        const completedTasks = taskDB.get(userId) || [];
        completedTasks.push(
            `${completedTask.taskName}（${completedTask.minutes}分钟）`
        );
        taskDB.set(userId, completedTasks);
        
        return `✅ 已记录完成任务【${input.taskName}】！继续加油！`;
    },
    {
        name: 'log_task',
        description: '记录一个已完成的任务（该任务必须已经在 start_timer 中启动过）',
        schema: z.object({
            taskName: z.string().describe('需要记录为完成的任务名称')
        })
    }
)

const getSummaryTool = tool(
    async (input: {}, config?: RunnableConfig) => {
        const userId = config?.configurable?.userId || 'unknown_user';
        
        const completedTasks = taskDB.get(userId) || [];
        const runningTimers = (timerDB.get(userId) || []).filter(t => t.status === 'running');
        
        let summary = `📊 【${userId}】的今日专注统计\n`;
        summary += `${'='.repeat(40)}\n`;
        
        if (completedTasks.length === 0) {
            summary += `还没有完成任何任务。来启动一个定时器，开始专注吧！`;
        } else {
            summary += `✅ 已完成任务（${completedTasks.length}个）：\n`;
            completedTasks.forEach((task, idx) => {
                summary += `  ${idx + 1}. ${task}\n`;
            });
        }
        
        if (runningTimers.length > 0) {
            summary += `\n⏳ 正在进行的任务：\n`;
            runningTimers.forEach((timer, idx) => {
                const elapsed = Math.floor((Date.now() - timer.startTime.getTime()) / 1000 / 60);
                const remaining = timer.minutes - elapsed;
                summary += `  ${idx + 1}. ${timer.taskName}（剩余 ${Math.max(0, remaining)} 分钟）\n`;
            });
        }
        
        summary += `${'='.repeat(40)}`;
        return summary;
    },
    {
        name: 'get_summary',
        description: '获取今天的专注任务统计摘要，包括已完成的任务和正在进行的定时器'
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
    tools:[startTimerTool, logTaskTool, getSummaryTool],
    checkpointer:new MemorySaver(),
})

async function chat(threadId: string, userId: string, message: string) {
    const result = await agent.invoke(
        { messages: [new HumanMessage(message)] },
        // { configurable: config.configurable }
        { configurable: { thread_id: threadId, userId: userId } }
    )
    const lastMsg = result.messages.at(-1);
    console.log(`\n[${threadId}|${userId}] 用户：${message}`)
    console.log(`[${threadId}|${userId}] Agent：${lastMsg?.content}\n`)
}

// 测试场景
(async () => {
    await chat('pomodoro-session-1', 'user_001', '帮我设定一个5分钟的定时器来完成代码审查')
    await new Promise(resolve => setTimeout(resolve, 6000)); // 等待2秒
    await chat('pomodoro-session-1', 'user_001', '帮我记录为完结')
    await chat('pomodoro-session-1', 'user_001', '帮我查看今天的专注统计')
    
    // 模拟另一个用户
    await chat('pomodoro-session-2', 'user_001', '我要开始一个10分钟的任务，内容是学习 TypeScript')
    await chat('pomodoro-session-2', 'user_001', '统计一下我的进度')
})()