const axios = require('axios');
const { config, logger } = require('../config');

/**
 * Format phone number to international format
 */
const formatInternationalPhone = (phone) => {
    // Remove any spaces or special characters
    let cleaned = phone.replace(/[\s\-\(\)]/g, '');

    // Handle various formats
    if (cleaned.startsWith('+')) {
        return cleaned;
    } else if (cleaned.startsWith('254')) {
        return '+' + cleaned;
    } else if (cleaned.startsWith('0')) {
        return '+254' + cleaned.substring(1);
    } else if (cleaned.length === 9) {
        return '+254' + cleaned;
    }

    return cleaned; // Return as-is if already in international format
};

/**
 * Send SMS via Brevo
 */
const sendSMS = async (phoneNumber, message, { shortCode = null, bulk = false } = {}) => {
    try {
        const formattedPhone = formatInternationalPhone(phoneNumber);

        // If no Brevo API key, log and simulate
        if (!config.brevo.apiKey) {
            logger.info(`[DEMO SMS] To: ${formattedPhone}`);
            logger.info(`[DEMO SMS] Message: ${message.substring(0, 100)}...`);
            return {
                success: true,
                messageId: 'DEMO-' + Date.now(),
                status: 'simulated',
                to: formattedPhone
            };
        }

        // Use Brevo's SMS API
        const url = 'https://api.brevo.com/v3/transactionalSMS/sms';

        const data = {
            sender: config.brevo.senderName || 'TheQuill',
            recipient: formattedPhone,
            content: message
        };

        const response = await axios.post(url, data, {
            headers: {
                'Content-Type': 'application/json',
                'api-key': config.brevo.apiKey
            }
        });

        return {
            success: true,
            messageId: response.data.messageId || response.data.id,
            status: 'sent',
            to: formattedPhone
        };
    } catch (error) {
        logger.error('Brevo SMS error:', error.message);

        // Return a demo response in development
        if (process.env.NODE_ENV !== 'production') {
            return {
                success: true,
                messageId: 'DEMO-' + Date.now(),
                status: 'simulated (error fallback)',
                to: formatInternationalPhone(phoneNumber),
                error: error.message
            };
        }

        return {
            success: false,
            error: error.message
        };
    }
};

/**
 * Send bulk SMS via Brevo
 */
const sendBulkSMS = async (recipients, message) => {
    const results = {
        total: recipients.length,
        successful: 0,
        failed: 0,
        messages: []
    };

    try {
        const formattedRecipients = recipients.map(r => formatInternationalPhone(r.phone));

        if (!config.brevo.apiKey) {
            // Demo mode
            for (const recipient of recipients) {
                results.successful++;
                results.messages.push({
                    to: formatInternationalPhone(recipient.phone),
                    status: 'simulated',
                    messageId: 'DEMO-' + Date.now()
                });
            }
            return results;
        }

        // Use Brevo's bulk SMS API
        const url = 'https://api.brevo.com/v3/transactionalSMS/bulk';

        const data = {
            sender: config.brevo.senderName || 'TheQuill',
            recipients: formattedRecipients.map(phone => ({ phoneNumber: phone })),
            content: message
        };

        const response = await axios.post(url, data, {
            headers: {
                'Content-Type': 'application/json',
                'api-key': config.brevo.apiKey
            }
        });

        // Process response
        if (response.data && response.data.recipients) {
            for (const recipient of response.data.recipients) {
                if (recipient.status === 'success' || recipient.status === 0) {
                    results.successful++;
                } else {
                    results.failed++;
                }
                results.messages.push({
                    to: recipient.phoneNumber,
                    status: recipient.status,
                    messageId: recipient.messageId
                });
            }
        }
    } catch (error) {
        logger.error('Bulk SMS error:', error.message);

        // Fallback to individual sending
        for (const recipient of recipients) {
            const result = await sendSMS(recipient.phone, message);
            if (result.success) {
                results.successful++;
            } else {
                results.failed++;
            }
            results.messages.push(result);
        }
    }

    return results;
};

/**
 * Check SMS balance (Brevo)
 */
const checkBalance = async () => {
    try {
        if (!config.brevo.apiKey) {
            return {
                success: true,
                balance: 'Demo Mode - No real balance',
                currency: 'KES'
            };
        }

        const url = 'https://api.brevo.com/v3/transactionalSMS/balance';

        const response = await axios.get(url, {
            headers: {
                'api-key': config.brevo.apiKey
            }
        });

        return {
            success: true,
            balance: response.data.credits || 0,
            currency: 'credits'
        };
    } catch (error) {
        logger.error('Balance check error:', error.message);
        return {
            success: false,
            error: error.message
        };
    }
};

/**
 * Get delivery status
 */
const getDeliveryStatus = async (messageId) => {
    try {
        if (!config.brevo.apiKey) {
            return {
                success: true,
                status: 'delivered',
                messageId
            };
        }

        // Brevo doesn't have a direct status check endpoint for SMS
        // Return pending as we can't check status
        return {
            success: true,
            status: 'pending',
            messageId,
            note: 'Status tracking not available via API'
        };
    } catch (error) {
        logger.error('Delivery status error:', error.message);
        return {
            success: false,
            error: error.message
        };
    }
};

// Premium SMS (for verification codes, etc.)
const sendPremiumSMS = async (phoneNumber, message, options = {}) => {
    // Use regular SMS for now - Brevo handles this automatically
    return sendSMS(phoneNumber, message, options);
};

module.exports = {
    initAfricaTalking: () => console.log('SMS service now uses Brevo'),
    sendSMS,
    sendBulkSMS,
    checkBalance,
    getDeliveryStatus,
    sendPremiumSMS,
    formatKenyaPhone: formatInternationalPhone
};
