/**
 * @file src/dashboard/middleware/rateLimiter.js
 * @description Production Rate Limiting Shields using express-rate-limit for ModBot.
 */

const rateLimit = require('express-rate-limit');

/**
 * Resolves unique client identifier:
 * Prioritizes authenticated user ID; falls back to client IP.
 *
 * @param {import('express').Request} req
 * @returns {string}
 */
function resolveClientKey(req) {
    if (req.session?.user?.id) {
        return `user_${req.session.user.id}`;
    }
    return req.ip || req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown';
}

/**
 * Mutation Rate Limiter:
 * Caps state mutations (POST, PUT, DELETE, PATCH) at 30 requests/minute.
 * Returns HTTP 429 Too Many Requests.
 */
const mutationLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 30, // 30 requests per window
    standardHeaders: 'draft-7', // Draft-7 standard headers (RateLimit-Limit, etc.)
    legacyHeaders: false, // Disable X-RateLimit-* legacy headers
    statusCode: 429,
    keyGenerator: resolveClientKey,
    validate: { xForwardedForHeader: false, default: true, keyGeneratorIpFallback: false },
    handler: (req, res, next, options) => {
        res.status(options.statusCode).json({
            error: 'TooManyRequests',
            message: 'تم تجاوز الحد المسموح به من الطلبات (30 طلب/دقيقة). يرجى المحاولة لاحقاً.'
        });
    },
    skip: (req) => {
        return process.env.NODE_ENV === 'test' && req.headers['x-test-bypass-rate-limit'] === 'true';
    }
});

/**
 * General API Rate Limiter:
 * Caps read requests at 100 requests/minute to prevent scraping and polling flood.
 */
const generalLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 100, // 100 requests per window
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    statusCode: 429,
    keyGenerator: resolveClientKey,
    validate: { xForwardedForHeader: false, default: true, keyGeneratorIpFallback: false },
    handler: (req, res, next, options) => {
        res.status(options.statusCode).json({
            error: 'TooManyRequests',
            message: 'تم تجاوز معدل الطلبات المسموح به (100 طلب/دقيقة). يرجى المحاولة لاحقاً.'
        });
    },
    skip: (req) => {
        return process.env.NODE_ENV === 'test' && req.headers['x-test-bypass-rate-limit'] === 'true';
    }
});

/**
 * Auth Rate Limiter:
 * Caps OAuth2 entrypoints at 20 requests per 15 minutes to defend against token abuse.
 */
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 20,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    statusCode: 429,
    keyGenerator: (req) => req.ip || 'unknown',
    validate: { xForwardedForHeader: false, default: true, keyGeneratorIpFallback: false },
    handler: (req, res, next, options) => {
        res.status(options.statusCode).json({
            error: 'TooManyRequests',
            message: 'تم تجاوز عدد محاولات تسجيل الدخول المسموح بها. يرجى المحاولة لاحقاً.'
        });
    },
    skip: (req) => {
        return process.env.NODE_ENV === 'test' && req.headers['x-test-bypass-rate-limit'] === 'true';
    }
});

module.exports = {
    mutationLimiter,
    generalLimiter,
    authLimiter,
    resolveClientKey
};
