const CustomerLead = require('../models/leadModel');
const FollowUpRecord = require('../models/followupModel');
const LeadSource = require('../models/leadSourceModel');
const { Op, fn, col, QueryTypes } = require('sequelize');

// 工具函数：格式化日期为 yyyy-MM-dd HH:mm:ss
function formatDate(date, end = false) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  if (end) {
    return `${y}-${m}-${d} 23:59:59`;
  } else {
    return `${y}-${m}-${d} 00:00:00`;
  }
}

// 线索统计概览
exports.getLeadsOverview = async (req, res) => {
  const startTime = Date.now();
  try {
    // 获取筛选参数
    const { assigned_user_id, date_from, date_to } = req.query;
    const userRole = req.user.role;
    const userId = req.user.id;

    // 权限控制：只有管理员可以使用筛选功能
    if ((assigned_user_id || date_from || date_to) && userRole !== 'admin') {
      return res.status(403).json({
        success: false,
        message: '只有管理员可以使用筛选功能'
      });
    }

    console.log(`获取线索统计概览 - 角色: ${userRole}, 筛选参数: assigned_user_id=${assigned_user_id}, date_from=${date_from}, date_to=${date_to}`);

    const dbStartTime = Date.now();
    
    let whereCondition = '';
    let replacements = {};

    if (userRole !== 'admin') {
      whereCondition += ' AND current_follower = :current_follower';
      replacements.current_follower = userId;
    } else if (assigned_user_id) {
      whereCondition += ' AND current_follower = :assigned_user_id';
      replacements.assigned_user_id = assigned_user_id;
    }
    
    if (date_from) {
      whereCondition += ' AND lead_time >= :date_from';
      replacements.date_from = date_from + ' 00:00:00';
    }
    
    if (date_to) {
      whereCondition += ' AND lead_time <= :date_to';
      replacements.date_to = date_to + ' 23:59:59';
    }

    // 1. 总线索数量（应用筛选条件）
    let totalLeadsQuery = 'SELECT COUNT(*) as count FROM customer_leads WHERE 1=1' + whereCondition;
    const totalLeadsResult = await CustomerLead.sequelize.query(totalLeadsQuery, {
      replacements,
      type: QueryTypes.SELECT
    });
    const totalLeads = parseInt(totalLeadsResult[0].count);

    // 2. 时间变量声明
    const today = new Date();
    const todayStartStr = formatDate(today, false);
    const todayEndStr = formatDate(today, true);
    const dayOfWeek = today.getDay() === 0 ? 7 : today.getDay(); // 周日为7
    const weekStart = new Date(today.getFullYear(), today.getMonth(), today.getDate() - dayOfWeek + 1);
    const weekStartStr = formatDate(weekStart, false);
    const weekEndStr = formatDate(new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + 6), true);
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    const monthStartStr = formatDate(monthStart, false);
    const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0);
    const monthEndStr = formatDate(monthEnd, true);

    // 3. intention_distribution、platform_distribution、recent_additions 合并SQL（应用筛选条件）
    const statsQuery = `
      SELECT
        intention_level,
        source_platform,
        COUNT(*) AS count,
        SUM(CASE WHEN lead_time >= :todayStart AND lead_time <= :todayEnd THEN 1 ELSE 0 END) AS today,
        SUM(CASE WHEN lead_time >= :weekStart AND lead_time <= :weekEnd THEN 1 ELSE 0 END) AS this_week,
        SUM(CASE WHEN lead_time >= :monthStart AND lead_time <= :monthEnd THEN 1 ELSE 0 END) AS this_month
      FROM customer_leads
      WHERE 1=1${whereCondition}
      GROUP BY intention_level, source_platform
    `;
    const statsRows = await CustomerLead.sequelize.query(statsQuery, {
      replacements: {
        ...replacements,
        todayStart: todayStartStr,
        todayEnd: todayEndStr,
        weekStart: weekStartStr,
        weekEnd: weekEndStr,
        monthStart: monthStartStr,
        monthEnd: monthEndStr
      },
      type: QueryTypes.SELECT
    });
    // 4. intention_distribution、platform_distribution、recent_additions 变量聚合
    const intentionStats = {};
    const platformStats = {};
    let todayLeads = 0, thisWeekLeads = 0, thisMonthLeads = 0;
    statsRows.forEach(row => {
      if (row.intention_level) {
        intentionStats[row.intention_level] = (intentionStats[row.intention_level] || 0) + parseInt(row.count);
      }
      if (row.source_platform) {
        platformStats[row.source_platform] = (platformStats[row.source_platform] || 0) + parseInt(row.count);
      }
      todayLeads += parseInt(row.today);
      thisWeekLeads += parseInt(row.this_week);
      thisMonthLeads += parseInt(row.this_month);
    });

    // 5. 最近15天每一天的线索数量（以lead_time为准，应用筛选条件）
    const last15Start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 14);
    const last15StartStr = formatDate(last15Start, false);
    const last15DaysQuery = `SELECT DATE(lead_time) AS date, COUNT(*) AS count FROM customer_leads WHERE lead_time >= :startDate${whereCondition} GROUP BY DATE(lead_time) ORDER BY date ASC`;
    const last15DaysRaw = await CustomerLead.sequelize.query(last15DaysQuery, {
      replacements: { 
        ...replacements,
        startDate: last15StartStr 
      },
      type: QueryTypes.SELECT
    });
    const last15Days = [];
    for (let i = 14; i >= 0; i--) {
      const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
      const dateStr = formatDate(date, false).slice(0, 10);
      const found = last15DaysRaw.find(item => item.date === dateStr);
      last15Days.push({
        date: dateStr,
        count: found ? found.count : 0
      });
    }

    // 6. 本周跟进统计（以follow_up_time为准，周一到周日）
    let followupWeekLeadCount = 0;
    let followupWeekRecordCount = 0;
    if (userRole === 'admin' && !assigned_user_id) {
      followupWeekLeadCount = await FollowUpRecord.count({
        where: {
          follow_up_time: {
            [Op.gte]: weekStartStr,
            [Op.lte]: weekEndStr
          }
        },
        distinct: true,
        col: 'lead_id',
        raw: true
      });
      followupWeekRecordCount = await FollowUpRecord.count({
        where: {
          follow_up_time: {
            [Op.gte]: weekStartStr,
            [Op.lte]: weekEndStr
          }
        },
        raw: true
      });
    } else {
      const followerId = userRole !== 'admin' ? userId : assigned_user_id;
      const weekFollowedLeadsQuery = `
        SELECT COUNT(DISTINCT fr.lead_id) as count
        FROM follow_up_records fr
        JOIN customer_leads cl ON fr.lead_id = cl.id
        WHERE fr.follow_up_time >= :weekStart 
        AND fr.follow_up_time <= :weekEnd
        AND cl.current_follower = :followerId
      `;
      const weekFollowedResult = await FollowUpRecord.sequelize.query(weekFollowedLeadsQuery, {
        replacements: {
          weekStart: weekStartStr,
          weekEnd: weekEndStr,
          followerId
        },
        type: QueryTypes.SELECT
      });
      followupWeekLeadCount = weekFollowedResult[0]?.count || 0;

      const weekFollowupRecordsQuery = `
        SELECT COUNT(*) as count
        FROM follow_up_records fr
        JOIN customer_leads cl ON fr.lead_id = cl.id
        WHERE fr.follow_up_time >= :weekStart 
        AND fr.follow_up_time <= :weekEnd
        AND cl.current_follower = :followerId
      `;
      const weekFollowupResult = await FollowUpRecord.sequelize.query(weekFollowupRecordsQuery, {
        replacements: {
          weekStart: weekStartStr,
          weekEnd: weekEndStr,
          followerId
        },
        type: QueryTypes.SELECT
      });
      followupWeekRecordCount = weekFollowupResult[0]?.count || 0;
    }

    // 7. 今日统计
    // 构建今日跟进统计的查询条件
    let todayFollowupWhere = {
      follow_up_time: {
        [Op.gte]: todayStartStr,
        [Op.lte]: todayEndStr
      }
    };
    
    // 声明变量
    let todayFollowedLeads = 0;
    let todayFollowupRecords = 0;
    
    // 如果有销售员筛选，需要通过关联查询
    if (assigned_user_id) {
      const todayFollowedLeadsQuery = `
        SELECT COUNT(DISTINCT fr.lead_id) as count
        FROM follow_up_records fr
        JOIN customer_leads cl ON fr.lead_id = cl.id
        WHERE fr.follow_up_time >= :todayStart 
        AND fr.follow_up_time <= :todayEnd
        AND cl.current_follower = :assigned_user_id
      `;
      const todayFollowedResult = await FollowUpRecord.sequelize.query(todayFollowedLeadsQuery, {
        replacements: {
          todayStart: todayStartStr,
          todayEnd: todayEndStr,
          assigned_user_id: assigned_user_id
        },
        type: QueryTypes.SELECT
      });
      todayFollowedLeads = todayFollowedResult[0]?.count || 0;
      
      const todayFollowupRecordsQuery = `
        SELECT COUNT(*) as count
        FROM follow_up_records fr
        JOIN customer_leads cl ON fr.lead_id = cl.id
        WHERE fr.follow_up_time >= :todayStart 
        AND fr.follow_up_time <= :todayEnd
        AND cl.current_follower = :assigned_user_id
      `;
      const todayFollowupResult = await FollowUpRecord.sequelize.query(todayFollowupRecordsQuery, {
        replacements: {
          todayStart: todayStartStr,
          todayEnd: todayEndStr,
          assigned_user_id: assigned_user_id
        },
        type: QueryTypes.SELECT
      });
      todayFollowupRecords = todayFollowupResult[0]?.count || 0;
    } else {
      if (userRole !== 'admin') {
        const todayFollowedLeadsQuery = `
          SELECT COUNT(DISTINCT fr.lead_id) as count
          FROM follow_up_records fr
          JOIN customer_leads cl ON fr.lead_id = cl.id
          WHERE fr.follow_up_time >= :todayStart 
          AND fr.follow_up_time <= :todayEnd
          AND cl.current_follower = :current_follower
        `;
        const todayFollowedResult = await FollowUpRecord.sequelize.query(todayFollowedLeadsQuery, {
          replacements: {
            todayStart: todayStartStr,
            todayEnd: todayEndStr,
            current_follower: userId
          },
          type: QueryTypes.SELECT
        });
        todayFollowedLeads = todayFollowedResult[0]?.count || 0;

        const todayFollowupRecordsQuery = `
          SELECT COUNT(*) as count
          FROM follow_up_records fr
          JOIN customer_leads cl ON fr.lead_id = cl.id
          WHERE fr.follow_up_time >= :todayStart 
          AND fr.follow_up_time <= :todayEnd
          AND cl.current_follower = :current_follower
        `;
        const todayFollowupResult = await FollowUpRecord.sequelize.query(todayFollowupRecordsQuery, {
          replacements: {
            todayStart: todayStartStr,
            todayEnd: todayEndStr,
            current_follower: userId
          },
          type: QueryTypes.SELECT
        });
        todayFollowupRecords = todayFollowupResult[0]?.count || 0;
      } else {
        todayFollowedLeads = await FollowUpRecord.aggregate('lead_id', 'count', {
          distinct: true,
          where: todayFollowupWhere
        });
        todayFollowupRecords = await FollowUpRecord.count({
          where: todayFollowupWhere
        });
      }
    }
    // 构建todayEndedLeads的查询条件
    let todayEndedWhere = {
      end_followup: 1,
      updated_at: {
        [Op.gte]: todayStartStr,
        [Op.lte]: todayEndStr
      }
    };
    
    if (assigned_user_id) {
      todayEndedWhere.current_follower = assigned_user_id;
    }
    if (userRole !== 'admin') {
      todayEndedWhere.current_follower = userId;
    }
    if (date_from) {
      todayEndedWhere.lead_time = todayEndedWhere.lead_time || {};
      todayEndedWhere.lead_time[Op.gte] = date_from + ' 00:00:00';
    }
    if (date_to) {
      todayEndedWhere.lead_time = todayEndedWhere.lead_time || {};
      todayEndedWhere.lead_time[Op.lte] = date_to + ' 23:59:59';
    }
    
    const todayEndedLeads = await CustomerLead.count({
      where: todayEndedWhere
    });

    // 8. 性能统计
    const dbEndTime = Date.now();
    const totalTime = Date.now() - startTime;
    const dbTime = dbEndTime - dbStartTime;
    console.log(`获取线索统计概览完成 - 总耗时: ${totalTime}ms, 数据库操作耗时: ${dbTime}ms`);

    // 9. 返回结构
    res.json({
      success: true,
      data: {
        total_leads: totalLeads,
        intention_distribution: intentionStats,
        platform_distribution: platformStats,
        recent_additions: {
          today: todayLeads,
          this_week: thisWeekLeads,
          this_month: thisMonthLeads
        },
        last_15_days_trend: last15Days,
        followup: {
          this_week_lead_count: followupWeekLeadCount,
          this_week_record_count: followupWeekRecordCount
        },
        today_stats: {
          followed_leads: todayFollowedLeads,
          followup_records: todayFollowupRecords,
          ended_leads: todayEndedLeads
        }
      },
      performance: {
        totalTime: `${totalTime}ms`,
        dbTime: `${dbTime}ms`
      }
    });
  } catch (error) {
    console.error('获取线索统计概览失败:', error);
    res.status(500).json({
      success: false,
      message: '获取线索统计概览失败',
      error: error.message
    });
  }
};

