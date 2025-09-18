require('dotenv').config();
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { Op } = require('sequelize');
const OcrTaskRecord = require('../models/ocrTaskRecordModel');
const leadController = require('./leadController');

// 内存任务队列
const ocrTasks = new Map();

// 生成任务ID
const generateTaskId = () => {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
};

// 创建OCR任务记录
const createTaskRecord = async (taskId, fileInfo, startTime, userInfo = null) => {
  console.log(`[OCR-${taskId}] 开始创建数据库任务记录`);
  console.log(`[OCR-${taskId}] 记录参数:`);
  console.log(`  - taskId: ${taskId}`);
  console.log(`  - fileInfo: ${JSON.stringify(fileInfo)}`);
  console.log(`  - startTime: ${new Date(startTime).toISOString()}`);
  console.log(`  - userInfo: ${JSON.stringify(userInfo)}`);
  
  try {
    const recordData = {
      task_id: taskId,
      file_name: fileInfo.originalName,
      file_size: fileInfo.size,
      file_type: fileInfo.mimetype,
      task_status: 'pending',
      start_time: new Date(startTime),
      operator_user_id: userInfo ? userInfo.id : null,
      operator_nickname: userInfo ? (userInfo.nickname || userInfo.username) : null
    };
    console.log(`[OCR-${taskId}] 将要创建的记录数据: ${JSON.stringify(recordData, null, 2)}`);
    
    const createdRecord = await OcrTaskRecord.create(recordData);
    console.log(`[OCR-${taskId}] 数据库记录创建成功，记录ID: ${createdRecord.id}`);
  } catch (error) {
    console.error(`[OCR-${taskId}] 创建数据库记录失败:`);
    console.error(`  - 错误消息: ${error.message}`);
    console.error(`  - 错误堆栈: ${error.stack}`);
  }
};

