import { randomUUID } from "node:crypto";

export interface Task {
  id: string;
  title: string;
  status: "open" | "completed";
  createdAt: string;
  completedAt?: string;
  worktreePath?: string;
  branch?: string;
  baseBranch?: string;
  commits: string[];
}

export function createTask(title: string, now = new Date().toISOString()): Task {
  const normalizedTitle = title.trim();
  if (!normalizedTitle) throw new Error("Task title cannot be empty.");
  return { id: randomUUID(), title: normalizedTitle, status: "open", createdAt: now, commits: [] };
}

export function resolveTask(tasks: Task[], id: string): Task {
  const matches = tasks.filter((task) => task.id === id || task.id.startsWith(id));
  if (!matches.length) throw new Error("Task not found. Use /bioarc-task list.");
  if (matches.length > 1) throw new Error("Task ID is ambiguous; choose a longer autocomplete result.");
  return matches[0]!;
}

export function completeTask(task: Task, now = new Date().toISOString()): void {
  task.status = "completed";
  task.completedAt = now;
}

export function commitSubject(title: string, supervisor: string): string {
  if (/\p{Script=Latin}/u.test(title) || /\p{Script=Latin}/u.test(supervisor)) throw new Error("عنوان تسک و نام سرپرست باید فارسی باشند؛ پیام کامیت انگلیسی مجاز نیست.");
  return `نوع کامیت: تسک میزیتو عنوان تسک: ${title} فرد محول کننده: ${supervisor}`;
}
