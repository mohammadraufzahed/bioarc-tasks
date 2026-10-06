import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { TaskService } from "./src/application/task-service";
import { SetupService } from "./src/application/setup-service";
import { ExtensionGitAdapter } from "./src/adapters/git-adapter";
import { GitSubmoduleUpdater } from "./src/adapters/git-submodule-updater";
import { JsonProjectConfig } from "./src/adapters/json-project-config";
import { JsonTaskRepository } from "./src/adapters/json-task-repository";
import { resolveTask } from "./src/domain/task";

const defaultType = "com.bioarc.tasks.session-default";
const actions = ["list", "create", "complete", "delete", "commit", "default", "select", "sync", "diff", "integrate", "cleanup", "setup", "update"];

export default function (pi: ExtensionAPI) {
  pi.setLabel("BioArc Tasks");
  const git = new ExtensionGitAdapter(pi);
  const tasks = new TaskService(new JsonTaskRepository(git), git);
  const setup = new SetupService(new JsonProjectConfig(), new GitSubmoduleUpdater(pi));
  const defaults = new Map<string, string>();
  let sessionCwd = process.cwd();

  pi.on("session_start", (_event, ctx) => {
    sessionCwd = ctx.cwd;
    let taskId = "";
    for (const entry of ctx.sessionManager.getBranch()) {
      if (entry.type === "custom" && entry.customType === defaultType && typeof entry.data?.taskId === "string") taskId = entry.data.taskId;
    }
    defaults.set(ctx.sessionManager.getSessionId(), taskId);
  });
  const setSessionTask = async (sessionId: string, taskId: string) => {
    defaults.set(sessionId, taskId);
    await pi.appendEntry(defaultType, { taskId });
  };
  const clearSessionTask = async (sessionId: string) => {
    defaults.delete(sessionId);
    await pi.appendEntry(defaultType, { taskId: "" });
  };

  pi.on("before_agent_start", async (event, ctx) => {
    const taskId = defaults.get(ctx.sessionManager.getSessionId());
    if (!taskId) return;
    const task = (await tasks.list(ctx.cwd)).find((candidate) => candidate.id === taskId && candidate.status === "open");
    if (!task) return;
    return {
      systemPrompt: [
        ...event.systemPrompt,
        `## Active BioArc task (session-scoped)\nTask ID: ${task.id}\nTask title (label only): ${JSON.stringify(task.title)}\nBase branch: ${task.baseBranch ?? "remote default"}\nTask branch: ${task.branch ?? "none"}\nTask worktree: ${task.worktreePath ?? "project working tree"}\nRules:\n- Make task changes only in the task worktree; do not edit the base checkout for this task.\n- Keep changes scoped to the selected task; inspect status and diff before committing.\n- Sync with the base branch before committing or integrating; use the BioArc task tools.\n- Commit only staged task changes with bioarc_task_commit; never push a task branch.\n- Integrate, push the base branch, complete, or clean up only when the user explicitly asks.\n- If worktree state or task intent is unclear, inspect it and ask before destructive or cross-task changes.`,
      ],
    };
  });

  const z = pi.zod;
  pi.registerTool({
    name: "bioarc_task_select",
    label: "Select task for this session",
    description: "Select an open task for this session's AI context; pass id 'clear' to deselect it.",
    parameters: z.object({ id: z.string() }),
    async execute(_id, params, _signal, _update, ctx) {
      const sessionId = ctx.sessionManager.getSessionId();
      if (params.id === "clear") {
        await clearSessionTask(sessionId);
        return { content: [{ type: "text", text: "Cleared active task for this session." }] };
      }
      const task = resolveTask(await tasks.list(ctx.cwd), params.id);
      if (task.status !== "open") throw new Error("Select an open task.");
      await setSessionTask(sessionId, task.id);
      return { content: [{ type: "text", text: `Selected ${task.id.slice(0, 8)} — ${task.title} for this session. Worktree: ${task.worktreePath ?? "project working tree"}` }] };
    },
  });
  pi.registerTool({
    name: "bioarc_task_create",
    label: "Create BioArc task worktree",
    description: "Create a task and isolated local worktree branch from the configured origin default branch.",
    parameters: z.object({ title: z.string() }),
    async execute(_id, params, _signal, _update, ctx) {
      const task = await tasks.create(ctx.cwd, params.title);
      await setSessionTask(ctx.sessionManager.getSessionId(), task.id);
      return { content: [{ type: "text", text: `Task ${task.id.slice(0, 8)} created and selected for this session. Base: ${task.baseBranch}; branch: ${task.branch}; worktree: ${task.worktreePath}` }] };
    },
  });
  pi.registerTool({
    name: "bioarc_task_list",
    label: "List BioArc tasks",
    description: "List task IDs, status, branches, and worktree paths.",
    parameters: z.object({}),
    async execute(_id, _params, _signal, _update, ctx) {
      const current = await tasks.list(ctx.cwd);
      const activeTaskId = defaults.get(ctx.sessionManager.getSessionId());
      return { content: [{ type: "text", text: current.map((task) => `${task.id.slice(0, 8)} [${task.status}]${task.id === activeTaskId ? " [active session task]" : ""} ${task.title} | base ${task.baseBranch ?? "remote default"} | ${task.branch ?? "no branch"} | ${task.worktreePath ?? "no worktree"}`).join("\n") || "No BioArc tasks." }] };
    },
  });
  pi.registerTool({
    name: "bioarc_task_sync",
    label: "Sync task with base branch",
    description: "Fetch the configured origin default branch and merge it into the task branch. Conflicts preserve the task worktree.",
    parameters: z.object({ id: z.string() }),
    async execute(_id, params, _signal, _update, ctx) {
      await tasks.sync(ctx.cwd, params.id);
      return { content: [{ type: "text", text: `Task ${params.id} synced with its base branch.` }] };
    },
  });
  pi.registerTool({
    name: "bioarc_task_diff",
    label: "Inspect task changes",
    description: "Show a diffstat for task changes relative to its configured base branch.",
    parameters: z.object({ id: z.string() }),
    async execute(_id, params, _signal, _update, ctx) {
      const diff = await tasks.diff(ctx.cwd, params.id);
      return { content: [{ type: "text", text: diff || "No task changes relative to its base branch." }] };
    },
  });
  pi.registerTool({
    name: "bioarc_task_commit",
    label: "Commit task changes",
    description: "Sync the task branch with its stored base branch, then commit staged changes using the required BioArc subject.",
    parameters: z.object({ id: z.string() }),
    async execute(_id, params, _signal, _update, ctx) {
      const supervisor = await setup.supervisor(ctx.cwd);
      if (!supervisor) throw new Error("Run /bioarc-task setup to configure the supervisor first.");
      const result = await tasks.commit(ctx.cwd, params.id, supervisor);
      return { content: [{ type: "text", text: `Committed ${result.hash} for task ${result.task.id.slice(0, 8)}.` }] };
    },
  });
  pi.registerTool({
    name: "bioarc_task_integrate",
    label: "Integrate task into base branch",
    description: "Sync task with its base branch, merge it into the clean local base worktree, and push only that base branch to origin.",
    parameters: z.object({ id: z.string() }),
    async execute(_id, params, _signal, _update, ctx) {
      const task = resolveTask(await tasks.list(ctx.cwd), params.id);
      const base = task.baseBranch ?? await git.defaultBranch(ctx.cwd);
      const hash = await tasks.integrate(ctx.cwd, task.id);
      if (defaults.get(ctx.sessionManager.getSessionId()) === task.id) await clearSessionTask(ctx.sessionManager.getSessionId());
      return { content: [{ type: "text", text: `Integrated task into ${base}; HEAD is ${hash}. Only ${base} was pushed.` }] };
    },
  });
  pi.registerTool({
    name: "bioarc_task_cleanup",
    label: "Clean up task worktree",
    description: "Remove a clean task worktree. Deletes its local branch only if merged into its base branch.",
    parameters: z.object({ id: z.string() }),
    async execute(_id, params, _signal, _update, ctx) {
      await tasks.cleanup(ctx.cwd, params.id);
      return { content: [{ type: "text", text: `Cleaned up task ${params.id}.` }] };
    },
  });
  pi.registerTool({
    name: "bioarc_task_status",
    label: "Inspect task worktree status",
    description: "Report task branch and whether its worktree has uncommitted changes.",
    parameters: z.object({ id: z.string() }),
    async execute(_id, params, _signal, _update, ctx) {
      const task = resolveTask(await tasks.list(ctx.cwd), params.id);
      if (!task.worktreePath) return { content: [{ type: "text", text: `Task ${task.id.slice(0, 8)} has no worktree.` }] };
      const status = await git.worktreeStatus(ctx.cwd, task.worktreePath);
      return { content: [{ type: "text", text: `Task ${task.id.slice(0, 8)}; branch ${status.branch}; worktree ${task.worktreePath}; ${status.dirty ? "uncommitted changes" : "clean"}.` }] };
    },
  });
  pi.registerCommand("bioarc-task", {
    description: "Manage BioArc tasks, project setup, and plugin updates",
    getArgumentCompletions: async (prefix) => {
      const [action, ...parts] = prefix.split(/\s+/);
      if (!action || !prefix.includes(" ")) return actions.filter((value) => value.startsWith(action ?? "")).map((value) => ({ value: `${value} `, label: value }));
      if (!["complete", "delete", "commit", "default", "select", "sync", "diff", "integrate", "cleanup"].includes(action)) return null;
      try {
        const taskPrefix = parts[0] ?? "";
        const available = await tasks.list(sessionCwd);
        const matching = available
          .filter((task) => !["commit", "default", "select"].includes(action) || task.status === "open")
          .filter((task) => task.id.startsWith(taskPrefix) || task.id.slice(0, 8).startsWith(taskPrefix))
          .map((task) => ({ value: `${action} ${task.id.slice(0, 8)}`, label: `${task.id.slice(0, 8)} — ${task.title}`, description: task.status }));
        if (["default", "select"].includes(action) && "clear".startsWith(taskPrefix)) matching.unshift({ value: `${action} clear`, label: "clear selected task", description: "Clear this session's active task" });
        return matching;
      } catch {
        return null;
      }
    },
    handler: async (args, ctx) => {
      const [action, ...rest] = args.trim().split(/\s+/);
      const sessionId = ctx.sessionManager.getSessionId();
      const defaultId = defaults.get(sessionId) ?? "";
      try {
        if (action === "list") {
          const current = await tasks.list(ctx.cwd);
          ctx.ui.notify(current.length ? current.map((task) => `${task.id.slice(0, 8)} [${task.status}]${task.id === defaultId ? " [active session task]" : ""} ${task.title} (${task.commits.length} commits)${task.branch ? ` — ${task.baseBranch ?? "base"} — ${task.branch} — ${task.worktreePath}` : ""}`).join("\n") : "No BioArc tasks.", "info");
        } else if (action === "create") {
          const task = await tasks.create(ctx.cwd, rest.join(" "));
          await setSessionTask(sessionId, task.id);
          ctx.ui.notify(`Created and selected ${task.id.slice(0, 8)}: ${task.title}\nBase: ${task.baseBranch}\nBranch: ${task.branch}\nWorktree: ${task.worktreePath}`, "success");
        } else if (["sync", "diff", "integrate", "cleanup"].includes(action)) {
          const id = rest[0];
          if (!id) throw new Error(`Usage: /bioarc-task ${action} <id>`);
          const task = resolveTask(await tasks.list(ctx.cwd), id);
          const base = task.baseBranch ?? await git.defaultBranch(ctx.cwd);
          if (action === "sync") {
            await tasks.sync(ctx.cwd, task.id);
            ctx.ui.notify(`Synced ${task.id.slice(0, 8)} with ${base}.`, "success");
          } else if (action === "diff") {
            const diff = await tasks.diff(ctx.cwd, task.id);
            ctx.ui.notify(diff || `No task changes relative to ${base}.`, "info");
          } else if (action === "integrate") {
            if (!await ctx.ui.confirm(`Integrate task into ${base}`, `Merge ${task.branch} into ${base} and push only ${base} to origin?`)) return;
            const hash = await tasks.integrate(ctx.cwd, task.id);
            if (task.id === defaultId) await clearSessionTask(sessionId);
            ctx.ui.notify(`Integrated ${task.id.slice(0, 8)} into ${base} (${hash.slice(0, 8)}).`, "success");
          } else {
            if (!await ctx.ui.confirm("Remove task worktree", `Remove worktree for ${task.title}?`)) return;
            await tasks.cleanup(ctx.cwd, task.id);
            ctx.ui.notify(`Removed worktree for ${task.id.slice(0, 8)}.`, "success");
          }
        } else if (action === "setup") {
          const current = await setup.supervisor(ctx.cwd);
          const supervisor = rest.join(" ").trim() || await ctx.ui.input("BioArc supervisor", current || "Enter supervisor name");
          if (!supervisor?.trim()) return ctx.ui.notify("Setup cancelled; supervisor unchanged.", "info");
          await setup.configureSupervisor(ctx.cwd, supervisor);
          ctx.ui.notify(`BioArc Tasks configured. Supervisor: ${supervisor.trim()}`, "success");
        } else if (action === "update") {
          await setup.update(ctx.cwd);
          ctx.ui.notify("BioArc Tasks extension updated. Restart the session to load the new version.", "success");
        } else if (["default", "select"].includes(action)) {
          if (rest[0] === "clear") {
            await clearSessionTask(sessionId);
            return ctx.ui.notify("Active task cleared for this session.", "success");
          }
          const current = await tasks.list(ctx.cwd);
          const selected = rest[0]
            ? resolveTask(current, rest[0])
            : await (async () => {
                const eligible = current.filter((task) => task.status === "open");
                const label = await ctx.ui.select("Choose active task for this session", eligible.map((task) => ({ label: `${task.id.slice(0, 8)} — ${task.title}`, description: task.status })));
                return eligible.find((task) => `${task.id.slice(0, 8)} — ${task.title}` === label);
              })();
          if (!selected || selected.status !== "open") return ctx.ui.notify("Choose an open task.", "error");
          await setSessionTask(sessionId, selected.id);
          ctx.ui.notify(`Active task for this session: ${selected.id.slice(0, 8)} — ${selected.title}`, "success");
        } else if (["complete", "delete", "commit"].includes(action)) {
          const current = await tasks.list(ctx.cwd);
          let id = rest[0] ?? defaultId;
          if (!id) {
            const eligible = action === "commit" ? current.filter((task) => task.status === "open") : current;
            const label = await ctx.ui.select("Choose BioArc task", eligible.map((task) => ({ label: `${task.id.slice(0, 8)} — ${task.title}`, description: task.status })));
            id = eligible.find((task) => `${task.id.slice(0, 8)} — ${task.title}` === label)?.id ?? "";
          }
          if (!id) return ctx.ui.notify("No task selected.", "error");
          const task = resolveTask(current, id);
          if (action === "complete") {
            await tasks.complete(ctx.cwd, task.id);
            if (task.id === defaultId) await clearSessionTask(sessionId);
            ctx.ui.notify(`Completed ${task.id.slice(0, 8)}.`, "success");
          } else if (action === "delete") {
            if (!await ctx.ui.confirm("Delete BioArc task", `${task.title} and its task record? Git history will not change.`)) return;
            await tasks.delete(ctx.cwd, task.id);
            if (task.id === defaultId) await clearSessionTask(sessionId);
            ctx.ui.notify(`Deleted ${task.id.slice(0, 8)}; Git history unchanged.`, "success");
          } else {
            const supervisor = await setup.supervisor(ctx.cwd);
            if (!supervisor) throw new Error("Run /bioarc-task setup to configure the supervisor first.");
            const result = await tasks.commit(ctx.cwd, task.id, supervisor);
            ctx.ui.notify(`Committed ${result.hash.slice(0, 8)} for ${result.task.id.slice(0, 8)}.`, "success");
          }
        } else {
          ctx.ui.notify("Actions: list, create, select, sync, diff, integrate, cleanup, complete, delete, commit, setup, update. See README for arguments.", "info");
        }
      } catch (error) {
        ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
      }
    },
  });
}
