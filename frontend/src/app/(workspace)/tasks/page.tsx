"use client";

import { Suspense, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeftRight, ListChecks, Plus, UserRound } from "lucide-react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import type { Task, TaskStatus } from "@/lib/types";
import { useAuth } from "@/components/auth-provider";
import { CreateTaskModal } from "@/components/tasks/create-task";
import { TaskCard } from "@/components/tasks/task-card";
import { TaskDetailModal } from "@/components/tasks/task-detail";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState, Skeleton } from "@/components/ui/empty";
import { Select } from "@/components/ui/input";
import { TASK_STATUS_LABEL, formatDate } from "@/lib/utils";

const COLUMNS: { key: TaskStatus; label: string }[] = [
  { key: "todo", label: "待开始" },
  { key: "doing", label: "进行中" },
  { key: "done", label: "已完成" },
];

function TasksContent() {
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [projectId, setProjectId] = useState(searchParams.get("project") ?? "");
  const [mine, setMine] = useState(false);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const projectsQuery = useQuery({ queryKey: ["projects"], queryFn: api.projects.list });
  const tasksQuery = useQuery({
    queryKey: ["tasks", projectId, mine],
    queryFn: () => api.tasks.list({ projectId: projectId || undefined, mine }),
  });
  const exchangesQuery = useQuery({
    queryKey: ["task-exchanges"],
    queryFn: api.tasks.exchanges,
  });

  const projects = projectsQuery.data ?? [];
  const tasks = tasksQuery.data ?? [];
  const selectedProject = projects.find((project) => project.id === projectId);
  const taskProject = projects.find((project) => project.id === selectedTask?.project_id);
  const members = taskProject?.members ?? selectedProject?.members ?? [];
  const isChair = Boolean(user?.roles.some((role) => role.code === "chair"));
  const isLead = Boolean(user?.roles.some((role) => role.code === "lead"));
  const canManageProject = (project: typeof selectedProject) => {
    if (!project || !user) return isChair;
    if (isChair || project.lead?.id === user.id) return true;
    return Boolean(
      isLead &&
        project.department_id &&
        user.departments.some((department) => department.id === project.department_id),
    );
  };
  const canCreate = projectId ? canManageProject(selectedProject) : isChair;
  const canManageSelected = selectedTask ? canManageProject(taskProject) : isChair;

  const incoming = useMemo(
    () => (exchangesQuery.data ?? []).filter((item) => item.status === "pending" && item.to_user_id === user?.id),
    [exchangesQuery.data, user?.id],
  );

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ["tasks"] });
    await queryClient.invalidateQueries({ queryKey: ["task-exchanges"] });
    await queryClient.invalidateQueries({ queryKey: ["notifications"] });
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[1240px] px-5 py-6 lg:px-8">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wider text-slate-400">Tasks</p>
            <h2 className="mt-1 text-[22px] font-semibold tracking-tight text-slate-900">任务中心</h2>
            <p className="mt-1 text-[12px] text-slate-500">按优先级推进任务；成员可以发起任务交换。</p>
          </div>
          {canCreate ? (
            <Button onClick={() => setCreateOpen(true)} disabled={!projectId}>
              <Plus size={15} /> 新建任务
            </Button>
          ) : null}
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <Select
            value={projectId}
            onChange={(event) => setProjectId(event.target.value)}
            className="w-64"
          >
            <option value="">全部项目</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </Select>
          <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white p-1">
            <button
              onClick={() => setMine(false)}
              className={`rounded-md px-3 py-1.5 text-[11px] font-medium ${!mine ? "bg-indigo-50 text-indigo-700" : "text-slate-500"}`}
            >
              全部任务
            </button>
            <button
              onClick={() => setMine(true)}
              className={`rounded-md px-3 py-1.5 text-[11px] font-medium ${mine ? "bg-indigo-50 text-indigo-700" : "text-slate-500"}`}
            >
              我的任务
            </button>
          </div>
          <span className="text-[11px] text-slate-400">共 {tasks.length} 项</span>
        </div>

        {incoming.length > 0 ? (
          <div className="mt-4 space-y-2">
            {incoming.map((exchange) => {
              const fromTask = tasks.find((task) => task.id === exchange.from_task_id);
              const toTask = tasks.find((task) => task.id === exchange.to_task_id);
              return (
                <div
                  key={exchange.id}
                  className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-200 bg-amber-50/70 px-4 py-3"
                >
                  <ArrowLeftRight size={15} className="text-amber-600" />
                  <div className="min-w-0 flex-1">
                    <p className="text-[11.5px] font-medium text-amber-900">收到任务交换申请</p>
                    <p className="mt-0.5 text-[10.5px] text-amber-700">
                      「{fromTask?.title ?? "对方任务"}」 ↔ 「{toTask?.title ?? "你的任务"}」
                      {exchange.message ? ` · ${exchange.message}` : ""}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    onClick={async () => {
                      await api.tasks.acceptExchange(exchange.id);
                      toast.success("已接受交换");
                      await refresh();
                    }}
                  >
                    接受
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={async () => {
                      await api.tasks.rejectExchange(exchange.id);
                      toast.success("已拒绝交换");
                      await refresh();
                    }}
                  >
                    拒绝
                  </Button>
                </div>
              );
            })}
          </div>
        ) : null}

        {tasksQuery.isLoading ? (
          <div className="mt-5 grid gap-4 lg:grid-cols-3">
            {[0, 1, 2].map((index) => (
              <Skeleton key={index} className="h-72 rounded-2xl" />
            ))}
          </div>
        ) : tasks.length === 0 ? (
          <EmptyState
            icon={ListChecks}
            title="还没有任务"
            description={projectId ? "在项目详情或这里创建第一个任务。" : "选择一个项目，或先创建一个活动项目。"}
            action={
              canCreate && projectId ? (
                <Button onClick={() => setCreateOpen(true)}>
                  <Plus size={14} /> 新建任务
                </Button>
              ) : undefined
            }
          />
        ) : (
          <div className="mt-5 grid gap-4 lg:grid-cols-3">
            {COLUMNS.map((column) => {
              const columnTasks = tasks.filter((task) => task.status === column.key);
              return (
                <div key={column.key} className="rounded-2xl border border-slate-200/80 bg-slate-50/50 p-3">
                  <div className="mb-2 flex items-center justify-between px-1">
                    <p className="text-[11px] font-medium text-slate-600">{column.label}</p>
                    <span className="rounded-full bg-white px-2 py-0.5 text-[10px] text-slate-400">
                      {columnTasks.length}
                    </span>
                  </div>
                  <div className="space-y-2">
                    {columnTasks.map((task) => {
                      const project = projects.find((item) => item.id === task.project_id);
                      return (
                        <div key={task.id}>
                          <p className="mb-1 px-1 text-[9px] text-slate-400">{project?.name}</p>
                          <TaskCard task={task} onClick={() => setSelectedTask(task)} />
                        </div>
                      );
                    })}
                    {columnTasks.length === 0 ? (
                      <p className="py-8 text-center text-[10px] text-slate-400">暂无任务</p>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {(exchangesQuery.data ?? []).length > 0 ? (
          <div className="mt-6 rounded-2xl border border-slate-200/80 bg-white p-5">
            <p className="text-[13px] font-semibold text-slate-800">最近的交换记录</p>
            <div className="mt-3 space-y-2">
              {(exchangesQuery.data ?? []).slice(0, 5).map((exchange) => {
                const fromTask = tasks.find((task) => task.id === exchange.from_task_id);
                const toTask = tasks.find((task) => task.id === exchange.to_task_id);
                return (
                  <div key={exchange.id} className="flex items-center gap-2 text-[11px] text-slate-500">
                    <ArrowLeftRight size={12} className="text-slate-400" />
                    <span className="min-w-0 flex-1 truncate">
                      {fromTask?.title ?? exchange.from_task_id} ↔ {toTask?.title ?? exchange.to_task_id}
                    </span>
                    <Badge
                      variant={
                        exchange.status === "accepted"
                          ? "success"
                          : exchange.status === "pending"
                            ? "warning"
                            : "default"
                      }
                    >
                      {exchange.status === "accepted"
                        ? "已接受"
                        : exchange.status === "pending"
                          ? "待处理"
                          : "已拒绝"}
                    </Badge>
                    <span className="text-[10px] text-slate-400">{formatDate(exchange.created_at)}</span>
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}
      </div>

      {projectId ? (
        <CreateTaskModal
          open={createOpen}
          onClose={() => setCreateOpen(false)}
          projectId={projectId}
          members={members}
          onCreated={async () => {
            await refresh();
          }}
        />
      ) : null}

      <TaskDetailModal
        task={selectedTask}
        allTasks={tasks}
        members={members}
        currentUser={user}
        canManage={canManageSelected}
        onClose={() => setSelectedTask(null)}
        onChanged={() => {
          void refresh();
          if (selectedTask) {
            void api.tasks
              .list({ projectId: projectId || undefined })
              .then((items) => setSelectedTask(items.find((item) => item.id === selectedTask.id) ?? null));
          }
        }}
      />
    </div>
  );
}

export default function TasksPage() {
  return (
    <Suspense
      fallback={
        <div className="p-8">
          <Skeleton className="h-8 w-48" />
        </div>
      }
    >
      <TasksContent />
    </Suspense>
  );
}
