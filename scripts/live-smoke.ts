import { runAllTargets } from "../src/monitor.ts";
import type { Env } from "../src/types.ts";

class MemoryKv {
  private readonly values = new Map<string, string>();

  async get<T>(key: string, _type: "json"): Promise<T | null> {
    const value = this.values.get(key);
    if (value === undefined) return null;
    return JSON.parse(value) as T;
  }

  async put(key: string, value: string): Promise<void> {
    this.values.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.values.delete(key);
  }
}

const env = { STATE: new MemoryKv() } satisfies Env;
const reports = [await runAllTargets(env, { sendAlerts: false })];
if (process.argv.includes("--warm")) reports.push(await runAllTargets(env, { sendAlerts: false }));
console.log(JSON.stringify(reports.length === 1 ? reports[0] : reports, null, 2));

const failed = reports.some(
  (report) =>
    report.errors.length > 0 ||
    report.targets.some(
      (target) => target.seatMapsAttempted === 0 || target.seatMapsAttempted !== target.seatMapsSucceeded,
    ),
);
if (failed) process.exitCode = 1;
