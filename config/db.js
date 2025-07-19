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
    logging: false, // 关闭SQL日志，减少输出
    pool: {
      max: 20,        // 增加最大连接数
      min: 5,         // 保持最小连接数
      acquire: 60000, // 增加连接获取超时时间
      idle: 300000,   // 增加空闲超时时间（5分钟）
      evict: 300000,  // 增加连接清理间隔
    },
    retry: {
      max: 10,        // 增加重试次数
      backoffBase: 1000, // 重试间隔基数
      backoffExponent: 1.5 // 重试间隔指数
    },
    dialectOptions: {
      connectTimeout: 60000,    // 连接超时
      acquireTimeout: 60000,    // 获取连接超时
      timeout: 60000,           // 查询超时
      charset: 'utf8mb4',       // 字符集
      supportBigNumbers: true,  // 支持大数字
      bigNumberStrings: true,   // 大数字转字符串
      // 连接保活设置
      keepAlive: true,
      keepAliveInitialDelay: 0,
      // 自动重连设置
      reconnect: true,
      // 连接池设置
      connectionLimit: 20,
      queueLimit: 0
    },
    // 查询超时设置
    query: {
      timeout: 60000
    }
  }
);

// 增强的自动重连机制
let reconnectAttempts = 0;
const maxReconnectAttempts = 10;

async function connectWithRetry() {
  try {
    await sequelize.authenticate();
    console.log('✅ 数据库连接成功');
    reconnectAttempts = 0; // 重置重连计数
  } catch (err) {
    reconnectAttempts++;
    console.error(`❌ 数据库连接失败 (第${reconnectAttempts}次尝试):`, err.message);
    
    if (reconnectAttempts < maxReconnectAttempts) {
      const delay = Math.min(1000 * Math.pow(1.5, reconnectAttempts - 1), 30000);
      console.log(`${delay}ms 后重试连接...`);
      setTimeout(connectWithRetry, delay);
    } else {
      console.error('❌ 数据库连接失败次数过多，停止重连');
      process.exit(1);
    }
  }
}

// 监听连接事件
sequelize.addHook('beforeConnect', async (config) => {
  console.log('🔄 正在连接数据库...');
});

sequelize.addHook('afterConnect', async (connection) => {
  console.log('✅ 数据库连接已建立');
});

// 监听连接错误
sequelize.addHook('afterDisconnect', async (connection) => {
  console.log('⚠️ 数据库连接已断开，尝试重连...');
  setTimeout(connectWithRetry, 5000);
});

// 定期检查连接状态
setInterval(async () => {
  try {
    await sequelize.authenticate();
  } catch (err) {
    console.error('⚠️ 数据库连接检查失败，尝试重连:', err.message);
    connectWithRetry();
  }
}, 300000); // 每5分钟检查一次

// 优雅关闭
process.on('SIGINT', async () => {
  console.log('正在关闭数据库连接...');
  await sequelize.close();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('正在关闭数据库连接...');
  await sequelize.close();
  process.exit(0);
});

connectWithRetry();

module.exports = sequelize; 