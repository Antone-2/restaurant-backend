require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const mongoose = require('mongoose');
const http = require('http');
const { Server } = require('socket.io');
const rateLimit = require('express-rate-limit');
const morgan = require('morgan');
const mpesa = require('./mpesa');
const kitchenRoutes = require('./kitchen');

// Import config
const { logger, morganStream, config } = require('./config');

// Import models (for reference in other modules)
try {
    const models = require('./models/index');
    console.log('Models loaded:', Object.keys(models));

    // Verify User model exists
    if (!models.User) {
        console.error('ERROR: User model is NOT in the exported models!');
    } else {
        console.log('User model is defined');
    }
} catch (err) {
    console.error('Error loading models:', err);
}

// Load engagement models synchronously before automation service needs them
try {
    require('./models/engagement');
    console.log('Engagement models loaded');
} catch (err) {
    console.error('Error loading engagement models:', err);
}

// Import middleware
const { authenticateToken, requireAuth, requireAdmin, setMongoConnected, getMongoConnected } = require('./middleware/auth');
const { validateOrderInput } = require('./middleware/validation');

// Import services
const { initBrevo, sendEmailNotification } = require('./services/email');
const { initAfricaTalking } = require('./services/sms');
const { sendOrderNotifications } = require('./services/notifications');
const engagementService = require('./services/engagement');

// Import routes
const authRoutes = require('./routes/auth');
const cartRoutes = require('./routes/cart');
const wishlistRoutes = require('./routes/wishlist');
const menuRoutes = require('./routes/menu');
const ordersRoutes = require('./routes/orders');
const reservationsRoutes = require('./routes/reservations');
const reviewsRoutes = require('./routes/reviews');
const eventsRoutes = require('./routes/events');
const contactRoutes = require('./routes/contact');
const parkingRoutes = require('./routes/parking');
const loyaltyRoutes = require('./routes/loyalty');
const adminRoutes = require('./routes/admin');
const statsRoutes = require('./routes/stats');
const engagementRoutes = require('./routes/engagement');

// Import utils
const { setSocketIO } = require('./utils/socket');

const app = express();
const server = http.createServer(app);

// Rate limiters
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

const strictPaymentLimiter = rateLimit({
    windowMs: 30 * 60 * 1000,
    max: 3,
    message: { error: 'Too many payment attempts. Please wait before trying again.' },
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req, res) => req.user && config.adminEmails.includes(req.user.email)
});

// Socket.io setup
const io = new Server(server, {
    cors: {
        origin: config.allowedOrigins.length > 0 ? config.allowedOrigins : ['*'],
        methods: ['GET', 'POST'],
        credentials: true
    }
});

// Initialize socket utils
setSocketIO(io);

const connectedClients = new Map();

io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);
    socket.on('register', (userData) => {
        connectedClients.set(socket.id, { ...userData, socketId: socket.id, connectedAt: new Date() });
    });
    socket.on('join:admin', () => socket.join('admin'));
    socket.on('join:orders', () => socket.join('orders'));
    socket.on('join:reservations', () => socket.join('reservations'));
    socket.on('disconnect', () => connectedClients.delete(socket.id));
});

