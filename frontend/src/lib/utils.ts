import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function initials(name: string) {
  const trimmed = name.trim();
  if (!trimmed) return "?";
  if (/[\u4e00-\u9fff]/.test(trimmed)) return trimmed.slice(-1);
  return trimmed.length <= 2 ? trimmed.toUpperCase() : trimmed.slice(0, 2).toUpperCase();
}

export function formatDate(value: string | null | undefined, options?: { withTime?: boolean }) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  const base = `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, "0")}.${String(
    date.getDate(),
  ).padStart(2, "0")}`;
  if (!options?.withTime) return base;
  return `${base} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

export function relativeTime(value: string) {
  const date = new Date(value).getTime();
  const diff = Date.now() - date;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} 天前`;
  return formatDate(value);
}

export function fileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export const STATUS_LABEL: Record<string, string> = {
  preparing: "筹备中",
  running: "执行中",
  ended: "已结束",
  archived: "已归档",
};

export const TASK_STATUS_LABEL: Record<string, string> = {
  todo: "待开始",
  doing: "进行中",
  done: "已完成",
};

export const PRIORITY_LABEL: Record<string, string> = {
  urgent: "紧急",
  high: "高",
  medium: "中",
  low: "低",
};

export const ROLE_LABEL: Record<string, string> = {
  chair: "主席团",
  lead: "部门负责人",
  member: "普通部员",
};

export const KNOWLEDGE_TYPE_LABEL: Record<string, string> = {
  fact: "已确认事实",
  experience: "执行经验",
  advice: "一般建议",
  inference: "模型推测",
};

export const KNOWLEDGE_STATUS_LABEL: Record<string, string> = {
  proposed: "待确认",
  confirmed: "已确认",
  archived: "已归档",
};
