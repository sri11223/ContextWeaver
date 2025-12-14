/**
 * Session Export/Import
 * 
 * Backup and restore conversation sessions:
 * - Export sessions to JSON
 * - Import sessions from backup
 * - Batch operations
 */

import type { Message, StorageAdapter } from './types.js';
import { generateId } from './utils.js';

/**
 * Export formats
 */
export type ExportFormat = 'json' | 'jsonl';

/**
 * Session export data
 */
export interface SessionExport {
  sessionId: string;
  messages: Message[];
  metadata: {
    exportedAt: number;
    version: string;
    messageCount: number;
  };
}

/**
 * Export options
 */
export interface ExportOptions {
  /** Include message metadata (default: true) */
  includeMetadata?: boolean;
  
  /** Pretty print JSON (default: false) */
  prettyPrint?: boolean;
  
  /** Export format (default: 'json') */
  format?: ExportFormat;
}

/**
 * Import options
 */
export interface ImportOptions {
  /** Overwrite existing sessions (default: false) */
  overwrite?: boolean;
  
  /** Validate message structure (default: true) */
  validate?: boolean;
  
  /** Generate new IDs for messages (default: false) */
  regenerateIds?: boolean;
}

/**
 * Export a single session
 */
export async function exportSession(
  storage: StorageAdapter,
  sessionId: string,
  options: ExportOptions = {}
): Promise<string> {
  const { includeMetadata = true, prettyPrint = false } = options;
  
  const messages = await storage.getMessages(sessionId);
  
  const exportData: SessionExport = {
    sessionId,
    messages,
    metadata: {
      exportedAt: Date.now(),
      version: '1.0.0',
      messageCount: messages.length
    }
  };
  
  if (!includeMetadata) {
    delete (exportData as Partial<SessionExport>).metadata;
  }
  
  return prettyPrint ? JSON.stringify(exportData, null, 2) : JSON.stringify(exportData);
}

/**
 * Export all sessions
 */
export async function exportAllSessions(
  storage: StorageAdapter,
  sessionIds: string[],
  options: ExportOptions = {}
): Promise<string> {
  const { prettyPrint = false } = options;
  
  const exports = await Promise.all(
    sessionIds.map(id => exportSession(storage, id, { ...options, format: 'json' }))
  );
  
  if (options.format === 'jsonl') {
    return exports.join('\n');
  }
  
  const allData = exports.map(e => JSON.parse(e));
  return prettyPrint ? JSON.stringify(allData, null, 2) : JSON.stringify(allData);
}

/**
 * Import a session
 */
export async function importSession(
  storage: StorageAdapter,
  data: string,
  options: ImportOptions = {}
): Promise<string> {
  const { overwrite = false, validate = true, regenerateIds = false } = options;
  
  const sessionExport: SessionExport = JSON.parse(data);
  
  if (validate) {
    validateSessionExport(sessionExport);
  }
  
  const { sessionId, messages } = sessionExport;
  
  // Check if session exists
  if (!overwrite) {
    const existing = await storage.getMessages(sessionId);
    if (existing.length > 0) {
      throw new Error(`Session ${sessionId} already exists. Use overwrite: true to replace.`);
    }
  }
  
  // Clear existing if overwriting (manually delete all messages)
  if (overwrite) {
    const existing = await storage.getMessages(sessionId);
    for (const msg of existing) {
      await storage.deleteMessage(sessionId, msg.id);
    }
  }
  
  // Import messages
  for (const message of messages) {
    const importMessage = regenerateIds
      ? { ...message, id: generateId() }
      : message;
    
    await storage.addMessage(sessionId, importMessage);
  }
  
  return sessionId;
}

/**
 * Import multiple sessions
 */
export async function importSessions(
  storage: StorageAdapter,
  data: string,
  options: ImportOptions = {}
): Promise<string[]> {
  const sessions: SessionExport[] = JSON.parse(data);
  
  if (!Array.isArray(sessions)) {
    throw new Error('Import data must be an array of session exports');
  }
  
  const imported: string[] = [];
  
  for (const session of sessions) {
    const sessionData = JSON.stringify(session);
    const sessionId = await importSession(storage, sessionData, options);
    imported.push(sessionId);
  }
  
  return imported;
}

/**
 * Validate session export structure
 */
function validateSessionExport(data: SessionExport): void {
  if (!data.sessionId) {
    throw new Error('Invalid export: missing sessionId');
  }
  
  if (!Array.isArray(data.messages)) {
    throw new Error('Invalid export: messages must be an array');
  }
  
  for (const message of data.messages) {
    if (!message.id || !message.role || !message.content) {
      throw new Error('Invalid export: message missing required fields');
    }
  }
}
