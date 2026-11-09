# Dify 源码级调研（v1.19 / HEAD e0b48a2，2026-11-09）

> 调研对象：`/Users/sakura/better-student-union/research/repos/dify`（浅克隆，只读，未修改）。
> 结论场景：高校研究生会「AI 协同工作台」（Next.js + FastAPI + SQLAlchemy/Alembic + PostgreSQL/pgvector + Redis/RQ + Docker Compose，Mac mini M4 16GB）。不 Fork Dify，只判断「独立服务复用 / 借鉴架构 / 必自研」。
> 本文所有路径均相对仓库根目录；行号取自当前 HEAD。凡属估算而非源码事实的，均在文中显式标注（本机无 Docker CLI、无外网，无法实测镜像体积）。

---

## 0. 结论速览

| 维度 | 结论 |
|---|---|
| LICENSE | 修改版 Apache-2.0（+多租户禁止 +LOGO 保留）。**单工作区、内部自用、不暴露 Dify 控制台前端 → 可接受**。一旦给每个学院/部门各开一个 workspace，即触发多租户条款，必须商业授权。 |
| 后端框架 | **Flask 3.1 + flask-restx + SQLAlchemy 2.0.49 + Alembic 1.17.2（flask-migrate）+ Celery 5.6**，Python 3.13。**不是 FastAPI**（唯一例外是新拆出的 `dify-agent` 服务用 FastAPI）。 |
| 前端 | Next.js **16.4.5**（App Router/RSC，`output: 'standalone'`）+ React 19.3.1 + TS 6.0.2，pnpm workspace；`web/` 约 6435 个 ts/tsx，其中工作流编辑器 1640 个文件。 |
| 队列 | **Celery**（Redis broker，24+ 队列），不是 RQ。 |
| 图谱引擎 | v1.19 已把工作流执行内核**外置为 `graphon` 包**（git pin），`api/` 只留 Dify 侧适配层。804 个 py 文件 import graphon。 |
| 模型供应商 | 已**插件化**：`api/` 内不再有具体 provider 实现，全部经 plugin_daemon 调用 marketplace 插件。 |
| Compose | 47 个服务定义；默认 profile 起 **16 个容器**。核心必需 6 个（api/worker/beat/redis/db/plugin_daemon），其余全部可选。 |
| 复用判断 | **可直接依赖**：Service API（workflow run / dataset retrieve）、`dify-client`（MIT，npm 3.1.0）、sandbox 代码执行。**只能参考**：工作流 DSL/变量池、RAG 分层、版本化、HITL 审批。**不可用**：会话/消息、多租户权限、插件系统、Agent v2、前端编辑器。 |
| FastAPI 集成 | Dify **不能**做用户/权限/项目主库。会话与知识库**必须**以我们 Postgres 为真源，Dify 只做无状态能力服务，否则必然出现两套会话 + 两套知识库。 |
| Mac mini M4 16GB | 全量 Dify（含 agent_backend/web/weaviate）常驻约 **6–8 GB**，与本系统叠加后**不现实**；裁剪到 api+worker(1)+redis+pg+plugin_daemon 约 **2.6–3.6 GB**，**现实但需限并发**。 |

---

## 1. LICENSE 精读

`LICENSE:1-22` 全文仅 22 行，非标准 Apache：首行即声明「modified version of the Apache License 2.0, with the following additional conditions」（`LICENSE:3`）。

### 1.1 四条实质条款

| 行号 | 条款 | 对我们的含义 |
|---|---|---|
| `LICENSE:5` | 允许商用（含作为其他应用的后端服务、企业应用开发平台），但满足下列条件须商业授权 | 内部自用不属于「须授权」情形 |
| `LICENSE:7-8` | **多租户限制**：「Unless explicitly authorized by Dify in writing, you may not use the Dify source code to operate a multi-tenant environment」；并定义 tenant ≡ workspace（一个 workspace 是一个租户的隔离数据/配置区） | 这是唯一的硬红线。判据不是「有几个用户」，而是「有几个 workspace / 租户」。 |
| `LICENSE:10-11` | **LOGO/版权**：使用 Dify **前端**时不得移除/修改控制台或应用中的 LOGO 与版权信息；并明确「不涉及前端的使用不受此限」，前端范围 = 源码运行时 `web/` 目录或 Docker 运行时 `web` 镜像 | 只要不部署 `dify-web` 镜像、不改 `web/`，此条不适用 |
| `LICENSE:13-16` | 贡献者授权：作者可单方面收紧/放宽协议；贡献代码可被用于其云业务 | 与我们无关，但说明协议可能变化，需锁定版本 |
| `LICENSE:18` | 其余全部适用 Apache-2.0 | 专利授权、免责、保留声明等按 Apache |
| `LICENSE:20` | 「The interactive design of this product is protected by appearance patent.」 | **外观设计专利**保护交互设计。逐像素复刻工作流画布 UI 有风险；借鉴交互逻辑风险低。 |

### 1.2 内部自用是否可接受：**可以，但有 4 个前提**

1. **只开一个 workspace**（一个 tenant）。研究生会整体 = 1 个租户；成员用 `tenant_account_joins` 角色区分（`api/enums/account.py:7`：owner/admin/editor/normal/dataset_operator），这不算多租户。
   - ⚠️ 若「每个学院/部门一个 workspace」「给每个社团独立空间」→ 直接命中 `LICENSE:7`，属违约。届时的替代方案是自研多租户，或改用 Dify 商业授权。
2. **不部署 `web` 镜像 / 不使用 `web/` 源码**。只用 `api` + 我们自己的 Next.js。这样 LOGO 条款不适用。
3. **不复制工作流画布 UI 的视觉/交互外观**（`LICENSE:20`）。功能与数据结构（DSL）可以借鉴。
4. **锁定版本并留存 LICENSE**。协议允许作者单方面变更（`LICENSE:13-15`），v1.19 之后的新版本条款可能更严。建议 pin 镜像 digest，并保留 `LICENSE` 副本与内部合规说明。

### 1.3 许可证的「分叉」要注意

- `sdks/nodejs-client` 是**独立 MIT**（`sdks/nodejs-client/package.json` 中 `"license": "MIT"`，版本 3.1.0），与主仓协议无关，可放心 `npm i dify-client`。
- `plugin_daemon`、`sandbox`、`agent_backend`、`knowledge-fs` 都是**别的仓库/别的镜像**（`docker/docker-compose.yaml:568,621,753,670`），主仓 LICENSE 不必然覆盖。使用前须逐一确认其各自协议——本仓内没有它们的源码，**无法在本仓库内验证**。
- `graphon`（工作流内核）是 git 依赖（`api/pyproject.toml` 的 `[tool.uv.sources]`，rev `4fa2214…`），仓库外，**许可证未能在本环境核实**（无外网）。这是「不依赖 graphon 作为库」的重要理由之一。

