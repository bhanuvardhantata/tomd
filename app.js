// ToMD Frontend Orchestration

document.addEventListener("DOMContentLoaded", () => {
  // --- DOM Elements ---
  const badgeTesseract = document.getElementById("badge-tesseract");
  const badgeWhisper = document.getElementById("badge-whisper");

  const dropZone = document.getElementById("drop-zone");
  const fileInput = document.getElementById("file-input");
  const fileDetails = document.getElementById("file-details");
  const fileNameDisplay = document.getElementById("file-name");
  const fileSizeDisplay = document.getElementById("file-size");
  const removeFileBtn = document.getElementById("remove-file-btn");
  const sizeLimitText = document.getElementById("size-limit-text");

  const whisperModelSelect = document.getElementById("whisper-model");
  const frameIntervalInput = document.getElementById("frame-interval");
  const convertBtn = document.getElementById("convert-btn");

  const placeholderView = document.getElementById("workspace-placeholder");
  const progressContainer = document.getElementById("progress-container");
  const progressBarFill = document.getElementById("progress-bar-fill");
  const currentStatusText = document.getElementById("current-status-text");
  const logsList = document.getElementById("logs-list");
  const stageIndicators = document.getElementById("stage-indicators");

  const resultsContainer = document.getElementById("results-container");
  const tabPanePreview = document.getElementById("tab-pane-preview");
  const tabPaneSource = document.getElementById("tab-pane-source");
  const tabPaneSummary = document.getElementById("tab-pane-summary");
  const markdownRawTextarea = document.getElementById("markdown-raw");
  const copyBtn = document.getElementById("copy-btn");
  const downloadBtn = document.getElementById("download-btn");

  const aiSummaryMode = document.getElementById("ai-summary-mode");
  const aiSummaryHelper = document.getElementById("ai-summary-helper");
  const geminiKeyGroup = document.getElementById("gemini-key-group");
  const geminiApiKeyInput = document.getElementById("gemini-api-key");
  const toggleApiKeyBtn = document.getElementById("toggle-api-key");
  const customProxyGroup = document.getElementById("custom-proxy-group");
  const customProxyUrlInput = document.getElementById("custom-proxy-url");
  const apiKeyLabel = document.getElementById("api-key-label");
  const apiKeyHelper = document.getElementById("api-key-helper");
  const apiKeyLink = document.getElementById("api-key-link");

  const tabButtons = document.querySelectorAll(".tab-btn");

  // --- App State ---
  let selectedFile = null;
  let convertedMarkdown = "";

  // File extensions categories
  const PLAIN_TEXT_EXTENSIONS = new Set([
    ".txt", ".md", ".markdown", ".log", ".cfg", ".ini", ".conf",
    ".env", ".yml", ".yaml", ".toml", ".properties", ".gitignore",
    ".dockerignore", ".editorconfig",
  ]);

  const LANG_MAP = {
    ".py": "python", ".js": "javascript", ".ts": "typescript",
    ".java": "java", ".c": "c", ".cpp": "cpp", ".h": "c",
    ".cs": "csharp", ".rb": "ruby", ".go": "go", ".rs": "rust",
    ".sh": "bash", ".bash": "bash", ".zsh": "bash",
    ".swift": "swift", ".kt": "kotlin", ".scala": "scala",
    ".r": "r", ".sql": "sql", ".php": "php", ".pl": "perl",
    ".lua": "lua", ".m": "objectivec", ".mm": "objectivec",
    ".cls": "apex", ".trigger": "apex", ".apex": "apex",
  };

  const IMAGE_EXTENSIONS = new Set([
    ".png", ".jpg", ".jpeg", ".webp", ".bmp", ".gif", ".tiff"
  ]);

  const VIDEO_EXTENSIONS = new Set([
    ".mp4", ".mkv", ".avi", ".mov", ".webm", ".flv", ".wmv", ".m4v"
  ]);

  const AUDIO_EXTENSIONS = new Set([
    ".mp3", ".wav", ".m4a", ".flac", ".ogg", ".aac", ".wma"
  ]);

  const MEDIA_EXTENSIONS = new Set([...VIDEO_EXTENSIONS, ...AUDIO_EXTENSIONS]);

  // Max upload size locally set to 500 MB
  const maxUploadSizeMb = 500;

  // --- Initialize App ---
  checkEngineDiagnostics();
  initAISummaryFeature();

  // --- Event Listeners ---

  // Drag & Drop event handling
  ["dragenter", "dragover"].forEach(eventName => {
    dropZone.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropZone.classList.add("drag-over");
    });
  });

  ["dragleave", "drop"].forEach(eventName => {
    dropZone.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropZone.classList.remove("drag-over");
    });
  });

  dropZone.addEventListener("drop", (e) => {
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      handleFileSelected(files[0]);
    }
  });

  // Clicking on drop zone triggers file input
  fileInput.addEventListener("change", () => {
    if (fileInput.files.length > 0) {
      handleFileSelected(fileInput.files[0]);
    }
  });

  // Remove File Button
  removeFileBtn.addEventListener("click", () => {
    resetInputFile();
  });

  // Convert Button click
  convertBtn.addEventListener("click", () => {
    if (!selectedFile) return;
    startClientSideConversion();
  });

  // Tab switching
  tabButtons.forEach(btn => {
    btn.addEventListener("click", () => {
      const tabName = btn.getAttribute("data-tab");

      tabButtons.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");

      // Hide all panes, show target pane
      document.querySelectorAll(".tab-pane").forEach(pane => {
        pane.classList.remove("active");
      });
      const targetPane = document.getElementById(`tab-pane-${tabName}`);
      if (targetPane) {
        targetPane.classList.add("active");
      }
    });
  });

  // Copy Button
  copyBtn.addEventListener("click", () => {
    const rawMarkdown = markdownRawTextarea.value;
    navigator.clipboard.writeText(rawMarkdown).then(() => {
      const originalText = copyBtn.innerHTML;
      copyBtn.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="btn-icon-sm">
          <polyline points="20 6 9 17 4 12"/>
        </svg>
        Copied!
      `;
      setTimeout(() => {
        copyBtn.innerHTML = originalText;
      }, 2000);
    });
  });

  // Download Button (Client-side Blob download)
  downloadBtn.addEventListener("click", () => {
    if (!convertedMarkdown) return;
    const blob = new Blob([convertedMarkdown], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const origName = selectedFile ? selectedFile.name.split(".").slice(0, -1).join(".") : "converted";
    a.href = url;
    a.download = `${origName}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  });

  // --- Diagnostics Check ---
  function checkEngineDiagnostics() {
    // Check Tesseract availability
    const tesseractAvailable = typeof Tesseract !== "undefined";
    updateBadge(badgeTesseract, tesseractAvailable);

    // Check Whisper availability (Web Audio + Transformers.js support)
    const webAudioAvailable = !!(window.AudioContext || window.webkitAudioContext);
    updateBadge(badgeWhisper, webAudioAvailable);

    // Configure dropdown models
    if (webAudioAvailable) {
      whisperModelSelect.innerHTML = `
        <option value="Xenova/whisper-tiny.en">Whisper Tiny English (~75MB)</option>
        <option value="Xenova/whisper-base.en">Whisper Base English (~140MB)</option>
      `;
    } else {
      whisperModelSelect.innerHTML = `<option value="">Speech-to-Text Not Supported</option>`;
      whisperModelSelect.disabled = true;
    }

    sizeLimitText.textContent = `Max file size: ${maxUploadSizeMb} MB`;
  }

  function updateBadge(badgeElement, available) {
    if (!badgeElement) return;
    badgeElement.classList.remove("loading");
    if (available) {
      badgeElement.classList.add("available");
      badgeElement.classList.remove("unavailable");
    } else {
      badgeElement.classList.add("unavailable");
      badgeElement.classList.remove("available");
    }
  }

  // --- Input Selection ---
  function handleFileSelected(file) {
    const maxBytes = maxUploadSizeMb * 1024 * 1024;
    if (file.size > maxBytes) {
      alert(`File too large (${formatBytes(file.size)}). Maximum allowed is ${maxUploadSizeMb} MB.`);
      return;
    }

    selectedFile = file;
    fileNameDisplay.textContent = file.name;
    fileSizeDisplay.textContent = formatBytes(file.size);

    fileDetails.classList.remove("hidden");
    dropZone.classList.add("hidden");
    convertBtn.disabled = false;
  }

  function resetInputFile() {
    selectedFile = null;
    fileInput.value = "";
    fileDetails.classList.add("hidden");
    dropZone.classList.remove("hidden");
    convertBtn.disabled = true;

    placeholderView.classList.remove("hidden");
    progressContainer.classList.add("hidden");
    resultsContainer.classList.add("hidden");

    convertedMarkdown = "";
    if (tabPaneSummary) tabPaneSummary.innerHTML = "";
    logsList.innerHTML = "";
    resetStages();
  }

  // --- Conversion Orchestration ---
  function startClientSideConversion() {
    if (!selectedFile) return;

    // Lock UI controls
    convertBtn.disabled = true;
    whisperModelSelect.disabled = true;
    frameIntervalInput.disabled = true;
    removeFileBtn.disabled = true;

    placeholderView.classList.add("hidden");
    resultsContainer.classList.add("hidden");
    progressContainer.classList.remove("hidden");

    progressBarFill.style.width = "5%";
    progressBarFill.style.background = "";
    progressBarFill.style.boxShadow = "";
    currentStatusText.textContent = "Loading file content...";

    logsList.innerHTML = "";
    resetStages();
    setStageActive("upload");
    addLogEntry("System", `Initializing direct client-side conversion: ${selectedFile.name}`);

    const ext = "." + selectedFile.name.split(".").pop().toLowerCase();

    // Async yield for UI thread updates
    setTimeout(async () => {
      try {
        setStageActive("processing");
        progressBarFill.style.width = "20%";

        let markdownResult = "";

        if (PLAIN_TEXT_EXTENSIONS.has(ext)) {
          addLogEntry("System", "Reading plain text file content...");
          markdownResult = await readFileAsText(selectedFile);
        } else if (LANG_MAP[ext]) {
          addLogEntry("System", `Wrapping source code file (${LANG_MAP[ext]})...`);
          const text = await readFileAsText(selectedFile);
          markdownResult = `\`\`\`${LANG_MAP[ext]}\n${text}\n\`\`\`\n`;
        } else if (ext === ".csv") {
          addLogEntry("System", "Parsing CSV format to Markdown table...");
          const text = await readFileAsText(selectedFile);
          markdownResult = convertCsvToMarkdown(text);
        } else if (ext === ".json") {
          addLogEntry("System", "Parsing JSON string...");
          const text = await readFileAsText(selectedFile);
          try {
            const parsed = JSON.parse(text);
            markdownResult = `\`\`\`json\n${JSON.stringify(parsed, null, 2)}\n\`\`\`\n`;
          } catch {
            markdownResult = `\`\`\`json\n${text}\n\`\`\`\n`;
          }
        } else if (ext === ".xml") {
          addLogEntry("System", "Formatting XML tags...");
          const text = await readFileAsText(selectedFile);
          markdownResult = `\`\`\`xml\n${text}\n\`\`\`\n`;
        } else if (ext === ".html" || ext === ".htm") {
          addLogEntry("System", "Translating HTML elements via Turndown...");
          const text = await readFileAsText(selectedFile);
          markdownResult = convertHtmlToMarkdown(text);
        } else if (ext === ".docx") {
          addLogEntry("System", "Decompressing Word layout with Mammoth.js...");
          const buffer = await readFileAsArrayBuffer(selectedFile);
          markdownResult = await convertDocxToMarkdown(buffer);
        } else if (ext === ".xlsx") {
          addLogEntry("System", "Parsing spreadsheet data using SheetJS...");
          const buffer = await readFileAsArrayBuffer(selectedFile);
          markdownResult = convertXlsxToMarkdown(buffer);
        } else if (ext === ".pptx") {
          addLogEntry("System", "Parsing slide structures via JSZip...");
          const buffer = await readFileAsArrayBuffer(selectedFile);
          markdownResult = await convertPptxToMarkdown(buffer);
        } else if (ext === ".pdf") {
          addLogEntry("System", "Running PDF.js text extractor...");
          const buffer = await readFileAsArrayBuffer(selectedFile);
          markdownResult = await convertPdfToMarkdown(buffer);
        } else if (IMAGE_EXTENSIONS.has(ext)) {
          addLogEntry("System", "Triggering Tesseract.js OCR engine...");
          markdownResult = await convertImageToMarkdown(selectedFile);
        } else if (MEDIA_EXTENSIONS.has(ext)) {
          addLogEntry("System", "Processing audio track...");
          markdownResult = await convertMediaToMarkdown(selectedFile, ext);
        } else {
          addLogEntry("System", "Unrecognized format, testing plain text compatibility...");
          try {
            const text = await readFileAsText(selectedFile);
            if (text.includes("\x00")) {
              markdownResult = `*Binary file: \`${selectedFile.name}\` (${selectedFile.size} bytes)*\n`;
            } else {
              markdownResult = text;
            }
          } catch {
            markdownResult = `*Binary file: \`${selectedFile.name}\` (${selectedFile.size} bytes)*\n`;
          }
        }

        progressBarFill.style.width = "100%";
        setStageActive("complete");
        addLogEntry("System", "Conversion completed successfully!");

        setTimeout(() => {
          displayResults(markdownResult);
        }, 500);

      } catch (err) {
        console.error("Client side conversion failed:", err);
        progressBarFill.style.width = "100%";
        progressBarFill.style.background = "var(--status-error)";
        progressBarFill.style.boxShadow = "0 0 8px var(--status-error)";
        addLogEntry("Error", `Conversion failed: ${err.message}`);
        currentStatusText.textContent = "Conversion failed.";
        enableInputControls();
      }
    }, 150);
  }

  // --- Specialized Converter Adapters ---

  function readFileAsText(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target.result);
      reader.onerror = () => reject(new Error("Unable to read file text content."));
      reader.readAsText(file);
    });
  }

  function readFileAsArrayBuffer(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target.result);
      reader.onerror = () => reject(new Error("Unable to read file byte stream."));
      reader.readAsArrayBuffer(file);
    });
  }

  function convertCsvToMarkdown(content) {
    const lines = content.split(/\r?\n/);
    const parsedRows = [];
    for (let line of lines) {
      if (!line.trim()) continue;
      const cells = line.split(",").map(c => c.trim().replace(/^["']|["']$/g, ""));
      parsedRows.push(cells);
    }
    if (parsedRows.length === 0) return "";
    const headers = parsedRows[0];
    let output = "| " + headers.join(" | ") + " |\n";
    output += "| " + headers.map(() => "---").join(" | ") + " |\n";
    for (let i = 1; i < parsedRows.length; i++) {
      const row = parsedRows[i];
      const paddedRow = row.concat(Array(headers.length - row.length).fill(""));
      output += "| " + paddedRow.slice(0, headers.length).join(" | ") + " |\n";
    }
    return output;
  }

  function convertHtmlToMarkdown(htmlContent) {
    if (typeof TurndownService === "undefined") {
      throw new Error("Turndown library is missing.");
    }
    const turndownService = new TurndownService({
      headingStyle: "atx",
      codeBlockStyle: "fenced"
    });
    return turndownService.turndown(htmlContent);
  }

  async function convertDocxToMarkdown(arrayBuffer) {
    if (typeof mammoth === "undefined") {
      throw new Error("Mammoth library is missing.");
    }
    addLogEntry("Converter", "Converting DOCX elements to clean HTML...");
    const result = await mammoth.convertToHtml({ arrayBuffer: arrayBuffer });
    addLogEntry("Converter", "Translating HTML to Markdown format...");
    return convertHtmlToMarkdown(result.value);
  }

  function convertXlsxToMarkdown(arrayBuffer) {
    if (typeof XLSX === "undefined") {
      throw new Error("SheetJS library is missing.");
    }
    addLogEntry("Converter", "Reading spreadsheet workbook...");
    const data = new Uint8Array(arrayBuffer);
    const workbook = XLSX.read(data, { type: "array" });
    let output = "";

    workbook.SheetNames.forEach(sheetName => {
      addLogEntry("Converter", `Parsing sheet index: ${sheetName}...`);
      output += `# Sheet: ${sheetName}\n\n`;
      const sheet = workbook.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });

      if (rows.length === 0) {
        output += "*(empty sheet)*\n\n";
        return;
      }

      const headers = rows[0].map(c => c !== undefined && c !== null ? String(c) : "");
      output += "| " + headers.join(" | ") + " |\n";
      output += "| " + headers.map(() => "---").join(" | ") + " |\n";

      for (let i = 1; i < rows.length; i++) {
        const row = rows[i].map(c => c !== undefined && c !== null ? String(c) : "");
        const paddedRow = row.concat(Array(headers.length - row.length).fill(""));
        output += "| " + paddedRow.slice(0, headers.length).join(" | ") + " |\n";
      }
      output += "\n\n";
    });
    return output.trim() + "\n";
  }

  async function convertPptxToMarkdown(arrayBuffer) {
    if (typeof JSZip === "undefined") {
      throw new Error("JSZip library is missing.");
    }
    addLogEntry("Converter", "Extracting PowerPoint ZIP archive...");
    const zip = await JSZip.loadAsync(arrayBuffer);
    const parser = new DOMParser();

    const slideFiles = Object.keys(zip.files).filter(name =>
      name.startsWith("ppt/slides/slide") && name.endsWith(".xml")
    );

    if (slideFiles.length === 0) {
      return "*No slides found inside presentation.*\n";
    }

    slideFiles.sort((a, b) => {
      const numA = parseInt(a.match(/slide(\d+)/)[1]);
      const numB = parseInt(b.match(/slide(\d+)/)[1]);
      return numA - numB;
    });

    let output = [];
    const numSlides = slideFiles.length;

    for (let idx = 0; idx < numSlides; idx++) {
      const filename = slideFiles[idx];
      addLogEntry("Converter", `Reading slide ${idx + 1} of ${numSlides}...`);
      output.push(`## Slide ${idx + 1}\n`);

      const xmlString = await zip.files[filename].async("string");
      const xmlDoc = parser.parseFromString(xmlString, "application/xml");

      const slideTexts = [];
      const textNodes = xmlDoc.getElementsByTagName("a:t");
      for (const node of textNodes) {
        if (node.textContent.trim()) {
          slideTexts.push(node.textContent.trim());
        }
      }

      if (slideTexts.length > 0) {
        output.push(slideTexts.join("\n\n"));
      } else {
        output.push("*(empty slide)*");
      }
      output.push("");
    }
    return output.join("\n") + "\n";
  }

  async function convertPdfToMarkdown(arrayBuffer) {
    if (typeof pdfjsLib === "undefined") {
      throw new Error("PDF.js library is missing.");
    }
    addLogEntry("Converter", "Setting up worker thread...");
    pdfjsLib.GlobalWorkerOptions.workerSrc = "./lib/pdf.worker.min.js";

    const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) });
    const pdf = await loadingTask.promise;

    const numPages = pdf.numPages;
    addLogEntry("Converter", `PDF loaded. Total Pages: ${numPages}`);

    let outputParts = [];

    for (let idx = 1; idx <= numPages; idx++) {
      addLogEntry("Converter", `Extracting text page ${idx} of ${numPages}...`);
      const page = await pdf.getPage(idx);
      const textContent = await page.getTextContent();

      const items = textContent.items;
      let pageText = "";

      if (items.length > 0) {
        items.sort((a, b) => b.transform[5] - a.transform[5] || a.transform[4] - b.transform[4]);

        let lastY = null;
        let lineParts = [];

        for (let item of items) {
          const y = item.transform[5];
          if (lastY !== null && Math.abs(y - lastY) > 5) {
            pageText += lineParts.join(" ") + "\n";
            lineParts = [];
          }
          lineParts.push(item.str);
          lastY = y;
        }
        if (lineParts.length > 0) {
          pageText += lineParts.join(" ") + "\n";
        }
      }

      // Fallback to OCR if page has no selectable text (scanned PDF)
      if (!pageText.trim() && typeof Tesseract !== "undefined") {
        addLogEntry("Converter", `No selectable text on page ${idx}. Running local OCR scan...`);
        try {
          const scale = 1.5;
          const viewport = page.getViewport({ scale });
          const canvas = document.createElement("canvas");
          const context = canvas.getContext("2d");
          canvas.height = viewport.height;
          canvas.width = viewport.width;

          const renderContext = {
            canvasContext: context,
            viewport: viewport
          };

          await page.render(renderContext).promise;
          const dataUrl = canvas.toDataURL("image/png");

          const absoluteLangPath = new URL('./lib/lang-data', window.location.href).href;
          const absoluteWorkerPath = new URL('./lib/tesseract-worker.min.js', window.location.href).href;
          const absoluteCorePath = new URL('./lib/tesseract-core.wasm.js', window.location.href).href;

          const ocrResult = await Tesseract.recognize(
            dataUrl,
            "eng",
            {
              workerPath: absoluteWorkerPath,
              corePath: absoluteCorePath,
              langPath: absoluteLangPath,
            }
          );
          pageText = ocrResult.data.text || "";
          addLogEntry("Converter", `OCR scan for page ${idx} completed successfully.`);
        } catch (ocrErr) {
          console.error(`OCR failed on page ${idx}:`, ocrErr);
          addLogEntry("Error", `OCR failed on page ${idx}: ${ocrErr.message}`);
        }
      }

      if (pageText.trim()) {
        outputParts.push(pageText.trim());
      }

      progressBarFill.style.width = Math.min(85, 20 + (idx / numPages) * 60) + "%";
    }

    const result = outputParts.join("\n\n");
    return result.trim() ? (result + "\n") : "*No extractable text content in this PDF.*\n";
  }

  async function convertImageToMarkdown(file) {
    if (typeof Tesseract === "undefined") {
      throw new Error("Tesseract.js OCR library is missing.");
    }
    addLogEntry("Converter", "Loading OCR worker model...");

    const absoluteLangPath = new URL('./lib/lang-data', window.location.href).href;
    const absoluteWorkerPath = new URL('./lib/tesseract-worker.min.js', window.location.href).href;
    const absoluteCorePath = new URL('./lib/tesseract-core.wasm.js', window.location.href).href;

    const result = await Tesseract.recognize(
      file,
      "eng",
      {
        workerPath: absoluteWorkerPath,
        corePath: absoluteCorePath,
        langPath: absoluteLangPath,
        logger: (m) => {
          if (m.status === "recognizing text") {
            const pct = Math.round(m.progress * 100);
            currentStatusText.textContent = `OCR scan text: ${pct}%`;
            progressBarFill.style.width = Math.min(95, 20 + m.progress * 75) + "%";
          } else {
            currentStatusText.textContent = m.status;
          }
        }
      }
    );

    addLogEntry("Converter", "Text scan complete.");
    const text = result.data.text;
    return text.trim() ? (text.trim() + "\n") : "*No readable text detected in the image.*\n";
  }

  async function convertMediaToMarkdown(file, ext) {
    const isVideo = VIDEO_EXTENSIONS.has(ext);
    const filename = file.name;
    const sections = [];

    sections.push(isVideo ? `# Video: ${filename}\n` : `# Audio: ${filename}\n`);

    addLogEntry("Converter", "Initializing web audio decoder...");
    currentStatusText.textContent = "Decoding audio track...";

    const arrayBuffer = await readFileAsArrayBuffer(file);

    let audioBuffer;
    try {
      const audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
      audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
    } catch (e) {
      console.error(e);
      throw new Error("Browser audio decoder failure. Ensure file type is native browser compatible.");
    }

    addLogEntry("Converter", `Decoder done. Resampled to 16kHz mono. Length: ${audioBuffer.duration.toFixed(1)}s`);

    let rawAudio = audioBuffer.getChannelData(0);

    // Load and run Whisper model via a Web Worker to keep main thread responsive
    const modelName = whisperModelSelect.value || "Xenova/whisper-tiny.en";
    const isLocal = modelName === "Xenova/whisper-tiny.en";
    addLogEntry("Converter", "Accessing Whisper WASM engine in background worker...");

    badgeWhisper.className = "diagnostic-badge loading";

    const transcriptionResult = await new Promise((resolve, reject) => {
      const worker = new Worker('./whisper-worker.js', { type: 'module' });

      worker.onmessage = (event) => {
        const data = event.data;
        if (data.status === "loading") {
          currentStatusText.textContent = data.message;
          addLogEntry("System", isLocal ? `Loading local weights for ${modelName}...` : `Downloading weights for ${modelName}...`);
        } else if (data.status === "progress") {
          const pct = Math.round(data.progress);
          currentStatusText.textContent = isLocal
            ? `Loading local Whisper model: ${pct}%`
            : `Downloading Whisper model: ${pct}%`;
          progressBarFill.style.width = Math.min(85, 20 + data.progress * 0.5) + "%";
        } else if (data.status === "loaded") {
          badgeWhisper.className = "diagnostic-badge available";
          addLogEntry("System", data.message);
        } else if (data.status === "transcribing") {
          addLogEntry("Converter", "Running automatic speech recognition transcription...");
          currentStatusText.textContent = data.message;
          progressBarFill.style.width = "30%";
        } else if (data.status === "transcribing_chunk") {
          addLogEntry("Converter", data.message);
          currentStatusText.textContent = data.message;
          const currentProgress = 30 + Math.round((data.progress / 100) * 65);
          progressBarFill.style.width = currentProgress + "%";
        } else if (data.status === "completed") {
          addLogEntry("Converter", "ASR pipeline finished transcription.");
          worker.terminate();
          resolve(data.result);
        } else if (data.status === "error") {
          worker.terminate();
          reject(new Error(data.error));
        }
      };

      // Pass the audio buffer as a transferable to avoid memory copy
      worker.postMessage({
        action: "transcribe",
        audio: rawAudio,
        modelName: modelName
      }, [rawAudio.buffer]);
    });

    addLogEntry("Converter", "ASR pipeline finished transcription.");

    let transcriptMarkdown = "";
    if (transcriptionResult && transcriptionResult.chunks) {
      transcriptMarkdown = "| Time | Transcript |\n| :--- | :--- |\n" + transcriptionResult.chunks.map(chunk => {
        const start = chunk.timestamp[0] !== null ? chunk.timestamp[0] : 0;
        const h = Math.floor(start / 3600);
        const m = Math.floor((start % 3600) / 60);
        const s = Math.floor(start % 60);
        const timestamp = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
        return `| **\`${timestamp}\`** | ${chunk.text.trim().replace(/\|/g, '\\|')} |`;
      }).join("\n");
    } else {
      transcriptMarkdown = transcriptionResult.text || "";
    }

    sections.push("## Transcript\n\n" + (transcriptMarkdown || "*No speech detected.*"));

    // Run canvas seeking for video captures if Tesseract.js is present
    if (isVideo && typeof Tesseract !== "undefined") {
      addLogEntry("Converter", "Spawning canvas video frame grabber...");
      currentStatusText.textContent = "Slicing keyframes...";

      const frames = await captureVideoFrames(file, parseInt(frameIntervalInput.value) || 30);
      if (frames.length > 0) {
        addLogEntry("Converter", `Running OCR scan on ${frames.length} keyframes...`);
        const ocrResults = [];

        for (let idx = 0; idx < frames.length; idx++) {
          const { timestamp, dataUrl } = frames[idx];
          currentStatusText.textContent = `OCR Scan Frame ${idx + 1}/${frames.length}...`;
          progressBarFill.style.width = Math.min(95, 80 + (idx / frames.length) * 15) + "%";

          const absoluteLangPath = new URL('./lib/lang-data', window.location.href).href;
          const absoluteWorkerPath = new URL('./lib/tesseract-worker.min.js', window.location.href).href;
          const absoluteCorePath = new URL('./lib/tesseract-core.wasm.js', window.location.href).href;

          const ocrResult = await Tesseract.recognize(dataUrl, "eng", {
            workerPath: absoluteWorkerPath,
            corePath: absoluteCorePath,
            langPath: absoluteLangPath,
          });
          const text = ocrResult.data.text.trim();

          if (text && text.length > 10) {
            ocrResults.push({ timestamp, text });
          }
        }

        // Remove identical repeats
        const deduplicated = [];
        for (let entry of ocrResults) {
          if (deduplicated.length === 0) {
            deduplicated.push(entry);
          } else {
            const prev = deduplicated[deduplicated.length - 1];
            if (entry.text !== prev.text) {
              deduplicated.push(entry);
            }
          }
        }

        if (deduplicated.length > 0) {
          sections.push("## Visual Content (Keyframes)\n");
          deduplicated.forEach(entry => {
            const h = Math.floor(entry.timestamp / 3600);
            const m = Math.floor((entry.timestamp % 3600) / 60);
            const s = Math.floor(entry.timestamp % 60);
            const timestamp = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
            sections.push(`### 📸 Keyframe **\`${timestamp}\`**\n\n\`\`\`text\n${entry.text}\n\`\`\`\n`);
          });
        }
      }
    }

    return sections.join("\n\n");
  }

  function captureVideoFrames(file, intervalSeconds) {
    return new Promise((resolve) => {
      const video = document.createElement("video");
      video.preload = "auto";
      video.muted = true;
      video.playsInline = true;

      const fileUrl = URL.createObjectURL(file);
      video.src = fileUrl;

      video.onloadedmetadata = () => {
        const duration = video.duration;
        const timestamps = [];
        for (let t = 0; t < duration; t += intervalSeconds) {
          timestamps.push(t);
        }
        if (timestamps.length === 0 || timestamps[timestamps.length - 1] < duration - 5) {
          timestamps.push(Math.max(0, duration - 1));
        }

        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");
        const frames = [];
        let index = 0;

        const captureNext = () => {
          if (index >= timestamps.length) {
            URL.revokeObjectURL(fileUrl);
            resolve(frames);
            return;
          }
          const ts = timestamps[index];
          video.currentTime = ts;

          video.onseeked = () => {
            canvas.width = video.videoWidth || 640;
            canvas.height = video.videoHeight || 360;
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

            const dataUrl = canvas.toDataURL("image/png");
            frames.push({ timestamp: ts, dataUrl });

            index++;
            captureNext();
          };
        };

        video.onerror = () => {
          URL.revokeObjectURL(fileUrl);
          resolve([]);
        };

        captureNext();
      };

      video.onerror = () => {
        URL.revokeObjectURL(fileUrl);
        resolve([]);
      };
    });
  }

  // --- Rendering Results ---
  function displayResults(markdownContent) {
    progressContainer.classList.add("hidden");
    resultsContainer.classList.remove("hidden");
    convertedMarkdown = markdownContent;
    markdownRawTextarea.value = markdownContent;

    try {
      const rawHtml = marked.parse(markdownContent);
      const cleanHtml = typeof DOMPurify !== "undefined"
        ? DOMPurify.sanitize(rawHtml, { ADD_TAGS: ["code"], ADD_ATTR: ["class"] })
        : rawHtml;
      tabPanePreview.innerHTML = cleanHtml;

      Prism.highlightAllUnder(tabPanePreview);
    } catch (e) {
      console.error("Markdown parse preview error:", e);
      tabPanePreview.innerHTML = `<p class="error-msg">Preview parse error: ${e.message}</p>`;
    }

    enableInputControls();
    generateSummary(markdownContent);
  }

  function enableInputControls() {
    convertBtn.disabled = false;
    whisperModelSelect.disabled = false;
    frameIntervalInput.disabled = false;
    removeFileBtn.disabled = false;
  }

  // --- Logs Utility ---
  function addLogEntry(source, text) {
    const entry = document.createElement("div");
    entry.className = "log-entry";

    const timeSpan = document.createElement("span");
    timeSpan.className = "log-time";
    timeSpan.textContent = new Date().toLocaleTimeString();

    const textSpan = document.createElement("span");
    textSpan.className = "log-text";
    textSpan.textContent = `[${source}] ${text}`;

    if (source === "Error") {
      textSpan.style.color = "var(--status-error)";
    } else if (source === "System") {
      textSpan.style.color = "var(--accent-cyan)";
    }

    entry.appendChild(timeSpan);
    entry.appendChild(textSpan);
    logsList.appendChild(entry);

    logsList.scrollTop = logsList.scrollHeight;
  }

  // --- Stage Stepper ---
  function resetStages() {
    if (!stageIndicators) return;
    stageIndicators.querySelectorAll(".stage").forEach(s => {
      s.classList.remove("active", "completed");
    });
    stageIndicators.querySelectorAll(".stage-connector").forEach(c => {
      c.classList.remove("active");
    });
  }

  function setStageActive(stageName) {
    if (!stageIndicators) return;
    const stages = ["upload", "processing", "complete"];
    const targetIndex = stages.indexOf(stageName);
    if (targetIndex < 0) return;

    stageIndicators.querySelectorAll(".stage").forEach(s => {
      const sStage = s.getAttribute("data-stage");
      const sIndex = stages.indexOf(sStage);
      if (sIndex < targetIndex) {
        s.classList.remove("active");
        s.classList.add("completed");
      } else if (sIndex === targetIndex) {
        s.classList.add("active");
        s.classList.remove("completed");
      } else {
        s.classList.remove("active", "completed");
      }
    });

    const connectors = stageIndicators.querySelectorAll(".stage-connector");
    connectors.forEach((c, i) => {
      if (i < targetIndex) {
        c.classList.add("active");
      } else {
        c.classList.remove("active");
      }
    });
  }

  // --- Utility sizes ---
  function formatBytes(bytes, decimals = 2) {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + " " + sizes[i];
  }

  // --- AI Summarization Features ---

  function initAISummaryFeature() {
    // Note: API Keys are not persisted in localStorage to ensure security and follow user request.
    if (geminiApiKeyInput) {
      geminiApiKeyInput.value = "";
    }

    // API Key visibility toggle
    if (toggleApiKeyBtn && geminiApiKeyInput) {
      toggleApiKeyBtn.addEventListener("click", () => {
        if (geminiApiKeyInput.type === "password") {
          geminiApiKeyInput.type = "text";
          toggleApiKeyBtn.textContent = "Hide";
        } else {
          geminiApiKeyInput.type = "password";
          toggleApiKeyBtn.textContent = "Show";
        }
      });
    }

    // Trigger summary on API key input (without saving to localStorage)
    if (geminiApiKeyInput) {
      geminiApiKeyInput.addEventListener("change", () => {
        if (convertedMarkdown && aiSummaryMode && aiSummaryMode.value !== "local") {
          generateSummary(convertedMarkdown);
        }
      });
    }

    // Proxy host configurations (non-sensitive, so we can save it)
    if (customProxyUrlInput) {
      const savedProxy = localStorage.getItem("custom_proxy_url") || "";
      customProxyUrlInput.value = savedProxy;
      customProxyUrlInput.addEventListener("input", () => {
        localStorage.setItem("custom_proxy_url", customProxyUrlInput.value.trim());
      });
    }

    // Summary mode dropdown logic
    if (aiSummaryMode) {
      aiSummaryMode.addEventListener("change", async () => {
        localStorage.setItem("ai_summary_mode", aiSummaryMode.value);
        await updateSummarySettingsUI();
        // Re-trigger summary generation if a file was already converted
        if (convertedMarkdown) {
          generateSummary(convertedMarkdown);
        }
      });

      // Load saved mode
      const savedMode = localStorage.getItem("ai_summary_mode") || "gemini";
      aiSummaryMode.value = savedMode;
    }

    updateSummarySettingsUI();
  }

  async function updateSummarySettingsUI() {
    if (!aiSummaryMode || !aiSummaryHelper) return;
    const mode = aiSummaryMode.value;

    if (mode === "local") {
      if (geminiKeyGroup) geminiKeyGroup.classList.add("hidden");
      if (customProxyGroup) customProxyGroup.classList.add("hidden");
      
      const check = await checkLocalSummarizerSupport();
      if (!check.supported) {
        aiSummaryHelper.textContent = "Unsupported in this browser. Please use a cloud model.";
        aiSummaryHelper.style.color = "var(--status-error)";
      } else if (check.status === "available") {
        aiSummaryHelper.textContent = "Local Gemini Nano is ready to use.";
        aiSummaryHelper.style.color = "var(--status-success)";
      } else if (check.status === "downloadable") {
        aiSummaryHelper.textContent = "Model needs to be downloaded by Chrome. Click Convert to initiate.";
        aiSummaryHelper.style.color = "var(--status-warning)";
      } else {
        aiSummaryHelper.textContent = `On-device summarizer status: ${check.status}.`;
        aiSummaryHelper.style.color = "";
      }
    } else {
      if (geminiKeyGroup) geminiKeyGroup.classList.remove("hidden");
      if (customProxyGroup) customProxyGroup.classList.remove("hidden");
      aiSummaryHelper.style.color = "";

      if (mode === "gemini") {
        aiSummaryHelper.textContent = "Summarize using Google Gemini API. (Bypasses browser CORS natively).";
        if (apiKeyLabel) apiKeyLabel.textContent = "Gemini API Key";
        if (geminiApiKeyInput) geminiApiKeyInput.placeholder = "AIzaSy...";
        if (apiKeyLink) {
          apiKeyLink.textContent = "Get a free key here";
          apiKeyLink.href = "https://aistudio.google.com/";
        }
      } else if (mode === "openai") {
        aiSummaryHelper.textContent = "Summarize using OpenAI Chat Completions (gpt-4o-mini).";
        if (apiKeyLabel) apiKeyLabel.textContent = "OpenAI API Key";
        if (geminiApiKeyInput) geminiApiKeyInput.placeholder = "sk-proj-...";
        if (apiKeyLink) {
          apiKeyLink.textContent = "Get a key here";
          apiKeyLink.href = "https://platform.openai.com/";
        }
      } else if (mode === "anthropic") {
        aiSummaryHelper.textContent = "Summarize using Anthropic Message API (claude-3-5-haiku).";
        if (apiKeyLabel) apiKeyLabel.textContent = "Anthropic API Key";
        if (geminiApiKeyInput) geminiApiKeyInput.placeholder = "sk-ant-...";
        if (apiKeyLink) {
          apiKeyLink.textContent = "Get a key here";
          apiKeyLink.href = "https://console.anthropic.com/";
        }
      }
    }
  }

  async function checkLocalSummarizerSupport() {
    if (!('Summarizer' in self)) {
      return { supported: false, status: "unsupported" };
    }
    try {
      const options = { type: 'key-points', format: 'markdown', length: 'medium' };
      const availability = await Summarizer.availability(options);
      return { supported: true, status: availability };
    } catch (e) {
      console.warn("Error checking local summarizer:", e);
      return { supported: false, status: "error", error: e.message };
    }
  }

  function getApiEndpoint(defaultBase, path, proxyUrl) {
    if (proxyUrl && proxyUrl.trim()) {
      let base = proxyUrl.trim();
      if (base.endsWith("/")) {
        base = base.slice(0, -1);
      }
      return `${base}${path}`;
    }
    return `${defaultBase}${path}`;
  }

  async function generateSummary(markdownContent) {
    if (!tabPaneSummary) return;
    if (!markdownContent || !markdownContent.trim()) {
      tabPaneSummary.innerHTML = `<div class="workspace-placeholder"><p>No converted content to summarize.</p></div>`;
      return;
    }

    const mode = aiSummaryMode ? aiSummaryMode.value : "gemini";
    
    if (mode === "local") {
      const check = await checkLocalSummarizerSupport();
      if (!check.supported) {
        tabPaneSummary.innerHTML = `
          <div class="workspace-placeholder">
            <svg class="placeholder-icon" viewBox="0 0 24 24" fill="none" stroke="var(--status-error)" stroke-width="1.2">
              <circle cx="12" cy="12" r="10"></circle>
              <line x1="12" y1="8" x2="12" y2="12"></line>
              <line x1="12" y1="16" x2="12.01" y2="16"></line>
            </svg>
            <h3 style="color: var(--status-error);">Local AI Unsupported</h3>
            <p>Your browser or system configuration does not support the experimental built-in Summarizer API (Gemini Nano).</p>
            <p>Please switch to one of the cloud model engines in the left options panel.</p>
          </div>
        `;
        return;
      }

      if (check.status === "downloadable" || check.status === "downloading") {
        tabPaneSummary.innerHTML = `
          <div class="workspace-placeholder">
            <svg class="placeholder-icon" viewBox="0 0 24 24" fill="none" stroke="var(--status-warning)" stroke-width="1.2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            <h3>Download Required</h3>
            <p>To summarize locally, Chrome needs to download the Gemini Nano model (~1.5GB) to your device.</p>
            <button id="btn-start-model-download" class="btn btn-primary btn-sm" style="margin-top: 10px;">Download Model & Summarize</button>
          </div>
        `;

        const btnDownload = document.getElementById("btn-start-model-download");
        if (btnDownload) {
          btnDownload.addEventListener("click", async () => {
            try {
              await startLocalSummarizationWithDownload(markdownContent);
            } catch (err) {
              console.error("Local summarization failed:", err);
              tabPaneSummary.innerHTML = `<p class="error-msg">Local Summarizer failed: ${err.message}</p>`;
            }
          });
        }
        return;
      }

      // If available, run immediately
      try {
        tabPaneSummary.innerHTML = `
          <div class="workspace-placeholder">
            <svg class="placeholder-icon" style="animation: pulse 1.2s infinite ease-in-out;" viewBox="0 0 24 24" fill="none" stroke="var(--accent-cyan)" stroke-width="1.2">
              <circle cx="12" cy="12" r="10"></circle>
              <path d="M12 16v-4"></path>
              <path d="M12 8h.01"></path>
            </svg>
            <h3>Analyzing locally...</h3>
            <p>Distilling document content using native Gemini Nano model...</p>
          </div>
        `;
        const summary = await summarizeWithLocalAI(markdownContent);
        renderSummaryHTML(summary);
      } catch (err) {
        console.error("Local summarization failed:", err);
        tabPaneSummary.innerHTML = `<p class="error-msg">Local Summarizer failed: ${err.message}</p>`;
      }

    } else {
      // Cloud modes
      const apiKey = geminiApiKeyInput ? geminiApiKeyInput.value.trim() : "";
      const proxyUrl = customProxyUrlInput ? customProxyUrlInput.value.trim() : "";
      
      const labelText = apiKeyLabel ? apiKeyLabel.textContent : "API Key";
      if (!apiKey) {
        tabPaneSummary.innerHTML = `
          <div class="workspace-placeholder">
            <svg class="placeholder-icon" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" stroke-width="1.2">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
              <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
            </svg>
            <h3>${labelText} Required</h3>
            <p>This session requires an active API Key. Please enter it in the left settings panel.</p>
          </div>
        `;
        return;
      }

      try {
        tabPaneSummary.innerHTML = `
          <div class="workspace-placeholder">
            <svg class="placeholder-icon" style="animation: float 3s ease-in-out infinite;" viewBox="0 0 24 24" fill="none" stroke="var(--accent-blue)" stroke-width="1.2">
              <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path>
            </svg>
            <h3>Generating Summary...</h3>
            <p>Sending request to the configured API endpoint...</p>
          </div>
        `;
        
        let summary = "";
        if (mode === "gemini") {
          summary = await summarizeWithGeminiAPI(markdownContent, apiKey, proxyUrl);
        } else if (mode === "openai") {
          summary = await summarizeWithOpenAI(markdownContent, apiKey, proxyUrl);
        } else if (mode === "anthropic") {
          summary = await summarizeWithAnthropic(markdownContent, apiKey, proxyUrl);
        }
        
        renderSummaryHTML(summary);
      } catch (err) {
        console.error("Cloud API summarization failed:", err);
        tabPaneSummary.innerHTML = `
          <div class="workspace-placeholder">
            <h3 style="color: var(--status-error);">Summarization Failed</h3>
            <p class="error-msg" style="margin-top:10px;">${err.message}</p>
            <p style="font-size: 0.8rem; margin-top: 10px;">Please check if your API Key is valid or if you are facing CORS restrictions (if using default hosts for OpenAI/Anthropic). You can also configure a custom API proxy.</p>
          </div>
        `;
      }
    }
  }

  async function startLocalSummarizationWithDownload(markdownContent) {
    if (!tabPaneSummary) return;
    tabPaneSummary.innerHTML = `
      <div class="workspace-placeholder">
        <svg class="placeholder-icon" style="animation: pulse 1.5s infinite;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="7 10 12 15 17 10" />
          <line x1="12" y1="15" x2="12" y2="3" />
        </svg>
        <h3>Downloading Local AI Model...</h3>
        <p id="download-progress-text">Downloading Gemini Nano (~1.5GB). This runs entirely in your browser. Please do not close this tab...</p>
      </div>
    `;

    try {
      const options = { type: 'key-points', format: 'markdown', length: 'medium' };
      const summarizer = await Summarizer.create({
        ...options,
        monitor(m) {
          m.addEventListener('downloadprogress', (e) => {
            const pct = Math.round((e.loaded / e.total) * 100);
            const progressText = document.getElementById("download-progress-text");
            if (progressText) {
              progressText.textContent = `Downloading Gemini Nano model: ${pct}% complete...`;
            }
          });
        }
      });

      tabPaneSummary.innerHTML = `
        <div class="workspace-placeholder">
          <svg class="placeholder-icon" style="animation: pulse 1.2s infinite ease-in-out;" viewBox="0 0 24 24" fill="none" stroke="var(--accent-cyan)" stroke-width="1.2">
            <circle cx="12" cy="12" r="10"></circle>
            <path d="M12 16v-4"></path>
            <path d="M12 8h.01"></path>
          </svg>
          <h3>Analyzing locally...</h3>
          <p>Model download complete. Analyzing document...</p>
        </div>
      `;

      const summary = await summarizer.summarize(markdownContent);
      renderSummaryHTML(summary);
      
      // Update UI Status Badge
      await updateSummarySettingsUI();
    } catch (e) {
      throw new Error(`Failed during download or initialization: ${e.message}`);
    }
  }

  async function summarizeWithLocalAI(text) {
    const options = { type: 'key-points', format: 'markdown', length: 'medium' };
    const summarizer = await Summarizer.create(options);
    const summary = await summarizer.summarize(text);
    return summary;
  }

  async function summarizeWithGeminiAPI(text, apiKey, proxyUrl) {
    const path = `/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
    const url = getApiEndpoint("https://generativelanguage.googleapis.com", path, proxyUrl);
    
    const prompt = `You are a helpful assistant. Provide a detailed, clear, and highly structured human-readable description and summary of the following document content in Markdown format. Outline key topics, main insights, and a brief TL;DR at the top. If there are tables, transcripts, or code blocks in the source, summarize what they represent:

${text}`;

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{
          parts: [{ text: prompt }]
        }]
      })
    });

    if (!response.ok) {
      const errJson = await response.json().catch(() => ({}));
      const errMsg = errJson.error?.message || `HTTP ${response.status} Error`;
      throw new Error(errMsg);
    }

    const data = await response.json();
    const summaryText = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!summaryText) {
      throw new Error("Invalid response structure from Gemini API");
    }
    return summaryText;
  }

  async function summarizeWithOpenAI(text, apiKey, proxyUrl) {
    const path = "/v1/chat/completions";
    const url = getApiEndpoint("https://api.openai.com", path, proxyUrl);
    const model = "gpt-4o-mini";
    
    const prompt = `You are a helpful assistant. Provide a detailed, clear, and highly structured human-readable description and summary of the following document content in Markdown format. Outline key topics, main insights, and a brief TL;DR at the top. If there are tables, transcripts, or code blocks in the source, summarize what they represent:

${text}`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: model,
        messages: [{ role: "user", content: prompt }]
      })
    });

    if (!response.ok) {
      const errJson = await response.json().catch(() => ({}));
      const errMsg = errJson.error?.message || `HTTP ${response.status} Error`;
      throw new Error(errMsg);
    }

    const data = await response.json();
    const summaryText = data.choices?.[0]?.message?.content;
    if (!summaryText) {
      throw new Error("Invalid response structure from OpenAI API");
    }
    return summaryText;
  }

  async function summarizeWithAnthropic(text, apiKey, proxyUrl) {
    const path = "/v1/messages";
    const url = getApiEndpoint("https://api.anthropic.com", path, proxyUrl);
    const model = "claude-3-5-haiku-20241022";
    
    const prompt = `You are a helpful assistant. Provide a detailed, clear, and highly structured human-readable description and summary of the following document content in Markdown format. Outline key topics, main insights, and a brief TL;DR at the top. If there are tables, transcripts, or code blocks in the source, summarize what they represent:

${text}`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "dangerously-allow-browser": "true"
      },
      body: JSON.stringify({
        model: model,
        max_tokens: 4000,
        messages: [{ role: "user", content: prompt }]
      })
    });

    if (!response.ok) {
      const errJson = await response.json().catch(() => ({}));
      const errMsg = errJson.error?.message || `HTTP ${response.status} Error`;
      throw new Error(errMsg);
    }

    const data = await response.json();
    const summaryText = data.content?.[0]?.text;
    if (!summaryText) {
      throw new Error("Invalid response structure from Anthropic API");
    }
    return summaryText;
  }

  function renderSummaryHTML(summaryMarkdown) {
    if (!tabPaneSummary) return;
    try {
      const rawHtml = marked.parse(summaryMarkdown);
      const cleanHtml = typeof DOMPurify !== "undefined"
        ? DOMPurify.sanitize(rawHtml, { ADD_TAGS: ["code"], ADD_ATTR: ["class"] })
        : rawHtml;
      
      tabPaneSummary.innerHTML = cleanHtml;
      Prism.highlightAllUnder(tabPaneSummary);
    } catch (e) {
      console.error("Markdown parse summary error:", e);
      tabPaneSummary.innerHTML = `<p class="error-msg">Summary rendering error: ${e.message}</p>
                                  <textarea class="markdown-raw" readonly>${summaryMarkdown}</textarea>`;
    }
  }
});
