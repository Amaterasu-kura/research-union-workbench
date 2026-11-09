"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowUpRight, CalendarDays, FolderKanban, Plus, Search, Users } from "lucide-react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import type { AgentAction, ProjectStatus } from "@/lib/types";
import { useAuth } from "@/components/auth-provider";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState, Skeleton } from "@/components/ui/empty";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { STATUS_LABEL } from "@/lib/utils";

const FILTERS: { key: "all" | ProjectStatus; label: string }[] = [
  { key: "all", label: "全部" },
  { key: "preparing", label: "筹备中" },
  { key: "running", label: "执行中" },
  { key: "ended", label: "已结束" },
  { key: "archived", label: "已归档" },
];

const STATUS_VARIANT: Record<string, "brand" | "warning" | "default" | "outline"> = {
  preparing: "brand",
  running: "warning",
  ended: "default",
  archived: "outline",
};

export default function ProjectsPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [filter, setFilter] = useState<"all" | ProjectStatus>("all");
  const [keyword, setKeyword] = useState("");
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"create" | "request">("create");
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: "",
    year: new Date().getFullYear(),
    series_name: "",
    description: "",
    start_date: "",
    end_date: "",
  });

  const { data: projects = [], isLoading } = useQuery({
    queryKey: ["projects"],
    queryFn: api.projects.list,
  });

  const isManager = Boolean(user?.roles.some((role) => ["chair", "lead"].includes(role.code)));
  const actionsQuery = useQuery({
    queryKey: ["agent-actions", "proposed"],
    queryFn: () => api.agent.actions("proposed"),
    enabled: isManager,
  });
  const pendingRequests = actionsQuery.data ?? [];

  const openModal = (nextMode: "create" | "request") => {
    setMode(nextMode);
    setOpen(true);
  };

  const confirmRequest = async (action: AgentAction) => {
    try {
      const result = await api.agent.confirm(action.id);
      toast.success(`已创建「${result.project.name}」`);
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
      await queryClient.invalidateQueries({ queryKey: ["agent-actions"] });
      router.push(`/projects/${result.project.id}`);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "确认失败");
    }
  };

  const rejectRequest = async (action: AgentAction) => {
    try {
      await api.agent.reject(action.id);
      toast.success("已忽略该申请");
      await queryClient.invalidateQueries({ queryKey: ["agent-actions"] });
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "操作失败");
    }
  };

  const filtered = useMemo(() => {
    return projects.filter((project) => {
      if (filter !== "all" && project.status !== filter) return false;
      if (keyword && !`${project.name}${project.series?.name ?? ""}`.toLowerCase().includes(keyword.toLowerCase()))
        return false;
      return true;
    });
  }, [projects, filter, keyword]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      const body = {
        name: form.name,
        year: Number(form.year),
        series_name: form.series_name || undefined,
        description: form.description || undefined,
        start_date: form.start_date || undefined,
        end_date: form.end_date || undefined,
      };
      if (isManager) {
        const project = await api.projects.create(body);
        toast.success("项目已创建");
        await queryClient.invalidateQueries({ queryKey: ["projects"] });
        setOpen(false);
        setForm({ name: "", year: new Date().getFullYear(), series_name: "", description: "", start_date: "", end_date: "" });
        router.push(`/projects/${project.id}`);
      } else {
        await api.projects.requestCreate(body);
        toast.success("申请已提交，等待负责人或主席团确认");
        setOpen(false);
        setForm({ name: "", year: new Date().getFullYear(), series_name: "", description: "", start_date: "", end_date: "" });
      }
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "创建失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[1240px] px-5 py-6 lg:px-8">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wider text-slate-400">Projects</p>
            <h2 className="mt-1 text-[22px] font-semibold tracking-tight text-slate-900">活动项目</h2>
            <p className="mt-1 text-[12px] text-slate-500">
              每个项目集中关联成员、对话、文件、任务与历史经验。
            </p>
          </div>
          <Button onClick={() => openModal(isManager ? "create" : "request")}>
            <Plus size={15} /> {isManager ? "创建项目" : "申请创建项目"}
          </Button>
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white p-1">
            {FILTERS.map((item) => (
              <button
                key={item.key}
                onClick={() => setFilter(item.key)}
                className={`rounded-md px-3 py-1.5 text-[11px] font-medium transition ${
                  filter === item.key ? "bg-indigo-50 text-indigo-700" : "text-slate-500 hover:text-slate-800"
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
          <div className="relative ml-auto w-full sm:w-64">
            <Search size={14} className="absolute left-2.5 top-2.5 text-slate-400" />
            <Input
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              placeholder="搜索项目或活动系列"
              className="pl-8"
            />
          </div>
        </div>

        {isManager && pendingRequests.length > 0 ? (
          <div className="mt-5 space-y-2 rounded-2xl border border-amber-200 bg-amber-50/60 p-4">
            <p className="text-[12px] font-medium text-amber-900">待确认的项目创建申请</p>
            {pendingRequests.map((action) => (
              <div
                key={action.id}
                className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-200/70 bg-white px-4 py-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-[12px] font-medium text-slate-800">
                    {String(action.payload.name ?? "未命名项目")} · {String(action.payload.year ?? "")} 年
                  </p>
                  <p className="mt-0.5 text-[10px] text-slate-500">
                    {String(action.payload.requested_by_name ?? "成员")} 申请
                    {action.payload.series_name ? ` · ${String(action.payload.series_name)}` : ""}
                    {action.payload.description ? ` · ${String(action.payload.description)}` : ""}
                  </p>
                </div>
                <Button size="sm" onClick={() => void confirmRequest(action)}>
                  确认创建
                </Button>
                <Button size="sm" variant="outline" onClick={() => void rejectRequest(action)}>
                  忽略
                </Button>
              </div>
            ))}
          </div>
        ) : null}

        {isLoading ? (
          <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {[0, 1, 2, 3].map((index) => (
              <Skeleton key={index} className="h-52 rounded-2xl" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={FolderKanban}
            title="没有符合条件的项目"
            description="换一个筛选条件，或从 AI 对话中提出新的活动想法。"
            action={
              <Button variant="outline" onClick={() => openModal(isManager ? "create" : "request")}>
                <Plus size={14} /> {isManager ? "创建第一个项目" : "申请创建项目"}
              </Button>
            }
          />
        ) : (
          <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {filtered.map((project) => {
              const activeMembers = project.members.filter((member) => member.status === "active");
              return (
                <Link
                  key={project.id}
                  href={`/projects/${project.id}`}
                  className="group flex flex-col rounded-2xl border border-slate-200/80 bg-white p-5 shadow-[0_1px_2px_rgba(16,24,40,0.03)] transition hover:-translate-y-0.5 hover:border-indigo-200 hover:shadow-md"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 text-[10px] text-slate-400">
                      <CalendarDays size={12} />
                      {project.year} 年
                      {project.series ? <span className="truncate">· {project.series.name}</span> : null}
                    </div>
                    <Badge variant={STATUS_VARIANT[project.status] ?? "default"}>
                      {STATUS_LABEL[project.status]}
                    </Badge>
                  </div>
                  <h3 className="mt-3 text-[16px] font-semibold leading-6 text-slate-900 group-hover:text-indigo-700">
                    {project.name}
                  </h3>
                  <p className="mt-1.5 line-clamp-2 min-h-[38px] text-[11px] leading-5 text-slate-500">
                    {project.description ?? "还没有项目说明。"}
                  </p>

                  <div className="mt-auto pt-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        {project.lead ? <Avatar name={project.lead.name} size={24} /> : null}
                        <div>
                          <p className="text-[10px] text-slate-400">负责人</p>
                          <p className="text-[11px] font-medium text-slate-700">{project.lead?.name ?? "未指定"}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 text-[10px] text-slate-400">
                        <Users size={12} /> {activeMembers.length}
                      </div>
                    </div>
                    <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-3">
                      <div className="flex -space-x-1.5">
                        {activeMembers.slice(0, 5).map((member) => (
                          <Avatar
                            key={member.id}
                            name={member.user.name}
                            size={22}
                            className="ring-2 ring-white"
                          />
                        ))}
                      </div>
                      <span className="flex items-center gap-1 text-[10px] text-indigo-600">
                        查看项目 <ArrowUpRight size={12} />
                      </span>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={isManager ? "创建活动项目" : "申请创建活动项目"}
        description={
          isManager
            ? "项目创建后会自动生成「项目主对话」，负责人自动加入成员。"
            : "提交后由主席团或部门负责人确认；确认后会生成项目与主对话。"
        }
      >
        <form onSubmit={submit} className="space-y-3.5">
          <div>
            <Label htmlFor="name">项目名称</Label>
            <Input
              id="name"
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
              placeholder="例如：2027 年科技论文报告会"
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="year">年份</Label>
              <Input
                id="year"
                type="number"
                value={form.year}
                onChange={(event) => setForm({ ...form, year: Number(event.target.value) })}
                required
              />
            </div>
            <div>
              <Label htmlFor="series">活动系列（可选）</Label>
              <Input
                id="series"
                value={form.series_name}
                onChange={(event) => setForm({ ...form, series_name: event.target.value })}
                placeholder="科技论文报告会"
              />
            </div>
          </div>
          <div>
            <Label htmlFor="description">项目说明</Label>
            <Textarea
              id="description"
              rows={3}
              value={form.description}
              onChange={(event) => setForm({ ...form, description: event.target.value })}
              placeholder="一句话说明活动目标、对象与规模"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="start">开始日期</Label>
              <Input
                id="start"
                type="date"
                value={form.start_date}
                onChange={(event) => setForm({ ...form, start_date: event.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="end">结束日期</Label>
              <Input
                id="end"
                type="date"
                value={form.end_date}
                onChange={(event) => setForm({ ...form, end_date: event.target.value })}
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "提交中…" : isManager ? "创建项目" : "提交申请"}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
