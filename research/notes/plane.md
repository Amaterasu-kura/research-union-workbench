# Plane 源码调研（精简版）

> 仓库：`research/repos/plane`，HEAD `618d0eb`（2026-11-03），版本 1.5.0（`package.json:3`）。
> 只读源码，未构建/未启动容器；资源数字为估算。

## 0. 结论速览

| 问题 | 结论 |
|---|---|
| 许可证 | **AGPL-3.0-only**，标准 AGPLv3 全文，无附加限制 |
| 能否复制组件进闭源系统 | **不能**（衍生作品整体须 AGPL；网络服务还须按 §13 提供源码） |
| 前端 | **React Router 8 framework mode，已不是 Next.js**；web 纯 CSR |
| 后端 | Django 5.2.17 + DRF + Celery 5.5.3（RabbitMQ），Python 3.12 |
| 服务数 | compose 13 个（12 常驻 + 1 一次性 migrator） |
| 复用 | **不复制任何代码**；只借鉴交互范式与数据模型 |
| 部署 | 不建议为"参考 UI"部署整套（官方最低 2vCPU/4GB） |

## 1. LICENSE 与实际约束

- `LICENSE.txt:1-2` AGPLv3；`COPYRIGHT.txt:2` `AGPL-3.0-only`；`package.json:6`、各 `apps/*`、`packages/*` 均标 AGPL-3.0。
- §13 在 `LICENSE.txt:540-551`：**修改后**通过网络供人交互，须向所有远程用户提供完整 Corresponding Source。
- 场景判断：
  - 原样自建不修改：§13 不触发，保留声明即可；
  - 修改后部署（哪怕校内、只给师生用）：§13 触发，须对这些用户开放源码；
  - 复制 `.tsx/.py` 进我们的闭源系统：形成组合作品，整体须 AGPL —— **不可接受**。
- 商标不在授权内（不能沿用 Plane 名称/Logo）。
- **未验证**：`@makeplane/propel` 是外部 npm 包（`pnpm-workspace.yaml:28`，0.9.7），仓库无其源码/LICENSE，需单独核实（离线无法访问 npm）。
- 结论：代码零复制；信息架构、状态机、表结构思路可自由重写。

## 2. 技术栈与服务

- 前端：React Router 8（`apps/web/package.json:63`），`ssr:false`（`apps/web/react-router.config.ts:10-11`）；仍留 **329 处 `next/*` import**，由 Vite alias 指到 `app/compat/next/*`（`apps/web/vite.config.ts:26-31`）。
- 状态：**MobX 6.12** + 少量 SWR（`pnpm-workspace.yaml:134-135`；通知未读数只在挂载时拉一次，`components/navigation/top-navigation-root.tsx:34-37`）。
- UI：外部 `@makeplane/propel` 0.9.7 + Base UI + Tailwind 4（`pnpm-workspace.yaml:28,172`）；编辑器 TipTap 3 + Yjs/Hocuspocus（`packages/editor`）；拖拽 pragmatic-dnd；表格 TanStack Table；命令面板 cmdk。
- i18n：22 个 locale，含 zh-CN/zh-TW（`packages/i18n/src/locales/`）。
- 后端：Django 5.2.17 + DRF 3.18.3 + Celery 5.5.3 + `django-celery-beat`（`apps/api/pyproject.toml`、`plane/celery.py`）。
- DB：Postgres 15.7（`docker-compose.yml:110`），126 个 migration，用 ArrayField/JSONB/advisory lock。
- MQ：RabbitMQ 3.13.6 作 Celery broker（`docker-compose.yml:132`、`settings/common.py:355-366`）。
- 缓存：Valkey 7.2.11（`docker-compose.yml:125`）。
- 对象存储：**仅 S3 兼容**，默认 backend 即 S3Storage（`settings/common.py:331-332`），自建用 MinIO（`docker-compose.yml:145`）。
- 实时：`channels` 无 consumer；`apps/live`（Hocuspocus）**只服务文档协作**，前端唯一 WebSocket 在 `components/pages/editor/editor-body.tsx:86-100`。**任务看板/通知无实时推送**。
- 13 服务（`docker-compose.yml`）：web/admin/space/api/worker/beat/migrator/live/plane-db/plane-redis/plane-mq/plane-minio/proxy。
  必需 7 个：web、api、worker、db、redis、mq、minio；beat 建议留；admin/space/live/proxy 可省（live 仅页面协作）。

## 3. 数据模型（`apps/api/plane/db/models/`，102 个模型类）

