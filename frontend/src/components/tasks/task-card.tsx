"use client";

import { CalendarClock, Flag } from "lucide-react";
import type { Task } from "@/lib/types";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { PRIORITY_LABEL, TASK_STATUS_LABEL, cn, formatDate } from "@/lib/utils";

const PRIORITY_COLOR: Record<string, string> = {
  urgent: "text-red-500",
  high: "text-orange-500",
  medium: "text-sky-500",
  low: "text-slate-400",
};

const STATUS_VARIANT: Record<string, "default" | "brand" | "success"> = {
  todo: "default",
  doing: "brand",
  done: "success",
};

export function TaskCard({ task, onClick }: { task: Task; onClick?: () => void }) {
  const overdue =
    task.due_at && task.status !== "done" && new Date(task.due_at).getTime() < Date.now();

  return (
    <button
      onClick={onClick}
      className="group w-full rounded-xl border border-slate-200/80 bg-white p-3.5 text-left shadow-[0_1px_2px_rgba(16,24,40,0.03)] transition hover:border-indigo-200 hover:shadow-sm"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-1.5 text-[10px] text-slate-400">
          <Flag size={11} className={PRIORITY_COLOR[task.priority]} />
          {PRIORITY_LABEL[task.priority]}优先级
        </div>
        <Badge variant={STATUS_VARIANT[task.status]}>{TASK_STATUS_LABEL[task.status]}</Badge>
      </div>
      <p className="mt-2 text-[12.5px] font-medium leading-5 text-slate-800 group-hover:text-indigo-700">
        {task.title}
      </p>
      {task.description ? (
        <p className="mt-1 line-clamp-2 text-[10.5px] leading-4 text-slate-400">{task.description}</p>
      ) : null}
      <div className="mt-3 flex items-center justify-between">
        <span className={cn("flex items-center gap-1 text-[10px]", overdue ? "text-red-500" : "text-slate-400")}>
          <CalendarClock size={11} /> {formatDate(task.due_at)}
        </span>
        {task.assignee ? (
          <span className="flex items-center gap-1.5">
            <span className="text-[10px] text-slate-400">{task.assignee.name}</span>
            <Avatar name={task.assignee.name} size={22} />
          </span>
        ) : (
          <span className="text-[10px] text-slate-300">待分配</span>
        )}
      </div>
    </button>
  );
}
