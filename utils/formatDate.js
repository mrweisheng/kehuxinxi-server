const dayjs = require('dayjs');

function isDateLike(val) {
  // 判断是否为Date对象或ISO字符串
  if (!val) return false;
  if (val instanceof Date) return true;
  if (typeof val === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(val)) return true;
  return false;
}

function formatDate(val) {
  if (!val) return '';
  if (typeof val === 'string' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(val)) return val;
  return dayjs(val).format('YYYY-MM-DD HH:mm:ss');
}

function formatAllDates(obj, visited = new WeakSet()) {
  // 检测循环引用
  if (obj && typeof obj === 'object') {
    if (visited.has(obj)) {
      return obj; // 避免循环引用
    }
    visited.add(obj);
  }
  
  if (Array.isArray(obj)) {
    return obj.map(item => formatAllDates(item, visited));
  }
  if (obj && typeof obj === 'object') {
    const newObj = {};
    for (const key in obj) {
      if (['created_at','updated_at','lead_time','deal_date','follow_up_time','operation_time','start_time','end_time'].includes(key) && isDateLike(obj[key])) {
        newObj[key] = formatDate(obj[key]);
      } else if (typeof obj[key] === 'object' && obj[key] !== null) {
        newObj[key] = formatAllDates(obj[key], visited);
      } else {
        newObj[key] = obj[key];
      }
    }
    return newObj;
  }
  return obj;
}

module.exports = { formatDate, formatAllDates };