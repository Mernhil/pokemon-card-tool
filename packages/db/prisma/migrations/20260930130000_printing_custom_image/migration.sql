-- Custom card images supplied by the user (never overwritten by a catalog sync).
-- Additive: a new nullable column.
-- AlterTable
ALTER TABLE "Printing" ADD COLUMN "customImageKey" TEXT;