// 获取线索来源统计（按平台分组）
exports.getLeadSourceStats = async (req, res) => {
  const startTime = Date.now();
  
  try {
    const { date_from, date_to, group_by = 'platform' } = req.query;
    
    const dbStartTime = Date.now();
    
    let query;
    if (group_by === 'platform') {
      // 按平台统计
      query = `
        SELECT 
          ls.platform,
          COUNT(cl.id) as total_leads,
          COUNT(CASE WHEN cl.is_deal = 1 THEN 1 END) as deal_leads,
          COUNT(CASE WHEN cl.is_contacted = 1 THEN 1 END) as contacted_leads,
          ROUND(COUNT(CASE WHEN cl.is_deal = 1 THEN 1 END) * 100.0 / NULLIF(COUNT(cl.id), 0), 2) as deal_rate
        FROM lead_sources ls
        LEFT JOIN customer_leads cl ON ls.platform = cl.source_platform 
          AND ls.account = cl.source_account
          ${date_from && date_to ? `AND cl.lead_time BETWEEN '${date_from} 00:00:00' AND '${date_to} 23:59:59'` : ''}
        WHERE ls.is_active = 1
        GROUP BY ls.platform
        ORDER BY total_leads DESC
      `;
    } else {
      // 按平台和账号统计
      query = `
        SELECT 
          ls.platform,
          ls.account,
          ls.id as source_id,
          COUNT(cl.id) as total_leads,
          COUNT(CASE WHEN cl.is_deal = 1 THEN 1 END) as deal_leads,
          COUNT(CASE WHEN cl.is_contacted = 1 THEN 1 END) as contacted_leads,
          ROUND(COUNT(CASE WHEN cl.is_deal = 1 THEN 1 END) * 100.0 / NULLIF(COUNT(cl.id), 0), 2) as deal_rate
        FROM lead_sources ls
        LEFT JOIN customer_leads cl ON ls.platform = cl.source_platform 
          AND ls.account = cl.source_account
          ${date_from && date_to ? `AND cl.lead_time BETWEEN '${date_from} 00:00:00' AND '${date_to} 23:59:59'` : ''}
        WHERE ls.is_active = 1
        GROUP BY ls.platform, ls.account, ls.id
        ORDER BY ls.platform, total_leads DESC
      `;
    }
    
    const results = await CustomerLead.sequelize.query(query, {
      type: QueryTypes.SELECT
    });
    
    const dbEndTime = Date.now();
    
    // 格式化数据
    let formattedData;
    if (group_by === 'platform') {
      formattedData = results;
    } else {
      // 按平台分组账号数据
      formattedData = {};
      results.forEach(item => {
        if (!formattedData[item.platform]) {
          formattedData[item.platform] = [];
        }
        formattedData[item.platform].push({
          account: item.account,
          source_id: item.source_id,
          total_leads: item.total_leads,
          deal_leads: item.deal_leads,
          contacted_leads: item.contacted_leads,
          deal_rate: item.deal_rate
        });
      });
    }
    
    const totalTime = Date.now() - startTime;
    const dbTime = dbEndTime - dbStartTime;
    
    console.log(`获取线索来源统计完成 - 分组: ${group_by}, 总耗时: ${totalTime}ms, 数据库操作耗时: ${dbTime}ms`);
    
    res.json({
      success: true,
      data: formattedData,
      query_params: {
        date_from,
        date_to,
        group_by
      },
      performance: {
        totalTime: `${totalTime}ms`,
        dbTime: `${dbTime}ms`
      }
    });
    
  } catch (error) {
    console.error('获取线索来源统计失败:', error);
    const totalTime = Date.now() - startTime;
    res.status(500).json({
      success: false,
      message: '获取线索来源统计失败',
      error: error.message,
      performance: {
        totalTime: `${totalTime}ms`
      }
    });
  }
};

