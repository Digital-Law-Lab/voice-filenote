import {
    App,
    Modal,
    Notice,
    Plugin,
    PluginSettingTab,
    Setting,
    TFile,
    moment,
    requestUrl,
} from "obsidian";

type RecordingMode = "new" | "append";

type NoticeLevel = "info" | "warn" | "error";

// Shows a Notice and mirrors it to the console at a matching level, so
// messages remain visible in Developer Tools after the toast disappears.
function notify(message: string, level: NoticeLevel = "info", err?: unknown): void {
    new Notice(message);
    const detail = err !== undefined ? [message, err] : [message];
    if (level === "error") console.error("[Voice Filenote]", ...detail);
    else if (level === "warn") console.warn("[Voice Filenote]", ...detail);
    else console.log("[Voice Filenote]", ...detail);
}

class QuotaExceededError extends Error {
    constructor(public readonly api: string) {
        super(`${api} quota exceeded`);
    }
}

interface VoiceFilenoteSettings {
    speechKey: string;
    speechRegion: string;
    openaiEndpoint: string;
    openaiKey: string;
    openaiDeployment: string;
    language: string;
    summaryPrompt: string;
    notesFolder: string;
    defaultMode: RecordingMode;
    enableDiarization: boolean;
    maxSpeakers: number;
}

const DEFAULT_SETTINGS: VoiceFilenoteSettings = {
    speechKey: "",
    speechRegion: "australiaeast",
    openaiEndpoint: "",
    openaiKey: "",
    openaiDeployment: "gpt-4o",
    language: "en-AU",
    enableDiarization: false,
    maxSpeakers: 4,
    summaryPrompt:
        "Provide a concise summary of the following voice note transcript. Highlight key points and any action items.",
    notesFolder: "Voice Notes",
    defaultMode: "new",
};

export default class VoiceFilenotePlugin extends Plugin {
    settings: VoiceFilenoteSettings;
    private mediaRecorder: MediaRecorder | null = null;
    private audioChunks: Blob[] = [];
    private isRecording = false;
    private pendingMode: RecordingMode = "new";
    private ribbonIconEl: HTMLElement | null = null;
    private statusBarEl: HTMLElement | null = null;

    async onload() {
        await this.loadSettings();

        this.ribbonIconEl = this.addRibbonIcon(
            "mic",
            "Voice Filenote: start/stop recording",
            () => this.toggleRecording(this.settings.defaultMode)
        );

        this.statusBarEl = this.addStatusBarItem();

        this.addCommand({
            id: "toggle-recording",
            name: "Start / stop recording (use default mode)",
            callback: () => this.toggleRecording(this.settings.defaultMode),
        });

        this.addCommand({
            id: "toggle-recording-new",
            name: "Start / stop recording → new note",
            callback: () => this.toggleRecording("new"),
        });

        this.addCommand({
            id: "toggle-recording-append",
            name: "Start / stop recording → append to current note",
            callback: () => this.toggleRecording("append"),
        });

        this.addCommand({
            id: "transcribe-file",
            name: "Transcribe audio file…",
            callback: () =>
                new AudioFileModal(this.app, this.settings.defaultMode, async (file, mode) => {
                    try {
                        await this.processAudioFile(file, mode);
                    } catch (err) {
                        notify(`Voice Filenote error: ${err.message}`, "error", err);
                    }
                }).open(),
        });

        this.addCommand({
            id: "retry-pending",
            name: "Retry pending transcriptions",
            callback: () => this.retryPendingTranscriptions(),
        });

        this.addSettingTab(new VoiceFilenoteSettingTab(this.app, this));
    }

