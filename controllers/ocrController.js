const multer = require('multer');
const fs = require('fs');
const path = require('path');
const OpenAI = require('openai');
const { Op } = require('sequelize');
const OcrTaskRecord = require('../models/ocrTaskRecordModel');
const leadController = require('./leadController');
require('dotenv').config();

// 内存任务队列
const ocrTasks = new Map();

// 生成任务ID
const generateTaskId = () => {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
};

// 创建OCR任务记录
const createTaskRecord = async (taskId, fileInfo, startTime) => {
  try {
    await OcrTaskRecord.create({
      task_id: taskId,
      file_name: fileInfo.originalName,
      file_size: fileInfo.size,
      file_type: fileInfo.mimetype,
      task_status: 'pending',
      start_time: new Date(startTime)
    });
    console.log(`[OCR-${taskId}] 数据库记录已创建`);
  } catch (error) {
    console.error(`[OCR-${taskId}] 创建数据库记录失败:`, error);
  }
};

// 更新OCR任务记录
const updateTaskRecord = async (taskId, updateData) => {
  try {
    await OcrTaskRecord.update(updateData, {
      where: { task_id: taskId }
    });
    console.log(`[OCR-${taskId}] 数据库记录已更新:`, Object.keys(updateData));
  } catch (error) {
    console.error(`[OCR-${taskId}] 更新数据库记录失败:`, error);
  }
};

// 配置存储
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = './uploads/ocr';
    // 确保上传目录存在
    if (!fs.existsSync('./uploads')) {
      fs.mkdirSync('./uploads');
    }
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir);
    }
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    // 生成唯一文件名
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname);
    cb(null, file.fieldname + '-' + uniqueSuffix + ext);
  }
});

// 限制上传文件类型为图片
const fileFilter = (req, file, cb) => {
  const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('只允许上传图片文件（jpeg, png, gif, webp）'), false);
  }
};

// 配置multer
const upload = multer({ 
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024 // 限制文件大小为10MB
  },
  fileFilter: fileFilter
});

// 初始化OpenAI客户端（豆包API）
const openai = new OpenAI({
  apiKey: process.env.OCR_API_KEY,
  baseURL: process.env.OCR_BASE_URL,
});

// 将图片文件转换为base64
const imageToBase64 = (filePath) => {
  try {
    const imageBuffer = fs.readFileSync(filePath);
    return `data:image/${path.extname(filePath).slice(1)};base64,${imageBuffer.toString('base64')}`;
  } catch (error) {
    console.error('图片转换为base64失败:', error);
    throw new Error('图片处理失败');
  }
};

// 清理上传的临时文件
const cleanupTempFile = (filePath) => {
  // 检查文件是否存在
  if (fs.existsSync(filePath)) {
    fs.unlink(filePath, (err) => {
      if (err) {
        console.error('清理临时文件失败:', err);
      } else {
        console.log('临时文件已清理:', filePath);
      }
    });
  } else {
    console.log('临时文件不存在，无需清理:', filePath);
  }
};

// 从customer_name中提取日期部分
const extractDateFromCustomerName = (customerName) => {
  if (!customerName || typeof customerName !== 'string') {
    return null;
  }
  
  // 查找第一个斜杠的位置
  const slashIndex = customerName.indexOf('/');
  if (slashIndex === -1) {
    return null;
  }
  
  // 提取斜杠前的部分作为日期
  const datePart = customerName.substring(0, slashIndex).trim();
  return datePart;
};

