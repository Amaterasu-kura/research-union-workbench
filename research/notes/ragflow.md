# RAGFlow 源码级调研报告

- 调研对象：`/Users/sakura/better-student-union/research/repos/ragflow`
- HEAD：`e5a51b680bf11431060e3c4c4f1bc0704b3944c1`（2026-11-09，commit msg: *Provision native libs from versioned user cache (offline CI, drop /opt pre-bake) (#22099)*）
- 版本号：`pyproject.toml:3` → `version = "1.0.0"`；Go module 名 `ragflow`（`go.mod:1`）
- 仓库体积：94 MB（浅克隆，`git log` 只有 1 个 commit，无法做历史考古）
- 方式：只读；逐目录阅读 `go.mod` / `internal/` / `pyproject.toml` / `docker/` / `web/` / `cmd/` / `deps/`
- **环境限制**：本机无外网（`curl https://huggingface.co` 与 web_fetch 均失败），因此**模型文件的精确字节数无法实测**，凡涉及"MB/GB"的地方我都标注了推导依据与置信度，未实测的一律写"估算"。

---

## 0. 结论速览（TL;DR）

| 问题 | 结论 |
|---|---|
| LICENSE | Apache License 2.0，**纯标准文本，无附加条款**（`LICENSE:1-201`，无 NOTICE 文件）。但仓库是 open-core：EE 能力用 `//go:build ee` + `!ee` stub 切走，不在本树内 |
| 真实架构 | **已经不是「Go 1.0 + Python deepdoc」**。Python 的 `api/` `rag/` `deepdoc/` `agent/` **在本 HEAD 中已被删除**；DeepDoc 用 Go + ONNX Runtime（静态链接）在进程内跑，`--deepdoc` 独立推理服务器是 **EE 专属 stub** |
| 前端 | React 18 + TypeScript 5.9 + Vite 7 + Tailwind 3（**不是 Next.js**） |
| 数据平面 | 元数据：MySQL 8（默认）/ OceanBase / Vastbase（**不支持原生 PostgreSQL**）；向量+全文：Elasticsearch 8（默认）/ Infinity / OceanBase / SeekDB / Vastbase（**OpenSearch 代码里显式 not implemented**）；对象存储 MinIO；缓存 Kvrocks（Redis 协议）；MQ NATS JetStream |
| 必需容器 | `ragflow-cpu` + MySQL + Elasticsearch + MinIO + Kvrocks + NATS = **6 个常驻容器** |
| 复用结论 | ①作为独立服务 API 接入：**可行但昂贵**（必须再维护一整套数据平面）；②抽 Python parser 当库：**不可能**（Python 实现已不存在）；③**只借鉴设计：最划算**（引用定位、引用插入算法、表格 HTML 化、分块族） |
| 与 pgvector | **硬冲突**：RAGFlow 1.0 的向量库就是它的 doc engine，没有 pgvector 通道；元数据库也不支持原生 PG。若要用，必须接受"双数据平面"，或只做**离线批量解析导出** |
| Mac mini M4 16GB | 完整栈常驻约 **7–9 GB**（默认参数，可压到 5 GB 左右），与 Next+FastAPI+PG 共存**不现实**；官方 docker 部署明确写「macOS 暂不支持 Go 后端」，镜像 `platform: linux/amd64`（Rosetta）。原生 darwin/arm64 构建脚本支持，但需自行验证 |

---

## 1. LICENSE：精确结论

### 1.1 主许可证

- `LICENSE:1-2`：`Apache License / Version 2.0, January 2004`，全文为标准 Apache-2.0（含 APPENDIX 样板段落，`LICENSE:180-202`）。
- 全文检索 `additional|supplement|except|restrict|commercial|attribution|trademark` 只命中 Apache-2.0 的**标准条款**（第 4 条归属声明、第 6 条商标、第 9 条额外担保），**没有任何附加限制条款**，例如没有 Commons Clause、没有"禁止商用"、没有 SSPL 式限制。
- **没有 `NOTICE` 文件**（`ls NOTICE*` 不存在）→ Apache-2.0 §4(d) 的分发 NOTICE 义务不触发；但 §4(a)(b) 仍要求：分发时附带 LICENSE 副本、修改过的文件需标注修改。

### 1.2 但这是 open-core 仓库（重要）

- `AGENTS.md:63-73` 明确：企业版代码在下游私有仓库，本树只保留 `*_ee.go`（`//go:build ee`）和 `//go:build !ee` 的 `stub.go`。
- 本树只有 1 个真正的 `ee` 文件：`internal/deepdoc/parser/pdf/table/table_construct_vh_stub.go`（OSS 侧 stub，返回空字符串），以及约 20 个 `!ee` stub（`internal/**/stub.go`）。
- 已被确认切成"企业能力"的关键点：
  - **独立 DeepDoc 推理服务器是 EE 专属**：`cmd/stub.go:28-31` → `runDeepDoc` 直接返回 `errors.New("the DeepDoc inference server is only available in the enterprise edition")`。
  - ClickHouse 分析落地：`internal/engine/clickhouse/stub.go:21-23`（OSS 构建永不连接 ClickHouse）。
  - 视觉表格 V/H 拼装渲染：`table_construct_vh_stub.go`。

> 法律结论：**复制/分发本树任何代码都只需遵守 Apache-2.0**（保留版权与许可声明即可，可商用、可闭源分发衍生作品）。风险不在许可证，而在：①EE 能力的实现思路不在树内；②`AGENTS.md:22` 的"去 Python 化"路线意味着 Python SDK/脚本随时被删；③商标（§6）不得使用 "RAGFlow" 名称与 logo 做产品背书。

### 1.3 复制 C++ 分词代码时的第三方许可（小坑）

- `internal/binding/cpp/opencc/*` 自带 Apache-2.0 头（`opencc.h:1-14`），OK。
- `internal/binding/cpp/darts/darts.h`（Darts-clone 0.32）**在本树中已丢失上游许可证头**（前 30 行只有宏定义，`grep -i bsd` 无命中）。上游 Darts-clone 是 BSD-2-Clause。若直接复制这个文件，建议回上游补许可声明。
- 其余 native 依赖（pdfium / pdf_oxide / office_oxide / onnxruntime）是**下载的静态库**，不在本树，各自许可需单独审（pdfium 是 BSD-3-Clause 变体，ONNX Runtime 是 MIT）。

---

## 2. 当前真实架构与技术栈

### 2.1 一个二进制，六种模式

`cmd/ragflow_server.go` 是唯一入口（649 行），模式在 `cmd/ragflow_server.go:146` 定义：

```
"admin" | "api" | "ingestor" | "syncer" | "deepdoc" | "migrate"
```

用法输出见 `cmd/ragflow_server.go:276-300`。`docker/entrypoint.sh` 的启动序列（同进程内多角色，一个镜像）：

- `docker/entrypoint.sh:105-117`：先跑 `bin/ragflow_server --migrate`（一次性数据库迁移）
- `docker/entrypoint.sh:166`：`--admin`（可选，默认关，`--enable-adminserver` 才开）
- `docker/entrypoint.sh:174`：`--api`（9380，由内置 nginx 反代到 80/443）
- `docker/entrypoint.sh:179`：`--syncer`（数据源同步）
- `docker/entrypoint.sh:186`：`--ingestor` × N（`--ingestors=2` 可开多个，默认 1）

**关键点**：`--ingestor` 不是"只做解析的轻 worker"。它在 `internal/ingestion/service/ingestion_service.go:243` 里 `InitConsumer(common.TaskSubject)`（`tasks.RAGFLOW`，`internal/common/task.go:24`），而 `cmd/ragflow_server.go:505-560` 在进入任何非 deepdoc 模式前，都会顺序初始化 **DB → doc engine → Kvrocks → 对象存储 → MQ**，任一失败 `common.Fatal`。也就是说：**OSS 没有"只跑解析、不连数据库/ES"的部署形态**（唯一例外是 EE 的 `--deepdoc`，见 2.3）。

### 2.2 DeepDoc 在进程内（不是独立服务）

- `internal/server/deepdoc/server.go:60-120`：`RegisterNativeDeepDoc` 注册**进程内** ONNX 后端；模型或 ORT 缺失时 `common.Fatal`（**fail-fast，没有静默降级**）。
- `internal/deepdoc/parser/pdf/inference/native_analyzer/native_analyzer.go:1-17` 的包注释写得很直白：
  > "It wraps the ONNX Runtime inference library ... so the PDF parser can run DLA/TSR/OCR locally on CPU, with no Python service in the loop. It is the SOLE production DeepDoc backend: the external Python HTTP service (DEEPDOC_URL) has been removed entirely from both the production path and the test suite."
- ONNX Runtime 以**静态库**链进二进制，运行时 `dlopen(NULL)` 取符号（`internal/deepdoc/native/session.go:50-72`；`docker/README.md:166`）。
- 推理预算：进程级信号量 `internal/deepdoc/native/inference_limit.go`，启动时由 `--deepdoc-inference-concurrency K`（默认 1）与 `--deepdoc-inference-cpu-cores N` 配置（`cmd/ragflow_server.go:136-139`）；`N` 未显式给时 `N=K`，即**每个 Run 单线程**（`internal/server/deepdoc/server.go:101-110`）。
- 页级并发：`ingestor.page_concurrency` 默认 **2**，允许 1–16（`internal/server/config/ingestor_config.go:101-109`）。

### 2.3 Python 侧还剩什么（**纠正前提**）

任务描述里的"Go 1.0 + Python deepdoc"在**这个 HEAD 上已不成立**。

- 仓库根目录**没有** `deepdoc/`、`api/`、`rag/`、`agent/` 目录（`ls` 直接 No such file）。
- Python 文件统计（排除 `test/`）：只剩
  - `sdk/python/**`（20 个文件，客户端 SDK）
  - `tools/**`（chatgpt-on-wechat 插件、firecrawl、es-to-oceanbase 迁移工具、`tools/scripts/download_dev_deps.py`、`deps/download_deps.py`）
  - `scripts/gen_tokenizer_oracle.py`、`scripts/tokenizer_coverage.py`、`run_tests.py`
  - 4 个"黄金样本生成器"：`internal/ingestion/component/chunker/tool-py/*.py`、`internal/deepdoc/parser/pdf/util/testdata/gen_warp_golden.py`（仅用于对齐测试，不参与生产）
- `pyproject.toml:120-130` 的 `[tool.setuptools] packages` 仍列着 `'agent','api','deepdoc','rag',...` —— **这是过期配置**，对应目录已被删除。依赖里也还留着 `mysql-connector-python`、`peewee`、`elasticsearch-dsl`（历史 Python 服务遗留），没有任何 PDF/DOCX 解析库（无 pymupdf/pdfplumber/python-docx/unstructured）→ 进一步证明 Python 解析链已不存在。
- `AGENTS.md:22`：**"Remove all Python code ... from the repository. Do not add new Python code while this removal is in progress."**

> 对方案的影响：**"把 deepdoc 当一个 Python 包抽出来"这条路已被上游自己堵死**。要么用旧版本（≤0.2x 的 Python 实现），要么用 Go，要么换成 Python 生态的替代解析器（见 §8）。

### 2.4 Web 前端

- `web/package.json`：`"description": "RAGFlow Web Frontend migrated to Vite"`，React `^18.2.0` + `react-dom ^18.2.0` + `vite ^7.3.7` + `typescript ^5.9.3` + `tailwindcss ^3` + Radix UI + Lexical（富文本）+ `@antv/x6`/`g6`/`g2`（画布/流程图/图表）+ `@monaco-editor/react` + `@tanstack/react-query ^5`。
- 无 Next.js、无 antd（有 `@ant-design/icons` 仅图标）。
- 开发代理对齐 Go 端口：`web/vite.config.ts`（`docker/README.md` 与 `AGENTS.md:12` 均提到）。

### 2.5 数据平面（逐项，含代码证据）

| 组件 | 支持情况 | 证据 |
|---|---|---|
| 元数据库 | **MySQL 8 默认**；OceanBase、Vastbase 可选；**纯 PostgreSQL 不支持** | `internal/server/config/database_config.go:73-81` 只 `switch "mysql"/"oceanbase"/"vastbase"`，default 直接报错；`internal/server/config/environments.go:178-186` 白名单同上 |
| 为什么 PG 不行 | Go 侧只有一个 `postgres` dialector，且是给 Vastbase（PG 兼容国产库）用的 | `internal/dao/database.go:121-145` `vastbaseDialector`；`internal/dao/database.go:34-42` |
| doc engine（向量+全文） | **Elasticsearch 8.11.3（默认）**、Infinity 0.7.5、OceanBase、SeekDB、Vastbase；**OpenSearch 未实现** | `internal/server/config/environments.go:163-172`：`case "opensearch": return fmt.Errorf("not implemented: %s", docEngine)` |
| 索引粒度 | 每个租户一个 chunk 索引 `ragflow_<tenant_id>`，所有知识库靠 `kb_id` 过滤 | `internal/engine/infinity/chunk.go:1584`；`internal/engine/elasticsearch/chunk.go:1025` 注释 |
| 文档元数据索引 | `ragflow_doc_meta_<tenant_id>` | `internal/engine/elasticsearch/common.go:98-99` |
| 对象存储 | MinIO（默认）/ S3 / 阿里 OSS / GCS | `internal/server/config/environments.go:190-198`；`internal/storage/{minio,s3,oss,gcs}.go` |
| 缓存 | **Kvrocks 2.16**（Redis 协议兼容，RocksDB 落盘），不是 Redis | `docker/docker-compose-base.yml:352-393`；`docker/README.md:124` |
| 消息队列 | **NATS 2.14 + JetStream** | `docker/docker-compose-base.yml:411-428`；`internal/engine/nats/`；subject `tasks.RAGFLOW`（`internal/common/task.go:24`）、`knowledge.compile.events.>`（`internal/engine/nats/knowledgecompile.go:37`）、`sync.tasks.RAGFLOW`（`internal/engine/nats/syncer.go:36`） |
| 分析库 | ClickHouse **仅 EE**，OSS build 永不连接 | `internal/engine/clickhouse/stub.go:21-40` |

### 2.6 分词 / 向量化 / rerank

- **分词**（BM25 词条）不是用 ES 的 analyzer，而是**客户端自研 C++ 分析器**：
  - `internal/binding/cpp/`：`rag_analyzer.cpp`、`tokenizer.cpp`、`term.cpp`、`darts/darts.h`（前缀词典）、`opencc/`（繁简转换）、`stemmer/`、`re2`、`pcre2`。
  - Go 侧通过 CGO 调：`internal/binding/rag_analyzer.go`；封装在 `internal/tokenizer/tokenizer.go:559-571`。
  - ES mapping 里 `*_tks` / `*_ltks` 字段用 `whitespace` analyzer + 自定义 `scripted_sim` 打分（`conf/mapping.json`，`similarity.scripted_sim` + `dynamic_templates`）—— 即"**先把中文切好再用空格喂 ES**"的经典做法。
  - 有意思的细节：`internal/tokenizer/tokenizer.go:564-567`，当 doc engine 是 Infinity 时 `Tokenize` 直接原样返回（对齐 Python 行为）。
- **Embedding**：走"模型供应商驱动"统一接口（`internal/entity/models/types.go:52-56` 的 `Embed`/`Rerank`），驱动几十个（`internal/entity/models/*.go`，含 openai/vllm/xinference/gpustack/localai/ollama 等）。**镜像不含 embedding 模型**（`docker/README.md:155`）。
- 可选本地 embedding：`tei-cpu` / `tei-gpu` profile 起 `infiniflow/text-embeddings-inference:1.8`，默认模型 `Qwen/Qwen3-Embedding-0.6B`（`docker/.env:337-345`）。
- **Rerank**：默认没有本地 cross-encoder；`RerankByModel` 调外部 rerank API（`internal/service/nlp/retrieval.go:502-515`）。没有 rerank 模型时退化为**本地重排** `RerankStandard`（query 词条 ∩ chunk 词条 + 余弦的加权和），见 `internal/service/nlp/reranker.go`。

### 2.7 docker-compose 的 profile 全景

`docker/docker-compose.yml` 只有 `include: ./docker-compose-base.yml` + 一个 `ragflow-cpu` 服务（`docker/docker-compose.yml:1-46`）。依赖服务的 profile 全在 base 里：

| profile | 服务 | 是否必需（默认 Go 部署） |
|---|---|---|
| `cpu` | `ragflow-cpu`（应用本体，含 nginx + 4 个角色） | ✅ |
| `metadata-mysql` / `mysql` | `mysql:8.0.40` | ✅（默认元数据库） |
| `elasticsearch` | `es01`（`elasticsearch:${STACK_VERSION}`，默认 8.11.3） | ✅（默认 doc engine） |
| —（无 profile） | `minio`（`pgsty/silo`，S3 兼容替代） | ✅ |
| —（无 profile） | `kvrocks`（`apache/kvrocks:2.16.0`） | ✅ |
| —（无 profile） | `nats`（`nats:2.14.2`，`-js` 开 JetStream） | ✅ |
| `infinity` | `infiniflow/infinity:v0.7.5-x64-v3` | 可选（替代 ES，**x64 only 标签**，ARM 存疑） |
| `oceanbase` / `seekdb` / `vastbase` / `serenedb` | 各自数据库 | 可选（替代 ES/元数据库） |
| `opensearch` | `opensearchproject/opensearch:2.19.1` | ❌ **代码未实现**，起了也连不上 |
| `tei-cpu` / `tei-gpu` | TEI embedding 服务 | 可选 |
| `clickhouse` | `clickhouse-server:26.5.5.8` | ❌ OSS build 不连接（EE 才有分析落地） |
| `kibana` / `jaeger` / `sandbox` | 观测 / 代码沙箱 | 可选 |
| `gpu` | **compose 中没有定义任何服务**（`DEVICE=gpu` 只会拼出 `COMPOSE_PROFILES=...,gpu`，无服务被激活） | ⚠️ 观察，非结论 |

`COMPOSE_PROFILES` 由 `.env:55` 组合：`${DOC_ENGINE},${DEVICE},metadata-${METADATA_DB_PROFILE}`。

> 说明：`docker/README.md:24` 明确「`docker-compose-macos.yml` 不是 Go 部署入口；Go 后端暂不支持 macOS」，而 macos compose 里 `ragflow.platform: linux/amd64`（`docker/docker-compose-macos.yml:6`）。

### 2.8 镜像体积 / 内存量级

**无法实测**（无外网、无本地镜像缓存、`~/ragflow-native-libs` 不存在）。可给的**唯一硬锚点**：

- `Dockerfile:28-33`：`layout.laws/manual/paper.onnx` 与 `layout.onnx` 字节相同，通过排除+软链 **"saving ~219MB"** → 即 **单个 `layout.onnx/ort` ≈ 73 MB**。
- `tools/scripts/convert_deepdoc_model.py:7`：`libonnxruntime.a` **≈ 48 MB**（静态库，链进二进制）。
- `internal/tokenizer/bpe_metaspace_golden_test.go:26`：某个 `tokenizer.json` **≈ 34 MB**（测试注释）；`counter_properties_test.go:23` 提到 17 MB 的 oracle fixtures。
- 基础镜像 `ubuntu:24.04`（`Dockerfile:15`）+ nginx + 静态链接的 pdfium/office_oxide/pdf_oxide/ORT + C++ 分析器。

我的**估算（置信度低）**：
- `ragflow` 镜像 **1.5–2.5 GB**（Go 二进制 150–300 MB + 模型 150–250 MB + nginx/ubuntu 底座）。
- 依赖镜像合计 **≈ 3.5–4.5 GB**（ES ~1.3 GB、MySQL ~600 MB、Kvrocks ~250 MB、MinIO ~150 MB、NATS ~50 MB、TEI ~1 GB if enabled）。
- 磁盘建议值有官方口径可引用：`README.md:150` / `docs/quickstart.mdx:19` → **4 核 / 16 GB RAM / 50 GB 空闲磁盘**（"recommended starting configuration"）。

---

## 3. 文档解析链路：源码级拆解

### 3.0 总览（一条链路，五个包）

```
HTTP upload            internal/handler/document.go → internal/service/document/document_upload.go
  ↓ MinIO Put          internal/storage/minio.go（storageImpl.Put，document_upload.go:95）
  ↓ document 行        internal/entity/document.go
parse 请求             POST /api/v1/datasets/{id}/chunks  （docs/references/http_api_reference.md:1577）
  ↓ ingestion_task     internal/entity/ingestion_task.go（CREATED→RUNNING）
  ↓ NATS tasks.RAGFLOW internal/ingestion/service/ingestion_service.go:243
ingestor 消费          internal/ingestion/task/pipeline_executor.go（1384 行）
  ↓ 画布 DSL 执行       internal/ingestion/pipeline/{pipeline.go,component_params.go}
   File → Parser → Chunker → Tokenizer → Extractor   （见 ingestion_pipeline_general.json）
  ↓ Parser             internal/ingestion/component/parser_dispatch.go → internal/parser/parser/*
                       → internal/deepdoc/parser/{pdf,office,image}
  ↓ Chunker            internal/ingestion/component/chunker/*
  ↓ Tokenizer          internal/ingestion/component/tokenizer.go（embedding + content_ltks）
  ↓ 写索引             internal/ingestion/task/chunk_index_writer.go → internal/engine/elasticsearch
检索                   internal/service/nlp/retrieval.go（hybrid + fusion）
rerank                 internal/service/nlp/reranker.go（外部模型）或 RerankStandard（本地）
引用                   internal/service/{citation.go, kb_prompt.go, agentic_reference.go}
```

默认流水线的 5 个节点是明文的 JSON DSL，可直接读：`internal/ingestion/pipeline/template/ingestion_pipeline_general.json`
（`File → Parser:HipSignsRhyme → GeneralChunker:SixApplesFall → Tokenizer:LegalReadersDecide → Extractor:AutoExtractDefault`）。

### 3.1 上传

- `internal/service/document/document_upload.go:34-135`：`UploadLocalDocuments` → `storageImpl.Put(ctx, kb.ID, location, blob)`（:95）→ 插 `document` 行；失败会回滚删除 blob（:117）。
- 支持的解析族在 Parser 组件的 params 里穷举（`ingestion_pipeline_general.json` 的 Parser 节点）：
  `doc`、`docx`、`html`、`markdown`、`pdf`、`spreadsheet`(xls/xlsx/csv)、`text&code`(txt/py/js/java/c/…)、`image`(bmp/gif/jpeg/jpg/png/svg/tif/tiff/webp)、`email`。

### 3.2 解析路由（PDF / Office / 图片）

- 路由层：`internal/ingestion/component/parser_dispatch.go`（+ `_test` 系列锁定了输出形状与并发）。
- PDF 的 `parse_method` 支持：`DeepDOC`（默认）、`OCR`、MinerU（本地 `mineru_local.go` / 云端 `mineru_cloud.go`）、PaddleOCR（`paddleocr_local.go`），另可选 VLM 视觉增强（`enable_vision_enhancement` + `vlm.llm_id`）。证据：`internal/ingestion/component/parser.go:257-350`、`internal/ingestion/component/dispatch_model.go:107-172`。
- Office：`internal/deepdoc/parser/office/engine_cgo.go:23-40` → 调 `github.com/yfedoseev/office_oxide/go`，一次拿到三种视图 `irJSON / markdown / plainText`（走 native 静态库），再由 `internal/parser/parser/docx_ir.go`、`docx_postprocess.go`、`doc_flatten.go` 做结构化后处理。xlsx 走 `github.com/xuri/excelize/v2`（`internal/parser/parser/office_table_render.go:26`、`xlsx_parser.go:26`）。

### 3.3 PDF 解析核心（自研，最值得读的一段）

入口与主循环：
- `internal/deepdoc/parser/pdf/parse_cgo.go:22-34`：`Parse()` 建原生引擎（**pdf_oxide**）→ `ParseRaw`。
- `internal/deepdoc/parser/pdf/pdfoxide_bridge.go:18-25`：`NewEngine` 用 pdf_oxide 读文档；**渲染**另走 pdfium（`renderer_pdfium.go` 在 cgo 构建里替换 `renderFn`；默认 `fallbackRender` 见 `renderer.go:14-36`）。
- `internal/deepdoc/parser/pdf/parser.go:87-89`：`ParseRaw → processPages`。
- `internal/deepdoc/parser/pdf/parser.go:636-690`：`processPages` = 读页数 → 先抽 outline（目录，用于识别 TOC 页）→ `runPageWorkers`（页级 worker pool）→ `assembleDocument`。
- 每个页面的产物结构见 `parser.go:35-56` 的 `pageResult`：`Boxes/Chars/Tables/DLARegions/OCRUsed/IsScanNoise/PageHeight/PageWidth`。这段注释同时给了**降级策略**：渲染失败→退化为 chars→boxes；OCR 失败→退化为内嵌文本；DLA/TSR 失败→该页无表格。

版面与 OCR：
- 渲染 DPI：`internal/deepdoc/parser/type/types.go:301-305` → `DlaDPI = 216`，`DlaScale = 3.0`（A4 一页 ≈ 1785×2526 px）。
- DLA（版面检测）：`internal/deepdoc/native/dla.go:20-60` → 输入 **1024×1024**（letterbox，114 填充），**YOLOv10 风格 10 类**：title/Text/Reference/Figure/Figure caption/Table/Table caption/Equation…；最多 300 框。
- OCR 检测：`internal/deepdoc/native/det_core.go:25,79-83` → `detLimitSideLen = 960`，按长边等比缩放到 round32；**shape 池上限 24**，每 shape 最多缓存 4 个 session（防内存炸）。
- OCR 识别：`internal/deepdoc/parser/pdf/parser_ocr.go:25` `recBatchNum = 16`；`parser_ocr.go:29-52` 检测框 → `WarpCrop` 透视矫正 → 长宽比排序、按子批 pad → 批量识别；竖长框（h ≥ 1.5w）额外生成 0°/±90° 三个候选，取置信度最高（`parser_ocr.go:75-110`）。
- 置信度阈值：`native_analyzer.go:44` `DefaultDropScore = 0.5`（对齐 Python `Recognizer.drop_score`），低于阈值的文本被清空。
- 扫描件判定：`pageResult.IsScanNoise` / `OCRUsed`（`parser.go:43-47`）+ `internal/deepdoc/parser/pdf/util/garbled.go:218-236` 用 `ocr.res` 词表判断"乱码/非本语言脚本"，决定是否值得跑 OCR。

表格（PDF）：
- 结构识别 TSR：`internal/deepdoc/native/tsr.go`（`tsr.ort`）。
- 组装：`internal/deepdoc/parser/pdf/table/`（`table_construct.go`、`table_cells.go`、`table_spans.go`、`table_merge.go`、`table_orient.go`、`table_post.go`、`table_html.go`、`table_todata.go`；`deepdoc_table_builder.go` 实现 `pdf.TableBuilder` 接口，工厂 `parser.go:64-84`）。
- 输出 HTML：`table/table_html.go:13-55` `SimpleRowsToHTML`（首行 `<th>`，其余 `<td>`，HTML 转义）；V/H 拼装渲染是 EE（`table_construct_vh_stub.go`）。
- 跨页表格合并：`internal/deepdoc/parser/pdf/table/table_merge.go` + `internal/ingestion/component/chunker/general_pdf_continuation.go`。

### 3.4 分块（RAGFlow 的"知识资产"其实在这里）

分块组件注册表：`internal/ingestion/component/chunker/register.go:41-51` + `names.go:22-34`，**10 种 chunker**：
`GeneralChunker`、`TokenChunker`、`TitleChunker`、`GroupTitleChunker`、`HierarchyTitleChunker`、`ManualChunker`、`OneChunker`、`PageChunker`、`QAChunker`、`TableChunker`。

- GeneralChunker 参数（`internal/ingestion/component/chunker/general.go:44-60`）：`chunk_token_size` 默认 **512**、`delimiters` 默认 `["\n"]`、`overlapped_percent`、`children_delimiters`、`table_context_size`、`image_context_size`。
- 底层切分算子：`internal/parser/chunk/split.go:89-104`，strategy = `sentence | char | paragraph | length`，`length` 默认窗口 **256 runes**（`split.go:36`）。
- 父/子块：`ChunkDoc.Mom` 字段（`schema/chunk_types.go:112`）+ `mom_id` 检索期提升（`internal/service/nlp/retrieval.go:735` 附近 select 字段 `mom_id`）。
- 表格 chunk：`chunker/table.go:20-31` 的包注释即设计说明 —— "**Every row in table will be treated as a chunk**"，每行重复列名，格式 `- field: value`；表头单行表则整表一个 chunk。
- 表格工具：`internal/parser/tableutil/table_html.go`（HTML→`TableData`，含 rowspan/colspan 网格化）、`table_rows.go`（行遍历）。测试里能看到大量 merge/越界/超限用例（`table_grid_test.go`）。
- 图片 chunk：`chunker/image_upload.go` + `chunker/pdfcrop_cgo.go:266` `cropChunkPreview`（按 positions 裁剪页面 → 上传 MinIO → `img_id`）。
- Chunk 身份：`chunker/common.go` 的 `canonicalChunkID` → `common.ChunkID(docID, text)`（`register.go:120` 附近），**确定性 ID**（同文档同文本 → 同 ID），可幂等重跑。

### 3.5 索引前处理（embedding + 全文词条）

`internal/ingestion/component/tokenizer.go:17-72` 的文件头就是一份高质量设计说明：
- 产出 `content_ltks` / `content_sm_ltks`（细粒度变体）、`title_tks` / `title_sm_tks`；
- embedding 走注入的 `DefaultEmbedderResolver` → 租户模型驱动；**整批一次 `Encode([]string)`**（不分片扇出），批大小由 `settings.EMBEDDING_BATCH_SIZE`（默认 16）或模型自带上限决定（`docker/README.md:183` 的 `TOKENIZER_EMBEDDING_BATCH_SIZE`）；
- 明确列出**未移植**项（Python 的 async batching / `embed_limiter` 语义被单次批量调用替代）。

写入：`internal/ingestion/task/chunk_index_writer.go` → `engine.InsertChunks(...)`（`internal/engine/engine.go:52-55`）。

### 3.6 检索

`internal/service/nlp/retrieval.go`（1433 行）是检索主入口。

- 请求结构 `RetrievalRequest`（:50-82）：`KNNTopK` 默认 1024、`KNNNumCandidates` 默认 2048（:119-124），上限 2048 / 10000（:98-99）。
- 融合公式，源码注释写死：**`sim = tkWeight*tsim + vtWeight*vsim`，`tkWeight = 1 - vector_similarity_weight`**（`retrieval.go:487-491`）。
- 两条融合路径：
  - Infinity：引擎侧 `weighted_sum`，权重 `(1-vw, vw)`（`retrieval.go:653-666`）；
  - 其它引擎（ES 等）：先按固定权重 `0.001,1` 做**向量召回**，再由 `RerankWithKNN` 二次打分（`retrieval.go:669-687`，注释明确引用 `rag/nlp/search.py:331` 这段 Python 历史行为）。
- `vector_similarity_weight ≥ 0.8` 时 `min_match` 归零（放弃词面约束，`retrieval.go:697-702`）。
- 阈值过滤：`similarity_threshold` 只对融合分有意义，`vw==0` 时被忽略（`retrieval.go:246-265`）。
- 返回字段（ES `_source` 白名单）就是"引用溯源"的全部素材：`content_with_weight, doc_type_kwd, mom_id, row_id(), docnm_kwd, position_int, page_num_int, top_int, img_id, doc_id, kb_id, chunk_order_int, ...`（`retrieval.go:725-740`）。

### 3.7 rerank

- 配了 rerank 模型 → `RerankByModel`（`retrieval.go:502-515` 调用；实现在 `internal/service/nlp/reranker.go`，1045 行），走外部 HTTP rerank API（如 vLLM `/v1/rerank`，`internal/entity/models/vllm.go:339-452`）。
- 没配 → `RerankStandard`（`retrieval.go:531-543`）：纯本地词面+余弦加权，无 cross-encoder 语义。

### 3.8 引用溯源（两套机制，都值得抄）

**机制 A：句级引用插入（RAG 答案里的 `[ID:n]`）**

`internal/service/citation.go`：
- `:68-80` `InsertCitations`：把答案切句 → 对每句 encode → 与 chunk 向量算**余弦相似度矩阵**（`:99` `cosineSimMatrix`）→ `findCitations`（`:100`，逐句挑最相似且过阈值的 chunk）→ `applyCitations`（`:102`）在句尾插 `[ID:n]`。
- 切句逻辑 `splitAnswer`（`:105-134`）：**先按 ``` 切代码块（代码块不插引用）**，再按句末标点切，过滤过短片段。这个细节很实用。
- 纯函数内核 `InsertCitationsWithVectors`（`:84-103`）便于测试与移植。

**机制 B：引用负载（前端 popover 用）**

- `internal/service/kb_prompt.go:30-54` `ChunksFormat`：每 chunk 输出
  `id / content / document_id / document_name / dataset_id / image_id / positions / url / similarity / vector_similarity / term_similarity / row_id / doc_type / document_metadata`。
- 组装：`internal/service/ask_service.go:266-289`（`refs = {"chunks": chunkRefs, "doc_aggs": result.DocAggs}`，随 `AskDeltaFinal` 推给前端）。
- Agent 路径另一套：`internal/service/agentic_reference.go:140-215`，按 `[ID:N]` 反查 ES（`fetchChunksByIDs`，只取 `content_with_weight/docnm_kwd/doc_id/kb_id/img_id/position_int`）→ `agenticDocAggs` 聚合成 `{doc_id, doc_name, count, url}`。
- 落库：`internal/entity/conversation_history.go:51-62` `ConversationReference{conversation_id, position, reference(json), message_position}` 表 `conversation_reference`；API 会话同名表 `api_4_conversation_reference`（:74-85）。

**positions 的确切语义**（关键）：
- `internal/deepdoc/parser/type/types.go:149-156` `Position{PageNumbers, Left, Right, Top, Bottom}`，坐标是 **PDF point（72 DPI）**，页面渲染时 `÷ DlaScale` 归一回 point（`parser_ocr.go:56-62`）。
- 落到 chunk 上是 `positions` / `_pdf_positions` / `position_int` / `page_number`（`schema/chunk_types.go:129-132`），对外 JSON 形如 `[[page, left, right, top, bottom], ...]`（`internal/service/chunk/chunk.go:948` 直接回传）。
- 配合 `img_id`（MinIO 里裁剪出来的 chunk 预览图）→ 前端可做"点引用高亮原文 + 缩略图"。

### 3.9 DeepDoc 模型文件：多大 / 要不要 GPU

- **只有 5 个文件**：`det.ort`、`layout.ort`、`tsr.ort`、`rec.ort`、`ocr.res`
  - 单一真相源：`internal/common/environments.go:560-566`（`DeepDocModelFiles`），以及 `deps/download_deps.py:103-104`。
  - `internal/common/environments.go:568-579` `HasModelFiles` 是启动 fail-fast 的唯一检查点。
- 来源：HuggingFace `InfiniFlow/deepdoc`（`deps/download_deps.py:103`），`.onnx` 版本是 Python 专用、Go 侧**故意不下载**（`deps/download_deps.py:96-99`）。
- 体积：**未实测**。唯一硬锚点 `Dockerfile:28-33` → `layout.onnx ≈ 73 MB`。合理推断总量 **150–250 MB**（置信度中低）。另有 embedding tokenizer 资产（`sentencepiece.bpe.model`、`vocab.txt`、若干 `tokenizer.json`，其中一个 ~34 MB，见 `internal/tokenizer/bpe_metaspace_golden_test.go:26`）+ `cl100k_base.tiktoken`（`Dockerfile:55-63`）+ `NotoSansCJKsc-VF.ttf`（`Dockerfile:88-91`）。
- **GPU：不需要，OSS 就是 CPU**：
  - `docker/README.md:168`："In the RAGFlow open-source 1.0 release, DeepDoc uses CPU inference."
  - 构建期只有 CPU 版静态 ORT（`build.sh:176-183` 的 `onnxruntime-*-static_lib-*`，无 CUDA 变体；`grep -i cuda|coreml|directml` 在 `internal/deepdoc/native` 无命中）。
  - `DEVICE=gpu` 在 compose 里没有对应服务（见 §2.7）。
- **可 CPU**：默认每 Run 1 线程 + `inference_concurrency=1` + `page_concurrency=2`（`internal/server/config/ingestor_config.go:109`），是给无 GPU 场景设计的。
- 一个**内存陷阱**（上游自己踩过）：`internal/deepdoc/native/session.go:255-262` 注释 —— 解析大 PDF 时同时活着的 rec/det/DLA/TSR session 可达 **~220 个**，BFC arena 每个都预留一块不还，曾经主导了 **~14 GB 原生内存、~20 GB OOM 峰值**；修复手段是 `SetCpuMemArena(false)` + **权重共享**（`weightSet` 通过 `AddInitializer` 注入同一份 buffer，`session.go:95-120`）。→ 说明"满血 DeepDoc"在 16 GB 机器上要谨慎，但默认参数+共享权重后是可控的。

---

## 4. 数据模型

### 4.1 元数据库（约 56 张表，GORM AutoMigrate）

单一清单：`internal/dao/database.go:246-310` `autoMigrateModels()`。核心表：

| 表 | 实体 / 证据 | 关键列 |
|---|---|---|
| `knowledgebase` | `internal/entity/dataset.go:104-153`，TableName :154 | `id, tenant_id, embd_id, parser_id, pipeline_id, parser_config(json), similarity_threshold(0.2), vector_similarity_weight(0.3), doc_num, chunk_num, token_num`，外加一堆任务态字段（graphrag/raptor/mindmap/wiki/structure_*） |
| `document` | `internal/entity/document.go:20-59`，TableName :88 | `kb_id, parser_id, pipeline_id, pipeline_version_id, parser_config(longtext json), source_type, type, name, location(S3 key), size, token_num, chunk_num, progress, progress_msg, process_begin_at, process_duration, content_hash, suffix, status` |
| `file` / `file2document` | `internal/entity/file.go:35,48` | 原始文件与文档的映射（同文件可挂多文档） |
| `task` | `internal/entity/task.go:40` | 老式任务表（仍有） |
| `ingestion_task` | `internal/entity/ingestion_task.go:20-43` | `document_id(unique), dataset_id, schema(DSL json), status, component_total, pipeline_log_id` |
| `ingestion_task_log` | `ingestion_task.go:46-60` | `task_id, checkpoint(json), phase, event_type, component, message`（**断点续跑**靠 checkpoint） |
| `pipeline_operation_log` | `internal/entity/pipeline.go:58` | 运行日志（comment 里提到它占了 3.6G 库里的 2.66G，见 `docker-compose-base.yml:296-300`） |
| `conversation_message` / `conversation_reference` | `conversation_history.go:40-62` | 见 §3.8 |
| `api_4_conversation*` | `conversation_history.go:71-85` | 同上，API 通道 |
| `tenant_llm` / `tenant_model*` / `llm` / `llm_factories` | `llm.go:32`、`tenant_llm.go:36` 等 | 模型供应商/实例/密钥 |
| `user` `tenant` `user_tenant` `api_token` | — | 多租户与鉴权 |
| `canvas` / `canvas_template` / `canvas_version` | `canvas.go:40,72,89` | Agent 画布 |
| `connector` / `connector2kb` / `sync_logs` / `file_commit*` | `connector.go:45,140,173`、`file_commit.go:36,69` | 数据源同步 |
| `memory` / `memory_task` / `search` / `skill_space` / `skill_search_config` / `evaluation_*` / `knowledge_compile_*` / `compilation_template*` | 各自文件 | 新特性 |

连接与迁移：`internal/dao/database.go:334-360`（dialector 选择：vastbase → postgres dialector，其它 → MySQL）；`--migrate` 模式在 `cmd/ragflow_server.go:536-545`。

### 4.2 Chunk 不在 SQL 里（最重要的数据模型事实）

- 没有任何 `chunk` 表（`autoMigrateModels` 无 `Chunk` 实体；`grep "type Chunk struct"` 只命中 `internal/ingestion/component/knowledge_compiler/common/types.go:107`，那是另一个特性的内部结构）。
- Chunk 存 doc engine 的索引里：`ragflow_<tenant_id>`（每租户一个索引/表，`internal/engine/infinity/chunk.go:1584`），文档元数据在 `ragflow_doc_meta_<tenant_id>`。
- Chunk 的完整字段契约是 `internal/ingestion/component/schema/chunk_types.go:108-148` 的 `ChunkDoc`：
  ```
  text, doc_type_kwd("text"/"table"/"image"), tk_nums, mom(父块), img_id, id,
  layout, layout_type, layoutno, image, context_above, context_below,
  questions, keywords, summary, chunk_order_int, title_tks, title_sm_tks,
  content_ltks, content_sm_ltks, page_number, top_int,
  _pdf_positions, positions, sheet, sheet_index, _preserve_order,
  table(结构化 TableData), media_ref, Extra
  ```
- 也就是说：**RAGFlow 的"知识库"是 MySQL(元数据) + ES(文本/向量/位置) 两套存储拼起来的**，缺一不可。这一点直接决定了 §6 的结论。

---

## 5. 复用判定（逐项）

### 5.1 方案 A：作为独立文档/RAG 服务，通过 HTTP API 接入

**结论：技术上可行，但运维成本高于收益（对 16GB Mac mini 尤其）。**

可行性证据：
- API 完整且已文档化：`docs/references/http_api_reference.md`（上传 :1018、解析 :1575、列 chunk :1858、检索 :2428、chat :3822）。
- 解析结果是**可以从外部取走**的：`GET /api/v1/datasets/{dataset_id}/documents/{document_id}/chunks` 直接返回 `content` + `positions` + `image_id`（`docs/references/http_api_reference.md:1907-1930`）。→ 可以"用 RAGFlow 解析，把文本+位置灌进我们自己的 pgvector"。
- 鉴权简单：`Authorization: Bearer <API_KEY>`（同上）。
- Apache-2.0，商用无碍。

代价（源码证据）：
1. **6 个常驻容器**（§2.7），并且 app 启动时对 DB/engine/kvrocks/storage/MQ 全部 fail-fast（`cmd/ragflow_server.go:505-560`）→ 少一个就起不来。
2. **必须注册 embedding 模型**：建数据集强制 `embd_id`（`internal/service/dataset/embedding.go:58` `"`embd_id` is required"`）→ 解析链路自带向量化，哪怕你只想要文本。可以用 TEI 本地起一个（`tei-cpu` profile），或指向我们自己的 embedding 端点。
3. **不能只要有解析**：没有"parse only"模式（`--deepdoc` 是 EE stub）。
4. 数据双写：RAGFlow 的 chunk 存在它自己的 ES 里，我们还要再写一份到 pgvector，**没有官方同步机制**，只能靠 API 拉取。

### 5.2 方案 B：复制解析代码（当 Python 库 / Go 库）

**结论：不可行。**

- **Python 侧已无代码可复制**（§2.3）。`api/rag/deepdoc/agent` 全删；`pyproject.toml` 的 packages 是残留配置。想拿 Python deepdoc，只能回退到旧 tag（≤0.2x），但那与 1.0 的分块/引用契约不一致，等于另立分支维护。
- **Go 侧无法作为库被外部引用**：所有实现都在 `internal/`（Go 的 `internal` 语义禁止外部模块 import），如 `ragflow/internal/deepdoc/parser/pdf`。要用只能 fork 或 vendor 整个模块（用户已排除 fork）。
- 即便 vendor，构建门槛也极高：`build.sh` 要求 CGO + clang/LLD 20 + 3 个原生静态库（pdfium、pdf_oxide、office_oxide）+ 静态 ORT（`AGENTS.md:243-247`、`build.sh:101-183`、`README.md:244`），还要额外的 C++ 分词器（`internal/binding/cpp`，依赖 pcre2/re2/opencc/darts）。
- 体积与许可证传导：模型 150–250 MB + 二进制 150–300 MB + 第三方静态库许可审查。

### 5.3 方案 C：只参考设计（**推荐**）

**结论：性价比最高，且是唯一能在我们现有栈上落地的路径。**

理由：
- RAGFlow 真正值得抄的是**信息模型与算法约定**，而不是代码：
  1. `positions` 五元组 + `page_number` + `img_id` 的引用三元组；
  2. `[ID:n]` 句级引用插入（cosine + 阈值 + 代码块跳过）；
  3. 表格 → HTML（含 rowspan/colspan）+ "每行一 chunk，`- col: value`" 的文本化策略；
  4. 分块族（general/token/title/page/table/qa/one）+ `chunk_token_size` + `overlapped_percent` + 父子块 `mom`；
  5. 混合检索的 `sim = (1-vw)*term + vw*vector` 与"向量召回 + 二次打分"的两段式。
- 这些设计**不依赖**它的数据平面，可以用 Python 在 2–4 周内等价实现（见 §8 成本表）。

### 5.4 三维对比

| 维度 | A 独立服务 | B 复制代码 | C 只参考设计 |
|---|---|---|---|
| 许可证 | ✅ Apache-2.0 | ✅ Apache-2.0（+第三方库需审） | ✅ 无需分发 |
| 语言栈匹配 | ⚠️ Go 二进制当黑盒，可接受 | ❌ Go + CGO + C++，与我们 Python 栈冲突 | ✅ 纯设计 |
| 耦合度 | 低（HTTP） | 极高（internal 包 + native 库） | 无 |
| 运维复杂度 | ❌ 6 容器 / 双数据平面 | ❌ 编译链复杂 | ✅ 零 |
| 迁移成本 | 1 周接 API + 1 周调度/容错 | 4–8 周 + 长期维护 CGO 工具链 | 2–4 周（纯 Python） |
| 解析质量 | ✅ 最高（自研 DLA/TSR/OCR） | ✅ 同 A | ⚠️ 取决于替代方案 |

---

## 6. 与 FastAPI + PostgreSQL/pgvector 的冲突分析

### 6.1 是否必须维护第二套数据平面？

**是，如果跑完整 RAGFlow。** 推导链（全部有代码证据）：

1. 元数据必须是 MySQL/OceanBase/Vastbase：`internal/server/config/database_config.go:73-81`（`default: return fmt.Errorf("database type %s is not supported")`），`environments.go:178-186`。**原生 PostgreSQL 不在白名单**。
2. chunk 向量必须进 doc engine：`internal/engine/engine.go:48-92` 的 `DocEngine` 接口只暴露 `InsertChunks/Search/KNNScores`，没有任何 SQL/pgvector 实现；已实现的 6 个后端里没有 Postgres/pgvector。
3. 因此：即使把 MySQL 换成 Vastbase（PG 协议），**向量仍然必须放 ES/Infinity**，pgvector 依然用不上。
4. 加上 MinIO（原文件 + chunk 裁剪图）、Kvrocks（缓存/租约）、NATS（任务）→ **完整第二套数据平面（5 个有状态服务）**。

### 6.2 能否只抽出 parser 作为 Python 库/服务？

- **作为 Python 库：不能**（Python 实现已删，§2.3）。
- **作为"服务"：只能以完整 RAGFlow 的形式**（HTTP API），且该服务的启动强依赖 DB+ES+MinIO+Kvrocks+NATS。
- **EE 的 `--deepdoc` 模式反而是理想形态**（只启 ONNX、不连任何基础设施，`cmd/ragflow_server.go:52-65` 的 `isStandaloneDeepDocServer` 注释明确写 "never the full RAGFlow infrastructure"），但它 `cmd/stub.go:30` 直接报"企业版专属"。
  → 这是一个**明确的商业边界**：RAGFlow 官方也认为"只卖解析能力"要收费。
- 变通：可以只启动 `--ingestor`（不启 `--api`），但 `cmd/ragflow_server.go:505-560` 的初始化链一样要求全部依赖就绪。**省不了容器**。

### 6.3 抽出的文本能否直接进 pgvector？

**能，而且是这条链路里唯一"干净"的部分。**

- 每个 chunk 的可用字段（`content` / `positions` / `page_number` / `image_id` / `doc_type`）都是纯 JSON，可通过 `GET .../chunks` 分页取走（`docs/references/http_api_reference.md:1858`）。
- 映射到我们的表几乎是 1:1：

```sql
CREATE TABLE rag_chunk (
  id            text PRIMARY KEY,          -- RAGFlow chunk id（确定性 hash）
  document_id   uuid NOT NULL,
  kb_id         uuid NOT NULL,
  content       text NOT NULL,
  doc_type      text,                      -- text | table | image
  page_no       int,
  bbox          jsonb,                     -- [[page,left,right,top,bottom], ...]
  image_key     text,                      -- 对应 RAGFlow 的 img_id（MinIO key）
  embedding     vector(1024),
  content_ltks  text,                      -- 若要做中文 BM25（需自带分词器）
  tsv           tsvector
);
```

- 注意两点坑：
  1. **中文分词**：RAGFlow 的 `content_ltks` 是它自研 C++ 分析器切出来的（`internal/binding/cpp`）。导出后如果你在 PG 里用 `zhparser`/`pg_jieba`，词表不同 → 词面分不可比，但用作我们自己的 BM25 没问题。
  2. **确定性 ID**：`common.ChunkID(docID, text)` 意味着同文档重解析 ID 不变 → 我们可以做**幂等 upsert**，非常适合"历史资料批量导入 + 反复重解析"的场景。

### 6.4 三条可选路线（排序建议）

| 路线 | 做法 | 代价 | 适用 |
|---|---|---|---|
| **R1（推荐起步）** | 用 RAGFlow **离线批量跑一遍**历史资料（论文/策划案/扫描件），通过 API 导出 chunks JSONL，灌进我们的 pgvector；RAGFlow 用完即停（`docker compose down`） | 一次性投入 1–2 周；长期零运维 | 历史资料一次性/低频入库 |
| R2 | RAGFlow 常驻，作为"重解析服务"（扫描件/复杂表格才路由过去），日常解析走 Python 轻链路 | 6 容器常驻 + 双写同步器 | 后续持续有扫描件入库 |
| R3 | 完全自建：PyMuPDF + python-docx + PaddleOCR/PP-Structure（或 MinerU）+ 自写分块 + pgvector | 2–4 周开发，质量略低 | 追求单一数据平面、可接受表格/版面质量下降 |

---

## 7. Mac mini M4 16GB 资源评估

### 7.1 完整 RAGFlow 常驻

**内存（分项估算，依据见备注）**

| 组件 | 稳态 | 峰值 | 依据 |
|---|---|---|---|
| Elasticsearch 8.11 | **≈4.5–5 GB** | 6 GB+ | compose 未设 `ES_JAVA_OPTS`，`mem_limit: ${MEM_LIMIT}` = **8 GB**（`.env:92`）→ ES 默认堆 = 容器内存 50% ≈ 4 GB，加 off-heap |
| MySQL 8 | **≈1.3–1.6 GB** | 2 GB | `--innodb-buffer-pool-size=1G`（`docker-compose-base.yml:296`）+ `max_connections=1000` |
| MinIO/Silo | 0.15–0.3 GB | — | 对象存储 |
| Kvrocks | 0.2–1 GB | — | RocksDB block cache |
| NATS JetStream | 0.05–0.1 GB | — | |
| ragflow 应用 | **0.6–1.2 GB** | 2–3 GB | Go 二进制 + ORT + 模型权重（layout ~73 MB + 其余，估算 150–250 MB）+ 216 DPI 页图（A4≈13 MB/页 × page_concurrency 2）+ 会话池 |
| **合计** | **≈7–9 GB** | **10–13 GB** | 与 `README.md:150` "16 GB recommended" 吻合 |

**可压缩空间**（重要）：把 `MEM_LIMIT` 降到 2 GB（ES 堆 ≤1 GB）、MySQL buffer pool 512 MB、`--ingestors=1`、`page_concurrency=1`、`--deepdoc-inference-concurrency=1`，可压到 **≈4.5–5.5 GB**。代价：大 PDF/扫描件解析变慢、ES 大库检索抖动。

**磁盘**：镜像 ≈3.5–4.5 GB（估算）+ 数据。官方建议 50 GB（`README.md:150`）。

**启动时间（估算，中低置信度）**：
- 依赖冷启：ES 20–40 s（compose 健康检查 `interval: 10s, retries: 120`，即最多容忍 20 分钟）、MySQL 15–30 s、其它 5–10 s。
- 应用：`--migrate`（56 表 AutoMigrate）10–30 s → 模型校验（缺文件直接 `Fatal`）→ ORT session 懒加载。
- **首次 `up` 约 60–120 s，之后约 30–60 s**。

### 7.2 只跑解析 worker 是否可行？

**不可行（OSS 版）。**

- `--deepdoc`（唯一"只跑 ONNX"的形态）是 EE stub（`cmd/stub.go:28-31`）。
- `--ingestor` 仍然要求 DB / doc engine / Kvrocks / 对象存储 / NATS 全部就绪，否则 `common.Fatal`（`cmd/ragflow_server.go:505-560`）。
- 也就是说"只跑一个轻量解析 worker"这条路**被架构本身堵死**，除非自己 fork 出一个只 import `internal/deepdoc/parser/...` 的 main（但 `internal` 包在 fork 内部可用 → fork 后可行；**这就是"不 fork 就用不了"的技术根因**）。

### 7.3 与 FastAPI/Next/Postgres 共存是否现实？

**不现实（常驻）；按需启停则可行。**

- 基线开销（M4 16 GB，macOS 自身 3–4 GB）：Next dev/prod 0.3–0.8 GB + FastAPI 0.2–0.4 GB + Postgres 0.5–1 GB + Redis 0.1 GB ≈ **4.5–6 GB**。
- 叠加 RAGFlow 7–9 GB → **11.5–15 GB**，已经贴到 16 GB 上限，macOS 会开始压缩内存/swap，Docker Desktop VM 还要额外一层开销。
- 另外两个**硬约束**：
  1. `docker/README.md:24`："macOS is temporarily not supported by the Go backend"；`docker-compose-macos.yml:6` 固定 `platform: linux/amd64` → **Rosetta 模拟 x86_64 跑 ONNX 推理**，性能与稳定性都不可接受。
  2. 原生 darwin/arm64 **是**有支持的：`build.sh:115-183` 有 `darwin_arm64` 分支，`tools/scripts/download_dev_deps.py:46-49` 明确给出 `darwin/arm64 -> native-macos-aarch64 / pdfium-mac-arm64 / pdf_oxide-go-ffi-darwin-arm64 / onnxruntime-osx-arm64`。→ 即**可以原生编译，但要自己搭 clang/CMake/PCRE2 工具链并实测**（编译产物是 Mac 原生二进制，不是 Docker 镜像）。
- 现实建议：
  - **不要常驻**。用 `docker compose up -d` → 批处理 → `down` 的批处理窗口模式（夜间跑），或
  - 直接在 Mac 上原生编译 + `--ingestor`（仍需 5 个依赖容器，但省掉 qemu 层），或
  - 走 §6.4 的 R3（完全不用 RAGFlow 运行时）。

---

## 8. 最值得移植的 3–5 个能力 + 替代方案与成本

排序依据：对我们「研究生会 AI 工作台」的实际收益 ÷ 实现成本。

### 8.1 【★★★★★】引用定位：`positions` 五元组 + `page_no` + 裁剪图

- 抄什么：`Position{PageNumbers, Left, Right, Top, Bottom}`（`internal/deepdoc/parser/type/types.go:149-156`）+ 一页多段时 `positions` 是数组（`general_pdf_source_positions.go:104-120` 的切片/合并算法）+ `img_id` 裁剪图（`pdfcrop_cgo.go:266`）。
- 为什么值得：这是"引用溯源"能不能做到"点一下跳到原文那一行"的分水岭。RAGFlow 把它做成**chunk 的一等字段**，而不是事后猜。
- 我们的等价实现：
  - `PyMuPDF` (`page.get_text("dict")`) 天然给 block/line/span 的 bbox → 分块时维护 `[(page_no, bbox)]` 列表；
  - 存 `jsonb`，前端用 pdf.js 的 `getViewport` + 百分比坐标高亮（**注意坐标系：PDF point 原点左下，屏幕原点左上**，RAGFlow 的 `top/bottom` 已是屏幕向下的值，可直接抄它的语义）。
  - 成本：**3–5 人日**（含前端高亮）。

### 8.2 【★★★★★】句级引用插入算法（`[ID:n]`）

- 抄什么：`internal/service/citation.go` 整个文件（约 300 行）——`splitAnswer`（代码块跳过 + 句末切分 + 短句过滤，:105-134）、`cosineSimMatrix`（:99）、`findCitations` + `applyCitations`（阈值 + 每句最多 N 个引用）。
- 为什么值得：LLM 自己写的 `[ID:n]` 经常编号错乱/漏引；RAGFlow 的做法是**答案生成后**用 embedding 做一次"事后对齐"，鲁棒性高得多。
- 我们的等价实现：Python 里 150 行即可（numpy 余弦 + 正则切句）。复用我们已有的 embedding（bge-m3 / Qwen3-Embedding）。
- 成本：**2–3 人日**（含中文句切分调优）。

### 8.3 【★★★★☆】表格 → HTML（含合并单元格）+ "每行一 chunk"

- 抄什么：
  - HTML 化：`internal/parser/tableutil/table_html.go`（HTML→`TableData` 网格化，正确处理 rowspan/colspan/越界钳制；测试用例 `table_grid_test.go` 覆盖 colspan/rowspan/overlap/huge-span）；
  - 行级 chunk：`internal/ingestion/component/chunker/table.go:20-31`（每行一 chunk，`- 列名: 值` 文本化，表头单行表则整表一块）；
  - 表格上下文：`table_context_size`（`general.go:52`）—— 给表格 chunk 补上"表标题/前后文"，显著改善召回。
- 我们的等价实现（可选替代）：

| 方案 | 表格质量 | 成本 | 备注 |
|---|---|---|---|
| `pdfplumber` `extract_tables()` | 中（规则线框好，无线框差） | 1 人日 | 轻，纯 Python |
| `camelot`（lattice/stream） | 中高 | 2 人日 | 依赖 ghostscript/opencv |
| `unstructured` `hi_res`（detectron2/YOLOX） | 高 | 3–5 人日 + 模型 500 MB+ | 重，但一体化 |
| `MinerU`（本地/云） | 很高（版式+表格+公式） | 2 人日接 API；本地要 GPU/大内存 | RAGFlow 自己就支持 MinerU（`mineru_local.go`） |
| 抄 RAGFlow 设计 + `pdfplumber` 实现 | 中高 | **4–6 人日** | 推荐 |

### 8.4 【★★★★☆】分块族 + 父子块 + token 预算

- 抄什么：
  - 参数面：`chunk_token_size`(512) / `delimiters` / `overlapped_percent` / `children_delimiters`（`general.go:44-60`）；
  - 父子块：`mom` + 检索期提升（`chunk_types.go:112`，`retrieval.go` 的 `mom_id`）—— 用小块检索、用父块喂 LLM，是提升答案完整度的廉价手段；
  - 10 种 chunker 的语义划分（`chunker/names.go:22-34`）：`naive/general`（通用）、`one`（整篇一块，适合短策划案）、`page`（按页，适合 PPT/扫描件）、`table`（按行）、`qa`（问答对）、`title`（按标题层级，适合 Word 大纲）、`manual`（手册）、`token`。
- 为什么值得：Word 策划案 + PDF 总结 + 表格 + 扫描件的**最优策略完全不同**，RAGFlow 把"按文档类型选策略"做成了产品级默认值。
- 我们的等价实现：Python 重写，`tiktoken`/`transformers` 计数，`rank_bm25` 可选。
- 成本：**3–5 人日**。

### 8.5 【★★★☆☆】扫描件 OCR + 版面（DeepDoc ONNX）

- 抄什么：不是抄代码，而是抄**参数与阈值**：216 DPI 渲染（`types.go:301-305`）、DLA 1024 letterbox（`dla.go:20,91-132`）、DET 长边 960（`det_core.go:25`）、REC batch 16 + 竖框三方向投票（`parser_ocr.go:25,75-110`）、置信度 0.5 丢弃（`native_analyzer.go:44`）、"是否乱码→是否值得 OCR"的门控（`util/garbled.go:218-236`）。
- 我们的替代方案对比：

| 方案 | 中文扫描件质量 | 内存 | 成本 | 备注 |
|---|---|---|---|---|
| **macOS Vision**（`ocrmac`/`pyobjc`） | 高（中英混排很强） | 极低 | **1–2 人日** | M4 上最快，**但只能在 Mac 跑**，不是可移植方案 |
| **PaddleOCR** PP-OCRv4/v5 + PP-Structure | 高 | 1–2 GB | 3–4 人日 | x86/ARM 都能跑，中文最强生态之一 |
| **RapidOCR**（onnxruntime，PP-OCR 模型） | 高 | 300–600 MB | 2–3 人日 | 纯 CPU、无 paddle 依赖，**性价比最高** |
| **MinerU** | 很高（含公式/表格） | 4 GB+ / 需 GPU 才快 | 2 人日（云 API） | 扫描件多的批次用 |
| **docling**（IBM） | 高 | 1–2 GB | 2–3 人日 | 版式+表格+阅读顺序 |
| 自建 DeepDoc 等价（照抄 5 模型） | 高 | 0.5–1 GB | 4–6 人日 + 模型许可 | 不推荐（等于重造 RAGFlow） |

### 8.6 不建议抄的

- `internal/agent/`（Agent 画布 / DSL / 沙箱）：与我们的工作台定位重叠但复杂度极高（`internal/agent` 下 20+ 子包，含 canvas/workflowx/sandbox）。
- GraphRAG / RAPTOR / Mindmap / Wiki 编译（`internal/ingestion/knowledge_compile`）：研究生会场景用不上，且是重计算任务。
- C++ 分词器：Python 侧用 `jieba`/`pkuseg` 足够；RAGFlow 自研是为了性能和确定性的词表一致性。

---

## 9. 不确定 / 未验证项（诚实清单）

| 项 | 状态 | 影响 |
|---|---|---|
| DeepDoc 5 个模型文件的精确字节数 | **未实测**（无外网）。仅知 `layout.onnx ≈ 73 MB`（由 `Dockerfile:28-33` "saving ~219MB / 3 files" 反推） | 影响磁盘/内存估算，误差可能 ±50% |
| `ragflow` 镜像实际大小 | **估算** 1.5–2.5 GB | 同上 |
| 启动时间 | **估算**（ES/MySQL 冷启经验值 + healthcheck 参数） | 低风险 |
| `serenedb` 能否真用 | `EngineSereneDB` 常量存在（`internal/engine/engine.go:40`），但 `environments.go:163-172` 的 env 白名单**不含 serenedb**，且 `.env:103` 注释说支持。→ 可能只能通过 `service_conf.yaml` 配 | 不影响主结论 |
| `DEVICE=gpu` 的实际效果 | compose 中无 `gpu` profile 的服务定义；OSS 构建只有 CPU ORT | 结论：**OSS 无 GPU 加速** |
| mac 原生构建能否一次成功 | `build.sh`/`download_dev_deps.py` 有 darwin/arm64 分支，但 `docker/README.md:24` 说 macOS 暂不支持 | 需实测（0.5–1 人日） |
| Infinity 在 ARM Mac 上能否跑 | `infiniflow/infinity:v0.7.5-x64-v3` 标签是 x64 | 需实测；ES 无此问题 |
| 旧版（≤0.2x）Python deepdoc 是否还值得取 | 未调研（浅克隆无历史） | 若走"Python 库"路线需单独评估 |

---

## 10. 给决策者的建议（一页纸）

1. **不要 Fork，也不要把 Python deepdoc 当库抽**——它已经不存在了（本 HEAD 已删除）。
2. **不要为了 RAGFlow 常驻 6 个容器**。16 GB M4 上它与 Next+FastAPI+Postgres 抢内存，且官方未支持 macOS Go 后端。
3. **推荐 R1**：把 RAGFlow 当**一次性/低频的"重解析设备"**（`docker compose up` → 批量上传 → 拉 chunks → 灌 pgvector → `down`）。它输出的 `positions`/`page_no`/`img_id` 正好是我们要的引用溯源三元组。
4. **日常链路自建**：PyMuPDF（文本+bbox）+ python-docx（Word 大纲）+ RapidOCR/PaddleOCR（扫描件）+ 自写分块（抄 §8.4 的参数面）+ pgvector。
5. **必抄两个算法**：§8.1 引用定位、§8.2 句级引用插入。这两个是"看起来能用"和"敢给学生看"的差别。
6. **许可证放心用**：Apache-2.0，无附加条款；只需保留版权声明，不要用 RAGFlow 商标。若复制 C++ 分词代码，补 `darts.h` 的 BSD 声明。

---

## 附录 A：证据索引（文件:行）

| 主题 | 位置 |
|---|---|
| Apache-2.0 全文 | `LICENSE:1-201` |
| 版本号 1.0.0 | `pyproject.toml:3` |
| Go 1.27 / module ragflow | `go.mod:1,3` |
| 去 Python 化路线 | `AGENTS.md:22`（Go-only target） |
| 企业版 stub 机制 | `AGENTS.md:63-73`、`cmd/stub.go:28-31`、`internal/engine/clickhouse/stub.go:21` |
| 六种运行模式 | `cmd/ragflow_server.go:146,276-300` |
| deepdoc 独立服务器 = EE | `cmd/stub.go:30` |
| 进程内 DeepDoc 注册 + fail-fast | `internal/server/deepdoc/server.go:60-120` |
| DeepDoc 无 Python 服务 | `internal/deepdoc/parser/pdf/inference/native_analyzer/native_analyzer.go:1-17` |
| ORT 静态链接 | `internal/deepdoc/native/session.go:50-72`、`docker/README.md:166` |
| 推理并发/线程预算 | `internal/deepdoc/native/inference_config.go:52-100`、`cmd/ragflow_server.go:136-139` |
| 页并发默认 2 | `internal/server/config/ingestor_config.go:101-109` |
| 5 个模型文件 | `internal/common/environments.go:560-566`、`deps/download_deps.py:103-104` |
| 模型来源 HF | `deps/download_deps.py:103` |
| layout 模型 ≈73 MB | `Dockerfile:28-33` |
| ORT 静态库 ≈48 MB | `tools/scripts/convert_deepdoc_model.py:7` |
| 仅 CPU 推理 | `docker/README.md:168` |
| session/权重共享与 14 GB 陷阱 | `internal/deepdoc/native/session.go:95-120,255-262` |
| DPI 216 | `internal/deepdoc/parser/type/types.go:301-305` |
| DLA 1024 + 10 类 | `internal/deepdoc/native/dla.go:20,46-60` |
| DET 960 + shape 池 | `internal/deepdoc/native/det_core.go:25,79-83` |
| OCR batch 16 + 旋转投票 | `internal/deepdoc/parser/pdf/parser_ocr.go:25,75-110` |
| drop_score 0.5 | `internal/deepdoc/parser/pdf/inference/native_analyzer/native_analyzer.go:44` |
| 乱码门控 | `internal/deepdoc/parser/pdf/util/garbled.go:218-236` |
| PDF 主流程 | `internal/deepdoc/parser/pdf/parser.go:87,636-690` |
| 表格 HTML 化 | `internal/deepdoc/parser/pdf/table/table_html.go:13-55` |
| 表格网格化（span） | `internal/parser/tableutil/table_html.go`、`table_grid_test.go` |
| 每行一 chunk | `internal/ingestion/component/chunker/table.go:20-31` |
| 10 种 chunker | `internal/ingestion/component/chunker/names.go:22-34` |
| 分块默认参数 | `internal/ingestion/component/chunker/general.go:44-60` |
| split 算子 | `internal/parser/chunk/split.go:36,89-104` |
| 默认流水线 DSL | `internal/ingestion/pipeline/template/ingestion_pipeline_general.json` |
| Chunk 字段契约 | `internal/ingestion/component/schema/chunk_types.go:108-148` |
| Position 结构 | `internal/deepdoc/parser/type/types.go:149-156` |
| Chunk 唯一 ID | `internal/ingestion/component/chunker/register.go:110-135`、`common.ChunkID` |
| Tokenizer 组件（含设计说明） | `internal/ingestion/component/tokenizer.go:17-72` |
| 检索融合公式 | `internal/service/nlp/retrieval.go:487-491,653-702` |
| 检索字段白名单 | `internal/service/nlp/retrieval.go:725-740` |
| 句级引用插入 | `internal/service/citation.go:68-134` |
| 引用负载 | `internal/service/kb_prompt.go:30-54`、`internal/service/ask_service.go:266-289` |
| Agent 引用聚合 | `internal/service/agentic_reference.go:140-215` |
| 引用落库 | `internal/entity/conversation_history.go:51-85` |
| knowledgebase 表 | `internal/entity/dataset.go:104-154` |
| document 表 | `internal/entity/document.go:20-88` |
| ingestion_task(_log) | `internal/entity/ingestion_task.go:20-60` |
| 56 张表清单 | `internal/dao/database.go:246-310` |
| DB 类型白名单 | `internal/server/config/database_config.go:73-81`、`environments.go:178-186` |
| doc engine 白名单（OpenSearch 未实现） | `internal/server/config/environments.go:163-172` |
| 对象存储白名单 | `internal/server/config/environments.go:190-198` |
| 每租户索引名 | `internal/engine/infinity/chunk.go:1584`、`internal/engine/elasticsearch/common.go:98`、`chunk.go:1025` |
| DocEngine 接口 | `internal/engine/engine.go:38-111` |
| 任务 subject | `internal/common/task.go:24`、`internal/ingestion/service/ingestion_service.go:243` |
| 启动依赖链 fail-fast | `cmd/ragflow_server.go:505-560` |
| entrypoint 角色编排 | `docker/entrypoint.sh:105-186` |
| compose profile 全表 | `docker/docker-compose-base.yml:1-520` |
| MEM_LIMIT 8 GB | `docker/.env:92` |
| COMPOSE_PROFILES 组合 | `docker/.env:55` |
| 16 GB 官方建议 | `README.md:150`、`docs/quickstart.mdx:19` |
| macOS 不支持声明 | `docker/README.md:24`、`docker/docker-compose-macos.yml:6` |
| darwin/arm64 原生构建支持 | `build.sh:115-183`、`tools/scripts/download_dev_deps.py:46-49` |
| 前端栈 | `web/package.json`（react 18 / vite 7 / ts 5.9 / tailwind 3） |
| 上传落 MinIO | `internal/service/document/document_upload.go:34-135` |
| 解析 API | `docs/references/http_api_reference.md:1575-1640` |
| chunk 列表 API（含 positions） | `docs/references/http_api_reference.md:1858-1935` |
| 检索 API | `docs/references/http_api_reference.md:2428` |
| embedding 必填 | `internal/service/dataset/embedding.go:58` |
| 镜像不含 embedding 模型 | `docker/README.md:155` |
| TEI 配置 | `docker/.env:337-351` |
| 第三方许可（opencc Apache / darts 缺声明） | `internal/binding/cpp/opencc/opencc.h:1-14`、`internal/binding/cpp/darts/darts.h:1-30` |
