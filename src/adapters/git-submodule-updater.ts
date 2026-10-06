import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import type { PluginUpdater } from "../ports";

export class GitSubmoduleUpdater implements PluginUpdater {
  constructor(private readonly pi: ExtensionAPI) {}

  async update(cwd: string): Promise<void> {
    const result = await this.pi.exec("git", ["submodule", "update", "--remote", "--merge", "--", ".omp/extensions/bioarc-tasks"], { cwd });
    if (result.code !== 0) throw new Error(result.stderr || "Plugin update failed; check for local submodule changes.");
  }
}
