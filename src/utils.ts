/**
 * Generate a unique message ID
 */
export function generateId(): string {
  return `msg_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Get current timestamp
 */
export function now(): number {
  return Date.now();
}

/**
 * Sort messages by timestamp (oldest first)
 */
export function sortByTimestamp<T extends { timestamp: number }>(messages: T[]): T[] {
  return [...messages].sort((a, b) => a.timestamp - b.timestamp);
}

/**
 * Partition messages into pinned and unpinned
 */
export function partitionMessages<T extends { pinned?: boolean }>(
  messages: T[]
): { pinned: T[]; unpinned: T[] } {
  const pinned: T[] = [];
  const unpinned: T[] = [];

  for (const message of messages) {
    if (message.pinned) {
      pinned.push(message);
    } else {
      unpinned.push(message);
    }
  }

  return { pinned, unpinned };
}
