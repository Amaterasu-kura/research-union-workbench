import type {
  AgentAction,
  ChatResult,
  Chunk,
  Conversation,
  FileItem,
  KnowledgeItem,
  Message,
  NotificationItem,
  Project,
  ProjectMember,
  ProjectSummary,
  SearchHit,
  Task,
  TaskExchange,
  TaskHistory,
  User,
} from "@/lib/types";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  const isForm = init.body instanceof FormData;
  if (!isForm && init.body) headers.set("Content-Type", "application/json");
  const response = await fetch(`/api/backend${path}`, {
    ...init,
    headers,
    credentials: "include",
  });
  if (!response.ok) {
    let detail = `请求失败（HTTP ${response.status}）`;
    try {
      const data = await response.json();
      detail = typeof data.detail === "string" ? data.detail : JSON.stringify(data.detail ?? data);
    } catch {
      // ignore
    }
    throw new ApiError(response.status, detail);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

const get = <T>(path: string) => request<T>(path);
const post = <T>(path: string, body?: unknown) =>
  request<T>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });
const patch = <T>(path: string, body: unknown) =>
  request<T>(path, { method: "PATCH", body: JSON.stringify(body) });
const del = <T>(path: string) => request<T>(path, { method: "DELETE" });

export const api = {
  auth: {
    login: (email: string, password: string) =>
      post<{ access_token: string; user: User }>("/auth/login", { email, password }),
    logout: () => post<{ status: string }>("/auth/logout"),
    me: () => get<User>("/auth/me"),
  },
  users: {
    list: () => get<User[]>("/users"),
    departments: () => get<{ id: string; name: string; code: string }[]>("/departments"),
  },
  projects: {
    list: () => get<Project[]>("/projects"),
    get: (id: string) => get<Project>(`/projects/${id}`),
    create: (body: Record<string, unknown>) => post<Project>("/projects", body),
    requestCreate: (body: Record<string, unknown>) =>
      post<{ id: string; action_type: string; payload: Record<string, unknown>; status: string }>(
        "/projects/requests",
        body,
      ),
    update: (id: string, body: Record<string, unknown>) => patch<Project>(`/projects/${id}`, body),
    members: (id: string) => get<ProjectMember[]>(`/projects/${id}/members`),
    addMember: (id: string, userId: string) =>
      post<ProjectMember>(`/projects/${id}/members`, { user_id: userId }),
    apply: (id: string, message?: string) =>
      post<ProjectMember>(`/projects/${id}/apply`, { message }),
    reviewMember: (id: string, memberId: string, status: string) =>
      patch<ProjectMember>(`/projects/${id}/members/${memberId}`, { status }),
    summary: (id: string) => get<ProjectSummary>(`/projects/${id}/summary`),
  },
  conversations: {
    list: (scope: "global" | "project", projectId?: string) =>
      get<Conversation[]>(
        `/conversations?scope=${scope}${projectId ? `&project_id=${projectId}` : ""}`,
      ),
    get: (id: string) => get<Conversation>(`/conversations/${id}`),
    create: (body: Record<string, unknown>) => post<Conversation>("/conversations", body),
    rename: (id: string, title: string) => patch<Conversation>(`/conversations/${id}`, { title }),
    remove: (id: string) => del<{ status: string }>(`/conversations/${id}`),
    messages: (id: string) => get<Message[]>(`/conversations/${id}/messages`),
    chat: (id: string, content: string, fileIds: string[] = []) =>
      post<ChatResult>(`/conversations/${id}/chat`, { content, file_ids: fileIds }),
  },
  tasks: {
    list: (params: { projectId?: string; mine?: boolean; status?: string } = {}) => {
      const query = new URLSearchParams();
      if (params.projectId) query.set("project_id", params.projectId);
      if (params.mine) query.set("mine", "true");
      if (params.status) query.set("status", params.status);
      return get<Task[]>(`/tasks?${query.toString()}`);
    },
    create: (body: Record<string, unknown>) => post<Task>("/tasks", body),
    update: (id: string, body: Record<string, unknown>) => patch<Task>(`/tasks/${id}`, body),
    history: (id: string) => get<TaskHistory[]>(`/tasks/${id}/history`),
    exchanges: () => get<TaskExchange[]>("/task-exchanges"),
    createExchange: (taskId: string, toTaskId: string, message?: string) =>
      post<TaskExchange>(`/tasks/${taskId}/exchange`, { to_task_id: toTaskId, message }),
    acceptExchange: (id: string) => post<TaskExchange>(`/task-exchanges/${id}/accept`),
    rejectExchange: (id: string) => post<TaskExchange>(`/task-exchanges/${id}/reject`),
  },
  files: {
    list: (projectId?: string, includeGlobal = false) => {
      const query = new URLSearchParams();
      if (projectId) query.set("project_id", projectId);
      if (includeGlobal) query.set("include_global", "true");
      return get<FileItem[]>(`/files?${query.toString()}`);
    },
    upload: (file: File, projectId?: string) => {
      const form = new FormData();
      form.append("file", file);
      if (projectId) form.append("project_id", projectId);
      return request<FileItem>("/files", { method: "POST", body: form });
    },
    remove: (id: string) => del<{ status: string }>(`/files/${id}`),
    chunks: (id: string) => get<Chunk[]>(`/files/${id}/chunks`),
    reprocess: (id: string) => post<FileItem>(`/files/${id}/reprocess`),
    downloadUrl: (id: string) => `/api/backend/files/${id}/download`,
  },
  knowledge: {
    search: (query: string, projectId?: string, limit = 8) =>
      post<SearchHit[]>("/knowledge/search", { query, project_id: projectId, limit }),
    list: (params: { projectId?: string; status?: string } = {}) => {
      const query = new URLSearchParams();
      if (params.projectId) query.set("project_id", params.projectId);
      if (params.status) query.set("status", params.status);
      return get<KnowledgeItem[]>(`/knowledge?${query.toString()}`);
    },
    create: (body: Record<string, unknown>) => post<KnowledgeItem>("/knowledge", body),
    update: (id: string, body: Record<string, unknown>) =>
      patch<KnowledgeItem>(`/knowledge/${id}`, body),
  },
  notifications: {
    list: () => get<NotificationItem[]>("/notifications"),
    unreadCount: () => get<{ count: number }>("/notifications/unread-count"),
    read: (id: string) => post<{ status: string }>(`/notifications/${id}/read`),
    readAll: () => post<{ status: string }>("/notifications/read-all"),
  },
  agent: {
    status: () =>
      get<{ configured: boolean; model: string; embedding_model: string; embedding_dim: number }>(
        "/agent/status",
      ),
    actions: (status = "proposed") => get<AgentAction[]>(`/agent/actions?status=${status}`),
    confirm: (id: string) => post<{ action: AgentAction; project: Project }>(`/agent/actions/${id}/confirm`),
    reject: (id: string) => post<AgentAction>(`/agent/actions/${id}/reject`),
  },
};
