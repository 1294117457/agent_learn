# LLM（大语言模型）开发指南

---

## 第一部分：核心概念

### 什么是 LLM？

LLM（Large Language Model，大语言模型）是基于 Transformer 架构训练的深度学习模型，通过海量文本数据学习语言规律，能够理解并生成自然语言。常见的 LLM 包括：

| 模型系列 | 提供方 | API 服务 |
|---------|-------|---------|
| GPT-4o / GPT-4.1 | OpenAI | openai.com |
| Claude 3.5 / Claude 4 | Anthropic | anthropic.com |
| Gemini 1.5 / 2.0 | Google | ai.google.dev |
| Qwen / DeepSeek | 国内厂商 | 各自官网 |

### LLM API 的工作原理

LLM 对外暴露的是一个"对话接口"，核心概念：

```
用户输入（Prompt）
      ↓
  LLM 推理
      ↓
模型输出（Completion）
```

- **Prompt**：发送给模型的输入，包括系统提示（system）和用户消息（user）
- **Completion**：模型返回的文本输出
- **Token**：LLM 处理文本的基本单位，大约 1 个汉字 = 1.5 token
- **Context Window**：模型一次能处理的最大 token 数（如 Claude Sonnet 4.6 支持 200K tokens）
- **Temperature**：控制输出随机性，0 = 确定性输出，1 = 创意性输出

### 消息结构（Messages API）

现代 LLM API 普遍采用多轮对话格式：

```json
[
  {"role": "system",    "content": "你是一个专业的代码助手"},
  {"role": "user",      "content": "帮我写一个冒泡排序"},
  {"role": "assistant", "content": "好的，这是冒泡排序的实现..."},
  {"role": "user",      "content": "能加上注释吗？"}
]
```

- `system`：设定模型的角色、规则、背景知识
- `user`：用户发送的消息
- `assistant`：模型历史回复（用于多轮对话记忆）

### 关键参数

| 参数 | 说明 | 典型值 |
|------|------|-------|
| `model` | 使用哪个模型版本 | `claude-sonnet-4-6` |
| `max_tokens` | 最大输出 token 数 | 1024 ~ 8192 |
| `temperature` | 随机性（0~1） | 0.7 |
| `stream` | 是否流式输出 | true/false |

---

## 第二部分：快速上手教程

### 环境准备

```bash
pip install anthropic openai python-dotenv
```

创建 `.env` 文件：
```
ANTHROPIC_API_KEY=sk-ant-xxxxxxxx
OPENAI_API_KEY=sk-xxxxxxxx
```

---

### 教程 1：调用 Claude API（单次对话）

```python
import anthropic

client = anthropic.Anthropic(api_key="your-api-key")

message = client.messages.create(
    model="claude-sonnet-4-6",
    max_tokens=1024,
    messages=[
        {"role": "user", "content": "用一句话解释什么是量子纠缠"}
    ]
)

print(message.content[0].text)
```

**输出示例：**
```
量子纠缠是指两个或多个粒子在量子力学层面产生关联，
无论相距多远，对一个粒子的测量都会瞬间影响另一个粒子的状态。
```

---

### 教程 2：多轮对话（维护历史）

```python
import anthropic

client = anthropic.Anthropic()

def chat():
    history = []
    print("开始对话（输入 quit 退出）")

    while True:
        user_input = input("\n你: ")
        if user_input.lower() == "quit":
            break

        # 将用户输入加入历史
        history.append({"role": "user", "content": user_input})

        # 调用 API，传入完整历史
        response = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=1024,
            system="你是一个耐心的编程导师，用简洁的中文回答问题",
            messages=history
        )

        assistant_reply = response.content[0].text

        # 将模型回复也加入历史
        history.append({"role": "assistant", "content": assistant_reply})

        print(f"\nAI: {assistant_reply}")

chat()
```

---

### 教程 3：流式输出（Streaming）

```python
import anthropic

client = anthropic.Anthropic()

print("AI 回复：", end="", flush=True)

with client.messages.stream(
    model="claude-sonnet-4-6",
    max_tokens=1024,
    messages=[{"role": "user", "content": "写一首关于秋天的五言绝句"}]
) as stream:
    for text in stream.text_stream:
        print(text, end="", flush=True)

print()  # 换行
```

---

### 教程 4：System Prompt 工程

```python
import anthropic

client = anthropic.Anthropic()

SYSTEM_PROMPT = """
你是一个专业的 SQL 专家。
规则：
1. 只回答 SQL 相关问题
2. 始终提供可运行的 SQL 代码
3. 代码中加入必要注释
4. 如果问题不清晰，先询问数据库类型（MySQL/PostgreSQL/SQLite）
"""

response = client.messages.create(
    model="claude-sonnet-4-6",
    max_tokens=2048,
    system=SYSTEM_PROMPT,
    messages=[
        {"role": "user", "content": "查出销售额最高的前10个产品"}
    ]
)

print(response.content[0].text)
```

---

### 教程 5：Tool Use（工具调用 / Function Calling）

