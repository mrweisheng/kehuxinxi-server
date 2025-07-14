const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

const RemindEmailList = sequelize.define('remind_email_list', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true
  },
  email: {
    type: DataTypes.STRING(100),
    allowNull: false,
    unique: true,
    comment: '收件人邮箱'
  },
  updated_at: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW,
    comment: '更新时间'
  }
}, {
  tableName: 'remind_email_list',
  timestamps: false,
  comment: '超期提醒收件人列表'
});

module.exports = RemindEmailList; 