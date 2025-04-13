import rateLimit from "express-rate-limit";

const limiter = (limit) => {
    return rateLimit({
        windowMs: 5 * 60 * 1000,
        max: limit,
        handler: function (res) {
            res.status(429).json({
                message: "Too many requests, please try again later.",
            });
        },
    });
}

export default limiter;