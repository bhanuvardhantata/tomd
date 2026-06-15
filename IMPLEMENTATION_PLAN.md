# Offline Reasoning Implementation Plan

> **Goal**: Add fully offline LLM reasoning (summarization, Q&A, text analysis) to ToMD using Transformers.js, replicating the existing Whisper Web Worker architecture.

---

## Current Architecture Summary

ToMD is a privacy-first, 100% client-side file-to-Markdown converter supporting 30+ formats. Key existing components:

| Component | File | Purpose |
|-----------|------|---------|
| Main App Logic | `app.js` | File conversion orchestration, UI management, settings |
| Whisper Worker | `whisper-worker.js` | Speech-to-text in a Web Worker via Transformers.js |
| ML Runtime | `lib/transformers.js` | ONNX model inference (used by Whisper worker) |
| Pre-cached Model | `models/Xenova/whisper-tiny.en/` | Bundled Whisper model for offline audio transcription |
| UI | `index.html` + `index.css` | Single-page app with settings panel, tabbed results |

**Current AI capabilities**:
- ✅ Offline: Whisper speech-to-text, Tesseract OCR
- ❌ Online-only: Summarization via cloud APIs (Gemini, OpenAI, Anthropic) or Chrome's experimental Gemini Nano

**Gap**: No offline reasoning/LLM. The summarization feature requires either network access (cloud APIs) or Chrome 138+ with experimental flags (Gemini Nano).

**Post-implementation default**: The Local LLM (via `llm-worker.js`) becomes the **default reasoning engine**. Cloud APIs (Gemini, OpenAI, Anthropic) remain available as opt-in fallbacks, but the app ships with offline-first behavior out of the box.

---

## Implementation Overview

Create a new `llm-worker.js` Web Worker that runs text-generation models via Transformers.js ONNX runtime. This mirrors the proven `whisper-worker.js` pattern exactly. Models are downloaded on first use and cached in the browser's Cache API for subsequent offline use.

### Architecture Diagram

```
┌─────────────────────────────────────────────────────────┐
│  Main Thread (app.js)                                   │
│                                                         │
│  ┌─────────────┐  ┌──────────────┐  ┌───────────────┐  │
│  │ File        │  │ Reasoning UI │  │ Settings      │  │
│  │ Conversion  │  │ (Chat/Sum/   │  │ (Model select,│  │
│  │ Pipeline    │  │  Analyze)    │  │  temperature) │  │
│  └─────────────┘  └──────┬───────┘  └───────────────┘  │
│                           │                             │
│          postMessage()    │    postMessage()            │
└───────────────────────────┼─────────────────────────────┘
                            │
                ┌───────────▼───────────┐
                │  llm-worker.js        │
                │  (Web Worker)         │
                │                       │
                │  ┌─────────────────┐  │
                │  │ Transformers.js │  │
                │  │ text-generation │  │
                │  │ pipeline        │  │
                │  └────────┬────────┘  │
                │           │           │
                │  ┌────────▼────────┐  │
                │  │ ONNX Runtime    │  │
                │  │ (WASM backend)  │  │
                │  └────────┬────────┘  │
                │           │           │
                └───────────┼───────────┘
                            │
                ┌───────────▼───────────┐
                │  Browser Cache API    │
                │  (Downloaded models)  │
                └───────────────────────┘
```

---

## Phase 1: LLM Worker Foundation

### Step 1: Create `llm-worker.js`

**What**: A new Web Worker file at project root that handles LLM inference.

**Reference**: Copy the structure of `whisper-worker.js` (lines 1-10 for environment config, pipeline initialization pattern, message protocol).

**Create file `llm-worker.js`** with this structure:

