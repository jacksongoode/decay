pub mod config;
pub mod types;

use wasm_bindgen::prelude::*;

// Initialize panic hook for better error messages
#[wasm_bindgen(start)]
pub fn init() {
    console_error_panic_hook::set_once();
}

#[wasm_bindgen]
pub struct AudioProcessor {
    sample_rate: f32,
    decay_rate: f32,
}

#[wasm_bindgen]
impl AudioProcessor {
    #[wasm_bindgen(constructor)]
    pub fn new(sample_rate: f32) -> Self {
        Self {
            sample_rate,
            decay_rate: calculate_initial_decay_rate(sample_rate),
        }
    }

    pub fn process_audio(&mut self, input: &[f32]) -> Vec<f32> {
        // Actually use the fields to process audio
        input
            .iter()
            .map(|&sample| sample * self.decay_rate)
            .collect()
    }

    pub fn update_decay_rate(&mut self, new_rate: f32) {
        self.decay_rate = new_rate.clamp(0.0, 1.0);
    }
}

fn calculate_initial_decay_rate(sample_rate: f32) -> f32 {
    // Simple example calculation
    (1.0 / sample_rate).clamp(0.0, 1.0)
}

// This is required for proper WebAssembly initialization
#[wasm_bindgen]
pub fn init_panic_hook() {
    console_error_panic_hook::set_once();
}
