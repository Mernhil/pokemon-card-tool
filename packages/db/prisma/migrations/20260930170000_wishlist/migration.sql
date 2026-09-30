-- Wishlist: cards the user wants for later. Additive: a new table.
-- CreateTable
CREATE TABLE "WishlistItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "printingId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WishlistItem_printingId_fkey" FOREIGN KEY ("printingId") REFERENCES "Printing" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "WishlistItem_printingId_key" ON "WishlistItem"("printingId");
