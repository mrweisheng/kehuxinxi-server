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
    pool: {
      max: 10,      // 最大连接数
      min: 0,       // 最小连接数
      acquire: 30000, // 连接超时时间
      idle: 60000,    // 空闲超时时间
      evict: 60000,   // 连接清理间隔
    },
    retry: {
      max: 5 // 失败重试次数
    },
    dialectOptions: {
      connectTimeout: 60000 // 只保留这个有效参数
    }
  }
);

// 健壮性增强：自动重连
async function connectWithRetry() {
  try {
    await sequelize.authenticate();
    console.log('数据库连接成功');
  } catch (err) {
    console.error('数据库连接失败，5秒后重试', err);
    setTimeout(connectWithRetry, 5000);
  }
}

// 监听连接事件
sequelize.addHook('beforeConnect', async (config) => {
  console.log('正在连接数据库...');
});

sequelize.addHook('afterConnect', async (connection) => {
  console.log('数据库连接已建立');
});

connectWithRetry();

module.exports = sequelize; 