---

## 2. 技术栈与运行单元

### 2.1 后端（`api/`）

| 项 | 事实 | 证据 |
|---|---|---|
| 语言 | Python `~=3.13.0` | `api/pyproject.toml:4` |
| Web 框架 | Flask ≥3.1.3 + flask-restx（git 分叉 pin）+ flask-login + flask-migrate | `api/pyproject.toml:14,34,35,38` |
| WSGI | gunicorn 26 + **gevent** worker（`SERVER_WORKER_CLASS=gevent`），`psycogreen` 补丁 | `api/pyproject.toml:19-22`；`api/docker/entrypoint.sh`；`docker/envs/core-services/api-worker.defaults` |
| ORM | SQLAlchemy **2.0.49**，`MappedAsDataclass` 声明式模型 | `api/uv.lock:6314-6315`；`api/models/base.py:15-23` |
| 迁移 | Alembic **1.17.2** + flask-migrate，**247** 个版本文件，启动时 `flask upgrade-db` | `api/uv.lock:145-146`；`api/migrations/versions/`（247 个）；`api/docker/entrypoint.sh:11` |
| 迁移并发保护 | 用 Redis 分布式锁 `db_upgrade_lock` 抢锁，抢不到就跳过 | `api/commands/system.py:136-170` |
| 队列 | Celery ≥5.6.3，Redis broker，队列 24+ 个（dataset/workflow/mail/plugin/…） | `api/pyproject.toml:9`；`api/docker/entrypoint.sh:39-42` |
| 默认并发 | `SERVER_WORKER_AMOUNT=1`、`CELERY_WORKER_AMOUNT=4`、`GRAPH_ENGINE_MAX_WORKERS=10` | `docker/envs/core-services/api-worker.defaults`、`api.defaults` |
| DB 连接池 | pool_size **30**、max_overflow 10、recycle 3600 → 单进程 40 连接 | `api/configs/middleware/__init__.py:210-224` |
| 代码规模 | 非测试 py 文件 **2742** 个，约 **53 万行** | `find api -name '*.py'` 统计 |

### 2.2 前端（`web/`）

| 项 | 事实 | 证据 |
|---|---|---|
| 框架 | Next.js **16.4.5** + React **19.3.1** | `pnpm-workspace.yaml:231,242` |
| 构建 | `output: 'standalone'`；另有实验性 `vinext` 运行时 | `web/next.config.ts:55`；`web/package.json` scripts |
| 类型/状态 | TS 6.0.2（`@typescript/typescript6`）、TanStack Query、jotai、zod | `pnpm-workspace.yaml:269`；`web/app/query-provider.tsx` |
| 与后端契约 | 自研 `@dify/openapi-content-mapper`：把 OpenAPI 文档编译成类型化调用 + TanStack Query hooks（TS 7.1 content mapper，beta） | `packages/openapi-content-mapper/README.md:1-20`；`web/next.config.ts:12-25` |
| 规模 | ts/tsx **6435** 个；`web/app/components/workflow/` **1640** 个 | 文件计数 |
| 构建内存 | 构建期要求 `NODE_OPTIONS=--max-old-space-size=4096` | `web/Dockerfile:29` |

### 2.3 数据与中间件

- **关系库**：PostgreSQL 15（默认 profile）或 MySQL 8（`docker/docker-compose.yaml:492,525`）。
- **缓存/队列**：Redis 6-alpine（`:552`）。
- **向量库**：**31 个后端适配器**，全部是 `api/providers/vdb/vdb-*` 下的独立 workspace 包（pgvector、pgvecto-rs、Qdrant、Weaviate、Milvus、Chroma、Elasticsearch、OpenSearch、Oracle、OceanBase、TiDB…）。统一抽象在 `api/core/rag/datasource/vdb/vector_factory.py`，类型枚举 `vector_type.py`。
- **对象存储**：内置 opendal 抽象（本地 fs / S3 / OSS / COS / Azure / GCS…），`STORAGE_TYPE=opendal`。

### 2.4 沙箱 / 插件机制（三套，别混淆）

| 机制 | 组件 | 实现 | 证据 |
|---|---|---|---|
| 代码节点沙箱 | `sandbox`（`langgenius/dify-sandbox:0.2.15`，Go） | 独立 HTTP 服务；API 侧 POST `/v1/sandbox/run`，带 `X-Api-Key`、`enable_network`、依赖预装目录 | `api/core/helper/code_executor/code_executor.py:14,81-100` |
| 插件运行时 | `plugin_daemon`（`dify-plugin-daemon:0.6.14-local`，Go） | API 通过 HTTP 调用 daemon（`PLUGIN_DAEMON_URL`），daemon 负责安装/启动插件进程、注入凭据、转发调用 | `api/core/plugin/impl/base.py:51,183` |
| Agent shell 沙箱 | `local_sandbox`（`dify-agent-local-sandbox`，`shellctl serve`） | 独立网络 + 强制走 Squid 代理，只允许访问 agent_backend 与 `/files/*` | `docker/docker-compose.yaml:594-618` |

插件分类见 `api/core/plugin/entities/plugin.py:61-67`（Tool / Model / Extension / AgentStrategy / Datasource / Trigger），声明结构见同文件 `:70-105`。

### 2.5 `docker-compose.yaml` 到底起多少容器

全文件 **47 个服务定义**（`docker/docker-compose.yaml`），默认 `COMPOSE_PROFILES=weaviate,postgresql,collaboration`（`docker/.env.example`）会起 **16 个**：

| 分类 | 服务 | 行号 | 必需性 |
|---|---|---|---|
| 初始化 | `init_permissions`（busybox，跑完即退） | `:271` | 必需（chown 卷） |
| 核心 | `api`（Flask, 5001） | `:297` | **必需** |
| 核心 | `worker`（Celery 全队列） | `:371` | **必需**（否则文档索引/异步工作流不动） |
| 核心 | `worker_beat`（定时任务） | `:441` | 必需（清理/调度任务） |
| 核心 | `plugin_daemon`（5002/5003） | `:620` | **必需**（模型/工具全部走它） |
| 核心 | `redis` | `:547` | 必需 |
| 核心 | `db_postgres` (profile `postgresql`) | `:487` | 必需（或 MySQL/OceanBase） |
| 前端 | `web`（Next standalone, 3000） | `:475` | 可选（我们会去掉） |
| 入口 | `nginx` | `:848` | 可选（直连 api 可去） |
| 代码执行 | `sandbox` | `:567` | 可选（不用 Code 节点可去） |
| Agent v2 | `agent_backend` | `:752` | 可选（不用 Agent 节点可去，但 compose 里 api 硬 `depends_on`） |
| Agent v2 | `local_sandbox` | `:594` | 可选 |
| 代理 | `ssrf_proxy` / `agent_ssrf_proxy`（squid） | `:805,778` | 可选（但 SSRF 防护建议保留） |
| 协作 | `api_websocket`（profile `collaboration`） | `:335` | 可选（多人同时编辑画布才要） |
| 向量库 | `weaviate`（默认） | `:882` | 必需其一 |
| KnowledgeFS | `knowledge_fs` + 5 个 worker（profile `knowledge-fs`/`knowledge-fs-celery`） | `:669-750` | **默认关闭，且镜像仅 amd64** |
| 重型可选 | `elasticsearch`(2g 内存上限)/`kibana`/`unstructured`(4 CPU/6G)/`milvus`+`etcd`+`minio`/`opensearch`/`oracle` 等 | `:1289,1329,1357,1170` | 全部可选 profile |

