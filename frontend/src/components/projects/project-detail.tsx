"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  BookOpen,
  CalendarDays,
  CheckCircle2,
  Download,
  FileText,
  FolderKanban,
  ListChecks,
  MessageSquareText,
  MoreHorizontal,
  Plus,
  Search,
  Trash2,
  Upload,
  UserPlus,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import type {
  FileItem,
  KnowledgeItem,
  ProjectMember,
  ProjectStatus,
  SearchHit,
  Task,
  TaskStatus,
} from "@/lib/types";
import { useAuth } from "@/components/auth-provider";
import { CreateTaskModal } from "@/components/tasks/create-task";
import { TaskCard } from "@/components/tasks/task-card";
import { TaskDetailModal } from "@/components/tasks/task-detail";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState, Skeleton } from "@/components/ui/empty";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import {
  KNOWLEDGE_STATUS_LABEL,
  KNOWLEDGE_TYPE_LABEL,
  STATUS_LABEL,
  TASK_STATUS_LABEL,
  fileSize,
  formatDate,
  relativeTime,
} from "@/lib/utils";

const TABS = [
  { key: "overview", label: "概览" },
  { key: "conversations", label: "对话" },
  { key: "tasks", label: "任务" },
  { key: "files", label: "文件" },
  { key: "members", label: "成员" },
  { key: "knowledge", label: "知识" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

const STATUS_VARIANT: Record<string, "brand" | "warning" | "default" | "outline"> = {
  preparing: "brand",
  running: "warning",
  ended: "default",
  archived: "outline",
};

const TASK_COLUMNS: { key: TaskStatus; label: string }[] = [
  { key: "todo", label: "待开始" },
  { key: "doing", label: "进行中" },
  { key: "done", label: "已完成" },
];

export function ProjectDetail() {
  const params = useParams<{ id: string }>();
  const projectId = params.id;
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const { user } = useAuth();

  const initialTab = (searchParams.get("tab") as TabKey) || "overview";
  const [tab, setTab] = useState<TabKey>(initialTab);
  const [taskModal, setTaskModal] = useState(false);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [memberModal, setMemberModal] = useState(false);
  const [memberToAdd, setMemberToAdd] = useState("");
  const [knowledgeModal, setKnowledgeModal] = useState(false);
  const [knowledgeForm, setKnowledgeForm] = useState({ title: "", content: "", type: "experience" });
  const [previewFile, setPreviewFile] = useState<FileItem | null>(null);
  const [query, setQuery] = useState("");
  const uploadRef = useRef<HTMLInputElement>(null);

  const projectQuery = useQuery({
    queryKey: ["project", projectId],
    queryFn: () => api.projects.get(projectId),
  });
  const project = projectQuery.data;

  const isManager = useMemo(() => {
    if (!user || !project) return false;
    if (user.roles.some((role) => role.code === "chair")) return true;
    if (project.lead?.id === user.id) return true;
    return Boolean(
      user.roles.some((role) => role.code === "lead") &&
        project.department_id &&
        user.departments.some((department) => department.id === project.department_id),
    );
  }, [user, project]);

  const isMember = useMemo(
    () => Boolean(project?.members.some((member) => member.user.id === user?.id && member.status === "active")),
    [project, user?.id],
  );
  const application = project?.members.find((member) => member.user.id === user?.id);
  const canSeeContent = isMember || isManager;

  const summaryQuery = useQuery({
    queryKey: ["project-summary", projectId],
    queryFn: () => api.projects.summary(projectId),
    enabled: canSeeContent,
  });
  const tasksQuery = useQuery({
    queryKey: ["tasks", "project", projectId],
    queryFn: () => api.tasks.list({ projectId }),
    enabled: canSeeContent,
  });
  const conversationsQuery = useQuery({
    queryKey: ["conversations", "project", projectId],
    queryFn: () => api.conversations.list("project", projectId),
    enabled: canSeeContent,
  });
  const filesQuery = useQuery({
    queryKey: ["files", "project", projectId],
    queryFn: () => api.files.list(projectId),
    enabled: canSeeContent,
    refetchInterval: (query) => {
      const data = query.state.data as FileItem[] | undefined;
      return data?.some((file) => file.status === "pending" || file.status === "parsing") ? 2500 : false;
    },
  });
  const knowledgeQuery = useQuery({
    queryKey: ["knowledge", "project", projectId],
    queryFn: () => api.knowledge.list({ projectId }),
    enabled: canSeeContent,
  });
  const usersQuery = useQuery({
    queryKey: ["users"],
    queryFn: api.users.list,
    enabled: isManager,
  });
  const searchQuery = useQuery({
    queryKey: ["knowledge-search", projectId, query],
    queryFn: () => api.knowledge.search(query, projectId),
    enabled: canSeeContent && tab === "knowledge" && query.trim().length > 0,
  });
  useEffect(() => {
    if (project && !canSeeContent && tab !== "overview") setTab("overview");
  }, [project, canSeeContent, tab]);

  const chunksQuery = useQuery({
    queryKey: ["file-chunks", previewFile?.id],
    queryFn: () => api.files.chunks(previewFile!.id),
    enabled: !!previewFile,
  });

  const refreshAll = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["project", projectId] }),
      queryClient.invalidateQueries({ queryKey: ["project-summary", projectId] }),
      queryClient.invalidateQueries({ queryKey: ["tasks", "project", projectId] }),
      queryClient.invalidateQueries({ queryKey: ["files", "project", projectId] }),
      queryClient.invalidateQueries({ queryKey: ["knowledge", "project", projectId] }),
      queryClient.invalidateQueries({ queryKey: ["conversations", "project", projectId] }),
    ]);
  };

  if (projectQuery.isLoading) {
    return (
      <div className="p-8">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="mt-4 h-24 w-full rounded-2xl" />
      </div>
    );
  }

  if (!project) {
    return (
      <EmptyState
        icon={FolderKanban}
        title="项目不存在或无权访问"
        description="请返回项目列表，或联系项目负责人。"
        action={
          <Link href="/projects">
            <Button variant="outline">返回项目列表</Button>
          </Link>
        }
      />
    );
  }

  const tasks = tasksQuery.data ?? [];
  const members = project.members;
  const activeMembers = members.filter((member) => member.status === "active");
  const appliedMembers = members.filter((member) => member.status === "applied");
  const taskStats = summaryQuery.data?.tasks;
  const progress = taskStats && taskStats.total > 0 ? Math.round((taskStats.done / taskStats.total) * 100) : 0;

  const updateStatus = async (status: ProjectStatus) => {
    try {
      await api.projects.update(projectId, { status });
      toast.success("项目状态已更新");
      await refreshAll();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "更新失败");
    }
  };

  const apply = async () => {
    try {
      await api.projects.apply(projectId);
      toast.success("申请已提交，等待负责人确认");
      await refreshAll();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "申请失败");
    }
  };

  const addMember = async () => {
    if (!memberToAdd) return;
    try {
      await api.projects.addMember(projectId, memberToAdd);
      toast.success("成员已加入");
      setMemberModal(false);
      setMemberToAdd("");
      await refreshAll();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "添加失败");
    }
  };

  const reviewMember = async (member: ProjectMember, status: "active" | "rejected") => {
    try {
      await api.projects.reviewMember(projectId, member.id, status);
      toast.success(status === "active" ? "已通过申请" : "已拒绝申请");
      await refreshAll();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "操作失败");
    }
  };

  const uploadFile = async (file: File) => {
    try {
      await api.files.upload(file, projectId);
      toast.success("文件已上传，正在解析");
      await queryClient.invalidateQueries({ queryKey: ["files", "project", projectId] });
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "上传失败");
    }
  };

  const createKnowledge = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      await api.knowledge.create({
        title: knowledgeForm.title,
        content: knowledgeForm.content,
        knowledge_type: knowledgeForm.type,
        project_id: projectId,
      });
      toast.success("知识条目已创建");
      setKnowledgeModal(false);
      setKnowledgeForm({ title: "", content: "", type: "experience" });
      await queryClient.invalidateQueries({ queryKey: ["knowledge", "project", projectId] });
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "创建失败");
    }
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[1240px] px-5 py-5 lg:px-8">
        <Link href="/projects" className="mb-4 inline-flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-700">
          <ArrowLeft size={12} /> 返回项目列表
        </Link>

        <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-[0_1px_2px_rgba(16,24,40,0.03)] lg:p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2 text-[10px] text-slate-400">
                <span className="flex items-center gap-1">
                  <CalendarDays size={11} /> {project.year} 年
                </span>
                {project.series ? <span>· {project.series.name}</span> : null}
                <Badge variant={STATUS_VARIANT[project.status] ?? "default"}>{STATUS_LABEL[project.status]}</Badge>
              </div>
              <h2 className="mt-2 text-[24px] font-semibold tracking-tight text-slate-900">{project.name}</h2>
              <p className="mt-1 max-w-2xl text-[12px] leading-6 text-slate-500">
                {project.description ?? "还没有项目说明。"}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {isManager ? (
                <Select
                  value={project.status}
                  onChange={(event) => void updateStatus(event.target.value as ProjectStatus)}
                  className="w-28"
                >
                  <option value="preparing">筹备中</option>
                  <option value="running">执行中</option>
                  <option value="ended">已结束</option>
                  <option value="archived">已归档</option>
                </Select>
              ) : null}
              {!isMember && !isManager ? (
                application?.status === "applied" ? (
                  <Badge variant="warning">申请审核中</Badge>
                ) : (
                  <Button size="sm" variant="outline" onClick={() => void apply()}>
                    <UserPlus size={13} /> 申请加入
                  </Button>
                )
              ) : null}
              <Link href={`/chat?project=${projectId}`}>
                <Button size="sm">
                  <MessageSquareText size={13} /> 项目对话
                </Button>
              </Link>
            </div>
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-slate-100 pt-4 text-[11px] text-slate-500">
            <span className="flex items-center gap-2">
              <Avatar name={project.lead?.name ?? "未指定"} size={22} />
              负责人 <span className="font-medium text-slate-700">{project.lead?.name ?? "未指定"}</span>
            </span>
            <span className="flex items-center gap-1">
              <Users size={12} /> {activeMembers.length} 位成员
            </span>
            <span className="flex items-center gap-1">
              <ListChecks size={12} /> {taskStats?.done ?? 0}/{taskStats?.total ?? 0} 项任务完成
            </span>
            <div className="ml-auto flex items-center gap-2">
              <div className="h-1.5 w-32 overflow-hidden rounded-full bg-slate-100">
                <div className="h-full rounded-full bg-indigo-500" style={{ width: `${progress}%` }} />
              </div>
              <span>{progress}%</span>
            </div>
          </div>
        </div>

        {!canSeeContent ? (
          <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-indigo-100 bg-indigo-50/50 px-4 py-3">
            <p className="flex-1 text-[11px] leading-5 text-indigo-800">
              你还没有加入该项目。加入后可以查看项目对话、任务、文件与成员协作内容。
            </p>
            {application?.status === "applied" ? (
              <Badge variant="warning">申请审核中</Badge>
            ) : (
              <Button size="sm" onClick={() => void apply()}>
                <UserPlus size={13} /> 申请加入
              </Button>
            )}
          </div>
        ) : null}

        <div className="mt-5 flex gap-1 overflow-x-auto border-b border-slate-200">
          {TABS.filter((item) => canSeeContent || item.key === "overview").map((item) => (
            <button
              key={item.key}
              onClick={() => {
                setTab(item.key);
                router.replace(`/projects/${projectId}?tab=${item.key}`);
              }}
              className={`shrink-0 border-b-2 px-4 py-2.5 text-[12px] font-medium transition ${
                tab === item.key
                  ? "border-indigo-500 text-indigo-700"
                  : "border-transparent text-slate-500 hover:text-slate-800"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        {tab === "overview" ? (
          <div className="mt-5 grid gap-4 lg:grid-cols-3">
            <div className="space-y-4 lg:col-span-2">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[
                  { label: "成员", value: summaryQuery.data?.members ?? 0, icon: Users },
                  { label: "对话", value: summaryQuery.data?.conversations ?? 0, icon: MessageSquareText },
                  { label: "文件", value: summaryQuery.data?.files ?? 0, icon: FileText },
                  { label: "知识", value: summaryQuery.data?.knowledge ?? 0, icon: BookOpen },
                ].map((item) => (
                  <div key={item.label} className="rounded-xl border border-slate-200/80 bg-white p-3.5">
                    <item.icon size={15} className="text-indigo-500" />
                    <p className="mt-2 text-[20px] font-semibold text-slate-900">{item.value}</p>
                    <p className="text-[10px] text-slate-400">{item.label}</p>
                  </div>
                ))}
              </div>

              <div className="rounded-2xl border border-slate-200/80 bg-white p-5">
                <div className="flex items-center justify-between">
                  <p className="text-[13px] font-semibold text-slate-800">近期任务</p>
                  <button onClick={() => setTab("tasks")} className="text-[10px] text-indigo-600 hover:underline">
                    查看全部
                  </button>
                </div>
                <div className="mt-3 space-y-2">
                  {tasks.slice(0, 4).map((task) => (
                    <button
                      key={task.id}
                      onClick={() => setSelectedTask(task)}
                      className="flex w-full items-center gap-3 rounded-lg border border-slate-100 px-3 py-2.5 text-left transition hover:bg-slate-50"
                    >
                      <CheckCircle2
                        size={15}
                        className={task.status === "done" ? "text-emerald-500" : "text-slate-300"}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[11.5px] font-medium text-slate-700">
                          {task.title}
                        </span>
                        <span className="text-[10px] text-slate-400">
                          {TASK_STATUS_LABEL[task.status]} · {formatDate(task.due_at)}
                        </span>
                      </span>
                      {task.assignee ? <Avatar name={task.assignee.name} size={22} /> : null}
                    </button>
                  ))}
                  {tasks.length === 0 ? (
                    <p className="py-6 text-center text-[11px] text-slate-400">还没有任务</p>
                  ) : null}
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <div className="rounded-2xl border border-slate-200/80 bg-white p-5">
                <p className="text-[13px] font-semibold text-slate-800">项目成员</p>
                <div className="mt-3 space-y-2">
                  {activeMembers.slice(0, 6).map((member) => (
                    <div key={member.id} className="flex items-center gap-2.5">
                      <Avatar name={member.user.name} size={28} />
                      <div className="min-w-0">
                        <p className="truncate text-[11px] font-medium text-slate-700">{member.user.name}</p>
                        <p className="truncate text-[10px] text-slate-400">
                          {member.user.departments[0]?.name ?? "未分配部门"}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200/80 bg-white p-5">
                <p className="text-[13px] font-semibold text-slate-800">最近文件</p>
                <div className="mt-3 space-y-2">
                  {(filesQuery.data ?? []).slice(0, 4).map((file) => (
                    <div key={file.id} className="flex items-center gap-2">
                      <FileText size={13} className="shrink-0 text-slate-400" />
                      <span className="min-w-0 flex-1 truncate text-[11px] text-slate-600">{file.original_name}</span>
                      <span className="text-[9px] text-slate-400">{fileSize(file.size_bytes)}</span>
                    </div>
                  ))}
                  {(filesQuery.data ?? []).length === 0 ? (
                    <p className="py-4 text-center text-[11px] text-slate-400">还没有文件</p>
                  ) : null}
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {tab === "conversations" ? (
          <div className="mt-5">
            <div className="flex items-center justify-between">
              <p className="text-[12px] text-slate-500">项目成员共享所有对话与项目上下文。</p>
              <Button
                size="sm"
                onClick={async () => {
                  const conversation = await api.conversations.create({
                    scope: "project",
                    project_id: projectId,
                    title: "新主题对话",
                  });
                  await queryClient.invalidateQueries({ queryKey: ["conversations", "project", projectId] });
                  router.push(`/chat?project=${projectId}&conversation=${conversation.id}`);
                }}
              >
                <Plus size={13} /> 新建对话
              </Button>
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {(conversationsQuery.data ?? []).map((conversation) => (
                <Link
                  key={conversation.id}
                  href={`/chat?project=${projectId}&conversation=${conversation.id}`}
                  className="rounded-xl border border-slate-200 bg-white p-4 transition hover:border-indigo-200 hover:shadow-sm"
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-[12px] font-medium text-slate-800">{conversation.title}</p>
                    {conversation.is_default ? <Badge variant="brand">主对话</Badge> : null}
                  </div>
                  <p className="mt-2 text-[10px] text-slate-400">
                    {conversation.creator?.name ?? "未知"} · {relativeTime(conversation.updated_at)}
                  </p>
                </Link>
              ))}
            </div>
          </div>
        ) : null}

        {tab === "tasks" ? (
          <div className="mt-5">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-[12px] text-slate-500">按优先级与截止时间排序，点击卡片查看详情。</p>
              {isManager ? (
                <Button size="sm" onClick={() => setTaskModal(true)}>
                  <Plus size={13} /> 新建任务
                </Button>
              ) : null}
            </div>
            <div className="grid gap-4 lg:grid-cols-3">
              {TASK_COLUMNS.map((column) => {
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
                      {columnTasks.map((task) => (
                        <TaskCard key={task.id} task={task} onClick={() => setSelectedTask(task)} />
                      ))}
                      {columnTasks.length === 0 ? (
                        <p className="py-8 text-center text-[10px] text-slate-400">暂无任务</p>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}

        {tab === "files" ? (
          <div className="mt-5">
            <div
              onClick={() => uploadRef.current?.click()}
              className="flex cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-8 transition hover:border-indigo-300 hover:bg-indigo-50/20"
            >
              <Upload size={20} className="text-slate-400" />
              <p className="mt-2 text-[12px] font-medium text-slate-700">点击上传 Word / PDF / 文本 / 图片</p>
              <p className="mt-1 text-[10px] text-slate-400">上传后自动解析、分块并建立检索索引</p>
              <input
                ref={uploadRef}
                type="file"
                className="hidden"
                accept=".pdf,.docx,.doc,.txt,.md,.png,.jpg,.jpeg,.webp"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void uploadFile(file);
                  event.target.value = "";
                }}
              />
            </div>

            <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200/80 bg-white">
              <div className="grid grid-cols-[1fr_90px_90px_110px_130px] gap-2 border-b border-slate-100 px-4 py-2.5 text-[10px] font-medium text-slate-400">
                <span>文件</span>
                <span>大小</span>
                <span>状态</span>
                <span>上传人</span>
                <span className="text-right">操作</span>
              </div>
              {(filesQuery.data ?? []).map((file) => (
                <div
                  key={file.id}
                  className="grid grid-cols-[1fr_90px_90px_110px_130px] items-center gap-2 border-b border-slate-50 px-4 py-3 text-[11px] last:border-0"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <FileText size={14} className="shrink-0 text-slate-400" />
                    <span className="truncate text-slate-700">{file.original_name}</span>
                  </div>
                  <span className="text-slate-400">{fileSize(file.size_bytes)}</span>
                  <span>
                    {file.status === "ready" ? (
                      <Badge variant="success">可检索</Badge>
                    ) : file.status === "failed" ? (
                      <Badge variant="danger">失败</Badge>
                    ) : (
                      <Badge variant="warning">解析中</Badge>
                    )}
                  </span>
                  <span className="text-slate-400">{members.find((m) => m.user.id === file.uploaded_by)?.user.name ?? "—"}</span>
                  <span className="flex items-center justify-end gap-1">
                    <a
                      href={api.files.downloadUrl(file.id)}
                      className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                      title="下载"
                    >
                      <Download size={13} />
                    </a>
                    <button
                      onClick={() => setPreviewFile(file)}
                      className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                      title="查看分块"
                    >
                      <Search size={13} />
                    </button>
                    {isManager || file.uploaded_by === user?.id ? (
                      <button
                        onClick={async () => {
                          if (!window.confirm("确定删除该文件？")) return;
                          await api.files.remove(file.id);
                          await queryClient.invalidateQueries({ queryKey: ["files", "project", projectId] });
                          toast.success("文件已删除");
                        }}
                        className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
                        title="删除"
                      >
                        <Trash2 size={13} />
                      </button>
                    ) : null}
                  </span>
                </div>
              ))}
              {(filesQuery.data ?? []).length === 0 ? (
                <p className="py-10 text-center text-[11px] text-slate-400">还没有上传文件</p>
              ) : null}
            </div>
          </div>
        ) : null}

        {tab === "members" ? (
          <div className="mt-5 grid gap-4 lg:grid-cols-2">
            <div className="rounded-2xl border border-slate-200/80 bg-white p-5">
              <div className="flex items-center justify-between">
                <p className="text-[13px] font-semibold text-slate-800">正式成员</p>
                {isManager ? (
                  <Button size="sm" variant="outline" onClick={() => setMemberModal(true)}>
                    <UserPlus size={13} /> 添加成员
                  </Button>
                ) : null}
              </div>
              <div className="mt-3 space-y-2.5">
                {activeMembers.map((member) => (
                  <div key={member.id} className="flex items-center gap-2.5">
                    <Avatar name={member.user.name} size={30} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[12px] font-medium text-slate-700">{member.user.name}</p>
                      <p className="text-[10px] text-slate-400">
                        {member.user.departments.map((department) => department.name).join(" / ") || "未分配部门"}
                      </p>
                    </div>
                    <Badge variant="success">已加入</Badge>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200/80 bg-white p-5">
              <p className="text-[13px] font-semibold text-slate-800">加入申请</p>
              <div className="mt-3 space-y-2.5">
                {appliedMembers.map((member) => (
                  <div key={member.id} className="flex items-center gap-2.5">
                    <Avatar name={member.user.name} size={30} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[12px] font-medium text-slate-700">{member.user.name}</p>
                      <p className="text-[10px] text-slate-400">{relativeTime(member.created_at)} 申请</p>
                    </div>
                    {isManager ? (
                      <div className="flex gap-1">
                        <Button size="sm" onClick={() => void reviewMember(member, "active")}>
                          通过
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => void reviewMember(member, "rejected")}>
                          拒绝
                        </Button>
                      </div>
                    ) : (
                      <Badge variant="warning">待审核</Badge>
                    )}
                  </div>
                ))}
                {appliedMembers.length === 0 ? (
                  <p className="py-6 text-center text-[11px] text-slate-400">暂无待审核申请</p>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}

        {tab === "knowledge" ? (
          <div className="mt-5">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative flex-1">
                <Search size={14} className="absolute left-2.5 top-2.5 text-slate-400" />
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="检索项目资料与经验，例如「宣传节奏」"
                  className="pl-8"
                />
              </div>
              <Button size="sm" onClick={() => setKnowledgeModal(true)}>
                <Plus size={13} /> 新增知识
              </Button>
            </div>

            {query.trim() ? (
              <div className="mt-3 space-y-2">
                {(searchQuery.data ?? []).map((hit) => (
                  <div key={`${hit.kind}-${hit.id}`} className="rounded-xl border border-slate-200 bg-white p-4">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[12px] font-medium text-slate-800">{hit.title}</p>
                      <Badge variant={hit.kind === "knowledge" ? "brand" : "outline"}>
                        {hit.kind === "knowledge" ? "知识条目" : hit.page_no ? `文件 · 第 ${hit.page_no} 页` : "文件 · 文档"}
                      </Badge>
                    </div>
                    <p className="mt-1.5 line-clamp-3 text-[11px] leading-5 text-slate-500">{hit.content}</p>
                  </div>
                ))}
                {(searchQuery.data ?? []).length === 0 && !searchQuery.isLoading ? (
                  <p className="py-8 text-center text-[11px] text-slate-400">没有检索到相关内容</p>
                ) : null}
              </div>
            ) : (
              <div className="mt-3 space-y-2">
                {(knowledgeQuery.data ?? []).map((item) => (
                  <KnowledgeRow key={item.id} item={item} canConfirm={isManager} onChanged={() => queryClient.invalidateQueries({ queryKey: ["knowledge", "project", projectId] })} />
                ))}
                {(knowledgeQuery.data ?? []).length === 0 ? (
                  <p className="py-8 text-center text-[11px] text-slate-400">还没有沉淀项目知识</p>
                ) : null}
              </div>
            )}
          </div>
        ) : null}
      </div>

      <CreateTaskModal
        open={taskModal}
        onClose={() => setTaskModal(false)}
        projectId={projectId}
        members={members}
        onCreated={async () => {
          await queryClient.invalidateQueries({ queryKey: ["tasks", "project", projectId] });
        }}
      />
      <TaskDetailModal
        task={selectedTask}
        allTasks={tasks}
        members={members}
        currentUser={user}
        canManage={isManager}
        onClose={() => setSelectedTask(null)}
        onChanged={() => {
          void queryClient.invalidateQueries({ queryKey: ["tasks", "project", projectId] });
          if (selectedTask) {
            void api.tasks
              .list({ projectId })
              .then((items) => setSelectedTask(items.find((item) => item.id === selectedTask.id) ?? null));
          }
        }}
      />

      <Modal open={memberModal} onClose={() => setMemberModal(false)} title="添加项目成员">
        <div className="space-y-3">
          <Label>选择成员</Label>
          <Select value={memberToAdd} onChange={(event) => setMemberToAdd(event.target.value)}>
            <option value="">请选择</option>
            {(usersQuery.data ?? [])
              .filter((candidate) => !activeMembers.some((member) => member.user.id === candidate.id))
              .map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.name} · {candidate.departments[0]?.name ?? ""}
                </option>
              ))}
          </Select>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setMemberModal(false)}>
              取消
            </Button>
            <Button onClick={() => void addMember()} disabled={!memberToAdd}>
              添加
            </Button>
          </div>
        </div>
      </Modal>

      <Modal open={knowledgeModal} onClose={() => setKnowledgeModal(false)} title="新增项目知识">
        <form onSubmit={createKnowledge} className="space-y-3.5">
          <div>
            <Label>标题</Label>
            <Input
              value={knowledgeForm.title}
              onChange={(event) => setKnowledgeForm({ ...knowledgeForm, title: event.target.value })}
              placeholder="例如：报告厅设备检查清单"
              required
            />
          </div>
          <div>
            <Label>知识类型</Label>
            <Select
              value={knowledgeForm.type}
              onChange={(event) => setKnowledgeForm({ ...knowledgeForm, type: event.target.value })}
            >
              <option value="experience">执行经验</option>
              <option value="fact">已确认事实</option>
              <option value="advice">一般建议</option>
              <option value="inference">模型推测</option>
            </Select>
          </div>
          <div>
            <Label>内容</Label>
            <Textarea
              rows={5}
              value={knowledgeForm.content}
              onChange={(event) => setKnowledgeForm({ ...knowledgeForm, content: event.target.value })}
              placeholder="写下可复用的经验、注意事项或规则…"
              required
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setKnowledgeModal(false)}>
              取消
            </Button>
            <Button type="submit">保存</Button>
          </div>
        </form>
      </Modal>

      <Modal
        open={!!previewFile}
        onClose={() => setPreviewFile(null)}
        title={previewFile?.original_name ?? "文件分块"}
        description="检索时按这些分块召回，并保留页码与标题路径。"
        width="max-w-2xl"
      >
        <div className="space-y-2">
          {chunksQuery.isLoading ? <Skeleton className="h-24" /> : null}
          {(chunksQuery.data ?? []).map((chunk) => (
            <div key={chunk.id} className="rounded-lg border border-slate-100 bg-slate-50/50 p-3">
              <p className="text-[10px] text-slate-400">
                #{chunk.index} · {chunk.heading_path ?? "无标题"} · 第 {chunk.page_no ?? "-"} 页
              </p>
              <p className="mt-1 whitespace-pre-wrap text-[11px] leading-5 text-slate-600">{chunk.content}</p>
            </div>
          ))}
          {(chunksQuery.data ?? []).length === 0 && !chunksQuery.isLoading ? (
            <p className="py-6 text-center text-[11px] text-slate-400">暂无分块，可能仍在解析</p>
          ) : null}
        </div>
      </Modal>
    </div>
  );
}

function KnowledgeRow({
  item,
  canConfirm,
  onChanged,
}: {
  item: KnowledgeItem;
  canConfirm: boolean;
  onChanged: () => void;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[12px] font-medium text-slate-800">{item.title}</p>
        <div className="flex items-center gap-1.5">
          <Badge variant="outline">{KNOWLEDGE_TYPE_LABEL[item.knowledge_type]}</Badge>
          <Badge variant={item.status === "confirmed" ? "success" : "warning"}>
            {KNOWLEDGE_STATUS_LABEL[item.status]}
          </Badge>
          {canConfirm && item.status === "proposed" ? (
            <Button
              size="sm"
              variant="soft"
              onClick={async () => {
                await api.knowledge.update(item.id, { status: "confirmed" });
                toast.success("知识已确认");
                onChanged();
              }}
            >
              确认
            </Button>
          ) : null}
        </div>
      </div>
      <p className="mt-1.5 text-[11px] leading-5 text-slate-500">{item.content}</p>
    </div>
  );
}