```javascript
import { pipeline, env, TextStreamer } from './lib/transformers.js';

// Configure for local-first model loading (same as whisper-worker.js lines 3-6)
env.allowLocalModels = true;
env.allowRemoteModels = true;
env.localModelPath = './models/';

let generationPipeline = null;
let currentModelName = "";

self.onmessage = async (event) => {
  const { action, modelName, messages, generationConfig } = event.data;

  switch (action) {
    case "load_model":
      await handleLoadModel(modelName);
      break;
    case "generate":
      await handleGenerate(messages, generationConfig);
      break;
    case "unload":
      handleUnload();
      break;
  }
};

async function handleLoadModel(modelName) {
  try {
    if (generationPipeline && currentModelName === modelName) {
      self.postMessage({ status: "ready", message: "Model already loaded." });
      return;
    }

    // Unload previous model to free memory
    if (generationPipeline) {
      generationPipeline = null;
      currentModelName = "";
    }

    self.postMessage({ 
      status: "loading", 
      message: `Downloading/loading model: ${modelName}...` 
    });

    generationPipeline = await pipeline("text-generation", modelName, {
      dtype: "q4",  // 4-bit quantization for smaller size
      progress_callback: (progress) => {
        if (progress.status === "progress") {
          self.postMessage({ 
            status: "download_progress", 
            progress: progress.progress,
            file: progress.file,
            loaded: progress.loaded,
            total: progress.total
          });
        }
      }
    });

    currentModelName = modelName;
    self.postMessage({ status: "ready", message: `Model ${modelName} loaded successfully.` });
  } catch (error) {
    self.postMessage({ status: "error", message: `Failed to load model: ${error.message}` });
  }
}

async function handleGenerate(messages, generationConfig) {
  if (!generationPipeline) {
    self.postMessage({ status: "error", message: "No model loaded. Load a model first." });
    return;
  }

  try {
    self.postMessage({ status: "generating", message: "Generating response..." });

    // Stream tokens back to main thread one at a time
    const streamer = new TextStreamer(generationPipeline.tokenizer, {
      skip_prompt: true,
      callback_function: (token) => {
        self.postMessage({ status: "token", token: token });
      }
    });

    const config = {
      max_new_tokens: generationConfig?.max_new_tokens || 512,
      temperature: generationConfig?.temperature || 0.7,
      top_p: generationConfig?.top_p || 0.9,
      do_sample: generationConfig?.temperature > 0,
      streamer: streamer
    };

    const output = await generationPipeline(messages, config);

    // Extract the generated text (last message in the output)
    const generatedText = output[0].generated_text.at(-1).content;

    self.postMessage({ 
      status: "completed", 
      result: generatedText 
    });
  } catch (error) {
    self.postMessage({ status: "error", message: `Generation failed: ${error.message}` });
  }
}

function handleUnload() {
  generationPipeline = null;
  currentModelName = "";
  self.postMessage({ status: "unloaded", message: "Model unloaded." });
}
```

**Key differences from whisper-worker.js**:
- Uses `"text-generation"` pipeline instead of `"automatic-speech-recognition"`
- Accepts `messages` array (chat format) instead of audio Float32Array
- Streams individual tokens back via `TextStreamer` callback
- Supports `dtype: "q4"` for 4-bit quantized models
- Has explicit `load_model` action (Whisper loads lazily on first transcribe)

---

### Step 2: Add Model Catalog to `app.js`

**What**: Define available models as a constant near the top of `app.js`.

**Where**: Insert after the existing element references (around line 20 of `app.js`, after the `const whisperModelSelect = ...` line).

**Add this code**:

```javascript
// ============================================================
// OFFLINE REASONING MODEL CATALOG
// ============================================================
const LLM_MODELS = [
  {
    id: "onnx-community/SmolLM2-360M-Instruct",
    name: "SmolLM2 360M",
    description: "Fast, basic reasoning (~200MB download)",
    size: "~200MB",
    contextWindow: 2048,
    quality: "basic"
  },
  {
    id: "onnx-community/Qwen2.5-0.5B-Instruct",
    name: "Qwen2.5 0.5B",
    description: "Good balance of speed and quality (~350MB download)",
    size: "~350MB",
    contextWindow: 4096,
    quality: "good"
  },
  {
    id: "onnx-community/Qwen2.5-1.5B-Instruct",
    name: "Qwen2.5 1.5B",
    description: "Better quality, slower (~900MB download)",
    size: "~900MB",
    contextWindow: 4096,
    quality: "better"
  },
  {
    id: "onnx-community/Phi-3.5-mini-instruct",
    name: "Phi-3.5 Mini",
    description: "Best quality, large download (~2GB download)",
    size: "~2GB",
    contextWindow: 4096,
    quality: "best"
  }
];
```

---

### Step 3: Initialize LLM Worker in `app.js`

**What**: Create and manage the LLM worker instance in the main thread.

**Where**: In `app.js`, near where the Whisper worker is initialized. Search for `new Worker('./whisper-worker.js'` to find the location (approximately line 670). Add the LLM worker initialization nearby (can be at the top-level scope).

