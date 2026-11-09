"use client";

import { useEffect, useRef, useState } from "react";
import { Bell, CheckCheck } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { cn, relativeTime } from "@/lib/utils";

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();

  const { data: count } = useQuery({
    queryKey: ["notifications", "unread"],
    queryFn: api.notifications.unreadCount,
    refetchInterval: 30_000,
  });
  const { data: items = [] } = useQuery({
    queryKey: ["notifications", "list"],
    queryFn: api.notifications.list,
    enabled: open,
  });

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const markAll = async () => {
    await api.notifications.readAll();
    await queryClient.invalidateQueries({ queryKey: ["notifications"] });
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((value) => !value)}
        className="relative flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
        aria-label="通知"
      >
        <Bell size={17} />
        {count && count.count > 0 ? (
          <span className="absolute right-1.5 top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-medium text-white">
            {count.count > 99 ? "99+" : count.count}
          </span>
        ) : null}
      </button>
      {open ? (
        <div className="absolute right-0 top-11 z-40 w-80 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <p className="text-sm font-semibold text-slate-800">通知</p>
            <button
              onClick={markAll}
              className="flex items-center gap-1 text-[11px] text-slate-500 hover:text-indigo-600"
            >
              <CheckCheck size={13} /> 全部已读
            </button>
          </div>
          <div className="max-h-80 overflow-y-auto">
            {items.length === 0 ? (
              <p className="px-4 py-10 text-center text-xs text-slate-400">暂无通知</p>
            ) : (
              items.map((item) => (
                <button
                  key={item.id}
                  onClick={async () => {
                    if (!item.read_at) await api.notifications.read(item.id);
                    await queryClient.invalidateQueries({ queryKey: ["notifications"] });
                  }}
                  className={cn(
                    "block w-full border-b border-slate-50 px-4 py-3 text-left transition hover:bg-slate-50",
                    !item.read_at && "bg-indigo-50/30",
                  )}
                >
                  <p className="text-xs font-medium text-slate-800">{item.title}</p>
                  {item.body ? <p className="mt-0.5 line-clamp-2 text-[11px] text-slate-500">{item.body}</p> : null}
                  <p className="mt-1 text-[10px] text-slate-400">{relativeTime(item.created_at)}</p>
                </button>
              ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