关键细节：

- **KnowledgeFS 是闭源/私有组件**：Dockerfile 首行注释「KnowledgeFS is released independently … Ordinary Dify API images do not rebuild or download a second copy of **the private engine**」（`api/Dockerfile:1-3`），compose 注释「The published image is **linux/amd64 only**」（`docker/docker-compose.yaml:668`），镜像 tag 还是 `deploy-konwledge`（拼写错误的非发布 tag，`:670`）。功能默认关闭（`api/configs/extra/knowledge_fs_config.py:21-24` `KNOWLEDGE_FS_ENABLED=False`）。→ **Mac mini M4（arm64）上不可用/需 QEMU 模拟，直接排除**。
- 只有两处写了资源限制：Elasticsearch `memory: 2g`（`:1315-1318`）、unstructured `cpus: "4.0" / memory: 6G`（`:1379-1383`）。其余服务**无限制**，会按需吃满。

### 2.6 镜像体积/内存量级（**估算，非实测**）

本机无 Docker CLI、无外网，以下按「基础镜像 + 依赖清单 + Dockerfile 步骤」推算，量级供决策，精确值需 `docker images` 复核：

| 镜像 | 体积估算 | 依据 |
|---|---|---|
| `dify-api` | **1.2–1.8 GB**（压缩后 ≈700–900 MB） | `python:3.13-slim-bookworm`（`api/Dockerfile:9`）+ `uv sync --frozen --no-dev`（`api/Dockerfile:31`）；`uv.lock` 里 **507** 个包，含 boto3、google-cloud-aiplatform、opentelemetry×8、gevent、gmpy2、numpy 等；生产阶段还装了 Node 24（`:59-80`） |
| `dify-web` | 300–500 MB | `node:24.22.1-alpine`（`web/Dockerfile:3`）+ standalone 产物 + 103 运行时依赖 |
| `dify-plugin-daemon` | 150–250 MB | Go 静态二进制 + 存储卷 |
| `dify-agent-backend` | **600 MB–1 GB** | pydantic-ai + openshell + e2b + grpcio（`dify-agent/pyproject.toml:10-30`） |
| `dify-sandbox` | 80–150 MB | Go + python3 运行时 |
| `dify-agent-local-sandbox` | 150–300 MB | shellctl + shell 工具链 |
| `weaviate:1.39.13` | 120–200 MB | — |
| `postgres:15-alpine` / `redis:6-alpine` | 250 MB / 35 MB | 官方镜像已知量级 |

**Dify 全家桶镜像合计约 3.5–5 GB 磁盘**（不含卷）。

---

## 3. 核心模块地图（真实路径）

> 注意：v1.19 的「引擎」与「Dify 适配」是分开的。`graphon` 提供 Graph/VariablePool/Engine/多数通用节点；`api/core/workflow/` 只保留 Dify 特有节点与胶水。