**Add this code block** (place it after the model catalog from Step 2):

```javascript
// ============================================================
// LLM WORKER INITIALIZATION
// ============================================================
let llmWorker = null;
let llmModelReady = false;
let llmModelName = "";

function initLLMWorker() {
  if (llmWorker) return; // Already initialized
  
  llmWorker = new Worker('./llm-worker.js', { type: 'module' });
  
  llmWorker.onmessage = (event) => {
    const { status, message, token, result, progress, file, loaded, total } = event.data;
    
    switch (status) {
      case "loading":
        updateReasoningStatus("loading", message);
        break;
      case "download_progress":
        updateReasoningProgress(progress, file, loaded, total);
        break;
      case "ready":
        llmModelReady = true;
        updateReasoningStatus("ready", message);
        break;
      case "generating":
        updateReasoningStatus("generating", message);
        break;
      case "token":
        appendReasoningToken(token);
        break;
      case "completed":
        finalizeReasoningResponse(result);
        break;
      case "error":
        handleReasoningError(message);
        break;
      case "unloaded":
        llmModelReady = false;
        llmModelName = "";
        updateReasoningStatus("idle", message);
        break;
    }
  };
  
  llmWorker.onerror = (error) => {
    handleReasoningError(`Worker error: ${error.message}`);
  };
}

function loadLLMModel(modelId) {
  initLLMWorker();
  llmModelReady = false;
  llmModelName = modelId;
  llmWorker.postMessage({ action: "load_model", modelName: modelId });
}

function generateWithLLM(messages, config) {
  if (!llmWorker || !llmModelReady) {
    handleReasoningError("Model not loaded. Please select and load a model first.");
    return;
  }
  llmWorker.postMessage({ 
    action: "generate", 
    messages: messages,
    generationConfig: config
  });
}

function unloadLLMModel() {
  if (llmWorker) {
    llmWorker.postMessage({ action: "unload" });
  }
}
```

---

## Phase 2: UI Integration

### Step 4: Add Reasoning Settings Section to `index.html`

**What**: Add a new settings section for the reasoning model configuration.

**Where**: In `index.html`, inside the settings panel, after the existing "Converter Options" section (after the `<div class="settings-section">` that contains `whisper-model` and `frame-interval`, approximately line 155). Insert a new `<div class="settings-section">` block.

**Add this HTML** (insert after the Converter Options `</div>` closing tag, before the AI Summary Options section):

```html
<!-- Offline Reasoning Settings -->
<div class="settings-section">
  <h3>Offline Reasoning (Local LLM)</h3>
  <p class="helper-text">Run AI reasoning entirely on your device. Models are downloaded once and cached for offline use.</p>
  
  <div class="form-group">
    <label for="reasoning-model">Reasoning Model</label>
    <select id="reasoning-model" class="form-input">
      <option value="">-- Select a model --</option>
      <!-- Populated dynamically from LLM_MODELS catalog -->
    </select>
    <span class="helper-text" id="reasoning-model-description"></span>
  </div>
  
  <div class="form-group">
    <button id="load-reasoning-model" class="btn btn-secondary" disabled>
      Load Model
    </button>
    <span id="reasoning-model-status" class="status-text">No model loaded</span>
  </div>
  
  <div class="form-group hidden" id="reasoning-progress-group">
    <label>Download Progress</label>
    <div class="progress-bar-container">
      <div id="reasoning-progress-bar" class="progress-bar" style="width: 0%"></div>
    </div>
    <span id="reasoning-progress-text" class="helper-text">0%</span>
  </div>
  
  <div class="form-group">
    <label for="reasoning-max-tokens">Max Response Length</label>
    <input type="range" id="reasoning-max-tokens" min="128" max="2048" value="512" step="64" class="form-input">
    <span id="reasoning-max-tokens-value">512 tokens</span>
  </div>
  
  <div class="form-group">
    <label for="reasoning-temperature">Creativity (Temperature)</label>
    <input type="range" id="reasoning-temperature" min="0.1" max="1.5" value="0.7" step="0.1" class="form-input">
    <span id="reasoning-temperature-value">0.7</span>
  </div>
  
  <div class="form-group">
    <button id="unload-reasoning-model" class="btn btn-danger btn-small hidden">
      Unload Model (Free Memory)
    </button>
  </div>
</div>
```

---

