# LangGraph 调研（结论版）

仓库 `/Users/sakura/better-student-union/research/repos/langgraph`，HEAD `e5e37b5`（2026-11-06），`langgraph 1.2.20`（`libs/langgraph/pyproject.toml:7`）。只读，未改仓库。行号均为实际源码。

## 结论
采用**核心运行时**：`StateGraph` + Pregel 循环 + `PostgresSaver` + `interrupt()/Command(resume=)`。
不用 LangGraph Server/Platform、不用 `prebuilt` 的 agent 工厂、不用 LangSmith、不用 DeltaChannel/v3 流式（均未成熟或不在 MIT 仓库）。
集成方式：**图执行放 RQ worker（同步 `graph.stream` + 同步 `PostgresSaver`），FastAPI 只做「入队 + SSE + 状态快照」**。

## 1. LICENSE 与依赖
- MIT：`/LICENSE:1-3`；`libs/langgraph/pyproject.toml:12`。
- 强绑 langchain-core：`pyproject.toml:27` `langchain-core>=1.4.7,<2`；33 个文件 import（`graph/state.py:34` 起手就 `RunnableConfig`）。绑定的是 config/callback/message 协议，不是 agent 抽象——节点内可直接调官方 SDK。
- 其余：`langgraph-checkpoint>=4.3.0,<5`、`langgraph-sdk>=0.4.6,<0.5`、`langgraph-prebuilt>=1.1,<1.2`、`xxhash`、`pydantic>=2.7.4`；py3.10+，但 `get_config()` 异步注入需 3.11+（`langgraph/config.py:20-28`）→ 用 3.12。
- **官方在收缩 agent 层**：`AGENTS.md:29-34`（LangGraph 收敛为 runtime）、`:49-50`（prebuilt/supervisor/swarm 为 maintenance-only）；`prebuilt/chat_agent_executor.py:313-317` `create_react_agent` 已 deprecated，指向 `langchain.agents.create_agent`。押注 prebuilt 是逆势。
- Server 不在本仓库：`cli/langgraph_cli/cli.py:791` import `langgraph_api`；`config.py:157-161` 里 `langgraph_api/langgraph_runtime/langgraph_license` 为镜像内独立包 → 闭源可控性未知。

## 2. 核心抽象（路径 + 类）
- `StateGraph`（`graph/state.py:131`，builder，必须 `.compile()`）→ `CompiledStateGraph`（`:1404`，继承 `Pregel`）→ `Pregel`（`pregel/main.py:456`）。BSP 三阶段 Plan/Execution/Update：`main.py:470-479`。
- 节点/边/路由：`add_node:667`、`add_edge:928`（多起点=fan-in join）、`add_conditional_edges:982`；边可返回 `Command(goto=...)`（`_control_branch:1749`）。`Send` 并行 fan-out：`types.py:748`。
- state/reducer：`TypedDict|pydantic`；`Annotated[T,f]`→`BinaryOperatorAggregate`（`state.py:1904`），`Annotated[T,BaseChannel]`→该 channel（`:1876`）。`DeltaChannel` 为 **Beta**（`channels/delta.py:29-36`）。
- context（放租户/actor/db_factory，不进 state）：`state.py:216` + `runtime.py:159`，docstring `state.py:145-149` 明示"user_id, db_conn"。
- 持久化：`BaseCheckpointSaver`（`checkpoint/base/__init__.py:199`）；`Checkpoint`(`:93`)、`put:301`、`put_writes:324`。**每 superstep 落盘**：`_loop.py:768`。`durability` 三档（`types.py:99`，默认 async；`sync` 每步 await `main.py:3572`）；写操作按序链式（`_loop.py:1742-1756`）→ kill -9 会丢最后一步，不可逆步骤用 `sync`。
- 失败恢复的关键：pending writes（`checkpoint/README.md:59`，完成的节点不重跑）。
- interrupt：`types.py:906`，实现 `:1030-1055`；`Interrupt` 类 `:594`；`Command` `:843`；`resume` 分支 `_loop.py:1020-1093`（多 interrupt 必须传 id 映射 `:1054-1060`；无 checkpointer 直接 RuntimeError `:1024-1027`）。静态断点 `interrupt_before` 用 `invoke(None, cfg)`（`tests/test_interruption.py:50,56`）。
- time travel：`get_state_history`（`main.py:1529`）、`update_state` 分叉（`:2636`）、按 `checkpoint_id` 回放（`tests/test_time_travel_async.py:1-20`）。
- 子图：编译产物即 Runnable，`checkpointer=None` 继承父图（`main.py:1200`）；`checkpoint_ns = node:task`（`_constants.py:84-86`）。本仓库无 supervisor/swarm。
- 流式：`StreamMode` 7 种（`types.py:132-146`）；`version="v2"` 输出 `StreamPart` TypedDict（`types.py:269-320`，字段 `type/ns/data/interrupts`）→ 可直接当 SSE 事件名。`invoke` 是 `stream` 的糖（`main.py:3946-4065`），SSE 必须用 `astream`。v3 流式 `@beta`（`stream/run_stream.py:56`）。
- **没有持久化任务队列**：`_queue.py` 只是进程内队列；仅 checkpoint/pending writes/`Send` 任务（`_constants.py:16`，`_algo.py:442`）持久化，**没人替你重新驱动**。

