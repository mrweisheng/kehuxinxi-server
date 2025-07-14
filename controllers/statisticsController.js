const CustomerLead = require('../models/leadModel');
const FollowUpRecord = require('../models/followupModel');
const { Op, fn, col } = require('sequelize');

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
    const dbStartTime = Date.now();
    // 1. 总线索数量
    const totalLeads = await CustomerLead.count({ raw: true });
    // 2. 各意向等级分布
    const intentionDistribution = await CustomerLead.findAll({
      attributes: [
        'intention_level',
        [CustomerLead.sequelize.fn('COUNT', '*'), 'count']
      ],
      group: ['intention_level'],
      raw: true
    });
    // 3. 各来源平台分布
    const platformDistribution = await CustomerLead.findAll({
      attributes: [
        'source_platform',
        [CustomerLead.sequelize.fn('COUNT', '*'), 'count']
      ],
      group: ['source_platform'],
      raw: true
    });
    // 4. 今日新增线索数（以lead_time为准）
    const today = new Date();
    const todayStartStr = formatDate(today, false);
    const todayEndStr = formatDate(today, true);
    const todayLeads = await CustomerLead.count({
      where: {
        lead_time: {
          [Op.gte]: todayStartStr,
          [Op.lte]: todayEndStr
        }
      },
      raw: true
    });
    // 5. 本周新增线索数（以lead_time为准，周一为一周开始）
    const dayOfWeek = today.getDay() === 0 ? 7 : today.getDay(); // 周日为7
    const weekStart = new Date(today.getFullYear(), today.getMonth(), today.getDate() - dayOfWeek + 1);
    const weekStartStr = formatDate(weekStart, false);
    const weekEndStr = formatDate(new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + 6), true);
    const thisWeekLeads = await CustomerLead.count({
      where: {
        lead_time: {
          [Op.gte]: weekStartStr,
          [Op.lte]: weekEndStr
        }
      },
      raw: true
    });
    // 6. 本月新增线索数（以lead_time为准）
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    const monthStartStr = formatDate(monthStart, false);
    const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0);
    const monthEndStr = formatDate(monthEnd, true);
    const thisMonthLeads = await CustomerLead.count({
      where: {
        lead_time: {
          [Op.gte]: monthStartStr,
          [Op.lte]: monthEndStr
        }
      },
      raw: true
    });
    // 7. 最近15天每一天的线索数量（以lead_time为准）
    const last15Days = [];
    for (let i = 14; i >= 0; i--) {
      const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
      const dayStartStr = formatDate(date, false);
      const dayEndStr = formatDate(date, true);
      const dayCount = await CustomerLead.count({
        where: {
          lead_time: {
            [Op.gte]: dayStartStr,
            [Op.lte]: dayEndStr
          }
        },
        raw: true
      });
      last15Days.push({
        date: dayStartStr.slice(0, 10), // YYYY-MM-DD
        count: dayCount
      });
    }
    // 8. 本周跟进统计（以follow_up_time为准，周一到周日）
    const followupWeekLeadCount = await FollowUpRecord.count({
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
    const followupWeekRecordCount = await FollowUpRecord.count({
      where: {
        follow_up_time: {
          [Op.gte]: weekStartStr,
          [Op.lte]: weekEndStr
        }
      },
      raw: true
    });
    const dbEndTime = Date.now();
    // 处理统计数据格式
    const intentionStats = {};
    intentionDistribution.forEach(item => {
      intentionStats[item.intention_level] = parseInt(item.count);
    });
    const platformStats = {};
    platformDistribution.forEach(item => {
      platformStats[item.source_platform] = parseInt(item.count);
    });
    const totalTime = Date.now() - startTime;
    const dbTime = dbEndTime - dbStartTime;
    console.log(`获取线索统计概览完成 - 总耗时: ${totalTime}ms, 数据库操作耗时: ${dbTime}ms`);
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
        }
      },
      performance: {
        totalTime: `${totalTime}ms`,
        dbTime: `${dbTime}ms`
      }
    });
  } catch (err) {
    const totalTime = Date.now() - startTime;
    console.error(`获取线索统计概览出错 - 总耗时: ${totalTime}ms`, err);
    res.status(500).json({
      success: false,
      message: err.message,
      performance: {
        totalTime: `${totalTime}ms`
      }
    });
  }
}; 