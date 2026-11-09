"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import {
  BookOpen,
  ChevronDown,
  Files,
  FolderKanban,
  LayoutDashboard,
  ListChecks,
  LogOut,
  Menu,
  MessageSquareText,
  Search,
  Settings,
  Sparkles,
  Users,
  X,
} from "lucide-react";
import { useAuth } from "@/components/auth-provider";
import { NotificationBell } from "@/components/notification-bell";
import { Avatar } from "@/components/ui/avatar";
import { cn, ROLE_LABEL } from "@/lib/utils";

const NAV = [
  { href: "/chat", label: "AI 对话", icon: MessageSquareText },
  { href: "/projects", label: "活动项目", icon: FolderKanban },
  { href: "/tasks", label: "任务中心", icon: ListChecks },
  { href: "/files", label: "文件中心", icon: Files },
  { href: "/knowledge", label: "知识库", icon: BookOpen },
];

const ADMIN_NAV = [
  { href: "/organization", label: "组织管理", icon: Users },
  { href: "/settings", label: "系统设置", icon: Settings },
];

const TITLES: Record<string, { title: string; subtitle: string }> = {
  "/chat": { title: "AI 对话", subtitle: "让想法变成可执行的方案" },
  "/projects": { title: "活动项目", subtitle: "从策划到归档的完整闭环" },
  "/tasks": { title: "任务中心", subtitle: "优先级、负责人和进度" },
  "/files": { title: "文件中心", subtitle: "策划案、总结与活动资料" },
  "/knowledge": { title: "知识库", subtitle: "让每次活动都成为组织资产" },
  "/organization": { title: "组织管理", subtitle: "成员、部门与角色" },
  "/settings": { title: "系统设置", subtitle: "模型、账号与运行状态" },
};

