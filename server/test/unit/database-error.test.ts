import { describe, expect, it } from "vitest";
import { databaseError } from "../../src/status/database-error.js";

describe("databaseError", () => {
  it("maps SQLite result codes, extended ones by their primary code", () => {
    const coded = (code: string): Error => Object.assign(new Error("made up"), { code });
    expect(databaseError(coded("SQLITE_BUSY"))).toBe("busy");
    expect(databaseError(coded("SQLITE_BUSY_SNAPSHOT"))).toBe("busy");
    expect(databaseError(coded("SQLITE_NOTADB"))).toBe("corrupt");
    expect(databaseError(coded("SQLITE_FULL"))).toBe("no_space");
    expect(databaseError(coded("SQLITE_READONLY_DBMOVED"))).toBe("read_only");
    expect(databaseError(coded("SQLITE_CANTOPEN"))).toBe("cannot_open");
    expect(databaseError(coded("SQLITE_IOERR_WRITE"))).toBe("failed");
  });

  it("answers failed for anything without a code", () => {
    expect(databaseError(new Error("made up"))).toBe("failed");
    expect(databaseError("made up")).toBe("failed");
    expect(databaseError(null)).toBe("failed");
  });
});
