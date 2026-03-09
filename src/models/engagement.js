const mongoose = require('mongoose');

// Check if Review model already exists to avoid OverwriteModelError
let Review;
if (mongoose.models.Review) {
    Review = mongoose.model('Review');
} else {
    const reviewSchema = new mongoose.Schema({
        _id: String,
        name: String,
        rating: Number,
        comment: String,
        orderId: String,
        userId: String,
        email: String,
        phone: String,
        status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
        isVisible: { type: Boolean, default: false },
        adminReply: String,
        // Automation fields
        reviewRequested: { type: Boolean, default: false },
        reviewRequestSentAt: Date,
        reviewRequestedFrom: { type: String, enum: ['order', 'reservation'], default: 'order' },
        sourceType: { type: String, enum: ['order', 'reservation', 'direct'], default: 'order' },
        isComplaint: { type: Boolean, default: false },
        complaintAlertSent: { type: Boolean, default: false },
        createdAt: { type: Date, default: Date.now },
        updatedAt: { type: Date, default: Date.now }
    });
    Review = mongoose.model('Review', reviewSchema);
}

// Customer Profile Schema - centralized customer data
const customerProfileSchema = new mongoose.Schema({
    _id: String,
    userId: { type: String, default: null },
    email: { type: String, required: true, unique: true },
    phone: { type: String, required: true },
    name: String,
    birthday: Date,
    anniversary: Date,
    preferences: {
        dietaryRestrictions: [String],
        favoriteDishes: [{ type: String }],
        favoriteCategories: [String],
        preferredPaymentMethod: String,
        preferredDeliveryTime: String
    },
    // Engagement metrics
    totalOrders: { type: Number, default: 0 },
    totalSpent: { type: Number, default: 0 },
    averageOrderValue: { type: Number, default: 0 },
    lastOrderDate: Date,
    lastVisitDate: Date,
    visitCount: { type: Number, default: 0 },
    // Segment and tags
    segment: { type: String, enum: ['new', 'regular', 'vip', 'inactive', 'at-risk'], default: 'new' },
    tags: [String],
    // Communication preferences (Kenya PDPA compliance)
    communicationPreferences: {
        emailMarketing: { type: Boolean, default: true },
        smsMarketing: { type: Boolean, default: true },
        pushNotifications: { type: Boolean, default: true },
        reviewRequests: { type: Boolean, default: true },
        loyaltyUpdates: { type: Boolean, default: true },
        birthdayOffers: { type: Boolean, default: true }
    },
    consentDate: Date,
    consentVersion: String,
    // Tracking
    referrerCode: String,
    referredBy: String,
    referralCount: { type: Number, default: 0 },
    firstSeen: { type: Date, default: Date.now },
    lastActive: { type: Date, default: Date.now },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});
customerProfileSchema.index({ email: 1 });
customerProfileSchema.index({ phone: 1 });
customerProfileSchema.index({ segment: 1 });
customerProfileSchema.index({ lastActive: 1 });
const CustomerProfile = mongoose.model('CustomerProfile', customerProfileSchema);

// Check if LoyaltyPoints model already exists to avoid OverwriteModelError
let LoyaltyPoints;
if (mongoose.models.LoyaltyPoints) {
    LoyaltyPoints = mongoose.model('LoyaltyPoints');
} else {
    const loyaltyPointsSchema = new mongoose.Schema({
        _id: String,
        userId: { type: String, required: true },
        customerProfileId: { type: String, default: null },
        points: { type: Number, default: 0 },
        lifetimePoints: { type: Number, default: 0 },
        redeemedPoints: { type: Number, default: 0 },
        tier: { type: String, enum: ['bronze', 'silver', 'gold', 'platinum'], default: 'bronze' },
        tierHistory: [{
            tier: String,
            achievedAt: Date,
            pointsAtTier: Number
        }],
        referralCode: { type: String, unique: true, sparse: true },
        referredBy: String,
        referralBonusEarned: { type: Number, default: 0 },
        pointsHistory: [{
            points: Number,
            type: { type: String, enum: ['earn', 'redeem', 'bonus', 'expire', 'referral', 'birthday', 'review'] },
            description: String,
            orderId: String,
            createdAt: { type: Date, default: Date.now }
        }],
        // Birthday rewards
        birthdayBonusClaimed: { type: Boolean, default: false },
        birthdayBonusYear: Number,
        // Tier benefits
        currentTierBenefits: {
            pointsMultiplier: { type: Number, default: 1 },
            freeDelivery: { type: Boolean, default: false },
            priorityReservation: { type: Boolean, default: false },
            exclusiveOffers: { type: Boolean, default: false }
        },
        createdAt: { type: Date, default: Date.now },
        updatedAt: { type: Date, default: Date.now }
    });
    loyaltyPointsSchema.index({ userId: 1 });
    loyaltyPointsSchema.index({ referralCode: 1 });
    LoyaltyPoints = mongoose.model('LoyaltyPoints', loyaltyPointsSchema);
}

