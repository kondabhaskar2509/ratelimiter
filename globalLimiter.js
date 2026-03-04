import { formatTime } from './utils.js';

export default class GlobalLimiter {
    constructor(capacity, refillAmount, refillTime, redisClient) {
        this.capacity = capacity;
        this.refillAmount = refillAmount;
        this.refillTime = refillTime;
        this.redisClient = redisClient;
        this.key = 'global:limiter';
    }

    async handleRequest() {
        const currentTime = Date.now();
        const state = await this.redisClient.hGetAll(this.key);
        let bucket;

        if (!state.tokens || !state.ts) {
            bucket = { tokens: this.capacity, ts: currentTime };
        } else {
            bucket = {
                tokens: Number(state.tokens),
                ts: Number(state.ts),
            };
        }

        const elapsedTime = Math.floor((currentTime - bucket.ts) / (this.refillTime * 1000));

        if (elapsedTime >= 1) {
            const newTokens = elapsedTime * this.refillAmount;
            bucket.tokens = Math.min(this.capacity, bucket.tokens + newTokens);
            bucket.ts = currentTime;
        }
        
        if (bucket.tokens <= 0) {
            console.log(`[GLOBAL] Request rejected at ${formatTime()}, system overloaded`);
            await this.redisClient.hSet(this.key, {
                tokens: bucket.tokens,
                ts: bucket.ts,
            });
            await this.redisClient.expire(this.key, 3600);
            return { allowed: false, tokensLeft: bucket.tokens };
        }

        bucket.tokens -= 1;
        await this.redisClient.hSet(this.key, {
            tokens: bucket.tokens,
            ts: bucket.ts,
        });
        await this.redisClient.expire(this.key, 3600);

        console.log(`[GLOBAL] Request allowed at ${formatTime()}, ${bucket.tokens} global tokens left`);
        return { allowed: true, tokensLeft: bucket.tokens };
    }
}