| 模块 | 路径 | 实现机制（1-2 句） |
|---|---|---|
| **工作流执行内核** | 外部包 `graphon`；Dify 侧入口 `api/core/workflow/workflow_entry.py:55-75` | `Engine` 以事件流驱动 DAG：`Graph` + `VariablePool` + `ExecutionFrame`，支持 layer 扩展（`ExecutionLimitsLayer`/可观测 layer）。Dify 通过 `EngineEventFilter` 把原始变量流重排为「响应顺序」的旧式流。 |
| 节点执行/节点类型 | `api/core/workflow/nodes/`（Dify 特有：agent/agent_v2/datasource/human_input/human_input_v2/knowledge_index/knowledge_retrieval/trigger_*）；通用节点在 graphon | 每种节点一个 `Node` 子类 + `entities.py` 里的 pydantic 数据模型；`NodeConfigDictAdapter` 校验节点 data。前端节点枚举 35 种：`web/app/components/workflow/types.ts:30-65`。 |
| 变量池 | `api/core/workflow/variable_pool_initializer.py`、`variable_prefixes.py`、`system_variables.py` | 变量选择器是 `(node_id, key)` 元组；`sys.*`、`env.*`、`conversation.*` 三类前缀；节点输入在创建时预加载（`preload_node_creation_variables`）。 |
| 流式输出 | `api/core/app/apps/base_app_queue_manager.py:164`、`message_based_app_generator.py:306-315`、`api/libs/broadcast_channel/` | 生成端往进程内队列 publish 事件；SSE 端订阅 Redis pub/sub 频道 `channel:{app_mode}:{workflow_run_id}`，把 `QueueXxxEvent` 转成 SSE `event:`。 |
| **模型供应商抽象** | `api/core/plugin/impl/model_runtime.py`、`api/core/model_manager.py`、`api/core/provider_manager.py`（1819 行） | 三层：`ProviderManager`（租户级凭据/模型配置，DB）+ `ModelInstance`（单次调用句柄）+ 插件侧 runtime。模型/provider/凭据实体来自 `graphon.model_runtime.entities`。实际 provider 代码不在本仓。 |
| **RAG/知识库** | `api/core/rag/`（extractor / splitter / index_processor / embedding / retrieval / rerank / data_post_processor / datasource） | 抽取（docx/pdf/xlsx/md/html/notion…）→ 分块（fixed/recursive + 父子块 + QA 模式）→ 索引（`IndexProcessorFactory` 按 `chunk_structure` 选 paragraph/parent-child/qa）→ 向量库 + 关键词索引双写 → 检索（语义/全文/混合 + 权重 + rerank + 阈值）→ 后处理（去重/重排/引用）。 |
| 检索编排 | `api/core/rag/retrieval/dataset_retrieval.py:126,406`；`retrieval/router/` | 多知识库时用 LLM 做 function-call 路由（`multi_dataset_function_call_router.py`）或 ReAct 路由，选库后再检索。 |
| 索引写入 | `api/core/rag/index_processor/index_processor.py:81` | `index_and_clean` 先删旧 segment 再写新块；写向量在事务外（先 `session.commit()` 再向量 I/O）。 |
| Rerank | `api/core/rag/rerank/rerank_model.py:20`、`weight_rerank.py` | 两种 runner：模型 rerank + 加权融合（向量 0-1 权重 / 关键词权重）。 |
| Embedding | `api/core/rag/embedding/cached_embedding.py` | 查询向量走 Redis 缓存（TTL 600s），文档向量批量落 `embeddings` 表做去重/复用。 |
| **Agent 策略** | `api/core/agent/`：`base_agent_runner.py`、`fc_agent_runner.py`（function-calling）、`cot_agent_runner.py`、`strategy/`（`base.py`,`plugin.py`） | 两套内置 runner（FC / CoT），外加插件式 agent-strategy；`MessageAgentThought` 记录每轮思考与工具调用；v1.19 另有 Agent v2（`core/workflow/nodes/agent_v2/`）委托给 `agent_backend`。 |
| **工具调用** | `api/core/tools/tool_engine.py`、`tool_manager.py`、`builtin_tool/providers/`（code/time/audio/webscraper）、`plugin_tool/`、`api_tool/`（OpenAPI）、`mcp_tool/`、`workflow_as_tool/`、`custom_tool/` | 统一 `Tool` 抽象（参数 schema + 凭据 + 调用），`ToolEngine` 负责鉴权/计费/文件上传回写；「工作流即工具」把一次 workflow run 包成 tool（`workflow_as_tool/tool.py:46`）。 |
| **会话与消息** | `api/models/model.py:1127`(Conversation)、`:1475`(Message)、`:2414`(MessageChain)、`:2433`(MessageAgentThought)、`:1843`(MessageFile)、`:1793`(MessageFeedback) | 会话绑定 `app_id + from_source + from_end_user_id/from_account_id`；消息存 query/answer/usage/price；思维链单独表；`conversation_variables` 表存会话级变量（`api/models/workflow.py:1537`）。 |
| **多租户与权限** | `api/models/account.py:29`(Account)、`:175`(Tenant)、`:212`(TenantAccountJoin)；`api/core/rbac/`；`api/controllers/common/rbac/checks.py:43` | 所有业务表带 `tenant_id` 列（23 个 model 文件有 `tenant_id: Mapped`），查询**手工**加 `tenant_id ==` 过滤，无全局行级策略。细粒度 RBAC 依赖企业版服务：`RBAC_ENABLED=false` 时 `enforce_rbac_checks` 直接 return（`:43-44`）。 |
| **插件系统** | `api/core/plugin/`（`impl/`、`entities/`、`plugin_service.py` 1426 行）、`plugin_daemon` 容器 | API 只做 HTTP 客户端 + 凭据加密 + 声明缓存；插件安装/进程管理/依赖安装在 daemon。插件包来自 marketplace（外部仓库）。 |
| **工作流版本化** | `api/models/workflow.py:169`(Workflow)、`:743`(WorkflowVersionCounter)、`version`/`version_number`/`marked_name`/`marked_comment` 字段（`:221-231`） | 每个 app 一行 `version='draft'` + N 行发布版本；`version_number` 由单独计数表单调分配，删除不回收。 |
| **HITL 人工审批** | `api/core/workflow/nodes/human_input/`、`human_input_v2/`；`api/models/human_input.py`、`workflow.py:2141`(WorkflowPause) | 执行到人工节点时把运行状态暂停并落库（pause + resume token），表单提交后从断点恢复；带超时任务（`api/tasks/human_input_timeout_tasks.py`）。 |
| **DSL 导入导出** | `api/services/app_dsl_service.py:940,1018`、`api/services/entities/dsl_entities.py:152`、`api/constants/dsl_version.py:1` | 整包导出为 YAML：`{version, kind, app, workflow{graph,features,env_vars,conv_vars}, dependencies, site}`；导入时做版本兼容检查、依赖检查、凭据剥离。 |

---

## 4. 关键数据结构 / 接口

### 4.1 工作流 DSL（schema 在哪、长什么样）

**版本**：`CURRENT_APP_DSL_VERSION = "0.7.0"`（`api/constants/dsl_version.py:1`），兼容性检查在 `api/services/dsl_version.py:check_version_compatibility`。

**顶层信封**（`api/services/entities/dsl_entities.py:152-166` + `api/services/app_dsl_service.py:1010-1024`）：

```yaml
version: "0.7.0"
kind: app
app: { name, mode, icon, icon_type, icon_background, description, use_icon_as_answer_icon }
workflow:                 # 由 Workflow.to_dict() 生成，api/models/workflow.py:685-699
  graph:                  # ← 核心；DB 里是 LongText JSON（workflow.graph），graph_dict 反序列化（:333-351）
    nodes: [ { id, type, position:{x,y}, data:{...}, width, height, ... } ]
    edges: [ { id, source, target, sourceHandle, targetHandle, type } ]
    viewport: { x, y, zoom }
  features: { ... }
  environment_variables: [ {name,value,value_type,description} ]
  conversation_variables: [ ... ]
  rag_pipeline_variables: [ ... ]
dependencies: [ { type: marketplace|github|package, value: {...} } ]
site: { ... }             # 可选
```

**校验位置**（没有单一 JSON Schema 文件，是 pydantic 分层校验）：

- 节点数据结构：`graphon.entities.graph_config.NodeConfigDictAdapter`（`api/core/workflow/workflow_entry.py:69`）。
- 节点私有 data：每种节点一个 `entities.py`，如 `api/core/workflow/nodes/knowledge_retrieval/entities.py:13-40`（`KnowledgeRetrievalNodeData`）。
- 图拓扑：`api/core/workflow/graph_topology.py:20-60`（nodes/edges 的 source/target 校验、环检测辅助）。
- 前端类型：`web/app/components/workflow/types.ts:30-65`（35 种节点 type 字符串，与后端 `BuiltinNodeTypes` 对齐）。

> 结论：**DSL 是「约定 + pydantic 校验」而非正式 schema**。想复用必须连同节点语义一起搬，成本高。

### 4.2 知识库检索 API

端点：`POST /v1/datasets/{dataset_id}/retrieve`（旧路径 `/hit-testing` 已标 deprecated）
（`api/controllers/service_api/dataset/hit_testing.py:29-88`）

**请求**（`HitTestingPayload`，`api/controllers/console/datasets/hit_testing_base.py:33-49`）：

```json
{
  "query": "≤250 字符",
  "retrieval_model": {                       // RetrievalModel, api/services/knowledge/entities/knowledge_entities.py:156-177
    "search_method": "semantic_search | keyword_search | hybrid_search | full_text_search",
    "reranking_enable": true,
    "reranking_mode": "reranking_model | weighted_score",
    "reranking_model": {"reranking_provider_name": "...", "reranking_model_name": "..."},
    "top_k": 4,
    "score_threshold_enabled": true,
    "score_threshold": 0.5,
    "weights": {"weight_type":"customized","vector_setting":{...},"keyword_setting":{...}},
    "metadata_filtering_conditions": {...}
  },
  "attachment_ids": ["..."]
}
```

