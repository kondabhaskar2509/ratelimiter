import { formatTime } from './utils.js';

export default class leakyBucket {
    constructor(capacity, leakRate, redisClient) {
        this.capacity = capacity;
        this.leakRate = leakRate;
        this.redisClient = redisClient;
    }

    async handleRequest(key) {
        const redisKey = `lb:${key}`;
        const currentTime = Date.now();
        const state = await this.redisClient.hGetAll(redisKey);
        let bucket;
        
        if (!state.tokens || !state.lastLeakTime) {
            bucket = { tokens: 0, lastLeakTime: currentTime };
        } else {
            bucket = {
                tokens: Number(state.tokens),
                lastLeakTime: Number(state.lastLeakTime),
            };
        }
        
        const elapsedTime =Math.floor((currentTime - bucket.lastLeakTime) / 1000);
        const leakedTokens = elapsedTime * this.leakRate;
        
        bucket.tokens = Math.max(0, bucket.tokens - leakedTokens);
        bucket.lastLeakTime = currentTime;
        
        if (bucket.tokens < this.capacity) {
            bucket.tokens += 1;  
            await this.redisClient.hSet(redisKey, {
                tokens: bucket.tokens,
                lastLeakTime: bucket.lastLeakTime,
            });
            await this.redisClient.expire(redisKey, 3600);
            console.log(`request sent at ${formatTime()}, no. of tokens left is ${bucket.tokens}`);
            return { allowed: true, tokensLeft: bucket.tokens };
        } else {
            await this.redisClient.hSet(redisKey, {
                tokens: bucket.tokens,
                lastLeakTime: bucket.lastLeakTime,
            });
            await this.redisClient.expire(redisKey, 3600);
            console.log(`request rejected at ${formatTime()}, too many requests`);
            return { allowed: false, tokensLeft: bucket.tokens };
        }
    }

}
