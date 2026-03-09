const { v4: uuidv4 } = require('uuid');
const { sendEmailNotification } = require('./email');
const { sendSMS } = require('./sms');
const { logger, config } = require('../config');
const {
    CustomerProfile,
    LoyaltyPoints,
    Campaign,
    CampaignLog,
    ReviewFollowUp,
    AutomationTemplate,
    CustomerActivity,
    Consent,
    EngagementAnalytics,
    Review
} = require('../models/engagement');

// ===== REVIEW MANAGEMENT =====

/**
 * Create a review follow-up after order completion
 */
const createReviewFollowUp = async (orderData) => {
    try {
        const { orderId, customerId, customerEmail, customerPhone, customerName, total } = orderData;

        // Check if follow-up already exists
        const existing = await ReviewFollowUp.findOne({ orderId });
        if (existing) {
            return { success: false, message: 'Follow-up already exists' };
        }

        const followUpId = 'REVFU-' + uuidv4().substring(0, 8).toUpperCase();

        const followUp = new ReviewFollowUp({
            _id: followUpId,
            orderId,
            customerId,
            customerEmail,
            customerPhone,
            customerName,
            status: 'pending'
        });

        await followUp.save();

        // Schedule the review request (immediate for now)
        await sendReviewRequest(followUpId);

        return { success: true, followUpId };
    } catch (error) {
        logger.error('Create review follow-up error:', error);
        return { success: false, error: error.message };
    }
};

/**
 * Send review request to customer
 */
const sendReviewRequest = async (followUpId, channel = 'email') => {
    try {
        const followUp = await ReviewFollowUp.findById(followUpId);
        if (!followUp) {
            return { success: false, error: 'Follow-up not found' };
        }

        if (followUp.requestSent) {
            return { success: false, message: 'Request already sent' };
        }

        let emailResult = null;
        let smsResult = null;

        // Send email
        if (channel === 'email' || channel === 'both') {
            const emailSubject = 'How was your recent experience at The Quill? 🍽️';
            const emailHtml = `
                <div style="text-align: center; padding: 20px;">
                    <h2 style="color: #1a1a2e;">Thank you for dining with us, ${followUp.customerName || 'Guest'}!</h2>
                    <p>We hope you enjoyed your recent visit to The Quill.</p>
                    <p>Your feedback helps us continue to serve you better.</p>
                    <p style="margin: 30px 0;">
                        <a href="${process.env.FRONTEND_URL || 'http://localhost:5173'}/review?order=${followUp.orderId}" 
                           style="background: #f59e0b; color: white; padding: 15px 30px; text-decoration: none; border-radius: 8px; font-weight: bold;">
                            Share Your Feedback
                        </a>
                    </p>
                    <p style="font-size: 12px; color: #666;">
                        It only takes a minute and means the world to us!
                    </p>
                </div>
            `;

            emailResult = await sendEmailNotification(followUp.customerEmail, emailSubject, emailHtml);
        }

        // Send SMS
        if (channel === 'sms' || channel === 'both') {
            const smsMessage = `Hi ${followUp.customerName || 'Guest'}! Thank you for visiting The Quill. We'd love to hear about your experience. Share your feedback: ${process.env.FRONTEND_URL || 'http://bit.ly/thequill-review'}`;
            smsResult = await sendSMS(followUp.customerPhone, smsMessage);
        }

        // Update follow-up
        followUp.requestSent = true;
        followUp.requestSentAt = new Date();
        followUp.requestChannel = channel;
        followUp.status = 'sent';
        followUp.followUpCount = 1;
        followUp.lastFollowUpAt = new Date();
        await followUp.save();

        return { success: true, emailResult, smsResult };
    } catch (error) {
        logger.error('Send review request error:', error);
        return { success: false, error: error.message };
    }
};

/**
 * Process incoming review and route accordingly
 */
