import { Bot, Context as GrammyContext, SessionFlavor, session } from 'grammy';
import { Addon, Context, Messenger, SessionData } from '../../interfaces';
import { apiThrottler } from '@grammyjs/transformer-throttler';
import * as middleware from '../../middleware';
import * as permissions from '../../permissions';
import * as inline from '../../inline';
import cache from '../../cache';
import { registerCommonHandlers } from '../../handlers';
import * as log from 'fancy-log'

type BotContext = GrammyContext & SessionFlavor<SessionData>;

class TelegramAddon implements Addon {
  public bot: Bot<BotContext>;
  public botInfo: any = {};

  private static instance: TelegramAddon | null = null;

  private redactBotToken(input: string): string {
    return input.replace(/\/bot\d+:[A-Za-z0-9_-]+/g, '/bot<redacted>');
  }

  private constructor(token: string, apiRoot?: string, apiRootBasicAuth?: string) {
    // Prepare bot options
    const botOptions: any = {};

    if (apiRoot) {
      // grammy throws if apiRoot has a trailing slash
      botOptions.client = {
        ...(botOptions.client || {}),
        apiRoot: apiRoot.replace(/\/$/, ''),
      };
      log.info(`Using custom API root: ${botOptions.client.apiRoot}`);
    }

    // Configure basic auth if provided
    if (apiRootBasicAuth) {
      const authHeader = `Basic ${Buffer.from(apiRootBasicAuth).toString('base64')}`;
      const originalFetch = fetch;
      botOptions.client = {
        ...(botOptions.client || {}),
        fetch: async (url: string | URL | Request, init?: RequestInit) => {
          const method = init?.method || 'GET';
          const startedAt = Date.now();
          const rawUrl = typeof url === 'string' ? url : (url instanceof URL ? url.toString() : url.url);
          const safeUrl = this.redactBotToken(rawUrl);
          const headers = new Headers(init?.headers);
          headers.set('Authorization', authHeader);
          log.info(`[Telegram API] ${method} ${safeUrl}`);
          try {
            const fetchInit: RequestInit = { ...init, headers };
            if ((fetchInit as any).signal && !((fetchInit as any).signal instanceof AbortSignal)) {
              log.info(`[Telegram API] ${method} ${safeUrl} dropping incompatible request signal`);
              delete (fetchInit as any).signal;
            }
            const response = await originalFetch(url, fetchInit);
            const durationMs = Date.now() - startedAt;
            log.info(`[Telegram API] ${method} ${safeUrl} -> ${response.status} (${durationMs}ms)`);
            return response;
          } catch (err) {
            const durationMs = Date.now() - startedAt;
            log.error(`[Telegram API] ${method} ${safeUrl} failed after ${durationMs}ms`, err);
            throw err;
          }
        },
      };
      log.info('Using basic auth for API requests');
    }

    this.bot = new Bot<BotContext>(token, botOptions);
    const throttler = apiThrottler();
    this.bot.api.config.use(throttler);
    this.bot.api.config.use(async (prev, method, payload, signal) => {
      const startedAt = Date.now();
      log.info(`[Telegram API middleware] Calling method=${method}`);
      try {
        const result = await prev(method, payload, signal);
        const durationMs = Date.now() - startedAt;
        log.info(`[Telegram API middleware] Success method=${method} (${durationMs}ms)`);
        return result;
      } catch (err) {
        const durationMs = Date.now() - startedAt;
        log.error(`[Telegram API middleware] Failed method=${method} (${durationMs}ms)`, err);
        throw err;
      }
    });
    this.bot.init().then(() => {
      this.botInfo = this.bot.botInfo;
      log.info(`Bot initialized successfully: @${this.botInfo.username} (id: ${this.botInfo.id})`);
    }).catch((err) => {
      log.error('Failed to initialize bot:', err);
    });
  }

  public static getInstance(token?: string, apiRoot?: string, apiRootBasicAuth?: string): TelegramAddon {
    if (!TelegramAddon.instance) {
      if (!token) {
        throw new Error(
          'Token must be provided when creating the TelegramAddon for the first time.'
        );
      }
      TelegramAddon.instance = new TelegramAddon(token, apiRoot, apiRootBasicAuth);
    }
    return TelegramAddon.instance;
  }

  // --- Session Initialization ---
  initSession() {
    const initial = (): SessionData => ({
      admin: null,
      modeData: {} as any,
      mode: null,
      lastContactDate: null,
      groupCategory: null,
      groupTag: '',
      group: '',
      groupAdmin: {} as any,
      getSessionKey: (ctx: Context) => {
        if (ctx.callbackQuery && ctx.callbackQuery.id) {
          return `${ctx.from.id}:${ctx.from.id}`;
        } else if (ctx.from && ctx.inlineQuery) {
          return `${ctx.from.id}:${ctx.from.id}`;
        } else if (ctx.from && ctx.chat) {
          return `${ctx.from.id}:${ctx.chat.id}`;
        }
        return null;
      },
    });
    return session({ initial });
  }

  // --- Methods required by the Addon interface ---
  async sendMessage(chatId: string | number, text: string, options: any = {}): Promise<string | null> {
    options.disable_web_page_preview = true;
    if (typeof chatId !== 'string' && typeof chatId !== 'number') return;
    const response = await this.bot.api.sendMessage(chatId.toString(), text, options);
    return response.message_id.toString();
  }

  sendDocument = (
    chatId: string | number,
    document: any,
    other?: any,
    signal?: any
  ) => {
    this.bot.api.sendDocument(chatId, document, other, signal);
  };

  sendPhoto(chatId: string | number, photo: any, options?: any) {
    this.bot.api.sendPhoto(chatId, photo, options);
  }

  sendVideo(chatId: string | number, video: any, options?: any) {
    this.bot.api.sendVideo(chatId, video, options);
  }

  command(command: string, callback: (ctx: any) => void): void {
    this.bot.command(command, ctx => callback(ctx));
  }

  on = (filter: any, ...middleware: any) => {
    this.bot.on(filter, ...middleware);
  };

  catch(handler: (error: any, ctx?: Context) => void): void {
    this.bot.catch(handler);
  }

  hears(trigger: string | string[] | RegExp, callback: (ctx: any) => void): void {
    this.bot.hears(trigger, ctx => callback(ctx));
  }

  // --- Start and Configure the Bot ---
  start(): void {
    log.info('Starting Telegram Addon...');

    // Setup session and middleware.
    this.bot.use(this.initSession());
    this.bot.use((ctx: any, next: () => any) => {
      ctx.messenger = Messenger.TELEGRAM;
      if (cache.config.dev_mode) {
        middleware.reply(
          ctx,
          `_Dev mode is on: You might notice some delay in messages, no replies or other errors._`
        );
      }
      permissions.checkPermissions(ctx, next, cache.config);
    });

    const keys = inline.initInline(this);
    registerCommonHandlers(this, keys);
    log.info('Telegram handlers and middleware registered');

    // Start the Bot.
    log.info('Starting Telegram polling loop...');
    this.bot.start({
      onStart: (botInfo) => {
        log.info(`Telegram Addon polling started: @${botInfo.username} (id: ${botInfo.id})`);
      },
    }).then(() => {
      log.info('Telegram polling loop stopped');
    }).catch((err) => {
      log.error('Failed to start Telegram Addon polling:', err);
    });
  }
}

export default TelegramAddon;
