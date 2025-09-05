const express = require('express');
const router = express.Router();
const statisticsController = require('../controllers/statisticsController');

// 线索统计概览
router.get('/leads-overview', statisticsController.getLeadsOverview);

// 线索来源统计
router.get('/lead-sources', statisticsController.getLeadSourceStats);

// 线索来源趋势统计
router.get('/lead-sources/trend', statisticsController.getLeadSourceTrend);

// 上周统计
router.get('/last-week', statisticsController.getLastWeekStats);

// 平台账号统计概览
router.get('/platform-account-summary', statisticsController.getPlatformAccountSummary);

module.exports = router; 