import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { runScheduled } from "../src/monitor.ts";
import type { Env } from "../src/types.ts";

const statePath = process.env.NOTIFIER_STATE_PATH ?? ".notifier-state/state.json";

class FileKv {
  private readonly path: string;
  private readonly values: Record<string, string>;

  private constructor(path: string, values: Record<string, string>) {
    this.path = path;
    this.values = values;
  }

  static async open(path: string): Promise<FileKv> {
    try {
      const parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("state file must contain a JSON object");
      }
      return new FileKv(path, parsed as Record<string, string>);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return new FileKv(path, {});
      throw error;
    }
  }

  async get<T>(key: string, _type: "json"): Promise<T | null> {
    const value = this.values[key];
    if (value === undefined) return null;
    return JSON.parse(value) as T;
  }

  async put(key: string, value: string): Promise<void> {
    this.values[key] = value;
    await this.persist();
  }

  async delete(key: string): Promise<void> {
    delete this.values[key];
    await this.persist();
  }

  private async persist(): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const temporaryPath = `${this.path}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(this.values, null, 2)}\n`, { mode: 0o600 });
    await rename(temporaryPath, this.path);
  }
}

const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
const state = await FileKv.open(statePath);
const report = await runScheduled({
  STATE: state,
  ...(webhookUrl ? { DISCORD_WEBHOOK_URL: webhookUrl } : {}),
} satisfies Env);

if (report.errors.length > 0) process.exitCode = 1;
