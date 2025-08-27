const express = require('express');
const router = express.Router();
const ocrController = require('../controllers/ocrController');

// 图片识别API端点（异步模式）
// POST /api/ocr/recognize
// 需要上传图片文件，字段名为 'image'
// 返回任务ID，需要通过状态查询接口获取结果
router.post('/recognize', ocrController.uploadMiddleware, ocrController.recognizeImage);

// 查询OCR任务状态
// GET /api/ocr/status/:taskId
// 返回任务状态、进度和结果
router.get('/status/:taskId', ocrController.getTaskStatus);

// 查询OCR任务记录历史
// GET /api/ocr/records
// 支持分页和筛选参数：page, limit, status, startDate, endDate
router.get('/records', ocrController.getTaskRecords);

module.exports = router;