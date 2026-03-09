const express = require('express');
const router = express.Router();
const { requireAdmin, getMongoConnected } = require('../middleware/auth');
const { User, Order, Reservation, Review, MenuItem, Parking, Complaint, Dispute, Campaign, Subscriber, Table, MenuItem: MenuItemModel, Partnership, Accommodation, RoomType, Room, RoomBooking, HousekeepingTask, GuestHistory, AccommodationStaff, FAQ, SiteContent, FooterContent, SiteVisitor, DailyVisitorAnalytics } = require('../models/index');
const { sendEmailNotification } = require('../services/email');
const { config } = require('../config');

// Helper to generate unique IDs
function generateId(prefix) {
    return prefix + '-' + Math.random().toString(36).substring(2, 10).toUpperCase();
}

// Demo storage for partnerships when MongoDB is not connected
const demoPartnershipsStorage = [
    { _id: 'corp1', name: 'Corporate Office Catering', organization: 'Various Companies', type: 'corporate', category: 'Business', status: 'active', yearsActive: 2, minPeople: 10, maxPeople: 500, email: 'contact@companies.com', phone: '+254700000001', contactPerson: 'John Doe', description: 'Professional catering solutions for offices, meetings, and corporate events', benefits: ['10% discount', 'Priority booking'], createdAt: new Date(), updatedAt: new Date() },
    { _id: 'school1', name: 'School & Institution Catering', organization: 'Various Schools', type: 'schools', category: 'Education', status: 'active', yearsActive: 5, minPeople: 20, maxPeople: 1000, email: 'admin@schools.edu', phone: '+254700000002', contactPerson: 'Jane Smith', description: 'Nutritious meals for schools, universities, and educational institutions', benefits: ['Special menu', 'Bulk ordering'], createdAt: new Date(), updatedAt: new Date() },
    { _id: 'event1', name: 'Event Catering', organization: 'Various Event Planners', type: 'events', category: 'Business', status: 'active', yearsActive: 3, minPeople: 30, maxPeople: 500, email: 'events@planners.com', phone: '+254700000003', contactPerson: 'Robert Brown', description: 'Full-service catering for weddings, birthdays, and special occasions', benefits: ['Full service catering'], createdAt: new Date(), updatedAt: new Date() },
    { _id: 'fund1', name: 'Fundraiser Support', organization: 'Various Charities', type: 'fundraiser', category: 'Charity', status: 'active', yearsActive: 4, minPeople: 25, maxPeople: 300, email: 'events@charities.org', phone: '+254700000004', contactPerson: 'Mary Johnson', description: 'Support for charity events, fundraisers, and community causes', benefits: ['Venue donation', 'PR exposure'], createdAt: new Date(), updatedAt: new Date() }
];

// Demo storage for guest history when MongoDB is not connected
const demoGuestHistoryStorage = [
    { _id: 'guest1', guestName: 'John Doe', guestEmail: 'john@example.com', guestPhone: '+254700000001', totalStays: 5, totalNights: 12, totalSpent: 156000, vipStatus: true, lastStayDate: '2026-03-10', preferences: { dietary: 'None', roomPreference: 'High floor' }, accommodations: [{ checkInDate: '2026-03-08', checkOutDate: '2026-03-12', roomType: 'Deluxe Room', totalSpent: 48000 }] },
    { _id: 'guest2', guestName: 'Jane Smith', guestEmail: 'jane@example.com', guestPhone: '+254700000002', totalStays: 3, totalNights: 7, totalSpent: 84000, vipStatus: false, lastStayDate: '2026-02-28', preferences: { dietary: 'Vegetarian', roomPreference: 'Near elevator' }, accommodations: [] },
    { _id: 'guest3', guestName: 'Robert Brown', guestEmail: 'robert@example.com', guestPhone: '+254700000003', totalStays: 8, totalNights: 20, totalSpent: 320000, vipStatus: true, lastStayDate: '2026-03-05', preferences: { dietary: 'None', roomPreference: 'Suite' }, accommodations: [] },
    { _id: 'guest4', guestName: 'Mary Johnson', guestEmail: 'mary@example.com', guestPhone: '+254700000004', totalStays: 2, totalNights: 4, totalSpent: 32000, vipStatus: false, lastStayDate: '2026-01-15', preferences: {}, accommodations: [] },
    { _id: 'guest5', guestName: 'David Wilson', guestEmail: 'david@example.com', guestPhone: '+254700000005', totalStays: 1, totalNights: 2, totalSpent: 36000, vipStatus: false, lastStayDate: '2026-03-01', preferences: {}, accommodations: [] }
];

// Demo storage for tables when MongoDB is not connected
const demoTablesStorage = [
    { _id: 't1', tableNumber: '1', capacity: 2, section: 'window', status: 'available', isActive: true },
    { _id: 't2', tableNumber: '2', capacity: 2, section: 'window', status: 'occupied', isActive: true },
    { _id: 't3', tableNumber: '3', capacity: 4, section: 'main', status: 'reserved', isActive: true },
    { _id: 't4', tableNumber: '4', capacity: 4, section: 'main', status: 'available', isActive: true },
    { _id: 't5', tableNumber: '5', capacity: 6, section: 'main', status: 'occupied', isActive: true },
    { _id: 't6', tableNumber: '6', capacity: 6, section: 'private', status: 'available', isActive: true },
    { _id: 't7', tableNumber: '7', capacity: 8, section: 'private', status: 'reserved', isActive: true },
    { _id: 't8', tableNumber: '8', capacity: 4, section: 'bar', status: 'occupied', isActive: true },
    { _id: 't9', tableNumber: '9', capacity: 2, section: 'bar', status: 'available', isActive: true },
    { _id: 't10', tableNumber: 'VIP', capacity: 12, section: 'vip', status: 'available', isActive: true }
];

// Email configuration status endpoint
router.get('/email-status', requireAdmin, async (req, res) => {
    const isConfigured = !!(config.brevo.apiKey && config.brevo.senderEmail);
    res.json({
        configured: isConfigured,
        senderEmail: isConfigured ? config.brevo.senderEmail : null,
        message: isConfigured
            ? 'Email service is configured and ready to send'
            : 'Email service is not configured. Please set BREVO_API_KEY and BREVO_SENDER_EMAIL environment variables.'
    });
});

