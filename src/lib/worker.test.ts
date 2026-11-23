import assert from "node:assert/strict";
import { test } from "node:test";
import { dueJobs, type Job } from "./worker";

const job = (name: string, everyMs: number): Job => ({
  name,
  everyMs,
  run: async () => {},
});

test("jobs are due on the first tick and then once per interval", () => {
  const jobs = [job("fast", 1000), job("slow", 60_000)];
  const last = new Map<string, number>();
  assert.deepEqual(
    dueJobs(jobs, last, 0).map((j) => j.name),
    ["fast", "slow"],
  );
  last.set("fast", 0).set("slow", 0);
  assert.deepEqual(dueJobs(jobs, last, 999), []);
  assert.deepEqual(
    dueJobs(jobs, last, 1000).map((j) => j.name),
    ["fast"],
  );
  assert.deepEqual(
    dueJobs(jobs, last, 60_000).map((j) => j.name),
    ["fast", "slow"],
  );
});
