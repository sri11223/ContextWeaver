/**
 * Retry Logic & Error Recovery
 * 
 * Provides automatic retry for failed operations with:
 * - Exponential backoff
 * - Configurable retry attempts
 * - Error classification (retryable vs fatal)
 * - Circuit breaker pattern
 */

import { ContextWeaverError } from './errors.js';

/**
 * Retry configuration options
 */
export interface RetryOptions {
  /** Maximum number of retry attempts (default: 3) */
  maxAttempts?: number;
  
  /** Initial delay in milliseconds (default: 100) */
  initialDelay?: number;
  
  /** Maximum delay in milliseconds (default: 5000) */
  maxDelay?: number;
  
  /** Backoff multiplier (default: 2) */
  backoffMultiplier?: number;
  
  /** Jitter factor 0-1 (default: 0.1) */
  jitter?: number;
  
  /** Custom retry condition */
  shouldRetry?: (error: Error, attempt: number) => boolean;
  
  /** Callback on retry */
  onRetry?: (error: Error, attempt: number, delay: number) => void;
}

/**
 * Circuit breaker states
 */
export enum CircuitState {
  CLOSED = 'closed',   // Normal operation
  OPEN = 'open',       // Failing, reject immediately
  HALF_OPEN = 'half-open' // Testing if recovered
}

/**
 * Circuit breaker configuration
 */
export interface CircuitBreakerOptions {
  /** Failure threshold before opening circuit (default: 5) */
  failureThreshold?: number;
  
  /** Success threshold to close circuit (default: 2) */
  successThreshold?: number;
  
  /** Timeout before trying half-open (default: 60000ms) */
  timeout?: number;
  
  /** Sliding window size for failure tracking (default: 10) */
  windowSize?: number;
}

/**
 * Retry with exponential backoff
 */
export async function retry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    maxAttempts = 3,
    initialDelay = 100,
    maxDelay = 5000,
    backoffMultiplier = 2,
    jitter = 0.1,
    shouldRetry = defaultShouldRetry,
    onRetry
  } = options;

  let lastError: Error;
  
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      
      // Don't retry on last attempt or if error is not retryable
      if (attempt === maxAttempts || !shouldRetry(lastError, attempt)) {
        throw lastError;
      }
      
      // Calculate delay with exponential backoff and jitter
      const baseDelay = Math.min(
        initialDelay * Math.pow(backoffMultiplier, attempt - 1),
        maxDelay
      );
      const jitterAmount = baseDelay * jitter * (Math.random() * 2 - 1);
      const delay = Math.max(0, baseDelay + jitterAmount);
      
      onRetry?.(lastError, attempt, delay);
      
      await sleep(delay);
    }
  }
  
  throw lastError!;
}

/**
 * Default retry condition: retry on network/timeout errors
 */
function defaultShouldRetry(error: Error, _attempt: number): boolean {
  // Don't retry validation errors
  if (error instanceof ContextWeaverError) {
    return false;
  }
  
  // Retry network errors
  const message = error.message.toLowerCase();
  return (
    message.includes('timeout') ||
    message.includes('network') ||
    message.includes('econnreset') ||
    message.includes('econnrefused') ||
    message.includes('etimedout')
  );
}

/**
 * Circuit breaker pattern implementation
 */
export class CircuitBreaker {
  private state: CircuitState = CircuitState.CLOSED;
  private failures: number = 0;
  private successes: number = 0;
  private nextAttempt: number = 0;
  private recentResults: boolean[] = [];
  
  constructor(private options: CircuitBreakerOptions = {}) {
    this.options = {
      failureThreshold: 5,
      successThreshold: 2,
      timeout: 60000,
      windowSize: 10,
      ...options
    };
  }
  
  /**
   * Execute function with circuit breaker protection
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === CircuitState.OPEN) {
      if (Date.now() < this.nextAttempt) {
        throw new Error('Circuit breaker is OPEN');
      }
      // Try half-open state
      this.state = CircuitState.HALF_OPEN;
    }
    
    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }
  
  /**
   * Record successful execution
   */
  private onSuccess(): void {
    this.failures = 0;
    
    if (this.state === CircuitState.HALF_OPEN) {
      this.successes++;
      if (this.successes >= this.options.successThreshold!) {
        this.close();
      }
    }
    
    this.recordResult(true);
  }
  
  /**
   * Record failed execution
   */
  private onFailure(): void {
    this.successes = 0;
    this.failures++;
    
    this.recordResult(false);
    
    const recentFailures = this.recentResults.filter(r => !r).length;
    
    if (
      this.state === CircuitState.HALF_OPEN ||
      recentFailures >= this.options.failureThreshold!
    ) {
      this.open();
    }
  }
  
  /**
   * Record result in sliding window
   */
  private recordResult(success: boolean): void {
    this.recentResults.push(success);
    if (this.recentResults.length > this.options.windowSize!) {
      this.recentResults.shift();
    }
  }
  
  /**
   * Open the circuit (stop all requests)
   */
  private open(): void {
    this.state = CircuitState.OPEN;
    this.nextAttempt = Date.now() + this.options.timeout!;
  }
  
  /**
   * Close the circuit (normal operation)
   */
  private close(): void {
    this.state = CircuitState.CLOSED;
    this.failures = 0;
    this.successes = 0;
  }
  
  /**
   * Get current circuit state
   */
  getState(): CircuitState {
    return this.state;
  }
  
  /**
   * Get circuit statistics
   */
  getStats() {
    return {
      state: this.state,
      failures: this.failures,
      successes: this.successes,
      recentFailureRate: this.recentResults.filter(r => !r).length / this.recentResults.length
    };
  }
  
  /**
   * Reset the circuit breaker
   */
  reset(): void {
    this.state = CircuitState.CLOSED;
    this.failures = 0;
    this.successes = 0;
    this.recentResults = [];
  }
}

/**
 * Sleep utility
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Retry with circuit breaker
 */
export async function retryWithCircuitBreaker<T>(
  fn: () => Promise<T>,
  retryOptions: RetryOptions = {},
  breakerOptions: CircuitBreakerOptions = {}
): Promise<T> {
  const breaker = new CircuitBreaker(breakerOptions);
  
  return retry(
    () => breaker.execute(fn),
    retryOptions
  );
}