// 严格校验客户名称格式
const validateCustomerNameFormat = (customerName) => {
  if (!customerName || typeof customerName !== 'string') {
    return { valid: false, error: '客户名称不能为空' };
  }
  
  // 去除首尾空格
  const trimmedName = customerName.trim();
  if (trimmedName.length === 0) {
    return { valid: false, error: '客户名称不能为空' };
  }
  
  // 检查是否包含斜杠
  const slashIndex = trimmedName.indexOf('/');
  if (slashIndex === -1) {
    return { valid: false, error: `客户名称格式错误，缺少斜杠分隔符: ${customerName}` };
  }
  
  // 检查斜杠位置（必须在第4位，即MMDD/格式）
  if (slashIndex !== 4) {
    return { valid: false, error: `客户名称格式错误，斜杠位置不正确，应为MMDD/客户昵称格式: ${customerName}` };
  }
  
  // 提取日期部分
  const datePart = trimmedName.substring(0, slashIndex);
  
  // 检查日期部分长度（必须是4位数字）
  if (datePart.length !== 4) {
    return { valid: false, error: `日期部分长度错误，应为4位数字: ${datePart}` };
  }
  
  // 检查日期部分是否为纯数字
  if (!/^\d{4}$/.test(datePart)) {
    return { valid: false, error: `日期部分必须为纯数字: ${datePart}` };
  }
  
  // 验证月份和日期的有效性
  const month = parseInt(datePart.substring(0, 2), 10);
  const day = parseInt(datePart.substring(2, 4), 10);
  
  if (month < 1 || month > 12) {
    return { valid: false, error: `月份无效: ${month}` };
  }
  
  if (day < 1 || day > 31) {
    return { valid: false, error: `日期无效: ${day}` };
  }
  
  // 检查斜杠后是否有内容
  const namePart = trimmedName.substring(slashIndex + 1);
  if (!namePart || namePart.trim().length === 0) {
    return { valid: false, error: `客户名称不能为空: ${customerName}` };
  }
  
  return { 
    valid: true, 
    datePart: datePart,
    namePart: namePart.trim(),
    fullName: trimmedName
  };
};

// 将MMDD格式转换为YYYY-MM-DD HH:mm:ss格式
const formatLeadTime = (mmdd) => {
  if (!mmdd || mmdd.length !== 4) {
    return null;
  }
  
  const month = mmdd.substring(0, 2);
  const day = mmdd.substring(2, 4);
  const currentYear = new Date().getFullYear();
  
  // 验证月份和日期的有效性
  const monthNum = parseInt(month, 10);
  const dayNum = parseInt(day, 10);
  
  if (monthNum < 1 || monthNum > 12 || dayNum < 1 || dayNum > 31) {
    return null;
  }
  
  return `${currentYear}-${month}-${day} 00:00:00`;
};

// 批量注册线索
const batchRegisterLeads = async (taskId, customers) => {
  const results = {
    total: customers.length,
    success: 0,
    failed: 0,
    duplicated: 0,
    errors: []
  };
  
  console.log(`[OCR-${taskId}] 开始批量注册线索，共 ${customers.length} 个客户`);
  
  for (let i = 0; i < customers.length; i++) {
    const customer = customers[i];
    const customerName = customer.customer_name;
    
    try {
      // 严格校验客户名称格式
      const validation = validateCustomerNameFormat(customerName);
      if (!validation.valid) {
        throw new Error(validation.error);
      }
      
      // 格式化日期
      const leadTime = formatLeadTime(validation.datePart);
      if (!leadTime) {
        throw new Error(`日期格式无效: ${validation.datePart}`);
      }
      
      // 构造线索数据
      const leadData = {
        customer_nickname: validation.fullName,
        source_platform: '视频号',
        source_account: '明哥揀粤港车',
        contact_account: validation.fullName,
        contact_name: validation.fullName,
        lead_time: leadTime,
        is_contacted: 1,  // 修改为：已联系
        intention_level: '低',  // 修改为：低意向
        is_deal: 0,
        follow_up_content: '首次联系',
        current_follower: 1
      };
      
      // 构造模拟的req和res对象
      const mockReq = {
        body: leadData,
        headers: { 'x-batch-mode': 'true' }
      };
      
      let responseData = null;
      let statusCode = 200;
      
      const mockRes = {
        json: (data) => {
          responseData = data;
          return mockRes;
        },
        status: (code) => {
          statusCode = code;
          return {
            json: (data) => {
              responseData = { ...data, statusCode: code };
              return mockRes;
            }
          };
        }
      };
      
      // 直接调用leadController.createLead
      await leadController.createLead(mockReq, mockRes);
      
      if (responseData && responseData.success) {
        if (responseData.duplicate) {
          results.duplicated++;
          console.log(`[OCR-${taskId}] 线索重复: ${customerName}`);
        } else {
          results.success++;
          console.log(`[OCR-${taskId}] 线索注册成功: ${customerName}`);
        }
      } else {
        throw new Error(responseData?.message || '注册失败');
      }
      
    } catch (error) {
      results.failed++;
      const errorMsg = `客户 ${customerName}: ${error.message}`;
      results.errors.push(errorMsg);
      console.error(`[OCR-${taskId}] 线索注册失败: ${errorMsg}`);
    }
  }
  
  console.log(`[OCR-${taskId}] 批量注册完成，成功: ${results.success}，失败: ${results.failed}，重复: ${results.duplicated}`);
  return results;
};

