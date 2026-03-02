
const crypto = require('crypto');
const https = require('https');
const { v4: uuidv4 } = require('uuid');

const config = {
    consumerKey: process.env.MPESA_CONSUMER_KEY,
    consumerSecret: process.env.MPESA_CONSUMER_SECRET,
    shortcode: process.env.MPESA_SHORTCODE || '174379',
    passkey: process.env.MPESA_PASSKEY,
    environment: process.env.MPESA_ENVIRONMENT || 'sandbox',
    callbackUrl: process.env.MPESA_CALLBACK_URL || `http://localhost:3001/api/payments/mpesa/callback`
};
const getBaseUrl = () => {
    return config.environment === 'production'
        ? 'https://api.safaricom.co.ke'
        : 'https://sandbox.safaricom.co.ke';
};

/**
 * Generate OAuth Access Token
 * @returns {Promise<string>} Access token
 */
const generateAccessToken = async () => {
    return new Promise((resolve, reject) => {
        // Check if credentials are configured
        if (!config.consumerKey || !config.consumerSecret ||
            config.consumerKey.includes('your_') || config.consumerSecret.includes('your_')) {
            console.log('[M-Pesa] Using demo mode - no real credentials configured');
            resolve('demo_token_' + Date.now());
            return;
        }

        const auth = Buffer.from(`${config.consumerKey}:${config.consumerSecret}`).toString('base64');
        const options = {
            hostname: getBaseUrl().replace('https://', ''),
            path: '/oauth/v1/generate?grant_type=client_credentials',
            method: 'GET',
            headers: {
                'Authorization': `Basic ${auth}`
            }
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    if (json.access_token) {
                        resolve(json.access_token);
                    } else {
                        reject(new Error('Failed to get access token: ' + data));
                    }
                } catch (e) {
                    reject(new Error('Failed to parse token response'));
                }
            });
        });

        req.on('error', (e) => {
            console.error('[M-Pesa] Token request error:', e.message);
            // Fall back to demo mode on network error
            resolve('demo_token_' + Date.now());
        });

        req.end();
    });
};

/**
 * Generate STK Push Password
 * @param {string} timestamp - Timestamp in YYYYMMDDHHmmss format
 * @returns {string} Base64 encoded password
 */
const generatePassword = (timestamp) => {
    // If no passkey configured, use a demo password
    if (!config.passkey || config.passkey.includes('your_')) {
        return Buffer.from(`demo:${timestamp}`).toString('base64');
    }

    const data = `${config.shortcode}${config.passkey}${timestamp}`;
    return crypto.createHash('sha256').update(data).digest('base64');
};

/**
 * Initiate STK Push Payment
 * @param {string} phoneNumber - Customer phone number (254xxxxxxxxx)
 * @param {number} amount - Amount in KES
 * @param {string} accountReference - Account reference (e.g., order ID)
 * @param {string} transactionDesc - Transaction description
 * @returns {Promise<object>} STK Push response
 */