### Step 5: Add Reasoning Tab and Chat UI to Results Area

**What**: Add a new "Reasoning" tab in the results container with a chat-style interface.

**Where**: In `index.html`, find the tabs control area (the `<div class="tabs-control">` that contains Preview, Markdown Source, and Summary buttons). Add a new tab button. Then add a new tab pane in the `<div class="panes-container">`.

**Modification 1** — Add tab button (after the Summary tab button):

```html
<button class="tab-btn" data-tab="reasoning">Reasoning</button>
```

**Modification 2** — Add tab pane (after `<div id="tab-pane-summary" class="tab-pane markdown-body"></div>`):

```html
<!-- Reasoning Tab -->
<div id="tab-pane-reasoning" class="tab-pane">
  <div class="reasoning-container">
    <!-- Task Mode Selector -->
    <div class="reasoning-mode-selector">
      <button class="reasoning-mode-btn active" data-mode="summarize">Summarize</button>
      <button class="reasoning-mode-btn" data-mode="qa">Q&A</button>
      <button class="reasoning-mode-btn" data-mode="analyze">Analyze</button>
    </div>
    
    <!-- Status Indicator -->
    <div id="reasoning-status-bar" class="reasoning-status">
      <span id="reasoning-status-icon" class="status-dot status-idle"></span>
      <span id="reasoning-status-text">No model loaded — load one in Settings</span>
    </div>
    
    <!-- Response Output Area (streaming) -->
    <div id="reasoning-output" class="reasoning-output markdown-body">
      <p class="placeholder-text">Select a mode above and click "Run" or type a question to get started.</p>
    </div>
    
    <!-- Input Area (for Q&A mode) -->
    <div class="reasoning-input-area">
      <textarea id="reasoning-input" class="reasoning-input" 
                placeholder="Ask a question about this document..." 
                rows="2"></textarea>
      <button id="reasoning-run-btn" class="btn btn-primary" disabled>
        Run
      </button>
    </div>
  </div>
</div>
```

---

### Step 6: Add CSS Styles for Reasoning UI

**What**: Add styles for the reasoning chat interface, progress bars, and status indicators.

**Where**: Append to the end of `index.css`.

**Add these styles**:

```css
/* ============================================================
   OFFLINE REASONING UI
   ============================================================ */

/* Reasoning Container */
.reasoning-container {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 400px;
}

/* Mode Selector Buttons */
.reasoning-mode-selector {
  display: flex;
  gap: 8px;
  padding: 12px 0;
  border-bottom: 1px solid var(--border-color, #e0e0e0);
  margin-bottom: 12px;
}

.reasoning-mode-btn {
  padding: 6px 16px;
  border: 1px solid var(--border-color, #d0d0d0);
  border-radius: 16px;
  background: transparent;
  cursor: pointer;
  font-size: 13px;
  transition: all 0.2s;
}

.reasoning-mode-btn.active {
  background: var(--accent-color, #2563eb);
  color: white;
  border-color: var(--accent-color, #2563eb);
}

/* Status Bar */
.reasoning-status {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: var(--surface-color, #f8f9fa);
  border-radius: 6px;
  margin-bottom: 12px;
  font-size: 12px;
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.status-dot.status-idle { background: #9ca3af; }
.status-dot.status-loading { background: #f59e0b; animation: pulse 1.5s infinite; }
.status-dot.status-ready { background: #10b981; }
.status-dot.status-generating { background: #3b82f6; animation: pulse 0.8s infinite; }
.status-dot.status-error { background: #ef4444; }

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}

/* Output Area */
.reasoning-output {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  border: 1px solid var(--border-color, #e0e0e0);
  border-radius: 8px;
  margin-bottom: 12px;
  min-height: 200px;
  font-size: 14px;
  line-height: 1.6;
}

.reasoning-output .placeholder-text {
  color: #9ca3af;
  font-style: italic;
}

.reasoning-output .streaming-cursor {
  display: inline-block;
  width: 2px;
  height: 1em;
  background: var(--accent-color, #2563eb);
  animation: blink 1s infinite;
  vertical-align: text-bottom;
  margin-left: 2px;
}

@keyframes blink {
  0%, 50% { opacity: 1; }
  51%, 100% { opacity: 0; }
}

/* Input Area */
.reasoning-input-area {
  display: flex;
  gap: 8px;
  align-items: flex-end;
}

.reasoning-input {
  flex: 1;
  padding: 10px 14px;
  border: 1px solid var(--border-color, #d0d0d0);
  border-radius: 8px;
  resize: vertical;
  font-size: 14px;
  font-family: inherit;
  min-height: 42px;
  max-height: 120px;
}

.reasoning-input:focus {
  outline: none;
  border-color: var(--accent-color, #2563eb);
  box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.1);
}

/* Progress Bar */
.progress-bar-container {
  width: 100%;
  height: 6px;
  background: var(--border-color, #e0e0e0);
  border-radius: 3px;
  overflow: hidden;
}

.progress-bar {
  height: 100%;
  background: var(--accent-color, #2563eb);
  border-radius: 3px;
  transition: width 0.3s ease;
}

/* Utility */
.btn-danger {
  background: #ef4444;
  color: white;
  border: none;
}

.btn-small {
  padding: 4px 12px;
  font-size: 12px;
}

.status-text {
  font-size: 12px;
  color: #6b7280;
}
```

