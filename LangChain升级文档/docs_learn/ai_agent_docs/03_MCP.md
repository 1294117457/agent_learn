# MCP（Model Context Protocol）开发指南

---

## 第一部分：核心概念

### 什么是 MCP？

MCP（Model Context Protocol，模型上下文协议）是 Anthropic 于 2024 年底发布的开放标准协议，它定义了 **AI 应用如何连接外部工具和数据源**的统一方式。

可以把 MCP 理解为 AI 世界的"USB 接口"：

```
没有 MCP（以前的做法）：
  每个 AI 应用都要为每个工具写定制集成代码
  → 重复劳动，难以复用

有了 MCP（现在的做法）：
  工具开发者实现一次 MCP Server
  所有支持 MCP 的 AI 应用都能直接使用
  → 生态共享，即插即用
```

### MCP 的架构

```
┌─────────────────────────────────────────────────────┐
│                    MCP 生态                          │
│                                                     │
│  ┌──────────────┐    MCP 协议    ┌───────────────┐  │
│  │  MCP Client  │◄──────────────►│  MCP Server   │  │
│  │（AI 应用）    │                │（工具/数据源）  │  │
│  │              │                │               │  │
│  │ Claude Code  │                │ 文件系统 Server │  │
│  │ Cursor       │                │ 数据库 Server  │  │
│  │ 自定义 Agent  │                │ GitHub Server  │  │
│  └──────────────┘                │ 自定义 Server  │  │
│                                  └───────────────┘  │
└─────────────────────────────────────────────────────┘
```

**MCP Client**：AI 应用（Claude Code、Cursor、你自己开发的 Agent）
**MCP Server**：提供工具和数据的服务（可以是本地进程或远程服务）

### MCP Server 能提供什么？

MCP Server 对外暴露三类能力：

#### 1. Tools（工具）
模型可以调用的函数，类似 Function Calling：
```
天气查询、代码执行、数据库查询、发送邮件...
```

#### 2. Resources（资源）
模型可以读取的数据，类似只读文件系统：
```
文件内容、数据库记录、API 响应...
```

#### 3. Prompts（提示模板）
预定义的提示模板，供用户选择调用：
```
"代码审查模板"、"文档生成模板"...
```

### MCP 的通信方式

| 传输方式 | 适用场景 | 说明 |
|---------|---------|------|
| **stdio** | 本地进程 | Client 通过标准输入输出与 Server 通信 |
| **SSE** (HTTP) | 远程服务 | 通过 HTTP + Server-Sent Events |
| **Streamable HTTP** | 远程服务 | 新版推荐，更灵活 |

本地开发最常用 **stdio** 方式——Client 直接启动一个子进程作为 Server。

### 为什么需要 MCP？

