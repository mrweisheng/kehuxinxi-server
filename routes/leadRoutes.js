const express = require('express');
const router = express.Router();
const leadController = require('../controllers/leadController');

// 新增线索
router.post('/', leadController.createLead);
// 获取线索列表
router.get('/', leadController.getLeads);
// 获取线索详情
router.get('/:id', leadController.getLeadDetail);
// 编辑线索
router.put('/:id', leadController.updateLead);
// 删除线索
router.delete('/:id', leadController.deleteLead);

module.exports = router; 