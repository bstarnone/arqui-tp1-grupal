import rateLimit from "express-rate-limit";

const limiter = (limit) => {
    return rateLimit({
        windowMs: 30 * 1000,
        max: limit,
        standardHeaders: true, // add the `RateLimit-*` headers to the response
        legacyHeaders: false, // remove the `X-RateLimit-*` headers from the response
    });
}

export default limiter;