import { completeTask, commitSubject, createTask, resolveTask, type Task } from "../domain/task";
import type { GitPort, TaskRepository } from "../ports";

export class TaskService {
  constructor(
    private readonly repository: TaskRepository,
    private readonly git: GitPort,
  ) {}

  list(cwd: string): Promise<Task[]> {
    return this.repository.load(cwd);
  }

  async create(cwd: string, title: string): Promise<Task> {
    const tasks = await this.repository.load(cwd);
    const task = createTask(title);
    tasks.push(task);
    await this.repository.save(cwd, tasks);
    return task;
  }

  async complete(cwd: string, id: string): Promise<Task> {
    const tasks = await this.repository.load(cwd);
    const task = resolveTask(tasks, id);
    completeTask(task);
    await this.repository.save(cwd, tasks);
    return task;
  }

  async delete(cwd: string, id: string): Promise<Task> {
    const tasks = await this.repository.load(cwd);
    const task = resolveTask(tasks, id);
    tasks.splice(tasks.indexOf(task), 1);
    await this.repository.save(cwd, tasks);
    return task;
  }

  async commit(cwd: string, id: string, supervisor: string): Promise<{ task: Task; hash: string }> {
    const tasks = await this.repository.load(cwd);
    const task = resolveTask(tasks, id);
    if (task.status !== "open") throw new Error("Cannot commit to a completed task.");
    if (!supervisor.trim()) throw new Error("Set BIOARC_SUPERVISOR to the supervisor's name.");
    if (!await this.git.hasStagedChanges(cwd)) throw new Error("Stage the task's changes first; no staged changes found.");
    const hash = await this.git.commit(cwd, commitSubject(task.title, supervisor.trim()));
    task.commits.push(hash);
    await this.repository.save(cwd, tasks);
    return { task, hash };
  }
}
