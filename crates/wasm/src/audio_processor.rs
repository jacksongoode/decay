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
    phase_accumulator: f32,
    previous_sample: f32,
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
            phase_accumulator: 0.0,
            previous_sample: 0.0,
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

        // Process each sample individually for a simple pitch shift down one octave
        for i in 0..length {
            let input_index = (offset + i) / 2; // Read at half speed for pitch shift
            if input_index < BUFFER_SIZE {
                self.output_buffer[offset + i] = self.input_buffer[input_index];
            } else {
                self.output_buffer[offset + i] = 0.0; // Handle out of bounds
            }
        }

        let output_level = self.output_buffer[offset..offset + length]
            .iter()
            .map(|&x| x.abs())
            .fold(0.0_f32, f32::max);
        console_log!(
            "Post-processing level: {}, pitch shifted down one octave",
            output_level
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
