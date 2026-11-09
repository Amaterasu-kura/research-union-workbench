"use client";

import { useState } from "react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import type { ProjectMember, Task } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";

export function CreateTaskModal({
  open,
  onClose,
  projectId,
  members,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  projectId: string;
  members: ProjectMember[];
  onCreated: (task: Task) => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState("medium");
  const [dueAt, setDueAt] = useState("");
  const [assigneeId, setAssigneeId] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      const task = await api.tasks.create({
        project_id: projectId,
        title,
        description: description || undefined,
        priority,
        due_at: dueAt ? new Date(dueAt).toISOString() : undefined,
        assignee_id: assigneeId || undefined,
      });
      toast.success("任务已创建");
      setTitle("");
      setDescription("");
      setDueAt("");
      setAssigneeId("");
      onCreated(task);
      onClose();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "创建失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="新建任务" description="任务默认由负责人确认后发布。">
      <form onSubmit={submit} className="space-y-3.5">
        <div>
          <Label htmlFor="task-title">任务标题</Label>
          <Input
            id="task-title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="例如：发布第一轮征稿通知"
            required
          />
        </div>
        <div>
          <Label htmlFor="task-desc">详细说明</Label>
          <Textarea
            id="task-desc"
            rows={3}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="交付标准、注意事项、关联资料…"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="task-priority">优先级</Label>
            <Select id="task-priority" value={priority} onChange={(event) => setPriority(event.target.value)}>
              <option value="urgent">紧急</option>
              <option value="high">高</option>
              <option value="medium">中</option>
              <option value="low">低</option>
            </Select>
          </div>
          <div>
            <Label htmlFor="task-due">截止时间</Label>
            <Input
              id="task-due"
              type="datetime-local"
              value={dueAt}
              onChange={(event) => setDueAt(event.target.value)}
            />
          </div>
        </div>
        <div>
          <Label htmlFor="task-assignee">负责人</Label>
          <Select id="task-assignee" value={assigneeId} onChange={(event) => setAssigneeId(event.target.value)}>
            <option value="">暂不分配</option>
            {members
              .filter((member) => member.status === "active")
              .map((member) => (
                <option key={member.user.id} value={member.user.id}>
                  {member.user.name} · {member.user.departments[0]?.name ?? ""}
                </option>
              ))}
          </Select>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? "创建中…" : "创建任务"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