// Check if Campaign model already exists to avoid OverwriteModelError
let Campaign;
if (mongoose.models.Campaign) {
    Campaign = mongoose.model('Campaign');
} else {
    const campaignSchema = new mongoose.Schema({
        _id: String,
        name: { type: String, required: true },
        type: { type: String, enum: ['email', 'sms', 'push', 'promotion', 'automated'], required: true },
        category: { type: String, enum: ['welcome', 'winback', 'reorder', 'birthday', 'review', 'promotional', 'loyalty', 'reservation', 'general'], default: 'general' },
        status: { type: String, enum: ['draft', 'scheduled', 'active', 'paused', 'completed', 'cancelled'], default: 'draft' },

        // Audience targeting
        audience: {
            type: { type: String, enum: ['all', 'segment', 'behavior', 'custom'], default: 'all' },
            segments: [String],
            conditions: {
                minOrders: Number,
                maxOrders: Number,
                minSpent: Number,
                maxSpent: Number,
                daysSinceLastOrder: Number,
                hasBirthdayThisMonth: Boolean,
                tier: [String],
                tags: [String]
            }
        },

        // Campaign content
        subject: String,
        preheader: String,
        message: String,
        htmlContent: String,
        templateId: String,

        // Links and CTA
        ctaButton: {
            text: String,
            url: String,
            type: { type: String, enum: ['order', 'reserve', 'review', 'website', 'custom'], default: 'order' }
        },

        // Offer details
        offer: {
            type: { type: String, enum: ['none', 'percentage', 'fixed', 'free_item', 'points'], default: 'none' },
            value: Number,
            minOrderAmount: Number,
            code: String,
            expiresAt: Date
        },

        // Scheduling
        schedule: {
            sendAt: Date,
            timezone: { type: String, default: 'Africa/Nairobi' },
            recurrence: { type: String, enum: ['once', 'daily', 'weekly', 'monthly'], default: 'once' },
            endDate: Date
        },

        // Automation triggers
        automation: {
            enabled: { type: Boolean, default: false },
            trigger: {
                type: { type: String, enum: ['order_completed', 'first_order', 'order_placed', 'reservation_made', 'birthday', 'inactive_days', 'review_received', 'tier_upgraded', 'points_earned', 'custom'], default: 'custom' },
                delay: {
                    value: Number,
                    unit: { type: String, enum: ['minutes', 'hours', 'days'], default: 'hours' }
                },
                condition: String
            }
        },

        // Tracking
        sentCount: { type: Number, default: 0 },
        deliveredCount: { type: Number, default: 0 },
        openedCount: { type: Number, default: 0 },
        clickedCount: { type: Number, default: 0 },
        convertedCount: { type: Number, default: 0 },
        revenueGenerated: { type: Number, default: 0 },

        // Metrics
        openRate: { type: Number, default: 0 },
        clickRate: { type: Number, default: 0 },
        conversionRate: { type: Number, default: 0 },

        // Timing
        startDate: Date,
        endDate: Date,
        sentAt: Date,

        createdBy: String,
        createdAt: { type: Date, default: Date.now },
        updatedAt: { type: Date, default: Date.now }
    });
    campaignSchema.index({ status: 1 });
    campaignSchema.index({ category: 1 });
    campaignSchema.index({ 'automation.enabled': 1 });
    Campaign = mongoose.model('Campaign', campaignSchema);
}

