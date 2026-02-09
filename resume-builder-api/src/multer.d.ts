declare module 'multer' {
  export function memoryStorage(): any;
}

declare global {
  namespace Express {
    namespace Multer {
      interface File {
        originalname: string;
        mimetype: string;
        buffer: Buffer;
        size: number;
      }
    }
  }
}

export {};
