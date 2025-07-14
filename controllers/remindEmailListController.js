const RemindEmailList = require('../models/remindEmailList');

// 获取所有收件人邮箱
exports.getEmailList = async (req, res) => {
  try {
    const list = await RemindEmailList.findAll({ 
      attributes: ['id', 'email'],
      raw: true // 返回纯净的业务数据
    });
    res.json({ success: true, list });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// 新增收件人邮箱
exports.addEmail = async (req, res) => {
  try {
    const { email } = req.body;
    if (!email || typeof email !== 'string') {
      return res.status(400).json({ success: false, message: '邮箱不能为空' });
    }
    const exists = await RemindEmailList.findOne({ where: { email } });
    if (exists) {
      return res.status(400).json({ success: false, message: '该邮箱已存在' });
    }
    const record = await RemindEmailList.create({ email });
    res.json({ success: true, id: record.id });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// 删除收件人邮箱
exports.deleteEmail = async (req, res) => {
  try {
    const { id } = req.params;
    const deleted = await RemindEmailList.destroy({ where: { id } });
    if (!deleted) {
      return res.status(404).json({ success: false, message: '未找到该邮箱' });
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}; 