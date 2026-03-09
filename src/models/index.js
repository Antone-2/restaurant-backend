const mongoose = require('mongoose');

// Order Schema
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

// Reservation Schema
const reservationSchema = new mongoose.Schema({
    _id: String,
    name: { type: String, required: true },
    email: { type: String, required: true },
    phone: { type: String, required: true },
    date: { type: String, required: true },
    time: { type: String, required: true },
    guests: { type: Number, required: true },
    tableId: { type: String, default: null },
    tableName: { type: String, default: '' },
    tableIds: [{ type: String }],
    status: { type: String, enum: ['pending', 'confirmed', 'cancelled', 'completed', 'no-show'], default: 'pending' },
    specialRequests: { type: String, default: '' },
    customerId: { type: String, default: null },
    partySize: { type: Number, default: 1 },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});
const Reservation = mongoose.model('Reservation', reservationSchema);

// Parking Schema
const parkingSchema = new mongoose.Schema({
    _id: String,
    name: String,
    email: String,
    phone: String,
    vehicleType: String,
    vehiclePlate: String,
    date: String,
    time: String,
    duration: { type: Number, default: 1 },
    slotNumber: String,
    price: { type: Number, default: 0 },
    paymentStatus: { type: String, enum: ['unpaid', 'pending', 'paid', 'failed'], default: 'unpaid' },
    paymentMethod: { type: String, enum: ['cash', 'mpesa', 'card', ''], default: '' },
    paidAt: { type: Date, default: null },
    mpesaCheckoutRequestId: String,
    mpesaMerchantId: String,
    createdAt: { type: Date, default: Date.now }
});
const Parking = mongoose.model('Parking', parkingSchema);

// Table Schema
const tableSchema = new mongoose.Schema({
    _id: String,
    tableNumber: { type: String, required: true, unique: true },
    capacity: { type: Number, required: true, default: 4 },
    location: { type: String, enum: ['indoor', 'outdoor', 'bar', 'vip', 'private'], default: 'indoor' },
    status: { type: String, enum: ['available', 'occupied', 'reserved', 'maintenance'], default: 'available' },
    section: { type: String, default: 'main' },
    description: { type: String, default: '' },
    position: { type: String, default: '' },
    isActive: { type: Boolean, default: true },
    restaurantId: { type: String, default: 'default' },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});
const Table = mongoose.model('Table', tableSchema);

// TimeSlot Schema
const timeSlotSchema = new mongoose.Schema({
    _id: String,
    dayOfWeek: { type: Number, required: true, min: 0, max: 6 },
    time: { type: String, required: true },
    timeLabel: { type: String, default: '' },
    maxBookings: { type: Number, default: 10, min: 1 },
    currentBookings: { type: Number, default: 0, min: 0 },
    isActive: { type: Boolean, default: true },
    restaurantId: { type: String, default: 'default' },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});
timeSlotSchema.index({ dayOfWeek: 1, time: 1 }, { unique: true });
const TimeSlot = mongoose.model('TimeSlot', timeSlotSchema);

// Blacklist Schema
const blacklistSchema = new mongoose.Schema({
    _id: String,
    customerName: { type: String, required: true },
    email: { type: String, default: '' },
    phone: { type: String, required: true },
    noShowCount: { type: Number, default: 1, min: 1 },
    reason: { type: String, default: '' },
    flaggedAt: { type: Date, default: Date.now },
    notes: { type: String, default: '' },
    isActive: { type: Boolean, default: true },
    requiresManualApproval: { type: Boolean, default: false },
    history: [{
        date: Date,
        reservationId: String,
        reason: String
    }],
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});
blacklistSchema.index({ phone: 1 }, { unique: true });
blacklistSchema.index({ email: 1 });
const Blacklist = mongoose.model('Blacklist', blacklistSchema);

// Review Schema
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

// Event Schema
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

// Special Event Schema
const specialEventSchema = new mongoose.Schema({
    _id: String,
    title: { type: String, required: true },
    description: { type: String, required: true },
    date: { type: Date, required: true },
    time: { type: String, required: true },
    type: {
        type: String,
        enum: ['fundraiser', 'live-music', 'themed-night', 'wine-tasting', 'other'],
        required: true
    },
    price: { type: String, required: true },
    capacity: { type: Number, required: true },
    image: { type: String },
    isUpcoming: { type: Boolean, default: true },
    organizer: { type: String },
    donationPercent: { type: Number },
    isActive: { type: Boolean, default: true },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});