// 获取线索来源趋势统计（按时间分组）
exports.getLeadSourceTrend = async (req, res) => {
  const startTime = Date.now();
  
  try {
    const { date_from, date_to, platform, account, group_by = 'day' } = req.query;
    
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
    
    const dbStartTime = Date.now();
    
    let dateFormat, groupClause;
    if (group_by === 'day') {
      dateFormat = '%Y-%m-%d';
      groupClause = 'DATE(cl.lead_time)';
    } else if (group_by === 'week') {
      dateFormat = '%Y-%u';
      groupClause = 'YEARWEEK(cl.lead_time)';
    } else if (group_by === 'month') {
      dateFormat = '%Y-%m';
      groupClause = 'DATE_FORMAT(cl.lead_time, "%Y-%m")';
    }
    
    let whereClause = `cl.lead_time BETWEEN '${date_from} 00:00:00' AND '${date_to} 23:59:59'`;
    if (platform) {
      whereClause += ` AND ls.platform = '${platform}'`;
    }
    if (account) {
      whereClause += ` AND ls.account = '${account}'`;
    }
    
    const query = `
      SELECT 
        ${groupClause} as time_period,
        ls.platform,
        ls.account,
        COUNT(cl.id) as total_leads,
        COUNT(CASE WHEN cl.is_deal = 1 THEN 1 END) as deal_leads
      FROM lead_sources ls
      LEFT JOIN customer_leads cl ON ls.platform = cl.source_platform 
        AND ls.account = cl.source_account
        AND ${whereClause}
      WHERE ls.is_active = 1
      GROUP BY ${groupClause}, ls.platform, ls.account
      ORDER BY time_period, ls.platform, ls.account
    `;
    
    const results = await CustomerLead.sequelize.query(query, {
      type: QueryTypes.SELECT
    });
    
    const dbEndTime = Date.now();
    
    // 格式化趋势数据
    const trendData = {};
    results.forEach(item => {
      const key = `${item.platform}-${item.account}`;
      if (!trendData[key]) {
        trendData[key] = {
          platform: item.platform,
          account: item.account,
          trend: []
        };
      }
      trendData[key].trend.push({
        time_period: item.time_period,
        total_leads: item.total_leads,
        deal_leads: item.deal_leads
      });
    });
    
    const totalTime = Date.now() - startTime;
    const dbTime = dbEndTime - dbStartTime;
    
    console.log(`获取线索来源趋势统计完成 - 分组: ${group_by}, 总耗时: ${totalTime}ms, 数据库操作耗时: ${dbTime}ms`);
    
    res.json({
      success: true,
      data: Object.values(trendData),
      query_params: {
        date_from,
        date_to,
        platform,
        account,
        group_by
      },
      performance: {
        totalTime: `${totalTime}ms`,
        dbTime: `${dbTime}ms`
      }
    });
    
  } catch (error) {
    console.error('获取线索来源趋势统计失败:', error);
    const totalTime = Date.now() - startTime;
    res.status(500).json({
      success: false,
      message: '获取线索来源趋势统计失败',
      error: error.message,
      performance: {
        totalTime: `${totalTime}ms`
      }
    });
  }
};

