const CustomerLead = require('../models/leadModel');
const FollowUpRecord = require('../models/followupModel');
const FollowupRemindConfig = require('../models/followupRemindConfig');
const { Op } = require('sequelize');
const dayjs = require('dayjs');
const { updateNeedFollowupByLeadId } = require('../services/followupRemindChecker');
const User = require('../models/user');

// 验证必填字段
function validateLeadData(data) {
  const requiredFields = [
    'customer_nickname',
    'source_platform', 
    'source_account',
    'contact_account',
    'lead_time',
    'is_contacted',
    'intention_level',
    'follow_up_person',
    'is_deal',
    'follow_up_content' // 新增：跟进内容必填
  ];
  
  const missingFields = requiredFields.filter(field => !data[field] && data[field] !== 0);
  
  if (missingFields.length > 0) {
    return {
      valid: false,
      message: `缺少必填字段: ${missingFields.join(', ')}`
    };
  }
  
  // 验证意向等级
  const validLevels = ['高', '中', '低'];
  if (!validLevels.includes(data.intention_level)) {
    return {
      valid: false,
      message: '意向等级必须是: 高、中、低'
    };
  }
  
  // 验证布尔值字段
  if (![0, 1].includes(data.is_contacted)) {
    return {
      valid: false,
      message: 'is_contacted 必须是 0 或 1'
    };
  }
  
  if (![0, 1].includes(data.is_deal)) {
    return {
      valid: false,
      message: 'is_deal 必须是 0 或 1'
    };
  }
  
  // 验证跟进内容不能为空字符串
  if (data.follow_up_content && data.follow_up_content.trim() === '') {
    return {
      valid: false,
      message: '跟进内容不能为空'
    };
  }
  
  return { valid: true };
}