const processReview = async (reviewData) => {
    try {
        const { orderId, rating, comment, customerEmail, customerPhone, customerName } = reviewData;

        // Find the follow-up
        const followUp = await ReviewFollowUp.findOne({ orderId });

        const isPositive = rating >= 4;

        // Update follow-up
        if (followUp) {
            followUp.reviewReceived = true;
            followUp.rating = rating;
            followUp.comment = comment;
            followUp.isPositive = isPositive;
            followUp.status = isPositive ? 'received' : 'complaint';
            followUp.updatedAt = new Date();
            await followUp.save();
        }

        // If positive (4-5 stars), route to review sites
        if (isPositive && rating >= 5) {
            // Send to public review sites (simulated)
            await sendPositiveReviewRequest(followUp);
        } else if (rating <= 2) {
            // If negative, alert management
            await sendComplaintAlert(reviewData);
        }

        // Log activity
        await logActivity(followUp?.customerId || 'unknown', isPositive ? 'review_positive' : 'review_negative', {
            orderId,
            rating,
            comment
        });

        return { success: true, isPositive };
    } catch (error) {
        logger.error('Process review error:', error);
        return { success: false, error: error.message };
    }
};

/**
 * Send positive review to public sites
 */
const sendPositiveReviewRequest = async (followUp) => {
    if (!followUp) return;

    try {
        const reviewSites = [
            { name: 'Google', url: 'https://g.page/rate/replace-with-your-place-id' },
            { name: 'TripAdvisor', url: 'https://www.tripadvisor.com/Restaurant_Review' },
            { name: 'Facebook', url: 'https://facebook.com/thequill/reviews' }
        ];

        const emailSubject = 'Would you recommend us? 🌟';
        const emailHtml = `
            <div style="text-align: center; padding: 20px;">
                <h2 style="color: #1a1a2e;">We're thrilled you enjoyed your visit!</h2>
                <p>Would you take a moment to share your experience on these platforms?</p>
                <div style="margin: 30px 0;">
                    ${reviewSites.map(site => `
                        <a href="${site.url}" 
                           style="display: inline-block; background: #f59e0b; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin: 5px;">
                            Review on ${site.name}
                        </a>
                    `).join('')}
                </div>
                <p style="font-size: 12px; color: #666;">
                    Thank you for supporting The Quill!
                </p>
            </div>
        `;

        await sendEmailNotification(followUp.customerEmail, emailSubject, emailHtml);

        followUp.routedToReviewSite = true;
        followUp.routedToReviewSiteAt = new Date();
        await followUp.save();

        return { success: true };
    } catch (error) {
        logger.error('Send positive review request error:', error);
        return { success: false, error: error.message };
    }
};

/**
 * Send complaint alert to management
 */
const sendComplaintAlert = async (reviewData) => {
    try {
        const { orderId, customerName, customerEmail, customerPhone, rating, comment } = reviewData;

        // Alert admin via socket
        const { emitToRoom } = require('../utils/socket');
        emitToRoom('admin', 'complaint:new', {
            orderId,
            customerName,
            customerEmail,
            customerPhone,
            rating,
            comment,
            timestamp: new Date()
        });

        // Log the complaint
        const followUp = await ReviewFollowUp.findOne({ orderId });
        if (followUp) {
            followUp.isComplaint = true;
            followUp.complaintAlertSent = true;
            followUp.complaintAlertSentAt = new Date();
            await followUp.save();
        }

        // Notify management via email
        if (config.adminEmail) {
            const adminEmailSubject = `⚠️ URGENT: Customer Complaint - Order ${orderId}`;
            const adminEmailHtml = `
                <div style="background: #fee2e2; padding: 20px; border-radius: 8px;">
                    <h3 style="color: #dc2626;">New Customer Complaint</h3>
                    <p><strong>Order:</strong> ${orderId}</p>
                    <p><strong>Customer:</strong> ${customerName}</p>
                    <p><strong>Email:</strong> ${customerEmail}</p>
                    <p><strong>Phone:</strong> ${customerPhone}</p>
                    <p><strong>Rating:</strong> ${rating}/5</p>
                    <p><strong>Comment:</strong> ${comment}</p>
                    <p><em>Please respond within 24 hours.</em></p>
                </div>
            `;
            await sendEmailNotification(config.adminEmail, adminEmailSubject, adminEmailHtml);
        }

        logger.warn(`Complaint alert sent for order ${orderId}`);
        return { success: true };
    } catch (error) {
        logger.error('Send complaint alert error:', error);
        return { success: false, error: error.message };
    }
};