- 基类：`BaseModel` UUID 主键 + 审计 + 软删（`base.py:17-44`）；`AuditModel`（`mixins.py:85-89`）；唯一约束一律 `deleted_at IS NULL` 部分索引（`project.py:148-163`）。
- `Workspace`（`workspace.py:119-182`）：组织根，角色仅 **20 Admin / 15 Member / 5 Guest**（`:19`）。`Team` 模型（`:261`）是死代码，无接口 —— **没有部门层**。
- `Project`（`project.py:68-227`）：`identifier/network/default_state/timezone/archived_at` 等；`ProjectBaseModel` 自动回填 workspace（`:230-239`）。
- `ProjectMember`（`project.py:260-306`）：项目内角色同样 20/15/5；`ProjectUserProperty`（`:392-419`）存用户×项目的 filters/display_properties（**视图配置服务端持久化**）。
- `Issue`（`issue.py:104-172`）：
  - 子任务 = `parent` 自关联（`:114-120`），无独立表；
  - `state` FK（项目内状态）；`priority` 固定 5 值 `urgent/high/medium/low/none`（`:141-146`）；
  - `start_date/target_date` DateField；`assignees` M2M through `IssueAssignee`（多负责人）；`labels` M2M；
  - `sequence_id` 项目内序号，创建时 PG advisory lock + `IssueSequence` 墓碑表，**序号永不回收**（`:184-214`）；
  - `sort_order` float（+10000 间隔，`:206-210`）；`completed_at` 随 state group 自动维护（`:240-255`）。
  - 默认 manager 排除 triage/归档/草稿（`:92-101`）。
- `State`（`state.py:79-126`）：属于项目，`group ∈ backlog/unstarted/started/completed/cancelled/triage`（`:14-20`）；**无流转规则**，任意互跳，完成语义只看 group。
- `Label`（`label.py:11-57`）：workspace 级或项目级（project 可空）。
- `Cycle`（`cycle.py:60-101`，迭代，带 `progress_snapshot` JSON）、`Module`（`module.py:67-127`，6 种 status）、`Estimate`（`estimate.py:18-57`）、`IssueType`（`issue_type.py:14-52`）。
- 活动：`IssueActivity`（`issue.py:415-448`，verb/field/old_value/new_value/actor/epoch）；写库后由 Celery 逐字段 diff 生成（`app/views/issue/base.py:406-744`、`bgtasks/issue_activities_task.py:1549+`）。另 `IssueVersion`/`IssueDescriptionVersion` 整行快照（`:677-822`）。**无通用 audit_log**。
- 附件：`FileAsset`（`asset.py:32-124`）通用表 + `entity_type`；S3 预签名直传（`app/views/asset/v2.py:198-230`），默认 5MB（`issue.py:392-395`），孤儿文件由 beat 清理。
- 通知：`Notification`（`notification.py:13-69`，9 个复合索引）+ 偏好表 + 邮件日志。

## 4. 前端交互

- 五布局：kanban/list/calendar/gantt/spreadsheet（`components/issues/issue-layouts/`，约 15,660 行）；甘特自研 2,266 行（`components/gantt-chart/`）。
- 卡片：`ID → 标题 → 属性 chips`，hover 出快捷菜单，点击开 peek 侧滑（`kanban/block.tsx:98-143`）；chips 受 `displayProperties` 控制，窄行收进 `+N`（`properties/all-properties.tsx:76-120`）。
- 详情：主区（标题/描述/子任务/活动流）+ 侧栏（Parent/Labels/Estimate、Cycle/Modules），全部就地编辑（`issue-detail/main-content.tsx`、`sidebar-sections.tsx`）。
- 活动流按 `field` 分发到 20+ 小组件（`issue-detail/issue-activity/activity/activity-list.tsx:40-120`）。
- 筛选/排序：`filters` + `display_filters` JSON 存服务端（`ProjectUserProperty`/`IssueView`），列表接口按 `group_by` 服务端分组、每组独立分页（`app/views/issue/base.py:317-404`）。
- 快捷键：Power K 注册表，命令带 `shortcut/keySequence/modifierShortcut/isVisible(ctx)`，并处理键盘布局（`components/power-k/core/registry.ts`、`shortcut-handler.ts`）。
- 乐观更新：先改 MobX，再 PATCH，失败回滚（`store/issue/helpers/base-issues.store.ts:555-590`）；拖拽落位 `hooks/use-group-dragndrop.ts:60-120`。
- 批量操作：**CE 被阉割**——多选后只弹升级广告（`components/issues/bulk-operations/root.tsx:34-52`）；后端仅开放批量删除/批量改日期（`app/views/issue/base.py:775-800,1108-1187`）。

## 5. 复用判定

| 类别 | 资产 | 说明 |
|---|---|---|
| 可直接复制 | **无** | AGPL + Monorepo/MobX/propel 耦合 |
| 可参考重写 | 卡片 IA、State group、字段级活动流、视图持久化+分组分页、命令注册表、乐观更新、FileAsset 附件、Notification 表设计、zh-CN 术语 | 只学设计，自己实现 |
| 完全不可用 | Django 权限/序列化/Celery、services 包、propel、admin/space/live、license/telemetry | 框架/许可不匹配 |

`packages/blocks` 最像可复用库（无 `@/` 别名），但仍依赖 5 个 `@plane/*` 包 + propel + Tailwind 语义色（`packages/blocks/package.json:62-70`）；`packages/services` 与 Django URL 强绑定。**复用 = 照着重写**。

## 6. 与 Next.js + FastAPI 的冲突

