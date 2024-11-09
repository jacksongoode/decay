// src/audio_processor.rs
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_namespace = console)]
    fn log(s: &str);

    #[wasm_bindgen(js_namespace = console, js_name = log)]
    fn log_u32(a: u32);

    #[wasm_bindgen(js_namespace = console, js_name = log)]
    fn log_many(a: &str, b: &str);
}

macro_rules! console_log {
    ($($t:tt)*) => (log(&format_args!($($t)*).to_string()))
}

#[wasm_bindgen]
#[derive(Default)]
pub struct AudioMetrics {
    pub spectral_complexity: f64,
}

#[wasm_bindgen]
impl AudioMetrics {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        Self::default()
    }

    pub fn analyze_buffer(&mut self, samples: &[f32]) {
        // Simple spectral complexity estimation
        let mut sum_differences = 0.0;
        for window in samples.windows(2) {
            if let [a, b] = window {
                sum_differences += (b - a).abs() as f64;
            }
        }

        // Normalize and update complexity
        self.spectral_complexity = (sum_differences / samples.len() as f64).min(1.0).max(0.0);
    }
}

const BUFFER_SIZE: usize = 2048;

#[wasm_bindgen]
pub struct AudioProcessor {
    current_bitrate: u32,
    min_bitrate: u32,
    max_bitrate: u32,
    sample_reduction: f32,
    input_buffer: Vec<f32>,
    output_buffer: Vec<f32>,
    // Add sample_rate if you need it for processing
    // sample_rate: f32,
}

#[wasm_bindgen]
impl AudioProcessor {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        AudioProcessor {
            current_bitrate: 128000,
            min_bitrate: 1000,
            max_bitrate: 128000,
            sample_reduction: 1.0,
            input_buffer: vec![0.0; BUFFER_SIZE],
            output_buffer: vec![0.0; BUFFER_SIZE],
        }
    }

    #[wasm_bindgen]
    pub fn get_input_buffer_ptr(&self) -> *const f32 {
        self.input_buffer.as_ptr()
    }

    #[wasm_bindgen]
    pub fn get_output_buffer_ptr(&mut self) -> *mut f32 {
        self.output_buffer.as_mut_ptr()
    }

    #[wasm_bindgen]
    pub fn process_audio(&mut self, length: usize) {
        // Call the existing buffer processing method with the current sample rate
        self.process_audio_buffer(length, 44100.0); // We could make sample_rate a struct field if needed
    }

    #[wasm_bindgen]
    pub fn process_audio_buffer(&mut self, length: usize, sample_rate: f32) {
        // Process in chunks for better SIMD optimization
        const CHUNK_SIZE: usize = 64;

        for chunk_start in (0..length).step_by(CHUNK_SIZE) {
            let chunk_end = (chunk_start + CHUNK_SIZE).min(length);

            // Process chunk of samples
            for i in chunk_start..chunk_end {
                let processed = self.process_single_sample(self.input_buffer[i]);
                self.output_buffer[i] = processed;
            }
        }
    }

    #[inline(always)]
    fn process_single_sample(&mut self, sample: f32) -> f32 {
        // Fast path for high quality
        if self.sample_reduction > 0.95 {
            return sample;
        }

        let bit_depth = (24.0 * self.sample_reduction).max(8.0) as i32;
        let quantization_steps = 1_u32.wrapping_shl(bit_depth as u32) as f32;

        // Optimized processing path
        let processed = if sample.abs() > 0.8 {
            sample * (1.0 - (sample.abs() - 0.8) * 0.75)
        } else {
            sample
        };

        let noise = (rand::random::<f32>() - 0.5) * (1.0 / quantization_steps);
        ((processed + noise * self.sample_reduction) * quantization_steps).floor()
            / quantization_steps
    }

    pub fn adjust_bitrate(&mut self, target_bitrate: u32) -> u32 {
        console_log!("WASM Adjusting bitrate to {} kbps", target_bitrate / 1000);

        // Simply clamp to valid range
        self.current_bitrate = target_bitrate.clamp(self.min_bitrate, self.max_bitrate);

        // Update sample reduction based on current bitrate
        self.sample_reduction = (self.current_bitrate as f32 / self.max_bitrate as f32)
            .powf(2.5) // Non-linear reduction
            .max(0.05); // Lower minimum quality

        self.current_bitrate
    }
}
