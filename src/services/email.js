const api = require('sib-api-v3-sdk');
const { config } = require('../config');

// Initialize Brevo client at module load time
let brevoClient = null;

const initBrevo = () => {
    try {
        // The SDK already initializes authentications when loaded
        // We just need to set the API key property (not overwrite the entire object)
        if (config.brevo.apiKey) {
            api.ApiClient.instance.authentications['api-key'].apiKey = config.brevo.apiKey;
            brevoClient = api.ApiClient.instance;
            console.log('Brevo API initialized with key: YES');
            console.log('Brevo Sender Email:', config.brevo.senderEmail);
        } else {
            console.log('Brevo API initialization failed: No API key');
        }
    } catch (error) {
        console.error('Brevo init error:', error.message);
    }
};

// Initialize on module load
initBrevo();

const sendEmailNotification = async (to, subject, htmlContent) => {
    // Default to empty string if htmlContent is not provided
    let content = htmlContent || '';

    // Check if API key is configured
    if (!config.brevo.apiKey) {
        console.log(`[DEMO] Email to: ${to}, Subject: ${subject} (no API key)`);
        return false;
    }

    // Ensure Brevo client is initialized
    if (!brevoClient) {
        initBrevo();
    }

    // Check again after init
    if (!brevoClient) {
        console.log(`[DEMO] Email to: ${to}, Subject: ${subject} (client not initialized)`);
        return false;
    }

    const modernTemplate = (bodyContent) => `
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
                    ${bodyContent}
                </table>
            </td>
        </tr>
    </table>
</body>
</html>`;

    // Wrap content in modern template if not already HTML
    if (!content || !content.includes('<!DOCTYPE html>')) {
        htmlContent = modernTemplate(`
            <tr>
                <td style="background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); padding: 40px 30px; text-align: center;">
                    <h1 style="color: #ffffff; margin: 0; font-size: 28px; font-weight: 700;">🍽️ The Quill</h1>
                    <p style="color: #a0a0a0; margin: 10px 0 0 0; font-size: 14px;">Fine Dining Experience</p>
                </td>
            </tr>
            <tr>
                <td style="padding: 40px 30px;">
                    ${content}
                </td>
            </tr>
            <tr>
                <td style="background-color: #f8f9fa; padding: 20px; text-align: center;">
                    <p style="color: #999999; margin: 0; font-size: 12px;">© 2026 The Quill Restaurant. All rights reserved.</p>
                    <p style="color: #999999; margin: 5px 0 0 0; font-size: 11px;">Nambale, Kisumu - Busia Rd, Busia, Kenya</p>
                </td>
            </tr>`);
    }

    try {
        const apiInstance = new api.TransactionalEmailsApi(brevoClient);
        const sendSmtpEmail = new api.SendSmtpEmail();
        sendSmtpEmail.subject = subject;
        sendSmtpEmail.htmlContent = htmlContent;
        sendSmtpEmail.sender = {
            name: 'The Quill Restaurant',
            email: config.brevo.senderEmail
        };
        sendSmtpEmail.to = [{ email: to }];

        await apiInstance.sendTransacEmail(sendSmtpEmail);
        console.log(`Email sent successfully to: ${to}`);
        return true;
    } catch (error) {
        console.error('Brevo API Error for', to, ':', error.message);
        if (error.response && error.response.body) {
            console.error('Brevo error details:', JSON.stringify(error.response.body));
            // Log specific error codes for debugging
            if (error.response.body.code) {
                console.error('Brevo error code:', error.response.body.code);
            }
            if (error.response.body.message) {
                console.error('Brevo error message:', error.response.body.message);
            }
        }
        // Return false but with more detailed error info in logs
        console.error(`[EMAIL] Failed to send to ${to}. Check Brevo API key and sender email verification.`);
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

module.exports = {
    initBrevo,
    sendEmailNotification,
    sendSMSNotification
};

