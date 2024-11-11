// src/audio_processor.rs
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_namespace = console)]
    fn log(s: &str);
}

macro_rules! console_log {
    ($($t:tt)*) => (log(&format_args!($($t)*).to_string()))
}

const BUFFER_SIZE: usize = 2048;

#[wasm_bindgen]
pub struct AudioProcessor {
    input_buffer: Vec<f32>,
    output_buffer: Vec<f32>,
    bit_depth: u32,
    sample_rate: f32,
    buffer_position: usize,
    processing_enabled: bool,
}

#[wasm_bindgen]
impl AudioProcessor {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        console_error_panic_hook::set_once();
        console_log!("Creating new AudioProcessor");

        Self {
            input_buffer: vec![0.0; BUFFER_SIZE],
            output_buffer: vec![0.0; BUFFER_SIZE],
            bit_depth: 16,
            sample_rate: 48000.0,
            buffer_position: 0,
            processing_enabled: true,
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
    pub fn process_audio(&mut self, offset: usize, length: usize) {
        if offset + length > BUFFER_SIZE {
            return;
        }

        let input = &self.input_buffer[offset..offset + length];
        let output = &mut self.output_buffer[offset..offset + length];

        // Apply more aggressive processing
        for (i, &sample) in input.iter().enumerate() {
            // Apply bit reduction with gain
            let scale = (1 << (self.bit_depth - 1)) as f32;
            let processed = (sample * scale * 2.0).round() / scale; // Added gain
            output[i] = processed.max(-1.0).min(1.0); // Clamp to prevent distortion
        }

        // Update buffer position
        self.buffer_position = (self.buffer_position + length) % BUFFER_SIZE;
    }

    #[wasm_bindgen]
    pub fn set_bit_depth(&mut self, depth: u32) {
        self.bit_depth = depth.clamp(4, 16);
        console_log!("Bit depth set to {}", self.bit_depth);
    }

    #[wasm_bindgen]
    pub fn set_sample_rate(&mut self, rate: f32) {
        self.sample_rate = rate;
        console_log!("Sample rate set to {}", rate);
    }

    #[wasm_bindgen]
    pub fn enable_processing(&mut self, enabled: bool) {
        self.processing_enabled = enabled;
        console_log!("Processing enabled: {}", enabled);
    }

    #[wasm_bindgen]
    pub fn get_buffer_size(&self) -> usize {
        BUFFER_SIZE
    }

    #[wasm_bindgen]
    pub fn get_buffer_position(&self) -> usize {
        self.buffer_position
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_audio_processing() {
        let mut processor = AudioProcessor::new();

        // Test with simple sine wave
        for i in 0..BUFFER_SIZE {
            let t = i as f32 / 48000.0;
            processor.input_buffer[i] = (t * 440.0 * 2.0 * std::f32::consts::PI).sin();
        }

        processor.process_audio(0, BUFFER_SIZE);

        // Verify output is within bounds
        for sample in processor.output_buffer.iter() {
            assert!(sample.abs() <= 1.0);
        }
    }

    #[test]
    fn test_processing_disabled() {
        let mut processor = AudioProcessor::new();
        processor.enable_processing(false);

        // Fill input with test data
        for i in 0..BUFFER_SIZE {
            processor.input_buffer[i] = (i as f32 / BUFFER_SIZE * 2.0 - 1.0) * 0.99;
        }

        processor.process_audio(0, BUFFER_SIZE);

        // Verify output is unchanged
        for i in 0..BUFFER_SIZE {
            assert_eq!(processor.input_buffer[i], processor.output_buffer[i]);
        }
    }
}
