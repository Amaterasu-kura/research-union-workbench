"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, BookOpen, FolderKanban, MessageSquareText, Sparkles, Users } from "lucide-react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/components/auth-provider";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";

const DEMO_ACCOUNTS = [
  { label: "主席团", email: "chair@example.com", hint: "全局管理" },
  { label: "部门负责人", email: "lead@example.com", hint: "项目统筹" },
  { label: "普通成员", email: "member@example.com", hint: "参与执行" },
];

export default function LoginPage() {
  const router = useRouter();
  const { refresh } = useAuth();
  const [email, setEmail] = useState("lead@example.com");
  const [password, setPassword] = useState("Passw0rd!");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      await api.auth.login(email, password);
      await refresh();
      toast.success("登录成功");
      router.push("/chat");
      router.refresh();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "登录失败，请稍后重试";
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen bg-[#0d0f14]">
      <div className="relative hidden w-[56%] flex-col justify-between overflow-hidden p-12 lg:flex">
        <div className="pointer-events-none absolute -left-32 -top-40 h-[520px] w-[520px] rounded-full bg-indigo-600/20 blur-[120px]" />
        <div className="pointer-events-none absolute -bottom-48 right-0 h-[480px] w-[480px] rounded-full bg-violet-500/15 blur-[120px]" />

        <div className="relative flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-400 to-violet-500 text-base font-semibold text-white">
            研
          </div>
          <div>
            <p className="text-sm font-semibold text-white">研究生会 AI 协同工作台</p>
            <p className="text-[10px] tracking-[0.18em] text-white/40">RESEARCH UNION WORKSPACE</p>
          </div>
        </div>

        <div className="relative max-w-xl">
          <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] text-indigo-200">
            <Sparkles size={13} /> 让每次活动都成为组织资产
          </div>
          <h1 className="text-[40px] font-semibold leading-[1.18] tracking-tight text-white">
            不再从零开始
            <br />
            筹备每一场活动
          </h1>
          <p className="mt-5 max-w-md text-sm leading-7 text-white/55">
            把活动想法、往届资料、策划案、任务分工与执行经验放在同一个工作台里。
            AI 负责检索与起草，负责人负责确认，组织负责沉淀。
          </p>

          <div className="mt-9 grid grid-cols-2 gap-3">
            {[
              { icon: MessageSquareText, title: "项目内多对话", text: "策划、宣传、执行各自讨论，共享项目上下文" },
              { icon: BookOpen, title: "历史资料可追溯", text: "Word/PDF 入库，回答带来源与页码" },
              { icon: FolderKanban, title: "项目全周期", text: "筹备、执行、总结、归档四个状态" },
              { icon: Users, title: "任务与协作", text: "优先级、负责人、状态与交换记录" },
            ].map((item) => (
              <div key={item.title} className="rounded-xl border border-white/10 bg-white/[0.04] p-4">
                <item.icon size={17} className="text-indigo-300" />
                <p className="mt-2.5 text-[13px] font-medium text-white/90">{item.title}</p>
                <p className="mt-1 text-[11px] leading-5 text-white/40">{item.text}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="relative flex items-center gap-6 text-[11px] text-white/35">
          <span>科技论文报告会</span>
          <span className="h-1 w-1 rounded-full bg-white/20" />
          <span>研究生迎新活动</span>
          <span className="h-1 w-1 rounded-full bg-white/20" />
          <span>学术论坛</span>
        </div>
      </div>

      <div className="flex w-full flex-col justify-center bg-[#f6f7f9] px-6 py-10 lg:w-[44%] lg:px-16">
        <div className="mx-auto w-full max-w-[380px]">
          <div className="mb-8 lg:hidden">
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 text-base font-semibold text-white">
              研
            </div>
            <p className="text-sm font-semibold text-slate-900">研会工作台</p>
          </div>

          <h2 className="text-[24px] font-semibold tracking-tight text-slate-900">欢迎回来</h2>
          <p className="mt-1.5 text-[13px] text-slate-500">使用组织账号登录，继续推进你的活动。</p>

          <form onSubmit={submit} className="mt-8 space-y-4">
            <div>
              <Label htmlFor="email">邮箱</Label>
              <Input
                id="email"
                type="email"
                autoComplete="username"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="name@example.com"
                required
              />
            </div>
            <div>
              <Label htmlFor="password">密码</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="请输入密码"
                required
              />
            </div>

            {error ? (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{error}</p>
            ) : null}

            <Button type="submit" size="lg" className="w-full" disabled={loading}>
              {loading ? "登录中…" : "进入工作台"}
              {!loading ? <ArrowRight size={15} /> : null}
            </Button>
          </form>

          <div className="mt-8">
            <p className="mb-2 text-[11px] font-medium text-slate-400">Demo 账号（密码均为 Passw0rd!）</p>
            <div className="space-y-1.5">
              {DEMO_ACCOUNTS.map((account) => (
                <button
                  key={account.email}
                  type="button"
                  onClick={() => {
                    setEmail(account.email);
                    setPassword("Passw0rd!");
                  }}
                  className="flex w-full items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2 text-left transition hover:border-indigo-200 hover:bg-indigo-50/40"
                >
                  <span>
                    <span className="text-xs font-medium text-slate-700">{account.label}</span>
                    <span className="ml-2 text-[10px] text-slate-400">{account.hint}</span>
                  </span>
                  <span className="text-[10px] text-slate-400">{account.email}</span>
                </button>
              ))}
            </div>
          </div>

          <p className="mt-8 text-[10px] leading-5 text-slate-400">
            登录即表示你同意组织内部的资料使用规范。历史资料跨部门共享，但仅用于研会工作。
          </p>
        </div>
      </div>
    </div>
  );
}
