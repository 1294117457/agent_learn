# Skill（Agent 技能）开发指南

---

## 第一部分：核心概念

### 什么是 Skill？

Skill（技能）是为 AI Agent 预定义的**可复用任务模板**。它将一个复杂的、有固定流程的任务封装成一个可以被触发的单元，使 Agent 能够以标准化方式执行专项任务。

可以把 Skill 理解为 Agent 的"SOP（标准操作流程）"：

```
没有 Skill（临时发挥）：
  用户："帮我审查这个 PR"
  Agent 每次都重新想："我应该检查什么？格式？逻辑？安全？..."
  → 质量不稳定，可能遗漏重要检查项

有了 Skill（标准化执行）：
  用户："帮我审查这个 PR"
  Agent 调用 "code-review" Skill
  → 按照预定义的步骤系统性执行，输出格式统一
```

### Skill 在 Claude Code 中的实现

在 Claude Code 生态中，Skill 以 **Markdown 文件**的形式存在，通过特定目录结构被加载：

```
项目根目录/
  .claude/
    commands/           ← 项目级 Skill（只对此项目生效）
      commit.md
      review-pr.md
      deploy.md

~/.claude/
  commands/             ← 全局 Skill（对所有项目生效）
    my-skill.md
```

用户输入 `/commit` 时，Claude 会加载对应的 Markdown 文件作为系统级指令执行。

### Skill 的构成要素

一个完整的 Skill 包含：

```markdown
---
# Frontmatter（元信息，可选）
description: "Skill 的描述"
---

# 主体内容
Skill 的执行指令、步骤、规则...

$ARGUMENTS  ← 用户传入的参数占位符
```

**关键要素：**
- **触发名称**：文件名即触发命令（`commit.md` → `/commit`）
- **执行指令**：告诉模型需要做什么、怎么做
- **参数支持**：`$ARGUMENTS` 接收用户额外输入
- **工具调用**：Skill 内部可以指示模型使用工具（读文件、执行命令等）

### Skill 与其他概念的关系

```
┌─────────────────────────────────────────────────┐
│                  AI Agent 能力层                  │
│                                                 │
│  LLM API ←── 核心推理引擎                        │
│     ↑                                           │
│  Tool Use ←── 单次工具调用能力                    │
│     ↑                                           │
│  MCP Server ←── 可复用的工具集合                  │
│     ↑                                           │
│  Skill ←── 编排工具+指令的高层任务模板             │
│     ↑                                           │
│  用户触发（/command 或自然语言）                   │
└─────────────────────────────────────────────────┘
```

**层次说明：**
- LLM 是底层推理引擎
- Tool Use / MCP 提供能力（能做什么）
- Skill 定义策略（怎么做、按什么规范做）

### 广义的 Skill 概念

除了 Claude Code 的 `/command` 形式，在更广泛的 Agent 开发中，Skill 泛指：

| 形式 | 描述 | 典型框架 |
|------|------|---------|
| Slash Command | `/command` 触发的 Markdown 模板 | Claude Code |
| Prompt Template | 参数化的任务提示 | LangChain |
| Workflow Node | 可视化流程中的节点 | Dify, Flowise |
| Sub-Agent | 专门处理特定任务的子智能体 | AutoGen, CrewAI |
| Tool Function | 封装为函数的原子操作 | 所有 Agent 框架 |

---

## 第二部分：快速上手教程

### 教程 1：创建第一个 Skill（Git Commit）

创建文件 `.claude/commands/commit.md`：

```markdown
分析当前 git 暂存区的变更内容，生成一条规范的 git commit message 并执行提交。

执行步骤：
1. 运行 `git diff --staged` 查看暂存区变更
2. 运行 `git status` 了解整体状态
3. 根据变更内容，生成符合以下规范的 commit message：
   - 格式：`<type>(<scope>): <description>`
   - type: feat/fix/docs/refactor/test/chore
   - description: 用中文简洁描述变更内容（不超过50字）
   - 如有必要，添加详细描述（Body）
4. 向用户展示生成的 commit message，询问确认
5. 确认后执行 `git commit -m "<message>"`

$ARGUMENTS
```

**使用方式：**
```
# 基本使用
/commit

# 带额外说明
/commit 这是紧急修复，需要在描述中注明
```

---

### 教程 2：代码审查 Skill

创建文件 `.claude/commands/review.md`：

