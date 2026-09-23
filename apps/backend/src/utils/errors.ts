export class AppError extends Error {
  constructor(public readonly statusCode: number, message: string, public readonly code = 'APP_ERROR') {
    super(message);
    this.name = 'AppError';
  }
}

export function isPrismaUniqueError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: string }).code === 'P2002';
}
