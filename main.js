var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/main.ts
var main_exports = {};
__export(main_exports, {
  default: () => VoiceFilenotePlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian = require("obsidian");
var QuotaExceededError = class extends Error {
  constructor(api) {
    super(`${api} quota exceeded`);
    this.api = api;
  }
};
var DEFAULT_SETTINGS = {
  speechKey: "",
  speechRegion: "australiaeast",
  openaiEndpoint: "",
  openaiKey: "",
  openaiDeployment: "gpt-4o",
  language: "en-AU",
  summaryPrompt: "Provide a concise summary of the following voice note transcript. Highlight key points and any action items.",
  notesFolder: "Voice Notes",
  defaultMode: "new"
};
var VoiceFilenotePlugin = class extends import_obsidian.Plugin {
  constructor() {
    super(...arguments);
    this.mediaRecorder = null;
    this.audioChunks = [];
    this.isRecording = false;
    this.pendingMode = "new";
    this.ribbonIconEl = null;
    this.statusBarEl = null;
  }
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
      callback: () => this.toggleRecording(this.settings.defaultMode)
    });
    this.addCommand({
      id: "toggle-recording-new",
      name: "Start / stop recording \u2192 new note",
      callback: () => this.toggleRecording("new")
    });
    this.addCommand({
      id: "toggle-recording-append",
      name: "Start / stop recording \u2192 append to current note",
      callback: () => this.toggleRecording("append")
    });
    this.addCommand({
      id: "transcribe-file",
      name: "Transcribe audio file\u2026",
      callback: () => new AudioFileModal(
        this.app,
        this.settings.defaultMode,
        (file, mode) => this.processAudioFile(file, mode)
      ).open()
    });
    this.addCommand({
      id: "retry-pending",
      name: "Retry pending transcriptions",
      callback: () => this.retryPendingTranscriptions()
    });
    this.addSettingTab(new VoiceFilenoteSettingTab(this.app, this));
  }
  onunload() {
    if (this.isRecording)
      this.forceStopRecording();
  }
  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }
  async saveSettings() {
    await this.saveData(this.settings);
  }
  async toggleRecording(mode) {
    if (this.isRecording) {
      await this.stopRecording();
    } else {
      await this.startRecording(mode);
    }
  }
  async startRecording(mode) {
    var _a, _b, _c;
    const { speechKey, openaiKey, openaiEndpoint } = this.settings;
    if (!speechKey || !openaiKey || !openaiEndpoint) {
      new import_obsidian.Notice(
        "Voice Filenote: please fill in your API keys in Settings before recording."
      );
      return;
    }
    if (mode === "append" && !this.app.workspace.getActiveFile()) {
      new import_obsidian.Notice(
        "Voice Filenote: no note is currently open. Open a note first, or use 'new note' mode."
      );
      return;
    }
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      new import_obsidian.Notice(`Voice Filenote: microphone access denied \u2014 ${err.message}`);
      return;
    }
    const mimeType = (_a = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg"].find(
      (t) => MediaRecorder.isTypeSupported(t)
    )) != null ? _a : "";
    this.audioChunks = [];
    this.pendingMode = mode;
    this.mediaRecorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    this.mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0)
        this.audioChunks.push(e.data);
    };
    this.mediaRecorder.start(1e3);
    this.isRecording = true;
    (_b = this.ribbonIconEl) == null ? void 0 : _b.addClass("voice-filenote-recording");
    (_c = this.statusBarEl) == null ? void 0 : _c.setText("\u23FA Recording\u2026");
    new import_obsidian.Notice("Voice Filenote: recording started.");
  }
  async stopRecording() {
    if (!this.mediaRecorder)
      return;
    return new Promise((resolve) => {
      this.mediaRecorder.onstop = async () => {
        var _a, _b, _c, _d, _e;
        const mimeType = ((_a = this.mediaRecorder) == null ? void 0 : _a.mimeType) || "audio/webm";
        const audioBlob = new Blob(this.audioChunks, { type: mimeType });
        (_b = this.mediaRecorder) == null ? void 0 : _b.stream.getTracks().forEach((t) => t.stop());
        this.isRecording = false;
        (_c = this.ribbonIconEl) == null ? void 0 : _c.removeClass("voice-filenote-recording");
        (_d = this.statusBarEl) == null ? void 0 : _d.setText("\u23F3 Processing\u2026");
        new import_obsidian.Notice("Voice Filenote: recording stopped, processing\u2026");
        try {
          await this.processRecording(audioBlob, mimeType, this.pendingMode);
        } catch (err) {
          new import_obsidian.Notice(`Voice Filenote error: ${err.message}`);
          console.error("[Voice Filenote]", err);
        } finally {
          (_e = this.statusBarEl) == null ? void 0 : _e.setText("");
        }
        resolve();
      };
      this.mediaRecorder.stop();
    });
  }
  forceStopRecording() {
    var _a;
    (_a = this.mediaRecorder) == null ? void 0 : _a.stream.getTracks().forEach((t) => t.stop());
    this.mediaRecorder = null;
    this.isRecording = false;
  }
  async processRecording(audioBlob, mimeType, mode) {
    var _a, _b, _c, _d, _e, _f;
    const timestamp = (0, import_obsidian.moment)().format("YYYY-MM-DD HH-mm-ss");
    const ext = mimeType.includes("ogg") ? "ogg" : "webm";
    const audioFilename = `Recording ${timestamp}.${ext}`;
    const refNotePath = mode === "append" ? (_b = (_a = this.app.workspace.getActiveFile()) == null ? void 0 : _a.path) != null ? _b : "" : `${this.settings.notesFolder}/Voice Note ${timestamp}.md`;
    const attachFolder = this.resolveAttachmentFolder(refNotePath);
    await this.ensureFolder(attachFolder);
    const audioPath = `${attachFolder}/${audioFilename}`;
    await this.app.vault.createBinary(audioPath, await audioBlob.arrayBuffer());
    (_c = this.statusBarEl) == null ? void 0 : _c.setText("\u23F3 Transcribing\u2026");
    let transcript;
    try {
      transcript = await this.transcribeAudio(audioBlob);
    } catch (err) {
      if (err instanceof QuotaExceededError) {
        const targetNote = mode === "append" ? (_e = (_d = this.app.workspace.getActiveFile()) == null ? void 0 : _d.path) != null ? _e : "" : "";
        await this.createPendingNote(timestamp, audioFilename, audioPath, mode, targetNote);
        new import_obsidian.Notice("Voice Filenote: Speech quota exceeded. Recording saved \u2014 run 'Retry pending transcriptions' when quota resets.");
        return;
      }
      throw err;
    }
    (_f = this.statusBarEl) == null ? void 0 : _f.setText("\u23F3 Summarising\u2026");
    const summary = await this.summarise(transcript);
    if (mode === "append") {
      await this.appendToCurrentNote(timestamp, audioFilename, transcript, summary);
    } else {
      await this.createNewNote(timestamp, audioFilename, transcript, summary);
    }
  }
  async processAudioFile(file, mode) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _i;
    const timestamp = (0, import_obsidian.moment)().format("YYYY-MM-DD HH-mm-ss");
    const refNotePath = mode === "append" ? (_b = (_a = this.app.workspace.getActiveFile()) == null ? void 0 : _a.path) != null ? _b : "" : `${this.settings.notesFolder}/Voice Note ${timestamp}.md`;
    const attachFolder = this.resolveAttachmentFolder(refNotePath);
    await this.ensureFolder(attachFolder);
    const audioPath = `${attachFolder}/${file.name}`;
    if (!this.app.vault.getAbstractFileByPath(audioPath)) {
      await this.app.vault.createBinary(audioPath, await file.arrayBuffer());
    }
    (_c = this.statusBarEl) == null ? void 0 : _c.setText("\u23F3 Transcribing\u2026");
    new import_obsidian.Notice("Voice Filenote: transcribing, this may take a moment\u2026");
    let transcript;
    try {
      transcript = await this.transcribeAudio(file);
    } catch (err) {
      if (err instanceof QuotaExceededError) {
        const targetNote = mode === "append" ? (_e = (_d = this.app.workspace.getActiveFile()) == null ? void 0 : _d.path) != null ? _e : "" : "";
        await this.createPendingNote(timestamp, file.name, audioPath, mode, targetNote);
        new import_obsidian.Notice("Voice Filenote: Speech quota exceeded. File saved \u2014 run 'Retry pending transcriptions' when quota resets.");
        (_f = this.statusBarEl) == null ? void 0 : _f.setText("");
        return;
      }
      (_g = this.statusBarEl) == null ? void 0 : _g.setText("");
      throw err;
    }
    (_h = this.statusBarEl) == null ? void 0 : _h.setText("\u23F3 Summarising\u2026");
    const summary = await this.summarise(transcript);
    (_i = this.statusBarEl) == null ? void 0 : _i.setText("");
    if (mode === "append") {
      await this.appendToCurrentNote(timestamp, file.name, transcript, summary);
    } else {
      await this.createNewNote(timestamp, file.name, transcript, summary);
    }
  }
  async createPendingNote(timestamp, audioFilename, audioPath, mode, targetNote) {
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
  async retryPendingTranscriptions() {
    var _a, _b, _c, _d, _e;
    const pending = this.app.vault.getMarkdownFiles().filter((f) => {
      var _a2;
      const cache = this.app.metadataCache.getFileCache(f);
      return ((_a2 = cache == null ? void 0 : cache.frontmatter) == null ? void 0 : _a2.voice_filenote_pending) === true;
    });
    if (pending.length === 0) {
      new import_obsidian.Notice("Voice Filenote: no pending transcriptions found.");
      return;
    }
    new import_obsidian.Notice(`Voice Filenote: retrying ${pending.length} pending transcription(s)\u2026`);
    for (const stubFile of pending) {
      const fm = (_a = this.app.metadataCache.getFileCache(stubFile)) == null ? void 0 : _a.frontmatter;
      if (!fm)
        continue;
      const audioPath = fm.audio_path;
      const mode = fm.original_mode;
      const targetNote = (_b = fm.target_note) != null ? _b : "";
      const timestamp = fm.timestamp;
      const audioFile = this.app.vault.getAbstractFileByPath(audioPath);
      if (!(audioFile instanceof import_obsidian.TFile)) {
        new import_obsidian.Notice(`Voice Filenote: audio file not found \u2014 ${audioPath}`);
        continue;
      }
      try {
        const audioData = await this.app.vault.readBinary(audioFile);
        const audioBlob = new Blob([audioData], { type: this.audioMimeType(audioFile.name) });
        const audioFilename = audioFile.name;
        (_c = this.statusBarEl) == null ? void 0 : _c.setText("\u23F3 Transcribing\u2026");
        const transcript = await this.transcribeAudio(audioBlob);
        (_d = this.statusBarEl) == null ? void 0 : _d.setText("\u23F3 Summarising\u2026");
        const summary = await this.summarise(transcript);
        if (mode === "append" && targetNote) {
          const targetFile = this.app.vault.getAbstractFileByPath(targetNote);
          if (targetFile instanceof import_obsidian.TFile) {
            const existing = await this.app.vault.read(targetFile);
            await this.app.vault.modify(
              targetFile,
              existing.trimEnd() + "\n\n" + this.buildAppendContent(timestamp, audioFilename, transcript, summary)
            );
            await this.app.vault.delete(stubFile);
            new import_obsidian.Notice(`Voice Filenote: appended to ${targetFile.basename}.`);
            continue;
          }
        }
        await this.app.vault.modify(
          stubFile,
          this.buildNewNoteContent(timestamp, audioFilename, transcript, summary)
        );
        new import_obsidian.Notice(`Voice Filenote: transcription complete \u2014 ${stubFile.basename}.`);
      } catch (err) {
        if (err instanceof QuotaExceededError) {
          new import_obsidian.Notice("Voice Filenote: quota still exceeded. Try again later.");
          break;
        }
        new import_obsidian.Notice(`Voice Filenote: retry failed for ${stubFile.basename} \u2014 ${err.message}`);
      } finally {
        (_e = this.statusBarEl) == null ? void 0 : _e.setText("");
      }
    }
  }
  // Reads the vault's "Default location for new attachments" setting and
  // resolves it to an absolute vault path. The setting has four forms:
  //   ""        → vault root
  //   "folder"  → absolute folder from vault root
  //   "./"      → same folder as the note
  //   "./sub"   → subfolder relative to the note
  resolveAttachmentFolder(notePath) {
    var _a;
    const raw = (_a = this.app.vault.getConfig("attachmentFolderPath")) != null ? _a : "";
    if (!raw || raw === "/")
      return "/";
    if (raw.startsWith("./")) {
      const noteDir = notePath.includes("/") ? notePath.substring(0, notePath.lastIndexOf("/")) : "";
      const sub = raw.slice(2);
      return sub ? noteDir ? `${noteDir}/${sub}` : sub : noteDir || "/";
    }
    return raw;
  }
  async createNewNote(timestamp, audioFilename, transcript, summary) {
    await this.ensureFolder(this.settings.notesFolder);
    const notePath = `${this.settings.notesFolder}/Voice Note ${timestamp}.md`;
    const content = this.buildNewNoteContent(timestamp, audioFilename, transcript, summary);
    const noteFile = await this.app.vault.create(notePath, content);
    await this.app.workspace.getLeaf(false).openFile(noteFile);
    new import_obsidian.Notice("Voice Filenote: new note created.");
  }
  async appendToCurrentNote(timestamp, audioFilename, transcript, summary) {
    const activeFile = this.app.workspace.getActiveFile();
    if (!activeFile || !(activeFile instanceof import_obsidian.TFile)) {
      throw new Error(
        "no note is currently open. Open a note first, or use 'new note' mode."
      );
    }
    const existing = await this.app.vault.read(activeFile);
    const appended = existing.trimEnd() + "\n\n" + this.buildAppendContent(timestamp, audioFilename, transcript, summary);
    await this.app.vault.modify(activeFile, appended);
    new import_obsidian.Notice("Voice Filenote: appended to current note.");
  }
  async transcribeAudio(audioBlob) {
    var _a, _b;
    const { speechKey, speechRegion, language } = this.settings;
    const url = `https://${speechRegion}.api.cognitive.microsoft.com/speechtotext/transcriptions:transcribe?api-version=2024-11-15`;
    const { body, contentType } = await this.buildMultipartBody(audioBlob, {
      locales: [language],
      profanityFilterMode: "None",
      channels: [0]
    });
    const response = await (0, import_obsidian.requestUrl)({
      url,
      method: "POST",
      headers: {
        "Ocp-Apim-Subscription-Key": speechKey,
        "Content-Type": contentType
      },
      body,
      throw: false
    });
    if (response.status === 429) {
      throw new QuotaExceededError("Azure Speech");
    }
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`Speech API error ${response.status}: ${response.text}`);
    }
    const data = response.json;
    const combined = (_a = data.combinedPhrases) != null ? _a : [];
    if (combined.length > 0)
      return combined.map((p) => p.text).join(" ");
    const phrases = (_b = data.phrases) != null ? _b : [];
    return phrases.map((p) => p.text).join(" ");
  }
  async summarise(transcript) {
    const { openaiEndpoint, openaiKey, openaiDeployment, summaryPrompt } = this.settings;
    const base = openaiEndpoint.replace(/\/$/, "");
    const url = `${base}/openai/deployments/${openaiDeployment}/chat/completions?api-version=2024-08-01-preview`;
    const response = await (0, import_obsidian.requestUrl)({
      url,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": openaiKey
      },
      body: JSON.stringify({
        messages: [
          {
            role: "system",
            content: "You are a helpful assistant that summarises voice note transcripts for a legal practitioner. Be concise and use markdown formatting."
          },
          {
            role: "user",
            content: `${summaryPrompt}

${transcript}`
          }
        ],
        temperature: 0.3,
        max_tokens: 600
      }),
      throw: false
    });
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`OpenAI API error ${response.status}: ${response.text}`);
    }
    return response.json.choices[0].message.content;
  }
  audioMimeType(filename) {
    var _a, _b, _c;
    const ext = (_b = (_a = filename.split(".").pop()) == null ? void 0 : _a.toLowerCase()) != null ? _b : "";
    const map = {
      mp3: "audio/mpeg",
      mp4: "audio/mp4",
      m4a: "audio/mp4",
      wav: "audio/wav",
      ogg: "audio/ogg",
      webm: "audio/webm",
      flac: "audio/flac",
      aac: "audio/aac",
      wma: "audio/x-ms-wma"
    };
    return (_c = map[ext]) != null ? _c : "audio/webm";
  }
  // Constructs a multipart/form-data body manually because requestUrl
  // does not accept FormData objects.
  async buildMultipartBody(audioBlob, definition) {
    const boundary = "VoiceFilenote" + Date.now().toString(36);
    const enc = new TextEncoder();
    const audioData = await audioBlob.arrayBuffer();
    const filename = audioBlob instanceof File ? audioBlob.name : "recording.webm";
    const mimeType = audioBlob instanceof File && audioBlob.type && audioBlob.type !== "application/octet-stream" ? audioBlob.type : this.audioMimeType(filename);
    const part1 = enc.encode(
      `--${boundary}\r
Content-Disposition: form-data; name="definition"\r
Content-Type: application/json\r
\r
` + JSON.stringify(definition) + `\r
`
    );
    const part2Head = enc.encode(
      `--${boundary}\r
Content-Disposition: form-data; name="audio"; filename="${filename}"\r
Content-Type: ${mimeType}\r
\r
`
    );
    const part2Tail = enc.encode(`\r
--${boundary}--\r
`);
    const total = part1.byteLength + part2Head.byteLength + audioData.byteLength + part2Tail.byteLength;
    const buf = new Uint8Array(total);
    let off = 0;
    buf.set(part1, off);
    off += part1.byteLength;
    buf.set(part2Head, off);
    off += part2Head.byteLength;
    buf.set(new Uint8Array(audioData), off);
    off += audioData.byteLength;
    buf.set(part2Tail, off);
    return {
      body: buf.buffer,
      contentType: `multipart/form-data; boundary=${boundary}`
    };
  }
  buildNewNoteContent(timestamp, audioFilename, transcript, summary) {
    return `---
created: ${timestamp}
tags:
  - voice-note
---

# Voice Note \u2014 ${timestamp}

## Summary

${summary}

## Transcript

${transcript}

## Recording

![[${audioFilename}]]
`;
  }
  buildAppendContent(timestamp, audioFilename, transcript, summary) {
    return `---

## Voice Note \u2014 ${timestamp}

### Summary

${summary}

### Transcript

${transcript}

### Recording

![[${audioFilename}]]
`;
  }
  async ensureFolder(path) {
    if (!this.app.vault.getAbstractFileByPath(path)) {
      await this.app.vault.createFolder(path);
    }
  }
};
var VoiceFilenoteSettingTab = class extends import_obsidian.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Voice Filenote" });
    containerEl.createEl("h3", { text: "Recording behaviour" });
    new import_obsidian.Setting(containerEl).setName("Default mode").setDesc(
      "What happens when you click the ribbon icon or run the default recording command."
    ).addDropdown(
      (d) => d.addOption("new", "Create a new note").addOption("append", "Append to the current open note").setValue(this.plugin.settings.defaultMode).onChange(async (v) => {
        this.plugin.settings.defaultMode = v;
        await this.plugin.saveSettings();
      })
    );
    containerEl.createEl("h3", { text: "Azure AI Speech (transcription)" });
    new import_obsidian.Setting(containerEl).setName("API key").setDesc("Key 1 from your Azure AI Speech resource").addText(
      (t) => t.setPlaceholder("Paste key here").setValue(this.plugin.settings.speechKey).onChange(async (v) => {
        this.plugin.settings.speechKey = v.trim();
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Region").setDesc("Azure region of your Speech resource").addText(
      (t) => t.setPlaceholder("australiaeast").setValue(this.plugin.settings.speechRegion).onChange(async (v) => {
        this.plugin.settings.speechRegion = v.trim().toLowerCase();
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Language").setDesc("BCP-47 language code (e.g. en-AU, en-US)").addText(
      (t) => t.setPlaceholder("en-AU").setValue(this.plugin.settings.language).onChange(async (v) => {
        this.plugin.settings.language = v.trim();
        await this.plugin.saveSettings();
      })
    );
    containerEl.createEl("h3", { text: "Azure OpenAI (summarisation)" });
    new import_obsidian.Setting(containerEl).setName("Endpoint").setDesc("Endpoint URL from your Azure OpenAI resource").addText(
      (t) => t.setPlaceholder("https://my-openai.openai.azure.com/").setValue(this.plugin.settings.openaiEndpoint).onChange(async (v) => {
        this.plugin.settings.openaiEndpoint = v.trim();
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("API key").setDesc("Key 1 from your Azure OpenAI resource").addText(
      (t) => t.setPlaceholder("Paste key here").setValue(this.plugin.settings.openaiKey).onChange(async (v) => {
        this.plugin.settings.openaiKey = v.trim();
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Deployment name").setDesc("The name you gave the GPT-4o deployment").addText(
      (t) => t.setPlaceholder("gpt-4o").setValue(this.plugin.settings.openaiDeployment).onChange(async (v) => {
        this.plugin.settings.openaiDeployment = v.trim();
        await this.plugin.saveSettings();
      })
    );
    containerEl.createEl("h3", { text: "Notes" });
    new import_obsidian.Setting(containerEl).setName("Notes folder").setDesc("Where new voice note files are created in your vault").addText(
      (t) => t.setPlaceholder("Voice Notes").setValue(this.plugin.settings.notesFolder).onChange(async (v) => {
        this.plugin.settings.notesFolder = v.trim();
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Summary prompt").setDesc("Instruction sent to GPT-4o along with the transcript").addTextArea((t) => {
      t.setPlaceholder("Provide a concise summary\u2026").setValue(this.plugin.settings.summaryPrompt).onChange(async (v) => {
        this.plugin.settings.summaryPrompt = v;
        await this.plugin.saveSettings();
      });
      t.inputEl.rows = 4;
      t.inputEl.style.width = "100%";
    });
  }
};
var AudioFileModal = class extends import_obsidian.Modal {
  constructor(app, defaultMode, onSubmit) {
    super(app);
    this.file = null;
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
    fileInput.onchange = () => {
      var _a, _b;
      this.file = (_b = (_a = fileInput.files) == null ? void 0 : _a[0]) != null ? _b : null;
    };
    new import_obsidian.Setting(contentEl).setName("Mode").addDropdown((dd) => {
      dd.addOption("new", "Create new note");
      dd.addOption("append", "Append to current note");
      dd.setValue(this.mode);
      dd.onChange((v) => {
        this.mode = v;
      });
    });
    new import_obsidian.Setting(contentEl).addButton(
      (btn) => btn.setButtonText("Transcribe").setCta().onClick(() => {
        if (!this.file) {
          new import_obsidian.Notice("Voice Filenote: please select an audio file.");
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
};
