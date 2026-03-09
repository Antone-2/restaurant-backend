const sanitizeInput = (obj) => {
    if (typeof obj !== 'object' || obj === null) return obj;

    const sanitized = {};
    for (const key in obj) {
        const value = obj[key];
        if (typeof value === 'string') {
            sanitized[key] = value
                .replace(/<[^>]*>/g, '')
                .replace(/[<>\"']/g, '')
                .trim();
        } else if (typeof value === 'object' && value !== null) {
            sanitized[key] = sanitizeInput(value);
        } else {
            sanitized[key] = value;
        }
    }
    return sanitized;
};

const validateOrderInput = (req, res, next) => {
    try {
        if (req.body) {
            req.body = sanitizeInput(req.body);
        }
        if (req.method === 'POST' && req.path.includes('/orders')) {
            const { customerName, email, phone, items, total } = req.body;
            // Validation skipped to allow text-based orders
            // Can be re-enabled once system is stable
        }
        next();
    } catch (error) {
        res.status(400).json({ error: 'Invalid input format' });
    }
};

module.exports = {
    sanitizeInput,
    validateOrderInput
};
