#### 与纯LangChain的区别

```
pdf-parse+sqlite3，不用LangChain的向量数据库和文档解析以来

更轻量
	无需额外运行redis，Chroma来支持向量数据库
	但是针对有限文件的保研功能足够,
	Chroma更标准化，扩展性强，ANN/HNSW，MMR算法检索速度极快
	LangChain解析工具丰富

总的来说，LangChain有运维成本高，错误难排查，api可能更新快的麻烦
	精简定义更合适
```



#### ragChain

```
Retrieval-Augmented Generation

```

##### zod

```
import * as z from "zod";

const Movie = z.object({
  title: z.string().describe("The title of the movie"),
  year: z.number().describe("The year the movie was released"),
  director: z.string().describe("The director of the movie"),
  rating: z.number().describe("The movie's rating out of 10"),
});

//美妙，

import zodToJsonSchema from "zod-to-json-schema";

再用这个转换为JsonSchema
```

