import { getAuthUserId } from '@convex-dev/auth/server';
import { query } from '../_generated/server';
export const viewer = query({
  args: {},
  handler:async(ctx, args_0) =>{
		const userId = await getAuthUserId(ctx);
		if(!userId) return null;
		return await ctx.db.get(userId)
	},
});