    onunload() {
        if (this.isRecording) this.forceStopRecording();
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    private async toggleRecording(mode: RecordingMode) {
        if (this.isRecording) {
            await this.stopRecording();
        } else {
            await this.startRecording(mode);
        }
    }

    private async startRecording(mode: RecordingMode) {
        const { speechKey, openaiKey, openaiEndpoint } = this.settings;
        if (!speechKey || !openaiKey || !openaiEndpoint) {
            notify(
                "Voice Filenote: please fill in your API keys in Settings before recording.",
                "warn"
            );
            return;
        }

        if (mode === "append" && !this.app.workspace.getActiveFile()) {
            notify(
                "Voice Filenote: no note is currently open. Open a note first, or use 'new note' mode.",
                "warn"
            );
            return;
        }

        let stream: MediaStream;
        try {
            stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        } catch (err) {
            notify(`Voice Filenote: microphone access denied — ${err.message}`, "error", err);
            return;
        }

        const mimeType =
            ["audio/webm;codecs=opus", "audio/webm", "audio/ogg"].find((t) =>
                MediaRecorder.isTypeSupported(t)
            ) ?? "";

        this.audioChunks = [];
        this.pendingMode = mode;
        this.mediaRecorder = mimeType
            ? new MediaRecorder(stream, { mimeType })
            : new MediaRecorder(stream);

        this.mediaRecorder.ondataavailable = (e) => {
            if (e.data.size > 0) this.audioChunks.push(e.data);
        };

        this.mediaRecorder.start(1000);
        this.isRecording = true;
        this.ribbonIconEl?.addClass("voice-filenote-recording");
        this.statusBarEl?.setText("⏺ Recording…");
        notify("Voice Filenote: recording started.");
    }

    private async stopRecording() {
        if (!this.mediaRecorder) return;

        return new Promise<void>((resolve) => {
            this.mediaRecorder!.onstop = async () => {
                const mimeType = this.mediaRecorder?.mimeType || "audio/webm";
                const audioBlob = new Blob(this.audioChunks, { type: mimeType });
                this.mediaRecorder?.stream.getTracks().forEach((t) => t.stop());
                this.isRecording = false;
                this.ribbonIconEl?.removeClass("voice-filenote-recording");
                this.statusBarEl?.setText("⏳ Processing…");
                notify("Voice Filenote: recording stopped, processing…");

                try {
                    await this.processRecording(audioBlob, mimeType, this.pendingMode);
                } catch (err) {
                    notify(`Voice Filenote error: ${err.message}`, "error", err);
                } finally {
                    this.statusBarEl?.setText("");
                }
                resolve();
            };
            this.mediaRecorder!.stop();
        });
    }

    private forceStopRecording() {
        this.mediaRecorder?.stream.getTracks().forEach((t) => t.stop());
        this.mediaRecorder = null;
        this.isRecording = false;
    }

    private async processRecording(
        audioBlob: Blob,
        mimeType: string,
        mode: RecordingMode
    ) {
        const timestamp = moment().format("YYYY-MM-DD HH-mm-ss");
        const ext = mimeType.includes("ogg") ? "ogg" : "webm";
        const audioFilename = `Recording ${timestamp}.${ext}`;

        // Resolve the reference note path so we can honour vault attachment settings
        // that are relative to the current file (e.g. "./Attachments").
        const refNotePath =
            mode === "append"
                ? (this.app.workspace.getActiveFile()?.path ?? "")
                : `${this.settings.notesFolder}/Voice Note ${timestamp}.md`;

        const attachFolder = this.resolveAttachmentFolder(refNotePath);
        await this.ensureFolder(attachFolder);
        const audioPath = `${attachFolder}/${audioFilename}`;
        await this.app.vault.createBinary(audioPath, await audioBlob.arrayBuffer());

        this.statusBarEl?.setText("⏳ Transcribing…");
        let transcript: string;
        try {
            transcript = await this.transcribeAudio(audioBlob);
        } catch (err) {
            if (err instanceof QuotaExceededError) {
                const targetNote = mode === "append" ? (this.app.workspace.getActiveFile()?.path ?? "") : "";
                await this.createPendingNote(timestamp, audioFilename, audioPath, mode, targetNote);
                notify(
                    "Voice Filenote: Speech quota exceeded. Recording saved — run 'Retry pending transcriptions' when quota resets.",
                    "warn"
                );
                return;
            }
            throw err;
        }

        this.statusBarEl?.setText("⏳ Summarising…");
        const summary = await this.summarise(transcript);

        if (mode === "append") {
            await this.appendToCurrentNote(timestamp, audioFilename, transcript, summary);
        } else {
            await this.createNewNote(timestamp, audioFilename, transcript, summary);
        }
    }

    private async processAudioFile(file: File, mode: RecordingMode) {
        const timestamp = moment().format("YYYY-MM-DD HH-mm-ss");

        const refNotePath =
            mode === "append"
                ? (this.app.workspace.getActiveFile()?.path ?? "")
                : `${this.settings.notesFolder}/Voice Note ${timestamp}.md`;

        const attachFolder = this.resolveAttachmentFolder(refNotePath);
        await this.ensureFolder(attachFolder);
        const audioPath = `${attachFolder}/${file.name}`;

        if (!this.app.vault.getAbstractFileByPath(audioPath)) {
            await this.app.vault.createBinary(audioPath, await file.arrayBuffer());
        }

        this.statusBarEl?.setText("⏳ Transcribing…");
        notify("Voice Filenote: transcribing, this may take a moment…");

        let transcript: string;
        try {
            transcript = await this.transcribeAudio(file);
        } catch (err) {
            if (err instanceof QuotaExceededError) {
                const targetNote = mode === "append" ? (this.app.workspace.getActiveFile()?.path ?? "") : "";
                await this.createPendingNote(timestamp, file.name, audioPath, mode, targetNote);
                notify(
                    "Voice Filenote: Speech quota exceeded. File saved — run 'Retry pending transcriptions' when quota resets.",
                    "warn"
                );
                this.statusBarEl?.setText("");
                return;
            }
            this.statusBarEl?.setText("");
            throw err;
        }

        this.statusBarEl?.setText("⏳ Summarising…");
        const summary = await this.summarise(transcript);
        this.statusBarEl?.setText("");

        if (mode === "append") {
            await this.appendToCurrentNote(timestamp, file.name, transcript, summary);
        } else {
            await this.createNewNote(timestamp, file.name, transcript, summary);
        }
    }

    private async createPendingNote(
        timestamp: string,
        audioFilename: string,
        audioPath: string,
        mode: RecordingMode,
        targetNote: string
    ) {
        await this.ensureFolder(this.settings.notesFolder);
        const notePath = `${this.settings.notesFolder}/Voice Note ${timestamp}.md`;
        const content = `---
voice_filenote_pending: true
audio_path: "${audioPath}"
original_mode: "${mode}"
target_note: "${targetNote}"
timestamp: "${timestamp}"
created: ${timestamp}
tags:
  - voice-note
---

> [!warning] Transcription pending
> Azure Speech quota was exceeded. The recording has been saved.
> Run the **Retry pending transcriptions** command once your quota resets.

![[${audioFilename}]]
`;
        await this.app.vault.create(notePath, content);
    }

    private async retryPendingTranscriptions() {
        const pending = this.app.vault.getMarkdownFiles().filter(f => {
            const cache = this.app.metadataCache.getFileCache(f);
            return cache?.frontmatter?.voice_filenote_pending === true;
        });

        if (pending.length === 0) {
            notify("Voice Filenote: no pending transcriptions found.");
            return;
        }

        notify(`Voice Filenote: retrying ${pending.length} pending transcription(s)…`);

        for (const stubFile of pending) {
            const fm = this.app.metadataCache.getFileCache(stubFile)?.frontmatter;
            if (!fm) continue;

            const audioPath: string = fm.audio_path;
            const mode: RecordingMode = fm.original_mode;
            const targetNote: string = fm.target_note ?? "";
            const timestamp: string = fm.timestamp;

            const audioFile = this.app.vault.getAbstractFileByPath(audioPath);
            if (!(audioFile instanceof TFile)) {
                notify(`Voice Filenote: audio file not found — ${audioPath}`, "warn");
                continue;
            }

            try {
                const audioData = await this.app.vault.readBinary(audioFile);
                const audioBlob = new Blob([audioData], { type: this.audioMimeType(audioFile.name) });
                const audioFilename = audioFile.name;

                this.statusBarEl?.setText("⏳ Transcribing…");
                const transcript = await this.transcribeAudio(audioBlob);

                this.statusBarEl?.setText("⏳ Summarising…");
                const summary = await this.summarise(transcript);

                if (mode === "append" && targetNote) {
                    const targetFile = this.app.vault.getAbstractFileByPath(targetNote);
                    if (targetFile instanceof TFile) {
                        const existing = await this.app.vault.read(targetFile);
                        await this.app.vault.modify(
                            targetFile,
                            existing.trimEnd() + "\n\n" + this.buildAppendContent(timestamp, audioFilename, transcript, summary)
                        );
                        await this.app.vault.delete(stubFile);
                        notify(`Voice Filenote: appended to ${targetFile.basename}.`);
                        continue;
                    }
                }

                await this.app.vault.modify(
                    stubFile,
                    this.buildNewNoteContent(timestamp, audioFilename, transcript, summary)
                );
                notify(`Voice Filenote: transcription complete — ${stubFile.basename}.`);
            } catch (err) {
                if (err instanceof QuotaExceededError) {
                    notify("Voice Filenote: quota still exceeded. Try again later.", "warn");
                    break;
                }
                notify(`Voice Filenote: retry failed for ${stubFile.basename} — ${err.message}`, "error", err);
            } finally {
                this.statusBarEl?.setText("");
            }
        }
    }

    // Reads the vault's "Default location for new attachments" setting and
    // resolves it to an absolute vault path. The setting has four forms:
    //   ""        → vault root
    //   "folder"  → absolute folder from vault root
    //   "./"      → same folder as the note
    //   "./sub"   → subfolder relative to the note
    private resolveAttachmentFolder(notePath: string): string {
        const raw: string =
            (this.app.vault as any).getConfig("attachmentFolderPath") ?? "";

        if (!raw || raw === "/") return "/";

        if (raw.startsWith("./")) {
            const noteDir = notePath.includes("/")
                ? notePath.substring(0, notePath.lastIndexOf("/"))
                : "";
            const sub = raw.slice(2);
            return sub ? (noteDir ? `${noteDir}/${sub}` : sub) : (noteDir || "/");
        }

        return raw;
    }

    private async createNewNote(
        timestamp: string,
        audioFilename: string,
        transcript: string,
        summary: string
    ) {
        await this.ensureFolder(this.settings.notesFolder);
        const notePath = `${this.settings.notesFolder}/Voice Note ${timestamp}.md`;
        const content = this.buildNewNoteContent(timestamp, audioFilename, transcript, summary);
        const noteFile = await this.app.vault.create(notePath, content);
        await this.app.workspace.getLeaf(false).openFile(noteFile);
        notify("Voice Filenote: new note created.");
    }

    private async appendToCurrentNote(
        timestamp: string,
        audioFilename: string,
        transcript: string,
        summary: string
    ) {
        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile || !(activeFile instanceof TFile)) {
            throw new Error(
                "no note is currently open. Open a note first, or use 'new note' mode."
            );
        }

        const existing = await this.app.vault.read(activeFile);
        const appended =
            existing.trimEnd() +
            "\n\n" +
            this.buildAppendContent(timestamp, audioFilename, transcript, summary);
        await this.app.vault.modify(activeFile, appended);
        notify("Voice Filenote: appended to current note.");
    }

