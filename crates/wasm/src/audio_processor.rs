// src/audio_processor.rs
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct AudioProcessor {
    current_bitrate: u32,
    min_bitrate: u32,
    max_bitrate: u32,
}

#[wasm_bindgen]
impl AudioProcessor {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        AudioProcessor {
            current_bitrate: 128000, // 128 kbps
            min_bitrate: 1000,       // 1 kbps
            max_bitrate: 128000,     // 128 kbps
        }
    }

    pub fn adjust_bitrate(&mut self, target_bitrate: u32) -> u32 {
        self.current_bitrate = target_bitrate.clamp(self.min_bitrate, self.max_bitrate);
        self.current_bitrate
    }
}