// Campaign Message Log
const campaignLogSchema = new mongoose.Schema({
    _id: String,
    campaignId: { type: String, required: true },
    customerId: { type: String, required: true },
    customerEmail: String,
    customerPhone: String,
    channel: { type: String, enum: ['email', 'sms', 'push'], default: 'email' },
    status: { type: String, enum: ['queued', 'sent', 'delivered', 'opened', 'clicked', 'failed', 'unsubscribed'], default: 'queued' },
    sentAt: Date,
    deliveredAt: Date,
    openedAt: Date,
    clickedAt: Date,
    error: String,
    metadata: mongoose.Schema.Types.Mixed,
    createdAt: { type: Date, default: Date.now }
});
campaignLogSchema.index({ campaignId: 1 });
campaignLogSchema.index({ customerId: 1 });
campaignLogSchema.index({ status: 1 });
const CampaignLog = mongoose.model('CampaignLog', campaignLogSchema);

// Review Follow-up Schema
const reviewFollowUpSchema = new mongoose.Schema({
    _id: String,
    orderId: { type: String, required: true },
    customerId: { type: String, required: true },
    customerEmail: String,
    customerPhone: String,
    customerName: String,
    // Request tracking
    requestSent: { type: Boolean, default: false },
    requestSentAt: Date,
    requestChannel: { type: String, enum: ['email', 'sms', 'both'], default: 'email' },
    requestTemplate: String,
    // Response tracking
    reviewReceived: { type: Boolean, default: false },
    reviewId: String,
    rating: Number,
    comment: String,
    // Routing
    isPositive: { type: Boolean, default: false },
    routedToReviewSite: { type: Boolean, default: false },
    routedToReviewSiteAt: Date,
    reviewSiteUrl: String,
    // Complaint handling
    isComplaint: { type: Boolean, default: false },
    complaintAlertSent: { type: Boolean, default: false },
    complaintAlertSentAt: Date,
    complaintAcknowledged: { type: Boolean, default: false },
    // Status
    status: { type: String, enum: ['pending', 'sent', 'received', 'complaint', 'resolved'], default: 'pending' },
    followUpCount: { type: Number, default: 0 },
    lastFollowUpAt: Date,
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});
reviewFollowUpSchema.index({ orderId: 1 }, { unique: true });
reviewFollowUpSchema.index({ customerId: 1 });
reviewFollowUpSchema.index({ status: 1 });
const ReviewFollowUp = mongoose.model('ReviewFollowUp', reviewFollowUpSchema);

// Marketing Automation Template
const automationTemplateSchema = new mongoose.Schema({
    _id: String,
    name: { type: String, required: true },
    category: { type: String, enum: ['welcome', 'winback', 'reorder', 'birthday', 'review', 'loyalty', 'reservation', 'anniversary', 'custom'], required: true },
    description: String,
    isActive: { type: Boolean, default: true },
    isDefault: { type: Boolean, default: false },

    // Steps in the automation
    steps: [{
        stepNumber: Number,
        name: String,
        delay: {
            value: Number,
            unit: { type: String, enum: ['minutes', 'hours', 'days'], default: 'hours' }
        },
        channel: { type: String, enum: ['email', 'sms', 'push'], default: 'email' },
        subject: String,
        message: String,
        htmlContent: String,
        ctaButton: {
            text: String,
            url: String
        },
        conditions: {
            ifOpened: Boolean,
            ifClicked: Boolean,
            ifNotOpened: Boolean
        }
    }],

    // Entry conditions
    entryConditions: {
        customerSegment: [String],
        minOrders: Number,
        minSpent: Number,
        daysSinceRegistration: Number,
        daysSinceLastOrder: Number,
        hasBirthday: Boolean
    },

    // Exit conditions
    exitConditions: {
        afterSteps: Number,
        afterConversion: Boolean,
        afterDays: Number
    },

    // Metrics
    triggeredCount: { type: Number, default: 0 },
    completedCount: { type: Number, default: 0 },
    convertedCount: { type: Number, default: 0 },

    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});
automationTemplateSchema.index({ category: 1 });
automationTemplateSchema.index({ isActive: 1 });
const AutomationTemplate = mongoose.model('AutomationTemplate', automationTemplateSchema);