    // Azure's fast transcription endpoint rejects request bodies over
    // 524,288,000 bytes (500 MB). Stay a little under that to leave room
    // for multipart framing overhead.
    private static readonly MAX_UPLOAD_BYTES = 523_000_000;

    private async transcribeAudio(audioBlob: Blob): Promise<string> {
        if (audioBlob.size <= VoiceFilenotePlugin.MAX_UPLOAD_BYTES) {
            return this.transcribeChunk(audioBlob);
        }

        const sizeMb = (audioBlob.size / (1024 * 1024)).toFixed(0);
        let chunks: Blob[];
        try {
            chunks = await this.splitWavForUpload(audioBlob, VoiceFilenotePlugin.MAX_UPLOAD_BYTES);
        } catch (err) {
            throw new Error(
                `File is ${sizeMb} MB, which exceeds Azure Speech's 500 MB request limit, and it could not be split automatically (${err.message}). Please compress the audio or split it into shorter files before transcribing.`
            );
        }

        notify(`Voice Filenote: file is ${sizeMb} MB — splitting into ${chunks.length} parts for transcription…`);

        const transcripts: string[] = [];
        for (let i = 0; i < chunks.length; i++) {
            this.statusBarEl?.setText(`⏳ Transcribing part ${i + 1}/${chunks.length}…`);
            transcripts.push(await this.transcribeChunk(chunks[i]));
        }
        return transcripts.join(" ");
    }

