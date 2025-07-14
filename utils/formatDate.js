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

function formatAllDates(obj) {
  if (Array.isArray(obj)) {
    return obj.map(formatAllDates);
  }
  if (obj && typeof obj === 'object') {
    const newObj = {};
    for (const key in obj) {
      if (['created_at','updated_at','lead_time','deal_date','follow_up_time','operation_time'].includes(key) && isDateLike(obj[key])) {
        newObj[key] = formatDate(obj[key]);
      } else if (typeof obj[key] === 'object' && obj[key] !== null) {
        newObj[key] = formatAllDates(obj[key]);
      } else {
        newObj[key] = obj[key];
      }
    }
    return newObj;
  }
  return obj;
}

module.exports = { formatDate, formatAllDates }; 