**响应**（`HitTestingResponse`，`api/fields/hit_testing_fields.py:88-91`）：

```json
{"query":{"content":"..."},
 "records":[{"segment":{"id","position","document_id","content","sign_content","answer","word_count","tokens",
                        "keywords","index_node_id","index_node_hash","hit_count","enabled","status",
                        "document":{"id","data_source_type","name","doc_type","doc_metadata"}},
             "child_chunks":[{"id","content","position","score"}],
             "score":0.87,"files":[],"summary":null,"tsne_position":null}]}
```

调用后端鉴权：`Authorization: Bearer dataset-xxxx`（`ApiToken`，`api/models/model.py:2207-2240`；`DatasetApiTokenBinding` 可把 key 限制到特定知识库，`:2243+`）。

### 4.3 工作流运行 API

端点：`POST /v1/workflows/run`、`GET /v1/workflows/run/{id}`、`POST /v1/workflows/tasks/{id}/stop`（`api/controllers/service_api/app/workflow.py:287,231,551`）。

请求体：`{inputs, files?, response_mode: "blocking"|"streaming"}`（`:82-91`）。
响应体：`{id, workflow_id, status, inputs, outputs, error, total_steps, total_tokens, created_at, finished_at, elapsed_time}`（`:128-145`）。
流式用 SSE，事件类型见 `web/types/workflow.ts`（`workflow_started/node_started/node_finished/text_chunk/workflow_finished/workflow_paused/...`）。

### 4.4 Agent 运行记录

| 表 | 位置 | 说明 |
|---|---|---|
| `agents` | `api/models/agent.py:180` | 名册（roster）里的 Agent 实体，含 icon/scope/status |
| `agent_config_drafts` / `agent_config_snapshots` / `agent_config_revisions` | `:338 / :382 / :418` | 配置草稿 / 发布快照 / 修订流水（版本化） |
| `agent_home_snapshots` | `:263` | Agent 工作区快照（沙箱 home 的持久化） |
| `agent_workspaces` / `agent_workspace_bindings` | `:525 / :563` | 会话与 Agent 工作区的绑定 |
| `workflow_agent_node_bindings` | `:468` | 工作流 Agent 节点 ↔ 名册 Agent 的绑定（含 node job 配置） |
| `messages` / `message_agent_thoughts` / `message_chains` | `api/models/model.py:1475 / 2433 / 2414` | 传统 Agent 每轮思考/工具调用/链路 |
| 运行期执行绑定 | `dify-agent/src/dify_agent/server/execution_bindings.py:35-61` | Agent backend 内的执行会话（create/destroy binding） |
| 工作流运行 | `workflow_runs` / `workflow_node_executions` / `workflow_node_execution_offload` | `api/models/workflow.py:784 / 960 / 1243`；大字段可 offload 到对象存储 |

---

## 5. 复用判定（逐模块）

图例：**A=可直接依赖（HTTP/库）**、**B=可复制少量代码**、**C=只能参考设计**、**D=不可用**。
「数据归属」= 该模块是否会把业务数据锁进 Dify 的库结构。

| 模块 | 判定 | 理由（含证据） | 数据归属 |
|---|---|---|---|
| **Service API（workflow run / dataset retrieve / file upload）** | **A** | 稳定 REST + Bearer token；`dify-client` npm 包 MIT 已封装 chat/completion/workflow/knowledge-base（`sdks/nodejs-client/src/client/`）。耦合点仅「app_id + api_key」，可当我们 FastAPI 的一个上游服务。 | 运行日志落 Dify 库（可接受，视为执行审计） |
| **`dify-client`（Node SDK）** | **A** | `sdks/nodejs-client/package.json` `license: MIT`，v3.1.0，覆盖 chat/workflow/dataset。可直接被 Next.js（server side）依赖。 | 无 |
| **代码执行沙箱 `dify-sandbox`** | **A** | 纯 HTTP `/v1/sandbox/run` + `X-Api-Key`（`api/core/helper/code_executor/code_executor.py:81-100`），无业务耦合。可单独起一个容器给我们用（Python/Node/Jinja2）。 | 无（无状态） |
| **RAG 索引/检索流水线** | **A/B** | 作为服务用是 A；想自己实现则 B：分块策略（父子块 `parent_child_index_processor.py`）、`DataPostProcessor`（rerank+权重+阈值）、`RetrievalModel` 配置模型这三块代码量小、逻辑清晰，可移植（注意仍受 `LICENSE` 约束，属「衍生作品」范畴需保留声明）。 | **Dify 侧**（dataset/document/segment/embedding 全在 Dify 库） |
| **工作流 DSL / 变量池 / 节点执行** | **C**（不建议 A） | 内核已外置为 `graphon`（git pin，非发布版本，许可未核实，无 API 稳定性承诺）；Dify 侧适配层 804 处 import、`workflow_entry.py` 1000+ 行胶水；节点语义与前端强耦合（35 种 type）。作为库引入等于把最不稳定的部分变成我们的地基。**建议只借鉴：变量选择器模型、layer 分层、暂停/恢复**。 | 若用则全在 Dify 库 |
| **模型供应商抽象** | **D** | 具体 provider 已全部移出本仓，运行依赖 `plugin_daemon` + marketplace 插件包 + 插件进程沙箱（`api/core/plugin/impl/model_runtime.py:32-44`、`docker-compose.yaml:620`）。我们直接用 OpenAI 兼容 SDK 更简单。 | 凭据加密存 Dify 库 |
| **Agent 策略（ReAct/FC）** | **C** | `fc_agent_runner.py` 1000+ 行，深度绑定 `Message`/`MessageAgentThought`/`ToolManager`/`ModelInstance`；Agent v2 又外移到 `agent_backend`（FastAPI + pydantic-ai + Go 运行时 `dify-agent-runtime`）。借鉴「FC 优先、CoT 兜底」的判定逻辑即可。 | Dify 库 |
| **工具调用框架** | **C** | `Tool` 抽象值得抄（参数 schema + 凭据 + 文件回写）；但 `ToolEngine` 依赖计费、插件、租户凭据。MCP 部分可以「用」：Dify 可把 App 暴露成 MCP server（`api/controllers/mcp/mcp.py:67`），我们可直接消费。 | 混合 |
| **会话与消息** | **D** | 会话主键绑死 `app_id + from_source + end_user`（`api/models/model.py:1127-1180`），没有「项目」「话题」「成员」概念；且 console 会话与 service-api 会话是两套来源枚举。 | Dify 库，且与我们模型冲突 |
| **多租户与权限** | **D** | tenant=workspace 单层（`api/models/account.py:175`），角色只有 5 种枚举（`api/enums/account.py:7-13`）；细粒度 RBAC 是**企业版服务**，社区版 `RBAC_ENABLED` 默认 false 且实现为 no-op（`api/controllers/common/rbac/checks.py:43-44`）。 | Dify 库 |
| **插件系统** | **D** | 需要 Go daemon + marketplace 账号 + 插件签名/安装/进程管理；社区版插件生态是外部仓库。自带模型调用更省。 | 混合 |
| **工作流编辑器前端** | **D**（设计可 C） | 1640 个文件、依赖 `@langgenius/dify-ui`、`loro-crdt` 协同、`vinext` 实验运行时；且 `LICENSE:10-11` 要求保留 LOGO，`LICENSE:20` 有外观专利。 | — |
| **版本化机制（draft/published + 单调版本号）** | **B** | 设计极简：`version` 字符串（draft/时间戳）+ `version_number` 由 `WorkflowVersionCounter` 单调分配 + `marked_name/marked_comment`（`api/models/workflow.py:221-231,743-758`）。可直接仿写，约 100 行。 | 自建 |
| **HITL（人工审批/表单/超时/恢复）** | **C** | 机制值得完整借鉴（pause → 落库 → 表单提交 → resume），但实现与 workflow 状态机、`WorkflowPause`/`WorkflowPauseReason` 强绑（`api/models/workflow.py:2141,2209`）。 | 自建 |
| **KnowledgeFS（新知识库子系统）** | **D** | 私有引擎、非发布 tag、**仅 amd64**、默认关闭（`api/Dockerfile:1-3`、`docker-compose.yaml:668`、`configs/extra/knowledge_fs_config.py:21`）。 | Dify 库 |

