import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  JOURNAL_OBJECT_KEY_PATTERN,
  journalEntryErrors,
  journalObjectKey,
  validateJournalEntry,
  validateWsMessage,
  wsMessageErrors,
} from "../src/index";

const FIXTURES = join(import.meta.dir, "..", "fixtures");
const JOURNAL_PREFIX = "journal-entry.";
const WS_PREFIX = "ws.";

interface Fixture {
  name: string;
  value: unknown;
}

function loadFixtures(kind: "valid" | "invalid"): Fixture[] {
  const dir = join(FIXTURES, kind);
  return readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => ({ name, value: JSON.parse(readFileSync(join(dir, name), "utf8")) as unknown }));
}

function validatorFor(name: string): { validate: (x: unknown) => boolean; errors: () => unknown } {
  if (name.startsWith(JOURNAL_PREFIX)) return { validate: validateJournalEntry, errors: journalEntryErrors };
  if (name.startsWith(WS_PREFIX)) return { validate: validateWsMessage, errors: wsMessageErrors };
  throw new Error(`fixture ${name} has no recognised prefix (expected "${JOURNAL_PREFIX}" or "${WS_PREFIX}")`);
}

const valid = loadFixtures("valid");
const invalid = loadFixtures("invalid");

describe("fixture directories", () => {
  test("are non-empty and every file has a recognised prefix", () => {
    expect(valid.length).toBeGreaterThan(0);
    expect(invalid.length).toBeGreaterThan(0);
    for (const kind of ["valid", "invalid"] as const) {
      for (const name of readdirSync(join(FIXTURES, kind))) {
        expect(name.endsWith(".json")).toBe(true);
        expect(() => validatorFor(name)).not.toThrow();
      }
    }
  });

  test("valid set holds exactly the 4 journal actions and 7 ws types", () => {
    const names = valid.map((f) => f.name).sort();
    const expected = [
      ...["added", "modified", "deleted", "renamed"].map((a) => `journal-entry.${a}.json`),
      ...["auth_init", "auth_ok", "auth_error", "journal_appended", "sync_required", "ping", "pong"].map(
        (t) => `ws.${t}.json`,
      ),
    ].sort();
    expect(names).toEqual(expected);
  });
});

describe("valid fixtures", () => {
  for (const { name, value } of valid) {
    test(name, () => {
      const { validate, errors } = validatorFor(name);
      const ok = validate(value);
      if (!ok) throw new Error(`${name} rejected: ${JSON.stringify(errors(), null, 2)}`);
      expect(ok).toBe(true);
    });
  }
});

describe("invalid fixtures", () => {
  for (const { name, value } of invalid) {
    test(name, () => {
      expect(validatorFor(name).validate(value)).toBe(false);
    });
  }
});

describe("ws privacy", () => {
  const FORBIDDEN = ["path", "old_path", "hash", "base_hash", "blob_id", "size", "mtime_ms"];

  function keysOf(value: unknown, acc: string[] = []): string[] {
    if (Array.isArray(value)) {
      for (const item of value) keysOf(item, acc);
    } else if (value !== null && typeof value === "object") {
      for (const [k, v] of Object.entries(value)) {
        acc.push(k);
        keysOf(v, acc);
      }
    }
    return acc;
  }

  for (const { name, value } of valid.filter((f) => f.name.startsWith(WS_PREFIX))) {
    test(`${name} carries no plaintext file metadata`, () => {
      const keys = keysOf(value);
      for (const k of FORBIDDEN) expect(keys).not.toContain(k);
      if (name !== "ws.auth_init.json") expect(keys).not.toContain("device_name");
    });
  }
});

describe("relPath", () => {
  const base = JSON.parse(readFileSync(join(FIXTURES, "valid", "journal-entry.added.json"), "utf8")) as Record<
    string,
    unknown
  >;
  const accept = ["Documents/finances.pdf", ".bashrc", "..hidden", "a/.../b", "a", "dir/sub/file name.txt"];
  const reject = ["/abs", "a/../b", "./a", "a/./b", "a//b", "a/", "a\\b", "..", ".", "", "a/\u0000b", "x".repeat(4097)];

  for (const path of accept) {
    test(`accepts ${JSON.stringify(path)}`, () => {
      expect(validateJournalEntry({ ...base, path })).toBe(true);
    });
  }
  for (const path of reject) {
    test(`rejects ${JSON.stringify(path.length > 20 ? `${path.slice(0, 8)}...(${path.length})` : path)}`, () => {
      expect(validateJournalEntry({ ...base, path })).toBe(false);
    });
  }
});

describe("journalObjectKey", () => {
  const id = "3f2b8c1e-9d4a-4e7b-a1c6-5f8e2d9b0a73";

  test("pads seq to 20 digits", () => {
    expect(journalObjectKey(id, 42)).toBe(`rb/journal/${id}/00000000000000000042`);
    expect(journalObjectKey(id, 1)).toBe(`rb/journal/${id}/00000000000000000001`);
    expect(journalObjectKey(id, Number.MAX_SAFE_INTEGER)).toBe(`rb/journal/${id}/00009007199254740991`);
  });

  test("output matches the pattern and the ws schema", () => {
    for (const seq of [1, 42, Number.MAX_SAFE_INTEGER]) {
      const object_key = journalObjectKey(id, seq);
      expect(JOURNAL_OBJECT_KEY_PATTERN.test(object_key)).toBe(true);
      const msg = { type: "journal_appended", payload: { seq, object_key } };
      expect(validateWsMessage(msg)).toBe(true);
    }
  });

  for (const seq of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
    test(`rejects seq ${seq}`, () => {
      expect(() => journalObjectKey(id, seq)).toThrow(RangeError);
    });
  }

  for (const bad of [id.toUpperCase(), "not-a-uuid", "", `${id}0`, "3f2b8c1e9d4a4e7ba1c65f8e2d9b0a73"]) {
    test(`rejects deviceId ${JSON.stringify(bad)}`, () => {
      expect(() => journalObjectKey(bad, 1)).toThrow(TypeError);
    });
  }
});
