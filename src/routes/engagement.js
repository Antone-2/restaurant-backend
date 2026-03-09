const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { requireAdmin, authenticateToken, getMongoConnected } = require('../middleware/auth');
const engagementService = require('../services/engagement');
const { emitToRoom } = require('../utils/socket');
const {
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
} = require('../models/engagement');

// ===== REVIEW MANAGEMENT =====

// Get all reviews with filters
router.get('/reviews', async (req, res) => {
    try {
        if (!getMongoConnected()) return res.json([]);

        const { status, isComplaint, startDate, endDate } = req.query;
        let query = {};

        if (status && status !== 'all') query.status = status;
        if (isComplaint === 'true') query.isComplaint = true;

        if (startDate || endDate) {
            query.createdAt = {};
            if (startDate) query.createdAt.$gte = new Date(startDate);
            if (endDate) query.createdAt.$lte = new Date(endDate);
        }

        const reviews = await Review.find(query).sort({ createdAt: -1 });
        res.json(reviews);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get single review
router.get('/reviews/:id', async (req, res) => {
    try {
        if (!getMongoConnected()) return res.status(503).json({ error: 'Database unavailable' });

        const review = await Review.findById(req.params.id);
        if (!review) return res.status(404).json({ error: 'Review not found' });

        res.json(review);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Submit a review (public endpoint)
router.post('/reviews', async (req, res) => {
    try {
        const { name, rating, comment, orderId, userId, email, phone } = req.body;

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
            phone,
            status: 'pending',
            isVisible: false,
            isComplaint: rating <= 2
        });

        await review.save();

        // Process the review (route to review sites or alert management)
        await engagementService.processReview({
            orderId,
            rating,
            comment,
            customerEmail: email,
            customerPhone: phone,
            customerName: name
        });

        // Log activity
        if (userId || orderId) {
            await engagementService.logActivity(
                userId || orderId,
                rating >= 4 ? 'review_positive' : 'review_negative',
                { rating, comment }
            );
        }

        // Emit to admin
        emitToRoom('admin', 'review:new', {
            reviewId,
            name,
            rating,
            comment,
            isComplaint: rating <= 2,
            createdAt: review.createdAt
        });

        res.status(201).json({
            message: rating >= 4
                ? 'Thank you for your feedback!'
                : 'We apologize for your experience. We will contact you shortly.',
            reviewId
        });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// Update review status (admin)
router.put('/reviews/:id/status', requireAdmin, async (req, res) => {
    try {
        const { status, adminReply } = req.body;

        if (!status) {
            return res.status(400).json({ error: 'Status is required' });
        }

        const updateData = {
            status,
            isVisible: status === 'approved',
            updatedAt: new Date()
        };

        if (adminReply !== undefined) {
            updateData.adminReply = adminReply;
        }

        const review = await Review.findByIdAndUpdate(
            req.params.id,
            updateData,
            { new: true }
        );

        if (!review) {
            return res.status(404).json({ error: 'Review not found' });
        }

        emitToAll('review:updated', {
            reviewId: req.params.id,
            status,
            isVisible: review.isVisible
        });

        res.json({ message: 'Review status updated', review });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// Get review follow-ups
router.get('/reviews/followups', requireAdmin, async (req, res) => {
    try {
        if (!getMongoConnected()) return res.json([]);

        const { status } = req.query;
        let query = {};
        if (status && status !== 'all') query.status = status;

        const followUps = await ReviewFollowUp.find(query).sort({ createdAt: -1 });
        res.json(followUps);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Send review request (manual)
router.post('/reviews/:orderId/request', requireAdmin, async (req, res) => {
    try {
        const { channel = 'email' } = req.body;

        const followUp = await ReviewFollowUp.findOne({ orderId: req.params.orderId });
        if (!followUp) {
            return res.status(404).json({ error: 'Review follow-up not found' });
        }

        const result = await engagementService.sendReviewRequest(followUp._id, channel);

        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ===== CUSTOMER PROFILES =====

// Get all customers
router.get('/customers', requireAdmin, async (req, res) => {
    try {
        if (!getMongoConnected()) return res.json([]);

        const { segment, search, page = 1, limit = 20 } = req.query;
        let query = {};

        if (segment && segment !== 'all') query.segment = segment;

        if (search) {
            query.$or = [
                { name: { $regex: search, $options: 'i' } },
                { email: { $regex: search, $options: 'i' } },
                { phone: { $regex: search, $options: 'i' } }
            ];
        }

        const skip = (parseInt(page) - 1) * parseInt(limit);

        const [customers, total] = await Promise.all([
            CustomerProfile.find(query)
                .skip(skip)
                .limit(parseInt(limit))
                .sort({ lastActive: -1 }),
            CustomerProfile.countDocuments(query)
        ]);

        res.json({
            customers,
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

// Get single customer
router.get('/customers/:id', requireAdmin, async (req, res) => {
    try {
        if (!getMongoConnected()) return res.status(503).json({ error: 'Database unavailable' });

        const customer = await CustomerProfile.findById(req.params.id);
        if (!customer) return res.status(404).json({ error: 'Customer not found' });

        // Get loyalty data
        const loyalty = await LoyaltyPoints.findOne({ customerProfileId: req.params.id });

        // Get recent activity
        const activity = await CustomerActivity.find({ customerId: req.params.id })
            .limit(20)
            .sort({ createdAt: -1 });

        res.json({ customer, loyalty, activity });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Create/update customer (from order)
router.post('/customers', async (req, res) => {
    try {
        const { email, phone, userId, name, birthday } = req.body;

        if (!email || !phone) {
            return res.status(400).json({ error: 'Email and phone are required' });
        }

        const profile = await engagementService.upsertCustomerProfile({
            email,
            phone,
            userId,
            name,
            birthday
        });

        if (!profile) {
            return res.status(500).json({ error: 'Failed to create customer profile' });
        }

        // Ensure loyalty account
        await engagementService.getOrCreateLoyaltyAccount(profile._id, userId);

        res.json({ customerId: profile._id, message: 'Customer profile created/updated' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Update customer segment manually
router.put('/customers/:id/segment', requireAdmin, async (req, res) => {
    try {
        const { segment } = req.body;

        if (!segment) {
            return res.status(400).json({ error: 'Segment is required' });
        }

        const customer = await CustomerProfile.findByIdAndUpdate(
            req.params.id,
            { segment, updatedAt: new Date() },
            { new: true }
        );

        if (!customer) {
            return res.status(404).json({ error: 'Customer not found' });
        }

        res.json({ message: 'Segment updated', customer });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Update customer communication preferences
router.put('/customers/:id/preferences', async (req, res) => {
    try {
        const { communicationPreferences } = req.body;

        const customer = await CustomerProfile.findByIdAndUpdate(
            req.params.id,
            { communicationPreferences, updatedAt: new Date() },
            { new: true }
        );

        if (!customer) {
            return res.status(404).json({ error: 'Customer not found' });
        }

        res.json({ message: 'Preferences updated', customer });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get customer activity
router.get('/customers/:id/activity', requireAdmin, async (req, res) => {
    try {
        if (!getMongoConnected()) return res.json([]);

        const { type, limit = 50 } = req.query;
        let query = { customerId: req.params.id };

        if (type) {
            query.activityType = type;
        }

        const activity = await CustomerActivity.find(query)
            .limit(parseInt(limit))
            .sort({ createdAt: -1 });

        res.json(activity);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ===== LOYALTY PROGRAM =====

// Get loyalty data for a customer
router.get('/loyalty/:customerId', async (req, res) => {
    try {
        if (!getMongoConnected()) {
            return res.json({ points: 0, tier: 'bronze', lifetimePoints: 0, pointsHistory: [] });
        }

        let loyalty = await LoyaltyPoints.findOne({ customerProfileId: req.params.customerId });

        if (!loyalty) {
            // Create new loyalty account
            loyalty = await engagementService.getOrCreateLoyaltyAccount(req.params.customerId, null);
        }

        if (!loyalty) {
            return res.status(404).json({ error: 'Loyalty account not found' });
        }

        res.json({
            points: loyalty.points,
            tier: loyalty.tier,
            lifetimePoints: loyalty.lifetimePoints,
            referralCode: loyalty.referralCode,
            pointsHistory: loyalty.pointsHistory || [],
            currentTierBenefits: loyalty.currentTierBenefits,
            birthdayBonusClaimed: loyalty.birthdayBonusClaimed,
            birthdayBonusYear: loyalty.birthdayBonusYear
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Earn points (called after order completion)
router.post('/loyalty/earn', async (req, res) => {
    try {
        const { customerId, orderId, orderTotal } = req.body;

        if (!customerId || !orderTotal) {
            return res.status(400).json({ error: 'Customer ID and order total are required' });
        }

        const result = await engagementService.awardPoints(customerId, orderId, orderTotal);

        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Redeem points
router.post('/loyalty/redeem', async (req, res) => {
    try {
        const { customerId, points, description } = req.body;

        if (!customerId || !points || points <= 0) {
            return res.status(400).json({ error: 'Valid customer ID and points amount are required' });
        }

        const result = await engagementService.redeemPoints(customerId, points, description);

        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Apply referral code
router.post('/loyalty/referral/apply', async (req, res) => {
    try {
        const { referralCode, newCustomerId } = req.body;

        if (!referralCode || !newCustomerId) {
            return res.status(400).json({ error: 'Referral code and new customer ID are required' });
        }

        const result = await engagementService.awardReferralBonus(referralCode, newCustomerId);

        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get all loyalty members (admin)
router.get('/loyalty', requireAdmin, async (req, res) => {
    try {
        if (!getMongoConnected()) return res.json([]);

        const { tier, search, page = 1, limit = 20 } = req.query;
        let query = {};

        if (tier && tier !== 'all') query.tier = tier;

        const skip = (parseInt(page) - 1) * parseInt(limit);

        const [members, total] = await Promise.all([
            LoyaltyPoints.find(query)
                .populate('customerProfileId', 'name email phone')
                .skip(skip)
                .limit(parseInt(limit))
                .sort({ lifetimePoints: -1 }),
            LoyaltyPoints.countDocuments(query)
        ]);

        res.json({
            members,
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

// ===== CAMPAIGNS =====

// Get all campaigns
router.get('/campaigns', requireAdmin, async (req, res) => {
    try {
        if (!getMongoConnected()) return res.json([]);

        const { status, category, page = 1, limit = 20 } = req.query;
        let query = {};

        if (status && status !== 'all') query.status = status;
        if (category && category !== 'all') query.category = category;

        const skip = (parseInt(page) - 1) * parseInt(limit);

        const [campaigns, total] = await Promise.all([
            Campaign.find(query)
                .skip(skip)
                .limit(parseInt(limit))
                .sort({ createdAt: -1 }),
            Campaign.countDocuments(query)
        ]);

        res.json({
            campaigns,
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

// Get single campaign
router.get('/campaigns/:id', requireAdmin, async (req, res) => {
    try {
        if (!getMongoConnected()) return res.status(503).json({ error: 'Database unavailable' });

        const campaign = await Campaign.findById(req.params.id);
        if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

        // Get campaign logs
        const logs = await CampaignLog.find({ campaignId: req.params.id })
            .limit(100)
            .sort({ createdAt: -1 });

        res.json({ campaign, logs });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Create campaign
router.post('/campaigns', requireAdmin, async (req, res) => {
    try {
        const campaignData = req.body;
        const campaignId = 'CAMP-' + uuidv4().substring(0, 8).toUpperCase();

        const campaign = new Campaign({
            _id: campaignId,
            ...campaignData,
            status: campaignData.status || 'draft',
            createdBy: req.user?.userId,
            createdAt: new Date()
        });

        await campaign.save();

        res.status(201).json({ message: 'Campaign created', campaignId });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// Update campaign
router.put('/campaigns/:id', requireAdmin, async (req, res) => {
    try {
        const campaign = await Campaign.findByIdAndUpdate(
            req.params.id,
            { ...req.body, updatedAt: new Date() },
            { new: true }
        );

        if (!campaign) {
            return res.status(404).json({ error: 'Campaign not found' });
        }

        res.json({ message: 'Campaign updated', campaign });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// Send campaign now
router.post('/campaigns/:id/send', requireAdmin, async (req, res) => {
    try {
        // Update status to active
        await Campaign.findByIdAndUpdate(req.params.id, { status: 'active' });

        const result = await engagementService.sendCampaign(req.params.id);

        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Schedule campaign
router.post('/campaigns/:id/schedule', requireAdmin, async (req, res) => {
    try {
        const { sendAt } = req.body;

        if (!sendAt) {
            return res.status(400).json({ error: 'Send date/time is required' });
        }

        const campaign = await Campaign.findByIdAndUpdate(
            req.params.id,
            {
                status: 'scheduled',
                'schedule.sendAt': new Date(sendAt),
                updatedAt: new Date()
            },
            { new: true }
        );

        if (!campaign) {
            return res.status(404).json({ error: 'Campaign not found' });
        }

        res.json({ message: 'Campaign scheduled', campaign });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// Get campaign logs
router.get('/campaigns/:id/logs', requireAdmin, async (req, res) => {
    try {
        if (!getMongoConnected()) return res.json([]);

        const { status, page = 1, limit = 50 } = req.query;
        let query = { campaignId: req.params.id };

        if (status && status !== 'all') query.status = status;

        const skip = (parseInt(page) - 1) * parseInt(limit);

        const [logs, total] = await Promise.all([
            CampaignLog.find(query)
                .skip(skip)
                .limit(parseInt(limit))
                .sort({ createdAt: -1 }),
            CampaignLog.countDocuments(query)
        ]);

        res.json({
            logs,
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

// ===== ANALYTICS =====

// Get engagement analytics
router.get('/analytics', requireAdmin, async (req, res) => {
    try {
        if (!getMongoConnected()) return res.json({});

        const { startDate, endDate, period = 'month' } = req.query;

        let start = new Date();
        if (period === 'day') {
            start.setDate(start.getDate() - 7);
        } else if (period === 'week') {
            start.setDate(start.getDate() - 28);
        } else {
            start.setDate(start.getDate() - 365);
        }

        const end = new Date();

        const analytics = await engagementService.getEngagementAnalytics(start, end);

        // Get summary stats
        const [
            totalCustomers,
            activeCustomers,
            avgOrderValue,
            totalReviews,
            positiveReviewRate,
            campaignStats
        ] = await Promise.all([
            CustomerProfile.countDocuments(),
            CustomerProfile.countDocuments({
                lastActive: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }
            }),
            CustomerProfile.aggregate([
                { $group: { _id: null, avg: { $avg: '$averageOrderValue' } } }
            ]),
            Review.countDocuments(),
            Review.aggregate([
                { $match: { rating: { $gte: 4 } } },
                { $count: 'positive' }
            ]),
            Campaign.aggregate([
                {
                    $group: {
                        _id: null,
                        totalSent: { $sum: '$sentCount' },
                        totalOpened: { $sum: '$openedCount' },
                        totalClicked: { $sum: '$clickedCount' }
                    }
                }
            ])
        ]);

        const positive = positiveReviewRate[0]?.positive || 0;

        res.json({
            analytics,
            summary: {
                totalCustomers,
                activeCustomers,
                avgOrderValue: avgOrderValue[0]?.avg || 0,
                totalReviews,
                positiveReviewRate: totalReviews > 0 ? (positive / totalReviews * 100).toFixed(1) : 0,
                emailCampaigns: {
                    sent: campaignStats[0]?.totalSent || 0,
                    opened: campaignStats[0]?.totalOpened || 0,
                    clicked: campaignStats[0]?.totalClicked || 0
                }
            }
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get customer segments breakdown
router.get('/analytics/segments', requireAdmin, async (req, res) => {
    try {
        if (!getMongoConnected()) return res.json([]);

        const segments = await CustomerProfile.aggregate([
            { $group: { _id: '$segment', count: { $sum: 1 } } }
        ]);

        res.json(segments);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ===== AUTOMATION TEMPLATES =====

// Get automation templates
router.get('/automations', requireAdmin, async (req, res) => {
    try {
        if (!getMongoConnected()) return res.json([]);

        const { category, isActive } = req.query;
        let query = {};

        if (category) query.category = category;
        if (isActive !== undefined) query.isActive = isActive === 'true';

        const automations = await AutomationTemplate.find(query)
            .sort({ category: 1, createdAt: -1 });

        res.json(automations);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Create automation template
router.post('/automations', requireAdmin, async (req, res) => {
    try {
        const automationId = 'AUTO-' + uuidv4().substring(0, 8).toUpperCase();

        const automation = new AutomationTemplate({
            _id: automationId,
            ...req.body,
            createdAt: new Date()
        });

        await automation.save();

        res.status(201).json({ message: 'Automation created', automationId });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// Update automation template
router.put('/automations/:id', requireAdmin, async (req, res) => {
    try {
        const automation = await AutomationTemplate.findByIdAndUpdate(
            req.params.id,
            { ...req.body, updatedAt: new Date() },
            { new: true }
        );

        if (!automation) {
            return res.status(404).json({ error: 'Automation not found' });
        }

        res.json({ message: 'Automation updated', automation });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// ===== CONSENT (Kenya PDPA) =====

// Record consent
router.post('/consent', async (req, res) => {
    try {
        const { customerId, customerEmail, customerPhone, consents, consentVersion } = req.body;

        if (!customerId || !consents) {
            return res.status(400).json({ error: 'Customer ID and consents are required' });
        }

        const consentId = 'CONS-' + uuidv4().substring(0, 8);

        const consent = new Consent({
            _id: consentId,
            customerId,
            customerEmail,
            customerPhone,
            consents: {
                dataProcessing: consents.dataProcessing || false,
                marketingEmails: consents.marketingEmails || false,
                marketingSMS: consents.marketingSMS || false,
                marketingPush: consents.marketingPush || false,
                thirdPartySharing: consents.thirdPartySharing || false,
                profiling: consents.profiling || false,
                dataRetention: consents.dataRetention || false
            },
            consentVersion: consentVersion || '1.0',
            ipAddress: req.ip,
            userAgent: req.get('User-Agent'),
            createdAt: new Date()
        });

        await consent.save();

        // Update customer preferences
        if (customerId) {
            await CustomerProfile.findByIdAndUpdate(customerId, {
                communicationPreferences: {
                    emailMarketing: consents.marketingEmails || false,
                    smsMarketing: consents.marketingSMS || false,
                    pushNotifications: consents.marketingPush || false,
                    reviewRequests: true,
                    loyaltyUpdates: true,
                    birthdayOffers: consents.marketingEmails || false
                },
                consentDate: new Date(),
                consentVersion: consentVersion || '1.0',
                updatedAt: new Date()
            });
        }

        res.status(201).json({ message: 'Consent recorded', consentId });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// Get customer consent
router.get('/consent/:customerId', async (req, res) => {
    try {
        if (!getMongoConnected()) return res.status(503).json({ error: 'Database unavailable' });

        const consent = await Consent.findOne({ customerId: req.params.customerId });

        if (!consent) {
            return res.status(404).json({ error: 'Consent not found' });
        }

        res.json(consent);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