- Next.js：组件全是 `observer()` + 浏览器 API，进 App Router 必须 `"use client"`，无 RSC 红利；但 329 处 `next/navigation|link` 在 Next 里原生可用（去掉垫片即可），路由结构 `[workspaceSlug]/[projectId]/...` 兼容。
- FastAPI：需重写分组列表、CRUD、history、comments、附件预签名、通知、筛选视图等端点（Plane 用 DRF + `GroupedOffsetPaginator`）。
- RBAC：Plane 是 workspace 角色 + project 角色（均 20/15/5），**workspace Admin 覆盖 project 角色**（`app/permissions/base.py:79-93`），guest 仅见自己创建的任务（`:106-141`），前端镜像同一套（`store/user/base-permissions.store.ts:127-137`）。我们「部门 + 项目成员 + 三种全局角色」无对应层级，且不能照搬"Admin 通吃"。
  → 建议在 FastAPI 做 `effective_permissions(user, project) -> capabilities{view,edit,assign,delete,manage}`，前端只认能力位。
- 重写量（看板+列表+详情+活动流+筛选+分配+快捷键 MVP）：前端 5–8k 行，后端 1.5–2.5k 行，权限 0.3–0.5k 行；单人 4–8 周。Plane 全量 web 17.2 万行，我们取其约 4%。

## 7. Mac mini 16GB 资源

- 官方最低 **2vCPU / 4GB**（`deployments/cli/community/README.md:13`）。
- 空载估算：api 0.5–0.8G、worker 0.8–2.5G（默认按核数起进程，须限 `--concurrency=2`）、beat 0.2G、live 0.3G、space 0.2G、web/admin/proxy 各 0.05G、PG 0.3G、Valkey 0.05G、RabbitMQ 0.25G、MinIO 0.15G → **约 3.4–5.2GB**；加 macOS/Docker 开销实际 6–8GB。
- 构建峰值 10–12GB；磁盘：镜像 8–12GB + 缓存 10–20GB，建议预留 30GB。
- **不建议为参考 UI 部署整套**。若必须：只起 7 个服务、限内存、worker 限并发、用完 `down -v`。

## 8. 最值得移植的 5 个设计

1. **卡片 IA**：ID → 标题 → 优先级/截止/负责人/子任务 chips，点开 Drawer；固定 4 个 chip，不做配置系统。
2. **State group 状态机**：状态行带 `group`，任意互跳，`completed_at` 自动维护；我们固定 4 状态但保留 group 列，进度按 group 聚合。
3. **字段级活动流**：`task_activity(task, actor, verb, field, old, new)` 同事务同步写（不用 Celery），前端 8 个渲染分支，"任务交换"记为 `field='transfer'`。
4. **视图持久化**：`task_view(user, project, layout, filters jsonb)`；不做每组独立分页（社团项目 <500 任务）。
5. **命令面板**：cmdk + 12 条命令 + 6 个快捷键（`c`/`/`/`g b`/`g l`/`?`/`Esc`）。

附带小点：序号墓碑表、软删 + 部分唯一索引、`sort_order` float、附件预签名直传、通知复合索引。

## 9. 关键证据索引

| 项 | 路径:行 |
|---|---|
| AGPL/§13 | `LICENSE.txt:1-2,540-551`；`COPYRIGHT.txt:2`；`package.json:6` |
| React Router / CSR | `apps/web/package.json:63`；`apps/web/react-router.config.ts:10-11` |
| next 兼容层 | `apps/web/vite.config.ts:26-31`；`apps/web/app/compat/next/navigation.ts` |
| propel/MobX/Tailwind | `pnpm-workspace.yaml:28,134-135,172` |
| 后端依赖 | `apps/api/pyproject.toml`；`plane/celery.py` |
| DB/MQ/Redis/MinIO | `docker-compose.yml:110,125,132,145`；`settings/common.py:331-332,355-366` |
| 13 服务/最低配置 | `docker-compose.yml`；`deployments/cli/community/README.md:13` |
| 角色与权限 | `db/models/workspace.py:19`；`db/models/project.py:21`；`app/permissions/base.py:19-141` |
| Issue 模型 | `db/models/issue.py:104-172,184-214,240-255` |
| State | `db/models/state.py:14-20,79-126` |
| 活动 | `db/models/issue.py:415-448`；`bgtasks/issue_activities_task.py:1549+`；`app/views/issue/base.py:406-744` |
| 附件 | `db/models/asset.py:32-124`；`app/views/asset/v2.py:198-230` |
| 通知/视图 | `db/models/notification.py:13-69`；`db/models/view.py:58-99`；`db/models/project.py:392-419` |
| 卡片/活动/乐观更新 | `components/issues/issue-layouts/kanban/block.tsx:98-143`；`issue-activity/activity/activity-list.tsx:40-120`；`store/issue/helpers/base-issues.store.ts:555-590` |
| 批量阉割 | `components/issues/bulk-operations/root.tsx:34-52` |
| 规模 | web 1,860 文件/17.2 万行；api 12.1 万行；102 模型；126 migrations |

## 10. 未验证

1. `@makeplane/propel` 许可证（仓库外 npm 包）。
2. 各服务真实 RSS、镜像体积（未构建，均为估算）。
3. 商业版（Plane One）的批量编辑/AI 不在 CE，不能作参考。
