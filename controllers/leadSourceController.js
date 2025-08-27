const LeadSource = require('../models/leadSourceModel');

// 获取线索来源列表（按平台分组）
exports.getLeadSources = async (req, res) => {
  const startTime = Date.now();
  
  try {
    const dbStartTime = Date.now();
    
    // 查询所有启用的线索来源
    const sources = await LeadSource.findAll({
      where: { is_active: true },
      order: [
        ['platform', 'ASC'],
        ['account', 'ASC']
      ],
      attributes: ['id', 'platform', 'account', 'description']
    });
    
    const dbEndTime = Date.now();
    
    // 按平台分组数据
    const groupedData = {};
    sources.forEach(source => {
      const platform = source.platform;
      if (!groupedData[platform]) {
        groupedData[platform] = [];
      }
      groupedData[platform].push({
        id: source.id,
        account: source.account,
        description: source.description
      });
    });
    
    const totalTime = Date.now() - startTime;
    const dbTime = dbEndTime - dbStartTime;
    
    console.log(`获取线索来源完成 - 总耗时: ${totalTime}ms, 数据库操作耗时: ${dbTime}ms`);
    
    res.json({
      success: true,
      data: groupedData,
      performance: {
        totalTime: `${totalTime}ms`,
        dbTime: `${dbTime}ms`
      }
    });
    
  } catch (error) {
    console.error('获取线索来源失败:', error);
    const totalTime = Date.now() - startTime;
    res.status(500).json({
      success: false,
      message: '获取线索来源失败',
      error: error.message,
      performance: {
        totalTime: `${totalTime}ms`
      }
    });
  }
};

// 获取所有平台列表
exports.getPlatforms = async (req, res) => {
  const startTime = Date.now();
  
  try {
    const dbStartTime = Date.now();
    
    // 查询所有唯一的平台
    const platforms = await LeadSource.findAll({
      where: { is_active: true },
      attributes: [
        [LeadSource.sequelize.fn('DISTINCT', LeadSource.sequelize.col('platform')), 'platform']
      ],
      order: [['platform', 'ASC']],
      raw: true
    });
    
    const dbEndTime = Date.now();
    
    const platformList = platforms.map(item => item.platform);
    
    const totalTime = Date.now() - startTime;
    const dbTime = dbEndTime - dbStartTime;
    
    console.log(`获取平台列表完成 - 总耗时: ${totalTime}ms, 数据库操作耗时: ${dbTime}ms`);
    
    res.json({
      success: true,
      data: platformList,
      performance: {
        totalTime: `${totalTime}ms`,
        dbTime: `${dbTime}ms`
      }
    });
    
  } catch (error) {
    console.error('获取平台列表失败:', error);
    const totalTime = Date.now() - startTime;
    res.status(500).json({
      success: false,
      message: '获取平台列表失败',
      error: error.message,
      performance: {
        totalTime: `${totalTime}ms`
      }
    });
  }
};

// 根据平台获取账号列表
exports.getAccountsByPlatform = async (req, res) => {
  const startTime = Date.now();
  
  try {
    const { platform } = req.params;
    
    if (!platform) {
      const totalTime = Date.now() - startTime;
      return res.status(400).json({
        success: false,
        message: '平台参数不能为空',
        performance: {
          totalTime: `${totalTime}ms`
        }
      });
    }
    
    const dbStartTime = Date.now();
    
    // 查询指定平台下的所有账号
    const accounts = await LeadSource.findAll({
      where: { 
        platform: platform,
        is_active: true 
      },
      attributes: ['id', 'account', 'description'],
      order: [['account', 'ASC']]
    });
    
    const dbEndTime = Date.now();
    
    const accountList = accounts.map(item => ({
      id: item.id,
      account: item.account,
      description: item.description
    }));
    
    const totalTime = Date.now() - startTime;
    const dbTime = dbEndTime - dbStartTime;
    
    console.log(`获取平台账号列表完成 - 平台: ${platform}, 总耗时: ${totalTime}ms, 数据库操作耗时: ${dbTime}ms`);
    
    res.json({
      success: true,
      data: {
        platform: platform,
        accounts: accountList
      },
      performance: {
        totalTime: `${totalTime}ms`,
        dbTime: `${dbTime}ms`
      }
    });
    
  } catch (error) {
    console.error('获取平台账号列表失败:', error);
    const totalTime = Date.now() - startTime;
    res.status(500).json({
      success: false,
      message: '获取平台账号列表失败',
      error: error.message,
      performance: {
        totalTime: `${totalTime}ms`
      }
    });
  }
};

