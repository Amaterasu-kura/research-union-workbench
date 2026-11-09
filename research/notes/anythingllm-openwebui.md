# AnythingLLM / Open WebUI 源码级调研（结论稿）

> 对象：AnythingLLM `308b2766`（v1.19.0，2026-11-05）、Open WebUI `b0e6098e`（v0.13.3，2026-11-09）。
> 仓库根：[anything-llm](../repos/anything-llm)、[open-webui](../repos/open-webui)。
> 方法：只读源码 + `路径:行号` 佐证。**未运行实测**（无 Docker/外网），资源数字为按 Dockerfile 与依赖推算的估算。

---

## 1. 许可证

| | AnythingLLM | Open WebUI |
|---|---|---|
| 文本 | **MIT**（`LICENSE:1-21`，Mintplex Labs Inc.） | **Open WebUI License**（`LICENSE:1-34`）＝BSD-3 式 + 第 4 条品牌条款 |
| 附加条款 | `TERMS_SELF_HOSTED.md` 是隐私/运维说明，**不是附加许可**：§5 明写 core is MIT（`:29`）；遥测可选可关（`:11-14`）；CDN 兜底下载模型（`:26`） | 第 4 条：禁止删改/遮挡/替换 "Open WebUI" 品牌，例外为 ①滚动 30 天 ≤**50** 用户 ②书面许可 ③企业许可（`LICENSE:20-34`） |
| 常见误读 | — | **50 人不是使用上限**，只是"可去品牌"的豁免线；超 50 人仍可自托管，但须保留品牌。违反第 4 条＝material breach（`:33-34`） |
| 历史 | 无 | MIT → BSD-3（`a76068d6`）→ Open WebUI License（`60d84a3a`），见 `LICENSE_NOTICE:5-9`、`LICENSE_HISTORY:1-53` |
| 对我们的含义 | 可改品牌、可闭源、可摘代码（留声明） | 自托管不去品牌 ✅；去品牌仅 ≤50 人；**只借鉴交互、自己重写**是唯一无灰区路径 |

## 2. 技术栈与运行单元

| | AnythingLLM | Open WebUI |
|---|---|---|
| 运行时 | Node：server（Express 4，`server/package.json:61`）+ collector（Puppeteer/Tesseract `collector/package.json:18-52`）+ React 前端（构建进 `server/public`） | Python：FastAPI + SQLAlchemy2 + Alembic（`pyproject.toml:9-41`）+ SvelteKit 前端 |
| 进程模型 | **1 容器 2 Node 进程**（`docker/docker-entrypoint.sh:19-28`），启动时跑 `prisma migrate` | 1 个 uvicorn 进程 + 可选 Redis（socket.io 多副本，`env.py:457-478`） |
| 应用库 | **SQLite 硬编码**（`server/prisma/schema.prisma:13-16`），PG 仅注释（`:5-12`），41 个 SQLite 迁移 | SQLite 默认（`env.py:261`）／PG 一等公民 |
| 向量库 | 11 种，默认 **lancedb**（`server/utils/helpers/index.js:87-90`） | 10+ 种，默认 **chroma 内嵌**（`config.py:483`）；slim 默认 pgvector，单表 `document_chunk`（`retrieval/vector/dbs/pgvector.py:74-88`） |
| Embedding | 默认本地 ONNX `Xenova/all-MiniLM-L6-v2`（`helpers/index.js:313-364`、`EmbeddingEngines/native/index.js:8`） | 默认本地 sentence-transformers，**启动即加载**（`config.py:1011-1018`、`main.py:694`、`routers/retrieval.py:143-165`） |
| 镜像 | ubuntu noble + Node24 + Chromium + ffmpeg（`docker/Dockerfile:2,15-40,65-72`），~2.5–3.5GB（估） | 标准：torch CPU + 模型烘入（`Dockerfile:175-186`）~4–6GB（估）；slim：~1–1.5GB |
| 默认端口 | 3001 单端口（`docker/docker-compose.yml:24-25`） | 8080 |
| 默认鉴权 | **单用户无鉴权**（`server/utils/middleware/validatedRequest.js:19-26`） | 开放注册（`config.py:1687`），新用户 pending（`:1749`） |
| 官方资源 | ≥2GB RAM / ≥10GB 盘（`BARE_METAL.md:10-13`） | 未标注；按依赖推算见 §6 |

## 3. 数据模型与 RAG

**AnythingLLM**（`server/prisma/schema.prisma`）：`users:61-90`（role=admin/manager/default）、`workspaces:121-152`（`slug` 同时是向量 namespace、`openAiPrompt/topN/similarityThreshold/chatProvider/chatModel`）、`workspace_users:214-222`、`workspace_documents:27-40`、`workspace_threads:154-168`、`workspace_chats:182-196`（**一问一答一行，response 是 JSON 字符串**，无 message id）、`document_vectors:113-119`。
RAG：`utils/chats/stream.js:103-283`（hasNamespace→相似检索 topN/threshold→pinnedDocs→fillSourceWindow→compressMessages→流式）。**query 模式零命中直接拒答**（`:245-283`）；**sources 只放本次命中，context 才回填历史**（`:230-237` 注释说明理由）。
引用：流末块返回 `sources`（`:377-400`）；前端 `Citation/index.jsx`（`combineLikeSources` 合并同文档多 chunk + 相似度）。

