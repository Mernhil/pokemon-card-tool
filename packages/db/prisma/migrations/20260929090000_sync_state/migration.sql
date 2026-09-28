-- Background catalog sync + lazy image cache. Additive only (new tables, one
-- new nullable column), so it can't touch existing catalog/collection rows —
-- see 20260928090000_binder_color_and_set for why no table is rebuilt.
-- AlterTable
ALTER TABLE "Printing" ADD COLUMN "imageUrls" TEXT;

-- CreateTable
CREATE TABLE "SyncState" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "job" TEXT NOT NULL,
    "game" TEXT NOT NULL,
    "itemKey" TEXT NOT NULL,
    "label" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "lastSyncedAt" DATETIME,
    "lastAttemptAt" DATETIME,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "JobLock" (
    "name" TEXT NOT NULL PRIMARY KEY,
    "holder" TEXT NOT NULL,
    "acquiredAt" DATETIME NOT NULL,
    "heartbeatAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ImageCacheEntry" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "printingId" TEXT,
    "bytes" INTEGER NOT NULL,
    "contentType" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastAccessedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "SyncState_job_game_status_idx" ON "SyncState"("job", "game", "status");

-- CreateIndex
CREATE UNIQUE INDEX "SyncState_job_game_itemKey_key" ON "SyncState"("job", "game", "itemKey");

-- CreateIndex
CREATE INDEX "ImageCacheEntry_lastAccessedAt_idx" ON "ImageCacheEntry"("lastAccessedAt");

-- CreateIndex
CREATE INDEX "ImageCacheEntry_printingId_idx" ON "ImageCacheEntry"("printingId");

