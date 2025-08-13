import { chat } from '../src/users';
import cache from '../src/cache';
import * as db from '../src/db';
import * as llm from '../src/addons/llm';
import { reply, sendMessage } from '../src/middleware';
import { Context } from '../src/interfaces';
import * as log from 'fancy-log';

// Mock dependencies
jest.mock('../src/cache');
jest.mock('../src/db', () => ({
  getTicketByUserId: jest.fn(),
  addIdAndName: jest.fn()
}));
jest.mock('../src/addons/llm', () => ({
  getResponseFromLLM: jest.fn()
}));
jest.mock('../src/middleware', () => ({
  strictEscape: jest.fn((str) => str.replace(/([_*])/g, '\\$1')),
  reply: jest.fn(),
  sendMessage: jest.fn().mockResolvedValue('message-id')
}));
jest.mock('fancy-log');

describe('Users Module', () => {
  let mockContext: Context;

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Setup default cache config
    (cache as any).config = {
      language: {
        dear: 'Hi',
        regards: 'Regards,',
        automatedReplyAuthor: 'Support Bot',
        automatedReply: 'This is an automated reply.',
        automatedReplySent: 'Automated reply was sent to the user.',
        confirmationMessage: 'Thank you for contacting us.',
        ticket: 'Ticket',
        from: 'from',
        language: 'Language',
        blockedSpam: 'Too many messages'
      },
      clean_replies: false,
      use_llm: false,
      autoreply: [],
      show_auto_replied: false,
      autoreply_confirmation: true,
      show_user_ticket: false,
      spam_time: 300000,
      spam_cant_msg: 5,
      staffchat_id: '-123456789',
      staffchat_type: 'telegram',
      parse_mode: 'Markdown',
      anonymous_tickets: true,
      allow_private: false
    };

    (cache as any).userId = '12345';
    (cache as any).ticketIDs = [];
    (cache as any).ticketStatus = {};
    (cache as any).ticketSent = {};

    // Setup mock context
    mockContext = {
      message: {
        text: 'Test message',
        from: {
          id: '12345',
          first_name: 'TestUser',
          language_code: 'en'
        }
      },
      session: {
        group: null,
        groupTag: '',
        groupCategory: 'default'
      },
      messenger: 'telegram',
      from: {
        id: '12345'
      }
    } as any;

    // Mock db functions
    (db.getTicketByUserId as jest.Mock).mockResolvedValue({
      ticketId: 1,
      messenger: 'telegram',
      toString: () => '1'
    });
    (db.addIdAndName as jest.Mock).mockImplementation(() => {});
  });

  describe('Auto-reply functionality', () => {
    it('should handle LLM responses without markdown escaping', async () => {
      cache.config.use_llm = true;
      cache.config.clean_replies = false;
      
      const llmResponse = '*Important:* This is a _formatted_ response with [links](http://example.com)';
      (llm.getResponseFromLLM as jest.Mock).mockResolvedValue(llmResponse);
      
      await chat(mockContext, { id: '12345' });
      
      // Verify that reply was called with unescaped LLM content
      expect(reply).toHaveBeenCalledWith(
        mockContext,
        expect.stringContaining(llmResponse)
      );
      
      // Verify the full message structure
      const replyCall = (reply as jest.Mock).mock.calls[0][1];
      expect(replyCall).toContain('Hi TestUser,');
      expect(replyCall).toContain(llmResponse);
      expect(replyCall).toContain('Regards,');
      expect(replyCall).toContain('Support Bot');
      expect(replyCall).toContain('*This is an automated reply.*');
    });

    it('should return clean LLM response when clean_replies is true', async () => {
      cache.config.use_llm = true;
      cache.config.clean_replies = true;
      
      const llmResponse = '*Important:* This is a response';
      (llm.getResponseFromLLM as jest.Mock).mockResolvedValue(llmResponse);
      
      await chat(mockContext, { id: '12345' });
      
      expect(reply).toHaveBeenCalledWith(mockContext, llmResponse);
    });

    it('should handle common auto-reply questions', async () => {
      cache.config.autoreply = [
        { question: 'install', answer: 'Installation instructions here' }
      ];
      
      mockContext.message.text = 'How do I install this?';
      
      await chat(mockContext, { id: '12345' });
      
      expect(reply).toHaveBeenCalledWith(
        mockContext,
        expect.stringContaining('Installation instructions here')
      );
    });

    it('should escape user names but not message content', async () => {
      cache.config.use_llm = true;
      cache.config.clean_replies = false;
      
      // User with special markdown characters in name
      mockContext.message.from.first_name = 'Test_User*Name';
      
      const llmResponse = 'Response with *markdown*';
      (llm.getResponseFromLLM as jest.Mock).mockResolvedValue(llmResponse);
      
      await chat(mockContext, { id: '12345' });
      
      const replyCall = (reply as jest.Mock).mock.calls[0][1];
      // Name should be escaped
      expect(replyCall).toContain('Test\\_User\\*Name');
      // But LLM response should not be escaped
      expect(replyCall).toContain('Response with *markdown*');
    });

    it('should fallback to ticket system when LLM returns null', async () => {
      cache.config.use_llm = true;
      (llm.getResponseFromLLM as jest.Mock).mockResolvedValue(null);
      
      await chat(mockContext, { id: '12345' });
      
      expect(reply).not.toHaveBeenCalled();
      expect(sendMessage).toHaveBeenCalled();
    });

    it('should not show auto-replied tickets when show_auto_replied is false', async () => {
      cache.config.use_llm = true;
      cache.config.show_auto_replied = false;
      
      (llm.getResponseFromLLM as jest.Mock).mockResolvedValue('Auto response');
      
      await chat(mockContext, { id: '12345' });
      
      expect(reply).toHaveBeenCalled();
      expect(sendMessage).not.toHaveBeenCalled();
    });

    it('should show auto-replied tickets when show_auto_replied is true', async () => {
      cache.config.use_llm = true;
      cache.config.show_auto_replied = true;
      
      (llm.getResponseFromLLM as jest.Mock).mockResolvedValue('Auto response');
      
      await chat(mockContext, { id: '12345' });
      
      expect(reply).toHaveBeenCalled();
      expect(sendMessage).toHaveBeenCalled();
    });

    it('should fallback to normal flow when LLM returns null', async () => {
      cache.config.use_llm = true;
      cache.config.show_auto_replied = false;
      cache.config.autoreply_confirmation = true;
      
      // Mock LLM returning null (refused to answer)
      (llm.getResponseFromLLM as jest.Mock).mockResolvedValue(null);
      
      await chat(mockContext, { id: '12345' });
      
      // Should NOT call reply (no auto-reply was sent)
      expect(reply).not.toHaveBeenCalled();
      
      // Should send confirmation message to user
      expect(sendMessage).toHaveBeenCalledWith(
        '12345',
        mockContext.messenger,
        'Thank you for contacting us.\n'
      );
      
      // Should send ticket to staff without "Automated reply was sent" message
      expect(sendMessage).toHaveBeenCalledWith(
        '-123456789',
        'telegram',
        expect.not.stringContaining('Automated reply was sent to the user')
      );
    });

    it('should fallback to normal flow when LLM returns "null" string', async () => {
      cache.config.use_llm = true;
      cache.config.show_auto_replied = false;
      cache.config.autoreply_confirmation = true;
      
      // Mock LLM returning "null" as a string (this should be handled in llm.ts)
      (llm.getResponseFromLLM as jest.Mock).mockResolvedValue(null);
      
      await chat(mockContext, { id: '12345' });
      
      // Should NOT call reply (no auto-reply was sent)
      expect(reply).not.toHaveBeenCalled();
      
      // Should send confirmation message to user
      expect(sendMessage).toHaveBeenCalledWith(
        '12345',
        mockContext.messenger,
        'Thank you for contacting us.\n'
      );
    });

    it('should handle LLM errors gracefully', async () => {
      cache.config.use_llm = true;
      cache.config.autoreply_confirmation = true;
      
      // Silence console.error for this test
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
      
      // Mock LLM throwing an error
      (llm.getResponseFromLLM as jest.Mock).mockRejectedValue(new Error('LLM API error'));
      
      await chat(mockContext, { id: '12345' });
      
      // Should NOT call reply (no auto-reply was sent)
      expect(reply).not.toHaveBeenCalled();
      
      // Should send confirmation message to user (fallback behavior)
      expect(sendMessage).toHaveBeenCalledWith(
        '12345',
        mockContext.messenger,
        'Thank you for contacting us.\n'
      );
      
      // Verify error was logged
      expect(consoleErrorSpy).toHaveBeenCalledWith('LLM response failed:', expect.any(Error));
      
      // Restore console.error
      consoleErrorSpy.mockRestore();
    });
  });

  describe('Spam protection', () => {
    it('should handle spam protection correctly', async () => {
      cache.ticketSent['12345'] = 5; // User has sent max messages
      
      await chat(mockContext, { id: '12345' });
      
      expect(sendMessage).toHaveBeenCalledWith(
        '12345',
        mockContext.messenger,
        'Too many messages'
      );
    });

    it('should increment message counter within spam time', async () => {
      cache.ticketSent['12345'] = 2;
      
      await chat(mockContext, { id: '12345' });
      
      expect(cache.ticketSent['12345']).toBe(3);
    });
  });

  describe('Ticket logging', () => {
    it('should always log ticket messages', async () => {
      await chat(mockContext, { id: '12345' });
      
      expect(log.info).toHaveBeenCalled();
    });
  });
});