// ===== LOYALTY PROGRAM =====

/**
 * Initialize or get customer loyalty account
 */
const getOrCreateLoyaltyAccount = async (customerProfileId, userId) => {
    try {
        let loyalty = await LoyaltyPoints.findOne({
            $or: [{ customerProfileId }, { userId }]
        });

        if (!loyalty) {
            const referralCode = 'REF-' + uuidv4().substring(0, 8).toUpperCase();

            loyalty = new LoyaltyPoints({
                _id: 'LOYAL-' + (customerProfileId || userId || uuidv4().substring(0, 8)),
                userId,
                customerProfileId,
                points: 0,
                lifetimePoints: 0,
                tier: 'bronze',
                referralCode,
                pointsHistory: [],
                tierHistory: [{
                    tier: 'bronze',
                    achievedAt: new Date(),
                    pointsAtTier: 0
                }],
                currentTierBenefits: {
                    pointsMultiplier: 1,
                    freeDelivery: false,
                    priorityReservation: false,
                    exclusiveOffers: false
                }
            });
            await loyalty.save();
        }

        return loyalty;
    } catch (error) {
        logger.error('Get/create loyalty account error:', error);
        return null;
    }
};

/**
 * Calculate tier based on lifetime points
 */
const calculateTier = (lifetimePoints) => {
    if (lifetimePoints >= 10000) return 'platinum';
    if (lifetimePoints >= 5000) return 'gold';
    if (lifetimePoints >= 2000) return 'silver';
    return 'bronze';
};

/**
 * Get tier benefits
 */
const getTierBenefits = (tier) => {
    const benefits = {
        bronze: {
            pointsMultiplier: 1,
            freeDelivery: false,
            priorityReservation: false,
            exclusiveOffers: false,
            pointsPerKSh: 1
        },
        silver: {
            pointsMultiplier: 1.25,
            freeDelivery: false,
            priorityReservation: true,
            exclusiveOffers: false,
            pointsPerKSh: 1.25
        },
        gold: {
            pointsMultiplier: 1.5,
            freeDelivery: true,
            priorityReservation: true,
            exclusiveOffers: true,
            pointsPerKSh: 1.5
        },
        platinum: {
            pointsMultiplier: 2,
            freeDelivery: true,
            priorityReservation: true,
            exclusiveOffers: true,
            pointsPerKSh: 2
        }
    };
    return benefits[tier] || benefits.bronze;
};

/**
 * Award points for purchase
 */
const awardPoints = async (customerId, orderId, orderTotal) => {
    try {
        const loyalty = await LoyaltyPoints.findOne({ customerProfileId: customerId });
        if (!loyalty) {
            return { success: false, error: 'Loyalty account not found' };
        }

        const tier = calculateTier(loyalty.lifetimePoints);
        const benefits = getTierBenefits(tier);

        // Calculate points (1 point per KSh, multiplied by tier)
        const pointsEarned = Math.floor(orderTotal * benefits.pointsPerKSh);

        loyalty.points += pointsEarned;
        loyalty.lifetimePoints += pointsEarned;

        // Check for tier upgrade
        const previousTier = loyalty.tier;
        if (tier !== previousTier) {
            loyalty.tier = tier;
            loyalty.tierHistory.push({
                tier: tier,
                achievedAt: new Date(),
                pointsAtTier: loyalty.lifetimePoints
            });
            loyalty.currentTierBenefits = benefits;

            // Notify about tier upgrade
            await notifyTierUpgrade(loyalty, previousTier, tier);
        }

        // Add to history
        loyalty.pointsHistory.push({
            points: pointsEarned,
            type: 'earn',
            description: `Points earned from order ${orderId}`,
            orderId,
            createdAt: new Date()
        });

        loyalty.updatedAt = new Date();
        await loyalty.save();

        // Log activity
        await logActivity(customerId, 'loyalty_earned', { orderId, pointsEarned, newBalance: loyalty.points });

        return {
            success: true,
            pointsEarned,
            totalPoints: loyalty.points,
            tier: loyalty.tier
        };
    } catch (error) {
        logger.error('Award points error:', error);
        return { success: false, error: error.message };
    }
};

