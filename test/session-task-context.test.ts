import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import extension from "../index";

type Hook = (...args: unknown[]) => unknown;
type RegisteredTool = { execute: Hook };

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((part: unknown) => typeof part === "string");
}

function getSystemPrompt(value: unknown): string[] | undefined {
  if (!value || typeof value !== "object" || !("systemPrompt" in value)) return undefined;
  return isStringArray(value.systemPrompt) ? value.systemPrompt : undefined;
}

test("selected task is injected only into its session's agent context", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "bioarc-session-task-"));
  try {
    mkdirSync(join(cwd, ".git"));
    const tasks = [
      { id: "task-session-a", title: "Task for session A", status: "open", createdAt: "2026-01-01T00:00:00.000Z", commits: [] },
      { id: "task-session-b", title: "Task for session B", status: "open", createdAt: "2026-01-01T00:00:00.000Z", commits: [] },
    ];
    writeFileSync(join(cwd, ".git", "bioarc-tasks.json"), JSON.stringify(tasks));
    const handlers = new Map<string, Hook>();
    const tools = new Map<string, RegisteredTool>();
    const pi = {
      setLabel() {},
      on(name: string, handler: Hook) { handlers.set(name, handler); },
      registerTool(tool: { name: string; execute: Hook }) { tools.set(tool.name, tool); },
      registerCommand() {},
      appendEntry: async () => {},
      zod: { object: (value: unknown) => value, string: () => ({}) },
      exec: async (_command: string, args: string[], options: { cwd: string }) => ({
        code: 0,
        stdout: args[0] === "symbolic-ref" ? "origin/master" : args.includes("--git-common-dir") ? join(options.cwd, ".git") : ".git",
        stderr: "",
      }),
    };
    extension(pi as never);
    const session = (id: string) => ({ cwd, sessionManager: { getSessionId: () => id, getBranch: () => [] } });
    const sessionA = session("session-a");
    const sessionB = session("session-b");
    const sessionC = session("session-c");
    handlers.get("session_start")!({}, sessionA);
    handlers.get("session_start")!({}, sessionB);
    handlers.get("session_start")!({}, sessionC);
    const select = tools.get("bioarc_task_select")!;
    const commit = tools.get("bioarc_task_commit")!;
    await assert.rejects(async () => commit.execute("no-active", { id: "task-session-a" }, undefined, undefined, sessionC), /No task selected for this session/);
    const selectionResult = await select.execute("call-a", { id: "task-session-a" }, undefined, undefined, sessionA);
    assert.ok(JSON.stringify(selectionResult).includes("Work remains in the current checkout"));

    const beforeAgentStart = handlers.get("before_agent_start")!;
    const contextA = await beforeAgentStart({ systemPrompt: ["base prompt"] }, sessionA);
    const contextB = await beforeAgentStart({ systemPrompt: ["base prompt"] }, sessionB);
    const promptA = getSystemPrompt(contextA);
    assert.ok(promptA);
    assert.match(promptA.at(-1) ?? "", /Task for session A/);
    assert.match(promptA.at(-1) ?? "", /Current checkout/);
    assert.match(promptA.at(-1) ?? "", /Tasks are labels only/);
    assert.match(promptA.at(-1) ?? "", /bioarc_task_commit/);
    assert.match(promptA.at(-1) ?? "", /Do not push unless the user explicitly asks/);
    assert.match(promptA.at(-1) ?? "", /never use generic OMP Git tools/);
    assert.match(promptA.at(-1) ?? "", /ask which task/);
    assert.match(promptA.at(-1) ?? "", /no English\/free-form commit messages/);
    const promptB = getSystemPrompt(contextB);
    assert.ok(promptB);
    assert.match(promptB.at(-1) ?? "", /No task is selected for this session/);
    assert.match(promptB.at(-1) ?? "", /ask the user which task/);

    await select.execute("call-b", { id: "task-session-b" }, undefined, undefined, sessionB);
    await assert.rejects(async () => commit.execute("wrong-task", { id: "task-session-a" }, undefined, undefined, sessionB), /Only the session-selected task/);
    const stillA = await beforeAgentStart({ systemPrompt: ["base prompt"] }, sessionA);
    const nowB = await beforeAgentStart({ systemPrompt: ["base prompt"] }, sessionB);
    const promptStillA = getSystemPrompt(stillA);
    const promptNowB = getSystemPrompt(nowB);
    assert.ok(promptStillA);
    assert.ok(promptNowB);
    assert.match(promptStillA.at(-1) ?? "", /Task for session A/);
    assert.match(promptNowB.at(-1) ?? "", /Task for session B/);
    const create = tools.get("bioarc_task_create")!;
    const created = await create.execute("call-create", { title: "New task" }, undefined, undefined, sessionB);
    const createdContext = await beforeAgentStart({ systemPrompt: ["base prompt"] }, sessionB);
    const createdPrompt = getSystemPrompt(createdContext);
    assert.ok(createdPrompt);
    assert.match(createdPrompt.at(-1) ?? "", /New task/);

    const clearResult = await select.execute("call-clear", { id: "clear" }, undefined, undefined, sessionA);
    assert.ok(JSON.stringify(clearResult).includes("Current checkout is unchanged"));
    const clearedContext = await beforeAgentStart({ systemPrompt: ["base prompt"] }, sessionA);
    const clearedPrompt = getSystemPrompt(clearedContext);
    assert.ok(clearedPrompt);
    assert.match(clearedPrompt.at(-1) ?? "", /No task is selected for this session/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
