import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import { ExtensionGitAdapter } from "../src/adapters/git-adapter";
import { TaskService } from "../src/application/task-service";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

test("task branch syncs with main, integrates, and only main is pushed", async () => {
  const root = mkdtempSync(join(tmpdir(), "bioarc-git-test-"));
  roots.push(root);
  const origin = join(root, "origin.git");
  const main = join(root, "main");
  execFileSync("git", ["init", "--bare", "--initial-branch=main", origin]);
  execFileSync("git", ["clone", origin, main]);
  execFileSync("git", ["config", "user.name", "BioArc Test"], { cwd: main });
  execFileSync("git", ["config", "user.email", "test@example.invalid"], { cwd: main });
  writeFileSync(join(main, "base.txt"), "base\n");
  execFileSync("git", ["add", "base.txt"], { cwd: main });
  execFileSync("git", ["commit", "-m", "base"], { cwd: main });
  execFileSync("git", ["push", "origin", "main"], { cwd: main });

  const adapter = new ExtensionGitAdapter({
    exec: async (command: string, args: string[], options: { cwd: string }) => {
      const result = spawnSync(command, args, { cwd: options.cwd, encoding: "utf8" });
      return { code: result.status ?? 1, stdout: result.stdout, stderr: result.stderr };
    },
  } as never);
  const worktree = await adapter.createWorktree(main, "task-123", "bioarc/task-123", "main");
  const parallelWorktree = await adapter.createWorktree(main, "task-456", "bioarc/task-456", "main");
  assert.notEqual(parallelWorktree, worktree);
  execFileSync("git", ["config", "user.name", "BioArc Test"], { cwd: worktree });
  execFileSync("git", ["config", "user.email", "test@example.invalid"], { cwd: worktree });
  writeFileSync(join(worktree, "task.txt"), "task change\n");
  execFileSync("git", ["add", "task.txt"], { cwd: worktree });
  const taskCommit = await adapter.commit(worktree, "task change");
  assert.match(taskCommit, /^[0-9a-f]{40}$/);

  writeFileSync(join(main, "main.txt"), "main advanced\n");
  execFileSync("git", ["add", "main.txt"], { cwd: main });
  execFileSync("git", ["commit", "-m", "advance main"], { cwd: main });
  execFileSync("git", ["push", "origin", "main"], { cwd: main });
  await adapter.syncWorktree(main, worktree, "main");
  assert.equal(execFileSync("git", ["merge-base", "--is-ancestor", "origin/main", "HEAD"], { cwd: worktree }).length, 0);

  const integrated = await adapter.integrateWorktree(main, worktree, "main");
  assert.match(integrated, /^[0-9a-f]{40}$/);
  const remoteMain = execFileSync("git", ["--git-dir", origin, "show", "main:task.txt"], { encoding: "utf8" });
  assert.equal(remoteMain, "task change\n");
  const remoteRefs = execFileSync("git", ["--git-dir", origin, "for-each-ref", "--format=%(refname:short)", "refs/heads"], { encoding: "utf8" });
  assert.equal(remoteRefs.trim(), "main");

  await adapter.removeWorktree(main, worktree);
  assert.equal(execFileSync("git", ["branch", "--list", "bioarc/task-123"], { cwd: main, encoding: "utf8" }).trim(), "");
  await adapter.removeWorktree(main, parallelWorktree);
  assert.equal(execFileSync("git", ["branch", "--list", "bioarc/task-456"], { cwd: main, encoding: "utf8" }).trim(), "");
  assert.equal(readFileSync(join(main, "task.txt"), "utf8"), "task change\n");
});

test("cleanup refuses dirty worktree", async () => {
  const root = mkdtempSync(join(tmpdir(), "bioarc-git-dirty-test-"));
  roots.push(root);
  const origin = join(root, "origin.git");
  const main = join(root, "main");
  execFileSync("git", ["init", "--bare", "--initial-branch=main", origin]);
  execFileSync("git", ["clone", origin, main]);
  execFileSync("git", ["config", "user.name", "BioArc Test"], { cwd: main });
  execFileSync("git", ["config", "user.email", "test@example.invalid"], { cwd: main });
  writeFileSync(join(main, "base.txt"), "base\n");
  execFileSync("git", ["add", "base.txt"], { cwd: main });
  execFileSync("git", ["commit", "-m", "base"], { cwd: main });
  execFileSync("git", ["push", "origin", "main"], { cwd: main });
  const adapter = new ExtensionGitAdapter({
    exec: async (command: string, args: string[], options: { cwd: string }) => {
      const result = spawnSync(command, args, { cwd: options.cwd, encoding: "utf8" });
      return { code: result.status ?? 1, stdout: result.stdout, stderr: result.stderr };
    },
  } as never);
  const worktree = await adapter.createWorktree(main, "dirty-task", "bioarc/dirty-task", "main");
  writeFileSync(join(worktree, "uncommitted.txt"), "keep me\n");
  const task = { id: "dirty-task", title: "dirty", status: "open" as const, createdAt: new Date().toISOString(), commits: [], branch: "bioarc/dirty-task", worktreePath: worktree };
  const service = new TaskService({ load: async () => [task], save: async () => {} }, adapter);
  await assert.rejects(service.cleanup(main, "dirty-task"), /uncommitted changes/);
  assert.equal(readFileSync(join(worktree, "uncommitted.txt"), "utf8"), "keep me\n");
});
