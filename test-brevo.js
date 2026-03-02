require('dotenv').config();
const api = require('sib-api-v3-sdk');

const testBrevoAPI = async () => {
    try {
        console.log('🔍 Testing Brevo API Key...');
        console.log(`API Key (first 20 chars): ${process.env.BREVO_API_KEY?.substring(0, 20)}...`);

        // Initialize client
        const brevoClient = api.ApiClient.instance;
        brevoClient.authentications['api-key'].apiKey = process.env.BREVO_API_KEY;

        // Test with TransactionalEmailsApi
        const apiInstance = new api.TransactionalEmailsApi(brevoClient);
        const sendSmtpEmail = new api.SendSmtpEmail();

        sendSmtpEmail.subject = '🧪 Test Email from The Quill Backend';
        sendSmtpEmail.htmlContent = `
            <div style="font-family: Arial; padding: 20px; background: #f0f0f0;">
                <h1 style="color: #2ecc71;"> Brevo API is Working!</h1>
                <p>This is a test email to verify your Brevo API key is valid and functional.</p>
                <p><strong>Timestamp:</strong> ${new Date().toISOString()}</p>
            </div>
        `;
        sendSmtpEmail.sender = {
            name: 'The Quill Restaurant',
            email: process.env.BREVO_SENDER_EMAIL || 'noreply@thequill.com'
        };
        sendSmtpEmail.to = [{ email: process.env.BREVO_SENDER_EMAIL || 'noreply@thequill.com' }];

        console.log('📤 Sending test email...');
        const response = await apiInstance.sendTransacEmail(sendSmtpEmail);

        console.log(' SUCCESS! Brevo API is working correctly!');
        console.log(` Email sent with message ID: ${response.messageId}`);
        console.log('\n Your API key is valid and functional!');
        process.exit(0);

    } catch (error) {
        console.error(' FAILED! Brevo API test failed');
        console.error('Error:', error.message);
        if (error.response) {
            console.error('Status Code:', error.response.status);
            console.error('Response:', error.response.body);
        }
        process.exit(1);
    }
};

testBrevoAPI();
