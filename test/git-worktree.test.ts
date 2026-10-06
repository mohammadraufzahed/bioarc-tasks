import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import { ExtensionGitAdapter } from "../src/adapters/git-adapter";
import { TaskService } from "../src/application/task-service";
import { JsonTaskRepository } from "../src/adapters/json-task-repository";
import { GitSubmoduleUpdater } from "../src/adapters/git-submodule-updater";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

test("task branch syncs with detected base, integrates, and only base is pushed", async () => {
  const root = mkdtempSync(join(tmpdir(), "bioarc-git-test-"));
  roots.push(root);
  const origin = join(root, "origin.git");
  const main = join(root, "main");
  execFileSync("git", ["init", "--bare", "--initial-branch=master", origin]);
  execFileSync("git", ["clone", origin, main]);
  execFileSync("git", ["config", "user.name", "BioArc Test"], { cwd: main });
  execFileSync("git", ["config", "user.email", "test@example.invalid"], { cwd: main });
  writeFileSync(join(main, "base.txt"), "base\n");
  execFileSync("git", ["add", "base.txt"], { cwd: main });
  execFileSync("git", ["commit", "-m", "base"], { cwd: main });
  execFileSync("git", ["push", "origin", "master"], { cwd: main });

  const adapter = new ExtensionGitAdapter({
    exec: async (command: string, args: string[], options: { cwd: string }) => {
      const result = spawnSync(command, args, { cwd: options.cwd, encoding: "utf8" });
      return { code: result.status ?? 1, stdout: result.stdout, stderr: result.stderr };
    },
  } as never);
  const base = await adapter.defaultBranch(main);
  assert.equal(base, "master");
  const repository = new JsonTaskRepository(adapter);
  const service = new TaskService(repository, adapter);
  const task = await service.create(main, "task one");
  const parallelTask = await service.create(main, "task two");
  assert.equal(task.baseBranch, base);
  const branch = task.branch;
  assert.ok(branch);
  const worktree = task.worktreePath;
  assert.ok(worktree);
  const parallelBranch = parallelTask.branch;
  assert.ok(parallelBranch);
  const parallelWorktree = parallelTask.worktreePath;
  assert.ok(parallelWorktree);
  assert.notEqual(parallelWorktree, worktree);
  assert.equal((await repository.load(main)).length, 2);
  execFileSync("git", ["config", "user.name", "BioArc Test"], { cwd: worktree });
  execFileSync("git", ["config", "user.email", "test@example.invalid"], { cwd: worktree });
  writeFileSync(join(worktree, "task.txt"), "task change\n");
  execFileSync("git", ["add", "task.txt"], { cwd: worktree });
  const taskCommit = await adapter.commit(worktree, "task change");
  assert.match(taskCommit, /^[0-9a-f]{40}$/);

  writeFileSync(join(main, "main.txt"), "base advanced\n");
  execFileSync("git", ["add", "main.txt"], { cwd: main });
  execFileSync("git", ["commit", "-m", "advance base"], { cwd: main });
  execFileSync("git", ["push", "origin", base], { cwd: main });
  await adapter.syncWorktree(main, worktree, base);
  assert.equal(execFileSync("git", ["merge-base", "--is-ancestor", `origin/${base}`, "HEAD"], { cwd: worktree }).length, 0);

  const integrated = await adapter.integrateWorktree(main, worktree, base);
  assert.match(integrated, /^[0-9a-f]{40}$/);
  const remoteMain = execFileSync("git", ["--git-dir", origin, "show", `${base}:task.txt`], { encoding: "utf8" });
  assert.equal(remoteMain, "task change\n");
  const remoteRefs = execFileSync("git", ["--git-dir", origin, "for-each-ref", "--format=%(refname:short)", "refs/heads"], { encoding: "utf8" });
  assert.equal(remoteRefs.trim(), base);

  await adapter.removeWorktree(main, worktree, base);
  assert.equal(execFileSync("git", ["branch", "--list", branch], { cwd: main, encoding: "utf8" }).trim(), "");
  await adapter.removeWorktree(main, parallelWorktree, base);
  assert.equal(execFileSync("git", ["branch", "--list", parallelBranch], { cwd: main, encoding: "utf8" }).trim(), "");
  assert.equal(readFileSync(join(main, "task.txt"), "utf8"), "task change\n");
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
  mkdirSync(join(project, ".omp", "extensions"), { recursive: true });
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
  } as never);
  await updater.update(project);
  assert.equal(readFileSync(join(extension, "version.txt"), "utf8"), "two\n");
});

test("cleanup refuses dirty worktree", async () => {
  const root = mkdtempSync(join(tmpdir(), "bioarc-git-dirty-test-"));
  roots.push(root);
  const origin = join(root, "origin.git");
  const main = join(root, "main");
  execFileSync("git", ["init", "--bare", "--initial-branch=master", origin]);
  execFileSync("git", ["clone", origin, main]);
  execFileSync("git", ["config", "user.name", "BioArc Test"], { cwd: main });
  execFileSync("git", ["config", "user.email", "test@example.invalid"], { cwd: main });
  writeFileSync(join(main, "base.txt"), "base\n");
  execFileSync("git", ["add", "base.txt"], { cwd: main });
  execFileSync("git", ["commit", "-m", "base"], { cwd: main });
  execFileSync("git", ["push", "origin", "master"], { cwd: main });
  const adapter = new ExtensionGitAdapter({
    exec: async (command: string, args: string[], options: { cwd: string }) => {
      const result = spawnSync(command, args, { cwd: options.cwd, encoding: "utf8" });
      return { code: result.status ?? 1, stdout: result.stdout, stderr: result.stderr };
    },
  } as never);
  const worktree = await adapter.createWorktree(main, "dirty-task", "bioarc/dirty-task", "master");
  writeFileSync(join(worktree, "uncommitted.txt"), "keep me\n");
  const task = { id: "dirty-task", title: "dirty", status: "open" as const, createdAt: new Date().toISOString(), commits: [], branch: "bioarc/dirty-task", baseBranch: "master", worktreePath: worktree };
  const service = new TaskService({ load: async () => [task], save: async () => {} }, adapter);
  await assert.rejects(service.cleanup(main, "dirty-task"), /uncommitted changes/);
  assert.equal(readFileSync(join(worktree, "uncommitted.txt"), "utf8"), "keep me\n");
});
