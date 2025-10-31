const FollowupRemindConfig = require('../models/followupRemindConfig');

// 配置缓存
let configCache = null;
let cacheTimestamp = null;
const CACHE_DURATION = 5 * 60 * 1000; // 5分钟缓存

/**
 * 获取跟进配置（带缓存）
 * @returns {Object} 配置映射对象 {intention_level: interval_days}
 */
async function getFollowupConfigs() {
  const now = Date.now();
  
  // 检查缓存是否有效
  if (configCache && cacheTimestamp && (now - cacheTimestamp) < CACHE_DURATION) {
    return configCache;
  }
  
  try {
    // 从数据库获取配置
    const configs = await FollowupRemindConfig.findAll({
      attributes: ['intention_level', 'interval_days'],
      raw: true
    });
    
    // 构建配置映射
    const configMap = {};
    configs.forEach(config => {
      configMap[config.intention_level] = config.interval_days;
    });
    
    // 更新缓存
    configCache = configMap;
    cacheTimestamp = now;
    
    console.log('跟进配置已更新到缓存:', configMap);
    return configMap;
    
  } catch (error) {
    console.error('获取跟进配置失败:', error);
    
    // 如果数据库查询失败，返回旧缓存或默认配置
    if (configCache) {
      console.log('使用旧缓存配置');
      return configCache;
    }
    
    // 返回默认配置
    const defaultConfig = {
      '高': 3,
      '中': 7,
      '低': 14
    };
    console.log('使用默认配置:', defaultConfig);
    return defaultConfig;
  }
}

/**
 * 清除配置缓存（当配置更新时调用）
 */
function clearConfigCache() {
  configCache = null;
  cacheTimestamp = null;
  console.log('配置缓存已清除');
}

/**
 * 获取特定意向等级的跟进间隔天数
 * @param {string} intentionLevel 意向等级
 * @returns {number} 跟进间隔天数
 */
async function getFollowupInterval(intentionLevel) {
  const configs = await getFollowupConfigs();
  return configs[intentionLevel] || 7; // 默认7天
}

module.exports = {
  getFollowupConfigs,
  clearConfigCache,
  getFollowupInterval
};