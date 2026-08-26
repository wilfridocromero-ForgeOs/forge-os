export function compareOrbMessages(left, right) {
  const timeDifference = new Date(left.created_at || 0) - new Date(right.created_at || 0);
  if (timeDifference) return timeDifference;
  if (right.reply_to_message_id === left.id) return -1;
  if (left.reply_to_message_id === right.id) return 1;
  if (left.role !== right.role) return left.role === "user" ? -1 : 1;
  return String(left.id).localeCompare(String(right.id));
}

export function normalizeOrbMessages(rows) {
  return [...rows].sort(compareOrbMessages).map((message) => ({
    ...message,
    displayStatus: message.status,
  }));
}
