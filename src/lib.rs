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
            decay_rate: 1.0,
        }
    }

    pub fn process_audio(&mut self, input: &[f32]) -> Vec<f32> {
        // Basic implementation - will expand this later
        input.to_vec()
    }
}

// This is required for proper WebAssembly initialization
#[wasm_bindgen]
pub fn init_panic_hook() {
    console_error_panic_hook::set_once();
}