// 新增线索
exports.createLead = async (req, res) => {
  const startTime = Date.now();
  let transaction;
  
  try {
    // 初始化事务
    transaction = await CustomerLead.sequelize.transaction();
    
    const data = req.body;
    // 日志打印入参
    console.log('收到新增线索请求:', JSON.stringify(data));
    
    // 检查是否为批量登记模式
    const isBatchMode = req.headers['x-batch-mode'] === 'true';
    let registrantId;
    
    if (isBatchMode) {
      // 批量登记模式：登记人固定为ID为2的用户
      registrantId = 2;
      console.log('批量登记模式：登记人ID设置为', registrantId);
      
      // 安全检查：验证ID为2的用户是否存在
      try {
        const User = require('../models/user');
        const batchUser = await User.findByPk(2);
        if (!batchUser) {
          await transaction.rollback();
          const totalTime = Date.now() - startTime;
          return res.status(400).json({
            success: false,
            message: '批量登记模式配置错误：ID为2的用户不存在',
            performance: {
              totalTime: `${totalTime}ms`
            }
          });
        }
      } catch (error) {
        await transaction.rollback();
        const totalTime = Date.now() - startTime;
        return res.status(500).json({
          success: false,
          message: '批量登记模式验证失败',
          performance: {
            totalTime: `${totalTime}ms`
          }
        });
      }
    } else {
      // 正常模式：登记人为当前登录用户
      registrantId = req.user.id;
      console.log('正常模式：登记人ID设置为', registrantId);
    }
    
    // 先自动填充登记人
    data.follow_up_person = registrantId;
    // 参数校验
    const validation = validateLeadData(data);
    if (!validation.valid) {
      await transaction.rollback();
      const totalTime = Date.now() - startTime;
      return res.status(400).json({
        success: false,
        message: validation.message,
        performance: {
          totalTime: `${totalTime}ms`
        }
      });
    }
    
    // 校验 current_follower 必须传且为数字
    if (!data.current_follower || isNaN(Number(data.current_follower))) {
      await transaction.rollback();
      const totalTime = Date.now() - startTime;
      return res.status(400).json({ success: false, message: 'current_follower（跟进人用户ID）必填且必须为有效用户ID' });
    }

    // 处理 deal_date 字段
    if (data.deal_date === '') {
      data.deal_date = null;
    }
    
    // 调试：打印传递给Sequelize的数据
    console.log('传递给Sequelize的数据:', JSON.stringify(data, null, 2));
    
    // 记录数据库操作开始时间
    const dbStartTime = Date.now();
    
    // 去重检查：对完整contact_name进行精确匹配
    if (data.contact_name) {
      const contactName = data.contact_name.trim();
      
      const existingLead = await CustomerLead.findOne({
        where: {
          contact_name: contactName
        },
        transaction
      });
      
      if (existingLead) {
        await transaction.rollback();
        const totalTime = Date.now() - startTime;
        console.log(`去重检查：发现重复的contact_name: ${contactName}，跳过创建`);
        return res.json({
          success: true,
          duplicate: true,
          message: `联系名称 ${contactName} 已存在，跳过创建`,
          existingId: existingLead.id,
          performance: {
            totalTime: `${totalTime}ms`
          }
        });
      }
    }
    
    // 1. 创建线索记录
    const lead = await CustomerLead.create(data, { transaction });
    
    // 调试：打印创建后的线索数据
    console.log('创建后的线索数据:', JSON.stringify(lead.toJSON(), null, 2));
    
    // 2. 创建首次跟进记录（新增线索时默认创建）
    let followUp = null;
    const shouldCreateFollowUp = data.create_follow_up !== false; // 默认为true，除非明确设置为false
    
    if (shouldCreateFollowUp) {
      const followUpData = {
        lead_id: lead.id,
        follow_up_time: data.lead_time, // 使用线索时间作为首次跟进时间
        follow_up_method: '首次联系', // 默认跟进方式
        follow_up_content: data.follow_up_content, // 用户必须提供的跟进内容
        follow_up_result: '待跟进', // 默认跟进结果
        follow_up_person_id: data.follow_up_person
      };
      
      followUp = await FollowUpRecord.create(followUpData, { transaction });
    }
    
    // 提交事务
    await transaction.commit();
    
    const dbEndTime = Date.now();
    
    // 记录总响应时间
    const totalTime = Date.now() - startTime;
    const dbTime = dbEndTime - dbStartTime;
    
    console.log(`新增线索完成 - 总耗时: ${totalTime}ms, 数据库操作耗时: ${dbTime}ms`);
    console.log(`创建线索ID: ${lead.id}${followUp ? `, 跟进记录ID: ${followUp.id}` : ', 未创建跟进记录'}`);
    
    res.json({ 
      success: true, 
      id: lead.id,
      followUpId: followUp ? followUp.id : null,
      createdFollowUp: !!followUp,
      performance: {
        totalTime: `${totalTime}ms`,
        dbTime: `${dbTime}ms`
      }
    });
  } catch (err) {
    // 回滚事务（如果事务已创建）
    if (transaction) {
      await transaction.rollback();
    }
    
    const totalTime = Date.now() - startTime;
    console.error(`新增线索出错 - 总耗时: ${totalTime}ms`, err);
    
    // 区分不同类型的错误
    let statusCode = 500;
    let errorMessage = err.message;
    
    if (err.name === 'SequelizeValidationError') {
      statusCode = 400;
      errorMessage = '数据验证失败: ' + err.message;
    } else if (err.name === 'SequelizeUniqueConstraintError') {
      statusCode = 400;
      errorMessage = '数据已存在，请检查输入信息';
    } else if (err.name === 'SequelizeForeignKeyConstraintError') {
      statusCode = 400;
      errorMessage = '关联数据错误，请检查输入信息';
    } else if (err.name === 'SequelizeConnectionError') {
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

// 获取线索列表（分页、筛选、模糊搜索）
exports.getLeads = async (req, res) => {
  const startTime = Date.now();
  try {
    const {
      page = 1,
      page_size = 20,
      intention_level,
      is_deal,
      is_contacted,
      keyword,
      contact_name,
      date_from,
      date_to
    } = req.query;
    
    // 参数验证
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
    
    const where = {};
    if (intention_level) where.intention_level = intention_level;
    if (is_deal !== undefined) where.is_deal = is_deal;
    if (is_contacted !== undefined) where.is_contacted = is_contacted;
    if (date_from && date_to) {
      where.lead_time = { 
        [Op.between]: [
          `${date_from} 00:00:00`, 
          `${date_to} 23:59:59`
        ] 
      };
    }
    const cleanKeyword = typeof keyword === 'string' ? keyword.trim() : '';
    if (cleanKeyword) {
      where[Op.or] = [
        { customer_nickname: { [Op.like]: `%${cleanKeyword}%` } },
        { contact_account: { [Op.like]: `%${cleanKeyword}%` } },
        { source_account: { [Op.like]: `%${cleanKeyword}%` } },
        { 
          contact_name: { 
            [Op.and]: [
              { [Op.ne]: null },
              { [Op.like]: `%${cleanKeyword}%` }
            ]
          } 
        }
      ];
    }
    // 新增：客户昵称模糊检索
    if (req.query.customer_nickname) {
      where.customer_nickname = { [Op.like]: `%${req.query.customer_nickname}%` };
    }
    // 新增：联系名称模糊检索
    if (req.query.contact_name) {
      const cleanContactName = req.query.contact_name.trim();
      if (cleanContactName) {
        where.contact_name = { 
          [Op.and]: [
            { [Op.ne]: null },
            { [Op.like]: `%${cleanContactName}%` }
          ]
        };
      }
    }
    
    // 新增：基于角色的权限控制
    const userRole = req.user.role;
    const userId = req.user.id;
    
    console.log(`用户权限控制 - 角色: ${userRole}, 用户ID: ${userId}`);
    
    if (userRole === 'service') {
      // 客服只能查看自己登记的线索
      where.follow_up_person = userId.toString();
      console.log('权限控制: 客服用户，只能查看自己登记的线索');
    } else if (userRole === 'sales') {
      // 销售只能查看分配给自己的线索
      where.current_follower = userId;
      console.log('权限控制: 销售用户，只能查看分配给自己的线索');
    } else if (userRole === 'admin') {
      // 管理员可以查看所有线索
      console.log('权限控制: 管理员用户，可以查看所有线索');
    } else {
      // 其他角色默认只能查看自己登记的线索
      where.follow_up_person = userId.toString();
      console.log('权限控制: 其他角色用户，只能查看自己登记的线索');
    }
    
    const offset = (page - 1) * page_size;
    const dbStartTime = Date.now();
    
    // 查询意向等级对应的最大未跟进天数配置
    const remindConfigs = await FollowupRemindConfig.findAll({ raw: true });
    const configMap = {};
    remindConfigs.forEach(cfg => {
      configMap[cfg.intention_level] = cfg.interval_days;
    });
    
    // 恢复数据库 need_followup 字段排序
    const { count, rows } = await CustomerLead.findAndCountAll({
      where,
      offset: Number(offset),
      limit: Number(page_size),
      order: [
        ['need_followup', 'DESC'],
        ['lead_time', 'DESC']
      ],
      include: [
        {
          model: User,
          as: 'currentFollowerUser',
          attributes: ['id', 'nickname', 'username']
        }
      ],
      attributes: [
        'id',
        'customer_nickname',
        'source_platform',
        'source_account',
        'contact_account',
        'contact_name',
        'lead_time',
        'is_contacted',
        'intention_level',
        'follow_up_person',
        'is_deal',
        'deal_date',
        'created_at',
        'updated_at',
        'need_followup',
        'end_followup',
        'end_followup_reason',
        'current_follower'
      ]
    });

    // 批量查询最新跟进记录，避免 N+1 查询
    const leadIds = rows.map(lead => lead.id);
    const latestFollowUps = await FollowUpRecord.findAll({
      attributes: [
        'lead_id',
        'follow_up_time',
        'follow_up_content',
        'follow_up_person_id'
      ],
      where: {
        lead_id: { [Op.in]: leadIds }
      },
      include: [{
        model: User,
        as: 'followUpPerson',
        attributes: ['id', 'nickname']
      }],
      order: [['follow_up_time', 'DESC']],
      // 移除 group: ['lead_id']，改用子查询方式
      raw: true,
      nest: true
    });

    // 构建跟进记录映射，手动取每个线索的最新记录
    const followUpMap = {};
    latestFollowUps.forEach(followUp => {
      // 如果该线索还没有记录，或者当前记录更新，则更新映射
      if (!followUpMap[followUp.lead_id] || 
          new Date(followUp.follow_up_time) > new Date(followUpMap[followUp.lead_id].follow_up_time)) {
        followUpMap[followUp.lead_id] = followUp;
      }
    });

    // 直接返回数据库 need_followup 字段
    const processedRows = rows.map(lead => {
      const leadData = lead.toJSON();
      const latestFollowUp = followUpMap[leadData.id];
      return {
        ...leadData,
        current_follower: leadData.currentFollowerUser
          ? {
              id: leadData.currentFollowerUser.id,
              nickname: leadData.currentFollowerUser.nickname,
              username: leadData.currentFollowerUser.username
            }
          : null,
        latest_follow_up: latestFollowUp ? {
          follow_up_time: latestFollowUp.follow_up_time,
          follow_up_content: latestFollowUp.follow_up_content
        } : null,
        currentFollowerUser: undefined
      };
    });
    
    const dbEndTime = Date.now();
    
    const totalTime = Date.now() - startTime;
    const dbTime = dbEndTime - dbStartTime;
    
    console.log(`获取线索列表完成 - 总耗时: ${totalTime}ms, 数据库操作耗时: ${dbTime}ms`);
    
    res.json({ 
      success: true, 
      total: count,
      list: processedRows,
      performance: {
        totalTime: `${totalTime}ms`,
        dbTime: `${dbTime}ms`
      }
    });
  } catch (err) {
    const totalTime = Date.now() - startTime;
    console.error(`获取线索列表出错 - 总耗时: ${totalTime}ms`, err);
    res.status(500).json({ 
      success: false, 
      message: err.message,
      performance: {
        totalTime: `${totalTime}ms`
      }
    });
  }
};

// 获取线索详情（同理动态判断need_followup）
exports.getLeadDetail = async (req, res) => {
  const startTime = Date.now();
  try {
    const id = req.params.id;
    
    // 参数验证
    if (!id || isNaN(Number(id))) {
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
    
    // 查询意向等级对应的最大未跟进天数配置
    const remindConfigs = await FollowupRemindConfig.findAll({ raw: true });
    const configMap = {};
    remindConfigs.forEach(cfg => {
      configMap[cfg.intention_level] = cfg.interval_days;
    });
    
    // 使用关联查询获取线索及其最新跟进记录
    const lead = await CustomerLead.findByPk(id, {
      include: [
        {
          model: FollowUpRecord,
          as: 'followUps',
          attributes: ['follow_up_time', 'follow_up_content', 'follow_up_person_id'],
          separate: true,
          order: [['follow_up_time', 'DESC']],
          limit: 1,
          include: [{
            model: User,
            as: 'followUpPerson',
            attributes: ['id', 'nickname']
          }]
        }
      ],
      attributes: [
        'id',
        'customer_nickname',
        'source_platform',
        'source_account',
        'contact_account',
        'contact_name',
        'lead_time',
        'is_contacted',
        'intention_level',
        'follow_up_person',
        'is_deal',
        'deal_date',
        'created_at',
        'updated_at',
        'need_followup',
        'end_followup',
        'end_followup_reason',
        'current_follower'
      ]
    });
    
    const dbEndTime = Date.now();
    
    const totalTime = Date.now() - startTime;
    const dbTime = dbEndTime - dbStartTime;
    
    if (!lead) {
      return res.status(404).json({ 
        success: false, 
        message: '未找到该线索',
        performance: {
          totalTime: `${totalTime}ms`,
          dbTime: `${dbTime}ms`
        }
      });
    }
    
    // 新增：权限控制检查
    const userRole = req.user.role;
    const userId = req.user.id;
    const leadData = lead.toJSON();
    
    console.log(`线索详情权限检查 - 角色: ${userRole}, 用户ID: ${userId}, 线索ID: ${id}`);
    
    let hasPermission = false;
    
    if (userRole === 'admin') {
      // 管理员可以查看所有线索
      hasPermission = true;
      console.log('权限检查: 管理员用户，允许访问');
    } else if (userRole === 'service') {
      // 客服只能查看自己登记的线索
      hasPermission = leadData.follow_up_person === userId.toString();
      console.log(`权限检查: 客服用户，登记人: ${leadData.follow_up_person}, 当前用户: ${userId}, 权限: ${hasPermission}`);
    } else if (userRole === 'sales') {
      // 销售只能查看分配给自己的线索
      hasPermission = leadData.current_follower === userId;
      console.log(`权限检查: 销售用户，跟进人: ${leadData.current_follower}, 当前用户: ${userId}, 权限: ${hasPermission}`);
    } else {
      // 其他角色默认只能查看自己登记的线索
      hasPermission = leadData.follow_up_person === userId.toString();
      console.log(`权限检查: 其他角色用户，登记人: ${leadData.follow_up_person}, 当前用户: ${userId}, 权限: ${hasPermission}`);
    }
    
    if (!hasPermission) {
      return res.status(403).json({ 
        success: false, 
        message: '您没有权限查看该线索',
        performance: {
          totalTime: `${totalTime}ms`,
          dbTime: `${dbTime}ms`
        }
      });
    }
    
    // 处理返回数据，动态判断need_followup
    const now = dayjs();
    const latestFollowUp = leadData.followUps && leadData.followUps.length > 0
      ? leadData.followUps[0]
      : null;
    const lastTime = latestFollowUp ? dayjs(latestFollowUp.follow_up_time) : dayjs(leadData.lead_time);
    const interval = configMap[leadData.intention_level] || 3;
    const overdue = now.diff(lastTime, 'day') >= interval;
    const processedData = {
      ...leadData,
      latest_follow_up: latestFollowUp ? {
        follow_up_time: latestFollowUp.follow_up_time,
        follow_up_content: latestFollowUp.follow_up_content
      } : null,
      need_followup: overdue ? 1 : 0,
      end_followup: leadData.end_followup,
      end_followup_reason: leadData.end_followup_reason,
      followUps: undefined
    };
    
    console.log(`获取线索详情完成 - 总耗时: ${totalTime}ms, 数据库操作耗时: ${dbTime}ms`);
    
    res.json({ 
      success: true, 
      data: processedData,
      performance: {
        totalTime: `${totalTime}ms`,
        dbTime: `${dbTime}ms`
      }
    });
  } catch (err) {
    const totalTime = Date.now() - startTime;
    console.error(`获取线索详情出错 - 总耗时: ${totalTime}ms`, err);
    res.status(500).json({ 
      success: false, 
      message: err.message,
      performance: {
        totalTime: `${totalTime}ms`
      }
    });
  }
};

// 编辑线索时禁止前端修改登记人
exports.updateLead = async (req, res) => {
  const startTime = Date.now();
  let transaction;
  
  try {
    const id = req.params.id;
    const data = req.body;
    
    // 参数验证
    if (!id || isNaN(Number(id))) {
      const totalTime = Date.now() - startTime;
      return res.status(400).json({
        success: false,
        message: '无效的线索ID',
        performance: {
          totalTime: `${totalTime}ms`
        }
      });
    }
    
    // 禁止前端修改登记人
    if ('follow_up_person' in data) {
      delete data.follow_up_person;
    }
    
    // 禁止修改跟进人，保持原有的分配关系
    if ('current_follower' in data) {
      delete data.current_follower;
    }

    // 验证更新数据
    if (data.intention_level && !['高', '中', '低'].includes(data.intention_level)) {
      const totalTime = Date.now() - startTime;
      return res.status(400).json({
        success: false,
        message: '意向等级必须是: 高、中、低',
        performance: {
          totalTime: `${totalTime}ms`
        }
      });
    }
    
    // 初始化事务
    transaction = await CustomerLead.sequelize.transaction();
    
    const dbStartTime = Date.now();
    
    // 新增：权限控制检查
    const userRole = req.user.role;
    const userId = req.user.id;
    
    console.log(`编辑线索权限检查 - 角色: ${userRole}, 用户ID: ${userId}, 线索ID: ${id}`);
    
    // 先查询线索信息进行权限检查
    const existingLead = await CustomerLead.findByPk(id, { transaction });
    if (!existingLead) {
      await transaction.rollback();
      const totalTime = Date.now() - startTime;
      return res.status(404).json({ 
        success: false, 
        message: '未找到该线索',
        performance: {
          totalTime: `${totalTime}ms`
        }
      });
    }
    
    const leadData = existingLead.toJSON();
    let hasPermission = false;
    
    if (userRole === 'admin') {
      // 管理员可以编辑所有线索
      hasPermission = true;
      console.log('权限检查: 管理员用户，允许编辑');
    } else if (userRole === 'service') {
      // 客服只能编辑自己登记的线索
      hasPermission = leadData.follow_up_person === userId.toString();
      console.log(`权限检查: 客服用户，登记人: ${leadData.follow_up_person}, 当前用户: ${userId}, 权限: ${hasPermission}`);
    } else if (userRole === 'sales') {
      // 销售只能编辑分配给自己的线索
      hasPermission = leadData.current_follower === userId;
      console.log(`权限检查: 销售用户，跟进人: ${leadData.current_follower}, 当前用户: ${userId}, 权限: ${hasPermission}`);
    } else {
      // 其他角色默认只能编辑自己登记的线索
      hasPermission = leadData.follow_up_person === userId.toString();
      console.log(`权限检查: 其他角色用户，登记人: ${leadData.follow_up_person}, 当前用户: ${userId}, 权限: ${hasPermission}`);
    }
    
    if (!hasPermission) {
      await transaction.rollback();
      const totalTime = Date.now() - startTime;
      return res.status(403).json({ 
        success: false, 
        message: '您没有权限编辑该线索',
        performance: {
          totalTime: `${totalTime}ms`
        }
      });
    }
    
    // 1. 更新线索记录
    // 新增：如果请求包含end_followup=1，则自动将need_followup设为0
    if (data.end_followup === 1) {
      data.need_followup = 0;
      if (!data.end_followup_reason || data.end_followup_reason.trim() === '') {
        await transaction.rollback();
        const totalTime = Date.now() - startTime;
        return res.status(400).json({
          success: false,
          message: '终结跟进时必须填写终结原因',
          performance: {
            totalTime: `${totalTime}ms`
          }
        });
      }
    }
    const [updated] = await CustomerLead.update(data, { 
      where: { id },
      transaction 
    });
    
    // 2. 检查是否需要创建跟进记录
    let followUp = null;
    const shouldCreateFollowUp = data.create_follow_up === true; // 只有明确设置为true才创建
    
    if (shouldCreateFollowUp) {
      // 验证跟进内容
      if (!data.follow_up_content || data.follow_up_content.trim() === '') {
        await transaction.rollback();
        const totalTime = Date.now() - startTime;
        return res.status(400).json({
          success: false,
          message: '创建跟进记录时，跟进内容不能为空',
          performance: {
            totalTime: `${totalTime}ms`
          }
        });
      }
      
      // 获取当前时间字符串，格式：yyyy-MM-dd HH:mm:ss
      const now = new Date();
      const currentTimeStr = now.getFullYear() + '-' + 
        String(now.getMonth() + 1).padStart(2, '0') + '-' + 
        String(now.getDate()).padStart(2, '0') + ' ' + 
        String(now.getHours()).padStart(2, '0') + ':' + 
        String(now.getMinutes()).padStart(2, '0') + ':' + 
        String(now.getSeconds()).padStart(2, '0');
      
      const followUpData = {
        lead_id: id,
        follow_up_time: data.follow_up_time || currentTimeStr, // 使用指定时间或当前时间字符串
        follow_up_method: data.follow_up_method || '编辑跟进', // 跟进方式
        follow_up_content: data.follow_up_content, // 跟进内容
        follow_up_result: data.follow_up_result || '待跟进', // 跟进结果
        follow_up_person_id: req.user.id // 自动填充为当前登录用户ID
      };
      
      followUp = await FollowUpRecord.create(followUpData, { transaction });
      // 新增：自动更新 need_followup 字段（事务内）
      await updateNeedFollowupByLeadId(id, transaction);
    }
    
    // 提交事务
    await transaction.commit();
    
    const dbEndTime = Date.now();
    
    const totalTime = Date.now() - startTime;
    const dbTime = dbEndTime - dbStartTime;
    
    if (!updated) {
      return res.status(404).json({ 
        success: false, 
        message: '未找到该线索',
        performance: {
          totalTime: `${totalTime}ms`,
          dbTime: `${dbTime}ms`
        }
      });
    }
    
    console.log(`编辑线索完成 - 总耗时: ${totalTime}ms, 数据库操作耗时: ${dbTime}ms`);
    console.log(`更新线索ID: ${id}${followUp ? `, 创建跟进记录ID: ${followUp.id}` : ', 未创建跟进记录'}`);
    res.json({ 
      success: true,
      updatedLead: true,
      followUpId: followUp ? followUp.id : null,
      createdFollowUp: !!followUp,
      performance: {
        totalTime: `${totalTime}ms`,
        dbTime: `${dbTime}ms`
      }
    });
  } catch (err) {
    // 回滚事务（如果事务已创建）
    if (transaction) {
      await transaction.rollback();
    }
    
    const totalTime = Date.now() - startTime;
    console.error(`编辑线索出错 - 总耗时: ${totalTime}ms`, err);
    
    // 区分不同类型的错误
    let statusCode = 500;
    let errorMessage = err.message;
    
    if (err.name === 'SequelizeValidationError') {
      statusCode = 400;
      errorMessage = '数据验证失败: ' + err.message;
    } else if (err.name === 'SequelizeUniqueConstraintError') {
      statusCode = 400;
      errorMessage = '数据已存在，请检查输入信息';
    } else if (err.name === 'SequelizeForeignKeyConstraintError') {
      statusCode = 400;
      errorMessage = '关联数据错误，请检查输入信息';
    } else if (err.name === 'SequelizeConnectionError') {
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

exports.deleteLead = async (req, res) => {
  const startTime = Date.now();
  let transaction;
  try {
    const id = req.params.id;
    // 参数验证
    if (!id || isNaN(Number(id))) {
      const totalTime = Date.now() - startTime;
      return res.status(400).json({
        success: false,
        message: '无效的线索ID',
        performance: {
          totalTime: `${totalTime}ms`
        }
      });
    }
    // 初始化事务
    transaction = await CustomerLead.sequelize.transaction();
    
    // 新增：权限控制检查
    const userRole = req.user.role;
    const userId = req.user.id;
    
    console.log(`删除线索权限检查 - 角色: ${userRole}, 用户ID: ${userId}, 线索ID: ${id}`);
    
    // 先查询线索信息进行权限检查
    const existingLead = await CustomerLead.findByPk(id, { transaction });
    if (!existingLead) {
      await transaction.rollback();
      const totalTime = Date.now() - startTime;
      return res.status(404).json({ 
        success: false, 
        message: '未找到该线索',
        performance: {
          totalTime: `${totalTime}ms`
        }
      });
    }
    
    const leadData = existingLead.toJSON();
    let hasPermission = false;
    
    if (userRole === 'admin') {
      // 管理员可以删除所有线索
      hasPermission = true;
      console.log('权限检查: 管理员用户，允许删除');
    } else if (userRole === 'service') {
      // 客服只能删除自己登记的线索
      hasPermission = leadData.follow_up_person === userId.toString();
      console.log(`权限检查: 客服用户，登记人: ${leadData.follow_up_person}, 当前用户: ${userId}, 权限: ${hasPermission}`);
    } else if (userRole === 'sales') {
      // 销售只能删除分配给自己的线索
      hasPermission = leadData.current_follower === userId;
      console.log(`权限检查: 销售用户，跟进人: ${leadData.current_follower}, 当前用户: ${userId}, 权限: ${hasPermission}`);
    } else {
      // 其他角色默认只能删除自己登记的线索
      hasPermission = leadData.follow_up_person === userId.toString();
      console.log(`权限检查: 其他角色用户，登记人: ${leadData.follow_up_person}, 当前用户: ${userId}, 权限: ${hasPermission}`);
    }
    
    if (!hasPermission) {
      await transaction.rollback();
      const totalTime = Date.now() - startTime;
      return res.status(403).json({ 
        success: false, 
        message: '您没有权限删除该线索',
        performance: {
          totalTime: `${totalTime}ms`
        }
      });
    }
    
    const dbStartTime = Date.now();
    // 1. 先删除关联的跟进记录
    const deletedFollowUps = await FollowUpRecord.destroy({
      where: { lead_id: id },
      transaction
    });
    // 2. 再删除线索记录
    const deletedLead = await CustomerLead.destroy({
      where: { id },
      transaction
    });
    // 提交事务
    await transaction.commit();
    const dbEndTime = Date.now();
    const totalTime = Date.now() - startTime;
    const dbTime = dbEndTime - dbStartTime;
    if (!deletedLead) {
      return res.status(404).json({
        success: false,
        message: '未找到该线索',
        performance: {
          totalTime: `${totalTime}ms`,
          dbTime: `${dbTime}ms`
        }
      });
    }
    res.json({
      success: true,
      deletedFollowUps,
      performance: {
        totalTime: `${totalTime}ms`,
        dbTime: `${dbTime}ms`
      }
    });
  } catch (err) {
    if (transaction) {
      await transaction.rollback();
    }
    const totalTime = Date.now() - startTime;
    let statusCode = 500;
    let errorMessage = err.message;
    if (err.name === 'SequelizeForeignKeyConstraintError') {
      statusCode = 400;
      errorMessage = '删除失败，该线索可能被其他数据引用';
    } else if (err.name === 'SequelizeConnectionError') {
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

// 导出客户线索
exports.exportLeads = async (req, res) => {
  const startTime = Date.now();
  
  try {
    const {
      date_from,
      date_to,
      intention_level,
      is_deal,
      is_contacted,
      keyword,
      contact_name,
      customer_nickname
    } = req.query;
    
    // 验证时间区间参数
    if (!date_from || !date_to) {
      const totalTime = Date.now() - startTime;
      return res.status(400).json({
        success: false,
        message: '必须提供时间区间参数 date_from 和 date_to',
        performance: {
          totalTime: `${totalTime}ms`
        }
      });
    }
    
    // 验证时间格式
    const dateFrom = new Date(date_from);
    const dateTo = new Date(date_to);
    if (isNaN(dateFrom.getTime()) || isNaN(dateTo.getTime())) {
      const totalTime = Date.now() - startTime;
      return res.status(400).json({
        success: false,
        message: '时间格式不正确，请使用 YYYY-MM-DD 格式',
        performance: {
          totalTime: `${totalTime}ms`
        }
      });
    }
    
    // 构建查询条件 - 修复时间区间查询，确保包含完整的天数
    const where = {
      lead_time: { 
        [Op.between]: [
          `${date_from} 00:00:00`, 
          `${date_to} 23:59:59`
        ] 
      }
    };
    
    // 添加其他筛选条件
    if (intention_level) where.intention_level = intention_level;
    if (is_deal !== undefined) where.is_deal = is_deal;
    if (is_contacted !== undefined) where.is_contacted = is_contacted;
    
    // 关键词搜索
    const cleanKeyword = typeof keyword === 'string' ? keyword.trim() : '';
    if (cleanKeyword) {
      where[Op.or] = [
        { customer_nickname: { [Op.like]: `%${cleanKeyword}%` } },
        { contact_account: { [Op.like]: `%${cleanKeyword}%` } },
        { source_account: { [Op.like]: `%${cleanKeyword}%` } },
        { 
          contact_name: { 
            [Op.and]: [
              { [Op.ne]: null },
              { [Op.like]: `%${cleanKeyword}%` }
            ]
          } 
        }
      ];
    }
    
    // 客户昵称模糊检索
    if (customer_nickname) {
      where.customer_nickname = { [Op.like]: `%${customer_nickname}%` };
    }
    
    // 联系名称模糊检索
    if (contact_name) {
      const cleanContactName = contact_name.trim();
      if (cleanContactName) {
        where.contact_name = { 
          [Op.and]: [
            { [Op.ne]: null },
            { [Op.like]: `%${cleanContactName}%` }
          ]
        };
      }
    }
    
    // 基于角色的权限控制
    const userRole = req.user.role;
    const userId = req.user.id;
    
    console.log(`导出权限控制 - 角色: ${userRole}, 用户ID: ${userId}`);
    
    if (userRole === 'service') {
      // 客服只能导出自己登记的线索
      where.follow_up_person = userId.toString();
      console.log('权限控制: 客服用户，只能导出自己登记的线索');
    } else if (userRole === 'sales') {
      // 销售只能导出分配给自己的线索
      where.current_follower = userId;
      console.log('权限控制: 销售用户，只能导出分配给自己的线索');
    } else if (userRole === 'admin') {
      // 管理员可以导出所有线索
      console.log('权限控制: 管理员用户，可以导出所有线索');
    } else {
      // 其他角色默认只能导出自己登记的线索
      where.follow_up_person = userId.toString();
      console.log('权限控制: 其他角色用户，只能导出自己登记的线索');
    }
    
    const dbStartTime = Date.now();
    
    // 查询所有符合条件的线索（不分页）
    const leads = await CustomerLead.findAll({
      where,
      order: [['lead_time', 'DESC']],
      include: [
        {
          model: User,
          as: 'currentFollowerUser',
          attributes: ['id', 'nickname', 'username']
        }
      ],
      attributes: [
        'id',
        'customer_nickname',
        'source_platform',
        'source_account',
        'contact_account',
        'contact_name',
        'lead_time',
        'is_contacted',
        'intention_level',
        'follow_up_person',
        'is_deal',
        'deal_date',
        'created_at',
        'updated_at',
        'need_followup',
        'end_followup',
        'end_followup_reason',
        'current_follower'
      ]
    });

    // 批量查询最新跟进记录
    const leadIds = leads.map(lead => lead.id);
    const latestFollowUps = await FollowUpRecord.findAll({
      attributes: [
        'lead_id',
        'follow_up_time',
        'follow_up_content',
        'follow_up_method',
        'follow_up_result',
        'follow_up_person_id'
      ],
      where: {
        lead_id: { [Op.in]: leadIds }
      },
      include: [{
        model: User,
        as: 'followUpPerson',
        attributes: ['id', 'nickname']
      }],
      order: [['follow_up_time', 'DESC']],
      raw: true,
      nest: true
    });

    // 构建跟进记录映射，取每个线索的最新记录
    const followUpMap = {};
    latestFollowUps.forEach(followUp => {
      if (!followUpMap[followUp.lead_id] || 
          new Date(followUp.follow_up_time) > new Date(followUpMap[followUp.lead_id].follow_up_time)) {
        followUpMap[followUp.lead_id] = followUp;
      }
    });

    // 处理数据，添加最新跟进信息
    const exportData = leads.map(lead => {
      const leadData = lead.toJSON();
      const latestFollowUp = followUpMap[leadData.id];
      
      return {
        // 基本信息
        id: leadData.id,
        customer_nickname: leadData.customer_nickname,
        source_platform: leadData.source_platform,
        source_account: leadData.source_account,
        contact_account: leadData.contact_account,
        contact_name: leadData.contact_name,
        lead_time: leadData.lead_time,
        is_contacted: leadData.is_contacted === 1 ? '是' : '否',
        intention_level: leadData.intention_level,
        follow_up_person: leadData.follow_up_person,
        is_deal: leadData.is_deal === 1 ? '是' : '否',
        deal_date: leadData.deal_date,
        created_at: leadData.created_at,
        updated_at: leadData.updated_at,
        
        // 跟进状态
        need_followup: leadData.need_followup === 1 ? '是' : '否',
        end_followup: leadData.end_followup === 1 ? '是' : '否',
        end_followup_reason: leadData.end_followup_reason,
        
        // 当前跟进人
        current_follower: leadData.currentFollowerUser ? leadData.currentFollowerUser.nickname : null,
        current_follower_username: leadData.currentFollowerUser ? leadData.currentFollowerUser.username : null,
        
        // 最新跟进情况
        latest_follow_up_time: latestFollowUp ? latestFollowUp.follow_up_time : null,
        latest_follow_up_content: latestFollowUp ? latestFollowUp.follow_up_content : null,
        latest_follow_up_method: latestFollowUp ? latestFollowUp.follow_up_method : null,
        latest_follow_up_result: latestFollowUp ? latestFollowUp.follow_up_result : null,
        latest_follow_up_person: latestFollowUp && latestFollowUp.followUpPerson ? latestFollowUp.followUpPerson.nickname : null
      };
    });
    
    const dbEndTime = Date.now();
    const totalTime = Date.now() - startTime;
    const dbTime = dbEndTime - dbStartTime;
    
    console.log(`导出客户线索完成 - 总耗时: ${totalTime}ms, 数据库操作耗时: ${dbTime}ms, 导出数量: ${exportData.length}`);
    
    res.json({ 
      success: true, 
      data: exportData,
      total: exportData.length,
      date_range: {
        from: date_from,
        to: date_to
      },
      performance: {
        totalTime: `${totalTime}ms`,
        dbTime: `${dbTime}ms`
      }
    });
    
  } catch (error) {
    console.error('导出客户线索失败:', error);
    const totalTime = Date.now() - startTime;
    res.status(500).json({
      success: false,
      message: '导出失败',
      error: error.message,
      performance: {
        totalTime: `${totalTime}ms`
      }
    });
  }
};