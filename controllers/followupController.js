const FollowUpRecord = require('../models/followupModel');
const User = require('../models/user');
const { updateNeedFollowupByLeadId, markCycleCompletedOnFollowUp } = require('../services/followupRemindChecker');

// 验证跟进记录数据
function validateFollowUpData(data) {
  const requiredFields = [
    'lead_id',
    'follow_up_time',
    'follow_up_method',
    'follow_up_content',
    'follow_up_result',
    'follow_up_person_id'
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
  
  // 验证follow_up_person_id是否为数字
  if (isNaN(Number(data.follow_up_person_id))) {
    return {
      valid: false,
      message: 'follow_up_person_id必须是有效的用户ID'
    };
  }
  
  return { valid: true };
}

// 新增跟进记录
exports.createFollowUp = async (req, res) => {
  const startTime = Date.now();
  try {
    const data = req.body;
    
    // 自动填充当前用户ID
    data.follow_up_person_id = req.user.id;
    
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
    // 新增：创建跟进记录后，将当前跟进周期标记为已完成
    await markCycleCompletedOnFollowUp(data.lead_id);
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
      include: [{
        model: User,
        as: 'followUpPerson',
        attributes: ['id', 'nickname']
      }],
      order: [['follow_up_time', 'DESC']]
    });
    const dbEndTime = Date.now();
    
    const totalTime = Date.now() - startTime;
    const dbTime = dbEndTime - dbStartTime;
    
    console.log(`获取跟进记录完成 - 总耗时: ${totalTime}ms, 数据库操作耗时: ${dbTime}ms`);
    
    res.json({ 
      success: true, 
      list: list.map(item => item.toJSON()),
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
    
    const dbStartTime = Date.now();
    const list = await FollowUpRecord.findAll({
      where: { lead_id: leadId },
      include: [{
        model: User,
        as: 'followUpPerson',
        attributes: ['id', 'nickname']
      }],
      order: [['follow_up_time', 'DESC']]
    });
    const dbEndTime = Date.now();
    
    const totalTime = Date.now() - startTime;
    const dbTime = dbEndTime - dbStartTime;
    
    console.log(`获取跟进记录完成 - 总耗时: ${totalTime}ms, 数据库操作耗时: ${dbTime}ms`);
    
    res.json({ 
      success: true, 
      list: list.map(item => item.toJSON()),
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