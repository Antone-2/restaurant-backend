const cron = require('node-cron');
const { logger, config } = require('../config');
const engagementService = require('./engagement');
const { sendEmailNotification } = require('./email');
const { sendSMS } = require('./sms');
const {
    CustomerProfile,
    LoyaltyPoints,
    Campaign,
    ReviewFollowUp,
    AutomationTemplate,
    Order,
    Reservation
} = require('../models/engagement');

// Store running jobs
const runningJobs = new Map();

/**
 * Start all automation cron jobs
 */
const startAutomationJobs = () => {
    logger.info('Starting automation cron jobs...');

    // Run daily at 9 AM - Birthday rewards
    cron.schedule('0 9 * * *', async () => {
        logger.info('Running birthday bonus job...');
        await processBirthdayBonuses();
    }, { timezone: 'Africa/Nairobi' });

    // Run daily at 10 AM - Win-back campaigns
    cron.schedule('0 10 * * *', async () => {
        logger.info('Running win-back campaign job...');
        await processWinBackCampaigns();
    }, { timezone: 'Africa/Nairobi' });

    // Run daily at 11 AM - Reorder reminders
    cron.schedule('0 11 * * *', async () => {
        logger.info('Running reorder reminder job...');
        await processReorderReminders();
    }, { timezone: 'Africa/Nairobi' });

    // Run daily at 12 PM - Review follow-ups
    cron.schedule('0 12 * * *', async () => {
        logger.info('Running review follow-up job...');
        await processReviewFollowUps();
    }, { timezone: 'Africa/Nairobi' });

    // Run daily at 8 AM - Daily analytics
    cron.schedule('0 8 * * *', async () => {
        logger.info('Recording daily analytics...');
        await engagementService.recordDailyAnalytics();
    }, { timezone: 'Africa/Nairobi' });

    // Run every hour - Scheduled campaigns
    cron.schedule('0 * * * *', async () => {
        logger.info('Checking scheduled campaigns...');
        await processScheduledCampaigns();
    }, { timezone: 'Africa/Nairobi' });

    // Run every hour - Segment updates
    cron.schedule('30 * * * *', async () => {
        logger.info('Updating customer segments...');
        await updateCustomerSegments();
    }, { timezone: 'Africa/Nairobi' });

    // Run weekly on Monday at 9 AM - Weekly engagement report
    cron.schedule('0 9 * * 1', async () => {
        logger.info('Sending weekly engagement report...');
        await sendWeeklyEngagementReport();
    }, { timezone: 'Africa/Nairobi' });

    logger.info('All automation cron jobs started');
};

/**
 * Process birthday bonuses
 */
const processBirthdayBonuses = async () => {
    try {
        const today = new Date();
        const month = today.getMonth();
        const day = today.getDate();

        // Find customers with birthdays today
        const customers = await CustomerProfile.find({
            birthday: { $exists: true, $ne: null }
        });

        let processed = 0;
        let failed = 0;

        for (const customer of customers) {
            if (!customer.birthday) continue;

            const birthDate = new Date(customer.birthday);

            // Check if birthday is today
            if (birthDate.getMonth() === month && birthDate.getDate() === day) {
                // Check if opted in for birthday offers
                if (customer.communicationPreferences?.birthdayOffers !== false) {
                    try {
                        const result = await engagementService.awardBirthdayBonus(customer);
                        if (result.success) {
                            processed++;
                        } else if (result.error.includes('already claimed')) {
                            // Already claimed this year, skip silently
                        } else {
                            failed++;
                        }
                    } catch (error) {
                        logger.error(`Birthday bonus error for ${customer._id}:`, error);
                        failed++;
                    }
                }
            }
        }

        logger.info(`Birthday bonus job completed: ${processed} processed, ${failed} failed`);
        return { processed, failed };
    } catch (error) {
        logger.error('Birthday bonus job error:', error);
        return { processed: 0, failed: 0, error: error.message };
    }
};

/**
 * Process win-back campaigns for inactive customers
 */
const processWinBackCampaigns = async () => {
    try {
        const INACTIVE_DAYS = 60;
        const AT_RISK_DAYS = 45;

        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - INACTIVE_DAYS);

        // Find inactive customers
        const inactiveCustomers = await CustomerProfile.find({
            segment: { $in: ['inactive', 'at-risk'] },
            lastActive: { $lt: cutoffDate },
            'communicationPreferences.emailMarketing': true
        });

        // Find active win-back campaign
        const campaign = await Campaign.findOne({
            category: 'winback',
            status: 'active',
            'automation.enabled': true
        });

        if (!campaign) {
            logger.info('No active win-back campaign found');
            return { sent: 0 };
        }

        let sent = 0;
        for (const customer of inactiveCustomers) {
            try {
                const result = await engagementService.sendToCustomer(campaign, customer);
                if (result.success) sent++;
            } catch (error) {
                logger.error(`Win-back send error for ${customer._id}:`, error);
            }
        }

        logger.info(`Win-back campaign completed: ${sent} sent`);
        return { sent };
    } catch (error) {
        logger.error('Win-back campaign job error:', error);
        return { sent: 0, error: error.message };
    }
};

