const express = require('express');
const router = express.Router();
const followupRemindConfigController = require('../controllers/followupRemindConfigController');

// 获取所有意向级别的提醒配置
router.get('/', followupRemindConfigController.getAllConfigs);

// 更新某个意向级别的提醒配置
router.put('/:level', followupRemindConfigController.updateConfig);

// 手动触发跟进提醒检查
router.post('/trigger-check', followupRemindConfigController.triggerRemindCheck);

module.exports = router; 