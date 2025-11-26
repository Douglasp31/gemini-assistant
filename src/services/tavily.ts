import { App, Notice } from 'obsidian';

export class TavilyService {
    private app: App;
    private apiKey: string | null = null;

    constructor(app: App) {
        this.app = app;
    }

    async initialize() {
        try {
            const keyFile = this.app.vault.getAbstractFileByPath('tavily_api_key.txt');
            if (keyFile && 'read' in this.app.vault) {
                // @ts-ignore
                const content = await this.app.vault.read(keyFile as any);
                this.apiKey = content.trim();
                console.log('Tavily API Key loaded.');
            } else {
                console.warn('tavily_api_key.txt not found.');
            }
        } catch (e) {
            console.error('Failed to load Tavily API key', e);
        }
    }

    async search(query: string): Promise<string> {
        if (!this.apiKey) await this.initialize();
        if (!this.apiKey) {
            new Notice('Tavily API Key missing. Please create tavily_api_key.txt');
            return 'Error: Tavily API Key missing.';
        }

        try {
            const response = await fetch('https://api.tavily.com/search', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    api_key: this.apiKey,
                    query: query,
                    search_depth: 'basic',
                    include_answer: true,
                    max_results: 5
                })
            });

            if (!response.ok) {
                throw new Error(`Tavily API error: ${response.statusText}`);
            }

            const data = await response.json();

            let result = '';
            if (data.answer) {
                result += `Direct Answer: ${data.answer}\n\n`;
            }

            if (data.results && data.results.length > 0) {
                result += 'Search Results:\n';
                data.results.forEach((res: any) => {
                    result += `- [${res.title}](${res.url}): ${res.content}\n`;
                });
            }

            return result;
        } catch (e: any) {
            console.error('Tavily search failed', e);
            return `Error searching web: ${e.message}`;
        }
    }
}
