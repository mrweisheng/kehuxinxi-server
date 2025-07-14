const FollowUpRecord = require('../models/followupModel');

// 验证跟进记录数据
function validateFollowUpData(data) {
  const requiredFields = [
    'lead_id',
    'follow_up_time',
    'follow_up_method',
    'follow_up_content',
    'follow_up_result',
    'follow_up_person'
  ];
  
  const missingFields = requiredFields.filter(field => !data[field]);
  
  if (missingFields.length > 0) {
    return {
      valid: false,
      message: `缺少必填字段: ${missingFields.join(', ')}`
    };
  }
  
  // 验证lead_id是否为数字
  if (isNaN(Number(data.lead_id))) {
    return {
      valid: false,
      message: 'lead_id必须是有效的数字'
    };
  }
  
  return { valid: true };
}

// 新增跟进记录
exports.createFollowUp = async (req, res) => {
  const startTime = Date.now();
  try {
    const data = req.body;
    
    // 参数验证
    const validation = validateFollowUpData(data);
    if (!validation.valid) {
      const totalTime = Date.now() - startTime;
      return res.status(400).json({
        success: false,
        message: validation.message,
        performance: {
          totalTime: `${totalTime}ms`
        }
      });
    }
    
    const dbStartTime = Date.now();
    const record = await FollowUpRecord.create(data);
    // 新增：自动将该线索的need_followup字段设为0
    const CustomerLead = require('../models/leadModel');
    await CustomerLead.update({ need_followup: 0 }, { where: { id: data.lead_id } });
    const dbEndTime = Date.now();
    
    const totalTime = Date.now() - startTime;
    const dbTime = dbEndTime - dbStartTime;
    
    console.log(`新增跟进记录完成 - 总耗时: ${totalTime}ms, 数据库操作耗时: ${dbTime}ms`);
    
    res.json({ 
      success: true, 
      id: record.id,
      performance: {
        totalTime: `${totalTime}ms`,
        dbTime: `${dbTime}ms`
      }
    });
  } catch (err) {
    const totalTime = Date.now() - startTime;
    console.error(`新增跟进记录出错 - 总耗时: ${totalTime}ms`, err);
    
    let statusCode = 500;
    let errorMessage = err.message;
    
    if (err.name === 'SequelizeValidationError') {
      statusCode = 400;
      errorMessage = '数据验证失败: ' + err.message;
    } else if (err.name === 'SequelizeForeignKeyConstraintError') {
      statusCode = 404;
      errorMessage = '关联的线索不存在';
    }
    
    res.status(statusCode).json({ 
      success: false, 
      message: errorMessage,
      performance: {
        totalTime: `${totalTime}ms`
      }
    });
  }
};

// 获取某条线索的跟进记录
exports.getFollowUps = async (req, res) => {
  const startTime = Date.now();
  try {
    const { lead_id } = req.query;
    
    // 参数验证
    if (!lead_id) {
      const totalTime = Date.now() - startTime;
      return res.status(400).json({ 
        success: false, 
        message: '缺少lead_id参数',
        performance: {
          totalTime: `${totalTime}ms`
        }
      });
    }
    
    if (isNaN(Number(lead_id))) {
      const totalTime = Date.now() - startTime;
      return res.status(400).json({ 
        success: false, 
        message: 'lead_id必须是有效的数字',
        performance: {
          totalTime: `${totalTime}ms`
        }
      });
    }
    
    const dbStartTime = Date.now();
    const list = await FollowUpRecord.findAll({
      where: { lead_id },
      order: [['follow_up_time', 'DESC']],
      raw: true // 返回纯净的业务数据，不包含Sequelize内部属性
    });
    const dbEndTime = Date.now();
    
    const totalTime = Date.now() - startTime;
    const dbTime = dbEndTime - dbStartTime;
    
    console.log(`获取跟进记录完成 - 总耗时: ${totalTime}ms, 数据库操作耗时: ${dbTime}ms`);
    
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
    console.error(`获取跟进记录出错 - 总耗时: ${totalTime}ms`, err);
    res.status(500).json({ 
      success: false, 
      message: err.message,
      performance: {
        totalTime: `${totalTime}ms`
      }
    });
  }
};

// 根据线索ID获取所有跟进记录（通过路径参数）
exports.getFollowUpsByLeadId = async (req, res) => {
  const startTime = Date.now();
  try {
    const { leadId } = req.params;
    const { page = 1, page_size = 20 } = req.query;
    
    // 参数验证
    if (!leadId || isNaN(Number(leadId))) {
      const totalTime = Date.now() - startTime;
      return res.status(400).json({
        success: false,
        message: '无效的线索ID',
        performance: {
          totalTime: `${totalTime}ms`
        }
      });
    }
    
    // 分页参数验证
    if (page < 1 || page_size < 1 || page_size > 100) {
      const totalTime = Date.now() - startTime;
      return res.status(400).json({
        success: false,
        message: '页码和页面大小必须是正整数，页面大小不能超过100',
        performance: {
          totalTime: `${totalTime}ms`
        }
      });
    }
    
    const dbStartTime = Date.now();
    
    // 计算偏移量
    const offset = (page - 1) * page_size;
    
    // 查询该线索的所有跟进记录，支持分页
    const { count, rows } = await FollowUpRecord.findAndCountAll({
      where: { lead_id: leadId },
      order: [['follow_up_time', 'DESC']], // 按跟进时间倒序，最新的在前面
      offset: Number(offset),
      limit: Number(page_size),
      raw: true // 返回纯净的业务数据，不包含Sequelize内部属性
    });
    
    const dbEndTime = Date.now();
    
    const totalTime = Date.now() - startTime;
    const dbTime = dbEndTime - dbStartTime;
    
    console.log(`获取线索ID ${leadId} 的跟进记录完成 - 总耗时: ${totalTime}ms, 数据库操作耗时: ${dbTime}ms`);
    console.log(`找到 ${count} 条跟进记录，当前页显示 ${rows.length} 条`);
    
    res.json({ 
      success: true, 
      leadId: Number(leadId),
      total: count,
      page: Number(page),
      page_size: Number(page_size),
      total_pages: Math.ceil(count / page_size),
      list: rows,
      performance: {
        totalTime: `${totalTime}ms`,
        dbTime: `${dbTime}ms`
      }
    });
  } catch (err) {
    const totalTime = Date.now() - startTime;
    console.error(`获取线索跟进记录出错 - 总耗时: ${totalTime}ms`, err);
    
    let statusCode = 500;
    let errorMessage = err.message;
    
    if (err.name === 'SequelizeConnectionError') {
      statusCode = 500;
      errorMessage = '数据库连接失败，请稍后重试';
    }
    
    res.status(statusCode).json({ 
      success: false, 
      message: errorMessage,
      performance: {
        totalTime: `${totalTime}ms`
      }
    });
  }
}; 