---

## Phase 3: Reasoning Pipelines

### Step 7: Add Reasoning Orchestrator to `app.js`

**What**: The main function that connects the UI to the LLM worker. Handles prompt construction, context windowing, and response streaming.

**Where**: In `app.js`, add after the existing `generateSummary()` function (around line 1185).

**Add this code**:

```javascript
// ============================================================
// OFFLINE REASONING ORCHESTRATOR
// ============================================================

// System prompts for each reasoning task
const REASONING_PROMPTS = {
  summarize: `You are a document summarizer. Given the following document content, produce a concise summary with key points in Markdown format. Focus on the most important information, findings, and conclusions. Use bullet points for clarity.`,
  
  qa: `You are a document assistant. Answer the user's question based ONLY on the provided document content. If the answer cannot be found in the document, say "I couldn't find this information in the document." Be specific and cite relevant parts when possible.`,
  
  analyze: `You are a document analyst. Analyze the following document and provide:
1. **Topic/Category**: What is this document about?
2. **Key Entities**: People, organizations, places, dates mentioned
3. **Sentiment**: Overall tone (positive, negative, neutral, mixed)
4. **Main Arguments/Claims**: Core points being made
5. **Action Items**: Any tasks, recommendations, or next steps mentioned

Format your response in Markdown.`
};

/**
 * Estimate token count from text (rough approximation: ~4 chars per token)
 */
function estimateTokens(text) {
  return Math.ceil(text.length / 4);
}

/**
 * Truncate document content to fit within model's context window.
 * Preserves document structure (headings, first/last sections).
 * 
 * @param {string} content - The full markdown content
 * @param {number} maxTokens - Maximum tokens available for context
 * @returns {string} - Truncated content that fits within token budget
 */
function truncateToContextWindow(content, maxTokens) {
  const currentTokens = estimateTokens(content);
  if (currentTokens <= maxTokens) return content;
  
  // Strategy: Keep first 60% and last 20% of the budget, with a note in between
  const lines = content.split('\n');
  const charBudget = maxTokens * 4; // Convert back to chars
  const headBudget = Math.floor(charBudget * 0.6);
  const tailBudget = Math.floor(charBudget * 0.2);
  
  let headContent = "";
  let tailContent = "";
  
  // Build head (first portion)
  for (const line of lines) {
    if ((headContent + line + '\n').length > headBudget) break;
    headContent += line + '\n';
  }
  
  // Build tail (last portion)
  for (let i = lines.length - 1; i >= 0; i--) {
    if ((lines[i] + '\n' + tailContent).length > tailBudget) break;
    tailContent = lines[i] + '\n' + tailContent;
  }
  
  return headContent + 
    '\n\n[... Document truncated due to model context limits. ' +
    `${currentTokens - maxTokens} tokens omitted ...]\n\n` + 
    tailContent;
}

/**
 * Main entry point for offline reasoning.
 * 
 * @param {string} markdownContent - The converted document markdown
 * @param {string} taskMode - One of: "summarize", "qa", "analyze"
 * @param {string} userQuery - User's question (only used in "qa" mode)
 */
