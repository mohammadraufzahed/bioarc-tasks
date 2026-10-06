import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { GitPort, ProjectConfigPort } from "../ports";

interface BioArcConfig {
  supervisor?: string;
}

export class JsonProjectConfig implements ProjectConfigPort {
  constructor(private readonly git: GitPort) {}

  async getSupervisor(cwd: string): Promise<string> {
    const path = join(await this.git.getProjectRoot(cwd), ".omp", "bioarc-tasks.json");
    if (!existsSync(path)) return "";
    const config = JSON.parse(readFileSync(path, "utf8")) as BioArcConfig;
    return typeof config.supervisor === "string" ? config.supervisor : "";
  }

  async setSupervisor(cwd: string, supervisor: string): Promise<void> {
    const projectRoot = await this.git.getProjectRoot(cwd);
    const path = join(projectRoot, ".omp", "bioarc-tasks.json");
    mkdirSync(join(projectRoot, ".omp"), { recursive: true });
    writeFileSync(path, `${JSON.stringify({ supervisor }, null, 2)}\n`, { mode: 0o600 });
  }
}