/**
 * Redeem points for reward
 */
const redeemPoints = async (customerId, pointsToRedeem, description = 'Redemption') => {
    try {
        const loyalty = await LoyaltyPoints.findOne({ customerProfileId: customerId });
        if (!loyalty) {
            return { success: false, error: 'Loyalty account not found' };
        }

        if (loyalty.points < pointsToRedeem) {
            return { success: false, error: 'Insufficient points' };
        }

        loyalty.points -= pointsToRedeem;
        loyalty.redeemedPoints += pointsToRedeem;

        loyalty.pointsHistory.push({
            points: pointsToRedeem,
            type: 'redeem',
            description,
            createdAt: new Date()
        });

        loyalty.updatedAt = new Date();
        await loyalty.save();

        // Log activity
        await logActivity(customerId, 'loyalty_redeemed', { pointsRedeemed: pointsToRedeem, remainingPoints: loyalty.points });

        return {
            success: true,
            pointsRedeemed: pointsToRedeem,
            remainingPoints: loyalty.points
        };
    } catch (error) {
        logger.error('Redeem points error:', error);
        return { success: false, error: error.message };
    }
};

/**
 * Award referral bonus
 */
const awardReferralBonus = async (referrerCode, newCustomerId) => {
    try {
        const referrer = await LoyaltyPoints.findOne({ referralCode: referrerCode });
        if (!referrer) {
            return { success: false, error: 'Invalid referral code' };
        }

        const BONUS_POINTS = 500;

        referrer.points += BONUS_POINTS;
        referrer.lifetimePoints += BONUS_POINTS;
        referrer.referralCount += 1;
        referrer.referralBonusEarned += BONUS_POINTS;

        referrer.pointsHistory.push({
            points: BONUS_POINTS,
            type: 'referral',
            description: `Referral bonus for bringing a new customer`,
            createdAt: new Date()
        });

        // Update tier if needed
        const newTier = calculateTier(referrer.lifetimePoints);
        if (newTier !== referrer.tier) {
            referrer.tier = newTier;
            referrer.currentTierBenefits = getTierBenefits(newTier);
        }

        await referrer.save();

        // Update new customer's referredBy
        await LoyaltyPoints.findOneAndUpdate(
            { customerProfileId: newCustomerId },
            { referredBy: referrer._id }
        );

        // Notify referrer
        await notifyReferrer(referrer, BONUS_POINTS);

        return { success: true, bonusPoints: BONUS_POINTS };
    } catch (error) {
        logger.error('Award referral bonus error:', error);
        return { success: false, error: error.message };
    }
};

/**
 * Award birthday bonus
 */
