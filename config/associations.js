// 初始化模型关联关系
function initializeAssociations() {
  // 导入模型
  const CustomerLead = require('../models/leadModel');
  const FollowUpRecord = require('../models/followupModel');
  const OperationLog = require('../models/logModel');
  const User = require('../models/user');
  const OcrTaskRecord = require('../models/ocrTaskRecordModel');

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

  // FollowUpRecord 和 User 的关联关系
  FollowUpRecord.belongsTo(User, {
    foreignKey: 'follow_up_person_id',
    as: 'followUpPerson',
    onDelete: 'RESTRICT',
    onUpdate: 'CASCADE'
  });

  User.hasMany(FollowUpRecord, {
    foreignKey: 'follow_up_person_id',
    as: 'followUpRecords',
    onDelete: 'RESTRICT',
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

  // CustomerLead 和 User 的关联关系
  // 当前跟进人关联
  CustomerLead.belongsTo(User, {
    foreignKey: 'current_follower',
    as: 'currentFollowerUser'
  });

  // 登记人关联
  CustomerLead.belongsTo(User, {
    foreignKey: 'creator_user_id',
    as: 'creatorUser'
  });

  // 分配的跟进人关联
  CustomerLead.belongsTo(User, {
    foreignKey: 'assigned_user_id',
    as: 'assignedUser'
  });

  // User 的反向关联
  User.hasMany(CustomerLead, {
    foreignKey: 'current_follower',
    as: 'currentFollowerLeads'
  });

  User.hasMany(CustomerLead, {
    foreignKey: 'creator_user_id',
    as: 'createdLeads'
  });

  User.hasMany(CustomerLead, {
    foreignKey: 'assigned_user_id',
    as: 'assignedLeads'
  });

  // OCR任务记录和用户的关联关系
  OcrTaskRecord.belongsTo(User, {
    foreignKey: 'operator_user_id',
    as: 'operator',
    onDelete: 'SET NULL',
    onUpdate: 'CASCADE'
  });

  User.hasMany(OcrTaskRecord, {
    foreignKey: 'operator_user_id',
    as: 'ocrTasks',
    onDelete: 'SET NULL',
    onUpdate: 'CASCADE'
  });

  console.log('模型关联关系初始化完成');
}

module.exports = initializeAssociations;