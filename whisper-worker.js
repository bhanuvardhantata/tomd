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

      self.postMessage({ 
        status: "transcribing", 
        message: "Running speech recognition..." 
      });

      const transcriptionResult = await whisperPipeline(audio, {
        chunk_length_s: 30,
        stride_length_s: 5,
        return_timestamps: true
      });

      self.postMessage({ 
        status: "completed", 
        result: transcriptionResult 
      });
    } catch (err) {
      self.postMessage({ 
        status: "error", 
        error: err.message || String(err) 
      });
    }
  }
};
