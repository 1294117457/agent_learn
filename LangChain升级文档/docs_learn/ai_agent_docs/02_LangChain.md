# LangChain 开发指南

---

## 第一部分：核心概念

### 什么是 LangChain？

LangChain 是一个用于构建 LLM 应用的开源框架，它提供了一套标准化的抽象层和组件，解决了直接调用 LLM API 时遇到的常见问题：记忆管理、工具集成、多步推理、文档检索等。

```
没有 LangChain（原始 API）：
  你需要手动写：历史管理 + 工具调度 + 提示拼接 + 错误处理 + 输出解析...

有了 LangChain：
  这些逻辑被封装为可复用的组件，组合使用即可
```

### 核心架构：LCEL（LangChain Expression Language）

LangChain 的现代用法基于 **LCEL**，用 `|` 管道符将组件串联：

```python
chain = prompt | llm | output_parser
result = chain.invoke({"input": "用户输入"})
```

每个组件都实现统一接口（`invoke` / `stream` / `batch`），可以自由拼接。

### 五大核心组件

#### 1. Models（模型）
对各家 LLM API 的统一封装：
```
ChatOpenAI、ChatAnthropic、ChatOllama（本地模型）...
```

#### 2. Prompts（提示模板）
参数化的提示，避免硬编码：
```python
ChatPromptTemplate.from_messages([
    ("system", "你是{role}"),
    ("human", "{question}")
])
```

#### 3. Memory（记忆）
为对话链自动维护历史：
- `ConversationBufferMemory`：保留完整历史
- `ConversationSummaryMemory`：自动摘要压缩
- `ConversationBufferWindowMemory`：只保留最近 N 轮

#### 4. Chains（链）
将多个步骤串联为一个工作流：
```
用户提问 → 检索相关文档 → 拼接上下文 → LLM 生成回答
```

#### 5. Agents（智能体）
让模型自主决策：选择调用哪些工具、调用几次，直到完成任务。

### RAG（检索增强生成）

LangChain 最常见的应用场景，解决"模型不知道私有知识"的问题：

```
私有文档（PDF/网页/数据库）
      ↓ 分块 + 向量化
   向量数据库（Chroma/FAISS/Pinecone）
      ↓ 用户提问时相似度检索
   召回相关文档片段
      ↓ 拼入 Prompt
   LLM 基于上下文回答
```

---

## 第二部分：快速上手教程

### 环境准备

```bash
pip install langchain langchain-anthropic langchain-openai langchain-community
pip install faiss-cpu chromadb  # 向量数据库
pip install python-dotenv
```

`.env` 文件：
```
ANTHROPIC_API_KEY=sk-ant-xxxxxxxx
OPENAI_API_KEY=sk-xxxxxxxx
```

---

### 教程 1：最简单的 Chain

```python
from langchain_anthropic import ChatAnthropic
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.output_parsers import StrOutputParser

# 1. 定义模型
llm = ChatAnthropic(model="claude-sonnet-4-6")

# 2. 定义提示模板
prompt = ChatPromptTemplate.from_messages([
    ("system", "你是一个{language}编程专家，用简洁中文回答"),
    ("human", "{question}")
])

# 3. 定义输出解析器
parser = StrOutputParser()

# 4. 用管道组合成 Chain
chain = prompt | llm | parser

# 5. 执行
result = chain.invoke({
    "language": "Python",
    "question": "什么是装饰器？"
})
print(result)
```

---

### 教程 2：带记忆的对话链

```python
from langchain_anthropic import ChatAnthropic
from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder
from langchain_core.output_parsers import StrOutputParser
from langchain_core.chat_history import InMemoryChatMessageHistory
from langchain_core.runnables.history import RunnableWithMessageHistory

llm = ChatAnthropic(model="claude-sonnet-4-6")

prompt = ChatPromptTemplate.from_messages([
    ("system", "你是一个友好的 AI 助手，记住用户说过的所有信息"),
    MessagesPlaceholder(variable_name="history"),  # 历史消息占位符
    ("human", "{input}")
])

chain = prompt | llm | StrOutputParser()

# 存储每个 session 的对话历史
store = {}

def get_session_history(session_id: str):
    if session_id not in store:
        store[session_id] = InMemoryChatMessageHistory()
    return store[session_id]

# 给 chain 包上记忆管理
chain_with_memory = RunnableWithMessageHistory(
    chain,
    get_session_history,
    input_messages_key="input",
    history_messages_key="history"
)

# 使用（同一 session_id = 同一对话）
config = {"configurable": {"session_id": "user_001"}}

reply1 = chain_with_memory.invoke(
    {"input": "我叫小明，我是一名Python开发者"},
    config=config
)
print(f"第1轮: {reply1}")

reply2 = chain_with_memory.invoke(
    {"input": "我叫什么名字？我是做什么的？"},
    config=config
)
print(f"第2轮: {reply2}")
```

