const { Op } = require('sequelize');
const dayjs = require('dayjs');
const CustomerLead = require('../models/leadModel');
const FollowUpRecord = require('../models/followupModel');
const FollowupRemindConfig = require('../models/followupRemindConfig');
const RemindEmailList = require('../models/remindEmailList');
const { sendMail } = require('../utils/emailSender');
const cron = require('node-cron');
const dotenv = require('dotenv');
dotenv.config();
const User = require('../models/user');

// 检查所有意向级别的超期线索并发送邮件
async function checkOverdueLeads() {
  let transaction;
  try {
    console.log('🔄 开始检查超期线索...');
    
    // 获取数据库连接
    const sequelize = require('../config/db');
    
    // 检查数据库连接
    try {
      await sequelize.authenticate();
      console.log('✅ 数据库连接正常');
    } catch (dbError) {
      console.error('❌ 数据库连接失败，跳过本次检查:', dbError.message);
      return [];
    }
    
    transaction = await sequelize.transaction();
    
    const configs = await FollowupRemindConfig.findAll({ transaction });
    const emailRecords = await RemindEmailList.findAll({ transaction });
    
    if (emailRecords.length === 0) {
      console.log('⚠️ 没有配置收件人邮箱，跳过邮件发送');
      await transaction.commit();
      return [];
    }
    
    const globalEmailList = emailRecords.map(e => e.email);
    const now = dayjs();
    
    // 先将所有启用跟进且未终结线索的need_followup重置为0
    await CustomerLead.update({ need_followup: 0 }, { 
      where: { end_followup: 0, enable_followup: 1 },
      transaction 
    });
    
    let overdueList = [];

    for (const config of configs) {
      try {
        // 查找该意向级别所有启用跟进且未终结的线索及其最新跟进时间
        const leads = await CustomerLead.findAll({
          where: { intention_level: config.intention_level, end_followup: 0, enable_followup: 1 },
          attributes: ['id', 'customer_nickname', 'intention_level', 'lead_time', 'follow_up_person', 'contact_account'],
          include: [{
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
          }],
          transaction
        });
        
        console.log(`📊 检查 ${config.intention_level} 意向等级，找到 ${leads.length} 条线索`);
        
        for (const lead of leads) {
          try {
            const leadData = lead.toJSON();
            const lastFollowUpObj = leadData.followUps && leadData.followUps.length > 0 ? leadData.followUps[0] : null;
            const lastFollowUp = lastFollowUpObj ? lastFollowUpObj.follow_up_time : null;
            const lastFollowUpContent = lastFollowUpObj ? lastFollowUpObj.follow_up_content : null;
            const lastTime = lastFollowUp ? dayjs(lastFollowUp) : dayjs(leadData.lead_time);
            const diffDays = now.diff(lastTime, 'day');
            
            if (diffDays >= config.interval_days) {
              overdueList.push({
                lead_id: leadData.id,
                customer_nickname: leadData.customer_nickname,
                intention_level: leadData.intention_level,
                last_follow_up_time: lastFollowUp || leadData.lead_time,
                last_follow_up_content: lastFollowUpContent,
                contact_account: leadData.contact_account,
                follow_up_person: leadData.follow_up_person,
                overdue_days: diffDays,
                config_days: config.interval_days,
                email_list: globalEmailList
              });
            }
          } catch (leadError) {
            console.error(`❌ 处理线索 ${lead.id} 时出错:`, leadError.message);
            continue; // 跳过这条线索，继续处理其他线索
          }
        }
      } catch (configError) {
        console.error(`❌ 处理 ${config.intention_level} 意向等级时出错:`, configError.message);
        continue; // 跳过这个意向等级，继续处理其他等级
      }
    }
    
    // 对所有超期线索批量设置need_followup=1
    const overdueIds = overdueList.map(item => item.lead_id);
    if (overdueIds.length > 0) {
      await CustomerLead.update({ need_followup: 1 }, { 
        where: { id: overdueIds },
        transaction 
      });
      console.log(`✅ 已标记 ${overdueIds.length} 条超期线索`);
    }

    // 提交事务
    await transaction.commit();

    // 如果有超期线索，发送邮件提醒
    if (overdueList.length > 0) {
      try {
        await sendOverdueRemindEmail(overdueList, globalEmailList);
        console.log(`📧 发现 ${overdueList.length} 条超期线索，已发送邮件提醒`);
      } catch (emailError) {
        console.error('❌ 发送超期提醒邮件失败:', emailError.message);
        // 邮件失败不影响主流程
      }
    } else {
      console.log('✅ 无超期线索');
    }
    
    console.log('✅ 超期线索检查完成');
    return overdueList;
    
  } catch (error) {
    if (transaction) {
      try {
        await transaction.rollback();
      } catch (rollbackError) {
        console.error('❌ 事务回滚失败:', rollbackError.message);
      }
    }
    
    console.error('❌ 检查超期线索时出错:', error.message);
    
    // 如果是连接错误，记录详细信息
    if (error.name === 'SequelizeConnectionError') {
      console.error('🔗 数据库连接错误详情:', {
        code: error.parent?.code,
        errno: error.parent?.errno,
        sqlState: error.parent?.sqlState,
        sqlMessage: error.parent?.sqlMessage
      });
    }
    
    // 不再throw，避免服务崩溃
    return [];
  }
}