// CORS options
const corsOptions = {
    origin: (origin, callback) => {
        if (!origin) return callback(null, true);
        if (config.nodeEnv) return callback(null, true);
        if (config.allowedOrigins.includes(origin)) {
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

// Middleware
app.use(morgan('combined', { stream: morganStream }));
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

// Initialize Brevo
initBrevo();

// Initialize Africa's Talking
initAfricaTalking();

// Import automation service
const { startAutomationJobs } = require('./services/automation');

// MongoDB connection
const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://localhost:27017/thequill';

// Add connection options for better reliability
const mongoOptions = {
    serverSelectionTimeoutMS: 30000,
    socketTimeoutMS: 45000,
    maxPoolSize: 10,
    minPoolSize: 1
};

mongoose.connect(MONGO_URI, mongoOptions)
    .then(() => {
        setMongoConnected(true);
        console.log('MongoDB connected');
        // Load reservation system after MongoDB is connected
        require('./reservationSystem')(app, requireAdmin, getMongoConnected);
        // Start automation cron jobs after MongoDB connects
        startAutomationJobs();
    })
    .catch(err => {
        console.error('MongoDB connection error:', err.message);
        setMongoConnected(false);
    });

// Reservation reminder scheduler (runs every hour)
const { processReminders } = require('./services/reservationEmails');

// Run reminders check every hour
setInterval(async () => {
    try {
        console.log('[Scheduler] Checking for upcoming reservations...');
        const result = await processReminders();
        if (result.processed > 0) {
            console.log(`[Scheduler] Sent ${result.processed} reservation reminders`);
        }
    } catch (err) {
        console.error('[Scheduler] Error processing reminders:', err.message);
    }
}, 60 * 60 * 1000); // Every hour

// Also run on startup (in case server was down)
setTimeout(async () => {
    try {
        console.log('[Scheduler] Running initial reminder check...');
        await processReminders();
    } catch (err) {
        console.error('[Scheduler] Initial reminder check failed:', err.message);
    }
}, 10000); // Run 10 seconds after startup

// ============= ROUTES =============

// Health check endpoint
app.get('/api/health', async (req, res) => {
    try {
        console.log('[Health] Checking models...');
        const models = require('./models/index');
        console.log('[Health] Available models:', Object.keys(models));
        const { User } = models;
        console.log('[Health] User model:', User);
        if (!User) {
            return res.status(500).json({
                status: 'error',
                error: 'User model is undefined',
                availableModels: Object.keys(models)
            });
        }
        const mongoStatus = mongoose.connection.readyState === 1;
        const userCount = mongoStatus ? await User.countDocuments() : 0;
        res.json({
            status: 'ok',
            mongodb: mongoStatus ? 'connected' : 'disconnected',
            userCount,
            modelsLoaded: Object.keys(models)
        });
    } catch (err) {
        console.error('[Health] Error:', err);
        res.status(500).json({ status: 'error', error: err.message, stack: err.stack });
    }
});

// Auth routes (modular)
app.use('/api/auth', authLimiter, authRoutes);

// Cart routes
app.use('/api/cart', cartRoutes);

// Wishlist routes
app.use('/api/wishlist', wishlistRoutes);

// Menu routes
app.use('/api/menu', menuRoutes);

// Orders routes
app.use('/api/orders', ordersRoutes);

// Reservations routes
app.use('/api/reservations', reservationsRoutes);

// Reviews routes
app.use('/api/reviews', reviewsRoutes);

// Events routes (including special events)
app.use('/api/events', eventsRoutes);

// Contact & subscribe routes
app.use('/api', contactRoutes);

// Parking routes
app.use('/api/parking', parkingRoutes);

// Stats route
app.use('/api/stats', statsRoutes);

// Admin routes
app.use('/api/admin', adminRoutes);

// Special events - create proxy routes to /api/events/special
const { SpecialEvent } = require('./models/index');

app.get('/api/special-events', async (req, res) => {
    try {
        const { upcoming, type } = req.query;
        let query = {};
        if (upcoming === 'true') { query.isUpcoming = true; query.date = { $gte: new Date() }; }
        if (type) query.type = type;
        const events = await SpecialEvent.find(query).sort({ date: 1 });
        const formattedEvents = events.map(event => ({ ...event.toObject(), id: event._id, date: event.date instanceof Date ? event.date.toISOString().split('T')[0] : event.date }));
        res.json(formattedEvents);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/special-events', requireAdmin, async (req, res) => {
    try {
        const { v4: uuidv4 } = require('uuid');
        const { title, description, date, time, type, price, capacity, image, isUpcoming, organizer, donationPercent, isActive } = req.body;
        if (!title || !description || !date || !time || !type || !price || !capacity) return res.status(400).json({ error: 'All required fields must be provided' });
        const eventId = 'SE-' + uuidv4().substring(0, 8).toUpperCase();
        const specialEvent = new SpecialEvent({ _id: eventId, title, description, date: new Date(date), time, type, price, capacity, image: image || '', isUpcoming: isUpcoming !== false, organizer: organizer || '', donationPercent: donationPercent || 0, isActive: isActive !== false });
        await specialEvent.save();
        const savedEvent = specialEvent.toObject();
        res.status(201).json({ ...savedEvent, id: savedEvent._id, date: savedEvent.date instanceof Date ? savedEvent.date.toISOString().split('T')[0] : savedEvent.date });
    } catch (err) { res.status(400).json({ error: err.message }); }
});

app.get('/api/special-events/:id', async (req, res) => {
    try {
        const event = await SpecialEvent.findById(req.params.id);
        if (!event) return res.status(404).json({ error: 'Special event not found' });
        res.json({ ...event.toObject(), id: event._id, date: event.date instanceof Date ? event.date.toISOString().split('T')[0] : event.date });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/special-events/:id', requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const updateData = { ...req.body, updatedAt: new Date() };
        if (updateData.date) updateData.date = new Date(updateData.date);
        Object.keys(updateData).forEach(key => { if (updateData[key] === undefined) delete updateData[key]; });
        const event = await SpecialEvent.findByIdAndUpdate(id, updateData, { new: true });
        if (!event) return res.status(404).json({ error: 'Special event not found' });
        res.json({ message: 'Special event updated', specialEvent: event });
    } catch (err) { res.status(400).json({ error: err.message }); }
});

app.delete('/api/special-events/:id', requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const event = await SpecialEvent.findByIdAndDelete(id);
        // If event doesn't exist, return success anyway (idempotent operation)
        if (!event) {
            console.log(`Special event not found for deletion: ${id}`);
            return res.status(200).json({ message: 'Special event deleted (or did not exist)' });
        }
        res.json({ message: 'Special event deleted' });
    } catch (err) { res.status(400).json({ error: err.message }); }
});

// Seed endpoint to populate initial special events
app.post('/api/special-events/seed', requireAdmin, async (req, res) => {
    try {
        const { v4: uuidv4 } = require('uuid');

        const seedEvents = [
            {
                _id: 'SE-' + uuidv4().substring(0, 8).toUpperCase(),
                title: 'Jazz Night with Local Artists',
                description: 'Enjoy an evening of smooth jazz with talented local musicians. Complimentary appetizer plate included.',
                date: new Date('2026-03-15'),
                time: '7:00 PM',
                type: 'live-music',
                price: 'KES 2,500/person',
                capacity: 50,
                image: 'https://images.unsplash.com/photo-1514320291840-2e0a9bf2a9ae?w=400',
                isUpcoming: true,
                organizer: 'The Quill & Kisumu Arts Council',
                donationPercent: 0,
                isActive: true
            },
            {
                _id: 'SE-' + uuidv4().substring(0, 8).toUpperCase(),
                title: 'Charity Fundraiser Dinner',
                description: 'Support St. Jude\'s Orphanage with a gourmet dinner. 20% of proceeds go to the charity.',
                date: new Date('2026-03-22'),
                time: '6:30 PM',
                type: 'fundraiser',
                price: 'KES 3,500/person',
                capacity: 80,
                image: 'https://images.unsplash.com/photo-1464366400600-7168b8af9bc3?w=400',
                isUpcoming: true,
                organizer: "St. Jude's Orphanage",
                donationPercent: 20,
                isActive: true
            },
            {
                _id: 'SE-' + uuidv4().substring(0, 8).toUpperCase(),
                title: 'Wine & Dine Evening',
                description: 'Explore a curated selection of wines paired with exquisite dishes from our chef.',
                date: new Date('2026-03-29'),
                time: '6:00 PM',
                type: 'wine-tasting',
                price: 'KES 4,500/person',
                capacity: 30,
                image: 'https://images.unsplash.com/photo-1510812431401-41d2bd2722f3?w=400',
                isUpcoming: true,
                organizer: 'The Quill Sommelier Club',
                donationPercent: 0,
                isActive: true
            },
            {
                _id: 'SE-' + uuidv4().substring(0, 8).toUpperCase(),
                title: '80s Retro Night',
                description: 'Travel back in time with 80s hits, classic cocktails, and retro vibes!',
                date: new Date('2026-04-05'),
                time: '8:00 PM',
                type: 'themed-night',
                price: 'KES 1,500/person',
                capacity: 60,
                image: 'https://images.unsplash.com/photo-1492684223066-81342ee5ff30?w=400',
                isUpcoming: true,
                organizer: 'The Quill Entertainment',
                donationPercent: 0,
                isActive: true
            },
            {
                _id: 'SE-' + uuidv4().substring(0, 8).toUpperCase(),
                title: 'Mother\'s Day Brunch Fundraiser',
                description: 'Treat mom to a special brunch while supporting local women entrepreneurs.',
                date: new Date('2026-05-10'),
                time: '11:00 AM',
                type: 'fundraiser',
                price: 'KES 2,000/person',
                capacity: 100,
                image: 'https://images.unsplash.com/photo-1529335764857-3f5164c3f1ac?w=400',
                isUpcoming: true,
                organizer: 'Busia Women Business League',
                donationPercent: 15,
                isActive: true
            },
            {
                _id: 'SE-' + uuidv4().substring(0, 8).toUpperCase(),
                title: 'Afrobeat Live Night',
                description: 'Experience the best of Afrobeat music with live performances from renowned artists.',
                date: new Date('2026-04-12'),
                time: '7:30 PM',
                type: 'live-music',
                price: 'KES 3,000/person',
                capacity: 75,
                image: 'https://images.unsplash.com/photo-1501386761578-eac5c94b800a?w=400',
                isUpcoming: true,
                organizer: 'Kisumu Music Festival',
                donationPercent: 0,
                isActive: true
            },
            {
                _id: 'SE-' + uuidv4().substring(0, 8).toUpperCase(),
                title: 'Sunset Cocktail Party',
                description: 'Enjoy signature cocktails and canapés as the sun sets over Lake Victoria.',
                date: new Date('2026-04-20'),
                time: '5:00 PM',
                type: 'other',
                price: 'KES 2,000/person',
                capacity: 40,
                image: 'https://images.unsplash.com/photo-1470337458703-46ad1756a187?w=400',
                isUpcoming: true,
                organizer: 'The Quill Bar',
                donationPercent: 0,
                isActive: true
            },
            {
                _id: 'SE-' + uuidv4().substring(0, 8).toUpperCase(),
                title: 'Kenyan Cuisine Masterclass',
                description: 'Learn to cook traditional Kenyan dishes with our executive chef. Includes recipe booklet.',
                date: new Date('2026-05-03'),
                time: '10:00 AM',
                type: 'other',
                price: 'KES 5,000/person',
                capacity: 20,
                image: 'https://images.unsplash.com/photo-1556910103-1c02745aae4d?w=400',
                isUpcoming: true,
                organizer: 'The Quill Culinary School',
                donationPercent: 0,
                isActive: true
            },
            {
                _id: 'SE-' + uuidv4().substring(0, 8).toUpperCase(),
                title: 'Romantic Valentine\'s Dinner',
                description: 'A special 5-course dinner for couples with live violin music and champagne.',
                date: new Date('2026-06-14'),
                time: '7:00 PM',
                type: 'themed-night',
                price: 'KES 8,000/couple',
                capacity: 30,
                image: 'https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=400',
                isUpcoming: true,
                organizer: 'The Quill Restaurant',
                donationPercent: 0,
                isActive: true
            }
        ];

        // Clear existing events and insert new ones
        await SpecialEvent.deleteMany({});
        await SpecialEvent.insertMany(seedEvents);

        res.json({ message: 'Special events seeded successfully', count: seedEvents.length });
    } catch (err) { res.status(400).json({ error: err.message }); }
});

// Loyalty routes
app.use('/api/loyalty', loyaltyRoutes);

// Engagement routes (reviews, campaigns, customer profiles)
app.use('/api/engagement', engagementRoutes);

// Coupons routes (inline - kept here for simplicity)
const { Coupon } = require('./models/index');

app.post('/api/coupons/validate', async (req, res) => {
    try {
        const { code, orderTotal } = req.body;
        if (!code) return res.status(400).json({ error: 'Coupon code is required' });
        if (!getMongoConnected()) return res.json({ valid: false, error: 'Database unavailable' });
        const coupon = await Coupon.findOne({ code: code.toUpperCase() });
        if (!coupon) return res.json({ valid: false, error: 'Invalid coupon code' });
        if (!coupon.isActive) return res.json({ valid: false, error: 'This coupon is no longer active' });
        const now = new Date();
        if (coupon.validFrom && new Date(coupon.validFrom) > now) return res.json({ valid: false, error: 'This coupon is not yet valid' });
        if (coupon.validUntil && new Date(coupon.validUntil) < now) return res.json({ valid: false, error: 'This coupon has expired' });
        if (coupon.maxUses && coupon.usedCount >= coupon.maxUses) return res.json({ valid: false, error: 'This coupon has reached its maximum number of uses' });
        if (orderTotal && coupon.minOrderAmount && orderTotal < coupon.minOrderAmount) return res.json({ valid: false, error: `Minimum order amount of KES ${coupon.minOrderAmount} required` });
        let discount = coupon.discountType === 'percentage' ? (orderTotal || 0) * (coupon.discountValue / 100) : coupon.discountValue;
        res.json({ valid: true, code: coupon.code, description: coupon.description, discountType: coupon.discountType, discountValue: coupon.discountValue, discount, message: 'Coupon applied successfully' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/coupons', async (req, res) => {
    try {
        if (!getMongoConnected()) return res.json([]);
        const coupons = await Coupon.find({ isActive: true }).sort({ createdAt: -1 });
        res.json(coupons);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/admin/coupons', requireAdmin, async (req, res) => {
    try {
        const { v4: uuidv4 } = require('uuid');
        const { code, description, discountType, discountValue, minOrderAmount, maxUses, validFrom, validUntil, applicableCategories } = req.body;
        if (!code || !discountType || !discountValue) return res.status(400).json({ error: 'Code, discount type, and discount value are required' });
        const couponId = 'CPN-' + uuidv4().substring(0, 8).toUpperCase();
        const coupon = new Coupon({ _id: couponId, code: code.toUpperCase(), description, discountType, discountValue, minOrderAmount: minOrderAmount || 0, maxUses, usedCount: 0, validFrom, validUntil, isActive: true, applicableCategories: applicableCategories || [] });
        await coupon.save();
        res.status(201).json({ message: 'Coupon created', coupon });
    } catch (err) { res.status(400).json({ error: err.message }); }
});

// M-Pesa payment routes (inline - kept here for simplicity)
const { Order } = require('./models/index');
const { emitToRoom } = require('./utils/socket');

app.post('/api/payments/mpesa/initiate', strictPaymentLimiter, async (req, res) => {
    try {
        const { phoneNumber, amount, orderId } = req.body;
        if (!phoneNumber || !amount || !orderId) return res.status(400).json({ error: 'Phone number, amount, and order ID are required' });
        const order = await Order.findById(orderId);
        if (!order) return res.status(404).json({ error: 'Order not found' });
        const formattedPhone = mpesa.formatPhoneNumber(phoneNumber);
        const result = await mpesa.initiateSTKPush(formattedPhone, amount, `ORDER-${orderId}`, `The Quill Restaurant - Order #${orderId}`);
        if (result.success) {
            order.paymentMethod = 'mpesa'; order.mpesaRequestId = result.CheckoutRequestID; order.paymentStatus = 'pending'; order.updatedAt = new Date(); await order.save();
            res.json({ success: true, isDemo: result.isDemo || false, message: result.CustomerMessage || 'M-Pesa payment initiated', mpesaRequestId: result.CheckoutRequestID, merchantRequestId: result.MerchantRequestID, orderId, accountReference: `ORDER-${orderId}`, businessShortCode: mpesa.config.shortcode, amount, phoneNumber: formattedPhone, instruction: 'Complete M-Pesa payment on your phone', timeout: 180, redirectTo: '/orders/' + orderId });
        } else { res.status(400).json({ success: false, error: result.error || 'Failed to initiate payment' }); }
    } catch (err) { console.error('M-Pesa initiate error:', err.message); res.status(400).json({ success: false, error: err.message }); }
});

app.get('/api/payments/mpesa/status/:checkoutRequestId', async (req, res) => {
    try {
        const { checkoutRequestId } = req.params;
        const order = await Order.findOne({ mpesaRequestId: checkoutRequestId });
        if (!order) return res.json({ checkoutRequestId, paymentStatus: 'pending', message: 'Order not found' });
        if (order.paymentStatus === 'completed') return res.json({ checkoutRequestId, orderId: order._id, paymentStatus: 'completed', mpesaTransactionId: order.mpesaTransactionId, amount: order.total, timestamp: order.updatedAt });
        const result = await mpesa.querySTKStatus(checkoutRequestId);
        if (result.ResultCode === '0' && result.TransactionId) { order.paymentStatus = 'completed'; order.mpesaTransactionId = result.TransactionId; order.status = 'confirmed'; order.updatedAt = new Date(); await order.save(); await sendOrderNotifications(order); }
        res.json({ checkoutRequestId, orderId: order._id, paymentStatus: order.paymentStatus, mpesaTransactionId: order.mpesaTransactionId || result.TransactionId || null, amount: order.total, resultCode: result.ResultCode, resultDesc: result.ResultDesc, isDemo: result.isDemo || false, timestamp: order.updatedAt });
    } catch (err) { console.error('M-Pesa status check error:', err.message); res.status(400).json({ error: err.message }); }
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
            let mpesaData = { amount: 0, transactionId: '', phoneNumber: '', transactionDate: new Date() };
            metadata.forEach(item => { if (item.Name === 'Amount') mpesaData.amount = item.Value; if (item.Name === 'MpesaReceiptNumber') mpesaData.transactionId = item.Value; if (item.Name === 'PhoneNumber') mpesaData.phoneNumber = item.Value; });
            console.log('[M-Pesa] Payment successful:', mpesaData);
            const order = await Order.findOne({ mpesaRequestId: CheckoutRequestID });
            if (order) { order.paymentStatus = 'completed'; order.mpesaTransactionId = mpesaData.transactionId; order.status = 'confirmed'; order.updatedAt = new Date(); order.statusHistory = order.statusHistory || []; order.statusHistory.push({ status: 'confirmed', timestamp: new Date(), note: `Payment confirmed. Transaction ID: ${mpesaData.transactionId}` }); await order.save(); await sendOrderNotifications(order); emitToRoom('orders', 'order:paymentUpdated', { orderId: order._id, paymentStatus: 'completed', mpesaTransactionId: mpesaData.transactionId }); emitToRoom('admin', 'order:paymentUpdated', { orderId: order._id, paymentStatus: 'completed', mpesaTransactionId: mpesaData.transactionId }); }
        }
    } catch (err) { console.error('M-Pesa callback error:', err.message); res.json({ ResultCode: 1, ResponseCode: '1' }); }
});

// Kitchen routes
app.use('/api/kitchen', kitchenRoutes);

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Error:', err);
    res.status(500).json({ error: err.message || 'Internal server error' });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
});

// Start server
const PORT = config.port;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

module.exports = { app, server, io };