## 3. FastAPI 集成
- 嵌入即可，`Pregel.stream` 是纯 Python 生成器（`main.py:2767`），Server 只是可选壳。
- **官方没有 FastAPI 示例**：全仓 `import fastapi` 为 0；`fastapi` 仅作保留包名（`cli/config.py:808`）；唯一 Web 例子是 Server 的 Starlette 自定义 app（`cli/examples/my_app.py:5-8`）。`examples/` 已归档为空壳（`examples/human_in_the_loop/wait-user-input.ipynb:16`）。
- 中断恢复：执行由消费者驱动（`main.py:3520-3560`）→ 请求1 跑到 interrupt，落 `waiting_approval`；请求2 `Command(resume={iid: decision})` 同 `thread_id` 续跑。任何进程可恢复（状态在 PG）。
- 并发真实约束：`AsyncPostgresSaver` 构造时绑 event loop（`aio.py:63-64`）；**整段 DB 操作持一把锁**（`aio.py:428`、`__init__.py:485`）；**无 per-thread 锁**（全仓无 advisory，同 thread 并发 resume 会双跑）；每 run 一个 ThreadPoolExecutor（`_executor.py:58`，限流靠 `max_concurrency` `:143-148`）。compiled graph 可并发复用（每 run 新建 channel：`_checkpoint.py:494-497`）。

## 4. checkpoint-postgres
- 4 张表（`postgres/base.py:46-94`）：`checkpoints(thread_id, checkpoint_ns, checkpoint_id, ...)`、`checkpoint_blobs`、`checkpoint_writes`、`checkpoint_migrations`；**只有 thread_id 索引**，`metadata` 无 GIN → `list(filter=)` 走 `metadata @> %s`（`base.py:866-869`）会全表扫。
- **非 Alembic**（grep 为 0）：`MIGRATIONS` 列表下标即版本 + 版本表，`setup()` 由用户显式调一次（`__init__.py:90-115`）。含 `CREATE INDEX CONCURRENTLY` → 依赖 autocommit；并发 setup 会撞主键 → 放一次性迁移步骤。
- 可与业务库共库：表名不带 schema，走 `search_path` → 用 `options=-csearch_path=agent,public` 放独立 schema；业务用 SQLAlchemy，checkpoint 用 psycopg 池，两条通道别混（必须 `autocommit=True`+`dict_row`，`README.md:34-44`）。
- 多租户：只有 `thread_id` 一个维度，**后端从 agent_runs 反查生成** `{tenant}:{user}:{run}`，绝不接受前端传入。`delete_thread` 可用；`delete_for_runs` 在 PG 实现里**没有**（0 处），清理自己写；`prune` 可用但 DeltaChannel 慎用（`checkpoint/base/__init__.py:409-437`）。
- 序列化红线：`JsonPlusSerializer` 默认宽松（`serde/jsonplus.py:108-135`）→ 生产置 `LANGGRAPH_STRICT_MSGPACK=true`（`serde/_msgpack.py:12`），state 只放纯数据。
- 体积：标量内联 `checkpoints.checkpoint`，非标量进 blobs 且按 version 去重（`postgres/__init__.py:314-331`、`base.py:134-138`）→ 只追加的 messages 每轮存一份全量副本，故 state 只放 id/摘要。