const awardBirthdayBonus = async (customerProfile) => {
    try {
        const loyalty = await LoyaltyPoints.findOne({ customerProfileId: customerProfile._id });
        if (!loyalty) return { success: false, error: 'No loyalty account' };

        const currentYear = new Date().getFullYear();

        // Check if already claimed this year
        if (loyalty.birthdayBonusClaimed && loyalty.birthdayBonusYear === currentYear) {
            return { success: false, error: 'Birthday bonus already claimed this year' };
        }

        const BONUS_POINTS = 200;

        loyalty.points += BONUS_POINTS;
        loyalty.lifetimePoints += BONUS_POINTS;
        loyalty.birthdayBonusClaimed = true;
        loyalty.birthdayBonusYear = currentYear;

        loyalty.pointsHistory.push({
            points: BONUS_POINTS,
            type: 'birthday',
            description: 'Happy Birthday! Special birthday bonus points',
            createdAt: new Date()
        });

        await loyalty.save();

        // Notify customer
        await notifyBirthdayBonus(customerProfile, BONUS_POINTS);

        // Log activity
        await logActivity(customerProfile._id, 'birthday_claimed', { pointsAwarded: BONUS_POINTS });

        return { success: true, bonusPoints: BONUS_POINTS };
    } catch (error) {
        logger.error('Award birthday bonus error:', error);
        return { success: false, error: error.message };
    }
};

/**
 * Notify customer about tier upgrade
 */
const notifyTierUpgrade = async (loyalty, oldTier, newTier) => {
    try {
        const customer = await CustomerProfile.findById(loyalty.customerProfileId);
        if (!customer || !customer.communicationPreferences?.loyaltyUpdates) return;

        const benefits = getTierBenefits(newTier);

        const emailSubject = `🎉 Congratulations! You've been upgraded to ${newTier.charAt(0).toUpperCase() + newTier.slice(1)} Tier!`;
        const emailHtml = `
            <div style="text-align: center; padding: 20px;">
                <h2 style="color: #1a1a2e;">Congratulations, ${customer.name || 'Valued Customer'}!</h2>
                <p>You've been upgraded to <strong>${newTier.toUpperCase()} Tier</strong> at The Quill!</p>
                <div style="background: #f3f4f6; padding: 20px; border-radius: 8px; margin: 20px 0;">
                    <h3>Your New Benefits:</h3>
                    <ul style="text-align: left;">
                        <li>${benefits.pointsPerKSh}x points on every KSh spent</li>
                        ${benefits.freeDelivery ? '<li>Free delivery on all orders</li>' : ''}
                        ${benefits.priorityReservation ? '<li>Priority table reservations</li>' : ''}
                        ${benefits.exclusiveOffers ? '<li>Exclusive offers and promotions</li>' : ''}
                    </ul>
                </div>
                <p>Thank you for being a loyal customer!</p>
            </div>
        `;

        await sendEmailNotification(customer.email, emailSubject, emailHtml);
    } catch (error) {
        logger.error('Notify tier upgrade error:', error);
    }
};

/**
 * Notify referrer about bonus
 */
const notifyReferrer = async (loyalty, bonusPoints) => {
    try {
        const customer = await CustomerProfile.findById(loyalty.customerProfileId);
        if (!customer) return;

        const emailSubject = `🎁 You earned ${bonusPoints} bonus points!`;
        const emailHtml = `
            <div style="text-align: center; padding: 20px;">
                <h2 style="color: #1a1a2e;">Thank you for spreading the word!</h2>
                <p>One of your friends made their first purchase at The Quill!</p>
                <p style="font-size: 24px; font-weight: bold; color: #f59e0b;">+${bonusPoints} bonus points added to your account!</p>
                <p>Keep sharing your referral code: <strong>${loyalty.referralCode}</strong></p>
            </div>
        `;

        await sendEmailNotification(customer.email, emailSubject, emailHtml);
    } catch (error) {
        logger.error('Notify referrer error:', error);
    }
};

/**
 * Notify customer about birthday bonus
 */
