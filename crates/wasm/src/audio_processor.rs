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

const BUFFER_SIZE: usize = 128;

#[wasm_bindgen]
pub struct AudioProcessor {
    input_buffer: Vec<f32>,
    output_buffer: Vec<f32>,
    bit_depth: u8,
    sample_rate: f32,
    processing_enabled: bool,
    buffer_position: usize,
    start_time: Option<f64>,
    decay_duration: f64,
    initial_bit_depth: u8,
}

#[wasm_bindgen]
impl AudioProcessor {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        console_log!("Creating new AudioProcessor");
        Self {
            input_buffer: vec![0.0; BUFFER_SIZE],
            output_buffer: vec![0.0; BUFFER_SIZE],
            bit_depth: 16,
            initial_bit_depth: 16,
            sample_rate: 48000.0,
            processing_enabled: true,
            buffer_position: 0,
            start_time: None,
            decay_duration: 30.0,
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
        if !self.processing_enabled || offset + length > BUFFER_SIZE {
            return;
        }

        // Initialize start time if not set
        if self.start_time.is_none() {
            self.start_time = Some(js_sys::Date::now() / 1000.0);
            self.initial_bit_depth = self.bit_depth;
        }

        // Calculate decay progress (0.0 to 1.0)
        let current_time = js_sys::Date::now() / 1000.0;
        let elapsed = current_time - self.start_time.unwrap();
        let decay_progress = (elapsed / self.decay_duration).min(1.0);

        // Degrade bit depth over time (from initial to 4 bits)
        let target_bit_depth =
            (self.initial_bit_depth as f64 * (1.0 - decay_progress) + 4.0 * decay_progress) as u8;
        self.bit_depth = target_bit_depth.max(4);

        // Calculate sample rate reduction (skip more samples as time progresses)
        let sample_skip = ((decay_progress * 4.0) as usize).max(1);

        let input_slice = &self.input_buffer[offset..offset + length];
        let input_level = input_slice.iter().map(|&x| x.abs()).fold(0.0_f32, f32::max);
        console_log!("Pre-processing input level: {}", input_level);

        // Process samples with degrading quality
        for i in (0..length).step_by(sample_skip) {
            let sample = input_slice[i];

            // Apply increasingly aggressive bit reduction
            let scale = (1 << (self.bit_depth - 1)) as f32;
            let processed = (sample * scale).round() / scale;

            // Fill skipped samples with the same value (sample & hold)
            for j in 0..sample_skip {
                if i + j < length {
                    self.output_buffer[offset + i + j] = processed;
                }
            }
        }

        let output_level = self.output_buffer[offset..offset + length]
            .iter()
            .map(|&x| x.abs())
            .fold(0.0_f32, f32::max);
        console_log!(
            "Post-processing level: {}, bit_depth: {}, skip: {}",
            output_level,
            self.bit_depth,
            sample_skip
        );
    }

    #[wasm_bindgen]
    pub fn set_bit_depth(&mut self, depth: u8) {
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
