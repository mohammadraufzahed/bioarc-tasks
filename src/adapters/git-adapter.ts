import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import type { GitPort } from "../ports";

export class ExtensionGitAdapter implements GitPort {
  constructor(private readonly pi: ExtensionAPI) {}

  async getGitDirectory(cwd: string): Promise<string> {
    const result = await this.pi.exec("git", ["rev-parse", "--git-dir"], { cwd });
    if (result.code !== 0) throw new Error("Run this command inside a Git repository.");
    return result.stdout.trim();
  }

  async hasStagedChanges(cwd: string): Promise<boolean> {
    const result = await this.pi.exec("git", ["diff", "--cached", "--quiet"], { cwd });
    if (result.code === 0) return false;
    if (result.code === 1) return true;
    throw new Error(result.stderr || "Unable to inspect staged changes.");
  }

  async commit(cwd: string, message: string): Promise<string> {
    const result = await this.pi.exec("git", ["commit", "-m", message], { cwd });
    if (result.code !== 0) throw new Error(result.stderr || "Git commit failed.");
    const head = await this.pi.exec("git", ["rev-parse", "HEAD"], { cwd });
    if (head.code !== 0) throw new Error(head.stderr || "Unable to read committed revision.");
    return head.stdout.trim();
  }
}