---

### 教程 3：RAG（文档问答系统）

```python
from langchain_anthropic import ChatAnthropic
from langchain_openai import OpenAIEmbeddings
from langchain_community.document_loaders import TextLoader
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_community.vectorstores import FAISS
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.output_parsers import StrOutputParser
from langchain_core.runnables import RunnablePassthrough

# --- 第一步：加载并处理文档 ---

# 加载文档（支持 PDF、网页、Word 等多种格式）
loader = TextLoader("my_document.txt", encoding="utf-8")
docs = loader.load()

# 分块（LLM 的 context 有限，需要分成小块）
splitter = RecursiveCharacterTextSplitter(
    chunk_size=500,     # 每块 500 字符
    chunk_overlap=50    # 块间重叠 50 字符，保证语义连续
)
chunks = splitter.split_documents(docs)
print(f"文档分成了 {len(chunks)} 个块")

# --- 第二步：向量化并存入数据库 ---

embeddings = OpenAIEmbeddings()  # 或使用 HuggingFace 免费模型
vectorstore = FAISS.from_documents(chunks, embeddings)

# 转为检索器（默认返回最相关的 4 个块）
retriever = vectorstore.as_retriever(search_kwargs={"k": 4})

# --- 第三步：构建 RAG Chain ---

RAG_PROMPT = ChatPromptTemplate.from_template("""
根据以下上下文回答问题。如果上下文中没有相关信息，
请说"根据提供的文档，我无法回答这个问题"。

上下文：
{context}

问题：{question}

回答：
""")

llm = ChatAnthropic(model="claude-sonnet-4-6")

def format_docs(docs):
    return "\n\n---\n\n".join(doc.page_content for doc in docs)

rag_chain = (
    {"context": retriever | format_docs, "question": RunnablePassthrough()}
    | RAG_PROMPT
    | llm
    | StrOutputParser()
)

# --- 第四步：提问 ---
answer = rag_chain.invoke("文档中提到了哪些主要观点？")
print(answer)
```

---

### 教程 4：LangChain Agent（自主工具调用）

```python
from langchain_anthropic import ChatAnthropic
from langchain_core.tools import tool
from langgraph.prebuilt import create_react_agent

# 定义工具（用 @tool 装饰器）
@tool
def calculator(expression: str) -> str:
    """计算数学表达式，例如 '2 + 3 * 4'"""
    try:
        result = eval(expression)
        return f"计算结果: {result}"
    except Exception as e:
        return f"计算错误: {e}"

@tool
def search_web(query: str) -> str:
    """搜索互联网获取最新信息"""
    # 实际项目接入 Tavily、SerpAPI 等
    return f"搜索 '{query}' 的模拟结果：这是关于{query}的最新信息..."

@tool
def get_current_time() -> str:
    """获取当前日期和时间"""
    from datetime import datetime
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")

# 创建 Agent
llm = ChatAnthropic(model="claude-sonnet-4-6")
tools = [calculator, search_web, get_current_time]

agent = create_react_agent(llm, tools)

# 运行 Agent（它会自动决定用哪些工具）
result = agent.invoke({
    "messages": [("human", "现在几点？另外帮我算一下 (123 * 456) + 789 等于多少？")]
})

# 打印最终回复
print(result["messages"][-1].content)
```

---

### 教程 5：结构化输出