function generateLocalReasoning(markdownContent, taskMode, userQuery = "") {
  if (!llmWorker || !llmModelReady) {
    handleReasoningError("No model loaded. Go to Settings → Offline Reasoning to load a model.");
    return;
  }
  
  // Get current model's context window from catalog
  const modelInfo = LLM_MODELS.find(m => m.id === llmModelName);
  const contextWindow = modelInfo?.contextWindow || 2048;
  
  // Get generation config from UI
  const maxNewTokens = parseInt(document.getElementById("reasoning-max-tokens")?.value || "512");
  const temperature = parseFloat(document.getElementById("reasoning-temperature")?.value || "0.7");
  
  // Reserve tokens for: system prompt (~200) + user query (~100) + generation output
  const reservedTokens = 200 + (taskMode === "qa" ? estimateTokens(userQuery) + 50 : 0) + maxNewTokens;
  const availableContextTokens = contextWindow - reservedTokens;
  
  // Truncate content if needed
  const truncatedContent = truncateToContextWindow(markdownContent, availableContextTokens);
  
  // Build chat messages
  const systemPrompt = REASONING_PROMPTS[taskMode] || REASONING_PROMPTS.summarize;
  
  let userMessage;
  if (taskMode === "qa") {
    userMessage = `## Document Content:\n\n${truncatedContent}\n\n## Question:\n${userQuery}`;
  } else {
    userMessage = `## Document Content:\n\n${truncatedContent}`;
  }
  
  const messages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userMessage }
  ];
  
  // Clear output and show streaming cursor
  const outputEl = document.getElementById("reasoning-output");
  if (outputEl) {
    outputEl.innerHTML = '<span class="streaming-cursor"></span>';
  }
  
  // Send to worker
  generateWithLLM(messages, {
    max_new_tokens: maxNewTokens,
    temperature: temperature,
    top_p: 0.9
  });
}
```

---

### Step 8: Add UI Helper Functions to `app.js`

**What**: Functions that update the reasoning UI based on worker messages.

**Where**: Add directly after the orchestrator code from Step 7.

```javascript
// ============================================================
// REASONING UI HELPERS
// ============================================================

let reasoningResponseBuffer = "";

function updateReasoningStatus(state, message) {
  const statusIcon = document.getElementById("reasoning-status-icon");
  const statusText = document.getElementById("reasoning-status-text");
  const runBtn = document.getElementById("reasoning-run-btn");
  
  if (statusIcon) {
    statusIcon.className = `status-dot status-${state}`;
  }
  if (statusText) {
    statusText.textContent = message;
  }
  if (runBtn) {
    runBtn.disabled = (state === "loading" || state === "generating");
  }
}

function updateReasoningProgress(percent, file, loaded, total) {
  const progressGroup = document.getElementById("reasoning-progress-group");
  const progressBar = document.getElementById("reasoning-progress-bar");
  const progressText = document.getElementById("reasoning-progress-text");
  
  if (progressGroup) progressGroup.classList.remove("hidden");
  if (progressBar) progressBar.style.width = `${percent}%`;
  if (progressText) {
    const loadedMB = loaded ? (loaded / 1024 / 1024).toFixed(1) : "?";
    const totalMB = total ? (total / 1024 / 1024).toFixed(1) : "?";
    progressText.textContent = `${Math.round(percent)}% — ${loadedMB}MB / ${totalMB}MB${file ? ` (${file})` : ""}`;
  }
}

function appendReasoningToken(token) {
  reasoningResponseBuffer += token;
  const outputEl = document.getElementById("reasoning-output");
  if (outputEl) {
    // Render accumulated markdown with a streaming cursor at the end
    const rendered = DOMPurify.sanitize(marked.parse(reasoningResponseBuffer));
    outputEl.innerHTML = rendered + '<span class="streaming-cursor"></span>';
    outputEl.scrollTop = outputEl.scrollHeight;
  }
}

function finalizeReasoningResponse(fullText) {
  reasoningResponseBuffer = fullText || reasoningResponseBuffer;
  const outputEl = document.getElementById("reasoning-output");
  if (outputEl) {
    // Final render without cursor
    const rendered = DOMPurify.sanitize(marked.parse(reasoningResponseBuffer));
    outputEl.innerHTML = rendered;
  }
  updateReasoningStatus("ready", "Done. Model ready for next query.");
  reasoningResponseBuffer = "";
}

