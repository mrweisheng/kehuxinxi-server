const express = require('express');
const router = express.Router();
const remindEmailListController = require('../controllers/remindEmailListController');

// 获取所有收件人邮箱
router.get('/', remindEmailListController.getEmailList);
// 新增收件人邮箱
router.post('/', remindEmailListController.addEmail);
// 删除收件人邮箱
router.delete('/:id', remindEmailListController.deleteEmail);

module.exports = router; 