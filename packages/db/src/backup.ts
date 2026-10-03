import { mkdir, readdir, rm, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { appDataDir } from "@tcg-vault/shared";
import { prisma } from "./client";
import { getSettings } from "./settings";

/**
 * Scheduled copies of the whole database (VACUUM INTO: a clean, consistent
 * snapshot even while the app runs) into a folder the user picks, typically
 * one that OneDrive or Google Drive syncs. The newest `backupKeep` are kept.
 */

const STATUS_KEY = "backup-status";
const FILE_RE = /^tcg-vault-(\d{4}-\d{2}-\d{2})-(\d{6})\.db$/;

export const BACKUP_INTERVAL_MS = 24 * 3_600_000;

export interface BackupStatus {
  at: number;
  ok: boolean;
  /** Path of the backup file, or the error text when it failed. */
  detail: string;
}

export interface BackupFile {
  name: string;
  path: string;
  bytes: number;
  at: number;
}

export function defaultBackupDir(): string {
  return join(appDataDir(), "backups");
}

/** The configured folder, or the default one inside the app data folder. */
export function backupDir(folder: string): string {
  return folder.trim() ? resolve(folder.trim()) : defaultBackupDir();
}

/** tcg-vault-2026-10-03-141500.db (UTC, so names sort in time order). */
export function backupFileName(now = new Date()): string {
  const iso = now.toISOString(); // 2026-10-03T14:15:00.000Z
  return `tcg-vault-${iso.slice(0, 10)}-${iso.slice(11, 19).replace(/:/g, "")}.db`;
}

/** Existing backups in a folder, newest first. Other files are never touched. */
export async function listBackups(dir: string): Promise<BackupFile[]> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const files: BackupFile[] = [];
  for (const name of names.filter((n) => FILE_RE.test(n))) {
    const path = join(dir, name);
    try {
      const st = await stat(path);
      files.push({ name, path, bytes: st.size, at: st.mtimeMs });
    } catch {
      /* removed meanwhile */
    }
  }
  return files.sort((a, b) => (a.name < b.name ? 1 : -1));
}

/** Deletes all but the newest `keep` backups; returns how many it removed. */
export async function pruneBackups(dir: string, keep: number): Promise<number> {
  const old = (await listBackups(dir)).slice(Math.max(1, keep));
  for (const f of old) await rm(f.path, { force: true });
  return old.length;
}

export async function getBackupStatus(): Promise<BackupStatus | null> {
  const row = await prisma.appSetting.findUnique({ where: { key: STATUS_KEY } });
  if (!row) return null;
  try {
    return JSON.parse(row.value) as BackupStatus;
  } catch {
    return null;
  }
}

async function setBackupStatus(status: BackupStatus): Promise<void> {
  const value = JSON.stringify(status);
  await prisma.appSetting.upsert({
    where: { key: STATUS_KEY },
    update: { value },
    create: { key: STATUS_KEY, value },
  });
}

/**
 * Writes one backup now and prunes old ones. The outcome (success or the
 * error) is remembered for the Settings page; a failure is also rethrown.
 */
export async function runBackup(now = new Date()): Promise<BackupFile> {
  const settings = await getSettings();
  const dir = backupDir(settings.backupFolder);
  try {
    await mkdir(dir, { recursive: true });
    const path = join(dir, backupFileName(now));
    await rm(path, { force: true }); // VACUUM INTO refuses an existing file
    // The path is built here from the settings folder and a fixed pattern; SQLite needs a literal.
    await prisma.$executeRawUnsafe(`VACUUM INTO '${path.replace(/'/g, "''")}'`);
    const st = await stat(path);
    await pruneBackups(dir, settings.backupKeep);
    await setBackupStatus({ at: now.getTime(), ok: true, detail: path });
    return { name: backupFileName(now), path, bytes: st.size, at: st.mtimeMs };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    await setBackupStatus({ at: now.getTime(), ok: false, detail }).catch(() => {});
    throw err;
  }
}

/**
 * Scheduler entry point: backs up when enabled and the last successful
 * backup is older than a day (so a computer that's off at the scheduled time
 * catches up on the next start). Returns the file, or null if nothing was due.
 */
export async function runBackupIfDue(now = new Date()): Promise<BackupFile | null> {
  const settings = await getSettings();
  if (!settings.backupEnabled) return null;
  const [newest] = await listBackups(backupDir(settings.backupFolder));
  // Judge by the file's own time, so a wiped or changed folder is backed up right away.
  if (newest && now.getTime() - newest.at < BACKUP_INTERVAL_MS - 60_000) return null;
  return runBackup(now);
}