```python
import anthropic
import json

client = anthropic.Anthropic()

# 定义工具
tools = [
    {
        "name": "get_weather",
        "description": "获取指定城市的天气信息",
        "input_schema": {
            "type": "object",
            "properties": {
                "city": {
                    "type": "string",
                    "description": "城市名称，如：北京、上海"
                }
            },
            "required": ["city"]
        }
    }
]

# 模拟工具执行函数
def get_weather(city: str) -> str:
    # 实际项目中这里调用真实天气 API
    return f"{city}今天晴天，气温 22°C，湿度 60%"

# 第一轮：模型决定调用工具
response = client.messages.create(
    model="claude-sonnet-4-6",
    max_tokens=1024,
    tools=tools,
    messages=[{"role": "user", "content": "北京今天天气怎么样？"}]
)

# 检查模型是否要调用工具
if response.stop_reason == "tool_use":
    tool_use_block = next(b for b in response.content if b.type == "tool_use")
    tool_name = tool_use_block.name
    tool_input = tool_use_block.input

    print(f"模型调用工具: {tool_name}，参数: {tool_input}")

    # 执行工具
    tool_result = get_weather(tool_input["city"])

    # 第二轮：将工具结果返回给模型
    final_response = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=1024,
        tools=tools,
        messages=[
            {"role": "user", "content": "北京今天天气怎么样？"},
            {"role": "assistant", "content": response.content},
            {
                "role": "user",
                "content": [{
                    "type": "tool_result",
                    "tool_use_id": tool_use_block.id,
                    "content": tool_result
                }]
            }
        ]
    )

    print(f"\n最终回复: {final_response.content[0].text}")
```

---

## 第三部分：教程解析

### 解析 1：为什么要维护 `history` 列表？

LLM 是**无状态**的——每次 API 调用都是独立的，模型不记得上一次说了什么。维护 `history` 列表，每次调用时把完整对话历史传入，模型才能"看到"上下文，实现多轮对话。

```
第1轮: messages = [user: "你好"]
第2轮: messages = [user: "你好", assistant: "你好！", user: "我叫小明"]
第3轮: messages = [user: "你好", assistant: "你好！", user: "我叫小明", assistant: "你好小明！", user: "我叫什么？"]
        ↑ 模型能回答"你叫小明"，因为历史在 messages 里
```

**注意**：历史越长，消耗的 token 越多，成本越高。实际项目中需要做"历史截断"或"摘要压缩"。

---

### 解析 2：Streaming 的意义

不开流式时，用户要等模型生成完全部内容才能看到结果（可能等 5-10 秒）。
开启流式后，模型边生成边输出，用户能看到"打字机效果"，体验更好。

```
非流式: [等待 8 秒] → 一次性显示完整回复
流  式: 即时显示 "量..." → "量子..." → "量子纠缠..." （实时追加）
```

---

### 解析 3：System Prompt 的核心作用

System Prompt 是给模型设定"身份"和"规则"的地方，它有最高优先级。用好 System Prompt 是 AI 应用质量的关键：

```
差的 System Prompt: "你是一个助手"
好的 System Prompt:
  - 明确角色：你是XX领域专家
  - 明确规则：只回答XX类问题
  - 明确格式：始终用JSON格式输出
  - 明确边界：遇到XX情况时，做YY处理
```

---

### 解析 4：Tool Use 的工作流程

Tool Use（工具调用）是让 LLM 具备"行动能力"的核心机制：

```
用户提问
    ↓
模型分析：需要调用工具吗？
    ├── 不需要 → 直接文字回答
    └── 需要 → 返回 tool_use（工具名+参数）
                    ↓
              你的代码执行工具（调用API、查数据库等）
                    ↓
              将结果通过 tool_result 返回给模型
                    ↓
              模型根据工具结果生成最终回复
```

这个"模型→工具→模型"的循环，正是 AI Agent 的核心机制。

---

### 解析 5：Token 与成本控制

```python
# 估算 token 数（简单方法）
def estimate_tokens(text: str) -> int:
    # 英文约 0.75 词/token，中文约 1.5 字/token
    chinese_chars = sum(1 for c in text if '\u4e00' <= c <= '\u9fff')
    other_chars = len(text) - chinese_chars
    return int(chinese_chars * 1.5 + other_chars * 0.25)
```

**成本控制技巧：**
- 用 `max_tokens` 限制输出长度
- 历史对话超过一定长度时做摘要
- 简单任务用小模型（如 Haiku），复杂任务用大模型（如 Opus）
- 缓存常用的 System Prompt（Anthropic 支持 Prompt Caching）

---

### 小结：LLM API 开发要点

```
✅ 掌握 Messages 格式（system / user / assistant）
✅ 理解无状态特性，手动维护对话历史
✅ 合理设计 System Prompt，控制模型行为
✅ 使用 Tool Use 赋予模型外部能力
✅ 用 Streaming 提升用户体验
✅ 注意 Token 成本，做好截断和缓存
```
