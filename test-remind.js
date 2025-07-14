const sequelize = require('./config/db');
const initializeAssociations = require('./config/associations');
const { checkOverdueLeads } = require('./services/followupRemindChecker');

// 测试跟进提醒功能
async function testRemindFunction() {
  console.log('开始测试跟进提醒功能...');
  
  try {
    // 确保数据库连接
    await sequelize.authenticate();
    console.log('数据库连接成功');
    
    // 初始化模型关联关系
    initializeAssociations();
    
    // 执行检查
    const overdueList = await checkOverdueLeads();
    console.log('测试完成！');
    console.log(`发现 ${overdueList.length} 条超期线索`);
    
    if (overdueList.length > 0) {
      console.log('超期线索详情:');
      overdueList.forEach((item, index) => {
        console.log(`${index + 1}. ${item.customer_nickname} (${item.intention_level}意向) - 超期${item.overdue_days}天`);
      });
    }
  } catch (error) {
    console.error('测试失败:', error);
  } finally {
    // 关闭数据库连接
    await sequelize.close();
    console.log('数据库连接已关闭');
  }
}

// 运行测试
testRemindFunction(); 