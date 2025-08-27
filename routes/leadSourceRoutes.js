const express = require('express');
const router = express.Router();
const leadSourceController = require('../controllers/leadSourceController');

// 获取线索来源列表（按平台分组）
router.get('/', leadSourceController.getLeadSources);

// 获取所有平台列表
router.get('/platforms', leadSourceController.getPlatforms);

// 根据平台获取账号列表
router.get('/platforms/:platform/accounts', leadSourceController.getAccountsByPlatform);

// 新增平台
router.post('/platforms', leadSourceController.createPlatform);

// 新增账号
router.post('/accounts', leadSourceController.createAccount);

// 删除账号
router.delete('/accounts/:id', leadSourceController.deleteAccount);

module.exports = router;
