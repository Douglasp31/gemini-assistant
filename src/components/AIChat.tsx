import * as React from 'react';
import { Copy, Globe, FileText, Paperclip, Trash2, Mic, Square, X, Send, ArrowRight } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { LLMProvider } from '../interfaces/llm';
import { GitService } from '../services/git';

interface AIChatProps {
    providers: LLMProvider[];
    gitService: GitService;
    getActiveFileContent: () => Promise<string | null>;
}

interface Message {
    role: 'user' | 'model';
    text?: string;
    isThinking?: boolean;
    usage?: {
        promptTokenCount: number;
        candidatesTokenCount: number;
        totalTokenCount: number;
    };
}
import { Notice } from 'obsidian';

interface Attachment {
    name: string;
    data: string; // Base64
    mimeType: string;
}

export const AIChat: React.FC<AIChatProps> = ({ providers, gitService, getActiveFileContent }) => {
    const [messages, setMessages] = React.useState<Message[]>([]);
    const [obsidianInput, setObsidianInput] = React.useState('');
    const [webInput, setWebInput] = React.useState('');
    const [models, setModels] = React.useState<{ id: string, name: string }[]>([]);
    const [selectedProviderId, setSelectedProviderId] = React.useState(providers[0]?.id || '');
    const [selectedModel, setSelectedModel] = React.useState('');
    const [useActiveFile, setUseActiveFile] = React.useState(false);
    const [useActiveFileWeb, setUseActiveFileWeb] = React.useState(false);
    const [customCommands, setCustomCommands] = React.useState<{ label: string, prompt: string }[]>([]);
    const [gems, setGems] = React.useState<{ name: string, path: string }[]>([]);
    const [selectedGemObsidian, setSelectedGemObsidian] = React.useState('');
    const [selectedGemWeb, setSelectedGemWeb] = React.useState('');
    const [attachments, setAttachments] = React.useState<Attachment[]>([]);
    const [deepThink, setDeepThink] = React.useState(false);
    const [isRecording, setIsRecording] = React.useState(false);
    const fileInputRef = React.useRef<HTMLInputElement>(null);
    const mediaRecorderRef = React.useRef<MediaRecorder | null>(null);
    const audioChunksRef = React.useRef<Blob[]>([]);

    const [recordingMode, setRecordingMode] = React.useState<'default' | 'force-insert' | 'web-chat'>('default');

    // mode: 'default' (obsidian chat), 'web-chat' (web chat), or 'force-insert' (header button)
    const toggleDictation = async (mode: 'default' | 'force-insert' | 'web-chat' = 'default') => {
        if (!activeProvider) {
            new Notice('Please select an AI provider first.');
            return;
        }

        if (isRecording) {
            // STOP RECORDING
            if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
                mediaRecorderRef.current.stop();
            }
            setIsRecording(false);
            // forceInsertFile state will be read in the closure of onstop (captured when started) 
            // - WAIT, onstop is defined inside "start" block.
            // When stopping, we just stop. The logic runs in the onstop handler defined during START.
        } else {
            // START RECORDING
            // Update the state for THIS recording session
            // setRecordingMode is handled below before start() to ensure state is ready

            try {
                const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                const mediaRecorder = new MediaRecorder(stream);
                mediaRecorderRef.current = mediaRecorder;
                audioChunksRef.current = [];

                mediaRecorder.ondataavailable = (event) => {
                    if (event.data.size > 0) {
                        audioChunksRef.current.push(event.data);
                    }
                };

                mediaRecorder.onstop = async () => {
                    // Turn off mic stream tracks
                    stream.getTracks().forEach(track => track.stop());

                    const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
                    const reader = new FileReader();

                    new Notice('Processing audio with Gemini...');

                    reader.readAsDataURL(audioBlob);
                    reader.onloadend = async () => {
                        const base64String = (reader.result as string).split(',')[1];

                        if (activeProvider.id === 'gemini') {
                            const gemini = activeProvider as any;
                            // Use the new transcribeAudio method if available
                            if (typeof gemini.transcribeAudio === 'function') {
                                try {
                                    // Determine mime type (defaulting to webm as that's what we requested)
                                    // but Chrome/Electron might differ, usually audio/webm
                                    const text = await gemini.transcribeAudio(base64String, 'audio/webm');

                                    // Check if we should insert into active file
                                    // Logic: ONLY insert to file if mode is explicitly 'force-insert' (Top Button)
                                    // The 'useActiveFile' checkbox is now ONLY for context context during chat submission.

                                    const shouldInsertToFile = mode === 'force-insert';

                                    if (shouldInsertToFile) {
                                        if (typeof gemini.insertTextAtCursor === 'function') {
                                            gemini.insertTextAtCursor(text);
                                            new Notice('Dictation inserted into active file.');
                                        } else {
                                            new Notice('Insert to file not supported by this provider.');
                                            setObsidianInput(prev => (prev + ' ' + text).trim());
                                        }
                                    } else if (mode === 'web-chat') {
                                        setWebInput(prev => (prev + ' ' + text).trim());
                                        new Notice('Dictation added to Web Chat.');
                                    } else {
                                        setObsidianInput(prev => (prev + ' ' + text).trim());
                                        new Notice('Dictation added to chat.');
                                    }

                                } catch (e: any) {
                                    new Notice('Transcription failed: ' + e.message);
                                }
                            } else {
                                new Notice('Update plugin: transcribeAudio not found on Gemini service.');
                            }
                        } else {
                            new Notice('Audio dictation currently only supported for Gemini.');
                        }
                    };
                };

                mediaRecorder.start();
                setIsRecording(true);
                setRecordingMode(mode); // Track which mode is recording to show correct icon state
                new Notice(mode === 'force-insert' ? 'Dictating to Note...' : 'Listening...');
            } catch (err) {
                console.error('Error accessing microphone:', err);
                new Notice('Microphone access denied or not available.');
                setIsRecording(false);
            }
        }
    };

    const activeProvider = providers.find(p => p.id === selectedProviderId) || providers[0];

    React.useEffect(() => {
        if (activeProvider) {
            activeProvider.getModels().then(ms => {
                setModels(ms);
                if (ms.length > 0) {
                    // Try to restore saved model for this provider
                    const savedModel = localStorage.getItem(`gemini-assistant-last-model-${activeProvider.id}`);
                    if (savedModel && ms.find(m => m.id === savedModel)) {
                        setSelectedModel(savedModel);
                    } else {
                        setSelectedModel(ms[0].id);
                    }
                }
            });

            // Load custom commands and gems (assuming these are shared or handled by the first provider for now, 
            // or we could abstract this to a separate service. For now, we'll cast to any if needed or assume provider has these methods 
            // but LLMProvider interface doesn't enforce them. 
            // Let's assume GeminiService is the one handling Vault operations for now.
            // We can find the Gemini provider to load these.
            const geminiProvider = providers.find(p => p.id === 'gemini');
            if (geminiProvider) {
                // @ts-ignore
                if (geminiProvider.getCustomCommands) geminiProvider.getCustomCommands().then(setCustomCommands);
                // @ts-ignore
                if (geminiProvider.getGems) geminiProvider.getGems().then(setGems);
            }
        }
    }, [activeProvider, providers]);

    const handleProviderChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        setSelectedProviderId(e.target.value);
    };

    const handleModelChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        const newModel = e.target.value;
        setSelectedModel(newModel);
        if (activeProvider) {
            localStorage.setItem(`gemini-assistant-last-model-${activeProvider.id}`, newModel);
        }
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

        if (!activeProvider) {
            new Notice('No AI provider selected');
            return;
        }

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
                // Use Gemini provider for reading gems as it has the vault logic
                const geminiProvider = providers.find(p => p.id === 'gemini');
                if (geminiProvider) {
                    // @ts-ignore
                    const gemContent = await geminiProvider.readGem(selectedGem);
                    const gemContext = `\n\nAdditional Context from Gem (${selectedGem.split('/').pop()}):\n${gemContent}`;
                    context = context ? context + gemContext : gemContext;
                    new Notice('Included Gem content');
                }
            } catch (e) {
                console.error('Failed to read Gem', e);
                new Notice('Failed to read selected Gem');
            }
        }

        try {
            let usageData: any = undefined;
            const response = await activeProvider.chat(
                input,
                history,
                context,
                selectedModel,
                mode,
                (toolMsg) => {
                    new Notice(toolMsg); // Show tool execution as toast
                },
                attachments,
                (metadata) => {
                    if (metadata && metadata.usage) {
                        // Capture usage in a variable to use when updating the final message
                        usageData = metadata.usage;
                    }
                },
                { deepThink }
            );

            setMessages(prev => {
                const newMsgs = [...prev];
                newMsgs[newMsgs.length - 1] = {
                    role: 'model',
                    text: response,
                    usage: usageData
                };
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
            {/* HEADER CONTAINER */}
            <div style={{ borderBottom: '1px solid var(--background-modifier-border)' }}>
                {/* ROW 1: Title, Deep Think, Controls */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px' }}>

                    {/* Left: Title + Deep Think */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '24px' }}>
                        <h2 style={{ margin: 0, color: '#ff4d4d', fontSize: '1.1rem' }}>Stephen's AI Assistant</h2>

                        {/* Deep Think Toggle - Inline */}
                        {activeProvider.id === 'gemini' && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                                <input
                                    type="checkbox"
                                    id="deepThinkToggle"
                                    checked={deepThink}
                                    onChange={(e) => setDeepThink(e.target.checked)}
                                    style={{ cursor: 'pointer' }}
                                />
                                <label htmlFor="deepThinkToggle" style={{ cursor: 'pointer', userSelect: 'none' }}>Deep Think (High Reasoning)</label>
                            </div>
                        )}
                    </div>

                    {/* Right: Controls */}
                    <div className="gemini-header-controls" style={{ gap: '8px' }}>
                        <select
                            value={selectedProviderId}
                            onChange={handleProviderChange}
                            className="gemini-model-select"
                            style={{ minWidth: '110px' }}
                        >
                            {providers.map(p => (
                                <option key={p.id} value={p.id}>{p.name}</option>
                            ))}
                        </select>
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

                {/* ROW 2: Active Document Options (b/w separator) */}
                <div style={{ padding: '8px 16px', borderTop: '1px solid var(--background-modifier-border)', display: 'flex', alignItems: 'center' }}>
                    <button
                        onClick={() => toggleDictation('force-insert')}
                        className={`gemini-dictation-pill ${isRecording && recordingMode === 'force-insert' ? 'recording' : ''}`}
                        title="Dictate to Active File"
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '6px',
                            padding: '4px 12px',
                            borderRadius: '16px',
                            border: '1px solid var(--background-modifier-border)',
                            background: isRecording && recordingMode === 'force-insert' ? '#ff4d4d' : 'var(--background-primary)',
                            color: isRecording && recordingMode === 'force-insert' ? 'white' : 'var(--text-normal)',
                            fontSize: '0.8rem',
                            cursor: 'pointer',
                            transition: 'all 0.2s ease',
                            boxShadow: '0 1px 2px rgba(0,0,0,0.05)'
                        }}
                    >
                        <span style={{ fontWeight: 500 }}>Dictation</span>
                        {isRecording && recordingMode === 'force-insert' ? <Square size={14} /> : <Mic size={14} />}
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
                                    {msg.usage && (
                                        <div className="gemini-usage-stats">
                                            Tokens: {msg.usage.promptTokenCount} prompt / {msg.usage.candidatesTokenCount} response / {msg.usage.totalTokenCount} total
                                        </div>
                                    )}
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
                        <textarea
                            value={obsidianInput}
                            onChange={(e) => setObsidianInput(e.target.value)}
                            onPaste={handlePaste}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' && !e.shiftKey) {
                                    e.preventDefault();
                                    handleSubmit(e, 'obsidian');
                                }
                            }}
                            placeholder={`Ask ${activeProvider?.name} Obsidian...`}
                            className="gemini-input obsidian"
                            rows={3}
                            style={{ resize: 'vertical' }}
                        />
                        <button
                            type="button"
                            className={`gemini-dictation-btn ${isRecording && recordingMode === 'default' ? 'recording' : ''}`}
                            onClick={() => toggleDictation('default')}
                            title="Dictate to Chat"
                        >
                            {isRecording && recordingMode === 'default' ? <Square size={14} /> : <Mic size={14} />}
                        </button>
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
                        <textarea
                            value={webInput}
                            onChange={(e) => setWebInput(e.target.value)}
                            onPaste={handlePaste}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' && !e.shiftKey) {
                                    e.preventDefault();
                                    handleSubmit(e, 'web');
                                }
                            }}
                            placeholder={`Ask ${activeProvider?.name} Web...`}
                            className="gemini-input web"
                            rows={3}
                            style={{ resize: 'vertical' }}
                        />
                        <button
                            type="button"
                            className={`gemini-dictation-btn ${isRecording && recordingMode === 'web-chat' ? 'recording' : ''}`}
                            onClick={() => toggleDictation('web-chat')}
                            title="Dictate to Web Chat"
                        >
                            {isRecording && recordingMode === 'web-chat' ? <Square size={14} /> : <Mic size={14} />}
                        </button>
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
