export function createIdentityRequestKey(userId, identityRevision) {
  if (!userId) return null;
  return `${userId}:${identityRevision}`;
}