```python
from langchain_anthropic import ChatAnthropic
from pydantic import BaseModel, Field
from typing import List

# 定义输出的数据结构
class ProductReview(BaseModel):
    """产品评价分析结果"""
    sentiment: str = Field(description="情感倾向：positive/negative/neutral")
    score: int = Field(description="评分 1-5 分", ge=1, le=5)
    key_points: List[str] = Field(description="主要观点列表")
    summary: str = Field(description="一句话总结")

llm = ChatAnthropic(model="claude-sonnet-4-6")

# 让模型按结构化格式输出
structured_llm = llm.with_structured_output(ProductReview)

review = """
这款耳机音质非常棒，低音浑厚有力，佩戴也比较舒适。
但续航只有 6 小时有点短，而且价格偏贵。总体来说值得购买。
"""

result = structured_llm.invoke(f"分析以下产品评价：\n{review}")

print(f"情感: {result.sentiment}")
print(f"评分: {result.score}/5")
print(f"要点: {result.key_points}")
print(f"总结: {result.summary}")
```

---

## 第三部分：教程解析

### 解析 1：LCEL 管道（`|`）的本质

`|` 管道符让每个组件的**输出**自动成为下一个组件的**输入**：

```
prompt.invoke({"language":"Python", "question":"什么是装饰器？"})
  → 返回 ChatPromptValue（格式化后的消息列表）
      ↓ 传给
llm.invoke(messages)
  → 返回 AIMessage（模型回复对象）
      ↓ 传给
parser.invoke(AIMessage)
  → 返回 str（纯文本字符串）
```

好处：
- 每个组件职责单一，可独立测试
- 可以随时替换某个环节（换模型、换解析器）
- 支持并行分支、条件路由等复杂拓扑

---

### 解析 2：RAG 各步骤的意义

```
文档分块（Chunking）
  └─ 为什么？LLM context 有限，1万字文档不能全塞进去
  └─ chunk_overlap 解决了什么？保证边界处的语义不被截断

向量化（Embedding）
  └─ 把文本转为数字向量（如 1536 维）
  └─ 语义相近的文本，向量之间的距离也近

向量检索
  └─ 用户提问 → 转向量 → 在数据库中找最近的 k 个向量
  └─ 比关键词搜索更智能：能理解同义词、近义词

上下文注入
  └─ 把检索到的文档片段拼入 Prompt
  └─ 让 LLM "看到" 私有知识再回答
```

**常见坑：** 分块太大 → 检索精度低；分块太小 → 语义不完整。通常 300-600 字符是合适的范围。

---

### 解析 3：Agent 的 ReAct 推理模式

LangChain Agent 使用 **ReAct**（Reason + Act）框架：

```
Thought:  我需要知道当前时间，应该调用 get_current_time 工具
Action:   get_current_time()
Observation: 2026-03-26 14:30:00

Thought:  现在需要计算 (123 * 456) + 789，调用 calculator
Action:   calculator("(123 * 456) + 789")
Observation: 计算结果: 56877

Thought:  我已经有了所有信息，可以回答了
Final Answer: 现在是 2026-03-26 14:30:00，(123 * 456) + 789 = 56877
```

模型不断循环"思考→行动→观察"，直到得出最终答案。

---

### 解析 4：结构化输出的实现原理

`with_structured_output` 内部实际上是用了 Tool Use：

```
1. 将 Pydantic 模型转换为 JSON Schema
2. 把这个 Schema 作为工具定义传给模型
3. 强制模型以工具调用的形式输出
4. 解析工具调用参数，构建 Pydantic 对象
```

这样能保证输出格式 100% 可靠，不会因为模型"心情不好"输出乱格式。

---

### 解析 5：何时用 Chain，何时用 Agent？

| 场景 | 推荐方案 |
|------|---------|
| 流程固定（步骤可预知） | Chain |
| 需要动态决策（不确定步骤数） | Agent |
| 文档问答 | RAG Chain |
| 自动化任务（搜索+计算+写报告） | Agent |
| 批量数据处理 | Chain（可 batch） |

**原则**：能用 Chain 解决就用 Chain，Chain 预期行为更可控、更快、成本更低。只有在需要"模型自主决策"时才用 Agent。

---

### 小结：LangChain 开发要点

```
✅ 用 LCEL 管道（|）组合组件，保持模块化
✅ 用 PromptTemplate 参数化提示，避免字符串拼接
✅ 用 RunnableWithMessageHistory 管理多轮对话
✅ RAG = 分块 + 向量化 + 检索 + 注入，解决私有知识问题
✅ Agent 适合动态多步任务，用 @tool 装饰器定义工具
✅ 用 with_structured_output 保证输出格式可靠
```