| 问题 | 没有 MCP | 有了 MCP |
|------|---------|---------|
| 接入新工具 | 每个 AI 应用各自实现 | 写一次 Server，所有 Client 通用 |
| 工具生态 | 碎片化 | 共享市场（[mcpservers.org](https://mcpservers.org)） |
| 工具热更新 | 需要重启应用 | Server 独立运行，可独立升级 |
| 多语言支持 | 受限于 AI 应用语言 | Server 可以用任何语言写 |

---

## 第二部分：快速上手教程

### 环境准备

```bash
# Python SDK
pip install mcp anthropic

# 或 Node.js SDK（MCP 官方 SDK 主要是 TypeScript）
npm install @modelcontextprotocol/sdk
```

---

### 教程 1：创建第一个 MCP Server（Python）

创建文件 `my_mcp_server.py`：

```python
import asyncio
from mcp.server import Server
from mcp.server.stdio import stdio_server
from mcp import types

# 创建 Server 实例
app = Server("my-first-server")

# ─── 注册 Tools ───────────────────────────────────────

@app.list_tools()
async def list_tools() -> list[types.Tool]:
    """告诉 Client 我提供哪些工具"""
    return [
        types.Tool(
            name="add_numbers",
            description="将两个数字相加",
            inputSchema={
                "type": "object",
                "properties": {
                    "a": {"type": "number", "description": "第一个数字"},
                    "b": {"type": "number", "description": "第二个数字"}
                },
                "required": ["a", "b"]
            }
        ),
        types.Tool(
            name="get_system_info",
            description="获取当前系统信息",
            inputSchema={
                "type": "object",
                "properties": {}
            }
        )
    ]

@app.call_tool()
async def call_tool(name: str, arguments: dict) -> list[types.TextContent]:
    """执行工具调用"""
    if name == "add_numbers":
        result = arguments["a"] + arguments["b"]
        return [types.TextContent(
            type="text",
            text=f"{arguments['a']} + {arguments['b']} = {result}"
        )]

    elif name == "get_system_info":
        import platform
        import psutil
        info = {
            "os": platform.system(),
            "python": platform.python_version(),
            "cpu_percent": psutil.cpu_percent(),
            "memory_gb": round(psutil.virtual_memory().total / 1e9, 2)
        }
        return [types.TextContent(
            type="text",
            text=str(info)
        )]

    else:
        raise ValueError(f"未知工具: {name}")

# ─── 启动 Server ─────────────────────────────────────

async def main():
    async with stdio_server() as (read_stream, write_stream):
        await app.run(
            read_stream,
            write_stream,
            app.create_initialization_options()
        )

if __name__ == "__main__":
    asyncio.run(main())
```

---

### 教程 2：在 Claude Code 中使用 MCP Server

编辑 Claude Code 配置文件（`~/.claude/settings.json` 或项目级 `.claude/settings.json`）：

```json
{
  "mcpServers": {
    "my-first-server": {
      "command": "python",
      "args": ["my_mcp_server.py"],
      "cwd": "/path/to/your/project"
    }
  }
}
```

重启 Claude Code 后，Claude 就能自动调用你的工具了。

**验证**：在 Claude Code 中说 "帮我用 add_numbers 工具算 42 + 58"，Claude 会自动调用你的 MCP Server。

---

### 教程 3：带 Resources 的 MCP Server

```python
import asyncio
import json
from pathlib import Path
from mcp.server import Server
from mcp.server.stdio import stdio_server
from mcp import types

app = Server("file-manager-server")

BASE_DIR = Path("./data")

# ─── Resources ───────────────────────────────────────

@app.list_resources()
async def list_resources() -> list[types.Resource]:
    """列出所有可读资源"""
    resources = []
    for file in BASE_DIR.glob("*.json"):
        resources.append(types.Resource(
            uri=f"file://{file.name}",
            name=file.stem,
            description=f"JSON 文件: {file.name}",
            mimeType="application/json"
        ))
    return resources

@app.read_resource()
async def read_resource(uri: str) -> str:
    """读取资源内容"""
    filename = uri.replace("file://", "")
    file_path = BASE_DIR / filename

    if not file_path.exists():
        raise ValueError(f"文件不存在: {filename}")

    return file_path.read_text(encoding="utf-8")

# ─── Tools ───────────────────────────────────────────

@app.list_tools()
async def list_tools() -> list[types.Tool]:
    return [
        types.Tool(
            name="write_json",
            description="写入 JSON 数据到文件",
            inputSchema={
                "type": "object",
                "properties": {
                    "filename": {"type": "string", "description": "文件名（不含路径）"},
                    "data": {"type": "object", "description": "要写入的 JSON 数据"}
                },
                "required": ["filename", "data"]
            }
        )
    ]

@app.call_tool()
async def call_tool(name: str, arguments: dict) -> list[types.TextContent]:
    if name == "write_json":
        BASE_DIR.mkdir(exist_ok=True)
        file_path = BASE_DIR / arguments["filename"]
        file_path.write_text(
            json.dumps(arguments["data"], ensure_ascii=False, indent=2),
            encoding="utf-8"
        )
        return [types.TextContent(
            type="text",
            text=f"成功写入 {arguments['filename']}"
        )]

async def main():
    async with stdio_server() as (read_stream, write_stream):
        await app.run(read_stream, write_stream, app.create_initialization_options())

if __name__ == "__main__":
    asyncio.run(main())
```

---

### 教程 4：在自定义 Python Agent 中使用 MCP

```python
import asyncio
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client
import anthropic

async def run_agent_with_mcp():
    # 连接到 MCP Server
    server_params = StdioServerParameters(
        command="python",
        args=["my_mcp_server.py"]
    )

    async with stdio_client(server_params) as (read, write):
        async with ClientSession(read, write) as session:
            # 初始化连接
            await session.initialize()

            # 获取 Server 提供的工具列表
            tools_result = await session.list_tools()

            # 转换为 Anthropic Tool 格式
            anthropic_tools = [
                {
                    "name": tool.name,
                    "description": tool.description,
                    "input_schema": tool.inputSchema
                }
                for tool in tools_result.tools
            ]

            print(f"发现 {len(anthropic_tools)} 个工具: {[t['name'] for t in anthropic_tools]}")

            # 使用 Claude 与工具交互
            client = anthropic.Anthropic()

            messages = [{"role": "user", "content": "帮我计算 100 加 200，然后获取系统信息"}]

            while True:
                response = client.messages.create(
                    model="claude-sonnet-4-6",
                    max_tokens=1024,
                    tools=anthropic_tools,
                    messages=messages
                )

                if response.stop_reason == "end_turn":
                    # 模型完成回答
                    print(f"\n最终回复: {response.content[0].text}")
                    break

                elif response.stop_reason == "tool_use":
                    # 执行工具调用
                    messages.append({"role": "assistant", "content": response.content})

                    tool_results = []
                    for block in response.content:
                        if block.type == "tool_use":
                            print(f"调用工具: {block.name}，参数: {block.input}")

                            # 通过 MCP Session 调用工具
                            result = await session.call_tool(block.name, block.input)
                            result_text = result.content[0].text

                            print(f"工具返回: {result_text}")

                            tool_results.append({
                                "type": "tool_result",
                                "tool_use_id": block.id,
                                "content": result_text
                            })

                    messages.append({"role": "user", "content": tool_results})

asyncio.run(run_agent_with_mcp())
```

---

### 教程 5：使用现有的 MCP Server（不自己开发）

很多常用工具已经有现成的 MCP Server，直接配置即可：

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/your/directory"]
    },
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "your-token"
      }
    },
    "sqlite": {
      "command": "uvx",
      "args": ["mcp-server-sqlite", "--db-path", "./my_database.db"]
    },
    "brave-search": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-brave-search"],
      "env": {
        "BRAVE_API_KEY": "your-api-key"
      }
    }
  }
}
```

常用现成 Server：
- `@modelcontextprotocol/server-filesystem`：文件系统操作
- `@modelcontextprotocol/server-github`：GitHub API
- `mcp-server-sqlite`：SQLite 数据库
- `@modelcontextprotocol/server-postgres`：PostgreSQL
- `@modelcontextprotocol/server-brave-search`：网页搜索

---

## 第三部分：教程解析

### 解析 1：MCP 协议的通信流程

```
启动阶段：
  Client → Server: initialize（客户端版本、能力）
  Server → Client: initialize_result（服务器版本、能力）
  Client → Server: initialized（确认完成）