// 获取上周统计（前一个完整自然周）
exports.getLastWeekStats = async (req, res) => {
  const startTime = Date.now();
  
  try {
    // 权限控制：只有管理员可以查看完整统计，销售员只能看自己的数据
    const userRole = req.user.role;
    const userId = req.user.id;
    const { assigned_user_id } = req.query;
    
    console.log(`获取上周统计 - 角色: ${userRole}, 用户ID: ${userId}, 筛选销售员: ${assigned_user_id}`);
    
    const dbStartTime = Date.now();
    
    // 计算前一个完整自然周的时间范围（周一到周日）
    const today = new Date();
    const dayOfWeek = today.getDay() || 7; // 周日为0，转换为7
    const lastWeekEnd = new Date(today);
    lastWeekEnd.setDate(today.getDate() - dayOfWeek); // 上周日
    const lastWeekStart = new Date(lastWeekEnd);
    lastWeekStart.setDate(lastWeekEnd.getDate() - 6); // 上周一
    
    const weekStartStr = formatDate(lastWeekStart, false);
    const weekEndStr = formatDate(lastWeekEnd, true);
    
    // 生成一周的日期数组
    const weekDates = [];
    for (let i = 0; i < 7; i++) {
      const date = new Date(lastWeekStart);
      date.setDate(lastWeekStart.getDate() + i);
      weekDates.push(formatDate(date, false).slice(0, 10));
    }
    
    // 构建权限过滤条件
    let whereCondition = 'cl.lead_time BETWEEN ? AND ?';
    let replacements = [weekStartStr, weekEndStr];
    
    // 如果不是管理员，只能查看自己负责的线索
    if (userRole !== 'admin') {
      whereCondition += ' AND cl.current_follower = ?';
      replacements.push(userId);
    } else if (assigned_user_id) {
      // 管理员可以按销售员筛选
      whereCondition += ' AND cl.current_follower = ?';
      replacements.push(assigned_user_id);
    }
    
    // 查询平台统计
    const platformQuery = `
      SELECT 
        COALESCE(ls.platform, cl.source_platform) as platform,
        DATE(cl.lead_time) as date,
        COUNT(cl.id) as count
      FROM customer_leads cl
      LEFT JOIN lead_sources ls ON ls.platform = cl.source_platform 
        AND ls.account = cl.source_account
      WHERE ${whereCondition}
      GROUP BY COALESCE(ls.platform, cl.source_platform), DATE(cl.lead_time)
      ORDER BY platform, date
    `;
    
    // 查询平台+账号统计
    const accountQuery = `
      SELECT 
        COALESCE(ls.platform, cl.source_platform) as platform,
        COALESCE(ls.account, cl.source_account) as account,
        DATE(cl.lead_time) as date,
        COUNT(cl.id) as count
      FROM customer_leads cl
      LEFT JOIN lead_sources ls ON ls.platform = cl.source_platform 
        AND ls.account = cl.source_account
      WHERE ${whereCondition}
      GROUP BY COALESCE(ls.platform, cl.source_platform), 
               COALESCE(ls.account, cl.source_account), 
               DATE(cl.lead_time)
      ORDER BY platform, account, date
    `;
    
    // 查询每日合计
    const dailyTotalQuery = `
      SELECT 
        DATE(cl.lead_time) as date,
        COUNT(cl.id) as count
      FROM customer_leads cl
      WHERE ${whereCondition}
      GROUP BY DATE(cl.lead_time)
      ORDER BY date
    `;
    
    // 执行查询
    const platformResults = await CustomerLead.sequelize.query(platformQuery, {
      replacements: replacements,
      type: QueryTypes.SELECT
    });
    
    const accountResults = await CustomerLead.sequelize.query(accountQuery, {
      replacements: replacements,
      type: QueryTypes.SELECT
    });
    
    const dailyTotalResults = await CustomerLead.sequelize.query(dailyTotalQuery, {
      replacements: replacements,
      type: QueryTypes.SELECT
    });
    
    const dbEndTime = Date.now();
    
    // 格式化平台统计数据
    const platformStats = {};
    platformResults.forEach(row => {
      if (!platformStats[row.platform]) {
        platformStats[row.platform] = {};
        // 初始化每天的数据为0
        weekDates.forEach(date => {
          platformStats[row.platform][date] = 0;
        });
      }
      platformStats[row.platform][row.date] = parseInt(row.count);
    });
    
    // 格式化平台+账号统计数据
    const accountStats = {};
    accountResults.forEach(row => {
      if (!accountStats[row.platform]) {
        accountStats[row.platform] = {};
      }
      if (!accountStats[row.platform][row.account]) {
        accountStats[row.platform][row.account] = {};
        // 初始化每天的数据为0
        weekDates.forEach(date => {
          accountStats[row.platform][row.account][date] = 0;
        });
      }
      accountStats[row.platform][row.account][row.date] = parseInt(row.count);
    });
    
    // 格式化每日合计数据
    const dailyTotals = {};
    weekDates.forEach(date => {
      dailyTotals[date] = 0;
    });
    dailyTotalResults.forEach(row => {
      dailyTotals[row.date] = parseInt(row.count);
    });
    
    const totalTime = Date.now() - startTime;
    const dbTime = dbEndTime - dbStartTime;
    
    console.log(`获取上周统计完成 - 周范围: ${weekStartStr.slice(0, 10)} 至 ${weekEndStr.slice(0, 10)}, 总耗时: ${totalTime}ms, 数据库操作耗时: ${dbTime}ms`);
    
    res.json({
      success: true,
      data: {
        week_range: {
          start: weekStartStr.slice(0, 10),
          end: weekEndStr.slice(0, 10),
          dates: weekDates
        },
        platform_stats: platformStats,
        account_stats: accountStats,
        daily_totals: dailyTotals
      },
      performance: {
        totalTime: `${totalTime}ms`,
        dbTime: `${dbTime}ms`
      }
    });
    
  } catch (error) {
    console.error('获取上周统计失败:', error);
    const totalTime = Date.now() - startTime;
    res.status(500).json({
      success: false,
      message: '获取上周统计失败',
      error: error.message,
      performance: {
        totalTime: `${totalTime}ms`
      }
    });
  }
};

