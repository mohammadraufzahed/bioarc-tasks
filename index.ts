import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

interface Task {
  id: string;
  title: string;
  status: "open" | "completed";
  createdAt: string;
  completedAt?: string;
  commits: string[];
}

const storeName = "bioarc-tasks.json";
const defaultType = "com.bioarc.tasks.session-default";

export default function (pi: ExtensionAPI) {
  pi.setLabel("BioArc Tasks");
  const defaults = new Map<string, string>();
  let sessionCwd = process.cwd();
  pi.on("session_start", (_event, ctx) => {
    sessionCwd = ctx.cwd;
    let taskId = "";
    for (const entry of ctx.sessionManager.getBranch()) {
      if (entry.type === "custom" && entry.customType === defaultType && typeof entry.data?.taskId === "string") {
        taskId = entry.data.taskId;
      }
    }
    defaults.set(ctx.sessionManager.getSessionId(), taskId);
  });

  pi.registerCommand("bioarc-task", {
    description: "Manage BioArc tasks; autocomplete actions and task IDs",
    getArgumentCompletions: (prefix) => {
      const [action, ...parts] = prefix.split(/\s+/);
      const actions = ["list", "create", "complete", "delete", "commit", "default"];
      if (!action || !prefix.includes(" ")) {
        return actions.filter((value) => value.startsWith(action ?? "")).map((value) => ({ value: `${value} `, label: value }));
      }
      if (!["complete", "delete", "commit", "default"].includes(action)) return null;
      const cwd = sessionCwd;
      const gitDir = Bun.spawnSync(["git", "rev-parse", "--git-dir"], { cwd, stdout: "pipe", stderr: "ignore" });
      if (gitDir.exitCode !== 0) return null;
      const store = join(cwd, gitDir.stdout.toString().trim(), storeName);
      const tasks: Task[] = existsSync(store) ? JSON.parse(readFileSync(store, "utf8")) : [];
      const taskPrefix = parts[0] ?? "";
      const candidates = action === "commit" ? tasks.filter((task) => task.status === "open") : tasks;
      const items = candidates.filter((task) => task.id.startsWith(taskPrefix) || task.id.slice(0, 8).startsWith(taskPrefix)).map((task) => ({
        value: `${action} ${task.id.slice(0, 8)}`,
        label: `${task.id.slice(0, 8)} — ${task.title}`,
        description: task.status,
      }));
      if (action === "default" && "clear".startsWith(taskPrefix)) items.unshift({ value: "default clear", label: "clear default", description: "Use task selection each time" });
      return items;
    },
    handler: async (args, ctx) => {
      const [action, ...rest] = args.trim().split(/\s+/);
      const cwd = ctx.cwd;
      const gitDir = await pi.exec("git", ["rev-parse", "--git-dir"], { cwd });
      if (gitDir.code !== 0) return ctx.ui.notify("Run this command inside a Git repository.", "error");
      const store = join(cwd, gitDir.stdout.trim(), storeName);
      const tasks: Task[] = existsSync(store) ? JSON.parse(readFileSync(store, "utf8")) : [];
      const sessionId = ctx.sessionManager.getSessionId();
      const defaultId = defaults.get(sessionId) ?? "";
      const persistTasks = () => writeFileSync(store, `${JSON.stringify(tasks, null, 2)}\n`, { mode: 0o600 });
      const chooseTask = async (eligible: Task[]) => {
        if (!eligible.length) return undefined;
        const selected = await ctx.ui.select("Choose BioArc task", eligible.map((task) => ({ label: `${task.id.slice(0, 8)} — ${task.title}`, description: task.status })));
        return eligible.find((task) => `${task.id.slice(0, 8)} — ${task.title}` === selected);
      };

      if (action === "list") {
        ctx.ui.notify(tasks.length ? tasks.map((task) => `${task.id.slice(0, 8)} [${task.status}]${task.id === defaultId ? " [session default]" : ""} ${task.title} (${task.commits.length} commits)`).join("\n") : "No BioArc tasks.", "info");
      } else if (action === "create") {
        const title = rest.join(" ").trim();
        if (!title) return ctx.ui.notify("Usage: /bioarc-task create <title>", "error");
        const task: Task = { id: randomUUID(), title, status: "open", createdAt: new Date().toISOString(), commits: [] };
        tasks.push(task);
        persistTasks();
        ctx.ui.notify(`Created ${task.id.slice(0, 8)}: ${title}`, "success");
      } else if (action === "default") {
        if (rest[0] === "clear") {
          defaults.delete(sessionId);
          await pi.appendEntry(defaultType, { taskId: "" });
          return ctx.ui.notify("Session default task cleared.", "success");
        }
        const selected = rest[0] ? tasks.find((task) => task.id.startsWith(rest[0])) : await chooseTask(tasks.filter((task) => task.status === "open"));
        if (!selected) return ctx.ui.notify("No matching task. Use autocomplete or /bioarc-task create.", "error");
        defaults.set(sessionId, selected.id);
        await pi.appendEntry(defaultType, { taskId: selected.id });
        ctx.ui.notify(`Session default: ${selected.id.slice(0, 8)} — ${selected.title}`, "success");
      } else if (["complete", "delete", "commit"].includes(action)) {
        let task = rest[0] ? tasks.find((item) => item.id.startsWith(rest[0])) : tasks.find((item) => item.id === defaultId);
        if (!task && !rest[0]) task = await chooseTask(action === "commit" ? tasks.filter((item) => item.status === "open") : tasks);
        if (!task) return ctx.ui.notify("Task not found. Set a session default or choose a task.", "error");
        if (action === "complete" || action === "delete") {
          if (action === "complete") {
            task.status = "completed";
            task.completedAt = new Date().toISOString();
          } else {
            if (!await ctx.ui.confirm("Delete BioArc task", `${task.title} and its task record? Git history will not change.`)) return;
            tasks.splice(tasks.indexOf(task), 1);
            if (task.id === defaultId) {
              defaults.delete(sessionId);
              await pi.appendEntry(defaultType, { taskId: "" });
            }
          }
          persistTasks();
          ctx.ui.notify(action === "complete" ? `Completed ${task.id.slice(0, 8)}.` : `Deleted ${task.id.slice(0, 8)}; Git history unchanged.`, "success");
        } else {
          if (task.status !== "open") return ctx.ui.notify("Cannot commit to a completed task.", "error");
          const supervisor = process.env.BIOARC_SUPERVISOR?.trim();
          if (!supervisor) return ctx.ui.notify("Set BIOARC_SUPERVISOR to the supervisor's name.", "error");
          const staged = await pi.exec("git", ["diff", "--cached", "--quiet"], { cwd });
          if (staged.code === 0) return ctx.ui.notify("Stage the task's changes first; no staged changes found.", "error");
          const message = `نوع کامیت: تسک میزیتو عنوان تسک: ${task.title} فرد محول کننده: ${supervisor}`;
          const committed = await pi.exec("git", ["commit", "-m", message], { cwd });
          if (committed.code !== 0) return ctx.ui.notify(committed.stderr || "Git commit failed.", "error");
          const hash = await pi.exec("git", ["rev-parse", "HEAD"], { cwd });
          task.commits.push(hash.stdout.trim());
          persistTasks();
          ctx.ui.notify(`Committed ${hash.stdout.trim().slice(0, 8)} for ${task.id.slice(0, 8)}.`, "success");
        }
      } else {
        ctx.ui.notify("Usage: /bioarc-task list | create <title> | complete <id> | delete <id> | commit <id> | default [id|clear]", "info");
      }
    },
  });
}
