import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import os from "node:os";
import path from "node:path";

import { validatePath } from "../validate";

const ORIG_HOME = os.homedir();

function setHome(fakeHome: string) {
  vi.spyOn(os, "homedir").mockReturnValue(fakeHome);
}

beforeEach(() => {
  setHome("/home/user");
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("validatePath", () => {
  it("accepts a path inside home", () => {
    const r = validatePath("/home/user/Documents/team");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.resolved).toBe("/home/user/Documents/team");
  });

  it("accepts the home directory itself", () => {
    const r = validatePath("/home/user");
    expect(r.ok).toBe(true);
  });

  it("expands `~/` prefix to home", () => {
    const r = validatePath("~/Documents");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.resolved).toBe("/home/user/Documents");
  });

  it("expands a bare `~` to home", () => {
    const r = validatePath("~");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.resolved).toBe("/home/user");
  });

  it("rejects the prefix-attack path /home/userOTHER", () => {
    const r = validatePath("/home/userOTHER/foo");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(403);
  });

  it("rejects /etc/passwd and other system paths", () => {
    const r = validatePath("/etc/passwd");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(403);
  });

  it("rejects path traversal with `..` resolving outside home", () => {
    const r = validatePath("/home/user/../../etc");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(403);
  });

  it("normalizes valid `..` that stays inside home", () => {
    const r = validatePath("/home/user/Documents/../Pictures");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.resolved).toBe("/home/user/Pictures");
  });

  it("rejects ~/.openclaw/workspace-{agentId} (OpenClaw boundary)", () => {
    const r = validatePath("/home/user/.openclaw/workspace-abc/secret");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(403);
    if (!r.ok) expect(r.message).toMatch(/private OpenClaw workspace/);
  });

  it("rejects empty input", () => {
    const r = validatePath("");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(400);
  });

  it("rejects non-string input", () => {
    const r = validatePath(undefined);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(400);
  });

  it("rejects when home is `/` (root user / container)", () => {
    setHome("/");
    const r = validatePath("/anywhere");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(500);
  });

  it("rejects when home has only 1 segment", () => {
    setHome("/foo");
    const r = validatePath("/foo/bar");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(500);
  });

  it("accepts long-name home (regression for prefix-attack siblings)", () => {
    setHome("/home/user-name");
    expect(validatePath("/home/user-name/foo").ok).toBe(true);
    expect(validatePath("/home/user-nameOTHER/foo").ok).toBe(false);
  });

  // Restore the real homedir for any later import that consumes it before reset.
  it.skip("noop placeholder", () => {
    expect(ORIG_HOME).toBeTypeOf("string");
  });
});
