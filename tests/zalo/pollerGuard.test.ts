import { describe, it, expect, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createPollerGuard } from "@/lib/zalo/pollerGuard";

const files: string[] = [];
function tempFile(): string {
  const file = path.join(os.tmpdir(), `guard-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  files.push(file);
  return file;
}

afterEach(() => {
  for (const file of files.splice(0)) {
    fs.rmSync(file, { force: true });
    fs.rmSync(`${file}.tmp`, { force: true });
  }
});

describe("createPollerGuard", () => {
  it("lets a key through once, in memory", () => {
    const guard = createPollerGuard();
    expect(guard.claim("a")).toBe(true);
    expect(guard.claim("a")).toBe(false);
    expect(guard.claim("b")).toBe(true);
  });

  it("remembers claimed keys and tries after the process is replaced", () => {
    const file = tempFile();
    const first = createPollerGuard(file);
    first.claim("thread:msg-1");
    expect(first.beginAttempt("confirm:x")).toBe(1);
    expect(first.beginAttempt("confirm:x")).toBe(2);

    // A new guard on the same file = the poller restarted after a crash.
    const second = createPollerGuard(file);
    expect(second.claim("thread:msg-1")).toBe(false);
    expect(second.claim("thread:msg-2")).toBe(true);
    expect(second.beginAttempt("confirm:x")).toBe(3);
  });

  it("forgets the tries of finished work", () => {
    const file = tempFile();
    const guard = createPollerGuard(file);
    guard.beginAttempt("k");
    guard.beginAttempt("k");
    guard.finishAttempt("k");
    expect(guard.beginAttempt("k")).toBe(1);
    expect(createPollerGuard(file).beginAttempt("k")).toBe(2);
  });

  it("starts empty from a missing or damaged file instead of failing", () => {
    const file = tempFile();
    expect(createPollerGuard(file).claim("a")).toBe(true);
    fs.writeFileSync(file, "{ not json");
    expect(createPollerGuard(file).claim("a")).toBe(true);
  });

  it("keeps working when the file can't be written", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const guard = createPollerGuard(path.join(os.tmpdir(), "no-such-dir-for-guard", "state.json"));
    expect(guard.claim("a")).toBe(true);
    expect(guard.claim("a")).toBe(false);
    expect(guard.beginAttempt("a")).toBe(1);
    vi.restoreAllMocks();
  });

  it("remembers only the latest 500 claimed keys", () => {
    const guard = createPollerGuard();
    for (let i = 0; i < 501; i++) guard.claim(`k${i}`);
    expect(guard.claim("k0")).toBe(true); // pushed out
    expect(guard.claim("k500")).toBe(false);
  });
});
