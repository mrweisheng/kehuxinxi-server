const express = require('express');
const router = express.Router();
const statisticsController = require('../controllers/statisticsController');
const authMiddleware = require('../middleware/auth');

// 线索统计概览
router.get('/leads-overview', authMiddleware, statisticsController.getLeadsOverview);

// 线索来源统计
router.get('/lead-sources', authMiddleware, statisticsController.getLeadSourceStats);

// 线索来源趋势
router.get('/lead-sources/trend', authMiddleware, statisticsController.getLeadSourceTrend);

// 上周统计
router.get('/last-week', authMiddleware, statisticsController.getLastWeekStats);

// 平台账号汇总
router.get('/platform-account-summary', authMiddleware, statisticsController.getPlatformAccountSummary);

module.exports = router;