import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
 
export default defineSchema({
  ...authTables,
  toolUsageDaily: defineTable({
    userId: v.string(),
    dayKey: v.string(),
    count: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_user_day", ["userId", "dayKey"]),
});
 
