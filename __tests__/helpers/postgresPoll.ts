import { expect, TestRunner, type RunnerTestCase } from "vitest";

export function postgresPoll<T>(probe: () => T | Promise<T>) {
  const task = TestRunner.getCurrentTest<RunnerTestCase>();
  return expect.poll(probe, { timeout: task.timeout });
}
