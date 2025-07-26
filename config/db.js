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
      max: 20,        // 增加最大连接数
      min: 5,         // 增加最小连接数
      acquire: 120000, // 增加连接获取超时时间（2分钟）
      idle: 300000,   // 增加空闲超时时间（5分钟）
      evict: 300000,  // 增加连接清理间隔（5分钟）
    },
    retry: {
      max: 3,         // 减少重试次数
      backoffBase: 2000, // 增加重试间隔基数
      backoffExponent: 2 // 增加重试间隔指数
    },
    dialectOptions: {
      connectTimeout: 120000,   // 增加连接超时（2分钟）
      acquireTimeout: 120000,   // 增加获取连接超时（2分钟）
      timeout: 120000,          // 增加查询超时（2分钟）
      charset: 'utf8mb4',       // 字符集
      supportBigNumbers: true,  // 支持大数字
      bigNumberStrings: true,   // 大数字转字符串
      // 添加 keepAlive 相关配置
      enableKeepAlive: true,    // 启用 keepAlive
      keepAliveInitialDelay: 0  // keepAlive 初始延迟
    }
  }
);

// 优化重连机制
let reconnectAttempts = 0;
const maxReconnectAttempts = 3; // 减少最大重连次数
let reconnectTimer = null;

async function connectWithRetry() {
  try {
    await sequelize.authenticate();
    console.log('✅ 数据库连接成功');
    reconnectAttempts = 0; // 重置重连计数
  } catch (err) {
    reconnectAttempts++;
    console.error(`❌ 数据库连接失败 (第${reconnectAttempts}次尝试):`, err.message);
    
    if (reconnectAttempts < maxReconnectAttempts) {
      const delay = Math.min(5000 * Math.pow(2, reconnectAttempts - 1), 30000); // 增加延迟
      console.log(`${delay}ms 后重试连接...`);
      reconnectTimer = setTimeout(connectWithRetry, delay);
    } else {
      console.error('❌ 数据库连接失败次数过多，停止重连');
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

// 优化连接断开处理
sequelize.addHook('afterDisconnect', async (connection) => {
  console.log('⚠️ 数据库连接已断开');
  
  // 清除之前的重连定时器
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
  }
  
  // 延迟重连，避免频繁重连
  reconnectTimer = setTimeout(() => {
    if (reconnectAttempts < maxReconnectAttempts) {
      connectWithRetry();
    }
  }, 30000); // 30秒后重连
});

// 减少定期检查频率
setInterval(async () => {
  try {
    await sequelize.authenticate();
  } catch (err) {
    console.error('⚠️ 数据库连接检查失败:', err.message);
    // 只有在连接检查失败时才重连
    if (reconnectAttempts < maxReconnectAttempts) {
      connectWithRetry();
    }
  }
}, 900000); // 每15分钟检查一次

// 优雅关闭
process.on('SIGINT', async () => {
  console.log('正在关闭数据库连接...');
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
  }
  await sequelize.close();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('正在关闭数据库连接...');
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
  }
  await sequelize.close();
  process.exit(0);
});

connectWithRetry();

module.exports = sequelize; 