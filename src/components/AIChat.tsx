import * as React from 'react';
import ReactMarkdown from 'react-markdown';
import { GeminiService } from '../services/gemini';
import { GitService } from '../services/git';

interface AIChatProps {
    geminiService: GeminiService;
    gitService: GitService;
    getActiveFileContent: () => Promise<string | null>;
}

interface Message {
    role: 'user' | 'model';
    text?: string;
    isThinking?: boolean;
}
import { Notice } from 'obsidian';
import { Copy, Send, Globe, Trash2, RefreshCw, Paperclip, X } from 'lucide-react';

interface Attachment {
    name: string;
    data: string; // Base64
    mimeType: string;
}

export const AIChat: React.FC<AIChatProps> = ({ geminiService, gitService, getActiveFileContent }) => {
    const [messages, setMessages] = React.useState<Message[]>([]);
    const [obsidianInput, setObsidianInput] = React.useState('');
    const [webInput, setWebInput] = React.useState('');
    const [models, setModels] = React.useState<{ id: string, name: string }[]>([]);
    const [selectedModel, setSelectedModel] = React.useState('gemini-1.5-flash');
    const [useActiveFile, setUseActiveFile] = React.useState(false);
    const [useActiveFileWeb, setUseActiveFileWeb] = React.useState(false);
    const [customCommands, setCustomCommands] = React.useState<{ label: string, prompt: string }[]>([]);
    const [gems, setGems] = React.useState<{ name: string, path: string }[]>([]);
    const [selectedGemObsidian, setSelectedGemObsidian] = React.useState('');
    const [selectedGemWeb, setSelectedGemWeb] = React.useState('');
    const [attachments, setAttachments] = React.useState<Attachment[]>([]);
    const fileInputRef = React.useRef<HTMLInputElement>(null);

    React.useEffect(() => {
        geminiService.getModels().then(setModels);
        geminiService.getCustomCommands().then(setCustomCommands);
        geminiService.getGems().then(setGems);

        // Load saved model preference
        const savedModel = localStorage.getItem('gemini-assistant-last-model');
        if (savedModel) {
            setSelectedModel(savedModel);
        }
    }, [geminiService]);

    const handleModelChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        const newModel = e.target.value;
        setSelectedModel(newModel);
        localStorage.setItem('gemini-assistant-last-model', newModel);
    };

    const clearChat = () => {
        setMessages([]);
        setAttachments([]);
        new Notice('Chat history cleared');
    };

    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files.length > 0) {
            const file = e.target.files[0];
            const reader = new FileReader();
            reader.onload = (event) => {
                if (event.target?.result) {
                    const base64 = (event.target.result as string).split(',')[1];
                    setAttachments(prev => [...prev, {
                        name: file.name,
                        data: base64,
                        mimeType: file.type
                    }]);
                }
            };
            reader.readAsDataURL(file);
        }
        // Reset input
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    const removeAttachment = (index: number) => {
        setAttachments(prev => prev.filter((_, i) => i !== index));
    };

    const handleSubmit = async (e: React.FormEvent, mode: 'obsidian' | 'web') => {
        e.preventDefault();
        const input = mode === 'obsidian' ? obsidianInput : webInput;
        if (!input.trim() && attachments.length === 0) return;

        const userMsg: Message = {
            role: 'user',
            text: input + (attachments.length > 0 ? `\n[Attached ${attachments.length} file(s)]` : '')
        };
        setMessages(prev => [...prev, userMsg]);

        if (mode === 'obsidian') setObsidianInput('');
        else setWebInput('');

        setMessages(prev => [...prev, { role: 'model', isThinking: true }]);

        // Prepare history (exclude thinking messages and errors)
        const history = messages
            .filter(m => !m.isThinking && m.text && !m.text.startsWith('Error:'))
            .map(m => ({ role: m.role, text: m.text! }));

        let context = null;
        if ((mode === 'obsidian' && useActiveFile) || (mode === 'web' && useActiveFileWeb)) {
            context = await getActiveFileContent();
            if (context) {
                new Notice('Included active file as context');
            }
        }

        // Include Gem content if selected
        const selectedGem = mode === 'obsidian' ? selectedGemObsidian : selectedGemWeb;
        if (selectedGem) {
            try {
                const gemContent = await geminiService.readGem(selectedGem);
                const gemContext = `\n\nAdditional Context from Gem (${selectedGem.split('/').pop()}):\n${gemContent}`;
                context = context ? context + gemContext : gemContext;
                new Notice('Included Gem content');
            } catch (e) {
                console.error('Failed to read Gem', e);
                new Notice('Failed to read selected Gem');
            }
        }

        try {
            const response = await geminiService.chat(
                input,
                history,
                context,
                selectedModel,
                mode,
                (toolMsg) => {
                    new Notice(toolMsg); // Show tool execution as toast
                },
                attachments
            );

            setMessages(prev => {
                const newMsgs = [...prev];
                newMsgs[newMsgs.length - 1] = { role: 'model', text: response };
                return newMsgs;
            });
            setAttachments([]); // Clear attachments after sending
        } catch (err: any) {
            setMessages(prev => {
                const newMsgs = [...prev];
                newMsgs[newMsgs.length - 1] = {
                    role: 'model',
                    text: `Error: ${err.message}`
                };
                return newMsgs;
            });
        }
    };

    const copyToClipboard = (text: string) => {
        navigator.clipboard.writeText(text);
        new Notice('Copied to clipboard');
    };

    const copyAll = () => {
        const allText = messages
            .map(m => `**${m.role === 'user' ? 'User' : 'Gemini'}**: ${m.text}`)
            .join('\n\n');
        navigator.clipboard.writeText(allText);
        new Notice('Copied entire chat to clipboard');
    };

    const handlePaste = (e: React.ClipboardEvent) => {
        const items = e.clipboardData.items;
        for (let i = 0; i < items.length; i++) {
            if (items[i].type.indexOf('image') !== -1) {
                e.preventDefault();
                const blob = items[i].getAsFile();
                if (blob) {
                    const reader = new FileReader();
                    reader.onload = (event) => {
                        if (event.target?.result) {
                            const base64 = (event.target.result as string).split(',')[1];
                            setAttachments(prev => [...prev, {
                                name: 'Pasted Image ' + new Date().toLocaleTimeString(),
                                data: base64,
                                mimeType: blob.type
                            }]);
                            new Notice('Image pasted from clipboard');
                        }
                    };
                    reader.readAsDataURL(blob);
                }
            }
        }
    };

    return (
        <div className="gemini-assistant-container">
            <div className="gemini-header">
                <h2>Gemini Assistant</h2>
                <div className="gemini-header-controls">
                    <select
                        value={selectedModel}
                        onChange={handleModelChange}
                        className="gemini-model-select"
                    >
                        {models.map(m => (
                            <option key={m.id} value={m.id}>{m.name}</option>
                        ))}
                    </select>
                    <button
                        onClick={copyAll}
                        className="gemini-header-btn"
                        title="Copy Conversation"
                        style={{ gap: '4px' }}
                    >
                        <Copy size={16} />
                        <span style={{ fontSize: '0.75rem' }}>Copy</span>
                    </button>
                    <button
                        onClick={clearChat}
                        className="gemini-header-btn"
                        title="Clear Chat History"
                    >
                        <Trash2 size={16} />
                    </button>

                </div>
            </div>

            <div className="gemini-chat-area">
                {messages.length === 0 && (
                    <div className="gemini-empty-state">
                        Ask questions about your vault,<br />or search the web.
                    </div>
                )}
                {messages.map((msg, idx) => (
                    <div key={idx} className={`gemini-message ${msg.role}`}>
                        <div className="gemini-bubble">
                            {msg.isThinking ? (
                                <span className="animate-pulse">Thinking...</span>
                            ) : (
                                <>
                                    <div className="gemini-markdown">
                                        <ReactMarkdown>{msg.text || ''}</ReactMarkdown>
                                    </div>
                                    <button
                                        onClick={() => copyToClipboard(msg.text!)}
                                        className="gemini-copy-btn"
                                        title="Copy"
                                    >
                                        <Copy size={12} />
                                    </button>
                                </>
                            )}
                        </div>
                    </div>
                ))}
            </div>

            <div className="gemini-inputs">
                {/* Attachments Preview */}
                {attachments.length > 0 && (
                    <div className="gemini-attachments">
                        {attachments.map((att, idx) => (
                            <div key={idx} className="gemini-attachment-chip">
                                <span className="text-xs truncate max-w-[100px]">{att.name}</span>
                                <button onClick={() => removeAttachment(idx)} className="gemini-attachment-remove">
                                    <X size={12} />
                                </button>
                            </div>
                        ))}
                    </div>
                )}

                <input
                    type="file"
                    ref={fileInputRef}
                    style={{ display: 'none' }}
                    onChange={handleFileSelect}
                    accept="image/*,application/pdf"
                />

                {/* Obsidian Chat Input */}
                <form onSubmit={(e) => handleSubmit(e, 'obsidian')} className="gemini-input-form">
                    <div className="gemini-input-wrapper">
                        <button
                            type="button"
                            className="gemini-attach-btn"
                            onClick={() => fileInputRef.current?.click()}
                            title="Attach Image or PDF"
                        >
                            <Paperclip size={16} />
                        </button>
                        <input
                            type="text"
                            value={obsidianInput}
                            onChange={(e) => setObsidianInput(e.target.value)}
                            onPaste={handlePaste}
                            placeholder="Ask Gemini Obsidian..."
                            className="gemini-input obsidian"
                        />
                        <button type="submit" className="gemini-send-btn obsidian">
                            <Send size={16} />
                        </button>
                    </div>

                    <div style={{ display: 'flex', gap: '10px', marginTop: '15px', marginBottom: '15px' }}>
                        {customCommands.length > 0 && (
                            <select
                                onChange={(e) => {
                                    if (e.target.value) {
                                        setObsidianInput(e.target.value);
                                        e.target.value = ''; // Reset dropdown
                                    }
                                }}
                                className="gemini-model-select text-xs w-full"
                                style={{ opacity: 0.9, padding: '6px', flex: 1 }}
                            >
                                <option value="">Select a command...</option>
                                {customCommands.map((cmd, idx) => (
                                    <option key={idx} value={cmd.prompt}>{cmd.label}</option>
                                ))}
                            </select>
                        )}

                        {gems.length > 0 && (
                            <select
                                value={selectedGemObsidian}
                                onChange={(e) => setSelectedGemObsidian(e.target.value)}
                                className="gemini-model-select text-xs w-full"
                                style={{ opacity: 0.9, padding: '6px', flex: 1 }}
                            >
                                <option value="">Select Gem</option>
                                {gems.map((gem, idx) => (
                                    <option key={idx} value={gem.path}>{gem.name}</option>
                                ))}
                            </select>
                        )}
                    </div>

                    <div className="flex items-center gap-2 mt-4 text-xs text-gray-500 dark:text-gray-400">
                        <input
                            type="checkbox"
                            id="use-active-file"
                            checked={useActiveFile}
                            onChange={(e) => setUseActiveFile(e.target.checked)}
                            className="rounded border-gray-300 dark:border-gray-600"
                        />
                        <label htmlFor="use-active-file">Include active file for context</label>
                    </div>
                </form>

                {/* Web Chat Input */}
                <form onSubmit={(e) => handleSubmit(e, 'web')} className="gemini-input-form">
                    <div className="gemini-input-wrapper">
                        <button
                            type="button"
                            className="gemini-attach-btn"
                            onClick={() => fileInputRef.current?.click()}
                            title="Attach Image or PDF"
                        >
                            <Paperclip size={16} />
                        </button>
                        <input
                            type="text"
                            value={webInput}
                            onChange={(e) => setWebInput(e.target.value)}
                            onPaste={handlePaste}
                            placeholder="Ask Gemini Web..."
                            className="gemini-input web"
                        />
                        <button type="submit" className="gemini-send-btn web">
                            <Globe size={16} />
                        </button>
                    </div>

                    {gems.length > 0 && (
                        <div style={{ marginTop: '15px', marginBottom: '15px' }}>
                            <select
                                value={selectedGemWeb}
                                onChange={(e) => setSelectedGemWeb(e.target.value)}
                                className="gemini-model-select text-xs w-full"
                                style={{ opacity: 0.9, padding: '6px', width: '50%' }}
                            >
                                <option value="">Select Gem</option>
                                {gems.map((gem, idx) => (
                                    <option key={idx} value={gem.path}>{gem.name}</option>
                                ))}
                            </select>
                        </div>
                    )}

                    <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400" style={{ marginTop: '15px' }}>
                        <input
                            type="checkbox"
                            id="use-active-file-web"
                            checked={useActiveFileWeb}
                            onChange={(e) => setUseActiveFileWeb(e.target.checked)}
                            className="rounded border-gray-300 dark:border-gray-600"
                        />
                        <label htmlFor="use-active-file-web">Include active file for context</label>
                    </div>
                </form>
            </div>
        </div>
    );
};