/**
 * Process reorder reminders based on favorite dishes
 */
const processReorderReminders = async () => {
    try {
        // Find customers who haven't ordered in 30-45 days
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        const fortyFiveDaysAgo = new Date();
        fortyFiveDaysAgo.setDate(fortyFiveDaysAgo.getDate() - 45);

        const customers = await CustomerProfile.find({
            lastOrderDate: {
                $gte: fortyFiveDaysAgo,
                $lt: thirtyDaysAgo
            },
            'preferences.favoriteDishes': { $exists: true, $ne: [] },
            'communicationPreferences.emailMarketing': true
        });

        // Find reorder campaign
        const campaign = await Campaign.findOne({
            category: 'reorder',
            status: 'active',
            'automation.enabled': true
        });

        if (!campaign) {
            logger.info('No active reorder campaign found');
            return { sent: 0 };
        }

        let sent = 0;
        for (const customer of customers) {
            try {
                // Get their favorite dishes for personalization
                const favoriteDishes = customer.preferences?.favoriteDishes || [];

                let message = campaign.message;
                if (favoriteDishes.length > 0) {
                    message = message.replace('{favorite_dish}', favoriteDishes[0]);
                }

                const personalizedCampaign = {
                    ...campaign,
                    message
                };

                const result = await engagementService.sendToCustomer(personalizedCampaign, customer);
                if (result.success) sent++;
            } catch (error) {
                logger.error(`Reorder send error for ${customer._id}:`, error);
            }
        }

        logger.info(`Reorder reminders completed: ${sent} sent`);
        return { sent };
    } catch (error) {
        logger.error('Reorder reminder job error:', error);
        return { sent: 0, error: error.message };
    }
};

/**
 * Process pending review follow-ups
 */
const processReviewFollowUps = async () => {
    try {
        // Find orders completed 1-3 days ago without review follow-up
        const threeDaysAgo = new Date();
        threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);

        const oneDayAgo = new Date();
        oneDayAgo.setDate(oneDayAgo.getDate() - 1);

        // Get completed orders from the last 1-3 days
        const recentOrders = await Order.find({
            status: 'completed',
            createdAt: { $gte: threeDaysAgo, $lte: oneDayAgo }
        });

        let processed = 0;

        for (const order of recentOrders) {
            // Check if review follow-up already exists
            const existing = await ReviewFollowUp.findOne({ orderId: order._id });
            if (existing) continue;

            // Create follow-up
            await engagementService.createReviewFollowUp({
                orderId: order._id,
                customerId: order.userId || order._id,
                customerEmail: order.email,
                customerPhone: order.phone,
                customerName: order.customerName,
                total: order.total
            });
            processed++;
        }

        logger.info(`Review follow-ups processed: ${processed}`);
        return { processed };
    } catch (error) {
        logger.error('Review follow-up job error:', error);
        return { processed: 0, error: error.message };
    }
};

/**
 * Process scheduled campaigns
 */
const processScheduledCampaigns = async () => {
    try {
        const now = new Date();

        // Find campaigns scheduled to be sent
        const campaigns = await Campaign.find({
            status: 'scheduled',
            'schedule.sendAt': { $lte: now }
        });

        let sent = 0;

        for (const campaign of campaigns) {
            try {
                // Avoid duplicate processing
                if (runningJobs.has(campaign._id)) continue;

                runningJobs.set(campaign._id, true);

                campaign.status = 'active';
                await campaign.save();

                const result = await engagementService.sendCampaign(campaign._id);

                runningJobs.delete(campaign._id);

                if (result.success) sent++;
            } catch (error) {
                logger.error(`Scheduled campaign error for ${campaign._id}:`, error);
                runningJobs.delete(campaign._id);
            }
        }

        logger.info(`Scheduled campaigns processed: ${sent}`);
        return { sent };
    } catch (error) {
        logger.error('Scheduled campaigns job error:', error);
        return { sent: 0, error: error.message };
    }
};

/**
 * Update customer segments based on activity
 */
const updateCustomerSegments = async () => {
    try {
        const customers = await CustomerProfile.find({
            segment: { $nin: ['new'] }
        });

        let updated = 0;

        for (const customer of customers) {
            const result = await engagementService.updateCustomerSegment(customer._id);
            if (result && result.segment !== customer.segment) {
                updated++;
            }
        }

        logger.info(`Customer segments updated: ${updated}`);
        return { updated };
    } catch (error) {
        logger.error('Segment update job error:', error);
        return { updated: 0, error: error.message };
    }
};

/**
 * Send weekly engagement report to admin
 */
