/**
 * @fileoverview SETH — Özel hata hiyerarşisi.
 */

export class SETHError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = 'SETHError';
  }
}

export class ProviderError extends SETHError {
  constructor(
    message: string,
    public readonly provider: string,
    public readonly statusCode?: number,
  ) {
    super(message, 'PROVIDER_ERROR');
    this.name = 'ProviderError';
  }
}

export class ToolExecutionError extends SETHError {
  constructor(
    message: string,
    public readonly toolName: string,
  ) {
    super(message, 'TOOL_EXECUTION_ERROR');
    this.name = 'ToolExecutionError';
  }
}

export class PermissionDeniedError extends SETHError {
  constructor(
    message: string,
    public readonly toolName: string,
  ) {
    super(message, 'PERMISSION_DENIED');
    this.name = 'PermissionDeniedError';
  }
}

export class BudgetExceededError extends SETHError {
  constructor(message: string) {
    super(message, 'BUDGET_EXCEEDED');
    this.name = 'BudgetExceededError';
  }
}

export class ConfigError extends SETHError {
  constructor(message: string) {
    super(message, 'CONFIG_ERROR');
    this.name = 'ConfigError';
  }
}

export class AbortError extends SETHError {
  constructor() {
    super('Operation aborted by user', 'ABORT');
    this.name = 'AbortError';
  }
}
