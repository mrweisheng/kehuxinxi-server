const FollowupRemindConfig = require('../models/followupRemindConfig');
const { checkOverdueLeads } = require('../services/followupRemindChecker');

// 获取所有意向级别的提醒配置
exports.getAllConfigs = async (req, res) => {
  try {
    const configs = await FollowupRemindConfig.findAll({
      raw: true // 返回纯净的业务数据
    });
    res.json({ success: true, list: configs });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// 更新某个意向级别的提醒配置
exports.updateConfig = async (req, res) => {
  try {
    const { level } = req.params;
    const { interval_days } = req.body;
    if (!['高', '中', '低'].includes(level)) {
      return res.status(400).json({ success: false, message: '意向等级参数错误' });
    }
    if (!interval_days || isNaN(Number(interval_days)) || Number(interval_days) < 1) {
      return res.status(400).json({ success: false, message: '最大未跟进天数必须为正整数' });
    }
    const [updated] = await FollowupRemindConfig.update(
      { interval_days },
      { where: { intention_level: level } }
    );
    if (!updated) {
      return res.status(404).json({ success: false, message: '未找到该意向等级的配置' });
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// 手动触发跟进提醒检查
exports.triggerRemindCheck = async (req, res) => {
  const startTime = Date.now();
  try {
    const overdueList = await checkOverdueLeads();
    const totalTime = Date.now() - startTime;
    
    res.json({
      success: true,
      message: `检查完成，发现 ${overdueList.length} 条超期线索`,
      data: {
        overdue_count: overdueList.length,
        overdue_list: overdueList
      },
      performance: {
        totalTime: `${totalTime}ms`
      }
    });
  } catch (err) {
    const totalTime = Date.now() - startTime;
    console.error('手动触发跟进提醒检查失败:', err);
    res.status(500).json({
      success: false,
      message: err.message,
      performance: {
        totalTime: `${totalTime}ms`
      }
    });
  }
}; 