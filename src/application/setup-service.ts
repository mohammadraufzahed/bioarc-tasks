import type { PluginUpdater, ProjectConfigPort } from "../ports";

export class SetupService {
  constructor(
    private readonly config: ProjectConfigPort,
    private readonly updater: PluginUpdater,
  ) {}

  supervisor(cwd: string): Promise<string> {
    return this.config.getSupervisor(cwd);
  }

  async configureSupervisor(cwd: string, supervisor: string): Promise<void> {
    const value = supervisor.trim();
    if (!value) throw new Error("Supervisor name cannot be empty.");
    await this.config.setSupervisor(cwd, value);
  }

  update(cwd: string): Promise<void> {
    return this.updater.update(cwd);
  }
}
