import { ArgumentsHost, Catch, ExceptionFilter, HttpStatus } from '@nestjs/common';
import type { Response } from 'express';
import { MulterError } from 'multer';

@Catch(MulterError)
export class MulterUploadExceptionFilter implements ExceptionFilter {
  catch(exception: MulterError, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();

    if (exception.code === 'LIMIT_FILE_SIZE') {
      logUploadFailure('file too large; maximum allowed size is 6MB.');
      response.status(HttpStatus.PAYLOAD_TOO_LARGE).json({
        errors: ['file too large; maximum allowed size is 6MB.'],
      });
      return;
    }

    if (exception.code === 'LIMIT_UNEXPECTED_FILE') {
      logUploadFailure("file field missing; expected multipart field 'file'.");
      response.status(HttpStatus.BAD_REQUEST).json({
        errors: ["file field missing; expected multipart field 'file'."],
      });
      return;
    }

    logUploadFailure(`upload failed: ${exception.message}`);
    response.status(HttpStatus.BAD_REQUEST).json({
      errors: [`upload failed: ${exception.message}`],
    });
  }
}

function logUploadFailure(message: string) {
  if (process.env.NODE_ENV !== 'production') {
    console.warn(`[parse-upload] ${message}`);
  }
}
