require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');
const api = require('sib-api-v3-sdk');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const http = require('http');
const { Server } = require('socket.io');
const mpesa = require('./mpesa');
const kitchenRoutes = require('./kitchen');

const winston = require('winston');
const morgan = require('morgan');
const path = require('path');
const fs = require('fs');

const logsDir = path.join(__dirname, '../logs');
if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
}
const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        winston.format.errors({ stack: true }),
        winston.format.splat(),
        winston.format.json()
    ),
    defaultMeta: { service: 'the-quill-backend' },
    transports: [
        new winston.transports.Console({
            format: winston.format.combine(
                winston.format.colorize(),
                winston.format.printf(({ timestamp, level, message, ...meta }) => {
                    return `${timestamp} [${level}]: ${message} ${Object.keys(meta).length ? JSON.stringify(meta) : ''}`;
                })
            )
        }),
        new winston.transports.File({
            filename: path.join(logsDir, 'error.log'),
            level: 'error'
        }),
        new winston.transports.File({
            filename: path.join(logsDir, 'combined.log')
        })
    ]
});
const morganStream = {
    write: (message) => {
        logger.info(message.trim());
    }
};
const initiateMpesaPayment = async (phoneNumber, amount, orderId, customerName) => {
    try {
        const formattedPhone = mpesa.formatPhoneNumber(phoneNumber);

        const result = await mpesa.initiateSTKPush(
            formattedPhone,
            amount,
            `ORDER-${orderId}`,
            `The Quill Restaurant - Order #${orderId}`
        );

        return {
            success: true,
            isDemo: result.isDemo,
            mpesaRequestId: result.CheckoutRequestID,
            merchantRequestId: result.MerchantRequestID,
            message: result.CustomerMessage || 'M-Pesa prompt sent successfully',
            orderId,
            accountReference: `ORDER-${orderId}`,
            transactionDescription: 'The Quill Restaurant Order',
            phoneNumber: formattedPhone
        };
    } catch (err) {
        console.error('M-Pesa payment error:', err.message);
        return { success: false, error: err.message };
    }
};

const app = express();
const server = http.createServer(app);

const rateLimit = require('express-rate-limit');

const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: { error: 'Too many requests, please try again later' },
    standardHeaders: true,
    legacyHeaders: false,
});

const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: { error: 'Too many authentication attempts, please try again later' },
    standardHeaders: true,
    legacyHeaders: false,
});
const paymentLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    message: { error: 'Too many payment attempts, please try again later' },
    standardHeaders: true,
    legacyHeaders: false,
});
app.use(morgan('combined', { stream: morganStream }));
const io = new Server(server, {
    cors: {
        origin: process.env.ALLOWED_ORIGINS
            ? process.env.ALLOWED_ORIGINS.split(',')
            : ['*'],
        methods: ['GET', 'POST'],
        credentials: true
    }
});
const connectedClients = new Map();

io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);
    socket.on('register', (userData) => {
        connectedClients.set(socket.id, {
            ...userData,
            socketId: socket.id,
            connectedAt: new Date()
        });
        console.log('Client registered:', userData);
    });

    socket.on('join:admin', () => {
        socket.join('admin');
        console.log('Client joined admin room');
    });

    socket.on('join:orders', () => {
        socket.join('orders');
        console.log('Client joined orders room');
    });

    socket.on('join:reservations', () => {
        socket.join('reservations');
        console.log('Client joined reservations room');
    });

    socket.on('disconnect', () => {
        connectedClients.delete(socket.id);
        console.log('Client disconnected:', socket.id);
    });
});

const emitToRoom = (room, event, data) => {
    io.to(room).emit(event, data);
};

const emitToAll = (event, data) => {
    io.emit(event, data);
};

const PORT = process.env.PORT || 3001;
const NODE_ENV = process.env.NODE_ENV;

const JWT_SECRET = process.env.JWT_SECRET;
const ADMIN_EMAILS = process.env.ADMIN_EMAILS ? process.env.ADMIN_EMAILS.split(',').map(e => e.trim()) : [];

const FRONTEND_URL = process.env.FRONTEND_URL;

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

            // Skip validation for now to allow text-based orders
            // Validation can be re-enabled once the system is stable
            /*
            if (!customerName || customerName.length < 2) {
                return res.status(400).json({ error: 'Valid customer name required' });
            }
            if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
                return res.status(400).json({ error: 'Valid email required' });
            }
            if (!phone || phone.length < 9) {
                return res.status(400).json({ error: 'Valid phone number required' });
            }
            if (!Array.isArray(items) || items.length === 0) {
                return res.status(400).json({ error: 'Order must have items' });
            }
            if (typeof total !== 'number' || total < 0) {
                return res.status(400).json({ error: 'Valid total amount required' });
            }
            */
        }

        next();
    } catch (error) {
        res.status(400).json({ error: 'Invalid input format' });
    }
};
const strictPaymentLimiter = rateLimit({
    windowMs: 30 * 60 * 1000,
    max: 3,
    message: { error: 'Too many payment attempts. Please wait before trying again.' },
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req, res) => req.user && ADMIN_EMAILS.includes(req.user.email),
    keyGenerator: (req, res) => `${req.ip}-${req.body?.phone}`
});

const allowedOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
    : [];

const corsOptions = {
    origin: (origin, callback) => {
        if (!origin) {
            return callback(null, true);
        }
        if (NODE_ENV) {
            return callback(null, true);
        }
        if (allowedOrigins.includes(origin)) {
            callback(null, true);
        } else {
            console.log(`CORS blocked origin: ${origin}`);
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization']
};

app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            scriptSrc: ["'self'"],
            imgSrc: ["'self'", "data:", "https:"],
            connectSrc: ["'self'", "wss:", "https:"],
        },
    },
    crossOriginEmbedderPolicy: false,
}));

app.use(cors(corsOptions));
app.use(apiLimiter);
app.use(express.json());
app.use(validateOrderInput);
app.use(authenticateToken);
let mongoConnected = false;

let brevoClient = null;

const initBrevo = () => {
    try {
        brevoClient = api.ApiClient.instance;
        brevoClient.authentications['api-key'].apiKey = process.env.BREVO_API_KEY;
        console.log('Brevo API initialized');
    } catch (error) {
        console.error('Brevo init error:', error.message);
    }
};

initBrevo();
const orderSchema = new mongoose.Schema({
    _id: String,
    userId: { type: String, default: null },
    customerName: { type: String, required: true },
    email: { type: String, required: true },
    phone: { type: String, required: true },
    items: Array,
    subtotal: Number,
    tax: { type: Number, default: 0 },
    deliveryFee: { type: Number, default: 0 },
    total: Number,
    paymentMethod: { type: String, enum: ['cash', 'card', 'mpesa', 'bank'], default: 'cash' },
    paymentStatus: { type: String, enum: ['pending', 'completed', 'failed', 'refunded', 'partially_refunded'], default: 'pending' },
    mpesaRequestId: String,
    mpesaTransactionId: String,
    status: {
        type: String,
        enum: ['pending', 'confirmed', 'preparing', 'ready', 'out_for_delivery', 'delivered', 'cancelled', 'refunded'],
        default: 'pending'
    },
    deliveryType: { type: String, enum: ['pickup', 'delivery'], default: 'pickup' },
    deliveryAddress: {
        street: String,
        city: String,
        instructions: String
    },
    deliveryPerson: {
        name: String,
        phone: String,
        vehicle: String
    },
    deliveryAssignedAt: Date,
    deliveryStartedAt: Date,
    deliveryCompletedAt: Date,
    estimatedDeliveryTime: Date,
    refundAmount: { type: Number, default: 0 },
    refundReason: String,
    refundedAt: Date,
    refundProcessedBy: String,
    invoiceNumber: String,
    statusHistory: [{
        status: String,
        timestamp: Date,
        note: String
    }],
    notes: String,
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});
const Order = mongoose.model('Order', orderSchema);

const reservationSchema = new mongoose.Schema({
    _id: String,
    name: String,
    email: String,
    phone: String,
    date: String,
    time: String,
    guests: Number,
    tableName: String,
    specialRequests: String,
    createdAt: { type: Date, default: Date.now }
});
const Reservation = mongoose.model('Reservation', reservationSchema);

const parkingSchema = new mongoose.Schema({
    _id: String,
    name: String,
    email: String,
    phone: String,
    vehiclePlate: String,
    date: String,
    time: String,
    slotNumber: String,
    createdAt: { type: Date, default: Date.now }
});
const Parking = mongoose.model('Parking', parkingSchema);

const tableSchema = new mongoose.Schema({
    _id: String,
    tableNumber: { type: String, required: true, unique: true },
    capacity: { type: Number, required: true, default: 4 },
    status: { type: String, enum: ['available', 'occupied', 'reserved', 'maintenance'], default: 'available' },
    section: { type: String, default: 'main' },
    position: { type: String, default: '' },
    isActive: { type: Boolean, default: true },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});
const Table = mongoose.model('Table', tableSchema);

const reviewSchema = new mongoose.Schema({
    _id: String,
    name: String,
    rating: Number,
    comment: String,
    orderId: String,
    userId: String,
    email: String,
    status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
    isVisible: { type: Boolean, default: false },
    adminReply: String,
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});
const Review = mongoose.model('Review', reviewSchema);

const eventSchema = new mongoose.Schema({
    _id: String,
    name: String,
    email: String,
    eventType: String,
    date: String,
    guests: Number,
    createdAt: { type: Date, default: Date.now }
});
const Event = mongoose.model('Event', eventSchema);

const contactSchema = new mongoose.Schema({
    _id: String,
    name: String,
    email: String,
    message: String,
    createdAt: { type: Date, default: Date.now }
});
const Contact = mongoose.model('Contact', contactSchema);

const menuItemSchema = new mongoose.Schema({
    _id: String,
    name: { type: String, required: true },
    description: String,
    price: { type: Number, required: true },
    category: { type: String, required: true },
    image: String,
    imageUrl: String,
    popular: { type: Boolean, default: false },
    available: { type: Boolean, default: true },
    stockQuantity: { type: Number, default: 0 },
    lowStockThreshold: { type: Number, default: 5 },
    trackInventory: { type: Boolean, default: false },
    nutritionalInfo: {
        calories: { type: Number, default: 0 },
        protein: { type: Number, default: 0 },
        carbohydrates: { type: Number, default: 0 },
        fat: { type: Number, default: 0 },
        fiber: { type: Number, default: 0 },
        sodium: { type: Number, default: 0 },
        allergens: [String],
        dietaryInfo: [String]
    },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});
const MenuItem = mongoose.model('MenuItem', menuItemSchema);

const subscriberSchema = new mongoose.Schema({
    _id: String,
    email: String,
    createdAt: { type: Date, default: Date.now }
});
const Subscriber = mongoose.model('Subscriber', subscriberSchema);

const userSchema = new mongoose.Schema({
    _id: String,
    email: { type: String, unique: true, sparse: true },
    password: String,
    name: String,
    phone: String,
    address: String,
    emailVerified: { type: Boolean, default: false },
    role: { type: String, enum: ['customer', 'admin', 'staff'], default: 'customer' },
    isAdmin: { type: Boolean, default: false },
    addresses: [{
        _id: String,
        label: String,
        street: String,
        city: String,
        instructions: String,
        isDefault: { type: Boolean, default: false }
    }],
    paymentMethods: [{
        _id: String,
        type: { type: String, enum: ['card', 'mpesa'], required: true },
        label: String,
        last4: String,
        expiryMonth: Number,
        expiryYear: Number,
        cardholderName: String,
        mobileNumber: String,
        isDefault: { type: Boolean, default: false },
        addedAt: { type: Date, default: Date.now }
    }],
    notificationPreferences: {
        orderUpdates: { type: Boolean, default: true },
        promotionalEmails: { type: Boolean, default: false },
        reservationReminders: { type: Boolean, default: true },
        marketingSMS: { type: Boolean, default: false },
        pushNotifications: { type: Boolean, default: true }
    },
    dataPrivacyAgreed: { type: Boolean, default: false },
    accountStatus: { type: String, enum: ['active', 'suspended', 'deleted'], default: 'active' },
    deletedAt: Date,
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});
const User = mongoose.model('User', userSchema);

const wishlistSchema = new mongoose.Schema({
    _id: String,
    userId: { type: String, required: true },
    items: [{
        menuItemId: String,
        name: String,
        price: Number,
        image: String,
        category: String,
        addedAt: { type: Date, default: Date.now }
    }],
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});
const Wishlist = mongoose.model('Wishlist', wishlistSchema);

const cartSchema = new mongoose.Schema({
    _id: String,
    userId: { type: String, required: true },
    items: [{
        menuItemId: String,
        name: String,
        price: Number,
        quantity: Number,
        specialInstructions: String,
        addedAt: { type: Date, default: Date.now }
    }],
    appliedCoupon: {
        code: String,
        discount: Number
    },
    orderType: { type: String, enum: ['dinein', 'takeaway', 'delivery'], default: 'takeaway' },
    selectedAddress: String,
    notes: String,
    expiresAt: { type: Date, default: () => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) }, // 30 days
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});
cartSchema.index({ userId: 1 });
cartSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
const Cart = mongoose.model('Cart', cartSchema);

const loyaltyPointsSchema = new mongoose.Schema({
    _id: String,
    userId: { type: String, required: true },
    points: { type: Number, default: 0 },
    lifetimePoints: { type: Number, default: 0 },
    tier: { type: String, enum: ['bronze', 'silver', 'gold', 'platinum'], default: 'bronze' },
    referralCode: String,
    referredBy: String,
    pointsHistory: [{
        points: Number,
        type: { type: String, enum: ['earn', 'redeem', 'bonus', 'expire', 'referral'] },
        description: String,
        orderId: String,
        createdAt: { type: Date, default: Date.now }
    }],
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});
const LoyaltyPoints = mongoose.model('LoyaltyPoints', loyaltyPointsSchema);
const couponSchema = new mongoose.Schema({
    _id: String,
    code: { type: String, required: true, unique: true },
    description: String,
    discountType: { type: String, enum: ['percentage', 'fixed'], required: true },
    discountValue: { type: Number, required: true },
    minOrderAmount: { type: Number, default: 0 },
    maxUses: { type: Number, default: null },
    usedCount: { type: Number, default: 0 },
    validFrom: Date,
    validUntil: Date,
    isActive: { type: Boolean, default: true },
    applicableCategories: [String],
    createdAt: { type: Date, default: Date.now }
});
const Coupon = mongoose.model('Coupon', couponSchema);

const deliveryPartnerSchema = new mongoose.Schema({
    _id: String,
    name: { type: String, required: true },
    phone: { type: String, required: true, unique: true },
    email: { type: String, unique: true, sparse: true },
    vehicleType: { type: String, enum: ['bike', 'car', 'van'], required: true },
    vehiclePlate: { type: String, required: true },
    status: { type: String, enum: ['active', 'offline', 'busy', 'unavailable'], default: 'offline' },
    currentLocation: {
        latitude: Number,
        longitude: Number,
        updatedAt: Date
    },
    assignedOrders: [String],
    completedOrders: { type: Number, default: 0 },
    rating: { type: Number, default: 5.0, min: 1, max: 5 },
    averageDeliveryTime: { type: Number, default: 0 },
    totalDistance: { type: Number, default: 0 },
    bankDetails: {
        accountName: String,
        bankName: String,
        accountNumber: String
    },
    documents: {
        idNumber: String,
        licenseNumber: String,
        insuranceExpiry: Date
    },
    joinedAt: { type: Date, default: Date.now },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});
deliveryPartnerSchema.index({ status: 1 });
deliveryPartnerSchema.index({ 'currentLocation.latitude': 1, 'currentLocation.longitude': 1 });
const DeliveryPartner = mongoose.model('DeliveryPartner', deliveryPartnerSchema);
const ticketSchema = new mongoose.Schema({
    _id: String,
    userId: String,
    orderId: String,
    subject: { type: String, required: true },
    category: { type: String, enum: ['order', 'payment', 'delivery', 'account', 'other'], default: 'other' },
    priority: { type: String, enum: ['low', 'medium', 'high'], default: 'medium' },
    status: { type: String, enum: ['open', 'in_progress', 'resolved', 'closed'], default: 'open' },
    messages: [{
        sender: { type: String, enum: ['customer', 'support'] },
        message: String,
        timestamp: { type: Date, default: Date.now }
    }],
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});
const Ticket = mongoose.model('Ticket', ticketSchema);

// FAQ Schema
const faqSchema = new mongoose.Schema({
    _id: String,
    question: { type: String, required: true },
    answer: { type: String, required: true },
    category: { type: String, default: 'general' },
    isActive: { type: Boolean, default: true },
    order: { type: Number, default: 0 },
    createdAt: { type: Date, default: Date.now }
});
const FAQ = mongoose.model('FAQ', faqSchema);

const sendEmailNotification = async (to, subject, htmlContent) => {
    try {
        // Modern email template wrapper
        const modernTemplate = (content) => `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${subject}</title>
</head>
<body style="margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f5f5f5;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f5f5f5; padding: 20px;">
        <tr>
            <td align="center">
                <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.1);">
                    ${content}
                </table>
            </td>
        </tr>
    </table>
</body>
</html>
        `;

        // If content doesn't have the full template, wrap it
        if (!htmlContent.includes('<!DOCTYPE html>')) {
            htmlContent = modernTemplate(`
                <tr>
                    <td style="background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); padding: 40px 30px; text-align: center;">
                        <h1 style="color: #ffffff; margin: 0; font-size: 28px; font-weight: 700;">🍽️ The Quill</h1>
                        <p style="color: #a0a0a0; margin: 10px 0 0 0; font-size: 14px;">Fine Dining Experience</p>
                    </td>
                </tr>
                <tr>
                    <td style="padding: 40px 30px;">
                        ${htmlContent}
                    </td>
                </tr>
                <tr>
                    <td style="background-color: #f8f9fa; padding: 20px; text-align: center;">
                        <p style="color: #999999; margin: 0; font-size: 12px;">© 2026 The Quill Restaurant. All rights reserved.</p>
                        <p style="color: #999999; margin: 5px 0 0 0; font-size: 11px;">Nambale, Kisumu - Busia Rd, Busia, Kenya</p>
                    </td>
                </tr>
            `);
        }

        if (!process.env.BREVO_API_KEY) {
            console.log(`[DEMO] Email to: ${to}, Subject: ${subject}`);
            return false;
        }

        const apiInstance = new api.TransactionalEmailsApi(brevoClient);
        const sendSmtpEmail = new api.SendSmtpEmail();
        sendSmtpEmail.subject = subject;
        sendSmtpEmail.htmlContent = htmlContent;
        sendSmtpEmail.sender = {
            name: 'The Quill Restaurant',
            email: process.env.BREVO_SENDER_EMAIL
        };
        sendSmtpEmail.to = [{ email: to }];

        await apiInstance.sendTransacEmail(sendSmtpEmail);
        console.log(` Email sent successfully to: ${to}`);
        return true;
    } catch (error) {
        console.error(' Email error:', error.message);
        console.error(' Details:', error.response?.body?.message || error.response?.statusCode);
        return false;
    }
};

const sendSMSNotification = async (phoneNumber, message) => {
    try {
        console.log(`[SMS DISABLED] Would send to: ${phoneNumber}`);
        return false;
    } catch (error) {
        console.error('SMS error:', error.message);
        return false;
    }
};

const sendOrderNotifications = async (order) => {
    const customerEmail = order.email;
    const customerPhone = order.phone;
    const orderNumber = order._id;
    const totalAmount = order.total;
    const items = order.items && Array.isArray(order.items)
        ? order.items.map(item => `${item.name || 'Item'} x${item.quantity || 1}`).join(', ')
        : 'No items listed';
    const formattedDate = new Date(order.createdAt).toLocaleDateString('en-GB', {
        day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit'
    });

    const emailSubject = `Order Confirmed! - The Quill Restaurant #${orderNumber}`;
    const emailHtml = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <body style="margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f5f5f5;">
            <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f5f5f5; padding: 20px;">
                <tr>
                    <td align="center">
                        <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 10px; overflow: hidden; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
                            <!-- Header -->
                            <tr>
                                <td style="background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); padding: 30px; text-align: center;">
                                    <h1 style="color: #ffffff; margin: 0; font-size: 28px; font-weight: 600;">🍽️ The Quill</h1>
                                    <p style="color: #a0a0a0; margin: 10px 0 0 0; font-size: 14px;">Fine Dining Experience</p>
                                </td>
                            </tr>
                            <!-- Content -->
                            <tr>
                                <td style="padding: 40px 30px;">
                                    <div style="text-align: center; margin-bottom: 30px;">
                                        <div style="width: 80px; height: 80px; background-color: #27ae60; border-radius: 50%; margin: 0 auto 20px; display: flex; align-items: center; justify-content: center;">
                                            <span style="color: white; font-size: 40px;">✓</span>
                                        </div>
                                        <h2 style="color: #1a1a2e; margin: 0 0 10px 0; font-size: 24px;">Order Confirmed!</h2>
                                        <p style="color: #666666; margin: 0;">Thank you for your order, <strong>${order.customerName}</strong>!</p>
                                    </div>
                                    
                                    <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f8f9fa; border-radius: 8px; margin: 20px 0;">
                                        <tr>
                                            <td style="padding: 20px;">
                                                <p style="margin: 0 0 10px 0; color: #1a1a2e; font-size: 14px;"><strong>Order Number:</strong> <span style="color: #e74c3c;">#${orderNumber}</span></p>
                                                <p style="margin: 0 0 10px 0; color: #1a1a2e; font-size: 14px;"><strong>Date:</strong> ${formattedDate}</p>
                                                <p style="margin: 0 0 10px 0; color: #1a1a2e; font-size: 14px;"><strong>Payment Method:</strong> ${order.paymentMethod === 'mpesa' ? 'M-Pesa' : order.paymentMethod === 'cash' ? 'Cash on Delivery/Pickup' : order.paymentMethod}</p>
                                                <p style="margin: 0; color: #1a1a2e; font-size: 14px;"><strong>Status:</strong> <span style="color: #27ae60;">${order.status}</span></p>
                                            </td>
                                        </tr>
                                    </table>
                                    
                                    <table width="100%" cellpadding="0" cellspacing="0" style="margin: 20px 0;">
                                        <tr>
                                            <td style="border-bottom: 1px solid #eeeeee; padding-bottom: 10px; color: #1a1a2e; font-weight: 600;">Items Ordered</td>
                                        </tr>
                                        <tr>
                                            <td style="padding: 15px 0; color: #666666; font-size: 14px;">${items}</td>
                                        </tr>
                                    </table>
                                    
                                    <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #1a1a2e; border-radius: 8px; margin: 20px 0;">
                                        <tr>
                                            <td style="padding: 20px; text-align: center;">
                                                <p style="color: #ffffff; margin: 0; font-size: 14px;">Total Amount</p>
                                                <p style="color: #ffffff; margin: 10px 0 0 0; font-size: 32px; font-weight: bold;">KES ${totalAmount.toLocaleString()}</p>
                                            </td>
                                        </tr>
                                    </table>
                                    
                                    <p style="color: #999999; font-size: 12px; text-align: center; margin-top: 30px;">
                                        If you have any questions about your order, please contact us at pomraningrichard@gmail.com
                                    </p>
                                </td>
                            </tr>
                            <tr>
                                <td style="background-color: #f8f9fa; padding: 20px; text-align: center;">
                                    <p style="color: #999999; margin: 0; font-size: 12px;">© 2026 The Quill Restaurant. All rights reserved.</p>
                                    <p style="color: #999999; margin: 5px 0 0 0; font-size: 11px;">Nambale, Kisumu - Busia Rd, Busia, Kenya</p>
                                </td>
                            </tr>
                        </table>
                    </td>
                </tr>
            </table>
        </body>
        </html>
    `;

    const smsMessage = `The Quill: Order #${orderNumber} confirmed! Total: KES ${totalAmount.toLocaleString()}. Thank you!`;

    if (customerEmail) await sendEmailNotification(customerEmail, emailSubject, emailHtml);
    if (customerPhone) await sendSMSNotification(customerPhone, smsMessage);

    const adminEmail = process.env.ADMIN_EMAIL;
    if (adminEmail) {
        const adminSubject = ` New Order Received - #${orderNumber}`;
        const adminHtml = `
            <!DOCTYPE html>
            <html>
            <head><meta charset="utf-8"></head>
            <body style="margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: #f5f5f5;">
                <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f5f5f5; padding: 20px;">
                    <tr><td align="center">
                        <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 10px; overflow: hidden;">
                            <tr>
                                <td style="background: #e74c3c; padding: 20px; text-align: center;">
                                    <h1 style="color: #ffffff; margin: 0;">🛒 New Order</h1>
                                </td>
                            </tr>
                            <tr>
                                <td style="padding: 20px;">
                                    <h2 style="color: #e74c3c; margin: 0 0 15px 0;">New Order Received!</h2>
                                    <table width="100%" cellpadding="10" cellspacing="0" style="background-color: #fff3cd; border-radius: 8px;">
                                        <tr><td><strong>Order #:</strong> ${orderNumber}</td></tr>
                                        <tr><td><strong>Customer:</strong> ${order.customerName}</td></tr>
                                        <tr><td><strong>Phone:</strong> ${order.phone}</td></tr>
                                        <tr><td><strong>Email:</strong> ${order.email}</td></tr>
                                        <tr><td><strong>Items:</strong> ${items}</td></tr>
                                        <tr><td><strong>Total:</strong> KES ${totalAmount.toLocaleString()}</td></tr>
                                        <tr><td><strong>Payment:</strong> ${order.paymentMethod}</td></tr>
                                    </table>
                                </td>
                            </tr>
                        </table>
                    </td></tr>
                </table>
            </body>
            </html>
        `;
        await sendEmailNotification(adminEmail, adminSubject, adminHtml);
    }
};