// Customer Activity Log for analytics
const customerActivitySchema = new mongoose.Schema({
    _id: String,
    customerId: { type: String, required: true },
    activityType: {
        type: String,
        enum: [
            'order_placed', 'order_completed', 'order_cancelled',
            'reservation_made', 'reservation_completed', 'reservation_cancelled',
            'review_submitted', 'review_positive', 'review_negative',
            'campaign_received', 'campaign_opened', 'campaign_clicked',
            'loyalty_earned', 'loyalty_redeemed', 'tier_upgraded',
            'birthday_claimed', 'referral_made', 'referral_earned',
            'login', 'profile_updated', 'preferences_updated'
        ],
        required: true
    },
    metadata: mongoose.Schema.Types.Mixed,
    channel: { type: String, enum: ['email', 'sms', 'push', 'website', 'app'], default: 'website' },
    source: String,
    createdAt: { type: Date, default: Date.now }
});
customerActivitySchema.index({ customerId: 1 });
customerActivitySchema.index({ activityType: 1 });
customerActivitySchema.index({ createdAt: -1 });
const CustomerActivity = mongoose.model('CustomerActivity', customerActivitySchema);

// Kenya PDPA Consent Schema
const consentSchema = new mongoose.Schema({
    _id: String,
    customerId: { type: String, required: true },
    customerEmail: String,
    customerPhone: String,
    consents: {
        dataProcessing: { type: Boolean, default: false, date: Date },
        marketingEmails: { type: Boolean, default: false, date: Date },
        marketingSMS: { type: Boolean, default: false, date: Date },
        marketingPush: { type: Boolean, default: false, date: Date },
        thirdPartySharing: { type: Boolean, default: false, date: Date },
        profiling: { type: Boolean, default: false, date: Date },
        dataRetention: { type: Boolean, default: false, date: Date }
    },
    consentVersion: String,
    ipAddress: String,
    userAgent: String,
    privacyPolicyUrl: String,
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});
consentSchema.index({ customerId: 1 }, { unique: true });
const Consent = mongoose.model('Consent', consentSchema);

// Analytics aggregated data
const engagementAnalyticsSchema = new mongoose.Schema({
    _id: String,
    date: { type: Date, required: true },
    // Customer metrics
    newCustomers: { type: Number, default: 0 },
    returningCustomers: { type: Number, default: 0 },
    activeCustomers: { type: Number, default: 0 },
    atRiskCustomers: { type: Number, default: 0 },
    churnedCustomers: { type: Number, default: 0 },
    // Engagement metrics
    totalEmailsSent: { type: Number, default: 0 },
    totalEmailsOpened: { type: Number, default: 0 },
    totalEmailsClicked: { type: Number, default: 0 },
    totalSMSSent: { type: Number, default: 0 },
    totalSMSDelivered: { type: Number, default: 0 },
    // Review metrics
    reviewsRequested: { type: Number, default: 0 },
    reviewsReceived: { type: Number, default: 0 },
    positiveReviews: { type: Number, default: 0 },
    negativeReviews: { type: Number, default: 0 },
    complaintsReceived: { type: Number, default: 0 },
    // Loyalty metrics
    pointsEarned: { type: Number, default: 0 },
    pointsRedeemed: { type: Number, default: 0 },
    newTierUpgrades: { type: Number, default: 0 },
    birthdayRewardsClaimed: { type: Number, default: 0 },
    referralBonusesGiven: { type: Number, default: 0 },
    // Campaign metrics
    campaignsSent: { type: Number, default: 0 },
    campaignConversions: { type: Number, default: 0 },
    campaignRevenue: { type: Number, default: 0 },
    createdAt: { type: Date, default: Date.now }
});
engagementAnalyticsSchema.index({ date: -1 });
const EngagementAnalytics = mongoose.model('EngagementAnalytics', engagementAnalyticsSchema);

module.exports = {
    Review,
    CustomerProfile,
    LoyaltyPoints,
    Campaign,
    CampaignLog,
    ReviewFollowUp,
    AutomationTemplate,
    CustomerActivity,
    Consent,
    EngagementAnalytics
};