function handleReasoningError(message) {
  const outputEl = document.getElementById("reasoning-output");
  if (outputEl) {
    outputEl.innerHTML = `<p style="color: #ef4444;"><strong>Error:</strong> ${DOMPurify.sanitize(message)}</p>`;
  }
  updateReasoningStatus("error", message);
}
```

---

### Step 9: Add Event Listeners for Reasoning UI

**What**: Wire up all the reasoning UI elements (model loading, mode switching, run button).

**Where**: In `app.js`, add an initialization function that's called on `DOMContentLoaded`. Place it near the existing `initAISummaryFeature()` call (around line 972).

```javascript
// ============================================================
// REASONING FEATURE INITIALIZATION
// ============================================================

function initReasoningFeature() {
  const modelSelect = document.getElementById("reasoning-model");
  const loadBtn = document.getElementById("load-reasoning-model");
  const unloadBtn = document.getElementById("unload-reasoning-model");
  const runBtn = document.getElementById("reasoning-run-btn");
  const maxTokensSlider = document.getElementById("reasoning-max-tokens");
  const tempSlider = document.getElementById("reasoning-temperature");
  const reasoningInput = document.getElementById("reasoning-input");
  
  // Populate model dropdown from catalog
  if (modelSelect) {
    LLM_MODELS.forEach(model => {
      const option = document.createElement("option");
      option.value = model.id;
      option.textContent = `${model.name} (${model.size})`;
      modelSelect.appendChild(option);
    });
    
    // Restore saved selection
    const savedModel = localStorage.getItem("reasoning_model");
    if (savedModel) modelSelect.value = savedModel;
    
    modelSelect.addEventListener("change", () => {
      const selected = LLM_MODELS.find(m => m.id === modelSelect.value);
      const descEl = document.getElementById("reasoning-model-description");
      if (descEl && selected) {
        descEl.textContent = selected.description;
      }
      if (loadBtn) loadBtn.disabled = !modelSelect.value;
      localStorage.setItem("reasoning_model", modelSelect.value);
    });
  }
  
  // Load model button
  if (loadBtn) {
    loadBtn.addEventListener("click", () => {
      if (modelSelect?.value) {
        loadLLMModel(modelSelect.value);
      }
    });
  }
  
  // Unload model button
  if (unloadBtn) {
    unloadBtn.addEventListener("click", () => {
      unloadLLMModel();
      unloadBtn.classList.add("hidden");
    });
  }
  
  // Run button
  if (runBtn) {
    runBtn.addEventListener("click", () => {
      const markdownContent = document.getElementById("markdown-raw")?.value || "";
      if (!markdownContent.trim()) {
        handleReasoningError("No document content. Convert a file first.");
        return;
      }
      
      const activeMode = document.querySelector(".reasoning-mode-btn.active")?.dataset.mode || "summarize";
      const userQuery = reasoningInput?.value || "";
      
      if (activeMode === "qa" && !userQuery.trim()) {
        handleReasoningError("Please enter a question for Q&A mode.");
        return;
      }
      
      reasoningResponseBuffer = "";
      generateLocalReasoning(markdownContent, activeMode, userQuery);
    });
  }
  
  // Mode switching buttons
  document.querySelectorAll(".reasoning-mode-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".reasoning-mode-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      
      const inputArea = document.querySelector(".reasoning-input-area");
      const input = document.getElementById("reasoning-input");
      if (btn.dataset.mode === "qa") {
        input?.setAttribute("placeholder", "Ask a question about this document...");
      } else if (btn.dataset.mode === "summarize") {
        input?.setAttribute("placeholder", "Optional: specific focus for summary...");
      } else {
        input?.setAttribute("placeholder", "Optional: specific aspects to analyze...");
      }
    });
  });
  
  // Slider value displays
  if (maxTokensSlider) {
    const savedMaxTokens = localStorage.getItem("reasoning_max_tokens");
    if (savedMaxTokens) maxTokensSlider.value = savedMaxTokens;
    
    const display = document.getElementById("reasoning-max-tokens-value");
    if (display) display.textContent = `${maxTokensSlider.value} tokens`;
    
    maxTokensSlider.addEventListener("input", () => {
      if (display) display.textContent = `${maxTokensSlider.value} tokens`;
      localStorage.setItem("reasoning_max_tokens", maxTokensSlider.value);
    });
  }
  
  if (tempSlider) {
    const savedTemp = localStorage.getItem("reasoning_temperature");
    if (savedTemp) tempSlider.value = savedTemp;
    
    const display = document.getElementById("reasoning-temperature-value");
    if (display) display.textContent = tempSlider.value;
    
    tempSlider.addEventListener("input", () => {
      if (display) display.textContent = tempSlider.value;
      localStorage.setItem("reasoning_temperature", tempSlider.value);
    });
  }
  
  // Enter key in input sends query
  if (reasoningInput) {
    reasoningInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        runBtn?.click();
      }
    });
  }
}

