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

export default function (pi: ExtensionAPI) {
  pi.setLabel("BioArc Tasks");
  pi.registerCommand("bioarc-task", {
    description: "Manage BioArc tasks: list | create <title> | complete <id> | delete <id> | commit <id>",
    handler: async (args, ctx) => {
      const [action, ...rest] = args.trim().split(/\s+/);
      const cwd = ctx.cwd;
      const gitDir = await pi.exec("git", ["rev-parse", "--git-dir"], { cwd });
      if (gitDir.code !== 0) {
        ctx.ui.notify("Run this command inside a Git repository.", "error");
        return;
      }
      const store = join(cwd, gitDir.stdout.trim(), storeName);
      const tasks: Task[] = existsSync(store) ? JSON.parse(readFileSync(store, "utf8")) : [];
      const findTask = tasks.find((task) => task.id === rest[0] || task.id.startsWith(rest[0] ?? ""));
      const persistTasks = () => writeFileSync(store, `${JSON.stringify(tasks, null, 2)}\n`, { mode: 0o600 });

      if (action === "list") {
        ctx.ui.notify(tasks.length ? tasks.map((task) => `${task.id.slice(0, 8)} [${task.status}] ${task.title} (${task.commits.length} commits)`).join("\n") : "No BioArc tasks.", "info");
      } else if (action === "create") {
        const title = rest.join(" ").trim();
        if (!title) return ctx.ui.notify("Usage: /bioarc-task create <title>", "error");
        const task: Task = { id: randomUUID(), title, status: "open", createdAt: new Date().toISOString(), commits: [] };
        tasks.push(task);
        persistTasks();
        ctx.ui.notify(`Created ${task.id.slice(0, 8)}: ${title}`, "success");
      } else if (action === "complete" || action === "delete") {
        if (!findTask) return ctx.ui.notify("Task not found. Use /bioarc-task list.", "error");
        if (action === "complete") {
          findTask.status = "completed";
          findTask.completedAt = new Date().toISOString();
        } else {
          tasks.splice(tasks.indexOf(findTask), 1);
        }
        persistTasks();
        ctx.ui.notify(action === "complete" ? `Completed ${findTask.id.slice(0, 8)}.` : `Deleted ${findTask.id.slice(0, 8)}; Git history unchanged.`, "success");
      } else if (action === "commit") {
        if (!findTask) return ctx.ui.notify("Task not found. Use /bioarc-task list.", "error");
        if (findTask.status !== "open") return ctx.ui.notify("Cannot commit to a completed task.", "error");
        const supervisor = process.env.BIOARC_SUPERVISOR?.trim();
        if (!supervisor) return ctx.ui.notify("Set BIOARC_SUPERVISOR to the supervisor's name.", "error");
        const staged = await pi.exec("git", ["diff", "--cached", "--quiet"], { cwd });
        if (staged.code === 0) return ctx.ui.notify("Stage the task's changes first; no staged changes found.", "error");
        const message = `نوع کامیت: تسک میزیتو عنوان تسک: ${findTask.title} فرد محول کننده: ${supervisor}`;
        const committed = await pi.exec("git", ["commit", "-m", message], { cwd });
        if (committed.code !== 0) return ctx.ui.notify(committed.stderr || "Git commit failed.", "error");
        const hash = await pi.exec("git", ["rev-parse", "HEAD"], { cwd });
        findTask.commits.push(hash.stdout.trim());
        persistTasks();
        ctx.ui.notify(`Committed ${hash.stdout.trim().slice(0, 8)} for ${findTask.id.slice(0, 8)}.`, "success");
      } else {
        ctx.ui.notify("Usage: /bioarc-task list | create <title> | complete <id> | delete <id> | commit <id>", "info");
      }
    },
  });
}