specialEventSchema.index({ date: 1 });
specialEventSchema.index({ type: 1 });
const SpecialEvent = mongoose.model('SpecialEvent', specialEventSchema);

// Contact Schema
const contactSchema = new mongoose.Schema({
    _id: String,
    name: String,
    email: String,
    message: String,
    createdAt: { type: Date, default: Date.now }
});
const Contact = mongoose.model('Contact', contactSchema);

// MenuItem Schema
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
    dietaryTags: [{ type: String, enum: ['vegetarian', 'vegan', 'gluten-free', 'dairy-free', 'nut-free', 'halal'] }],
    spicy: { type: String, enum: ['mild', 'medium', 'hot', 'extra-hot', ''], default: '' },
    allergens: [String],
    popularTags: [{ type: String, enum: ['chef-special', 'customer-favourite', 'new', 'limited-time'] }],
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

// Subscriber Schema
const subscriberSchema = new mongoose.Schema({
    _id: String,
    email: { type: String, required: true, unique: true },
    name: String,
    phone: String,
    birthday: Date,
    segment: { type: String, enum: ['all', 'vip', 'loyalty', 'new', 'inactive'], default: 'new' },
    lastActivity: Date,
    totalOrders: { type: Number, default: 0 },
    totalSpent: { type: Number, default: 0 },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});
const Subscriber = mongoose.model('Subscriber', subscriberSchema);

// User Schema
const userSchema = new mongoose.Schema({
    _id: String,
    email: { type: String, unique: true, sparse: true },
    password: String,
    name: String,
    phone: String,
    address: String,
    emailVerified: { type: Boolean, default: false },
    role: { type: String, default: 'customer' },
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
    // Staff-specific fields
    shift: { type: String, enum: ['morning', 'evening', 'night', 'full-time'], default: 'full-time' },
    hourlyRate: { type: Number, default: 200 },
    yearsExperience: { type: Number, default: 0 },
    startDate: { type: Date, default: Date.now },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});
const User = mongoose.model('User', userSchema);

// Wishlist Schema
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

// Cart Schema
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
    expiresAt: { type: Date, default: () => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});
cartSchema.index({ userId: 1 });
cartSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
const Cart = mongoose.model('Cart', cartSchema);

// LoyaltyPoints Schema
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

// Coupon Schema
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

// Campaign Schema
const campaignSchema = new mongoose.Schema({
    _id: String,
    name: { type: String, required: true },
    type: { type: String, enum: ['email', 'sms', 'push', 'promotion', 'automated'], required: true },
    status: { type: String, enum: ['draft', 'scheduled', 'active', 'completed', 'cancelled'], default: 'draft' },
    audience: { type: String, default: 'all' },
    sentCount: { type: Number, default: 0 },
    openRate: { type: Number, default: 0 },
    clickRate: { type: Number, default: 0 },
    startDate: Date,
    endDate: Date,
    scheduledDate: Date,
    discount: String,
    code: String,
    subject: String,
    message: String,
    segment: { type: String, enum: ['all', 'vip', 'loyalty', 'new', 'inactive'], default: 'all' },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});
const Campaign = mongoose.model('Campaign', campaignSchema);

// DeliveryPartner Schema
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

// Ticket Schema
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

// Partnership Schema
const partnershipSchema = new mongoose.Schema({
    _id: String,
    name: { type: String, required: true },
    organization: { type: String },
    type: {
        type: String,
        enum: ['corporate', 'schools', 'events', 'fundraiser', 'other'],
        required: true
    },
    description: { type: String },
    email: { type: String },
    phone: { type: String },
    contactPerson: { type: String },
    benefits: [{ type: String }],
    minPeople: { type: Number, default: 10 },
    maxPeople: { type: Number, default: 100 },
    priceRange: { type: String },
    status: {
        type: String,
        enum: ['active', 'inactive', 'pending', 'archived'],
        default: 'active'
    },
    yearsActive: { type: Number, default: 0 },
    category: {
        type: String,
        enum: ['Healthcare', 'Education', 'Government', 'Business', 'Charity', 'Other'],
        default: 'Business'
    },
    isFeatured: { type: Boolean, default: false },
    notes: { type: String },
    contractStartDate: { type: Date },
    contractEndDate: { type: Date },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});
