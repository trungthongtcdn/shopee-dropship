import { describe, it, expect } from "vitest";
import { computeSyncDiff } from "@/lib/sync/diff";

describe("computeSyncDiff", () => {
  it("marks a row with no existing match as an insert", () => {
    const diff = computeSyncDiff([], [{ rowIndex: 2, hash: "h1", data: {} }]);
    expect(diff.inserts).toEqual([{ rowIndex: 2, hash: "h1", data: {} }]);
    expect(diff.updates).toEqual([]);
    expect(diff.softDeletes).toEqual([]);
  });

  it("marks a row with a changed hash as an update", () => {
    const diff = computeSyncDiff(
      [{ rowIndex: 2, hash: "old" }],
      [{ rowIndex: 2, hash: "new", data: {} }]
    );
    expect(diff.updates).toEqual([{ rowIndex: 2, hash: "new", data: {} }]);
    expect(diff.inserts).toEqual([]);
  });

  it("skips a row with an unchanged hash", () => {
    const diff = computeSyncDiff(
      [{ rowIndex: 2, hash: "same" }],
      [{ rowIndex: 2, hash: "same", data: {} }]
    );
    expect(diff.inserts).toEqual([]);
    expect(diff.updates).toEqual([]);
    expect(diff.softDeletes).toEqual([]);
  });

  it("marks an existing row missing from incoming as a soft delete", () => {
    const diff = computeSyncDiff([{ rowIndex: 2, hash: "h1" }], []);
    expect(diff.softDeletes).toEqual([2]);
  });

  it("handles a mixed batch correctly", () => {
    const diff = computeSyncDiff(
      [
        { rowIndex: 2, hash: "same" },
        { rowIndex: 3, hash: "old" },
        { rowIndex: 4, hash: "gone" },
      ],
      [
        { rowIndex: 2, hash: "same", data: {} },
        { rowIndex: 3, hash: "new", data: {} },
        { rowIndex: 5, hash: "brand-new", data: {} },
      ]
    );
    expect(diff.inserts).toEqual([{ rowIndex: 5, hash: "brand-new", data: {} }]);
    expect(diff.updates).toEqual([{ rowIndex: 3, hash: "new", data: {} }]);
    expect(diff.softDeletes).toEqual([4]);
  });
});
