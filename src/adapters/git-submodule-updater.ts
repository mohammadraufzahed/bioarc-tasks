import { resolve } from "node:path";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import type { GitPort, PluginUpdater } from "../ports";

export class GitSubmoduleUpdater implements PluginUpdater {
  constructor(private readonly pi: ExtensionAPI, private readonly git: GitPort) {}

  async update(cwd: string): Promise<void> {
    const extension = resolve(await this.git.getProjectRoot(cwd), ".omp/extensions/bioarc-tasks");
    const result = await this.pi.exec("git", ["pull", "--ff-only", "origin", "master"], { cwd: extension });
    if (result.code !== 0) throw new Error(result.stderr || "Plugin update failed; check for local extension changes.");
  }
}
