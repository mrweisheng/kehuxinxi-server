const express = require('express');
const router = express.Router();
const statisticsController = require('../controllers/statisticsController');

// 线索统计概览
router.get('/leads-overview', statisticsController.getLeadsOverview);

module.exports = router; 