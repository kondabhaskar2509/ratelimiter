import { formatTime } from './utils.js';

export default class tokenBucket {
    constructor(capacity, refillAmount, refillTime, redisClient) {
        this.capacity = capacity;
        this.refillAmount = refillAmount;
        this.refillTime = refillTime;
        this.redisClient = redisClient;
    }

    async handleRequest(key) {
        const redisKey = `tb:${key}`;
        const currentTime = Date.now();
        const state = await this.redisClient.hGetAll(redisKey);
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
            console.log(`request rejected at ${formatTime()}, too many requests`);
            await this.redisClient.hSet(redisKey, {
                tokens: bucket.tokens,
                ts: bucket.ts,
            });
            await this.redisClient.expire(redisKey, 3600);
            return { allowed: false, tokensLeft: bucket.tokens };
        }

        bucket.tokens -= 1;
        await this.redisClient.hSet(redisKey, {
            tokens: bucket.tokens,
            ts: bucket.ts,
        });
        await this.redisClient.expire(redisKey, 3600);

        console.log(`request sent at ${formatTime()}, no. of tokens left is ${bucket.tokens}`);
        return { allowed: true, tokensLeft: bucket.tokens };
    }
}