// 异步OCR处理函数
const processOCRAsync = async (taskId, filePath, originalName) => {
  const taskStartTime = Date.now();
  
  try {
    console.log(`[OCR-${taskId}] 开始异步处理图片: ${originalName}`);
    
    // 更新任务状态为处理中
    ocrTasks.set(taskId, {
      status: 'processing',
      startTime: taskStartTime,
      fileName: originalName,
      progress: '正在转换图片格式...'
    });
    
    // 更新数据库记录状态
    await updateTaskRecord(taskId, {
      task_status: 'processing'
    });

    // 使用固定的文本转录提示词，输出JSON格式
    const prompt = `你的任务是进行一次 绝对精确 的文本转录，并输出为JSON格式。
 唯一规则：  必须逐字、逐符号、逐空格地 100%复制 图片中的联系人备注。严禁进行任何形式的自动格式化、美化或空格调整。
 严重警告：  我注意到你可能会在斜杠 / 前后错误地添加空格。这是 绝对不允许 的。
 正确示例 (必须遵循)：  0824/俊
 错误示例 (必须避免)：  0824 / 俊
 你的输出必须和"正确示例"的格式完全一致，斜杠紧贴两边的文字。
 输出格式要求：请将识别到的每个联系人名称输出为JSON格式，每行一个对象，格式如下：
 {"customer_name": "0824/俊"}
 {"customer_name": "0824/刘汉彬"}
 现在，请处理图片，将所有联系人按上述JSON格式逐行输出。`;

    // 将图片转换为base64
    const base64ConvertStart = Date.now();
    const base64Image = imageToBase64(filePath);
    const base64ConvertTime = Date.now() - base64ConvertStart;
    
    console.log(`[OCR-${taskId}] 图片转换完成，耗时: ${base64ConvertTime}ms`);
    
    // 更新任务状态
    ocrTasks.set(taskId, {
      ...ocrTasks.get(taskId),
      progress: '正在调用AI识别服务...'
    });
    
    // 清理临时文件
    cleanupTempFile(filePath);

    // 调用豆包API
    const apiCallStart = Date.now();
    const response = await openai.chat.completions.create({
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: {
                url: base64Image
              },
            },
            { type: 'text', text: prompt },
          ],
        },
      ],
      model: process.env.OCR_MODEL,
    });
    const apiCallTime = Date.now() - apiCallStart;
    
    console.log(`[OCR-${taskId}] AI识别完成，耗时: ${apiCallTime}ms`);

    // 处理并返回结果
    if (response.choices && response.choices.length > 0) {
      const rawResult = response.choices[0].message.content;
      
      try {
        // 将AI返回的多行JSON字符串解析为数组
        const lines = rawResult.trim().split('\n');
        const customers = lines.map(line => {
          try {
            return JSON.parse(line.trim());
          } catch (parseError) {
            console.warn(`[OCR-${taskId}] 解析JSON行失败:`, line, parseError);
            return { customer_name: line.trim() }; // 降级处理
          }
        }).filter(item => item.customer_name); // 过滤掉空值
        
        const totalTime = Date.now() - taskStartTime;
        console.log(`[OCR-${taskId}] 处理完成，总耗时: ${totalTime}ms，识别到 ${customers.length} 个联系人`);
        
        // 批量注册线索
        const leadRegistrationResult = await batchRegisterLeads(taskId, customers);
        
        // 提取第一个客户的lead_time用于记录
        let extractedLeadTime = null;
        if (customers.length > 0) {
          const firstCustomer = customers[0];
          const datePart = extractDateFromCustomerName(firstCustomer.customer_name);
          if (datePart) {
            extractedLeadTime = formatLeadTime(datePart);
          }
        }
        
        // 更新任务状态为完成
        const endTime = Date.now();
        ocrTasks.set(taskId, {
          status: 'completed',
          startTime: taskStartTime,
          endTime: endTime,
          fileName: originalName,
          result: customers,
          leadRegistration: leadRegistrationResult,
          performance: {
            totalTime: `${totalTime}ms`,
            base64ConvertTime: `${base64ConvertTime}ms`,
            apiCallTime: `${apiCallTime}ms`
          }
        });
        
        // 更新数据库记录
        await updateTaskRecord(taskId, {
          task_status: 'completed',
          end_time: new Date(endTime),
          total_time_ms: totalTime,
          api_call_time_ms: apiCallTime,
          base64_convert_time_ms: base64ConvertTime,
          customers_extracted: customers.length,
          customers_imported: leadRegistrationResult.success || 0,
          customers_duplicated: leadRegistrationResult.duplicated || 0,
          customers_failed: leadRegistrationResult.failed || 0,
          extracted_data: customers,
          lead_time: extractedLeadTime
        });
        
      } catch (error) {
        console.error(`[OCR-${taskId}] 结果解析错误:`, error);
        // 降级返回原始字符串
        const totalTime = Date.now() - taskStartTime;
        const endTime = Date.now();
        ocrTasks.set(taskId, {
          status: 'completed',
          startTime: taskStartTime,
          endTime: endTime,
          fileName: originalName,
          result: rawResult,
          performance: {
            totalTime: `${totalTime}ms`,
            base64ConvertTime: `${base64ConvertTime}ms`,
            apiCallTime: `${apiCallTime}ms`
          }
        });
        
        // 更新数据库记录（解析失败但OCR成功）
        await updateTaskRecord(taskId, {
          task_status: 'completed',
          end_time: new Date(endTime),
          total_time_ms: totalTime,
          api_call_time_ms: apiCallTime,
          base64_convert_time_ms: base64ConvertTime,
          customers_extracted: 0,
          customers_imported: 0,
          customers_duplicated: 0,
          customers_failed: 0,
          extracted_data: { raw_result: rawResult },
          lead_time: null,
          error_message: `结果解析失败: ${error.message}`,
          error_details: { parse_error: error.message }
        });
      }
    } else {
      throw new Error('未获取到识别结果');
    }
  } catch (error) {
    const totalTime = Date.now() - taskStartTime;
    console.error(`[OCR-${taskId}] 处理失败，总耗时: ${totalTime}ms`, error);
    
    // 清理可能残留的临时文件
    if (filePath) {
      cleanupTempFile(filePath);
    }

    // 更新任务状态为失败
    const endTime = Date.now();
    ocrTasks.set(taskId, {
      status: 'failed',
      startTime: taskStartTime,
      endTime: endTime,
      fileName: originalName,
      error: error.message || '识别过程发生错误',
      performance: {
        totalTime: `${totalTime}ms`
      }
    });
    
    // 更新数据库记录
    await updateTaskRecord(taskId, {
      task_status: 'failed',
      end_time: new Date(endTime),
      total_time_ms: totalTime,
      customers_extracted: 0,
      customers_imported: 0,
      customers_duplicated: 0,
      customers_failed: 0,
      lead_time: null,
      error_message: error.message || '识别过程发生错误',
      error_details: {
        error_type: error.name || 'UnknownError',
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
      }
    });
  }
};