    private async transcribeChunk(audioBlob: Blob): Promise<string> {
        const { speechKey, speechRegion, language, enableDiarization, maxSpeakers } = this.settings;

        // api-version 2025-10-15 is required for diarization support.
        const url = `https://${speechRegion}.api.cognitive.microsoft.com/speechtotext/transcriptions:transcribe?api-version=2025-10-15`;
        const definition: Record<string, unknown> = {
            locales: [language],
            profanityFilterMode: "None",
            channels: [0],
        };
        if (enableDiarization) {
            definition.diarization = { enabled: true, maxSpeakers };
        }
        const { body, contentType } = await this.buildMultipartBody(audioBlob, definition);

        const response = await requestUrl({
            url,
            method: "POST",
            headers: {
                "Ocp-Apim-Subscription-Key": speechKey,
                "Content-Type": contentType,
            },
            body,
            throw: false,
        });

        if (response.status === 429) {
            throw new QuotaExceededError("Azure Speech");
        }
        if (response.status < 200 || response.status >= 300) {
            throw new Error(`Speech API error ${response.status}: ${response.text}`);
        }

        return this.formatTranscript(response.json, enableDiarization);
    }

    // When diarization is on, groups consecutive same-speaker phrases into
    // labelled paragraphs. Otherwise falls back to the plain merged text.
    private formatTranscript(data: any, diarization: boolean): string {
        const phrases: { text: string; speaker?: number }[] = data.phrases ?? [];

        if (diarization && phrases.some((p) => p.speaker !== undefined)) {
            const paragraphs: string[] = [];
            let currentSpeaker: number | undefined;
            let buffer: string[] = [];
            const flush = () => {
                if (buffer.length > 0) {
                    paragraphs.push(`**Speaker ${currentSpeaker}:** ${buffer.join(" ")}`);
                    buffer = [];
                }
            };
            for (const p of phrases) {
                if (p.speaker !== currentSpeaker) {
                    flush();
                    currentSpeaker = p.speaker;
                }
                buffer.push(p.text);
            }
            flush();
            return paragraphs.join("\n\n");
        }

        const combined: { text: string }[] = data.combinedPhrases ?? [];
        if (combined.length > 0) return combined.map((p) => p.text).join(" ");
        return phrases.map((p) => p.text).join(" ");
    }

