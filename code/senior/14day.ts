import dotenv from 'dotenv'
dotenv.config({ path: './.env' })
import { ChatOpenAI } from '@langchain/openai'
import { MemorySaver } from '@langchain/langgraph'
import { createAgent,createMiddleware } from "langchain";
import { HumanMessage, SystemMessage,ToolMessage,trimMessages } from '@langchain/core/messages'
import {Tool, tool} from "@langchain/core/tools"
import {z} from 'zod'

const model = new ChatOpenAI({
  apiKey: process.env.QWEN3_API_KEY,
  configuration: {
    baseURL: process.env.QWEN_BASE_URL
  },
  model: process.env.QWEN_CHAT_MODEL
})
function desensitizeText(text: string): string {
  if (!text) return text;
  return text
    // 匹配中国大陆 11 位手机号 (如: 13812345678 -> 138****5678)
    .replace(/(1[3-9]\d)\d{4}(\d{4})/g, '$1****$2')
    // 匹配 18 位身份证号 (如: 110105199001011234 -> 110105********1234)
    .replace(/(\d{6})\d{8}(\d{3}[\dXx])/gi, '$1********$2');
}
const desensitizeMiddleware = createMiddleware({
  name: "desensitize-messages-middleware",
  wrapModelCall: async (request, handler) => {
    // 遍历所有消息，如果是文本内容，则进行正则替换脱敏
    const desensitizedMessages = request.messages.map(msg => {
      if (typeof msg.content === 'string') {
        // 为了不污染原始的历史记录，通常建议克隆一个新的 Message 对象
        // 这里以直接修改 content 为例（不同版本的底层实现可能会受到影响，推荐新建实例）
        msg.content = desensitizeText(msg.content);
      }
      return msg;
    });
    
    // 将脱敏后的消息交给大模型
    return handler({ ...request, messages: desensitizedMessages });
  }
});
const trimmer = trimMessages({
    maxTokens: 500,
    tokenCounter: (msgs) => 
        msgs.reduce((n, m) => n + String(m.content).length / 2, 0),
    strategy:'last',
    includeSystem: true,
    allowPartial:false,
}) 

const trimMiddleware = createMiddleware({
  name: "trim-messages-middleware",
  // wrapModelCall：拦截大模型调用
  wrapModelCall: async (request, handler) => {
    // 1) 在发给模型前，先用 trimmer 把长条的 request.messages 裁剪变短
    const trimmedMessages = await trimmer.invoke(request.messages);
    
    // 2) 只有裁剪过的消息发给大模型，但底层的保存器(MemorySaver)依然存着完整的历史！
    return handler({ ...request, messages: trimmedMessages });
  }
});

const agent = createAgent({
    model:model,
    tools:[],
    checkpointer:new MemorySaver(),
    // messageModifier: trimmer,
    middleware: [ desensitizeMiddleware],
})

const threadId = 'test-trim'
const questions = [
    '350424200106030011，请你复述一遍',
    '13812345678，请你复述一遍',
]
/**
 * trimmer切割了消息，
 * 二次消息会读取不到上次消息的超出部分
 */
for(const q of questions){
    const result = await agent.invoke(
        {messages:[new HumanMessage(q)]},
        {configurable:{thread_id:threadId}}
    )
    const msgs = result.messages
    console.log(`用户：${q}`)
    console.log(`Agent回复 上下文条数：${msgs.length}`)
    console.log(`Agent回复：${String(msgs.at(-1)!.content).slice(0, 50)}...`)

}