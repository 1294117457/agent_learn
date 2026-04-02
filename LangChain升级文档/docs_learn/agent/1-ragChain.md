的主要功能是实现 **RAG（检索增强生成）对话逻辑**。它将用户提问、本地知识库检索结果、历史对话记录组装后，发送给大语言模型进行推理，并管理对话历史的持久化。

以下是内部包含的方法及其作用和实现细节：

### 1. 基础支撑方法 (内部调用)

- **[createChatModel()](vscode-file://vscode-app/c:/Program Files/Microsoft VS Code/resources/app/out/vs/code/electron-browser/workbench/workbench.html)**
  - **作用：** 大模型工厂方法。
  - **实现：** 从数据库/缓存中动态读取模型配置（API Key、Base URL、模型名称等），实例化并返回 LangChain 的 [ChatOpenAI](vscode-file://vscode-app/c:/Program Files/Microsoft VS Code/resources/app/out/vs/code/electron-browser/workbench/workbench.html) 对象。
- **[getHistory(sessionId, limit)](vscode-file://vscode-app/c:/Program Files/Microsoft VS Code/resources/app/out/vs/code/electron-browser/workbench/workbench.html)**
  - **作用：** 获取上下文记忆。
  - **实现：** 通过 SQLite 查询 `conversations` 表，按创建时间倒序查出最近 `N`（默认6）条聊天历史。
- **[saveMessage(sessionId, role, content)](vscode-file://vscode-app/c:/Program Files/Microsoft VS Code/resources/app/out/vs/code/electron-browser/workbench/workbench.html)**
  - **作用：** 记录对话。
  - **实现：** 将用户的问题或大模型的回复插入到 SQLite 的 `conversations` 表中。
- **[buildMessages(sessionId, userMessage, contextText)](vscode-file://vscode-app/c:/Program Files/Microsoft VS Code/resources/app/out/vs/code/electron-browser/workbench/workbench.html)**
  - **作用：** 组装发给大模型的标准 Prompt 结构。
  - **实现：** 将 `SystemRole` 和知识库查出的 [contextText](vscode-file://vscode-app/c:/Program Files/Microsoft VS Code/resources/app/out/vs/code/electron-browser/workbench/workbench.html) 拼接为系统提示词；把倒序取出的历史记录反转为正序（[HumanMessage](vscode-file://vscode-app/c:/Program Files/Microsoft VS Code/resources/app/out/vs/code/electron-browser/workbench/workbench.html)/[AIMessage](vscode-file://vscode-app/c:/Program Files/Microsoft VS Code/resources/app/out/vs/code/electron-browser/workbench/workbench.html)）；最后拼接上用户当前提问。
- **[buildContext(userMessage)](vscode-file://vscode-app/c:/Program Files/Microsoft VS Code/resources/app/out/vs/code/electron-browser/workbench/workbench.html)**
  - **作用：** RAG 的核心检索步骤。
  - **实现：** 调用 [getEmbedding](vscode-file://vscode-app/c:/Program Files/Microsoft VS Code/resources/app/out/vs/code/electron-browser/workbench/workbench.html) 把用户提问向量化，再通过 [searchSimilar](vscode-file://vscode-app/c:/Program Files/Microsoft VS Code/resources/app/out/vs/code/electron-browser/workbench/workbench.html) 在本地知识库中查出余弦相似度最高的 Top-5 文本块，拼接成字符串返回。

### 2. 核心对外方法 (供路由控制器使用)

- **[chatWithAgent(sessionId, userMessage)](vscode-file://vscode-app/c:/Program Files/Microsoft VS Code/resources/app/out/vs/code/electron-browser/workbench/workbench.html)**
  - **作用：** 非流式（一次性）对话接口。
  - **使用方式：** 等待大模型生成完毕后，一次性返回完整结果文本，同时把双方交互存入数据库。
- **[chatWithAgentStream(sessionId, userMessage)](vscode-file://vscode-app/c:/Program Files/Microsoft VS Code/resources/app/out/vs/code/electron-browser/workbench/workbench.html)**
  - **作用：** 流式（打字机）对话接口。
  - **使用方式：** 返回一个 [AsyncGenerator](vscode-file://vscode-app/c:/Program Files/Microsoft VS Code/resources/app/out/vs/code/electron-browser/workbench/workbench.html)。外部（如 `chat.ts` 路由）可以通过 `for await (const token of stream)` 消费数据块，借助 SSE 技术逐字推送到前端。流全部跑完后统一落库保存。
- **[clearConversation(sessionId)](vscode-file://vscode-app/c:/Program Files/Microsoft VS Code/resources/app/out/vs/code/electron-browser/workbench/workbench.html)**
  - **作用：** 清空当前用户的记忆。
  - **使用方式：** 接收 [sessionId](vscode-file://vscode-app/c:/Program Files/Microsoft VS Code/resources/app/out/vs/code/electron-browser/workbench/workbench.html)，在数据库中执行 DELETE 按条件删除。前端点击“清除对话”时调用。