// 图片识别处理函数（异步模式）
exports.recognizeImage = async (req, res) => {
  const startTime = Date.now();
  
  try {
    // 检查是否有文件上传
    if (!req.file) {
      const totalTime = Date.now() - startTime;
      console.log(`[OCR] 请求失败: 未上传文件，耗时: ${totalTime}ms`);
      return res.status(400).json({ 
        success: false,
        error: '请上传图片文件',
        performance: {
          totalTime: `${totalTime}ms`
        }
      });
    }

    // 生成任务ID
    const taskId = generateTaskId();
    const fileInfo = {
      originalName: req.file.originalname,
      size: req.file.size,
      mimetype: req.file.mimetype,
      path: req.file.path
    };
    
    console.log(`[OCR] 收到图片识别请求，任务ID: ${taskId}`);
    console.log(`[OCR-${taskId}] 文件信息:`, {
      name: fileInfo.originalName,
      size: `${(fileInfo.size / 1024).toFixed(2)}KB`,
      type: fileInfo.mimetype
    });

    // 初始化任务状态
    ocrTasks.set(taskId, {
      status: 'pending',
      startTime: startTime,
      fileName: fileInfo.originalName,
      fileSize: fileInfo.size,
      progress: '任务已创建，等待处理...'
    });

    // 创建数据库记录
    await createTaskRecord(taskId, fileInfo, startTime);

    // 异步处理OCR
    processOCRAsync(taskId, fileInfo.path, fileInfo.originalName);
    
    const totalTime = Date.now() - startTime;
    console.log(`[OCR-${taskId}] 任务已提交，耗时: ${totalTime}ms`);

    // 立即返回任务ID
    res.json({
      success: true,
      message: 'OCR任务已启动',
      data: {
        taskId: taskId,
        fileName: fileInfo.originalName,
        status: 'pending'
      },
      performance: {
        totalTime: `${totalTime}ms`
      }
    });
    
  } catch (error) {
    const totalTime = Date.now() - startTime;
    console.error(`[OCR] 提交任务失败，耗时: ${totalTime}ms`, error);
    
    // 清理可能残留的临时文件
    if (req.file && req.file.path) {
      cleanupTempFile(req.file.path);
    }

    res.status(500).json({
      success: false,
      error: error.message || '提交任务失败',
      performance: {
        totalTime: `${totalTime}ms`
      },
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
};

// 查询任务状态
exports.getTaskStatus = async (req, res) => {
  const startTime = Date.now();
  const { taskId } = req.params;
  
  try {
    console.log(`[OCR] 查询任务状态: ${taskId}`);
    
    if (!taskId) {
      const totalTime = Date.now() - startTime;
      return res.status(400).json({
        success: false,
        error: '任务ID不能为空',
        performance: {
          totalTime: `${totalTime}ms`
        }
      });
    }

    // 首先查询内存缓存
    let task = ocrTasks.get(taskId);
    
    // 如果内存中没有，则查询数据库
    if (!task) {
      console.log(`[OCR] 内存中未找到任务，查询数据库: ${taskId}`);
      
      try {
        const dbRecord = await OcrTaskRecord.findOne({
          where: { task_id: taskId }
        });
        
        if (dbRecord) {
          console.log(`[OCR] 数据库中找到任务记录: ${taskId}，状态: ${dbRecord.task_status}`);
          
          // 构造任务对象
          task = {
            status: dbRecord.task_status,
            fileName: dbRecord.file_name,
            startTime: dbRecord.start_time,
            endTime: dbRecord.end_time,
            performance: {
              totalTime: dbRecord.total_time_ms ? `${dbRecord.total_time_ms}ms` : undefined,
              apiCallTime: dbRecord.api_call_time_ms ? `${dbRecord.api_call_time_ms}ms` : undefined,
              base64ConvertTime: dbRecord.base64_convert_time_ms ? `${dbRecord.base64_convert_time_ms}ms` : undefined
            }
          };
          
          // 根据状态添加相应数据
          if (dbRecord.task_status === 'completed') {
            task.result = dbRecord.extracted_data || [];
            task.leadRegistration = {
              total: dbRecord.customers_extracted || 0,
              success: dbRecord.customers_imported || 0,
              failed: dbRecord.customers_failed || 0,
              duplicated: dbRecord.customers_duplicated || 0
            };
            // 添加线索时间信息
            task.lead_time = dbRecord.lead_time || null;
          } else if (dbRecord.task_status === 'failed') {
            task.error = dbRecord.error_message || '处理失败';
          }
          
        } else {
          const totalTime = Date.now() - startTime;
          console.log(`[OCR] 数据库中未找到任务: ${taskId}，耗时: ${totalTime}ms`);
          return res.status(404).json({
            success: false,
            error: '任务不存在或已过期',
            performance: {
              totalTime: `${totalTime}ms`
            }
          });
        }
      } catch (dbError) {
        console.error(`[OCR] 查询数据库失败: ${taskId}`, dbError);
        const totalTime = Date.now() - startTime;
        return res.status(500).json({
          success: false,
          error: '查询任务状态失败',
          performance: {
            totalTime: `${totalTime}ms`
          }
        });
      }
    }

    const totalTime = Date.now() - startTime;
    console.log(`[OCR] 任务状态查询完成: ${taskId}，状态: ${task.status}，耗时: ${totalTime}ms`);

    res.json({
      success: true,
      taskId: taskId,
      status: task.status,
      fileName: task.fileName,
      progress: task.progress,
      result: task.result,
      leadRegistration: task.leadRegistration,
      lead_time: task.lead_time,
      error: task.error,
      performance: {
        queryTime: `${totalTime}ms`,
        ...task.performance
      }
    });
    
  } catch (error) {
    const totalTime = Date.now() - startTime;
    console.error(`[OCR] 查询任务状态失败: ${taskId}，耗时: ${totalTime}ms`, error);
    
    res.status(500).json({
      success: false,
      error: error.message || '查询任务状态失败',
      performance: {
        totalTime: `${totalTime}ms`
      }
    });
  }
};

// 查询OCR任务记录历史
exports.getTaskRecords = async (req, res) => {
  const startTime = Date.now();
  
  try {
    const { page = 1, limit = 10, status, startDate, endDate } = req.query;
    
    // 构建查询条件
    const whereConditions = {};
    
    if (status) {
      whereConditions.task_status = status;
    }
    
    if (startDate || endDate) {
      whereConditions.start_time = {};
      if (startDate) {
        whereConditions.start_time[Op.gte] = new Date(startDate);
      }
      if (endDate) {
        whereConditions.start_time[Op.lte] = new Date(endDate);
      }
    }
    
    // 分页查询
    const offset = (parseInt(page) - 1) * parseInt(limit);
    const result = await OcrTaskRecord.findAndCountAll({
      where: whereConditions,
      order: [['created_at', 'DESC']],
      limit: parseInt(limit),
      offset: offset
    });
    
    const totalTime = Date.now() - startTime;
    console.log(`[OCR] 查询任务记录完成，返回 ${result.rows.length} 条记录，耗时: ${totalTime}ms`);
    
    res.json({
      success: true,
      data: {
        records: result.rows.map(record => record.toJSON()),
        pagination: {
          total: result.count,
          page: parseInt(page),
          limit: parseInt(limit),
          totalPages: Math.ceil(result.count / parseInt(limit))
        }
      },
      performance: {
        totalTime: `${totalTime}ms`
      }
    });
    
  } catch (error) {
    const totalTime = Date.now() - startTime;
    console.error(`[OCR] 查询任务记录失败，耗时: ${totalTime}ms`, error);
    
    res.status(500).json({
      success: false,
      error: error.message || '查询任务记录失败',
      performance: {
        totalTime: `${totalTime}ms`
      }
    });
  }
};

// 导出multer中间件
exports.uploadMiddleware = upload.single('image');