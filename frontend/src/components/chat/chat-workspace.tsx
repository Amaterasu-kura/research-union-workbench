"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ChevronDown,
  FolderKanban,
  MessageSquarePlus,
  MoreHorizontal,
  Sparkles,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import type { AgentAction, Conversation, Message } from "@/lib/types";
import { useAuth } from "@/components/auth-provider";
import { Composer } from "@/components/chat/composer";
import { ContextPanel } from "@/components/chat/context-panel";
import { MessageBubble } from "@/components/chat/message-bubble";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/empty";
import { cn, relativeTime } from "@/lib/utils";

const GLOBAL_SUGGESTIONS = [
  "帮我策划一场 2027 年科技论文报告会",
  "研究生会活动从想法到落地，通常要经过哪些步骤？",
  "检索往届科技论文报告会的宣传经验",
];

const PROJECT_SUGGESTIONS = [
  "根据往届资料，帮我起草今年策划案的框架",
  "把这个活动拆分成可执行的任务",
  "总结一下我们讨论过的关键决定",
];

export function ChatWorkspace() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const { user } = useAuth();

  const projectId = searchParams.get("project");
  const initialConversation = searchParams.get("conversation");
  const scope = projectId ? "project" : "global";

  const [conversationId, setConversationId] = useState<string | null>(initialConversation);
  const [sending, setSending] = useState(false);
  const [pendingUser, setPendingUser] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [messageActions, setMessageActions] = useState<Record<string, AgentAction[]>>({});
  const [railOpen, setRailOpen] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const projectsQuery = useQuery({ queryKey: ["projects"], queryFn: api.projects.list });
  const project = useMemo(
    () => (projectsQuery.data ?? []).find((item) => item.id === projectId) ?? null,
    [projectsQuery.data, projectId],
  );

  const agentStatus = useQuery({ queryKey: ["agent-status"], queryFn: api.agent.status });

  const conversationsQuery = useQuery({
    queryKey: ["conversations", scope, projectId],
    queryFn: () => api.conversations.list(scope, projectId ?? undefined),
  });

  const conversations = conversationsQuery.data ?? [];

  useEffect(() => {
    setConversationId(initialConversation);
  }, [initialConversation, projectId]);

  useEffect(() => {
    if (!conversationId && conversations.length > 0) {
      setConversationId(conversations[0].id);
    }
  }, [conversationId, conversations]);

  const messagesQuery = useQuery({
    queryKey: ["messages", conversationId],
    queryFn: () => api.conversations.messages(conversationId!),
    enabled: !!conversationId,
  });
  const messages = messagesQuery.data ?? [];

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, pendingUser, sending]);

  const ensureConversation = async (firstMessage: string) => {
    const conversation = await api.conversations.create({
      scope,
      project_id: projectId ?? undefined,
      title: firstMessage.slice(0, 24) || "新对话",
    });
    setConversationId(conversation.id);
    await queryClient.invalidateQueries({ queryKey: ["conversations"] });
    return conversation.id;
  };

  const send = async (content: string, fileIds: string[]) => {
    setSending(true);
    setError(null);
    setPendingUser(content);
    try {
      const activeId = conversationId ?? (await ensureConversation(content));
      const result = await api.conversations.chat(activeId, content, fileIds);
      queryClient.setQueryData<Message[]>(["messages", activeId], (old = []) => [
        ...old,
        result.user_message,
        ...(result.assistant_message ? [result.assistant_message] : []),
      ]);
      if (result.actions.length > 0 && result.assistant_message) {
        setMessageActions((previous) => ({
          ...previous,
          [result.assistant_message!.id]: result.actions,
        }));
      }
      await queryClient.invalidateQueries({ queryKey: ["conversations"] });
      await queryClient.invalidateQueries({ queryKey: ["notifications"] });
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "发送失败，请稍后重试";
      setError(message);
      toast.error(message);
    } finally {
      setPendingUser(null);
      setSending(false);
    }
  };

  const newConversation = async () => {
    try {
      const conversation = await api.conversations.create({
        scope,
        project_id: projectId ?? undefined,
        title: scope === "project" ? "新主题对话" : "新的全局对话",
      });
      setConversationId(conversation.id);
      await queryClient.invalidateQueries({ queryKey: ["conversations"] });
      setRailOpen(false);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "创建对话失败");
    }
  };

  const removeConversation = async (conversation: Conversation) => {
    if (!window.confirm(`确定删除「${conversation.title}」？`)) return;
    try {
      await api.conversations.remove(conversation.id);
      if (conversationId === conversation.id) setConversationId(null);
      await queryClient.invalidateQueries({ queryKey: ["conversations"] });
      toast.success("对话已删除");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "删除失败");
    }
  };

  const confirmAction = async (action: AgentAction) => {
    try {
      const result = await api.agent.confirm(action.id);
      toast.success(`已创建「${result.project.name}」`);
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
      router.push(`/projects/${result.project.id}`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "操作失败");
    }
  };

  const rejectAction = async (action: AgentAction) => {
    try {
      await api.agent.reject(action.id);
      setMessageActions((previous) =>
        Object.fromEntries(
          Object.entries(previous).map(([key, actions]) => [
            key,
            actions.map((item) => (item.id === action.id ? { ...item, status: "rejected" as const } : item)),
          ]),
        ),
      );
      toast.success("已忽略该建议");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "操作失败");
    }
  };

  const activeConversation = conversations.find((item) => item.id === conversationId);
  const llmReady = agentStatus.data?.configured ?? true;

  const rail = (
    <aside className="flex h-full w-[248px] shrink-0 flex-col border-r border-slate-200/80 bg-white">
      <div className="flex items-center justify-between px-4 pt-4">
        <p className="text-[11px] font-medium uppercase tracking-wider text-slate-400">对话</p>
        <button
          onClick={() => void newConversation()}
          className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-indigo-600"
          title="新建对话"
        >
          <MessageSquarePlus size={15} />
        </button>
      </div>

      <div className="mt-2 flex-1 space-y-0.5 overflow-y-auto px-2 pb-3">
        {conversationsQuery.isLoading ? (
          <div className="space-y-2 p-2">
            <Skeleton className="h-9" />
            <Skeleton className="h-9" />
            <Skeleton className="h-9" />
          </div>
        ) : conversations.length === 0 ? (
          <p className="px-3 py-8 text-center text-[11px] leading-5 text-slate-400">
            还没有对话
            <br />
            点击右上角 + 开始
          </p>
        ) : (
          conversations.map((conversation) => (
            <div
              key={conversation.id}
              className={cn(
                "group flex items-center gap-2 rounded-lg px-2.5 py-2 transition",
                conversation.id === conversationId
                  ? "bg-indigo-50/80 text-indigo-800"
                  : "text-slate-600 hover:bg-slate-50",
              )}
            >
              <button
                className="min-w-0 flex-1 text-left"
                onClick={() => {
                  setConversationId(conversation.id);
                  setRailOpen(false);
                }}
              >
                <span className="flex items-center gap-1.5">
                  <span className="truncate text-[12px] font-medium">{conversation.title}</span>
                  {conversation.is_default ? <Badge variant="brand">主</Badge> : null}
                </span>
                <span className="mt-0.5 block text-[10px] text-slate-400">
                  {relativeTime(conversation.updated_at)}
                </span>
              </button>
              {conversation.created_by === user?.id && !conversation.is_default ? (
                <button
                  className="hidden rounded p-1 text-slate-300 hover:bg-white hover:text-red-500 group-hover:block"
                  onClick={() => void removeConversation(conversation)}
                  title="删除对话"
                >
                  <Trash2 size={12} />
                </button>
              ) : (
                <MoreHorizontal size={13} className="text-slate-200 opacity-0 group-hover:opacity-100" />
              )}
            </div>
          ))
        )}
      </div>

      <div className="border-t border-slate-100 p-3">
        <div className="rounded-xl bg-gradient-to-br from-slate-50 to-indigo-50/50 p-3">
          <p className="flex items-center gap-1.5 text-[11px] font-medium text-slate-600">
            <Sparkles size={12} className="text-indigo-500" /> 提示
          </p>
          <p className="mt-1 text-[10px] leading-4 text-slate-500">
            对话会检索当前项目的文件与知识。重要决定请让负责人在确认卡片上确认。
          </p>
        </div>
      </div>
    </aside>
  );

  return (
    <div className="flex h-full min-h-0">
      <div className="hidden lg:flex">{rail}</div>
      {railOpen ? (
        <div className="fixed inset-0 z-40 flex lg:hidden">
          <div className="absolute inset-0 bg-slate-900/30" onClick={() => setRailOpen(false)} />
          <div className="relative h-full">{rail}</div>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-14 shrink-0 items-center gap-3 border-b border-slate-200/80 bg-white/80 px-4 backdrop-blur lg:px-5">
          <button
            className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 lg:hidden"
            onClick={() => setRailOpen(true)}
            aria-label="对话列表"
          >
            <MoreHorizontal size={17} />
          </button>

          <div className="relative">
            <select
              value={projectId ?? ""}
              onChange={(event) => {
                const value = event.target.value;
                setConversationId(null);
                router.push(value ? `/chat?project=${value}` : "/chat");
              }}
              className="h-8 max-w-[150px] appearance-none rounded-lg border border-slate-200 bg-white pl-8 pr-8 text-[12px] font-medium text-slate-700 focus:border-indigo-300 focus:outline-none sm:max-w-[260px]"
            >
              <option value="">全局对话</option>
              {(projectsQuery.data ?? []).map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
            <FolderKanban size={13} className="pointer-events-none absolute left-2.5 top-2.5 text-slate-400" />
            <ChevronDown size={12} className="pointer-events-none absolute right-2.5 top-2.5 text-slate-400" />
          </div>

          <div className="hidden min-w-0 sm:block">
            <p className="truncate text-[12px] font-medium text-slate-700">
              {activeConversation?.title ?? (scope === "project" ? "项目主对话" : "全局对话")}
            </p>
            <p className="hidden text-[10px] text-slate-400 sm:block">
              {scope === "project" ? "项目成员共享上下文" : "仅自己可见"} · {agentStatus.data?.model ?? "模型未配置"}
            </p>
          </div>

          <div className="ml-auto flex items-center gap-2">
            {project ? (
              <Link
                href={`/projects/${project.id}`}
                className="hidden rounded-lg px-2.5 py-1.5 text-[11px] text-slate-500 hover:bg-slate-100 sm:block"
              >
                项目详情
              </Link>
            ) : null}
            <Button size="sm" variant="outline" onClick={() => void newConversation()}>
              <MessageSquarePlus size={13} /> <span className="hidden sm:inline">新对话</span>
            </Button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto bg-[var(--background)]">
          <div className="mx-auto flex min-h-full max-w-[780px] flex-col px-4 py-6 lg:px-8">
            {!llmReady ? (
              <div className="mb-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[11px] leading-5 text-amber-800">
                <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                <span>
                  尚未配置云端模型。请在项目根目录 <code className="rounded bg-amber-100 px-1">.env</code> 中填写{" "}
                  <code className="rounded bg-amber-100 px-1">LLM_API_KEY</code>，然后重启后端。知识库上传与检索不受影响。
                </span>
              </div>
            ) : null}

            {messages.length === 0 && !pendingUser ? (
              <div className="flex flex-1 flex-col items-center justify-center py-16 text-center">
                <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-lg shadow-indigo-500/20">
                  <Sparkles size={24} />
                </div>
                <h3 className="text-[18px] font-semibold text-slate-900">
                  {project ? `一起推进「${project.name}」` : "把想法变成可执行的方案"}
                </h3>
                <p className="mt-2 max-w-md text-[12px] leading-6 text-slate-500">
                  {project
                    ? "这个对话会共享项目资料、任务与历史经验。你可以让我起草策划、拆分任务或总结讨论。"
                    : "描述一个活动想法，我会帮你检索往届资料、形成策划思路；涉及创建项目时会请你确认。"}
                </p>
                <div className="mt-6 grid w-full max-w-lg gap-2">
                  {(project ? PROJECT_SUGGESTIONS : GLOBAL_SUGGESTIONS).map((suggestion) => (
                    <button
                      key={suggestion}
                      onClick={() => void send(suggestion, [])}
                      className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-left text-[12px] text-slate-600 transition hover:border-indigo-200 hover:bg-indigo-50/40 hover:text-indigo-700"
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="space-y-5">
                {messages.map((message) => (
                  <MessageBubble
                    key={message.id}
                    message={message}
                    userName={user?.name ?? "我"}
                    actions={messageActions[message.id]}
                    onConfirmAction={confirmAction}
                    onRejectAction={rejectAction}
                  />
                ))}
                {pendingUser ? (
                  <div className="flex flex-row-reverse gap-3">
                    <Avatar name={user?.name ?? "我"} size={30} className="mt-0.5" />
                    <div className="max-w-[78%] rounded-2xl rounded-tr-md bg-indigo-600 px-4 py-3 text-[13px] leading-6 text-white">
                      {pendingUser}
                    </div>
                  </div>
                ) : null}
                {sending ? (
                  <div className="flex gap-3">
                    <div className="mt-0.5 flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 text-white">
                      <Sparkles size={14} />
                    </div>
                    <div className="rounded-2xl rounded-tl-md border border-slate-200 bg-white px-4 py-3">
                      <div className="flex items-center gap-1">
                        <span className="typing-dot h-1.5 w-1.5 rounded-full bg-indigo-400" />
                        <span className="typing-dot h-1.5 w-1.5 rounded-full bg-indigo-400" />
                        <span className="typing-dot h-1.5 w-1.5 rounded-full bg-indigo-400" />
                        <span className="ml-2 text-[10px] text-slate-400">正在检索资料并组织回答…</span>
                      </div>
                    </div>
                  </div>
                ) : null}
                {error ? (
                  <div className="flex items-start gap-2 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-[11px] leading-5 text-red-700">
                    <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                    <span>{error}</span>
                  </div>
                ) : null}
                <div ref={bottomRef} />
              </div>
            )}
          </div>
        </div>

        <Composer
          disabled={false}
          sending={sending}
          onSend={send}
          projectId={projectId}
          onUpload={async (file) => {
            const uploaded = await api.files.upload(file, projectId ?? undefined);
            toast.success("文件已上传，正在解析");
            return uploaded;
          }}
        />
      </div>

      <ContextPanel project={project} />
    </div>
  );
}
