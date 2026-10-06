import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ProjectConfigPort } from "../ports";

interface BioArcConfig {
  supervisor?: string;
}

export class JsonProjectConfig implements ProjectConfigPort {
  private path(cwd: string): string {
    return join(cwd, ".omp", "bioarc-tasks.json");
  }

  async getSupervisor(cwd: string): Promise<string> {
    const path = this.path(cwd);
    if (!existsSync(path)) return "";
    const config = JSON.parse(readFileSync(path, "utf8")) as BioArcConfig;
    return typeof config.supervisor === "string" ? config.supervisor : "";
  }

  async setSupervisor(cwd: string, supervisor: string): Promise<void> {
    const path = this.path(cwd);
    mkdirSync(join(cwd, ".omp"), { recursive: true });
    writeFileSync(path, `${JSON.stringify({ supervisor }, null, 2)}\n`, { mode: 0o600 });
  }
}