partnershipSchema.index({ type: 1, status: 1 });
partnershipSchema.index({ category: 1 });
partnershipSchema.index({ isFeatured: 1 });
const Partnership = mongoose.model('Partnership', partnershipSchema);

// Accommodation Schema
const accommodationSchema = new mongoose.Schema({
    _id: String,
    name: { type: String, required: true },
    type: {
        type: String,
        enum: ['hotel', 'guest-house', 'lodge', 'apartment', 'villa', 'hostel', 'other'],
        required: true
    },
    description: { type: String },
    address: {
        street: String,
        city: String,
        area: String,
        country: { type: String, default: 'Kenya' }
    },
    contactPerson: { type: String },
    email: { type: String },
    phone: { type: String },
    website: { type: String },
    starRating: { type: Number, min: 1, max: 5 },
    priceRange: {
        min: { type: Number, default: 0 },
        max: { type: Number, default: 0 },
        currency: { type: String, default: 'KES' }
    },
    amenities: [{ type: String }],
    rooms: [{
        roomNumber: String,
        roomType: String,
        capacity: { type: Number, default: 2 },
        pricePerNight: Number,
        availability: { type: String, enum: ['available', 'occupied', 'maintenance'], default: 'available' },
        features: [String]
    }],
    photos: [String],
    checkInTime: { type: String, default: '14:00' },
    checkOutTime: { type: String, default: '10:00' },
    status: {
        type: String,
        enum: ['active', 'inactive', 'pending', 'suspended'],
        default: 'active'
    },
    distanceFromVenue: { type: Number, default: 0 }, // in km
    partnerId: { type: String }, // Link to partnership if applicable
    notes: { type: String },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});
accommodationSchema.index({ type: 1, status: 1 });
accommodationSchema.index({ 'address.city': 1 });
accommodationSchema.index({ starRating: 1 });
const Accommodation = mongoose.model('Accommodation', accommodationSchema);

// Complaint Schema
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

// Dispute Schema
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

// Room Type Schema - For managing different room types with seasonal pricing
const roomTypeSchema = new mongoose.Schema({
    _id: String,
    accommodationId: { type: String, required: true },
    name: { type: String, required: true },
    description: { type: String },
    basePrice: { type: Number, required: true },
    capacity: { type: Number, default: 2 },
    maxAdults: { type: Number, default: 2 },
    maxChildren: { type: Number, default: 1 },
    bedType: { type: String, enum: ['single', 'double', 'twin', 'king', 'queen', 'suite'], default: 'double' },
    roomSize: { type: Number }, // in square meters
    amenities: [{ type: String }],
    photos: [String],
    seasonalPricing: [{
        seasonName: { type: String },
        startDate: Date,
        endDate: Date,
        price: { type: Number, required: true },
        minStay: { type: Number, default: 1 }
    }],
    minimumStay: { type: Number, default: 1 },
    maximumStay: { type: Number, default: 30 },
    totalRooms: { type: Number, default: 1 },
    isActive: { type: Boolean, default: true },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});
roomTypeSchema.index({ accommodationId: 1 });
roomTypeSchema.index({ isActive: 1 });
const RoomType = mongoose.model('RoomType', roomTypeSchema);

// Room Schema - Individual rooms
const roomSchema = new mongoose.Schema({
    _id: String,
    accommodationId: { type: String, required: true },
    roomTypeId: { type: String, required: true },
    roomNumber: { type: String, required: true },
    floor: { type: Number, default: 1 },
    status: {
        type: String,
        enum: ['available', 'occupied', 'maintenance', 'blocked', 'cleaning'],
        default: 'available'
    },
    lastCleaned: Date,
    notes: { type: String },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});
roomSchema.index({ accommodationId: 1, roomNumber: 1 }, { unique: true });
roomSchema.index({ status: 1 });
const Room = mongoose.model('Room', roomSchema);