**Open WebUI**（`backend/open_webui/models/`）：`chat:183-207`（**`chat` JSON 整棵树** + `share_id/archived/folder_id`）、`chat_message:161-199`（`parent_id` 树、`sources/usage`，与 chat 表**双写**）、`knowledge:49-116` + `knowledge_file`、`file:18-31`（`data.status`）、`user:140-176`、`access_grant:23-43`（resource×principal(user/group/anyone)×read/write）、`folder:20-31`。**无 project 概念**。
RAG：`utils/middleware.py:1685-1803`（可 LLM 生成检索 query → `retrieval/utils.py:1382` 展开 file/collection/note/folder → 向量+BM25+rerank → 注入 `<source>` 标签 → SSE `sources_retrieved` 状态）。Collection 名 `file-{id}`（`routers/retrieval.py:1684`）。
引用：`src/lib/components/chat/Messages/Citations.svelte:1-110`（`[1]` 角标 + Modal + distances 相关度）。
文档状态：`file.data.status` 四态 + `/files/{id}/process/status?stream=true`（`routers/files.py:647-705`）。

## 4. 复用判定

| 方案 | 结论 | 理由 |
|---|---|---|
| AnythingLLM 整机 sidecar | ❌ | MIT 无碍，但 Node 栈、**SQLite 无法进我们的 PG**、开发者 API 是**实例级 key**（`middleware/validApiKey.js:4-25`）、对话 `user_id=null` 仅靠 `api_session_id`（`utils/chats/apiChatHandler.js:147-164`）、默认无鉴权 |
| Open WebUI 整机 sidecar | ⚠️ **可选旁路** | 同 Python 栈、pgvector 可复用同实例、**trusted header 可接 SSO**（`env.py:812-815`）、API key 是**用户级**（`utils/auth.py:411-440`）；但品牌条款 + 0.13.x 每周迭代 + 第二份用户/知识库 |
| 复制模块 | ✅ 仅 AnythingLLM（MIT） | 嵌入子进程隔离、SSE 进度协议、pgvector 表结构、流式事件语义 |
| 仅参考交互 | ✅ 两者 | 见 §7 |

## 5. 与我们栈的冲突（若做 sidecar）

- **统一登录**：Open WebUI 可反代注入 `WEBUI_AUTH_TRUSTED_EMAIL/ROLE/GROUPS_HEADER` 自动建号，须同时关 `ENABLE_SIGNUP`、关登录表单；AnythingLLM 只有"开发者 API 签发一次性 token"（`middleware/simpleSSOEnabled.js:11-35`、`api/userManagement/index.js:63-90`），且要求多用户+额外开关，用户仍需在它那边建号。
- **归属**：AnythingLLM 开发者 API 不认用户身份 → 鉴权只能我们在外层兜；Open WebUI 有 `chat.user_id` + access_grant，可按人隔离。
- **知识库双写**：两者都没有"只写向量"的合法入口（collection 与 file/knowledge 行强绑定）→ 只能**单向、幂等、可重建**；禁止在 sidecar 侧编辑。
- **可编程性**：Open WebUI 有 OpenAI 兼容 `/api/v1/chat/completions`（`main.py:1104`）、`/models`（`:877`）、`/embeddings`（`:1068`）、Anthropic `/api/v1/messages`（`:2076`）及原生 `/api/v1/{chats,files,knowledge,users}`（`:818-866`）。AnythingLLM 有 `/api/v1/*` + Swagger，OpenAI 兼容端把 **workspace slug 当 model id**（`endpoints/api/openai/index.js:19,76`），但 key 无 scope/过期、无 webhook。
- **项目模型**：两者都没有研会"部门/届次/活动"的项目语义，需外层映射表 + 对账。

## 6. Mac mini M4 16GB

| | 空闲 | 峰值 | 磁盘 |
|---|---|---|---|
| AnythingLLM | ~0.5–0.7GB（2 Node 进程） | ~1.0–1.5GB（嵌入子进程 +300–500MB，用完退出） | 镜像 2.5–3.5GB |
| Open WebUI 标准（本地 embedding） | ~0.9–1.5GB | ~1.8–2.5GB | 4–6GB |
| Open WebUI 标准 + 外部 embedding | ~0.5–0.8GB | ~1.2GB | 同上（不加载 torch） |
| Open WebUI slim | ~0.3–0.5GB | ~0.8GB | 1–1.5GB |