// 新增平台
exports.createPlatform = async (req, res) => {
  const startTime = Date.now();
  
  try {
    const { platform, description } = req.body;
    
    if (!platform) {
      const totalTime = Date.now() - startTime;
      return res.status(400).json({
        success: false,
        message: '平台名称不能为空',
        performance: {
          totalTime: `${totalTime}ms`
        }
      });
    }
    
    const dbStartTime = Date.now();
    
    // 检查平台是否已存在
    const existingPlatform = await LeadSource.findOne({
      where: { platform: platform },
      attributes: ['platform']
    });
    
    if (existingPlatform) {
      const totalTime = Date.now() - startTime;
      return res.status(400).json({
        success: false,
        message: '平台名称已存在',
        performance: {
          totalTime: `${totalTime}ms`
        }
      });
    }
    
    // 创建平台（创建一个默认账号）
    const newPlatform = await LeadSource.create({
      platform: platform,
      account: '默认账号',
      description: description || `${platform}平台-默认账号`
    });
    
    const dbEndTime = Date.now();
    const totalTime = Date.now() - startTime;
    const dbTime = dbEndTime - dbStartTime;
    
    console.log(`新增平台完成 - 平台: ${platform}, 总耗时: ${totalTime}ms, 数据库操作耗时: ${dbTime}ms`);
    
    res.json({
      success: true,
      message: '平台创建成功',
      data: {
        id: newPlatform.id,
        platform: newPlatform.platform,
        account: newPlatform.account,
        description: newPlatform.description
      },
      performance: {
        totalTime: `${totalTime}ms`,
        dbTime: `${dbTime}ms`
      }
    });
    
  } catch (error) {
    console.error('新增平台失败:', error);
    const totalTime = Date.now() - startTime;
    res.status(500).json({
      success: false,
      message: '新增平台失败',
      error: error.message,
      performance: {
        totalTime: `${totalTime}ms`
      }
    });
  }
};

// 新增账号
exports.createAccount = async (req, res) => {
  const startTime = Date.now();
  
  try {
    const { platform, account, description } = req.body;
    
    if (!platform || !account) {
      const totalTime = Date.now() - startTime;
      return res.status(400).json({
        success: false,
        message: '平台名称和账号名称不能为空',
        performance: {
          totalTime: `${totalTime}ms`
        }
      });
    }
    
    const dbStartTime = Date.now();
    
    // 检查平台和账号组合是否已存在
    const existingAccount = await LeadSource.findOne({
      where: { 
        platform: platform,
        account: account
      },
      attributes: ['platform', 'account']
    });
    
    if (existingAccount) {
      const totalTime = Date.now() - startTime;
      return res.status(400).json({
        success: false,
        message: '该平台下已存在相同账号',
        performance: {
          totalTime: `${totalTime}ms`
        }
      });
    }
    
    // 创建账号
    const newAccount = await LeadSource.create({
      platform: platform,
      account: account,
      description: description || `${platform}平台-${account}账号`
    });
    
    const dbEndTime = Date.now();
    const totalTime = Date.now() - startTime;
    const dbTime = dbEndTime - dbStartTime;
    
    console.log(`新增账号完成 - 平台: ${platform}, 账号: ${account}, 总耗时: ${totalTime}ms, 数据库操作耗时: ${dbTime}ms`);
    
    res.json({
      success: true,
      message: '账号创建成功',
      data: {
        id: newAccount.id,
        platform: newAccount.platform,
        account: newAccount.account,
        description: newAccount.description
      },
      performance: {
        totalTime: `${totalTime}ms`,
        dbTime: `${dbTime}ms`
      }
    });
    
  } catch (error) {
    console.error('新增账号失败:', error);
    const totalTime = Date.now() - startTime;
    res.status(500).json({
      success: false,
      message: '新增账号失败',
      error: error.message,
      performance: {
        totalTime: `${totalTime}ms`
      }
    });
  }
};

// 删除账号
exports.deleteAccount = async (req, res) => {
  const startTime = Date.now();
  
  try {
    const { id } = req.params;
    
    if (!id) {
      const totalTime = Date.now() - startTime;
      return res.status(400).json({
        success: false,
        message: '账号ID不能为空',
        performance: {
          totalTime: `${totalTime}ms`
        }
      });
    }
    
    const dbStartTime = Date.now();
    
    // 查找账号
    const account = await LeadSource.findByPk(id);
    
    if (!account) {
      const totalTime = Date.now() - startTime;
      return res.status(404).json({
        success: false,
        message: '账号不存在',
        performance: {
          totalTime: `${totalTime}ms`
        }
      });
    }
    
    // 检查是否为默认账号（不允许删除）
    if (account.account === '默认账号') {
      const totalTime = Date.now() - startTime;
      return res.status(400).json({
        success: false,
        message: '不能删除默认账号',
        performance: {
          totalTime: `${totalTime}ms`
        }
      });
    }
    
    // 检查是否有线索使用该账号
    const CustomerLead = require('../models/leadModel');
    const leadCount = await CustomerLead.count({
      where: {
        source_platform: account.platform,
        source_account: account.account
      }
    });
    
    if (leadCount > 0) {
      const totalTime = Date.now() - startTime;
      return res.status(400).json({
        success: false,
        message: `该账号下还有 ${leadCount} 条线索，无法删除`,
        performance: {
          totalTime: `${totalTime}ms`
        }
      });
    }
    
    // 删除账号
    await account.destroy();
    
    const dbEndTime = Date.now();
    const totalTime = Date.now() - startTime;
    const dbTime = dbEndTime - dbStartTime;
    
    console.log(`删除账号完成 - ID: ${id}, 平台: ${account.platform}, 账号: ${account.account}, 总耗时: ${totalTime}ms, 数据库操作耗时: ${dbTime}ms`);
    
    res.json({
      success: true,
      message: '账号删除成功',
      data: {
        id: parseInt(id),
        platform: account.platform,
        account: account.account
      },
      performance: {
        totalTime: `${totalTime}ms`,
        dbTime: `${dbTime}ms`
      }
    });
    
  } catch (error) {
    console.error('删除账号失败:', error);
    const totalTime = Date.now() - startTime;
    res.status(500).json({
      success: false,
      message: '删除账号失败',
      error: error.message,
      performance: {
        totalTime: `${totalTime}ms`
      }
    });
  }
};
