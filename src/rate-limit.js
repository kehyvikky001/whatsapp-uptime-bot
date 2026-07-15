export function createRateLimiter({ windowMs, max, key = (req) => req.ip || "unknown" }) {
  const buckets = new Map();
  let lastSweep = 0;

  return function rateLimiter(req, res, next) {
    const now = Date.now();
    if (now - lastSweep > windowMs) {
      for (const [bucketKey, bucket] of buckets) {
        if (bucket.resetAt <= now) buckets.delete(bucketKey);
      }
      lastSweep = now;
    }

    const bucketKey = key(req);
    let bucket = buckets.get(bucketKey);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(bucketKey, bucket);
    }

    bucket.count += 1;
    res.set("x-ratelimit-limit", String(max));
    res.set("x-ratelimit-remaining", String(Math.max(0, max - bucket.count)));
    res.set("x-ratelimit-reset", String(Math.ceil(bucket.resetAt / 1000)));

    if (bucket.count > max) {
      res.set("retry-after", String(Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))));
      return res.status(429).json({ error: "rate limit exceeded" });
    }

    return next();
  };
}
