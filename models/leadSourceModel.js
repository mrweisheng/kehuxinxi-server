const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

const LeadSource = sequelize.define('LeadSource', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
    comment: '主键ID'
  },
  platform: {
    type: DataTypes.STRING(50),
    allowNull: false,
    comment: '平台名称，如抖音、视频号'
  },
  account: {
    type: DataTypes.STRING(100),
    allowNull: false,
    comment: '平台下的账号，如明哥两地牌'
  },
  description: {
    type: DataTypes.STRING(255),
    allowNull: true,
    comment: '描述信息'
  },
  is_active: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
    comment: '是否启用 (true: 启用, false: 禁用)'
  }
}, {
  tableName: 'lead_sources',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  comment: '线索来源配置表'
});

module.exports = LeadSource;
