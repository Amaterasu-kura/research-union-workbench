"use client";

import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, FileText, Search, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import type { FileItem } from "@/lib/types";
import { useAuth } from "@/components/auth-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState, Skeleton } from "@/components/ui/empty";
import { Select } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { fileSize, formatDate } from "@/lib/utils";

export default function FilesPage() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [projectId, setProjectId] = useState("");
  const [previewFile, setPreviewFile] = useState<FileItem | null>(null);
  const uploadRef = useRef<HTMLInputElement>(null);

  const projectsQuery = useQuery({ queryKey: ["projects"], queryFn: api.projects.list });
  const filesQuery = useQuery({
    queryKey: ["files", projectId || "mine"],
    queryFn: () => api.files.list(projectId || undefined),
    refetchInterval: (query) => {
      const data = query.state.data as FileItem[] | undefined;
      return data?.some((file) => file.status === "pending" || file.status === "parsing") ? 2500 : false;
    },
  });
  const chunksQuery = useQuery({
    queryKey: ["file-chunks", previewFile?.id],
    queryFn: () => api.files.chunks(previewFile!.id),
    enabled: !!previewFile,
  });

  const upload = async (file: File) => {
    try {
      await api.files.upload(file, projectId || undefined);
      toast.success("文件已上传，正在解析");
      await queryClient.invalidateQueries({ queryKey: ["files"] });
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "上传失败");
    }
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[1240px] px-5 py-6 lg:px-8">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wider text-slate-400">Files</p>
            <h2 className="mt-1 text-[22px] font-semibold tracking-tight text-slate-900">文件中心</h2>
            <p className="mt-1 text-[12px] text-slate-500">上传后自动解析文本、分块并建立检索索引。</p>
          </div>
          <div className="flex items-center gap-2">
            <Select value={projectId} onChange={(event) => setProjectId(event.target.value)} className="w-56">
              <option value="">我的全局文件</option>
              {(projectsQuery.data ?? []).map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </Select>
            <Button onClick={() => uploadRef.current?.click()}>
              <Upload size={14} /> 上传文件
            </Button>
            <input
              ref={uploadRef}
              type="file"
              className="hidden"
              accept=".pdf,.docx,.doc,.txt,.md,.png,.jpg,.jpeg,.webp"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void upload(file);
                event.target.value = "";
              }}
            />
          </div>
        </div>

        <div className="mt-4 rounded-xl border border-slate-200 bg-white px-4 py-3 text-[11px] text-slate-500">
          支持 Word / PDF / 文本 / 图片。原始资料与正式成果长期保留；临时过程文件默认 30 天后清理。
        </div>

        <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200/80 bg-white">
          <div className="grid grid-cols-[1fr_90px_90px_110px_130px] gap-2 border-b border-slate-100 px-4 py-2.5 text-[10px] font-medium text-slate-400">
            <span>文件名</span>
            <span>大小</span>
            <span>状态</span>
            <span>时间</span>
            <span className="text-right">操作</span>
          </div>

          {filesQuery.isLoading ? (
            <div className="p-4">
              <Skeleton className="h-10" />
            </div>
          ) : (filesQuery.data ?? []).length === 0 ? (
            <EmptyState
              icon={FileText}
              title="还没有文件"
              description="上传往届策划案或总结，AI 对话就能引用这些资料。"
              action={
                <Button variant="outline" onClick={() => uploadRef.current?.click()}>
                  <Upload size={14} /> 上传第一个文件
                </Button>
              }
            />
          ) : (
            (filesQuery.data ?? []).map((file) => (
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
                <span className="text-slate-400">{formatDate(file.created_at)}</span>
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
                  {file.uploaded_by === user?.id || user?.roles.some((role) => role.code === "chair") ? (
                    <button
                      onClick={async () => {
                        if (!window.confirm("确定删除该文件？")) return;
                        await api.files.remove(file.id);
                        await queryClient.invalidateQueries({ queryKey: ["files"] });
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
            ))
          )}
        </div>
      </div>

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
