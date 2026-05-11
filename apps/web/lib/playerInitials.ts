export const getPlayerInitials = (displayName?: string | null) => {
  const normalized = (displayName ?? '').trim().replace(/\s+/g, ' ');

  if (!normalized) {
    return '?';
  }

  const parts = normalized.split(' ').filter(Boolean);
  if (parts.length >= 2) {
    return `${Array.from(parts[0])[0] ?? ''}${Array.from(parts[1])[0] ?? ''}`.toUpperCase();
  }

  return (
    Array.from(parts[0] ?? '')
      .slice(0, 2)
      .join('') || '?'
  ).toUpperCase();
};