## 5. 工具调用 + 人工确认
`interrupt()` = 抛 `GraphInterrupt`，恢复时**节点从头重跑**（`types.py:1030-1055`；证据 `tests/test_time_travel_async.py:282` `call_count==2`）。因此：
1. LLM 工具面只给只读 + `propose`，写操作永不注册为工具；
2. `interrupt` 前代码必须纯（无 DB 写、无第二次 LLM 调用）；提议与确认拆两个节点；
3. 恢复后先 `approvals.consume(approval_id, actor_id)` 做**服务端**权限校验，再 `execute(idempotency_key=proposal_id)` 写库（唯一约束兜底）；
4. 多 interrupt 传 id 映射；重复提交用 `UNIQUE(interrupt_id)`。
`ToolNode` 会把异常转 ToolMessage 回喂模型（`prebuilt/tool_node.py:1019-1023`），不适合写操作。

## 6. 是否值得
| 能力 | 自研 | LG |
|---|---|---|
| 版本化状态快照 | 300-500 行 | ✅ |
| 断点续跑 | 难（event sourcing） | ✅ |
| 不重复已完成步骤 | 极难 | ✅ pending writes |
| 工具 schema/错误 | 150 行可控 | ⚠️ prebuilt 维护模式 |
| Router/权限/落库/SSE/队列 | 本来就要写 | ❌ |
净：省 800-1500 行最难逻辑，付 ~200 行胶水 + langchain-core 依赖 + 会变的 API（`config_schema`/`checkpoint_during` 均已 deprecate）。对冲：所有 LG 调用关进 `AgentRuntime` Protocol（start/resume/snapshot）一个文件。

## 7. 资源（未实测，量级估计）
纯库：基线 80-120MB + LG 导入 25-50MB；每 graph <5MB；每 run 1 task + 1 线程池。16GB 跑「API 1 + worker 2 + PG + Redis」很宽裕，瓶颈是单 saver 一把锁而非内存。
跑 Server：+250-500MB 进程、1.5-3GB 镜像、额外 PG/Redis、第二套鉴权 → 不划算。
真正吃资源：SSE 长连接数、state 体积、`recursion_limit` 默认 **10007**（`_internal/_config.py:42-44`）→ 必须显式设 20-50。

## 8. 最小架构
```
FastAPI: POST /runs → agent_runs(queued) + RQ enqueue
         POST /runs/{id}/resume → 鉴权 → RQ enqueue(iid, decision)
         GET  /runs/{id}/events → SSE：先回放 agent_events(seq>after)，再 XREAD 增量
RQ worker: graph=build_graph()（进程级单例）；saver=PostgresSaver(pool)
           graph.stream(input|Command(resume=), cfg,
                        stream_mode=["values","updates","messages","custom"],
                        version="v2", durability="sync")
           → 落 agent_events + XADD；遇 interrupt → status=waiting_approval，job 正常结束
```
cfg = `{"configurable":{"thread_id": tid}, "recursion_limit": 30}`。

三个坑：
1. **节点重跑**：interrupt 前有副作用 → 重复建项目/重复计费。对策见 §5。
2. **SSE 断连即取消**：执行由迭代驱动，断线=取消；且无事件回放（`_internal/_replay.py` 是子图 checkpoint 回放，不是事件回放）。→ 执行放后台 + 事件双写（表用于回放、Redis 用于分发）。
3. **checkpointer 并发模型**：绑 loop + 单锁 + 同 thread 无锁 → saver 必须进程级单例（API 在 lifespan 建；RQ 用同步版）；resume 前加 `pg_advisory_xact_lock(hashtext(thread_id))` 或 Redis 锁。

（第 4 坑：`recursion_limit` 默认 10007，跑飞很贵。）
