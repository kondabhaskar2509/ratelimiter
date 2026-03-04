import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from 'redis';
import { randomUUID } from 'crypto';
import tokenBucket from './tokenbucket.js';
import leakyBucket from './leakybucket.js';
import GlobalLimiter from './globalLimiter.js';
import { formatTime } from './utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
const redisClient = createClient({ url: redisUrl });

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const globalLimiter = new GlobalLimiter(500, 250, 30, redisClient);
const tokenBucketLimiter = new tokenBucket(8, 4, 10, redisClient);
const leakyBucketLimiter = new leakyBucket(4, 2, redisClient);
const maxQueueSize = 100;
const timeout = 60 * 1000;
const statustimeLimit = 65 * 1000;
const requestQueues = {
    'token-bucket': [],
    'leaky-bucket': [],
};

const requestStatuses = new Map();
let isDrainingQueue = false;

async function checkAlgorithm(algorithm, clientIP) {
    if (algorithm === 'token-bucket') {
        return tokenBucketLimiter.handleRequest(clientIP);
    }
    return leakyBucketLimiter.handleRequest(clientIP);
}

function enqueueRequest({ algorithm, clientIP, requestId }) {
    const queue = requestQueues[algorithm];
    if (!queue || queue.length >= maxQueueSize) {
        return false;
    }

    queue.push({
        algorithm,
        clientIP,
        requestId,
        enqueuedAt: Date.now(),
        timeoutAt: Date.now() + timeout,
    });
    return true;
}

function setRequestStatus(requestId, status, message, extra = {}) {
    requestStatuses.set(requestId, {
        requestId,
        status,
        message,
        updatedAt: Date.now(),
        ...extra,
    });

    setTimeout(() => {
        requestStatuses.delete(requestId);
    }, statustimeLimit);
}

async function drainQueues() {
    if (isDrainingQueue) {
        return;
    }

    isDrainingQueue = true;

    try {
        const algorithms = ['token-bucket', 'leaky-bucket'];

        for (const algorithm of algorithms) {
            const queue = requestQueues[algorithm];

            while (queue.length > 0) {
                const currentItem = queue[0];

                if (Date.now() > currentItem.timeoutAt) {
                    queue.shift();
                    setRequestStatus(
                        currentItem.requestId,
                        'timeout',
                        `Queued request timed out at ${formatTime()} by ${algorithm} algorithm.`
                    );
                    continue;
                }

                const globalResult = await globalLimiter.handleRequest();
                if (!globalResult.allowed) {
                    break;
                }

                const algorithmResult = await checkAlgorithm(algorithm, currentItem.clientIP);
                if (!algorithmResult.allowed) {
                    break;
                }

                queue.shift();
                const waitMs = Date.now() - currentItem.enqueuedAt;
                setRequestStatus(
                    currentItem.requestId,
                    'sent',
                    `Queued request sent at ${formatTime()} by ${algorithm} algorithm, ${algorithmResult.tokensLeft} tokens left. Waited ${waitMs}ms.`,
                    { waitMs, tokensLeft: algorithmResult.tokensLeft }
                );
            }
        }
    } catch (error) {
        console.error('Queue drain error:', error);
    } finally {
        isDrainingQueue = false;
    }
}

setInterval(drainQueues, 1000);

app.post('/request', async (req, res) => {
    const { algorithm = 'token-bucket' } = req.body;
    const clientIP = req.ip;
    
    let result;
    let tokensLeft = 0;

    try {
        const globalResult = await globalLimiter.handleRequest();
        if (!globalResult.allowed) {
            return res.status(503).json({
                message: `Service overloaded at ${formatTime()}. System rate limit exceeded. Try again later.`
            });
        }

        if (algorithm !== 'token-bucket' && algorithm !== 'leaky-bucket') {
            return res.status(400).json({ message: 'Invalid algorithm' });
        }

        result = await checkAlgorithm(algorithm, clientIP);
        tokensLeft = result.tokensLeft;

        if (result.allowed) {
            res.status(200).json({
                message: `Request sent at ${formatTime()} by ${algorithm} algorithm, ${tokensLeft} tokens left.`
            });
        } else {
            const requestId = randomUUID();
            const queued = enqueueRequest({ algorithm, clientIP, requestId });

            if (!queued) {
                return res.status(429).json({
                    message: `Request rejected at ${formatTime()} by ${algorithm} algorithm, queue is full.`
                });
            }

            setRequestStatus(
                requestId,
                'queued',
                `Request queued at ${formatTime()} by ${algorithm} algorithm.`
            );

            return res.status(202).json({
                requestId,
                message: `Request queued at ${formatTime()} by ${algorithm} algorithm.`
            });
        }
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ message: 'Server error: ' + error.message });
    }
});

app.get('/status/:id', (req, res) => {
    const entry = requestStatuses.get(req.params.id);
    if (!entry) {
        return res.status(404).json({ message: 'Request status not found or expired.' });
    }
    return res.status(200).json(entry);
});

redisClient.on('error', (error) => {
    console.error('Redis error:', error);
});

async function startServer() {
    try {
        await redisClient.connect();
        console.log(`Connected to Redis at ${redisUrl}`);
        app.listen(5000, () => {
            console.log('Server listening on port 5000');
        });
    } catch (error) {
        console.error('Failed to connect Redis:', error);
        process.exit(1);
    }
}

startServer();
