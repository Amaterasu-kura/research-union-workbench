"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowUpRight,
  BookOpen,
  CalendarDays,
  CheckCircle2,
  Circle,
  FileText,
  FolderKanban,
  ListChecks,
  Users,
} from "lucide-react";
import { api } from "@/lib/api";
import type { Project } from "@/lib/types";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { TASK_STATUS_LABEL, formatDate, STATUS_LABEL } from "@/lib/utils";

const STATUS_VARIANT: Record<string, "brand" | "warning" | "default" | "outline"> = {
  preparing: "brand",
  running: "warning",
  ended: "default",
  archived: "outline",
};

export function ContextPanel({ project }: { project: Project | null }) {
  const summary = useQuery({
    queryKey: ["project-summary", project?.id],
    queryFn: () => api.projects.summary(project!.id),
    enabled: !!project,
  });
  const tasks = useQuery({
    queryKey: ["tasks", "project", project?.id],
    queryFn: () => api.tasks.list({ projectId: project!.id }),
    enabled: !!project,
  });
  const files = useQuery({
    queryKey: ["files", "project", project?.id],
    queryFn: () => api.files.list(project!.id),
    enabled: !!project,
  });
  const knowledge = useQuery({
    queryKey: ["knowledge", "project", project?.id],
    queryFn: () => api.knowledge.list({ projectId: project!.id }),
    enabled: !!project,
  });

  if (!project) {
    return (
      <aside className="hidden w-[312px] shrink-0 border-l border-slate-200/80 bg-white xl:flex xl:flex-col">
        <div className="border-b border-slate-100 px-5 py-4">
          <p className="text-[13px] font-semibold text-slate-800">全局对话</p>
          <p className="mt-1 text-[11px] leading-5 text-slate-500">
            这里适合提出新活动想法、日常咨询和跨项目讨论。涉及具体项目时，可以切换到项目对话。
          </p>
        </div>
        <div className="space-y-3 p-4">
          <div className="rounded-xl border border-indigo-100 bg-indigo-50/50 p-4">
            <div className="flex items-center gap-2 text-indigo-700">
              <FolderKanban size={15} />
              <p className="text-[12px] font-medium">从想法到项目</p>
            </div>
            <p className="mt-1.5 text-[11px] leading-5 text-slate-600">
              在对话里描述活动，AI 会整理名称、年份与系列，形成创建建议；负责人确认后才会真正创建。
            </p>
          </div>
          <div className="rounded-xl border border-slate-200 p-4">
            <div className="flex items-center gap-2 text-slate-700">
              <BookOpen size={15} />
              <p className="text-[12px] font-medium">历史资料</p>
            </div>
            <p className="mt-1.5 text-[11px] leading-5 text-slate-500">
              上传往届策划案或总结后，对话会自动检索相关段落，并标注文件与页码。
            </p>
          </div>
          <Link
            href="/knowledge"
            className="flex items-center justify-between rounded-xl border border-slate-200 px-4 py-3 text-[12px] text-slate-700 transition hover:border-indigo-200 hover:bg-slate-50"
          >
            打开知识库 <ArrowUpRight size={14} className="text-slate-400" />
          </Link>
        </div>
      </aside>
    );
  }

  const taskStats = summary.data?.tasks;
  const progress = taskStats && taskStats.total > 0 ? Math.round((taskStats.done / taskStats.total) * 100) : 0;
  const activeTasks = (tasks.data ?? []).filter((task) => task.status !== "done").slice(0, 4);

  return (
    <aside className="hidden w-[312px] shrink-0 flex-col border-l border-slate-200/80 bg-white xl:flex">
      <div className="border-b border-slate-100 px-5 py-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-[13px] font-semibold text-slate-900">{project.name}</p>
            <p className="mt-1 flex items-center gap-1.5 text-[10px] text-slate-400">
              <CalendarDays size={11} /> {project.year} 年 · {project.series?.name ?? "未分类"}
            </p>
          </div>
          <Badge variant={STATUS_VARIANT[project.status] ?? "default"}>
            {STATUS_LABEL[project.status]}
          </Badge>
        </div>
        <div className="mt-3">
          <div className="mb-1 flex items-center justify-between text-[10px] text-slate-400">
            <span>任务完成度</span>
            <span>{progress}%</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
            <div className="h-full rounded-full bg-indigo-500 transition-all" style={{ width: `${progress}%` }} />
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
        <section>
          <div className="mb-2 flex items-center justify-between">
            <p className="flex items-center gap-1.5 text-[11px] font-medium text-slate-500">
              <ListChecks size={13} /> 进行中的任务
            </p>
            <Link href={`/tasks?project=${project.id}`} className="text-[10px] text-indigo-600 hover:underline">
              全部
            </Link>
          </div>
          {activeTasks.length === 0 ? (
            <p className="rounded-lg bg-slate-50 px-3 py-4 text-center text-[11px] text-slate-400">
              暂无待办任务
            </p>
          ) : (
            <div className="space-y-1.5">
              {activeTasks.map((task) => (
                <div key={task.id} className="rounded-lg border border-slate-100 bg-slate-50/60 px-3 py-2">
                  <div className="flex items-start gap-2">
                    <Circle size={11} className="mt-1 shrink-0 text-slate-300" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[11px] font-medium text-slate-700">{task.title}</p>
                      <p className="mt-0.5 text-[10px] text-slate-400">
                        {TASK_STATUS_LABEL[task.status]} · {formatDate(task.due_at)} ·{" "}
                        {task.assignee?.name ?? "待分配"}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section>
          <div className="mb-2 flex items-center justify-between">
            <p className="flex items-center gap-1.5 text-[11px] font-medium text-slate-500">
              <Users size={13} /> 项目成员
            </p>
            <span className="text-[10px] text-slate-400">{project.members.filter((m) => m.status === "active").length} 人</span>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {project.members
              .filter((member) => member.status === "active")
              .slice(0, 8)
              .map((member) => (
                <Avatar key={member.id} name={member.user.name} size={26} />
              ))}
          </div>
        </section>

        <section>
          <div className="mb-2 flex items-center justify-between">
            <p className="flex items-center gap-1.5 text-[11px] font-medium text-slate-500">
              <FileText size={13} /> 关联文件
            </p>
            <Link href={`/projects/${project.id}?tab=files`} className="text-[10px] text-indigo-600 hover:underline">
              管理
            </Link>
          </div>
          {(files.data ?? []).length === 0 ? (
            <p className="rounded-lg bg-slate-50 px-3 py-4 text-center text-[11px] text-slate-400">
              还没有上传资料
            </p>
          ) : (
            <div className="space-y-1">
              {(files.data ?? []).slice(0, 4).map((file) => (
                <div key={file.id} className="flex items-center gap-2 rounded-lg px-1 py-1.5">
                  <FileText size={13} className="shrink-0 text-slate-400" />
                  <span className="min-w-0 flex-1 truncate text-[11px] text-slate-600">{file.original_name}</span>
                  {file.status === "ready" ? (
                    <CheckCircle2 size={11} className="text-emerald-500" />
                  ) : (
                    <span className="text-[9px] text-amber-500">解析中</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        <section>
          <div className="mb-2 flex items-center justify-between">
            <p className="flex items-center gap-1.5 text-[11px] font-medium text-slate-500">
              <BookOpen size={13} /> 相关经验
            </p>
            <Link href={`/knowledge?project=${project.id}`} className="text-[10px] text-indigo-600 hover:underline">
              知识库
            </Link>
          </div>
          {(knowledge.data ?? []).length === 0 ? (
            <p className="rounded-lg bg-slate-50 px-3 py-4 text-center text-[11px] text-slate-400">
              暂无项目经验
            </p>
          ) : (
            <div className="space-y-1.5">
              {(knowledge.data ?? []).slice(0, 3).map((item) => (
                <div key={item.id} className="rounded-lg border border-slate-100 px-3 py-2">
                  <p className="line-clamp-1 text-[11px] font-medium text-slate-700">{item.title}</p>
                  <p className="mt-0.5 line-clamp-2 text-[10px] leading-4 text-slate-400">{item.content}</p>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <div className="border-t border-slate-100 p-3">
        <Link
          href={`/projects/${project.id}`}
          className="flex items-center justify-center gap-1.5 rounded-lg bg-slate-50 py-2 text-[11px] font-medium text-slate-600 transition hover:bg-slate-100"
        >
          打开项目详情 <ArrowUpRight size={12} />
        </Link>
      </div>
    </aside>
  );
}