---

## 6. 与 FastAPI + Next.js 集成的冲突点

### 6.1 主库归属：**必须是我们自己的 Postgres**

Dify 的数据模型里没有我们需要的三个核心实体：**EventSeries（活动系列）**、**Project（项目）**、**成员-项目角色**。它的顶层聚合是 `App`（`api/models/model.py:421`），App 属于 `Tenant`，Tenant 是计费/隔离单位。把项目塞进 App 会立刻遇到：

- 一个项目多对话 → 需要多个 App 或一个 chat App 多 conversation，但 conversation 无「项目」外键，只能靠 `app_id` 间接归属；
- 项目成员权限 → Dify 只有 workspace 级 5 角色，无法表达「某项目只读成员」；
- 活动系列下的多个项目 → Dify 没有层级。

**结论：用户、权限、项目、活动系列、文件元数据的主库 = 我们的 FastAPI + Postgres。Dify 库里只允许存在「执行记录」和「索引副本」。**

### 6.2 会话同步：会变成两套，且无法双向一致

Dify 的会话是 `conversations`（`app_id, from_source, from_end_user_id, ...`）+ `messages` + `message_agent_thoughts`，还有 `conversation_variables`（`api/models/workflow.py:1537`）。它的「用户」是 `EndUser`（`api/models/model.py:2040`，字段 `tenant_id/session_id/app_id/external_user_id`），由 `user` 参数惰性创建（`controllers/service_api/wraps.py:196-212`）。

如果我们让 Dify 存会话：

- 会话 id、消息 id、token 计数、引用的知识库片段全在 Dify 侧；我们的「项目内多对话」列表只能存 Dify conversation_id 做映射；
- 一旦我们想改标题、归档、按项目检索、按成员鉴权，都要回写 Dify，且 Dify 的 `PUT /conversations/{id}/name` 只支持改名（`api/controllers/service_api/app/conversation.py:260`）；
- 删除项目时需级联删 Dify 会话（有 `delete_conversation_task`，但要我们主动触发）；
- 两套消息表意味着「聊天记录导出/审计」要跨库 join。

**结论：会话主库 = 我们。Dify 只做「一次调用」，用 `conversation_id` 参数维持多轮上下文（Dify 侧会话仅作短期上下文容器），业务侧消息落我们自己的表。** 代价：Dify 侧的会话会随调用累积，需要定期清理任务（可复用 `schedule/clean_messages.py` 的思路）。

### 6.3 知识库：一定会变两套，除非明确「谁是索引」

Dify 的 `datasets`/`documents`/`document_segments`/`embeddings`（`api/models/dataset.py:150,374,554,715`）是完整的一套知识库。我们必然也有一份「项目文件」表（Word 策划案、附件）。

两种方案：

| 方案 | 做法 | 代价 |
|---|---|---|
| **A. Dify 为索引副本（推荐）** | 文件字节与元数据在我们库；上传后调 `POST /v1/datasets/{id}/documents/create-by-text`（或 file）推给 Dify，用 `doc_metadata` 存我们的 `project_id/file_id`；检索只调 `/retrieve`，用返回的 `document.id` 反查我们的文件。 | 需处理同步失败/重试；删除要双写；Dify 库是「可重建的派生数据」 |
| **B. Dify 为唯一知识库** | 我们的项目文件表退化成 `dataset_id` 映射 | 项目级权限、版本、审批全部无法表达 → 不可行 |

**结论：A。且必须在我们的库里显式维护 `dify_dataset_id` / `dify_document_id` 映射表，并把它标注为「可重建」。**

### 6.4 其他摩擦点（会被低估的）

1. **鉴权模型不同**：Dify Service API 是 **app/dataset 级 API Key**，不是用户 token（`api/models/model.py:2207`；`api/controllers/service_api/wraps.py:107-171`）。我们调用时必须由后端代持 key，绝不下发前端；同时 Dify 侧的 `user` 参数要传我们的 `user_id`，否则所有调用都落在同一个匿名 EndUser 上，审计不可用。
2. **身份两套**：Dify 有 Account（控制台）与 EndUser（应用侧）两套身份，我们的研究生会成员是第三套。不要把我们的用户同步进 Dify Account（会触发 workspace 成员语义与邀请流程）。
3. **多租户红线**：如果未来「每个学院一个 workspace」，直接违反 `LICENSE:7`。若一定要多组织，只能在**我们自己的库**里做多租户，Dify 侧始终 1 个 tenant。
4. **流式协议**：Dify SSE 事件名与我们的前端消息模型不同，需要在 FastAPI 里做一层转换（`text_chunk`/`message`/`agent_thought`…），不要在前端直接消费 Dify SSE——否则前端被 Dify 协议绑架。
5. **时区/时间戳**：Dify 大量用 naive UTC + 秒级 epoch（`libs/datetime_utils.ensure_naive_utc`，`to_timestamp`），与我们 `timestamptz` 习惯不同，转换层要统一。
6. **文件 URL**：Dify 返回 `files[].source_url` 是带签名的内部地址（`FILES_URL`），有 TTL（`FILES_ACCESS_TIMEOUT=300`）。前端不能缓存这些 URL，必须经我们后端代理。
7. **Word 生成能力不存在**：`api/core/rag/extractor/word_extractor.py` 只做 **.docx 读取**（`from docx import Document`），全仓没有 docx 生成代码（`grep "Document()"` 无写入用法）。**策划案生成与版本必须自研**（python-docx + 模板），Dify 帮不上。

