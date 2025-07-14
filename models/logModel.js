const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

const OperationLog = sequelize.define('operation_logs', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
    comment: '主键，自增ID'
  },
  operation_time: {
    type: DataTypes.DATE,
    allowNull: false,
    comment: '操作时间'
  },
  operation_type: {
    type: DataTypes.STRING(50),
    allowNull: false,
    comment: '操作类型（新增、修改、删除、跟进等）'
  },
  operation_content: {
    type: DataTypes.TEXT,
    allowNull: true,
    comment: '操作内容/详情'
  },
  lead_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    comment: '关联的客资ID（如涉及某条线索则记录）'
  }
}, {
  tableName: 'operation_logs',
  timestamps: false,
  comment: '操作日志表'
});

module.exports = OperationLog; 