// Call during app initialization (add to the DOMContentLoaded handler):
// initReasoningFeature();
```

**Important**: Find the existing `DOMContentLoaded` event listener in `app.js` and add `initReasoningFeature();` alongside the existing `initAISummaryFeature();` call.

---

## Phase 4: Integration with Existing Summary Flow

### Step 10: Update the Summary Engine Dropdown

**What**: Add "Local LLM (Offline)" as an option in the existing AI Summary Mode dropdown.

**Where**: In `index.html`, find the `<select id="ai-summary-mode">` element (around line 170).

**Add this option** as the first in the dropdown (it becomes the default selected):

```html
<option value="local-llm" selected>Local LLM (Offline — uses Reasoning Model)</option>
```

**Then in `app.js`**, modify the `generateSummary()` function (around line 1106) to handle the new mode. Add this case **before** the existing cloud API calls:

```javascript
// Inside generateSummary(), add handling for "local-llm" mode:
if (currentMode === "local-llm") {
  generateLocalReasoning(markdownContent, "summarize");
  return;
}
```

**Also in `app.js`**, update the default value for the summary mode localStorage key (in `initAISummaryFeature()`, around line 1014):

```javascript
// CHANGE FROM:
const savedMode = localStorage.getItem("ai_summary_mode") || "gemini";
// CHANGE TO:
const savedMode = localStorage.getItem("ai_summary_mode") || "local-llm";
```

This ensures that on first load (no localStorage set), the app defaults to the offline Local LLM rather than requiring a cloud API key.

---

## File Summary: What to Create vs. Modify

| Action | File | Description |
|--------|------|-------------|
| **CREATE** | `llm-worker.js` | New Web Worker for LLM inference (Step 1) |
| **MODIFY** | `app.js` | Add model catalog, worker init, orchestrator, UI helpers, event listeners (Steps 2-3, 7-9) |
| **MODIFY** | `index.html` | Add settings section, reasoning tab, chat UI (Steps 4-5, 10) |
| **MODIFY** | `index.css` | Add reasoning UI styles (Step 6) |

---

## Dependencies & Compatibility

- **No new libraries needed** — `lib/transformers.js` already supports text-generation pipeline
- **Browser support**: Chrome 90+, Firefox 90+, Safari 15.4+ (all support Web Workers + WASM)
- **Storage**: Models cached via Cache API (browser-managed, survives page reloads)
- **Memory**: 4-bit quantized models use ~400MB-4GB RAM depending on model size
- **First load**: Requires internet to download model from HuggingFace CDN
- **Subsequent loads**: 100% offline from browser cache

---

## Testing Checklist

1. **Offline test**: DevTools → Network → Offline, load cached model, convert PDF, summarize → works
2. **Streaming test**: Tokens appear one-by-one during generation (not all at once)
3. **Context overflow**: 50-page PDF → smart truncation produces coherent summary
4. **Worker isolation**: Run LLM inference while converting another file → UI stays responsive
5. **Memory**: Load Phi-3.5 on 8GB device → graceful error if OOM
6. **Q&A grounding**: Answers reference actual document content
7. **Settings persistence**: Reload page → model selection, temperature, max tokens preserved
8. **Model switching**: Change model mid-session → old model unloaded, new one loaded
9. **Tab switching**: Navigate between Preview/Source/Summary/Reasoning → state preserved

---

## Notes for Implementation

- The `TextStreamer` class from Transformers.js may need to be imported differently depending on the version in `lib/transformers.js`. If not available, implement streaming by using `generate()` with a custom callback or by polling partial outputs.
- The `pipeline("text-generation", ...)` call with chat-format messages requires Transformers.js v3+. If the bundled version is older, use `pipeline("text-generation", ...)` with a formatted prompt string instead of a messages array.
- Model IDs (`onnx-community/...`) are HuggingFace Hub paths. Transformers.js resolves these automatically via its CDN/cache system.
- The `dtype: "q4"` option requests 4-bit quantized weights. If unavailable for a model, remove this option and use the default quantization.