// 更新OCR任务记录
const updateTaskRecord = async (taskId, updateData) => {
  console.log(`[OCR-${taskId}] 开始更新数据库任务记录`);
  console.log(`[OCR-${taskId}] 更新数据: ${JSON.stringify(updateData, null, 2)}`);
  
  try {
    const [affectedRows] = await OcrTaskRecord.update(updateData, {
      where: { task_id: taskId }
    });
    console.log(`[OCR-${taskId}] 数据库记录更新成功，影响行数: ${affectedRows}`);
    
    if (affectedRows === 0) {
      console.warn(`[OCR-${taskId}] 警告: 没有找到匹配的记录进行更新`);
    }
  } catch (error) {
    console.error(`[OCR-${taskId}] 更新数据库记录失败:`);
    console.error(`  - 错误消息: ${error.message}`);
    console.error(`  - 错误堆栈: ${error.stack}`);
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

// 千问API客户端惰性初始化
let qwenClient = null;
const getQwenClient = () => {
  if (qwenClient) return qwenClient;

  // 惰性引入 SDK，避免 require 钩子在初始化前介入
  const OpenAI = require('openai');

  // 检查环境变量
  if (!process.env.DASHSCOPE_API_KEY) {
    throw new Error('DASHSCOPE_API_KEY 环境变量未设置');
  }

  qwenClient = new OpenAI({
    apiKey: process.env.DASHSCOPE_API_KEY,
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1'
  });
  return qwenClient;
};

// 将图片文件转换为base64
const imageToBase64 = (filePath) => {
  const convertStart = Date.now();
  console.log(`[OCR-BASE64] 开始转换图片为base64 - 文件路径: ${filePath}`);
  
  try {
    // 检查文件是否存在
    if (!fs.existsSync(filePath)) {
      console.log(`[OCR-BASE64-ERROR] 文件不存在: ${filePath}`);
      throw new Error('图片文件不存在');
    }
    
    // 获取文件信息
    const stats = fs.statSync(filePath);
    console.log(`[OCR-BASE64] 文件信息:`);
    console.log(`  - 文件大小: ${stats.size} bytes`);
    console.log(`  - 文件扩展名: ${path.extname(filePath)}`);
    
    const imageBuffer = fs.readFileSync(filePath);
    console.log(`[OCR-BASE64] 文件读取成功，缓冲区大小: ${imageBuffer.length} bytes`);
    
    const base64String = `data:image/${path.extname(filePath).slice(1)};base64,${imageBuffer.toString('base64')}`;
    const convertTime = Date.now() - convertStart;
    
    console.log(`[OCR-BASE64] base64转换成功:`);
    console.log(`  - 转换耗时: ${convertTime}ms`);
    console.log(`  - base64字符串长度: ${base64String.length} 字符`);
    console.log(`  - base64前缀: ${base64String.substring(0, 50)}...`);
    
    return base64String;
  } catch (error) {
    const convertTime = Date.now() - convertStart;
    console.log(`[OCR-BASE64-ERROR] 图片转换为base64失败:`);
    console.log(`  - 耗时: ${convertTime}ms`);
    console.log(`  - 错误消息: ${error.message}`);
    console.log(`  - 错误堆栈: ${error.stack}`);
    throw new Error('图片处理失败');
  }
};

// 清理上传的临时文件
const cleanupTempFile = (filePath) => {
  console.log(`[OCR-CLEANUP] 开始清理临时文件: ${filePath}`);
  
  // 检查文件是否存在
  if (fs.existsSync(filePath)) {
    console.log(`[OCR-CLEANUP] 文件存在，开始删除`);
    
    // 获取文件信息
    try {
      const stats = fs.statSync(filePath);
      console.log(`[OCR-CLEANUP] 文件信息: 大小 ${stats.size} bytes，修改时间 ${stats.mtime.toISOString()}`);
    } catch (statError) {
      console.log(`[OCR-CLEANUP] 无法获取文件信息: ${statError.message}`);
    }
    
    fs.unlink(filePath, (err) => {
      if (err) {
        console.error(`[OCR-CLEANUP] 清理临时文件失败: ${filePath}`);
        console.error(`  - 错误消息: ${err.message}`);
        console.error(`  - 错误码: ${err.code}`);
      } else {
        console.log(`[OCR-CLEANUP] 临时文件清理成功: ${filePath}`);
      }
    });
  } else {
    console.log(`[OCR-CLEANUP] 临时文件不存在，无需清理: ${filePath}`);
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
const batchRegisterLeads = async (taskId, customers, userInfo = null, assignedUserId = null) => {
  console.log(`[OCR-${taskId}] 开始批量注册线索`);
  console.log(`[OCR-${taskId}] 批量注册参数:`);
  console.log(`  - 客户数量: ${customers.length}`);
  console.log(`  - 用户信息: ${JSON.stringify(userInfo)}`);
  console.log(`  - 分配的跟进人ID: ${assignedUserId}`);
  
  const results = {
    total: customers.length,
    success: 0,
    failed: 0,
    duplicated: 0,
    errors: []
  };
  
  console.log(`[OCR-${taskId}] 初始化结果统计: ${JSON.stringify(results)}`);
  
  // 【优化1】预查询用户信息缓存，避免重复查询
  let userCache = {};
  if (assignedUserId) {
    console.log(`[OCR-${taskId}] 预查询跟进人信息 - 用户ID: ${assignedUserId}`);
    try {
      const User = require('../models/user');
      const followerUser = await User.findByPk(assignedUserId, {
        attributes: ['id', 'nickname', 'username']
      });
      if (followerUser) {
        userCache[assignedUserId] = {
          nickname: followerUser.nickname || followerUser.username,
          username: followerUser.username
        };
        console.log(`[OCR-${taskId}] 用户信息缓存成功: ${JSON.stringify(userCache[assignedUserId])}`);
      } else {
        console.log(`[OCR-${taskId}] 警告: 未找到跟进人信息 - 用户ID: ${assignedUserId}`);
      }
    } catch (error) {
      console.log(`[OCR-${taskId}] 用户信息查询失败: ${error.message}`);
    }
  }
  
  // 【优化2】批量去重查询，避免逐个查询
  console.log(`[OCR-${taskId}] 开始批量去重检查`);
  const allCustomerNames = customers.map(customer => customer.customer_name).filter(name => name);
  let existingLeadsMap = new Map();
  
  if (allCustomerNames.length > 0) {
    try {
      const CustomerLead = require('../models/leadModel');
      const { Op } = require('sequelize');
      
      console.log(`[OCR-${taskId}] 批量查询可能重复的客户名称，数量: ${allCustomerNames.length}`);
      const existingLeads = await CustomerLead.findAll({
        where: {
          contact_name: {
            [Op.in]: allCustomerNames
          }
        },
        attributes: ['id', 'contact_name', 'customer_nickname']
      });
      
      // 构建快速查找的Map
      existingLeads.forEach(lead => {
        existingLeadsMap.set(lead.contact_name, lead);
      });
      
      console.log(`[OCR-${taskId}] 批量去重查询完成，找到已存在记录: ${existingLeads.length}个`);
      if (existingLeads.length > 0) {
        console.log(`[OCR-${taskId}] 已存在的客户名称: ${existingLeads.map(l => l.contact_name).join(', ')}`);
      }
    } catch (error) {
      console.log(`[OCR-${taskId}] 批量去重查询失败: ${error.message}`);
    }
  }
  
  for (let i = 0; i < customers.length; i++) {
    const customer = customers[i];
    const customerName = customer.customer_name;
    
    console.log(`\n[OCR-${taskId}] 处理第${i + 1}/${customers.length}个客户: ${customerName}`);
    
    try {
      // 严格校验客户名称格式
      console.log(`[OCR-${taskId}] 正在验证客户名称格式: ${customerName}`);
      const validation = validateCustomerNameFormat(customerName);
      if (!validation.valid) {
        console.log(`[OCR-${taskId}] 客户名称格式验证失败: ${validation.error}`);
        throw new Error(validation.error);
      }
      console.log(`[OCR-${taskId}] 客户名称格式验证通过: ${JSON.stringify(validation)}`);
      
      // 格式化日期
      console.log(`[OCR-${taskId}] 正在格式化日期: ${validation.datePart}`);
      const leadTime = formatLeadTime(validation.datePart);
      if (!leadTime) {
        console.log(`[OCR-${taskId}] 日期格式化失败: ${validation.datePart}`);
        throw new Error(`日期格式无效: ${validation.datePart}`);
      }
      console.log(`[OCR-${taskId}] 日期格式化成功: ${leadTime}`);
      
      // 【优化3】使用批量去重结果，避免重复查询
      console.log(`[OCR-${taskId}] 检查去重结果 - 客户名称: ${validation.fullName}`);
      const existingLead = existingLeadsMap.get(validation.fullName);
      if (existingLead) {
        console.log(`[OCR-${taskId}] 发现重复记录 - 客户: ${validation.fullName}, 已存在ID: ${existingLead.id}`);
        results.duplicated++;
        continue; // 跳过重复记录
      }
      console.log(`[OCR-${taskId}] 去重检查通过，允许创建新记录: ${validation.fullName}`);
      
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
        current_follower: assignedUserId // 使用传入的跟进人ID
      };
      console.log(`[OCR-${taskId}] 构造的线索数据: ${JSON.stringify(leadData, null, 2)}`);
      
      
      // 【优化4】构造模拟的req和res对象，使用缓存的用户信息
      console.log(`[OCR-${taskId}] 构造模拟请求对象`);
      const mockReq = {
        body: leadData,
        headers: { 
          'x-batch-mode': 'true',
          'x-user-cache': JSON.stringify(userCache), // 传递用户缓存
          'x-skip-duplicate-check': 'true' // 跳过leadController中的去重检查，因为已经在批量处理中检查过
        },
        user: userInfo // 传递用户信息
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
      
      console.log(`[OCR-${taskId}] 模拟对象构造完成，准备调用leadController.createLead`);
      
      // 直接调用leadController.createLead
      console.log(`[OCR-${taskId}] 调用leadController.createLead开始`);
      const leadCreateStart = Date.now();
      await leadController.createLead(mockReq, mockRes);
      const leadCreateTime = Date.now() - leadCreateStart;
      
      console.log(`[OCR-${taskId}] leadController.createLead调用完成 - 耗时: ${leadCreateTime}ms`);
      console.log(`[OCR-${taskId}] 响应数据: ${JSON.stringify(responseData)}`);
      console.log(`[OCR-${taskId}] 响应状态码: ${statusCode}`);
      
      if (responseData && responseData.success) {
        if (responseData.duplicate) {
          console.log(`[OCR-${taskId}] 客户${customerName}为重复记录`);
          results.duplicated++;
        } else {
          console.log(`[OCR-${taskId}] 客户${customerName}注册成功`);
          results.success++;
        }
      } else {
        console.log(`[OCR-${taskId}] 客户${customerName}注册失败: ${responseData?.message || '注册失败'}`);
        throw new Error(responseData?.message || '注册失败');
      }
      
    } catch (error) {
      console.log(`[OCR-${taskId}] 客户${customerName}处理失败:`);
      console.log(`  - 错误消息: ${error.message}`);
      console.log(`  - 错误堆栈: ${error.stack}`);
      
      results.failed++;
      const errorMsg = `客户 ${customerName}: ${error.message}`;
      results.errors.push(errorMsg);
      console.log(`[OCR-${taskId}] 失败计数+1，当前失败数: ${results.failed}`);
    }
  }
  
  console.log(`[OCR-${taskId}] 批量注册完成，最终统计:`);
  console.log(`  - 总数: ${results.total}`);
  console.log(`  - 成功: ${results.success}`);
  console.log(`  - 失败: ${results.failed}`);
  console.log(`  - 重复: ${results.duplicated}`);
  console.log(`  - 错误列表: ${JSON.stringify(results.errors)}`);
  
  return results;
};

// 异步OCR处理函数
const processOCRAsync = async (taskId, filePath, originalName, userInfo, assignedUserId) => {
  const taskStartTime = Date.now();
  
  try {
    
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
    const prompt = `请精确识别图片中的联系人信息，并输出为JSON格式。

重要要求：
1. 逐字复制图片中的文字，不要改变任何字符
2. 保持原有的空格，不要随意添加或删除空格
3. 所有括号统一使用中文括号（），不要使用英文括号()
4. 不要在斜杠/前后添加空格
5. 保持繁简体字符不变

输出格式：
{"customer_name": "0824/俊"}
{"customer_name": "0911/Ada（資質齊全2.8W辦理蓮塘）"}

现在请识别图片中的联系人信息。`;

    // 将图片转换为base64
    console.log(`[OCR-${taskId}] 开始图片base64转换阶段`);
    const base64ConvertStart = Date.now();
    const base64Image = imageToBase64(filePath);
    const base64ConvertTime = Date.now() - base64ConvertStart;
    console.log(`[OCR-${taskId}] base64转换完成 - 耗时: ${base64ConvertTime}ms`);
    
    
    // 更新任务状态
    ocrTasks.set(taskId, {
      ...ocrTasks.get(taskId),
      progress: '正在调用AI识别服务...'
    });
    
    // 清理临时文件
    cleanupTempFile(filePath);

    // 调用千问API
    console.log(`[OCR-${taskId}] 开始调用千问AI API`);
    console.log(`[OCR-${taskId}] API调用参数:`);
    console.log(`  - 模型: qwen-vl-max`);
    console.log(`  - 提示词长度: ${prompt.length} 字符`);
    console.log(`  - base64图片大小: ${base64Image.length} 字符`);
    
    const apiCallStart = Date.now();
    let response;
    let apiCallTime;
    
    try {
      response = await getQwenClient().chat.completions.create({
        model: 'qwen-vl-max',
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
      });
      apiCallTime = Date.now() - apiCallStart;
      console.log(`[OCR-${taskId}] AI API调用成功 - 耗时: ${apiCallTime}ms`);
      console.log(`[OCR-${taskId}] API响应信息:`);
      console.log(`  - choices数量: ${response.choices?.length || 0}`);
      if (response.choices && response.choices.length > 0) {
        console.log(`  - 第一个选择的消息长度: ${response.choices[0].message?.content?.length || 0} 字符`);
        console.log(`  - 原始响应内容预览: ${response.choices[0].message?.content?.substring(0, 200) || 'null'}...`);
      }
      if (response.usage) {
        console.log(`  - Token使用情况: ${JSON.stringify(response.usage)}`);
      }
    } catch (apiError) {
      apiCallTime = Date.now() - apiCallStart;
      console.log(`[OCR-${taskId}] AI API调用失败 - 耗时: ${apiCallTime}ms`);
      console.log(`[OCR-${taskId}] API错误信息:`);
      console.log(`  - 错误消息: ${apiError.message}`);
      console.log(`  - 错误类型: ${apiError.name}`);
      console.log(`  - HTTP状态码: ${apiError.status || 'unknown'}`);
      console.log(`  - 错误堆栈: ${apiError.stack}`);
      throw apiError;
    }

    // 处理并返回结果
    if (response.choices && response.choices.length > 0) {
        const rawResult = response.choices[0].message.content;
        console.log(`[OCR-${taskId}] 开始处理AI响应结果`);
        console.log(`[OCR-${taskId}] 原始结果全文:\n${rawResult}`);
      
        try {
          // 将AI返回的多行JSON字符串解析为数组
          console.log(`[OCR-${taskId}] 开始解析JSON结果`);
          const lines = rawResult.trim().split('\n');
          console.log(`[OCR-${taskId}] 分割后得到 ${lines.length} 行数据`);
          
          const customers = lines.map((line, index) => {
            const trimmedLine = line.trim();
            if (!trimmedLine) {
              console.log(`[OCR-${taskId}] 第${index + 1}行为空，跳过`);
              return null;
            }
            
            try {
              const parsed = JSON.parse(trimmedLine);
              console.log(`[OCR-${taskId}] 第${index + 1}行解析成功: ${JSON.stringify(parsed)}`);
              return parsed;
            } catch (parseError) {
              console.log(`[OCR-${taskId}] 第${index + 1}行 JSON解析失败: ${trimmedLine}`);
              console.log(`[OCR-${taskId}] 解析错误: ${parseError.message}`);
              console.log(`[OCR-${taskId}] 使用降级处理`);
              return { customer_name: trimmedLine }; // 降级处理
            }
          }).filter(item => item && item.customer_name); // 过滤掉空值
          
          console.log(`[OCR-${taskId}] JSON解析完成，最终得到 ${customers.length} 个有效客户记录`);
          customers.forEach((customer, index) => {
            console.log(`[OCR-${taskId}] 客户${index + 1}: ${JSON.stringify(customer)}`);
          });
        
          const totalTime = Date.now() - taskStartTime;
          
          // 批量注册线索
          console.log(`[OCR-${taskId}] 开始批量注册线索 - 客户数量: ${customers.length}`);
          const leadRegistrationResult = await batchRegisterLeads(taskId, customers, userInfo, assignedUserId);
          console.log(`[OCR-${taskId}] 线索注册结果: ${JSON.stringify(leadRegistrationResult)}`);
        
          // 提取第一个客户的lead_time用于记录
          let extractedLeadTime = null;
          if (customers.length > 0) {
            const firstCustomer = customers[0];
            console.log(`[OCR-${taskId}] 提取第一个客户的日期信息: ${firstCustomer.customer_name}`);
            const datePart = extractDateFromCustomerName(firstCustomer.customer_name);
            console.log(`[OCR-${taskId}] 提取到的日期部分: ${datePart}`);
            if (datePart) {
              extractedLeadTime = formatLeadTime(datePart);
              console.log(`[OCR-${taskId}] 格式化后的线索时间: ${extractedLeadTime}`);
            }
          }
        
          // 根据线索入库结果判断任务状态 - 只有入库成功才算成功
          const endTime = Date.now();
          const taskStatus = (leadRegistrationResult.success > 0) ? 'completed' : 'failed';
          const taskStatusText = (leadRegistrationResult.success > 0) ? '完成' : '失败';
          console.log(`[OCR-${taskId}] 任务状态判断: ${taskStatusText} (成功注册: ${leadRegistrationResult.success})`);
        
        
          console.log(`[OCR-${taskId}] 更新内存任务状态为: ${taskStatus}`);
          ocrTasks.set(taskId, {
            status: taskStatus,
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
          console.log(`[OCR-${taskId}] 开始更新数据库任务记录`);
          const dbUpdateData = {
            task_status: taskStatus,
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
          };
          console.log(`[OCR-${taskId}] 数据库更新数据: ${JSON.stringify(dbUpdateData, null, 2)}`);
          
          await updateTaskRecord(taskId, dbUpdateData);
          console.log(`[OCR-${taskId}] 数据库记录更新成功`);
        
        } catch (error) {
          // 降级返回原始字符串（解析失败，没有成功入库，状态应为失败）
          console.log(`[OCR-${taskId}] JSON解析或线索注册失败:`);
          console.log(`  - 错误消息: ${error.message}`);
          console.log(`  - 错误堆栈: ${error.stack}`);
          
          const totalTime = Date.now() - taskStartTime;
          const endTime = Date.now();
          
          console.log(`[OCR-${taskId}] 设置任务状态为失败`);
          ocrTasks.set(taskId, {
            status: 'failed',
            startTime: taskStartTime,
            endTime: endTime,
            fileName: originalName,
            result: rawResult,
            error: `结果解析失败: ${error.message}`,
            performance: {
              totalTime: `${totalTime}ms`,
              base64ConvertTime: `${base64ConvertTime}ms`,
              apiCallTime: `${apiCallTime}ms`
            }
          });
        
          // 更新数据库记录（解析失败，没有成功入库，状态应为失败）
          console.log(`[OCR-${taskId}] 更新数据库记录为失败状态`);
          const failedDbData = {
            task_status: 'failed',
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
          };
          console.log(`[OCR-${taskId}] 失败数据库更新数据: ${JSON.stringify(failedDbData, null, 2)}`);
          
          await updateTaskRecord(taskId, failedDbData);
          console.log(`[OCR-${taskId}] 失败状态数据库记录更新完成`);
        }
      } else {
        console.log(`[OCR-${taskId}] API响应中没有choices数据`);
        console.log(`[OCR-${taskId}] 完整响应对象: ${JSON.stringify(response, null, 2)}`);
        throw new Error('未获取到识别结果');
      }
  } catch (error) {
    const totalTime = Date.now() - taskStartTime;
    console.log(`[OCR-${taskId}] processOCRAsync函数发生错误:`);
    console.log(`  - 错误消息: ${error.message}`);
    console.log(`  - 错误类型: ${error.name}`);
    console.log(`  - 错误堆栈: ${error.stack}`);
    console.log(`  - 总耗时: ${totalTime}ms`);
    
    // 清理可能残留的临时文件
    if (filePath) {
      console.log(`[OCR-${taskId}] 清理临时文件: ${filePath}`);
      cleanupTempFile(filePath);
    }

    // 更新任务状态为失败
    const endTime = Date.now();
    console.log(`[OCR-${taskId}] 设置最终任务状态为失败`);
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
    console.log(`[OCR-${taskId}] 更新数据库记录为最终失败状态`);
    const finalFailedDbData = {
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
    };
    console.log(`[OCR-${taskId}] 最终失败数据库更新数据: ${JSON.stringify(finalFailedDbData, null, 2)}`);
    
    await updateTaskRecord(taskId, finalFailedDbData);
    console.log(`[OCR-${taskId}] 最终失败状态数据库记录更新完成`);
    console.log(`[OCR-${taskId}] processOCRAsync函数执行结束`);
  }
};

// 图片识别处理函数（异步模式）
exports.recognizeImage = async (req, res) => {
  const startTime = Date.now();
  console.log(`\n[OCR-START] 开始处理OCR请求 - 时间: ${new Date().toISOString()}`);
  console.log(`[OCR-REQUEST] 请求来源IP: ${req.ip || req.connection.remoteAddress}`);
  console.log(`[OCR-REQUEST] 用户信息: ${req.user ? JSON.stringify({id: req.user.id, role: req.user.role, username: req.user.username}) : '未认证'}`);
  
  try {
    // 检查是否有文件上传
    if (!req.file) {
      console.log(`[OCR-ERROR] 文件上传失败 - 未检测到上传文件`);
      const totalTime = Date.now() - startTime;
      return res.status(400).json({ 
        success: false,
        error: '请上传图片文件',
        performance: {
          totalTime: `${totalTime}ms`
        }
      });
    }
    
    console.log(`[OCR-FILE] 文件上传成功:`);
    console.log(`  - 原始文件名: ${req.file.originalname}`);
    console.log(`  - 文件大小: ${req.file.size} bytes (${(req.file.size/1024/1024).toFixed(2)} MB)`);
    console.log(`  - 文件类型: ${req.file.mimetype}`);
    console.log(`  - 存储路径: ${req.file.path}`);

    // 角色权限验证：只允许 admin、service、sales 三个角色使用OCR
    const allowedRoles = ['admin', 'service', 'sales'];
    console.log(`[OCR-AUTH] 权限验证 - 用户角色: ${req.user?.role}, 允许角色: ${allowedRoles.join(', ')}`);
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      console.log(`[OCR-ERROR] 权限验证失败 - 用户角色: ${req.user?.role || '未认证'}, 不在允许列表中`);
      const totalTime = Date.now() - startTime;
      return res.status(403).json({ 
        success: false,
        error: '您没有权限使用OCR功能',
        performance: {
          totalTime: `${totalTime}ms`
        }
      });
    }
    console.log(`[OCR-AUTH] 权限验证通过`);

    // 打印OCR调用时的入参信息

    // 根据角色处理assigned_user_id参数
    let assignedUserId = null;
    console.log(`[OCR-ASSIGNMENT] 处理跟进人分配 - 用户角色: ${req.user.role}`);
    console.log(`[OCR-ASSIGNMENT] 请求体参数: ${JSON.stringify(req.body)}`);
    
    if (req.user.role === 'sales') {
      // 销售角色：使用当前用户ID作为跟进人
      assignedUserId = req.user.id;
      console.log(`[OCR-ASSIGNMENT] 销售角色 - 自动分配给自己, 跟进人ID: ${assignedUserId}`);
    } else if (req.user.role === 'admin' || req.user.role === 'service') {
      // 客服和管理员：必须传入assigned_user_id参数
      if (!req.body.assigned_user_id) {
        console.log(`[OCR-ERROR] ${req.user.role}角色未指定跟进人ID`);
        const totalTime = Date.now() - startTime;
        return res.status(400).json({ 
          success: false,
          error: `${req.user.role === 'admin' ? '管理员' : '客服'}使用OCR时必须指定跟进人`,
          performance: {
            totalTime: `${totalTime}ms`
          }
        });
      }
      assignedUserId = parseInt(req.body.assigned_user_id);
      console.log(`[OCR-ASSIGNMENT] ${req.user.role}角色 - 指定跟进人ID: ${assignedUserId}`);
    }
    

    // 生成任务ID
    const taskId = generateTaskId();
    console.log(`[OCR-TASK] 生成任务ID: ${taskId}`);
    
    const fileInfo = {
      originalName: req.file.originalname,
      size: req.file.size,
      mimetype: req.file.mimetype,
      path: req.file.path
    };
    console.log(`[OCR-TASK] 文件信息整理完成: ${JSON.stringify(fileInfo)}`);
    

    // 初始化任务状态
    console.log(`[OCR-TASK] 初始化内存任务状态`);
    ocrTasks.set(taskId, {
      status: 'pending',
      startTime: startTime,
      fileName: fileInfo.originalName,
      fileSize: fileInfo.size,
      progress: '任务已创建，等待处理...'
    });
    console.log(`[OCR-TASK] 内存任务状态初始化完成`);

    // 创建数据库记录 - 从数据库获取最新的用户信息
    console.log(`[OCR-TASK] 开始查询用户信息 - 用户ID: ${req.user.id}`);
    const User = require('../models/user');
    const currentUser = await User.findByPk(req.user.id, {
      attributes: ['id', 'username', 'nickname']
    });
    console.log(`[OCR-TASK] 用户信息查询结果: ${currentUser ? JSON.stringify({id: currentUser.id, username: currentUser.username, nickname: currentUser.nickname}) : 'null'}`);
    
    const userInfoForDB = currentUser ? {
      id: currentUser.id,
      username: currentUser.username,
      nickname: currentUser.nickname
    } : {
      id: req.user.id,
      username: req.user.username,
      nickname: req.user.nickname
    };
    console.log(`[OCR-TASK] 准备创建数据库记录 - 用户信息: ${JSON.stringify(userInfoForDB)}`);
    
    await createTaskRecord(taskId, fileInfo, startTime, userInfoForDB);
    console.log(`[OCR-TASK] 数据库任务记录创建完成`);

    // 异步处理OCR
    console.log(`[OCR-TASK] 启动异步OCR处理任务`);
    console.log(`[OCR-TASK] 异步任务参数:`);
    console.log(`  - taskId: ${taskId}`);
    console.log(`  - filePath: ${fileInfo.path}`);
    console.log(`  - originalName: ${fileInfo.originalName}`);
    console.log(`  - userInfo: ${JSON.stringify({ id: req.user.id, role: req.user.role })}`);
    console.log(`  - assignedUserId: ${assignedUserId}`);
    
    processOCRAsync(taskId, fileInfo.path, fileInfo.originalName, { 
      id: req.user.id, 
      role: req.user.role 
    }, assignedUserId);
    
    const totalTime = Date.now() - startTime;

    // 立即返回任务ID
    console.log(`[OCR-TASK] 任务提交成功，返回响应 - 总耗时: ${totalTime}ms`);
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
    console.log(`[OCR-TASK] 响应已返回给客户端`);
    
  } catch (error) {
    const totalTime = Date.now() - startTime;
    console.log(`[OCR-ERROR] recognizeImage函数发生异常:`);
    console.log(`  - 错误消息: ${error.message}`);
    console.log(`  - 错误类型: ${error.name}`);
    console.log(`  - 错误堆栈: ${error.stack}`);
    
    // 清理可能残留的临时文件
    if (req.file && req.file.path) {
      console.log(`[OCR-ERROR] 清理临时文件: ${req.file.path}`);
      cleanupTempFile(req.file.path);
    }

    console.log(`[OCR-ERROR] 返回错误响应 - 总耗时: ${totalTime}ms`);
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
      
      try {
        const dbRecord = await OcrTaskRecord.findOne({
          where: { task_id: taskId }
        });
        
        if (dbRecord) {
          
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
          return res.status(404).json({
            success: false,
            error: '任务不存在或已过期',
            performance: {
              totalTime: `${totalTime}ms`
            }
          });
        }
      } catch (dbError) {
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
    
    // 权限控制：管理员可以查看所有记录，其他角色只能查看自己的
    const { role, id: userId } = req.user;
    if (role !== 'admin') {
      whereConditions.operator_user_id = userId;
    }
    
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
    
    // 分页查询 - 关联查询用户信息
    const User = require('../models/user');
    const offset = (parseInt(page) - 1) * parseInt(limit);
    const result = await OcrTaskRecord.findAndCountAll({
      where: whereConditions,
      order: [['created_at', 'DESC']],
      limit: parseInt(limit),
      offset: offset,
      include: [{
        model: User,
        as: 'operator',
        attributes: ['id', 'username', 'nickname'],
        required: false // LEFT JOIN，允许没有关联用户的记录
      }]
    });
    
    const totalTime = Date.now() - startTime;
    
    res.json({
      success: true,
      data: {
        records: result.rows.map(record => {
          const recordData = record.toJSON();
          // 优先使用关联查询的用户信息，fallback到存储的nickname
          const operatorInfo = recordData.operator ? {
            user_id: recordData.operator.id,
            username: recordData.operator.username,
            nickname: recordData.operator.nickname || recordData.operator.username
          } : {
            user_id: recordData.operator_user_id,
            nickname: recordData.operator_nickname
          };
          
          return {
            ...recordData,
            operator: undefined, // 移除原始的关联对象
            operator_info: operatorInfo
          };
        }),
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