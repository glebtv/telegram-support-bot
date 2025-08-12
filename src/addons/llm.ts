import { Context } from '../interfaces';
import { openai } from "@llamaindex/openai";
import cache from '../cache';
import * as log from 'fancy-log';

let llm: any = null;

function getLLMClient() {
    if (!llm) {
        llm = openai({
            model: cache.config.llm_model,
            reasoningEffort: "low",
            apiKey: cache.config.llm_api_key,
            baseURL: cache.config.llm_base_url,
        });
    }
    return llm;
}

async function getResponseFromLLM(ctx: Context): Promise<string | null> {
    // Use system prompt from config, fallback to default if not set
    const systemPrompt = cache.config.llm_system_prompt || 
        `You are a Support Agent. You have been assigned to help the user based on the message and only the provided knowledge base. 
        If the knowledge base does not contain the information needed to answer the user's question, you should respond with "null". 
        Answer truthfully and to the best of your ability. Answer without salutation and greetings.
        Format your response using Telegram Markdown syntax (not MarkdownV2). Use *bold* for emphasis and _italic_ for subtle emphasis.
        Do not use emojis in your responses. Keep formatting simple and clean.`;
    
    const fullPrompt = `${systemPrompt}\n\nKnowledgebase: """\n${cache.config.llm_knowledge}\n"""`;

    var response = null
    try {
        const llmClient = getLLMClient();
        response = await llmClient.chat({
            messages: [
                { content: fullPrompt, role: "system" },
                { content: ctx.message.text, role: "user" }
            ],
        });
    }
    catch (error) {
        console.error("Error in LLM response:", error);
        return null;
    }

    if (!response || !response.message) {
        return null;
    }

    const message = response.message.content.toString();
    
    // Log LLM response if logging is enabled
    if (cache.config.llm_log_responses) {
        log.info(`LLM Response for user ${ctx.message.from.id} (${ctx.message.from.first_name}):`);
        log.info(`User message: ${ctx.message.text}`);
        log.info(`LLM response: ${message}`);
    }
    
    if (message === "null" || message === "Null" || message === null) {
        return null
    }

    return message;
}

export { getResponseFromLLM };