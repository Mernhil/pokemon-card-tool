-- Hand-written instead of Prisma's generated "rebuild the table" script:
-- adding columns in place needs no DROP TABLE, so it can't cascade-delete
-- BinderPage/BinderSlot rows (the desktop app's migration runner,
-- apps/web/lib/migrate.ts, doesn't pin statements to one connection, so a
-- PRAGMA foreign_keys=OFF there isn't guaranteed to cover the DROP).
ALTER TABLE "Binder" ADD COLUMN "color" TEXT NOT NULL DEFAULT '#5b1f2b';
ALTER TABLE "Binder" ADD COLUMN "setId" INTEGER REFERENCES "Set" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
