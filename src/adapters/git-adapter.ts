import { mkdir } from "node:fs/promises";
import { accessSync, constants } from "node:fs";
import { basename, delimiter, dirname, join } from "node:path";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import type { GitPort } from "../ports";

export function resolveGitExecutable(): string {
  for (const directory of (process.env.PATH ?? "").split(delimiter)) {
    if (!directory) continue;
    const executable = join(directory, "git");
    try {
      accessSync(executable, constants.X_OK);
      return executable;
    } catch {}
  }
  throw new Error("Git executable not found on PATH.");
}

export class ExtensionGitAdapter implements GitPort {
  private readonly gitExecutable = resolveGitExecutable();
  constructor(private readonly pi: ExtensionAPI) {}

  private async run(cwd: string, args: string[]): Promise<string> {
    const result = await this.pi.exec(this.gitExecutable, args, { cwd });
    if (result.code !== 0) throw new Error(result.stderr || `git ${args[0]} failed.`);
    return result.stdout.trim();
  }

  getGitDirectory(cwd: string): Promise<string> {
    return this.run(cwd, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  }

  async getProjectRoot(cwd: string): Promise<string> {
    return this.run(cwd, ["rev-parse", "--show-toplevel"]);
  }

  async createTaskWorktree(cwd: string, taskId: string): Promise<string> {
    const root = await this.getProjectRoot(cwd);
    const target = join(dirname(root), `${basename(root)}-worktrees`, taskId.slice(0, 8));
    await mkdir(dirname(target), { recursive: true });
    await this.run(cwd, ["worktree", "add", "-b", `bioarc-task/${taskId.slice(0, 8)}`, target, "HEAD"]);
    return target;
  }

  async hasStagedChanges(cwd: string): Promise<boolean> {
    const result = await this.pi.exec(this.gitExecutable, ["diff", "--cached", "--quiet"], { cwd });
    if (result.code === 0) return false;
    if (result.code === 1) return true;
    throw new Error(result.stderr || "Unable to inspect staged changes.");
  }

  async commit(cwd: string, message: string): Promise<string> {
    await this.run(cwd, ["commit", "-m", message]);
    return this.run(cwd, ["rev-parse", "HEAD"]);
  }
}