// 发送超期提醒邮件
async function sendOverdueRemindEmail(overdueList, emailList) {
  try {
    // 按意向等级分组
    const groupedByLevel = {};
    overdueList.forEach(item => {
      if (!groupedByLevel[item.intention_level]) {
        groupedByLevel[item.intention_level] = [];
      }
      groupedByLevel[item.intention_level].push(item);
    });
    
    // 生成邮件内容
    let htmlContent = `
      <h2>客户跟进超期提醒</h2>
      <p>以下客户已超过配置的跟进时间，请及时跟进：</p>
    `;
    
    let textContent = '客户跟进超期提醒\n\n以下客户已超过配置的跟进时间，请及时跟进：\n\n';
    
    for (const [level, items] of Object.entries(groupedByLevel)) {
      htmlContent += `<h3>${level}意向等级客户 (${items.length}条)</h3>`;
      textContent += `${level}意向等级客户 (${items.length}条):\n`;
      
      // 表格头
      htmlContent += '<table border="1" cellpadding="6" style="border-collapse:collapse;margin-bottom:20px;">';
      htmlContent += '<tr style="background-color:#f5f5f5;"><th>客户昵称</th><th>联系方式</th><th>最后跟进时间</th><th>最后跟进内容</th><th>跟进人</th></tr>';
      
      items.forEach(item => {
        htmlContent += `<tr>`
          + `<td>${item.customer_nickname}</td>`
          + `<td>${item.contact_account || '无'}</td>`
          + `<td>${item.last_follow_up_time}</td>`
          + `<td>${item.last_follow_up_content || '无'}</td>`
          + `<td>${item.follow_up_person}</td>`
          + `</tr>`;
        textContent += `- 客户昵称：${item.customer_nickname}，联系方式：${item.contact_account || '无'}，最后跟进时间：${item.last_follow_up_time}，最后跟进内容：${item.last_follow_up_content || '无'}，跟进人：${item.follow_up_person}\n`;
      });
      htmlContent += '</table>';
      textContent += '\n';
    }
    
    htmlContent += '<p style="color: #666; font-size: 12px;">此邮件由系统自动发送，请及时处理。</p>';
    textContent += '\n此邮件由系统自动发送，请及时处理。';
    
    // 发送邮件
    await sendMail({
      to: emailList.join(','),
      subject: `客户跟进超期提醒 - ${overdueList.length}条线索需要跟进`,
      text: textContent,
      html: htmlContent
    });
    
    console.log(`超期提醒邮件已发送给 ${emailList.length} 个收件人`);
  } catch (error) {
    console.error('发送超期提醒邮件失败:', error);
    throw error;
  }
}

// 启动定时检查（项目启动时立即执行，后续每天5个固定时间点执行）
function startScheduledCheck() {
  // 项目启动时立即执行一次
  checkOverdueLeads();

  // 从环境变量读取定时表达式
  const cronTimes = process.env.REMIND_CRON_TIMES || '0 9 * * *,30 11 * * *,0 14 * * *,30 16 * * *,0 19 * * *';
  cronTimes.split(',').forEach(expr => {
    const cronExpr = expr.trim();
    if (cronExpr) {
      cron.schedule(cronExpr, () => {
        checkOverdueLeads();
      });
    }
  });
}

// 工具函数：根据线索ID自动更新need_followup字段
async function updateNeedFollowupByLeadId(leadId, transaction) {
  const lead = await CustomerLead.findByPk(leadId, { transaction });
  if (!lead) return;
  // 已终结线索直接设为0
  if (lead.end_followup === 1) {
    await CustomerLead.update({ need_followup: 0 }, { where: { id: leadId }, transaction });
    return;
  }
  const latestFollowUp = await FollowUpRecord.findOne({
    where: { lead_id: leadId },
    order: [['follow_up_time', 'DESC']],
    transaction
  });
  const lastTime = latestFollowUp ? dayjs(latestFollowUp.follow_up_time) : dayjs(lead.lead_time);
  const config = await FollowupRemindConfig.findOne({ where: { intention_level: lead.intention_level }, transaction });
  const interval = config ? config.interval_days : 3;
  const now = dayjs();
  const overdue = now.diff(lastTime, 'day') >= interval;
  await CustomerLead.update({ need_followup: overdue ? 1 : 0 }, { where: { id: leadId }, transaction });
}

module.exports = {
  checkOverdueLeads,
  sendOverdueRemindEmail,
  startScheduledCheck,
  updateNeedFollowupByLeadId
};