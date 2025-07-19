const sequelize = require('./config/db');

// 数据库连接监控
async function monitorDatabaseConnection() {
  console.log('🔍 开始监控数据库连接...');
  
  // 测试连接
  try {
    await sequelize.authenticate();
    console.log('✅ 数据库连接正常');
    
    // 测试查询
    const result = await sequelize.query('SELECT 1 as test');
    console.log('✅ 数据库查询正常');
    
    // 获取连接池状态
    const pool = sequelize.connectionManager.pool;
    console.log('📊 连接池状态:', {
      size: pool.size,
      available: pool.available,
      pending: pool.pending,
      borrowed: pool.borrowed
    });
    
  } catch (error) {
    console.error('❌ 数据库连接测试失败:', error.message);
    
    if (error.name === 'SequelizeConnectionError') {
      console.error('🔗 连接错误详情:', {
        code: error.parent?.code,
        errno: error.parent?.errno,
        sqlState: error.parent?.sqlState,
        sqlMessage: error.parent?.sqlMessage
      });
    }
  }
}

// 定期监控
function startMonitoring() {
  console.log('🔄 启动数据库连接监控...');
  
  // 立即执行一次
  monitorDatabaseConnection();
  
  // 每30秒检查一次
  setInterval(monitorDatabaseConnection, 30000);
  
  // 监听连接事件
  sequelize.addHook('afterConnect', () => {
    console.log('✅ 数据库连接已建立');
  });
  
  sequelize.addHook('afterDisconnect', () => {
    console.log('⚠️ 数据库连接已断开');
  });
  
  sequelize.addHook('afterDestroy', () => {
    console.log('🗑️ 数据库连接已销毁');
  });
}

// 如果直接运行此脚本
if (require.main === module) {
  startMonitoring();
  
  // 优雅关闭
  process.on('SIGINT', async () => {
    console.log('正在关闭监控...');
    await sequelize.close();
    process.exit(0);
  });
}

module.exports = { monitorDatabaseConnection, startMonitoring }; 