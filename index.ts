import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { TaskService } from "./src/application/task-service";
import { SetupService } from "./src/application/setup-service";
import { ExtensionGitAdapter } from "./src/adapters/git-adapter";
import { GitSubmoduleUpdater } from "./src/adapters/git-submodule-updater";
import { JsonProjectConfig } from "./src/adapters/json-project-config";
import { JsonTaskRepository } from "./src/adapters/json-task-repository";
import { resolveTask } from "./src/domain/task";

const defaultType = "com.bioarc.tasks.session-default";
const actions = ["list", "create", "complete", "delete", "commit", "default", "sync", "diff", "integrate", "cleanup", "setup", "update"];

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

  const z = pi.zod;
  pi.registerTool({
    name: "bioarc_task_create",
    label: "Create BioArc task worktree",
    description: "Create a task and isolated local worktree branch from origin/main.",
    parameters: z.object({ title: z.string() }),
    async execute(_id, params, _signal, _update, ctx) {
      const task = await tasks.create(ctx.cwd, params.title);
      return { content: [{ type: "text", text: `Task ${task.id.slice(0, 8)} created. Branch: ${task.branch}; worktree: ${task.worktreePath}` }] };
    },
  });
  pi.registerTool({
    name: "bioarc_task_list",
    label: "List BioArc tasks",
    description: "List task IDs, status, branches, and worktree paths.",
    parameters: z.object({}),
    async execute(_id, _params, _signal, _update, ctx) {
      const current = await tasks.list(ctx.cwd);
      return { content: [{ type: "text", text: current.map((task) => `${task.id.slice(0, 8)} [${task.status}] ${task.title} | ${task.branch ?? "no branch"} | ${task.worktreePath ?? "no worktree"}`).join("\n") || "No BioArc tasks." }] };
    },
  });
  pi.registerTool({
    name: "bioarc_task_sync",
    label: "Sync task with main",
    description: "Fetch origin/main and merge it into the task branch. Conflicts preserve the task worktree.",
    parameters: z.object({ id: z.string() }),
    async execute(_id, params, _signal, _update, ctx) {
      await tasks.sync(ctx.cwd, params.id);
      return { content: [{ type: "text", text: `Task ${params.id} synced with origin/main.` }] };
    },
  });
  pi.registerTool({
    name: "bioarc_task_diff",
    label: "Inspect task changes",
    description: "Show a diffstat for task changes relative to origin/main.",
    parameters: z.object({ id: z.string() }),
    async execute(_id, params, _signal, _update, ctx) {
      const diff = await tasks.diff(ctx.cwd, params.id);
      return { content: [{ type: "text", text: diff || "No task changes relative to origin/main." }] };
    },
  });
  pi.registerTool({
    name: "bioarc_task_commit",
    label: "Commit task changes",
    description: "Sync task branch with main, then commit staged changes using the required BioArc subject.",
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
    label: "Integrate task into main",
    description: "Sync task with main, merge it into the local main worktree, and push only main to origin.",
    parameters: z.object({ id: z.string() }),
    async execute(_id, params, _signal, _update, ctx) {
      const hash = await tasks.integrate(ctx.cwd, params.id);
      return { content: [{ type: "text", text: `Integrated task into main; main HEAD is ${hash}. Only main was pushed.` }] };
    },
  });
  pi.registerTool({
    name: "bioarc_task_cleanup",
    label: "Clean up task worktree",
    description: "Remove a clean task worktree. Deletes its local branch only if merged into main.",
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
      if (!["complete", "delete", "commit", "default", "sync", "diff", "integrate", "cleanup"].includes(action)) return null;
      try {
        const taskPrefix = parts[0] ?? "";
        const available = await tasks.list(sessionCwd);
        const matching = available
          .filter((task) => action !== "commit" && action !== "default" || task.status === "open")
          .filter((task) => task.id.startsWith(taskPrefix) || task.id.slice(0, 8).startsWith(taskPrefix))
          .map((task) => ({ value: `${action} ${task.id.slice(0, 8)}`, label: `${task.id.slice(0, 8)} — ${task.title}`, description: task.status }));
        if (action === "default" && "clear".startsWith(taskPrefix)) matching.unshift({ value: "default clear", label: "clear default", description: "Use task selection each time" });
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
          ctx.ui.notify(current.length ? current.map((task) => `${task.id.slice(0, 8)} [${task.status}]${task.id === defaultId ? " [session default]" : ""} ${task.title} (${task.commits.length} commits)${task.branch ? ` — ${task.branch} — ${task.worktreePath}` : ""}`).join("\n") : "No BioArc tasks.", "info");
        } else if (action === "create") {
          const task = await tasks.create(ctx.cwd, rest.join(" "));
          ctx.ui.notify(`Created ${task.id.slice(0, 8)}: ${task.title}\nBranch: ${task.branch}\nWorktree: ${task.worktreePath}`, "success");
        } else if (["sync", "diff", "integrate", "cleanup"].includes(action)) {
          const id = rest[0];
          if (!id) throw new Error(`Usage: /bioarc-task ${action} <id>`);
          const task = resolveTask(await tasks.list(ctx.cwd), id);
          if (action === "sync") {
            await tasks.sync(ctx.cwd, task.id);
            ctx.ui.notify(`Synced ${task.id.slice(0, 8)} with main.`, "success");
          } else if (action === "diff") {
            const diff = await tasks.diff(ctx.cwd, task.id);
            ctx.ui.notify(diff || "No task changes relative to main.", "info");
          } else if (action === "integrate") {
            if (!await ctx.ui.confirm("Integrate task into main", `Merge ${task.branch} into main and push only main to origin?`)) return;
            const hash = await tasks.integrate(ctx.cwd, task.id);
            ctx.ui.notify(`Integrated ${task.id.slice(0, 8)} into main (${hash.slice(0, 8)}).`, "success");
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
          ctx.ui.notify("BioArc Tasks updated from its tracked Git submodule. Restart the session to load the new version.", "success");
        } else if (action === "default") {
          if (rest[0] === "clear") {
            defaults.delete(sessionId);
            await pi.appendEntry(defaultType, { taskId: "" });
            return ctx.ui.notify("Session default task cleared.", "success");
          }
          const current = await tasks.list(ctx.cwd);
          const selected = rest[0]
            ? resolveTask(current, rest[0])
            : await (async () => {
                const eligible = current.filter((task) => task.status === "open");
                const label = await ctx.ui.select("Choose session default task", eligible.map((task) => ({ label: `${task.id.slice(0, 8)} — ${task.title}`, description: task.status })));
                return eligible.find((task) => `${task.id.slice(0, 8)} — ${task.title}` === label);
              })();
          if (!selected) return ctx.ui.notify("No open task selected.", "error");
          defaults.set(sessionId, selected.id);
          await pi.appendEntry(defaultType, { taskId: selected.id });
          ctx.ui.notify(`Session default: ${selected.id.slice(0, 8)} — ${selected.title}`, "success");
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
            ctx.ui.notify(`Completed ${task.id.slice(0, 8)}.`, "success");
          } else if (action === "delete") {
            if (!await ctx.ui.confirm("Delete BioArc task", `${task.title} and its task record? Git history will not change.`)) return;
            await tasks.delete(ctx.cwd, task.id);
            if (task.id === defaultId) {
              defaults.delete(sessionId);
              await pi.appendEntry(defaultType, { taskId: "" });
            }
            ctx.ui.notify(`Deleted ${task.id.slice(0, 8)}; Git history unchanged.`, "success");
          } else {
            const supervisor = await setup.supervisor(ctx.cwd);
            if (!supervisor) throw new Error("Run /bioarc-task setup to configure the supervisor first.");
            const result = await tasks.commit(ctx.cwd, task.id, supervisor);
            ctx.ui.notify(`Committed ${result.hash.slice(0, 8)} for ${result.task.id.slice(0, 8)}.`, "success");
          }
        } else {
          ctx.ui.notify("Usage: /bioarc-task list | create <title> | sync <id> | diff <id> | integrate <id> | cleanup <id> | complete [id] | delete [id] | commit [id] | default [id|clear] | setup [supervisor] | update", "info");
        }
      } catch (error) {
        ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
      }
    },
  });
}