function NavItem({
  href,
  label,
  icon: Icon,
  active,
  onClick,
}: {
  href: string;
  label: string;
  icon: typeof MessageSquareText;
  active: boolean;
  onClick?: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      className={cn(
        "group flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-medium transition",
        active
          ? "bg-indigo-50 text-indigo-700"
          : "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
      )}
    >
      <Icon size={17} className={active ? "text-indigo-600" : "text-slate-400 group-hover:text-slate-600"} />
      {label}
      {active ? <span className="ml-auto h-1.5 w-1.5 rounded-full bg-indigo-500" /> : null}
    </Link>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, logout } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [userMenu, setUserMenu] = useState(false);

  const meta = TITLES[pathname] ?? TITLES[Object.keys(TITLES).find((key) => pathname.startsWith(key)) ?? ""] ?? {
    title: "研会工作台",
    subtitle: "AI 协同工作台",
  };

  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  const sidebar = (
    <aside className="flex h-full w-[248px] shrink-0 flex-col border-r border-slate-200/80 bg-white">
      <div className="flex h-16 items-center gap-2.5 px-5">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 text-sm font-semibold text-white shadow-sm">
          研
        </div>
        <div>
          <p className="text-[13px] font-semibold leading-4 text-slate-900">研会工作台</p>
          <p className="mt-0.5 text-[10px] tracking-wide text-slate-400">AI COLLABORATION</p>
        </div>
        <button className="ml-auto rounded-md p-1 text-slate-400 lg:hidden" onClick={() => setMobileOpen(false)}>
          <X size={16} />
        </button>
      </div>

      <div className="px-3">
        <Link
          href="/chat"
          onClick={() => setMobileOpen(false)}
          className="flex items-center justify-between rounded-xl border border-indigo-100 bg-gradient-to-r from-indigo-50 to-violet-50 px-3 py-2.5 text-[13px] font-medium text-indigo-700 transition hover:border-indigo-200"
        >
          <span className="flex items-center gap-2">
            <Sparkles size={15} /> 开始一个新想法
          </span>
          <span className="text-[10px] text-indigo-400">⌘K</span>
        </Link>
      </div>

      <nav className="mt-4 space-y-0.5 px-3">
        <p className="px-3 pb-1.5 text-[10px] font-medium uppercase tracking-wider text-slate-400">工作区</p>
        {NAV.map((item) => (
          <NavItem
            key={item.href}
            {...item}
            active={isActive(item.href)}
            onClick={() => setMobileOpen(false)}
          />
        ))}
        <p className="px-3 pb-1.5 pt-4 text-[10px] font-medium uppercase tracking-wider text-slate-400">管理</p>
        {ADMIN_NAV.map((item) => (
          <NavItem
            key={item.href}
            {...item}
            active={isActive(item.href)}
            onClick={() => setMobileOpen(false)}
          />
        ))}
      </nav>

      <div className="mt-auto border-t border-slate-100 p-3">
        <div className="rounded-xl bg-slate-50 px-3 py-2.5">
          <p className="text-[11px] font-medium text-slate-600">本周协作</p>
          <p className="mt-0.5 text-[10px] leading-4 text-slate-400">
            在任务中心查看待办与进度
          </p>
        </div>
        <div className="relative mt-2">
          <button
            onClick={() => setUserMenu((value) => !value)}
            className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left transition hover:bg-slate-100"
          >
            <Avatar name={user?.name ?? "访客"} size={30} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[12px] font-medium text-slate-800">
                {user?.name ?? "加载中"}
              </span>
              <span className="block truncate text-[10px] text-slate-400">
                {user ? ROLE_LABEL[user.roles[0]?.code] ?? user.roles[0]?.name : ""}
              </span>
            </span>
            <ChevronDown size={13} className="text-slate-400" />
          </button>
          {userMenu ? (
            <div className="absolute bottom-12 left-0 w-full overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
              <Link
                href="/settings"
                onClick={() => setUserMenu(false)}
                className="flex items-center gap-2 px-3 py-2 text-xs text-slate-600 hover:bg-slate-50"
              >
                <Settings size={13} /> 系统设置
              </Link>
              <button
                onClick={() => void logout()}
                className="flex w-full items-center gap-2 px-3 py-2 text-xs text-red-600 hover:bg-red-50"
              >
                <LogOut size={13} /> 退出登录
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </aside>
  );

  return (
    <div className="flex h-screen overflow-hidden bg-[var(--background)]">
      <div className="hidden lg:flex">{sidebar}</div>
      {mobileOpen ? (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          <div className="absolute inset-0 bg-slate-900/30" onClick={() => setMobileOpen(false)} />
          <div className="relative h-full">{sidebar}</div>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 shrink-0 items-center gap-3 border-b border-slate-200/80 bg-white/80 px-4 backdrop-blur lg:px-6">
          <button
            className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 lg:hidden"
            onClick={() => setMobileOpen(true)}
            aria-label="打开导航"
          >
            <Menu size={18} />
          </button>
          <div className="min-w-0">
            <h1 className="truncate text-[15px] font-semibold text-slate-900">{meta.title}</h1>
            <p className="hidden text-[11px] text-slate-400 sm:block">{meta.subtitle}</p>
          </div>

          <div className="ml-auto flex items-center gap-2">
            <div className="hidden items-center gap-2 rounded-lg border border-slate-200 bg-slate-50/70 px-2.5 py-1.5 md:flex">
              <Search size={14} className="text-slate-400" />
              <input
                placeholder="搜索知识、项目、文件…"
                className="w-44 bg-transparent text-xs text-slate-700 placeholder:text-slate-400 focus:outline-none"
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    const value = (event.target as HTMLInputElement).value.trim();
                    if (value) router.push(`/knowledge?q=${encodeURIComponent(value)}`);
                  }
                }}
              />
            </div>
            <NotificationBell />
            <Link href="/settings" className="ml-1">
              <Avatar name={user?.name ?? "访客"} size={32} />
            </Link>
          </div>
        </header>

        <main className="min-h-0 flex-1 overflow-hidden">{children}</main>
      </div>
    </div>
  );
}
