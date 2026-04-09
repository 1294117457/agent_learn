import { app } from "./src/subgraphs/mainGraph";
import { HumanMessage } from "@langchain/core/messages";
import { Command } from "@langchain/langgraph";

// 构造一个唯一的用户对话配置文件 (相当于 Cookie/Session)
const threadConfig = { configurable: { thread_id: "user-session-001" } };

/**
 * 模拟用户的全流程并发请求
 */
async function bootstrap() {
  console.log("\n==================================");
  console.log("   🚀 Agent 系统已启动 🚀         ");
  console.log("==================================\n");

  // --- 测试场景 1：政策咨询 (直接走 consultRoute, 无需记忆接续) ---
  console.log("【测试场景 1：政策咨询】");
  const consultConfig = { configurable: { thread_id: "consult-user-x" } };
  const resConsult = await app.invoke(
    { messages: [new HumanMessage("请问国创二等奖能加多少分？")] },
    consultConfig
  );
  console.log("-> 最终回复:", resConsult.messages.at(-1)?.content);


  // --- 测试场景 2：材料申请 (中断追问与恢复流程) ---
  console.log("\n【测试场景 2：申请加分 (多轮中断流)】");
  console.log("第一次：发送模糊请求...");
  const resApply1 = await app.invoke(
    { messages: [new HumanMessage("老师，我想申请综测加分！")] },
    threadConfig
  );
  console.log("-> 机器人拦截回复:", resApply1.messages.at(-1)?.content);

  // 此时程序进入挂起状态... 模拟用户 3 秒后回来补充信息
  console.log("\n* 用户正在敲字... *");
  await new Promise((r) => setTimeout(r, 2000));

  console.log("第二次：发送补充材料唤醒程序...");
  const resApply2 = await app.invoke(
    new Command({
      resume: "我的比赛是 2023年9月获得的挑战杯全国二等奖，我是一作核心成员。",
    }),
    threadConfig
  );
  
  console.log("-> 最终结果:", resApply2.messages.at(-1)?.content);
}

// 启动入口
bootstrap().catch((err) => {
    console.error("\n❌ 应用崩溃:", err);
    process.exit(1);
});