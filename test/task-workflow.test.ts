import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import { ExtensionGitAdapter } from "../src/adapters/git-adapter";
import { GitSubmoduleUpdater } from "../src/adapters/git-submodule-updater";
import { JsonTaskRepository } from "../src/adapters/json-task-repository";
import { TaskService } from "../src/application/task-service";
import { commitSubject } from "../src/domain/task";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

test("task commits use only the current checkout and record the selected task", async () => {
  const root = mkdtempSync(join(tmpdir(), "bioarc-task-test-"));
  roots.push(root);
  execFileSync("git", ["init", "--initial-branch=master", root]);
  execFileSync("git", ["config", "user.name", "BioArc Test"], { cwd: root });
  execFileSync("git", ["config", "user.email", "test@example.invalid"], { cwd: root });
  writeFileSync(join(root, "source.txt"), "base\n");
  execFileSync("git", ["add", "source.txt"], { cwd: root });
  execFileSync("git", ["commit", "-m", "base"], { cwd: root });

  const git = new ExtensionGitAdapter({
    exec: async (command: string, args: string[], options: { cwd: string }) => {
      if (command !== "git") throw new Error(`Unexpected command: ${command}`);
      const result = spawnSync(command, args, { cwd: options.cwd, encoding: "utf8" });
      return { code: result.status ?? 1, stdout: result.stdout, stderr: result.stderr };
    },
  } as never);
  const repository = new JsonTaskRepository(git);
  const service = new TaskService(repository, git);
  const task = await service.create(root, "تسک یک");
  assert.equal((await service.select(root, task.id)).id, task.id);
  assert.equal(execFileSync("git", ["branch", "--show-current"], { cwd: root, encoding: "utf8" }).trim(), "master");
  assert.equal(execFileSync("git", ["worktree", "list", "--porcelain"], { cwd: root, encoding: "utf8" }).split("\n").filter((line) => line.startsWith("worktree ")).length, 1);
  await assert.rejects(service.commit(root, task.id, "سرپرست"), /Stage the task's changes first/);

  writeFileSync(join(root, "source.txt"), "task change\n");
  execFileSync("git", ["add", "source.txt"], { cwd: root });
  const result = await service.commit(root, task.id, "سرپرست");
  assert.equal(execFileSync("git", ["log", "-1", "--format=%s"], { cwd: root, encoding: "utf8" }).trim(), "نوع کامیت: تسک میزیتو عنوان تسک: تسک یک فرد محول کننده: سرپرست");
  assert.equal((await repository.load(root))[0]?.commits.at(-1), result.hash);
  assert.throws(() => commitSubject("English title", "سرپرست"), /پیام کامیت انگلیسی مجاز نیست/);
});

test("self-update pulls the configured extension checkout without a parent gitlink", async () => {
  const root = mkdtempSync(join(tmpdir(), "bioarc-update-test-"));
  roots.push(root);
  const origin = join(root, "extension.git");
  const seed = join(root, "seed");
  const project = join(root, "project");
  const extension = join(project, ".omp", "extensions", "bioarc-tasks");
  execFileSync("git", ["init", "--bare", "--initial-branch=master", origin]);
  execFileSync("git", ["clone", origin, seed]);
  execFileSync("git", ["config", "user.name", "BioArc Test"], { cwd: seed });
  execFileSync("git", ["config", "user.email", "test@example.invalid"], { cwd: seed });
  writeFileSync(join(seed, "version.txt"), "one\n");
  execFileSync("git", ["add", "version.txt"], { cwd: seed });
  execFileSync("git", ["commit", "-m", "one"], { cwd: seed });
  execFileSync("git", ["push", "origin", "master"], { cwd: seed });
  execFileSync("git", ["clone", origin, extension]);
  writeFileSync(join(seed, "version.txt"), "two\n");
  execFileSync("git", ["add", "version.txt"], { cwd: seed });
  execFileSync("git", ["commit", "-m", "two"], { cwd: seed });
  execFileSync("git", ["push", "origin", "master"], { cwd: seed });
  const updater = new GitSubmoduleUpdater({
    exec: async (command: string, args: string[], options: { cwd: string }) => {
      const result = spawnSync(command, args, { cwd: options.cwd, encoding: "utf8" });
      return { code: result.status ?? 1, stdout: result.stdout, stderr: result.stderr };
    },
  } as never, { getProjectRoot: async () => project } as never);
  await updater.update(project);
  assert.equal(readFileSync(join(extension, "version.txt"), "utf8"), "two\n");
});
