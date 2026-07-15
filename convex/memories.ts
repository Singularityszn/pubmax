import { v } from "convex/values";
import { memoryDto } from "./dtoValidators";
import { requireOwnerIdentity } from "./lib/auth";
import { toMemoryDto } from "./lib/dto";
import { findOwnedPal } from "./lib/ownedPal";
import { query } from "./model";

export const listMine = query({
  args: { status: v.optional(v.union(v.literal("proposed"), v.literal("approved"))) },
  returns: v.array(memoryDto),
  handler: async (ctx, args) => {
    const owner = await requireOwnerIdentity(ctx.auth);
    const pal = await findOwnedPal(ctx, owner);
    if (!pal) return [];
    const status = args.status ?? "approved";
    const records = await ctx.db
      .query("palMemories")
      .withIndex("by_pal_status", (q) => q.eq("palId", pal._id).eq("status", status))
      .order("desc")
      .take(100);
    return records.map(toMemoryDto);
  },
});
