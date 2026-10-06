import type { Task } from "./domain/task";

export interface TaskRepository {
  load(cwd: string): Promise<Task[]>;
  save(cwd: string, tasks: Task[]): Promise<void>;
}

export interface GitPort {
  getGitDirectory(cwd: string): Promise<string>;
  hasStagedChanges(cwd: string): Promise<boolean>;
  commit(cwd: string, message: string): Promise<string>;
}

export interface ProjectConfigPort {
  getSupervisor(cwd: string): Promise<string>;
  setSupervisor(cwd: string, supervisor: string): Promise<void>;
}

export interface PluginUpdater {
  update(cwd: string): Promise<void>;
}
