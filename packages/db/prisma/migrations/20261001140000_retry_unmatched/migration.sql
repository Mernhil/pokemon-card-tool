-- The CardTrader matcher now also finds galleries filed inside their parent expansion:
-- drop the "not found" results it gave before so they are matched again on the next refresh.
-- Manual overrides are kept. Additive/safe: a mapping is re-created on demand.
DELETE FROM "ProviderMapping" WHERE "status" = 'not_found' AND "manualOverride" = 0;
