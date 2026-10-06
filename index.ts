import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { TaskService } from "./src/application/task-service";
import { ExtensionGitAdapter } from "./src/adapters/git-adapter";
import { JsonTaskRepository } from "./src/adapters/json-task-repository";
import { resolveTask } from "./src/domain/task";

const defaultType = "com.bioarc.tasks.session-default";
const actions = ["list", "create", "complete", "delete", "commit", "default"];

export default function (pi: ExtensionAPI) {
  pi.setLabel("BioArc Tasks");
  const git = new ExtensionGitAdapter(pi);
  const tasks = new TaskService(new JsonTaskRepository(git), git);
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

  pi.registerCommand("bioarc-task", {
    description: "Manage BioArc tasks; autocomplete actions and task IDs",
    getArgumentCompletions: async (prefix) => {
      const [action, ...parts] = prefix.split(/\s+/);
      if (!action || !prefix.includes(" ")) return actions.filter((value) => value.startsWith(action ?? "")).map((value) => ({ value: `${value} `, label: value }));
      if (!["complete", "delete", "commit", "default"].includes(action)) return null;
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
          ctx.ui.notify(current.length ? current.map((task) => `${task.id.slice(0, 8)} [${task.status}]${task.id === defaultId ? " [session default]" : ""} ${task.title} (${task.commits.length} commits)`).join("\n") : "No BioArc tasks.", "info");
        } else if (action === "create") {
          const task = await tasks.create(ctx.cwd, rest.join(" "));
          ctx.ui.notify(`Created ${task.id.slice(0, 8)}: ${task.title}`, "success");
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
            const supervisor = process.env.BIOARC_SUPERVISOR;
            if (!supervisor?.trim()) throw new Error("Set BIOARC_SUPERVISOR to the supervisor's name.");
            const result = await tasks.commit(ctx.cwd, task.id, supervisor);
            ctx.ui.notify(`Committed ${result.hash.slice(0, 8)} for ${result.task.id.slice(0, 8)}.`, "success");
          }
        } else {
          ctx.ui.notify("Usage: /bioarc-task list | create <title> | complete [id] | delete [id] | commit [id] | default [id|clear]", "info");
        }
      } catch (error) {
        ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
      }
    },
  });
}