---

## 7. Mac mini M4 16GB 是否现实

### 7.1 常驻内存估算（**估算，无实测**）

依据：Python/gevent 进程基线、Celery prefork 子进程数（默认 4）、Node 进程基线、Go 服务基线、DB 默认 shared_buffers。

| 组件 | 紧凑配置 | 默认配置 | 说明 |
|---|---|---|---|
| `api`（gunicorn 1 worker + gevent） | 350 MB | 500 MB | 加载了 507 个包，import 面很大 |
| `worker`（Celery） | 300 MB（`-c 1`） | **1.0–1.4 GB**（`-c 4`） | 每个 prefork 子进程 200–350 MB |
| `worker_beat` | 150 MB | 150 MB | |
| `plugin_daemon` | 80 MB + 每个插件进程 60–150 MB | 同左 ×N | 装 2–3 个模型插件后 +300 MB |
| `sandbox` | 40 MB | 40 MB | 不用 Code 节点可去掉 |
| `agent_backend` | 250 MB | 300 MB | 不用 Agent v2 可去掉 |
| `local_sandbox` | 50 MB | 50 MB | 可去掉 |
| `web`（Next standalone） | 200 MB | 250 MB | 我们会去掉 |
| `redis` | 40 MB | 60 MB | |
| `postgres` | 200 MB | 300 MB | shared_buffers 默认 128 MB |
| `weaviate` | 300 MB | 500 MB | 或换 pgvector（0 额外进程） |
| `nginx` + 2×`squid` | 60 MB | 80 MB | |
| **Dify 小计** | **≈2.0 GB**（api+worker1+beat+plugin+redis+pg+pgvector） | **≈4.2–5.0 GB**（+web+agent+sandbox+weaviate+代理） | |
| 我们的 Next dev/build | 400 MB–1.2 GB | 同左 | `next dev` 常驻 800 MB+ |
| 我们的 FastAPI（uvicorn 2 worker） | 250 MB | 300 MB | |
| 我们的 Postgres（同实例可复用） | — | — | 建议与 Dify 共用一个 PG 实例、不同 database |
| 我们的 Redis（可复用 Dify 的） | — | — | 不同 db index |
| 我们的 RQ worker | 150 MB | 250 MB | |
| **本系统小计** | ≈1.0 GB | ≈1.3 GB | |
| **合计** | **≈3.0 GB** | **≈5.5–6.5 GB** | |
| Docker Desktop VM 额外开销 | 1.5–3 GB | 同左 | macOS 上 Docker 跑在 Linux VM 里，**这部分不可忽略** |

### 7.2 判定

- **全量 Dify + 我们的栈 + Docker Desktop**：峰值 8–10 GB，16 GB 机器上**能跑但会频繁 swap**，且 `next build`（需 4 GB heap，`web/Dockerfile:29`）与 `worker -c 4` 同时进行会 OOM。**不推荐**。
- **裁剪版 Dify（api + worker(-c 1) + beat + plugin_daemon + redis + postgres + pgvector，去掉 web/nginx/agent_backend/local_sandbox/sandbox/weaviate）**：常驻 **2.6–3.6 GB**，加我们的栈 **4–5 GB**，Docker VM 8 GB 上限内**现实**。
- **额外收益**：把 Dify 的 `VECTOR_STORE` 设成 **pgvector**，可以直接复用同一个 Postgres 实例（`docker/envs/vectorstores/pgvector.env`），省掉一个 500 MB 的向量库进程，且 pgvector 在 arm64 上有官方镜像（`pgvector/pgvector:pg16`）。

### 7.3 CPU / 磁盘 / 启动时间

- **CPU**：M4 为 10 核（4P+6E）。Dify 默认要吃 `1(gunicorn) + 4(celery) + 1(beat) + N(plugin) + 1(node) ≈ 8–9` 个常驻进程，加上我们的 Next dev（Node 主线程 + 若干 worker）与 uvicorn，会长期打满 P 核。**必须把 `CELERY_WORKER_AMOUNT` 降到 1–2**（`docker/envs/core-services/api-worker.defaults` 的 `CELERY_WORKER_AMOUNT=4` 是默认值，可覆盖）。
- **磁盘**：镜像 3.5–5 GB（见 §2.6）；卷（`docker/volumes/`）中 `app/storage` 随 Word/PDF 增长，`plugin_daemon` 随插件增长（每个模型插件 20–80 MB），Postgres 数据 1–3 GB 起。**建议预留 20 GB**。
- **启动时间**（估算）：首次 `docker compose up` 需先跑 **247 个 Alembic 迁移**（`api/docker/entrypoint.sh:11`；`api/migrations/versions/` 247 个文件），并受 Redis 迁移锁串行化（`api/commands/system.py:136-157`）。冷启动 **60–120 s**，热启动（无迁移）**20–40 s**。`api` healthcheck `start_period: 30s`（`docker-compose.yaml:325`），`worker` `start_period: 60s`（`:400`）也印证了这个量级。
- **arm64 兼容性**：`dify-api`/`dify-web`/`plugin_daemon`/`sandbox` 均有 arm64 发布；**`knowledge-fs` 仅 amd64**（`docker-compose.yaml:668`），在 M4 上必须 QEMU 模拟 → **不要启用**。

### 7.4 只跑其中几个组件：**完全可行，且是推荐路径**

最小可用组合（给「工作流执行 + RAG 检索」用）：

```
postgres(15) + redis + api + worker(-c 1) + plugin_daemon + pgvector(同 PG 实例)
```
≈ 2.6–3.0 GB，5 个容器。去掉 `web`/`nginx`/`agent_backend`/`local_sandbox`/`sandbox`/`weaviate`/`ssrf_proxy` 后，`docker compose --profile postgresql --profile pgvector up api worker plugin_daemon redis db_postgres` 即可（注意 compose 里 `api` 对 `agent_backend` 有硬 `depends_on`，`docker-compose.yaml:311-312`，需要 `--no-deps` 或改用 `docker-compose.middleware.yaml` + 本机跑 api）。

> 开发期更轻的做法：用 `docker/docker-compose.middleware.yaml`（292 行，只起 postgres/redis/sandbox/plugin_daemon/weaviate，`docker/docker-compose.middleware.yaml:4,84,109,159,256`），api 用 `uv run flask run` 在本机跑。这样内存再省 300–500 MB，且热重载快。