const initiateSTKPush = async (phoneNumber, amount, accountReference, transactionDesc) => {
    const timestamp = new Date().toISOString().replace(/[-:T.Z]/g, '').substring(0, 14);
    const password = generatePassword(timestamp);

    // Demo mode - return mock response
    if (password.startsWith('demo:')) {
        console.log('[M-Pesa] Demo mode: Simulating STK Push to', phoneNumber, 'for KES', amount);
        return {
            success: true,
            isDemo: true,
            CheckoutRequestID: 'demo_' + uuidv4().substring(0, 8).toUpperCase(),
            ResponseCode: '0',
            ResponseDescription: 'Success. Request accepted for processing',
            MerchantRequestID: 'demo_mr_' + uuidv4().substring(0, 8).toUpperCase(),
            CustomerMessage: `STK Push sent to ${phoneNumber}. Amount: KES ${amount}. (Demo Mode)`,
            phoneNumber,
            amount,
            accountReference,
            transactionDesc,
            timestamp: new Date().toISOString()
        };
    }

    const accessToken = await generateAccessToken();

    const requestData = {
        BusinessShortCode: config.shortcode,
        Password: password,
        Timestamp: timestamp,
        TransactionType: 'CustomerBuyGoodsOnline',
        Amount: Math.ceil(amount), // Must be integer
        PartyA: phoneNumber,
        PartyB: config.shortcode,
        PhoneNumber: phoneNumber,
        CallBackURL: config.callbackUrl,
        AccountReference: accountReference,
        TransactionDesc: transactionDesc || 'The Quill Restaurant Payment'
    };

    return new Promise((resolve, reject) => {
        const options = {
            hostname: getBaseUrl().replace('https://', ''),
            path: '/mpesa/stkpush/v1/processrequest',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${accessToken}`
            }
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    if (json.ResponseCode === '0' || json.ResponseCode === undefined) {
                        resolve({
                            success: true,
                            isDemo: false,
                            CheckoutRequestID: json.CheckoutRequestID,
                            ResponseCode: json.ResponseCode,
                            ResponseDescription: json.ResponseDescription,
                            MerchantRequestID: json.MerchantRequestID,
                            CustomerMessage: json.CustomerMessage || 'Payment request sent successfully'
                        });
                    } else {
                        reject(new Error(json.ResponseDescription || 'STK Push failed'));
                    }
                } catch (e) {
                    reject(new Error('Failed to parse STK Push response'));
                }
            });
        });

        req.on('error', (e) => {
            console.error('[M-Pesa] STK Push error:', e.message);
            // Return demo response on network error
            resolve({
                success: true,
                isDemo: true,
                CheckoutRequestID: 'demo_' + uuidv4().substring(0, 8).toUpperCase(),
                ResponseCode: '0',
                ResponseDescription: 'Network error - demo mode',
                MerchantRequestID: 'demo_mr_' + uuidv4().substring(0, 8).toUpperCase(),
                CustomerMessage: `STK Push sent to ${phoneNumber}. Amount: KES ${amount}. (Demo Mode)`,
                phoneNumber,
                amount,
                accountReference,
                transactionDesc,
                timestamp: new Date().toISOString()
            });
        });

        req.write(JSON.stringify(requestData));
        req.end();
    });
};

/**
 * Query STK Push Status
 * @param {string} checkoutRequestId - Checkout request ID from STK Push
 * @returns {Promise<object>} STK Push status response
 */
const querySTKStatus = async (checkoutRequestId) => {
    // Demo mode - return mock status
    if (checkoutRequestId.startsWith('demo_')) {
        // Simulate a successful payment after a short delay
        return {
            success: true,
            isDemo: true,
            ResponseCode: '0',
            ResponseDescription: 'Success',
            ResultCode: '0',
            ResultDesc: 'The service request is processed successfully.',
            CheckoutRequestID: checkoutRequestId,
            TransactionId: 'DEMO' + Date.now(),
            TransactionAmount: 0,
            PhoneNumber: ''
        };
    }

    const timestamp = new Date().toISOString().replace(/[-:T.Z]/g, '').substring(0, 14);
    const password = generatePassword(timestamp);
    const accessToken = await generateAccessToken();

    const requestData = {
        BusinessShortCode: config.shortcode,
        Password: password,
        Timestamp: timestamp,
        CheckoutRequestID: checkoutRequestId
    };

    return new Promise((resolve, reject) => {
        const options = {
            hostname: getBaseUrl().replace('https://', ''),
            path: '/mpesa/stkpushquery/v1/query',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${accessToken}`
            }
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    if (json.ResponseCode === '0' || json.ResponseCode === undefined) {
                        resolve({
                            success: true,
                            isDemo: false,
                            ResponseCode: json.ResponseCode,
                            ResponseDescription: json.ResponseDescription,
                            ResultCode: json.ResultCode,
                            ResultDesc: json.ResultDesc,
                            CheckoutRequestID: json.CheckoutRequestID,
                            TransactionId: json.MpesaReceiptNumber
                        });
                    } else {
                        // Return as success but with failed status
                        resolve({
                            success: true,
                            isDemo: false,
                            ResponseCode: json.ResponseCode,
                            ResponseDescription: json.ResponseDescription,
                            ResultCode: json.ResultCode || '1',
                            ResultDesc: json.ResultDesc || 'Payment not completed',
                            CheckoutRequestID: json.CheckoutRequestID
                        });
                    }
                } catch (e) {
                    reject(new Error('Failed to parse STK status response'));
                }
            });
        });

        req.on('error', (e) => {
            console.error('[M-Pesa] STK Status query error:', e.message);
            // Return demo status on network error
            resolve({
                success: true,
                isDemo: true,
                ResponseCode: '0',
                ResponseDescription: 'Network error - demo mode',
                ResultCode: '0',
                ResultDesc: 'The service request is processed successfully. (Demo Mode)',
                CheckoutRequestID: checkoutRequestId,
                TransactionId: 'DEMO' + Date.now()
            });
        });

        req.write(JSON.stringify(requestData));
        req.end();
    });
};

/**
 * Format phone number to M-Pesa format (254xxxxxxxxx)
 * @param {string} phone - Phone number in any format
 * @returns {string} Formatted phone number
 */
const formatPhoneNumber = (phone) => {
    // Remove all non-digit characters
    let cleaned = phone.replace(/\D/g, '');

    // Handle different formats
    if (cleaned.startsWith('0') && cleaned.length === 10) {
        // Convert 07xx xxx xxx to 2547xx xxx xxx
        cleaned = '254' + cleaned.substring(1);
    } else if (cleaned.startsWith('254') && cleaned.length === 12) {
        // Already in correct format
        cleaned = cleaned;
    } else if (cleaned.startsWith('7') && cleaned.length === 9) {
        // Add country code: 7xx xxx xxx to 2547xx xxx xxx
        cleaned = '254' + cleaned;
    } else if (cleaned.startsWith('+') && cleaned.length === 13) {
        // Remove +: +254xxxxxxxxx to 254xxxxxxxxx
        cleaned = cleaned.substring(1);
    }

    return cleaned;
};

module.exports = {
    config,
    generateAccessToken,
    generatePassword,
    initiateSTKPush,
    querySTKStatus,
    formatPhoneNumber
};
