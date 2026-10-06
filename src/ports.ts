import type { Task } from "./domain/task";

export interface TaskRepository {
  load(cwd: string): Promise<Task[]>;
  save(cwd: string, tasks: Task[]): Promise<void>;
}

export interface GitPort {
  getGitDirectory(cwd: string): Promise<string>;
  getProjectRoot(cwd: string): Promise<string>;
  defaultBranch(cwd: string): Promise<string>;
  hasStagedChanges(cwd: string): Promise<boolean>;
  commit(cwd: string, message: string): Promise<string>;
  ensureWorktree(cwd: string, taskId: string, branch: string, base: string, existingPath?: string): Promise<string>;
  removeWorktree(cwd: string, path: string, base: string): Promise<boolean>;
  worktreeStatus(cwd: string, path: string): Promise<{ branch: string; dirty: boolean }>;
  syncWorktree(cwd: string, path: string, base: string): Promise<void>;
  diffWorktree(cwd: string, path: string, base: string): Promise<string>;
  integrateWorktree(cwd: string, path: string, base: string): Promise<string>;
}

export interface ProjectConfigPort {
  getSupervisor(cwd: string): Promise<string>;
  setSupervisor(cwd: string, supervisor: string): Promise<void>;
}

export interface PluginUpdater {
  update(cwd: string): Promise<void>;
}