查询阶段：
  Client → Server: tools/list（我要知道你有哪些工具）
  Server → Client: [{name, description, inputSchema}, ...]

调用阶段：
  Client → Server: tools/call {name: "xxx", arguments: {...}}
  Server → Client: {content: [{type: "text", text: "结果"}]}
```

整个通信基于 **JSON-RPC 2.0** 协议，每条消息都是一个 JSON 对象。

---

### 解析 2：为什么 Server 用 async？

MCP Server 通常需要同时处理：
- 文件 I/O（读写文件）
- 网络请求（调用第三方 API）
- 数据库查询

这些都是 I/O 密集型操作，`async/await` 能让 Server 在等待 I/O 时处理其他请求，避免阻塞。

```python
# 同步版（阻塞）：查询数据库时整个 Server 卡住
result = db.query("SELECT...")    # 等 500ms

# 异步版（不阻塞）：等待期间可以处理其他请求
result = await db.async_query("SELECT...")    # 让出控制权
```

---

### 解析 3：MCP vs 直接 Tool Use 的区别

| 对比 | 直接 Tool Use | MCP |
|------|------------|-----|
| 工具定义位置 | 硬编码在应用里 | 独立的 Server 进程 |
| 复用性 | 只能在当前应用用 | 任何 MCP Client 都能用 |
| 热更新 | 需要重启应用 | Server 独立重启 |
| 权限隔离 | 工具在应用进程内运行 | Server 是独立进程，可以沙箱化 |
| 适合场景 | 简单、一次性工具 | 复杂工具、需要在多处复用 |

**结论**：个人项目或工具简单时用直接 Tool Use；需要工具复用、生态共享时用 MCP。

---

### 解析 4：Resources vs Tools

```
Resources（资源）：
  - 只读，不修改状态
  - 模型主动"拉取"数据
  - 例：读取配置文件、查看数据库记录

Tools（工具）：
  - 可以有副作用（写文件、发请求、修改数据库）
  - 模型"触发"操作
  - 例：写文件、发送邮件、执行代码
```

设计 MCP Server 时，查询类操作放 Resources，写入/操作类放 Tools。

---

### 解析 5：安全注意事项

MCP Server 会被 AI 模型直接调用，安全性非常重要：

```python
# ❌ 危险：允许任意命令执行
@app.call_tool()
async def call_tool(name: str, arguments: dict):
    if name == "run_command":
        result = os.system(arguments["command"])  # 危险！

# ✅ 安全：限制允许的操作
ALLOWED_COMMANDS = ["ls", "pwd", "date"]

@app.call_tool()
async def call_tool(name: str, arguments: dict):
    if name == "run_command":
        cmd = arguments["command"]
        if cmd not in ALLOWED_COMMANDS:
            raise ValueError(f"不允许执行: {cmd}")
        result = subprocess.run(cmd, capture_output=True, text=True)
        return [types.TextContent(type="text", text=result.stdout)]
```

**安全原则**：
- 最小权限：只暴露必要的工具
- 输入验证：对所有参数进行校验
- 路径安全：防止路径穿越（`../../../etc/passwd`）
- 速率限制：防止模型无限循环调用

---

### 小结：MCP 开发要点

```
✅ MCP = AI 工具的"USB 标准"，一次实现，到处可用
✅ Server 暴露三类能力：Tools（操作）/ Resources（数据）/ Prompts（模板）
✅ 本地开发用 stdio 传输，生产环境用 HTTP/SSE
✅ 使用现有 MCP Server 时，只需配置 JSON，无需写代码
✅ 自定义 Server 时注意安全：输入校验、最小权限
✅ async/await 是 MCP Server 的标准写法
```
