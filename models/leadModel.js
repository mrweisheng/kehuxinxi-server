const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

const CustomerLead = sequelize.define('customer_leads', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
    comment: '主键，自增ID'
  },
  customer_nickname: {
    type: DataTypes.STRING(100),
    allowNull: false,
    comment: '客户昵称'
  },
  source_platform: {
    type: DataTypes.STRING(50),
    allowNull: false,
    comment: '客户来源平台（如抖音、微信等）'
  },
  source_account: {
    type: DataTypes.STRING(100),
    allowNull: false,
    comment: '客户来源账号（如某抖音号、公众号等）'
  },
  contact_account: {
    type: DataTypes.STRING(100),
    allowNull: false,
    comment: '客户联系方式（手机号、微信号等）'
  },
  contact_name: {
    type: DataTypes.STRING(100),
    allowNull: true,
    comment: '联系名称（联系客户时给客户的名称备注）'
  },
  lead_time: {
    type: DataTypes.STRING(19),
    allowNull: false,
    comment: '进线索时间'
  },
  is_contacted: {
    type: DataTypes.TINYINT,
    allowNull: false,
    comment: '是否联系上（0=否，1=是）'
  },
  intention_level: {
    type: DataTypes.ENUM('高', '中', '低'),
    allowNull: false,
    comment: '意向等级'
  },
  follow_up_person: {
    type: DataTypes.STRING(50),
    allowNull: false,
    comment: '跟进人'
  },
  is_deal: {
    type: DataTypes.TINYINT,
    allowNull: false,
    comment: '是否成交（0=否，1=是）'
  },
  deal_date: {
    type: DataTypes.STRING(19),
    allowNull: true,
    comment: '成交日期，仅在成交时填写'
  },
  // 新增字段：当前周期是否需要跟进
  need_followup: {
    type: DataTypes.TINYINT,
    allowNull: false,
    defaultValue: 0,
    comment: '当前周期是否需要跟进（1=是，0=否）'
  },
  // 新增字段：是否终结跟进
  end_followup: {
    type: DataTypes.TINYINT,
    allowNull: false,
    defaultValue: 0,
    comment: '是否终结跟进（1=终结，0=未终结）'
  },
  // 新增字段：终结跟进原因
  end_followup_reason: {
    type: DataTypes.STRING(255),
    allowNull: true,
    comment: '终结跟进原因'
  },
  // 新增字段：当前跟进人用户ID
  current_follower: {
    type: DataTypes.INTEGER,
    allowNull: true,
    comment: '当前跟进人用户ID'
  },
  // 新增字段：登记人用户ID
  creator_user_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    comment: '登记人用户ID（创建该线索的人）'
  },
  // 新增字段：分配的跟进人用户ID
  assigned_user_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    comment: '分配的跟进人用户ID（负责跟进的销售）'
  },
  // 新增字段：是否启用跟进
  enable_followup: {
    type: DataTypes.TINYINT,
    allowNull: false,
    defaultValue: 0,
    comment: '是否启用跟进（1=启用，0=不启用）'
  },
  // 新增字段：当前跟进周期是否已完成跟进
  current_cycle_completed: {
    type: DataTypes.TINYINT,
    allowNull: false,
    defaultValue: 0,
    comment: '当前跟进周期是否已完成跟进（0=未完成，1=已完成）'
  },
  created_at: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW,
    comment: '创建时间'
  },
  updated_at: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW,
    comment: '更新时间'
  }
}, {
  tableName: 'customer_leads',
  timestamps: true, // 启用自动时间戳
  createdAt: 'created_at', // 指定创建时间字段名
  updatedAt: 'updated_at', // 指定更新时间字段名
  comment: '客资主表（线索表）'
});

// 关联关系在 config/associations.js 中统一管理
// 这里不再定义关联关系，避免重复定义

module.exports = CustomerLead;