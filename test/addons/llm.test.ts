// Mock dependencies first before importing
const mockChat = jest.fn();
jest.mock('@llamaindex/openai', () => ({
  openai: jest.fn(() => ({
    chat: mockChat
  }))
}));

jest.mock('fancy-log', () => ({
  info: jest.fn(),
  error: jest.fn()
}));

// Mock cache
const mockConfig = {
  llm_model: 'test-model',
  llm_api_key: 'test-key',
  llm_base_url: 'http://test.com',
  llm_knowledge: 'Test knowledge base',
  llm_system_prompt: null,
  llm_log_responses: false
};

jest.mock('../../src/cache', () => ({
  default: {
    config: mockConfig
  },
  __esModule: true
}));

import * as llm from '../../src/addons/llm';
import cache from '../../src/cache';
import { Context } from '../../src/interfaces';
import * as log from 'fancy-log';

describe('LLM Module', () => {
  let mockContext: Context;

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Setup mock context
    mockContext = {
      message: {
        text: 'Test question',
        from: {
          id: '12345',
          first_name: 'TestUser',
          language_code: 'en'
        }
      },
      session: {},
      messenger: 'telegram'
    } as any;
  });

  describe('getResponseFromLLM', () => {
    it('should return LLM response for valid question', async () => {
      mockChat.mockResolvedValue({
        message: {
          content: 'This is a test response'
        }
      });

      const response = await llm.getResponseFromLLM(mockContext);
      
      expect(response).toBe('This is a test response');
      expect(mockChat).toHaveBeenCalledWith({
        messages: [
          { 
            content: expect.stringContaining('Knowledgebase: """'),
            role: 'system' 
          },
          { 
            content: 'Test question',
            role: 'user' 
          }
        ]
      });
    });

    it('should use custom system prompt when configured', async () => {
      mockConfig.llm_system_prompt = 'Custom system prompt';
      
      mockChat.mockResolvedValue({
        message: {
          content: 'Test response'
        }
      });

      await llm.getResponseFromLLM(mockContext);
      
      expect(mockChat).toHaveBeenCalledWith({
        messages: [
          { 
            content: expect.stringContaining('Custom system prompt'),
            role: 'system' 
          },
          { 
            content: 'Test question',
            role: 'user' 
          }
        ]
      });
    });

    it('should use default system prompt when not configured', async () => {
      mockConfig.llm_system_prompt = null;
      
      mockChat.mockResolvedValue({
        message: {
          content: 'Test response'
        }
      });

      await llm.getResponseFromLLM(mockContext);
      
      expect(mockChat).toHaveBeenCalledWith({
        messages: [
          { 
            content: expect.stringContaining('Format your response using Telegram Markdown syntax'),
            role: 'system' 
          },
          { 
            content: 'Test question',
            role: 'user' 
          }
        ]
      });
    });

    it('should return null when LLM responds with "null"', async () => {
      mockChat.mockResolvedValue({
        message: {
          content: 'null'
        }
      });

      const response = await llm.getResponseFromLLM(mockContext);
      
      expect(response).toBeNull();
    });

    it('should return null when LLM responds with "Null"', async () => {
      mockChat.mockResolvedValue({
        message: {
          content: 'Null'
        }
      });

      const response = await llm.getResponseFromLLM(mockContext);
      
      expect(response).toBeNull();
    });

    it('should return null when LLM responds with "NULL"', async () => {
      mockChat.mockResolvedValue({
        message: {
          content: 'NULL'
        }
      });

      const response = await llm.getResponseFromLLM(mockContext);
      
      expect(response).toBeNull();
    });

    it('should return null when LLM responds with empty string', async () => {
      mockChat.mockResolvedValue({
        message: {
          content: ''
        }
      });

      const response = await llm.getResponseFromLLM(mockContext);
      
      expect(response).toBeNull();
    });

    it('should return null when LLM responds with whitespace only', async () => {
      mockChat.mockResolvedValue({
        message: {
          content: '   '
        }
      });

      const response = await llm.getResponseFromLLM(mockContext);
      
      expect(response).toBeNull();
    });

    it('should return null when LLM message content is null', async () => {
      mockChat.mockResolvedValue({
        message: {
          content: null
        }
      });

      const response = await llm.getResponseFromLLM(mockContext);
      
      expect(response).toBeNull();
    });

    it('should handle LLM errors gracefully', async () => {
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
      mockChat.mockRejectedValue(new Error('API Error'));

      const response = await llm.getResponseFromLLM(mockContext);
      
      expect(response).toBeNull();
      expect(consoleErrorSpy).toHaveBeenCalledWith('Error in LLM response:', expect.any(Error));
      
      consoleErrorSpy.mockRestore();
    });

    it('should handle null response from LLM', async () => {
      mockChat.mockResolvedValue(null);

      const response = await llm.getResponseFromLLM(mockContext);
      
      expect(response).toBeNull();
    });

    it('should log responses when logging is enabled', async () => {
      mockConfig.llm_log_responses = true;
      
      mockChat.mockResolvedValue({
        message: {
          content: 'Logged response'
        }
      });

      await llm.getResponseFromLLM(mockContext);
      
      expect(log.info).toHaveBeenCalledWith('LLM Response for user 12345 (TestUser):');
      expect(log.info).toHaveBeenCalledWith('User message: Test question');
      expect(log.info).toHaveBeenCalledWith('LLM response: Logged response');
    });

    it('should not log responses when logging is disabled', async () => {
      mockConfig.llm_log_responses = false;
      
      mockChat.mockResolvedValue({
        message: {
          content: 'Not logged response'
        }
      });

      await llm.getResponseFromLLM(mockContext);
      
      expect(log.info).not.toHaveBeenCalled();
    });

    it('should include knowledge base in system prompt', async () => {
      mockConfig.llm_knowledge = 'Custom knowledge: Test info';
      
      mockChat.mockResolvedValue({
        message: {
          content: 'Response'
        }
      });

      await llm.getResponseFromLLM(mockContext);
      
      expect(mockChat).toHaveBeenCalledWith({
        messages: [
          { 
            content: expect.stringContaining('Custom knowledge: Test info'),
            role: 'system' 
          },
          { 
            content: 'Test question',
            role: 'user' 
          }
        ]
      });
    });
  });
});