"use client";

import { useQuery } from "@tanstack/react-query";
import { Bot, Database, KeyRound, LogOut, Server, ShieldCheck, UserRound } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/components/auth-provider";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ROLE_LABEL } from "@/lib/utils";

export default function SettingsPage() {
  const { user, logout } = useAuth();
  const status = useQuery({ queryKey: ["agent-status"], queryFn: api.agent.status });

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[980px] px-5 py-6 lg:px-8">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-wider text-slate-400">Settings</p>
          <h2 className="mt-1 text-[22px] font-semibold tracking-tight text-slate-900">系统设置</h2>
          <p className="mt-1 text-[12px] text-slate-500">账号、模型与运行状态。</p>
        </div>

        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          <div className="rounded-2xl border border-slate-200/80 bg-white p-5">
            <div className="flex items-center gap-2 text-[11px] font-medium text-slate-500">
              <UserRound size={14} /> 当前账号
            </div>
            <div className="mt-4 flex items-center gap-3">
              <Avatar name={user?.name ?? "访客"} size={44} />
              <div>
                <p className="text-[15px] font-semibold text-slate-900">{user?.name ?? "加载中"}</p>
                <p className="text-[11px] text-slate-400">{user?.email}</p>
              </div>
            </div>
            <div className="mt-4 space-y-2 text-[11px]">
              <div className="flex items-center justify-between">
                <span className="text-slate-400">角色</span>
                <span className="flex flex-wrap gap-1">
                  {(user?.roles ?? []).map((role) => (
                    <Badge key={role.id} variant="brand">
                      {ROLE_LABEL[role.code] ?? role.name}
                    </Badge>
                  ))}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-400">部门</span>
                <span className="text-slate-700">
                  {(user?.departments ?? []).map((department) => department.name).join(" / ") || "未分配"}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-400">账号状态</span>
                <Badge variant="success">正常</Badge>
              </div>
            </div>
            <Button variant="outline" size="sm" className="mt-5 text-red-600" onClick={() => void logout()}>
              <LogOut size={13} /> 退出登录
            </Button>
          </div>

          <div className="rounded-2xl border border-slate-200/80 bg-white p-5">
            <div className="flex items-center gap-2 text-[11px] font-medium text-slate-500">
              <Bot size={14} /> 云端模型
            </div>
            <div className="mt-4 space-y-3">
              <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2.5">
                <span className="text-[11px] text-slate-500">对话模型</span>
                <span className="text-[11px] font-medium text-slate-800">{status.data?.model ?? "—"}</span>
              </div>
              <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2.5">
                <span className="text-[11px] text-slate-500">Embedding</span>
                <span className="text-[11px] font-medium text-slate-800">
                  {status.data?.embedding_model ?? "—"} · {status.data?.embedding_dim ?? "—"} 维
                </span>
              </div>
              <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2.5">
                <span className="text-[11px] text-slate-500">API Key</span>
                {status.data?.configured ? (
                  <Badge variant="success">已配置</Badge>
                ) : (
                  <Badge variant="warning">未配置</Badge>
                )}
              </div>
            </div>
            {!status.data?.configured ? (
              <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-[10.5px] leading-5 text-amber-800">
                在项目根目录 <code className="rounded bg-amber-100 px-1">.env</code> 设置{" "}
                <code className="rounded bg-amber-100 px-1">LLM_API_KEY</code>，重启后端后生效。知识库检索不依赖该 Key。
              </div>
            ) : null}
          </div>

          <div className="rounded-2xl border border-slate-200/80 bg-white p-5">
            <div className="flex items-center gap-2 text-[11px] font-medium text-slate-500">
              <Database size={14} /> 数据与存储
            </div>
            <ul className="mt-4 space-y-2 text-[11px] leading-5 text-slate-500">
              <li className="flex items-center gap-2">
                <ShieldCheck size={13} className="text-emerald-500" /> PostgreSQL + pgvector，单库存储业务与检索索引
              </li>
              <li className="flex items-center gap-2">
                <Server size={13} className="text-indigo-500" /> 原始文件保存在本地 storage/，不覆盖原件
              </li>
              <li className="flex items-center gap-2">
                <KeyRound size={13} className="text-slate-400" /> 登录使用 HttpOnly Cookie，API Key 不下发前端
              </li>
            </ul>
          </div>

          <div className="rounded-2xl border border-slate-200/80 bg-white p-5">
            <div className="flex items-center gap-2 text-[11px] font-medium text-slate-500">
              <Server size={14} /> 运行信息
            </div>
            <div className="mt-4 space-y-2 text-[11px]">
              {[
                ["前端", "Next.js 16 + React 19"],
                ["后端", "FastAPI + SQLAlchemy 2"],
                ["队列", "Redis + RQ"],
                ["检索", "pgvector + 中文分词"],
              ].map(([key, value]) => (
                <div key={key} className="flex items-center justify-between border-b border-slate-50 pb-2">
                  <span className="text-slate-400">{key}</span>
                  <span className="text-slate-700">{value}</span>
                </div>
              ))}
            </div>
            <p className="mt-3 text-[10px] leading-5 text-slate-400">
              Phase 1 · 核心闭环。LangGraph 编排与文档版本将在 Phase 2 接入。
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
