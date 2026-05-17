import { BadRequestException, HttpException, HttpStatus } from '@nestjs/common';

export class InsufficientCreditsException extends HttpException {
  constructor() {
    super('INSUFFICIENT_CREDITS', HttpStatus.PAYMENT_REQUIRED);
  }
}

export function isInsufficientCreditsError(error: unknown): boolean {
  return (
    error instanceof InsufficientCreditsException ||
    (error instanceof BadRequestException && error.message === 'Insufficient credits')
  );
}