const notifyBirthdayBonus = async (customer, bonusPoints) => {
    try {
        const emailSubject = `🎂 Happy Birthday from The Quill! 🎁`;
        const emailHtml = `
            <div style="text-align: center; padding: 20px;">
                <h2 style="color: #1a1a2e;">Happy Birthday, ${customer.name || 'Valued Customer'}!</h2>
                <p>🎂🎈🎉</p>
                <p>To celebrate your special day, we're giving you <strong>${bonusPoints} bonus points</strong>!</p>
                <p>Use them on your next visit or save them up for exciting rewards!</p>
                <p>We hope to see you soon to celebrate!</p>
            </div>
        `;

        await sendEmailNotification(customer.email, emailSubject, emailHtml);

        // Also send SMS
        const smsMessage = `Happy Birthday from The Quill! 🎂 We've added ${bonusPoints} bonus points to your account. Celebrate with us soon!`;
        await sendSMS(customer.phone, smsMessage);
    } catch (error) {
        logger.error('Notify birthday bonus error:', error);
    }
};

// ===== MARKETING AUTOMATION =====

/**
 * Send campaign to audience
 */
const sendCampaign = async (campaignId) => {
    try {
        const campaign = await Campaign.findById(campaignId);
        if (!campaign || campaign.status !== 'active') {
            return { success: false, error: 'Campaign not found or not active' };
        }

        // Get target audience
        const audience = await getCampaignAudience(campaign);

        let sentCount = 0;
        let failedCount = 0;

        for (const customer of audience) {
            try {
                const result = await sendToCustomer(campaign, customer);
                if (result.success) sentCount++;
                else failedCount++;

                // Log
                const logId = 'CPLOG-' + uuidv4().substring(0, 8);
                const log = new CampaignLog({
                    _id: logId,
                    campaignId: campaign._id,
                    customerId: customer._id,
                    customerEmail: customer.email,
                    customerPhone: customer.phone,
                    channel: campaign.type === 'sms' ? 'sms' : 'email',
                    status: result.success ? 'sent' : 'failed',
                    sentAt: new Date(),
                    error: result.error
                });
                await log.save();
            } catch (error) {
                failedCount++;
                logger.error(`Campaign send error for customer ${customer._id}:`, error);
            }
        }

        // Update campaign
        campaign.sentCount += sentCount;
        campaign.status = 'completed';
        campaign.sentAt = new Date();
        await campaign.save();

        return { success: true, sentCount, failedCount };
    } catch (error) {
        logger.error('Send campaign error:', error);
        return { success: false, error: error.message };
    }
};

/**
 * Get campaign audience based on conditions
 */
const getCampaignAudience = async (campaign) => {
    try {
        // Get subscribers instead of customer profiles
        const { Subscriber } = require('../models/index');
        let query = {};

        // Filter by segment if specified
        if (campaign.audience?.type === 'segment' && campaign.audience?.segments) {
            query.segment = { $in: campaign.audience.segments };
        }

        // Also get users with emails
        const { User } = require('../models/index');
        const users = await User.find({}).select('email name phone').lean();

        // Get subscribers
        const subscribers = await Subscriber.find(query).select('email name phone segment').lean();

        // Combine and deduplicate
        const audienceMap = new Map();

        // Add subscribers
        for (const sub of subscribers) {
            if (sub.email) {
                audienceMap.set(sub.email, {
                    _id: sub._id,
                    email: sub.email,
                    name: sub.name || '',
                    phone: sub.phone || '',
                    segment: sub.segment || 'all'
                });
            }
        }

        // Add users (subscribers take precedence)
        for (const user of users) {
            if (user.email && !audienceMap.has(user.email)) {
                audienceMap.set(user.email, {
                    _id: user._id,
                    email: user.email,
                    name: user.name || '',
                    phone: user.phone || '',
                    segment: 'all'
                });
            }
        }

        return Array.from(audienceMap.values());
    } catch (error) {
        logger.error('Get campaign audience error:', error);
        return [];
    }
};

/**
 * Send campaign content to customer
 */
