const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

const User = sequelize.define('User', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
    allowNull: false,
    comment: '主键，自增ID',
  },
  username: {
    type: DataTypes.STRING(50),
    allowNull: false,
    unique: true,
    comment: '用户名，唯一',
  },
  password: {
    type: DataTypes.STRING(255),
    allowNull: false,
    comment: '密码（加密存储）',
  },
  nickname: {
    type: DataTypes.STRING(50),
    allowNull: true,
    comment: '昵称',
  },
  role: {
    type: DataTypes.STRING(20),
    allowNull: true,
    defaultValue: 'user',
    comment: '角色（user/admin等）',
  },
  created_at: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW,
    comment: '创建时间',
  },
  updated_at: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW,
    comment: '更新时间',
  },
}, {
  tableName: 'users',
  timestamps: false,
});

module.exports = User; 