```markdown
对指定的代码进行全面的代码审查，输出结构化的审查报告。

审查目标：$ARGUMENTS

如果没有指定目标，询问用户要审查哪个文件或 PR。

## 审查维度

### 1. 代码质量
- 命名是否清晰（变量、函数、类名）
- 函数职责是否单一
- 是否有重复代码
- 复杂度是否过高

### 2. 潜在 Bug
- 边界条件处理
- 空值/异常处理
- 并发安全性
- 资源释放（文件句柄、数据库连接等）

### 3. 安全性
- SQL 注入、XSS 等常见漏洞
- 敏感信息（密码、密钥）是否硬编码
- 输入验证是否完整

### 4. 性能
- 是否有明显的 N+1 查询
- 循环中是否有不必要的重复计算
- 大数据处理是否有内存风险

## 输出格式

用以下格式输出审查结果：

### 总体评分
[1-10 分] - [一句话总结]

### 问题列表
| 级别 | 位置 | 问题描述 | 建议修复 |
|------|------|---------|---------|
| 🔴 严重 | ... | ... | ... |
| 🟡 警告 | ... | ... | ... |
| 🔵 建议 | ... | ... | ... |

### 优点
[列出代码中做得好的地方]
```

---

### 教程 3：自动化部署检查 Skill

创建文件 `.claude/commands/pre-deploy.md`：

```markdown
在部署前执行全面的预检查，确保代码安全可以上线。

## 检查清单

### 代码检查
- [ ] 运行 `git status` 确认没有未提交的变更
- [ ] 运行 `git log --oneline -10` 查看最近提交记录
- [ ] 检查是否有调试代码（console.log、print、debugger）
- [ ] 检查是否有 TODO/FIXME 标注

### 配置检查
- [ ] 检查 `.env` 文件是否被 `.gitignore` 排除
- [ ] 检查生产环境配置（数据库地址、API 密钥）是否正确
- [ ] 检查 `DEBUG` 模式是否关闭

### 依赖检查
- [ ] 检查 `requirements.txt` 或 `package.json` 是否有安全漏洞
- [ ] 确认所有依赖版本已锁定

### 测试检查
- [ ] 确认测试全部通过
- [ ] 查看测试覆盖率报告

## 输出

生成部署检查报告，标记每项检查的状态（✅通过 / ❌失败 / ⚠️需关注），
并在报告末尾给出是否建议部署的结论。

目标环境：$ARGUMENTS
```

---

### 教程 4：用 Python 实现自定义 Skill 系统

如果你在开发自己的 Agent，可以实现类似的 Skill 机制：

