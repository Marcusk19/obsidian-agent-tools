import { execFile } from "node:child_process";
import { join } from "node:path";

const CLI_PATH =
  process.env.OBSIDIAN_CLI_PATH ||
  "/Applications/Obsidian.app/Contents/MacOS/obsidian";
const VAULT_PATH =
  process.env.OBSIDIAN_VAULT ||
  join(process.env.HOME || "/tmp", "obsidian-git-sync");

export function execObsidian(
  command: string,
  args: Record<string, string | boolean | number | undefined> = {}
): Promise<string> {
  const cliArgs = [command];

  for (const [key, value] of Object.entries(args)) {
    if (value === undefined || value === false) continue;
    if (value === true) {
      cliArgs.push(key);
    } else {
      cliArgs.push(`${key}=${value}`);
    }
  }

  return new Promise((resolve, reject) => {
    execFile(
      CLI_PATH,
      cliArgs,
      { cwd: VAULT_PATH, timeout: 15000 },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr || error.message));
        } else {
          resolve(stdout);
        }
      }
    );
  });
}
