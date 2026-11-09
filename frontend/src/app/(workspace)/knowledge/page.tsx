"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BookOpen, FileText, Plus, Search, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import type { KnowledgeItem, SearchHit } from "@/lib/types";
import { useAuth } from "@/components/auth-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState, Skeleton } from "@/components/ui/empty";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import {
  KNOWLEDGE_STATUS_LABEL,
  KNOWLEDGE_TYPE_LABEL,
  formatDate,
} from "@/lib/utils";

function KnowledgeContent() {
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [query, setQuery] = useState(searchParams.get("q") ?? "");
  const [projectId, setProjectId] = useState(searchParams.get("project") ?? "");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ title: "", content: "", type: "experience" });

  const projectsQuery = useQuery({ queryKey: ["projects"], queryFn: api.projects.list });
  const knowledgeQuery = useQuery({
    queryKey: ["knowledge", projectId],
    queryFn: () => api.knowledge.list({ projectId: projectId || undefined }),
  });
  const searchQuery = useQuery({
    queryKey: ["knowledge-search", projectId, query],
    queryFn: () => api.knowledge.search(query, projectId || undefined, 12),
    enabled: query.trim().length > 0,
  });

  const canConfirm = Boolean(user?.roles.some((role) => ["chair", "lead"].includes(role.code)));

  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      await api.knowledge.create({
        title: form.title,
        content: form.content,
        knowledge_type: form.type,
        project_id: projectId || undefined,
      });
      toast.success("知识条目已创建");
      setOpen(false);
      setForm({ title: "", content: "", type: "experience" });
      await queryClient.invalidateQueries({ queryKey: ["knowledge"] });
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "创建失败");
    }
  };

  const results: SearchHit[] = searchQuery.data ?? [];

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[1240px] px-5 py-6 lg:px-8">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wider text-slate-400">Knowledge</p>
            <h2 className="mt-1 text-[22px] font-semibold tracking-tight text-slate-900">知识库</h2>
            <p className="mt-1 text-[12px] text-slate-500">
              历史资料、执行经验与活动决策，跨部门共享、可持续积累。
            </p>
          </div>
          <Button onClick={() => setOpen(true)}>
            <Plus size={15} /> 新增知识
          </Button>
        </div>

        <div className="mt-5 rounded-2xl border border-slate-200/80 bg-white p-4">
          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="relative flex-1">
              <Search size={16} className="absolute left-3 top-3 text-slate-400" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="用自然语言提问，例如「往届宣传节奏是怎么安排的？」"
                className="h-10 pl-9"
              />
            </div>
            <Select value={projectId} onChange={(event) => setProjectId(event.target.value)} className="h-10 sm:w-52">
              <option value="">全部项目</option>
              {(projectsQuery.data ?? []).map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </Select>
          </div>
          <p className="mt-2 flex items-center gap-1.5 text-[10px] text-slate-400">
            <Sparkles size={11} /> 检索会同时匹配结构化知识与文件分块，并保留来源与页码。
          </p>
        </div>

        {query.trim() ? (
          <div className="mt-4">
            <p className="mb-2 text-[11px] text-slate-400">
              {searchQuery.isLoading ? "检索中…" : `找到 ${results.length} 条结果`}
            </p>
            <div className="space-y-2">
              {results.map((hit) => (
                <div key={`${hit.kind}-${hit.id}`} className="rounded-xl border border-slate-200 bg-white p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-[12.5px] font-medium text-slate-800">{hit.title}</p>
                    <div className="flex items-center gap-1.5">
                      <Badge variant={hit.kind === "knowledge" ? "brand" : "outline"}>
                        {hit.kind === "knowledge" ? "知识条目" : hit.page_no ? `文件 · 第 ${hit.page_no} 页` : "文件 · 文档"}
                      </Badge>
                      <span className="text-[10px] text-slate-400">相关度 {hit.score.toFixed(2)}</span>
                    </div>
                  </div>
                  <p className="mt-1.5 whitespace-pre-wrap text-[11px] leading-5 text-slate-500">
                    {hit.content}
                  </p>
                </div>
              ))}
              {results.length === 0 && !searchQuery.isLoading ? (
                <EmptyState
                  icon={FileText}
                  title="没有检索到相关内容"
                  description="换一种说法，或先上传往届资料 / 新增知识条目。"
                />
              ) : null}
            </div>
          </div>
        ) : (
          <div className="mt-5">
            {knowledgeQuery.isLoading ? (
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {[0, 1, 2].map((index) => (
                  <Skeleton key={index} className="h-40 rounded-2xl" />
                ))}
              </div>
            ) : (knowledgeQuery.data ?? []).length === 0 ? (
              <EmptyState
                icon={BookOpen}
                title="知识库还是空的"
                description="上传往届资料，或从活动总结中提取经验，逐步形成组织的长期资产。"
                action={
                  <Button variant="outline" onClick={() => setOpen(true)}>
                    <Plus size={14} /> 新增第一条知识
                  </Button>
                }
              />
            ) : (
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {(knowledgeQuery.data ?? []).map((item) => (
                  <KnowledgeCard
                    key={item.id}
                    item={item}
                    canConfirm={canConfirm}
                    onChanged={() => queryClient.invalidateQueries({ queryKey: ["knowledge"] })}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title="新增知识条目">
        <form onSubmit={create} className="space-y-3.5">
          <div>
            <Label>标题</Label>
            <Input
              value={form.title}
              onChange={(event) => setForm({ ...form, title: event.target.value })}
              placeholder="例如：报告厅设备检查清单"
              required
            />
          </div>
          <div>
            <Label>类型</Label>
            <Select value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value })}>
              <option value="experience">执行经验</option>
              <option value="fact">已确认事实</option>
              <option value="advice">一般建议</option>
              <option value="inference">模型推测</option>
            </Select>
          </div>
          <div>
            <Label>内容</Label>
            <Textarea
              rows={6}
              value={form.content}
              onChange={(event) => setForm({ ...form, content: event.target.value })}
              placeholder="写下可复用的经验、注意事项或规则…"
              required
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button type="submit">保存</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

function KnowledgeCard({
  item,
  canConfirm,
  onChanged,
}: {
  item: KnowledgeItem;
  canConfirm: boolean;
  onChanged: () => void;
}) {
  return (
    <div className="flex flex-col rounded-2xl border border-slate-200/80 bg-white p-4">
      <div className="flex items-start justify-between gap-2">
        <Badge variant="outline">{KNOWLEDGE_TYPE_LABEL[item.knowledge_type]}</Badge>
        <Badge variant={item.status === "confirmed" ? "success" : "warning"}>
          {KNOWLEDGE_STATUS_LABEL[item.status]}
        </Badge>
      </div>
      <p className="mt-2.5 text-[13px] font-medium leading-5 text-slate-800">{item.title}</p>
      <p className="mt-1.5 line-clamp-4 text-[11px] leading-5 text-slate-500">{item.content}</p>
      <div className="mt-auto flex items-center justify-between pt-4">
        <span className="text-[10px] text-slate-400">{formatDate(item.created_at)}</span>
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
  );
}


export default function KnowledgePage() {
  return (
    <Suspense
      fallback={
        <div className="p-8">
          <Skeleton className="h-8 w-48" />
        </div>
      }
    >
      <KnowledgeContent />
    </Suspense>
  );
}
