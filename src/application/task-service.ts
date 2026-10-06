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
    task.baseBranch = await this.git.defaultBranch(cwd);
    task.branch = `bioarc/task-${task.id.slice(0, 8)}`;
    task.worktreePath = await this.git.createWorktree(cwd, task.id, task.branch, task.baseBranch);
    tasks.push(task);
    await this.repository.save(cwd, tasks);
    return task;
  }

  async sync(cwd: string, id: string): Promise<void> {
    const task = resolveTask(await this.repository.load(cwd), id);
    if (!task.worktreePath) throw new Error("Task has no worktree.");
    const base = task.baseBranch ?? await this.git.defaultBranch(cwd);
    await this.git.syncWorktree(cwd, task.worktreePath, base);
  }

  async diff(cwd: string, id: string): Promise<string> {
    const task = resolveTask(await this.repository.load(cwd), id);
    if (!task.worktreePath) throw new Error("Task has no worktree.");
    const base = task.baseBranch ?? await this.git.defaultBranch(cwd);
    return this.git.diffWorktree(cwd, task.worktreePath, base);
  }

  async integrate(cwd: string, id: string): Promise<string> {
    const tasks = await this.repository.load(cwd);
    const task = resolveTask(tasks, id);
    if (!task.worktreePath) throw new Error("Task has no worktree.");
    const base = task.baseBranch ?? await this.git.defaultBranch(cwd);
    const hash = await this.git.integrateWorktree(cwd, task.worktreePath, base);
    task.status = "completed";
    task.completedAt = new Date().toISOString();
    await this.repository.save(cwd, tasks);
    return hash;
  }

  async cleanup(cwd: string, id: string): Promise<void> {
    const tasks = await this.repository.load(cwd);
    const task = resolveTask(tasks, id);
    if (!task.worktreePath) throw new Error("Task has no worktree.");
    const state = await this.git.worktreeStatus(cwd, task.worktreePath);
    if (state.dirty) throw new Error("Task worktree has uncommitted changes; cleanup refused.");
    const base = task.baseBranch ?? await this.git.defaultBranch(cwd);
    const branchDeleted = await this.git.removeWorktree(cwd, task.worktreePath, base);
    delete task.worktreePath;
    if (branchDeleted) {
      delete task.branch;
      delete task.baseBranch;
    }
    await this.repository.save(cwd, tasks);
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
    if (task.worktreePath) throw new Error("Clean up the task worktree before deleting this task.");
    tasks.splice(tasks.indexOf(task), 1);
    await this.repository.save(cwd, tasks);
    return task;
  }

  async commit(cwd: string, id: string, supervisor: string): Promise<{ task: Task; hash: string }> {
    const tasks = await this.repository.load(cwd);
    const task = resolveTask(tasks, id);
    if (task.status !== "open") throw new Error("Cannot commit to a completed task.");
    if (!supervisor.trim()) throw new Error("Set BIOARC_SUPERVISOR to the supervisor's name.");
    const worktree = task.worktreePath ?? cwd;
    if (task.worktreePath) await this.git.syncWorktree(cwd, task.worktreePath, task.baseBranch ?? await this.git.defaultBranch(cwd));
    if (!await this.git.hasStagedChanges(worktree)) throw new Error("Stage the task's changes first; no staged changes found.");
    const hash = await this.git.commit(worktree, commitSubject(task.title, supervisor.trim()));
    task.commits.push(hash);
    await this.repository.save(cwd, tasks);
    return { task, hash };
  }
}
