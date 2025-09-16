const express = require('express');
const router = express.Router();
const leadController = require('../controllers/leadController');
const authMiddleware = require('../middleware/auth');

// 新增线索 - 支持两种鉴权方式
router.post('/', (req, res, next) => {
  // 检查是否为批量登记模式
  const isBatchMode = req.headers['x-batch-mode'] === 'true';
  
  if (isBatchMode) {
    // 批量登记模式：跳过鉴权，直接执行
    console.log('批量登记模式：跳过鉴权');
    
    // 安全检查：验证请求来源（可选，根据实际需求调整）
    const userAgent = req.headers['user-agent'] || '';
    const referer = req.headers['referer'] || '';
    
    // 记录批量登记请求的详细信息
    console.log('批量登记请求详情:', {
      ip: req.ip,
      userAgent: userAgent.substring(0, 100),
      referer: referer.substring(0, 100),
      timestamp: new Date().toISOString()
    });
    
    return leadController.createLead(req, res);
  } else {
    // 正常模式：需要鉴权
    console.log('正常模式：需要鉴权');
    return authMiddleware(req, res, next);
  }
}, leadController.createLead);
// 获取线索列表
router.get('/', authMiddleware, leadController.getLeads);
// 获取重点客户列表
router.get('/key-customers', authMiddleware, leadController.getKeyCustomers);
// 导出客户线索
router.get('/export', authMiddleware, leadController.exportLeads);
// 获取线索详情
router.get('/:id', authMiddleware, leadController.getLeadDetail);
// 编辑线索
router.put('/:id', authMiddleware, leadController.updateLead);
// 启用跟进
router.post('/:id/enable-followup', authMiddleware, leadController.enableFollowup);
// 禁用跟进
router.post('/:id/disable-followup', authMiddleware, leadController.disableFollowup);
// 删除线索
router.delete('/:id', authMiddleware, leadController.deleteLead);

module.exports = router;