import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Response } from 'express';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      const message = typeof body === 'string' ? body : (body as { message?: unknown }).message;
      response.status(status).json({
        statusCode: status,
        message: message || exception.message,
        error: exception.name,
      });
      return;
    }
    const detail = exception instanceof Error ? exception.message : 'unexpected error';
    this.logger.error(detail);
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: 500,
      message: 'Internal server error',
      error: 'InternalServerError',
    });
  }
}
