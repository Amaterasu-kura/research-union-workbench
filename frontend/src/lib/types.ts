export type RoleCode = "chair" | "lead" | "member";

export interface Role {
  id: string;
  code: RoleCode | string;
  name: string;
}

export interface Department {
  id: string;
  name: string;
  code: string;
}

export interface User {
  id: string;
  email: string;
  name: string;
  title: string | null;
  avatar_url: string | null;
  status: string;
  departments: Department[];
  roles: Role[];
}

export type ProjectStatus = "preparing" | "running" | "ended" | "archived";

export interface EventSeries {
  id: string;
  name: string;
  description: string | null;
}

export interface ProjectMember {
  id: string;
  user: User;
  status: "applied" | "active" | "rejected" | "left";
  joined_at: string | null;
  created_at: string;
}

export interface Project {
  id: string;
  name: string;
  year: number;
  description: string | null;
  status: ProjectStatus;
  series: EventSeries | null;
  department_id: string | null;
  lead: User | null;
  members: ProjectMember[];
  start_date: string | null;
  end_date: string | null;
  created_at: string;
}

export interface Conversation {
  id: string;
  scope: "global" | "project";
  project_id: string | null;
  title: string;
  is_default: boolean;
  created_by: string | null;
  creator: User | null;
  created_at: string;
  updated_at: string;
}

export type MessageRole = "user" | "assistant" | "system" | "tool";

export interface Message {
  id: string;
  conversation_id: string;
  role: MessageRole;
  content: string;
  parent_id: string | null;
  attachments: { file_id: string }[];
  meta: Record<string, unknown>;
  created_by: string | null;
  created_at: string;
}

export interface AgentAction {
  id: string;
  agent_run_id: string | null;
  action_type: string;
  payload: Record<string, unknown>;
  status: "proposed" | "confirmed" | "rejected" | "expired";
  created_at: string;
}

export interface ChatResult {
  user_message: Message;
  assistant_message: Message | null;
  agent_run_id: string | null;
  actions: AgentAction[];
}

export type TaskStatus = "todo" | "doing" | "done";
export type TaskPriority = "urgent" | "high" | "medium" | "low";

export interface Task {
  id: string;
  project_id: string;
  title: string;
  description: string | null;
  priority: TaskPriority;
  status: TaskStatus;
  due_at: string | null;
  current_assignee_id: string | null;
  assignee: User | null;
  created_by: string | null;
  source: string;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface TaskHistory {
  id: string;
  action: string;
  field: string | null;
  old_value: string | null;
  new_value: string | null;
  actor_id: string | null;
  created_at: string;
}

export interface TaskExchange {
  id: string;
  from_user_id: string;
  to_user_id: string;
  from_task_id: string;
  to_task_id: string;
  status: "pending" | "accepted" | "rejected" | "cancelled";
  message: string | null;
  created_at: string;
  responded_at: string | null;
}

export type FileStatus = "pending" | "parsing" | "ready" | "failed";

export interface FileItem {
  id: string;
  original_name: string;
  mime_type: string;
  size_bytes: number;
  file_type: string;
  status: FileStatus;
  project_id: string | null;
  uploaded_by: string | null;
  error: string | null;
  created_at: string;
}

export interface Chunk {
  id: string;
  index: number;
  content: string;
  page_no: number | null;
  heading_path: string | null;
}

export type KnowledgeType = "fact" | "experience" | "advice" | "inference";
export type KnowledgeStatus = "proposed" | "confirmed" | "archived";

export interface KnowledgeItem {
  id: string;
  title: string;
  content: string;
  knowledge_type: KnowledgeType;
  status: KnowledgeStatus;
  confidence: number;
  project_id: string | null;
  department_id: string | null;
  created_at: string;
}

export interface SearchHit {
  id: string;
  kind: "chunk" | "knowledge";
  title: string;
  content: string;
  score: number;
  file_id: string | null;
  file_name: string | null;
  page_no: number | null;
  knowledge_id: string | null;
}

export interface ProjectSummary {
  conversations: number;
  files: number;
  knowledge: number;
  members: number;
  tasks: { total: number; todo: number; doing: number; done: number };
}

export interface NotificationItem {
  id: string;
  type: string;
  title: string;
  body: string | null;
  target_type: string | null;
  target_id: string | null;
  read_at: string | null;
  created_at: string;
}
