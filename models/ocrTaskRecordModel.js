const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

// OCR任务记录模型
const OcrTaskRecord = sequelize.define('OcrTaskRecord', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
    comment: '主键，自增ID'
  },
  task_id: {
    type: DataTypes.STRING(50),
    allowNull: false,
    unique: true,
    comment: '任务ID（对应OCR控制器中的taskId）'
  },
  file_name: {
    type: DataTypes.STRING(255),
    allowNull: false,
    comment: '上传的文件名'
  },
  file_size: {
    type: DataTypes.INTEGER,
    allowNull: false,
    comment: '文件大小（字节）'
  },
  file_type: {
    type: DataTypes.STRING(50),
    allowNull: false,
    comment: '文件类型（MIME类型）'
  },
  task_status: {
    type: DataTypes.ENUM('pending', 'processing', 'completed', 'failed'),
    allowNull: false,
    comment: '任务状态'
  },
  start_time: {
    type: DataTypes.DATE,
    allowNull: false,
    comment: '任务开始时间'
  },
  end_time: {
    type: DataTypes.DATE,
    allowNull: true,
    comment: '任务结束时间'
  },
  total_time_ms: {
    type: DataTypes.INTEGER,
    allowNull: true,
    comment: '总耗时（毫秒）'
  },
  api_call_time_ms: {
    type: DataTypes.INTEGER,
    allowNull: true,
    comment: 'AI API调用耗时（毫秒）'
  },
  base64_convert_time_ms: {
    type: DataTypes.INTEGER,
    allowNull: true,
    comment: '文件转换耗时（毫秒）'
  },
  customers_extracted: {
    type: DataTypes.INTEGER,
    allowNull: true,
    defaultValue: 0,
    comment: '提取到的客户数量'
  },
  customers_imported: {
    type: DataTypes.INTEGER,
    allowNull: true,
    defaultValue: 0,
    comment: '成功导入的客户数量'
  },
  customers_duplicated: {
    type: DataTypes.INTEGER,
    allowNull: true,
    defaultValue: 0,
    comment: '去重的客户数量'
  },
  customers_failed: {
    type: DataTypes.INTEGER,
    allowNull: true,
    defaultValue: 0,
    comment: '导入失败的客户数量'
  },
  extracted_data: {
    type: DataTypes.JSON,
    allowNull: true,
    comment: '提取到的客户数据（JSON格式）'
  },
  lead_time: {
    type: DataTypes.STRING(20),
    allowNull: true,
    comment: '线索时间（从OCR识别的客户名称中提取的时间信息）'
  },
  error_message: {
    type: DataTypes.TEXT,
    allowNull: true,
    comment: '错误信息（如果任务失败）'
  },
  error_details: {
    type: DataTypes.JSON,
    allowNull: true,
    comment: '详细错误信息（JSON格式，包含失败的具体客户和原因）'
  },
  created_at: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW,
    comment: '记录创建时间'
  },
  updated_at: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW,
    comment: '记录更新时间'
  }
}, {
  tableName: 'ocr_task_records',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  comment: 'OCR任务执行记录表',
  indexes: [
    {
      unique: true,
      fields: ['task_id']
    },
    {
      fields: ['task_status']
    },
    {
      fields: ['start_time']
    },
    {
      fields: ['created_at']
    }
  ]
});

module.exports = OcrTaskRecord;