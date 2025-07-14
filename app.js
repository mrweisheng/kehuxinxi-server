const express = require('express');
const bodyParser = require('body-parser');
const dotenv = require('dotenv');
const sequelize = require('./config/db');
const initializeAssociations = require('./config/associations');
const { formatAllDates } = require('./utils/formatDate');
const { checkOverdueLeads, startScheduledCheck } = require('./services/followupRemindChecker');

// 加载环境变量
dotenv.config();

const app = express();

// 允许所有跨域
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// 全局自动格式化所有API响应中的时间字段
const oldJson = res => res.json;
app.use((req, res, next) => {
  const originJson = res.json.bind(res);
  res.json = function (data) {
    const formatted = formatAllDates(data);
    return originJson(formatted);
  };
  next();
});

app.use(bodyParser.json());

// 路由
const leadRoutes = require('./routes/leadRoutes');
app.use('/api/leads', leadRoutes);
const followupRoutes = require('./routes/followupRoutes');
app.use('/api/followups', followupRoutes);
const logRoutes = require('./routes/logRoutes');
app.use('/api/logs', logRoutes);
const remindConfigRoutes = require('./routes/followupRemindConfigRoutes');
app.use('/api/followup-remind-config', remindConfigRoutes);
const remindEmailListRoutes = require('./routes/remindEmailListRoutes');
app.use('/api/remind-email-list', remindEmailListRoutes);
const statisticsRoutes = require('./routes/statisticsRoutes');
app.use('/api/statistics', statisticsRoutes);

// 测试数据库连接并启动服务
const PORT = process.env.PORT || 9527;
(async () => {
  try {
    await sequelize.authenticate();
    console.log('数据库连接成功');
    
    // 初始化模型关联关系
    initializeAssociations();
    
    app.listen(PORT, () => {
      console.log(`服务已启动，端口：${PORT}`);
      // 启动时立即执行一次超期检测
      checkOverdueLeads();
      // 启动跟进提醒定时检查
      startScheduledCheck();
    });
  } catch (err) {
    console.error('数据库连接失败:', err);
  }
})(); 