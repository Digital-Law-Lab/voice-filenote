# Voice Filenote

An Obsidian plugin that records audio, transcribes it, and summarises it — all in a single note. Built on Microsoft Azure so that your data never leaves Microsoft's infrastructure and is never used to train AI models.

Each voice note produces a markdown file containing:
- A concise AI-generated summary
- The full transcript
- An embedded audio recording

---

## Contents

1. [How it works](#how-it-works)
2. [Azure setup](#azure-setup)
   - [1. Create an Azure subscription](#1-create-an-azure-subscription)
   - [2. Create an Azure AI Speech resource](#2-create-an-azure-ai-speech-resource)
   - [3. Create an Azure OpenAI resource](#3-create-an-azure-openai-resource)
   - [4. Deploy GPT-4o](#4-deploy-gpt-4o)
3. [Plugin installation](#plugin-installation)
4. [Plugin configuration](#plugin-configuration)
5. [Usage](#usage)
   - [Recording modes](#recording-modes)
   - [Commands](#commands)
6. [Data governance](#data-governance)
7. [Pricing](#pricing)

---

## How it works

```
Microphone → [MediaRecorder] → audio file saved in vault
                                    ↓
                        [Azure AI Speech] → transcript
                                    ↓
                         [Azure OpenAI GPT-4o] → summary
                                    ↓
                            New note created
```

Transcription is handled by **Azure AI Speech** (Microsoft's own speech-to-text service). Summarisation is handled by **Azure OpenAI GPT-4o**. Both services are configured to run in the **Australia East** region by default, keeping your data on Australian soil under Microsoft's enterprise data protection terms.

---

## Azure setup

You will need a Microsoft account and an Azure subscription. The setup takes approximately 15–20 minutes and only needs to be done once.

### 1. Create an Azure subscription

If you already have an active Azure subscription, skip to step 2.

1. Go to [portal.azure.com](https://portal.azure.com) and sign in.
2. In the top search bar, search for **Subscriptions** and open it.
3. Click **+ Add**.
4. Choose **Microsoft Azure Plan** (Pay-As-You-Go — no monthly commitment, billed only for what you use).
5. Complete the billing details and click **Review + create**, then **Create**.

### 2. Create an Azure AI Speech resource

This resource handles audio transcription.

1. In the Azure portal search bar, search for **Speech services** and open it.
2. Click **+ Create**.
3. Fill in the details:
   | Field | Value |
   |---|---|
   | Subscription | Your subscription |
   | Resource group | Create new — e.g. `ai-tools` |
   | Region | **Australia East** (or your preferred region) |
   | Name | e.g. `my-speech` |
   | Pricing tier | **Free F0** (5 hours/month free; Standard S0 thereafter at ~$1/hour) |
4. Click **Review + create**, then **Create**.
5. Once deployed, open the resource and click **Keys and Endpoint** in the left sidebar.
6. Copy **Key 1** and note the **Region** — you will need these when configuring the plugin.

> **Note:** The Free F0 tier allows 5 hours of audio transcription per month at no cost. For most personal voice note use, this is sufficient. If you exceed this, switch to Standard S0 pricing in the resource's Pricing tier settings.

### 3. Create an Azure OpenAI resource

This resource handles AI summarisation.

1. In the Azure portal search bar, search for **Azure OpenAI** and open it.
2. Click **+ Create**, then select **Azure OpenAI**.
3. Fill in the details:
   | Field | Value |
   |---|---|
   | Subscription | Your subscription |
   | Resource group | `ai-tools` (same group as Speech) |
   | Region | **Australia East** |
   | Name | e.g. `my-openai` |
   | Pricing tier | **Standard S0** |
4. On the **Network** tab, select **All networks, including the internet**.
5. Click **Review + create**, then **Create**.
6. Once deployed, open the resource and click **Click here to manage keys** (or **Keys and Endpoint** in the left sidebar).
7. Copy **Key 1** and the **Endpoint URL** — you will need both when configuring the plugin.

### 4. Deploy GPT-4o

Azure OpenAI requires you to explicitly deploy a model before it can be used.

1. From your Azure OpenAI resource page, click **Go to Foundry portal** (or navigate to [ai.azure.com](https://ai.azure.com)).
2. Select your OpenAI resource from the resource list.
3. In the left sidebar, click **Models + endpoints** (under Shared resources, it may appear as **Deployments**).
4. Click **Deploy model** → **Deploy base model**.
5. Search for **gpt-4o** and select it.
6. On the deployment screen:
   | Field | Value |
   |---|---|
   | Deployment name | `gpt-4o` (or any name — you will enter this in plugin settings) |
   | Deployment type | **Standard** |
7. Click **Deploy**.

> **Why Standard and not Global Standard?** Standard processes requests in your resource's region (Australia East). Global Standard routes traffic across Microsoft's global infrastructure for capacity, which may send data outside Australia. For data residency, always choose Standard.

---

## Plugin installation

Voice Filenote is installed manually (it is not currently listed in the Obsidian Community Plugins directory).

1. Open your Obsidian vault folder in your file manager.
2. Navigate to `.obsidian/plugins/` (create the `plugins` folder if it does not exist).
3. Create a new folder named `voice-filenote`.
4. Copy the following three files from this repository into that folder:
   - `main.js`
   - `manifest.json`
   - `styles.css`
5. Open Obsidian. Go to **Settings → Community plugins**.
6. If community plugins are disabled, click **Turn on community plugins**.
7. Click the **Reload plugins** button (circular arrow icon).
8. Find **Voice Filenote** in the list and toggle it on.

---

## Plugin configuration

Go to **Settings → Voice Filenote** and fill in the following:

### Recording behaviour

| Setting | Options | Description |
|---|---|---|
| Default mode | Create a new note / Append to the current open note | What the ribbon icon and default command do. Individual commands in the command palette can always override this on a per-recording basis. |

### Azure AI Speech

| Setting | Description | Where to find it |
|---|---|---|
| API key | Your Speech resource's Key 1 | Azure portal → your Speech resource → Keys and Endpoint |
| Region | Azure region of your Speech resource | e.g. `australiaeast` |
| Language | BCP-47 language code for transcription | e.g. `en-AU`, `en-US`, `en-GB` |

### Azure OpenAI

| Setting | Description | Where to find it |
|---|---|---|
| Endpoint | Your OpenAI resource's endpoint URL | Azure portal → your OpenAI resource → Keys and Endpoint |
| API key | Your OpenAI resource's Key 1 | Azure portal → your OpenAI resource → Keys and Endpoint |
| Deployment name | The name you gave the GPT-4o deployment | Azure AI Foundry → your resource → Models + endpoints |

### Notes

| Setting | Default | Description |
|---|---|---|
| Notes folder | `Voice Notes` | Vault folder where new voice note files are created |
| Summary prompt | *(see below)* | Instruction sent to GPT-4o along with the transcript |

> **Recordings** are saved to whatever folder you have configured under **Settings → Files and links → Default location for new attachments**. Voice Filenote reads this setting automatically — there is no separate folder to configure.

The default summary prompt is:
> Provide a concise summary of the following voice note transcript. Highlight key points and any action items.

You can customise this to suit your workflow — for example, asking for dot-point action items, a structured legal file note format, or a particular writing style.

---

## Usage

1. Click the **microphone icon** in the Obsidian ribbon (left sidebar), or open the command palette (`Ctrl+P` / `Cmd+P`) and run one of the Voice Filenote commands.
2. The icon pulses red while recording is active.
3. Click the icon again (or run the same command again) to stop.
4. The plugin transcribes and summarises the audio — this typically takes 5–15 seconds.
5. The result is either inserted into a new note or appended to the current note, depending on the mode used.

### Recording modes

**New note** creates a standalone markdown file in your configured notes folder:

```markdown
---
created: 2026-06-11 14-32-00
tags:
  - voice-note
---

# Voice Note — 2026-06-11 14-32-00

## Summary
[AI-generated summary]

## Transcript
[Full transcript]

## Recording
![[Recording 2026-06-11 14-32-00.webm]]
```

**Append to current note** adds the voice note below the existing content of whatever note is open at the time recording stops. A horizontal rule separates entries, and headings use `##`/`###` so they sit subordinate to the document's own structure:

```markdown
---

## Voice Note — 2026-06-11 14-32-00

### Summary
[AI-generated summary]

### Transcript
[Full transcript]

### Recording
![[Recording 2026-06-11 14-32-00.webm]]
```

If no note is open when you try to start a recording in append mode, the plugin will show an error and not begin recording.

### Commands

Three commands are available in the command palette:

| Command | Behaviour |
|---|---|
| Start / stop recording (use default mode) | Uses whichever mode is set as default in Settings. This is also what the ribbon icon triggers. |
| Start / stop recording → new note | Always creates a new note, regardless of the default setting. |
| Start / stop recording → append to current note | Always appends to the current open note, regardless of the default setting. |

All three commands act as a toggle — run the command once to start, again to stop.

---

## Data governance

| Concern | Detail |
|---|---|
| **Data training** | Microsoft contractually commits that your data is not used to train AI models under the Azure OpenAI terms of service. |
| **Data residency** | With Standard deployment type and Australia East resources, all processing occurs within Microsoft's Australian data centres. |
| **Encryption** | Data is encrypted in transit (TLS) and at rest. |
| **Compliance** | Azure is certified for ISO 27001, SOC 2, and is covered by the Microsoft Data Protection Addendum (DPA). |
| **Audio storage** | Audio files are saved only in your local Obsidian vault. They are sent to Azure for transcription and then the connection closes — Azure does not retain them. |

For full details, see the [Microsoft Azure Data Protection Addendum](https://www.microsoft.com/en-us/licensing/docs/view/Microsoft-Products-and-Services-Data-Protection-Addendum-DPA).

---

## Pricing

Costs are incurred only when you record a note. There are no standing charges beyond your Azure subscription (which itself has no minimum spend).

| Service | Free tier | Paid rate |
|---|---|---|
| Azure AI Speech (transcription) | 5 hours/month free (F0 tier) | ~$1.00 USD per audio hour |
| Azure OpenAI GPT-4o (summarisation) | None | ~$2.50 USD per 1M input tokens / ~$10 USD per 1M output tokens |

A typical 2-minute voice note uses roughly 250 words of transcript (~330 tokens) and produces a summary of ~100 tokens. At these rates, the GPT-4o cost per note is well under $0.01 USD. For most personal use the Speech free tier covers all transcription at no cost.