// 平台账号统计概览
exports.getPlatformAccountSummary = async (req, res) => {
  const startTime = Date.now();
  
  try {
    // 权限控制：只有管理员可以查看完整统计，销售员只能看自己的数据
    const userRole = req.user.role;
    const userId = req.user.id;
    const { assigned_user_id } = req.query;
    
    console.log(`获取平台账号汇总 - 角色: ${userRole}, 用户ID: ${userId}, 筛选销售员: ${assigned_user_id}`);
    
    const dbStartTime = Date.now();
    
    // 1. 总线索数量
    let totalLeads;
    if (userRole === 'admin') {
      if (assigned_user_id) {
        // 管理员按销售员筛选
        totalLeads = await CustomerLead.count({
          where: { current_follower: assigned_user_id }
        });
      } else {
        // 管理员查看全部
        totalLeads = await CustomerLead.count();
      }
    } else {
      // 销售员只能看自己的数据
      totalLeads = await CustomerLead.count({
        where: { current_follower: userId }
      });
    }
    
    // 2. 按平台和账号统计线索数量
    let platformAccountQuery = `
      SELECT 
        CASE 
          WHEN cl.source_platform IS NULL OR cl.source_platform = '' OR cl.source_platform = '未知' 
          THEN '未知平台'
          ELSE cl.source_platform
        END as platform,
        CASE 
          WHEN cl.source_account IS NULL OR cl.source_account = '' OR cl.source_account = '未知' 
          THEN '未知账号'
          ELSE cl.source_account
        END as account,
        COUNT(*) as lead_count
      FROM customer_leads cl`;
    
    // 添加权限过滤条件
    let queryReplacements = [];
    if (userRole !== 'admin') {
      platformAccountQuery += ` WHERE cl.current_follower = ?`;
      queryReplacements.push(userId);
    } else if (assigned_user_id) {
      // 管理员可以按销售员筛选
      platformAccountQuery += ` WHERE cl.current_follower = ?`;
      queryReplacements.push(assigned_user_id);
    }
    
    platformAccountQuery += `
      GROUP BY 
        CASE 
          WHEN cl.source_platform IS NULL OR cl.source_platform = '' OR cl.source_platform = '未知' 
          THEN '未知平台'
          ELSE cl.source_platform
        END,
        CASE 
          WHEN cl.source_account IS NULL OR cl.source_account = '' OR cl.source_account = '未知' 
          THEN '未知账号'
          ELSE cl.source_account
        END
      ORDER BY platform, lead_count DESC
    `;
    
    const platformAccountResults = await CustomerLead.sequelize.query(platformAccountQuery, {
      replacements: queryReplacements,
      type: QueryTypes.SELECT
    });
    
    const dbEndTime = Date.now();
    
    // 3. 组织数据结构
    const platformStats = {};
    
    platformAccountResults.forEach(row => {
      const platform = row.platform;
      const account = row.account;
      const leadCount = parseInt(row.lead_count);
      
      if (!platformStats[platform]) {
        platformStats[platform] = {
          total_leads: 0,
          known_accounts: {},
          unknown_accounts: 0,
          account_count: 0
        };
      }
      
      platformStats[platform].total_leads += leadCount;
      
      if (account === '未知账号') {
        platformStats[platform].unknown_accounts = leadCount;
      } else {
        platformStats[platform].known_accounts[account] = leadCount;
        platformStats[platform].account_count += 1;
      }
    });
    
    const totalTime = Date.now() - startTime;
    const dbTime = dbEndTime - dbStartTime;
    
    console.log(`获取平台账号统计完成 - 总耗时: ${totalTime}ms, 数据库操作耗时: ${dbTime}ms`);
    
    res.json({
      success: true,
      data: {
        total_leads: totalLeads,
        platforms: platformStats
      },
      performance: {
        totalTime: `${totalTime}ms`,
        dbTime: `${dbTime}ms`
      }
    });
    
  } catch (error) {
    console.error('获取平台账号统计失败:', error);
    const totalTime = Date.now() - startTime;
    res.status(500).json({
      success: false,
      message: '获取平台账号统计失败',
      error: error.message,
      performance: {
        totalTime: `${totalTime}ms`
      }
    });
  }
};
