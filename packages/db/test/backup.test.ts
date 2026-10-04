import { mkdtemp, readdir, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../src/client";
import {
  backupFileName,
  getBackupStatus,
  listBackups,
  pruneBackups,
  runBackup,
  runBackupIfDue,
} from "../src/backup";
import { updateSettings } from "../src/settings";
import { resetDb } from "./helpers";

let dir: string;
beforeEach(async () => {
  await resetDb();
  dir = await mkdtemp(join(tmpdir(), "tcg-vault-backup-test-"));
  await updateSettings({ backupFolder: dir, backupKeep: 3, backupEnabled: true });
});
afterAll(() => prisma.$disconnect());

describe("backups", () => {
  it("names files so they sort in time order", () => {
    expect(backupFileName(new Date("2026-10-03T14:15:09Z"))).toBe("tcg-vault-2026-10-03-141509.db");
  });

  it("writes a restorable copy and keeps only the newest few", async () => {
    await prisma.appSetting.create({ data: { key: "marker", value: "x" } });
    for (let day = 1; day <= 5; day++)
      await runBackup(new Date(`2026-10-0${day}T04:00:00Z`));
    const files = await listBackups(dir);
    expect(files.map((f) => f.name)).toEqual([
      "tcg-vault-2026-10-05-040000.db",
      "tcg-vault-2026-10-04-040000.db",
      "tcg-vault-2026-10-03-040000.db",
    ]);
    expect(files[0]!.bytes).toBeGreaterThan(0);
    expect((await getBackupStatus())?.ok).toBe(true);
  });

  it("never deletes files that aren't backups", async () => {
    await writeFile(join(dir, "notes.txt"), "mine");
    await runBackup(new Date("2026-10-01T04:00:00Z"));
    await pruneBackups(dir, 1);
    expect(await readdir(dir)).toContain("notes.txt");
  });

  it("only backs up when the newest copy is a day old, and not when disabled", async () => {
    const now = new Date("2026-10-03T12:00:00Z");
    expect(await runBackupIfDue(now)).not.toBeNull();
    const [first] = await listBackups(dir);
    await utimes(first!.path, now, now);
    expect(await runBackupIfDue(new Date(now.getTime() + 3_600_000))).toBeNull();
    expect(await runBackupIfDue(new Date(now.getTime() + 25 * 3_600_000))).not.toBeNull();
    await updateSettings({ backupEnabled: false });
    expect(await runBackupIfDue(new Date(now.getTime() + 60 * 3_600_000))).toBeNull();
  });

  it("remembers a failure so Settings can show it", async () => {
    await updateSettings({ backupFolder: join(dir, "notes.txt", "sub") });
    await writeFile(join(dir, "notes.txt"), "a file where a folder should be");
    await expect(runBackup()).rejects.toThrow();
    expect((await getBackupStatus())?.ok).toBe(false);
  });
});

afterAll(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});
