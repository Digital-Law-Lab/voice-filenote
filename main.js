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
function notify(message, level = "info", err) {
  new import_obsidian.Notice(message);
  const detail = err !== void 0 ? [message, err] : [message];
  if (level === "error")
    console.error("[Voice Filenote]", ...detail);
  else if (level === "warn")
    console.warn("[Voice Filenote]", ...detail);
  else
    console.log("[Voice Filenote]", ...detail);
}
var QuotaExceededError = class extends Error {
  constructor(api) {
    super(`${api} quota exceeded`);
    this.api = api;
  }
};
var LEGACY_SUMMARY_PROMPT = "Provide a concise summary of the following voice note transcript. Highlight key points and any action items.";
var SUMMARY_SYSTEM_PROMPT = `You summarise voice recordings for an Australian legal practitioner. Your summary is saved into their notes and may later be relied on as a file note, so accuracy matters more than polish.

First decide what kind of recording this is:
- A conversation (meeting, phone call, conference) with two or more people \u2192 write a FILE NOTE.
- One person speaking (dictation, notes to self, thinking aloud) \u2192 write a DICTATION SUMMARY.

FILE NOTE \u2014 use these markdown sections, omitting any that would be empty:
### Attendees
Each person and, where it is clear, their role or relationship to the matter. Use the speaker names exactly as they appear in the transcript. If a speaker is unnamed (e.g. "Speaker 2"), keep that label and add who they appear to be only if the transcript makes it clear.
### Purpose
One or two sentences: what the conversation was about and which matter or client it relates to.
### Facts and instructions
What the client or other party told the practitioner, and any instructions given. Attribute each point to who said it.
### Advice given
Advice, opinions or recommendations the practitioner gave. Keep this separate from facts and instructions.
### Action items
A checklist ("- [ ] ...") with who is responsible and any due date mentioned.
### Key details
Dates, deadlines, amounts, names, addresses, reference or file numbers mentioned.
### To check
Anything unclear, inaudible, contradictory, or likely mis-transcribed.

DICTATION SUMMARY \u2014 use these sections, omitting any that would be empty:
### Summary
The main points, in the speaker's own framing.
### Action items
As above.
### Key details
As above.
### To check
As above.

Rules:
- Use only what is in the transcript. Never fill gaps with assumptions, and never invent names, dates, amounts or outcomes.
- Keep relative dates as spoken ("end of the week", "next Tuesday"). Don't convert them into calendar dates.
- The transcript is machine-generated. Names and legal terms are often mis-heard (e.g. a surname transcribed as ordinary words). If something looks like a mis-transcription, keep it as transcribed and list it under To check with your best guess, rather than silently correcting it.
- If the transcript is split into Parts, speaker labels such as "Speaker 1" are assigned separately in each part and may not be the same person across parts. Don't merge them unless the content makes it clear.
- Scale the length to the recording: a two-minute note needs a few lines, an hour-long meeting may need a page. Don't pad.
- Use Australian English and markdown. Start directly with the first section heading. Don't write a title, a preamble, or the format name ("FILE NOTE" or "DICTATION SUMMARY").`;
var DEFAULT_SETTINGS = {
  speechKey: "",
  speechRegion: "australiaeast",
  openaiEndpoint: "",
  openaiKey: "",
  openaiDeployment: "gpt-4o",
  language: "en-AU",
  enableDiarization: false,
  maxSpeakers: 4,
  promptForSpeakerNames: true,
  summariseWithAzure: true,
  summaryPrompt: "",
  notesFolder: "Voice Notes",
  defaultMode: "new"
};
var _VoiceFilenotePlugin = class extends import_obsidian.Plugin {
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
      callback: () => new AudioFileModal(this.app, this.settings.defaultMode, async (file, mode) => {
        try {
          await this.processAudioFile(file, mode);
        } catch (err) {
          notify(`Voice Filenote error: ${err.message}`, "error", err);
        }
      }).open()
    });
    this.addCommand({
      id: "retry-pending",
      name: "Retry pending transcriptions",
      callback: () => this.retryPendingTranscriptions()
    });
    this.addCommand({
      id: "retry-failed-summaries",
      name: "Retry failed summaries",
      callback: () => this.retryFailedSummaries()
    });
    this.addSettingTab(new VoiceFilenoteSettingTab(this.app, this));
  }
  onunload() {
    if (this.isRecording)
      this.forceStopRecording();
  }
  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    if (this.settings.summaryPrompt.trim() === LEGACY_SUMMARY_PROMPT) {
      this.settings.summaryPrompt = "";
      await this.saveSettings();
    }
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
    const { speechKey, openaiKey, openaiEndpoint, summariseWithAzure } = this.settings;
    if (!speechKey || summariseWithAzure && (!openaiKey || !openaiEndpoint)) {
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
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      notify(`Voice Filenote: microphone access denied \u2014 ${err.message}`, "error", err);
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
    notify("Voice Filenote: recording started.");
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
        notify("Voice Filenote: recording stopped, processing\u2026");
        try {
          await this.processRecording(audioBlob, mimeType, this.pendingMode);
        } catch (err) {
          notify(`Voice Filenote error: ${err.message}`, "error", err);
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
    var _a, _b, _c, _d, _e;
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
        notify(
          "Voice Filenote: Speech quota exceeded. Recording saved \u2014 run 'Retry pending transcriptions' when quota resets.",
          "warn"
        );
        return;
      }
      throw err;
    }
    const summary = await this.summariseOrPlaceholder(transcript, timestamp, {
      processedAt: timestamp,
      notePath: mode === "append" ? refNotePath : void 0
    });
    if (mode === "append") {
      await this.appendToCurrentNote(timestamp, audioFilename, transcript, summary);
    } else {
      await this.createNewNote(timestamp, audioFilename, transcript, summary);
    }
  }
  async processAudioFile(file, mode) {
    var _a, _b, _c, _d, _e, _f, _g, _h;
    const timestamp = (0, import_obsidian.moment)().format("YYYY-MM-DD HH-mm-ss");
    const refNotePath = mode === "append" ? (_b = (_a = this.app.workspace.getActiveFile()) == null ? void 0 : _a.path) != null ? _b : "" : `${this.settings.notesFolder}/Voice Note ${timestamp}.md`;
    const attachFolder = this.resolveAttachmentFolder(refNotePath);
    await this.ensureFolder(attachFolder);
    const audioPath = `${attachFolder}/${file.name}`;
    if (!this.app.vault.getAbstractFileByPath(audioPath)) {
      await this.app.vault.createBinary(audioPath, await file.arrayBuffer());
    }
    (_c = this.statusBarEl) == null ? void 0 : _c.setText("\u23F3 Transcribing\u2026");
    notify("Voice Filenote: transcribing, this may take a moment\u2026");
    let transcript;
    try {
      transcript = await this.transcribeAudio(file);
    } catch (err) {
      if (err instanceof QuotaExceededError) {
        const targetNote = mode === "append" ? (_e = (_d = this.app.workspace.getActiveFile()) == null ? void 0 : _d.path) != null ? _e : "" : "";
        await this.createPendingNote(timestamp, file.name, audioPath, mode, targetNote);
        notify(
          "Voice Filenote: Speech quota exceeded. File saved \u2014 run 'Retry pending transcriptions' when quota resets.",
          "warn"
        );
        (_f = this.statusBarEl) == null ? void 0 : _f.setText("");
        return;
      }
      (_g = this.statusBarEl) == null ? void 0 : _g.setText("");
      throw err;
    }
    const summary = await this.summariseOrPlaceholder(transcript, timestamp, {
      processedAt: timestamp,
      notePath: mode === "append" ? refNotePath : void 0,
      sourceFilename: file.name,
      fileModified: file.lastModified ? (0, import_obsidian.moment)(file.lastModified).format("YYYY-MM-DD HH:mm") : void 0
    });
    (_h = this.statusBarEl) == null ? void 0 : _h.setText("");
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
    var _a, _b, _c, _d;
    const pending = this.app.vault.getMarkdownFiles().filter((f) => {
      var _a2;
      const cache = this.app.metadataCache.getFileCache(f);
      return ((_a2 = cache == null ? void 0 : cache.frontmatter) == null ? void 0 : _a2.voice_filenote_pending) === true;
    });
    if (pending.length === 0) {
      notify("Voice Filenote: no pending transcriptions found.");
      return;
    }
    notify(`Voice Filenote: retrying ${pending.length} pending transcription(s)\u2026`);
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
        notify(`Voice Filenote: audio file not found \u2014 ${audioPath}`, "warn");
        continue;
      }
      try {
        const audioData = await this.app.vault.readBinary(audioFile);
        const audioBlob = new Blob([audioData], { type: this.audioMimeType(audioFile.name) });
        const audioFilename = audioFile.name;
        (_c = this.statusBarEl) == null ? void 0 : _c.setText("\u23F3 Transcribing\u2026");
        const transcript = await this.transcribeAudio(audioBlob);
        const summary = await this.summariseOrPlaceholder(transcript, timestamp, {
          processedAt: timestamp,
          notePath: mode === "append" && targetNote ? targetNote : void 0,
          sourceFilename: audioFilename
        });
        if (mode === "append" && targetNote) {
          const targetFile = this.app.vault.getAbstractFileByPath(targetNote);
          if (targetFile instanceof import_obsidian.TFile) {
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
        notify(`Voice Filenote: transcription complete \u2014 ${stubFile.basename}.`);
      } catch (err) {
        if (err instanceof QuotaExceededError) {
          notify("Voice Filenote: quota still exceeded. Try again later.", "warn");
          break;
        }
        notify(`Voice Filenote: retry failed for ${stubFile.basename} \u2014 ${err.message}`, "error", err);
      } finally {
        (_d = this.statusBarEl) == null ? void 0 : _d.setText("");
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
    notify("Voice Filenote: new note created.");
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
    notify("Voice Filenote: appended to current note.");
  }
  isWav(blob) {
    var _a;
    if (blob.type === "audio/wav" || blob.type === "audio/x-wav")
      return true;
    if (blob instanceof File) {
      const ext = (_a = blob.name.split(".").pop()) == null ? void 0 : _a.toLowerCase();
      return ext === "wav";
    }
    return false;
  }
  isWebm(blob) {
    var _a;
    if (blob.type === "audio/webm" || blob.type === "video/webm")
      return true;
    if (blob instanceof File) {
      return ((_a = blob.name.split(".").pop()) == null ? void 0 : _a.toLowerCase()) === "webm";
    }
    return false;
  }
  async transcribeAudio(audioBlob) {
    var _a;
    const { enableDiarization } = this.settings;
    if (this.isWebm(audioBlob)) {
      const { phrases, fallbackText } = await this.transcribeChunk(audioBlob);
      const names = await this.maybeIdentifySpeakers(audioBlob, phrases);
      return this.formatTranscript(phrases, fallbackText, enableDiarization, names);
    }
    let wavBlob;
    if (this.isWav(audioBlob)) {
      wavBlob = audioBlob;
    } else {
      notify("Voice Filenote: converting audio to WAV\u2026");
      wavBlob = await this.transcodeToWav(audioBlob);
    }
    if (wavBlob.size <= _VoiceFilenotePlugin.MAX_UPLOAD_BYTES) {
      const { phrases, fallbackText } = await this.transcribeChunk(wavBlob);
      const names = await this.maybeIdentifySpeakers(wavBlob, phrases);
      return this.formatTranscript(phrases, fallbackText, enableDiarization, names);
    }
    const sizeMb = (wavBlob.size / (1024 * 1024)).toFixed(0);
    let chunks;
    try {
      chunks = await this.splitWavForUpload(wavBlob, _VoiceFilenotePlugin.MAX_UPLOAD_BYTES);
    } catch (err) {
      throw new Error(
        `Audio is ${sizeMb} MB as WAV, which exceeds Azure Speech's 500 MB request limit, and it could not be split automatically (${err.message}). Please split it into shorter files before transcribing.`
      );
    }
    notify(`Voice Filenote: audio is ${sizeMb} MB as WAV \u2014 splitting into ${chunks.length} parts for transcription\u2026`);
    const parts = [];
    for (let i = 0; i < chunks.length; i++) {
      (_a = this.statusBarEl) == null ? void 0 : _a.setText(`\u23F3 Transcribing part ${i + 1}/${chunks.length}\u2026`);
      const { phrases, fallbackText } = await this.transcribeChunk(chunks[i]);
      const names = await this.maybeIdentifySpeakers(chunks[i], phrases, `Part ${i + 1} of ${chunks.length}`);
      parts.push(this.formatTranscript(phrases, fallbackText, enableDiarization, names));
    }
    const header = enableDiarization ? `> [!note] This recording was split into ${chunks.length} parts for transcription. Speaker labels are independent per part and may not refer to the same person across parts.

` : "";
    return header + parts.map((text, i) => `### Part ${i + 1}

${text}`).join("\n\n");
  }
  async transcribeChunk(audioBlob, isRetryAfterTranscode = false) {
    var _a, _b, _c, _d;
    const { speechKey, speechRegion, language, enableDiarization, maxSpeakers } = this.settings;
    const url = `https://${speechRegion}.api.cognitive.microsoft.com/speechtotext/transcriptions:transcribe?api-version=2025-10-15`;
    const definition = {
      locales: [language],
      profanityFilterMode: "None",
      channels: [0]
    };
    if (enableDiarization) {
      definition.diarization = { enabled: true, maxSpeakers };
    }
    const { body, contentType } = await this.buildMultipartBody(audioBlob, definition);
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
    if (response.status === 422 && !isRetryAfterTranscode && ((_b = (_a = response.json) == null ? void 0 : _a.innerError) == null ? void 0 : _b.code) === "InvalidAudioFormat") {
      notify("Voice Filenote: Azure couldn't decode this audio's container \u2014 converting to WAV and retrying\u2026", "warn");
      const wavBlob = await this.transcodeToWav(audioBlob);
      return this.transcribeChunk(wavBlob, true);
    }
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`Speech API error ${response.status}: ${response.text}`);
    }
    const data = response.json;
    const phrases = (_c = data.phrases) != null ? _c : [];
    const combined = (_d = data.combinedPhrases) != null ? _d : [];
    const fallbackText = combined.length > 0 ? combined.map((p) => p.text).join(" ") : phrases.map((p) => p.text).join(" ");
    return { phrases, fallbackText };
  }
  // Decodes arbitrary audio via the Web Audio API and re-encodes it as a
  // 16 kHz mono 16-bit PCM WAV — a format Azure's fast-transcription
  // decoder reliably accepts, used as a fallback when the original
  // container is rejected outright.
  async transcodeToWav(blob) {
    const arrayBuffer = await blob.arrayBuffer();
    const audioCtx = new AudioContext();
    let decoded;
    try {
      decoded = await audioCtx.decodeAudioData(arrayBuffer);
    } finally {
      await audioCtx.close();
    }
    const targetSampleRate = 16e3;
    const offlineCtx = new OfflineAudioContext(
      1,
      Math.ceil(decoded.duration * targetSampleRate),
      targetSampleRate
    );
    const source = offlineCtx.createBufferSource();
    source.buffer = decoded;
    source.connect(offlineCtx.destination);
    source.start();
    const rendered = await offlineCtx.startRendering();
    const samples = rendered.getChannelData(0);
    const pcm = new Int16Array(samples.length);
    for (let i = 0; i < samples.length; i++) {
      const s = Math.max(-1, Math.min(1, samples[i]));
      pcm[i] = s < 0 ? s * 32768 : s * 32767;
    }
    const header = this.buildWavHeader(pcm.byteLength, 1, targetSampleRate, 1, 16);
    return new Blob([header, pcm.buffer], { type: "audio/wav" });
  }
  // When diarization is on, groups consecutive same-speaker phrases into
  // labelled paragraphs, substituting user-supplied names where available.
  // Otherwise falls back to the plain merged text.
  formatTranscript(phrases, fallbackText, diarization, names = /* @__PURE__ */ new Map()) {
    if (diarization && phrases.some((p) => p.speaker !== void 0)) {
      const paragraphs = [];
      let currentSpeaker;
      let buffer = [];
      const flush = () => {
        var _a;
        if (buffer.length > 0) {
          const label = currentSpeaker !== void 0 ? (_a = names.get(currentSpeaker)) != null ? _a : `Speaker ${currentSpeaker}` : "Speaker";
          paragraphs.push(`**${label}:** ${buffer.join(" ")}`);
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
    return fallbackText;
  }
  // Prompts the user to identify each detected speaker (playing a sample
  // clip and showing a text excerpt), returning a speaker-id -> name map.
  // No-ops when diarization/prompting is off or fewer than 2 speakers were
  // detected in this chunk.
  async maybeIdentifySpeakers(audioBlob, phrases, partLabel) {
    const { enableDiarization, promptForSpeakerNames } = this.settings;
    if (!enableDiarization || !promptForSpeakerNames)
      return /* @__PURE__ */ new Map();
    const bySpeaker = /* @__PURE__ */ new Map();
    for (const p of phrases) {
      if (p.speaker === void 0)
        continue;
      const list = bySpeaker.get(p.speaker);
      if (list)
        list.push(p);
      else
        bySpeaker.set(p.speaker, [p]);
    }
    if (bySpeaker.size < 2)
      return /* @__PURE__ */ new Map();
    const samples = [...bySpeaker.entries()].sort(([a], [b]) => a - b).map(([speaker, ps]) => {
      const longest = ps.reduce((a, b) => b.durationMilliseconds > a.durationMilliseconds ? b : a);
      return {
        speaker,
        offsetMs: longest.offsetMilliseconds,
        durationMs: longest.durationMilliseconds,
        textSnippet: ps.slice(0, 3).map((p) => p.text).join(" ")
      };
    });
    return new Promise((resolve) => {
      new SpeakerIdModal(this.app, audioBlob, samples, partLabel, resolve).open();
    });
  }
  // Parses a WAV file's fmt/data chunks so it can be split into
  // independently-playable sub-files without re-encoding.
  parseWavHeader(buf) {
    const view = new DataView(buf);
    if (view.byteLength < 12 || view.getUint32(0, false) !== 1380533830 || view.getUint32(8, false) !== 1463899717) {
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
      if (chunkId === 1718449184) {
        audioFormat = view.getUint16(chunkBodyOffset, true);
        channels = view.getUint16(chunkBodyOffset + 2, true);
        sampleRate = view.getUint32(chunkBodyOffset + 4, true);
        bitsPerSample = view.getUint16(chunkBodyOffset + 14, true);
      } else if (chunkId === 1684108385) {
        dataOffset = chunkBodyOffset;
        dataLength = Math.min(chunkSize, view.byteLength - chunkBodyOffset);
      }
      offset = chunkBodyOffset + chunkSize + chunkSize % 2;
    }
    if (dataOffset < 0)
      throw new Error("WAV file has no data chunk");
    const blockAlign = channels * (bitsPerSample / 8);
    return { dataOffset, dataLength, audioFormat, sampleRate, channels, bitsPerSample, blockAlign };
  }
  buildWavHeader(dataLength, audioFormat, sampleRate, channels, bitsPerSample) {
    const blockAlign = channels * (bitsPerSample / 8);
    const byteRate = sampleRate * blockAlign;
    const buf = new ArrayBuffer(44);
    const view = new DataView(buf);
    const writeStr = (offset, str) => {
      for (let i = 0; i < str.length; i++)
        view.setUint8(offset + i, str.charCodeAt(i));
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
  async splitWavForUpload(audioBlob, maxBytes) {
    const buf = await audioBlob.arrayBuffer();
    const { dataOffset, dataLength, audioFormat, sampleRate, channels, bitsPerSample, blockAlign } = this.parseWavHeader(buf);
    if (blockAlign <= 0) {
      throw new Error("could not determine WAV sample format");
    }
    const maxDataBytesPerChunk = Math.floor((maxBytes - 44) / blockAlign) * blockAlign;
    if (maxDataBytesPerChunk <= 0) {
      throw new Error("WAV format parameters prevent chunking within the size limit");
    }
    const chunks = [];
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
  async summarise(transcript, context) {
    var _a, _b, _c, _d;
    const { openaiEndpoint, openaiKey, openaiDeployment, summaryPrompt } = this.settings;
    const base = openaiEndpoint.replace(/\/$/, "");
    const url = `${base}/openai/deployments/${openaiDeployment}/chat/completions?api-version=2024-10-21`;
    const contextLines = [`- Processed: ${context.processedAt}`];
    if (context.fileModified)
      contextLines.push(`- Audio file last modified (usually close to when it was recorded): ${context.fileModified}`);
    if (context.sourceFilename)
      contextLines.push(`- Audio file name: ${context.sourceFilename}`);
    if (context.notePath)
      contextLines.push(`- Being added to the note: ${context.notePath} (the folder and title usually identify the matter or client)`);
    const extra = summaryPrompt.trim();
    const userContent = [
      "Context:",
      ...contextLines,
      ...extra ? ["", `Additional instructions: ${extra}`] : [],
      "",
      "Transcript:",
      "",
      transcript
    ].join("\n");
    const send = (withTemperature) => (0, import_obsidian.requestUrl)({
      url,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": openaiKey
      },
      body: JSON.stringify({
        messages: [
          { role: "system", content: SUMMARY_SYSTEM_PROMPT },
          { role: "user", content: userContent }
        ],
        ...withTemperature ? { temperature: 0.2 } : {},
        max_completion_tokens: _VoiceFilenotePlugin.SUMMARY_MAX_TOKENS
      }),
      throw: false
    });
    let response = await send(true);
    if (response.status === 400 && /temperature/i.test(response.text)) {
      response = await send(false);
    }
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`OpenAI API error ${response.status}: ${response.text}`);
    }
    const choice = (_a = response.json.choices) == null ? void 0 : _a[0];
    const content = (_c = (_b = choice == null ? void 0 : choice.message) == null ? void 0 : _b.content) == null ? void 0 : _c.trim();
    if (!content) {
      throw new Error(`OpenAI returned an empty summary (finish_reason: ${(_d = choice == null ? void 0 : choice.finish_reason) != null ? _d : "unknown"})`);
    }
    if (choice.finish_reason === "length") {
      return content + "\n\n> [!warning] Summary cut off\n> The summary hit the length limit and is incomplete. Check the transcript for anything after this point.";
    }
    return content;
  }
  // Shifts the summary's markdown headings so its top level sits directly
  // under the note's own Summary heading (## in new notes, ### when appended).
  nestHeadings(markdown, topLevel) {
    const levels = [...markdown.matchAll(/^(#{1,6}) /gm)].map((m) => m[1].length);
    if (levels.length === 0)
      return markdown;
    const shift = topLevel - Math.min(...levels);
    return markdown.replace(/^(#{1,6}) /gm, (_, h) => "#".repeat(Math.min(6, Math.max(1, h.length + shift))) + " ");
  }
  // Never lets a summary failure lose the transcript: on error, returns a
  // placeholder that the "Retry failed summaries" command can find later.
  // Returns null when Azure summaries are turned off, so the note gets only
  // the transcript and recording (the summary is then written in Claude Code).
  async summariseOrPlaceholder(transcript, timestamp, context) {
    var _a;
    if (!this.settings.summariseWithAzure)
      return null;
    (_a = this.statusBarEl) == null ? void 0 : _a.setText("\u23F3 Summarising\u2026");
    try {
      return await this.summarise(transcript, context);
    } catch (err) {
      notify(
        `Voice Filenote: summary failed (${err.message}). Transcript saved \u2014 run 'Retry failed summaries' to try again.`,
        "error",
        err
      );
      return this.summaryFailedPlaceholder(timestamp, err.message);
    }
  }
  summaryFailedPlaceholder(timestamp, reason) {
    const oneLine = reason.replace(/\s+/g, " ").slice(0, 300);
    return `${_VoiceFilenotePlugin.SUMMARY_FAILED_START}
> [!warning] Summary failed
> Voice note ${timestamp}. The summary couldn't be generated: ${oneLine}
> The transcript below is complete. Run **Retry failed summaries** to try again.
${_VoiceFilenotePlugin.SUMMARY_FAILED_END}`;
  }
  // Finds summary-failed placeholders across the vault and regenerates each
  // summary from the transcript section that follows it in the same note.
  async retryFailedSummaries() {
    var _a, _b, _c, _d, _e;
    const { SUMMARY_FAILED_START: START, SUMMARY_FAILED_END: END } = _VoiceFilenotePlugin;
    const files = [];
    for (const f of this.app.vault.getMarkdownFiles()) {
      if ((await this.app.vault.cachedRead(f)).includes(START))
        files.push(f);
    }
    if (files.length === 0) {
      notify("Voice Filenote: no failed summaries found.");
      return;
    }
    notify(`Voice Filenote: retrying failed summaries in ${files.length} note(s)\u2026`);
    let fixed = 0;
    let failed = 0;
    for (const file of files) {
      let content = await this.app.vault.read(file);
      let searchFrom = 0;
      while (true) {
        const start = content.indexOf(START, searchFrom);
        if (start < 0)
          break;
        const endMarker = content.indexOf(END, start);
        if (endMarker < 0)
          break;
        const end = endMarker + END.length;
        const block = content.slice(start, end);
        const timestamp = (_b = (_a = block.match(/Voice note (\d{4}-\d{2}-\d{2} \d{2}-\d{2}-\d{2})/)) == null ? void 0 : _a[1]) != null ? _b : "";
        const rest = content.slice(end);
        const transcriptMatch = rest.match(/^#{2,3} Transcript\n([\s\S]*?)(?=^#{2,3} Recording\b)/m);
        if (!transcriptMatch || !transcriptMatch[1].trim()) {
          notify(`Voice Filenote: couldn't find the transcript after a failed summary in ${file.basename} \u2014 skipped.`, "warn");
          failed++;
          searchFrom = end;
          continue;
        }
        (_c = this.statusBarEl) == null ? void 0 : _c.setText("\u23F3 Summarising\u2026");
        try {
          const isVoiceNote = file.path.startsWith(`${this.settings.notesFolder}/`);
          const summary = await this.summarise(transcriptMatch[1].trim(), {
            processedAt: timestamp || (0, import_obsidian.moment)().format("YYYY-MM-DD HH-mm-ss"),
            notePath: isVoiceNote ? void 0 : file.path
          });
          const summaryHeading = [...content.slice(0, start).matchAll(/^(#{2,3}) Summary$/gm)].pop();
          const nested = this.nestHeadings(summary, ((_d = summaryHeading == null ? void 0 : summaryHeading[1].length) != null ? _d : 2) + 1);
          content = content.slice(0, start) + nested + content.slice(end);
          await this.app.vault.modify(file, content);
          searchFrom = start + nested.length;
          fixed++;
        } catch (err) {
          notify(`Voice Filenote: summary still failing for ${file.basename} \u2014 ${err.message}`, "error", err);
          failed++;
          searchFrom = end;
        } finally {
          (_e = this.statusBarEl) == null ? void 0 : _e.setText("");
        }
      }
    }
    notify(`Voice Filenote: ${fixed} summar${fixed === 1 ? "y" : "ies"} regenerated${failed ? `, ${failed} still failing` : ""}.`);
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
    const summarySection = summary === null ? "" : `## Summary

${this.nestHeadings(summary, 3)}

`;
    return `---
created: ${timestamp}
tags:
  - voice-note
---

# Voice Note \u2014 ${timestamp}

${summarySection}## Transcript

${transcript}

## Recording

![[${audioFilename}]]
`;
  }
  buildAppendContent(timestamp, audioFilename, transcript, summary) {
    const summarySection = summary === null ? "" : `### Summary

${this.nestHeadings(summary, 4)}

`;
    return `---

## Voice Note \u2014 ${timestamp}

${summarySection}### Transcript

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
var VoiceFilenotePlugin = _VoiceFilenotePlugin;
// Azure's fast transcription endpoint rejects request bodies over
// 524,288,000 bytes (500 MB). Stay a little under that to leave room
// for multipart framing overhead.
VoiceFilenotePlugin.MAX_UPLOAD_BYTES = 523e6;
// A ceiling, not a target: the prompt asks for length proportional to the
// recording. Reasoning models (GPT-5 onwards) spend part of this budget on
// hidden reasoning before writing, so it's set well above a long file note.
VoiceFilenotePlugin.SUMMARY_MAX_TOKENS = 16384;
VoiceFilenotePlugin.SUMMARY_FAILED_START = "<!-- voice-filenote:summary-failed -->";
VoiceFilenotePlugin.SUMMARY_FAILED_END = "<!-- /voice-filenote:summary-failed -->";
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
    new import_obsidian.Setting(containerEl).setName("Identify speakers").setDesc(
      "Label the transcript by speaker (e.g. 'Speaker 1: \u2026'). Only works on single-channel audio. Note: speaker numbers reset for each part of a file that's split for size, so they may not line up across parts."
    ).addToggle(
      (t) => t.setValue(this.plugin.settings.enableDiarization).onChange(async (v) => {
        this.plugin.settings.enableDiarization = v;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Maximum speakers").setDesc("Upper bound on the number of distinct speakers to detect (2\u201335).").addSlider(
      (s) => s.setLimits(2, 35, 1).setValue(this.plugin.settings.maxSpeakers).setDynamicTooltip().onChange(async (v) => {
        this.plugin.settings.maxSpeakers = v;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Prompt to name speakers").setDesc(
      "After transcribing, ask you to identify each detected speaker (with a play-sample button) and replace 'Speaker 0/1/\u2026' labels with the names you enter."
    ).addToggle(
      (t) => t.setValue(this.plugin.settings.promptForSpeakerNames).onChange(async (v) => {
        this.plugin.settings.promptForSpeakerNames = v;
        await this.plugin.saveSettings();
      })
    );
    containerEl.createEl("h3", { text: "Azure OpenAI (summarisation)" });
    new import_obsidian.Setting(containerEl).setName("Summarise with Azure OpenAI").setDesc("Turn off to save only the transcript and recording. You can then write the summary in Claude Code with /filenote. The settings below are only used when this is on.").addToggle(
      (t) => t.setValue(this.plugin.settings.summariseWithAzure).onChange(async (v) => {
        this.plugin.settings.summariseWithAzure = v;
        await this.plugin.saveSettings();
      })
    );
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
    new import_obsidian.Setting(containerEl).setName("Deployment name").setDesc("The name you gave the model deployment, e.g. gpt-4o").addText(
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
    new import_obsidian.Setting(containerEl).setName("Additional summary instructions").setDesc('Optional. Added to the built-in file-note instructions, e.g. "Always note any limitation dates mentioned." Leave blank to use the built-in instructions alone.').addTextArea((t) => {
      t.setPlaceholder("Optional extra instructions\u2026").setValue(this.plugin.settings.summaryPrompt).onChange(async (v) => {
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
};
var SpeakerIdModal = class extends import_obsidian.Modal {
  constructor(app, audioBlob, samples, partLabel, onDone) {
    super(app);
    this.audioBlob = audioBlob;
    this.samples = samples;
    this.partLabel = partLabel;
    this.onDone = onDone;
    this.names = /* @__PURE__ */ new Map();
    this.resolved = false;
  }
  onOpen() {
    this.objectUrl = URL.createObjectURL(this.audioBlob);
    this.audioEl = document.createElement("audio");
    this.audioEl.src = this.objectUrl;
    const { contentEl } = this;
    contentEl.createEl("h2", {
      text: this.partLabel ? `Identify speakers \u2014 ${this.partLabel}` : "Identify speakers"
    });
    contentEl.createEl("p", {
      text: "Play a sample or read the excerpt to identify each speaker. Leave a name blank to keep the default label."
    });
    for (const sample of this.samples) {
      new import_obsidian.Setting(contentEl).setName(`Speaker ${sample.speaker}`).setDesc(sample.textSnippet).addButton(
        (btn) => btn.setButtonText("\u25B6 Play").onClick(() => this.playSample(sample))
      ).addText(
        (text) => text.setPlaceholder(`Speaker ${sample.speaker}`).onChange((v) => {
          const trimmed = v.trim();
          if (trimmed)
            this.names.set(sample.speaker, trimmed);
          else
            this.names.delete(sample.speaker);
        })
      );
    }
    new import_obsidian.Setting(contentEl).addButton(
      (btn) => btn.setButtonText("Continue").setCta().onClick(() => this.finish())
    );
  }
  playSample(sample) {
    window.clearTimeout(this.pauseTimer);
    this.audioEl.pause();
    this.audioEl.currentTime = sample.offsetMs / 1e3;
    void this.audioEl.play();
    this.pauseTimer = window.setTimeout(() => this.audioEl.pause(), sample.durationMs);
  }
  finish() {
    this.resolved = true;
    this.close();
    this.onDone(this.names);
  }
  onClose() {
    var _a;
    this.contentEl.empty();
    window.clearTimeout(this.pauseTimer);
    (_a = this.audioEl) == null ? void 0 : _a.pause();
    if (this.objectUrl)
      URL.revokeObjectURL(this.objectUrl);
    if (!this.resolved) {
      this.resolved = true;
      this.onDone(/* @__PURE__ */ new Map());
    }
  }
};
