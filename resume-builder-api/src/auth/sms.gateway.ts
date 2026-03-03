import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface SmsSender {
  send(mobile: string, message: string): Promise<void>;
}

@Injectable()
export class GsmModemSender implements SmsSender {
  private readonly logger = new Logger(GsmModemSender.name);

  constructor(private readonly config: ConfigService) {}

  async send(mobile: string, message: string) {
    const enabledRaw = String(this.config.get<string>('GSM_MODEM_ENABLED', '') || '').trim().toLowerCase();
    const command = String(this.config.get<string>('GSM_MODEM_COMMAND', '') || '').trim();
    const enabled = enabledRaw === '1' || enabledRaw === 'true';

    if (!enabled || !command) {
      throw new InternalServerErrorException(
        'GSM modem sender not configured. Set GSM_MODEM_ENABLED and provide command/integration.',
      );
    }

    // Stub only in this phase: production wiring point for self-hosted GSM modem sender.
    this.logger.log(`GSM stub send using "${command}" to ${mobile}: ${message}`);
  }
}
