"use client";

import { useRef, useState } from "react";
import { ArrowUp, Loader2, Paperclip, X } from "lucide-react";
import type { FileItem } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { fileSize } from "@/lib/utils";

export function Composer({
  disabled,
  sending,
  onSend,
  onUpload,
  projectId,
}: {
  disabled?: boolean;
  sending?: boolean;
  onSend: (content: string, fileIds: string[]) => Promise<void>;
  onUpload?: (file: File) => Promise<FileItem>;
  projectId?: string | null;
}) {
  const [value, setValue] = useState("");
  const [files, setFiles] = useState<FileItem[]>([]);
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const submit = async () => {
    const content = value.trim();
    if (!content || sending || disabled) return;
    setValue("");
    const ids = files.map((file) => file.id);
    setFiles([]);
    await onSend(content, ids);
  };

  return (
    <div className="border-t border-slate-200/80 bg-white/90 px-4 py-3 backdrop-blur lg:px-6">
      {files.length > 0 ? (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {files.map((file) => (
            <span
              key={file.id}
              className="inline-flex items-center gap-1.5 rounded-lg bg-slate-100 px-2 py-1 text-[11px] text-slate-600"
            >
              <Paperclip size={11} /> {file.original_name}
              <span className="text-slate-400">{fileSize(file.size_bytes)}</span>
              {file.status !== "ready" ? <span className="text-amber-600">解析中</span> : null}
              <button onClick={() => setFiles((items) => items.filter((item) => item.id !== file.id))}>
                <X size={11} className="text-slate-400 hover:text-slate-700" />
              </button>
            </span>
          ))}
        </div>
      ) : null}

      <div className="rounded-xl border border-slate-200 bg-white p-2 shadow-[0_1px_3px_rgba(16,24,40,0.05)] focus-within:border-indigo-300 focus-within:ring-2 focus-within:ring-indigo-500/10">
        <textarea
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void submit();
            }
          }}
          rows={2}
          placeholder={
            disabled
              ? "请先配置 LLM_API_KEY 后再开始对话"
              : "描述你的活动想法，或输入 / 查看可用工作流…"
          }
          className="max-h-40 min-h-[52px] w-full resize-none bg-transparent px-2 py-1 text-[13px] leading-6 text-slate-800 placeholder:text-slate-400 focus:outline-none"
          disabled={disabled}
        />
        <div className="flex items-center justify-between px-1 pb-1">
          <div className="flex items-center gap-1">
            <input
              ref={fileInput}
              type="file"
              className="hidden"
              accept=".pdf,.docx,.doc,.txt,.md,.png,.jpg,.jpeg,.webp"
              onChange={async (event) => {
                const file = event.target.files?.[0];
                if (!file || !onUpload) return;
                setUploading(true);
                try {
                  const uploaded = await onUpload(file);
                  setFiles((items) => [...items, uploaded]);
                } finally {
                  setUploading(false);
                  if (fileInput.current) fileInput.current.value = "";
                }
              }}
            />
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              disabled={uploading || disabled}
              className="flex h-7 items-center gap-1 rounded-md px-2 text-[11px] text-slate-500 hover:bg-slate-100 disabled:opacity-50"
            >
              {uploading ? <Loader2 size={13} className="animate-spin" /> : <Paperclip size={13} />}
              附件
            </button>
            <span className="hidden text-[10px] text-slate-400 sm:inline">
              {projectId ? "文件会关联到当前项目" : "全局对话附件仅自己可见"}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="hidden text-[10px] text-slate-400 sm:inline">Enter 发送 · Shift+Enter 换行</span>
            <Button
              size="icon"
              className="h-8 w-8 rounded-lg"
              onClick={() => void submit()}
              disabled={!value.trim() || sending || disabled}
            >
              {sending ? <Loader2 size={15} className="animate-spin" /> : <ArrowUp size={15} />}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