    // Parses a WAV file's fmt/data chunks so it can be split into
    // independently-playable sub-files without re-encoding.
    private parseWavHeader(buf: ArrayBuffer): {
        dataOffset: number;
        dataLength: number;
        audioFormat: number;
        sampleRate: number;
        channels: number;
        bitsPerSample: number;
        blockAlign: number;
    } {
        const view = new DataView(buf);
        if (
            view.byteLength < 12 ||
            view.getUint32(0, false) !== 0x52494646 /* "RIFF" */ ||
            view.getUint32(8, false) !== 0x57415645 /* "WAVE" */
        ) {
            throw new Error("not a valid WAV file");
        }

        let offset = 12;
        let dataOffset = -1;
        let dataLength = 0;
        let audioFormat = 1;
        let sampleRate = 0;
        let channels = 0;
        let bitsPerSample = 0;

        while (offset + 8 <= view.byteLength) {
            const chunkId = view.getUint32(offset, false);
            const chunkSize = view.getUint32(offset + 4, true);
            const chunkBodyOffset = offset + 8;

            if (chunkId === 0x666d7420 /* "fmt " */) {
                audioFormat = view.getUint16(chunkBodyOffset, true);
                channels = view.getUint16(chunkBodyOffset + 2, true);
                sampleRate = view.getUint32(chunkBodyOffset + 4, true);
                bitsPerSample = view.getUint16(chunkBodyOffset + 14, true);
            } else if (chunkId === 0x64617461 /* "data" */) {
                dataOffset = chunkBodyOffset;
                dataLength = Math.min(chunkSize, view.byteLength - chunkBodyOffset);
            }

            offset = chunkBodyOffset + chunkSize + (chunkSize % 2);
        }

        if (dataOffset < 0) throw new Error("WAV file has no data chunk");
        const blockAlign = channels * (bitsPerSample / 8);
        return { dataOffset, dataLength, audioFormat, sampleRate, channels, bitsPerSample, blockAlign };
    }

    private buildWavHeader(
        dataLength: number,
        audioFormat: number,
        sampleRate: number,
        channels: number,
        bitsPerSample: number
    ): ArrayBuffer {
        const blockAlign = channels * (bitsPerSample / 8);
        const byteRate = sampleRate * blockAlign;
        const buf = new ArrayBuffer(44);
        const view = new DataView(buf);
        const writeStr = (offset: number, str: string) => {
            for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
        };

        writeStr(0, "RIFF");
        view.setUint32(4, 36 + dataLength, true);
        writeStr(8, "WAVE");
        writeStr(12, "fmt ");
        view.setUint32(16, 16, true);
        view.setUint16(20, audioFormat, true);
        view.setUint16(22, channels, true);
        view.setUint32(24, sampleRate, true);
        view.setUint32(28, byteRate, true);
        view.setUint16(32, blockAlign, true);
        view.setUint16(34, bitsPerSample, true);
        writeStr(36, "data");
        view.setUint32(40, dataLength, true);
        return buf;
    }