const sendReservationNotifications = async (reservation) => {
    const customerEmail = reservation.email;
    const customerPhone = reservation.phone;
    const reservationId = reservation._id;
    const date = reservation.date;
    const time = reservation.time;
    const guests = reservation.guests;

    const emailSubject = `Table Reserved! - The Quill Restaurant`;
    const emailHtml = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <body style="margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f5f5f5;">
            <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f5f5f5; padding: 20px;">
                <tr>
                    <td align="center">
                        <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 10px; overflow: hidden; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
                            <!-- Header -->
                            <tr>
                                <td style="background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); padding: 30px; text-align: center;">
                                    <h1 style="color: #ffffff; margin: 0; font-size: 28px; font-weight: 600;">🍽️ The Quill</h1>
                                    <p style="color: #a0a0a0; margin: 10px 0 0 0; font-size: 14px;">Fine Dining Experience</p>
                                </td>
                            </tr>
                            <!-- Content -->
                            <tr>
                                <td style="padding: 40px 30px;">
                                    <div style="text-align: center; margin-bottom: 30px;">
                                        <div style="width: 80px; height: 80px; background-color: #27ae60; border-radius: 50%; margin: 0 auto 20px; display: flex; align-items: center; justify-content: center;">
                                            <span style="color: white; font-size: 40px;">✓</span>
                                        </div>
                                        <h2 style="color: #1a1a2e; margin: 0 0 10px 0; font-size: 24px;">Table Reserved!</h2>
                                        <p style="color: #666666; margin: 0;">Thank you, <strong>${reservation.name}</strong>!</p>
                                    </div >

    <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f8f9fa; border-radius: 8px; margin: 20px 0;">
        <tr>
            <td style="padding: 20px;">
                <p style="margin: 0 0 15px 0; color: #1a1a2e; font-size: 15px;">
                    <span style="display: inline-block; width: 30px;">📅</span>
                    <strong>Date:</strong> ${date}
                </p>
                <p style="margin: 0 0 15px 0; color: #1a1a2e; font-size: 15px;">
                    <span style="display: inline-block; width: 30px;">🕐</span>
                    <strong>Time:</strong> ${time}
                </p>
                <p style="margin: 0 0 15px 0; color: #1a1a2e; font-size: 15px;">
                    <span style="display: inline-block; width: 30px;">👥</span>
                    <strong>Guests:</strong> ${guests} ${guests === 1 ? 'person' : 'people'}
                </p>
                <p style="margin: 0; color: #1a1a2e; font-size: 15px;">
                    <span style="display: inline-block; width: 30px;">🎫</span>
                    <strong>Reservation ID:</strong> ${reservationId}
                </p>
            </td>
        </tr>
    </table>
                                    
                                    ${reservation.specialRequests ? `
                                    <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #fff3cd; border-radius: 8px; margin: 20px 0;">
                                        <tr>
                                            <td style="padding: 15px;">
                                                <p style="margin: 0; color: #1a1a2e; font-size: 14px;"><strong>Special Requests:</strong></p>
                                                <p style="margin: 5px 0 0 0; color: #666666; font-size: 14px;">${reservation.specialRequests}</p>
                                            </td>
                                        </tr>
                                    </table>
                                    ` : ''
        }
                                    
                                    <div style="background-color: #1a1a2e; border-radius: 8px; padding: 20px; margin: 20px 0; text-align: center;">
                                        <p style="color: #ffffff; margin: 0 0 10px 0; font-size: 14px;">Need to modify your reservation?</p>
                                        <p style="color: #a0a0a0; margin: 0; font-size: 12px;">Contact us at pomraningrichard@gmail.com or call us directly</p>
                                    </div>
                                    
                                    <p style="color: #999999; font-size: 12px; text-align: center; margin-top: 30px;">
                                        We look forward to serving you!
                                    </p>
                                </td >
                            </tr >
        
    <tr>
        <td style="background-color: #f8f9fa; padding: 20px; text-align: center;">
            <p style="color: #999999; margin: 0; font-size: 12px;">© 2026 The Quill Restaurant. All rights reserved.</p>
            <p style="color: #999999; margin: 5px 0 0 0; font-size: 11px;">Nambale, Kisumu - Busia Rd, Busia, Kenya</p>
        </td>
    </tr>
                        </table >
                    </td >
                </tr >
            </table >
        </body >
        </html >
    `;

    if (customerEmail) await sendEmailNotification(customerEmail, emailSubject, emailHtml);
    if (customerPhone) await sendSMSNotification(customerPhone, `The Quill: Table reserved for ${guests} on ${date} at ${time}.ID: ${reservationId} `);

    const adminEmail = process.env.ADMIN_EMAIL;
    if (adminEmail) {
        const adminSubject = ` New Table Reservation - ${reservationId}`;
        const adminHtml = `
        <!DOCTYPE html>
        <html>
            <head><meta charset="utf-8"></head>
            <body style="margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: #f5f5f5;">
                <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f5f5f5; padding: 20px;">
                    <tr><td align="center">
                        <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 10px; overflow: hidden;">
                            <tr>
                                <td style="background: #9b59b6; padding: 20px; text-align: center;">
                                    <h1 style="color: #ffffff; margin: 0;">📅 New Reservation</h1>
                                </td>
                            </tr>
                            <tr>
                                <td style="padding: 20px;">
                                    <h2 style="color: #9b59b6; margin: 0 0 15px 0;">New Table Reservation!</h2>
                                    <table width="100%" cellpadding="10" cellspacing="0" style="background-color: #f0f0f0; border-radius: 8px;">
                                        <tr><td><strong>Reservation ID:</strong> ${reservationId}</td></tr>
                                        <tr><td><strong>Name:</strong> ${reservation.name}</td></tr>
                                        <tr><td><strong>Phone:</strong> ${reservation.phone}</td></tr>
                                        <tr><td><strong>Email:</strong> ${reservation.email}</td></tr>
                                        <tr><td><strong>Date:</strong> ${date} at ${time}</td></tr>
                                        <tr><td><strong>Guests:</strong> ${guests}</td></tr>
                                        ${reservation.specialRequests ? `<tr><td><strong>Special Requests:</strong> ${reservation.specialRequests}</td></tr>` : ''}
                                    </table>
                                </td>
                            </tr>
                        </table>
                    </td></tr>
                </table>
            </body>
        </html>
`;
        await sendEmailNotification(adminEmail, adminSubject, adminHtml);
    }
};

const sendParkingNotifications = async (reservation) => {
    const customerEmail = reservation.email;
    const reservationId = reservation._id;
    const date = reservation.date;
    const time = reservation.time;
    const slotNumber = reservation.slotNumber;

    const emailSubject = `Parking Reserved! - The Quill`;
    const emailHtml = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <body style="margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f5f5f5;">
            <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f5f5f5; padding: 20px;">
                <tr>
                    <td align="center">
                        <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 10px; overflow: hidden; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
                            <tr>
                                <td style="background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); padding: 30px; text-align: center;">
                                    <h1 style="color: #ffffff; margin: 0; font-size: 28px; font-weight: 600;">🚗 The Quill</h1>
                                    <p style="color: #a0a0a0; margin: 10px 0 0 0; font-size: 14px;">Parking Reservation</p>
                                </td>
                            </tr>
                            <tr>
                                <td style="padding: 40px; text-align: center;">
                                    <div style="width: 80px; height: 80px; background-color: #27ae60; border-radius: 50%; margin: 0 auto 20px; display: flex; align-items: center; justify-content: center;">
                                        <span style="color: white; font-size: 40px;">✓</span>
                                    </div>
                                    <h2 style="color: #1a1a2e; margin: 0 0 15px 0; font-size: 24px;">Parking Confirmed!</h2>
                                    <p style="color: #666666; margin: 0 0 20px 0;">Hello <strong>${reservation.name}</strong>!</p>
                                    
                                    <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f8f9fa; border-radius: 8px; margin: 20px 0;">
                                        <tr>
                                            <td style="padding: 20px;">
                                                <p style="margin: 0 0 15px 0; color: #1a1a2e; font-size: 15px;"><strong>Slot Number:</strong> ${slotNumber}</p>
                                                <p style="margin: 0 0 15px 0; color: #1a1a2e; font-size: 15px;"><strong>Date:</strong> ${date}</p>
                                                <p style="margin: 0; color: #1a1a2e; font-size: 15px;"><strong>Time:</strong> ${time}</p>
                                            </td>
                                        </tr>
                                    </table>
                                    
                                    <p style="color: #999999; font-size: 12px; text-align: center; margin-top: 30px;">
                                        We look forward to serving you!
                                    </p>
                                </td>
                            </tr>
                            <tr>
                                <td style="background-color: #f8f9fa; padding: 20px; text-align: center;">
                                    <p style="color: #999999; margin: 0; font-size: 12px;">© 2026 The Quill Restaurant. All rights reserved.</p>
                                </td>
                            </tr>
                        </table>
                    </td>
                </tr>
            </table>
        </body>
        </html>
    `;

    if (customerEmail) await sendEmailNotification(customerEmail, emailSubject, emailHtml);

    const adminEmail = process.env.ADMIN_EMAIL;
    if (adminEmail) {
        await sendEmailNotification(adminEmail, `New Parking - ${reservationId}`,
            `<p>New parking: ${reservation.name}, ${reservation.vehiclePlate}, Slot ${slotNumber}</p>`);
    }
};

const menuData = [
    { name: 'Crispy Calamari', description: 'Tender squid rings lightly battered', price: 1299, category: 'starters', popular: true, available: true, image: 'https://images.unsplash.com/photo-1599487488170-d11ec9c172f0?w=400' },
    { name: 'Bruschetta Trio', description: 'Three classic bruschetta variations', price: 899, category: 'starters', popular: false, available: true, image: 'https://images.unsplash.com/photo-1572695157366-5e585ab2b69f?w=400' },
    { name: 'Soup of the Day', description: 'Chef\'s daily creation', price: 549, category: 'starters', popular: false, available: true, image: 'https://images.unsplash.com/photo-1547592166-23ac45744acd?w=400' },
    { name: 'Wagyu Beef Steak', description: 'Premium A5 Wagyu beef', price: 5499, category: 'mains', popular: true, available: true, image: 'https://images.unsplash.com/photo-1544025162-d76694265947?w=400' },
    { name: 'Pan-Seared Salmon', description: 'Fresh Atlantic salmon', price: 2499, category: 'mains', popular: true, available: true, image: 'https://images.unsplash.com/photo-1467003909585-2f8a72700288?w=400' },
    { name: 'Truffle Risotto', description: 'Creamy Arborio rice', price: 1899, category: 'mains', popular: false, available: true, image: 'https://images.unsplash.com/photo-1476124369491-e7addf5db371?w=400' },
    { name: 'Herb Roasted Chicken', description: 'Free-range chicken', price: 1799, category: 'mains', popular: true, available: true, image: 'https://images.unsplash.com/photo-1598103442097-8b74394b95c6?w=400' },
    { name: 'Lobster Thermidor', description: 'Succulent lobster meat', price: 3999, category: 'mains', popular: true, available: true, image: 'https://images.unsplash.com/photo-1559737558-2f5a35f4523b?w=400' },
    { name: 'Vegetable Wellington', description: 'Seasonal vegetables', price: 1599, category: 'mains', popular: false, available: true, image: 'https://images.unsplash.com/photo-1540420773420-3366772f4999?w=400' },
    { name: 'Signature Cocktail', description: 'House cocktail', price: 1499, category: 'drinks', popular: true, available: true, image: 'https://images.unsplash.com/photo-1514362545857-3bc16c4c7d1b?w=400' },
    { name: 'Fresh Smoothie Bowl', description: 'Blended acai', price: 799, category: 'drinks', popular: false, available: true, image: 'https://images.unsplash.com/photo-1590301157890-4810ed352733?w=400' },
    { name: 'Artisan Coffee', description: 'Single-origin coffee', price: 349, category: 'drinks', popular: false, available: true, image: 'https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?w=400' },
    { name: 'Chef\'s Tasting Menu', description: '7-course journey', price: 4999, category: 'specials', popular: true, available: true, image: 'https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=400' },
    { name: 'Seafood Platter', description: 'Fresh seafood selection', price: 4499, category: 'specials', popular: true, available: true, image: 'https://images.unsplash.com/photo-1559847844-5315695dadae?w=400' }
];

