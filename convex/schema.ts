import { authTables } from "@convex-dev/auth/server";
import { rateLimitTables } from "convex-helpers/server/rateLimit";
import { defineSchema } from "convex/server";
 
export default defineSchema({
  ...authTables,
  ...rateLimitTables,
});
 
