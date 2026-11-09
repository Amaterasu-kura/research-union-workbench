"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Check, FileText, Sparkles, X } from "lucide-react";
import type { AgentAction, Message } from "@/lib/types";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { cn, formatDate } from "@/lib/utils";

export function MessageBubble({
  message,
  userName,
  actions,
  onConfirmAction,
  onRejectAction,
}: {
  message: Message;
  userName: string;
  actions?: AgentAction[];
  onConfirmAction?: (action: AgentAction) => void;
  onRejectAction?: (action: AgentAction) => void;
}) {
  const isUser = message.role === "user";
  const attachments = (message.attachments ?? []).filter((item) => item.file_id);

  return (
    <div className={cn("flex gap-3", isUser ? "flex-row-reverse" : "flex-row")}>
      {isUser ? (
        <Avatar name={userName} size={30} className="mt-0.5" />
      ) : (
        <div className="mt-0.5 flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 text-white">
          <Sparkles size={14} />
        </div>
      )}

      <div className={cn("min-w-0 max-w-[78%]", isUser ? "items-end" : "items-start")}>
        <div
          className={cn(
            "rounded-2xl px-4 py-3 text-[13px] shadow-[0_1px_2px_rgba(16,24,40,0.04)]",
            isUser
              ? "rounded-tr-md bg-indigo-600 text-white"
              : "rounded-tl-md border border-slate-200/80 bg-white text-slate-800",
          )}
        >
          {attachments.length > 0 ? (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {attachments.map((item) => (
                <span
                  key={item.file_id}
                  className={cn(
                    "inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px]",
                    isUser ? "bg-white/15 text-white" : "bg-slate-100 text-slate-600",
                  )}
                >
                  <FileText size={12} /> 附件
                </span>
              ))}
            </div>
          ) : null}

          {isUser ? (
            <p className="whitespace-pre-wrap leading-6">{message.content}</p>
          ) : (
            <div className="prose-chat">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
            </div>
          )}
        </div>

        {actions && actions.length > 0 ? (
          <div className="mt-2 space-y-2">
            {actions.map((action) => (
              <div
                key={action.id}
                className="rounded-xl border border-indigo-100 bg-indigo-50/50 p-3.5"
              >
                <p className="text-[11px] font-medium text-indigo-700">待确认操作 · 创建活动项目</p>
                <p className="mt-1 text-[13px] font-semibold text-slate-800">
                  {String(action.payload.name ?? "未命名项目")}
                </p>
                <p className="mt-0.5 text-[11px] leading-5 text-slate-500">
                  {String(action.payload.year ?? "")} 年 · {String(action.payload.series_name ?? "未指定活动系列")}
                  {action.payload.description ? ` · ${String(action.payload.description)}` : ""}
                </p>
                <div className="mt-2.5 flex gap-2">
                  <Button size="sm" onClick={() => onConfirmAction?.(action)}>
                    <Check size={13} /> 确认创建
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => onRejectAction?.(action)}>
                    <X size={13} /> 暂不创建
                  </Button>
                </div>
              </div>
            ))}
          </div>
        ) : null}

        <p
          className={cn(
            "mt-1.5 text-[10px] text-slate-400",
            isUser ? "text-right" : "text-left",
          )}
        >
          {formatDate(message.created_at, { withTime: true })}
          {message.role === "assistant" ? " · AI 生成" : ""}
        </p>
      </div>
    </div>
  );
}
