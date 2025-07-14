const express = require('express');
const router = express.Router();
const followupController = require('../controllers/followupController');

// 新增跟进记录
router.post('/', followupController.createFollowUp);
// 获取某条线索的跟进记录（通过query参数）
router.get('/', followupController.getFollowUps);
// 获取某条线索的所有跟进记录（通过路径参数）
router.get('/:leadId', followupController.getFollowUpsByLeadId);

module.exports = router; 