我们栈约 1.5–3GB。**结论**：任选一个 sidecar 均可共存（3.5–6.5GB），但三者全开不建议；若还要本机跑 Ollama，标准版 Open WebUI 的 1–2GB 会挤压 KV cache——**本机只保留一个"重"服务**。
**Open WebUI 默认确实会拉起本地 embedding**（`main.py:694`）；关闭方式：`RAG_EMBEDDING_ENGINE=openai|ollama|azure_openai`（`get_ef` 返回 None），或用 slim 镜像；但 **slim 只剩 csv/html/txt/md/xml 能本地解析，PDF/DOCX 需外部解析器**（`retrieval/loaders/main.py:713-726`、`factory.py:19-27`）——对以 PDF 为主的知识库是硬伤。

## 7. 值得借鉴（5 个）

1. **语义化 SSE**：`textResponseChunk / promptChatId / sources / abort / finalize`，引用只在末块（`chats/stream.js:285,326-400`），前端 `fetchEventSource`+`AbortController` 同步中断后端（`:93`、`frontend/src/models/workspace.js:184-247`）。
2. **引用**：角标+侧栏+原文片段+相似度；同文档多 chunk 合并；**只显示本次命中**（`stream.js:230-237`）。
3. **文档状态机 + 子进程隔离 + 断线重放**：`jobs/embedding-worker.js:1-25`（OOM 只杀 worker）、`utils/EmbeddingWorkerManager.js:1-140`（chunk 级进度、eventHistory 重放）、`endpoints/workspaces.js:1033-1090`。→ 我们用 Redis 队列 + SSE，四态可重试可取消。
4. **模型切换**：项目默认 + 会话覆盖（AnythingLLM `LLMSelector/index.jsx:100-106`）；Open WebUI `selectedModels[]` 支持多模型并排（`ModelSelector.svelte:12-89`）。
5. **会话管理**：从某条消息分叉（`endpoints/workspaces.js:733-800`；Open WebUI `chat_message.parent_id`）、归档（`chats.py:195`）、分享（`chats.py:194`）。

**不值得**：AnythingLLM 的 Agent/MCP/浏览器扩展/多向量库；Open WebUI 的终端/频道/日历/自动化/SCIM（已膨胀为 "AI OS"）；两者的 JSON+规范表双写；两者的自有用户闭环。

## 8. 结论

| 项目 | 定位 | 采用方式 |
|---|---|---|
| AnythingLLM | **不用** | 只读设计 + 可摘 <200 行 MIT 实现（子进程嵌入、pgvector 表结构、SSE 事件语义）；不部署 |
| Open WebUI | **可选 sidecar（旁路）** | 仅内部灰度/对照/兜底：独立 compose、锁 digest、`VECTOR_DB=pgvector` 指向独立 database、外部 embedding、trusted header 接 SSO、关注册；>50 人保留品牌；不进主链路 |
| 自研 | **主系统** | FastAPI 做 chat/RAG/文件/权限 + Next.js UI + PG/pgvector + Redis 队列 |

## 附录：证据索引（精选）

- 许可：`LICENSE:1-34`（Open WebUI 第 4 条 `:20-34`）、`LICENSE_NOTICE:5-9`、`TERMS_SELF_HOSTED.md:5-31`
- AnythingLLM：`prisma/schema.prisma:5-16,27-40,61-90,113-168,182-222`；`utils/helpers/index.js:87-90,313-364`；`utils/chats/stream.js:93,103-283,377-400`；`jobs/embedding-worker.js:1-25`；`utils/EmbeddingWorkerManager.js:1-140`；`endpoints/workspaces.js:733-800,1033-1090`；`middleware/validApiKey.js:4-25`；`middleware/validatedRequest.js:19-26`；`utils/chats/apiChatHandler.js:147-164`；`endpoints/api/openai/index.js:19,76`；`docker/Dockerfile:2,15-40,65-72`；`docker/docker-entrypoint.sh:19-28`；`BARE_METAL.md:10-13`
- Open WebUI：`pyproject.toml:9-41`；`env.py:43,261,812-815`；`config.py:483,957,1011-1018,1687,1749,2596`；`main.py:694,818-866,877,1068,1104,2076`；`utils/middleware.py:1685-1803`；`retrieval/utils.py:1382`；`retrieval/loaders/main.py:713-726`；`retrieval/vector/{factory.py:19-27,dbs/pgvector.py:74-88}`；`models/{chats.py:183-207,chat_messages.py:161-199,knowledge.py:49-116,files.py:18-31,users.py:140-176,access_grants.py:23-43}`；`routers/{files.py:647-705,retrieval.py:143-165,514,1684}`；`src/lib/components/chat/Messages/Citations.svelte:1-110`；`Dockerfile:22-24,46-51,175-186`

**局限**：未跑容器（镜像体积/RSS 为估算）；行号基于上述两个 commit，升级会漂移；未做依赖漏洞扫描。