---

## 8. 最值得移植到我们系统的 3–5 个设计/功能

> 移植成本按「1 名熟悉 Python/TS 的工程师」估算，含测试，不含需求澄清。

### ① 版本化模型：draft/published 双态 + 单调版本号 + 标注（**强烈推荐**）

- **抄什么**：`version`（`"draft"` 或时间戳串）+ `version_number`（独立计数表单调分配，删除不回收）+ `marked_name`/`marked_comment`（`api/models/workflow.py:221-231`、`WorkflowVersionCounter:743-758`）。另加 `WorkflowDraftVariable`（`:1585`）做「草稿变量独立于发布版本」。
- **映射到我们**：`proposal_versions(project_id, version_number, status=draft|published, label, comment, docx_object_key, diff_json)`；`proposal_version_counters(project_id, last_version_number)`。
- **成本**：**2–3 人日**。
- **风险**：低。唯一坑是并发分配版本号要用 `UPDATE ... RETURNING` 或行锁，别用 `MAX()+1`。

### ② 检索配置模型 `RetrievalModel` + 后处理链（**推荐**）

- **抄什么**：`api/services/knowledge/entities/knowledge_entities.py:139-177`（search_method / reranking_enable / reranking_mode / top_k / score_threshold / weights / metadata_filtering_conditions）+ `api/core/rag/data_post_processor/data_post_processor.py:38-120`（rerank → 阈值 → 重排 → 去重）+ `weight_rerank.py`（向量/关键词加权）。
- **映射到我们**：`project_retrieval_configs` 表 + 一个 `retrieve(query, config) -> list[Chunk]` 服务；pgvector 里做 `<=>` 语义检索 + `tsvector/zhparser` 关键词检索，RRF 或加权融合，再可选调 rerank API。
- **成本**：**4–6 人日**（含 pgvector 混合检索 + 阈值/去重）。
- **风险**：中。中文分词（`zhparser`/`pg_bigm`）需要额外编译；rerank 走外部 API 有延迟与费用。

### ③ 变量池 + 变量选择器表达式（**推荐，只抄数据模型**）

- **抄什么**：`VariablePool` 的 `(node_id, key)` 选择器、`sys.*`/`env.*`/`conversation.*` 前缀约定（`api/core/workflow/variable_pool_initializer.py`、`variable_prefixes.py`、`system_variables.py`）。**不要抄 Engine**。
- **映射到我们**：任务拆分模板、Word 模板占位符、Agent 提示词都用同一套 `{{node.key}}` / `{{project.name}}` 解析，前端做「变量选择器」下拉。
- **成本**：**3–4 人日**（解析器 + 前端选择器 + 校验）。
- **风险**：低。注意循环引用检测与缺失变量降级。

### ④ HITL：人工审批节点（暂停/表单/超时/恢复）（**推荐，只抄状态机**）

- **抄什么**：概念模型——执行到人工节点 → 持久化 `WorkflowPause` + `WorkflowPauseReason`（`api/models/workflow.py:2141,2209`）→ 生成表单 → 提交后按 pause 记录恢复执行；配套超时任务（`api/tasks/human_input_timeout_tasks.py`）。
- **映射到我们**：`approvals(id, project_id, target_type, target_id, status, form_schema, assignee_id, due_at)` + `approval_events`；Word 策划案的「提交审批 → 会签 → 驳回重提」直接复用这个状态机。
- **成本**：**6–9 人日**（含通知、超时、权限）。
- **风险**：中。恢复语义（恢复时业务数据已变化）需要显式快照策略。

### ⑤ 索引流水线的「抽取→分块→索引→清理」分离 + 父子块（**可选**）

- **抄什么**：`IndexProcessorFactory` 按 `chunk_structure` 选 processor（`api/core/rag/index_processor/index_processor.py:28-47`）、`parent_child_index_processor.py`（子块检索、父块召回）、`index_and_clean` 的「先 commit 再向量 I/O」（`:81-145`）。
- **映射到我们**：Word/PDF 入库 → 段落级父块 + 句级子块 → pgvector 存子块、父块存 PG；检索命中子块返回父块。
- **成本**：**5–7 人日**。
- **风险**：中低。父子块的 `position`/`index_node_hash` 一致性要设计好，否则重建索引会重复。

**不建议移植**：工作流引擎本体（graphon，§5）、Agent runner（§5）、插件系统（§5）、工作流画布 UI（外观专利 + 规模）。

---

## 9. 建议的最终形态（一句话版）

> **Dify 只作为一个「可选 sidecar 能力服务」存在**：`postgres + redis + api + worker(-c 1) + plugin_daemon + pgvector`，通过 Service API 提供「工作流执行」和「知识库检索」两件事；用户/权限/项目/会话/文件/版本/审批全部在我们 FastAPI + Postgres 里，Dify 侧数据标记为可重建派生数据。§8 的 ①②③④ 直接抄进我们代码库（共约 15–22 人日），换取「不依赖 Dify 也能演进」的独立性。

---

## 10. 证据索引 / 未验证项

**已验证（源码）**：LICENSE 全文；compose 47 服务/profile/资源限制；api/web Dockerfile 基础镜像；pyproject/uv.lock 版本；247 个迁移；entrypoint 迁移与队列；models 全部关键表；`graphon` 外置（804 处 import、`workflow_entry.py:55`）；模型 provider 插件化；RAG 各子模块；DSL 版本 0.7.0 与信封结构；检索 API 入参出参；RBAC 在社区版 no-op；KnowledgeFS 私有 + amd64 + 默认关闭；`dify-client` MIT；Word 仅支持读取。

**未验证（本环境限制，需后续确认）**：

1. **镜像实际体积**——无 Docker CLI、无外网，§2.6 全为估算。请在能联网的机器上 `docker pull langgenius/dify-api:1.19.0 && docker images` 复核。
2. **`graphon` 的许可证**——仓库外 git 依赖，`web_fetch` 失败。若考虑作为库引入，必须先读其 LICENSE（若也是修改版 Apache 且含多租户条款，则同样受限）。
3. **`plugin_daemon` / `sandbox` / `agent_backend` 的许可证**——不在本仓，需分别确认。
4. **常驻内存**——§7.1 为按进程基线的估算，建议在目标机 `docker stats` 实测一轮（空载/索引中/推理中三档）。
5. **启动时间**——受首次迁移与插件下载影响很大（`install_default_plugins_task`），建议实测冷启动。
6. **`docker-compose.yaml` 是自动生成的**（文件头 `:1-4` 注明由 `generate_docker_compose` 生成），改配置应改 `docker-compose-template.yaml` 或 `.env`，否则会被覆盖。
