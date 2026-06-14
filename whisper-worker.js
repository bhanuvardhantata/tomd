import { pipeline, env } from './lib/transformers.js';

// Configure transformers.js environment for local model loading
env.allowLocalModels = true;
env.allowRemoteModels = true;
env.localModelPath = './models/';

let whisperPipeline = null;
let currentModelName = "";

self.onmessage = async (event) => {
  const { action, audio, modelName } = event.data;

  if (action === "transcribe") {
    try {
      // Initialize or load new model if modelName changed
      if (!whisperPipeline || currentModelName !== modelName) {
        self.postMessage({ 
          status: "loading", 
          message: `Loading Whisper model: ${modelName}...` 
        });
        
        whisperPipeline = await pipeline("automatic-speech-recognition", modelName, {
          progress_callback: (p) => {
            if (p.status === "progress") {
              self.postMessage({ 
                status: "progress", 
                progress: p.progress 
              });
            }
          }
        });
        currentModelName = modelName;
        self.postMessage({ 
          status: "loaded", 
          message: "Whisper model loaded successfully." 
        });
      }

      // Split audio into 30-second chunks (at 16kHz sample rate)
      const sampleRate = 16000;
      const chunkSize = 30 * sampleRate; // 480,000 samples per chunk
      const totalSamples = audio.length;
      let offset = 0;
      const chunksToProcess = [];

      while (offset < totalSamples) {
        chunksToProcess.push(audio.subarray(offset, Math.min(totalSamples, offset + chunkSize)));
        offset += chunkSize;
      }

      self.postMessage({ 
        status: "transcribing", 
        message: `Initializing transcription: 0/${chunksToProcess.length} segments completed...` 
      });

      const accumulatedResultChunks = [];
      let accumulatedText = "";

      for (let i = 0; i < chunksToProcess.length; i++) {
        const chunkAudio = chunksToProcess[i];
        const chunkStartTime = i * 30; // 30s step per chunk

        self.postMessage({
          status: "transcribing_chunk",
          message: `Transcribing audio segment ${i + 1} of ${chunksToProcess.length}...`,
          progress: Math.round((i / chunksToProcess.length) * 100)
        });

        const result = await whisperPipeline(chunkAudio, {
          chunk_length_s: 30,
          stride_length_s: 5,
          return_timestamps: true
        });

        if (result) {
          accumulatedText += (result.text || "") + " ";
          
          if (result.chunks) {
            const shifted = result.chunks.map(c => {
              const start = c.timestamp[0] !== null ? c.timestamp[0] + chunkStartTime : chunkStartTime;
              const end = c.timestamp[1] !== null ? c.timestamp[1] + chunkStartTime : chunkStartTime;
              return {
                ...c,
                text: c.text,
                timestamp: [start, end]
              };
            });
            accumulatedResultChunks.push(...shifted);
          }
        }
      }

      const finalResult = {
        text: accumulatedText.trim(),
        chunks: accumulatedResultChunks
      };

      self.postMessage({ 
        status: "completed", 
        result: finalResult 
      });
    } catch (err) {
      self.postMessage({ 
        status: "error", 
        error: err.message || String(err) 
      });
    }
  }
};
