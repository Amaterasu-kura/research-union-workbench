"use client";

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeftRight, CalendarClock, Flag, History, UserRound } from "lucide-react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import type { ProjectMember, Task, User } from "@/lib/types";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import {
  PRIORITY_LABEL,
  TASK_STATUS_LABEL,
  formatDate,
  relativeTime,
} from "@/lib/utils";

const STATUSES: { value: Task["status"]; label: string }[] = [
  { value: "todo", label: "待开始" },
  { value: "doing", label: "进行中" },
  { value: "done", label: "已完成" },
];

const ACTION_LABEL: Record<string, string> = {
  created: "创建了任务",
  updated: "更新了",
  status_changed: "变更了状态",
  reassigned: "调整了负责人",
  exchanged: "交换了任务",
};

export function TaskDetailModal({
  task,
  allTasks,
  members,
  currentUser,
  canManage,
  onClose,
  onChanged,
}: {
  task: Task | null;
  allTasks: Task[];
  members: ProjectMember[];
  currentUser: User | null;
  canManage: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [exchangeTarget, setExchangeTarget] = useState("");
  const [exchangeMessage, setExchangeMessage] = useState("");

  const history = useQuery({
    queryKey: ["task-history", task?.id],
    queryFn: () => api.tasks.history(task!.id),
    enabled: !!task,
  });

  const otherTasks = useMemo(
    () =>
      allTasks.filter(
        (item) =>
          item.id !== task?.id &&
          item.current_assignee_id &&
          item.current_assignee_id !== currentUser?.id,
      ),
    [allTasks, task?.id, currentUser?.id],
  );

  if (!task) return null;
  const isAssignee = task.current_assignee_id === currentUser?.id;

  const update = async (body: Record<string, unknown>) => {
    setSaving(true);
    try {
      await api.tasks.update(task.id, body);
      await queryClient.invalidateQueries({ queryKey: ["task-history", task.id] });
      onChanged();
      toast.success("任务已更新");
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "更新失败");
    } finally {
      setSaving(false);
    }
  };

  const exchange = async () => {
    if (!exchangeTarget) return;
    setSaving(true);
    try {
      await api.tasks.createExchange(task.id, exchangeTarget, exchangeMessage || undefined);
      toast.success("交换申请已发送");
      setExchangeTarget("");
      setExchangeMessage("");
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "发起交换失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={!!task} onClose={onClose} title={task.title} description="任务详情与执行记录" width="max-w-xl">
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">
            <Flag size={11} /> {PRIORITY_LABEL[task.priority]}优先级
          </Badge>
          <Badge variant="brand">{TASK_STATUS_LABEL[task.status]}</Badge>
          <Badge variant="outline">
            <CalendarClock size={11} /> {formatDate(task.due_at)}
          </Badge>
          <Badge variant="outline">
            <UserRound size={11} /> {task.assignee?.name ?? "待分配"}
          </Badge>
        </div>

        {task.description ? (
          <p className="whitespace-pre-wrap rounded-xl bg-slate-50 px-4 py-3 text-[12px] leading-6 text-slate-600">
            {task.description}
          </p>
        ) : null}

        <div>
          <p className="mb-2 text-[11px] font-medium text-slate-500">更新状态</p>
          <div className="flex gap-2">
            {STATUSES.map((status) => (
              <Button
                key={status.value}
                size="sm"
                variant={task.status === status.value ? "primary" : "outline"}
                disabled={saving || (!canManage && !isAssignee)}
                onClick={() => void update({ status: status.value })}
              >
                {status.label}
              </Button>
            ))}
          </div>
        </div>

        {canManage ? (
          <div>
            <p className="mb-2 text-[11px] font-medium text-slate-500">负责人</p>
            <Select
              value={task.current_assignee_id ?? ""}
              onChange={(event) => void update({ assignee_id: event.target.value || null })}
              disabled={saving}
            >
              <option value="">待分配</option>
              {members
                .filter((member) => member.status === "active")
                .map((member) => (
                  <option key={member.user.id} value={member.user.id}>
                    {member.user.name} · {member.user.departments[0]?.name ?? ""}
                  </option>
                ))}
            </Select>
          </div>
        ) : null}

        {isAssignee && otherTasks.length > 0 ? (
          <div className="rounded-xl border border-indigo-100 bg-indigo-50/40 p-4">
            <p className="flex items-center gap-1.5 text-[11px] font-medium text-indigo-700">
              <ArrowLeftRight size={13} /> 发起任务交换
            </p>
            <p className="mt-1 text-[10px] leading-4 text-slate-500">
              选择同一项目内另一位成员的任务，对方接受后系统会交换双方负责人，并记录历史。
            </p>
            <div className="mt-2.5 space-y-2">
              <Select
                value={exchangeTarget}
                onChange={(event) => setExchangeTarget(event.target.value)}
              >
                <option value="">选择要交换的任务</option>
                {otherTasks.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.title} · {item.assignee?.name ?? "未知"}
                  </option>
                ))}
              </Select>
              <input
                value={exchangeMessage}
                onChange={(event) => setExchangeMessage(event.target.value)}
                placeholder="给对方留一句话（可选）"
                className="h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-xs focus:border-indigo-400 focus:outline-none"
              />
              <Button size="sm" disabled={!exchangeTarget || saving} onClick={() => void exchange()}>
                发送交换申请
              </Button>
            </div>
          </div>
        ) : null}

        <div>
          <p className="mb-2 flex items-center gap-1.5 text-[11px] font-medium text-slate-500">
            <History size={13} /> 历史记录
          </p>
          <div className="space-y-2">
            {(history.data ?? []).map((item) => (
              <div key={item.id} className="flex items-start gap-2 text-[10.5px] leading-4 text-slate-500">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-slate-300" />
                <div>
                  <p>
                    <span className="font-medium text-slate-700">
                      {ACTION_LABEL[item.action] ?? item.action}
                    </span>
                    {item.field ? ` · ${item.field}` : ""}
                    {item.new_value ? ` → ${item.new_value}` : ""}
                  </p>
                  <p className="text-[9.5px] text-slate-400">{relativeTime(item.created_at)}</p>
                </div>
              </div>
            ))}
            {(history.data ?? []).length === 0 ? (
              <p className="text-[11px] text-slate-400">暂无记录</p>
            ) : null}
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-slate-100 pt-3">
          <div className="flex items-center gap-2">
            <Avatar name={task.assignee?.name ?? "待分配"} size={24} />
            <span className="text-[10px] text-slate-400">
              创建于 {formatDate(task.created_at, { withTime: true })}
            </span>
          </div>
          <Button variant="outline" size="sm" onClick={onClose}>
            关闭
          </Button>
        </div>
      </div>
    </Modal>
  );
}
