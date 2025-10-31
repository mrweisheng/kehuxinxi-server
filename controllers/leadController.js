const CustomerLead = require('../models/leadModel');
const FollowUpRecord = require('../models/followupModel');
const FollowupRemindConfig = require('../models/followupRemindConfig');
const { Op } = require('sequelize');
const sequelize = require('../config/db');
const dayjs = require('dayjs');
const { updateNeedFollowupByLeadId } = require('../services/followupRemindChecker');
const User = require('../models/user');
const { getTodayFollowUpStats } = require('../utils/todayFollowUpStats');
const { getFollowupConfigs } = require('../utils/configCache');

// 标准化客户名称用于去重比较
function normalizeForDedup(name) {
  if (!name || typeof name !== 'string') {
    return '';
  }
  
  return name
    .replace(/\s+/g, '')           // 去除所有空格
    .replace(/[（）()]/g, '()');    // 统一所有括号为半角括号，兼容中英文括号
}

// 计算字符串相似度（使用编辑距离算法）
function calculateStringSimilarity(str1, str2) {
  if (str1 === str2) return 1.0;
  if (!str1 || !str2) return 0.0;
  
  const len1 = str1.length;
  const len2 = str2.length;
  const maxLen = Math.max(len1, len2);
  
  if (maxLen === 0) return 1.0;
  
  // 计算编辑距离
  const dp = Array(len1 + 1).fill(null).map(() => Array(len2 + 1).fill(0));
  
  for (let i = 0; i <= len1; i++) dp[i][0] = i;
  for (let j = 0; j <= len2; j++) dp[0][j] = j;
  
  for (let i = 1; i <= len1; i++) {
    for (let j = 1; j <= len2; j++) {
      if (str1[i - 1] === str2[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = Math.min(
          dp[i - 1][j] + 1,     // 删除
          dp[i][j - 1] + 1,     // 插入
          dp[i - 1][j - 1] + 1  // 替换
        );
      }
    }
  }
  
  const editDistance = dp[len1][len2];
  return (maxLen - editDistance) / maxLen;
}

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
    
    console.log('线索录入请求详情:', {
      isBatchMode: isBatchMode,
      userRole: req.user.role,
      userId: req.user.id,
      current_follower: data.current_follower,
      headers: req.headers
    });
    
    if (isBatchMode) {
      // 批量登记模式：登记人为当前登录用户（OCR等批量操作）
      registrantId = req.user.id;
      console.log('批量登记模式：登记人ID设置为当前用户', registrantId);
      
      // 角色权限检查（批量模式也需要权限验证）
      if (!req.user || !['admin', 'sales', 'service'].includes(req.user.role)) {
        await transaction.rollback();
        const totalTime = Date.now() - startTime;
        return res.status(403).json({
          success: false,
          message: '您没有权限进行批量录入',
          performance: {
            totalTime: `${totalTime}ms`
          }
        });
      }
    } else {
      // 正常模式：登记人为当前登录用户
      registrantId = req.user.id;
      console.log('正常模式：登记人ID设置为', registrantId);
      
      // 新增：角色权限检查
      if (!req.user || !['admin', 'sales', 'service'].includes(req.user.role)) {
        await transaction.rollback();
        const totalTime = Date.now() - startTime;
        return res.status(403).json({
          success: false,
          message: '您没有权限录入线索',
          performance: {
            totalTime: `${totalTime}ms`
          }
        });
      }
      
      // 新增：销售角色特殊处理
      if (req.user.role === 'sales') {
        // 销售角色：强制将跟进人设置为自己，忽略前端传入的值
        data.current_follower = parseInt(req.user.id);
        console.log(`销售角色录入，跟进人强制设置为自己: ${req.user.id}`);
      }
    }
    
    // 先自动填充登记人和分配的跟进人
    data.creator_user_id = parseInt(registrantId);
    data.assigned_user_id = parseInt(data.current_follower); // 确保类型转换为整数
    
    // 自动填充follow_up_person字段（跟进人昵称，用于显示）【支持用户缓存优化】
    if (!data.follow_up_person) {
      // 获取跟进人的昵称（跟进人ID = current_follower）
      try {
        const followerUserId = data.current_follower;
        
        // 【优化】检查是否有用户缓存
        let userCache = null;
        try {
          if (req.headers['x-user-cache']) {
            userCache = JSON.parse(req.headers['x-user-cache']);
          }
        } catch (e) {
          // 忽略缓存解析错误
        }
        
        // 优先使用缓存，缓存不存在时查询数据库
        if (userCache && userCache[followerUserId]) {
          console.log(`[LEAD-CREATE] 使用用户缓存 - 用户ID: ${followerUserId}`);
          data.follow_up_person = userCache[followerUserId].nickname;
        } else {
          console.log(`[LEAD-CREATE] 查询用户信息 - 用户ID: ${followerUserId}`);
          const User = require('../models/user');
          const followerUser = await User.findByPk(followerUserId, { 
            attributes: ['nickname', 'username'],
            transaction 
          });
          if (followerUser) {
            data.follow_up_person = followerUser.nickname || followerUser.username || `用户${followerUserId}`;
          } else {
            data.follow_up_person = `用户${followerUserId}`;
          }
        }
      } catch (error) {
        console.error('获取跟进人信息失败:', error);
        data.follow_up_person = `用户${data.current_follower}`;
      }
    }
    
    console.log('字段自动填充结果:', {
      creator_user_id: data.creator_user_id,
      assigned_user_id: data.assigned_user_id,
      current_follower: data.current_follower,
      follow_up_person: data.follow_up_person
    });
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
    
    // 确保 current_follower 是数字类型
    data.current_follower = parseInt(data.current_follower);

    // 处理 deal_date 字段
    if (data.deal_date === '') {
      data.deal_date = null;
    }
    
    // 调试：打印传递给Sequelize的数据
    console.log('传递给Sequelize的数据:', JSON.stringify(data, null, 2));
    
    // 记录数据库操作开始时间
    const dbStartTime = Date.now();
    
    // 去重检查：精确匹配 + 标准化匹配【支持批量处理优化跳过】
    if (data.contact_name && !req.headers['x-skip-duplicate-check']) {
      const contactName = data.contact_name.trim();
      const normalizedContactName = normalizeForDedup(contactName);
      
      // 详细的去重日志记录
      console.log(`[去重检查] 开始检查客户名称: "${contactName}"`);
      console.log(`[去重检查] 标准化后: "${normalizedContactName}"`);
      console.log(`[去重检查] 字符长度: ${contactName.length}, 标准化长度: ${normalizedContactName.length}`);
      
      // 多级去重检查：先精确匹配，再标准化匹配
      let existingLead = await CustomerLead.findOne({
        where: {
          contact_name: contactName  // 精确匹配（优先）
        },
        transaction
      });
      
      // 如果精确匹配没找到，尝试标准化匹配
      if (!existingLead) {
        // 查找所有可能相似的记录（基于日期前缀）
        const possibleDuplicates = await CustomerLead.findAll({
          where: {
            contact_name: {
              [Op.like]: `${contactName.substring(0, 4)}%`  // 使用日期前缀查找
            }
          },
          transaction,
          limit: 20  // 限制查询结果
        });
        
        // 在内存中进行标准化比较
        for (const lead of possibleDuplicates) {
          if (normalizeForDedup(lead.contact_name) === normalizedContactName) {
            existingLead = lead;
            break;
          }
        }
      }
      
      if (existingLead) {
        await transaction.rollback();
        const totalTime = Date.now() - startTime;
        const matchType = existingLead.contact_name === contactName ? '精确匹配' : '标准化匹配';
        console.log(`[去重检查] 发现重复记录 (${matchType}) - 新客户: "${contactName}", 已存在ID: ${existingLead.id}, 已存在名称: "${existingLead.contact_name}"`);
        console.log(`[去重检查] 标准化对比: 新记录="${normalizedContactName}", 已存在="${normalizeForDedup(existingLead.contact_name)}"`);
        return res.json({
          success: true,
          duplicate: true,
          message: `联系名称 ${contactName} 已存在(${matchType})，跳过创建`,
          existingId: existingLead.id,
          matchType: matchType,
          performance: {
            totalTime: `${totalTime}ms`
          }
        });
      } else {
        // console.log(`[去重检查] 精确匹配未发现重复，进行模糊匹配检查...`);
        
        // 模糊匹配去重检查（辅助手段）- 临时禁用，避免日志过多
        /*
        const similarLeads = await CustomerLead.findAll({
          where: {
            contact_name: {
              [Op.like]: `%${contactName.substring(0, 4)}%` // 使用前4个字符（日期部分）进行模糊匹配
            }
          },
          transaction,
          limit: 10 // 限制查询结果数量
        });
        
        if (similarLeads.length > 0) {
          console.log(`[模糊匹配] 找到 ${similarLeads.length} 个相似记录:`);
          
          for (const similarLead of similarLeads) {
            const similarity = calculateStringSimilarity(contactName, similarLead.contact_name);
            console.log(`[模糊匹配] ID: ${similarLead.id}, 名称: "${similarLead.contact_name}", 相似度: ${(similarity * 100).toFixed(2)}%`);
            
            // 如果相似度很高（95%以上），给出警告但不阻止创建
            if (similarity > 0.95) {
              console.log(`[模糊匹配] 警告：发现高相似度记录 (${(similarity * 100).toFixed(2)}%)，可能是繁简体差异导致的重复`);
              console.log(`[模糊匹配] 新记录: "${contactName}" vs 已存在: "${similarLead.contact_name}"`);
            }
          }
        }
        */
        
        console.log(`[去重检查] 允许创建新记录: "${contactName}"`);
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
        follow_up_person_id: data.current_follower // 使用跟进人用户ID，不是昵称
      };
      
      console.log('创建跟进记录数据:', {
        followUpData: followUpData,
        current_follower: data.current_follower,
        follow_up_person: data.follow_up_person
      });
      
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
      customer_nickname,
      enable_followup,
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
    if (enable_followup !== undefined) where.enable_followup = parseInt(enable_followup);
    if (customer_nickname) where.customer_nickname = { [Op.like]: `%${customer_nickname}%` };
    if (date_from && date_to) {
      where.lead_time = {
        [Op.between]: [
          `${date_from} 00:00:00`,
          `${date_to} 23:59:59`
        ]
      };
    } else if (date_from) {
      // 单个日期查询，查询该日期的数据
      where.lead_time = {
        [Op.between]: [
          `${date_from} 00:00:00`,
          `${date_from} 23:59:59`
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
      where.creator_user_id = userId;
      console.log('权限控制: 客服用户，只能查看自己登记的线索');
    } else if (userRole === 'sales') {
      // 销售只能查看分配给自己的线索
      where.assigned_user_id = userId;
      console.log('权限控制: 销售用户，只能查看分配给自己的线索');
    } else if (userRole === 'admin') {
      // 管理员可以查看所有线索
      console.log('权限控制: 管理员用户，可以查看所有线索');
    } else {
      // 其他角色默认只能查看自己登记的线索
      where.creator_user_id = userId;
      console.log('权限控制: 其他角色用户，只能查看自己登记的线索');
    }
    
    const offset = (page - 1) * page_size;
    const dbStartTime = Date.now();
    
    // 查询意向等级对应的最大未跟进天数配置（使用缓存）
    const configMap = await getFollowupConfigs();
    
    // 修改排序：优先显示启用跟进且当前周期未完成的线索，然后按进线索时间排序
    const { count, rows } = await CustomerLead.findAndCountAll({
      where,
      offset: Number(offset),
      limit: Number(page_size),
      order: [
        // 优先级：启用跟进且未完成 > 其他情况
        [sequelize.literal('CASE WHEN enable_followup = 1 AND current_cycle_completed = 0 THEN 0 ELSE 1 END'), 'ASC'],
        ['lead_time', 'DESC']
      ],
      include: [
        {
          model: User,
          as: 'currentFollowerUser',
          attributes: ['id', 'nickname', 'username']
        },
        {
          model: User,
          as: 'creatorUser',
          attributes: ['id', 'nickname', 'username']
        },
        {
          model: User,
          as: 'assignedUser',
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
        'current_follower',
        'enable_followup',
        'current_cycle_completed'
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
    const finalFollowUpMap = {};
    latestFollowUps.forEach(followUp => {
      // 如果该线索还没有记录，或者当前记录更新，则更新映射
      if (!finalFollowUpMap[followUp.lead_id] || 
          new Date(followUp.follow_up_time) > new Date(finalFollowUpMap[followUp.lead_id].follow_up_time)) {
        finalFollowUpMap[followUp.lead_id] = followUp;
      }
    });

    // 直接返回数据库 need_followup 字段
    const processedRows = rows.map(lead => {
      const leadData = lead.toJSON();
      const latestFollowUp = finalFollowUpMap[leadData.id];
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
    
    // 查询意向等级对应的最大未跟进天数配置（使用缓存）
    const configMap = await getFollowupConfigs();
    
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
        'current_follower',
        'enable_followup',
        'creator_user_id',
        'assigned_user_id'
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
    
    // 权限控制检查
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
      hasPermission = leadData.creator_user_id === userId;
      console.log(`权限检查: 客服用户，登记人: ${leadData.creator_user_id}, 当前用户: ${userId}, 权限: ${hasPermission}`);
    } else if (userRole === 'sales') {
      // 销售只能查看分配给自己的线索
      hasPermission = leadData.assigned_user_id === userId;
      console.log(`权限检查: 销售用户，跟进人: ${leadData.assigned_user_id}, 当前用户: ${userId}, 权限: ${hasPermission}`);
    } else {
      // 其他角色默认只能查看自己登记的线索
      hasPermission = leadData.creator_user_id === userId;
      console.log(`权限检查: 其他角色用户，登记人: ${leadData.creator_user_id}, 当前用户: ${userId}, 权限: ${hasPermission}`);
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
    // 🔧 修复：只计算整天数，忽略时分秒
    const lastTime = latestFollowUp ? dayjs(latestFollowUp.follow_up_time).startOf('day') : dayjs(leadData.lead_time).startOf('day');
    const currentTime = now.startOf('day');
    const interval = configMap[leadData.intention_level] || 3;
    const diffDays = currentTime.diff(lastTime, 'day');
    const overdue = diffDays >= interval;
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
      hasPermission = leadData.creator_user_id === userId;
      console.log(`权限检查: 客服用户，登记人: ${leadData.creator_user_id}, 当前用户: ${userId}, 权限: ${hasPermission}`);
    } else if (userRole === 'sales') {
      // 销售只能编辑分配给自己的线索
      hasPermission = leadData.assigned_user_id === userId;
      console.log(`权限检查: 销售用户，跟进人: ${leadData.assigned_user_id}, 当前用户: ${userId}, 权限: ${hasPermission}`);
    } else {
      // 其他角色默认只能编辑自己登记的线索
      hasPermission = leadData.creator_user_id === userId;
      console.log(`权限检查: 其他角色用户，登记人: ${leadData.creator_user_id}, 当前用户: ${userId}, 权限: ${hasPermission}`);
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
      hasPermission = leadData.creator_user_id === userId;
      console.log(`权限检查: 客服用户，登记人: ${leadData.creator_user_id}, 当前用户: ${userId}, 权限: ${hasPermission}`);
    } else if (userRole === 'sales') {
      // 销售只能删除分配给自己的线索
      hasPermission = leadData.assigned_user_id === userId;
      console.log(`权限检查: 销售用户，跟进人: ${leadData.assigned_user_id}, 当前用户: ${userId}, 权限: ${hasPermission}`);
    } else {
      // 其他角色默认只能删除自己登记的线索
      hasPermission = leadData.creator_user_id === userId;
      console.log(`权限检查: 其他角色用户，登记人: ${leadData.creator_user_id}, 当前用户: ${userId}, 权限: ${hasPermission}`);
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
      where.creator_user_id = userId;
      console.log('权限控制: 客服用户，只能导出自己登记的线索');
    } else if (userRole === 'sales') {
      // 销售只能导出分配给自己的线索
      where.assigned_user_id = userId;
      console.log('权限控制: 销售用户，只能导出分配给自己的线索');
    } else if (userRole === 'admin') {
      // 管理员可以导出所有线索
      console.log('权限控制: 管理员用户，可以导出所有线索');
    } else {
      // 其他角色默认只能导出自己登记的线索
      where.creator_user_id = userId;
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
        },
        {
          model: User,
          as: 'creatorUser',
          attributes: ['id', 'nickname', 'username']
        },
        {
          model: User,
          as: 'assignedUser',
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
        'current_follower',
        'enable_followup',
        'current_cycle_completed'
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
    const finalFollowUpMap = {};
    latestFollowUps.forEach(followUp => {
      if (!finalFollowUpMap[followUp.lead_id] || 
          new Date(followUp.follow_up_time) > new Date(finalFollowUpMap[followUp.lead_id].follow_up_time)) {
        finalFollowUpMap[followUp.lead_id] = followUp;
      }
    });

    // 处理数据，添加最新跟进信息
    const exportData = leads.map(lead => {
      const leadData = lead.toJSON();
      const latestFollowUp = finalFollowUpMap[leadData.id];
      
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

// 获取重点客户列表（今日需要跟进的线索）
exports.getKeyCustomers = async (req, res) => {
  const startTime = Date.now();
  try {
    const { page = 1, page_size = 20, intention_level, status_type } = req.query;
    const userRole = req.user.role;
    const userId = req.user.id;

    console.log(`获取重点客户列表 - 角色: ${userRole}, 用户ID: ${userId}`);

    const dbStartTime = Date.now();

    // 构建基础查询条件：已启用跟进且未终结的线索
    const where = {
      enable_followup: 1,
      end_followup: 0
      // 移除 current_cycle_completed 限制，显示所有已启用跟进的线索
    };

    // 权限控制
    if (userRole !== 'admin') {
      // 非管理员只能查看自己跟进的线索（重点客户页面主要给销售看今日跟进）
      where.current_follower = userId;
      console.log('权限控制: 非管理员用户，只能查看自己跟进的线索');
    }

    // 添加意向等级筛选
    if (intention_level) {
      where.intention_level = intention_level;
    }

    // 获取今日跟进统计信息
    const stats = await getTodayFollowUpStats(userId, userRole);

    // 直接获取所有已启用跟进的线索（分页查询）
    const offset = (page - 1) * page_size;
    const { count, rows: finalLeads } = await CustomerLead.findAndCountAll({
      where: where,
      include: [
        {
          model: User,
          as: 'currentFollowerUser',
          attributes: ['id', 'nickname']
        },
        {
          model: User,
          as: 'creatorUser',
          attributes: ['id', 'nickname']
        }
      ],
      order: [['lead_time', 'DESC']],
      limit: parseInt(page_size),
      offset: offset
    });

    const totalCount = count;

    // 获取最终线索ID用于批量查询跟进记录
    const finalLeadIds = finalLeads.map(lead => lead.id);

    // 优化：使用子查询批量获取每个线索的最新跟进记录
    let finalLatestFollowUps = [];
    
    if (finalLeadIds.length > 0) {
      const latestFollowUpSubquery = `
        SELECT 
          f1.lead_id,
          f1.follow_up_time,
          f1.follow_up_content,
          f1.follow_up_method,
          f1.follow_up_result
        FROM follow_up_records f1
        INNER JOIN (
          SELECT lead_id, MAX(follow_up_time) as max_time
          FROM follow_up_records 
          WHERE lead_id IN (:leadIds)
          GROUP BY lead_id
        ) f2 ON f1.lead_id = f2.lead_id AND f1.follow_up_time = f2.max_time
      `;

      finalLatestFollowUps = await sequelize.query(latestFollowUpSubquery, {
        replacements: { leadIds: finalLeadIds },
        type: sequelize.QueryTypes.SELECT
      });
    }

    // 构建跟进记录映射
    const resultFollowUpMap = {};
    finalLatestFollowUps.forEach(followUp => {
      resultFollowUpMap[followUp.lead_id] = followUp;
    });

    // 获取跟进配置（使用缓存）
    const resultConfigMap = await getFollowupConfigs();

    // 计算距离下次跟进的时间
    const resultNow = dayjs();
    const result = finalLeads.map(lead => {
      const leadData = lead.toJSON();
      const latestFollowUp = resultFollowUpMap[leadData.id];
      const intervalDays = resultConfigMap[leadData.intention_level] || 7; // 默认7天

      // 🔧 修复：只计算整天数，忽略时分秒
      const lastTime = latestFollowUp ? dayjs(latestFollowUp.follow_up_time).startOf('day') : dayjs(leadData.lead_time).startOf('day');
      const currentTime = resultNow.startOf('day');
      const diffDays = currentTime.diff(lastTime, 'day');
      const remainingDays = intervalDays - diffDays;

      // 构建跟进状态描述
      let followUpStatus = '';
      let statusType = ''; // 用于前端显示样式
      let daysText = '';

      if (leadData.current_cycle_completed === 1) {
        followUpStatus = '等待下一周期';
        statusType = 'waiting';
        daysText = '已完成当前周期';
      } else if (remainingDays > 0) {
        followUpStatus = '正常跟进';
        statusType = 'normal';
        daysText = `剩余${remainingDays}天`;
      } else if (remainingDays === 0) {
        followUpStatus = '今日跟进';
        statusType = 'today';
        daysText = '今日需要跟进';
      } else {
        followUpStatus = '已超期';
        statusType = 'overdue';
        daysText = `已超期${Math.abs(remainingDays)}天`;
      }

      return {
        // 基本信息
        id: leadData.id,
        customer_nickname: leadData.customer_nickname,
        contact_account: leadData.contact_account,
        contact_name: leadData.contact_name,
        source_platform: leadData.source_platform,
        source_account: leadData.source_account,
        intention_level: leadData.intention_level,
        is_contacted: leadData.is_contacted,
        is_deal: leadData.is_deal,
        lead_time: leadData.lead_time,

        // 人员信息
        creator_user: leadData.creatorUser ? leadData.creatorUser.nickname : null,
        current_follower: leadData.currentFollowerUser ? leadData.currentFollowerUser.nickname : null,

        // 跟进状态
        enable_followup: leadData.enable_followup,
        need_followup: leadData.need_followup,
        current_cycle_completed: leadData.current_cycle_completed,

        // 最新跟进情况
        latest_follow_up_time: latestFollowUp ? latestFollowUp.follow_up_time : null,
        latest_follow_up_content: latestFollowUp ? latestFollowUp.follow_up_content : null,
        latest_follow_up_method: latestFollowUp ? latestFollowUp.follow_up_method : null,
        latest_follow_up_result: latestFollowUp ? latestFollowUp.follow_up_result : null,

        // 跟进时间计算
        follow_up_status: followUpStatus,
        status_type: statusType,
        days_text: daysText,
        remaining_days: remainingDays,
        overdue_days: remainingDays < 0 ? Math.abs(remainingDays) : 0,
        next_follow_up_time: latestFollowUp ?
          dayjs(latestFollowUp.follow_up_time).add(intervalDays, 'day').format('YYYY-MM-DD') :
          dayjs(leadData.lead_time).add(intervalDays, 'day').format('YYYY-MM-DD')
      };
    });

    // 按跟进紧急程度排序：超期 > 今日 > 正常（按剩余天数升序） > 等待下一周期
    result.sort((a, b) => {
      // 1. 超期线索优先（remainingDays < 0）
      if (a.remaining_days < 0 && b.remaining_days >= 0) return -1;
      if (b.remaining_days < 0 && a.remaining_days >= 0) return 1;
      
      // 2. 都是超期的，按超期天数降序（超期越久越靠前）
      if (a.remaining_days < 0 && b.remaining_days < 0) {
        return a.remaining_days - b.remaining_days; // 负数越小越靠前
      }
      
      // 3. 今日需要跟进优先（remainingDays = 0）
      if (a.remaining_days === 0 && b.remaining_days > 0) return -1;
      if (b.remaining_days === 0 && a.remaining_days > 0) return 1;
      
      // 4. 等待下一周期排最后
      if (a.current_cycle_completed === 1 && b.current_cycle_completed === 0) return 1;
      if (b.current_cycle_completed === 1 && a.current_cycle_completed === 0) return -1;
      
      // 5. 正常跟进按剩余天数升序（剩余天数越少越靠前）
      if (a.remaining_days > 0 && b.remaining_days > 0) {
        return a.remaining_days - b.remaining_days;
      }
      
      // 6. 其他情况保持原顺序
      return 0;
    });

    const dbEndTime = Date.now();
    const totalTime = Date.now() - startTime;
    const dbTime = dbEndTime - dbStartTime;

    console.log(`获取重点客户完成 - 总耗时: ${totalTime}ms, 数据库操作耗时: ${dbTime}ms, 总数: ${totalCount}, 当前页: ${result.length}`);

    res.json({
      success: true,
      data: result,
      stats: stats,
      pagination: {
        current_page: parseInt(page),
        page_size: parseInt(page_size),
        total: totalCount,
        total_pages: Math.ceil(totalCount / page_size)
      },
      performance: {
        totalTime: `${totalTime}ms`,
        dbTime: `${dbTime}ms`
      }
    });

  } catch (error) {
    console.error('获取重点客户失败:', error);
    const totalTime = Date.now() - startTime;
    res.status(500).json({
      success: false,
      message: '获取重点客户失败',
      error: error.message,
      performance: {
        totalTime: `${totalTime}ms`
      }
    });
  }
};

// 启用跟进
exports.enableFollowup = async (req, res) => {
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
    
    // 权限控制检查
    const userRole = req.user.role;
    const userId = req.user.id;
    
    console.log(`启用跟进权限检查 - 角色: ${userRole}, 用户ID: ${userId}, 线索ID: ${id}`);
    
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
      // 管理员可以启用所有线索的跟进
      hasPermission = true;
      console.log('权限检查: 管理员用户，允许启用跟进');
    } else if (userRole === 'service') {
      // 客服只能启用自己登记的线索
      hasPermission = leadData.creator_user_id === userId;
      console.log(`权限检查: 客服用户，登记人: ${leadData.creator_user_id}, 当前用户: ${userId}, 权限: ${hasPermission}`);
    } else if (userRole === 'sales') {
      // 销售只能启用分配给自己的线索
      hasPermission = leadData.assigned_user_id === userId;
      console.log(`权限检查: 销售用户，跟进人: ${leadData.assigned_user_id}, 当前用户: ${userId}, 权限: ${hasPermission}`);
    } else {
      // 其他角色默认只能启用自己登记的线索
      hasPermission = leadData.creator_user_id === userId;
      console.log(`权限检查: 其他角色用户，登记人: ${leadData.creator_user_id}, 当前用户: ${userId}, 权限: ${hasPermission}`);
    }
    
    if (!hasPermission) {
      await transaction.rollback();
      const totalTime = Date.now() - startTime;
      return res.status(403).json({ 
        success: false, 
        message: '您没有权限启用该线索的跟进',
        performance: {
          totalTime: `${totalTime}ms`
        }
      });
    }
    
    // 检查是否已经启用
    if (leadData.enable_followup === 1) {
      await transaction.rollback();
      const totalTime = Date.now() - startTime;
      return res.status(400).json({
        success: false,
        message: '该线索已经启用跟进',
        performance: {
          totalTime: `${totalTime}ms`
        }
      });
    }
    
    const dbStartTime = Date.now();
    
    // 启用跟进：设置enable_followup=1，同时重置end_followup=0，current_cycle_completed=0
    await CustomerLead.update({
      enable_followup: 1,
      end_followup: 0,
      end_followup_reason: null,
      current_cycle_completed: 0  // 启用跟进时，当前跟进周期标记为未完成
    }, {
      where: { id },
      transaction
    });

    let followUp = null;

    // 🔧 修改：启用跟进必须提供跟进内容
    const { follow_up_content, follow_up_method } = req.body;

    // 验证必须提供跟进内容
    if (!follow_up_content || !follow_up_content.trim()) {
      await transaction.rollback();
      const totalTime = Date.now() - startTime;
      return res.status(400).json({
        success: false,
        message: '启用跟进必须填写跟进内容',
        performance: {
          totalTime: `${totalTime}ms`
        }
      });
    }

    // 验证跟进方式
    if (!follow_up_method || !follow_up_method.trim()) {
      await transaction.rollback();
      const totalTime = Date.now() - startTime;
      return res.status(400).json({
        success: false,
        message: '请选择跟进方式',
        performance: {
          totalTime: `${totalTime}ms`
        }
      });
    }

    // 创建首次跟进记录
    const now = new Date();
    const currentTimeStr = now.getFullYear() + '-' +
      String(now.getMonth() + 1).padStart(2, '0') + '-' +
      String(now.getDate()).padStart(2, '0') + ' ' +
      String(now.getHours()).padStart(2, '0') + ':' +
      String(now.getMinutes()).padStart(2, '0') + ':' +
      String(now.getSeconds()).padStart(2, '0');

    const followUpData = {
      lead_id: id,
      follow_up_time: currentTimeStr,
      follow_up_method: follow_up_method,
      follow_up_content: follow_up_content,
      follow_up_result: '已跟进',
      follow_up_person_id: userId
    };

    followUp = await FollowUpRecord.create(followUpData, { transaction });

    // 创建跟进记录后，将当前跟进周期标记为已完成
    const { markCycleCompletedOnFollowUp } = require('../services/followupRemindChecker');
    await markCycleCompletedOnFollowUp(id, transaction);
    
    // 提交事务
    await transaction.commit();
    
    const dbEndTime = Date.now();
    const totalTime = Date.now() - startTime;
    const dbTime = dbEndTime - dbStartTime;
    
    console.log(`启用跟进完成 - 总耗时: ${totalTime}ms, 数据库操作耗时: ${dbTime}ms`);

    res.json({
      success: true,
      message: '跟进功能启用成功，已创建首次跟进记录',
      followUpId: followUp.id,
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
    console.error(`启用跟进出错 - 总耗时: ${totalTime}ms`, err);
    
    res.status(500).json({ 
      success: false, 
      message: err.message,
      performance: {
        totalTime: `${totalTime}ms`
      }
    });
  }
};

// 禁用跟进
exports.disableFollowup = async (req, res) => {
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
    
    // 验证终结跟进原因（必填）
    if (!data.end_followup_reason || data.end_followup_reason.trim() === '') {
      const totalTime = Date.now() - startTime;
      return res.status(400).json({
        success: false,
        message: '终结跟进时必须填写终结原因',
        performance: {
          totalTime: `${totalTime}ms`
        }
      });
    }
    
    // 初始化事务
    transaction = await CustomerLead.sequelize.transaction();
    
    const dbStartTime = Date.now();
    
    // 权限控制检查
    const userRole = req.user.role;
    const userId = req.user.id;
    
    console.log(`禁用跟进权限检查 - 角色: ${userRole}, 用户ID: ${userId}, 线索ID: ${id}`);
    
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
      // 管理员可以禁用所有线索的跟进
      hasPermission = true;
      console.log('权限检查: 管理员用户，允许禁用跟进');
    } else if (userRole === 'service') {
      // 客服只能禁用自己登记的线索
      hasPermission = leadData.creator_user_id === userId;
      console.log(`权限检查: 客服用户，登记人: ${leadData.creator_user_id}, 当前用户: ${userId}, 权限: ${hasPermission}`);
    } else if (userRole === 'sales') {
      // 销售只能禁用分配给自己的线索
      hasPermission = leadData.assigned_user_id === userId;
      console.log(`权限检查: 销售用户，跟进人: ${leadData.assigned_user_id}, 当前用户: ${userId}, 权限: ${hasPermission}`);
    } else {
      // 其他角色默认只能禁用自己登记的线索
      hasPermission = leadData.creator_user_id === userId;
      console.log(`权限检查: 其他角色用户，登记人: ${leadData.creator_user_id}, 当前用户: ${userId}, 权限: ${hasPermission}`);
    }
    
    if (!hasPermission) {
      await transaction.rollback();
      const totalTime = Date.now() - startTime;
      return res.status(403).json({ 
        success: false, 
        message: '您没有权限禁用该线索的跟进',
        performance: {
          totalTime: `${totalTime}ms`
        }
      });
    }
    
    // 1. 更新线索记录 - 设置终结跟进和禁用跟进
    const updateData = {
      end_followup: 1,
      end_followup_reason: data.end_followup_reason,
      enable_followup: 0,
      current_cycle_completed: 1  // 禁用跟进时，当前跟进周期标记为已完成
    };
    
    const [updated] = await CustomerLead.update(updateData, { 
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
        follow_up_time: data.follow_up_time || currentTimeStr,
        follow_up_method: data.follow_up_method || '终结跟进',
        follow_up_content: data.follow_up_content,
        follow_up_result: data.follow_up_result || '终结跟进',
        follow_up_person_id: userId
      };
      
      followUp = await FollowUpRecord.create(followUpData, { transaction });
    } else {
      // 如果不创建跟进记录，则创建一个默认的终结跟进记录
      const now = new Date();
      const currentTimeStr = now.getFullYear() + '-' + 
        String(now.getMonth() + 1).padStart(2, '0') + '-' + 
        String(now.getDate()).padStart(2, '0') + ' ' + 
        String(now.getHours()).padStart(2, '0') + ':' + 
        String(now.getMinutes()).padStart(2, '0') + ':' + 
        String(now.getSeconds()).padStart(2, '0');
      
      const followUpData = {
        lead_id: id,
        follow_up_time: currentTimeStr,
        follow_up_method: '系统操作',
        follow_up_content: `终结跟进 - 原因：${data.end_followup_reason}`,
        follow_up_result: '终结跟进',
        follow_up_person_id: userId
      };
      
      followUp = await FollowUpRecord.create(followUpData, { transaction });
    }
    
    // 提交事务
    await transaction.commit();
    
    const dbEndTime = Date.now();
    const totalTime = Date.now() - startTime;
    const dbTime = dbEndTime - dbStartTime;
    
    res.json({
      success: true,
      message: '跟进功能禁用成功',
      updatedLead: updated > 0,
      followUpId: followUp.id,
      createdFollowUp: true,
      performance: {
        totalTime: `${totalTime}ms`,
        dbTime: `${dbTime}ms`
      }
    });
    
  } catch (error) {
    if (transaction) {
      await transaction.rollback();
    }
    
    console.error('禁用跟进失败:', error);
    const totalTime = Date.now() - startTime;
    
    res.status(500).json({
      success: false,
      message: '禁用跟进失败',
      error: error.message,
      performance: {
        totalTime: `${totalTime}ms`
      }
    });
  }
};