// Room Booking Schema - For reservations
const roomBookingSchema = new mongoose.Schema({
    _id: String,
    accommodationId: { type: String, required: true },
    roomTypeId: { type: String, required: true },
    roomId: { type: String },
    guestId: { type: String },
    guestName: { type: String, required: true },
    guestEmail: { type: String, required: true },
    guestPhone: { type: String, required: true },
    checkInDate: { type: Date, required: true },
    checkOutDate: { type: Date, required: true },
    numberOfAdults: { type: Number, default: 1 },
    numberOfChildren: { type: Number, default: 0 },
    roomPrice: { type: Number, required: true },
    totalAmount: { type: Number, required: true },
    paidAmount: { type: Number, default: 0 },
    paymentStatus: {
        type: String,
        enum: ['pending', 'partial', 'paid', 'refunded'],
        default: 'pending'
    },
    paymentMethod: { type: String },
    bookingStatus: {
        type: String,
        enum: ['pending', 'confirmed', 'checked-in', 'checked-out', 'cancelled', 'no-show'],
        default: 'pending'
    },
    specialRequests: { type: String },
    dietaryRequirements: { type: String },
    blockedDates: [{
        startDate: Date,
        endDate: Date,
        reason: { type: String, default: 'maintenance' }
    }],
    bookingSource: { type: String, default: 'direct' },
    confirmationNumber: String,
    checkedInAt: Date,
    checkedOutAt: Date,
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});
roomBookingSchema.index({ accommodationId: 1 });
roomBookingSchema.index({ guestId: 1 });
roomBookingSchema.index({ checkInDate: 1, checkOutDate: 1 });
roomBookingSchema.index({ bookingStatus: 1 });
const RoomBooking = mongoose.model('RoomBooking', roomBookingSchema);

// Housekeeping Task Schema
const housekeepingTaskSchema = new mongoose.Schema({
    _id: String,
    accommodationId: { type: String, required: true },
    roomId: { type: String, required: true },
    roomNumber: { type: String, required: true },
    taskType: {
        type: String,
        enum: ['checkout', 'stayover', 'deep-cleaning', 'turnover', 'inspection'],
        required: true
    },
    status: {
        type: String,
        enum: ['pending', 'in-progress', 'completed', 'inspected', 'skipped'],
        default: 'pending'
    },
    priority: {
        type: String,
        enum: ['low', 'medium', 'high', 'urgent'],
        default: 'medium'
    },
    assignedTo: {
        staffId: String,
        staffName: String
    },
    scheduledDate: { type: Date, required: true },
    scheduledTime: { type: String },
    completedAt: Date,
    inspectedAt: Date,
    inspectedBy: String,
    inspectionNotes: { type: String },
    notes: { type: String },
    suppliesNeeded: [{ type: String }],
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});
housekeepingTaskSchema.index({ accommodationId: 1 });
housekeepingTaskSchema.index({ roomId: 1 });
housekeepingTaskSchema.index({ status: 1 });
housekeepingTaskSchema.index({ scheduledDate: 1 });
const HousekeepingTask = mongoose.model('HousekeepingTask', housekeepingTaskSchema);

// Guest History Schema
const guestHistorySchema = new mongoose.Schema({
    _id: String,
    guestId: { type: String },
    guestName: { type: String, required: true },
    guestEmail: { type: String },
    guestPhone: { type: String },
    accommodations: [{
        accommodationId: String,
        accommodationName: String,
        bookingId: String,
        checkInDate: Date,
        checkOutDate: Date,
        roomType: String,
        roomNumber: String,
        totalSpent: Number,
        rating: Number,
        notes: String
    }],
    preferences: {
        preferredRoomType: { type: String },
        floorPreference: { type: String },
        dietaryNeeds: [String],
        specialRequests: [String],
        pillowType: { type: String },
        bedType: { type: String }
    },
    allergies: [String],
    vipStatus: { type: Boolean, default: false },
    vipNotes: { type: String },
    specialNotes: { type: String },
    blacklisted: { type: Boolean, default: false },
    blacklistReason: { type: String },
    totalStays: { type: Number, default: 0 },
    totalNights: { type: Number, default: 0 },
    totalSpent: { type: Number, default: 0 },
    lastStayDate: Date,
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});
guestHistorySchema.index({ guestId: 1 }, { unique: true, sparse: true });
guestHistorySchema.index({ guestEmail: 1 });
guestHistorySchema.index({ guestPhone: 1 });
const GuestHistory = mongoose.model('GuestHistory', guestHistorySchema);