const sendWeeklyEngagementReport = async () => {
    try {
        const weekAgo = new Date();
        weekAgo.setDate(weekAgo.getDate() - 7);

        // Get weekly stats
        const [
            newCustomers,
            activeCustomers,
            ordersCount,
            avgOrderValue,
            reviewsCount,
            positiveReviews,
            campaignsSent
        ] = await Promise.all([
            CustomerProfile.countDocuments({ firstSeen: { $gte: weekAgo } }),
            CustomerProfile.countDocuments({ lastActive: { $gte: weekAgo } }),
            Order.countDocuments({ createdAt: { $gte: weekAgo, status: { $ne: 'cancelled' } } }),
            Order.aggregate([
                { $match: { createdAt: { $gte: weekAgo }, status: { $ne: 'cancelled' } } },
                { $group: { _id: null, avg: { $avg: '$total' } } }
            ]),
            require('../models/engagement').Review.countDocuments({ createdAt: { $gte: weekAgo } }),
            require('../models/engagement').Review.countDocuments({ createdAt: { $gte: weekAgo }, rating: { $gte: 4 } }),
            require('../models/engagement').CampaignLog.countDocuments({ sentAt: { $gte: weekAgo } })
        ]);

        const avgValue = avgOrderValue[0]?.avg || 0;
        const reviewRate = reviewsCount > 0 ? (positiveReviews / reviewsCount * 100).toFixed(1) : 0;

        const reportHtml = `
            <div style="padding: 20px;">
                <h2 style="color: #1a1a2e;">📊 Weekly Engagement Report</h2>
                <p style="color: #666;">Week of ${weekAgo.toLocaleDateString()} - ${new Date().toLocaleDateString()}</p>
                
                <div style="background: #f3f4f6; padding: 20px; border-radius: 8px; margin: 20px 0;">
                    <h3>Customer Activity</h3>
                    <p>New Customers: <strong>${newCustomers}</strong></p>
                    <p>Active Customers: <strong>${activeCustomers}</strong></p>
                    <p>Total Orders: <strong>${ordersCount}</strong></p>
                    <p>Average Order Value: <strong>KSh ${avgValue.toFixed(2)}</strong></p>
                </div>
                
                <div style="background: #f3f4f6; padding: 20px; border-radius: 8px; margin: 20px 0;">
                    <h3>Reviews & Feedback</h3>
                    <p>Total Reviews: <strong>${reviewsCount}</strong></p>
                    <p>Positive Review Rate: <strong>${reviewRate}%</strong></p>
                </div>
                
                <div style="background: #f3f4f6; padding: 20px; border-radius: 8px; margin: 20px 0;">
                    <h3>Marketing</h3>
                    <p>Messages Sent: <strong>${campaignsSent}</strong></p>
                </div>
            </div>
        `;

        if (config.adminEmail) {
            await sendEmailNotification(
                config.adminEmail,
                '📊 Weekly Engagement Report - The Quill',
                reportHtml
            );
        }

        logger.info('Weekly engagement report sent');
        return { success: true };
    } catch (error) {
        logger.error('Weekly report job error:', error);
        return { success: false, error: error.message };
    }
};

/**
 * Trigger welcome sequence for new customer
 */
const triggerWelcomeSequence = async (customerId) => {
    try {
        const template = await AutomationTemplate.findOne({
            category: 'welcome',
            isActive: true
        });

        if (!template) {
            logger.info('No welcome automation template found');
            return { triggered: false };
        }

        // Process each step in the sequence
        for (const step of template.steps) {
            const delay = engagementService.calculateDelay(step.delay);

            if (delay > 0) {
                setTimeout(async () => {
                    await processWelcomeStep(customerId, step);
                }, delay);
            } else {
                await processWelcomeStep(customerId, step);
            }
        }

        logger.info(`Welcome sequence triggered for customer ${customerId}`);
        return { triggered: true };
    } catch (error) {
        logger.error('Welcome sequence error:', error);
        return { triggered: false, error: error.message };
    }
};

/**
 * Process a single welcome step
 */
const processWelcomeStep = async (customerId, step) => {
    try {
        const customer = await CustomerProfile.findById(customerId);
        if (!customer) return;

        const message = step.message
            .replace('{customer_name}', customer.name || 'there')
            .replace('{first_name}', (customer.name || '').split(' ')[0] || 'there');

        if (step.channel === 'sms') {
            await sendSMS(customer.phone, message);
        } else {
            const subject = step.subject
                .replace('{customer_name}', customer.name || 'there');
            await sendEmailNotification(customer.email, subject, step.htmlContent || message);
        }

        // Log activity
        await engagementService.logActivity(customerId, 'campaign_received', {
            stepName: step.name,
            channel: step.channel
        });
    } catch (error) {
        logger.error(`Welcome step error for ${customerId}:`, error);
    }
};

/**
 * Manually trigger a campaign
 */
const triggerCampaign = async (campaignId) => {
    try {
        const campaign = await Campaign.findById(campaignId);
        if (!campaign) {
            return { success: false, error: 'Campaign not found' };
        }

        campaign.status = 'active';
        await campaign.save();

        const result = await engagementService.sendCampaign(campaignId);

        return result;
    } catch (error) {
        logger.error('Manual campaign trigger error:', error);
        return { success: false, error: error.message };
    }
};

module.exports = {
    startAutomationJobs,
    processBirthdayBonuses,
    processWinBackCampaigns,
    processReorderReminders,
    processReviewFollowUps,
    processScheduledCampaigns,
    updateCustomerSegments,
    sendWeeklyEngagementReport,
    triggerWelcomeSequence,
    triggerCampaign
};
