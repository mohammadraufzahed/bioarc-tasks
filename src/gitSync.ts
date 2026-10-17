import { exec as execCb } from 'child_process';
import { promisify } from 'util';

const exec = promisify(execCb);

export interface GitSyncOptions {
  maxRetries?: number;
  backoffMs?: number;
  remote?: string;
  cwd?: string;
}

function sleep(ms: number) {
  return new Promise((res) => setTimeout(res, ms));
}

export class GitSync {
  maxRetries: number;
  backoffMs: number;
  remote: string;
  cwd?: string;

  constructor(opts: GitSyncOptions = {}) {
    this.maxRetries = opts.maxRetries ?? 3;
    this.backoffMs = opts.backoffMs ?? 1000; // base backoff in ms
    this.remote = opts.remote ?? 'origin';
    this.cwd = opts.cwd;
  }

  private async run(cmd: string) {
    // exec with inherited environment; capture stdout/stderr for debugging
    const options = this.cwd ? { cwd: this.cwd } : undefined;
    try {
      const { stdout, stderr } = await exec(cmd, options as any);
      return { stdout: stdout?.toString?.() ?? '', stderr: stderr?.toString?.() ?? '' };
    } catch (err: any) {
      // normalize error
      const message = err?.message ?? String(err);
      const stdout = err?.stdout?.toString?.() ?? '';
      const stderr = err?.stderr?.toString?.() ?? '';
      const e: any = new Error(`Command failed: ${cmd}\n${message}\n${stderr}`);
      e.stdout = stdout;
      e.stderr = stderr;
      throw e;
    }
  }

  async currentBranch(): Promise<string> {
    const { stdout } = await this.run('git rev-parse --abbrev-ref HEAD');
    return stdout.trim();
  }

  async fetch(): Promise<void> {
    await this.run(`git fetch ${this.remote} --prune`);
  }

  async pullRebase(branch: string): Promise<void> {
    // Use autostash to preserve local changes, and rebase onto remote branch
    await this.fetch();
    // Try rebase with rebase-merges to better handle merge commits
    await this.run(`git rebase --autostash --rebase-merges ${this.remote}/${branch}`);
  }

  async push(branch: string): Promise<void> {
    // Use --force-with-lease only when necessary; here we attempt a normal push first
    try {
      await this.run(`git push ${this.remote} ${branch}`);
    } catch (err) {
      // If push was rejected due to remote changes, try force-with-lease once
      await this.run(`git push --force-with-lease ${this.remote} ${branch}`);
    }
  }

  async sync(branch?: string): Promise<void> {
    const targetBranch = branch ?? (await this.currentBranch());

    let attempt = 0;
    while (true) {
      try {
        attempt++;
        // Pull (fetch + rebase) then push
        await this.pullRebase(targetBranch);
        await this.push(targetBranch);
        return;
      } catch (err) {
        if (attempt > this.maxRetries) {
          // attach attempt count for callers
          const e: any = new Error(`git sync failed after ${attempt - 1} retries: ${err?.message ?? err}`);
          e.original = err;
          throw e;
        }

        const backoff = this.backoffMs * attempt;
        // exponential-ish jittered backoff could be added; keep simple for now
        await sleep(backoff);
      }
    }
  }
}

export default GitSync;
