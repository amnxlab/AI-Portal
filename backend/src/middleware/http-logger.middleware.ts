import { Injectable, NestMiddleware, Logger } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

@Injectable()
export class HttpLoggerMiddleware implements NestMiddleware {
    private readonly logger = new Logger('HTTP');

    use(req: Request, res: Response, next: NextFunction): void {
        const { method, originalUrl, ip } = req;
        const origin  = req.headers['origin'] ?? '-';
        const ua      = (req.headers['user-agent'] ?? '-').slice(0, 60);
        const start   = Date.now();

        // Log the incoming request
        this.logger.log(`→ ${method} ${originalUrl}  [origin: ${origin}]  [ip: ${ip}]`);

        // Intercept response finish to log outcome
        res.on('finish', () => {
            const ms     = Date.now() - start;
            const status = res.statusCode;
            const color  =
                status >= 500 ? '\x1b[31m' :   // red
                status >= 400 ? '\x1b[33m' :   // yellow
                status >= 300 ? '\x1b[36m' :   // cyan
                                '\x1b[32m';     // green
            const reset  = '\x1b[0m';
            const label  = `${color}${status}${reset}`;

            if (status >= 400) {
                this.logger.warn(
                    `← ${method} ${originalUrl}  ${label}  ${ms}ms  [origin: ${origin}]  [ua: ${ua}]`,
                );
            } else {
                this.logger.log(
                    `← ${method} ${originalUrl}  ${label}  ${ms}ms`,
                );
            }
        });

        next();
    }
}
