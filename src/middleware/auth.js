const jwt = require('jsonwebtoken');
const { config } = require('../config');
const { User } = require('../models/index');

const JWT_SECRET = config.jwtSecret;
console.log('Auth middleware loaded, JWT_SECRET exists:', !!JWT_SECRET);
const ADMIN_EMAILS = config.adminEmails;
let mongoConnected = false;

// Set mongo connection status from outside
const setMongoConnected = (status) => {
    mongoConnected = status;
};

const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        req.user = null;
        return next();
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            req.user = null;
            return next();
        }
        req.user = user;
        next();
    });
};

const requireAuth = (req, res, next) => {
    if (!req.user) {
        return res.status(401).json({ error: 'Authentication required. Please log in.' });
    }
    next();
};

const requireAdmin = async (req, res, next) => {
    if (!req.user) {
        return res.status(401).json({ error: 'Authentication required. Admin access only.' });
    }

    const isEnvAdmin = ADMIN_EMAILS.includes(req.user.email);

    let isDbAdmin = false;
    if (mongoConnected) {
        try {
            const user = await User.findById(req.user.userId);
            if (user) {
                isDbAdmin = user.isAdmin === true || user.role === 'admin';
            }
        } catch (err) {
            console.error('Error checking admin status:', err.message);
        }
    }

    if (!isEnvAdmin && !isDbAdmin) {
        return res.status(403).json({ error: 'Admin access required' });
    }

    next();
};

module.exports = {
    authenticateToken,
    requireAuth,
    requireAdmin,
    setMongoConnected,
    getMongoConnected: () => mongoConnected
};