// Site Visitor Tracking Schema
const siteVisitorSchema = new mongoose.Schema({
    sessionId: { type: String, required: true, index: true },
    ipAddress: String,
    userAgent: String,
    referrer: String,
    country: String,
    city: String,
    deviceType: { type: String, enum: ['desktop', 'mobile', 'tablet'], default: 'desktop' },
    browser: String,
    os: String,
    firstVisit: { type: Date, default: Date.now },
    lastVisit: { type: Date, default: Date.now },
    pageViews: { type: Number, default: 1 },
    pagesVisited: [String],
    visitedAt: { type: Date, default: Date.now }
});
siteVisitorSchema.index({ visitedAt: -1 });
siteVisitorSchema.index({ firstVisit: 1 });
const SiteVisitor = mongoose.model('SiteVisitor', siteVisitorSchema);

// Daily Visitor Analytics Schema
const dailyVisitorAnalyticsSchema = new mongoose.Schema({
    _id: { type: String },
    date: { type: Date, required: true, unique: true },
    totalVisitors: { type: Number, default: 0 },
    uniqueVisitors: { type: Number, default: 0 },
    newVisitors: { type: Number, default: 0 },
    returningVisitors: { type: Number, default: 0 },
    pageViews: { type: Number, default: 0 },
    avgSessionDuration: { type: Number, default: 0 },
    bounceRate: { type: Number, default: 0 },
    topPages: [{ page: String, views: Number }],
    topReferrers: [{ source: String, visits: Number }],
    deviceBreakdown: { desktop: Number, mobile: Number, tablet: Number },
    countryBreakdown: [{ country: String, visitors: Number }]
});
dailyVisitorAnalyticsSchema.index({ date: -1 });
const DailyVisitorAnalytics = mongoose.model('DailyVisitorAnalytics', dailyVisitorAnalyticsSchema);

// Staff Schema (for housekeeping)
const accommodationStaffSchema = new mongoose.Schema({
    _id: String,
    accommodationId: { type: String, required: true },
    name: { type: String, required: true },
    role: {
        type: String,
        enum: ['housekeeper', 'supervisor', 'maintenance', 'manager'],
        required: true
    },
    email: { type: String },
    phone: { type: String, required: true },
    isActive: { type: Boolean, default: true },
    assignedAreas: [String],
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});
accommodationStaffSchema.index({ accommodationId: 1 });
accommodationStaffSchema.index({ role: 1 });
const AccommodationStaff = mongoose.model('AccommodationStaff', accommodationStaffSchema);

// SiteContent Schema - For managing website content from admin
const siteContentSchema = new mongoose.Schema({
    _id: String,
    key: { type: String, required: true, unique: true },
    type: {
        type: String,
        enum: ['faq', 'policy', 'info', 'footer', 'about', 'contact'],
        required: true
    },
    title: String,
    content: mongoose.Schema.Types.Mixed, // Can store different content structures
    isActive: { type: Boolean, default: true },
    order: { type: Number, default: 0 },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});
siteContentSchema.index({ key: 1 }, { unique: true });
siteContentSchema.index({ type: 1 });
const SiteContent = mongoose.model('SiteContent', siteContentSchema);

// Footer Contact Info Schema
const footerContentSchema = new mongoose.Schema({
    _id: String,
    restaurantName: { type: String, default: 'The Quill' },
    description: String,
    phone: String,
    email: String,
    address: String,
    operatingHours: String,
    socialLinks: {
        facebook: String,
        instagram: String,
        twitter: String,
        whatsapp: String
    },
    developedBy: {
        name: String,
        email: String,
        whatsapp: String
    },
    copyright: String,
    updatedAt: { type: Date, default: Date.now }
});
const FooterContent = mongoose.model('FooterContent', footerContentSchema);

module.exports = {
    Order,
    Reservation,
    Parking,
    Table,
    TimeSlot,
    Blacklist,
    Review,
    Event,
    SpecialEvent,
    Contact,
    MenuItem,
    Subscriber,
    User,
    Wishlist,
    Cart,
    LoyaltyPoints,
    Coupon,
    Campaign,
    DeliveryPartner,
    Ticket,
    FAQ,
    Partnership,
    Accommodation,
    Complaint,
    Dispute,
    RoomType,
    Room,
    RoomBooking,
    HousekeepingTask,
    GuestHistory,
    AccommodationStaff,
    SiteContent,
    FooterContent,
    SiteVisitor,
    DailyVisitorAnalytics
};