    // Splits an oversized WAV file into standalone WAV blobs, each under
    // maxBytes, cut on sample-block boundaries so no audio frame is corrupted.
    private async splitWavForUpload(audioBlob: Blob, maxBytes: number): Promise<Blob[]> {
        const buf = await audioBlob.arrayBuffer();
        const { dataOffset, dataLength, audioFormat, sampleRate, channels, bitsPerSample, blockAlign } =
            this.parseWavHeader(buf);

        if (blockAlign <= 0) {
            throw new Error("could not determine WAV sample format");
        }

        const maxDataBytesPerChunk = Math.floor((maxBytes - 44) / blockAlign) * blockAlign;
        if (maxDataBytesPerChunk <= 0) {
            throw new Error("WAV format parameters prevent chunking within the size limit");
        }

        const chunks: Blob[] = [];
        const dataEnd = dataOffset + dataLength;
        let offset = dataOffset;
        while (offset < dataEnd) {
            const chunkDataLength = Math.min(maxDataBytesPerChunk, dataEnd - offset);
            const header = this.buildWavHeader(chunkDataLength, audioFormat, sampleRate, channels, bitsPerSample);
            const chunkData = buf.slice(offset, offset + chunkDataLength);
            chunks.push(new Blob([header, chunkData], { type: "audio/wav" }));
            offset += chunkDataLength;
        }
        return chunks;
    }

    private async summarise(transcript: string): Promise<string> {
        const { openaiEndpoint, openaiKey, openaiDeployment, summaryPrompt } =
            this.settings;

        const base = openaiEndpoint.replace(/\/$/, "");
        const url = `${base}/openai/deployments/${openaiDeployment}/chat/completions?api-version=2024-08-01-preview`;

        const response = await requestUrl({
            url,
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "api-key": openaiKey,
            },
            body: JSON.stringify({
                messages: [
                    {
                        role: "system",
                        content:
                            "You are a helpful assistant that summarises voice note transcripts for a legal practitioner. Be concise and use markdown formatting.",
                    },
                    {
                        role: "user",
                        content: `${summaryPrompt}\n\n${transcript}`,
                    },
                ],
                temperature: 0.3,
                max_tokens: 600,
            }),
            throw: false,
        });

        if (response.status < 200 || response.status >= 300) {
            throw new Error(`OpenAI API error ${response.status}: ${response.text}`);
        }

        return response.json.choices[0].message.content as string;
    }

    private audioMimeType(filename: string): string {
        const ext = filename.split(".").pop()?.toLowerCase() ?? "";
        const map: Record<string, string> = {
            mp3: "audio/mpeg",
            mp4: "audio/mp4",
            m4a: "audio/mp4",
            wav: "audio/wav",
            ogg: "audio/ogg",
            webm: "audio/webm",
            flac: "audio/flac",
            aac: "audio/aac",
            wma: "audio/x-ms-wma",
        };
        return map[ext] ?? "audio/webm";
    }

    // Constructs a multipart/form-data body manually because requestUrl
    // does not accept FormData objects.
    private async buildMultipartBody(
        audioBlob: Blob,
        definition: object
    ): Promise<{ body: ArrayBuffer; contentType: string }> {
        const boundary = "VoiceFilenote" + Date.now().toString(36);
        const enc = new TextEncoder();
        const audioData = await audioBlob.arrayBuffer();
        const filename = audioBlob instanceof File ? audioBlob.name : "recording.webm";
        const mimeType = (audioBlob instanceof File && audioBlob.type && audioBlob.type !== "application/octet-stream")
            ? audioBlob.type
            : this.audioMimeType(filename);

        const part1 = enc.encode(
            `--${boundary}\r\n` +
            `Content-Disposition: form-data; name="definition"\r\n` +
            `Content-Type: application/json\r\n\r\n` +
            JSON.stringify(definition) +
            `\r\n`
        );
        const part2Head = enc.encode(
            `--${boundary}\r\n` +
            `Content-Disposition: form-data; name="audio"; filename="${filename}"\r\n` +
            `Content-Type: ${mimeType}\r\n\r\n`
        );
        const part2Tail = enc.encode(`\r\n--${boundary}--\r\n`);

        const total = part1.byteLength + part2Head.byteLength + audioData.byteLength + part2Tail.byteLength;
        const buf = new Uint8Array(total);
        let off = 0;
        buf.set(part1, off);           off += part1.byteLength;
        buf.set(part2Head, off);       off += part2Head.byteLength;
        buf.set(new Uint8Array(audioData), off); off += audioData.byteLength;
        buf.set(part2Tail, off);

        return {
            body: buf.buffer,
            contentType: `multipart/form-data; boundary=${boundary}`,
        };
    }

    private buildNewNoteContent(
        timestamp: string,
        audioFilename: string,
        transcript: string,
        summary: string
    ): string {
        return `---
created: ${timestamp}
tags:
  - voice-note
---

# Voice Note — ${timestamp}

## Summary

${summary}

## Transcript

${transcript}

## Recording

![[${audioFilename}]]
`;
    }

    private buildAppendContent(
        timestamp: string,
        audioFilename: string,
        transcript: string,
        summary: string
    ): string {
        return `---

## Voice Note — ${timestamp}

### Summary

${summary}

### Transcript

${transcript}

### Recording

![[${audioFilename}]]
`;
    }

    private async ensureFolder(path: string) {
        if (!this.app.vault.getAbstractFileByPath(path)) {
            await this.app.vault.createFolder(path);
        }
    }
}

