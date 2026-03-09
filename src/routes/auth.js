const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { config } = require('../config');
const { User, Order, Wishlist, Cart, LoyaltyPoints } = require('../models/index');
const { authenticateToken, requireAuth, requireAdmin } = require('../middleware/auth');
const { sendEmailNotification } = require('../services/email');

const JWT_SECRET = config.jwtSecret;
const FRONTEND_URL = config.frontendUrl;

// Register
router.post('/register', async (req, res) => {
    try {
        const { email, password, name, phone } = req.body;
        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password required' });
        }
        const existingUser = await User.findOne({ email });
        if (existingUser) {
            return res.status(409).json({ error: 'User already exists' });
        }
        const hashedPassword = await bcrypt.hash(password, 10);
        const userId = 'USR-' + uuidv4().substring(0, 8).toUpperCase();
        const verifyToken = jwt.sign({ userId, email, type: 'email-verify' }, JWT_SECRET, { expiresIn: '24h' });
        const user = new User({ _id: userId, email, password: hashedPassword, name: name || email.split('@')[0], phone: phone || '' });
        await user.save();
        const verifyUrl = `${FRONTEND_URL}/verify-email?token=${verifyToken}`;
        await sendEmailNotification(email, 'Welcome to The Quill Restaurant - Verify Your Email', `<p>Click <a href="${verifyUrl}">here</a> to verify your email.</p>`);
        res.status(201).json({ message: 'Registration successful. Please check your email to verify your account.', requiresVerification: true, email: user.email });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Login
router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password required' });
        }
        console.log('[Auth] Login attempt for:', email);

        // Check if User model is available
        if (!User) {
            console.error('[Auth] User model is undefined!');
            return res.status(500).json({ error: 'Server configuration error: User model not loaded' });
        }

        const user = await User.findOne({ email });
        if (!user) {
            console.log('[Auth] User not found:', email);
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        console.log('[Auth] User found, comparing password...');
        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) {
            console.log('[Auth] Invalid password for:', email);
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        console.log('[Auth] Password valid, checking email verification...');
        console.log('[Auth] User email:', user.email);
        console.log('[Auth] Admin emails from config:', config.adminEmails);
        const isAdminUser = config.adminEmails.includes(user.email) || user.isAdmin === true || user.role === 'admin';
        console.log('[Auth] Is admin user:', isAdminUser);
        if (!user.emailVerified && !isAdminUser) {
            console.log('[Auth] Email not verified:', email);
            return res.status(403).json({ error: 'Please verify your email before logging in' });
        }
        console.log('[Auth] Creating JWT token...');
        const token = jwt.sign({ userId: user._id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
        console.log('[Auth] Login successful for:', email);
        res.json({ message: 'Login successful', token, user: { userId: user._id, email: user.email, name: user.name, isAdmin: isAdminUser } });
    } catch (err) {
        console.error('[Auth] Login error:', err);
        console.error('[Auth] Login error stack:', err.stack);
        res.status(500).json({ error: err.message });
    }
});

// Verify email
router.post('/verify-email', async (req, res) => {
    try {
        const { token } = req.body;
        if (!token) {
            return res.status(400).json({ error: 'Verification token is required' });
        }
        let decoded;
        try {
            decoded = jwt.verify(token, JWT_SECRET);
        } catch (err) {
            return res.status(400).json({ error: 'Invalid or expired token' });
        }
        if (decoded.type !== 'email-verify') {
            return res.status(400).json({ error: 'Invalid token type' });
        }
        const user = await User.findById(decoded.userId);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        if (user.emailVerified) {
            return res.json({ message: 'Email already verified. You can proceed to login.', verified: true });
        }
        user.emailVerified = true;
        user.updatedAt = new Date();
        await user.save();
        res.json({ message: 'Email verified successfully! Welcome to The Quill.', verified: true, email: user.email });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Resend verification
router.post('/resend-verification', async (req, res) => {
    try {
        const { email } = req.body;
        if (!email) {
            return res.status(400).json({ error: 'Email is required' });
        }
        const user = await User.findOne({ email });
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        if (user.emailVerified) {
            return res.json({ message: 'Email is already verified' });
        }
        const verifyToken = jwt.sign({ userId: user._id, email: user.email, type: 'email-verify' }, JWT_SECRET, { expiresIn: '24h' });
        const verifyUrl = `${FRONTEND_URL}/verify-email?token=${verifyToken}`;
        await sendEmailNotification(email, 'Verify Your Email - The Quill Restaurant', `<p>Click <a href="${verifyUrl}">here</a> to verify your email.</p>`);
        res.json({ message: 'Verification email sent. Please check your inbox.' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Forgot password
router.post('/forgot-password', async (req, res) => {
    try {
        const { email } = req.body;
        if (!email) {
            return res.status(400).json({ error: 'Email is required' });
        }
        const user = await User.findOne({ email });
        if (!user) {
            return res.json({ message: 'If an account exists with this email, you will receive a password reset link shortly.' });
        }
        const resetToken = jwt.sign({ userId: user._id, email: user.email, type: 'password-reset' }, JWT_SECRET, { expiresIn: '1h' });
        const resetUrl = `${FRONTEND_URL}/reset-password?token=${resetToken}`;
        await sendEmailNotification(email, 'Reset Your Password - The Quill Restaurant', `<p>Click <a href="${resetUrl}">here</a> to reset your password.</p>`);
        res.json({ message: 'If an account exists with this email, you will receive a password reset link shortly.' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Reset password
router.post('/reset-password', async (req, res) => {
    try {
        const { token, newPassword } = req.body;
        if (!token || !newPassword) {
            return res.status(400).json({ error: 'Token and new password are required' });
        }
        if (newPassword.length < 6) {
            return res.status(400).json({ error: 'Password must be at least 6 characters' });
        }
        let decoded;
        try {
            decoded = jwt.verify(token, JWT_SECRET);
        } catch (err) {
            return res.status(400).json({ error: 'Invalid or expired token' });
        }
        if (decoded.type !== 'password-reset') {
            return res.status(400).json({ error: 'Invalid token type' });
        }
        const user = await User.findById(decoded.userId);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        user.password = await bcrypt.hash(newPassword, 10);
        await user.save();
        await sendEmailNotification(user.email, 'Password Reset Successful - The Quill Restaurant', '<p>Your password has been successfully reset.</p>');
        res.json({ message: 'Password reset successful. You can now login with your new password.' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get profile
router.get('/profile', authenticateToken, async (req, res) => {
    try {
        if (!req.user) {
            return res.status(401).json({ error: 'Not authenticated' });
        }
        const user = await User.findById(req.user.userId);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        res.json({ userId: user._id, email: user.email, name: user.name, phone: user.phone, address: user.address });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Update profile
router.put('/profile', authenticateToken, async (req, res) => {
    try {
        if (!req.user) {
            return res.status(401).json({ error: 'Not authenticated' });
        }
        const { name, phone, address } = req.body;
        const user = await User.findByIdAndUpdate(req.user.userId, { name, phone, address, updatedAt: new Date() }, { new: true });
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        res.json({ message: 'Profile updated successfully', user: { userId: user._id, email: user.email, name: user.name } });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Change password
router.post('/change-password', authenticateToken, async (req, res) => {
    try {
        if (!req.user) {
            return res.status(401).json({ error: 'Not authenticated' });
        }
        const { currentPassword, newPassword } = req.body;
        if (!currentPassword || !newPassword) {
            return res.status(400).json({ error: 'Current and new passwords are required' });
        }
        if (newPassword.length < 6) {
            return res.status(400).json({ error: 'New password must be at least 6 characters' });
        }
        const user = await User.findById(req.user.userId);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        const validPassword = await bcrypt.compare(currentPassword, user.password);
        if (!validPassword) {
            return res.status(401).json({ error: 'Current password is incorrect' });
        }
        user.password = await bcrypt.hash(newPassword, 10);
        user.updatedAt = new Date();
        await user.save();
        res.json({ message: 'Password changed successfully' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get addresses
router.get('/addresses', authenticateToken, async (req, res) => {
    try {
        if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
        const user = await User.findById(req.user.userId);
        if (!user) return res.status(404).json({ error: 'User not found' });
        res.json({ addresses: user.addresses || [] });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Add address
router.post('/addresses', authenticateToken, async (req, res) => {
    try {
        if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
        const { label, street, city, instructions, isDefault } = req.body;
        if (!street || !city) return res.status(400).json({ error: 'Street and city are required' });
        const user = await User.findById(req.user.userId);
        if (!user) return res.status(404).json({ error: 'User not found' });
        const addressId = 'ADDR-' + uuidv4().substring(0, 8).toUpperCase();
        const newAddress = { _id: addressId, label: label || 'Other', street, city, instructions: instructions || '', isDefault: isDefault || false };
        if (isDefault && user.addresses) user.addresses.forEach(addr => addr.isDefault = false);
        user.addresses = user.addresses || [];
        user.addresses.push(newAddress);
        user.updatedAt = new Date();
        await user.save();
        res.status(201).json({ message: 'Address added', address: newAddress });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Delete address
router.delete('/addresses/:id', authenticateToken, async (req, res) => {
    try {
        if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
        const { id } = req.params;
        const user = await User.findById(req.user.userId);
        if (!user) return res.status(404).json({ error: 'User not found' });
        user.addresses = (user.addresses || []).filter(addr => addr._id !== id);
        user.updatedAt = new Date();
        await user.save();
        res.json({ message: 'Address deleted' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Set default address
router.put('/addresses/:id/default', authenticateToken, async (req, res) => {
    try {
        if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
        const { id } = req.params;
        const user = await User.findById(req.user.userId);
        if (!user) return res.status(404).json({ error: 'User not found' });
        user.addresses = (user.addresses || []).map(addr => ({ ...addr, isDefault: addr._id === id }));
        user.updatedAt = new Date();
        await user.save();
        res.json({ message: 'Default address updated', addresses: user.addresses });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get payment methods
router.get('/payment-methods', authenticateToken, async (req, res) => {
    try {
        if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
        const user = await User.findById(req.user.userId);
        if (!user) return res.status(404).json({ error: 'User not found' });
        const methods = (user.paymentMethods || []).map(m => ({
            _id: m._id, type: m.type, label: m.label, last4: m.last4, expiryMonth: m.expiryMonth, expiryYear: m.expiryYear,
            mobileNumber: m.mobileNumber ? m.mobileNumber.slice(-4) : null, isDefault: m.isDefault, addedAt: m.addedAt
        }));
        res.json({ paymentMethods: methods });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Add payment method
router.post('/payment-methods', authenticateToken, async (req, res) => {
    try {
        if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
        const { type, label, last4, expiryMonth, expiryYear, cardholderName, mobileNumber } = req.body;
        if (!type || !['card', 'mpesa'].includes(type)) return res.status(400).json({ error: 'Invalid payment method type' });
        if (type === 'card' && (!last4 || !expiryMonth || !expiryYear)) return res.status(400).json({ error: 'Card details are required' });
        if (type === 'mpesa' && !mobileNumber) return res.status(400).json({ error: 'Mobile number is required for M-Pesa' });
        const user = await User.findById(req.user.userId);
        if (!user) return res.status(404).json({ error: 'User not found' });
        const newMethod = {
            _id: uuidv4(), type, label: label || (type === 'card' ? `Card ending in ${last4}` : 'M-Pesa'),
            last4, expiryMonth, expiryYear, cardholderName, mobileNumber,
            isDefault: (user.paymentMethods || []).length === 0, addedAt: new Date()
        };
        user.paymentMethods = (user.paymentMethods || []);
        user.paymentMethods.push(newMethod);
        user.updatedAt = new Date();
        await user.save();
        res.status(201).json({ message: 'Payment method added', paymentMethod: newMethod });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Delete payment method
router.delete('/payment-methods/:id', authenticateToken, async (req, res) => {
    try {
        if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
        const { id } = req.params;
        const user = await User.findById(req.user.userId);
        if (!user) return res.status(404).json({ error: 'User not found' });
        const methodToDelete = (user.paymentMethods || []).find(m => m._id === id);
        if (!methodToDelete) return res.status(404).json({ error: 'Payment method not found' });
        user.paymentMethods = (user.paymentMethods || []).filter(m => m._id !== id);
        if (methodToDelete.isDefault && user.paymentMethods.length > 0) user.paymentMethods[0].isDefault = true;
        user.updatedAt = new Date();
        await user.save();
        res.json({ message: 'Payment method deleted' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Delete account
router.delete('/account', authenticateToken, async (req, res) => {
    try {
        if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
        const { password } = req.body;
        if (!password) return res.status(400).json({ error: 'Password is required for account deletion' });
        const user = await User.findById(req.user.userId);
        if (!user) return res.status(404).json({ error: 'User not found' });
        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) return res.status(401).json({ error: 'Invalid password' });
        user.accountStatus = 'deleted';
        user.deletedAt = new Date();
        user.email = null;
        user.phone = null;
        user.address = null;
        user.addresses = [];
        user.paymentMethods = [];
        user.notificationPreferences = {};
        await user.save();
        res.json({ message: 'Account successfully deleted.' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Download data
router.get('/download-data', authenticateToken, async (req, res) => {
    try {
        if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
        const user = await User.findById(req.user.userId);
        if (!user) return res.status(404).json({ error: 'User not found' });
        const orders = await Order.find({ customerEmail: user.email });
        const wishlist = await Wishlist.findOne({ userId: req.user.userId });
        const cart = await Cart.findOne({ userId: req.user.userId });
        const loyaltyPoints = await LoyaltyPoints.findOne({ userId: req.user.userId });
        const userData = {
            user: { id: user._id, email: user.email, name: user.name, phone: user.phone, createdAt: user.createdAt, addresses: user.addresses },
            orders: orders.map(o => ({ id: o._id, total: o.total, status: o.status, items: o.items, createdAt: o.createdAt })),
            wishlist: wishlist?.items || [],
            cart: cart?.items || [],
            loyaltyPoints: loyaltyPoints ? { currentPoints: loyaltyPoints.points, tier: loyaltyPoints.tier, lifetimePoints: loyaltyPoints.lifetimePoints } : null,
            exportedAt: new Date()
        };
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', 'attachment; filename="user-data-export.json"');
        res.send(JSON.stringify(userData, null, 2));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Update preferences
router.put('/preferences', authenticateToken, async (req, res) => {
    try {
        if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
        const { notificationPreferences } = req.body;
        const user = await User.findByIdAndUpdate(req.user.userId, { notificationPreferences, updatedAt: new Date() }, { new: true });
        if (!user) return res.status(404).json({ error: 'User not found' });
        res.json({ message: 'Preferences updated', notificationPreferences: user.notificationPreferences });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
