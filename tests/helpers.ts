import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const execute = promisify(execFile);
export async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "codemap-tour-test-"));
  const repo = path.join(root, "repository");
  await mkdir(repo);
  const git = async (...args: string[]) =>
    (await execute("git", args, { cwd: repo, encoding: "utf8" })).stdout.trim();
  await git("init", "-b", "main");
  await git("config", "user.name", "CodeMap Tour test");
  await git("config", "user.email", "test@localhost");
  await git("config", "commit.gpgsign", "false");
  return {
    root,
    repo,
    write: async (file: string, content: string) => {
      await mkdir(path.dirname(path.join(repo, file)), { recursive: true });
      await writeFile(path.join(repo, file), content);
    },
    commit: async (message: string) => {
      await git("add", "--all");
      await git("commit", "-m", message);
      return git("rev-parse", "HEAD");
    },
    dispose: () => rm(root, { recursive: true, force: true }),
  };
}
