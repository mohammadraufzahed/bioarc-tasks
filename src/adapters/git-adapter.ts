import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import type { GitPort } from "../ports";

export class ExtensionGitAdapter implements GitPort {
  constructor(private readonly pi: ExtensionAPI) {}

  private async run(cwd: string, args: string[]): Promise<string> {
    const result = await this.pi.exec("git", args, { cwd });
    if (result.code !== 0) throw new Error(result.stderr || `git ${args[0]} failed.`);
    return result.stdout.trim();
  }

  async getGitDirectory(cwd: string): Promise<string> {
    const result = await this.pi.exec("git", ["rev-parse", "--git-dir"], { cwd });
    if (result.code !== 0) throw new Error("Run this command inside a Git repository.");
    return result.stdout.trim();
  }
  async defaultBranch(cwd: string): Promise<string> {
    const localHead = await this.pi.exec("git", ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"], { cwd });
    if (localHead.code === 0 && localHead.stdout.trim().startsWith("origin/")) return localHead.stdout.trim().slice("origin/".length);
    const remoteHead = await this.pi.exec("git", ["ls-remote", "--symref", "origin", "HEAD"], { cwd });
    const match = remoteHead.stdout.match(/^ref: refs\/heads\/(.+)\tHEAD$/m);
    if (remoteHead.code !== 0 || !match?.[1]) throw new Error(remoteHead.stderr || "Unable to detect origin's default branch.");
    return match[1];
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

  async ensureWorktree(cwd: string, taskId: string, branch: string, base: string, existingPath?: string): Promise<string> {
    if (existingPath) {
      const existing = await this.pi.exec("git", ["rev-parse", "--show-toplevel"], { cwd: existingPath });
      if (existing.code === 0) {
        const existingBranch = await this.run(existingPath, ["branch", "--show-current"]);
        if (existingBranch !== branch) throw new Error(`Task worktree is on branch ${existingBranch || "(detached)"}, expected ${branch}.`);
        return existingPath;
      }
    }
    await this.run(cwd, ["fetch", "origin", base]);
    const commonDir = await this.run(cwd, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
    const repoKey = createHash("sha256").update(commonDir).digest("hex").slice(0, 10);
    const path = join(homedir(), ".omp", "wt", `${basename(cwd)}-${repoKey}-${taskId}`);
    const branchExists = await this.pi.exec("git", ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`], { cwd });
    if (branchExists.code !== 0 && branchExists.code !== 1) throw new Error(branchExists.stderr || "Unable to inspect the task branch.");
    const args = branchExists.code === 0
      ? ["worktree", "add", "-C", cwd, path, branch, "--quiet"]
      : ["worktree", "add", "-C", cwd, "-b", branch, path, `origin/${base}`, "--quiet"];
    const result = await this.pi.exec("omp", args, { cwd });
    if (result.code !== 0) throw new Error(result.stderr || result.stdout || "OMP could not create the task worktree.");
    return path;
  }

  async removeWorktree(cwd: string, path: string, base: string): Promise<boolean> {
    const branch = await this.run(path, ["branch", "--show-current"]);
    await this.run(cwd, ["worktree", "remove", path]);
    const merged = await this.run(cwd, ["branch", "--merged", base, "--list", branch]);
    if (!merged) return false;
    await this.run(cwd, ["branch", "-d", branch]);
    return true;
  }

  async worktreeStatus(cwd: string, path: string): Promise<{ branch: string; dirty: boolean }> {
    const branch = await this.run(path, ["branch", "--show-current"]);
    const dirty = (await this.run(path, ["status", "--porcelain"])).length > 0;
    return { branch, dirty };
  }

  async syncWorktree(cwd: string, path: string, base: string): Promise<void> {
    await this.run(cwd, ["fetch", "origin", base]);
    await this.run(path, ["merge", "--no-edit", `origin/${base}`]);
  }

  async diffWorktree(cwd: string, path: string, base: string): Promise<string> {
    await this.run(cwd, ["fetch", "origin", base]);
    return this.run(path, ["diff", "--no-ext-diff", "--stat", `origin/${base}...HEAD`]);
  }

  async integrateWorktree(cwd: string, path: string, base: string): Promise<string> {
    const status = await this.run(cwd, ["status", "--porcelain"]);
    if (status) throw new Error("Base worktree has uncommitted changes; refusing integration.");
    await this.run(cwd, ["fetch", "origin", base]);
    const currentBranch = await this.run(cwd, ["branch", "--show-current"]);
    if (currentBranch !== base) throw new Error(`Switch the base worktree to ${base} before integration.`);
    const taskStatus = await this.run(path, ["status", "--porcelain"]);
    if (taskStatus) throw new Error("Task worktree has uncommitted changes; commit or clean them before integration.");
    await this.run(path, ["merge", "--no-edit", `origin/${base}`]);
    const remoteHead = await this.run(cwd, ["rev-parse", `origin/${base}`]);
    const localHead = await this.run(cwd, ["rev-parse", "HEAD"]);
    if (remoteHead !== localHead) throw new Error(`Local ${base} is not aligned with origin/${base}; update it before integrating.`);
    const branch = await this.run(path, ["branch", "--show-current"]);
    const mergeResult = await this.pi.exec("git", ["merge", "--no-ff", "--no-edit", branch], { cwd });
    if (mergeResult.code !== 0) {
      await this.pi.exec("git", ["merge", "--abort"], { cwd });
      throw new Error(mergeResult.stderr || "Merge failed; task worktree was preserved.");
    }
    const push = await this.pi.exec("git", ["push", "origin", base], { cwd });
    if (push.code !== 0) throw new Error(push.stderr || `Push failed; local ${base} contains the integration. Update and retry pushing ${base}.`);
    return await this.run(cwd, ["rev-parse", "HEAD"]);
  }
}
