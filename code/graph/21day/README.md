1.这里的处理方式，还是根据之前学习的材料整合的，不够完善，这里各个图的处理都比较闭塞

2.实际整合应该全局角度考虑从main传入时state的各种字段
应该是main获取第一次用户输入的自然语言，然后validateNode处理，判断参数是否足够，

3.同时判断用户意图是apply或consult，
  如果参数不足或意图不明显则interrupt，获取用户二次Command

4.然后实际无论apply或consult核心逻辑都是和政策文件对比，
  consult返回给用户相关咨询，语言上的回答
  apply返回处理好的字段，后续给后端使用，

5.这么想，实际state的字段设置还需要重新考虑，比如MainState有missingInfo，ApplyState要有返回参的字段，consult是不是就可以直接返回对应的AIMessage，三个State都要有validate从自然语言提取的参数的字段

```
1. 全局设计思路 (架构蓝图)
主图 (MainGraph - 接待与质检)：
	接收用户的自然语言。
	通过 classifierNode 一次性完成：意图识别（intent）、字段提取（赛事、时间等）、缺失判断（missingInfo）。
	如果是 insufficient，直接在主图 interrupt 拦截追问。
	如果是 consult，带着问题进入咨询子图。
	如果是 apply，带着提取好的标准化字段进入申请子图。
咨询子图 (ConsultGraph - RAG 问答)：
    核心：纯语言交互。
    节点：Retrieve (查政策) -> Answer (生成回复)。
    输出：直接给 messages 追加一条 AIMessage，返回给用户看即可。
申请子图 (ApplyGraph - 审批流 & 结构化输出)：
    核心：工作流审批与结果下发。
    节点：拿到主图发来的标准字段 -> Send 并行多项合规检查 -> 汇总节点生成给后端调用的结构化 JSON 数据。
2. State 字段重新设计 (大一统模式)
根据你的需求，所有的图实际上都在操作和流转同一套“业务上下文”，建议采用一个大一统的 MainState，各取所需：
```

