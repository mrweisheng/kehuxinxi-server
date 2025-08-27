const { Sequelize } = require('sequelize');
require('dotenv').config();

const sequelize = new Sequelize(
  process.env.DB_NAME,
  process.env.DB_USER,
  process.env.DB_PASSWORD,
  {
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    dialect: 'mysql',
    dialectModule: require('mysql2'), // 明确指定使用 mysql2
    logging: false, // 关闭SQL日志，减少输出
    pool: {
      max: 20,
      min: 5,
      acquire: 120000,
      idle: 300000,
      evict: 300000,
    },
    retry: {
      max: 3,
      backoffBase: 2000,
      backoffExponent: 2
    },
    dialectOptions: {
      connectTimeout: 120000,
      charset: 'utf8mb4',
      supportBigNumbers: true,
      bigNumberStrings: true,
      enableKeepAlive: true,
      keepAliveInitialDelay: 0
    }
  }
);

module.exports = sequelize;