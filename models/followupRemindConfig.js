const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

const FollowupRemindConfig = sequelize.define('followup_remind_config', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true
  },
  intention_level: {
    type: DataTypes.ENUM('高', '中', '低'),
    allowNull: false,
    unique: true,
    comment: '意向等级'
  },
  interval_days: {
    type: DataTypes.INTEGER,
    allowNull: false,
    comment: '最大未跟进天数'
  },
  updated_at: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW,
    comment: '更新时间'
  }
}, {
  tableName: 'followup_remind_config',
  timestamps: false,
  comment: '跟进超期提醒配置'
});

module.exports = FollowupRemindConfig; 