const OperationLog = require('../models/logModel');
const { Op } = require('sequelize');

// 查询日志
exports.getLogs = async (req, res) => {
  const startTime = Date.now();
  try {
    const { lead_id, date_from, date_to } = req.query;
    
    // 参数验证
    if (lead_id && isNaN(Number(lead_id))) {
      const totalTime = Date.now() - startTime;
      return res.status(400).json({
        success: false,
        message: 'lead_id必须是有效的数字',
        performance: {
          totalTime: `${totalTime}ms`
        }
      });
    }
    
    // 验证日期格式
    if (date_from && !isValidDate(date_from)) {
      const totalTime = Date.now() - startTime;
      return res.status(400).json({
        success: false,
        message: 'date_from日期格式错误',
        performance: {
          totalTime: `${totalTime}ms`
        }
      });
    }
    
    if (date_to && !isValidDate(date_to)) {
      const totalTime = Date.now() - startTime;
      return res.status(400).json({
        success: false,
        message: 'date_to日期格式错误',
        performance: {
          totalTime: `${totalTime}ms`
        }
      });
    }
    
    const where = {};
    if (lead_id) where.lead_id = lead_id;
    if (date_from && date_to) {
      where.operation_time = { [Op.between]: [date_from, date_to] };
    }
    
    const dbStartTime = Date.now();
    const list = await OperationLog.findAll({
      where,
      order: [['operation_time', 'DESC']],
      raw: true // 返回纯净的业务数据
    });
    const dbEndTime = Date.now();
    
    const totalTime = Date.now() - startTime;
    const dbTime = dbEndTime - dbStartTime;
    
    console.log(`查询日志完成 - 总耗时: ${totalTime}ms, 数据库操作耗时: ${dbTime}ms`);
    
    res.json({ 
      success: true, 
      list,
      performance: {
        totalTime: `${totalTime}ms`,
        dbTime: `${dbTime}ms`
      }
    });
  } catch (err) {
    const totalTime = Date.now() - startTime;
    console.error(`查询日志出错 - 总耗时: ${totalTime}ms`, err);
    res.status(500).json({ 
      success: false, 
      message: err.message,
      performance: {
        totalTime: `${totalTime}ms`
      }
    });
  }
};

// 验证日期格式 - 只验证字符串格式，不做Date对象转换
function isValidDate(dateString) {
  // 验证格式：yyyy-MM-dd HH:mm:ss 或 yyyy-MM-dd
  const dateTimePattern = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
  const datePattern = /^\d{4}-\d{2}-\d{2}$/;
  return dateTimePattern.test(dateString) || datePattern.test(dateString);
} 