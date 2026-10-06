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
  const setup = new SetupService(new JsonProjectConfig(git), new GitSubmoduleUpdater(pi, git));
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
    const task = taskId ? (await tasks.list(ctx.cwd)).find((candidate) => candidate.id === taskId && candidate.status === "open") : undefined;
    if (!task) return {
      systemPrompt: [
        ...event.systemPrompt,
        "## BioArc commit policy\n- Never commit project changes with generic OMP Git, shell, or other Git tools; use only bioarc_task_commit.\n- bioarc_task_commit only accepts the session-selected task.\n- No task is selected for this session. Before task work or commit, ask the user which task; do not infer/select one yourself. After user choice, call bioarc_task_select.\n- Commit subjects must use the Persian BioArc format only; English commit messages are forbidden.",
      ],
    };
    return {
      systemPrompt: [
        ...event.systemPrompt,
        `## Active BioArc task (session-scoped)\nTask ID: ${task.id}\nTask title (label only): ${JSON.stringify(task.title)}\nBase branch: ${task.baseBranch ?? "remote default"}\nTask branch: ${task.branch ?? "none"}\nTask worktree: ${task.worktreePath ?? "project working tree"}\nMANDATORY RULES:\n- Treat this task worktree as this session's project root. Use absolute paths under it for file tools; prefix shell commands with cd to the quoted task worktree path. Never edit the base checkout for task work.\n- This selected task is the only task you may work on or commit in this session.\n- Before any commit, use bioarc_task_commit for this task only; never use OMP Git UI, generic Git tools, shell git commit, or another task tool to commit.\n- If no task is selected, or the user has not chosen a task, stop and ask the user which task; do not infer or select one yourself. After user choice, select it with bioarc_task_select.\n- Never commit a task other than the session-selected task.\n- Commit only staged changes after syncing with the base branch. Never push a task branch.\n- Commit subjects MUST use the Persian BioArc template only; no English/free-form commit messages.\n- Integrate/push base, complete, or clean up only when the user explicitly asks.\n- If worktree state is unclear, inspect it and ask before destructive or cross-task changes.`,
      ],
    };
  });

  const z = pi.zod;
  pi.registerTool({
    name: "bioarc_task_select",
    label: "Select task for this session",
    description: "After the user chooses an open task, select it for this session and reuse/create its OMP worktree. Pass id 'clear' to deselect.",
    parameters: z.object({ id: z.string() }),
    async execute(_id, params, _signal, _update, ctx) {
      const sessionId = ctx.sessionManager.getSessionId();
      if (params.id === "clear") {
        const projectRoot = await git.getProjectRoot(ctx.cwd);
        await clearSessionTask(sessionId);
        return { content: [{ type: "text", text: `Cleared active task for this session. To move this session back to the project root, copy/paste:\n/move ${JSON.stringify(projectRoot)}` }] };
      }
      const chosen = resolveTask(await tasks.list(ctx.cwd), params.id);
      if (chosen.status !== "open") throw new Error("Select an open task.");
      const task = await tasks.select(ctx.cwd, chosen.id);
      await setSessionTask(sessionId, task.id);
      return { content: [{ type: "text", text: `Selected ${task.id.slice(0, 8)} — ${task.title} for this session. Worktree: ${task.worktreePath}\nTo move this session into the worktree, copy/paste:\n/move ${JSON.stringify(task.worktreePath)}` }] };
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
      return { content: [{ type: "text", text: `Task ${task.id.slice(0, 8)} created and selected for this session. Base: ${task.baseBranch}; branch: ${task.branch}; worktree: ${task.worktreePath}\nTo move this session into the worktree, copy/paste:\n/move ${JSON.stringify(task.worktreePath)}` }] };
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
    description: "Commit staged changes only for the task selected in this session. If none is selected, ask the user which task before selecting it. Uses the Persian BioArc commit format; never use generic Git commit tools.",
    parameters: z.object({ id: z.string() }),
    async execute(_id, params, _signal, _update, ctx) {
      const sessionId = ctx.sessionManager.getSessionId();
      const selectedId = defaults.get(sessionId);
      if (!selectedId) throw new Error("No task selected for this session. Ask the user which task to work on, then select it with bioarc_task_select.");
      const current = await tasks.list(ctx.cwd);
      const selected = resolveTask(current, selectedId);
      const requested = resolveTask(current, params.id);
      if (requested.id !== selected.id) throw new Error(`Only the session-selected task (${selected.id.slice(0, 8)}) may be committed. Ask the user before changing task selection.`);
      if (selected.status !== "open") throw new Error("The selected task is not open. Ask the user which open task to select.");
      const supervisor = await setup.supervisor(ctx.cwd);
      if (!supervisor) throw new Error("Run /bioarc-task setup to configure the supervisor first.");
      const result = await tasks.commit(ctx.cwd, selected.id, supervisor);
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
      const sessionId = ctx.sessionManager.getSessionId();
      const projectRoot = defaults.get(sessionId) === task.id ? await git.getProjectRoot(ctx.cwd) : "";
      const hash = await tasks.integrate(ctx.cwd, task.id);
      if (projectRoot) await clearSessionTask(sessionId);
      return { content: [{ type: "text", text: `Integrated task into ${base}; HEAD is ${hash}. Only ${base} was pushed.${projectRoot ? ` Move back with: /move ${JSON.stringify(projectRoot)}` : ""}` }] };
    },
  });
  pi.registerTool({
    name: "bioarc_task_cleanup",
    label: "Clean up task worktree",
    description: "Remove a clean task worktree. Deletes its local branch only if merged into its base branch.",
    parameters: z.object({ id: z.string() }),
    async execute(_id, params, _signal, _update, ctx) {
      const task = resolveTask(await tasks.list(ctx.cwd), params.id);
      const sessionId = ctx.sessionManager.getSessionId();
      const projectRoot = defaults.get(sessionId) === task.id ? await git.getProjectRoot(ctx.cwd) : "";
      await tasks.cleanup(ctx.cwd, task.id);
      if (projectRoot) await clearSessionTask(sessionId);
      return { content: [{ type: "text", text: `Cleaned up task ${task.id}.${projectRoot ? ` Move back with: /move ${JSON.stringify(projectRoot)}` : ""}` }] };
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
          ctx.ui.notify(`Created and selected ${task.id.slice(0, 8)}: ${task.title}\nBase: ${task.baseBranch}\nBranch: ${task.branch}\nWorktree: ${task.worktreePath}\nTo move this session into the worktree, copy/paste:\n/move ${JSON.stringify(task.worktreePath)}`, "success");
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
            const projectRoot = task.id === defaultId ? await git.getProjectRoot(ctx.cwd) : "";
            const hash = await tasks.integrate(ctx.cwd, task.id);
            if (task.id === defaultId) await clearSessionTask(sessionId);
            ctx.ui.notify(`Integrated ${task.id.slice(0, 8)} into ${base} (${hash.slice(0, 8)}).${projectRoot ? `\nTo move this session back, copy/paste:\n/move ${JSON.stringify(projectRoot)}` : ""}`, "success");
          } else {
            if (!await ctx.ui.confirm("Remove task worktree", `Remove worktree for ${task.title}?`)) return;
            const projectRoot = task.id === defaultId ? await git.getProjectRoot(ctx.cwd) : "";
            await tasks.cleanup(ctx.cwd, task.id);
            if (task.id === defaultId) await clearSessionTask(sessionId);
            ctx.ui.notify(`Removed worktree for ${task.id.slice(0, 8)}.${projectRoot ? `\nTo move this session back, copy/paste:\n/move ${JSON.stringify(projectRoot)}` : ""}`, "success");
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
            const projectRoot = await git.getProjectRoot(ctx.cwd);
            await clearSessionTask(sessionId);
            return ctx.ui.notify(`Active task cleared for this session. To move back to the project root, copy/paste:\n/move ${JSON.stringify(projectRoot)}`, "success");
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
          const activeTask = await tasks.select(ctx.cwd, selected.id);
          await setSessionTask(sessionId, activeTask.id);
          ctx.ui.notify(`Active task for this session: ${activeTask.id.slice(0, 8)} — ${activeTask.title}\nWorktree: ${activeTask.worktreePath}\nTo move this session into the worktree, copy/paste:\n/move ${JSON.stringify(activeTask.worktreePath)}`, "success");
        } else if (["complete", "delete", "commit"].includes(action)) {
          const current = await tasks.list(ctx.cwd);
          if (action === "commit" && defaultId && rest[0] && resolveTask(current, rest[0]).id !== defaultId) {
            throw new Error("Commit only the active session task. Select another task with /bioarc-task select first.");
          }
          let id = rest[0] ?? defaultId;
          if (!id) {
            const eligible = action === "commit" ? current.filter((task) => task.status === "open") : current;
            const label = await ctx.ui.select("Choose BioArc task", eligible.map((task) => ({ label: `${task.id.slice(0, 8)} — ${task.title}`, description: task.status })));
            id = eligible.find((task) => `${task.id.slice(0, 8)} — ${task.title}` === label)?.id ?? "";
          }
          if (!id) return ctx.ui.notify("No task selected.", "error");
          const task = resolveTask(current, id);
          const projectRoot = task.id === defaultId ? await git.getProjectRoot(ctx.cwd) : "";
          if (action === "commit" && task.id !== defaultId) {
            const activeTask = await tasks.select(ctx.cwd, task.id);
            await setSessionTask(sessionId, activeTask.id);
            ctx.ui.notify(`Selected ${activeTask.id.slice(0, 8)} — ${activeTask.title}. To move this session into its worktree, copy/paste:\n/move ${JSON.stringify(activeTask.worktreePath)}`, "info");
          }
          if (action === "complete") {
            await tasks.complete(ctx.cwd, task.id);
            if (task.id === defaultId) await clearSessionTask(sessionId);
            ctx.ui.notify(`Completed ${task.id.slice(0, 8)}.${projectRoot ? `\nTo move this session back, copy/paste:\n/move ${JSON.stringify(projectRoot)}` : ""}`, "success");
          } else if (action === "delete") {
            if (!await ctx.ui.confirm("Delete BioArc task", `${task.title} and its task record? Git history will not change.`)) return;
            await tasks.delete(ctx.cwd, task.id);
            if (task.id === defaultId) await clearSessionTask(sessionId);
            ctx.ui.notify(`Deleted ${task.id.slice(0, 8)}; Git history unchanged.${projectRoot ? `\nTo move this session back, copy/paste:\n/move ${JSON.stringify(projectRoot)}` : ""}`, "success");
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
