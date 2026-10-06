import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { GitPort, TaskRepository } from "../ports";
import type { Task } from "../domain/task";

export class JsonTaskRepository implements TaskRepository {
  constructor(private readonly git: GitPort) {}

  async load(cwd: string): Promise<Task[]> {
    const path = join(cwd, await this.git.getGitDirectory(cwd), "bioarc-tasks.json");
    return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) as Task[] : [];
  }

  async save(cwd: string, tasks: Task[]): Promise<void> {
    const path = join(cwd, await this.git.getGitDirectory(cwd), "bioarc-tasks.json");
    writeFileSync(path, `${JSON.stringify(tasks, null, 2)}\n`, { mode: 0o600 });
  }
}