```python
import os
from pathlib import Path
import anthropic

class SkillManager:
    """Skill 管理器：加载和执行预定义的任务模板"""

    def __init__(self, skills_dir: str = ".agent/skills"):
        self.skills_dir = Path(skills_dir)
        self.skills = {}
        self._load_skills()

    def _load_skills(self):
        """从目录加载所有 Skill 文件"""
        if not self.skills_dir.exists():
            return

        for skill_file in self.skills_dir.glob("*.md"):
            skill_name = skill_file.stem
            content = skill_file.read_text(encoding="utf-8")

            # 解析 frontmatter（如果有的话）
            description = ""
            body = content

            if content.startswith("---"):
                parts = content.split("---", 2)
                if len(parts) >= 3:
                    import yaml
                    meta = yaml.safe_load(parts[1])
                    description = meta.get("description", "")
                    body = parts[2].strip()

            self.skills[skill_name] = {
                "name": skill_name,
                "description": description,
                "template": body
            }

        print(f"已加载 {len(self.skills)} 个 Skill: {list(self.skills.keys())}")

    def get_skill_prompt(self, skill_name: str, arguments: str = "") -> str:
        """获取替换了参数的 Skill 提示"""
        if skill_name not in self.skills:
            raise ValueError(f"Skill '{skill_name}' 不存在")

        template = self.skills[skill_name]["template"]
        return template.replace("$ARGUMENTS", arguments)

    def list_skills(self) -> list[dict]:
        """列出所有可用 Skill"""
        return [
            {"name": k, "description": v["description"]}
            for k, v in self.skills.items()
        ]


class SkillAgent:
    """集成了 Skill 系统的 Agent"""

    def __init__(self):
        self.client = anthropic.Anthropic()
        self.skill_manager = SkillManager()

    def run_skill(self, skill_name: str, arguments: str = "", context: str = ""):
        """执行一个 Skill"""
        skill_prompt = self.skill_manager.get_skill_prompt(skill_name, arguments)

        messages = [{"role": "user", "content": skill_prompt}]

        # 如果有额外上下文（如文件内容），加入到消息中
        if context:
            messages[0]["content"] = f"{context}\n\n---\n\n{skill_prompt}"

        print(f"\n执行 Skill: {skill_name}")
        print("─" * 50)

        # 流式输出
        with self.client.messages.stream(
            model="claude-sonnet-4-6",
            max_tokens=4096,
            messages=messages
        ) as stream:
            for text in stream.text_stream:
                print(text, end="", flush=True)

        print("\n" + "─" * 50)

    def interactive(self):
        """交互式界面，支持 /skill_name 触发"""
        print("Agent 已启动。输入 /list 查看可用 Skill，/quit 退出")

        while True:
            user_input = input("\n> ").strip()

            if user_input == "/quit":
                break

            elif user_input == "/list":
                skills = self.skill_manager.list_skills()
                print("\n可用 Skill：")
                for s in skills:
                    print(f"  /{s['name']} - {s['description']}")

            elif user_input.startswith("/"):
                # 解析 skill 名称和参数
                parts = user_input[1:].split(" ", 1)
                skill_name = parts[0]
                arguments = parts[1] if len(parts) > 1 else ""

                try:
                    self.run_skill(skill_name, arguments)
                except ValueError as e:
                    print(f"错误: {e}")

            else:
                # 普通对话
                response = self.client.messages.create(
                    model="claude-sonnet-4-6",
                    max_tokens=1024,
                    messages=[{"role": "user", "content": user_input}]
                )
                print(f"Agent: {response.content[0].text}")


# 使用示例
if __name__ == "__main__":
    agent = SkillAgent()
    agent.interactive()
```

---

### 教程 5：组合型 Skill（Skill 调用 Skill）

在 LangChain 中实现带子技能的复合 Skill：

```python
from langchain_anthropic import ChatAnthropic
from langchain_core.tools import tool
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.output_parsers import StrOutputParser
from langgraph.prebuilt import create_react_agent

llm = ChatAnthropic(model="claude-sonnet-4-6")

# 定义子技能作为工具
@tool
def analyze_code_quality(code: str) -> str:
    """分析代码质量，检查命名规范、复杂度等"""
    chain = (
        ChatPromptTemplate.from_template(
            "分析以下代码的质量问题，输出简洁的要点列表：\n\n{code}"
        )
        | llm
        | StrOutputParser()
    )
    return chain.invoke({"code": code})

@tool
def detect_security_issues(code: str) -> str:
    """检测代码中的安全漏洞"""
    chain = (
        ChatPromptTemplate.from_template(
            "检查以下代码的安全漏洞（SQL注入、XSS、硬编码密钥等），输出发现的问题：\n\n{code}"
        )
        | llm
        | StrOutputParser()
    )
    return chain.invoke({"code": code})

@tool
def suggest_optimizations(code: str) -> str:
    """提出性能优化建议"""
    chain = (
        ChatPromptTemplate.from_template(
            "分析以下代码的性能问题并提出优化建议：\n\n{code}"
        )
        | llm
        | StrOutputParser()
    )
    return chain.invoke({"code": code})

# 组合型 Skill：综合代码审查（调用三个子技能）
REVIEW_SKILL_PROMPT = """
你是一个资深代码审查专家。请对用户提供的代码进行全面审查。

你有三个专项分析工具：
- analyze_code_quality: 分析代码质量
- detect_security_issues: 检测安全漏洞
- suggest_optimizations: 提出性能优化

请依次调用这三个工具，然后综合三方面的分析结果，
生成一份结构清晰的代码审查报告。
"""

review_agent = create_react_agent(
    llm,
    [analyze_code_quality, detect_security_issues, suggest_optimizations],
    state_modifier=REVIEW_SKILL_PROMPT
)

# 执行综合审查
code_to_review = """
def get_user(user_id):
    password = "admin123"  # 数据库密码
    conn = db.connect(f"postgresql://admin:{password}@localhost/mydb")
    query = f"SELECT * FROM users WHERE id = {user_id}"
    result = conn.execute(query)
    return result.fetchall()
"""

result = review_agent.invoke({
    "messages": [("human", f"请审查这段代码：\n```python\n{code_to_review}\n```")]
})

print(result["messages"][-1].content)
```