class VoiceFilenoteSettingTab extends PluginSettingTab {
    plugin: VoiceFilenotePlugin;

    constructor(app: App, plugin: VoiceFilenotePlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();
        containerEl.createEl("h2", { text: "Voice Filenote" });

        // ── Recording behaviour ──────────────────────────────────────────────
        containerEl.createEl("h3", { text: "Recording behaviour" });

        new Setting(containerEl)
            .setName("Default mode")
            .setDesc(
                "What happens when you click the ribbon icon or run the default recording command."
            )
            .addDropdown((d) =>
                d
                    .addOption("new", "Create a new note")
                    .addOption("append", "Append to the current open note")
                    .setValue(this.plugin.settings.defaultMode)
                    .onChange(async (v) => {
                        this.plugin.settings.defaultMode = v as RecordingMode;
                        await this.plugin.saveSettings();
                    })
            );

        // ── Speech ──────────────────────────────────────────────────────────
        containerEl.createEl("h3", { text: "Azure AI Speech (transcription)" });

        new Setting(containerEl)
            .setName("API key")
            .setDesc("Key 1 from your Azure AI Speech resource")
            .addText((t) =>
                t
                    .setPlaceholder("Paste key here")
                    .setValue(this.plugin.settings.speechKey)
                    .onChange(async (v) => {
                        this.plugin.settings.speechKey = v.trim();
                        await this.plugin.saveSettings();
                    })
            );

        new Setting(containerEl)
            .setName("Region")
            .setDesc("Azure region of your Speech resource")
            .addText((t) =>
                t
                    .setPlaceholder("australiaeast")
                    .setValue(this.plugin.settings.speechRegion)
                    .onChange(async (v) => {
                        this.plugin.settings.speechRegion = v.trim().toLowerCase();
                        await this.plugin.saveSettings();
                    })
            );

        new Setting(containerEl)
            .setName("Language")
            .setDesc("BCP-47 language code (e.g. en-AU, en-US)")
            .addText((t) =>
                t
                    .setPlaceholder("en-AU")
                    .setValue(this.plugin.settings.language)
                    .onChange(async (v) => {
                        this.plugin.settings.language = v.trim();
                        await this.plugin.saveSettings();
                    })
            );

        new Setting(containerEl)
            .setName("Identify speakers")
            .setDesc(
                "Label the transcript by speaker (e.g. 'Speaker 1: …'). Only works on single-channel audio. " +
                "Note: speaker numbers reset for each part of a file that's split for size, so they may not line up across parts."
            )
            .addToggle((t) =>
                t
                    .setValue(this.plugin.settings.enableDiarization)
                    .onChange(async (v) => {
                        this.plugin.settings.enableDiarization = v;
                        await this.plugin.saveSettings();
                    })
            );

        new Setting(containerEl)
            .setName("Maximum speakers")
            .setDesc("Upper bound on the number of distinct speakers to detect (2–35).")
            .addSlider((s) =>
                s
                    .setLimits(2, 35, 1)
                    .setValue(this.plugin.settings.maxSpeakers)
                    .setDynamicTooltip()
                    .onChange(async (v) => {
                        this.plugin.settings.maxSpeakers = v;
                        await this.plugin.saveSettings();
                    })
            );

        // ── OpenAI ──────────────────────────────────────────────────────────
        containerEl.createEl("h3", { text: "Azure OpenAI (summarisation)" });

        new Setting(containerEl)
            .setName("Endpoint")
            .setDesc("Endpoint URL from your Azure OpenAI resource")
            .addText((t) =>
                t
                    .setPlaceholder("https://my-openai.openai.azure.com/")
                    .setValue(this.plugin.settings.openaiEndpoint)
                    .onChange(async (v) => {
                        this.plugin.settings.openaiEndpoint = v.trim();
                        await this.plugin.saveSettings();
                    })
            );

        new Setting(containerEl)
            .setName("API key")
            .setDesc("Key 1 from your Azure OpenAI resource")
            .addText((t) =>
                t
                    .setPlaceholder("Paste key here")
                    .setValue(this.plugin.settings.openaiKey)
                    .onChange(async (v) => {
                        this.plugin.settings.openaiKey = v.trim();
                        await this.plugin.saveSettings();
                    })
            );

        new Setting(containerEl)
            .setName("Deployment name")
            .setDesc("The name you gave the GPT-4o deployment")
            .addText((t) =>
                t
                    .setPlaceholder("gpt-4o")
                    .setValue(this.plugin.settings.openaiDeployment)
                    .onChange(async (v) => {
                        this.plugin.settings.openaiDeployment = v.trim();
                        await this.plugin.saveSettings();
                    })
            );

        // ── Notes ───────────────────────────────────────────────────────────
        containerEl.createEl("h3", { text: "Notes" });

        new Setting(containerEl)
            .setName("Notes folder")
            .setDesc("Where new voice note files are created in your vault")
            .addText((t) =>
                t
                    .setPlaceholder("Voice Notes")
                    .setValue(this.plugin.settings.notesFolder)
                    .onChange(async (v) => {
                        this.plugin.settings.notesFolder = v.trim();
                        await this.plugin.saveSettings();
                    })
            );

        new Setting(containerEl)
            .setName("Summary prompt")
            .setDesc("Instruction sent to GPT-4o along with the transcript")
            .addTextArea((t) => {
                t.setPlaceholder("Provide a concise summary…")
                    .setValue(this.plugin.settings.summaryPrompt)
                    .onChange(async (v) => {
                        this.plugin.settings.summaryPrompt = v;
                        await this.plugin.saveSettings();
                    });
                t.inputEl.rows = 4;
                t.inputEl.style.width = "100%";
            });
    }
}

