const dayjs = require('dayjs');
const { Op } = require('sequelize');
const sequelize = require('../config/db');
const CustomerLead = require('../models/leadModel');
const FollowUpRecord = require('../models/followupModel');
const { getFollowupConfigs } = require('./configCache');

// 获取今日跟进统计信息 - 优化版本，解决N+1查询问题
async function getTodayFollowUpStats(userId, userRole) {
  try {
    const today = dayjs().format('YYYY-MM-DD');
    const todayStart = `${today} 00:00:00`;
    const todayEnd = `${today} 23:59:59`;

    // 1. 统计今日已跟进数量（用户今天创建的跟进记录）
    const todayFollowUpWhere = {
      follow_up_time: {
        [Op.between]: [todayStart, todayEnd]
      },
      follow_up_person_id: userId
    };

    const todayCompletedCount = await FollowUpRecord.count({
      where: todayFollowUpWhere
    });

    // 2. 统计今日待跟进数据 - 优化版本
    const pendingWhere = {
      enable_followup: 1,
      end_followup: 0,
      current_cycle_completed: 0
    };

    // 权限控制
    if (userRole !== 'admin') {
      pendingWhere.current_follower = userId;
    }

    // 获取所有需要跟进的线索
    const pendingLeads = await CustomerLead.findAll({
      where: pendingWhere,
      attributes: ['id', 'intention_level', 'lead_time'],
      raw: true
    });

    if (pendingLeads.length === 0) {
      // 如果没有待跟进线索，直接返回
      const totalCustomersWhere = {
        enable_followup: 1,
        end_followup: 0
      };
      
      if (userRole !== 'admin') {
        totalCustomersWhere.current_follower = userId;
      }

      const totalCustomersCount = await CustomerLead.count({
        where: totalCustomersWhere
      });

      return {
        todayCompleted: todayCompletedCount,
        todayPending: 0,
        total: totalCustomersCount
      };
    }

    // 获取跟进配置（使用缓存）
    const configMap = await getFollowupConfigs();

    // 批量获取所有线索的最新跟进记录 - 解决N+1查询问题
    const leadIds = pendingLeads.map(lead => lead.id);
    
    // 使用子查询获取每个线索的最新跟进时间
    const latestFollowUps = await FollowUpRecord.findAll({
      attributes: [
        'lead_id',
        [sequelize.fn('MAX', sequelize.col('follow_up_time')), 'latest_follow_up_time']
      ],
      where: {
        lead_id: { [Op.in]: leadIds }
      },
      group: ['lead_id'],
      raw: true
    });

    // 构建最新跟进时间映射
    const latestFollowUpMap = {};
    latestFollowUps.forEach(record => {
      latestFollowUpMap[record.lead_id] = record.latest_follow_up_time;
    });

    // 批量获取今日已跟进的线索ID
    const todayFollowedLeadIds = await FollowUpRecord.findAll({
      attributes: ['lead_id'],
      where: {
        lead_id: { [Op.in]: leadIds },
        follow_up_time: {
          [Op.between]: [todayStart, todayEnd]
        }
      },
      group: ['lead_id'],
      raw: true
    }).then(records => new Set(records.map(r => r.lead_id)));

    let todayPending = 0;
    const now = dayjs();

    // 计算今日还需跟进数据
    for (const lead of pendingLeads) {
      const intervalDays = configMap[lead.intention_level] || 7;

      // 获取最后跟进时间
      const lastFollowUpTime = latestFollowUpMap[lead.id];
      const lastFollowUp = lastFollowUpTime 
        ? dayjs(lastFollowUpTime)
        : dayjs(lead.lead_time);

      const diffDays = now.diff(lastFollowUp, 'day');
      const remainingDays = intervalDays - diffDays;

      // 如果今天需要跟进（remainingDays <= 0）且今天还没跟进
      if (remainingDays <= 0 && !todayFollowedLeadIds.has(lead.id)) {
        todayPending++;
      }
    }

    // 3. 统计用户已启用跟进的客户总数（与重点客户页面数据范围一致）
    const totalCustomersWhere = {
      enable_followup: 1,  // 已启用跟进
      end_followup: 0      // 未终结跟进
    };
    
    // 权限控制：非管理员只能看到自己跟进的客户
    if (userRole !== 'admin') {
      totalCustomersWhere.current_follower = userId;
    }

    const totalCustomersCount = await CustomerLead.count({
      where: totalCustomersWhere
    });

    return {
      todayCompleted: todayCompletedCount,          // 今日已跟进总数
      todayPending,             // 今日还需跟进数量
      total: totalCustomersCount // 用户已启用跟进的客户总数
    };

  } catch (error) {
    console.error('获取今日跟进统计失败:', error);
    return {
      todayCompleted: 0,
      todayPending: 0,
      total: 0
    };
  }
}

module.exports = { getTodayFollowUpStats };