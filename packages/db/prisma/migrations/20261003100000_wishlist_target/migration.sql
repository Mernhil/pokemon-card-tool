-- Wishlist deal finder: an optional target price per wishlist card. Additive: a nullable column.
ALTER TABLE "WishlistItem" ADD COLUMN "targetEur" INTEGER;