class AudioFileModal extends Modal {
    private file: File | null = null;
    private mode: RecordingMode;
    private readonly onSubmit: (file: File, mode: RecordingMode) => void;

    constructor(app: App, defaultMode: RecordingMode, onSubmit: (file: File, mode: RecordingMode) => void) {
        super(app);
        this.mode = defaultMode;
        this.onSubmit = onSubmit;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.createEl("h2", { text: "Transcribe audio file" });

        const fileInput = contentEl.createEl("input");
        fileInput.type = "file";
        fileInput.accept = "audio/*,.m4a,.mp3,.wav,.ogg,.webm,.flac,.mp4,.aac";
        fileInput.style.cssText = "display:block; width:100%; margin-bottom:1em;";
        fileInput.onchange = () => { this.file = fileInput.files?.[0] ?? null; };

        new Setting(contentEl)
            .setName("Mode")
            .addDropdown(dd => {
                dd.addOption("new", "Create new note");
                dd.addOption("append", "Append to current note");
                dd.setValue(this.mode);
                dd.onChange(v => { this.mode = v as RecordingMode; });
            });

        new Setting(contentEl)
            .addButton(btn =>
                btn.setButtonText("Transcribe")
                   .setCta()
                   .onClick(() => {
                       if (!this.file) {
                           notify("Voice Filenote: please select an audio file.", "warn");
                           return;
                       }
                       this.close();
                       this.onSubmit(this.file, this.mode);
                   })
            );
    }

    onClose() {
        this.contentEl.empty();
    }
}
