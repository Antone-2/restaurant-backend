const mongoose = require('mongoose');

// Menu Item Schema
const menuItemSchema = new mongoose.Schema({
    name: { type: String, required: true },
    description: { type: String, required: true },
    price: { type: Number, required: true },
    image: { type: String },
    category: {
        type: String,
        enum: ['starters', 'mains', 'drinks', 'specials'],
        required: true
    },
    popular: { type: Boolean, default: false },
    available: { type: Boolean, default: true },
    nutritionalInfo: {
        calories: Number,
        protein: Number,
        carbs: Number,
        fat: Number
    },
    allergens: [String],
    dietary: {
        vegetarian: { type: Boolean, default: false },
        vegan: { type: Boolean, default: false },
        glutenFree: { type: Boolean, default: false },
        dairyFree: { type: Boolean, default: false },
        nutFree: { type: Boolean, default: false }
    },
    preparationTime: { type: Number, default: 15 }, // minutes
    // Inventory tracking
    stockQuantity: { type: Number, default: 0 },
    lowStockThreshold: { type: Number, default: 10 },
    trackInventory: { type: Boolean, default: false }
}, { timestamps: true });

// Menu Item Indexes - Optimized for common queries
menuItemSchema.index({ category: 1, available: 1 });
menuItemSchema.index({ popular: 1, available: 1 });
menuItemSchema.index({ name: 'text', description: 'text' });
menuItemSchema.index({ price: 1 });
menuItemSchema.index({ trackInventory: 1, stockQuantity: 1 }); // For low stock queries

// Order Schema
const orderSchema = new mongoose.Schema({
    customerName: { type: String, required: true },
    phone: { type: String, required: true },
    orderType: {
        type: String,
        enum: ['dinein', 'takeaway', 'delivery'],
        required: true
    },
    items: [{
        menuItemId: { type: mongoose.Schema.Types.ObjectId, ref: 'MenuItem' },
        name: String,
        price: Number,
        quantity: Number,
        specialInstructions: String
    }],
    subtotal: { type: Number, required: true },
    tax: { type: Number, required: true },
    total: { type: Number, required: true },
    status: {
        type: String,
        enum: ['pending', 'confirmed', 'preparing', 'ready', 'delivered', 'completed', 'cancelled'],
        default: 'pending'
    },
    deliveryAddress: {
        street: String,
        city: String,
        instructions: String
    },
    deliveryInstructions: String,
    paymentMethod: {
        type: String,
        enum: ['cash', 'mpesa', 'card'],
        default: 'cash'
    },
    paymentStatus: {
        type: String,
        enum: ['pending', 'paid', 'failed', 'refunded'],
        default: 'pending'
    },
    customerEmail: String,
    reservationDate: Date,
    reservationTime: String,
    numberOfGuests: Number,
    specialRequests: String,
    // Delivery tracking
    deliveryPartner: {
        name: String,
        phone: String,
        vehicle: String
    },
    deliveryEta: {
        preparationTime: Number,
        deliveryTime: Number
    },
    // Loyalty
    loyaltyPointsEarned: { type: Number, default: 0 },
    loyaltyPointsRedeemed: { type: Number, default: 0 }
}, { timestamps: true });

// Order Indexes - Optimized for admin dashboard queries
orderSchema.index({ customerEmail: 1 });
orderSchema.index({ status: 1, createdAt: -1 });
orderSchema.index({ paymentStatus: 1, createdAt: -1 });
orderSchema.index({ createdAt: -1 });
orderSchema.index({ 'items.menuItemId': 1 }); // For popular items analytics
orderSchema.index({ orderType: 1, status: 1 }); // Kitchen display queries

// Reservation Schema
const reservationSchema = new mongoose.Schema({
    name: { type: String, required: true },
    email: { type: String, required: true },
    phone: { type: String, required: true },
    date: { type: Date, required: true },
    time: { type: String, required: true },
    guests: { type: Number, required: true },
    tableName: { type: String },
    specialRequests: String,
    status: {
        type: String,
        enum: ['pending', 'confirmed', 'cancelled', 'completed'],
        default: 'confirmed'
    },
    reservationId: { type: String, required: true, unique: true }
}, { timestamps: true });

// Reservation Indexes
reservationSchema.index({ date: 1, time: 1 });
reservationSchema.index({ status: 1, date: 1 });
reservationSchema.index({ email: 1 });
reservationSchema.index({ date: 1, status: 1, guests: 1 });

// Parking Reservation Schema
const parkingReservationSchema = new mongoose.Schema({
    name: { type: String, required: true },
    email: { type: String, required: true },
    phone: { type: String, required: true },
    vehicleType: { type: String, required: true },
    vehiclePlate: { type: String, required: true },
    date: { type: Date, required: true },
    time: { type: String, required: true },
    duration: { type: Number, required: true },
    slotNumber: { type: String },
    specialRequests: String,
    status: {
        type: String,
        enum: ['pending', 'confirmed', 'cancelled', 'completed'],
        default: 'confirmed'
    },
    reservationId: { type: String, required: true, unique: true }
}, { timestamps: true });

