// 初始化模型关联关系
function initializeAssociations() {
  // 导入模型
  const CustomerLead = require('../models/leadModel');
  const FollowUpRecord = require('../models/followupModel');
  const OperationLog = require('../models/logModel');

  // 建立关联关系
  // CustomerLead 和 FollowUpRecord 的一对多关系
  CustomerLead.hasMany(FollowUpRecord, {
    foreignKey: 'lead_id',
    as: 'followUps',
    onDelete: 'CASCADE',
    onUpdate: 'CASCADE'
  });

  FollowUpRecord.belongsTo(CustomerLead, {
    foreignKey: 'lead_id',
    as: 'lead',
    onDelete: 'CASCADE',
    onUpdate: 'CASCADE'
  });

  // OperationLog 和 CustomerLead 的关联（可选）
  OperationLog.belongsTo(CustomerLead, {
    foreignKey: 'lead_id',
    as: 'lead',
    onDelete: 'SET NULL',
    onUpdate: 'CASCADE'
  });

  CustomerLead.hasMany(OperationLog, {
    foreignKey: 'lead_id',
    as: 'logs',
    onDelete: 'CASCADE',
    onUpdate: 'CASCADE'
  });

  console.log('模型关联关系初始化完成');
}

module.exports = initializeAssociations; 