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
      max: 10,        // 合理的最大连接数
      min: 2,         // 保持最小连接数
      acquire: 60000, // 连接获取超时时间
      idle: 60000,    // 空闲超时时间（1分钟，避免过长）
      evict: 60000,   // 连接清理间隔（1分钟）
    },
    retry: {
      max: 5,         // 合理的重试次数
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
      // 移除无效的 keepAlive 配置
      // keepAlive: true,  // MySQL2 不支持此参数
      // keepAliveInitialDelay: 0  // 删除无效配置
    }
  }
);

// 增强的自动重连机制
let reconnectAttempts = 0;
const maxReconnectAttempts = 5; // 减少最大重连次数

async function connectWithRetry() {
  try {
    await sequelize.authenticate();
    console.log('✅ 数据库连接成功');
    reconnectAttempts = 0; // 重置重连计数
  } catch (err) {
    reconnectAttempts++;
    console.error(`❌ 数据库连接失败 (第${reconnectAttempts}次尝试):`, err.message);
    
    if (reconnectAttempts < maxReconnectAttempts) {
      const delay = Math.min(2000 * Math.pow(1.5, reconnectAttempts - 1), 15000); // 增加延迟，减少重连频率
      console.log(`${delay}ms 后重试连接...`);
      setTimeout(connectWithRetry, delay);
    } else {
      console.error('❌ 数据库连接失败次数过多，停止重连');
      // 不要直接退出进程，让应用继续运行
      // process.exit(1);
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

// 监听连接错误，减少重连频率
sequelize.addHook('afterDisconnect', async (connection) => {
  console.log('⚠️ 数据库连接已断开');
  // 延迟重连，避免频繁重连
  setTimeout(() => {
    if (reconnectAttempts < maxReconnectAttempts) {
      connectWithRetry();
    }
  }, 10000); // 10秒后重连
});

// 定期检查连接状态，减少检查频率
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
}, 600000); // 每10分钟检查一次，减少检查频率

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