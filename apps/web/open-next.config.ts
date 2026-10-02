import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// Every page is rendered per request from the database (no ISR / static cache),
// so the default (in-memory) incremental cache is all this app needs.
export default defineCloudflareConfig({});