---

## 第三部分：教程解析

### 解析 1：为什么要用 Skill？

没有 Skill 的 Agent 存在的问题：

```
问题1：不稳定
  用户："帮我写 commit"
  第1次：写了标准的 feat: 格式
  第2次：写了随意的中文描述
  第3次：格式完全不同
  → 质量不可控

问题2：遗漏步骤
  代码审查时，模型可能只检查了语法，忘了检查安全性
  → 关键步骤被跳过

问题3：重复说明
  每次都要说"按照这个格式审查代码：1.检查... 2.检查..."
  → 用户体验差
```

Skill 把"怎么做"固化下来，模型只需要"执行"，不需要每次"设计"。

---

### 解析 2：$ARGUMENTS 的灵活用法

```markdown
# 基本用法：接收补充说明
/commit 这是紧急安全修复

# 作为目标参数
/review src/auth.py        ← $ARGUMENTS = "src/auth.py"

# 作为配置参数
/deploy production         ← $ARGUMENTS = "production"

# 多个参数（约定格式）
/translate zh-en README.md ← $ARGUMENTS = "zh-en README.md"
```

Skill 文件内可以说明如何解析 `$ARGUMENTS`：
```markdown
参数格式：`<目标语言> <文件路径>`
例如：/translate en-zh README.md
```

---

### 解析 3：Skill 的颗粒度设计

```
太细（原子级别）：
  /git-status   /git-add   /git-commit   /git-push
  → 用户需要手动编排，还不如直接用命令行

太粗（功能级别）：
  /release（自动测试+构建+部署+通知）
  → 单次失败影响太大，难以调试

恰当（任务级别）：
  /pre-deploy（部署前检查）
  /commit（暂存+消息+提交）
  /review（审查单个文件或PR）
```

**原则**：一个 Skill = 用户能明确表达的一个完整任务意图

---

### 解析 4：Skill 中的工具调用

Skill 的 Markdown 描述本质上是"指令"，模型会根据这些指令决定调用哪些工具：

```markdown
## 隐式工具调用（通过自然语言描述）
"运行 git diff --staged 查看变更"
→ 模型调用 Bash 工具执行命令

"读取 src/main.py 分析代码结构"
→ 模型调用 Read 工具读取文件
```

这意味着 Skill 能使用的工具，取决于 Agent 本身有哪些工具权限。

---

### 解析 5：构建 Skill 库的最佳实践

```
目录结构建议：
.claude/commands/
  ├── dev/              # 开发类
  │   ├── commit.md
  │   ├── review.md
  │   └── refactor.md
  ├── ops/              # 运维类
  │   ├── pre-deploy.md
  │   └── monitor.md
  └── docs/             # 文档类
      ├── generate-readme.md
      └── changelog.md

Skill 文件写作建议：
  1. 开头明确目标（这个 Skill 做什么）
  2. 分步骤描述（用编号列表）
  3. 指定输出格式（表格/列表/代码块）
  4. 说明边界情况（如果没有输入怎么办）
  5. 保持简洁，避免过度约束
```

---

### 解析 6：Skill 与 MCP Server 的协作

最强大的 Agent 是将两者结合：

```
用户输入：/analyze-db-performance

Skill（定义策略）：
  1. 连接数据库获取慢查询日志
  2. 分析 Top 10 慢查询
  3. 给出优化建议

MCP Server（提供能力）：
  - db-server: 提供数据库连接、查询执行工具
  - explain-server: 提供 EXPLAIN ANALYZE 工具
```

Skill 负责"做什么、怎么做"，MCP 负责"能做什么"。

---

### 小结：Skill 开发要点

```
✅ Skill = Agent 的 SOP，让复杂任务标准化、可复用
✅ 在 Claude Code 中，.claude/commands/*.md 即为 Skill
✅ 用 $ARGUMENTS 接收用户参数，增加灵活性
✅ Skill 颗粒度：一个完整的用户任务意图 = 一个 Skill
✅ Skill 描述输出格式，让结果可预期
✅ 复杂任务用子技能（Sub-skill）分解，每层职责单一
✅ Skill + MCP = 策略层 + 能力层，构成完整 Agent
```