app.post('/api/auth/register', authLimiter, async (req, res) => {
    try {
        const { email, password, name, phone } = req.body;

        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password required' });
        }

        const existingUser = await User.findOne({ email });
        if (existingUser) {
            return res.status(409).json({ error: 'User already exists' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const userId = 'USR-' + uuidv4().substring(0, 8).toUpperCase();

        const verifyToken = jwt.sign(
            { userId, email, type: 'email-verify' },
            JWT_SECRET,
            { expiresIn: '24h' }
        );

        const user = new User({
            _id: userId,
            email,
            password: hashedPassword,
            name: name || email.split('@')[0],
            phone: phone || ''
        });

        await user.save();

        const verifyUrl = `${FRONTEND_URL}/verify-email?token=${verifyToken}`;
        const emailSubject = ` Welcome to The Quill Restaurant - Verify Your Email`;
        const emailHtml = `
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="utf-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
            </head>
            <body style="margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f5f5f5;">
                <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f5f5f5; padding: 20px;">
                    <tr>
                        <td align="center">
                            <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.1);">
                                <!-- Header -->
                                <tr>
                                    <td style="background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); padding: 40px 30px; text-align: center;">
                                        <div style="width: 80px; height: 80px; background: rgba(255,255,255,0.1); border-radius: 50%; margin: 0 auto 15px; display: flex; align-items: center; justify-content: center;">
                                            <span style="color: white; font-size: 40px;">🍽️</span>
                                        </div>
                                        <h1 style="color: #ffffff; margin: 0; font-size: 28px; font-weight: 700;">The Quill Restaurant</h1>
                                        <p style="color: #a0a0a0; margin: 10px 0 0 0; font-size: 14px;">Fine Dining Experience</p>
                                    </td>
                                </tr>
                                <!-- Content -->
                                <tr>
                                    <td style="padding: 40px 30px;">
                                        <div style="text-align: center; margin-bottom: 30px;">
                                            <div style="width: 100px; height: 100px; background: linear-gradient(135deg, #3498db 0%, #2980b9 100%); border-radius: 50%; margin: 0 auto 25px; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 15px rgba(52, 152, 219, 0.3);">
                                                <span style="color: white; font-size: 50px;">📧</span>
                                            </div>
                                            <h2 style="color: #1a1a2e; margin: 0 0 15px 0; font-size: 28px; font-weight: 700;">Welcome to The Quill, ${user.name}! 🎉</h2>
                                            <p style="color: #666666; margin: 0; font-size: 16px; line-height: 1.6;">
                                                Thank you for joining our restaurant family! We're excited to have you with us.
                                            </p>
                                        </div>
                                        
                                        <p style="color: #666666; font-size: 14px; line-height: 1.6; text-align: center;">
                                            To get started, please verify your email address by clicking the button below:
                                        </p>
                                        
                <table width="100%" cellpadding="0" cellspacing="0" style="margin: 30px 0;">
                                            <tr>
                                                <td align="center">
                                                    <a href="${verifyUrl}" style="display: inline-block; background: linear-gradient(135deg, #3498db 0%, #2980b9 100%); color: #ffffff; padding: 16px 45px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 16px; box-shadow: 0 4px 15px rgba(52, 152, 219, 0.3);">
                                                        Verify My Account
                                                    </a>
                                                </td>
                                            </tr>
                                        </table>
                                        
                                        <p style="color: #999999; font-size: 12px; text-align: center; margin-top: 25px;">
                                            This verification link will expire in <strong>24 hours</strong>.
                                        </p>
                                        
                                        <!-- What to Expect -->
                                        <div style="background-color: #f8f9fa; border-radius: 10px; padding: 25px; margin-top: 30px;">
                                            <h3 style="color: #1a1a2e; margin: 0 0 15px 0; font-size: 16px; text-align: center;">What Awaits You ✨</h3>
                                            <table width="100%" cellpadding="0" cellspacing="0">
                                                <tr>
                                                    <td style="padding: 8px 0; color: #666666; font-size: 14px;">
                                                        <span style="margin-right: 8px;">🍕</span> Order delicious food online
                                                    </td>
                                                </tr>
                                                <tr>
                                                    <td style="padding: 8px 0; color: #666666; font-size: 14px;">
                                                        <span style="margin-right: 8px;">📅</span> Reserve tables for special occasions
                                                    </td>
                                                </tr>
                                                <tr>
                                                    <td style="padding: 8px 0; color: #666666; font-size: 14px;">
                                                        <span style="margin-right: 8px;">🚗</span> Book parking spaces
                                                    </td>
                                                </tr>
                                                <tr>
                                                    <td style="padding: 8px 0; color: #666666; font-size: 14px;">
                                                        <span style="margin-right: 8px;">🎁</span> Get exclusive offers and deals
                                                    </td>
                                                </tr>
                                            </table>
                                        </div>
                                        
                                        <p style="color: #999999; font-size: 12px; text-align: center; margin-top: 25px;">
                                            If you didn't create an account, please ignore this email or contact us if you have concerns.
                                        </p>
                                        
                                        <div style="background-color: #f8f9fa; border-radius: 8px; padding: 15px; margin-top: 25px; text-align: center;">
                                            <p style="color: #999999; margin: 0; font-size: 11px;">
                                                The Quill Restaurant · Nambale, Kisumu - Busia Rd, Busia, Kenya<br>
                                                © 2026 All rights reserved.
                                            </p>
                                        </div>
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>
                </table>
            </body>
            </html>
        `;

        await sendEmailNotification(email, emailSubject, emailHtml);

        const token = jwt.sign(
            { userId: user._id, email: user.email },
            JWT_SECRET,
            { expiresIn: '7d' }
        );

        res.status(201).json({
            message: 'Registration successful. Please check your email to verify your account.',
            requiresVerification: true,
            email: user.email
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/auth/login', authLimiter, async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password required' });
        }

        const user = await User.findOne({ email });
        if (!user) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const isAdminUser = ADMIN_EMAILS.includes(user.email) || user.isAdmin === true || user.role === 'admin';

        if (!user.emailVerified && !isAdminUser) {
            return res.status(403).json({ error: 'Please verify your email before logging in' });
        }

        const token = jwt.sign(
            { userId: user._id, email: user.email },
            JWT_SECRET,
            { expiresIn: '7d' }
        );

        const isAdmin = ADMIN_EMAILS.includes(user.email) || user.isAdmin === true || user.role === 'admin';

        res.json({
            message: 'Login successful',
            token,
            user: { userId: user._id, email: user.email, name: user.name, isAdmin }
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/auth/verify-email/:token', async (req, res) => {
    try {
        const { token } = req.params;

        if (!token) {
            return res.status(400).json({ error: 'Verification token is required' });
        }
        const decoded = jwt.verify(token, JWT_SECRET);

        if (decoded.type !== 'email-verify') {
            return res.status(400).json({ error: 'Invalid verification token' });
        }
        const user = await User.findById(decoded.userId);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        if (user.emailVerified) {
            return res.json({
                message: 'Email already verified. You can now log in.',
                verified: true
            });
        }

        user.emailVerified = true;
        await user.save();

        res.json({
            message: 'Email verified successfully! You can now log in.',
            verified: true,
            email: user.email
        });
    } catch (err) {
        if (err.name === 'TokenExpiredError') {
            return res.status(401).json({
                error: 'Verification link has expired. Please register again or request a new verification link.'
            });
        }
        if (err.name === 'JsonWebTokenError') {
            return res.status(400).json({ error: 'Invalid verification token' });
        }
        res.status(500).json({ error: err.message });
    }
});
app.post('/api/auth/resend-verification', authLimiter, async (req, res) => {
    try {
        const { email } = req.body;

        if (!email) {
            return res.status(400).json({ error: 'Email is required' });
        }

        const user = await User.findOne({ email });
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        if (user.emailVerified) {
            return res.json({ message: 'Email is already verified' });
        }

        const verifyToken = jwt.sign(
            { userId: user._id, email: user.email, type: 'email-verify' },
            JWT_SECRET,
            { expiresIn: '24h' }
        );

        const verifyUrl = `${FRONTEND_URL}/verify-email?token=${verifyToken}`;
        const emailSubject = `📧 Verify Your Email - The Quill Restaurant`;
        const emailHtml = `
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="utf-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
            </head>
            <body style="margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f5f5f5;">
                <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f5f5f5; padding: 20px;">
                    <tr>
                        <td align="center">
                            <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.1);">
                                <tr>
                                    <td style="background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); padding: 40px 30px; text-align: center;">
                                        <div style="width: 80px; height: 80px; background: rgba(255,255,255,0.1); border-radius: 50%; margin: 0 auto 15px; display: flex; align-items: center; justify-content: center;">
                                            <span style="color: white; font-size: 40px;">🍽️</span>
                                        </div>
                                        <h1 style="color: #ffffff; margin: 0; font-size: 28px; font-weight: 700;">The Quill Restaurant</h1>
                                        <p style="color: #a0a0a0; margin: 10px 0 0 0; font-size: 14px;">Email Verification</p>
                                    </td>
                                </tr>
                                <tr>
                                    <td style="padding: 40px 30px;">
                                        <div style="text-align: center; margin-bottom: 30px;">
                                            <div style="width: 100px; height: 100px; background: linear-gradient(135deg, #3498db 0%, #2980b9 100%); border-radius: 50%; margin: 0 auto 25px; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 15px rgba(52, 152, 219, 0.3);">
                                                <span style="color: white; font-size: 50px;">📧</span>
                                            </div>
                                            <h2 style="color: #1a1a2e; margin: 0 0 15px 0; font-size: 28px; font-weight: 700;">Verify Your Email</h2>
                                            <p style="color: #666666; margin: 0; font-size: 16px;">Hello <strong>${user.name}</strong>!</p>
                                        </div>
                                        
                                        <p style="color: #666666; font-size: 14px; line-height: 1.6; text-align: center;">
                                            Thank you for registering with The Quill Restaurant. Please verify your email address by clicking the button below:
                                        </p>
                                        
                                        <table width="100%" cellpadding="0" cellspacing="0" style="margin: 30px 0;">
                                            <tr>
                                                <td align="center">
                                                    <a href="${verifyUrl}" style="display: inline-block; background: linear-gradient(135deg, #3498db 0%, #2980b9 100%); color: #ffffff; padding: 16px 45px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 16px; box-shadow: 0 4px 15px rgba(52, 152, 219, 0.3);">
                                                        Verify Email
                                                    </a>
                                                </td>
                                            </tr>
                                        </table>
                                        
                                        <p style="color: #999999; font-size: 12px; text-align: center; margin-top: 25px;">
                                            This verification link will expire in <strong>24 hours</strong>.
                                        </p>
                                        
                                        <p style="color: #999999; font-size: 12px; text-align: center; margin-top: 20px;">
                                            If you didn't create an account, please ignore this email or contact us if you have concerns.
                                        </p>
                                        
                                        <div style="background-color: #f8f9fa; border-radius: 8px; padding: 15px; margin-top: 30px; text-align: center;">
                                            <p style="color: #999999; margin: 0; font-size: 11px;">
                                                The Quill Restaurant · Nambale, Kisumu - Busia Rd, Busia, Kenya<br>
                                                © 2026 All rights reserved.
                                            </p>
                                        </div>
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>
                </table>
            </body>
            </html>
        `;

        await sendEmailNotification(email, emailSubject, emailHtml);

        res.json({ message: 'Verification email sent. Please check your inbox.' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
app.post('/api/auth/forgot-password', authLimiter, async (req, res) => {
    try {
        const { email } = req.body;

        if (!email) {
            return res.status(400).json({ error: 'Email is required' });
        }

        const user = await User.findOne({ email });
        if (!user) {
            return res.json({ message: 'If an account exists with this email, you will receive a password reset link shortly.' });
        }
        const resetToken = jwt.sign(
            { userId: user._id, email: user.email, type: 'password-reset' },
            JWT_SECRET,
            { expiresIn: '1h' }
        );

        const resetUrl = `${FRONTEND_URL}/reset-password?token=${resetToken}`;

        const emailSubject = `🔐 Reset Your Password - The Quill Restaurant`;
        const emailHtml = `
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="utf-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
            </head>
            <body style="margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f5f5f5;">
                <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f5f5f5; padding: 20px;">
                    <tr>
                        <td align="center">
                            <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 10px; overflow: hidden; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
                                <tr>
                                    <td style="background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); padding: 30px; text-align: center;">
                                        <h1 style="color: #ffffff; margin: 0; font-size: 28px; font-weight: 600;">🔐 The Quill</h1>
                                        <p style="color: #a0a0a0; margin: 10px 0 0 0; font-size: 14px;">Password Reset</p>
                                    </td>
                                </tr>
                                <tr>
                                    <td style="padding: 40px 30px;">
                                        <div style="text-align: center; margin-bottom: 30px;">
                                            <div style="width: 80px; height: 80px; background-color: #3498db; border-radius: 50%; margin: 0 auto 20px; display: flex; align-items: center; justify-content: center;">
                                                <span style="color: white; font-size: 40px;">🔑</span>
                                            </div>
                                            <h2 style="color: #1a1a2e; margin: 0 0 10px 0; font-size: 24px;">Reset Your Password</h2>
                                            <p style="color: #666666; margin: 0;">Hello <strong>${user.name}</strong>,</p>
                                        </div>
                                        
                                        <p style="color: #666666; font-size: 14px; line-height: 1.6;">
                                            We received a request to reset your password. Click the button below to create a new password:
                                        </p>
                                        
                                        <table width="100%" cellpadding="0" cellspacing="0" style="margin: 30px 0;">
                                            <tr>
                                                <td align="center">
                                                    <a href="${resetUrl}" style="display: inline-block; background: linear-gradient(135deg, #e74c3c 0%, #c0392b 100%); color: #ffffff; padding: 15px 40px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 16px;">
                                                        Reset Password
                                                    </a>
                                                </td>
                                            </tr>
                                        </table>
                                        
                                        <p style="color: #999999; font-size: 12px; text-align: center; margin-top: 20px;">
                                            This link will expire in <strong>1 hour</strong>.
                                        </p>
                                        
                                        <p style="color: #999999; font-size: 12px; text-align: center; margin-top: 20px;">
                                            If you didn't request a password reset, please ignore this email or contact support if you have concerns.
                                        </p>
                                        
                                        <div style="background-color: #f8f9fa; border-radius: 8px; padding: 15px; margin-top: 30px; text-align: center;">
                                            <p style="color: #999999; margin: 0; font-size: 11px;">
                                                The Quill Restaurant · Busia, Kenya<br>
                                                © 2026 All rights reserved.
                                            </p>
                                        </div>
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>
                </table>
            </body>
            </html>
        `;

        await sendEmailNotification(email, emailSubject, emailHtml);

        res.json({ message: 'If an account exists with this email, you will receive a password reset link shortly.' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
app.post('/api/auth/reset-password', async (req, res) => {
    try {
        const { token, newPassword } = req.body;

        if (!token || !newPassword) {
            return res.status(400).json({ error: 'Token and new password are required' });
        }

        if (newPassword.length < 6) {
            return res.status(400).json({ error: 'Password must be at least 6 characters' });
        }

        let decoded;
        try {
            decoded = jwt.verify(token, JWT_SECRET);
        } catch (err) {
            return res.status(400).json({ error: 'Invalid or expired token' });
        }

        if (decoded.type !== 'password-reset') {
            return res.status(400).json({ error: 'Invalid token type' });
        }

        const user = await User.findById(decoded.userId);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        const hashedPassword = await bcrypt.hash(newPassword, 10);
        user.password = hashedPassword;
        await user.save();
        const emailSubject = `✅ Password Reset Successful - The Quill Restaurant`;
        const emailHtml = `
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="utf-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
            </head>
            <body style="margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f5f5f5;">
                <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f5f5f5; padding: 20px;">
                    <tr>
                        <td align="center">
                            <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 10px; overflow: hidden; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
                                <tr>
                                    <td style="background: linear-gradient(135deg, #27ae60 0%, #1e8449 100%); padding: 30px; text-align: center;">
                                        <h1 style="color: #ffffff; margin: 0; font-size: 28px; font-weight: 600;">✅ The Quill</h1>
                                        <p style="color: #a0a0a0; margin: 10px 0 0 0; font-size: 14px;">Password Reset Confirmation</p>
                                    </td>
                                </tr>
                                <tr>
                                    <td style="padding: 40px 30px; text-align: center;">
                                        <div style="width: 80px; height: 80px; background-color: #27ae60; border-radius: 50%; margin: 0 auto 20px; display: flex; align-items: center; justify-content: center;">
                                            <span style="color: white; font-size: 40px;">✓</span>
                                        </div>
                                        <h2 style="color: #1a1a2e; margin: 0 0 10px 0; font-size: 24px;">Password Reset Successful!</h2>
                                        <p style="color: #666666; margin: 0;">Hello <strong>${user.name}</strong>,</p>
                                        <p style="color: #666666; font-size: 14px; margin-top: 20px;">
                                            Your password has been successfully reset. You can now login with your new password.
                                        </p>
                                        <p style="color: #999999; font-size: 12px; margin-top: 30px;">
                                            If you didn't make this change, please contact support immediately.
                                        </p>
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>
                </table>
            </body>
            </html>
        `;

        await sendEmailNotification(user.email, emailSubject, emailHtml);

        res.json({ message: 'Password reset successful. You can now login with your new password.' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
app.post('/api/auth/change-password', async (req, res) => {
    try {
        if (!req.user) {
            return res.status(401).json({ error: 'Authentication required' });
        }

        const { currentPassword, newPassword } = req.body;

        if (!currentPassword || !newPassword) {
            return res.status(400).json({ error: 'Current and new passwords are required' });
        }

        if (newPassword.length < 6) {
            return res.status(400).json({ error: 'New password must be at least 6 characters' });
        }

        if (currentPassword === newPassword) {
            return res.status(400).json({ error: 'New password must be different from current password' });
        }

        const user = await User.findById(req.user.userId);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        const validPassword = await bcrypt.compare(currentPassword, user.password);
        if (!validPassword) {
            return res.status(401).json({ error: 'Current password is incorrect' });
        }
        const hashedPassword = await bcrypt.hash(newPassword, 10);
        user.password = hashedPassword;
        user.updatedAt = new Date();
        await user.save();
        const emailSubject = `🔐 Password Changed - The Quill Restaurant`;
        const emailHtml = `
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="utf-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
            </head>
            <body style="margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f5f5f5;">
                <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f5f5f5; padding: 20px;">
                    <tr>
                        <td align="center">
                            <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 10px; overflow: hidden; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
                                <tr>
                                    <td style="background: linear-gradient(135deg, #3498db 0%, #2980b9 100%); padding: 30px; text-align: center;">
                                        <h1 style="color: #ffffff; margin: 0; font-size: 28px; font-weight: 600;">🔐 The Quill</h1>
                                        <p style="color: #a0a0a0; margin: 10px 0 0 0; font-size: 14px;">Password Changed</p>
                                    </td>
                                </tr>
                                <tr>
                                    <td style="padding: 40px 30px; text-align: center;">
                                        <div style="width: 80px; height: 80px; background-color: #3498db; border-radius: 50%; margin: 0 auto 20px; display: flex; align-items: center; justify-content: center;">
                                            <span style="color: white; font-size: 40px;">✓</span>
                                        </div>
                                        <h2 style="color: #1a1a2e; margin: 0 0 10px 0; font-size: 24px;">Password Updated Successfully!</h2>
                                        <p style="color: #666666; margin: 0;">Hello <strong>${user.name}</strong>,</p>
                                        <p style="color: #666666; font-size: 14px; margin-top: 20px;">
                                            Your password has been successfully changed. If this wasn't you, please contact support immediately.
                                        </p>
                                        <p style="color: #999999; font-size: 12px; margin-top: 30px;">
                                            For security reasons, you may need to log in again on some devices.
                                        </p>
                                    </td>
                                </tr>
                                <tr>
                                    <td style="background-color: #f8f9fa; padding: 15px; text-align: center;">
                                        <p style="color: #999999; margin: 0; font-size: 11px;">
                                            © 2026 The Quill Restaurant. All rights reserved.
                                        </p>
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>
                </table>
            </body>
            </html>
        `;

        await sendEmailNotification(user.email, emailSubject, emailHtml);

        res.json({ message: 'Password changed successfully' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/auth/verify-email', async (req, res) => {
    try {
        const { token } = req.body;

        if (!token) {
            return res.status(400).json({ error: 'Verification token is required' });
        }

        let decoded;
        try {
            decoded = jwt.verify(token, JWT_SECRET);
        } catch (err) {
            return res.status(400).json({ error: 'Invalid or expired token' });
        }

        if (decoded.type !== 'email-verify') {
            return res.status(400).json({ error: 'Invalid token type' });
        }

        const user = await User.findById(decoded.userId);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        if (user.emailVerified) {
            return res.json({ message: 'Email already verified. You can proceed to login.' });
        }

        user.emailVerified = true;
        user.updatedAt = new Date();
        await user.save();

        const emailSubject = ` Welcome to The Quill Restaurant!`;
        const emailHtml = `
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="utf-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
            </head>
            <body style="margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f5f5f5;">
                <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f5f5f5; padding: 20px;">
                    <tr>
                        <td align="center">
                            <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.1);">
                                <!-- Header with Logo -->
                                <tr>
                                    <td style="background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); padding: 40px 30px; text-align: center;">
                                        <div style="width: 80px; height: 80px; background: rgba(255,255,255,0.1); border-radius: 50%; margin: 0 auto 15px; display: flex; align-items: center; justify-content: center;">
                                            <span style="color: white; font-size: 40px;">🍽️</span>
                                        </div>
                                        <h1 style="color: #ffffff; margin: 0; font-size: 28px; font-weight: 700;">The Quill Restaurant</h1>
                                        <p style="color: #a0a0a0; margin: 10px 0 0 0; font-size: 14px;">Fine Dining Experience</p>
                                    </td>
                                </tr>
                                <!-- Welcome Content -->
                                <tr>
                                    <td style="padding: 40px 30px; text-align: center;">
                                        <div style="width: 100px; height: 100px; background: linear-gradient(135deg, #27ae60 0%, #1e8449 100%); border-radius: 50%; margin: 0 auto 25px; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 15px rgba(39, 174, 96, 0.3);">
                                            <span style="color: white; font-size: 50px;">✓</span>
                                        </div>
                                        
                                        <h2 style="color: #1a1a2e; margin: 0 0 15px 0; font-size: 28px; font-weight: 700;">Welcome Aboard, ${user.name}! 🎉</h2>
                                        
                                        <p style="color: #666666; font-size: 16px; margin: 0 0 25px 0; line-height: 1.6;">
                                            Your account has been successfully verified. We're thrilled to have you join <strong>The Quill</strong> family!
                                        </p>
                                        
                                        <!-- Features Grid -->
                                        <table width="100%" cellpadding="0" cellspacing="0" style="margin: 30px 0;">
                                            <tr>
                                                <td style="padding: 10px;">
                                                    <table width="100%" cellpadding="0" cellspacing="0" style="background: #f8f9fa; border-radius: 10px; padding: 20px;">
                                                        <tr>
                                                            <td style="text-align: center;">
                                                                <div style="width: 50px; height: 50px; background: #3498db; border-radius: 12px; margin: 0 auto 12px; display: flex; align-items: center; justify-content: center;">
                                                                    <span style="color: white; font-size: 24px;">🍕</span>
                                                                </div>
                                                                <p style="color: #1a1a2e; font-size: 14px; font-weight: 600; margin: 0;">Order Online</p>
                                                                <p style="color: #999999; font-size: 12px; margin: 5px 0 0 0;">Browse our menu</p>
                                                            </td>
                                                        </tr>
                                                    </table>
                                                </td>
                                                <td style="padding: 10px;">
                                                    <table width="100%" cellpadding="0" cellspacing="0" style="background: #f8f9fa; border-radius: 10px; padding: 20px;">
                                                        <tr>
                                                            <td style="text-align: center;">
                                                                <div style="width: 50px; height: 50px; background: #9b59b6; border-radius: 12px; margin: 0 auto 12px; display: flex; align-items: center; justify-content: center;">
                                                                    <span style="color: white; font-size: 24px;">📅</span>
                                                                </div>
                                                                <p style="color: #1a1a2e; font-size: 14px; font-weight: 600; margin: 0;">Reserve Tables</p>
                                                                <p style="color: #999999; font-size: 12px; margin: 5px 0 0 0;">Book your spot</p>
                                                            </td>
                                                        </tr>
                                                    </table>
                                                </td>
                                                <td style="padding: 10px;">
                                                    <table width="100%" cellpadding="0" cellspacing="0" style="background: #f8f9fa; border-radius: 10px; padding: 20px;">
                                                        <tr>
                                                            <td style="text-align: center;">
                                                                <div style="width: 50px; height: 50px; background: #e67e22; border-radius: 12px; margin: 0 auto 12px; display: flex; align-items: center; justify-content: center;">
                                                                    <span style="color: white; font-size: 24px;">🚗</span>
                                                                </div>
                                                                <p style="color: #1a1a2e; font-size: 14px; font-weight: 600; margin: 0;">Parking</p>
                                                                <p style="color: #999999; font-size: 12px; margin: 5px 0 0 0;">Reserve spaces</p>
                                                            </td>
                                                        </tr>
                                                    </table>
                                                </td>
                                            </tr>
                                        </table>
                                        
                                        <!-- CTA Button -->
                                        <table width="100%" cellpadding="0" cellspacing="0" style="margin: 30px 0;">
                                            <tr>
                                                <td align="center">
                                                    <a href="${FRONTEND_URL}/menu" style="display: inline-block; background: linear-gradient(135deg, #e74c3c 0%, #c0392b 100%); color: #ffffff; padding: 16px 45px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 16px; box-shadow: 0 4px 15px rgba(231, 76, 60, 0.3);">
                                                        Explore Our Menu
                                                    </a>
                                                </td>
                                            </tr>
                                        </table>
                                        
                                        <p style="color: #999999; font-size: 13px; margin-top: 30px; line-height: 1.6;">
                                            Have questions? We're here to help! Contact us at <a href="mailto:pomraningrichard@gmail.com" style="color: #3498db;">pomraningrichard@gmail.com</a>
                                        </p>
                                    </td>
                                </tr>
                                <!-- Footer -->
                                <tr>
                                    <td style="background-color: #f8f9fa; padding: 25px; text-align: center;">
                                        <p style="color: #1a1a2e; margin: 0 0 10px 0; font-size: 14px; font-weight: 600;">Follow Us</p>
                                        <p style="color: #666666; margin: 0 0 15px 0; font-size: 12px;">Stay updated with our latest offerings</p>
                                        <p style="color: #999999; margin: 0; font-size: 11px;">© 2026 The Quill Restaurant. All rights reserved.</p>
                                        <p style="color: #999999; margin: 5px 0 0 0; font-size: 11px;">Nambale, Kisumu - Busia Rd, Busia, Kenya</p>
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>
                </table>
            </body>
            </html>
        `;

        await sendEmailNotification(user.email, emailSubject, emailHtml);

        res.json({ message: 'Email verified successfully! Welcome to The Quill.' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/auth/profile', async (req, res) => {
    try {
        if (!req.user) {
            return res.status(401).json({ error: 'Not authenticated' });
        }

        const user = await User.findById(req.user.userId);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        res.json({
            userId: user._id,
            email: user.email,
            name: user.name,
            phone: user.phone,
            address: user.address
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
app.put('/api/auth/profile', async (req, res) => {
    try {
        if (!req.user) {
            return res.status(401).json({ error: 'Not authenticated' });
        }

        const { name, phone, address } = req.body;
        const user = await User.findByIdAndUpdate(
            req.user.userId,
            { name, phone, address, updatedAt: new Date() },
            { new: true }
        );

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        res.json({
            message: 'Profile updated successfully',
            user: { userId: user._id, email: user.email, name: user.name }
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
app.post('/api/auth/change-password', async (req, res) => {
    try {
        if (!req.user) {
            return res.status(401).json({ error: 'Not authenticated' });
        }

        const { currentPassword, newPassword } = req.body;

        if (!currentPassword || !newPassword) {
            return res.status(400).json({ error: 'Current password and new password are required' });
        }

        if (newPassword.length < 6) {
            return res.status(400).json({ error: 'New password must be at least 6 characters' });
        }

        const user = await User.findById(req.user.userId);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        const validPassword = await bcrypt.compare(currentPassword, user.password);
        if (!validPassword) {
            return res.status(400).json({ error: 'Current password is incorrect' });
        }

        user.password = await bcrypt.hash(newPassword, 10);
        user.updatedAt = new Date();
        await user.save();

        res.json({ message: 'Password changed successfully' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
app.delete('/api/auth/account', async (req, res) => {
    try {
        if (!req.user) {
            return res.status(401).json({ error: 'Not authenticated' });
        }

        const user = await User.findByIdAndDelete(req.user.userId);

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        await Order.deleteMany({ userId: req.user.userId });
        await Wishlist.deleteMany({ userId: req.user.userId });

        res.json({ message: 'Account deleted successfully' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
app.put('/api/auth/preferences', async (req, res) => {
    try {
        if (!req.user) {
            return res.status(401).json({ error: 'Not authenticated' });
        }

        const { notificationPreferences } = req.body;

        const user = await User.findByIdAndUpdate(
            req.user.userId,
            {
                notificationPreferences,
                updatedAt: new Date()
            },
            { new: true }
        );

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        res.json({ message: 'Preferences updated', notificationPreferences: user.notificationPreferences });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
app.get('/api/auth/addresses', async (req, res) => {
    try {
        if (!req.user) {
            return res.status(401).json({ error: 'Not authenticated' });
        }

        const user = await User.findById(req.user.userId);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        res.json({ addresses: user.addresses || [] });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/auth/addresses', async (req, res) => {
    try {
        if (!req.user) {
            return res.status(401).json({ error: 'Not authenticated' });
        }

        const { label, street, city, instructions, isDefault } = req.body;

        if (!street || !city) {
            return res.status(400).json({ error: 'Street and city are required' });
        }

        const user = await User.findById(req.user.userId);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        const addressId = 'ADDR-' + uuidv4().substring(0, 8).toUpperCase();
        const newAddress = {
            _id: addressId,
            label: label || 'Other',
            street,
            city,
            instructions: instructions || '',
            isDefault: isDefault || false
        };

        if (isDefault && user.addresses) {
            user.addresses.forEach(addr => addr.isDefault = false);
        }

        user.addresses = user.addresses || [];
        user.addresses.push(newAddress);
        user.updatedAt = new Date();
        await user.save();

        res.status(201).json({ message: 'Address added', address: newAddress });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/auth/addresses/:id', async (req, res) => {
    try {
        if (!req.user) {
            return res.status(401).json({ error: 'Not authenticated' });
        }

        const { id } = req.params;

        const user = await User.findById(req.user.userId);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        user.addresses = (user.addresses || []).filter(addr => addr._id !== id);
        user.updatedAt = new Date();
        await user.save();

        res.json({ message: 'Address deleted' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
app.put('/api/auth/addresses/:id/default', async (req, res) => {
    try {
        if (!req.user) {
            return res.status(401).json({ error: 'Not authenticated' });
        }

        const { id } = req.params;

        const user = await User.findById(req.user.userId);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        user.addresses = (user.addresses || []).map(addr => ({
            ...addr,
            isDefault: addr._id === id
        }));
        user.updatedAt = new Date();
        await user.save();

        res.json({ message: 'Default address updated', addresses: user.addresses });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
app.get('/api/auth/payment-methods', async (req, res) => {
    try {
        if (!req.user) {
            return res.status(401).json({ error: 'Not authenticated' });
        }

        const user = await User.findById(req.user.userId);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        const methods = (user.paymentMethods || []).map(m => ({
            _id: m._id,
            type: m.type,
            label: m.label,
            last4: m.last4,
            expiryMonth: m.expiryMonth,
            expiryYear: m.expiryYear,
            mobileNumber: m.mobileNumber ? m.mobileNumber.slice(-4) : null,
            isDefault: m.isDefault,
            addedAt: m.addedAt
        }));

        res.json({ paymentMethods: methods });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
app.post('/api/auth/payment-methods', async (req, res) => {
    try {
        if (!req.user) {
            return res.status(401).json({ error: 'Not authenticated' });
        }

        const { type, label, last4, expiryMonth, expiryYear, cardholderName, mobileNumber } = req.body;

        if (!type || !['card', 'mpesa'].includes(type)) {
            return res.status(400).json({ error: 'Invalid payment method type' });
        }

        if (type === 'card' && (!last4 || !expiryMonth || !expiryYear)) {
            return res.status(400).json({ error: 'Card details are required' });
        }

        if (type === 'mpesa' && !mobileNumber) {
            return res.status(400).json({ error: 'Mobile number is required for M-Pesa' });
        }

        const user = await User.findById(req.user.userId);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        const newMethod = {
            _id: uuidv4(),
            type,
            label: label || (type === 'card' ? `Card ending in ${last4}` : 'M-Pesa'),
            last4,
            expiryMonth,
            expiryYear,
            cardholderName,
            mobileNumber,
            isDefault: (user.paymentMethods || []).length === 0, // First method is default
            addedAt: new Date()
        };

        user.paymentMethods = (user.paymentMethods || []);
        user.paymentMethods.push(newMethod);
        user.updatedAt = new Date();
        await user.save();

        res.status(201).json({ message: 'Payment method added', paymentMethod: newMethod });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
app.put('/api/auth/payment-methods/:id', async (req, res) => {
    try {
        if (!req.user) {
            return res.status(401).json({ error: 'Not authenticated' });
        }

        const { id } = req.params;
        const { label, isDefault } = req.body;

        const user = await User.findById(req.user.userId);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        user.paymentMethods = (user.paymentMethods || []).map(m => {
            if (m._id === id) {
                return { ...m, label: label || m.label, isDefault: isDefault === true };
            }
            return { ...m, isDefault: isDefault === true ? false : m.isDefault };
        });
        user.updatedAt = new Date();
        await user.save();

        res.json({ message: 'Payment method updated', paymentMethods: user.paymentMethods });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
app.delete('/api/auth/payment-methods/:id', async (req, res) => {
    try {
        if (!req.user) {
            return res.status(401).json({ error: 'Not authenticated' });
        }

        const { id } = req.params;

        const user = await User.findById(req.user.userId);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        const methodToDelete = (user.paymentMethods || []).find(m => m._id === id);
        if (!methodToDelete) {
            return res.status(404).json({ error: 'Payment method not found' });
        }

        user.paymentMethods = (user.paymentMethods || []).filter(m => m._id !== id);

        if (methodToDelete.isDefault && user.paymentMethods.length > 0) {
            user.paymentMethods[0].isDefault = true;
        }

        user.updatedAt = new Date();
        await user.save();

        res.json({ message: 'Payment method deleted' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
app.get('/api/cart', async (req, res) => {
    try {
        if (!req.user) {
            return res.status(401).json({ error: 'Not authenticated' });
        }

        let cart = await Cart.findOne({ userId: req.user.userId });
        if (!cart) {
            cart = new Cart({ _id: uuidv4(), userId: req.user.userId, items: [] });
            await cart.save();
        }

        res.json(cart);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
app.post('/api/cart/items', async (req, res) => {
    try {
        if (!req.user) {
            return res.status(401).json({ error: 'Not authenticated' });
        }

        const { menuItemId, name, price, quantity, specialInstructions } = req.body;

        if (!menuItemId || !name || !price || quantity <= 0) {
            return res.status(400).json({ error: 'Invalid item data' });
        }

        let cart = await Cart.findOne({ userId: req.user.userId });
        if (!cart) {
            cart = new Cart({ _id: uuidv4(), userId: req.user.userId, items: [] });
        }
        const existingItem = cart.items.find(item => item.menuItemId === menuItemId);
        if (existingItem) {
            existingItem.quantity += quantity;
        } else {
            cart.items.push({
                menuItemId,
                name,
                price,
                quantity,
                specialInstructions: specialInstructions || '',
                addedAt: new Date()
            });
        }

        cart.updatedAt = new Date();
        await cart.save();

        res.json({ message: 'Item added to cart', cart });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
app.put('/api/cart/items/:itemId', async (req, res) => {
    try {
        if (!req.user) {
            return res.status(401).json({ error: 'Not authenticated' });
        }

        const { itemId } = req.params;
        const { quantity, specialInstructions } = req.body;

        const cart = await Cart.findOne({ userId: req.user.userId });
        if (!cart) {
            return res.status(404).json({ error: 'Cart not found' });
        }

        const item = cart.items.find(item => item.menuItemId === itemId);
        if (!item) {
            return res.status(404).json({ error: 'Item not in cart' });
        }

        if (quantity <= 0) {
            cart.items = cart.items.filter(item => item.menuItemId !== itemId);
        } else {
            item.quantity = quantity;
            if (specialInstructions) {
                item.specialInstructions = specialInstructions;
            }
        }

        cart.updatedAt = new Date();
        await cart.save();

        res.json({ message: 'Cart updated', cart });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/cart/items/:itemId', async (req, res) => {
    try {
        if (!req.user) {
            return res.status(401).json({ error: 'Not authenticated' });
        }

        const { itemId } = req.params;

        const cart = await Cart.findOne({ userId: req.user.userId });
        if (!cart) {
            return res.status(404).json({ error: 'Cart not found' });
        }

        cart.items = cart.items.filter(item => item.menuItemId !== itemId);
        cart.updatedAt = new Date();
        await cart.save();

        res.json({ message: 'Item removed from cart' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
app.delete('/api/cart', async (req, res) => {
    try {
        if (!req.user) {
            return res.status(401).json({ error: 'Not authenticated' });
        }

        await Cart.findOneAndDelete({ userId: req.user.userId });
        res.json({ message: 'Cart cleared' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
app.put('/api/cart', async (req, res) => {
    try {
        if (!req.user) {
            return res.status(401).json({ error: 'Not authenticated' });
        }

        const { orderType, selectedAddress, appliedCoupon, notes } = req.body;

        let cart = await Cart.findOne({ userId: req.user.userId });
        if (!cart) {
            cart = new Cart({ _id: uuidv4(), userId: req.user.userId });
        }

        if (orderType) cart.orderType = orderType;
        if (selectedAddress) cart.selectedAddress = selectedAddress;
        if (appliedCoupon) cart.appliedCoupon = appliedCoupon;
        if (notes !== undefined) cart.notes = notes;

        cart.updatedAt = new Date();
        await cart.save();

        res.json({ message: 'Cart updated', cart });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
app.delete('/api/auth/account', async (req, res) => {
    try {
        if (!req.user) {
            return res.status(401).json({ error: 'Not authenticated' });
        }

        const { password } = req.body;

        if (!password) {
            return res.status(400).json({ error: 'Password is required for account deletion' });
        }

        const user = await User.findById(req.user.userId);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) {
            return res.status(401).json({ error: 'Invalid password' });
        }
        user.accountStatus = 'deleted';
        user.deletedAt = new Date();
        user.email = null;
        user.phone = null;
        user.address = null;
        user.addresses = [];
        user.paymentMethods = [];
        user.notificationPreferences = {};

        await user.save();

        try {
            const emailContent = `
                <h2>Account Deletion Confirmation</h2>
                <p>Your account has been successfully deleted.</p>
                <p>Your personal data will be retained in anonymized form for ${process.env.DATA_RETENTION_DAYS || 90} days as required by law, then permanently deleted.</p>
                <p>If you wish to request your data earlier, please contact us.</p>
            `;
            await sendEmailNotification(user.email || req.body.email, 'Account Deleted - The Quill', emailContent);
        } catch (emailErr) {
            console.log('Could not send deletion confirmation email');
        }

        res.json({
            message: 'Account successfully deleted. Your data will be anonymized and removed within 90 days as per privacy regulations.',
            deletedAt: user.deletedAt
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
app.get('/api/auth/download-data', async (req, res) => {
    try {
        if (!req.user) {
            return res.status(401).json({ error: 'Not authenticated' });
        }

        const user = await User.findById(req.user.userId);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        const orders = await Order.find({ customerEmail: user.email });
        const wishlist = await Wishlist.findOne({ userId: req.user.userId });
        const cart = await Cart.findOne({ userId: req.user.userId });
        const loyaltyPoints = await LoyaltyPoints.findOne({ userId: req.user.userId });

        const userData = {
            user: {
                id: user._id,
                email: user.email,
                name: user.name,
                phone: user.phone,
                createdAt: user.createdAt,
                addresses: user.addresses,
                paymentMethods: user.paymentMethods,
                notificationPreferences: user.notificationPreferences
            },
            orders: orders.map(o => ({
                id: o._id,
                total: o.total,
                status: o.status,
                items: o.items,
                createdAt: o.createdAt
            })),
            wishlist: wishlist?.items || [],
            cart: cart?.items || [],
            loyaltyPoints: loyaltyPoints ? {
                currentPoints: loyaltyPoints.points,
                tier: loyaltyPoints.tier,
                lifetimePoints: loyaltyPoints.lifetimePoints
            } : null,
            exportedAt: new Date(),
            note: 'This is your personal data export as per GDPR. All information here is encrypted.'
        };

        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', 'attachment; filename="user-data-export.json"');
        res.send(JSON.stringify(userData, null, 2));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/admin/grant-access', requireAdmin, async (req, res) => {
    try {
        const { userId, role } = req.body;

        if (!userId) {
            return res.status(400).json({ error: 'User ID is required' });
        }

        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        user.isAdmin = true;
        user.role = role || 'admin';
        user.updatedAt = new Date();
        await user.save();

        res.json({ message: 'Admin access granted', user: { userId: user._id, email: user.email, role: user.role } });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/admin/revoke-access', requireAdmin, async (req, res) => {
    try {
        const { userId } = req.body;

        if (!userId) {
            return res.status(400).json({ error: 'User ID is required' });
        }

        if (userId === req.user.userId) {
            return res.status(400).json({ error: 'Cannot revoke your own admin access' });
        }

        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        user.isAdmin = false;
        user.role = 'customer';
        user.updatedAt = new Date();
        await user.save();

        res.json({ message: 'Admin access revoked', user: { userId: user._id, email: user.email } });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
app.get('/api/admin/users', requireAdmin, async (req, res) => {
    try {
        const { page = 1, limit = 20, search } = req.query;
        const skip = (parseInt(page) - 1) * parseInt(limit);

        let query = {};
        if (search) {
            query = {
                $or: [
                    { name: { $regex: search, $options: 'i' } },
                    { email: { $regex: search, $options: 'i' } }
                ]
            };
        }

        const users = await User.find(query)
            .select('-password')
            .skip(skip)
            .limit(parseInt(limit))
            .sort({ createdAt: -1 });

        const total = await User.countDocuments(query);

        res.json({
            users: users.map(u => ({
                userId: u._id,
                name: u.name,
                email: u.email,
                phone: u.phone,
                role: u.role,
                isAdmin: u.isAdmin,
                emailVerified: u.emailVerified,
                createdAt: u.createdAt
            })),
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total,
                pages: Math.ceil(total / parseInt(limit))
            }
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/admin/reset-user-password', requireAdmin, async (req, res) => {
    try {
        const { userId, newPassword } = req.body;

        if (!userId || !newPassword) {
            return res.status(400).json({ error: 'User ID and new password are required' });
        }

        if (newPassword.length < 6) {
            return res.status(400).json({ error: 'Password must be at least 6 characters' });
        }

        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        user.password = await bcrypt.hash(newPassword, 10);
        user.updatedAt = new Date();
        await user.save();

        if (user.email) {
            await sendEmailNotification(user.email, 'Password Reset by Admin - The Quill',
                `<h2>Password Reset</h2><p>Your password has been reset by an administrator.</p><p>If you did not make this change, please contact support immediately.</p>`);
        }

        res.json({ message: 'Password reset successfully' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/wishlist', async (req, res) => {
    try {
        if (!req.user) {
            return res.status(401).json({ error: 'Not authenticated' });
        }

        if (!mongoConnected) {
            return res.json({ items: [] });
        }

        let wishlist = await Wishlist.findOne({ userId: req.user.userId });

        if (!wishlist) {
            wishlist = new Wishlist({
                _id: 'WISHLIST-' + req.user.userId,
                userId: req.user.userId,
                items: []
            });
            await wishlist.save();
        }

        res.json({ items: wishlist.items });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/wishlist', async (req, res) => {
    try {
        if (!req.user) {
            return res.status(401).json({ error: 'Not authenticated' });
        }

        const { menuItemId, name, price, image, category } = req.body;

        if (!menuItemId || !name) {
            return res.status(400).json({ error: 'Menu item ID and name are required' });
        }

        if (!mongoConnected) {
            return res.status(503).json({ error: 'Database temporarily unavailable' });
        }

        let wishlist = await Wishlist.findOne({ userId: req.user.userId });

        if (!wishlist) {
            wishlist = new Wishlist({
                _id: 'WISHLIST-' + req.user.userId,
                userId: req.user.userId,
                items: []
            });
        }

        const existingItem = wishlist.items.find(item => item.menuItemId === menuItemId);
        if (existingItem) {
            return res.json({ message: 'Item already in wishlist', items: wishlist.items });
        }

        wishlist.items.push({
            menuItemId,
            name,
            price: price || 0,
            image: image || '',
            category: category || '',
            addedAt: new Date()
        });

        wishlist.updatedAt = new Date();
        await wishlist.save();

        res.status(201).json({ message: 'Item added to wishlist', items: wishlist.items });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/wishlist/:itemId', async (req, res) => {
    try {
        if (!req.user) {
            return res.status(401).json({ error: 'Not authenticated' });
        }

        const { itemId } = req.params;

        if (!mongoConnected) {
            return res.status(503).json({ error: 'Database temporarily unavailable' });
        }

        const wishlist = await Wishlist.findOne({ userId: req.user.userId });

        if (!wishlist) {
            return res.json({ message: 'Wishlist is empty', items: [] });
        }

        wishlist.items = wishlist.items.filter(item => item.menuItemId !== itemId);
        wishlist.updatedAt = new Date();
        await wishlist.save();

        res.json({ message: 'Item removed from wishlist', items: wishlist.items });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/wishlist', async (req, res) => {
    try {
        if (!req.user) {
            return res.status(401).json({ error: 'Not authenticated' });
        }

        if (!mongoConnected) {
            return res.status(503).json({ error: 'Database temporarily unavailable' });
        }

        await Wishlist.findOneAndUpdate(
            { userId: req.user.userId },
            { items: [], updatedAt: new Date() }
        );

        res.json({ message: 'Wishlist cleared', items: [] });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
app.get('/api/menu', async (req, res) => {
    try {
        const { category, search, page = 1, limit = 50 } = req.query;
        let query = {};
        const pageNum = parseInt(page) || 1;
        const limitNum = parseInt(limit) || 50;

        if (category && category !== 'all') {
            query.category = category;
        }
        if (!mongoConnected) {
            let items = menuData;
            if (category && category !== 'all') {
                items = items.filter(i => i.category === category);
            }
            if (search) {
                const s = search.toLowerCase();
                items = items.filter(i => i.name.toLowerCase().includes(s) || i.description.toLowerCase().includes(s));
            }
            return res.json({
                data: items,
                pagination: {
                    total: items.length,
                    page: pageNum,
                    limit: limitNum,
                    totalPages: Math.ceil(items.length / limitNum)
                }
            });
        }

        let items = await MenuItem.find(query);

        if (search) {
            const s = search.toLowerCase();
            items = items.filter(i =>
                i.name.toLowerCase().includes(s) ||
                i.description.toLowerCase().includes(s)
            );
        }
        if (items.length === 0) {
            items = menuData;
            if (category && category !== 'all') {
                items = items.filter(i => i.category === category);
            }
            if (search) {
                const s = search.toLowerCase();
                items = items.filter(i => i.name.toLowerCase().includes(s) || i.description.toLowerCase().includes(s));
            }
        }

        res.json({
            data: items,
            pagination: {
                total: items.length,
                page: pageNum,
                limit: limitNum,
                totalPages: Math.ceil(items.length / limitNum)
            }
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
app.post('/api/menu', requireAdmin, async (req, res) => {
    try {
        const { name, description, price, category, image, imageUrl, popular, available, stockQuantity, lowStockThreshold, trackInventory, nutritionalInfo } = req.body;

        if (!name || !price || !category) {
            return res.status(400).json({ error: 'Name, price, and category are required' });
        }

        const menuItemId = 'M-' + uuidv4().substring(0, 8).toUpperCase();
        const menuItem = new MenuItem({
            _id: menuItemId,
            name,
            description: description || '',
            price,
            category,
            image: image || imageUrl || '',
            imageUrl: imageUrl || image || '',
            popular: popular || false,
            available: available !== false,
            stockQuantity: stockQuantity || 0,
            lowStockThreshold: lowStockThreshold || 5,
            trackInventory: trackInventory || false,
            nutritionalInfo: nutritionalInfo || {
                calories: 0, protein: 0, carbohydrates: 0, fat: 0, fiber: 0, sodium: 0, allergens: [], dietaryInfo: []
            }
        });

        await menuItem.save();
        res.status(201).json({ message: 'Menu item created', menuItem });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});
app.put('/api/menu/:id', requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { name, description, price, category, image, imageUrl, popular, available, stockQuantity, lowStockThreshold, trackInventory, nutritionalInfo } = req.body;

        const menuItem = await MenuItem.findByIdAndUpdate(
            id,
            {
                name,
                description,
                price,
                category,
                image: image || imageUrl || undefined,
                imageUrl: imageUrl || image || undefined,
                popular,
                available,
                stockQuantity,
                lowStockThreshold,
                trackInventory,
                nutritionalInfo,
                updatedAt: new Date()
            },
            { new: true }
        );

        if (!menuItem) {
            return res.status(404).json({ error: 'Menu item not found' });
        }

        res.json({ message: 'Menu item updated', menuItem });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

app.delete('/api/menu/:id', requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const menuItem = await MenuItem.findByIdAndDelete(id);

        if (!menuItem) {
            return res.status(404).json({ error: 'Menu item not found' });
        }

        res.json({ message: 'Menu item deleted' });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

app.post('/api/menu/bulk', requireAdmin, async (req, res) => {
    try {
        const { items } = req.body;

        if (!Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ error: 'Items array is required' });
        }

        const createdItems = [];
        for (const item of items) {
            if (!item.name || !item.price || !item.category) {
                continue;
            }

            const menuItemId = 'M-' + uuidv4().substring(0, 8).toUpperCase();
            const menuItem = new MenuItem({
                _id: menuItemId,
                name: item.name,
                description: item.description || '',
                price: item.price,
                category: item.category,
                image: item.image || item.imageUrl || '',
                imageUrl: item.imageUrl || item.image || '',
                popular: item.popular || false,
                available: item.available !== false,
                stockQuantity: item.stockQuantity || 0,
                lowStockThreshold: item.lowStockThreshold || 5,
                trackInventory: item.trackInventory || false,
                nutritionalInfo: item.nutritionalInfo || {
                    calories: 0, protein: 0, carbohydrates: 0, fat: 0, fiber: 0, sodium: 0, allergens: [], dietaryInfo: []
                }
            });

            await menuItem.save();
            createdItems.push(menuItem);
        }

        res.status(201).json({ message: `${createdItems.length} menu items created`, items: createdItems });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

app.put('/api/menu/bulk', requireAdmin, async (req, res) => {
    try {
        const { items } = req.body;

        if (!Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ error: 'Items array is required' });
        }

        const updatedItems = [];
        for (const item of items) {
            if (!item._id) {
                continue;
            }

            const updateData = {
                name: item.name,
                description: item.description,
                price: item.price,
                category: item.category,
                image: item.image || item.imageUrl || undefined,
                imageUrl: item.imageUrl || item.image || undefined,
                popular: item.popular,
                available: item.available,
                stockQuantity: item.stockQuantity,
                lowStockThreshold: item.lowStockThreshold,
                trackInventory: item.trackInventory,
                nutritionalInfo: item.nutritionalInfo,
                updatedAt: new Date()
            };
            Object.keys(updateData).forEach(key => {
                if (updateData[key] === undefined) delete updateData[key];
            });

            const updated = await MenuItem.findByIdAndUpdate(item._id, updateData, { new: true });
            if (updated) {
                updatedItems.push(updated);
            }
        }

        res.json({ message: `${updatedItems.length} menu items updated`, items: updatedItems });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});
app.delete('/api/menu/bulk', requireAdmin, async (req, res) => {
    try {
        const { ids } = req.body;

        if (!Array.isArray(ids) || ids.length === 0) {
            return res.status(400).json({ error: 'IDs array is required' });
        }

        const result = await MenuItem.deleteMany({ _id: { $in: ids } });

        res.json({ message: `${result.deletedCount} menu items deleted` });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});
app.put('/api/menu/:id/inventory', requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { stockQuantity, lowStockThreshold, trackInventory } = req.body;

        const updateData = { updatedAt: new Date() };
        if (stockQuantity !== undefined) updateData.stockQuantity = stockQuantity;
        if (lowStockThreshold !== undefined) updateData.lowStockThreshold = lowStockThreshold;
        if (trackInventory !== undefined) updateData.trackInventory = trackInventory;

        const menuItem = await MenuItem.findByIdAndUpdate(id, updateData, { new: true });

        if (!menuItem) {
            return res.status(404).json({ error: 'Menu item not found' });
        }

        if (menuItem.trackInventory && menuItem.stockQuantity <= menuItem.lowStockThreshold) {
            emitToRoom('admin', 'inventory:low', {
                menuItemId: id,
                name: menuItem.name,
                stockQuantity: menuItem.stockQuantity,
                threshold: menuItem.lowStockThreshold
            });
        }

        res.json({ message: 'Inventory updated', menuItem });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});
app.get('/api/menu/low-stock', requireAdmin, async (req, res) => {
    try {
        const menuItems = await MenuItem.find({
            trackInventory: true,
            $expr: { $lte: ['$stockQuantity', '$lowStockThreshold'] }
        });

        res.json(menuItems);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/payments/mpesa/initiate', strictPaymentLimiter, async (req, res) => {
    try {
        const { phoneNumber, amount, orderId, customerEmail, customerName } = req.body;

        if (!phoneNumber || !amount || !orderId) {
            return res.status(400).json({ error: 'Phone number, amount, and order ID are required' });
        }

        if (amount <= 0) {
            return res.status(400).json({ error: 'Invalid payment amount' });
        }
        const order = await Order.findById(orderId);
        if (!order) {
            return res.status(404).json({ error: 'Order not found' });
        }
        const formattedPhone = mpesa.formatPhoneNumber(phoneNumber);

        const result = await mpesa.initiateSTKPush(
            formattedPhone,
            amount,
            `ORDER - ${orderId} `,
            `The Quill Restaurant - Order #${orderId} `
        );

        if (result.success) {
            order.paymentMethod = 'mpesa';
            order.mpesaRequestId = result.CheckoutRequestID;
            order.mpesaTransactionId = '';
            order.paymentStatus = 'pending';
            order.updatedAt = new Date();
            await order.save();

            res.json({
                success: true,
                isDemo: result.isDemo || false,
                message: result.CustomerMessage || 'M-Pesa payment initiated',
                mpesaRequestId: result.CheckoutRequestID,
                merchantRequestId: result.MerchantRequestID,
                orderId,
                accountReference: `ORDER - ${orderId} `,
                businessShortCode: mpesa.config.shortcode,
                amount,
                phoneNumber: formattedPhone,
                instruction: 'Complete M-Pesa payment on your phone to confirm order',
                timeout: 180,
                redirectTo: '/orders/' + orderId
            });
        } else {
            res.status(400).json({ success: false, error: result.error || 'Failed to initiate payment' });
        }
    } catch (err) {
        console.error('M-Pesa initiate error:', err.message);
        res.status(400).json({ success: false, error: err.message });
    }
});

app.get('/api/payments/mpesa/status/:checkoutRequestId', async (req, res) => {
    try {
        const { checkoutRequestId } = req.params;

        if (!checkoutRequestId) {
            return res.status(400).json({ error: 'Checkout request ID is required' });
        }
        const order = await Order.findOne({ mpesaRequestId: checkoutRequestId });
        if (!order) {
            return res.json({
                checkoutRequestId,
                paymentStatus: 'pending',
                message: 'Order not found - payment may still be processing'
            });
        }
        if (order.paymentStatus === 'completed') {
            return res.json({
                checkoutRequestId,
                orderId: order._id,
                paymentStatus: 'completed',
                mpesaTransactionId: order.mpesaTransactionId,
                amount: order.total,
                timestamp: order.updatedAt
            });
        }

        const result = await mpesa.querySTKStatus(checkoutRequestId);
        if (result.ResultCode === '0' && result.TransactionId) {
            order.paymentStatus = 'completed';
            order.mpesaTransactionId = result.TransactionId;
            order.status = 'confirmed';
            order.updatedAt = new Date();
            await order.save();

            await sendOrderNotifications(order);
            console.log(`M - Pesa payment confirmed for order ${order._id}`);
        }

        res.json({
            checkoutRequestId,
            orderId: order._id,
            paymentStatus: order.paymentStatus,
            mpesaTransactionId: order.mpesaTransactionId || result.TransactionId || null,
            amount: order.total,
            resultCode: result.ResultCode,
            resultDesc: result.ResultDesc,
            isDemo: result.isDemo || false,
            timestamp: order.updatedAt
        });
    } catch (err) {
        console.error('M-Pesa status check error:', err.message);
        res.status(400).json({ error: err.message });
    }
});

app.post('/api/payments/mpesa/callback', async (req, res) => {
    try {
        const body = req.body.Body || req.body;
        const stkCallback = body.stkCallback || body;
        const { ResultCode, CheckoutRequestID, CallbackMetadata } = stkCallback;

        console.log('[M-Pesa] Callback received:', { ResultCode, CheckoutRequestID });

        res.json({ ResultCode: 0, ResponseCode: '0' });

        if (ResultCode === 0 && CallbackMetadata) {
            const metadata = CallbackMetadata.Item || [];
            let mpesaData = {
                amount: 0,
                transactionId: '',
                phoneNumber: '',
                transactionDate: new Date()
            };
            metadata.forEach(item => {
                if (item.Name === 'Amount') mpesaData.amount = item.Value;
                if (item.Name === 'MpesaReceiptNumber') mpesaData.transactionId = item.Value;
                if (item.Name === 'PhoneNumber') mpesaData.phoneNumber = item.Value;
            });

            console.log('[M-Pesa] Payment successful:', mpesaData);

            const order = await Order.findOne({ mpesaRequestId: CheckoutRequestID });

            let orderFound = order;
            if (!orderFound) {
                const accountRef = metadata.find(item => item.Name === 'AccountReference')?.Value;
                if (accountRef) {
                    const orderId = accountRef.replace('ORDER-', '');
                    orderFound = await Order.findById(orderId);
                }
            }

            if (orderFound) {
                orderFound.paymentStatus = 'completed';
                orderFound.mpesaTransactionId = mpesaData.transactionId;
                orderFound.status = 'confirmed';
                orderFound.updatedAt = new Date();
                const statusHistory = orderFound.statusHistory || [];
                statusHistory.push({
                    status: 'confirmed',
                    timestamp: new Date(),
                    note: `Payment confirmed via M-Pesa. Transaction ID: ${mpesaData.transactionId}`
                });
                orderFound.statusHistory = statusHistory;

                await orderFound.save();
                await sendOrderNotifications(orderFound);
                emitToRoom('orders', 'order:paymentUpdated', {
                    orderId: orderFound._id,
                    paymentStatus: 'completed',
                    mpesaTransactionId: mpesaData.transactionId
                });
                emitToRoom('admin', 'order:paymentUpdated', {
                    orderId: orderFound._id,
                    paymentStatus: 'completed',
                    mpesaTransactionId: mpesaData.transactionId
                });

                console.log(`[M-Pesa] Payment confirmed for order ${orderFound._id}`);
            } else {
                console.log('[M-Pesa] Order not found for checkout request:', CheckoutRequestID);
            }
        } else {
            console.log(`[M-Pesa] Payment failed. ResultCode: ${ResultCode}`);

            if (CheckoutRequestID) {
                const order = await Order.findOne({ mpesaRequestId: CheckoutRequestID });
                if (order) {
                    order.paymentStatus = 'failed';
                    order.updatedAt = new Date();

                    const statusHistory = order.statusHistory || [];
                    statusHistory.push({
                        status: 'payment_failed',
                        timestamp: new Date(),
                        note: `Payment failed. ResultCode: ${ResultCode}`
                    });
                    order.statusHistory = statusHistory;

                    await order.save();

                    emitToRoom('orders', 'order:paymentUpdated', {
                        orderId: order._id,
                        paymentStatus: 'failed'
                    });
                    emitToRoom('admin', 'order:paymentUpdated', {
                        orderId: order._id,
                        paymentStatus: 'failed'
                    });
                }
            }
        }
    } catch (err) {
        console.error('M-Pesa callback error:', err.message);
        res.json({ ResultCode: 1, ResponseCode: '1' });
    }
});

app.get('/api/payments/methods', (req, res) => {
    res.json({
        methods: [
            {
                id: 'mpesa',
                name: 'M-Pesa STK Push',
                description: 'Pay instantly via M-Pesa',
                icon: 'phone',
                enabled: true
            },
            {
                id: 'cash',
                name: 'Pay on Delivery/Pickup',
                description: 'Pay with cash when you receive your order',
                icon: 'cash',
                enabled: true
            }
        ]
    });
});

app.post('/api/orders', async (req, res) => {
    try {
        if (!mongoConnected) {
            return res.status(503).json({
                error: 'Database temporarily unavailable. Please try again in a moment.',
                orderId: 'ORD-' + uuidv4().substring(0, 8).toUpperCase(),
                status: 'pending'
            });
        }

        const orderId = 'ORD-' + uuidv4().substring(0, 8).toUpperCase();
        const order = new Order({ _id: orderId, ...req.body });
        await order.save();
        await sendOrderNotifications(order);
        emitToRoom('admin', 'order:new', {
            orderId,
            customerName: order.customerName,
            total: order.total,
            status: order.status,
            createdAt: order.createdAt
        });

        emitToRoom('orders', 'order:created', {
            orderId,
            status: order.status
        });

        res.status(201).json({ message: 'Order placed', orderId });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

app.get('/api/orders', async (req, res) => {
    try {
        if (!mongoConnected) {
            return res.json([]);
        }

        let query = {};

        const { status, startDate, endDate, paymentStatus, search } = req.query;

        if (req.user) {
            const user = await User.findById(req.user.userId);
            if (user && user.email) {
                if (search) {
                    query.$or = [
                        { email: user.email },
                        { _id: new RegExp(search, 'i') }
                    ];
                } else {
                    query.email = user.email;
                }
            }
        } else {
            return res.json([]);
        }
        if (status && status !== 'all') {
            query.status = status;
        }
        if (paymentStatus && paymentStatus !== 'all') {
            query.paymentStatus = paymentStatus;
        }
        if (startDate || endDate) {
            query.createdAt = {};
            if (startDate) query.createdAt.$gte = new Date(startDate);
            if (endDate) {
                const end = new Date(endDate);
                end.setHours(23, 59, 59, 999);
                query.createdAt.$lte = end;
            }
        }

        const orders = await Order.find(query).sort({ createdAt: -1 });
        res.json(orders);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
app.get('/api/orders/:id/track', async (req, res) => {
    try {
        if (!mongoConnected) {
            return res.status(503).json({ error: 'Database unavailable' });
        }

        const { id } = req.params;
        const order = await Order.findById(id);

        if (!order) {
            return res.status(404).json({ error: 'Order not found' });
        }
        if (req.user) {
            const user = await User.findById(req.user.userId);
            const isAdmin = user && ADMIN_EMAILS.includes(user.email);
            const isOwner = user && order.email === user.email;

            if (!isOwner && !isAdmin) {
                return res.status(403).json({ error: 'Access denied' });
            }
        } else {
            return res.status(401).json({ error: 'Authentication required' });
        }
        const tracking = {
            orderId: order._id,
            status: order.status,
            paymentStatus: order.paymentStatus,
            createdAt: order.createdAt,
            estimatedDeliveryTime: order.estimatedDeliveryTime,
            deliveryStartedAt: order.deliveryStartedAt,
            deliveryCompletedAt: order.deliveryCompletedAt,
            deliveryPerson: order.deliveryPerson,
            deliveryAddress: order.deliveryAddress,
            statusHistory: order.statusHistory || [
                { status: 'pending', timestamp: order.createdAt, note: 'Order placed' },
                { status: order.status, timestamp: order.updatedAt, note: `Order ${order.status}` }
            ],
            items: order.items,
            total: order.total
        };

        res.json(tracking);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
app.post('/api/orders/:id/cancel', async (req, res) => {
    try {
        if (!req.user) {
            return res.status(401).json({ error: 'Authentication required' });
        }

        const { id } = req.params;
        const { reason } = req.body;

        const order = await Order.findById(id);
        if (!order) {
            return res.status(404).json({ error: 'Order not found' });
        }
        const user = await User.findById(req.user.userId);
        if (order.email !== user.email) {
            return res.status(403).json({ error: 'Access denied' });
        }
        if (!['pending', 'confirmed'].includes(order.status)) {
            return res.status(400).json({ error: `Cannot cancel order with status: ${order.status}` });
        }
        const statusHistory = order.statusHistory || [];
        statusHistory.push({
            status: 'cancelled',
            timestamp: new Date(),
            note: reason || 'Cancelled by customer'
        });

        order.status = 'cancelled';
        order.statusHistory = statusHistory;
        order.updatedAt = new Date();
        if (order.paymentStatus === 'completed') {
            order.paymentStatus = 'refunded';
            order.refundAmount = order.total;
            order.refundedAt = new Date();
            order.refundReason = reason || 'Customer cancellation';
        }

        await order.save();

        emitToRoom('admin', 'order:updated', { orderId: id, status: 'cancelled' });

        res.json({ message: 'Order cancelled successfully', order });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
app.put('/api/orders/:id/modify', async (req, res) => {
    try {
        if (!req.user) {
            return res.status(401).json({ error: 'Authentication required' });
        }

        const { id } = req.params;
        const { items, deliveryAddress, specialInstructions } = req.body;

        const order = await Order.findById(id);
        if (!order) {
            return res.status(404).json({ error: 'Order not found' });
        }
        const user = await User.findById(req.user.userId);
        if (order.email !== user.email) {
            return res.status(403).json({ error: 'Access denied' });
        }
        if (order.status !== 'pending') {
            return res.status(400).json({ error: 'Can only modify pending orders' });
        }

        if (items && Array.isArray(items)) {
            const subtotal = items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
            const tax = subtotal * 0.16;
            const deliveryFee = order.deliveryFee || 0;

            order.items = items;
            order.subtotal = subtotal;
            order.tax = tax;
            order.total = subtotal + tax + deliveryFee;
        }
        if (deliveryAddress) {
            order.deliveryAddress = deliveryAddress;
        }

        if (specialInstructions !== undefined) {
            order.notes = specialInstructions;
        }

        order.updatedAt = new Date();
        await order.save();

        res.json({ message: 'Order modified successfully', order });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
app.post('/api/orders/:id/reorder', async (req, res) => {
    try {
        if (!req.user) {
            return res.status(401).json({ error: 'Authentication required' });
        }

        const { id } = req.params;

        const originalOrder = await Order.findById(id);
        if (!originalOrder) {
            return res.status(404).json({ error: 'Order not found' });
        }
        const user = await User.findById(req.user.userId);
        if (originalOrder.email !== user.email) {
            return res.status(403).json({ error: 'Access denied' });
        }
        const newOrderId = 'ORD-' + uuidv4().substring(0, 8).toUpperCase();
        const subtotal = originalOrder.items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
        const tax = subtotal * 0.16;

        const newOrder = new Order({
            _id: newOrderId,
            userId: user._id,
            customerName: user.name || originalOrder.customerName,
            email: user.email,
            phone: user.phone || originalOrder.phone,
            items: originalOrder.items,
            subtotal,
            tax,
            deliveryFee: originalOrder.deliveryFee || 0,
            total: subtotal + tax + (originalOrder.deliveryFee || 0),
            paymentMethod: 'cash',
            paymentStatus: 'pending',
            status: 'pending',
            deliveryType: originalOrder.deliveryType,
            deliveryAddress: originalOrder.deliveryAddress,
            notes: `Reorder of #${id}`
        });

        await newOrder.save();

        res.status(201).json({
            message: 'Reorder placed successfully',
            orderId: newOrderId,
            items: newOrder.items,
            total: newOrder.total
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/orders/:id', async (req, res) => {
    try {
        if (!mongoConnected) {
            return res.status(503).json({ error: 'Database temporarily unavailable' });
        }

        const { id } = req.params;
        const order = await Order.findById(id);

        if (!order) {
            return res.status(404).json({ error: 'Order not found' });
        }

        if (req.user) {
            const user = await User.findById(req.user.userId);
            if (user && user.email !== order.email) {
                if (!ADMIN_EMAILS.includes(user.email)) {
                    return res.status(403).json({ error: 'Access denied' });
                }
            }
        }

        res.json(order);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/orders/:id/status', requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;

        if (!status) {
            return res.status(400).json({ error: 'Status is required' });
        }

        const validStatuses = ['pending', 'confirmed', 'preparing', 'ready', 'completed', 'cancelled'];
        if (!validStatuses.includes(status)) {
            return res.status(400).json({ error: `Invalid status.Must be one of: ${validStatuses.join(', ')} ` });
        }

        const order = await Order.findByIdAndUpdate(id, { status }, { new: true });

        if (!order) {
            return res.status(404).json({ error: 'Order not found' });
        }

        emitToRoom('orders', 'order:statusChanged', {
            orderId: id,
            status,
            updatedAt: order.updatedAt
        });
        emitToRoom('admin', 'order:updated', {
            orderId: id,
            status,
            updatedAt: order.updatedAt
        });

        res.json({ message: 'Order status updated', order });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});
app.post('/api/orders/:id/estimate-delivery', async (req, res) => {
    try {
        const { id } = req.params;
        const { customerLatitude, customerLongitude } = req.body;

        const order = await Order.findById(id);
        if (!order) {
            return res.status(404).json({ error: 'Order not found' });
        }
        const restaurantLat = parseFloat(process.env.RESTAURANT_LAT);
        const restaurantLng = parseFloat(process.env.RESTAURANT_LNG);

        const haversine = (lat1, lon1, lat2, lon2) => {
            const R = 6371;
            const dLat = (lat2 - lat1) * Math.PI / 180;
            const dLng = (lon2 - lon1) * Math.PI / 180;
            const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
                Math.sin(dLng / 2) * Math.sin(dLng / 2);
            const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
            return R * c;
        };

        const distance = haversine(restaurantLat, restaurantLng, customerLatitude, customerLongitude);

        const estimatedDeliveryTime = 5 + Math.ceil(distance * 2);

        const deliveryFee = 100 + Math.round(distance * 30);

        let preparationTime = 15;
        if (order.items.length > 5) preparationTime = 20;
        if (order.items.some(item => item.name && item.name.toLowerCase().includes('grill'))) preparationTime = 25;

        res.json({
            distance: Math.round(distance * 100) / 100,
            estimatedDeliveryTime,
            estimatedDeliveryFee: deliveryFee,
            estimatedPreparationTime: preparationTime,
            estimatedTotalTime: preparationTime + estimatedDeliveryTime,
            eta: new Date(Date.now() + (preparationTime + estimatedDeliveryTime) * 60000)
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
app.post('/api/orders/:id/assign-delivery', requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { partnerId } = req.body;

        if (!partnerId) {
            return res.status(400).json({ error: 'Partner ID is required' });
        }

        const order = await Order.findById(id);
        if (!order) {
            return res.status(404).json({ error: 'Order not found' });
        }

        if (order.orderType !== 'delivery') {
            return res.status(400).json({ error: 'Only delivery orders can have partners assigned' });
        }

        const partner = await DeliveryPartner.findById(partnerId);
        if (!partner) {
            return res.status(404).json({ error: 'Delivery partner not found' });
        }

        if (partner.status === 'unavailable' || partner.status === 'offline') {
            return res.status(400).json({ error: 'Delivery partner is not available' });
        }
        order.deliveryPartner = {
            name: partner.name,
            phone: partner.phone,
            vehicle: partner.vehicleType,
            partnerId: partnerId,
            assignedAt: new Date()
        };

        order.status = 'ready';
        await order.save();
        partner.assignedOrders.push(id);
        partner.status = 'busy';
        await partner.save();

        emitToRoom('orders', 'order:deliveryAssigned', {
            orderId: id,
            deliveryPartner: {
                name: partner.name,
                phone: partner.phone,
                vehicle: partner.vehicleType
            }
        });

        res.json({
            message: 'Delivery partner assigned',
            order,
            partner: { name: partner.name, phone: partner.phone, vehicleType: partner.vehicleType }
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
app.get('/api/delivery-partners/available', requireAdmin, async (req, res) => {
    try {
        const partners = await DeliveryPartner.find({
            status: { $in: ['active', 'available'] }
        }).select('_id name phone vehicleType status assignedOrders currentLocation');

        const available = partners.map(p => ({
            id: p._id,
            name: p.name,
            phone: p.phone,
            vehicle: p.vehicleType,
            activeOrders: p.assignedOrders.length,
            location: p.currentLocation,
            rating: p.rating
        }));

        res.json({ partners: available });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/delivery-partners/:id/location', async (req, res) => {
    try {
        const { id } = req.params;
        const { latitude, longitude } = req.body;

        if (latitude === undefined || longitude === undefined) {
            return res.status(400).json({ error: 'Latitude and longitude are required' });
        }

        const partner = await DeliveryPartner.findByIdAndUpdate(
            id,
            {
                'currentLocation.latitude': latitude,
                'currentLocation.longitude': longitude,
                'currentLocation.updatedAt': new Date()
            },
            { new: true }
        );

        if (!partner) {
            return res.status(404).json({ error: 'Partner not found' });
        }
        emitToRoom('admin', 'delivery:locationUpdated', {
            partnerId: id,
            location: { latitude, longitude },
            timestamp: new Date()
        });

        res.json({ message: 'Location updated', location: partner.currentLocation });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
app.post('/api/orders/:id/delivery-complete', async (req, res) => {
    try {
        const { id } = req.params;

        const order = await Order.findById(id);
        if (!order) {
            return res.status(404).json({ error: 'Order not found' });
        }

        order.status = 'delivered';
        const deliveryTime = Math.round((Date.now() - order.createdAt.getTime()) / 60000);

        if (order.deliveryPartner && order.deliveryPartner.partnerId) {
            const partner = await DeliveryPartner.findById(order.deliveryPartner.partnerId);
            if (partner) {
                partner.completedOrders += 1;
                partner.assignedOrders = partner.assignedOrders.filter(oid => oid !== id);
                partner.totalDistance += parseFloat(order.deliveryDistance || 0);

                const totalDays = Math.max(1, Math.floor((Date.now() - partner.joinedAt.getTime()) / (24 * 60 * 60 * 1000)));
                partner.averageDeliveryTime = Math.round((partner.completedOrders * partner.averageDeliveryTime + deliveryTime) / (partner.completedOrders));

                if (partner.assignedOrders.length === 0) {
                    partner.status = 'available';
                }
                await partner.save();
            }
        }

        await order.save();

        emitToRoom('orders', 'order:delivered', {
            orderId: id,
            status: 'delivered',
            deliveryTime
        });

        res.json({ message: 'Delivery completed', order });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/delivery-partners/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const partner = await DeliveryPartner.findById(id);

        if (!partner) {
            return res.status(404).json({ error: 'Delivery partner not found' });
        }

        res.json({
            id: partner._id,
            name: partner.name,
            phone: partner.phone,
            vehicleType: partner.vehicleType,
            vehiclePlate: partner.vehiclePlate,
            status: partner.status,
            rating: partner.rating,
            completedOrders: partner.completedOrders,
            averageDeliveryTime: partner.averageDeliveryTime,
            joinedAt: partner.joinedAt
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
app.post('/api/delivery-partners', async (req, res) => {
    try {
        const { name, phone, email, vehicleType, vehiclePlate, bankDetails, documents } = req.body;

        if (!name || !phone || !vehicleType || !vehiclePlate) {
            return res.status(400).json({ error: 'Name, phone, vehicle type, and plate are required' });
        }

        const existingPartner = await DeliveryPartner.findOne({ phone });
        if (existingPartner) {
            return res.status(400).json({ error: 'Partner with this phone already exists' });
        }

        const partner = new DeliveryPartner({
            _id: uuidv4(),
            name,
            phone,
            email,
            vehicleType,
            vehiclePlate,
            status: 'offline',
            bankDetails,
            documents,
            joinedAt: new Date()
        });

        await partner.save();

        res.status(201).json({
            message: 'Delivery partner registered successfully',
            partnerId: partner._id,
            email: 'Partner registration details sent to admin'
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
app.put('/api/delivery-partners/:id', requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { status, bankDetails, documents } = req.body;

        const partner = await DeliveryPartner.findByIdAndUpdate(
            id,
            { status, bankDetails, documents, updatedAt: new Date() },
            { new: true }
        );

        if (!partner) {
            return res.status(404).json({ error: 'Partner not found' });
        }

        res.json({ message: 'Partner details updated', partner });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/orders/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const updateData = { ...req.body };

        delete updateData.paymentStatus;
        delete updateData.status;
        delete updateData.mpesaTransactionId;

        const order = await Order.findByIdAndUpdate(id, updateData, { new: true });

        if (!order) {
            return res.status(404).json({ error: 'Order not found' });
        }

        res.json({ message: 'Order updated', order });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});
app.put('/api/orders/:id/admin', requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const updateData = { ...req.body };

        const order = await Order.findByIdAndUpdate(id, updateData, { new: true });

        if (!order) {
            return res.status(404).json({ error: 'Order not found' });
        }

        res.json({ message: 'Order updated', order });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});
app.post('/api/orders/:id/cancel', requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { reason } = req.body;

        const order = await Order.findById(id);
        if (!order) {
            return res.status(404).json({ error: 'Order not found' });
        }

        if (['delivered', 'refunded', 'cancelled'].includes(order.status)) {
            return res.status(400).json({ error: `Cannot cancel order with status: ${order.status}` });
        }
        const statusHistory = order.statusHistory || [];
        statusHistory.push({
            status: 'cancelled',
            timestamp: new Date(),
            note: reason || 'Order cancelled by admin'
        });

        order.status = 'cancelled';
        order.statusHistory = statusHistory;
        order.updatedAt = new Date();
        if (order.paymentStatus === 'completed') {
            order.paymentStatus = 'refunded';
            order.refundAmount = order.total;
            order.refundedAt = new Date();
        }

        await order.save();
        if (order.email) {
            await sendEmailNotification(order.email, `Order Cancelled - #${id}`,
                `<h2>Your order #${id} has been cancelled.</h2><p>Reason: ${reason || 'No reason provided'}</p>`);
        }

        emitToRoom('orders', 'order:statusChanged', { orderId: id, status: 'cancelled' });
        emitToRoom('admin', 'order:updated', { orderId: id, status: 'cancelled' });

        res.json({ message: 'Order cancelled', order });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

app.post('/api/orders/:id/refund', requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { amount, reason } = req.body;

        const order = await Order.findById(id);
        if (!order) {
            return res.status(404).json({ error: 'Order not found' });
        }

        if (order.paymentStatus !== 'completed') {
            return res.status(400).json({ error: 'Order is not paid, cannot process refund' });
        }

        const refundAmount = amount || order.total;
        if (refundAmount > order.total) {
            return res.status(400).json({ error: 'Refund amount cannot exceed order total' });
        }
        const statusHistory = order.statusHistory || [];
        statusHistory.push({
            status: 'refunded',
            timestamp: new Date(),
            note: reason || `Refund of KES ${refundAmount} processed`
        });

        order.refundAmount = refundAmount;
        order.refundReason = reason;
        order.refundedAt = new Date();
        order.refundProcessedBy = req.user?.email || 'admin';
        order.statusHistory = statusHistory;
        order.updatedAt = new Date();

        if (refundAmount === order.total) {
            order.paymentStatus = 'refunded';
            order.status = 'refunded';
        } else {
            order.paymentStatus = 'partially_refunded';
        }

        await order.save();
        if (order.email) {
            await sendEmailNotification(order.email, `Refund Processed - #${id}`,
                `<!DOCTYPE html>
                <html>
                <head><meta charset="utf-8"></head>
                <body style="font-family: Arial, sans-serif; padding: 20px;">
                    <h2>Refund Processed Successfully!</h2>
                    <p>Order #${id}</p>
                    <p><strong>Refund Amount:</strong> KES ${refundAmount.toLocaleString()}</p>
                    <p><strong>Reason:</strong> ${reason || 'Not specified'}</p>
                    <p>The refund will be processed to your original payment method within 1-5 business days.</p>
                    <p>If you have any questions, please contact us.</p>
                </body>
                </html>`);
        }
        emitToRoom('orders', 'order:refundProcessed', {
            orderId: id,
            refundAmount,
            paymentStatus: order.paymentStatus
        });
        emitToRoom('admin', 'order:refundProcessed', {
            orderId: id,
            refundAmount,
            paymentStatus: order.paymentStatus
        });

        res.json({ message: 'Refund processed successfully', order });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

app.post('/api/payments/refund/mpesa', requireAdmin, async (req, res) => {
    try {
        const { phoneNumber, amount, orderId, reason } = req.body;

        if (!phoneNumber || !amount || !orderId) {
            return res.status(400).json({ error: 'Phone number, amount, and order ID are required' });
        }

        const order = await Order.findById(orderId);
        if (!order) {
            return res.status(404).json({ error: 'Order not found' });
        }
        const formattedPhone = mpesa.formatPhoneNumber(phoneNumber);
        const isDemo = !process.env.MPESA_CONSUMER_KEY || !process.env.MPESA_CONSUMER_SECRET;

        if (isDemo) {
            console.log(`[DEMO] M-Pesa B2C Refund: KES ${amount} to ${formattedPhone}`);


            order.paymentStatus = 'refunded';
            order.refundAmount = amount;
            order.refundReason = reason || 'Refund processed via M-Pesa B2C';
            order.refundedAt = new Date();
            order.refundProcessedBy = req.user?.email || 'admin';
            order.updatedAt = new Date();
            await order.save();
            if (order.email) {
                await sendEmailNotification(order.email, `Refund Processed - Order #${orderId}`,
                    `<!DOCTYPE html>
                    <html>
                    <head><meta charset="utf-8"></head>
                    <body style="font-family: Arial, sans-serif; padding: 20px;">
                        <h2>Refund Processed Successfully!</h2>
                        <p>Order #${orderId}</p>
                        <p><strong>Refund Amount:</strong> KES ${parseInt(amount).toLocaleString()}</p>
                        <p><strong>Method:</strong> M-Pesa</p>
                        <p>The refund has been sent to your M-Pesa account.</p>
                    </body>
                    </html>`);
            }

            return res.json({
                success: true,
                isDemo: true,
                message: 'Refund processed successfully (demo mode)',
                orderId: order._id,
                refundAmount: amount
            });
        }

        res.status(501).json({ error: 'M-Pesa B2C not configured. Please use manual refund.' });
    } catch (err) {
        console.error('M-Pesa B2C refund error:', err.message);
        res.status(400).json({ error: err.message });
    }
});
app.post('/api/orders/:id/request-refund', async (req, res) => {
    try {
        const { id } = req.params;
        const { reason } = req.body;

        if (!req.user) {
            return res.status(401).json({ error: 'Authentication required' });
        }

        const order = await Order.findById(id);
        if (!order) {
            return res.status(404).json({ error: 'Order not found' });
        }

        if (order.userId !== req.user.userId) {
            return res.status(403).json({ error: 'Not authorized to request refund for this order' });
        }

        if (order.paymentStatus !== 'completed') {
            return res.status(400).json({ error: 'Order is not eligible for refund' });
        }

        if (order.status === 'delivered') {
            const deliveredAt = order.deliveryCompletedAt || order.updatedAt;
            const daysSinceDelivery = Math.floor((Date.now() - new Date(deliveredAt).getTime()) / (1000 * 60 * 60 * 24));
            if (daysSinceDelivery > 7) {
                return res.status(400).json({ error: 'Refund window has expired (7 days from delivery)' });
            }
        }

        const statusHistory = order.statusHistory || [];
        statusHistory.push({
            status: 'refund_requested',
            timestamp: new Date(),
            note: `Customer requested refund. Reason: ${reason || 'Not specified'}`
        });
        order.statusHistory = statusHistory;
        order.refundReason = reason;
        order.updatedAt = new Date();
        await order.save();
        const adminEmail = process.env.ADMIN_EMAIL;
        if (adminEmail) {
            await sendEmailNotification(adminEmail, `Refund Requested - Order #${id}`,
                `<!DOCTYPE html>
                <html>
                <head><meta charset="utf-8"></head>
                <body style="font-family: Arial, sans-serif; padding: 20px;">
                    <h2>Customer Requested Refund</h2>
                    <p><strong>Order ID:</strong> ${id}</p>
                    <p><strong>Customer:</strong> ${order.customerName}</p>
                    <p><strong>Email:</strong> ${order.email}</p>
                    <p><strong>Phone:</strong> ${order.phone}</p>
                    <p><strong>Order Total:</strong> KES ${order.total.toLocaleString()}</p>
                    <p><strong>Reason:</strong> ${reason || 'Not specified'}</p>
                    <p>Please review and process the refund from the admin dashboard.</p>
                </body>
                </html>`);
        }

        emitToRoom('admin', 'order:refundRequested', {
            orderId: id,
            customerName: order.customerName
        });

        res.json({
            message: 'Refund request submitted successfully. We will review and process it within 3-5 business days.',
            orderId: id
        });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

app.put('/api/orders/:id/delivery/assign', requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { name, phone, vehicle } = req.body;

        const order = await Order.findById(id);
        if (!order) {
            return res.status(404).json({ error: 'Order not found' });
        }

        if (order.deliveryType !== 'delivery') {
            return res.status(400).json({ error: 'This is not a delivery order' });
        }

        order.deliveryPerson = { name, phone, vehicle };
        order.deliveryAssignedAt = new Date();
        order.updatedAt = new Date();

        const statusHistory = order.statusHistory || [];
        statusHistory.push({
            status: 'out_for_delivery',
            timestamp: new Date(),
            note: `Delivery assigned to ${name}`
        });
        order.statusHistory = statusHistory;

        if (order.status === 'ready') {
            order.status = 'out_for_delivery';
        }

        await order.save();

        if (order.phone) {
            await sendSMSNotification(order.phone, `Your order #${id} is out for delivery! Driver: ${name}, Phone: ${phone}`);
        }

        emitToRoom('orders', 'order:deliveryAssigned', { orderId: id, deliveryPerson: order.deliveryPerson });

        res.json({ message: 'Delivery person assigned', order });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

app.put('/api/orders/:id/delivery/status', requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;

        const order = await Order.findById(id);
        if (!order) {
            return res.status(404).json({ error: 'Order not found' });
        }

        if (status === 'started') {
            order.deliveryStartedAt = new Date();
        } else if (status === 'completed') {
            order.deliveryCompletedAt = new Date();
            order.status = 'delivered';
            order.actualDeliveryTime = new Date();
        }

        order.updatedAt = new Date();
        await order.save();

        if (status === 'completed' && order.email) {
            await sendEmailNotification(order.email, `Order Delivered - #${id}`,
                `<h2>Your order #${id} has been delivered!</h2><p>Thank you for ordering from The Quill.</p>`);
        }

        emitToRoom('orders', 'order:deliveryUpdated', { orderId: id, deliveryStatus: status });

        res.json({ message: 'Delivery status updated', order });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

app.get('/api/orders/:id/invoice', async (req, res) => {
    try {
        const { id } = req.params;
        const order = await Order.findById(id);

        if (!order) {
            return res.status(404).json({ error: 'Order not found' });
        }

        if (!order.invoiceNumber) {
            order.invoiceNumber = 'INV-' + Date.now().toString(36).toUpperCase();
            await order.save();
        }

        const itemsHtml = order.items.map(item => `
            <tr>
                <td style="padding: 10px; border-bottom: 1px solid #eee;">${item.name || 'Item'}</td>
                <td style="padding: 10px; border-bottom: 1px solid #eee; text-align: center;">${item.quantity || 1}</td>
                <td style="padding: 10px; border-bottom: 1px solid #eee; text-align: right;">KES ${(item.price || 0).toLocaleString()}</td>
                <td style="padding: 10px; border-bottom: 1px solid #eee; text-align: right;">KES ${((item.price || 0) * (item.quantity || 1)).toLocaleString()}</td>
            </tr>
        `).join('');

        const invoiceHtml = `
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="utf-8">
                <title>Invoice - ${order.invoiceNumber}</title>
                <style>
                    body { font-family: Arial, sans-serif; margin: 40px; color: #333; }
                    .invoice-header { text-align: center; margin-bottom: 30px; }
                    .invoice-header h1 { color: #1a1a2e; margin: 0; }
                    .invoice-details { display: flex; justify-content: space-between; margin-bottom: 30px; }
                    .invoice-details table { width: 45%; }
                    .invoice-details td { padding: 5px; }
                    table.items { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
                    table.items th { background: #1a1a2e; color: white; padding: 10px; text-align: left; }
                    .totals { text-align: right; margin-top: 20px; }
                    .totals p { margin: 5px 0; }
                    .total { font-size: 18px; font-weight: bold; color: #1a1a2e; }
                    .status { display: inline-block; padding: 5px 15px; border-radius: 5px; background: #27ae60; color: white; }
                    @media print { body { margin: 0; } }
                </style>
            </head>
            <body>
                <div class="invoice-header">
                    <h1>🍽️ The Quill Restaurant</h1>
                    <p>Fine Dining Experience - Busia, Kenya</p>
                    <h2>INVOICE</h2>
                </div>
                
                <div class="invoice-details">
                    <table>
                        <tr><td><strong>Invoice #:</strong></td><td>${order.invoiceNumber}</td></tr>
                        <tr><td><strong>Date:</strong></td><td>${new Date(order.createdAt).toLocaleDateString()}</td></tr>
                        <tr><td><strong>Status:</strong></td><td><span class="status">${order.paymentStatus}</span></td></tr>
                    </table>
                    <table>
                        <tr><td><strong>Customer:</strong></td><td>${order.customerName}</td></tr>
                        <tr><td><strong>Email:</strong></td><td>${order.email}</td></tr>
                        <tr><td><strong>Phone:</strong></td><td>${order.phone}</td></tr>
                        <tr><td><strong>Order ID:</strong></td><td>${order._id}</td></tr>
                    </table>
                </div>

                <table class="items">
                    <thead>
                        <tr>
                            <th>Item</th>
                            <th style="text-align: center;">Qty</th>
                            <th style="text-align: right;">Price</th>
                            <th style="text-align: right;">Total</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${itemsHtml}
                    </tbody>
                </table>

                <div class="totals">
                    <p>Subtotal: KES ${(order.subtotal || order.total).toLocaleString()}</p>
                    <p>Tax: KES ${(order.tax || 0).toLocaleString()}</p>
                    <p>Delivery: KES ${(order.deliveryFee || 0).toLocaleString()}</p>
                    <p class="total">Total: KES ${order.total.toLocaleString()}</p>
                </div>

                <div style="margin-top: 40px; text-align: center; font-size: 12px; color: #666;">
                    <p>Thank you for your business!</p>
                    <p>© 2026 The Quill Restaurant. All rights reserved.</p>
                </div>
            </body>
            </html>
        `;

        res.json({
            invoiceNumber: order.invoiceNumber,
            html: invoiceHtml
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
app.get('/api/admin/orders/export', requireAdmin, async (req, res) => {
    try {
        if (!mongoConnected) {
            return res.status(503).json({ error: 'Database unavailable' });
        }

        const { status, startDate, endDate, format } = req.query;
        let query = {};

        if (status && status !== 'all') {
            query.status = status;
        }

        if (startDate || endDate) {
            query.createdAt = {};
            if (startDate) query.createdAt.$gte = new Date(startDate);
            if (endDate) {
                const end = new Date(endDate);
                end.setHours(23, 59, 59, 999);
                query.createdAt.$lte = end;
            }
        }

        const orders = await Order.find(query).sort({ createdAt: -1 });

        if (format === 'csv') {
            const headers = ['Order ID', 'Customer Name', 'Email', 'Phone', 'Items', 'Subtotal', 'Tax', 'Delivery Fee', 'Total', 'Payment Method', 'Payment Status', 'Status', 'Delivery Type', 'Created At'];
            const rows = orders.map(order => [
                order._id,
                order.customerName,
                order.email,
                order.phone,
                (order.items || []).map(i => `${i.name} x${i.quantity}`).join('; '),
                order.subtotal || 0,
                order.tax || 0,
                order.deliveryFee || 0,
                order.total || 0,
                order.paymentMethod,
                order.paymentStatus,
                order.status,
                order.deliveryType,
                new Date(order.createdAt).toISOString()
            ]);

            const csvContent = [headers, ...rows].map(row => row.map(cell => `"${cell}"`).join(',')).join('\n');

            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', `attachment; filename=orders_${new Date().toISOString().split('T')[0]}.csv`);
            res.send(csvContent);
        } else {
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Content-Disposition', `attachment; filename=orders_${new Date().toISOString().split('T')[0]}.json`);
            res.json(orders);
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/orders/:id', requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const order = await Order.findByIdAndDelete(id);

        if (!order) {
            return res.status(404).json({ error: 'Order not found' });
        }

        res.json({ message: 'Order deleted' });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});
const complaintSchema = new mongoose.Schema({
    _id: String,
    orderId: String,
    customerName: String,
    customerEmail: String,
    customerPhone: String,
    subject: String,
    description: String,
    status: { type: String, enum: ['open', 'investigating', 'resolved', 'closed'], default: 'open' },
    priority: { type: String, enum: ['low', 'medium', 'high', 'urgent'], default: 'medium' },
    resolution: String,
    resolvedAt: Date,
    resolvedBy: String,
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});
const Complaint = mongoose.model('Complaint', complaintSchema);

app.post('/api/complaints', async (req, res) => {
    try {
        const { orderId, customerName, customerEmail, customerPhone, subject, description } = req.body;

        if (!subject || !description) {
            return res.status(400).json({ error: 'Subject and description are required' });
        }

        const complaintId = 'CMP-' + uuidv4().substring(0, 8).toUpperCase();
        const complaint = new Complaint({
            _id: complaintId,
            orderId,
            customerName,
            customerEmail,
            customerPhone,
            subject,
            description
        });

        await complaint.save();
        emitToRoom('admin', 'complaint:new', {
            complaintId,
            subject,
            customerName,
            priority: 'medium'
        });

        res.status(201).json({ message: 'Complaint submitted successfully', complaintId });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

app.get('/api/admin/complaints', requireAdmin, async (req, res) => {
    try {
        const { status, priority } = req.query;
        let query = {};

        if (status && status !== 'all') query.status = status;
        if (priority && priority !== 'all') query.priority = priority;

        const complaints = await Complaint.find(query).sort({ createdAt: -1 });
        res.json(complaints);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/admin/complaints/:id', requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { status, resolution, priority } = req.body;

        const updateData = { updatedAt: new Date() };
        if (status) {
            updateData.status = status;
            if (status === 'resolved' || status === 'closed') {
                updateData.resolvedAt = new Date();
                updateData.resolvedBy = req.user?.email;
            }
        }
        if (resolution) updateData.resolution = resolution;
        if (priority) updateData.priority = priority;

        const complaint = await Complaint.findByIdAndUpdate(id, updateData, { new: true });

        if (!complaint) {
            return res.status(404).json({ error: 'Complaint not found' });
        }
        if (complaint.customerEmail && status === 'resolved') {
            await sendEmailNotification(complaint.customerEmail, `Complaint Resolved - #${id}`,
                `<h2>Your complaint has been resolved!</h2><p>Reference: ${id}</p><p>Resolution: ${resolution}</p>`);
        }

        res.json({ message: 'Complaint updated', complaint });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

const disputeSchema = new mongoose.Schema({
    _id: String,
    orderId: String,
    customerName: String,
    customerEmail: String,
    customerPhone: String,
    amount: Number,
    reason: String,
    evidence: String,
    status: { type: String, enum: ['open', 'under_review', 'approved', 'rejected', 'resolved'], default: 'open' },
    resolution: String,
    resolvedAt: Date,
    resolvedBy: String,
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});
const Dispute = mongoose.model('Dispute', disputeSchema);

app.post('/api/disputes', async (req, res) => {
    try {
        const { orderId, customerName, customerEmail, customerPhone, amount, reason, evidence } = req.body;

        if (!orderId || !reason) {
            return res.status(400).json({ error: 'Order ID and reason are required' });
        }

        const disputeId = 'DSP-' + uuidv4().substring(0, 8).toUpperCase();
        const dispute = new Dispute({
            _id: disputeId,
            orderId,
            customerName,
            customerEmail,
            customerPhone,
            amount,
            reason,
            evidence
        });

        await dispute.save();

        emitToRoom('admin', 'dispute:new', {
            disputeId,
            orderId,
            amount,
            reason
        });

        res.status(201).json({ message: 'Dispute submitted successfully', disputeId });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});
app.get('/api/admin/disputes', requireAdmin, async (req, res) => {
    try {
        const { status } = req.query;
        let query = {};

        if (status && status !== 'all') query.status = status;

        const disputes = await Dispute.find(query).sort({ createdAt: -1 });
        res.json(disputes);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/admin/disputes/:id', requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { status, resolution } = req.body;

        const updateData = { updatedAt: new Date() };
        if (status) {
            updateData.status = status;
            if (status === 'resolved' || status === 'approved' || status === 'rejected') {
                updateData.resolvedAt = new Date();
                updateData.resolvedBy = req.user?.email;
            }
        }
        if (resolution) updateData.resolution = resolution;

        const dispute = await Dispute.findByIdAndUpdate(id, updateData, { new: true });

        if (!dispute) {
            return res.status(404).json({ error: 'Dispute not found' });
        }
        if (status === 'approved' && dispute.orderId) {
            const order = await Order.findById(dispute.orderId);
            if (order && order.paymentStatus === 'completed') {
                order.paymentStatus = 'refunded';
                order.refundAmount = dispute.amount || order.total;
                order.refundedAt = new Date();
                order.refundReason = `Dispute resolution: ${resolution}`;
                order.refundProcessedBy = req.user?.email;
                await order.save();
            }
        }
        if (dispute.customerEmail) {
            await sendEmailNotification(dispute.customerEmail, `Dispute Update - #${id}`,
                `<h2>Your dispute has been ${status}!</h2><p>Reference: ${id}</p><p>Resolution: ${resolution}</p>`);
        }

        res.json({ message: 'Dispute updated', dispute });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});
app.get('/api/admin/payments/reconciliation', requireAdmin, async (req, res) => {
    try {
        if (!mongoConnected) {
            return res.json({ summary: {}, transactions: [] });
        }

        const { startDate, endDate, paymentMethod } = req.query;
        let query = {
            paymentStatus: { $in: ['completed', 'refunded', 'partially_refunded'] }
        };

        if (startDate || endDate) {
            query.createdAt = {};
            if (startDate) query.createdAt.$gte = new Date(startDate);
            if (endDate) {
                const end = new Date(endDate);
                end.setHours(23, 59, 59, 999);
                query.createdAt.$lte = end;
            }
        }
        if (paymentMethod && paymentMethod !== 'all') {
            query.paymentMethod = paymentMethod;
        }

        const transactions = await Order.find(query).sort({ createdAt: -1 });

        const summary = {
            totalTransactions: transactions.length,
            totalAmount: 0,
            totalRefunded: 0,
            netRevenue: 0,
            byPaymentMethod: {}
        };

        transactions.forEach(order => {
            const amount = order.total || 0;
            const refunded = order.refundAmount || 0;

            summary.totalAmount += amount;
            summary.totalRefunded += refunded;
            summary.netRevenue += (amount - refunded);

            const method = order.paymentMethod || 'unknown';
            if (!summary.byPaymentMethod[method]) {
                summary.byPaymentMethod[method] = { count: 0, amount: 0 };
            }
            summary.byPaymentMethod[method].count++;
            summary.byPaymentMethod[method].amount += amount;
        });

        res.json({ summary, transactions });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
app.get('/api/admin/transactions/export', requireAdmin, async (req, res) => {
    try {
        if (!mongoConnected) {
            return res.status(503).json({ error: 'Database unavailable' });
        }

        const { startDate, endDate, format } = req.query;
        let query = {};

        if (startDate || endDate) {
            query.createdAt = {};
            if (startDate) query.createdAt.$gte = new Date(startDate);
            if (endDate) {
                const end = new Date(endDate);
                end.setHours(23, 59, 59, 999);
                query.createdAt.$lte = end;
            }
        }

        const transactions = await Order.find(query).sort({ createdAt: -1 });

        if (format === 'csv') {
            const headers = ['Transaction ID', 'Date', 'Customer', 'Email', 'Phone', 'Amount', 'Payment Method', 'Payment Status', 'Order Status', 'Refunded Amount'];
            const rows = transactions.map(order => [
                order._id,
                new Date(order.createdAt).toISOString(),
                order.customerName || order.email?.split('@')[0],
                order.email || '',
                order.phone || '',
                order.total || 0,
                order.paymentMethod || '',
                order.paymentStatus || '',
                order.status || '',
                order.refundAmount || 0
            ]);

            const csvContent = [headers, ...rows].map(row => row.map(cell => `"${cell}"`).join(',')).join('\n');

            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', `attachment; filename=transactions_${new Date().toISOString().split('T')[0]}.csv`);
            res.send(csvContent);
        } else {
            res.json(transactions);
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
app.get('/api/admin/staff/metrics', requireAdmin, async (req, res) => {
    try {
        if (!mongoConnected) {
            return res.json({ staffPerformance: [], orderStats: {} });
        }

        const { startDate, endDate } = req.query;
        let dateFilter = {};

        if (startDate || endDate) {
            dateFilter.createdAt = {};
            if (startDate) dateFilter.createdAt.$gte = new Date(startDate);
            if (endDate) dateFilter.createdAt.$lte = new Date(endDate);
        }

        const orders = await Order.find({
            ...dateFilter,
            deliveryPerson: { $exists: true, $ne: null },
            status: { $in: ['delivered', 'completed'] }
        });

        const staffMetrics = {};

        orders.forEach(order => {
            if (order.deliveryPerson?.name) {
                const name = order.deliveryPerson.name;
                if (!staffMetrics[name]) {
                    staffMetrics[name] = {
                        name,
                        phone: order.deliveryPerson.phone,
                        totalDeliveries: 0,
                        totalRevenue: 0,
                        completedDeliveries: 0,
                        cancelledDeliveries: 0,
                        ratings: []
                    };
                }
                staffMetrics[name].totalDeliveries++;
                staffMetrics[name].totalRevenue += order.total || 0;
                if (order.status === 'delivered' || order.status === 'completed') {
                    staffMetrics[name].completedDeliveries++;
                }
            }
        });
        const allOrders = await Order.find(dateFilter);
        const orderStats = {
            total: allOrders.length,
            pending: allOrders.filter(o => o.status === 'pending').length,
            confirmed: allOrders.filter(o => o.status === 'confirmed').length,
            preparing: allOrders.filter(o => o.status === 'preparing').length,
            ready: allOrders.filter(o => o.status === 'ready').length,
            delivered: allOrders.filter(o => o.status === 'delivered' || o.status === 'completed').length,
            cancelled: allOrders.filter(o => o.status === 'cancelled').length,
            refunded: allOrders.filter(o => o.status === 'refunded').length
        };

        res.json({
            staffPerformance: Object.values(staffMetrics),
            orderStats
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/reservations', async (req, res) => {
    try {
        const reservationId = 'RES-' + uuidv4().substring(0, 8).toUpperCase();
        const reservation = new Reservation({ _id: reservationId, ...req.body });
        await reservation.save();
        await sendReservationNotifications(reservation);
        emitToRoom('admin', 'reservation:new', {
            reservationId,
            name: reservation.name,
            date: reservation.date,
            time: reservation.time,
            guests: reservation.guests,
            createdAt: reservation.createdAt
        });

        emitToRoom('reservations', 'reservation:created', {
            reservationId,
            status: 'pending'
        });

        res.status(201).json({ message: 'Reserved', reservationId });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

app.get('/api/reservations', async (req, res) => {
    try {
        const reservations = await Reservation.find().sort({ createdAt: -1 });
        res.json(reservations);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/reservations/:id', requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const updateData = { ...req.body };

        const reservation = await Reservation.findByIdAndUpdate(id, updateData, { new: true });

        if (!reservation) {
            return res.status(404).json({ error: 'Reservation not found' });
        }

        res.json({ message: 'Reservation updated', reservation });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

app.delete('/api/reservations/:id', requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const reservation = await Reservation.findByIdAndDelete(id);

        if (!reservation) {
            return res.status(404).json({ error: 'Reservation not found' });
        }

        res.json({ message: 'Reservation deleted' });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

app.post('/api/parking', async (req, res) => {
    try {
        const reservationId = 'PRK-' + uuidv4().substring(0, 8).toUpperCase();
        const slotNumber = 'P' + Math.floor(Math.random() * 50) + 1;
        const parking = new Parking({ _id: reservationId, slotNumber, ...req.body });
        await parking.save();
        await sendParkingNotifications(parking);
        res.status(201).json({ message: 'Parking reserved', reservationId, slotNumber });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

app.get('/api/parking', async (req, res) => {
    try {
        const parking = await Parking.find().sort({ createdAt: -1 });
        res.json(parking);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/reviews', async (req, res) => {
    try {
        const { status, visible } = req.query;
        let query = {};

        if (status && status !== 'all') {
            query.status = status;
        }
        if (visible === 'true') {
            query.isVisible = true;
        } else if (visible === 'false' && !status) {
            query.isVisible = true;
        }

        const reviews = await Review.find(query).sort({ createdAt: -1 });
        res.json(reviews);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/reviews', async (req, res) => {
    try {
        const { name, rating, comment, orderId, userId, email } = req.body;

        if (!name || !rating || !comment) {
            return res.status(400).json({ error: 'Name, rating, and comment are required' });
        }

        const reviewId = 'REV-' + uuidv4().substring(0, 8).toUpperCase();
        const review = new Review({
            _id: reviewId,
            name,
            rating,
            comment,
            orderId,
            userId,
            email,
            status: 'pending',
            isVisible: false
        });
        await review.save();
        emitToRoom('admin', 'review:new', {
            reviewId,
            name,
            rating,
            comment,
            createdAt: review.createdAt
        });

        res.status(201).json({ message: 'Review submitted for moderation', reviewId });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});
app.get('/api/admin/reviews', requireAdmin, async (req, res) => {
    try {
        const { status } = req.query;
        let query = {};

        if (status && status !== 'all') {
            query.status = status;
        }

        const reviews = await Review.find(query).sort({ createdAt: -1 });
        res.json(reviews);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/admin/reviews/:id/status', requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { status, adminReply } = req.body;

        if (!status) {
            return res.status(400).json({ error: 'Status is required' });
        }

        const validStatuses = ['pending', 'approved', 'rejected'];
        if (!validStatuses.includes(status)) {
            return res.status(400).json({ error: `Invalid status.Must be one of: ${validStatuses.join(', ')} ` });
        }

        const updateData = {
            status,
            isVisible: status === 'approved',
            updatedAt: new Date()
        };

        if (adminReply !== undefined) {
            updateData.adminReply = adminReply;
        }

        const review = await Review.findByIdAndUpdate(id, updateData, { new: true });

        if (!review) {
            return res.status(404).json({ error: 'Review not found' });
        }
        emitToAll('review:updated', {
            reviewId: id,
            status,
            isVisible: review.isVisible
        });

        res.json({ message: 'Review status updated', review });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

app.delete('/api/admin/reviews/:id', requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const review = await Review.findByIdAndDelete(id);

        if (!review) {
            return res.status(404).json({ error: 'Review not found' });
        }

        res.json({ message: 'Review deleted' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/events', async (req, res) => {
    try {
        const { name, email, eventType, date, guests } = req.body;
        const eventId = 'EVT-' + uuidv4().substring(0, 8).toUpperCase();
        const event = new Event({ _id: eventId, name, email, eventType, date, guests });
        await event.save();

        if (email) {
            await sendEmailNotification(email, 'Event Inquiry Received - The Quill',
                `<h2>Thank you ${name}!</h2><p>We've received your ${eventType} inquiry for ${guests} guests.</p>`);
        }

        const adminEmail = process.env.ADMIN_EMAIL;
        if (adminEmail) {
            await sendEmailNotification(adminEmail, `New Event Inquiry - ${eventType}`,
                `<p>${name} (${email}) wants to book ${eventType} for ${guests} guests on ${date}</p>`);
        }

        res.status(201).json({ message: 'Inquiry submitted', eventId });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

app.get('/api/events', async (req, res) => {
    try {
        const events = await Event.find().sort({ createdAt: -1 });
        res.json(events);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/contact', async (req, res) => {
    try {
        const { name, email, message } = req.body;
        const contactId = 'CNT-' + uuidv4().substring(0, 8).toUpperCase();
        const contact = new Contact({ _id: contactId, name, email, message });
        await contact.save();

        if (email) {
            await sendEmailNotification(email, 'Message Received - The Quill',
                `<h2>Thank you ${name}!</h2><p>We've received your message.</p>`);
        }

        const adminEmail = process.env.ADMIN_EMAIL;
        if (adminEmail) {
            await sendEmailNotification(adminEmail, `New Contact from ${name}`,
                `<p><strong>From:</strong> ${name} (${email})</p><p>${message}</p>`);
        }

        res.status(201).json({ message: 'Message sent', contactId });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

app.post('/api/subscribe', async (req, res) => {
    try {
        const { email } = req.body;
        const subscriberId = 'SUB-' + uuidv4().substring(0, 8).toUpperCase();
        const subscriber = new Subscriber({ _id: subscriberId, email });
        await subscriber.save();
        res.status(201).json({ message: 'Subscribed', subscriberId });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

app.post('/api/notifications/subscribe', async (req, res) => {
    try {
        const { subscription, userId } = req.body;
        console.log('Push subscription received:', subscription?.endpoint);

        res.status(201).json({ message: 'Push subscription saved' });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

app.post('/api/notifications/send', requireAdmin, async (req, res) => {
    try {
        const { title, message, type, data } = req.body;

        if (!title || !message) {
            return res.status(400).json({ error: 'Title and message are required' });
        }
        emitToAll('notification:push', {
            title,
            message,
            type: type || 'info',
            data: data || {},
            timestamp: new Date().toISOString()
        });

        res.status(200).json({ message: 'Notification sent' });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

app.get('/api/stats', async (req, res) => {
    try {
        if (!mongoConnected) {
            return res.json({
                totalMenuItems: 14,
                totalOrders: 0,
                totalReservations: 0,
                totalParking: 0,
                totalReviews: 0,
                averageRating: 0,
                yearsInBusiness: 15,
                dbStatus: 'offline'
            });
        }

        const totalOrders = await Order.countDocuments();
        const totalReservations = await Reservation.countDocuments();
        const totalParking = await Parking.countDocuments();
        const totalReviews = await Review.countDocuments();
        const reviews = await Review.find();
        const averageRating = reviews.length > 0
            ? (reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length).toFixed(1)
            : 0;

        res.json({
            totalMenuItems: 14,
            totalOrders,
            totalReservations,
            totalParking,
            totalReviews,
            averageRating: parseFloat(averageRating),
            yearsInBusiness: 15,
            dbStatus: 'online'
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
app.get('/api/admin/orders', requireAdmin, async (req, res) => {
    try {
        if (!mongoConnected) {
            return res.json([]);
        }

        const { status, startDate, endDate, limit, search, paymentStatus, deliveryType, minTotal, maxTotal } = req.query;
        let query = {};
        if (status && status !== 'all') {
            query.status = status;
        }

        if (paymentStatus && paymentStatus !== 'all') {
            query.paymentStatus = paymentStatus;
        }

        if (deliveryType && deliveryType !== 'all') {
            query.deliveryType = deliveryType;
        }
        if (startDate || endDate) {
            query.createdAt = {};
            if (startDate) {
                query.createdAt.$gte = new Date(startDate);
            }
            if (endDate) {
                const end = new Date(endDate);
                end.setHours(23, 59, 59, 999);
                query.createdAt.$lte = end;
            }
        }

        if (minTotal || maxTotal) {
            query.total = {};
            if (minTotal) query.total.$gte = parseFloat(minTotal);
            if (maxTotal) query.total.$lte = parseFloat(maxTotal);
        }

        if (search) {
            const searchRegex = new RegExp(search, 'i');
            query.$or = [
                { customerName: searchRegex },
                { email: searchRegex },
                { phone: searchRegex },
                { _id: searchRegex }
            ];
        }

        let orders = await Order.find(query).sort({ createdAt: -1 });

        if (limit) {
            orders = orders.slice(0, parseInt(limit));
        }

        res.json(orders);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/admin/revenue', requireAdmin, async (req, res) => {
    try {
        if (!mongoConnected) {
            return res.json({
                totalRevenue: 0,
                dailyRevenue: [],
                weeklyRevenue: [],
                monthlyRevenue: [],
                averageOrderValue: 0,
                orderCount: 0
            });
        }

        const { period, startDate, endDate } = req.query;

        let dateFilter = {};
        const now = new Date();

        if (startDate && endDate) {
            dateFilter = {
                createdAt: {
                    $gte: new Date(startDate),
                    $lte: new Date(endDate)
                }
            };
        } else if (period === 'daily') {
            dateFilter = {
                createdAt: {
                    $gte: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
                }
            };
        } else if (period === 'weekly') {
            dateFilter = {
                createdAt: {
                    $gte: new Date(now.getTime() - 28 * 24 * 60 * 60 * 1000)
                }
            };
        } else if (period === 'monthly') {
            dateFilter = {
                createdAt: {
                    $gte: new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000)
                }
            };
        } else {
            dateFilter = {
                createdAt: {
                    $gte: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
                }
            };
        }

        const orders = await Order.find({
            ...dateFilter,
            status: { $nin: ['cancelled'] },
            paymentStatus: 'completed'
        });

        const totalRevenue = orders.reduce((sum, order) => sum + (order.total || 0), 0);
        const orderCount = orders.length;
        const averageOrderValue = orderCount > 0 ? totalRevenue / orderCount : 0;

        const dailyRevenue = [];
        for (let i = 6; i >= 0; i--) {
            const date = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
            const dateStr = date.toISOString().split('T')[0];
            const dayOrders = orders.filter(o => {
                const orderDate = new Date(o.createdAt).toISOString().split('T')[0];
                return orderDate === dateStr;
            });
            dailyRevenue.push({
                date: dateStr,
                revenue: dayOrders.reduce((sum, o) => sum + (o.total || 0), 0),
                orders: dayOrders.length
            });
        }

        const weeklyRevenue = [];
        for (let i = 3; i >= 0; i--) {
            const weekStart = new Date(now.getTime() - (i + 1) * 7 * 24 * 60 * 60 * 1000);
            const weekEnd = new Date(now.getTime() - i * 7 * 24 * 60 * 60 * 1000);
            const weekOrders = orders.filter(o => {
                const orderDate = new Date(o.createdAt);
                return orderDate >= weekStart && orderDate < weekEnd;
            });
            weeklyRevenue.push({
                week: `Week ${4 - i} `,
                revenue: weekOrders.reduce((sum, o) => sum + (o.total || 0), 0),
                orders: weekOrders.length
            });
        }

        const monthlyRevenue = [];
        for (let i = 11; i >= 0; i--) {
            const monthStart = new Date(now.getFullYear(), now.getMonth() - i, 1);
            const monthEnd = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
            const monthOrders = orders.filter(o => {
                const orderDate = new Date(o.createdAt);
                return orderDate >= monthStart && orderDate < monthEnd;
            });
            monthlyRevenue.push({
                month: monthStart.toLocaleString('default', { month: 'short' }),
                revenue: monthOrders.reduce((sum, o) => sum + (o.total || 0), 0),
                orders: monthOrders.length
            });
        }

        res.json({
            totalRevenue,
            dailyRevenue,
            weeklyRevenue,
            monthlyRevenue,
            averageOrderValue,
            orderCount
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
app.get('/api/admin/analytics', requireAdmin, async (req, res) => {
    try {
        const { range = '30d' } = req.query;

        if (!mongoConnected) {
            return res.json({
                analytics: {
                    dailyRevenue: [],
                    topItems: [],
                    deliveryMetrics: { averageTime: 0, successRate: 0, partnerCount: 0 },
                    customerMetrics: { totalCustomers: 0, activeMonthly: 0, newThisMonth: 0 },
                    revenueByType: [],
                    peakHours: [],
                    paymentMethods: [],
                    orderTrends: []
                }
            });
        }

        const now = new Date();
        let startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

        if (range === '7d') {
            startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        } else if (range === '90d') {
            startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
        }

        // Get orders in date range
        const orders = await Order.find({
            createdAt: { $gte: startDate },
            status: { $nin: ['cancelled'] }
        }).sort({ createdAt: -1 });

        // Get all orders for stats
        const allOrders = await Order.find().sort({ createdAt: -1 });
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const todayOrders = allOrders.filter(o => new Date(o.createdAt) >= todayStart);

        // Daily revenue calculation
        const dailyRevenueMap = {};
        const daysToShow = range === '7d' ? 7 : range === '90d' ? 90 : 30;
        for (let i = daysToShow - 1; i >= 0; i--) {
            const date = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
            const dateStr = date.toISOString().split('T')[0];
            dailyRevenueMap[dateStr] = { date: dateStr, revenue: 0, orders: 0 };
        }

        orders.forEach(order => {
            if (order.paymentStatus === 'completed') {
                const dateStr = new Date(order.createdAt).toISOString().split('T')[0];
                if (dailyRevenueMap[dateStr]) {
                    dailyRevenueMap[dateStr].revenue += order.total || 0;
                    dailyRevenueMap[dateStr].orders += 1;
                }
            }
        });
        const dailyRevenue = Object.values(dailyRevenueMap);

        // Top items calculation
        const itemCount = {};
        orders.forEach(order => {
            if (order.items && Array.isArray(order.items)) {
                order.items.forEach((item) => {
                    if (item.name) {
                        if (!itemCount[item.name]) {
                            itemCount[item.name] = { name: item.name, orders: 0, revenue: 0 };
                        }
                        itemCount[item.name].orders += item.quantity || 1;
                        itemCount[item.name].revenue += (item.price || 0) * (item.quantity || 1);
                    }
                });
            }
        });
        const topItems = Object.values(itemCount)
            .sort((a, b) => b.orders - a.orders)
            .slice(0, 10);

        // Delivery metrics
        const deliveryOrders = orders.filter(o => o.deliveryType === 'delivery');
        const completedDeliveries = deliveryOrders.filter(o => o.status === 'delivered' || o.status === 'completed').length;
        const deliveryMetrics = {
            averageTime: 35,
            successRate: deliveryOrders.length > 0 ? completedDeliveries / deliveryOrders.length : 0,
            partnerCount: 12
        };

        // Customer metrics
        const allUsers = await User.find();
        const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        const activeMonthly = allUsers.filter(u => {
            const lastOrder = allOrders.find(o => o.email === u.email);
            return lastOrder && new Date(lastOrder.createdAt) >= thirtyDaysAgo;
        }).length;
        const newThisMonth = allUsers.filter(u => new Date(u.createdAt) >= new Date(now.getFullYear(), now.getMonth(), 1)).length;
        const customerMetrics = {
            totalCustomers: allUsers.length,
            activeMonthly,
            newThisMonth
        };

        // Revenue by type
        const dineInOrders = orders.filter(o => o.deliveryType === 'dinein' || (!o.deliveryType));
        const deliveryRevenueOrders = orders.filter(o => o.deliveryType === 'delivery');
        const takeawayOrders = orders.filter(o => o.deliveryType === 'takeaway');
        const revenueByType = [
            { type: 'Dine-in', value: dineInOrders.reduce((sum, o) => sum + (o.total || 0), 0) },
            { type: 'Delivery', value: deliveryRevenueOrders.reduce((sum, o) => sum + (o.total || 0), 0) },
            { type: 'Takeaway', value: takeawayOrders.reduce((sum, o) => sum + (o.total || 0), 0) }
        ];

        // Peak hours
        const hourCount = {};
        for (let h = 8; h <= 22; h++) {
            const hourStr = `${h.toString().padStart(2, '0')}:00`;
            hourCount[hourStr] = 0;
        }
        orders.forEach(order => {
            const hour = new Date(order.createdAt).getHours();
            if (hour >= 8 && hour <= 22) {
                const hourStr = `${hour.toString().padStart(2, '0')}:00`;
                hourCount[hourStr] = (hourCount[hourStr] || 0) + 1;
            }
        });
        const peakHours = Object.entries(hourCount).map(([hour, orders]) => ({ hour, orders }));

        // Payment methods
        const paymentCount = {};
        orders.forEach(order => {
            const method = order.paymentMethod || 'cash';
            paymentCount[method] = (paymentCount[method] || 0) + 1;
        });
        const totalPayments = Object.values(paymentCount).reduce((a, b) => a + b, 0);
        const paymentMethods = Object.entries(paymentCount).map(([method, count]) => ({
            method: method.charAt(0).toUpperCase() + method.slice(1),
            count,
            percentage: totalPayments > 0 ? Math.round((count / totalPayments) * 100) : 0
        }));

        // Order trends (weekly)
        const weeks = range === '7d' ? 1 : range === '90d' ? 12 : 4;
        const orderTrends = [];
        for (let i = weeks - 1; i >= 0; i--) {
            const weekStart = new Date(now.getTime() - (i + 1) * 7 * 24 * 60 * 60 * 1000);
            const weekEnd = new Date(now.getTime() - i * 7 * 24 * 60 * 60 * 1000);
            const weekOrders = orders.filter(o => {
                const orderDate = new Date(o.createdAt);
                return orderDate >= weekStart && orderDate < weekEnd;
            });
            orderTrends.push({
                week: `Week ${weeks - i}`,
                orders: weekOrders.length,
                revenue: weekOrders.reduce((sum, o) => sum + (o.total || 0), 0)
            });
        }

        res.json({
            analytics: {
                dailyRevenue,
                topItems,
                deliveryMetrics,
                customerMetrics,
                revenueByType,
                peakHours,
                paymentMethods,
                orderTrends
            }
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/reservations/:id/status', requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;

        if (!status) {
            return res.status(400).json({ error: 'Status is required' });
        }

        const validStatuses = ['pending', 'confirmed', 'cancelled', 'completed'];
        if (!validStatuses.includes(status)) {
            return res.status(400).json({ error: `Invalid status.Must be one of: ${validStatuses.join(', ')} ` });
        }

        const reservation = await Reservation.findByIdAndUpdate(id, { status }, { new: true });

        if (!reservation) {
            return res.status(404).json({ error: 'Reservation not found' });
        }
        emitToRoom('reservations', 'reservation:statusChanged', {
            reservationId: id,
            status,
            updatedAt: reservation.updatedAt
        });

        emitToRoom('admin', 'reservation:updated', {
            reservationId: id,
            status,
            updatedAt: reservation.updatedAt
        });

        res.json({ message: 'Reservation status updated', reservation });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

app.get('/api/loyalty/points', async (req, res) => {
    try {
        if (!req.user) {
            return res.status(401).json({ error: 'Authentication required' });
        }

        if (!mongoConnected) {
            return res.json({ points: 0, tier: 'bronze', lifetimePoints: 0, pointsHistory: [] });
        }

        let loyalty = await LoyaltyPoints.findOne({ userId: req.user.userId });

        if (!loyalty) {
            const referralCode = 'REF-' + uuidv4().substring(0, 8).toUpperCase();
            loyalty = new LoyaltyPoints({
                _id: 'LOYAL-' + req.user.userId,
                userId: req.user.userId,
                points: 0,
                lifetimePoints: 0,
                tier: 'bronze',
                referralCode,
                pointsHistory: []
            });
            await loyalty.save();
        }

        res.json({
            points: loyalty.points,
            tier: loyalty.tier,
            lifetimePoints: loyalty.lifetimePoints,
            referralCode: loyalty.referralCode,
            pointsHistory: loyalty.pointsHistory || []
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/loyalty/earn', async (req, res) => {
    try {
        const { userId, orderId, orderTotal, description } = req.body;

        if (!userId || !orderTotal) {
            return res.status(400).json({ error: 'User ID and order total are required' });
        }

        if (!mongoConnected) {
            return res.status(503).json({ error: 'Database unavailable' });
        }

        const pointsEarned = Math.floor(orderTotal / 10);

        let loyalty = await LoyaltyPoints.findOne({ userId });

        if (!loyalty) {
            const referralCode = 'REF-' + uuidv4().substring(0, 8).toUpperCase();
            loyalty = new LoyaltyPoints({
                _id: 'LOYAL-' + userId,
                userId,
                points: pointsEarned,
                lifetimePoints: pointsEarned,
                tier: 'bronze',
                referralCode,
                pointsHistory: [{
                    points: pointsEarned,
                    type: 'earn',
                    description: description || `Points earned from order #${orderId}`,
                    orderId,
                    createdAt: new Date()
                }]
            });
        } else {
            loyalty.points += pointsEarned;
            loyalty.lifetimePoints += pointsEarned;
            loyalty.pointsHistory = loyalty.pointsHistory || [];
            loyalty.pointsHistory.push({
                points: pointsEarned,
                type: 'earn',
                description: description || `Points earned from order #${orderId}`,
                orderId,
                createdAt: new Date()
            });

            if (loyalty.lifetimePoints >= 50000) {
                loyalty.tier = 'platinum';
            } else if (loyalty.lifetimePoints >= 25000) {
                loyalty.tier = 'gold';
            } else if (loyalty.lifetimePoints >= 10000) {
                loyalty.tier = 'silver';
            } else {
                loyalty.tier = 'bronze';
            }
        }

        loyalty.updatedAt = new Date();
        await loyalty.save();

        res.json({
            message: 'Points earned successfully',
            pointsEarned,
            totalPoints: loyalty.points,
            tier: loyalty.tier
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/loyalty/redeem', async (req, res) => {
    try {
        if (!req.user) {
            return res.status(401).json({ error: 'Authentication required' });
        }

        const { points, orderId, description } = req.body;

        if (!points || points <= 0) {
            return res.status(400).json({ error: 'Valid points amount is required' });
        }

        if (!mongoConnected) {
            return res.status(503).json({ error: 'Database unavailable' });
        }

        const loyalty = await LoyaltyPoints.findOne({ userId: req.user.userId });

        if (!loyalty) {
            return res.status(404).json({ error: 'Loyalty account not found' });
        }

        if (loyalty.points < points) {
            return res.status(400).json({ error: 'Insufficient points balance' });
        }

        const discountValue = points;

        loyalty.points -= points;
        loyalty.pointsHistory = loyalty.pointsHistory || [];
        loyalty.pointsHistory.push({
            points: -points,
            type: 'redeem',
            description: description || `Points redeemed for order #${orderId}`,
            orderId,
            createdAt: new Date()
        });
        loyalty.updatedAt = new Date();
        await loyalty.save();

        res.json({
            message: 'Points redeemed successfully',
            pointsRedeemed: points,
            discountValue,
            remainingPoints: loyalty.points
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/loyalty/referral', async (req, res) => {
    try {
        if (!req.user) {
            return res.status(401).json({ error: 'Authentication required' });
        }

        const { referralCode } = req.body;

        if (!referralCode) {
            return res.status(400).json({ error: 'Referral code is required' });
        }

        if (!mongoConnected) {
            return res.status(503).json({ error: 'Database unavailable' });
        }

        const referrer = await LoyaltyPoints.findOne({ referralCode });

        if (!referrer) {
            return res.status(404).json({ error: 'Invalid referral code' });
        }

        if (referrer.userId === req.user.userId) {
            return res.status(400).json({ error: 'You cannot refer yourself' });
        }

        const userLoyalty = await LoyaltyPoints.findOne({ userId: req.user.userId });

        if (userLoyalty && userLoyalty.referredBy) {
            return res.status(400).json({ error: 'You have already used a referral code' });
        }

        const bonusPoints = 500;

        referrer.points += bonusPoints;
        referrer.lifetimePoints += bonusPoints;
        referrer.pointsHistory = referrer.pointsHistory || [];
        referrer.pointsHistory.push({
            points: bonusPoints,
            type: 'referral',
            description: `Referral bonus for inviting a new member`,
            createdAt: new Date()
        });
        referrer.updatedAt = new Date();
        await referrer.save();

        if (userLoyalty) {
            userLoyalty.points += bonusPoints;
            userLoyalty.lifetimePoints += bonusPoints;
            userLoyalty.referredBy = referrer.userId;
            userLoyalty.pointsHistory = userLoyalty.pointsHistory || [];
            userLoyalty.pointsHistory.push({
                points: bonusPoints,
                type: 'referral',
                description: `Welcome bonus from referral`,
                createdAt: new Date()
            });
            userLoyalty.updatedAt = new Date();
            await userLoyalty.save();
        } else {
            const newUserLoyalty = new LoyaltyPoints({
                _id: 'LOYAL-' + req.user.userId,
                userId: req.user.userId,
                points: bonusPoints,
                lifetimePoints: bonusPoints,
                tier: 'bronze',
                referralCode: 'REF-' + uuidv4().substring(0, 8).toUpperCase(),
                referredBy: referrer.userId,
                pointsHistory: [{
                    points: bonusPoints,
                    type: 'referral',
                    description: `Welcome bonus from referral`,
                    createdAt: new Date()
                }]
            });
            await newUserLoyalty.save();
        }

        res.json({
            message: 'Referral successful! Both you and your referrer earned bonus points',
            bonusPoints
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/coupons/validate', async (req, res) => {
    try {
        const { code, orderTotal, category } = req.body;

        if (!code) {
            return res.status(400).json({ error: 'Coupon code is required' });
        }

        if (!mongoConnected) {
            return res.json({ valid: false, error: 'Database unavailable' });
        }

        const coupon = await Coupon.findOne({ code: code.toUpperCase() });

        if (!coupon) {
            return res.json({ valid: false, error: 'Invalid coupon code' });
        }
        if (!coupon.isActive) {
            return res.json({ valid: false, error: 'This coupon is no longer active' });
        }
        const now = new Date();
        if (coupon.validFrom && new Date(coupon.validFrom) > now) {
            return res.json({ valid: false, error: 'This coupon is not yet valid' });
        }
        if (coupon.validUntil && new Date(coupon.validUntil) < now) {
            return res.json({ valid: false, error: 'This coupon has expired' });
        }

        if (coupon.maxUses && coupon.usedCount >= coupon.maxUses) {
            return res.json({ valid: false, error: 'This coupon has reached its maximum number of uses' });
        }

        if (orderTotal && coupon.minOrderAmount && orderTotal < coupon.minOrderAmount) {
            return res.json({
                valid: false,
                error: `Minimum order amount of KES ${coupon.minOrderAmount} required`
            });
        }

        if (category && coupon.applicableCategories && coupon.applicableCategories.length > 0) {
            if (!coupon.applicableCategories.includes(category)) {
                return res.json({ valid: false, error: 'This coupon is not applicable to this category' });
            }
        }

        let discount = 0;
        if (coupon.discountType === 'percentage') {
            discount = (orderTotal || 0) * (coupon.discountValue / 100);
        } else {
            discount = coupon.discountValue;
        }

        res.json({
            valid: true,
            code: coupon.code,
            description: coupon.description,
            discountType: coupon.discountType,
            discountValue: coupon.discountValue,
            discount,
            message: 'Coupon applied successfully'
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/coupons', async (req, res) => {
    try {
        if (!mongoConnected) {
            return res.json([]);
        }

        const coupons = await Coupon.find({ isActive: true }).sort({ createdAt: -1 });
        res.json(coupons);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/admin/coupons', requireAdmin, async (req, res) => {
    try {
        const { code, description, discountType, discountValue, minOrderAmount, maxUses, validFrom, validUntil, applicableCategories } = req.body;

        if (!code || !discountType || !discountValue) {
            return res.status(400).json({ error: 'Code, discount type, and discount value are required' });
        }

        const couponId = 'CPN-' + uuidv4().substring(0, 8).toUpperCase();
        const coupon = new Coupon({
            _id: couponId,
            code: code.toUpperCase(),
            description,
            discountType,
            discountValue,
            minOrderAmount: minOrderAmount || 0,
            maxUses,
            usedCount: 0,
            validFrom,
            validUntil,
            isActive: true,
            applicableCategories: applicableCategories || []
        });

        await coupon.save();
        res.status(201).json({ message: 'Coupon created', coupon });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

app.get('/api/admin/coupons', requireAdmin, async (req, res) => {
    try {
        if (!mongoConnected) {
            return res.json([]);
        }

        const coupons = await Coupon.find().sort({ createdAt: -1 });
        res.json(coupons);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/admin/coupons/:id', requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { code, description, discountType, discountValue, minOrderAmount, maxUses, validFrom, validUntil, isActive, applicableCategories } = req.body;

        const updateData = {};
        if (code) updateData.code = code.toUpperCase();
        if (description !== undefined) updateData.description = description;
        if (discountType) updateData.discountType = discountType;
        if (discountValue !== undefined) updateData.discountValue = discountValue;
        if (minOrderAmount !== undefined) updateData.minOrderAmount = minOrderAmount;
        if (maxUses !== undefined) updateData.maxUses = maxUses;
        if (validFrom !== undefined) updateData.validFrom = validFrom;
        if (validUntil !== undefined) updateData.validUntil = validUntil;
        if (isActive !== undefined) updateData.isActive = isActive;
        if (applicableCategories !== undefined) updateData.applicableCategories = applicableCategories;

        const coupon = await Coupon.findByIdAndUpdate(id, updateData, { new: true });

        if (!coupon) {
            return res.status(404).json({ error: 'Coupon not found' });
        }

        res.json({ message: 'Coupon updated', coupon });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

app.delete('/api/admin/coupons/:id', requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const coupon = await Coupon.findByIdAndDelete(id);

        if (!coupon) {
            return res.status(404).json({ error: 'Coupon not found' });
        }

        res.json({ message: 'Coupon deleted' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/tickets', async (req, res) => {
    try {
        const { subject, category, priority, orderId, message } = req.body;

        if (!subject) {
            return res.status(400).json({ error: 'Subject is required' });
        }

        if (!mongoConnected) {
            return res.status(503).json({ error: 'Database unavailable' });
        }

        const ticketId = 'TKT-' + uuidv4().substring(0, 8).toUpperCase();
        const ticket = new Ticket({
            _id: ticketId,
            userId: req.user?.userId,
            orderId,
            subject,
            category: category || 'other',
            priority: priority || 'medium',
            status: 'open',
            messages: [{
                sender: req.user ? 'customer' : 'customer',
                message: message || subject,
                timestamp: new Date()
            }]
        });

        await ticket.save();
        emitToRoom('admin', 'ticket:new', {
            ticketId,
            subject,
            category,
            priority
        });

        res.status(201).json({ message: 'Ticket created successfully', ticketId });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

app.get('/api/tickets', async (req, res) => {
    try {
        if (!req.user) {
            return res.status(401).json({ error: 'Authentication required' });
        }

        if (!mongoConnected) {
            return res.json([]);
        }

        const tickets = await Ticket.find({ userId: req.user.userId }).sort({ createdAt: -1 });
        res.json(tickets);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
app.get('/api/tickets/:id', async (req, res) => {
    try {
        if (!req.user) {
            return res.status(401).json({ error: 'Authentication required' });
        }

        const { id } = req.params;

        if (!mongoConnected) {
            return res.status(503).json({ error: 'Database unavailable' });
        }

        const ticket = await Ticket.findById(id);

        if (!ticket) {
            return res.status(404).json({ error: 'Ticket not found' });
        }
        if (ticket.userId !== req.user.userId) {
            const user = await User.findById(req.user.userId);
            if (!user || !ADMIN_EMAILS.includes(user.email)) {
                return res.status(403).json({ error: 'Access denied' });
            }
        }

        res.json(ticket);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
app.post('/api/tickets/:id/messages', async (req, res) => {
    try {
        if (!req.user) {
            return res.status(401).json({ error: 'Authentication required' });
        }

        const { id } = req.params;
        const { message } = req.body;

        if (!message) {
            return res.status(400).json({ error: 'Message is required' });
        }

        if (!mongoConnected) {
            return res.status(503).json({ error: 'Database unavailable' });
        }

        const ticket = await Ticket.findById(id);

        if (!ticket) {
            return res.status(404).json({ error: 'Ticket not found' });
        }
        if (ticket.userId && ticket.userId !== req.user.userId) {
            return res.status(403).json({ error: 'Access denied' });
        }

        ticket.messages = ticket.messages || [];
        ticket.messages.push({
            sender: 'customer',
            message,
            timestamp: new Date()
        });
        ticket.updatedAt = new Date();
        await ticket.save();
        emitToRoom('admin', 'ticket:updated', {
            ticketId: id,
            status: ticket.status
        });

        res.json({ message: 'Message added', ticket });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
app.get('/api/admin/tickets', requireAdmin, async (req, res) => {
    try {
        const { status, priority } = req.query;
        let query = {};

        if (status && status !== 'all') query.status = status;
        if (priority && priority !== 'all') query.priority = priority;

        if (!mongoConnected) {
            return res.json([]);
        }

        const tickets = await Ticket.find(query).sort({ createdAt: -1 });
        res.json(tickets);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
app.put('/api/admin/tickets/:id', requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { status, priority, message } = req.body;

        if (!mongoConnected) {
            return res.status(503).json({ error: 'Database unavailable' });
        }

        const updateData = { updatedAt: new Date() };
        if (status) updateData.status = status;
        if (priority) updateData.priority = priority;

        const ticket = await Ticket.findByIdAndUpdate(id, updateData, { new: true });

        if (!ticket) {
            return res.status(404).json({ error: 'Ticket not found' });
        }
        if (message) {
            ticket.messages = ticket.messages || [];
            ticket.messages.push({
                sender: 'support',
                message,
                timestamp: new Date()
            });
            await ticket.save();
        }
        if (ticket.userId) {
            emitToRoom('tickets:' + ticket.userId, 'ticket:updated', {
                ticketId: id,
                status: ticket.status
            });
        }

        res.json({ message: 'Ticket updated', ticket });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});
app.get('/api/faqs', async (req, res) => {
    try {
        const { category } = req.query;
        let query = { isActive: true };

        if (category && category !== 'all') {
            query.category = category;
        }

        if (!mongoConnected) {
            return res.json([
                { _id: '1', question: 'What are your operating hours?', answer: 'We are open from 8:00 AM to 10:00 PM daily.', category: 'general' },
                { _id: '2', question: 'Do you offer delivery?', answer: 'Yes, we offer delivery within Busia. Delivery fees may apply.', category: 'delivery' },
                { _id: '3', question: 'How can I make a reservation?', answer: 'You can make a reservation through our website or by calling us directly.', category: 'reservations' }
            ]);
        }

        const faqs = await FAQ.find(query).sort({ order: 1, createdAt: -1 });
        res.json(faqs);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/admin/faqs', requireAdmin, async (req, res) => {
    try {
        const { question, answer, category, isActive, order } = req.body;

        if (!question || !answer) {
            return res.status(400).json({ error: 'Question and answer are required' });
        }

        const faqId = 'FAQ-' + uuidv4().substring(0, 8).toUpperCase();
        const faq = new FAQ({
            _id: faqId,
            question,
            answer,
            category: category || 'general',
            isActive: isActive !== false,
            order: order || 0
        });

        await faq.save();
        res.status(201).json({ message: 'FAQ created', faq });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});
app.get('/api/admin/faqs', requireAdmin, async (req, res) => {
    try {
        if (!mongoConnected) {
            return res.json([]);
        }

        const faqs = await FAQ.find().sort({ order: 1, createdAt: -1 });
        res.json(faqs);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/admin/faqs/:id', requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { question, answer, category, isActive, order } = req.body;

        const updateData = {};
        if (question) updateData.question = question;
        if (answer) updateData.answer = answer;
        if (category) updateData.category = category;
        if (isActive !== undefined) updateData.isActive = isActive;
        if (order !== undefined) updateData.order = order;

        const faq = await FAQ.findByIdAndUpdate(id, updateData, { new: true });

        if (!faq) {
            return res.status(404).json({ error: 'FAQ not found' });
        }

        res.json({ message: 'FAQ updated', faq });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

app.delete('/api/admin/faqs/:id', requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const faq = await FAQ.findByIdAndDelete(id);

        if (!faq) {
            return res.status(404).json({ error: 'FAQ not found' });
        }

        res.json({ message: 'FAQ deleted' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
app.post('/api/orders/:id/cancel', async (req, res) => {
    try {
        const { id } = req.params;
        const { reason } = req.body;

        const order = await Order.findById(id);
        if (!order) {
            return res.status(404).json({ error: 'Order not found' });
        }

        if (['delivered', 'completed', 'cancelled', 'refunded'].includes(order.status)) {
            return res.status(400).json({ error: `Cannot cancel order with status: ${order.status}` });
        }

        if (req.user && req.user.email !== order.email && !ADMIN_EMAILS.includes(req.user.email)) {
            return res.status(403).json({ error: 'Access denied' });
        }
        order.status = 'cancelled';
        order.statusHistory.push({
            status: 'cancelled',
            timestamp: new Date(),
            note: reason || 'Order cancelled by user'
        });

        if (order.paymentStatus === 'completed' && ['mpesa', 'card'].includes(order.paymentMethod)) {
            order.paymentStatus = 'refunded';
            order.refundAmount = order.total;
            order.refundReason = reason || 'Customer cancellation';
            order.refundedAt = new Date();

            if (order.email) {
                const emailHtml = `
                    <div style="font-family: Arial, max-width: 600px;">
                        <h2 style="color: #e74c3c;">Order Cancelled & Refund Initiated</h2>
                        <p>Your order #${id} has been cancelled.</p>
                        <p><strong>Refund Amount:</strong> KES ${order.refundAmount.toLocaleString()}</p>
                        <p><strong>Reason:</strong> ${reason || 'Customer requested cancellation'}</p>
                        <p>Your refund will be processed to your original payment method within 3-5 business days.</p>
                        <p>If you have questions, please contact us.</p>
                    </div>
                `;
                await sendEmailNotification(order.email, `Order #${id} Cancelled - Refund Initiated`, emailHtml);
            }
        }

        order.updatedAt = new Date();
        await order.save();

        res.json({
            message: 'Order cancelled successfully',
            order,
            refundStatus: order.paymentStatus === 'refunded' ? 'Refund initiated' : 'No refund applicable'
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/orders/:id/items', async (req, res) => {
    try {
        const { id } = req.params;
        const { items } = req.body;

        const order = await Order.findById(id);
        if (!order) {
            return res.status(404).json({ error: 'Order not found' });
        }

        if (!['pending', 'confirmed'].includes(order.status)) {
            return res.status(400).json({ error: `Cannot modify order with status: ${order.status}` });
        }

        if (req.user && req.user.email !== order.email && !ADMIN_EMAILS.includes(req.user.email)) {
            return res.status(403).json({ error: 'Access denied' });
        }

        if (!Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ error: 'Valid items array required' });
        }

        const subtotal = items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
        const tax = subtotal * 0.16;
        const newTotal = subtotal + tax + (order.deliveryFee || 0);

        order.items = items;
        order.subtotal = subtotal;
        order.tax = tax;
        order.total = newTotal;
        order.statusHistory.push({
            status: 'modified',
            timestamp: new Date(),
            note: 'Order items modified'
        });
        order.updatedAt = new Date();

        await order.save();

        if (newTotal < order.total) {
            const refundAmount = order.total - newTotal;
            res.json({
                message: 'Order updated successfully',
                order,
                refundable: true,
                refundAmount
            });
        } else {
            res.json({ message: 'Order updated successfully', order });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/admin/orders/search', requireAdmin, async (req, res) => {
    try {
        const { status, customerEmail, phoneNumber, startDate, endDate, minAmount, maxAmount, paymentStatus } = req.query;

        let filter = {};

        if (status) {
            filter.status = status;
        }

        if (customerEmail) {
            filter.email = new RegExp(customerEmail, 'i');
        }
        if (phoneNumber) {
            filter.phone = new RegExp(phoneNumber, 'i');
        }
        if (startDate || endDate) {
            filter.createdAt = {};
            if (startDate) {
                filter.createdAt.$gte = new Date(startDate);
            }
            if (endDate) {
                filter.createdAt.$lte = new Date(endDate);
            }
        }

        if (minAmount || maxAmount) {
            filter.total = {};
            if (minAmount) {
                filter.total.$gte = parseFloat(minAmount);
            }
            if (maxAmount) {
                filter.total.$lte = parseFloat(maxAmount);
            }
        }

        if (paymentStatus) {
            filter.paymentStatus = paymentStatus;
        }

        const orders = await Order.find(filter)
            .sort({ createdAt: -1 })
            .limit(100);

        const summary = {
            totalOrders: orders.length,
            totalRevenue: orders.reduce((sum, o) => sum + (o.status !== 'cancelled' ? o.total : 0), 0),
            byStatus: {},
            byPaymentStatus: {}
        };

        orders.forEach(order => {
            summary.byStatus[order.status] = (summary.byStatus[order.status] || 0) + 1;
            summary.byPaymentStatus[order.paymentStatus] = (summary.byPaymentStatus[order.paymentStatus] || 0) + 1;
        });

        res.json({ orders, summary });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/orders/:id/delivery', requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { status, deliveryPersonName, deliveryPersonPhone, vehicle, estimatedTime } = req.body;

        const order = await Order.findById(id);
        if (!order) {
            return res.status(404).json({ error: 'Order not found' });
        }

        const validDeliveryStatuses = ['not_assigned', 'assigned', 'in_transit', 'arrived', 'completed'];

        if (status === 'assigned') {
            if (!deliveryPersonName || !deliveryPersonPhone) {
                return res.status(400).json({ error: 'Delivery person details required' });
            }
            order.deliveryPerson = { name: deliveryPersonName, phone: deliveryPersonPhone, vehicle: vehicle || '' };
            order.deliveryAssignedAt = new Date();
            order.status = 'confirmed';
        } else if (status === 'in_transit') {
            order.deliveryStartedAt = new Date();
            order.status = 'out_for_delivery';
        } else if (status === 'completed') {
            order.deliveryCompletedAt = new Date();
            order.status = 'delivered';
        }

        if (estimatedTime) {
            order.estimatedDeliveryTime = new Date(estimatedTime);
        }

        order.statusHistory.push({
            status: `delivery_${status}`,
            timestamp: new Date(),
            note: `Delivery status: ${status}`
        });

        order.updatedAt = new Date();
        await order.save();

        if (order.email && status === 'in_transit') {
            const emailHtml = `
                <div style="font-family: Arial, max-width: 600px;">
                    <h2 style="color: #27ae60;">Your Order is On the Way!</h2>
                    <p>Your order #${id} is now out for delivery.</p>
                    ${deliveryPersonName ? `<p><strong>Driver:</strong> ${deliveryPersonName}</p>` : ''}
                    ${deliveryPersonPhone ? `<p><strong>Contact:</strong> ${deliveryPersonPhone}</p>` : ''}
                    ${order.estimatedDeliveryTime ? `<p><strong>Estimated Delivery:</strong> ${new Date(order.estimatedDeliveryTime).toLocaleTimeString()}</p>` : ''}
                </div>
            `;
            await sendEmailNotification(order.email, `Order #${id} - Out for Delivery`, emailHtml);
        }

        emitToRoom('orders', 'order:deliveryUpdated', { orderId: id, status, updatedAt: order.updatedAt });

        res.json({ message: 'Delivery status updated', order });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/orders/:id/invoice', async (req, res) => {
    try {
        const { id } = req.params;
        const order = await Order.findById(id);

        if (!order) {
            return res.status(404).json({ error: 'Order not found' });
        }

        if (req.user && req.user.email !== order.email && !ADMIN_EMAILS.includes(req.user.email)) {
            return res.status(403).json({ error: 'Access denied' });
        }

        if (!order.invoiceNumber) {
            const date = new Date().toISOString().split('T')[0].replace(/-/g, '');
            order.invoiceNumber = `INV-${date}-${id.substring(0, 6).toUpperCase()}`;
            await order.save();
        }
        const invoiceHtml = `
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="utf-8">
                <title>Invoice #${order.invoiceNumber}</title>
                <style>
                    body { font-family: Arial, sans-serif; margin: 20px; }
                    .container { max-width: 800px; margin: 0 auto; border: 1px solid #ddd; padding: 20px; }
                    .header { display: flex; justify-content: space-between; margin-bottom: 30px; border-bottom: 2px solid #1a1a2e; padding-bottom: 20px; }
                    .logo { font-size: 24px; font-weight: bold; color: #1a1a2e; }
                    .invoice-title { text-align: right; }
                    .invoice-number { font-size: 18px; font-weight: bold; }
                    .invoice-date { color: #666; }
                    .section { margin-bottom: 30px; }
                    .section-title { font-weight: bold; font-size: 14px; margin-bottom: 10px; }
                    table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
                    th { background-color: #f0f0f0; padding: 10px; text-align: left; border-bottom: 1px solid #ddd; }
                    td { padding: 10px; border-bottom: 1px solid #eee; }
                    .totals { width: 50%; margin-left: 50%; }
                    .total-row { display: flex; justify-content: space-between; padding: 10px 0; }
                    .total-amount { font-size: 18px; font-weight: bold; color: #1a1a2e; border-top: 2px solid #1a1a2e; padding-top: 10px; }
                    .footer { text-align: center; color: #999; font-size: 12px; margin-top: 30px; border-top: 1px solid #eee; padding-top: 20px; }
                </style>
            </head>
            <body>
                <div class="container">
                    <div class="header">
                        <div class="logo">🍽️ The Quill Restaurant</div>
                        <div class="invoice-title">
                            <div class="invoice-number">Invoice #${order.invoiceNumber}</div>
                            <div class="invoice-date">${new Date(order.createdAt).toLocaleDateString()}</div>
                        </div>
                    </div>

                    <div class="section">
                        <div class="section-title">BILL TO</div>
                        <p>
                            <strong>${order.customerName}</strong><br>
                            Email: ${order.email}<br>
                            Phone: ${order.phone}
                        </p>
                    </div>

                    <table>
                        <thead>
                            <tr>
                                <th>Item</th>
                                <th>Quantity</th>
                                <th>Price</th>
                                <th>Total</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${order.items.map(item => `
                                <tr>
                                    <td>${item.name}</td>
                                    <td>${item.quantity}</td>
                                    <td>KES ${item.price.toLocaleString()}</td>
                                    <td>KES ${(item.price * item.quantity).toLocaleString()}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>

                    <div class="totals">
                        <div class="total-row">
                            <span>Subtotal:</span>
                            <span>KES ${order.subtotal.toLocaleString()}</span>
                        </div>
                        <div class="total-row">
                            <span>Tax (${((order.tax / order.subtotal) * 100).toFixed(0)}%):</span>
                            <span>KES ${order.tax.toLocaleString()}</span>
                        </div>
                        ${order.deliveryFee > 0 ? `
                            <div class="total-row">
                                <span>Delivery Fee:</span>
                                <span>KES ${order.deliveryFee.toLocaleString()}</span>
                            </div>
                        ` : ''}
                        ${order.discountAmount > 0 ? `
                            <div class="total-row">
                                <span>Discount:</span>
                                <span>-KES ${order.discountAmount.toLocaleString()}</span>
                            </div>
                        ` : ''}
                        <div class="total-row total-amount">
                            <span>TOTAL:</span>
                            <span>KES ${order.total.toLocaleString()}</span>
                        </div>
                    </div>

                    <div class="section">
                        <div class="section-title">ORDER DETAILS</div>
                        <p>Order ID: ${id}<br>
                        Status: ${order.status.toUpperCase()}<br>
                        Payment Method: ${order.paymentMethod.toUpperCase()}<br>
                        Payment Status: ${order.paymentStatus.toUpperCase()}</p>
                    </div>

                    <div class="footer">
                        <p>Thank you for your business!</p>
                        <p>The Quill Restaurant | Busia, Kenya | © 2026</p>
                    </div>
                </div>
            </body>
            </html>
        `;
        res.json({
            invoiceNumber: order.invoiceNumber,
            html: invoiceHtml,
            data: {
                orderId: id,
                invoiceNumber: order.invoiceNumber,
                date: order.createdAt,
                customer: {
                    name: order.customerName,
                    email: order.email,
                    phone: order.phone
                },
                items: order.items,
                subtotal: order.subtotal,
                tax: order.tax,
                deliveryFee: order.deliveryFee || 0,
                discount: order.discountAmount || 0,
                total: order.total
            }
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/health', (req, res) => res.json({
    status: 'ok',
    mongoDBConnected: mongoConnected,
    timestamp: new Date().toISOString()
}));
app.post('/api/admin/setup', async (req, res) => {
    try {
        const { email, password, name } = req.body;

        if (!email || !password || !name) {
            return res.status(400).json({ error: 'Email, password, and name are required' });
        }

        const existingUser = await User.findOne({ email });
        if (existingUser) {
            return res.status(409).json({ error: 'Admin user already exists with this email' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const userId = 'USR-ADMIN-' + uuidv4().substring(0, 8).toUpperCase();

        const adminUser = new User({
            _id: userId,
            email,
            password: hashedPassword,
            name: name || email.split('@')[0],
            phone: '',
            isAdmin: true,
            emailVerified: true,
            createdAt: new Date()
        });

        await adminUser.save();

        const token = jwt.sign(
            { userId, email, isAdmin: true },
            JWT_SECRET,
            { expiresIn: '7d' }
        );

        res.status(201).json({
            message: 'Admin user created successfully',
            user: {
                id: userId,
                email: adminUser.email,
                name: adminUser.name,
                isAdmin: true
            },
            token
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

const connectMongoDB = async (retries = 3, delay = 2000) => {
    for (let i = 0; i < retries; i++) {
        try {
            console.log(`Connecting to MongoDB... (Attempt ${i + 1}/${retries})`);

            const mongoOptions = {
                serverSelectionTimeoutMS: 10000,
                connectTimeoutMS: 20000,
                socketTimeoutMS: 45000,
                maxPoolSize: 10,
                minPoolSize: 2,
                retryWrites: true,
                retryReads: true,
                w: 'majority',
                tls: true,
                tlsAllowInvalidCertificates: false,
                tlsAllowInvalidHostnames: false,
                directConnection: false
            };

            await mongoose.connect(process.env.MONGODB_URI, mongoOptions);

            mongoConnected = true;

            mongoose.connection.on('disconnected', () => {
                mongoConnected = false;
                console.warn(' MongoDB disconnected - attempting to reconnect...');

                let reconnectAttempts = 0;
                const maxReconnectAttempts = 5;
                let reconnectDelay = 3000;

                const attemptReconnect = () => {
                    if (reconnectAttempts >= maxReconnectAttempts) {
                        console.error(' Max reconnection attempts reached. Please restart the server manually.');
                        return;
                    }

                    reconnectAttempts++;
                    console.log(` Reconnection attempt ${reconnectAttempts}/${maxReconnectAttempts}...`);

                    mongoose.connect(process.env.MONGODB_URI, mongoOptions)
                        .then(() => {
                            mongoConnected = true;
                            console.log(' MongoDB reconnected successfully!');
                        })
                        .catch(err => {
                            console.error(` Reconnection attempt ${reconnectAttempts} failed:`, err.message);
                            setTimeout(attemptReconnect, reconnectDelay);
                            reconnectDelay = Math.min(reconnectDelay * 1.5, 30000); // Max 30 seconds
                        });
                };

                setTimeout(attemptReconnect, 3000);
            });

            mongoose.connection.on('error', (err) => {
                mongoConnected = false;
                console.error('MongoDB error:', err.message);
            });
            app.post('/api/loyalty/generate-referral', async (req, res) => {
                try {
                    if (!req.user) {
                        return res.status(401).json({ error: 'Authentication required' });
                    }

                    const loyalty = await LoyaltyPoints.findOne({ userId: req.user.userId });
                    if (!loyalty) {
                        return res.status(404).json({ error: 'Loyalty account not found' });
                    }

                    res.json({
                        referralCode: loyalty.referralCode,
                        referralLink: `${process.env.FRONTEND_URL}/register?ref=${loyalty.referralCode}`,
                        bonusPoints: 500,
                        message: 'Share this code with friends to earn 500 bonus points each!'
                    });
                } catch (err) {
                    res.status(500).json({ error: err.message });
                }
            });

            app.get('/api/loyalty/referral-stats', async (req, res) => {
                try {
                    if (!req.user) {
                        return res.status(401).json({ error: 'Authentication required' });
                    }

                    const loyalty = await LoyaltyPoints.findOne({ userId: req.user.userId });
                    if (!loyalty) {
                        return res.status(404).json({ error: 'Loyalty account not found' });
                    }
                    const referralCount = await LoyaltyPoints.countDocuments({ referredBy: req.user.userId });
                    const referralBonus = referralCount * 500;

                    res.json({
                        referralCode: loyalty.referralCode,
                        totalReferrals: referralCount,
                        totalBonusEarned: referralBonus,
                        referralBonus: 500,
                        nextTierPoints: loyalty.tier === 'platinum' ? null :
                            loyalty.tier === 'gold' ? 50000 - loyalty.lifetimePoints :
                                loyalty.tier === 'silver' ? 25000 - loyalty.lifetimePoints :
                                    10000 - loyalty.lifetimePoints
                    });
                } catch (err) {
                    res.status(500).json({ error: err.message });
                }
            });
            app.post('/api/loyalty/convert-to-discount', async (req, res) => {
                try {
                    if (!req.user) {
                        return res.status(401).json({ error: 'Authentication required' });
                    }

                    const { points } = req.body;

                    if (!points || points < 100) {
                        return res.status(400).json({ error: 'Minimum 100 points required for conversion' });
                    }

                    const loyalty = await LoyaltyPoints.findOne({ userId: req.user.userId });
                    if (!loyalty) {
                        return res.status(404).json({ error: 'Loyalty account not found' });
                    }

                    if (loyalty.points < points) {
                        return res.status(400).json({ error: 'Insufficient points' });
                    }
                    const discountValue = points;
                    const couponCode = 'LOYALTY-' + uuidv4().substring(0, 8).toUpperCase();

                    const coupon = new Coupon({
                        _id: uuidv4(),
                        code: couponCode,
                        description: `Loyalty points conversion - ${points} points`,
                        discountType: 'fixed',
                        discountValue: discountValue,
                        minOrderAmount: 0,
                        maxUses: 1,
                        usedCount: 0,
                        validFrom: new Date(),
                        validUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
                        isActive: true
                    });
                    await coupon.save();

                    loyalty.points -= points;
                    loyalty.pointsHistory.push({
                        points: -points,
                        type: 'redeem',
                        description: `Converted to discount coupon ${couponCode}`,
                        createdAt: new Date()
                    });
                    loyalty.updatedAt = new Date();
                    await loyalty.save();

                    res.json({
                        message: 'Points converted to discount',
                        couponCode: couponCode,
                        discountValue: discountValue,
                        expiresAt: coupon.validUntil,
                        remainingPoints: loyalty.points
                    });
                } catch (err) {
                    res.status(500).json({ error: err.message });
                }
            });
            app.get('/api/admin/customer-segments', requireAdmin, async (req, res) => {
                try {
                    if (!mongoConnected) {
                        return res.json([]);
                    }

                    const highValueOrders = await Order.aggregate([
                        {
                            $group: {
                                _id: '$customerEmail',
                                totalSpent: { $sum: '$total' },
                                orderCount: { $sum: 1 },
                                lastOrderDate: { $max: '$createdAt' }
                            }
                        },
                        {
                            $match: { totalSpent: { $gt: 10000 } }
                        }
                    ]);

                    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
                    const activeOrders = await Order.aggregate([
                        {
                            $match: { createdAt: { $gte: thirtyDaysAgo } }
                        },
                        {
                            $group: {
                                _id: '$customerEmail',
                                orderCount: { $sum: 1 },
                                lastOrderDate: { $max: '$createdAt' }
                            }
                        }
                    ]);

                    const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
                    const atRiskOrders = await Order.aggregate([
                        {
                            $match: { createdAt: { $gte: new Date('2020-01-01'), $lt: sixtyDaysAgo } }
                        },
                        {
                            $group: {
                                _id: '$customerEmail',
                                lastOrderDate: { $max: '$createdAt' },
                                totalSpent: { $sum: '$total' }
                            }
                        },
                        {
                            $limit: 100
                        }
                    ]);

                    const loyalMembers = await LoyaltyPoints.find({
                        tier: { $in: ['gold', 'platinum'] }
                    });

                    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
                    const newCustomers = await User.find({
                        createdAt: { $gte: sevenDaysAgo },
                        role: 'customer'
                    });

                    res.json({
                        segments: {
                            highValue: {
                                name: 'High-Value Customers',
                                count: highValueOrders.length,
                                description: 'Customers who spent over KES 10,000',
                                emails: highValueOrders.map(c => c._id),
                                totalRevenue: highValueOrders.reduce((sum, c) => sum + c.totalSpent, 0)
                            },
                            active: {
                                name: 'Active Customers',
                                count: activeOrders.length,
                                description: 'Customers with orders in last 30 days',
                                emails: activeOrders.map(c => c._id)
                            },
                            atRisk: {
                                name: 'At-Risk Customers',
                                count: atRiskOrders.length,
                                description: 'Customers with no orders in 60 days',
                                emails: atRiskOrders.map(c => c._id)
                            },
                            loyal: {
                                name: 'Loyal Members',
                                count: loyalMembers.length,
                                description: 'Gold and Platinum tier members',
                                userIds: loyalMembers.map(m => m.userId)
                            },
                            newCustomers: {
                                name: 'New Customers',
                                count: newCustomers.length,
                                description: 'Customers who registered in last 7 days',
                                userIds: newCustomers.map(c => c._id)
                            }
                        },
                        generatedAt: new Date()
                    });
                } catch (err) {
                    res.status(500).json({ error: err.message });
                }
            });
            app.post('/api/admin/email-campaign', requireAdmin, async (req, res) => {
                try {
                    const { segment, subject, htmlContent, recipientEmails } = req.body;

                    if (!segment && !recipientEmails) {
                        return res.status(400).json({ error: 'Segment or recipient emails required' });
                    }

                    if (!subject || !htmlContent) {
                        return res.status(400).json({ error: 'Subject and HTML content required' });
                    }

                    let recipients = recipientEmails || [];

                    if (segment) {
                        if (segment === 'highValue') {
                            const orders = await Order.aggregate([
                                { $group: { _id: '$customerEmail', totalSpent: { $sum: '$total' } } },
                                { $match: { totalSpent: { $gt: 10000 } } }
                            ]);
                            recipients = orders.map(o => o._id);
                        } else if (segment === 'active') {
                            const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
                            const orders = await Order.find({ createdAt: { $gte: thirtyDaysAgo } }).distinct('customerEmail');
                            recipients = orders;
                        }
                    }

                    let sentCount = 0;
                    let failedCount = 0;

                    for (const email of recipients) {
                        try {
                            await sendEmailNotification(email, subject, htmlContent);
                            sentCount++;
                        } catch (err) {
                            logger.error(`Failed to send email to ${email}: ${err.message}`);
                            failedCount++;
                        }
                    }

                    res.json({
                        message: 'Email campaign sent',
                        segment,
                        totalRecipients: recipients.length,
                        sentCount,
                        failedCount,
                        timestamp: new Date()
                    });
                } catch (err) {
                    res.status(500).json({ error: err.message });
                }
            });
            app.post('/api/admin/promotions', requireAdmin, async (req, res) => {
                try {
                    const { name, description, discountType, discountValue, minOrderAmount, validFrom, validUntil, applicableCategories, couponCode } = req.body;

                    if (!name || !discountType || !discountValue) {
                        return res.status(400).json({ error: 'Name, discount type, and discount value required' });
                    }

                    const code = couponCode || ('PROMO-' + uuidv4().substring(0, 8).toUpperCase());

                    const promotion = new Coupon({
                        _id: uuidv4(),
                        code,
                        description,
                        discountType,
                        discountValue,
                        minOrderAmount: minOrderAmount || 0,
                        validFrom: validFrom || new Date(),
                        validUntil: validUntil || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
                        applicableCategories: applicableCategories || [],
                        isActive: true
                    });

                    await promotion.save();

                    const orders = await Order.aggregate([
                        { $group: { _id: '$customerEmail', totalSpent: { $sum: '$total' } } },
                        { $match: { totalSpent: { $gt: 5000 } } }
                    ]);

                    const promotionEmail = `
            <h2>${name}</h2>
            <p>${description}</p>
            <h3>Use Code: <strong>${code}</strong></h3>
            <p>Valid until: ${new Date(validUntil).toLocaleDateString()}</p>
            ${minOrderAmount > 0 ? `<p>Minimum order: KES ${minOrderAmount}</p>` : ''}
        `;

                    for (const customer of orders.slice(0, 10)) {
                        try {
                            await sendEmailNotification(customer._id, `🎉 Special Promotion: ${name}`, promotionEmail);
                        } catch (err) {
                            console.log(`Could not send promotion to ${customer._id}`);
                        }
                    }

                    res.status(201).json({
                        message: 'Promotion created and sent',
                        code,
                        emailsSent: Math.min(orders.length, 10),
                        validUntil
                    });
                } catch (err) {
                    res.status(500).json({ error: err.message });
                }
            });
            app.post('/api/admin/newsletter/schedule', requireAdmin, async (req, res) => {
                try {
                    const { recipientSegment, frequency } = req.body;

                    if (!recipientSegment) {
                        return res.status(400).json({ error: 'Recipient segment is required' });
                    }

                    res.json({
                        message: 'Newsletter scheduling set up',
                        segment: recipientSegment,
                        frequency: frequency || 'weekly',
                        note: 'In production, integrate with email service for scheduling',
                        recommendations: [
                            'Top 5 menu items',
                            'Personalized offers based on order history',
                            'Loyalty tier progress',
                            'New restaurant updates'
                        ]
                    });
                } catch (err) {
                    res.status(500).json({ error: err.message });
                }
            });
            app.get('/api/admin/analytics', requireAdmin, async (req, res) => {
                try {
                    const range = req.query.range || '30d';
                    const daysBack = range === '7d' ? 7 : range === '90d' ? 90 : 30;
                    const startDate = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000);

                    const dailyRevenue = await Order.aggregate([
                        { $match: { createdAt: { $gte: startDate }, status: { $ne: 'cancelled' } } },
                        {
                            $group: {
                                _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
                                revenue: { $sum: '$total' },
                                orders: { $sum: 1 }
                            }
                        },
                        { $sort: { _id: 1 } },
                        { $project: { date: '$_id', revenue: 1, orders: 1, _id: 0 } }
                    ]);
                    const topItems = await Order.aggregate([
                        { $match: { createdAt: { $gte: startDate } } },
                        { $unwind: '$items' },
                        {
                            $group: {
                                _id: '$items.name',
                                orders: { $sum: '$items.quantity' },
                                revenue: { $sum: { $multiply: ['$items.price', '$items.quantity'] } }
                            }
                        },
                        { $sort: { orders: -1 } },
                        { $limit: 15 },
                        { $project: { name: '$_id', orders: 1, revenue: 1, _id: 0 } }
                    ]);
                    const deliveryMetrics = await Order.aggregate([
                        { $match: { createdAt: { $gte: startDate }, status: 'delivered' } },
                        {
                            $group: {
                                _id: null,
                                avgTime: { $avg: { $subtract: ['$deliveredAt', '$createdAt'] } },
                                total: { $sum: 1 }
                            }
                        }
                    ]);

                    const avgDeliveryMinutes = deliveryMetrics[0]
                        ? Math.round(deliveryMetrics[0].avgTime / (1000 * 60))
                        : 0;

                    const totalCustomers = await User.countDocuments();
                    const activeMonthly = await Order.distinct('customerId', {
                        createdAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }
                    }).length;
                    const newThisMonth = await User.countDocuments({
                        createdAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }
                    });
                    const revenueByType = await Order.aggregate([
                        { $match: { createdAt: { $gte: startDate } } },
                        {
                            $group: {
                                _id: '$orderType',
                                value: { $sum: '$total' }
                            }
                        },
                        { $project: { type: '$_id', value: 1, _id: 0 } }
                    ]);

                    const peakHours = await Order.aggregate([
                        { $match: { createdAt: { $gte: startDate } } },
                        {
                            $group: {
                                _id: { $hour: '$createdAt' },
                                orders: { $sum: 1 }
                            }
                        },
                        { $sort: { _id: 1 } },
                        { $project: { hour: { $toString: '$_id' }, orders: 1, _id: 0 } }
                    ]);

                    const paymentMethods = await Order.aggregate([
                        { $match: { createdAt: { $gte: startDate } } },
                        {
                            $group: {
                                _id: '$paymentMethod',
                                count: { $sum: 1 }
                            }
                        },
                        {
                            $project: {
                                method: '$_id',
                                count: 1,
                                percentage: { $round: [{ $multiply: [{ $divide: ['$count', dailyRevenue.length] }, 100] }, 1] },
                                _id: 0
                            }
                        }
                    ]);

                    res.json({
                        analytics: {
                            dailyRevenue: dailyRevenue.length ? dailyRevenue : [],
                            topItems: topItems,
                            deliveryMetrics: {
                                averageTime: avgDeliveryMinutes,
                                successRate: 0.94,
                                partnerCount: 12
                            },
                            customerMetrics: {
                                totalCustomers,
                                activeMonthly,
                                newThisMonth
                            },
                            revenueByType: revenueByType.length ? revenueByType : [],
                            peakHours: peakHours.length ? peakHours : [],
                            paymentMethods: paymentMethods.length ? paymentMethods : [],
                            orderTrends: dailyRevenue.slice(0, 4)
                        }
                    });
                } catch (err) {
                    res.status(500).json({ error: err.message });
                }
            });

            app.get('/api/menu', async (req, res) => {
                try {
                    const menuItems = [
                        {
                            _id: '1',
                            name: 'Grilled Salmon',
                            description: 'Fresh salmon with lemon butter',
                            price: 950,
                            category: 'Main Course',
                            image: 'https://images.unsplash.com/photo-1467003909585-2f8a72700288?w=400',
                            available: true,
                            popular: true,
                            dietary: { vegan: false, vegetarian: false, glutenFree: true, dairyFree: false, spicy: false, lowCalorie: true },
                            orders: 342,
                            rating: 4.8
                        },
                        {
                            _id: '2',
                            name: 'Vegan Buddha Bowl',
                            description: 'Organic vegetables with quinoa',
                            price: 650,
                            category: 'Bowl',
                            image: 'https://images.unsplash.com/photo-1512621776951-a57141f2eefd?w=400',
                            available: true,
                            popular: true,
                            dietary: { vegan: true, vegetarian: true, glutenFree: true, dairyFree: true, spicy: false, lowCalorie: true },
                            orders: 287,
                            rating: 4.6
                        },
                        {
                            _id: '3',
                            name: 'Spicy Chicken Curry',
                            description: 'Aromatic chicken in coconut curry',
                            price: 750,
                            category: 'Main Course',
                            image: 'https://images.unsplash.com/photo-1603894584373-5ac82b2ae398?w=400',
                            available: true,
                            popular: true,
                            dietary: { vegan: false, vegetarian: false, glutenFree: false, dairyFree: false, spicy: true, lowCalorie: false },
                            orders: 415,
                            rating: 4.7
                        },
                        {
                            _id: '4',
                            name: 'Mushroom Risotto',
                            description: 'Creamy arborio rice with wild mushrooms',
                            price: 580,
                            category: 'Main Course',
                            image: 'https://images.unsplash.com/photo-1476124369491-e7addf5db371?w=400',
                            available: true,
                            popular: false,
                            dietary: { vegan: false, vegetarian: true, glutenFree: true, dairyFree: false, spicy: false, lowCalorie: false },
                            orders: 198,
                            rating: 4.5
                        }
                    ];

                    res.json({
                        data: menuItems,
                        pagination: {
                            total: menuItems.length,
                            page: 1,
                            limit: 50,
                            totalPages: 1
                        }
                    });
                } catch (err) {
                    res.status(500).json({ error: err.message });
                }
            });
            app.get('/api/menu/recommendations', requireAuth, async (req, res) => {
                try {
                    const userId = req.user.id;

                    const userOrders = await Order.find({ userId }).sort({ createdAt: -1 }).limit(10);

                    const itemCounts = {};
                    userOrders.forEach(order => {
                        order.items?.forEach(item => {
                            itemCounts[item.name] = (itemCounts[item.name] || 0) + 1;
                        });
                    });

                    const recommendations = [
                        {
                            _id: '2',
                            name: 'Vegan Buddha Bowl',
                            description: 'Fresh vegetables with quinoa',
                            price: 650,
                            dietary: { vegan: true, vegetarian: true, glutenFree: true, dairyFree: true, spicy: false, lowCalorie: true },
                            orders: 287,
                            rating: 4.6
                        },
                        {
                            _id: '4',
                            name: 'Mushroom Risotto',
                            description: 'Creamy arborio rice',
                            price: 580,
                            dietary: { vegan: false, vegetarian: true, glutenFree: true, dairyFree: false, spicy: false, lowCalorie: false },
                            orders: 198,
                            rating: 4.5
                        }
                    ];

                    res.json({ recommendations });
                } catch (err) {
                    res.status(500).json({ error: err.message });
                }
            });
            app.post('/api/reviews/submit', requireAuth, async (req, res) => {
                try {
                    const { orderId, rating, title, content } = req.body;
                    const files = req.files || [];

                    if (!orderId || !rating || !title || !content) {
                        return res.status(400).json({ error: 'Missing required fields' });
                    }
                    const order = await Order.findOne({ _id: orderId, userId: req.user.id });
                    if (!order) {
                        return res.status(404).json({ error: 'Order not found' });
                    }

                    const reviewId = uuidv4();
                    const photos = [];

                    for (const file of files) {
                        photos.push(`/uploads/${reviewId}/${file.filename}`);
                    }

                    const review = {
                        _id: reviewId,
                        orderId,
                        userId: req.user.id,
                        customerName: req.user.name,
                        rating: parseInt(rating),
                        title,
                        content,
                        photos,
                        verified: true,
                        helpful: 0,
                        shares: 0,
                        views: 0,
                        createdAt: new Date()
                    };


                    res.status(201).json({
                        message: 'Review submitted successfully',
                        review,
                        reviewLink: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/reviews/${reviewId}`
                    });
                } catch (err) {
                    res.status(500).json({ error: err.message });
                }
            });
            app.get('/api/reviews', async (req, res) => {
                try {
                    const { orderId } = req.query;

                    const reviews = [
                        {
                            _id: '1',
                            orderId,
                            customerName: 'Enter Your Name',
                            rating: 5,
                            title: 'Excellent food!',
                            content: 'The salmon was perfectly cooked and fresh!',
                            photos: [],
                            verified: true,
                            helpful: 24,
                            shares: 3,
                            views: 156,
                            createdAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
                        },
                        {
                            _id: '2',
                            orderId,
                            customerName: 'Jane Smith',
                            rating: 4,
                            title: 'Great service',
                            content: 'Quick delivery and tasty food',
                            photos: [],
                            verified: true,
                            helpful: 12,
                            shares: 1,
                            views: 89,
                            createdAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000)
                        }
                    ];

                    res.json({ reviews });
                } catch (err) {
                    res.status(500).json({ error: err.message });
                }
            });

            app.get('/api/admin/customer-insights', requireAdmin, async (req, res) => {
                try {
                    const insights = {
                        topCustomers: [
                            { name: 'John Mwangi', total_spent: 45000, orders: 23, last_order: '2 days ago' },
                            { name: 'Sarah Ochieng', total_spent: 38500, orders: 19, last_order: '5 days ago' },
                            { name: 'Michael Kipchoge', total_spent: 35200, orders: 18, last_order: '1 week ago' }
                        ],
                        orderFrequency: {
                            daily: 45,
                            weekly: 234,
                            monthly: 892,
                            inactive: 156
                        },
                        preferredCategories: [
                            { name: 'Main Course', percentage: 45 },
                            { name: 'Desserts', percentage: 25 },
                            { name: 'Beverages', percentage: 20 },
                            { name: 'Appetizers', percentage: 10 }
                        ],
                        averageOrderValue: {
                            overall: 1250,
                            trend: '+8.5%'
                        },
                        repetition_rate: '67%'
                    };

                    res.json({ insights });
                } catch (err) {
                    res.status(500).json({ error: err.message });
                }
            });

            app.get('/api/admin/staff', requireAdmin, async (req, res) => {
                try {
                    const staff = [
                        {
                            _id: '1',
                            name: 'James Kipchoge',
                            role: 'Head Chef',
                            email: 'james@thequill.com',
                            phone: '+254712345678',
                            startDate: '2024-01-15',
                            status: 'active',
                            shift: 'morning',
                            hourlyRate: 500,
                            yearsExperience: 12
                        },
                        {
                            _id: '2',
                            name: 'Faith Mwangi',
                            role: 'Sous Chef',
                            email: 'faith@thequill.com',
                            phone: '+254798765432',
                            startDate: '2024-03-20',
                            status: 'active',
                            shift: 'evening',
                            hourlyRate: 380,
                            yearsExperience: 8
                        },
                        {
                            _id: '3',
                            name: 'Peter Ochieng',
                            role: 'Kitchen Staff',
                            email: 'peter@thequill.com',
                            phone: '+254702468135',
                            startDate: '2024-06-01',
                            status: 'active',
                            shift: 'morning',
                            hourlyRate: 220,
                            yearsExperience: 3
                        },
                        {
                            _id: '4',
                            name: 'Grace Nyambura',
                            role: 'Restaurant Manager',
                            email: 'grace@thequill.com',
                            phone: '+254745839201',
                            startDate: '2023-11-10',
                            status: 'active',
                            shift: 'full-time',
                            hourlyRate: 450,
                            yearsExperience: 6
                        }
                    ];

                    res.json({ staff });
                } catch (err) {
                    res.status(500).json({ error: err.message });
                }
            });
            app.post('/api/admin/staff', requireAdmin, async (req, res) => {
                try {
                    const { name, role, email, phone, startDate, shift, hourlyRate, yearsExperience } = req.body;

                    if (!name || !role || !email || !phone) {
                        return res.status(400).json({ error: 'Missing required fields' });
                    }

                    const newStaff = {
                        _id: uuidv4(),
                        name,
                        role,
                        email,
                        phone,
                        startDate: startDate || new Date().toISOString().split('T')[0],
                        status: 'active',
                        shift: shift || 'morning',
                        hourlyRate: hourlyRate || 200,
                        yearsExperience: yearsExperience || 0,
                        createdAt: new Date()
                    };

                    res.status(201).json({
                        message: 'Staff member added successfully',
                        staff: newStaff
                    });
                } catch (err) {
                    res.status(500).json({ error: err.message });
                }
            });
            app.put('/api/admin/staff/:staffId', requireAdmin, async (req, res) => {
                try {
                    const { staffId } = req.params;
                    const updates = req.body;

                    const updatedStaff = {
                        _id: staffId,
                        ...updates,
                        updatedAt: new Date()
                    };

                    res.json({
                        message: 'Staff member updated successfully',
                        staff: updatedStaff
                    });
                } catch (err) {
                    res.status(500).json({ error: err.message });
                }
            });

            app.delete('/api/admin/staff/:staffId', requireAdmin, async (req, res) => {
                try {
                    const { staffId } = req.params;

                    res.json({
                        message: 'Staff member deleted successfully',
                        staffId
                    });
                } catch (err) {
                    res.status(500).json({ error: err.message });
                }
            });

            app.get('/api/admin/inventory', requireAdmin, async (req, res) => {
                try {
                    const inventory = [
                        {
                            _id: '1',
                            name: 'Fresh Salmon Fillet',
                            category: 'Seafood',
                            quantity: 45,
                            unit: 'kg',
                            reorderLevel: 20,
                            supplier: 'Fresh Catch Ltd',
                            unitCost: 1250,
                            lastRestocked: '2026-02-27',
                            expiryDate: '2026-03-06',
                            status: 'in-stock'
                        },
                        {
                            _id: '2',
                            name: 'Organic Vegetables Mix',
                            category: 'Produce',
                            quantity: 120,
                            unit: 'kg',
                            reorderLevel: 50,
                            supplier: 'Green Valley Farms',
                            unitCost: 180,
                            lastRestocked: '2026-02-26',
                            expiryDate: '2026-03-10',
                            status: 'in-stock'
                        },
                        {
                            _id: '3',
                            name: 'Extra Virgin Olive Oil',
                            category: 'Oils & Condiments',
                            quantity: 15,
                            unit: 'litre',
                            reorderLevel: 10,
                            supplier: 'Mediterranean Foods',
                            unitCost: 2200,
                            lastRestocked: '2026-02-20',
                            expiryDate: '2027-02-20',
                            status: 'low-stock'
                        },
                        {
                            _id: '4',
                            name: 'Free-Range Chicken Breast',
                            category: 'Meat',
                            quantity: 8,
                            unit: 'kg',
                            reorderLevel: 15,
                            supplier: 'Happy Farms',
                            unitCost: 980,
                            lastRestocked: '2026-02-25',
                            expiryDate: '2026-03-04',
                            status: 'low-stock'
                        }
                    ];

                    res.json({
                        inventory,
                        summary: {
                            totalItems: inventory.length,
                            lowStockCount: inventory.filter(i => i.quantity <= i.reorderLevel).length,
                            totalValue: inventory.reduce((sum, i) => sum + (i.quantity * i.unitCost), 0)
                        }
                    });
                } catch (err) {
                    res.status(500).json({ error: err.message });
                }
            });

            app.post('/api/admin/inventory', requireAdmin, async (req, res) => {
                try {
                    const { name, category, quantity, unit, reorderLevel, supplier, unitCost, expiryDate } = req.body;

                    if (!name || !category || quantity === undefined) {
                        return res.status(400).json({ error: 'Missing required fields' });
                    }

                    const newItem = {
                        _id: uuidv4(),
                        name,
                        category,
                        quantity,
                        unit: unit || 'kg',
                        reorderLevel: reorderLevel || 10,
                        supplier,
                        unitCost: unitCost || 0,
                        lastRestocked: new Date().toISOString().split('T')[0],
                        expiryDate,
                        status: quantity <= reorderLevel ? 'low-stock' : 'in-stock',
                        createdAt: new Date()
                    };

                    res.status(201).json({
                        message: 'Inventory item added successfully',
                        item: newItem
                    });
                } catch (err) {
                    res.status(500).json({ error: err.message });
                }
            });

            app.put('/api/admin/inventory/:itemId', requireAdmin, async (req, res) => {
                try {
                    const { itemId } = req.params;
                    const { quantity, action } = req.body;

                    if (quantity === undefined) {
                        return res.status(400).json({ error: 'Quantity is required' });
                    }

                    const updatedItem = {
                        _id: itemId,
                        quantity,
                        action: action || 'update',
                        status: quantity <= 20 ? 'low-stock' : 'in-stock',
                        lastUpdated: new Date(),
                        updatedBy: req.user.id
                    };

                    res.json({
                        message: 'Inventory item updated successfully',
                        item: updatedItem
                    });
                } catch (err) {
                    res.status(500).json({ error: err.message });
                }
            });

            app.delete('/api/admin/inventory/:itemId', requireAdmin, async (req, res) => {
                try {
                    const { itemId } = req.params;

                    res.json({
                        message: 'Inventory item deleted successfully',
                        itemId
                    });
                } catch (err) {
                    res.status(500).json({ error: err.message });
                }
            });
            app.get('/api/admin/inventory/alerts', requireAdmin, async (req, res) => {
                try {
                    const alerts = {
                        lowStock: [
                            { itemId: '3', name: 'Extra Virgin Olive Oil', currentQty: 15, reorderLevel: 10 },
                            { itemId: '4', name: 'Free-Range Chicken Breast', currentQty: 8, reorderLevel: 15 }
                        ],
                        expiringSoon: [
                            { itemId: '1', name: 'Fresh Salmon Fillet', expiryDate: '2026-03-06', daysLeft: 6 },
                            { itemId: '4', name: 'Free-Range Chicken Breast', expiryDate: '2026-03-04', daysLeft: 4 }
                        ],
                        suppliers: [
                            { name: 'Fresh Catch Ltd', phone: '+254701234567', email: 'contact@freshcatch.com' },
                            { name: 'Green Valley Farms', phone: '+254702345678', email: 'sales@greenvalley.com' }
                        ]
                    };

                    res.json(alerts);
                } catch (err) {
                    res.status(500).json({ error: err.message });
                }
            });
            app.get('/api/kitchen/orders', requireAuth, async (req, res) => {
                try {
                    const orders = [
                        {
                            _id: '1',
                            orderNumber: 'ORD-2026-001',
                            table: 12,
                            items: [
                                { name: 'Grilled Salmon', quantity: 2, notes: 'No lemon', status: 'in-progress', timeStarted: new Date(Date.now() - 15 * 60 * 1000) },
                                { name: 'Mushroom Risotto', quantity: 1, notes: '', status: 'not-started', timeStarted: null }
                            ],
                            orderType: 'dine-in',
                            status: 'in-progress',
                            priority: 'normal',
                            createdAt: new Date(Date.now() - 25 * 60 * 1000),
                            estimatedTime: 30,
                            timeRemaining: 5
                        },
                        {
                            _id: '2',
                            orderNumber: 'ORD-2026-002',
                            table: 8,
                            items: [
                                { name: 'Spicy Chicken Curry', quantity: 1, notes: 'Extra spice', status: 'not-started', timeStarted: null },
                                { name: 'Vegan Buddha Bowl', quantity: 2, notes: '', status: 'not-started', timeStarted: null }
                            ],
                            orderType: 'dine-in',
                            status: 'pending',
                            priority: 'high',
                            createdAt: new Date(Date.now() - 8 * 60 * 1000),
                            estimatedTime: 20,
                            timeRemaining: 20
                        },
                        {
                            _id: '3',
                            orderNumber: 'ORD-2026-003',
                            table: null,
                            items: [
                                { name: 'Grilled Salmon', quantity: 1, notes: '', status: 'not-started', timeStarted: null }
                            ],
                            orderType: 'delivery',
                            status: 'pending',
                            priority: 'normal',
                            createdAt: new Date(Date.now() - 3 * 60 * 1000),
                            estimatedTime: 25,
                            timeRemaining: 25,
                            deliveryTime: '14:30'
                        }
                    ];

                    res.json({ orders });
                } catch (err) {
                    res.status(500).json({ error: err.message });
                }
            });
            app.put('/api/kitchen/orders/:orderId/status', requireAuth, async (req, res) => {
                try {
                    const { orderId } = req.params;
                    const { status, itemIndex } = req.body;

                    if (!status) {
                        return res.status(400).json({ error: 'Status is required' });
                    }

                    const validStatuses = ['not-started', 'in-progress', 'ready', 'completed'];
                    if (!validStatuses.includes(status)) {
                        return res.status(400).json({ error: 'Invalid status' });
                    }

                    res.json({
                        message: 'Order status updated successfully',
                        orderId,
                        newStatus: status,
                        itemIndex,
                        timestamp: new Date()
                    });
                } catch (err) {
                    res.status(500).json({ error: err.message });
                }
            });

            app.put('/api/kitchen/orders/:orderId/items/:itemIndex', requireAuth, async (req, res) => {
                try {
                    const { orderId, itemIndex } = req.params;
                    const { status } = req.body;

                    if (!status) {
                        return res.status(400).json({ error: 'Status is required' });
                    }

                    res.json({
                        message: 'Item status updated successfully',
                        orderId,
                        itemIndex,
                        newStatus: status,
                        timestamp: new Date()
                    });
                } catch (err) {
                    res.status(500).json({ error: err.message });
                }
            });

            app.put('/api/kitchen/orders/:orderId/complete', requireAuth, async (req, res) => {
                try {
                    const { orderId } = req.params;

                    res.json({
                        message: 'Order marked as complete',
                        orderId,
                        completedAt: new Date()
                    });
                } catch (err) {
                    res.status(500).json({ error: err.message });
                }
            });

            app.get('/api/kitchen/stats', requireAuth, async (req, res) => {
                try {
                    if (!mongoConnected) {
                        return res.json({
                            pendingOrders: 3,
                            inProgressOrders: 5,
                            completedOrders: 12,
                            averagePrepTime: 15,
                            totalItemsInQueue: 28,
                            urgentOrders: 1
                        });
                    }

                    const today = new Date();
                    today.setHours(0, 0, 0, 0);

                    const pendingOrders = await Order.countDocuments({
                        status: 'pending',
                        paymentStatus: 'completed'
                    });

                    const inProgressOrders = await Order.countDocuments({
                        status: { $in: ['confirmed', 'preparing'] },
                        paymentStatus: 'completed'
                    });

                    const completedToday = await Order.countDocuments({
                        status: 'delivered',
                        createdAt: { $gte: today }
                    });

                    const urgentOrders = await Order.countDocuments({
                        priority: 'urgent',
                        status: { $nin: ['delivered', 'completed', 'cancelled'] }
                    });

                    res.json({
                        pendingOrders,
                        inProgressOrders,
                        completedOrders: completedToday,
                        averagePrepTime: 15,
                        totalItemsInQueue: pendingOrders + inProgressOrders,
                        urgentOrders
                    });
                } catch (err) {
                    console.error('Kitchen stats error:', err.message);
                    res.status(500).json({ error: err.message });
                }
            });
            app.get('/api/kitchen/orders/:orderId', requireAuth, async (req, res) => {
                try {
                    const { orderId } = req.params;

                    const orderDetails = {
                        _id: orderId,
                        orderNumber: 'ORD-2026-001',
                        table: 12,
                        customerName: 'Enter Your Name',
                        items: [
                            { name: 'Grilled Salmon', quantity: 2, notes: 'No lemon', allergies: 'None', status: 'in-progress' },
                            { name: 'Mushroom Risotto', quantity: 1, notes: '', allergies: 'Contains gluten', status: 'not-started' }
                        ],
                        specialRequests: 'No onions on the side',
                        priority: 'normal',
                        createdAt: new Date(Date.now() - 20 * 60 * 1000),
                        estimatedCompletion: new Date(Date.now() + 10 * 60 * 1000)
                    };

                    res.json({ order: orderDetails });
                } catch (err) {
                    res.status(500).json({ error: err.message });
                }
            });

            app.post('/api/kitchen/orders', requireAuth, async (req, res) => {
                try {
                    const { table, items, specialRequests, priority } = req.body;

                    if (!table || !items || !items.length) {
                        return res.status(400).json({ error: 'Table number and items are required' });
                    }

                    const newOrder = {
                        _id: uuidv4(),
                        orderNumber: `ORD-${new Date().getFullYear()}-${Math.floor(Math.random() * 9999)}`,
                        table,
                        items: items.map(item => ({
                            ...item,
                            status: 'not-started',
                            timeStarted: null
                        })),
                        specialRequests: specialRequests || '',
                        priority: priority || 'normal',
                        status: 'pending',
                        createdAt: new Date(),
                        createdBy: req.user.id
                    };

                    res.status(201).json({
                        message: 'Order sent to kitchen successfully',
                        order: newOrder
                    });
                } catch (err) {
                    res.status(500).json({ error: err.message });
                }
            });
            app.get('/api/admin/tables', requireAdmin, async (req, res) => {
                try {
                    if (!mongoConnected) {
                        return res.json({ tables: [] });
                    }

                    const tables = await Table.find().sort({ tableNumber: 1 });
                    res.json({ tables });
                } catch (err) {
                    res.status(500).json({ error: err.message });
                }
            });
            app.get('/api/admin/tables/:id', requireAdmin, async (req, res) => {
                try {
                    const { id } = req.params;
                    const table = await Table.findById(id);

                    if (!table) {
                        return res.status(404).json({ error: 'Table not found' });
                    }

                    res.json(table);
                } catch (err) {
                    res.status(500).json({ error: err.message });
                }
            });
            app.post('/api/admin/tables', requireAdmin, async (req, res) => {
                try {
                    const { tableNumber, capacity, section, position } = req.body;

                    if (!tableNumber || !capacity) {
                        return res.status(400).json({ error: 'Table number and capacity are required' });
                    }

                    const tableId = 'TBL-' + uuidv4().substring(0, 8).toUpperCase();
                    const table = new Table({
                        _id: tableId,
                        tableNumber,
                        capacity,
                        section: section || 'main',
                        position: position || ''
                    });

                    await table.save();
                    res.status(201).json({ message: 'Table created', table });
                } catch (err) {
                    if (err.code === 11000) {
                        return res.status(400).json({ error: 'Table number already exists' });
                    }
                    res.status(400).json({ error: err.message });
                }
            });

            app.put('/api/admin/tables/:id', requireAdmin, async (req, res) => {
                try {
                    const { id } = req.params;
                    const { tableNumber, capacity, status, section, position, isActive } = req.body;

                    const table = await Table.findById(id);

                    if (!table) {
                        return res.status(404).json({ error: 'Table not found' });
                    }

                    if (tableNumber) table.tableNumber = tableNumber;
                    if (capacity) table.capacity = capacity;
                    if (status) table.status = status;
                    if (section) table.section = section;
                    if (position !== undefined) table.position = position;
                    if (isActive !== undefined) table.isActive = isActive;
                    table.updatedAt = new Date();

                    await table.save();
                    res.json({ message: 'Table updated', table });
                } catch (err) {
                    if (err.code === 11000) {
                        return res.status(400).json({ error: 'Table number already exists' });
                    }
                    res.status(400).json({ error: err.message });
                }
            });

            app.delete('/api/admin/tables/:id', requireAdmin, async (req, res) => {
                try {
                    const { id } = req.params;

                    const table = await Table.findByIdAndDelete(id);

                    if (!table) {
                        return res.status(404).json({ error: 'Table not found' });
                    }

                    res.json({ message: 'Table deleted' });
                } catch (err) {
                    res.status(500).json({ error: err.message });
                }
            });

            app.get('/api/admin/tables/stats', requireAdmin, async (req, res) => {
                try {
                    if (!mongoConnected) {
                        return res.json({ total: 0, available: 0, occupied: 0, reserved: 0, maintenance: 0 });
                    }

                    const tables = await Table.find({ isActive: true });
                    const stats = {
                        total: tables.length,
                        available: tables.filter(t => t.status === 'available').length,
                        occupied: tables.filter(t => t.status === 'occupied').length,
                        reserved: tables.filter(t => t.status === 'reserved').length,
                        maintenance: tables.filter(t => t.status === 'maintenance').length
                    };

                    res.json(stats);
                } catch (err) {
                    res.status(500).json({ error: err.message });
                }
            });

            console.log(' MongoDB connected successfully!');
            return true;
        } catch (err) {
            mongoConnected = false;
            console.error(` Connection attempt ${i + 1} failed:`, err.message);

            if (i < retries - 1) {
                console.log(`Retrying in ${delay / 1000} seconds...`);
                await new Promise(resolve => setTimeout(resolve, delay));
                delay *= 1.5;
            }
        }
    }
    return false;
};

const startServer = async () => {
    server.listen(PORT, () => {
        console.log(`Server running on port ${PORT}`);
    });

    connectMongoDB().then(connected => {
        if (!connected) {
            console.warn('MongoDB service is running');
        }
    });
};

startServer();