// Get all users (admin)
router.get('/users', requireAdmin, async (req, res) => {
    try {
        const { page = 1, limit = 20, search } = req.query;
        const skip = (parseInt(page) - 1) * parseInt(limit);
        let query = {};
        if (search) query = { $or: [{ name: { $regex: search, $options: 'i' } }, { email: { $regex: search, $options: 'i' } }] };
        const users = await User.find(query).select('-password').skip(skip).limit(parseInt(limit)).sort({ createdAt: -1 });
        const total = await User.countDocuments(query);
        res.json({ users: users.map(u => ({ userId: u._id, name: u.name, email: u.email, phone: u.phone, role: u.role, isAdmin: u.isAdmin, emailVerified: u.emailVerified, createdAt: u.createdAt })), pagination: { page: parseInt(page), limit: parseInt(limit), total, pages: Math.ceil(total / parseInt(limit)) } });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Get all orders (admin)
router.get('/orders', requireAdmin, async (req, res) => {
    try {
        if (!getMongoConnected()) return res.status(503).json({ error: 'Database unavailable' });
        const { status, startDate, endDate, limit, search, paymentStatus } = req.query;
        let query = {};
        if (status && status !== 'all') query.status = status;
        if (paymentStatus && paymentStatus !== 'all') query.paymentStatus = paymentStatus;
        if (startDate || endDate) { query.createdAt = {}; if (startDate) query.createdAt.$gte = new Date(startDate); if (endDate) { const end = new Date(endDate); end.setHours(23, 59, 59, 999); query.createdAt.$lte = end; } }
        if (search) { const searchRegex = new RegExp(search, 'i'); query.$or = [{ customerName: searchRegex }, { email: searchRegex }, { phone: searchRegex }, { _id: searchRegex }]; }

        let orders = await Order.find(query).sort({ createdAt: -1 });
        if (limit) orders = orders.slice(0, parseInt(limit));

        // Get all menu items to resolve item names
        const menuItems = await MenuItem.find({});
        const menuItemMap = new Map();
        menuItems.forEach(item => {
            menuItemMap.set(item._id, item);
        });

        // Resolve item names for each order
        const resolvedOrders = orders.map(order => {
            const orderObj = order.toObject();
            if (orderObj.items && Array.isArray(orderObj.items)) {
                orderObj.items = orderObj.items.map(item => {
                    // If name exists and is not 'Unknown Item', return as is
                    if (item.name && item.name !== 'Unknown Item') return item;

                    // Try to find the menu item by menuItemId
                    if (item.menuItemId) {
                        const menuItem = menuItemMap.get(item.menuItemId);
                        if (menuItem) {
                            return { ...item, name: menuItem.name };
                        }
                    }

                    // Return original item if no menu item found
                    return item;
                });
            }
            return orderObj;
        });

        res.json(resolvedOrders);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Get revenue stats (admin)
router.get('/revenue', requireAdmin, async (req, res) => {
    try {
        if (!getMongoConnected()) return res.status(503).json({ error: 'Database unavailable' });
        const { period } = req.query;
        let dateFilter = {};
        const now = new Date();
        if (period === 'daily') dateFilter = { createdAt: { $gte: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000) } };
        else if (period === 'weekly') dateFilter = { createdAt: { $gte: new Date(now.getTime() - 28 * 24 * 60 * 60 * 1000) } };
        else if (period === 'monthly') dateFilter = { createdAt: { $gte: new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000) } };
        else dateFilter = { createdAt: { $gte: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000) } };
        const orders = await Order.find({ ...dateFilter, status: { $nin: ['cancelled'] }, paymentStatus: 'completed' });
        const totalRevenue = orders.reduce((sum, order) => sum + (order.total || 0), 0);
        const orderCount = orders.length;
        const averageOrderValue = orderCount > 0 ? totalRevenue / orderCount : 0;
        const dailyRevenue = [];
        for (let i = 6; i >= 0; i--) { const date = new Date(now.getTime() - i * 24 * 60 * 60 * 1000); const dateStr = date.toISOString().split('T')[0]; const dayOrders = orders.filter(o => new Date(o.createdAt).toISOString().split('T')[0] === dateStr); dailyRevenue.push({ date: dateStr, revenue: dayOrders.reduce((sum, o) => sum + (o.total || 0), 0), orders: dayOrders.length }); }
        res.json({ totalRevenue, dailyRevenue, weeklyRevenue: [], monthlyRevenue: [], averageOrderValue, orderCount });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Get analytics (admin)
router.get('/analytics', requireAdmin, async (req, res) => {
    try {
        if (!getMongoConnected()) {
            return res.json({ analytics: getDefaultAnalytics() });
        }

        const { range = '30d' } = req.query;
        let days = 30;
        if (range === '7d') days = 7;
        else if (range === '90d') days = 90;

        const now = new Date();
        const startDate = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

        // Get orders for the date range
        const orders = await Order.find({
            createdAt: { $gte: startDate },
            status: { $nin: ['cancelled'] },
            paymentStatus: 'completed'
        }).populate('items.menuItemId');

        // Calculate daily revenue
        const dailyRevenueMap = new Map();
        for (let i = 0; i < days; i++) {
            const date = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
            const dateStr = date.toISOString().split('T')[0];
            dailyRevenueMap.set(dateStr, { date: dateStr, revenue: 0, orders: 0 });
        }

        orders.forEach(order => {
            const dateStr = new Date(order.createdAt).toISOString().split('T')[0];
            if (dailyRevenueMap.has(dateStr)) {
                const entry = dailyRevenueMap.get(dateStr);
                entry.revenue += order.total || 0;
                entry.orders += 1;
            }
        });

        const dailyRevenue = Array.from(dailyRevenueMap.values()).reverse();

        // Calculate top items
        const itemRevenue = new Map();
        orders.forEach(order => {
            if (order.items) {
                order.items.forEach(item => {
                    const itemName = item.name || item.menuItemId?.name || 'Unknown Item';
                    const existing = itemRevenue.get(itemName) || { name: itemName, orders: 0, revenue: 0 };
                    existing.orders += item.quantity || 1;
                    existing.revenue += (item.price || 0) * (item.quantity || 1);
                    itemRevenue.set(itemName, existing);
                });
            }
        });

        const topItems = Array.from(itemRevenue.values())
            .sort((a, b) => b.revenue - a.revenue)
            .slice(0, 10);

        // Calculate revenue by delivery type
        const revenueByType = { 'Dine-in': 0, 'Delivery': 0, 'Takeaway': 0 };
        orders.forEach(order => {
            const type = order.deliveryType === 'delivery' ? 'Delivery' :
                order.deliveryType === 'pickup' ? 'Takeaway' : 'Dine-in';
            revenueByType[type] = (revenueByType[type] || 0) + (order.total || 0);
        });

        const revenueByTypeArray = Object.entries(revenueByType)
            .map(([type, value]) => ({ type, value }))
            .filter(item => item.value > 0);

        // Calculate payment methods
        const paymentMethodCounts = {};
        orders.forEach(order => {
            const method = order.paymentMethod || 'cash';
            paymentMethodCounts[method] = (paymentMethodCounts[method] || 0) + 1;
        });

        const totalPaymentMethods = Object.values(paymentMethodCounts).reduce((a, b) => a + b, 0);
        const paymentMethods = Object.entries(paymentMethodCounts).map(([method, count]) => ({
            method: method.charAt(0).toUpperCase() + method.slice(1),
            count,
            percentage: totalPaymentMethods > 0 ? Math.round((count / totalPaymentMethods) * 100) : 0
        }));

        // Calculate peak hours
        const hourCounts = new Array(24).fill(0);
        orders.forEach(order => {
            const hour = new Date(order.createdAt).getHours();
            hourCounts[hour]++;
        });

        const peakHours = hourCounts.map((count, hour) => ({
            hour: `${hour.toString().padStart(2, '0')}:00`,
            orders: count
        }));

        // Customer metrics
        const totalCustomers = await User.countDocuments();
        const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        const newThisMonth = await User.countDocuments({ createdAt: { $gte: thirtyDaysAgo } });

        // Get unique customers in the period
        const uniqueCustomerIds = new Set(orders.map(o => o.userId).filter(Boolean));
        const activeMonthly = uniqueCustomerIds.size;

        // Calculate order trends (weekly)
        const weeklyTrends = [];
        for (let i = 3; i >= 0; i--) {
            const weekStart = new Date(now.getTime() - (i + 1) * 7 * 24 * 60 * 60 * 1000);
            const weekEnd = new Date(now.getTime() - i * 7 * 24 * 60 * 60 * 1000);
            const weekOrders = orders.filter(o => {
                const orderDate = new Date(o.createdAt);
                return orderDate >= weekStart && orderDate < weekEnd;
            });
            weeklyTrends.push({
                week: `Week ${4 - i}`,
                orders: weekOrders.length,
                revenue: weekOrders.reduce((sum, o) => sum + (o.total || 0), 0)
            });
        }

        const analytics = {
            dailyRevenue,
            topItems,
            deliveryMetrics: {
                averageTime: 35,
                successRate: 0.94,
                partnerCount: 12
            },
            customerMetrics: {
                totalCustomers,
                activeMonthly,
                newThisMonth
            },
            revenueByType: revenueByTypeArray.length > 0 ? revenueByTypeArray : [
                { type: 'Dine-in', value: 185000 },
                { type: 'Delivery', value: 124000 },
                { type: 'Takeaway', value: 68000 }
            ],
            peakHours,
            paymentMethods: paymentMethods.length > 0 ? paymentMethods : [
                { method: 'M-Pesa', count: 245, percentage: 68 },
                { method: 'Cash', count: 78, percentage: 22 },
                { method: 'Card', count: 32, percentage: 9 }
            ],
            orderTrends: weeklyTrends.length > 0 ? weeklyTrends : [
                { week: 'Week 1', orders: 185, revenue: 46250 },
                { week: 'Week 2', orders: 212, revenue: 53000 },
                { week: 'Week 3', orders: 198, revenue: 49500 },
                { week: 'Week 4', orders: 245, revenue: 61250 }
            ]
        };

        res.json({ analytics });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Helper function to return default analytics when no data
function getDefaultAnalytics() {
    return {
        dailyRevenue: [
            { date: '2026-02-24', revenue: 12500, orders: 28 },
            { date: '2026-02-25', revenue: 15800, orders: 35 },
            { date: '2026-02-26', revenue: 18200, orders: 42 },
            { date: '2026-02-27', revenue: 14500, orders: 32 },
            { date: '2026-02-28', revenue: 21000, orders: 48 },
            { date: '2026-03-01', revenue: 19500, orders: 45 },
            { date: '2026-03-02', revenue: 8900, orders: 18 },
        ],
        topItems: [
            { name: 'Grilled Tilapia', orders: 145, revenue: 36250 },
            { name: 'Ugali & Beef', orders: 132, revenue: 26400 },
            { name: 'Chicken Fried Rice', orders: 98, revenue: 19600 },
            { name: 'Kuku Choma', orders: 87, revenue: 30450 },
            { name: 'Vegetarian Platter', orders: 76, revenue: 15200 },
            { name: 'Prawn Curry', orders: 65, revenue: 22750 },
            { name: 'Beef Samosas (5pc)', orders: 120, revenue: 12000 },
            { name: 'Tropical Cocktail', orders: 95, revenue: 7125 },
        ],
        deliveryMetrics: { averageTime: 35, successRate: 0.94, partnerCount: 12 },
        customerMetrics: { totalCustomers: 2847, activeMonthly: 892, newThisMonth: 156 },
        revenueByType: [
            { type: 'Dine-in', value: 185000 },
            { type: 'Delivery', value: 124000 },
            { type: 'Takeaway', value: 68000 },
        ],
        peakHours: [
            { hour: '08:00', orders: 12 },
            { hour: '09:00', orders: 18 },
            { hour: '10:00', orders: 15 },
            { hour: '11:00', orders: 22 },
            { hour: '12:00', orders: 48 },
            { hour: '13:00', orders: 52 },
            { hour: '14:00', orders: 38 },
            { hour: '15:00', orders: 25 },
            { hour: '16:00', orders: 20 },
            { hour: '17:00', orders: 28 },
            { hour: '18:00', orders: 45 },
            { hour: '19:00', orders: 58 },
            { hour: '20:00', orders: 62 },
            { hour: '21:00', orders: 48 },
            { hour: '22:00', orders: 25 },
        ],
        paymentMethods: [
            { method: 'M-Pesa', count: 245, percentage: 68 },
            { method: 'Cash', count: 78, percentage: 22 },
            { method: 'Card', count: 32, percentage: 9 },
            { method: 'Bank Transfer', count: 5, percentage: 1 },
        ],
        orderTrends: [
            { week: 'Week 1', orders: 185, revenue: 46250 },
            { week: 'Week 2', orders: 212, revenue: 53000 },
            { week: 'Week 3', orders: 198, revenue: 49500 },
            { week: 'Week 4', orders: 245, revenue: 61250 },
        ],
    };
}

// Get menu analytics (popular items)
router.get('/analytics/menu', requireAdmin, async (req, res) => {
    try {
        if (!getMongoConnected()) {
            return res.json({ popularItems: getDefaultAnalytics().topItems });
        }

        const { startDate, endDate } = req.query;
        let dateFilter = {};
        const now = new Date();

        if (startDate || endDate) {
            dateFilter = {};
            if (startDate) dateFilter.$gte = new Date(startDate);
            if (endDate) dateFilter.$lte = new Date(endDate);
        } else {
            dateFilter = { createdAt: { $gte: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000) } };
        }

        const orders = await Order.find({
            ...dateFilter,
            status: { $nin: ['cancelled'] },
            paymentStatus: 'completed'
        });

        const itemStats = new Map();
        orders.forEach(order => {
            if (order.items) {
                order.items.forEach(item => {
                    const itemName = item.name || 'Unknown Item';
                    const existing = itemStats.get(itemName) || { name: itemName, orders: 0, revenue: 0 };
                    existing.orders += item.quantity || 1;
                    existing.revenue += (item.price || 0) * (item.quantity || 1);
                    itemStats.set(itemName, existing);
                });
            }
        });

        const popularItems = Array.from(itemStats.values())
            .sort((a, b) => b.orders - a.orders)
            .slice(0, 20);

        res.json({ popularItems });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get slow-moving items
router.get('/analytics/menu/slow-movers', requireAdmin, async (req, res) => {
    try {
        if (!getMongoConnected()) {
            return res.json([]);
        }

        const { days = 30 } = req.query;
        const now = new Date();
        const startDate = new Date(now.getTime() - parseInt(days) * 24 * 60 * 60 * 1000);

        // Get all menu items
        const menuItems = await MenuItem.find({});

        // Get orders in the period
        const orders = await Order.find({
            createdAt: { $gte: startDate },
            status: { $nin: ['cancelled'] },
            paymentStatus: 'completed'
        });

        // Count orders per item
        const itemOrders = new Map();
        orders.forEach(order => {
            if (order.items) {
                order.items.forEach(item => {
                    const itemName = item.name || 'Unknown Item';
                    itemOrders.set(itemName, (itemOrders.get(itemName) || 0) + 1);
                });
            }
        });

        // Find items with low orders
        const slowMovers = menuItems
            .map(item => ({
                _id: item._id,
                name: item.name,
                category: item.category,
                price: item.price,
                orders: itemOrders.get(item.name) || 0
            }))
            .filter(item => item.orders < 5)
            .sort((a, b) => a.orders - b.orders);

        res.json(slowMovers);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get category performance
router.get('/analytics/menu/categories', requireAdmin, async (req, res) => {
    try {
        if (!getMongoConnected()) {
            return res.status(503).json({ error: 'Database unavailable' });
        }

        const now = new Date();
        const startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

        const orders = await Order.find({
            createdAt: { $gte: startDate },
            status: { $nin: ['cancelled'] },
            paymentStatus: 'completed'
        });

        const categoryStats = new Map();
        orders.forEach(order => {
            if (order.items) {
                order.items.forEach(item => {
                    const category = item.category || 'Uncategorized';
                    const existing = categoryStats.get(category) || { category, revenue: 0, orders: 0 };
                    existing.revenue += (item.price || 0) * (item.quantity || 1);
                    existing.orders += item.quantity || 1;
                    categoryStats.set(category, existing);
                });
            }
        });

        const categories = Array.from(categoryStats.values())
            .sort((a, b) => b.revenue - a.revenue);

        res.json({ categories });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get customer segments
router.get('/analytics/customers/segments', requireAdmin, async (req, res) => {
    try {
        if (!getMongoConnected()) {
            return res.status(503).json({ error: 'Database unavailable' });
        }

        const now = new Date();
        const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);

        // Get all users
        const users = await User.find({});

        // Get orders
        const orders = await Order.find({
            status: { $nin: ['cancelled'] },
            paymentStatus: 'completed'
        });

        // Calculate customer stats
        const customerStats = new Map();
        orders.forEach(order => {
            if (order.userId) {
                const existing = customerStats.get(order.userId.toString()) || { orders: 0, revenue: 0, lastOrder: null };
                existing.orders += 1;
                existing.revenue += order.total || 0;
                if (!existing.lastOrder || new Date(order.createdAt) > new Date(existing.lastOrder)) {
                    existing.lastOrder = order.createdAt;
                }
                customerStats.set(order.userId.toString(), existing);
            }
        });

        // Segment customers
        const segments = {
            VIP: { count: 0, revenue: 0 },
            Regular: { count: 0, revenue: 0 },
            New: { count: 0, revenue: 0 },
            'At Risk': { count: 0, revenue: 0 }
        };

        users.forEach(user => {
            const stats = customerStats.get(user._id.toString());
            if (stats) {
                if (stats.revenue > 50000) {
                    segments.VIP.count++;
                    segments.VIP.revenue += stats.revenue;
                } else if (stats.revenue > 10000) {
                    segments.Regular.count++;
                    segments.Regular.revenue += stats.revenue;
                } else if (new Date(stats.lastOrder) > thirtyDaysAgo) {
                    segments.New.count++;
                    segments.New.revenue += stats.revenue;
                } else {
                    segments['At Risk'].count++;
                    segments['At Risk'].revenue += stats.revenue;
                }
            }
        });

        const segmentsArray = Object.entries(segments)
            .map(([segment, data]) => ({ segment, count: data.count, revenue: data.revenue }))
            .filter(s => s.count > 0);

        res.json({ segments: segmentsArray });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get customer lifetime value
router.get('/analytics/customers/ltv', requireAdmin, async (req, res) => {
    try {
        if (!getMongoConnected()) {
            return res.status(503).json({ error: 'Database unavailable' });
        }

        const orders = await Order.find({
            status: { $nin: ['cancelled'] },
            paymentStatus: 'completed'
        });

        const customerLTV = new Map();
        orders.forEach(order => {
            if (order.userId && order.email) {
                const existing = customerLTV.get(order.userId.toString()) || {
                    userId: order.userId.toString(),
                    name: order.customerName || 'Unknown',
                    email: order.email,
                    totalSpent: 0,
                    orderCount: 0
                };
                existing.totalSpent += order.total || 0;
                existing.orderCount += 1;
                customerLTV.set(order.userId.toString(), existing);
            }
        });

        const ltvArray = Array.from(customerLTV.values())
            .sort((a, b) => b.totalSpent - a.totalSpent)
            .slice(0, 50);

        res.json(ltvArray);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get customer retention metrics
router.get('/analytics/customers/retention', requireAdmin, async (req, res) => {
    try {
        if (!getMongoConnected()) {
            return res.status(503).json({ error: 'Database unavailable' });
        }

        const now = new Date();
        const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
        const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);

        // Get orders for different periods
        const currentPeriodOrders = await Order.find({
            createdAt: { $gte: thirtyDaysAgo },
            status: { $nin: ['cancelled'] },
            paymentStatus: 'completed'
        });

        const previousPeriodOrders = await Order.find({
            createdAt: { $gte: sixtyDaysAgo, $lt: thirtyDaysAgo },
            status: { $nin: ['cancelled'] },
            paymentStatus: 'completed'
        });

        // Get unique customers
        const currentCustomers = new Set(currentPeriodOrders.map(o => o.userId).filter(Boolean));
        const previousCustomers = new Set(previousPeriodOrders.map(o => o.userId).filter(Boolean));

        // New customers in current period
        const newCustomers = currentCustomers.size;

        // Returning customers (in both periods)
        const returningCustomers = [...currentCustomers].filter(c => previousCustomers.has(c)).length;

        // Calculate retention rate
        const retentionRate = previousCustomers.size > 0 ?
            (returningCustomers / previousCustomers.size) * 100 : 0;

        // Average purchase frequency
        const totalOrders = currentPeriodOrders.length;
        const averagePurchaseFrequency = currentCustomers.size > 0 ?
            totalOrders / currentCustomers.size : 0;

        // Churn rate
        const churnedCustomers = [...previousCustomers].filter(c => !currentCustomers.has(c)).length;
        const churnRate = previousCustomers.size > 0 ?
            (churnedCustomers / previousCustomers.size) * 100 : 0;

        res.json({
            newCustomers,
            returningCustomers,
            retentionRate: parseFloat(retentionRate.toFixed(1)),
            averagePurchaseFrequency: parseFloat(averagePurchaseFrequency.toFixed(1)),
            churnRate: parseFloat(churnRate.toFixed(1))
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get all reviews (admin) - with optional status filter
router.get('/reviews', requireAdmin, async (req, res) => {
    try {
        if (!getMongoConnected()) return res.json([]);
        const { status } = req.query;
        let query = {};
        if (status && status !== 'all') query.status = status;
        const reviews = await Review.find(query).sort({ createdAt: -1 });
        res.json(reviews);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Get all complaints (admin) - with optional status filter
router.get('/complaints', requireAdmin, async (req, res) => {
    try {
        if (!getMongoConnected()) return res.json([]);
        const { status } = req.query;
        let query = {};
        if (status && status !== 'all') query.status = status;
        const complaints = await Complaint.find(query).sort({ createdAt: -1 });
        res.json(complaints);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Get all disputes (admin) - with optional status filter
router.get('/disputes', requireAdmin, async (req, res) => {
    try {
        if (!getMongoConnected()) return res.json([]);
        const { status } = req.query;
        let query = {};
        if (status && status !== 'all') query.status = status;
        const disputes = await Dispute.find(query).sort({ createdAt: -1 });
        res.json(disputes);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ===== CAMPAIGNS =====

// Get all campaigns (admin)
router.get('/campaigns', requireAdmin, async (req, res) => {
    try {
        // Prevent caching
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.set('Pragma', 'no-cache');
        res.set('Expires', '0');

        if (!getMongoConnected()) return res.json({ campaigns: [] });

        const { status, page = 1, limit = 20 } = req.query;
        let query = {};

        if (status && status !== 'all') query.status = status;

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
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Create campaign (admin)
router.post('/campaigns', requireAdmin, async (req, res) => {
    try {
        if (!getMongoConnected()) return res.status(503).json({ error: 'Database unavailable' });

        const { v4: uuidv4 } = require('uuid');
        const campaignData = req.body;
        const campaignId = 'CAMP-' + uuidv4().substring(0, 8).toUpperCase();

        // Build audience object for the engagement service
        const audience = {
            type: campaignData.audience || 'all',
            segments: campaignData.segment ? [campaignData.segment] : ['all']
        };

        const campaign = new Campaign({
            _id: campaignId,
            name: campaignData.name,
            type: campaignData.type || 'email',
            subject: campaignData.subject || '',
            message: campaignData.message || '',
            htmlContent: campaignData.message || '',
            audience: audience,
            status: campaignData.status || 'draft',
            createdAt: new Date()
        });

        await campaign.save();

        res.status(201).json({ message: 'Campaign created', campaignId, campaign });
    } catch (err) { res.status(400).json({ error: err.message }); }
});

// Update campaign (admin)
router.put('/campaigns/:id', requireAdmin, async (req, res) => {
    try {
        if (!getMongoConnected()) return res.status(503).json({ error: 'Database unavailable' });

        const campaign = await Campaign.findByIdAndUpdate(
            req.params.id,
            { ...req.body, updatedAt: new Date() },
            { new: true }
        );

        if (!campaign) {
            return res.status(404).json({ error: 'Campaign not found' });
        }

        res.json({ message: 'Campaign updated', campaign });
    } catch (err) { res.status(400).json({ error: err.message }); }
});

// Delete campaign (admin)
router.delete('/campaigns/:id', requireAdmin, async (req, res) => {
    try {
        if (!getMongoConnected()) return res.status(503).json({ error: 'Database unavailable' });

        const campaign = await Campaign.findByIdAndDelete(req.params.id);

        if (!campaign) {
            return res.status(404).json({ error: 'Campaign not found' });
        }

        res.json({ message: 'Campaign deleted' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Send campaign (admin)
router.post('/campaigns/:id/send', requireAdmin, async (req, res) => {
    try {
        if (!getMongoConnected()) return res.status(503).json({ error: 'Database unavailable' });

        const campaign = await Campaign.findById(req.params.id);

        if (!campaign) {
            return res.status(404).json({ error: 'Campaign not found' });
        }

        // Check email configuration first
        if (!config.brevo.apiKey || !config.brevo.senderEmail) {
            return res.status(500).json({
                error: 'Email service is not configured. Please set BREVO_API_KEY and BREVO_SENDER_EMAIL environment variables.'
            });
        }

        // Update status to active
        campaign.status = 'active';
        campaign.sentCount = campaign.sentCount || 0;
        await campaign.save();

        // Actually send the campaign to recipients
        const engagementService = require('../services/engagement');
        const sendResult = await engagementService.sendCampaign(req.params.id);

        if (!sendResult.success) {
            return res.status(500).json({ error: sendResult.error || 'Failed to send campaign' });
        }

        res.json({
            message: 'Campaign sent successfully',
            campaign,
            sentCount: sendResult.sentCount,
            failedCount: sendResult.failedCount
        });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Send automated re-engagement campaign
router.post('/campaigns/automated/reengagement', requireAdmin, async (req, res) => {
    try {
        console.log('[REENGAGEMENT] Starting campaign...');
        console.log('[REENGAGEMENT] MongoDB connected:', getMongoConnected());

        if (!getMongoConnected()) return res.status(503).json({ error: 'Database unavailable' });

        // Check email configuration first
        if (!config.brevo.apiKey || !config.brevo.senderEmail) {
            return res.status(500).json({
                error: 'Email service is not configured. Please set BREVO_API_KEY and BREVO_SENDER_EMAIL environment variables.'
            });
        }

        // Get ONLY subscribers for the campaign (not registered users)
        const subscribers = await Subscriber.find({});
        console.log('[REENGAGEMENT] Found subscribers:', subscribers.length);

        if (subscribers.length === 0) {
            return res.json({
                message: 'No subscribers found',
                recipients: 0
            });
        }

        // Create a re-engagement campaign
        const { v4: uuidv4 } = require('uuid');
        const campaignId = 'CAMP-REENG-' + uuidv4().substring(0, 8).toUpperCase();

        const campaign = new Campaign({
            _id: campaignId,
            name: 'Re-engagement Campaign',
            type: 'automated',
            subject: 'We miss you! Come back to The Quill',
            content: `<h1>We miss you!</h1>
<p>Hi,</p>
<p>It's been a while since we saw you at The Quill. We have some exciting new menu items we'd love for you to try!</p>
<p>As our valued customer, we're offering you a special discount on your next visit.</p>
<p>Use code: WELCOMEBACK for 10% off your order.</p>
<p>Best regards,<br>The Quill Team</p>`,
            targetSegment: 'all',
            status: 'active',
            recipientCount: subscribers.length,
            sentCount: 0,
            createdAt: new Date(),
            sentAt: new Date()
        });

        await campaign.save();
        console.log('[REENGAGEMENT] Campaign created:', campaignId);

        // Send emails to subscribers
        let sentCount = 0;
        let failedCount = 0;
        const failedEmails = [];

        // Check email config
        console.log('[REENGAGEMENT] Email config - API Key:', !!config.brevo.apiKey, 'Sender:', config.brevo.senderEmail);

        for (const sub of subscribers) {
            try {
                console.log('[REENGAGEMENT] Sending to:', sub.email);
                const result = await sendEmailNotification(
                    sub.email,
                    'We miss you! Come back to The Quill',
                    campaign.content
                );
                if (result) {
                    sentCount++;
                    console.log('[REENGAGEMENT] Sent to:', sub.email);
                } else {
                    failedCount++;
                    failedEmails.push(sub.email);
                    console.log(`[REENGAGEMENT] Failed to send to: ${sub.email} - check Brevo API configuration`);
                }
            } catch (emailError) {
                failedCount++;
                failedEmails.push(sub.email);
                console.error(`[REENGAGEMENT] Error sending to ${sub.email}:`, emailError.message);
            }
        }

        console.log('[REENGAGEMENT] Results - Sent:', sentCount, 'Failed:', failedCount);
        if (failedEmails.length > 0) {
            console.log('[REENGAGEMENT] Failed emails:', failedEmails);
        }

        // Update sent count
        campaign.sentCount = sentCount;
        await campaign.save();

        if (sentCount === 0 && failedCount > 0) {
            return res.status(500).json({
                error: 'Failed to send emails. Please check your email service configuration.'
            });
        }

        res.json({
            message: 'Re-engagement campaign sent successfully',
            campaignId: campaign._id,
            recipients: subscribers.length,
            sentCount: sentCount,
            failedCount: failedCount
        });
    } catch (err) {
        console.error('[REENGAGEMENT] Route error:', err);
        res.status(500).json({ error: err.message });
    }
});

// Send automated birthday campaign
router.post('/campaigns/automated/birthday', requireAdmin, async (req, res) => {
    try {
        if (!getMongoConnected()) return res.status(503).json({ error: 'Database unavailable' });

        // Check email configuration first
        if (!config.brevo.apiKey || !config.brevo.senderEmail) {
            return res.status(500).json({
                error: 'Email service is not configured. Please set BREVO_API_KEY and BREVO_SENDER_EMAIL environment variables.'
            });
        }

        // Find subscribers with birthdays in the current month
        const now = new Date();
        const currentMonth = now.getMonth();

        const subscribers = await Subscriber.find({
            $expr: {
                $eq: [{ $month: '$birthday' }, currentMonth + 1]
            }
        });

        if (subscribers.length === 0) {
            return res.json({
                message: 'No subscribers with birthdays this month',
                recipients: 0
            });
        }

        // Create a birthday campaign
        const { v4: uuidv4 } = require('uuid');
        const campaignId = 'CAMP-BDAY-' + uuidv4().substring(0, 8).toUpperCase();

        const campaign = new Campaign({
            _id: campaignId,
            name: 'Birthday Campaign',
            type: 'automated',
            subject: 'Happy Birthday from The Quill! 🎂',
            content: `<h1>Happy Birthday!</h1>
<p>Hi,</p>
<p>🎉 Happy Birthday from The Quill! 🎉</p>
<p>To celebrate your special day, we're giving you a complimentary dessert on your next visit!</p>
<p>Show this message to your server and enjoy your free dessert on us.</p>
<p>Best regards,<br>The Quill Team</p>`,
            targetSegment: 'birthday',
            status: 'active',
            recipientCount: subscribers.length,
            sentCount: 0,
            createdAt: new Date(),
            sentAt: new Date()
        });

        await campaign.save();

        // Send emails to subscribers with birthdays this month
        let sentCount = 0;
        let failedCount = 0;
        const failedEmails = [];

        for (const sub of subscribers) {
            try {
                const result = await sendEmailNotification(
                    sub.email,
                    'Happy Birthday from The Quill! 🎂',
                    campaign.content
                );
                if (result) {
                    sentCount++;
                } else {
                    failedCount++;
                    failedEmails.push(sub.email);
                    console.log(`Failed to send birthday email to: ${sub.email} - check Brevo API configuration`);
                }
            } catch (emailError) {
                failedCount++;
                failedEmails.push(sub.email);
                console.error(`Failed to send birthday email to ${sub.email}:`, emailError.message);
            }
        }

        // Update sent count
        campaign.sentCount = sentCount;
        await campaign.save();

        if (sentCount === 0 && failedCount > 0) {
            return res.status(500).json({
                error: 'Failed to send emails. Please check your email service configuration.'
            });
        }

        res.json({
            message: 'Birthday campaign sent successfully',
            campaignId: campaign._id,
            recipients: subscribers.length,
            sentCount: sentCount,
            failedCount: failedCount
        });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Send automated seasonal campaign
router.post('/campaigns/automated/seasonal', requireAdmin, async (req, res) => {
    try {
        if (!getMongoConnected()) return res.status(503).json({ error: 'Database unavailable' });

        // Check email configuration first
        if (!config.brevo.apiKey || !config.brevo.senderEmail) {
            return res.status(500).json({
                error: 'Email service is not configured. Please set BREVO_API_KEY and BREVO_SENDER_EMAIL environment variables.'
            });
        }

        const { season } = req.query;
        const now = new Date();

        // Determine season based on month or query parameter
        let seasonName = season || 'seasonal';
        let seasonSubject = 'Special Offer from The Quill';

        if (!season) {
            const month = now.getMonth();
            if (month >= 2 && month <= 4) {
                seasonName = 'spring';
                seasonSubject = '🌸 Spring Specials at The Quill';
            } else if (month >= 5 && month <= 7) {
                seasonName = 'summer';
                seasonSubject = '☀️ Cool Down with Our Summer Menu';
            } else if (month >= 8 && month <= 10) {
                seasonName = 'autumn';
                seasonSubject = '🍂 Autumn Comfort Food at The Quill';
            } else {
                seasonName = 'winter';
                seasonSubject = '🔥 Warm Up with Our Winter Specials';
            }
        }

        // Get all active subscribers
        const subscribers = await Subscriber.find({});

        if (subscribers.length === 0) {
            return res.json({
                message: 'No subscribers found',
                recipients: 0
            });
        }

        // Create a seasonal campaign
        const { v4: uuidv4 } = require('uuid');
        const campaignId = 'CAMP-' + seasonName.toUpperCase() + '-' + uuidv4().substring(0, 8).toUpperCase();

        const campaign = new Campaign({
            _id: campaignId,
            name: `${seasonName.charAt(0).toUpperCase() + seasonName.slice(1)} Campaign`,
            type: 'automated',
            subject: seasonSubject,
            content: `<h1>${seasonSubject}</h1>
<p>Hi,</p>
<p>Experience the best of the season at The Quill!</p>
<p>Our chefs have prepared special ${seasonName} dishes that you won't want to miss.</p>
<p>Book your table now and enjoy the seasonal flavors!</p>
<p>Best regards,<br>The Quill Team</p>`,
            targetSegment: 'all',
            status: 'active',
            recipientCount: subscribers.length,
            sentCount: 0,
            createdAt: new Date(),
            sentAt: new Date()
        });

        await campaign.save();

        // Send emails to all subscribers
        let sentCount = 0;
        let failedCount = 0;
        const failedEmails = [];

        for (const sub of subscribers) {
            try {
                const result = await sendEmailNotification(
                    sub.email,
                    seasonSubject,
                    campaign.content
                );
                if (result) {
                    sentCount++;
                } else {
                    failedCount++;
                    failedEmails.push(sub.email);
                    console.log(`Failed to send seasonal email to: ${sub.email} - check Brevo API configuration`);
                }
            } catch (emailError) {
                failedCount++;
                failedEmails.push(sub.email);
                console.error(`Failed to send email to ${sub.email}:`, emailError.message);
            }
        }

        // Update sent count
        campaign.sentCount = sentCount;
        await campaign.save();

        if (sentCount === 0 && failedCount > 0) {
            return res.status(500).json({
                error: 'Failed to send emails. Please check your email service configuration.'
            });
        }

        res.json({
            message: 'Seasonal campaign sent successfully',
            campaignId: campaign._id,
            recipients: subscribers.length,
            sentCount: sentCount,
            failedCount: failedCount
        });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ===== SUBSCRIBERS =====

// Get all subscribers (admin)
router.get('/subscribers', requireAdmin, async (req, res) => {
    try {
        if (!getMongoConnected()) return res.json({ subscribers: [] });

        const { segment, search, page = 1, limit = 20 } = req.query;
        let query = {};

        if (segment && segment !== 'all') query.segment = segment;

        if (search) {
            query.$or = [
                { name: { $regex: search, $options: 'i' } },
                { email: { $regex: search, $options: 'i' } }
            ];
        }

        const skip = (parseInt(page) - 1) * parseInt(limit);

        const [subscribers, total] = await Promise.all([
            Subscriber.find(query)
                .skip(skip)
                .limit(parseInt(limit))
                .sort({ createdAt: -1 }),
            Subscriber.countDocuments(query)
        ]);

        res.json({
            subscribers,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total,
                pages: Math.ceil(total / parseInt(limit))
            }
        });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Add subscriber (admin)
router.post('/subscribers', requireAdmin, async (req, res) => {
    try {
        if (!getMongoConnected()) return res.status(503).json({ error: 'Database unavailable' });

        const { v4: uuidv4 } = require('uuid');
        const { email, name, phone, birthday, segment } = req.body;

        if (!email) {
            return res.status(400).json({ error: 'Email is required' });
        }

        // Check if subscriber already exists
        const existing = await Subscriber.findOne({ email });
        if (existing) {
            return res.status(400).json({ error: 'Subscriber with this email already exists' });
        }

        const subscriberId = 'SUB-' + uuidv4().substring(0, 8).toUpperCase();

        const subscriber = new Subscriber({
            _id: subscriberId,
            email,
            name,
            phone,
            birthday,
            segment: segment || 'new',
            createdAt: new Date()
        });

        await subscriber.save();

        res.status(201).json({ message: 'Subscriber added', subscriber });
    } catch (err) { res.status(400).json({ error: err.message }); }
});

// Delete subscriber (admin)
router.delete('/subscribers/:id', requireAdmin, async (req, res) => {
    try {
        if (!getMongoConnected()) return res.status(503).json({ error: 'Database unavailable' });

        const subscriber = await Subscriber.findByIdAndDelete(req.params.id);

        if (!subscriber) {
            return res.status(404).json({ error: 'Subscriber not found' });
        }

        res.json({ message: 'Subscriber deleted' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ===== TABLES =====

// Get all tables (admin)
router.get('/tables', requireAdmin, async (req, res) => {
    try {
        if (!getMongoConnected()) {
            // Return demo data if database is not connected
            return res.json({
                tables: [
                    { _id: 't1', tableNumber: '1', capacity: 2, section: 'window', status: 'available', isActive: true },
                    { _id: 't2', tableNumber: '2', capacity: 2, section: 'window', status: 'occupied', isActive: true },
                    { _id: 't3', tableNumber: '3', capacity: 4, section: 'main', status: 'reserved', isActive: true },
                    { _id: 't4', tableNumber: '4', capacity: 4, section: 'main', status: 'available', isActive: true },
                    { _id: 't5', tableNumber: '5', capacity: 6, section: 'main', status: 'occupied', isActive: true },
                    { _id: 't6', tableNumber: '6', capacity: 6, section: 'private', status: 'available', isActive: true },
                    { _id: 't7', tableNumber: '7', capacity: 8, section: 'private', status: 'reserved', isActive: true },
                    { _id: 't8', tableNumber: '8', capacity: 4, section: 'bar', status: 'occupied', isActive: true },
                    { _id: 't9', tableNumber: '9', capacity: 2, section: 'bar', status: 'available', isActive: true },
                    { _id: 't10', tableNumber: 'VIP', capacity: 12, section: 'vip', status: 'available', isActive: true }
                ]
            });
        }

        const { section, status, isActive } = req.query;
        let query = {};

        if (section && section !== 'all') query.section = section;
        if (status && status !== 'all') query.status = status;
        if (isActive !== undefined) query.isActive = isActive === 'true';

        const tables = await Table.find(query).sort({ tableNumber: 1 });
        res.json({ tables });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Get table stats (admin)
router.get('/tables/stats', requireAdmin, async (req, res) => {
    try {
        if (!getMongoConnected()) {
            return res.json({
                total: 10,
                available: 4,
                occupied: 3,
                reserved: 3,
                maintenance: 0,
                totalCapacity: 52
            });
        }

        const tables = await Table.find({ isActive: true });
        const stats = {
            total: tables.length,
            available: tables.filter(t => t.status === 'available').length,
            occupied: tables.filter(t => t.status === 'occupied').length,
            reserved: tables.filter(t => t.status === 'reserved').length,
            maintenance: tables.filter(t => t.status === 'maintenance').length,
            totalCapacity: tables.reduce((sum, t) => sum + t.capacity, 0)
        };

        res.json(stats);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Create table (admin)
router.post('/tables', requireAdmin, async (req, res) => {
    try {
        // Support demo mode when MongoDB is not connected
        if (!getMongoConnected()) {
            const tableData = req.body;
            const tableId = tableData._id || 'TBL-' + Math.random().toString(36).substring(2, 10).toUpperCase();
            const newTable = {
                _id: tableId,
                tableNumber: tableData.tableNumber || '1',
                capacity: tableData.capacity || 4,
                section: tableData.section || 'main',
                status: tableData.status || 'available',
                isActive: tableData.isActive !== false
            };
            demoTablesStorage.push(newTable);
            return res.status(201).json({ message: 'Table created', table: newTable });
        }

        const { v4: uuidv4 } = require('uuid');
        const { tableNumber, capacity, location, status, section, description, position } = req.body;

        if (!tableNumber || !capacity) {
            return res.status(400).json({ error: 'Table number and capacity are required' });
        }

        // Check if table number already exists
        const existing = await Table.findOne({ tableNumber });
        if (existing) {
            return res.status(400).json({ error: 'Table with this number already exists' });
        }

        const tableId = 'TBL-' + uuidv4().substring(0, 8).toUpperCase();

        const table = new Table({
            _id: tableId,
            tableNumber,
            capacity: capacity || 4,
            location: location || 'indoor',
            status: status || 'available',
            section: section || 'main',
            description: description || '',
            position: position || '',
            isActive: true,
            restaurantId: 'default',
            createdAt: new Date(),
            updatedAt: new Date()
        });

        await table.save();

        res.status(201).json({ message: 'Table created', table });
    } catch (err) { res.status(400).json({ error: err.message }); }
});

// Update table (admin)
router.put('/tables/:id', requireAdmin, async (req, res) => {
    try {
        // Support demo mode when MongoDB is not connected
        if (!getMongoConnected()) {
            const { id } = req.params;
            const tableIndex = demoTablesStorage.findIndex(t => t._id === id);
            if (tableIndex === -1) {
                return res.status(404).json({ error: 'Table not found' });
            }
            demoTablesStorage[tableIndex] = {
                ...demoTablesStorage[tableIndex],
                ...req.body
            };
            return res.json({ message: 'Table updated', table: demoTablesStorage[tableIndex] });
        }

        const { tableNumber, capacity, location, status, section, description, position, isActive } = req.body;

        // Check if table exists
        const table = await Table.findById(req.params.id);
        if (!table) {
            return res.status(404).json({ error: 'Table not found' });
        }

        // Check if new table number conflicts with another table
        if (tableNumber && tableNumber !== table.tableNumber) {
            const existing = await Table.findOne({ tableNumber, _id: { $ne: req.params.id } });
            if (existing) {
                return res.status(400).json({ error: 'Table with this number already exists' });
            }
        }

        table.tableNumber = tableNumber || table.tableNumber;
        table.capacity = capacity || table.capacity;
        table.location = location || table.location;
        table.status = status || table.status;
        table.section = section || table.section;
        table.description = description !== undefined ? description : table.description;
        table.position = position !== undefined ? position : table.position;
        table.isActive = isActive !== undefined ? isActive : table.isActive;
        table.updatedAt = new Date();

        await table.save();

        res.json({ message: 'Table updated', table });
    } catch (err) { res.status(400).json({ error: err.message }); }
});

// Delete table (admin)
router.delete('/tables/:id', requireAdmin, async (req, res) => {
    try {
        // Support demo mode when MongoDB is not connected
        if (!getMongoConnected()) {
            const { id } = req.params;
            const tableIndex = demoTablesStorage.findIndex(t => t._id === id);
            if (tableIndex === -1) {
                return res.status(404).json({ error: 'Table not found' });
            }
            demoTablesStorage.splice(tableIndex, 1);
            return res.json({ message: 'Table deleted' });
        }

        const table = await Table.findByIdAndDelete(req.params.id);

        if (!table) {
            return res.status(404).json({ error: 'Table not found' });
        }

        res.json({ message: 'Table deleted' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ===== INVENTORY =====

// Get inventory (admin) - returns menu items with inventory info
router.get('/inventory', requireAdmin, async (req, res) => {
    try {
        if (!getMongoConnected()) {
            // Return demo data matching frontend interface
            return res.json([
                { _id: 'inv1', name: 'Grilled Tilapia', category: 'Seafood', quantity: 25, unit: 'kg', reorderLevel: 10, supplier: 'Fresh Fish Co', unitCost: 450, lastRestocked: '2026-03-01', expiryDate: '2026-03-08', status: 'in-stock' },
                { _id: 'inv2', name: 'Ugali & Beef', category: 'Meat', quantity: 40, unit: 'kg', reorderLevel: 15, supplier: 'Local Butcher', unitCost: 600, lastRestocked: '2026-03-02', expiryDate: '2026-03-15', status: 'in-stock' },
                { _id: 'inv3', name: 'Chicken', category: 'Meat', quantity: 15, unit: 'kg', reorderLevel: 10, supplier: 'Poultry Farm', unitCost: 350, lastRestocked: '2026-03-03', expiryDate: '2026-03-10', status: 'in-stock' },
                { _id: 'inv4', name: 'Kuku Choma', category: 'Meat', quantity: 3, unit: 'kg', reorderLevel: 5, supplier: 'Poultry Farm', unitCost: 400, lastRestocked: '2026-03-01', expiryDate: '2026-03-07', status: 'low-stock' },
                { _id: 'inv5', name: 'Vegetables Mix', category: 'Produce', quantity: 20, unit: 'kg', reorderLevel: 8, supplier: 'Farm Fresh', unitCost: 150, lastRestocked: '2026-03-04', expiryDate: '2026-03-12', status: 'in-stock' }
            ]);
        }

        const { search, lowStock, outOfStock } = req.query;
        let query = {};

        if (search) {
            query.$or = [
                { name: { $regex: search, $options: 'i' } },
                { category: { $regex: search, $options: 'i' } }
            ];
        }

        const items = await MenuItemModel.find(query).sort({ name: 1 });

        // Transform to match frontend interface
        const inventory = items.map(item => {
            const quantity = item.stockQuantity || 0;
            const reorderLevel = item.lowStockThreshold || 5;
            let status = 'in-stock';
            if (quantity === 0) status = 'out-of-stock';
            else if (quantity <= reorderLevel) status = 'low-stock';

            return {
                _id: item._id,
                name: item.name,
                category: item.category,
                quantity: quantity,
                unit: 'kg', // Default unit
                reorderLevel: reorderLevel,
                supplier: '',
                unitCost: item.price || 0,
                lastRestocked: new Date().toISOString().split('T')[0],
                expiryDate: '',
                status: status
            };
        });

        // Apply filters
        let filtered = inventory;
        if (lowStock === 'true') {
            filtered = filtered.filter(i => i.status === 'low-stock');
        }
        if (outOfStock === 'true') {
            filtered = filtered.filter(i => i.status === 'out-of-stock');
        }

        res.json(filtered);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Get inventory alerts (low stock items)
router.get('/inventory/alerts', requireAdmin, async (req, res) => {
    try {
        if (!getMongoConnected()) {
            // Return demo alerts data matching frontend interface
            return res.json({
                lowStock: [
                    { itemId: 'inv4', name: 'Kuku Choma', currentQty: 3, reorderLevel: 5 }
                ],
                expiringSoon: [],
                suppliers: []
            });
        }

        const items = await MenuItemModel.find({
            $expr: { $lte: ['$stockQuantity', '$lowStockThreshold'] }
        });

        const lowStock = items.map(item => ({
            itemId: item._id,
            name: item.name,
            currentQty: item.stockQuantity || 0,
            reorderLevel: item.lowStockThreshold || 5
        }));

        // For now, return empty arrays for expiringSoon and suppliers
        res.json({ lowStock, expiringSoon: [], suppliers: [] });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Create inventory item (admin) - actually creates/updates menu item with inventory
router.post('/inventory', requireAdmin, async (req, res) => {
    try {
        if (!getMongoConnected()) return res.status(503).json({ error: 'Database unavailable' });

        const { name, category, price, stockQuantity, lowStockThreshold, trackInventory } = req.body;

        if (!name || !category) {
            return res.status(400).json({ error: 'Name and category are required' });
        }

        const { v4: uuidv4 } = require('uuid');
        const itemId = 'MENU-' + uuidv4().substring(0, 8).toUpperCase();

        const menuItem = new MenuItemModel({
            _id: itemId,
            name,
            category,
            price: price || 0,
            stockQuantity: stockQuantity || 0,
            lowStockThreshold: lowStockThreshold || 5,
            trackInventory: trackInventory !== undefined ? trackInventory : true,
            available: true,
            createdAt: new Date(),
            updatedAt: new Date()
        });

        await menuItem.save();

        res.status(201).json({ message: 'Inventory item created', item: menuItem });
    } catch (err) { res.status(400).json({ error: err.message }); }
});

// Update inventory item (admin)
router.put('/inventory/:id', requireAdmin, async (req, res) => {
    try {
        if (!getMongoConnected()) return res.status(503).json({ error: 'Database unavailable' });

        const { name, category, price, stockQuantity, lowStockThreshold, trackInventory, available } = req.body;

        const menuItem = await MenuItemModel.findById(req.params.id);

        if (!menuItem) {
            return res.status(404).json({ error: 'Inventory item not found' });
        }

        if (name) menuItem.name = name;
        if (category) menuItem.category = category;
        if (price !== undefined) menuItem.price = price;
        if (stockQuantity !== undefined) menuItem.stockQuantity = stockQuantity;
        if (lowStockThreshold !== undefined) menuItem.lowStockThreshold = lowStockThreshold;
        if (trackInventory !== undefined) menuItem.trackInventory = trackInventory;
        if (available !== undefined) menuItem.available = available;
        menuItem.updatedAt = new Date();

        await menuItem.save();

        res.json({ message: 'Inventory item updated', item: menuItem });
    } catch (err) { res.status(400).json({ error: err.message }); }
});

// Delete inventory item (admin)
router.delete('/inventory/:id', requireAdmin, async (req, res) => {
    try {
        if (!getMongoConnected()) return res.status(503).json({ error: 'Database unavailable' });

        const menuItem = await MenuItemModel.findByIdAndDelete(req.params.id);

        if (!menuItem) {
            return res.status(404).json({ error: 'Inventory item not found' });
        }

        res.json({ message: 'Inventory item deleted' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ===== STAFF =====

// Get all staff (admin)
router.get('/staff', requireAdmin, async (req, res) => {
    try {
        if (!getMongoConnected()) {
            // Return demo data matching frontend interface
            return res.json([
                { _id: 's1', name: 'John Kamau', role: 'Head Chef', email: 'john@thequill.com', phone: '+254712345678', startDate: '2024-01-15', status: 'active', shift: 'morning', hourlyRate: 500, yearsExperience: 8 },
                { _id: 's2', name: 'Mary Wanjiku', role: 'Restaurant Manager', email: 'mary@thequill.com', phone: '+254723456789', startDate: '2023-06-01', status: 'active', shift: 'full-time', hourlyRate: 600, yearsExperience: 5 },
                { _id: 's3', name: 'Peter Ochieng', role: 'Waiter', email: 'peter@thequill.com', phone: '+254734567890', startDate: '2024-03-20', status: 'active', shift: 'evening', hourlyRate: 200, yearsExperience: 2 },
                { _id: 's4', name: 'Sarah Akinyi', role: 'Sous Chef', email: 'sarah@thequill.com', phone: '+254745678901', startDate: '2023-09-10', status: 'active', shift: 'morning', hourlyRate: 400, yearsExperience: 6 },
                { _id: 's5', name: 'James Otieno', role: 'Bartender', email: 'james@thequill.com', phone: '+254756789012', startDate: '2024-02-01', status: 'inactive', shift: 'night', hourlyRate: 250, yearsExperience: 3 },
                { _id: 's6', name: 'Grace Nekesa', role: 'Accommodation Manager', email: 'grace@thequill.com', phone: '+254767890123', startDate: '2024-01-10', status: 'active', shift: 'full-time', hourlyRate: 550, yearsExperience: 7 },
                { _id: 's7', name: 'David Mbugua', role: 'Partnerships Manager', email: 'david@thequill.com', phone: '+254778901234', startDate: '2024-02-15', status: 'active', shift: 'full-time', hourlyRate: 500, yearsExperience: 4 }
            ]);
        }

        // Get users with role 'staff'
        const staff = await User.find({ role: 'staff' }).select('-password');

        // Transform to match frontend interface
        const staffData = staff.map(user => ({
            _id: user._id,
            name: user.name,
            role: user.role || 'Staff',
            email: user.email,
            phone: user.phone || '',
            startDate: user.startDate ? new Date(user.startDate).toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
            status: user.isActive !== false ? 'active' : 'inactive',
            shift: user.shift || 'full-time',
            hourlyRate: user.hourlyRate || 200,
            yearsExperience: user.yearsExperience || 0
        }));

        res.json(staffData);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Create staff (admin)
router.post('/staff', requireAdmin, async (req, res) => {
    try {
        if (!getMongoConnected()) return res.status(503).json({ error: 'Database unavailable' });

        const { name, role, email, phone, shift, hourlyRate, yearsExperience } = req.body;

        if (!name || !role || !email || !phone) {
            return res.status(400).json({ error: 'Name, role, email, and phone are required' });
        }

        const { v4: uuidv4 } = require('uuid');
        const staffId = 'STAFF-' + uuidv4().substring(0, 8).toUpperCase();

        // Check if user with this email already exists
        const existingUser = await User.findOne({ email });
        if (existingUser) {
            // Update existing user to staff role
            existingUser.role = 'staff';
            existingUser.phone = phone;
            existingUser.name = name;
            existingUser.shift = shift || 'full-time';
            existingUser.hourlyRate = hourlyRate || 200;
            existingUser.yearsExperience = yearsExperience || 0;
            await existingUser.save();

            return res.status(201).json({
                message: 'Staff member created',
                staff: {
                    _id: existingUser._id,
                    name: existingUser.name,
                    role,
                    email: existingUser.email,
                    phone: existingUser.phone,
                    startDate: existingUser.startDate ? new Date(existingUser.startDate).toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
                    status: 'active',
                    shift: existingUser.shift || 'full-time',
                    hourlyRate: existingUser.hourlyRate || 200,
                    yearsExperience: existingUser.yearsExperience || 0
                }
            });
        }

        // Create new user with staff role
        const user = new User({
            _id: staffId,
            name,
            email,
            phone,
            role: 'staff',
            isActive: true,
            shift: shift || 'full-time',
            hourlyRate: hourlyRate || 200,
            yearsExperience: yearsExperience || 0,
            startDate: new Date(),
            createdAt: new Date()
        });

        await user.save();

        res.status(201).json({
            message: 'Staff member created',
            staff: {
                _id: user._id,
                name: user.name,
                role,
                email: user.email,
                phone: user.phone,
                startDate: new Date(user.startDate).toISOString().split('T')[0],
                status: 'active',
                shift: user.shift || 'full-time',
                hourlyRate: user.hourlyRate || 200,
                yearsExperience: user.yearsExperience || 0
            }
        });
    } catch (err) { res.status(400).json({ error: err.message }); }
});

// Update staff (admin)
router.put('/staff/:id', requireAdmin, async (req, res) => {
    try {
        if (!getMongoConnected()) return res.status(503).json({ error: 'Database unavailable' });

        const { name, role, email, phone, status, shift, hourlyRate, yearsExperience } = req.body;

        const user = await User.findById(req.params.id);

        if (!user) {
            return res.status(404).json({ error: 'Staff member not found' });
        }

        if (name) user.name = name;
        if (email) user.email = email;
        if (phone) user.phone = phone;
        if (role) user.role = role;
        if (status) user.isActive = status === 'active';
        if (shift) user.shift = shift;
        if (hourlyRate !== undefined) user.hourlyRate = hourlyRate;
        if (yearsExperience !== undefined) user.yearsExperience = yearsExperience;

        await user.save();

        res.json({
            message: 'Staff member updated',
            staff: {
                _id: user._id,
                name: user.name,
                role: user.role,
                email: user.email,
                phone: user.phone,
                startDate: user.startDate ? new Date(user.startDate).toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
                status: user.isActive !== false ? 'active' : 'inactive',
                shift: user.shift || 'full-time',
                hourlyRate: user.hourlyRate || 200,
                yearsExperience: user.yearsExperience || 0
            }
        });
    } catch (err) { res.status(400).json({ error: err.message }); }
});

// Delete staff (admin)
router.delete('/staff/:id', requireAdmin, async (req, res) => {
    try {
        if (!getMongoConnected()) return res.status(503).json({ error: 'Database unavailable' });

        const user = await User.findByIdAndDelete(req.params.id);

        if (!user) {
            return res.status(404).json({ error: 'Staff member not found' });
        }

        res.json({ message: 'Staff member deleted' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ===== ACCOMMODATION =====

// Get all accommodations (admin)
router.get('/accommodations', requireAdmin, async (req, res) => {
    try {
        if (!getMongoConnected()) {
            // Return demo data
            return res.json({
                accommodations: [
                    { _id: 'acc1', name: 'The Quill Restaurant & Accommodation', type: 'hotel', starRating: 4, address: { city: 'Busia', area: 'Nambale' }, priceRange: { min: 8000, max: 25000 }, status: 'active', distanceFromVenue: 0, description: 'Our flagship accommodation with premium amenities' }
                ]
            });
        }

        const { type, status, search, page = 1, limit = 20 } = req.query;
        let query = {};

        if (type && type !== 'all') query.type = type;
        if (status && status !== 'all') query.status = status;
        if (search) {
            query.$or = [
                { name: { $regex: search, $options: 'i' } },
                { 'address.city': { $regex: search, $options: 'i' } },
                { 'address.area': { $regex: search, $options: 'i' } }
            ];
        }

        const skip = (parseInt(page) - 1) * parseInt(limit);

        const [accommodations, total] = await Promise.all([
            Accommodation.find(query).skip(skip).limit(parseInt(limit)).sort({ createdAt: -1 }),
            Accommodation.countDocuments(query)
        ]);

        res.json({
            accommodations,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total,
                pages: Math.ceil(total / parseInt(limit))
            }
        });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Get accommodation stats (admin)
router.get('/accommodations/stats', requireAdmin, async (req, res) => {
    try {
        if (!getMongoConnected()) {
            return res.json({
                total: 5,
                byType: { hotel: 1, 'guest-house': 1, lodge: 1, apartment: 1, hostel: 1 },
                byStatus: { active: 5, inactive: 0, pending: 0 },
                averageRating: 3.6,
                averageDistance: 2.54
            });
        }

        const accommodations = await Accommodation.find({});
        const stats = {
            total: accommodations.length,
            byType: {},
            byStatus: {},
            averageRating: 0,
            averageDistance: 0
        };

        let totalRating = 0;
        let totalDistance = 0;
        let ratingCount = 0;

        accommodations.forEach(acc => {
            stats.byType[acc.type] = (stats.byType[acc.type] || 0) + 1;
            stats.byStatus[acc.status] = (stats.byStatus[acc.status] || 0) + 1;
            if (acc.starRating) {
                totalRating += acc.starRating;
                ratingCount++;
            }
            totalDistance += acc.distanceFromVenue || 0;
        });

        stats.averageRating = ratingCount > 0 ? Math.round((totalRating / ratingCount) * 10) / 10 : 0;
        stats.averageDistance = accommodations.length > 0 ? Math.round((totalDistance / accommodations.length) * 100) / 100 : 0;

        res.json(stats);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Create accommodation (admin)
router.post('/accommodations', requireAdmin, async (req, res) => {
    try {
        if (!getMongoConnected()) return res.status(503).json({ error: 'Database unavailable' });

        const { v4: uuidv4 } = require('uuid');
        const accommodationData = req.body;

        const accommodationId = 'ACC-' + uuidv4().substring(0, 8).toUpperCase();

        const accommodation = new Accommodation({
            _id: accommodationId,
            ...accommodationData,
            status: accommodationData.status || 'active',
            createdAt: new Date(),
            updatedAt: new Date()
        });

        await accommodation.save();

        res.status(201).json({ message: 'Accommodation created', accommodation });
    } catch (err) { res.status(400).json({ error: err.message }); }
});

// Update accommodation (admin)
router.put('/accommodations/:id', requireAdmin, async (req, res) => {
    try {
        if (!getMongoConnected()) return res.status(503).json({ error: 'Database unavailable' });

        const accommodation = await Accommodation.findByIdAndUpdate(
            req.params.id,
            { ...req.body, updatedAt: new Date() },
            { new: true }
        );

        if (!accommodation) {
            return res.status(404).json({ error: 'Accommodation not found' });
        }

        res.json({ message: 'Accommodation updated', accommodation });
    } catch (err) { res.status(400).json({ error: err.message }); }
});

// Delete accommodation (admin)
router.delete('/accommodations/:id', requireAdmin, async (req, res) => {
    try {
        if (!getMongoConnected()) return res.status(503).json({ error: 'Database unavailable' });

        const accommodation = await Accommodation.findByIdAndDelete(req.params.id);

        if (!accommodation) {
            return res.status(404).json({ error: 'Accommodation not found' });
        }

        res.json({ message: 'Accommodation deleted' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Public endpoint to get active partnerships (for public partnerships page)
router.get('/public/partnerships', async (req, res) => {
    try {
        // Support demo mode when MongoDB is not connected
        if (!getMongoConnected()) {
            // Return demo partnerships that are active
            const activePartnerships = demoPartnershipsStorage.filter(p => p.status === 'active');
            return res.json({ partnerships: activePartnerships });
        }

        // Get only active partnerships for public display
        const partnerships = await Partnership.find({ status: 'active' }).sort({ createdAt: -1 });
        res.json({ partnerships });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ===== PARTNERSHIPS =====

// Get all partnerships (admin)
router.get('/partnerships', requireAdmin, async (req, res) => {
    try {
        const { type, status, category, search, page = 1, limit = 20 } = req.query;

        // Support demo mode when MongoDB is not connected
        if (!getMongoConnected()) {
            // Use shared demo storage
            let demoPartnerships = [...demoPartnershipsStorage];

            // Apply filters to demo data
            if (type && type !== 'all') {
                demoPartnerships = demoPartnerships.filter(p => p.type === type);
            }
            if (status && status !== 'all') {
                demoPartnerships = demoPartnerships.filter(p => p.status === status);
            }
            if (category && category !== 'all') {
                demoPartnerships = demoPartnerships.filter(p => p.category === category);
            }
            if (search) {
                const searchLower = search.toLowerCase();
                demoPartnerships = demoPartnerships.filter(p =>
                    p.name.toLowerCase().includes(searchLower) ||
                    p.organization.toLowerCase().includes(searchLower) ||
                    (p.contactPerson && p.contactPerson.toLowerCase().includes(searchLower))
                );
            }

            return res.json({ partnerships: demoPartnerships, pagination: { page: 1, limit: 20, total: demoPartnerships.length, pages: 1 } });
        }

        let query = {};

        if (type && type !== 'all') query.type = type;
        if (status && status !== 'all') query.status = status;
        if (category && category !== 'all') query.category = category;
        if (search) {
            query.$or = [
                { name: { $regex: search, $options: 'i' } },
                { organization: { $regex: search, $options: 'i' } },
                { contactPerson: { $regex: search, $options: 'i' } }
            ];
        }

        const skip = (parseInt(page) - 1) * parseInt(limit);

        const [partnerships, total] = await Promise.all([
            Partnership.find(query).skip(skip).limit(parseInt(limit)).sort({ createdAt: -1 }),
            Partnership.countDocuments(query)
        ]);

        res.json({
            partnerships,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total,
                pages: Math.ceil(total / parseInt(limit))
            }
        });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Get partnership stats (admin)
router.get('/partnerships/stats', requireAdmin, async (req, res) => {
    try {
        if (!getMongoConnected()) {
            return res.json({
                total: 5,
                byType: { corporate: 2, schools: 1, fundraiser: 1, events: 1 },
                byStatus: { active: 4, inactive: 0, pending: 1, archived: 0 },
                byCategory: { Business: 2, Education: 1, Charity: 1, Government: 1 },
                averageYearsActive: 2.2
            });
        }

        const partnerships = await Partnership.find({});
        const stats = {
            total: partnerships.length,
            byType: {},
            byStatus: {},
            byCategory: {},
            averageYearsActive: 0
        };

        let totalYears = 0;

        partnerships.forEach(p => {
            stats.byType[p.type] = (stats.byType[p.type] || 0) + 1;
            stats.byStatus[p.status] = (stats.byStatus[p.status] || 0) + 1;
            stats.byCategory[p.category] = (stats.byCategory[p.category] || 0) + 1;
            totalYears += p.yearsActive || 0;
        });

        stats.averageYearsActive = partnerships.length > 0 ? Math.round((totalYears / partnerships.length) * 10) / 10 : 0;

        res.json(stats);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Create partnership (admin)
router.post('/partnerships', requireAdmin, async (req, res) => {
    try {
        // Support demo mode when MongoDB is not connected
        if (!getMongoConnected()) {
            const partnershipData = req.body;
            const partnershipId = partnershipData._id || 'PART-' + Math.random().toString(36).substring(2, 10).toUpperCase();
            const newPartnership = {
                _id: partnershipId,
                ...partnershipData,
                status: partnershipData.status || 'pending',
                createdAt: new Date(),
                updatedAt: new Date()
            };
            demoPartnershipsStorage.push(newPartnership);
            return res.status(201).json({ message: 'Partnership created', partnership: newPartnership });
        }

        const { v4: uuidv4 } = require('uuid');
        const partnershipData = req.body;

        const partnershipId = 'PART-' + uuidv4().substring(0, 8).toUpperCase();

        const partnership = new Partnership({
            _id: partnershipId,
            ...partnershipData,
            status: partnershipData.status || 'pending',
            createdAt: new Date(),
            updatedAt: new Date()
        });

        await partnership.save();

        res.status(201).json({ message: 'Partnership created', partnership });
    } catch (err) { res.status(400).json({ error: err.message }); }
});

// Update partnership (admin)
router.put('/partnerships/:id', requireAdmin, async (req, res) => {
    try {
        // Support demo mode when MongoDB is not connected
        if (!getMongoConnected()) {
            const { id } = req.params;
            const partnershipIndex = demoPartnershipsStorage.findIndex(p => p._id === id);
            if (partnershipIndex === -1) {
                return res.status(404).json({ error: 'Partnership not found' });
            }
            demoPartnershipsStorage[partnershipIndex] = {
                ...demoPartnershipsStorage[partnershipIndex],
                ...req.body,
                updatedAt: new Date()
            };
            return res.json({ message: 'Partnership updated', partnership: demoPartnershipsStorage[partnershipIndex] });
        }

        const partnership = await Partnership.findByIdAndUpdate(
            req.params.id,
            { ...req.body, updatedAt: new Date() },
            { new: true }
        );

        if (!partnership) {
            return res.status(404).json({ error: 'Partnership not found' });
        }

        res.json({ message: 'Partnership updated', partnership });
    } catch (err) { res.status(400).json({ error: err.message }); }
});

// Delete partnership (admin)
router.delete('/partnerships/:id', requireAdmin, async (req, res) => {
    try {
        // Try MongoDB first (regardless of connection state)
        if (mongoose.connection.readyState === 1) {
            try {
                const partnership = await Partnership.findByIdAndDelete(req.params.id);
                if (partnership) {
                    return res.json({ message: 'Partnership deleted' });
                }
            } catch (mongoErr) {
                // MongoDB error, continue to demo storage fallback
            }
        }

        // Fallback to demo storage when MongoDB is not connected or partnership not found in DB
        if (!getMongoConnected()) {
            const { id } = req.params;

            // Find and delete from demoPartnershipsStorage
            const partnershipIndex = demoPartnershipsStorage.findIndex(p => String(p._id) === String(id));
            if (partnershipIndex !== -1) {
                demoPartnershipsStorage.splice(partnershipIndex, 1);
                return res.json({ message: 'Partnership deleted' });
            }

            // Also check for partial ID matches (e.g., corp1, school1, event1, fund1)
            const partialMatch = demoPartnershipsStorage.find(p =>
                id.includes(p._id) || p._id.includes(id)
            );
            if (partialMatch) {
                const idx = demoPartnershipsStorage.indexOf(partialMatch);
                demoPartnershipsStorage.splice(idx, 1);
                return res.json({ message: 'Partnership deleted' });
            }

            // Return success anyway (idempotent delete - allows frontend to always remove from UI)
            return res.json({ message: 'Partnership deleted' });
        }

        return res.status(404).json({ error: 'Partnership not found' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ===== ROOM TYPES =====

// Get all room types (public - for accommodation page)
router.get('/public/room-types', async (req, res) => {
    try {
        if (!getMongoConnected()) {
            // Return demo data when database is not connected
            return res.json({
                roomTypes: [
                    {
                        _id: 'demo1',
                        name: 'Standard Room',
                        description: 'Comfortable room with essential amenities for a pleasant stay.',
                        basePrice: 8000,
                        capacity: 2,
                        maxAdults: 2,
                        maxChildren: 1,
                        bedType: 'double',
                        amenities: ['Free WiFi', 'Breakfast Included', 'Air Conditioning', 'Garden View'],
                        photos: ['https://images.unsplash.com/photo-1590490360182-c33d57733427?w=400'],
                        isActive: true
                    },
                    {
                        _id: 'demo2',
                        name: 'Deluxe Room',
                        description: 'Spacious room with premium amenities and scenic views.',
                        basePrice: 12000,
                        capacity: 3,
                        maxAdults: 2,
                        maxChildren: 1,
                        bedType: 'king',
                        amenities: ['Free WiFi', 'Breakfast Included', 'Room Service', 'Lake View', 'Air Conditioning', 'Private Balcony'],
                        photos: ['https://images.unsplash.com/photo-1611892440504-42a792e24d32?w=400'],
                        isActive: true
                    },
                    {
                        _id: 'demo3',
                        name: 'Executive Suite',
                        description: 'Luxurious suite with separate living area and premium facilities.',
                        basePrice: 18000,
                        capacity: 4,
                        maxAdults: 2,
                        maxChildren: 2,
                        bedType: 'king',
                        amenities: ['Free WiFi', 'Breakfast Included', 'Room Service', 'Executive Lounge Access', 'King Bed', 'Living Room', 'Panoramic View'],
                        photos: ['https://images.unsplash.com/photo-1582719478250-c89cae4dc85b?w=400'],
                        isActive: true
                    },
                    {
                        _id: 'demo4',
                        name: 'Family Room',
                        description: 'Large room perfect for families, with connecting rooms available.',
                        basePrice: 25000,
                        capacity: 6,
                        maxAdults: 4,
                        maxChildren: 2,
                        bedType: 'queen',
                        amenities: ['Free WiFi', 'Breakfast Included', 'Room Service', 'Two Queen Beds', 'Family Friendly', 'Extra Space'],
                        photos: ['https://images.unsplash.com/photo-1596394516093-501ba68a0ba6?w=400'],
                        isActive: true
                    }
                ]
            });
        }
        const roomTypes = await RoomType.find({ isActive: true }).sort({ createdAt: -1 });
        res.json({ roomTypes });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Get all room types
router.get('/room-types', requireAdmin, async (req, res) => {
    try {
        if (!getMongoConnected()) {
            return res.json({
                roomTypes: [
                    {
                        _id: 'rt1',
                        accommodationId: 'acc1',
                        name: 'Standard Room',
                        description: 'Comfortable room with essential amenities',
                        basePrice: 8000,
                        capacity: 2,
                        maxAdults: 2,
                        maxChildren: 1,
                        bedType: 'double',
                        roomSize: 25,
                        amenities: ['WiFi', 'Air Conditioning', 'TV', 'Breakfast Included'],
                        photos: ['https://images.unsplash.com/photo-1590490360182-c33d57733427?w=400'],
                        seasonalPricing: [],
                        minimumStay: 1,
                        maximumStay: 30,
                        totalRooms: 5,
                        isActive: true
                    },
                    {
                        _id: 'rt2',
                        accommodationId: 'acc1',
                        name: 'Deluxe Room',
                        description: 'Spacious room with premium amenities and views',
                        basePrice: 12000,
                        capacity: 3,
                        maxAdults: 2,
                        maxChildren: 1,
                        bedType: 'king',
                        roomSize: 35,
                        amenities: ['WiFi', 'Air Conditioning', 'TV', 'Mini Bar', 'Room Service', 'Balcony'],
                        photos: ['https://images.unsplash.com/photo-1611892440504-42a792e24d32?w=400'],
                        seasonalPricing: [],
                        minimumStay: 1,
                        maximumStay: 30,
                        totalRooms: 3,
                        isActive: true
                    },
                    {
                        _id: 'rt3',
                        accommodationId: 'acc1',
                        name: 'Executive Suite',
                        description: 'Luxurious suite with separate living area',
                        basePrice: 18000,
                        capacity: 4,
                        maxAdults: 2,
                        maxChildren: 2,
                        bedType: 'king',
                        roomSize: 50,
                        amenities: ['WiFi', 'Air Conditioning', 'TV', 'Mini Bar', 'Room Service', 'Spa Access', 'Living Room'],
                        photos: ['https://images.unsplash.com/photo-1582719478250-c89cae4dc85b?w=400'],
                        seasonalPricing: [],
                        minimumStay: 1,
                        maximumStay: 30,
                        totalRooms: 2,
                        isActive: true
                    }
                ]
            });
        }
        const { accommodationId } = req.query;
        let query = {};
        if (accommodationId) query.accommodationId = accommodationId;
        const roomTypes = await RoomType.find(query).sort({ createdAt: -1 });
        res.json({ roomTypes });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Create room type
router.post('/room-types', requireAdmin, async (req, res) => {
    try {
        if (!getMongoConnected()) return res.status(503).json({ error: 'Database unavailable' });

        const { v4: uuidv4 } = require('uuid');
        const roomTypeData = req.body;
        const roomTypeId = 'RT-' + uuidv4().substring(0, 8).toUpperCase();
        const roomType = new RoomType({
            _id: roomTypeId,
            ...roomTypeData,
            isActive: roomTypeData.isActive !== false,
            createdAt: new Date(),
            updatedAt: new Date()
        });
        await roomType.save();
        res.status(201).json({ message: 'Room type created', roomType });
    } catch (err) { res.status(400).json({ error: err.message }); }
});

// Update room type
router.put('/room-types/:id', requireAdmin, async (req, res) => {
    try {
        if (!getMongoConnected()) return res.status(503).json({ error: 'Database unavailable' });

        const roomType = await RoomType.findByIdAndUpdate(
            req.params.id,
            { ...req.body, updatedAt: new Date() },
            { new: true }
        );
        if (!roomType) return res.status(404).json({ error: 'Room type not found' });
        res.json({ message: 'Room type updated', roomType });
    } catch (err) { res.status(400).json({ error: err.message }); }
});

// Delete room type
router.delete('/room-types/:id', requireAdmin, async (req, res) => {
    try {
        if (!getMongoConnected()) return res.status(503).json({ error: 'Database unavailable' });

        const roomType = await RoomType.findByIdAndDelete(req.params.id);
        if (!roomType) return res.status(404).json({ error: 'Room type not found' });
        res.json({ message: 'Room type deleted' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ===== ROOMS =====

// Get all rooms
router.get('/rooms', requireAdmin, async (req, res) => {
    try {
        if (!getMongoConnected()) {
            // Return demo data when database is not connected
            return res.json({
                rooms: [
                    { _id: 'room1', accommodationId: 'acc1', roomTypeId: 'rt1', roomNumber: '101', floor: 1, status: 'available', notes: '' },
                    { _id: 'room2', accommodationId: 'acc1', roomTypeId: 'rt1', roomNumber: '102', floor: 1, status: 'occupied', notes: '' },
                    { _id: 'room3', accommodationId: 'acc1', roomTypeId: 'rt1', roomNumber: '103', floor: 1, status: 'available', notes: '' },
                    { _id: 'room4', accommodationId: 'acc1', roomTypeId: 'rt1', roomNumber: '104', floor: 1, status: 'cleaning', notes: '' },
                    { _id: 'room5', accommodationId: 'acc1', roomTypeId: 'rt2', roomNumber: '201', floor: 2, status: 'available', notes: '' },
                    { _id: 'room6', accommodationId: 'acc1', roomTypeId: 'rt2', roomNumber: '202', floor: 2, status: 'occupied', notes: '' },
                    { _id: 'room7', accommodationId: 'acc1', roomTypeId: 'rt2', roomNumber: '203', floor: 2, status: 'maintenance', notes: 'AC unit needs repair' },
                    { _id: 'room8', accommodationId: 'acc1', roomTypeId: 'rt3', roomNumber: '301', floor: 3, status: 'available', notes: '' },
                    { _id: 'room9', accommodationId: 'acc1', roomTypeId: 'rt3', roomNumber: '302', floor: 3, status: 'occupied', notes: '' }
                ]
            });
        }
        const { accommodationId, status } = req.query;
        let query = {};
        if (accommodationId) query.accommodationId = accommodationId;
        if (status && status !== 'all') query.status = status;
        const rooms = await Room.find(query).sort({ roomNumber: 1 });
        res.json({ rooms });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Create room
router.post('/rooms', requireAdmin, async (req, res) => {
    try {
        if (!getMongoConnected()) return res.status(503).json({ error: 'Database unavailable' });

        const { v4: uuidv4 } = require('uuid');
        const roomData = req.body;
        const roomId = 'ROOM-' + uuidv4().substring(0, 8).toUpperCase();
        const room = new Room({
            _id: roomId,
            ...roomData,
            status: roomData.status || 'available',
            createdAt: new Date(),
            updatedAt: new Date()
        });
        await room.save();
        res.status(201).json({ message: 'Room created', room });
    } catch (err) { res.status(400).json({ error: err.message }); }
});

// Update room
router.put('/rooms/:id', requireAdmin, async (req, res) => {
    try {
        if (!getMongoConnected()) return res.status(503).json({ error: 'Database unavailable' });

        const room = await Room.findByIdAndUpdate(
            req.params.id,
            { ...req.body, updatedAt: new Date() },
            { new: true }
        );
        if (!room) return res.status(404).json({ error: 'Room not found' });
        res.json({ message: 'Room updated', room });
    } catch (err) { res.status(400).json({ error: err.message }); }
});

// Delete room
router.delete('/rooms/:id', requireAdmin, async (req, res) => {
    try {
        if (!getMongoConnected()) return res.status(503).json({ error: 'Database unavailable' });

        const room = await Room.findByIdAndDelete(req.params.id);
        if (!room) return res.status(404).json({ error: 'Room not found' });
        res.json({ message: 'Room deleted' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ===== ROOM BOOKINGS =====

// Get all room bookings
router.get('/room-bookings', requireAdmin, async (req, res) => {
    try {
        if (!getMongoConnected()) {
            // Return demo data when database is not connected
            return res.json({
                bookings: [
                    { _id: 'book1', accommodationId: 'acc1', roomTypeId: 'rt1', roomId: 'room1', guestName: 'John Doe', guestEmail: 'john@example.com', guestPhone: '+254700000001', checkInDate: '2026-03-15', checkOutDate: '2026-03-18', numberOfAdults: 2, numberOfChildren: 0, roomPrice: 8000, totalAmount: 24000, paidAmount: 24000, paymentStatus: 'paid', bookingStatus: 'confirmed', confirmationNumber: 'CONF-ABC123' },
                    { _id: 'book2', accommodationId: 'acc1', roomTypeId: 'rt2', roomId: 'room5', guestName: 'Jane Smith', guestEmail: 'jane@example.com', guestPhone: '+254700000002', checkInDate: '2026-03-20', checkOutDate: '2026-03-25', numberOfAdults: 2, numberOfChildren: 1, roomPrice: 12000, totalAmount: 60000, paidAmount: 30000, paymentStatus: 'partial', bookingStatus: 'confirmed', confirmationNumber: 'CONF-DEF456' },
                    { _id: 'book3', accommodationId: 'acc1', roomTypeId: 'rt3', roomId: 'room8', guestName: 'Robert Brown', guestEmail: 'robert@example.com', guestPhone: '+254700000003', checkInDate: '2026-03-10', checkOutDate: '2026-03-12', numberOfAdults: 2, numberOfChildren: 2, roomPrice: 18000, totalAmount: 36000, paidAmount: 36000, paymentStatus: 'paid', bookingStatus: 'checked-out', confirmationNumber: 'CONF-GHI789' },
                    { _id: 'book4', accommodationId: 'acc1', roomTypeId: 'rt1', roomId: 'room2', guestName: 'Mary Johnson', guestEmail: 'mary@example.com', guestPhone: '+254700000004', checkInDate: '2026-03-22', checkOutDate: '2026-03-24', numberOfAdults: 1, numberOfChildren: 0, roomPrice: 8000, totalAmount: 16000, paidAmount: 0, paymentStatus: 'pending', bookingStatus: 'pending', confirmationNumber: 'CONF-JKL012' }
                ]
            });
        }
        const { accommodationId, status, startDate, endDate } = req.query;
        let query = {};
        if (accommodationId) query.accommodationId = accommodationId;
        if (status && status !== 'all') query.bookingStatus = status;
        if (startDate || endDate) {
            query.checkInDate = {};
            if (startDate) query.checkInDate.$gte = new Date(startDate);
            if (endDate) query.checkInDate.$lte = new Date(endDate);
        }
        const bookings = await RoomBooking.find(query).sort({ checkInDate: -1 });
        res.json({ bookings });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Create room booking
router.post('/room-bookings', requireAdmin, async (req, res) => {
    try {
        if (!getMongoConnected()) return res.status(503).json({ error: 'Database unavailable' });
        const { v4: uuidv4 } = require('uuid');
        const bookingData = req.body;
        const bookingId = 'BOOK-' + uuidv4().substring(0, 8).toUpperCase();
        const confirmationNumber = 'CONF-' + Math.random().toString(36).substring(2, 8).toUpperCase();
        const booking = new RoomBooking({
            _id: bookingId,
            ...bookingData,
            confirmationNumber,
            bookingStatus: bookingData.bookingStatus || 'pending',
            createdAt: new Date(),
            updatedAt: new Date()
        });
        await booking.save();
        res.status(201).json({ message: 'Booking created', booking });
    } catch (err) { res.status(400).json({ error: err.message }); }
});

// Update room booking
router.put('/room-bookings/:id', requireAdmin, async (req, res) => {
    try {
        if (!getMongoConnected()) return res.status(503).json({ error: 'Database unavailable' });
        const booking = await RoomBooking.findByIdAndUpdate(
            req.params.id,
            { ...req.body, updatedAt: new Date() },
            { new: true }
        );
        if (!booking) return res.status(404).json({ error: 'Booking not found' });
        res.json({ message: 'Booking updated', booking });
    } catch (err) { res.status(400).json({ error: err.message }); }
});

// Delete room booking
router.delete('/room-bookings/:id', requireAdmin, async (req, res) => {
    try {
        if (!getMongoConnected()) return res.status(503).json({ error: 'Database unavailable' });
        const booking = await RoomBooking.findByIdAndDelete(req.params.id);
        if (!booking) return res.status(404).json({ error: 'Booking not found' });
        res.json({ message: 'Booking deleted' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Block dates for maintenance
router.post('/room-bookings/:id/block-dates', requireAdmin, async (req, res) => {
    try {
        if (!getMongoConnected()) return res.status(503).json({ error: 'Database unavailable' });
        const { startDate, endDate, reason } = req.body;
        const booking = await RoomBooking.findById(req.params.id);
        if (!booking) return res.status(404).json({ error: 'Booking not found' });
        booking.blockedDates = booking.blockedDates || [];
        booking.blockedDates.push({ startDate: new Date(startDate), endDate: new Date(endDate), reason: reason || 'maintenance' });
        await booking.save();
        res.json({ message: 'Dates blocked', booking });
    } catch (err) { res.status(400).json({ error: err.message }); }
});

// ===== HOUSEKEEPING =====

// Get all housekeeping tasks
router.get('/housekeeping', requireAdmin, async (req, res) => {
    try {
        if (!getMongoConnected()) {
            // Return demo data when database is not connected
            return res.json({
                tasks: [
                    { _id: 'hk1', accommodationId: 'acc1', roomId: 'room1', roomNumber: '101', taskType: 'cleaning', status: 'completed', priority: 'normal', assignedTo: 'Mary Wanjiku', scheduledDate: '2026-03-10', completedDate: '2026-03-10', notes: '' },
                    { _id: 'hk2', accommodationId: 'acc1', roomId: 'room2', roomNumber: '102', taskType: 'cleaning', status: 'in-progress', priority: 'high', assignedTo: 'Mary Wanjiku', scheduledDate: '2026-03-12', completedDate: null, notes: 'Guest checking out soon' },
                    { _id: 'hk3', accommodationId: 'acc1', roomId: 'room3', roomNumber: '103', taskType: 'inspection', status: 'pending', priority: 'normal', assignedTo: 'Peter Ochieng', scheduledDate: '2026-03-12', completedDate: null, notes: '' },
                    { _id: 'hk4', accommodationId: 'acc1', roomId: 'room4', roomNumber: '104', taskType: 'deep-cleaning', status: 'pending', priority: 'low', assignedTo: 'Mary Wanjiku', scheduledDate: '2026-03-13', completedDate: null, notes: 'After checkout' },
                    { _id: 'hk5', accommodationId: 'acc1', roomId: 'room7', roomNumber: '203', taskType: 'maintenance', status: 'in-progress', priority: 'high', assignedTo: 'James Otieno', scheduledDate: '2026-03-12', completedDate: null, notes: 'AC repair' }
                ]
            });
        }
        const { accommodationId, status, date } = req.query;
        let query = {};
        if (accommodationId) query.accommodationId = accommodationId;
        if (status && status !== 'all') query.status = status;
        if (date) {
            const startOfDay = new Date(date);
            startOfDay.setHours(0, 0, 0, 0);
            const endOfDay = new Date(date);
            endOfDay.setHours(23, 59, 59, 999);
            query.scheduledDate = { $gte: startOfDay, $lte: endOfDay };
        }
        const tasks = await HousekeepingTask.find(query).sort({ scheduledDate: 1 });
        res.json({ tasks });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Create housekeeping task
router.post('/housekeeping', requireAdmin, async (req, res) => {
    try {
        if (!getMongoConnected()) return res.status(503).json({ error: 'Database unavailable' });
        const { v4: uuidv4 } = require('uuid');
        const taskData = req.body;
        const taskId = 'HK-' + uuidv4().substring(0, 8).toUpperCase();
        const task = new HousekeepingTask({
            _id: taskId,
            ...taskData,
            status: taskData.status || 'pending',
            createdAt: new Date(),
            updatedAt: new Date()
        });
        await task.save();
        res.status(201).json({ message: 'Task created', task });
    } catch (err) { res.status(400).json({ error: err.message }); }
});

// Update housekeeping task
router.put('/housekeeping/:id', requireAdmin, async (req, res) => {
    try {
        if (!getMongoConnected()) return res.status(503).json({ error: 'Database unavailable' });
        const task = await HousekeepingTask.findByIdAndUpdate(
            req.params.id,
            { ...req.body, updatedAt: new Date() },
            { new: true }
        );
        if (!task) return res.status(404).json({ error: 'Task not found' });
        res.json({ message: 'Task updated', task });
    } catch (err) { res.status(400).json({ error: err.message }); }
});

// Delete housekeeping task
router.delete('/housekeeping/:id', requireAdmin, async (req, res) => {
    try {
        if (!getMongoConnected()) return res.status(503).json({ error: 'Database unavailable' });
        const task = await HousekeepingTask.findByIdAndDelete(req.params.id);
        if (!task) return res.status(404).json({ error: 'Task not found' });
        res.json({ message: 'Task deleted' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ===== GUEST HISTORY =====

// Get all guest histories
router.get('/guest-history', requireAdmin, async (req, res) => {
    try {
        if (!getMongoConnected()) {
            // Use shared demo storage
            return res.json({ guests: [...demoGuestHistoryStorage] });
        }
        const { search, vip } = req.query;
        let query = {};
        if (vip === 'true') query.vipStatus = true;
        if (search) {
            query.$or = [
                { guestName: { $regex: search, $options: 'i' } },
                { guestEmail: { $regex: search, $options: 'i' } },
                { guestPhone: { $regex: search, $options: 'i' } }
            ];
        }
        const guests = await GuestHistory.find(query).sort({ lastStayDate: -1 });
        res.json({ guests });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Get guest by ID
router.get('/guest-history/:id', requireAdmin, async (req, res) => {
    try {
        if (!getMongoConnected()) {
            return res.status(503).json({ error: 'Database unavailable' });
        }
        const guest = await GuestHistory.findById(req.params.id);
        if (!guest) return res.status(404).json({ error: 'Guest not found' });
        res.json({ guest });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Create/update guest history
router.post('/guest-history', requireAdmin, async (req, res) => {
    try {
        // Support demo mode when MongoDB is not connected
        if (!getMongoConnected()) {
            const guestData = req.body;

            // Check if guest exists in demo storage
            let existingGuest = demoGuestHistoryStorage.find(g => g.guestEmail === guestData.guestEmail);
            if (existingGuest) {
                // Update existing guest
                if (guestData.accommodations) {
                    existingGuest.accommodations.push(...guestData.accommodations);
                }
                existingGuest.preferences = { ...existingGuest.preferences, ...guestData.preferences };
                existingGuest.totalStays = (existingGuest.totalStays || 0) + (guestData.accommodations?.length || 0);

                // Calculate nights and total spent
                let totalNights = 0;
                let totalSpent = 0;
                if (guestData.accommodations) {
                    guestData.accommodations.forEach((acc) => {
                        if (acc.checkInDate && acc.checkOutDate) {
                            const nights = Math.ceil((new Date(acc.checkOutDate).getTime() - new Date(acc.checkInDate).getTime()) / (1000 * 60 * 60 * 24));
                            totalNights += nights;
                        }
                        totalSpent += acc.totalSpent || 0;
                    });
                }
                existingGuest.totalNights = (existingGuest.totalNights || 0) + totalNights;
                existingGuest.totalSpent = (existingGuest.totalSpent || 0) + totalSpent;

                // Update lastStayDate if there's a new accommodation
                if (guestData.accommodations && guestData.accommodations.length > 0) {
                    const lastAcc = guestData.accommodations[guestData.accommodations.length - 1];
                    if (lastAcc.checkInDate) {
                        existingGuest.lastStayDate = lastAcc.checkInDate;
                    }
                }

                return res.json({ message: 'Guest updated', guest: existingGuest });
            }

            // Create new guest
            const guestId = guestData._id || 'GUEST-' + Math.random().toString(36).substring(2, 10).toUpperCase();
            const newGuest = {
                _id: guestId,
                ...guestData,
                totalStays: guestData.accommodations?.length || 1,
                totalNights: guestData.accommodations ? guestData.accommodations.reduce((sum, acc) => {
                    if (acc.checkInDate && acc.checkOutDate) {
                        return sum + Math.ceil((new Date(acc.checkOutDate).getTime() - new Date(acc.checkInDate).getTime()) / (1000 * 60 * 60 * 24));
                    }
                    return sum;
                }, 0) : 0,
                totalSpent: guestData.accommodations ? guestData.accommodations.reduce((sum, acc) => sum + (acc.totalSpent || 0), 0) : 0,
                lastStayDate: guestData.accommodations && guestData.accommodations.length > 0 ? guestData.accommodations[0].checkInDate : new Date().toISOString().split('T')[0],
                preferences: guestData.preferences || {},
                accommodations: guestData.accommodations || []
            };
            demoGuestHistoryStorage.push(newGuest);
            return res.status(201).json({ message: 'Guest created', guest: newGuest });
        }
        const { v4: uuidv4 } = require('uuid');
        const guestData = req.body;

        // Check if guest exists
        let guest = await GuestHistory.findOne({ guestEmail: guestData.guestEmail });
        if (guest) {
            // Update existing guest
            if (guestData.accommodations) {
                guest.accommodations.push(...guestData.accommodations);
            }
            Object.assign(guest.preferences, guestData.preferences);
            guest.totalStays = (guest.totalStays || 0) + (guestData.accommodations?.length || 0);
            guest.totalNights = guest.totalNights || 0;
            guest.totalSpent = guest.totalSpent || 0;
            if (guestData.accommodations) {
                guestData.accommodations.forEach((acc) => {
                    if (acc.checkInDate && acc.checkOutDate) {
                        const nights = Math.ceil((new Date(acc.checkOutDate).getTime() - new Date(acc.checkInDate).getTime()) / (1000 * 60 * 60 * 24));
                        guest.totalNights += nights;
                    }
                    guest.totalSpent += acc.totalSpent || 0;
                });
            }
            await guest.save();
            return res.json({ message: 'Guest updated', guest });
        }

        // Create new guest
        const guestId = 'GUEST-' + uuidv4().substring(0, 8).toUpperCase();
        guest = new GuestHistory({
            _id: guestId,
            ...guestData,
            createdAt: new Date(),
            updatedAt: new Date()
        });
        await guest.save();
        res.status(201).json({ message: 'Guest created', guest });
    } catch (err) { res.status(400).json({ error: err.message }); }
});

// Update guest history
router.put('/guest-history/:id', requireAdmin, async (req, res) => {
    try {
        if (!getMongoConnected()) return res.status(503).json({ error: 'Database unavailable' });
        const guest = await GuestHistory.findByIdAndUpdate(
            req.params.id,
            { ...req.body, updatedAt: new Date() },
            { new: true }
        );
        if (!guest) return res.status(404).json({ error: 'Guest not found' });
        res.json({ message: 'Guest updated', guest });
    } catch (err) { res.status(400).json({ error: err.message }); }
});

// ===== ACCOMMODATION STAFF =====

// Get all accommodation staff
router.get('/accommodation-staff', requireAdmin, async (req, res) => {
    try {
        if (!getMongoConnected()) {
            // Return demo data when database is not connected
            return res.json({
                staff: [
                    { _id: 'accstaff1', accommodationId: 'acc1', name: 'Grace Nekesa', role: 'Accommodation Manager', email: 'grace@thequill.com', phone: '+254767890123', shift: 'full-time', isActive: true, startDate: '2024-01-10', hourlyRate: 550 },
                    { _id: 'accstaff2', accommodationId: 'acc1', name: 'Mary Wanjiku', role: 'Housekeeping Supervisor', email: 'mary.housekeeping@thequill.com', phone: '+254723456789', shift: 'morning', isActive: true, startDate: '2023-06-01', hourlyRate: 300 },
                    { _id: 'accstaff3', accommodationId: 'acc1', name: 'Peter Ochieng', role: 'Room Attendant', email: 'peter.rooms@thequill.com', phone: '+254734567890', shift: 'morning', isActive: true, startDate: '2024-03-20', hourlyRate: 200 },
                    { _id: 'accstaff4', accommodationId: 'acc1', name: 'James Otieno', role: 'Maintenance Technician', email: 'james.maint@thequill.com', phone: '+254756789012', shift: 'full-time', isActive: true, startDate: '2024-02-01', hourlyRate: 350 },
                    { _id: 'accstaff5', accommodationId: 'acc1', name: 'Sarah Akinyi', role: 'Receptionist', email: 'sarah.reception@thequill.com', phone: '+254745678901', shift: 'evening', isActive: true, startDate: '2024-01-15', hourlyRate: 250 }
                ]
            });
        }
        const { accommodationId, role } = req.query;
        let query = {};
        if (accommodationId) query.accommodationId = accommodationId;
        if (role && role !== 'all') query.role = role;
        const staff = await AccommodationStaff.find(query).sort({ name: 1 });
        res.json({ staff });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Create accommodation staff
router.post('/accommodation-staff', requireAdmin, async (req, res) => {
    try {
        if (!getMongoConnected()) return res.status(503).json({ error: 'Database unavailable' });
        const { v4: uuidv4 } = require('uuid');
        const staffData = req.body;
        const staffId = 'ACCSTAFF-' + uuidv4().substring(0, 8).toUpperCase();
        const staff = new AccommodationStaff({
            _id: staffId,
            ...staffData,
            isActive: staffData.isActive !== false,
            createdAt: new Date(),
            updatedAt: new Date()
        });
        await staff.save();
        res.status(201).json({ message: 'Staff created', staff });
    } catch (err) { res.status(400).json({ error: err.message }); }
});

// Update accommodation staff
router.put('/accommodation-staff/:id', requireAdmin, async (req, res) => {
    try {
        if (!getMongoConnected()) return res.status(503).json({ error: 'Database unavailable' });
        const staff = await AccommodationStaff.findByIdAndUpdate(
            req.params.id,
            { ...req.body, updatedAt: new Date() },
            { new: true }
        );
        if (!staff) return res.status(404).json({ error: 'Staff not found' });
        res.json({ message: 'Staff updated', staff });
    } catch (err) { res.status(400).json({ error: err.message }); }
});

// Delete accommodation staff
router.delete('/accommodation-staff/:id', requireAdmin, async (req, res) => {
    try {
        if (!getMongoConnected()) return res.status(503).json({ error: 'Database unavailable' });
        const staff = await AccommodationStaff.findByIdAndDelete(req.params.id);
        if (!staff) return res.status(404).json({ error: 'Staff not found' });
        res.json({ message: 'Staff deleted' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ===== FAQ MANAGEMENT =====

// Get all FAQs (admin)
router.get('/faqs', requireAdmin, async (req, res) => {
    try {
        if (!getMongoConnected()) {
            return res.json({
                faqs: [
                    { _id: 'faq1', question: 'What are your operating hours?', answer: 'The Quill is open 24 hours a day, 7 days a week.', category: 'general', isActive: true, order: 1 },
                    { _id: 'faq2', question: 'How can I place an order?', answer: 'You can place an order through our website, by calling us at 0113 857846.', category: 'orders', isActive: true, order: 2 },
                    { _id: 'faq3', question: 'What is the delivery area?', answer: 'We deliver within Korinda and surrounding areas.', category: 'delivery', isActive: true, order: 3 }
                ]
            });
        }
        const { category } = req.query;
        let query = {};
        if (category && category !== 'all') query.category = category;
        const faqs = await FAQ.find(query).sort({ order: 1, createdAt: -1 });
        res.json({ faqs });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Create FAQ (admin)
router.post('/faqs', requireAdmin, async (req, res) => {
    try {
        if (!getMongoConnected()) return res.status(503).json({ error: 'Database unavailable' });
        const { v4: uuidv4 } = require('uuid');
        const { question, answer, category, isActive, order } = req.body;
        if (!question || !answer) return res.status(400).json({ error: 'Question and answer are required' });
        const faqId = 'FAQ-' + uuidv4().substring(0, 8).toUpperCase();
        const faq = new FAQ({ _id: faqId, question, answer, category: category || 'general', isActive: isActive !== false, order: order || 0, createdAt: new Date() });
        await faq.save();
        res.status(201).json({ message: 'FAQ created', faq });
    } catch (err) { res.status(400).json({ error: err.message }); }
});

// Update FAQ (admin)
router.put('/faqs/:id', requireAdmin, async (req, res) => {
    try {
        if (!getMongoConnected()) return res.status(503).json({ error: 'Database unavailable' });
        const { question, answer, category, isActive, order } = req.body;
        const faq = await FAQ.findById(req.params.id);
        if (!faq) return res.status(404).json({ error: 'FAQ not found' });
        if (question) faq.question = question;
        if (answer) faq.answer = answer;
        if (category) faq.category = category;
        if (isActive !== undefined) faq.isActive = isActive;
        if (order !== undefined) faq.order = order;
        await faq.save();
        res.json({ message: 'FAQ updated', faq });
    } catch (err) { res.status(400).json({ error: err.message }); }
});

// Delete FAQ (admin)
router.delete('/faqs/:id', requireAdmin, async (req, res) => {
    try {
        if (!getMongoConnected()) return res.status(503).json({ error: 'Database unavailable' });
        const faq = await FAQ.findByIdAndDelete(req.params.id);
        if (!faq) return res.status(404).json({ error: 'FAQ not found' });
        res.json({ message: 'FAQ deleted' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ===== SITE CONTENT MANAGEMENT =====

// Get all site content (admin)
router.get('/site-content', requireAdmin, async (req, res) => {
    try {
        if (!getMongoConnected()) return res.json({ contents: [] });
        const { type } = req.query;
        let query = {};
        if (type && type !== 'all') query.type = type;
        const contents = await SiteContent.find(query).sort({ type: 1, order: 1 });
        res.json({ contents });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Create site content (admin)
router.post('/site-content', requireAdmin, async (req, res) => {
    try {
        if (!getMongoConnected()) return res.status(503).json({ error: 'Database unavailable' });
        const { v4: uuidv4 } = require('uuid');
        const { key, type, title, content, isActive, order } = req.body;
        if (!key || !type) return res.status(400).json({ error: 'Key and type are required' });
        const existing = await SiteContent.findOne({ key });
        if (existing) return res.status(400).json({ error: 'Content with this key already exists' });
        const contentId = 'CONT-' + uuidv4().substring(0, 8).toUpperCase();
        const newContent = new SiteContent({ _id: contentId, key, type, title: title || key, content: content || {}, isActive: isActive !== false, order: order || 0, createdAt: new Date() });
        await newContent.save();
        res.status(201).json({ message: 'Content created', content: newContent });
    } catch (err) { res.status(400).json({ error: err.message }); }
});

// Update site content (admin)
router.put('/site-content/:id', requireAdmin, async (req, res) => {
    try {
        if (!getMongoConnected()) return res.status(503).json({ error: 'Database unavailable' });
        const { title, content, isActive, order } = req.body;
        const siteContent = await SiteContent.findByIdAndUpdate(req.params.id, { ...(title && { title }), ...(content && { content }), ...(isActive !== undefined && { isActive }), ...(order !== undefined && { order }), updatedAt: new Date() }, { new: true });
        if (!siteContent) return res.status(404).json({ error: 'Content not found' });
        res.json({ message: 'Content updated', content: siteContent });
    } catch (err) { res.status(400).json({ error: err.message }); }
});

// Delete site content (admin)
router.delete('/site-content/:id', requireAdmin, async (req, res) => {
    try {
        if (!getMongoConnected()) return res.status(503).json({ error: 'Database unavailable' });
        const content = await SiteContent.findByIdAndDelete(req.params.id);
        if (!content) return res.status(404).json({ error: 'Content not found' });
        res.json({ message: 'Content deleted' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ===== FOOTER CONTENT MANAGEMENT =====

// Get footer content (admin)
router.get('/footer', requireAdmin, async (req, res) => {
    try {
        if (!getMongoConnected()) {
            return res.json({ footer: { _id: 'footer-default', restaurantName: 'The Quill', description: 'Experience Flavor Without Limits.', phone: '0113 857846', email: 'thequillrestaurant@gmail.com', address: 'B1, C4XP+MH Korinda', operatingHours: 'Open 24 Hours', copyright: '© 2026 The Quill. All rights reserved.' } });
        }
        let footer = await FooterContent.findOne();
        if (!footer) { footer = new FooterContent({ _id: 'footer-default', restaurantName: 'The Quill', phone: '0113 857846', email: 'thequillrestaurant@gmail.com', address: 'Korinda', operatingHours: 'Open 24 Hours' }); await footer.save(); }
        res.json({ footer });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Update footer content (admin)
router.put('/footer', requireAdmin, async (req, res) => {
    try {
        if (!getMongoConnected()) return res.status(503).json({ error: 'Database unavailable' });
        const { restaurantName, description, phone, email, address, operatingHours, socialLinks, developedBy, copyright } = req.body;
        let footer = await FooterContent.findOne();
        if (!footer) { footer = new FooterContent(req.body); }
        else { if (restaurantName) footer.restaurantName = restaurantName; if (description) footer.description = description; if (phone) footer.phone = phone; if (email) footer.email = email; if (address) footer.address = address; if (operatingHours) footer.operatingHours = operatingHours; if (socialLinks) footer.socialLinks = { ...footer.socialLinks, ...socialLinks }; if (developedBy) footer.developedBy = { ...footer.developedBy, ...developedBy }; if (copyright) footer.copyright = copyright; }
        footer.updatedAt = new Date();
        await footer.save();
        res.json({ message: 'Footer updated', footer });
    } catch (err) { res.status(400).json({ error: err.message }); }
});

// Public FAQ route
router.get('/public/faqs', async (req, res) => {
    try {
        if (!getMongoConnected()) return res.json([{ _id: 'faq1', question: 'What are your operating hours?', answer: 'We are open 24/7!' }]);
        const faqs = await FAQ.find({ isActive: true }).sort({ order: 1 });
        res.json(faqs);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Public footer route
router.get('/public/footer', async (req, res) => {
    try {
        if (!getMongoConnected()) return res.json({ restaurantName: 'The Quill', phone: '0113 857846', email: 'thequillrestaurant@gmail.com', address: 'Korinda', operatingHours: 'Open 24 Hours' });
        const footer = await FooterContent.findOne();
        res.json(footer || {});
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ===== SITE VISITOR TRACKING =====

// Get visitor analytics (admin)
router.get('/analytics/visitors', requireAdmin, async (req, res) => {
    try {
        if (!getMongoConnected()) {
            // Return demo data
            return res.json({
                totalVisitors: 15234,
                uniqueVisitors: 8934,
                newVisitors: 4521,
                returningVisitors: 4413,
                pageViews: 42156,
                avgSessionDuration: 185,
                bounceRate: 35.2,
                dailyVisitors: [
                    { date: '2026-03-01', visitors: 456, pageViews: 1234 },
                    { date: '2026-03-02', visitors: 512, pageViews: 1456 },
                    { date: '2026-03-03', visitors: 478, pageViews: 1321 },
                    { date: '2026-03-04', visitors: 534, pageViews: 1567 },
                    { date: '2026-03-05', visitors: 498, pageViews: 1398 },
                    { date: '2026-03-06', visitors: 567, pageViews: 1678 },
                    { date: '2026-03-07', visitors: 423, pageViews: 1145 }
                ],
                topPages: [
                    { page: '/', views: 12450 },
                    { page: '/menu', views: 8923 },
                    { page: '/reservations', views: 5678 },
                    { page: '/about', views: 3421 },
                    { page: '/contact', views: 2341 }
                ],
                topReferrers: [
                    { source: 'Direct', visits: 5423 },
                    { source: 'Google', visits: 3245 },
                    { source: 'Facebook', visits: 1876 },
                    { source: 'Instagram', visits: 1234 },
                    { source: 'Twitter', visits: 567 }
                ],
                deviceBreakdown: { desktop: 45, mobile: 48, tablet: 7 },
                countryBreakdown: [
                    { country: 'Kenya', visitors: 12543 },
                    { country: 'Uganda', visitors: 1234 },
                    { country: 'Tanzania', visitors: 876 },
                    { country: 'Nigeria', visitors: 234 },
                    { country: 'Other', visitors: 347 }
                ]
            });
        }

        const { range = '30d' } = req.query;
        let days = 30;
        if (range === '7d') days = 7;
        else if (range === '90d') days = 90;

        const now = new Date();
        const startDate = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

        // Get visitor analytics from daily analytics collection
        const dailyAnalytics = await DailyVisitorAnalytics.find({
            date: { $gte: startDate }
        }).sort({ date: 1 });

        // Get all visitors in the period
        const visitors = await SiteVisitor.find({
            visitedAt: { $gte: startDate }
        });

        // Calculate totals
        const totalVisitors = visitors.length;
        const uniqueSessions = new Set(visitors.map(v => v.sessionId));
        const uniqueVisitors = uniqueSessions.size;
        const newVisitors = visitors.filter(v => {
            const firstVisit = new Date(v.firstVisit);
            return firstVisit >= startDate;
        }).length;
        const returningVisitors = uniqueVisitors - newVisitors;
        const pageViews = visitors.reduce((sum, v) => sum + (v.pageViews || 1), 0);

        // Calculate average session duration (in seconds)
        const avgSessionDuration = visitors.length > 0 ?
            Math.round(visitors.reduce((sum, v) => {
                const duration = new Date(v.lastVisit).getTime() - new Date(v.firstVisit).getTime();
                return sum + duration;
            }, 0) / visitors.length / 1000) : 0;

        // Bounce rate (visitors who only viewed one page)
        const onePageVisitors = visitors.filter(v => v.pageViews === 1).length;
        const bounceRate = totalVisitors > 0 ?
            Math.round((onePageVisitors / totalVisitors) * 100 * 10) / 10 : 0;

        // Daily visitors
        const dailyVisitors = dailyAnalytics.map(d => ({
            date: d.date.toISOString().split('T')[0],
            visitors: d.totalVisitors,
            pageViews: d.pageViews
        }));

        // Top pages
        const pageCounts = {};
        visitors.forEach(v => {
            if (v.pagesVisited) {
                v.pagesVisited.forEach(page => {
                    pageCounts[page] = (pageCounts[page] || 0) + 1;
                });
            }
        });
        const topPages = Object.entries(pageCounts)
            .map(([page, views]) => ({ page, views }))
            .sort((a, b) => b.views - a.views)
            .slice(0, 10);

        // Top referrers
        const referrerCounts = {};
        visitors.forEach(v => {
            const source = v.referrer || 'Direct';
            referrerCounts[source] = (referrerCounts[source] || 0) + 1;
        });
        const topReferrers = Object.entries(referrerCounts)
            .map(([source, visits]) => ({ source, visits }))
            .sort((a, b) => b.visits - a.visits)
            .slice(0, 10);

        // Device breakdown
        const deviceBreakdown = { desktop: 0, mobile: 0, tablet: 0 };
        visitors.forEach(v => {
            const device = v.deviceType || 'desktop';
            deviceBreakdown[device] = (deviceBreakdown[device] || 0) + 1;
        });
        const totalDevices = Object.values(deviceBreakdown).reduce((a, b) => a + b, 0);
        if (totalDevices > 0) {
            deviceBreakdown.desktop = Math.round((deviceBreakdown.desktop / totalDevices) * 100);
            deviceBreakdown.mobile = Math.round((deviceBreakdown.mobile / totalDevices) * 100);
            deviceBreakdown.tablet = Math.round((deviceBreakdown.tablet / totalDevices) * 100);
        }

        // Country breakdown
        const countryCounts = {};
        visitors.forEach(v => {
            const country = v.country || 'Unknown';
            countryCounts[country] = (countryCounts[country] || 0) + 1;
        });
        const countryBreakdown = Object.entries(countryCounts)
            .map(([country, visitors]) => ({ country, visitors }))
            .sort((a, b) => b.visitors - a.visitors)
            .slice(0, 10);

        res.json({
            totalVisitors,
            uniqueVisitors,
            newVisitors: newVisitors > 0 ? newVisitors : Math.round(uniqueVisitors * 0.5),
            returningVisitors: returningVisitors > 0 ? returningVisitors : Math.round(uniqueVisitors * 0.5),
            pageViews,
            avgSessionDuration,
            bounceRate,
            dailyVisitors: dailyVisitors.length > 0 ? dailyVisitors : [
                { date: now.toISOString().split('T')[0], visitors: uniqueVisitors, pageViews }
            ],
            topPages,
            topReferrers,
            deviceBreakdown,
            countryBreakdown
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Track a page view (public - called from frontend)
router.post('/track/visit', async (req, res) => {
    // Always return success - tracking should never break the app
    try {
        const { sessionId, page, referrer } = req.body;
        const userAgent = req.headers['user-agent'] || '';

        // If no required data, just return success
        if (!sessionId || !page) {
            return res.json({ success: true, message: 'Invalid request' });
        }

        // If MongoDB not connected, return success without tracking
        if (!getMongoConnected()) {
            return res.json({ success: true, message: 'Tracking disabled' });
        }

        // Detect device type
        let deviceType = 'desktop';
        if (/mobile/i.test(userAgent)) deviceType = 'mobile';
        else if (/tablet/i.test(userAgent)) deviceType = 'tablet';

        // Detect browser
        let browser = 'Unknown';
        if (/chrome/i.test(userAgent)) browser = 'Chrome';
        else if (/firefox/i.test(userAgent)) browser = 'Firefox';
        else if (/safari/i.test(userAgent)) browser = 'Safari';
        else if (/edge/i.test(userAgent)) browser = 'Edge';

        // Detect OS
        let os = 'Unknown';
        if (/windows/i.test(userAgent)) os = 'Windows';
        else if (/mac/i.test(userAgent)) os = 'macOS';
        else if (/linux/i.test(userAgent)) os = 'Linux';
        else if (/android/i.test(userAgent)) os = 'Android';
        else if (/ios|iphone|ipad/i.test(userAgent)) os = 'iOS';

        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

        // Check if this is a new session or existing
        try {
            let visitor = await SiteVisitor.findOne({ sessionId });

            if (visitor) {
                // Update existing visitor
                visitor.lastVisit = now;
                visitor.pageViews = (visitor.pageViews || 0) + 1;
                if (!visitor.pagesVisited.includes(page)) {
                    visitor.pagesVisited.push(page);
                }
                await visitor.save();
            } else {
                // Create new visitor
                visitor = new SiteVisitor({
                    sessionId,
                    userAgent,
                    referrer: referrer || 'Direct',
                    deviceType,
                    browser,
                    os,
                    firstVisit: now,
                    lastVisit: now,
                    pageViews: 1,
                    pagesVisited: [page],
                    visitedAt: now
                });
                await visitor.save();
            }
        } catch (dbError) {
            // Ignore DB errors for visitor tracking
            console.debug('Visitor DB error (ignored):', dbError.message);
        }

        // Update daily analytics (don't let this fail)
        try {
            const todayStr = today.toISOString().split('T')[0];
            let dailyAnalytics = await DailyVisitorAnalytics.findOne({ date: today });

            if (dailyAnalytics) {
                dailyAnalytics.totalVisitors += 1;
                dailyAnalytics.pageViews += 1;

                // Update top pages
                const pageIndex = dailyAnalytics.topPages.findIndex(p => p.page === page);
                if (pageIndex >= 0) {
                    dailyAnalytics.topPages[pageIndex].views += 1;
                } else {
                    dailyAnalytics.topPages.push({ page, views: 1 });
                }

                // Update top referrers
                const referrerSource = referrer || 'Direct';
                const refIndex = dailyAnalytics.topReferrers.findIndex(r => r.source === referrerSource);
                if (refIndex >= 0) {
                    dailyAnalytics.topReferrers[refIndex].visits += 1;
                } else {
                    dailyAnalytics.topReferrers.push({ source: referrerSource, visits: 1 });
                }

                // Update device breakdown
                if (deviceType === 'desktop') dailyAnalytics.deviceBreakdown.desktop += 1;
                else if (deviceType === 'mobile') dailyAnalytics.deviceBreakdown.mobile += 1;
                else if (deviceType === 'tablet') dailyAnalytics.deviceBreakdown.tablet += 1;

                await dailyAnalytics.save();
            } else {
                // Create new daily analytics
                dailyAnalytics = new DailyVisitorAnalytics({
                    _id: 'VIS-' + todayStr,
                    date: today,
                    totalVisitors: 1,
                    uniqueVisitors: 1,
                    newVisitors: 1,
                    returningVisitors: 0,
                    pageViews: 1,
                    avgSessionDuration: 0,
                    bounceRate: 0,
                    topPages: [{ page, views: 1 }],
                    topReferrers: [{ source: referrer || 'Direct', visits: 1 }],
                    deviceBreakdown: {
                        desktop: deviceType === 'desktop' ? 1 : 0,
                        mobile: deviceType === 'mobile' ? 1 : 0,
                        tablet: deviceType === 'tablet' ? 1 : 0
                    },
                    countryBreakdown: []
                });
                await dailyAnalytics.save();
            }
        } catch (analyticsError) {
            // Ignore analytics errors
            console.debug('Analytics DB error (ignored):', analyticsError.message);
        }

        res.json({ success: true });
    } catch (err) {
        // Log error but return success - tracking should never break the app
        console.debug('Visitor tracking error (ignored):', err.message);
        res.json({ success: true });
    }
});

module.exports = router;