const sendToCustomer = async (campaign, customer) => {
    try {
        // Check communication preferences
        if (campaign.type === 'email' && customer.communicationPreferences?.emailMarketing === false) {
            return { success: false, error: 'Customer opted out of emails' };
        }
        if (campaign.type === 'sms' && customer.communicationPreferences?.smsMarketing === false) {
            return { success: false, error: 'Customer opted out of SMS' };
        }

        if (campaign.type === 'sms') {
            return await sendSMS(customer.phone, campaign.message);
        } else {
            return await sendEmailNotification(
                customer.email,
                campaign.subject,
                campaign.htmlContent || campaign.message
            );
        }
    } catch (error) {
        logger.error('Send to customer error:', error);
        return { success: false, error: error.message };
    }
};

/**
 * Trigger automated campaign
 */
const triggerAutomation = async (triggerType, customerId, metadata = {}) => {
    try {
        // Find active automated campaigns matching this trigger
        const campaigns = await Campaign.find({
            status: 'active',
            'automation.enabled': true,
            'automation.trigger.type': triggerType
        });

        for (const campaign of campaigns) {
            // Check delay
            if (campaign.automation.trigger.delay) {
                const delay = calculateDelay(campaign.automation.trigger.delay);
                if (delay > 0) {
                    // Schedule for later
                    setTimeout(() => {
                        sendToAutomationRecipient(campaign._id, customerId);
                    }, delay);
                    continue;
                }
            }

            await sendToAutomationRecipient(campaign._id, customerId);
        }

        return { success: true };
    } catch (error) {
        logger.error('Trigger automation error:', error);
        return { success: false, error: error.message };
    }
};

/**
 * Calculate delay in milliseconds
 */
const calculateDelay = (delayConfig) => {
    const { value, unit } = delayConfig;
    switch (unit) {
        case 'minutes': return value * 60 * 1000;
        case 'hours': return value * 60 * 60 * 1000;
        case 'days': return value * 24 * 60 * 60 * 1000;
        default: return 0;
    }
};

/**
 * Send automation to single recipient
 */
const sendToAutomationRecipient = async (campaignId, customerId) => {
    try {
        const campaign = await Campaign.findById(campaignId);
        const customer = await CustomerProfile.findById(customerId);

        if (!campaign || !customer) return { success: false };

        const result = await sendToCustomer(campaign, customer);

        // Log
        const logId = 'CPLOG-' + uuidv4().substring(0, 8);
        const log = new CampaignLog({
            _id: logId,
            campaignId: campaign._id,
            customerId: customer._id,
            customerEmail: customer.email,
            customerPhone: customer.phone,
            channel: campaign.type,
            status: result.success ? 'sent' : 'failed',
            sentAt: new Date()
        });
        await log.save();

        return result;
    } catch (error) {
        logger.error('Send to automation recipient error:', error);
        return { success: false, error: error.message };
    }
};

// ===== CUSTOMER PROFILE =====

/**
 * Create or update customer profile
 */
const upsertCustomerProfile = async (customerData) => {
    try {
        const { email, phone, userId, name, birthday } = customerData;

        let profile = await CustomerProfile.findOne({
            $or: [{ email }, { phone }]
        });

        if (profile) {
            // Update existing
            if (name && !profile.name) profile.name = name;
            if (birthday && !profile.birthday) profile.birthday = birthday;
            if (userId && !profile.userId) profile.userId = userId;
            profile.lastActive = new Date();
            profile.updatedAt = new Date();
            await profile.save();
        } else {
            // Create new
            const profileId = 'CUST-' + uuidv4().substring(0, 8).toUpperCase();
            profile = new CustomerProfile({
                _id: profileId,
                email,
                phone,
                userId,
                name,
                birthday,
                segment: 'new',
                firstSeen: new Date(),
                lastActive: new Date()
            });
            await profile.save();

            // Trigger welcome automation
            await triggerAutomation('first_order', profile._id);
        }

        // Update segment based on activity
        await updateCustomerSegment(profile._id);

        return profile;
    } catch (error) {
        logger.error('Upsert customer profile error:', error);
        return null;
    }
};

