import { dirname } from "node:path";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import type { GitPort } from "../ports";

export class ExtensionGitAdapter implements GitPort {
  constructor(private readonly pi: ExtensionAPI) {}

  private async run(cwd: string, args: string[]): Promise<string> {
    const result = await this.pi.exec("git", args, { cwd });
    if (result.code !== 0) throw new Error(result.stderr || `git ${args[0]} failed.`);
    return result.stdout.trim();
  }

  getGitDirectory(cwd: string): Promise<string> {
    return this.run(cwd, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  }

  async getProjectRoot(cwd: string): Promise<string> {
    return dirname(await this.getGitDirectory(cwd));
  }

  async hasStagedChanges(cwd: string): Promise<boolean> {
    const result = await this.pi.exec("git", ["diff", "--cached", "--quiet"], { cwd });
    if (result.code === 0) return false;
    if (result.code === 1) return true;
    throw new Error(result.stderr || "Unable to inspect staged changes.");
  }

  async commit(cwd: string, message: string): Promise<string> {
    await this.run(cwd, ["commit", "-m", message]);
    return this.run(cwd, ["rev-parse", "HEAD"]);
  }
}