// Parking Indexes
parkingReservationSchema.index({ date: 1, slotNumber: 1 });
parkingReservationSchema.index({ status: 1, date: 1 });

// Review Schema
const reviewSchema = new mongoose.Schema({
    name: { type: String, required: true },
    rating: { type: Number, required: true, min: 1, max: 5 },
    comment: { type: String, required: true },
    date: { type: Date, default: Date.now },
    status: {
        type: String,
        enum: ['pending', 'approved', 'rejected'],
        default: 'pending'
    },
    orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order' },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    adminReply: String
});

// Review Indexes
reviewSchema.index({ status: 1 });
reviewSchema.index({ rating: -1 });

// Event Inquiry Schema
const eventInquirySchema = new mongoose.Schema({
    name: { type: String, required: true },
    email: { type: String, required: true },
    phone: { type: String, required: true },
    eventType: { type: String, required: true },
    date: { type: Date, required: true },
    guests: { type: Number, required: true },
    message: String,
    status: {
        type: String,
        enum: ['pending', 'contacted', 'confirmed', 'completed'],
        default: 'pending'
    }
}, { timestamps: true });

// Subscriber Schema
const subscriberSchema = new mongoose.Schema({
    email: { type: String, required: true, unique: true },
    subscribedAt: { type: Date, default: Date.now }
});

// Loyalty Points Schema
const loyaltyPointsSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    points: { type: Number, default: 0 },
    lifetimePoints: { type: Number, default: 0 },
    tier: {
        type: String,
        enum: ['bronze', 'silver', 'gold', 'platinum'],
        default: 'bronze'
    },
    referralCode: { type: String, unique: true },
    referredBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    history: [{
        points: Number,
        type: { type: String, enum: ['earned', 'redeemed', 'bonus', 'expired'] },
        description: String,
        orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order' },
        date: { type: Date, default: Date.now }
    }]
}, { timestamps: true });

// Loyalty Indexes
loyaltyPointsSchema.index({ userId: 1 });
loyaltyPointsSchema.index({ referralCode: 1 });
loyaltyPointsSchema.index({ tier: 1 });

// Coupon Schema
const couponSchema = new mongoose.Schema({
    code: { type: String, required: true, unique: true },
    description: String,
    discountType: {
        type: String,
        enum: ['percentage', 'fixed'],
        required: true
    },
    discountValue: { type: Number, required: true },
    minOrderAmount: { type: Number, default: 0 },
    maxUses: { type: Number },
    usedCount: { type: Number, default: 0 },
    validFrom: { type: Date, required: true },
    validUntil: { type: Date, required: true },
    applicableCategories: [String],
    isActive: { type: Boolean, default: true }
}, { timestamps: true });

// Coupon Indexes
couponSchema.index({ code: 1 });
couponSchema.index({ isActive: 1, validFrom: 1, validUntil: 1 });

// Support Ticket Schema
const ticketSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    subject: { type: String, required: true },
    category: {
        type: String,
        enum: ['general', 'order', 'payment', 'reservation', 'technical', 'feedback'],
        default: 'general'
    },
    priority: {
        type: String,
        enum: ['low', 'medium', 'high', 'urgent'],
        default: 'medium'
    },
    status: {
        type: String,
        enum: ['open', 'in_progress', 'resolved', 'closed'],
        default: 'open'
    },
    messages: [{
        sender: { type: String, enum: ['user', 'admin'] },
        message: String,
        timestamp: { type: Date, default: Date.now }
    }],
    orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order' }
}, { timestamps: true });

// Ticket Indexes
ticketSchema.index({ userId: 1, status: 1 });
ticketSchema.index({ status: 1, priority: 1 });

// FAQ Schema
const faqSchema = new mongoose.Schema({
    question: { type: String, required: true },
    answer: { type: String, required: true },
    category: {
        type: String,
        enum: ['general', 'orders', 'payments', 'reservations', 'account', 'loyalty'],
        default: 'general'
    },
    order: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true }
}, { timestamps: true });

// FAQ Indexes
faqSchema.index({ category: 1, order: 1 });
faqSchema.index({ isActive: 1 });

// Export models
const MenuItem = mongoose.model('MenuItem', menuItemSchema);
const Order = mongoose.model('Order', orderSchema);
const Reservation = mongoose.model('Reservation', reservationSchema);
const ParkingReservation = mongoose.model('ParkingReservation', parkingReservationSchema);
const Review = mongoose.model('Review', reviewSchema);
const EventInquiry = mongoose.model('EventInquiry', eventInquirySchema);
const Subscriber = mongoose.model('Subscriber', subscriberSchema);
const LoyaltyPoints = mongoose.model('LoyaltyPoints', loyaltyPointsSchema);
const Coupon = mongoose.model('Coupon', couponSchema);
const Ticket = mongoose.model('Ticket', ticketSchema);
const FAQ = mongoose.model('FAQ', faqSchema);

module.exports = {
    MenuItem,
    Order,
    Reservation,
    ParkingReservation,
    Review,
    EventInquiry,
    Subscriber,
    LoyaltyPoints,
    Coupon,
    Ticket,
    FAQ
};
