export const formatRelativeTime = (isoDate?: string) => {
  if (!isoDate) return "ไม่เคย";
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) {
    return "ไม่ทราบ";
  }

  const now = Date.now();
  const diffMs = now - date.getTime();
  const diffMinutes = Math.round(diffMs / (60 * 1000));

  if (diffMinutes < 1) return "เมื่อสักครู่";
  if (diffMinutes < 60) return `${diffMinutes} นาทีที่แล้ว`;

  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours} ชั่วโมงที่แล้ว`;

  const diffDays = Math.round(diffHours / 24);
  return `${diffDays} วันที่แล้ว`;
};
