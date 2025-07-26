const CustomerLead = require('../models/leadModel');
const FollowUpRecord = require('../models/followupModel');
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
    const dbStartTime = Date.now();
    // 1. 总线索数量
    const totalLeads = await CustomerLead.count({ raw: true });

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

    // 3. intention_distribution、platform_distribution、recent_additions 合并SQL
    const statsRows = await CustomerLead.sequelize.query(`
      SELECT
        intention_level,
        source_platform,
        COUNT(*) AS count,
        SUM(CASE WHEN lead_time >= :todayStart AND lead_time <= :todayEnd THEN 1 ELSE 0 END) AS today,
        SUM(CASE WHEN lead_time >= :weekStart AND lead_time <= :weekEnd THEN 1 ELSE 0 END) AS this_week,
        SUM(CASE WHEN lead_time >= :monthStart AND lead_time <= :monthEnd THEN 1 ELSE 0 END) AS this_month
      FROM customer_leads
      GROUP BY intention_level, source_platform
    `, {
      replacements: {
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

    // 5. 最近15天每一天的线索数量（以lead_time为准）
    const last15Start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 14);
    const last15StartStr = formatDate(last15Start, false);
    const last15DaysRaw = await CustomerLead.sequelize.query(
      `SELECT DATE(lead_time) AS date, COUNT(*) AS count FROM customer_leads WHERE lead_time >= :startDate GROUP BY DATE(lead_time) ORDER BY date ASC`,
      {
        replacements: { startDate: last15StartStr },
        type: QueryTypes.SELECT
      }
    );
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

    // 7. 今日统计
    const todayFollowedLeads = await FollowUpRecord.aggregate('lead_id', 'count', {
      distinct: true,
      where: {
        created_at: {
          [Op.gte]: todayStartStr,
          [Op.lte]: todayEndStr
        }
      }
    });
    const todayFollowupRecords = await FollowUpRecord.count({
      where: {
        created_at: {
          [Op.gte]: todayStartStr,
          [Op.lte]: todayEndStr
        }
      }
    });
    const todayEndedLeads = await CustomerLead.count({
      where: {
        end_followup: 1,
        updated_at: {
          [Op.gte]: todayStartStr,
          [Op.lte]: todayEndStr
        }
      }
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