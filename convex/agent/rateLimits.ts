import { defineRateLimits } from 'convex-helpers/server/rateLimit';

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export const TOOL_CALLS_PER_DAY_LIMIT = 3;
export const THREAD_CREATIONS_PER_DAY_LIMIT = 20;

export const { checkRateLimit, rateLimit } = defineRateLimits({
  toolCallsPerDay: {
    kind: 'fixed window',
    rate: TOOL_CALLS_PER_DAY_LIMIT,
    period: DAY,
  },
  threadCreationsPerDay: {
    kind: 'fixed window',
    rate: THREAD_CREATIONS_PER_DAY_LIMIT,
    period: DAY,
  },
});