/**
 * Update customer segment based on activity
 */
const updateCustomerSegment = async (customerId) => {
    try {
        const profile = await CustomerProfile.findById(customerId);
        if (!profile) return;

        const now = new Date();
        const daysSinceLastOrder = profile.lastOrderDate
            ? Math.floor((now - profile.lastOrderDate) / (1000 * 60 * 60 * 24))
            : null;

        let newSegment = profile.segment;

        if (profile.totalOrders === 0) {
            newSegment = 'new';
        } else if (daysSinceLastOrder !== null && daysSinceLastOrder > 90) {
            newSegment = 'inactive';
        } else if (daysSinceLastOrder !== null && daysSinceLastOrder > 60) {
            newSegment = 'at-risk';
        } else if (profile.totalSpent >= 50000 || profile.visitCount >= 20) {
            newSegment = 'vip';
        } else {
            newSegment = 'regular';
        }

        if (newSegment !== profile.segment) {
            profile.segment = newSegment;
            profile.updatedAt = new Date();
            await profile.save();
        }

        return profile;
    } catch (error) {
        logger.error('Update customer segment error:', error);
    }
};

/**
 * Record customer activity
 */
const logActivity = async (customerId, activityType, metadata = {}) => {
    try {
        const activityId = 'ACT-' + uuidv4().substring(0, 8);
        const activity = new CustomerActivity({
            _id: activityId,
            customerId,
            activityType,
            metadata,
            createdAt: new Date()
        });
        await activity.save();
        return activity;
    } catch (error) {
        logger.error('Log activity error:', error);
        return null;
    }
};

// ===== ANALYTICS =====

/**
 * Get engagement analytics
 */
const getEngagementAnalytics = async (startDate, endDate) => {
    try {
        const analytics = await EngagementAnalytics.find({
            date: { $gte: startDate, $lte: endDate }
        }).sort({ date: -1 });

        return analytics;
    } catch (error) {
        logger.error('Get engagement analytics error:', error);
        return [];
    }
};

/**
 * Record daily analytics
 */
const recordDailyAnalytics = async () => {
    try {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const existing = await EngagementAnalytics.findOne({ date: today });
        if (existing) return existing;

        // Calculate metrics
        const [
            newCustomers,
            activeCustomers,
            reviewsReceived,
            positiveReviews,
            campaignLogs
        ] = await Promise.all([
            CustomerProfile.countDocuments({
                firstSeen: { $gte: today }
            }),
            CustomerProfile.countDocuments({
                lastActive: { $gte: today }
            }),
            Review.countDocuments({
                createdAt: { $gte: today }
            }),
            Review.countDocuments({
                createdAt: { $gte: today },
                rating: { $gte: 4 }
            }),
            CampaignLog.countDocuments({
                sentAt: { $gte: today }
            })
        ]);

        const analytics = new EngagementAnalytics({
            _id: 'AN-' + today.toISOString().split('T')[0],
            date: today,
            newCustomers,
            activeCustomers,
            reviewsReceived,
            positiveReviews
        });

        await analytics.save();
        return analytics;
    } catch (error) {
        logger.error('Record daily analytics error:', error);
        return null;
    }
};

module.exports = {
    // Review Management
    createReviewFollowUp,
    sendReviewRequest,
    processReview,
    sendPositiveReviewRequest,
    sendComplaintAlert,

    // Loyalty Program
    getOrCreateLoyaltyAccount,
    calculateTier,
    getTierBenefits,
    awardPoints,
    redeemPoints,
    awardReferralBonus,
    awardBirthdayBonus,
    notifyTierUpgrade,

    // Marketing
    sendCampaign,
    getCampaignAudience,
    triggerAutomation,

    // Customer Profile
    upsertCustomerProfile,
    updateCustomerSegment,
    logActivity,

    // Analytics
    getEngagementAnalytics,
    recordDailyAnalytics
};
