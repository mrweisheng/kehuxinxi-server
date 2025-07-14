const express = require('express');
const router = express.Router();
const logController = require('../controllers/logController');

// 查询日志
router.get('/', logController.getLogs);

module.exports = router; 