const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

const FollowUpRecord = sequelize.define('follow_up_records', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
    comment: '主键，自增ID'
  },
  lead_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    comment: '关联的客资ID'
  },
  follow_up_time: {
    type: DataTypes.STRING(19),
    allowNull: false,
    comment: '跟进时间'
  },
  follow_up_method: {
    type: DataTypes.STRING(50),
    allowNull: false,
    comment: '跟进方式（如电话、微信、线下等）'
  },
  follow_up_content: {
    type: DataTypes.TEXT,
    allowNull: true,
    comment: '跟进内容/备注'
  },
  follow_up_result: {
    type: DataTypes.STRING(100),
    allowNull: true,
    comment: '跟进结果/状态'
  },
  follow_up_person_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    comment: '跟进人用户ID'
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
  tableName: 'follow_up_records',
  timestamps: true, // 启用自动时间戳
  createdAt: 'created_at', // 指定创建时间字段名
  updatedAt: 'updated_at', // 指定更新时间字段名
  comment: '跟进记录表'
});

// 定义关联关系
FollowUpRecord.associate = (models) => {
  FollowUpRecord.belongsTo(models.CustomerLead, {
    foreignKey: 'lead_id',
    as: 'lead'
  });
  
  // 添加与用户表的关联
  FollowUpRecord.belongsTo(models.User, {
    foreignKey: 'follow_up_person_id',
    as: 'followUpPerson'
  });
};

module.exports = FollowUpRecord; 